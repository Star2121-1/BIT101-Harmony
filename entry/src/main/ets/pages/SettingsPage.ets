/**
 * 设置页（M6-1 框架 / M6-3 深浅色 / M6-4 账号与登出 / M6-5 默认校区）
 *
 * 一个页面承载四件事，因为它们都是「低频、分组明确、进来改完就走」的设置项。
 * 分成四个页面反而要多点两下。
 *
 * ## 深色怎么生效
 * 本页改的是 `ThemeStore`，它往 `AppStorage` 广播 `ui_dark`；
 * 其它页面用 `@StorageLink('ui_dark')` + `@StorageLink('ui_palette')` 订阅，
 * 从 `gridTokens(isDark, palette)` 取色（#89 起 palette 轴可切）。
 * 颜色值本身在 `core/theme/GridTokens.ts`（三套 palette × 明暗，本页可切），
 * 对比度由 `tools/test-gridcontrast.mjs` 钉住。
 *
 * ## 登出的边界（重要）
 * 只清 **cookie + JWT**，**不清课表缓存**。
 * 理由是用户登出后仍应能离线看课表（那是他已经看到的公开数据），
 * 而「无 cookie 但有缓存」正好是自习卡 nologin 降级态的真实场景。
 */

import { router } from '@kit.ArkUI';
import { Context } from '@kit.AbilityKit';
import { bundleManager } from '@kit.AbilityKit';
import { gridTokens } from '../core/theme/GridTokens.ts';
import type { GridTokens } from '../core/theme/GridTokens.ts';
import type { PaletteName } from '../core/theme/GridTokens.ts';
import {
  ThemeStore, STORAGE_DARK, STORAGE_PALETTE, getPalette,
  MODE_AUTO, MODE_LIGHT, MODE_DARK,
  PALETTE_BRAND, PALETTE_CLASSIC, PALETTE_WARM
} from '../data/ThemeStore.ts';
import { SessionStore } from '../data/SessionStore.ts';
import { SchoolCookieStore } from '../data/SchoolCookieStore.ts';
import { EclassCookieStore } from '../data/EclassCookieStore.ts';
import { LibCookieStore } from '../data/LibCookieStore.ts';
import { CardCookieStore } from '../data/CardCookieStore.ts';
import { CampusCardStore } from '../data/CampusCardStore.ts';
import { CampusNetTrafficStore } from '../data/CampusNetTrafficStore.ts';
import { Prefs } from '../data/Prefs.ts';
import { TermStore, STORAGE_TERM, splitTermsByRecentYears, TermSplit } from '../data/TermStore.ts';
import { SchoolService } from '../service/SchoolService.ts';
import { CampusInfo } from '../core/model/SchoolModels.ts';
import { info, warn } from '../core/log/BitLog.ts';
import { JxzxProbe } from '../service/JxzxProbe.ts';
import { TimeTableStore } from '../data/TimeTableStore.ts';
import { ScoreCheckRunner } from '../service/ScoreCheckRunner.ts';
import { statusText, ScoreCheckCode } from '../corelogic/ScoreCheckLogic.ts';
import { DdlSourceStore } from '../data/DdlSourceStore.ts';
import type { DdlSourcePrefs } from '../corelogic/DdlSourceLogic.ts';

/** 默认校区偏好的持久化键（ClassroomPage 也读这个）。 */
export const KEY_DEFAULT_CAMPUS: string = 'default_campus_code';
export const KEY_DEFAULT_CAMPUS_NAME: string = 'default_campus_name';

/** 学期选择器中「近期」保留的学年数（默认 3 学年；更早的折叠进「展开旧学期」）。 */
const RECENT_TERM_YEARS: number = 3;

@Entry
@Component
struct SettingsPage {
  /** 订阅全局深浅色：设置页自己也要立刻跟着变（用户就在这页点）。 */
  @StorageLink(STORAGE_DARK) isDark: boolean = false;
  @StorageLink(STORAGE_PALETTE) paletteName: string = 'warm';

  @State mode: string = MODE_AUTO;
  @State studentId: string = '';
  @State loggedIn: boolean = false;
  @State campusName: string = '';
  @State campusCode: string = '';
  @State campusList: CampusInfo[] = [];
  @State pickerOpen: boolean = false;
  @State busy: boolean = false;
  @State toast: string = '';
  @State versionText: string = '';
  /** 开发者选项：默认收起。M1/M2 的验证件收在这里，不占正式界面。 */
  @State devOpen: boolean = false;
  @State diagText: string = '';
  /** 作息是否为自定义（从 TimeTableStore 读）。 */
  @State ttCustom: boolean = false;
  /** 最近一次出分检查的一句话状态（M7-3：后台静默跑的东西要看得见）。 */
  @State scoreLine: string = '';
  /** 作业来源开关（M4-5；落盘在 DdlSourceStore）。 */
  @State ddlEclass: boolean = true;
  @State ddlLocal: boolean = true;

  // ── 学期（对照原版：切学期在设置里，不在课表页） ──
  /** 订阅全局学期覆盖值（'' = 跟随教务）；课表页也订阅同一个键。 */
  @StorageLink(STORAGE_TERM) termOverride: string = '';
  /** 可选学期（教务返回，新→旧）。空 = 还没取到/取失败。 */
  @State termList: string[] = [];
  @State termBusy: boolean = false;
  /** 学期组的一行说明（取列表失败、已切换等，如实上屏，不吞）。 */
  @State termMsg: string = '';
  /** 旧学期是否展开（默认收起，避免一长串历史学期占满屏）。 */
  @State termExpanded: boolean = false;

  private p(): GridTokens {
    return gridTokens(this.isDark, getPalette(this.paletteName));
  }

  aboutToAppear(): void {
    this.refresh();
    this.loadVersion();
    this.loadTermList();
    this.loadScoreLine();
    this.loadDdlSource();
  }

  /** 出分检查的最近状态（读失败就给「还没检查过」，不抛）。 */
  private async loadScoreLine(): Promise<void> {
    const st = await ScoreCheckRunner.lastStatus();
    this.scoreLine = statusText(st);
  }

  private async loadDdlSource(): Promise<void> {
    const p: DdlSourcePrefs = await DdlSourceStore.load();
    this.ddlEclass = p.eclass;
    this.ddlLocal = p.local;
  }

  /**
   * 手动跑一次出分检查（force = 跳过 12h 闸门）。
   * 结果如实写进 `scoreLine`：这三类失败的下步动作完全不同，不能都写成「失败」。
   */
  private async runScoreCheckNow(): Promise<void> {
    if (this.busy) {
      return;
    }
    this.busy = true;
    this.toast = '';
    try {
      const ctx: Context = getContext(this) as Context;
      const out = await ScoreCheckRunner.check(ctx, true, true);
      if (!out.ran) {
        this.scoreLine = out.reason;
      } else if (out.code === ScoreCheckCode.OK) {
        let t: string = '刚检查：' + out.count + ' 门课';
        if (out.newCount > 0) {
          t = t + '（新出分 ' + out.newCount + ' 门）';
        }
        this.scoreLine = t;
      } else if (out.code === ScoreCheckCode.AUTH_FAILED) {
        this.scoreLine = '学校未通过登录（重试无效，请确认学号密码）';
      } else if (out.code === ScoreCheckCode.NEED_SMS) {
        this.scoreLine = '学校要求短信验证，本次无法检查';
      } else if (out.code === ScoreCheckCode.NOT_LOGGED_IN) {
        this.scoreLine = '还没保存学号密码（去「成绩查询」里保存）';
      } else {
        this.scoreLine = '检查失败' + (out.detail === null ? '' : '：' + out.detail);
      }
    } catch (e) {
      this.toast = '检查异常：' + (e as Error).message;
    }
    this.busy = false;
  }

  /** 切一个来源开关（which 只认 'eclass' / 'local'；其它调用是 bug，按 no-op 处理）。 */
  private async toggleDdlSource(which: string): Promise<void> {
    const next: DdlSourcePrefs = { eclass: this.ddlEclass, local: this.ddlLocal };
    if (which === 'eclass') {
      next.eclass = !next.eclass;
    } else if (which === 'local') {
      next.local = !next.local;
    } else {
      return;
    }
    this.ddlEclass = next.eclass;
    this.ddlLocal = next.local;
    try {
      await DdlSourceStore.save(next);
    } catch (e) {
      this.toast = '保存作业来源失败：' + (e as Error).message;
    }
  }

  /**
   * 拉学期列表（失败就如实报，不静默）。
   * ⚠️ 只在进设置页时拉一次：这个列表一天最多变一次，没必要每次点都联网。
   */
  private async loadTermList(): Promise<void> {
    if (this.termBusy) {
      return;
    }
    this.termBusy = true;
    this.termMsg = '';
    try {
      const ctx: Context = getContext(this) as Context;
      const list: string[] = await SchoolService.getTermList(ctx);
      this.termList = list;
      if (list.length === 0) {
        this.termMsg = '教务没有返回任何学期';
      }
      info('Settings termList=' + list.length);
    } catch (e) {
      this.termMsg = '取不到学期列表（' + (e as Error).message + '）';
      warn('Settings termList fail: ' + JSON.stringify(e));
    }
    this.termBusy = false;
  }

  /** 切学期（'' = 跟随教务）。写完由 AppStorage 广播，课表页 @Watch 自己重载。 */
  private async changeTerm(value: string): Promise<void> {
    if (value === this.termOverride) {
      return;
    }
    try {
      const ctx: Context = getContext(this) as Context;
      await TermStore.set(ctx, value);
      this.termMsg = value.length > 0 ? '已切到 ' + value : '已恢复跟随教务';
      info('Settings term -> ' + (value.length > 0 ? value : '(follow)'));
    } catch (e) {
      this.termMsg = '保存学期失败（' + (e as Error).message + '）';
      warn('Settings changeTerm fail: ' + JSON.stringify(e));
    }
  }

  /**
   * 把学期列表拆成「近期」与「旧学期」两截（委托纯函数，便于离线单测）。
   */
  private termSplit(): TermSplit {
    return splitTermsByRecentYears(this.termList, RECENT_TERM_YEARS);
  }

  /** 折叠态/展开态实际要渲染的学期列表（build 里只能写 UI 语法，故抽到方法）。 */
  private visibleTerms(): string[] {
    const split: TermSplit = this.termSplit();
    const collapsed: string[] = split.recent.slice();
    // 当前选中的若是更旧的、不在近期里，单列出来，否则选了旧学期却看不见、切不回来
    if (this.termOverride.length > 0 && !split.recent.includes(this.termOverride)) {
      collapsed.push(this.termOverride);
    }
    return this.termExpanded ? split.recent.concat(split.old) : collapsed;
  }

  /** 旧学期数量（用于「展开旧学期（更早的 N 个）」文案）。 */
  private oldTermCount(): number {
    return this.termSplit().old.length;
  }

  private async refresh(): Promise<void> {
    this.mode = ThemeStore.mode();
    this.paletteName = ThemeStore.palette();
    try {
      const snap = await SessionStore.snapshot();
      this.studentId = snap.studentId;
      this.loggedIn = snap.hasSchoolCookies;
    } catch (e) {
      warn('Settings refresh fail: ' + JSON.stringify(e));
    }
    try {
      this.ttCustom = await TimeTableStore.isCustom();
    } catch (e) {
      this.ttCustom = false;
    }
    try {
      this.campusCode = await Prefs.getString(KEY_DEFAULT_CAMPUS, '');
      this.campusName = await Prefs.getString(KEY_DEFAULT_CAMPUS_NAME, '');
    } catch (e) {
      warn('Settings read campus fail: ' + JSON.stringify(e));
    }
  }

  private loadVersion(): void {
    try {
      const bi = bundleManager.getBundleInfoForSelfSync(
        bundleManager.BundleFlag.GET_BUNDLE_INFO_DEFAULT);
      this.versionText = bi.versionName + ' (' + bi.versionCode + ')';
    } catch (e) {
      this.versionText = '取不到版本号';
    }
  }

  /** 学号打码：只露头 4 位尾巴 2 位。设置页是会被别人瞄一眼的页面。 */
  private maskedId(): string {
    const s: string = this.studentId;
    if (s.length <= 6) {
      return s.length > 0 ? s : '未登录';
    }
    return s.substring(0, 4) + '****' + s.substring(s.length - 2);
  }

  private async changeMode(m: string): Promise<void> {
    const ctx: Context = getContext(this) as Context;
    await ThemeStore.setMode(ctx, m);
    this.mode = m;
    info('Settings mode -> ' + m);
  }

  /**
   * 切换配色（palette 轴，1:1 原版 ThemeSettingPage「配色方案」项）。
   * ⚠️ 原版是 AlertDialog + RadioButton 单选列表；鸿蒙按本页深浅色的
   * **chip 惯例**落成同款可点 chip（#86/#87 已证原版各页 chip 形态本就不统一，
   * 逐页按实测/本页惯例，不跨页套用）。「动态适配系统主题 / 自动旋转」
   * 两项鸿蒙无对应系统能力，不迁（见 #89 提交说明）。
   */
  private async changePalette(v: string): Promise<void> {
    const name: PaletteName = v as PaletteName;
    if (name !== PALETTE_BRAND && name !== PALETTE_CLASSIC && name !== PALETTE_WARM) {
      return;
    }
    const ctx: Context = getContext(this) as Context;
    await ThemeStore.setPalette(ctx, name);
    this.paletteName = name;
    info('Settings palette -> ' + name);
  }

  private async loadCampuses(): Promise<void> {
    if (!this.loggedIn) {
      this.toast = '登录后才能设置默认校区';
      return;
    }
    if (this.campusList.length > 0) {
      this.pickerOpen = true;
      return;
    }
    this.busy = true;
    try {
      const ctx: Context = getContext(this) as Context;
      const list: CampusInfo[] = await SchoolService.getCampuses(ctx);
      this.campusList = list;
      this.pickerOpen = true;
      if (list.length === 0) {
        this.toast = '教务没有返回校区列表';
        this.pickerOpen = false;
      }
    } catch (e) {
      this.toast = '取校区失败：' + (e as Error).message;
      warn('Settings loadCampuses fail: ' + JSON.stringify(e));
    }
    this.busy = false;
  }

  private async pickCampus(c: CampusInfo): Promise<void> {
    this.campusCode = c.code;
    this.campusName = c.displayName;
    this.pickerOpen = false;
    try {
      await Prefs.putString(KEY_DEFAULT_CAMPUS, c.code);
      await Prefs.putString(KEY_DEFAULT_CAMPUS_NAME, c.displayName);
      this.toast = '默认校区已设为 ' + c.displayName;
    } catch (e) {
      this.toast = '保存失败：' + (e as Error).message;
    }
  }

  /**
   * 恢复默认（清掉偏好，回到「未设置 = 良乡」）。
   * ⚠️ 没有这个入口时，设过默认校区的用户永远改不回来——M6-5 真机点验时
   * 发现该缺口后补上（2026-10-21，证据 harmony/evidence/m6-5-default-campus/）。
   */
  private async resetCampus(): Promise<void> {
    this.campusCode = '';
    this.campusName = '';
    this.pickerOpen = false;
    try {
      await Prefs.remove(KEY_DEFAULT_CAMPUS);
      await Prefs.remove(KEY_DEFAULT_CAMPUS_NAME);
      this.toast = '已恢复默认（良乡）';
      info('Settings campus reset to default');
    } catch (e) {
      this.toast = '恢复失败：' + (e as Error).message;
      warn('Settings resetCampus fail: ' + JSON.stringify(e));
    }
  }

  /** 教务接口诊断（403 变体矩阵），结果写沙箱文件 jxzx_probe.txt。 */
  private async runDiag(): Promise<void> {
    this.busy = true;
    this.diagText = '诊断中…';
    try {
      const ctx: Context = getContext(this) as Context;
      const report: string = await JxzxProbe.run(ctx);
      this.diagText = report.length > 400
        ? '完成，完整结果见沙箱 jxzx_probe.txt；下方为前 400 字。'
          + report.substring(0, 400) + '…'
        : report;
    } catch (e) {
      this.diagText = '失败：' + JSON.stringify(e);
    }
    this.busy = false;
  }

  private async doLogout(): Promise<void> {
    this.busy = true;
    try {
      // 只清会话，保留课表缓存（登出后仍可离线看课表）
      await SessionStore.clear();
      await SchoolCookieStore.clear();
      // eclass 会话三处都清（Prefs + rcp 罐 + Web 组件存储）——
      // 不清 Web 存储的话下次 syncFromWeb 会把旧会话同步回来
      await EclassCookieStore.clear();
      // 图书馆会话同款三处（Prefs + rcp 罐 + Web 组件存储）
      await LibCookieStore.clear();
      // 一卡通会话同款三处 + 余额趋势历史（换账号不串趋势）
      await CardCookieStore.clear();
      await CampusCardStore.clear();
      // 校园网流量历史（同样换账号不串趋势）
      await CampusNetTrafficStore.clear();
      this.loggedIn = false;
      this.studentId = '';
      this.campusList = [];
      this.toast = '已退出登录（课表缓存保留，仍可离线查看）';
      info('Settings logout done (course cache kept)');
    } catch (e) {
      this.toast = '退出失败：' + (e as Error).message;
      warn('Settings logout fail: ' + JSON.stringify(e));
    }
    this.busy = false;
  }

  // ── UI 片段 ──

  @Builder
  groupTitle(text: string) {
    Text(text)
      .fontSize(11)
      .fontColor(this.p().textPlaceholder)
      .width('100%')
      .padding({ left: 4, top: 18, bottom: 6 })
  }

  @Builder
  modeChip(label: string, value: string) {
    Text(label)
      .fontSize(13)
      .fontColor(this.mode === value ? this.p().onPrimary : this.p().onSurfaceVariant)
      .backgroundColor(this.mode === value ? this.p().primary : this.p().background)
      .borderRadius(14)
      .padding({ left: 14, right: 14, top: 6, bottom: 6 })
      .margin({ right: 8 })
      .onClick(() => {
        this.changeMode(value);
      })
  }

  /** 配色 chip：与 modeChip 同范式（选中 primary 实底 / 未选 surface2 底）。 */
  @Builder
  paletteChip(label: string, value: string, note: string) {
    Row() {
      Text(label)
        .fontSize(13)
        .fontColor(this.paletteName === value ? this.p().onPrimary : this.p().onSurfaceVariant)
      if (note.length > 0) {
        Text(note)
          .fontSize(10)
          .fontColor(this.paletteName === value ? this.p().onPrimary : this.p().textPlaceholder)
          .margin({ left: 6 })
      }
    }
    .backgroundColor(this.paletteName === value ? this.p().primary : this.p().surface2)
    .borderRadius(14)
    .padding({ left: 14, right: 14, top: 6, bottom: 6 })
    .margin({ right: 8, bottom: 8 })
    .onClick(() => {
      this.changePalette(value);
    })
  }

  /** 学期 chip：与 modeChip 同范式（选中 primary 实底 / 未选 background 底）。 */
  @Builder
  termChip(label: string, value: string) {
    Text(label)
      .fontSize(13)
      .fontColor(this.termOverride === value ? this.p().onPrimary : this.p().onSurfaceVariant)
      .backgroundColor(this.termOverride === value ? this.p().primary : this.p().background)
      .borderRadius(14)
      .padding({ left: 14, right: 14, top: 6, bottom: 6 })
      .margin({ right: 8, bottom: 8 })
      .onClick(() => {
        this.changeTerm(value);
      })
  }

  build() {
    Column() {
      // 顶部
      Row() {
        Text('‹ 返回')
          .fontSize(14).fontColor(this.p().primary)
          .onClick(() => {
            router.back();
          })
        Text('设置')
          .fontSize(16).fontWeight(FontWeight.Bold)
          .fontColor(this.p().onSurface)
          .layoutWeight(1).textAlign(TextAlign.Center)
        Text('    ').fontSize(14)
      }
      .width('100%')
      .padding({ left: 12, right: 12, top: 10, bottom: 4 })

      Scroll() {
        Column() {
          // ── 外观 ──
          this.groupTitle('外观')
          Column() {
            Row() {
              Text('深浅色')
                .fontSize(14).fontColor(this.p().onSurface).layoutWeight(1)
              Text(this.mode === MODE_AUTO ? '跟随系统' : (this.mode === MODE_DARK ? '深色' : '浅色'))
                .fontSize(12).fontColor(this.p().textPlaceholder)
            }
            .width('100%').padding({ bottom: 10 })

            Row() {
              this.modeChip('跟随系统', MODE_AUTO)
              this.modeChip('浅色', MODE_LIGHT)
              this.modeChip('深色', MODE_DARK)
            }
            .width('100%')

            Row() {
              Text('配色方案')
                .fontSize(14).fontColor(this.p().onSurface).layoutWeight(1)
              Text(this.paletteName === PALETTE_BRAND ? 'BIT101经典配色'
                : (this.paletteName === PALETTE_CLASSIC ? '暖棕配色' : '清新青绿配色'))
                .fontSize(12).fontColor(this.p().textPlaceholder)
            }
            .width('100%').padding({ top: 12, bottom: 10 })

            // 纵向 chip（原版 ThemeSettingPage 是 AlertDialog 纵向单选列表，
            // 标签长 ⇒ 横向排不下，纵向同时贴合原版列表形态）
            Column() {
              this.paletteChip('BIT101经典配色', PALETTE_BRAND, '（实验性）')
              this.paletteChip('暖棕配色', PALETTE_CLASSIC, '')
              this.paletteChip('清新青绿配色', PALETTE_WARM, '')
            }
            .width('100%')
            .alignItems(HorizontalAlign.Start)

            Text('BIT101经典配色为深蓝占位（未验证），暖棕/青绿为已落地两套')
              .fontSize(10).fontColor(this.p().textPlaceholder)
              .width('100%').padding({ top: 2 })
          }
          .width('100%').padding(12)
          .backgroundColor(this.p().secondaryContainer)
          .borderRadius(12)

          // ── 账号 ──
          this.groupTitle('账号')
          Column() {
            Row() {
              Text('学号')
                .fontSize(14).fontColor(this.p().onSurface).layoutWeight(1)
              Text(this.maskedId())
                .fontSize(13).fontColor(this.p().onSurfaceVariant)
            }
            .width('100%').padding({ bottom: 8 })

            Row() {
              Text('状态')
                .fontSize(14).fontColor(this.p().onSurface).layoutWeight(1)
              Text(this.loggedIn ? '已登录' : '未登录')
                .fontSize(13)
                .fontColor(this.loggedIn ? this.p().onSurfaceVariant : this.p().stateAttention)
            }
            .width('100%').padding({ bottom: 10 })

            if (this.loggedIn) {
              Button('退出登录')
                .fontSize(13).height(34)
                .width('100%')
                .backgroundColor(this.p().surface2)
                .fontColor(this.p().error)
                .enabled(!this.busy)
                .onClick(() => {
                  this.doLogout();
                })
            } else {
              Button('去登录')
                .fontSize(13).height(34)
                .width('100%')
                .enabled(!this.busy)
                .onClick(() => {
                  router.pushUrl({ url: 'pages/LoginPage' }).catch((e: Error) => {
                    this.toast = '跳转失败：' + JSON.stringify(e);
                  });
                })
            }
          }
          .width('100%').padding(12)
          .backgroundColor(this.p().secondaryContainer)
          .borderRadius(12)

          // ── 学期（对照原版 CalendarSettingPage：切学期在设置里） ──
          // ⚠️ 为什么放在设置页而不是课表页：原版课表页**没有**学期选择器，
          //    学期在「设置 → 日历设置」的 TermListDialog 里切；课表页多一行 chips
          //    就是「和原版不是一套」最明显的一处。做这个组是删那行 chips 的前提。
          this.groupTitle('学期')
          Column() {
            Row() {
              Text('当前学期')
                .fontSize(14).fontColor(this.p().onSurface).layoutWeight(1)
              Text(this.termOverride.length > 0 ? this.termOverride : '跟随教务')
                .fontSize(13).fontColor(this.p().onSurfaceVariant)
              if (this.termBusy) {
                LoadingProgress().width(16).height(16)
                  .color(this.p().primary).margin({ left: 6 })
              }
            }
            .width('100%').padding({ bottom: 10 })

            if (this.termList.length > 0) {
              Flex({ wrap: FlexWrap.Wrap }) {
                this.termChip('跟随教务', '')
                ForEach(this.visibleTerms(), (t: string) => {
                  this.termChip(t, t)
                }, (t: string) => 'term_' + t)
              }
              .width('100%')

              if (this.oldTermCount() > 0) {
                Text(this.termExpanded
                  ? '收起旧学期'
                  : '展开旧学期（更早的 ' + this.oldTermCount().toString() + ' 个）')
                  .fontSize(11).fontColor(this.p().primary)
                  .width('100%').margin({ top: 6 })
                  .onClick(() => {
                    this.termExpanded = !this.termExpanded;
                  })
              }
            } else {
              Text(this.termMsg.length > 0 ? this.termMsg : '正在读取学期列表…')
                .fontSize(11).fontColor(this.p().onSurfaceVariant)
                .width('100%')
            }

            if (this.termList.length > 0 && this.termMsg.length > 0) {
              Text(this.termMsg)
                .fontSize(11).fontColor(this.p().onSurfaceVariant)
                .width('100%').padding({ top: 4 })
            }
            if (this.termList.length === 0 && !this.termBusy && this.termMsg.length === 0) {
              Button('重新读取学期列表')
                .fontSize(12).height(32).margin({ top: 6 })
                .width('100%')
                .backgroundColor(this.p().surface2)
                .fontColor(this.p().onSurfaceVariant)
                .onClick(() => {
                  this.loadTermList();
                })
            }
          }
          .width('100%').padding(12)
          .backgroundColor(this.p().surface2)
          .borderRadius(12)

          // ── 成绩（M10-2：查成绩 + 出分提醒的可见状态）──
          this.groupTitle('成绩')
          Column() {
            Row() {
              Text('成绩查询')
                .fontSize(14).fontColor(this.p().onSurface).layoutWeight(1)
              Text('按学期查看').fontSize(12).fontColor(this.p().onSurfaceVariant)
              Text(' ›').fontSize(13).fontColor(this.p().onSurfaceVariant)
            }
            .width('100%')
            .onClick(() => {
              router.pushUrl({ url: 'pages/ScorePage' }).catch((e: Error) => {
                this.toast = '跳转失败：' + JSON.stringify(e);
              });
            })

            Row() {
              Text('出分提醒')
                .fontSize(14).fontColor(this.p().onSurface).layoutWeight(1)
              Text('开关在「提醒设置」里')
                .fontSize(11).fontColor(this.p().onSurfaceVariant)
            }
            .width('100%').padding({ top: 10 })

            // 「立即检查」：否则自动检查只能等冷启动/12h 闸门，用户没法手动确认能不能用
            Row() {
              Text('立即检查一次')
                .fontSize(13).fontColor(this.p().onSurface).layoutWeight(1)
              Button(this.busy ? '检查中…' : '开始')
                .height(28).fontSize(11)
                .enabled(!this.busy)
                .onClick(() => {
                  this.runScoreCheckNow();
                })
            }
            .width('100%').padding({ top: 10 })

            // 检查状态（M7-3 的可见性：后台静默跑的东西必须能看出「成没成、为什么没成」）
            Text(this.scoreLine)
              .fontSize(11).fontColor(this.p().onSurfaceVariant)
              .width('100%').padding({ top: 8 })
          }
          .width('100%').padding(12)
          .backgroundColor(this.p().surface)
          .borderRadius(12)

          // ── 作业来源（M4-5：过滤只在展示层，库里两源都存）──
          this.groupTitle('作业来源')
          Column() {
            Row() {
              Text('延河课堂')
                .fontSize(14).fontColor(this.p().onSurface).layoutWeight(1)
              Text(this.ddlEclass ? '开' : '关')
                .fontSize(13)
                .fontColor(this.ddlEclass ? this.p().onPrimary : this.p().onSurfaceVariant)
                .backgroundColor(this.ddlEclass ? this.p().primary : this.p().surface2)
                .borderRadius(10).padding({ left: 12, right: 12, top: 4, bottom: 4 })
            }
            .width('100%').padding({ bottom: 8 })
            .onClick(() => {
              this.toggleDdlSource('eclass');
            })

            Row() {
              Text('本地新增')
                .fontSize(14).fontColor(this.p().onSurface).layoutWeight(1)
              Text(this.ddlLocal ? '开' : '关')
                .fontSize(13)
                .fontColor(this.ddlLocal ? this.p().onPrimary : this.p().onSurfaceVariant)
                .backgroundColor(this.ddlLocal ? this.p().primary : this.p().surface2)
                .borderRadius(10).padding({ left: 12, right: 12, top: 4, bottom: 4 })
            }
            .width('100%').padding({ bottom: 8 })
            .onClick(() => {
              this.toggleDdlSource('local');
            })

            Row() {
              Text('乐学').fontSize(14).fontColor(this.p().onSurfaceVariant).layoutWeight(1)
              Text('本版不提供（接口未验证）')
                .fontSize(11).fontColor(this.p().onSurfaceVariant)
            }
            .width('100%').padding({ bottom: 4 })
          }
          .width('100%').padding(12)
          .backgroundColor(this.p().surface)
          .borderRadius(12)

          // ── 提醒 ──
          // 「提醒设置」的唯一入口原在「我」页入口组；对照原版拆入口组时
          // 必须先安置到这里（引用数=1，先搬再拆，避免成孤儿页）。
          this.groupTitle('提醒')
          Column() {
            Row() {
              Text('提醒设置')
                .fontSize(14).fontColor(this.p().onSurface).layoutWeight(1)
              Text('开关 / 提前量').fontSize(13).fontColor(this.p().textPlaceholder)
              Text(' ›').fontSize(13).fontColor(this.p().textPlaceholder)
            }
            .width('100%')
            .onClick(() => {
              router.pushUrl({ url: 'pages/NotifySettingsPage' }).catch((e: Error) => {
                this.toast = '跳转失败：' + JSON.stringify(e);
              });
            })
          }
          .width('100%').padding(12)
          .backgroundColor(this.p().secondaryContainer)
          .borderRadius(12)

          // ── 查找 ──
          this.groupTitle('查找')
          Column() {
            Row() {
              Text('作息时间')
                .fontSize(14).fontColor(this.p().onSurface).layoutWeight(1)
              Text(this.ttCustom ? '自定义' : '学校官方')
                .fontSize(13).fontColor(this.p().textPlaceholder)
              Text(' ›').fontSize(13).fontColor(this.p().textPlaceholder)
            }
            .width('100%').padding({ bottom: 10 })
            .onClick(() => {
              router.pushUrl({ url: 'pages/TimeTablePage' }).catch((e: Error) => {
                this.toast = '跳转失败：' + JSON.stringify(e);
              });
            })

            Row() {
              Text('手动改课表')
                .fontSize(14).fontColor(this.p().onSurface).layoutWeight(1)
              Text('改 / 藏 / 新增').fontSize(13).fontColor(this.p().textPlaceholder)
              Text(' ›').fontSize(13).fontColor(this.p().textPlaceholder)
            }
            .width('100%').padding({ bottom: 10 })
            .onClick(() => {
              router.pushUrl({ url: 'pages/OverlayPage' }).catch((e: Error) => {
                this.toast = '跳转失败：' + JSON.stringify(e);
              });
            })

            Row() {
              Text('作业（DDL）')
                .fontSize(14).fontColor(this.p().onSurface).layoutWeight(1)
              Text('延河课堂').fontSize(13).fontColor(this.p().textPlaceholder)
              Text(' ›').fontSize(13).fontColor(this.p().textPlaceholder)
            }
            .width('100%').padding({ bottom: 10 })
            .onClick(() => {
              router.pushUrl({ url: 'pages/DdlPage' }).catch((e: Error) => {
                this.toast = '跳转失败：' + JSON.stringify(e);
              });
            })

            Row() {
              Text('课程动态')
                .fontSize(14).fontColor(this.p().onSurface).layoutWeight(1)
              Text('延河课堂').fontSize(13).fontColor(this.p().textPlaceholder)
              Text(' ›').fontSize(13).fontColor(this.p().textPlaceholder)
            }
            .width('100%')
            .onClick(() => {
              router.pushUrl({ url: 'pages/EclassActivityPage' }).catch((e: Error) => {
                this.toast = '跳转失败：' + JSON.stringify(e);
              });
            })

            Row() {
              Text('图书馆借阅')
                .fontSize(14).fontColor(this.p().onSurface).layoutWeight(1)
              Text('我的借阅').fontSize(13).fontColor(this.p().textPlaceholder)
              Text(' ›').fontSize(13).fontColor(this.p().textPlaceholder)
            }
            .width('100%').padding({ top: 10 })
            .onClick(() => {
              router.pushUrl({ url: 'pages/LibBorrowPage' }).catch((e: Error) => {
                this.toast = '跳转失败：' + JSON.stringify(e);
              });
            })

            Row() {
              Text('一卡通')
                .fontSize(14).fontColor(this.p().onSurface).layoutWeight(1)
              Text('余额与趋势').fontSize(13).fontColor(this.p().textPlaceholder)
              Text(' ›').fontSize(13).fontColor(this.p().textPlaceholder)
            }
            .width('100%').padding({ top: 10 })
            .onClick(() => {
              router.pushUrl({ url: 'pages/CardPage' }).catch((e: Error) => {
                this.toast = '跳转失败：' + JSON.stringify(e);
              });
            })

            Row() {
              Text('校园网')
                .fontSize(14).fontColor(this.p().onSurface).layoutWeight(1)
              Text('流量与余额').fontSize(13).fontColor(this.p().textPlaceholder)
              Text(' ›').fontSize(13).fontColor(this.p().textPlaceholder)
            }
            .width('100%').padding({ top: 10 })
            .onClick(() => {
              router.pushUrl({ url: 'pages/NetPage' }).catch((e: Error) => {
                this.toast = '跳转失败：' + JSON.stringify(e);
              });
            })
          }
          .width('100%').padding(12)
          .backgroundColor(this.p().secondaryContainer)
          .borderRadius(12)

          this.groupTitle('空教室')
          Column() {
            Row() {
              Text('空教室默认校区')
                .fontSize(14).fontColor(this.p().onSurface).layoutWeight(1)
              Text(this.campusName.length > 0 ? this.campusName : '未设置（默认良乡）')
                .fontSize(13).fontColor(this.p().textPlaceholder)
              Text(' ›')
                .fontSize(13).fontColor(this.p().textPlaceholder)
            }
            .width('100%')
            .onClick(() => {
              this.loadCampuses();
            })

            // 校区选择面板（内联，避免多引一个弹层组件）
            if (this.pickerOpen) {
              Column() {
                // 恢复默认（设过才显示；没设过时「未设置」即默认，无需恢复）
                if (this.campusCode.length > 0) {
                  Row() {
                    Text('恢复默认（良乡）')
                      .fontSize(13)
                      .fontColor(this.p().textPlaceholder)
                      .layoutWeight(1)
                  }
                  .width('100%')
                  .padding({ top: 8, bottom: 8 })
                  .border({ width: { bottom: 0.5 }, color: this.p().outlineVariant })
                  .onClick(() => {
                    this.resetCampus();
                  })
                }
                ForEach(this.campusList, (c: CampusInfo) => {
                  Row() {
                    Text(c.displayName)
                      .fontSize(13)
                      .fontColor(c.code === this.campusCode ? this.p().primary : this.p().onSurface)
                      .layoutWeight(1)
                    if (c.code === this.campusCode) {
                      Text('✓').fontSize(13).fontColor(this.p().primary)
                    }
                  }
                  .width('100%')
                  .padding({ top: 8, bottom: 8 })
                  .border({ width: { bottom: 0.5 }, color: this.p().outlineVariant })
                  .onClick(() => {
                    this.pickCampus(c);
                  })
                }, (c: CampusInfo) => 'c_' + c.code)
              }
              .width('100%')
              .margin({ top: 8 })
            }
          }
          .width('100%').padding(12)
          .backgroundColor(this.p().secondaryContainer)
          .borderRadius(12)

          // ── 关于 ──
          this.groupTitle('关于')
          Column() {
            Row() {
              Text('版本与更新说明').fontSize(14).fontColor(this.p().onSurface).layoutWeight(1)
              Text(this.versionText).fontSize(13).fontColor(this.p().onSurfaceVariant)
              Text(' ›').fontSize(13).fontColor(this.p().onSurfaceVariant)
            }
            .width('100%').padding({ bottom: 8 })
            .onClick(() => {
              // M10-4：版本与更新说明单独一页（更新一律引导去商店，不做自下载）
              router.pushUrl({ url: 'pages/AboutPage' }).catch((e: Error) => {
                this.toast = '跳转失败：' + JSON.stringify(e);
              });
            })

            Row() {
              Text('网页服务').fontSize(14).fontColor(this.p().onSurface).layoutWeight(1)
              Text('门户 / 教务 / 图书馆').fontSize(11).fontColor(this.p().onSurfaceVariant)
              Text(' ›').fontSize(13).fontColor(this.p().onSurfaceVariant)
            }
            .width('100%').padding({ bottom: 8 })
            .onClick(() => {
              router.pushUrl({ url: 'pages/WebServicesPage' }).catch((e: Error) => {
                this.toast = '跳转失败：' + JSON.stringify(e);
              });
            })

            Row() {
              Text('项目主页').fontSize(14).fontColor(this.p().onSurface).layoutWeight(1)
              Text('github.com/Star2121-1/BIT101-Harmony')
                .fontSize(11).fontColor(this.p().onSurfaceVariant)
            }
            .width('100%').padding({ bottom: 8 })

            Text('非官方客户端，与学校无关。学号密码只在登录请求里用一次，默认不保存（成绩页显式勾选「记住密码」时存系统密钥库）。')
              .fontSize(11).fontColor(this.p().onSurfaceVariant)
              .width('100%')
          }
          .width('100%').padding(12)
          .backgroundColor(this.p().secondaryContainer)
          .borderRadius(12)

          // ── 开发者选项（默认收起）──
          Row() {
            Text('开发者选项')
              .fontSize(11).fontColor(this.p().textPlaceholder).layoutWeight(1)
            Text(this.devOpen ? '收起' : '展开')
              .fontSize(11).fontColor(this.p().primary)
          }
          .width('100%')
          .padding({ left: 4, top: 18, bottom: 6 })
          .onClick(() => {
            this.devOpen = !this.devOpen;
          })

          if (this.devOpen) {
            Column() {
              Text('M1/M2 的验证件。日常用不到，排查接口问题时才打开。')
                .fontSize(11).fontColor(this.p().textPlaceholder).width('100%')

              Row() {
                Text('教务接口诊断（403 变体矩阵）')
                  .fontSize(13).fontColor(this.p().onSurface).layoutWeight(1)
                Button('跑一遍')
                  .height(28).fontSize(11)
                  .enabled(!this.busy)
                  .onClick(() => {
                    this.runDiag();
                  })
              }
              .width('100%').margin({ top: 10 })

              Row() {
                Text('R1 风险闸（CAS 页 Web 组件探测）')
                  .fontSize(13).fontColor(this.p().onSurface).layoutWeight(1)
                Button('打开')
                  .height(28).fontSize(11)
                  .onClick(() => {
                    router.pushUrl({ url: 'pages/CasLoginProbe' }).catch((e: Error) => {
                      this.toast = '跳转失败：' + JSON.stringify(e);
                    });
                  })
              }
              .width('100%').margin({ top: 8 })

              Row() {
                Text('延河课堂登录（M4-1：Web 登录 → 抽 cookie → 验接口）')
                  .fontSize(13).fontColor(this.p().onSurface).layoutWeight(1)
                Button('打开')
                  .height(28).fontSize(11)
                  .onClick(() => {
                    router.pushUrl({ url: 'pages/EclassLoginPage' }).catch((e: Error) => {
                      this.toast = '跳转失败：' + JSON.stringify(e);
                    });
                  })
              }
              .width('100%').margin({ top: 8 })

              Row() {
                Text('裸协议探针（阶段A：rcp + AES 自证）')
                  .fontSize(13).fontColor(this.p().onSurface).layoutWeight(1)
                Button('打开')
                  .height(28).fontSize(11)
                  .onClick(() => {
                    router.pushUrl({ url: 'pages/CasProbePage' }).catch((e: Error) => {
                      this.toast = '跳转失败：' + JSON.stringify(e);
                    });
                  })
              }
              .width('100%').margin({ top: 8 })

              Row() {
                Text('座位 wire 探针（map/seminar 字段实测）')
                  .fontSize(13).fontColor(this.p().onSurface).layoutWeight(1)
                Button('打开')
                  .height(28).fontSize(11)
                  .onClick(() => {
                    router.pushUrl({ url: 'pages/SeatProbePage' }).catch((e: Error) => {
                      this.toast = '跳转失败：' + JSON.stringify(e);
                    });
                  })
              }
              .width('100%').margin({ top: 8 })

              if (this.diagText.length > 0) {
                Text(this.diagText)
                  .fontSize(10).fontColor(this.p().textPlaceholder)
                  .width('100%').margin({ top: 8 })
              }
            }
            .width('100%').padding(12)
            .backgroundColor(this.p().surface)
            .borderRadius(10)
          }

          if (this.toast.length > 0) {
            Text(this.toast)
              .fontSize(11).fontColor(this.p().textPlaceholder)
              .width('100%').margin({ top: 10 })
          }

          Text('')
            .height(24)
        }
        .width('100%')
        .padding({ left: 12, right: 12 })
        .alignItems(HorizontalAlign.Start)
      }
      .layoutWeight(1)
      .scrollBar(BarState.Off)
      .align(Alignment.Top)
    }
    .width('100%').height('100%')
    .backgroundColor(this.p().background)
  }
}
