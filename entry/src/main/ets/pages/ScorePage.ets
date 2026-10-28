/**
 * 成绩页（M10-2）。
 *
 * ## 数据怎么来
 * 走 BIT101 认证主机的异步挑战三步（`service/ScoreService.ts`）：
 * 起挑战 → 轮询到 `jwb` 就绪 → 带 Bearer 取数 → `ScoreLogic.parseTable`。
 *
 * ## 三条产品纪律
 *  1. **不偷偷登录**：进页面只用本地缓存（30 分钟内有效），要新数据得用户点
 *     「立即查询」/ 下拉刷新 —— 每次查询都是一次真的学校 SSO 登录；
 *  2. **凭据默认不存**：不勾「记住密码」就只在本次输入里用一次，用完立刻清空输入框；
 *     勾了才写系统密钥库（`ScoreCredentialStore`，见那里的取舍说明）；
 *  3. **失败分类照原样上屏**：「密码错」不能写成「稍后重试」（重试永远不会成功），
 *     「学校要短信」也不能（后台没有交互通道）。
 *
 * ## 展示口径
 * 按学期分组、学期新→旧、组内保持表里原顺序（**不按分数排序** —— 那会看起来像排名）。
 * 页头摘要只讲条数，不讲平均分/GPA（没有契约依据，不编造）。
 */

import { Context } from '@kit.AbilityKit';
import { router } from '@kit.ArkUI';
import { gridTokens } from '../core/theme/GridTokens.ts';
import type { GridTokens } from '../core/theme/GridTokens.ts';
import { STORAGE_DARK, STORAGE_PALETTE, getPalette } from '../data/ThemeStore.ts';
import { ScoreStore } from '../data/ScoreStore.ts';
import { ScoreCredentialStore } from '../data/ScoreCredentialStore.ts';
import { ScoreCheckRunner } from '../service/ScoreCheckRunner.ts';
import type { ScoreCheckOutcome } from '../service/ScoreCheckRunner.ts';
import type { CachedScores } from '../corelogic/ScoreStoreLogic.ts';
import { isFresh, SCORE_CACHE_TTL_MS } from '../corelogic/ScoreStoreLogic.ts';
import type { ScoreEntry } from '../corelogic/ScoreLogic.ts';
import { groupByTerm, summarize, summaryLine, hasScore } from '../corelogic/ScoreFlowLogic.ts';
import {
  creditSummary, creditLine, buckets, bucketLine, formatCredit,
} from '../corelogic/ScoreSummaryLogic.ts';
import type { CreditSummary, BucketCount, TermCredit } from '../corelogic/ScoreSummaryLogic.ts';
import type { ScoreTermGroup } from '../corelogic/ScoreFlowLogic.ts';
import { statusText, fmtCheckTime, humanReason, ScoreCheckCode } from '../corelogic/ScoreCheckLogic.ts';
import type { ScoreCheckStatus } from '../corelogic/ScoreCheckLogic.ts';
import { rowA11y } from '../corelogic/A11yText.ts';
import { warn } from '../core/log/BitLog.ts';

@Entry
@Component
export struct ScorePage {
  @StorageLink(STORAGE_DARK) isDark: boolean = false;
  @StorageLink(STORAGE_PALETTE) paletteName: string = 'warm';

  @State entries: ScoreEntry[] = [];
  /** 缓存时刻（毫秒；0 = 没有缓存）。 */
  @State cachedAt: number = 0;
  @State busy: boolean = false;
  @State refreshing: boolean = false;
  /** 是否已保存凭据（决定显示「立即查询」还是「输入学号密码」）。 */
  @State hasCred: boolean = false;
  /** 已保存的学号（打码展示）。 */
  @State savedUser: string = '';
  /** 一行状态/结果说明（如实上屏，不吞错误）。 */
  @State msg: string = '';
  /** 最近一次检查状态（`ScoreCheckLogic.statusText`）。 */
  @State lastLine: string = '';
  /** 折叠起来的学期（默认只展开最新一个；其余折叠，避免几十门课一次铺满）。 */
  @State collapsed: string[] = [];
  /** 课程名过滤（成绩多时按课名找）。 */
  @State filter: string = '';

  // ── 临时凭据输入（不保存时只在内存里活一次）──
  @State inputUser: string = '';
  @State inputPwd: string = '';
  @State remember: boolean = false;
  @State inputErr: string = '';

  private tk(): GridTokens {
    return gridTokens(this.isDark, getPalette(this.paletteName));
  }

  private groups(): ScoreTermGroup[] {
    return groupByTerm(this.entries);
  }

  /** 按课名过滤后的分组（过滤为空则原样）。 */
  private visibleGroups(): ScoreTermGroup[] {
    const kw: string = this.filter.trim();
    if (kw.length === 0) {
      return this.groups();
    }
    const out: ScoreTermGroup[] = [];
    const src: ScoreTermGroup[] = this.groups();
    for (let i = 0; i < src.length; i++) {
      const kept: ScoreEntry[] = [];
      for (let j = 0; j < src[i].entries.length; j++) {
        if (src[i].entries[j].course.indexOf(kw) >= 0) {
          kept.push(src[i].entries[j]);
        }
      }
      if (kept.length > 0) {
        out.push({
          term: src[i].term, label: src[i].label, entries: kept,
          scored: src[i].scored,
        });
      }
    }
    return out;
  }

  /** 学分一行（没有学分列就是空串，整块不显示）。 */
  private creditText(): string {
    const c: CreditSummary = creditSummary(this.entries);
    return creditLine(c);
  }

  /** 分档一行。 */
  private bucketText(): string {
    const list: BucketCount[] = buckets(this.entries);
    return bucketLine(list);
  }

  /** 某个学期的学分小计（找不到给空串）。 */
  private termCreditText(term: string): string {
    const c: CreditSummary = creditSummary(this.entries);
    for (let i = 0; i < c.terms.length; i++) {
      const t: TermCredit = c.terms[i];
      if (t.term === term && t.creditSum > 0) {
        return (t.partial ? '≥ ' : '') + formatCredit(t.creditSum) + ' 学分';
      }
    }
    return '';
  }

  /** 该学期是否折叠（默认：除第一个以外都折叠）。 */
  private isCollapsed(term: string): boolean {
    return this.collapsed.indexOf(term) >= 0;
  }

  private toggleCollapse(term: string): void {
    if (this.isCollapsed(term)) {
      this.collapsed = this.collapsed.filter((t: string) => t !== term);
      return;
    }
    this.collapsed = this.collapsed.concat([term]);
  }

  /** 页头摘要（只讲条数）。 */
  private headLine(): string {
    if (this.entries.length === 0) {
      return '';
    }
    return summaryLine(summarize(this.entries));
  }

  /** 缓存时间的人话（`MM-dd HH:mm`；没有缓存给空串）。 */
  private cacheLine(): string {
    if (this.cachedAt <= 0) {
      return '';
    }
    return '本地缓存于 ' + fmtCheckTime(this.cachedAt) + '（30 分钟内不重复登录）';
  }

  /** 学号打码：只露头 4 尾 2（与设置页同口径）。 */
  private maskedUser(): string {
    const s: string = this.savedUser;
    if (s.length <= 6) {
      return s.length > 0 ? s : '已保存';
    }
    return s.substring(0, 4) + '****' + s.substring(s.length - 2);
  }

  aboutToAppear(): void {
    this.load();
  }

  private async load(): Promise<void> {
    this.hasCred = await ScoreCredentialStore.has();
    this.savedUser = await ScoreCredentialStore.savedUsername();
    const cache: CachedScores | null = await ScoreStore.loadCache();
    if (cache !== null) {
      this.entries = cache.entries;
      this.cachedAt = cache.atMillis;
    }
    const st: ScoreCheckStatus | null = await ScoreCheckRunner.lastStatus();
    this.lastLine = statusText(st);
    // 缓存过期不自动刷新：那是一次真登录，必须由用户发起
    if (cache !== null && !isFresh(cache, Date.now(), SCORE_CACHE_TTL_MS)) {
      this.msg = '本地缓存已超过 30 分钟，可下拉刷新或点「立即查询」取最新';
    }
  }

  /** 触发一次真查询（会走学校 SSO）。 */
  private async runCheck(force: boolean): Promise<void> {
    if (this.busy) {
      return;
    }
    this.busy = true;
    this.inputErr = '';
    this.msg = '正在查询（需要走一次学校统一身份认证）…';
    try {
      const ctx: Context = getContext(this) as Context;
      const out: ScoreCheckOutcome = await ScoreCheckRunner.check(ctx, force, false);
      this.applyOutcome(out);
      await this.load();
    } catch (e) {
      warn('ScorePage runCheck throw: ' + JSON.stringify(e));
      this.msg = '⚠️ 查询异常：' + (e as Error).message;
    }
    this.busy = false;
    this.refreshing = false;
  }

  /** 把检查结果翻成页面上一句话（分类必须分开写，见文件头纪律 3）。 */
  private applyOutcome(out: ScoreCheckOutcome): void {
    if (!out.ran) {
      if (out.code === ScoreCheckCode.NOT_LOGGED_IN) {
        this.msg = '还没保存学号密码：填一次并勾「记住密码」后即可自动检查';
      } else {
        this.msg = out.reason;
      }
      return;
    }
    if (out.code === ScoreCheckCode.OK) {
      let t: string = '查询完成：' + out.count + ' 门课';
      if (out.newCount > 0) {
        t = t + '（新出分 ' + out.newCount + ' 门）';
      }
      this.msg = t;
      return;
    }
    if (out.code === ScoreCheckCode.AUTH_FAILED) {
      const r: string | null = humanReason(out.detail);
      this.msg = '⚠️ 学校未通过本次登录' + (r === null ? '' : '：' + r) + '（重试无效，请先确认学号与密码）';
      return;
    }
    if (out.code === ScoreCheckCode.NEED_SMS) {
      this.msg = '⚠️ 学校要求短信验证，本次查询无法继续（请在网页端完成验证后再试）';
      return;
    }
    if (out.code === ScoreCheckCode.TIMEOUT) {
      this.msg = '⚠️ 认证超时，稍后重试';
      return;
    }
    if (out.code === ScoreCheckCode.NOT_LOGGED_IN) {
      this.msg = '⚠️ 未登录：学号或密码为空';
      return;
    }
    this.msg = '⚠️ 查询失败' + (out.detail === null ? '' : '：' + out.detail);
  }

  /** 用本次输入的凭据查询（可选保存到密钥库）。 */
  private async queryWithInput(): Promise<void> {
    const u: string = this.inputUser.trim();
    const p: string = this.inputPwd;
    if (u.length === 0) {
      this.inputErr = '请填学号';
      return;
    }
    if (p.length === 0) {
      this.inputErr = '请填密码';
      return;
    }
    this.inputErr = '';
    try {
      if (this.remember) {
        await ScoreCredentialStore.save(u, p);
      }
      // 密码用完立刻从 UI 状态里清掉（不在 @State 里长期驻留）
      this.inputPwd = '';
      await this.runCheck(true);
    } catch (e) {
      this.inputErr = '保存失败：' + (e as Error).message;
    }
  }

  /** 忘记已保存的密码（连带清掉成绩本地数据，避免「以为删干净了」）。 */
  private async forgetCred(): Promise<void> {
    try {
      await ScoreCredentialStore.clear();
      await ScoreStore.clear();
      this.entries = [];
      this.cachedAt = 0;
      this.hasCred = false;
      this.savedUser = '';
      this.msg = '已清除保存的密码与本机成绩数据';
      await this.load();
    } catch (e) {
      this.msg = '⚠️ 清除失败：' + (e as Error).message;
    }
  }

  build() {
    Column() {
      // ── 顶栏 ──
      Row() {
        Text('‹ 返回')
          .fontSize(14).fontColor(this.tk().primary)
          .onClick(() => {
            router.back();
          })
        Text('成绩')
          .fontSize(16).fontWeight(FontWeight.Bold).fontColor(this.tk().onSurface)
          .layoutWeight(1).textAlign(TextAlign.Center)
        Text(this.busy ? '查询中' : '刷新')
          .fontSize(14)
          .fontColor(this.busy ? this.tk().onSurfaceVariant : this.tk().primary)
          .onClick(() => {
            if (!this.busy && this.hasCred) {
              this.runCheck(true);
            }
          })
      }
      .width('100%')
      .padding({ left: 12, right: 12, top: 10, bottom: 4 })

      Refresh({ refreshing: this.refreshing }) {
        Scroll() {
          Column() {
            // ── 凭据区（没保存时给输入；保存了就只给「忘记」入口）──
            if (!this.hasCred) {
              this.credForm()
            } else {
              Column() {
                Row() {
                  Text('已保存 ' + this.maskedUser())
                    .fontSize(13).fontColor(this.tk().onSurface).layoutWeight(1)
                  Text('忘记')
                    .fontSize(12).fontColor(this.tk().primary)
                    .onClick(() => {
                      this.forgetCred();
                    })
                }
                .width('100%')
                Button(this.busy ? '查询中…' : '立即查询')
                  .height(34).fontSize(13).width('100%').margin({ top: 10 })
                  .backgroundColor(this.tk().primary).fontColor(this.tk().onPrimary)
                  .enabled(!this.busy)
                  .onClick(() => {
                    this.runCheck(true);
                  })
              }
              .width('100%').padding(12).margin({ top: 6 })
              .backgroundColor(this.tk().surface).borderRadius(12)
              .alignItems(HorizontalAlign.Start)
            }

            // ── 状态行 ──
            if (this.msg.length > 0) {
              Text(this.msg)
                .fontSize(12).fontColor(this.tk().onSurfaceVariant)
                .width('100%').margin({ top: 10 })
            }

            // ── 摘要 + 缓存说明 ──
            if (this.headLine().length > 0) {
              Text(this.headLine())
                .fontSize(13).fontWeight(FontWeight.Medium)
                .fontColor(this.tk().onSurfaceVariant)
                .width('100%').margin({ top: 12 })
            }
            if (this.cacheLine().length > 0) {
              Text(this.cacheLine())
                .fontSize(11).fontColor(this.tk().onSurfaceVariant)
                .width('100%').margin({ top: 2 })
            }
            if (this.lastLine.length > 0) {
              Text(this.lastLine)
                .fontSize(11).fontColor(this.tk().onSurfaceVariant)
                .width('100%').margin({ top: 2 })
            }

            // ── 空态 ──
            if (this.entries.length === 0) {
              Column() {
                Text(this.hasCred
                  ? '还没有成绩数据。点「立即查询」取一次。'
                  : '填入学号与密码后可查询。密码默认不保存，只在本次查询里用一次。')
                  .fontSize(12).fontColor(this.tk().onSecondaryContainer)
                  .width('100%').textAlign(TextAlign.Center)
              }
              .width('100%').padding(16).margin({ top: 10 })
              .backgroundColor(this.tk().secondaryContainer).borderRadius(12)
            }

            // ── 学期分组列表 ──
            // 学分与分档（没有学分列时 creditText 为空，整行不显示）
            if (this.creditText().length > 0) {
              Text(this.creditText())
                .fontSize(12).fontColor(this.tk().onSurfaceVariant)
                .width('100%').margin({ top: 10 })
            }
            if (this.bucketText().length > 0) {
              Text(this.bucketText())
                .fontSize(11).fontColor(this.tk().textPlaceholder)
                .width('100%').margin({ top: 2 })
            }

            if (this.entries.length > 0) {
              TextInput({ placeholder: '按课名筛选（如：数学）', text: this.filter })
                .fontSize(13).fontColor(this.tk().onSurface)
                .backgroundColor(this.tk().surface)
                .height(38).margin({ top: 12 })
                .onChange((v: string) => {
                  this.filter = v;
                })
            }

            ForEach(this.visibleGroups(), (g: ScoreTermGroup) => {
              this.termBlock(g)
            }, (g: ScoreTermGroup) => 'term_' + g.term)

            if (this.filter.trim().length > 0 && this.visibleGroups().length === 0) {
              Text('没有匹配「' + this.filter.trim() + '」的课程')
                .fontSize(12).fontColor(this.tk().onSurfaceVariant)
                .width('100%').margin({ top: 14 })
            }

            // ── 隐私说明（原版的成绩在网页里；这里的边界要写清楚）──
            Text('成绩只存在本机（沙箱偏好），不上传；通知里只有课名、不含分数。')
              .fontSize(11).fontColor(this.tk().onSurfaceVariant)
              .width('100%').margin({ top: 16 })

            Text('')
              .height(24)
          }
          .width('100%').padding({ left: 12, right: 12 })
          .alignItems(HorizontalAlign.Start)
        }
        .width('100%').height('100%')
        // ⚠️ 顶对齐必须挂 Scroll 自身（写在内层 Column 上不生效）
        .align(Alignment.Top)
      }
      // ⚠️ onRefreshing 必须排在 layoutWeight 前面（test-uiconventions 规则 1 的形状判据）
      .onRefreshing(() => {
        this.refreshing = true;
        if (this.hasCred) {
          this.runCheck(true);
        } else {
          this.msg = '先填学号密码（或保存一次）才能查询';
          this.refreshing = false;
        }
      })
      .layoutWeight(1)
    }
    .width('100%').height('100%')
    .backgroundColor(this.tk().background)
  }

  /** 临时凭据表单（默认不保存；勾了才写系统密钥库）。 */
  @Builder
  credForm() {
    Column() {
      Text('学号密码只用于这次查询。勾选「记住」才会保存到系统密钥库。')
        .fontSize(11).fontColor(this.tk().onSurfaceVariant)
        .width('100%')

      TextInput({ placeholder: '学号', text: this.inputUser })
        .fontSize(14).fontColor(this.tk().onSurface)
        .backgroundColor(this.tk().background)
        .margin({ top: 10 })
        .onChange((v: string) => {
          this.inputUser = v;
        })

      TextInput({ placeholder: '密码', text: this.inputPwd })
        .type(InputType.Password)
        .fontSize(14).fontColor(this.tk().onSurface)
        .backgroundColor(this.tk().background)
        .margin({ top: 8 })
        .onChange((v: string) => {
          this.inputPwd = v;
        })

      Row() {
        Checkbox()
          .select(this.remember)
          .selectedColor(this.tk().primary)
          .unselectedColor(this.tk().outline)
          .onChange((v: boolean) => {
            this.remember = v;
          })
        Text('记住密码（用于后台出分提醒）')
          .fontSize(12).fontColor(this.tk().onSurfaceVariant)
          .layoutWeight(1).margin({ left: 6 })
      }
      .width('100%').margin({ top: 8 })

      if (this.inputErr.length > 0) {
        Text(this.inputErr)
          .fontSize(11).fontColor(this.tk().error)
          .width('100%').margin({ top: 6 })
      }

      Button(this.busy ? '查询中…' : '查询')
        .height(34).fontSize(13).width('100%').margin({ top: 10 })
        .backgroundColor(this.tk().primary).fontColor(this.tk().onPrimary)
        .enabled(!this.busy)
        .onClick(() => {
          this.queryWithInput();
        })
    }
    .width('100%').padding(12).margin({ top: 6 })
    .backgroundColor(this.tk().surface).borderRadius(12)
    .alignItems(HorizontalAlign.Start)
  }

  /** 一个学期的分组：标题行 + 逐门课。 */
  @Builder
  termBlock(g: ScoreTermGroup) {
    Column() {
      Row() {
        Text(g.label)
          .fontSize(13).fontWeight(FontWeight.Medium)
          .fontColor(this.tk().onSurfaceVariant)
          .layoutWeight(1)
        if (this.termCreditText(g.term).length > 0) {
          Text(this.termCreditText(g.term))
            .fontSize(11).fontColor(this.tk().onSurfaceVariant)
            .margin({ right: 8 })
        }
        Text(g.entries.length + ' 门')
          .fontSize(11).fontColor(this.tk().onSurfaceVariant)
        Text(this.isCollapsed(g.term) ? ' ▸' : ' ▾')
          .fontSize(11).fontColor(this.tk().onSurfaceVariant)
          .margin({ left: 4 })
      }
      .width('100%')
      .padding({ top: 14, bottom: 6 })
      .accessibilityText(g.label + '，' + g.entries.length + ' 门，' +
        (this.isCollapsed(g.term) ? '已折叠，点按展开' : '点按折叠'))
      .onClick(() => this.toggleCollapse(g.term))

      if (!this.isCollapsed(g.term)) {
      Column() {
        ForEach(g.entries, (e: ScoreEntry, idx: number) => {
          // 分隔线用 1vp 条而不是 border：border 的三元写法在 ArkTS 里要显式类型，不值得
          if (idx > 0) {
            Text('')
              .width('100%').height(1)
              .backgroundColor(this.tk().outlineVariant)
          }
          Row() {
            Text(e.course)
              .fontSize(14).fontColor(this.tk().onSurface)
              .layoutWeight(1)
              .maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis })
            Text(hasScore(e) ? (e.score as string) : '未出分')
              .fontSize(15).fontWeight(FontWeight.Medium)
              .fontColor(hasScore(e) ? this.tk().primary : this.tk().onSurfaceVariant)
              .margin({ left: 10 })
          }
          .width('100%')
          .padding({ top: 9, bottom: 9 })
          // 读屏：一门课念全「课程名 + 分数 + 学分」，别只念课程名
          .accessibilityText(rowA11y(
            e.course,
            hasScore(e) ? (e.score as string) : '未出分',
            (e.credit !== undefined && e.credit > 0) ? formatCredit(e.credit) + ' 学分' : ''
          ))
        }, (e: ScoreEntry) => g.term + '|' + e.course + '|' + (e.score === null ? '' : e.score))
      }
      .width('100%').padding({ left: 12, right: 12 })
      .backgroundColor(this.tk().surface).borderRadius(12)
      }
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
  }
}
