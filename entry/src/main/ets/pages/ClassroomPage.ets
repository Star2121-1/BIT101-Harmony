/**
 * 空教室页（M3-1/M3-2 + #85 UI 迁移）
 *
 * 三级：校区 → 教学楼 → 教室（逐节忙闲）。
 * 数据源：`SchoolService.getBuildings('')`（一次拿全部校区的楼，客户端分组）
 * + `ClassroomService.getClassrooms`（点哪栋拉哪栋）。
 *
 * ── #85 视觉迁移（对齐原版 BIT101，基准见 harmony/ui-ref/MIGRATION-BASELINE.md）──
 * - 配色从 AppColors.palette() 切到 GridTokens（Warm 默认皮肤，真机实证）；
 * - 校区卡 = surfaceVariant #F4EFE8（原版 surfaceContainerHigh，warm 下同值；
 *   平板实测 ref-07 采样中位色严丝合缝）；
 * - 教学楼卡 = mixHex(surface, primaryContainer, 0.25) = #FBE6D9（源码
 *   FreeClassroomSearch.kt:183「用 primaryContainer 会糊按钮、secondaryContainer
 *   会糊教室，手工调的颜色」；实测与公式一致）；
 * - 教室项双色（ClassroomList.kt:79-95）：现在空闲 = secondaryContainer 薄荷底；
 *   占用中 = mixHex(errorContainer, secondaryContainer, 0.5)（内容色同理混 on* 两个）；
 * - 层级缩进：校区卡（页边 12）→ 教学楼卡（+25）→ 教室卡（再 +25），
 *   与原版「色块明度 + 缩进 + 字号」的层级语言一致（原版注释：
 *   不靠再加一种主题色区分层级）；
 * - 校区分组纯函数 corelogic/CampusGrouping.ts 照搬原版 CampusGrouping.kt
 *   （含实机栽过的「名字叫 null 的校区」bug 的清洗），当前校区排最前并自动展开。
 *
 * 铁律落实：
 * - 0.4 「今天第几周 / 哪一天」必须写在屏幕上 —— 空教室结果是**特定某天**的，
 *   不写日期等于骗人（顶栏 + 底部说明各一处）；
 * - 「查不到」与「这栋楼全满」分开：前者是失败（红字 + 重试/登录入口），
 *   后者是事实（照实显示）；
 * - 逐栋加载：点哪栋拉哪栋，不一开始就把全校几百间都拉下来；
 * - 「现在空闲 N 间」的 N 与卡片双色**同一口径**（同一次 nowMinutes 快照），
 *   不一个按全天算一个按此刻算。
 *
 * 与原版的已知差异（如实记录，不装作一致）：
 * - 本页是首页 push 进来的子页，顶栏是鸿蒙自有 chrome（原版在 5-tab 骨架里）；
 * - 加载失败/空态鸿蒙用红字错误块（原版用 secondaryContainer  mint 卡），
 *   错误可读性优先；
 * - 原版 FAB 组（回到顶部 + 设置）与「隐藏非空闲」设置未搬（见 ROADMAP 待办）；
 * - 「现在空闲」节次边界与原版 nextBusyTime>=now 差每节开头一瞬，取诚实侧
 *   （corelogic/ClassroomFree.ts 注释与 test-classroomfree.mjs 钉死）。
 */

import { router } from '@kit.ArkUI';
import { FabColumn, FabAction } from '../components/shell/FabColumn.ets';
import { gridTokens } from '../core/theme/GridTokens.ts';
import type { GridTokens } from '../core/theme/GridTokens.ts';
import { mixHex } from '../core/theme/colorUtil.ts';
import { STORAGE_DARK, STORAGE_PALETTE, getPalette } from '../data/ThemeStore.ts';
import { Context } from '@kit.AbilityKit';
import { SchoolService, SchoolAuthError } from '../service/SchoolService.ts';
import { ClassroomService } from '../service/ClassroomService.ts';
import { BuildingInfo, ClassroomRow } from '../core/model/SchoolModels.ts';
import { CourseCache, CachedSchedule } from '../data/CourseCache.ts';
import { Prefs } from '../data/Prefs.ts';
import { SessionStore, SessionSnapshot } from '../data/SessionStore.ts';
import { weekOf } from '../corelogic/CourseWeekdayLogic.ts';
import { parseISODate } from '../corelogic/timeutil.ts';
import { groupCampuses } from '../corelogic/CampusGrouping.ts';
import type { CampusGroup } from '../corelogic/CampusGrouping.ts';
import { isFreeNow } from '../corelogic/ClassroomFree.ts';
import { FALLBACK_TIME_TABLE } from '../corelogic/TimeTableLogic.ts';
import type { TimeTable } from '../corelogic/timeutil.ts';
import { TimeTableStore } from '../data/TimeTableStore.ts';
import { info, warn } from '../core/log/BitLog.ts';

const DAY_LABELS: string[] = ['一', '二', '三', '四', '五', '六', '日'];
const SECTIONS: number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
/** 卡片圆角（M3 shapes.medium = 12dp）。 */
const CARD_RADIUS: number = 12;
/** 页边距（校区卡左右）；教学楼/教室卡在此基础上按 25vp 一级缩进。 */
const PAGE_GUTTER: number = 12;
/** 层级缩进（原版 Column padding(start = 25.dp)，取 24vp 接近值）。 */
const LEVEL_INDENT: number = 24;

@Entry
@Component
export struct ClassroomPage {
  /** true = 被外壳（底部 tab）嵌入：不渲染返回键（原版这些是 pager 页签，没有页面级返回）。 */
  isEmbedded: boolean = false;

  /** 订阅全局深浅色（由设置页切换、AppStorage 广播）。 */
  @StorageLink(STORAGE_DARK) isDark: boolean = false;
  @StorageLink(STORAGE_PALETTE) paletteName: string = 'warm';
  @State loading: boolean = true;
  @State errorText: string = '';
  @State needLogin: boolean = false;
  @State term: string = '';
  @State week: number = 1;
  @State dayOfWeek: number = 1;
  @State dateStr: string = '';
  /** 校区/楼的教学周是否确定（开学日未知时为空教室查询的前提不成立）。 */
  @State weekKnown: boolean = false;
  /** 用户作息表（M6-2）；「现在空闲」的节次边界以它为准。 */
  @State table: TimeTable = FALLBACK_TIME_TABLE;
  /** 全部教学楼按校区分组（当前校区排最前）；原版 CampusGrouping 的移植。 */
  @State groups: CampusGroup[] = [];
  /** 设置里选的默认校区代码；只用于「· 默认」角标与自动展开，不筛列表。 */
  @State defaultCampusCode: string = '';
  /** 展开的校区（可多个，对齐原版 expandedCampuses）。 */
  @State openCampuses: string[] = [];
  /** 展开的教学楼（一次一栋）。 */
  @State openBuilding: string = '';
  @State rooms: ClassroomRow[] = [];
  @State roomsLoading: boolean = false;
  @State roomsError: string = '';
  /** 拉教室时的「现在」（当天分钟数）；卡片双色与「现在空闲 N 间」同一口径。 */
  @State nowMinutes: number = -1;
  /** 下拉刷新指示器（原版空教室也是下拉刷新 ⇒ 原先那颗「刷新」FAB 可以去掉）。 */
  @State refreshing: boolean = false;
  /** 滚过一屏才显示「回到顶部」（原版 BackToTopFab 的淡入时机，由调用方决定）。 */
  @State showBackTop: boolean = false;
  /** Scroll 控制器：判滚动位置 + 回到顶部。 */
  private scroller: Scroller = new Scroller();

  aboutToAppear(): void {
    this.load();
  }

  private async load(): Promise<void> {
    this.loading = true;
    this.errorText = '';
    this.needLogin = false;
    try {
      const ctx: Context = getContext(this) as Context;
      const snap: SessionSnapshot = await SessionStore.snapshot();
      if (!snap.hasSchoolCookies) {
        this.needLogin = true;
        this.errorText = '空教室查询需要学校教务会话。请先登录。';
        this.loading = false;
        return;
      }

      // ⚠️ 必须用**当前学期**，不能用「上次查看的学期」——
      // 栽过（2026-10-20）：用户切到 2025-2026-2 看历史课表后再进空教室，
      // 页面按那个学期的开学日算出「第 34 周」，空教室结果是错的。
      this.term = await SchoolService.getCurrentTerm(ctx);
      // 开学日优先用该学期自己的课表缓存（省一次教务请求）
      const cached: CachedSchedule | null = await CourseCache.load(this.term);
      if (cached !== null) {
        this.applyDate(cached.firstDay);
      }
      if (!this.weekKnown) {
        const firstDay: string = await SchoolService.getFirstDay(ctx, this.term);
        this.applyDate(firstDay);
      }
      this.table = await TimeTableStore.load();
      // 默认校区（设置页 M6-5 选的）；空 = 没设过
      try {
        this.defaultCampusCode = await Prefs.getString('default_campus_code', '');
      } catch (e) {
        this.defaultCampusCode = '';
      }
      // 一次拿**全部校区**的教学楼，客户端分组（原版：每栋楼自带 XXXQDM，
      // 不必为每个校区单独发请求；分组规则含「null 字面量」清洗，见 CampusGrouping）
      const buildings: BuildingInfo[] = await SchoolService.getBuildings(ctx, '');
      this.groups = groupCampuses(buildings, this.defaultCampusCode, '');
      // 自动展开一个校区，少一次点击：默认校区 → 含「良乡」的组 → 第一组。
      // ⚠️ 「良乡」只是没设过默认时的兜底顺序，不是给用户的承诺；
      // 「· 默认」角标只认设置里真选过的（defaultCampusCode），兜底展开不给角标。
      const auto: string = this.autoExpandCode();
      this.openCampuses = auto.length > 0 ? [auto] : [];
      this.openBuilding = '';
      this.rooms = [];
      this.roomsError = '';
      info('ClassroomPage loaded term=' + this.term + ' week=' + this.week +
        ' dow=' + this.dayOfWeek + ' groups=' + this.groups.length);
    } catch (e) {
      if (e instanceof SchoolAuthError) {
        this.needLogin = true;
        this.errorText = '教务会话已过期或无效：' + (e as Error).message;
      } else {
        this.errorText = '取不到空教室数据（' + (e as Error).message + '）';
      }
      warn('ClassroomPage load fail: ' + JSON.stringify(e));
    }
    this.loading = false;
  }

  /** 由开学日推「今天是第几周 / 星期几 / 日期」。 */
  private applyDate(firstDay: string): void {
    const firstEpoch: number | null = parseISODate(firstDay);
    const d: Date = new Date();
    const todayEpoch: number = Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
    const mm: string = String(d.getMonth() + 1).padStart(2, '0');
    const dd: string = String(d.getDate()).padStart(2, '0');
    this.dateStr = d.getFullYear() + '-' + mm + '-' + dd;
    this.dayOfWeek = ((todayEpoch + 3) % 7 + 7) % 7 + 1;
    if (firstEpoch !== null) {
      const w: number = weekOf(firstEpoch, todayEpoch);
      this.week = w >= 1 ? w : 1;
      this.weekKnown = true;
    }
  }

  /** 自动展开哪个校区：默认校区 → 含「良乡」→ 第一组。 */
  private autoExpandCode(): string {
    if (this.groups.length === 0) {
      return '';
    }
    for (let i = 0; i < this.groups.length; i++) {
      if (this.groups[i].isCurrent) {
        return this.groups[i].campusCode;
      }
    }
    for (let i = 0; i < this.groups.length; i++) {
      if (this.groups[i].campusName.indexOf('良乡') >= 0) {
        return this.groups[i].campusCode;
      }
    }
    return this.groups[0].campusCode;
  }

  /** 校区卡是否展开（可多个同时展开）。 */
  private campusOpen(code: string): boolean {
    return this.openCampuses.indexOf(code) >= 0;
  }

  private toggleCampus(code: string): void {
    const idx: number = this.openCampuses.indexOf(code);
    if (idx >= 0) {
      this.openCampuses.splice(idx, 1);
    } else {
      this.openCampuses.push(code);
    }
  }

  private async toggleBuilding(index: string): Promise<void> {
    if (this.openBuilding === index) {
      this.openBuilding = '';
      this.rooms = [];
      return;
    }
    this.openBuilding = index;
    this.rooms = [];
    this.roomsError = '';
    if (!this.weekKnown) {
      this.roomsError = '开学日未知，无法确定「第几周」，空教室查询不可用。请先在课表页刷新一次。';
      return;
    }
    this.roomsLoading = true;
    // 「现在」快照：卡片双色与下方「现在空闲 N 间」共用，不各算各的
    this.nowMinutes = this.currentMinutes();
    try {
      const ctx: Context = getContext(this) as Context;
      const rows: ClassroomRow[] = await ClassroomService.getClassrooms(
        ctx, this.term, this.week, this.dayOfWeek, this.dateStr, index);
      this.rooms = rows;
      info('ClassroomPage rooms building=' + index + ' n=' + rows.length);
      if (rows.length === 0) {
        this.roomsError = '这栋楼没有返回教室（可能该楼当天无数据）';
      }
    } catch (e) {
      this.roomsError = '取不到这栋楼的教室（' + (e as Error).message + '）';
      warn('ClassroomPage rooms fail: ' + JSON.stringify(e));
    }
    this.roomsLoading = false;
  }

  /** 本地「现在」（当天分钟数）。 */
  private currentMinutes(): number {
    const d: Date = new Date();
    return d.getHours() * 60 + d.getMinutes();
  }

  /** 这间教室现在是否空闲（与原版 isFreeNow 同语义，见 ClassroomFree.ts）。 */
  private roomFree(r: ClassroomRow): boolean {
    if (this.nowMinutes < 0) {
      return true;
    }
    return isFreeNow(r.busySections, this.table, this.nowMinutes);
  }

  /** 现在空闲的教室数（与卡片双色同一 nowMinutes 口径）。 */
  private freeNowCount(): number {
    if (this.rooms.length === 0 || this.nowMinutes < 0) {
      return 0;
    }
    let n: number = 0;
    for (let i = 0; i < this.rooms.length; i++) {
      if (this.roomFree(this.rooms[i])) {
        n++;
      }
    }
    return n;
  }

  /** 忙闲摘要：'全天空闲' / '3-5 节占用' —— 比一排小方块更省地方，也好读。 */
  private busySummary(r: ClassroomRow): string {
    const busy: number[] = r.busySections;
    if (busy.length === 0) {
      return '全天空闲';
    }
    if (busy.length >= SECTIONS.length) {
      return '全天占用';
    }
    // 连续区间合并：[3,4,5,9] → '3-5, 9'
    const parts: string[] = [];
    let start: number = busy[0];
    let prev: number = busy[0];
    for (let i = 1; i < busy.length; i++) {
      if (busy[i] === prev + 1) {
        prev = busy[i];
        continue;
      }
      parts.push(start === prev ? String(start) : (start + '-' + prev));
      start = busy[i];
      prev = busy[i];
    }
    parts.push(start === prev ? String(start) : (start + '-' + prev));
    return parts.join(', ') + ' 节占用';
  }

  // ── 配色（全部来自 GridTokens；派生色现算，不硬编码第二份）──

  private tk(): GridTokens {
    return gridTokens(this.isDark, getPalette(this.paletteName));
  }

  /** 校区卡底（原版 surfaceContainerHigh；warm 下与 surfaceVariant 同值）。 */
  private campusCardBg(): string {
    return this.tk().surfaceVariant;
  }

  /** 教学楼卡底 = mixColor(surface, primaryContainer, 0.25)（源码 + 实测 #FBE6D9）。 */
  private buildingCardBg(): string {
    const t: GridTokens = this.tk();
    return mixHex(t.surface, t.primaryContainer, 0.25);
  }

  /** 教学楼卡内容色 = mixColor(onSurface, onPrimaryContainer, 0.25)。 */
  private buildingCardInk(): string {
    const t: GridTokens = this.tk();
    return mixHex(t.onSurface, t.onPrimaryContainer, 0.25);
  }

  /** 教室卡底：空闲 secondaryContainer；占用 mix(errorContainer, secondaryContainer, 0.5)。 */
  private roomCardBg(free: boolean): string {
    const t: GridTokens = this.tk();
    if (free) {
      return t.secondaryContainer;
    }
    return mixHex(t.errorContainer, t.secondaryContainer, 0.5);
  }

  /** 「第 N 周 · 周二 · 2026-10-27 · 学期」——铁律 0.4：结果对应哪一天必须写在屏幕上。 */
  private dayLine(): string {
    return '第 ' + this.week + ' 周 · 周' + DAY_LABELS[this.dayOfWeek - 1] +
      (this.dateStr.length > 0 ? ' · ' + this.dateStr : '') +
      (this.term.length > 0 ? ' · ' + this.term : '');
  }

  /** 教室卡内容色：空闲 onSecondaryContainer；占用混 on* 两个（0.5）。 */
  private roomCardInk(free: boolean): string {
    const t: GridTokens = this.tk();
    if (free) {
      return t.onSecondaryContainer;
    }
    return mixHex(t.onErrorContainer, t.onSecondaryContainer, 0.5);
  }

  /**
   * 右下角悬浮按钮（原版 PageFab 规格）：**回到顶部 + 设置**两颗，与 ref-07 一致。
   * 刷新不再是 FAB —— 原版本来就没有，它靠下拉刷新（本页现已补 Refresh）。
   */
  private fabActions(): FabAction[] {
    const list: FabAction[] = [];
    // 原版 BackToTopFab：滚过一段才淡入，首屏不出现
    if (this.showBackTop) {
      list.push({
        icon: 'ic_up.svg',
        label: '回到顶部',
        onTap: () => {
          this.scroller.scrollTo({
            xOffset: 0,
            yOffset: 0,
            animation: { duration: 240, curve: Curve.EaseOut },
          });
        },
      });
    }
    list.push({
      icon: 'ic_settings.svg',
      label: '设置',
      onTap: () => {
        router.pushUrl({ url: 'pages/SettingsPage' }).catch((e: Error) => {
          warn('open settings fail: ' + JSON.stringify(e));
        });
      },
    });
    return list;
  }

  build() {
    Stack({ alignContent: Alignment.BottomEnd }) {
    Column() {
      // 顶栏
      // ⚠️ 嵌入外壳时**不留标题也不留刷新钮**：原版 ref-07 从页签直接进「良乡校区」卡，
      //    没有任何页头（页签即页头），刷新走下拉 / 右下 FAB。
      //    但铁律 0.4 要求「结果对应哪一天」必须写在屏幕上 ⇒ 保留一行小字日期。
      if (!this.isEmbedded) {
        Row() {
          Button('返回').height(32).fontSize(12)
            .backgroundColor(Color.Transparent)
            .fontColor(this.tk().primary)
            .onClick(() => {
              router.back();
            })
          Column() {
            Text('空教室').fontSize(16).fontWeight(FontWeight.Bold).fontColor(this.tk().onSurface)
            Text(this.dayLine())
              .fontSize(11).fontColor(this.tk().textPlaceholder)
          }
          .alignItems(HorizontalAlign.Start)
          .layoutWeight(1)
          .margin({ left: 10 })
          Button('刷新').height(32).fontSize(12)
            .backgroundColor(Color.Transparent)
            .fontColor(this.tk().primary)
            .enabled(!this.loading)
            .onClick(() => {
              this.load();
            })
        }
        .width('100%').padding({ left: PAGE_GUTTER, right: PAGE_GUTTER, top: 10, bottom: 6 })
      } else {
        Text(this.dayLine())
          .fontSize(11).fontColor(this.tk().textPlaceholder)
          .width('100%')
          .padding({ left: PAGE_GUTTER, right: PAGE_GUTTER, top: 8, bottom: 2 })
      }

      // 错误态：取不到 ≠ 没楼，红字说清 + 给登录/重试入口
      if (this.errorText.length > 0) {
        Column() {
          Text(this.errorText).fontSize(13).fontColor(this.tk().error).width('100%')
          if (this.needLogin) {
            Button('去登录').height(40).margin({ top: 12 })
              .backgroundColor(this.tk().primary)
              .fontColor(this.tk().onPrimary)
              .onClick(() => {
                router.pushUrl({ url: 'pages/LoginPage' });
              })
          }
        }
        .width('100%').padding({ left: 16, right: 16, top: 8 })
      }

      if (this.loading) {
        // 加载提示条（原版 LoadingTip：secondaryContainer 底 + onSecondaryContainer 字）
        Row() {
          LoadingProgress().width(18).height(18).color(this.tk().primary)
          Text('正在拉取教学楼列表…').fontSize(12).fontColor(this.tk().onSecondaryContainer)
            .margin({ left: 8 })
        }
        .width('100%').justifyContent(FlexAlign.Center)
      } else if (this.groups.length === 0) {
        // 空态：一句保守的话，不点名「哪个校区没有」（列表本来就是全部校区的）
        Text('没有获取到教学楼（可以到设置里切换默认校区）')
          .fontSize(12).fontColor(this.tk().onSecondaryContainer).textAlign(TextAlign.Center)
          .width('100%').padding(12)
          .backgroundColor(this.tk().secondaryContainer).borderRadius(CARD_RADIUS)
      } else {
        // 下拉刷新（原版 PullToRefreshContainer）：去掉「刷新」FAB 后，这是唯一刷新入口
        Refresh({ refreshing: this.refreshing }) {
        Scroll(this.scroller) {
          Column() {
            ForEach(this.groups, (g: CampusGroup) => {
              // ── 校区卡（三级折叠最外层）──
              Column() {
                Row() {
                  // 定位图标（原版 Icons.Outlined.Place 的极简还原：外点 + 内孔）
                  Stack() {
                    Circle().width(12).height(12).fill(this.tk().onSurface)
                    Circle().width(4).height(4).fill(this.campusCardBg())
                  }
                  .width(12).height(12).margin({ right: 10 })

                  Column() {
                    Text(g.campusName)
                      .fontSize(15).fontWeight(FontWeight.Bold)
                      .fontColor(this.tk().onSurface).maxLines(1)
                      .textOverflow({ overflow: TextOverflow.Ellipsis })
                    Text(g.buildings.length + ' 栋教学楼' +
                      (g.isCurrent ? ' · 默认' : ''))
                      .fontSize(11).fontColor(this.tk().onSurface).maxLines(1)
                      .textOverflow({ overflow: TextOverflow.Ellipsis })
                  }
                  .alignItems(HorizontalAlign.Start)
                  .layoutWeight(1)

                  // 箭头（展开时旋转 90°，对齐原版 animateFloatAsState 的形态）
                  Text('›').fontSize(17).fontColor(this.tk().onSurface)
                    .rotate({ angle: this.campusOpen(g.campusCode) ? 90 : 0 })
                }
                .width('100%')
                .padding({ left: 15, right: 15, top: 12, bottom: 12 })
                .onClick(() => {
                  this.toggleCampus(g.campusCode);
                })

                // ── 教学楼卡（展开校区才显示，缩进一级）──
                if (this.campusOpen(g.campusCode)) {
                  Column() {
                    ForEach(g.buildings, (b: BuildingInfo) => {
                      Column() {
                        Row() {
                          Column() {
                            Text(b.buildingName.length > 0 ? b.buildingName : b.buildingIndex)
                              .fontSize(15).fontWeight(FontWeight.Medium)
                              .fontColor(this.buildingCardInk()).maxLines(1)
                              .textOverflow({ overflow: TextOverflow.Ellipsis })
                          }
                          .alignItems(HorizontalAlign.Start)
                          .layoutWeight(1)
                          Text('›').fontSize(17).fontColor(this.buildingCardInk())
                            .rotate({ angle: this.openBuilding === b.buildingIndex ? 90 : 0 })
                        }
                        .width('100%')
                        // ⚠️ 这里**不要再加 padding**：外层 Column（见下面 `.padding(…15…)`）
                        // 已经给过内边距了，两层各 12 叠起来 → 卡片 70vp，比原版 ref-07 的
                        // 54dp 高出一截（2026-10-27 真机 dumpLayout 实测 212px/3）。
                        // 行高**显式钉 24vp**：不钉的话会被 17sp 的 › 撑高，密度随字体浮动。
                        .height(24)
                        .onClick(() => {
                          this.toggleBuilding(b.buildingIndex);
                        })

                        // ── 教室项（展开教学楼才显示，再缩进一级）──
                        if (this.openBuilding === b.buildingIndex) {
                          if (this.roomsLoading) {
                            Row() {
                              LoadingProgress().width(16).height(16).color(this.tk().primary)
                              Text('正在获取教室列表…').fontSize(12)
                                .fontColor(this.tk().onSecondaryContainer).margin({ left: 8 })
                            }
                            .width('100%').justifyContent(FlexAlign.Center)
                          } else if (this.roomsError.length > 0) {
                            Text(this.roomsError)
                              .fontSize(12).fontColor(this.tk().error).width('100%')
                              .margin({ top: 6 })
                          } else {
                            Text('共 ' + this.rooms.length + ' 间教室 · 现在空闲 ' +
                              this.freeNowCount() + ' 间')
                              .fontSize(11).fontColor(this.tk().textPlaceholder)
                              .width('100%').margin({ top: 6, bottom: 4 })
                            ForEach(this.rooms, (r: ClassroomRow) => {
                              Column() {
                                Row() {
                                  Column() {
                                    Text(r.JASMC.length > 0 ? r.JASMC : '（未命名）')
                                      .fontSize(15).fontWeight(FontWeight.Medium)
                                      .fontColor(this.roomCardInk(this.roomFree(r)))
                                      .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
                                    Text((r.JASLXDM_DISPLAY.length > 0 ? r.JASLXDM_DISPLAY : '教室') +
                                      (r.SKZWS.length > 0 ? ' · ' + r.SKZWS + ' 座' : ''))
                                      .fontSize(11).fontColor(this.roomCardInk(this.roomFree(r)))
                                      .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
                                  }
                                  .alignItems(HorizontalAlign.Start)
                                  .layoutWeight(1)
                                  Text(this.busySummary(r))
                                    .fontSize(11)
                                    .fontColor(this.roomCardInk(this.roomFree(r)))
                                    .maxLines(1)
                                    .textOverflow({ overflow: TextOverflow.Ellipsis })
                                    .width('46%')
                                    .textAlign(TextAlign.End)
                                }
                                .width('100%')
                              }
                              .width('100%')
                              .padding({ left: 15, right: 12, top: 10, bottom: 10 })
                              .backgroundColor(this.roomCardBg(this.roomFree(r)))
                              .borderRadius(CARD_RADIUS)
                              .margin({ bottom: 6 })
                            }, (r: ClassroomRow) => 'r_' + b.buildingIndex + '_' + r.JASMC)
                          }
                        }
                      }
                      .width('100%')
                      // 行高对齐原版 ref-07：卡 54dp / 间距 10dp（15+24+15 = 54，行高显式钉在 Row 上）
                      .padding({ left: 15, right: 15, top: 15, bottom: 15 })
                      .backgroundColor(this.buildingCardBg())
                      .borderRadius(CARD_RADIUS)
                      .margin({ bottom: 10 })
                    }, (b: BuildingInfo) => 'b_' + g.campusCode + '_' + b.buildingIndex)
                  }
                  .width('100%')
                  .margin({ left: LEVEL_INDENT })
                }
              }
              .width('100%')
              .padding({ left: 15, right: 15, top: 12, bottom: 12 })
              .backgroundColor(this.campusCardBg())
              .borderRadius(CARD_RADIUS)
              .margin({ left: PAGE_GUTTER, right: PAGE_GUTTER, bottom: 8 })
            }, (g: CampusGroup) => 'g_' + g.campusCode)
          }
          .width('100%')
          .padding({ bottom: 8 })
        }
        .width('100%')
        // ⚠️ 顶对齐必须挂 Scroll 自身：加在内层 Column 上不生效（内容不足一屏会被垂直居中）
        .align(Alignment.Top)
        .scrollBar(BarState.Auto)
        // 滚动位置 → 「回到顶部」是否出现（原版 BackToTopFab：过一屏才淡入）
        .onDidScroll(() => {
          const y: number = this.scroller.currentOffset().yOffset;
          const show: boolean = y > 260;
          if (show !== this.showBackTop) {
            this.showBackTop = show;
          }
        })
        }
        // ⚠️ onRefreshing 必须排在 layoutWeight 前面：`test-uiconventions` 规则 1 用
        //    「.align(Top) → } → .layoutWeight(1)」这个形状判「align 挂错层」，反过来写会被误判。
        .onRefreshing(() => {
          this.refreshing = true;
          this.load().then(() => {
            this.refreshing = false;
          });
        })
        .layoutWeight(1)
      }

      // 铁律 0.4：结果对应哪一天，写在屏幕上
      // （嵌入时日期已在顶部那一行说了，这里只保留「开学日未知」这种必须说的告警）
      if (!this.weekKnown) {
        Text('开学日未知，结果可能不准')
          .fontSize(11).fontColor(this.tk().error)
          .width('100%')
          .padding({ left: PAGE_GUTTER, right: PAGE_GUTTER, top: 4, bottom: 8 })
      }

    }
    .width('100%').height('100%')
    .backgroundColor(this.tk().background)

      // 原版空教室默认只有 ⚙ 一颗；「回到顶部」是滚过一段才淡入（BackToTopFab），
      // 需要 Scroll 控制器 + 首项监听，另立一步。
      FabColumn({ actions: this.fabActions() })
    }
    .width('100%').height('100%')
  }
}
