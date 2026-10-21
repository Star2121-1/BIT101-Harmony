/**
 * 一卡通详情页（M5-1）：余额 + 趋势 + 解析出的全部字段。
 *
 * 验收判据（ROADMAP §4 M5-1，可证伪）：
 *  1. 登录后显示余额；**登录判定看最终 URL 不看状态码**（CampusCardLogic.parse）；
 *  2. 「今日 / 近 N 天」趋势现算（ CampusCardBalanceLogic ），
 *     算不出来时给「记录中…」占位而不是让整行消失；
 *  3. **取不到 / 未登录 / 确实没有余额字段** 三态分明 —— 请求失败要说
 *     「重试」，说「未登录」会让用户白去登一次（2026-09-25 Android 踩过）。
 *
 * 数据来源：CampusCardService.fetchSnapshot（同步 Web cookie → GET 首页 →
 * 按最终 URL 解析）；趋势历史在 CampusCardStore（每次成功取数记一笔）。
 */

import { Context } from '@kit.AbilityKit';
import { router } from '@kit.ArkUI';
import { palette, Palette } from '../core/theme/AppColors.ts';
import { STORAGE_DARK } from '../data/ThemeStore.ts';
import { CampusCardService } from '../service/CampusCardService.ts';
import { CampusCardStore } from '../data/CampusCardStore.ts';
import { CardEntry, CardSnapshot, balanceText } from '../corelogic/CampusCardLogic.ts';
import { BalanceTrend, emptyTrend, trendRowText } from '../corelogic/CampusCardBalanceLogic.ts';
import { info, warn } from '../core/log/BitLog.ts';

@Entry
@Component
struct CardPage {
  @StorageLink(STORAGE_DARK) isDark: boolean = false;

  @State snap: CardSnapshot | null = null;
  @State busy: boolean = false;
  @State loaded: boolean = false;
  @State trend: BalanceTrend = emptyTrend();

  private p(): Palette {
    return palette(this.isDark);
  }

  /** 三态码：'none' | 'ok' | 'loggedOut' | 'failed'（UI 树里不能声明局部变量，绕一层）。 */
  private stateKind(): string {
    if (this.snap === null) return 'none';
    if (this.snap.failed) return 'failed';
    if (!this.snap.loggedIn) return 'loggedOut';
    return 'ok';
  }

  /** 解析出的条目（未登录/失败时为空）。 */
  private entries(): CardEntry[] {
    return this.snap !== null && !this.snap.failed && this.snap.loggedIn ? this.snap.entries : [];
  }

  /** 余额摘要（口径与 Android balanceText 1:1；详情页的未登录文案是「点下方按钮」）。 */
  private balanceLine(): string {
    return balanceText(this.snap, this.busy && !this.loaded, this.loaded, '未登录，点下方按钮登录');
  }

  /** 从快照取余额数值（记采样用）；取不到返回 null —— 不猜。 */
  private parsedAmount(): number | null {
    if (this.snap === null || this.snap.failed || !this.snap.loggedIn) return null;
    if (this.snap.entries.length === 0) return null;
    const raw: string = this.snap.entries[0].value.replace(/,/g, '');
    if (raw.length === 0) return null;
    const v: number = Number(raw);
    return Number.isFinite(v) ? v : null;
  }

  private async refresh(): Promise<void> {
    if (this.busy) {
      return;
    }
    this.busy = true;
    try {
      const ctx: Context = getContext(this) as Context;
      const snap: CardSnapshot = await CampusCardService.fetchSnapshot(ctx);
      this.snap = snap;
      // 只有「已登录 + 解析出金额」才记采样：未登录页面上那几个数字是登录页里的，
      // 记进去会污染趋势（Android 原注释同款纪律）
      this.trend = await CampusCardStore.record(this.parsedAmount());
      this.loaded = true;
      info('card page refresh kind=' + this.stateKind() + ' amount=' + this.parsedAmount());
    } catch (e) {
      warn('card page refresh fail: ' + (e as Error).message);
      this.snap = { entries: [], htmlSnippet: '', loggedIn: false, failed: true };
      this.loaded = true;
    }
    this.busy = false;
  }

  onPageShow(): void {
    // 从登录页返回时会再次触发 —— 会话刚建立，必须重取
    this.refresh();
  }

  build() {
    // ⚠️ build() 根部不声明局部变量（编译器只认根节点起手）
    Column() {
      Row() {
        Button('‹ 返回')
          .onClick(() => {
            router.back();
          })
        Text('一卡通').fontSize(16).fontWeight(FontWeight.Bold).layoutWeight(1)
          .textAlign(TextAlign.Center)
        Button('刷新').fontSize(13)
          .enabled(!this.busy)
          .onClick(() => {
            this.refresh();
          })
      }.width('100%').padding(12)

      Scroll() {
        Column() {
          // ── 余额大数 ──
          Text(this.balanceLine())
            .fontSize(28).fontWeight(FontWeight.Bold)
            .fontColor(this.stateKind() === 'ok' ? this.p().textPrimary : this.p().textMuted)
            .width('100%').padding({ left: 16, right: 16, top: 8 })

          // ── 趋势行（详情页恒定显示：算不出来也有「记录中…」解释） ──
          Text(trendRowText(this.trend))
            .fontSize(12).fontColor(this.p().textSecondary)
            .width('100%').padding({ left: 16, right: 16, top: 4 })

          // ── 三态处置 ──
          if (this.stateKind() === 'failed') {
            // 取不到：如实说取不到，给重试
            Text('⚠️ 暂时取不到一卡通数据（网络或接口问题）')
              .fontSize(12).fontColor(this.p().error).width('100%').padding(16)
            Button('重试').fontSize(13).margin({ top: 8 })
              .onClick(() => {
                this.refresh();
              })
          } else if (this.stateKind() === 'loggedOut') {
            // 未登录：可处置状态 —— 给登录入口
            Text('一卡通会话未建立。登录后即可查看余额。')
              .fontSize(12).fontColor(this.p().textMuted).width('100%').padding(16)
            Button('去一卡通登录')
              .fontSize(13).margin({ top: 8 })
              .backgroundColor(this.p().accent).fontColor(this.p().textOnAccent)
              .onClick(() => {
                router.pushUrl({ url: 'pages/CardLoginPage' }).catch((e: Error) => {
                  warn('card -> login fail: ' + JSON.stringify(e));
                });
              })
          } else if (this.stateKind() === 'none') {
            Text('还没有数据，点右上角刷新。')
              .fontSize(12).fontColor(this.p().textMuted).width('100%').padding(16)
          } else if (this.entries().length === 0) {
            // 已登录但解析不到余额字段：如实说，不显示成「¥」空值
            Text('已登录，但未在首页识别到余额字段（页面可能已改版）')
              .fontSize(12).fontColor(this.p().textMuted).width('100%').padding(16)
          } else {
            // keyGenerator 单参（本编译器唯一编译得过的写法）
            ForEach(this.entries(), (entry: CardEntry) => {
                Row() {
                  Text(entry.label)
                    .fontSize(13).fontColor(this.p().textSecondary).layoutWeight(1)
                  Text('¥' + entry.value)
                    .fontSize(13).fontColor(this.p().textPrimary)
                }
                .width('100%').padding(12).margin({ top: 8 })
                .backgroundColor(this.p().bgCard)
                .borderRadius(10)
              }, (entry: CardEntry) => entry.label + '=' + entry.value)
          }
        }
        .width('100%').padding({ left: 12, right: 12 })
        .align(Alignment.Top)
      }
      .layoutWeight(1)
    }
    .width('100%').height('100%')
    .backgroundColor(this.p().bgPage)
  }
}
