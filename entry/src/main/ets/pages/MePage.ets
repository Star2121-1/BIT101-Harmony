/**
 * 「我」页（M5-5，#91 对照原版 ref-03 重排）：
 * 顶栏三图标（刷新/通知/设置）+ 居中账号区（无白卡，直接铺背景）
 * + 自习卡 + 一卡通/校园网双卡 + 图书馆卡。
 *
 * 验收判据（可证伪）：
 *  1. 三张卡**常显摘要**（不是空白）：取不到/未登录/确实没有各有各的话；
 *  2. 未登录时给登录入口，而不是让人自己去找；
 *  3. 点卡片进对应详情页；进详情页回来后数字会刷新（onPageShow）。
 *  4. 功能入口组已按原版删除（2026-10-27）：作业/座位走底部 tab、
 *     通知/设置走顶栏图标、提醒设置迁到设置页「提醒」组（唯一入口先安置再拆）。
 *
 * ## 为什么三卡各自独立兜底
 *
 * 三个数据源完全不同（一卡通 Web cookie / 内网明文 http / 图书馆 cookie），
 * 一个挂了不能让另外两张卡跟着消失 —— 每张卡自己 try/catch，各自显示自己的状态。
 *
 * ## 卡片上的趋势只显示「真的变了」
 *
 * 一卡通余额没动时 trendText 会说「今日 无变化 · 近 7 天 无变化」——
 * 占着天天看的一行却什么都没说 ⇒ 卡片用 hasChange 挡一层（Android 同款取舍）。
 * 详情页不受此限（那里「记录中…」是有用的解释）。
 */

import { Context } from '@kit.AbilityKit';
import { router } from '@kit.ArkUI';
import { gridTokens } from '../core/theme/GridTokens.ts';
import type { GridTokens } from '../core/theme/GridTokens.ts';
import { STORAGE_DARK, STORAGE_PALETTE, getPalette } from '../data/ThemeStore.ts';
import { SessionSnapshot, SessionStore } from '../data/SessionStore.ts';
import { CampusCardService } from '../service/CampusCardService.ts';
import { CampusCardStore } from '../data/CampusCardStore.ts';
import { CampusNetService } from '../service/CampusNetService.ts';
import { CampusNetTrafficStore } from '../data/CampusNetTrafficStore.ts';
import { LibBorrowService, LibBorrowResult } from '../service/LibBorrowService.ts';
import { CardSnapshot } from '../corelogic/CampusCardLogic.ts';
import { BalanceTrend, emptyTrend, hasChange, trendText } from '../corelogic/CampusCardBalanceLogic.ts';
import { CampusNetResult, LIMIT_BYTES, formatTraffic } from '../corelogic/CampusNetLogic.ts';
import { TrafficTrend, emptyTrafficTrend, todayText } from '../corelogic/CampusNetTrafficLogic.ts';
import { cardSummary } from '../corelogic/LibBorrowLogic.ts';
import type { DateTime } from '../corelogic/timeutil.ts';
import { rowA11y, joinA11y } from '../corelogic/A11yText.ts';
import { info, warn } from '../core/log/BitLog.ts';
import { StudySpotCard } from '../components/me/StudySpotCard.ets';

@Entry
@Component
export struct MePage {
  /** true = 被外壳（底部 tab）嵌入：不渲染返回键（原版这些是 pager 页签，没有页面级返回）。 */
  isEmbedded: boolean = false;

  @StorageLink(STORAGE_DARK) isDark: boolean = false;
  @StorageLink(STORAGE_PALETTE) paletteName: string = 'warm';

  @State studentId: string = '';
  @State loggedIn: boolean = false;

  @State cardSnap: CardSnapshot | null = null;
  @State cardTrend: BalanceTrend = emptyTrend();
  @State netResult: CampusNetResult | null = null;
  @State netTrend: TrafficTrend = emptyTrafficTrend();
  @State libResult: LibBorrowResult | null = null;

  @State busy: boolean = false;

  private p(): GridTokens {
    return gridTokens(this.isDark, getPalette(this.paletteName));
  }

  /** 本地「现在」（展示层 impure 边界：到期文案现算）。 */
  private now(): DateTime {
    const d: Date = new Date();
    const offsetMs: number = d.getTimezoneOffset() * 60000;
    return {
      day: Math.floor((d.getTime() - offsetMs) / 86400000),
      minutes: d.getHours() * 60 + d.getMinutes()
    };
  }

  // ── 一卡通卡 ──

  private cardLine(): string {
    const s: CardSnapshot | null = this.cardSnap;
    if (s === null) return '—';
    if (s.failed) return '取不到（点开重试）';
    if (!s.loggedIn) return '未登录，点开登录';
    return s.entries.length > 0 ? '¥' + s.entries[0].value : '未识别到余额';
  }

  /** 卡片上的趋势行：**只有真的变了才显示**（见文件头注释）。 */
  private cardTrendLine(): string {
    if (!hasChange(this.cardTrend)) return '';
    const t: string | null = trendText(this.cardTrend);
    return t !== null ? t : '';
  }

  // ── 校园网卡 ──

  private netLine(): string {
    const r: CampusNetResult | null = this.netResult;
    if (r === null) return '—';
    if (r.kind === 'online') {
      return formatTraffic(r.info.bytesTotal) + ' / ' + formatTraffic(LIMIT_BYTES);
    }
    if (r.kind === 'notOnline') return '未认证，点开去登录';
    return '连不上（多半不在校园网内）';
  }

  private netSubLine(): string {
    const t: string | null = todayText(this.netTrend);
    return t !== null ? '今日 ' + t : '';
  }

  // ── 图书馆卡 ──

  private libLine(): string {
    const r: LibBorrowResult | null = this.libResult;
    if (r === null) return '—';
    if (r.kind === 'loggedOut') return '未登录，点开登录';
    if (r.kind === 'failed') return '取不到（点开重试）';
    return '在借 ' + r.records.length + ' 本';
  }

  private libSubLine(): string {
    const r: LibBorrowResult | null = this.libResult;
    if (r === null || r.kind !== 'ok' || r.records.length === 0) return '';
    return cardSummary(r.records, this.now());
  }

  // ── 加载 ──

  private async loadCard(ctx: Context): Promise<void> {
    try {
      const snap: CardSnapshot = await CampusCardService.fetchSnapshot(ctx);
      this.cardSnap = snap;
      // 只有「已登录 + 解析出金额」才记采样（未登录页上的数字会污染趋势）
      let amount: number | null = null;
      if (snap.loggedIn && !snap.failed && snap.entries.length > 0) {
        const raw: string = snap.entries[0].value.replace(/,/g, '');
        const v: number = Number(raw);
        amount = raw.length > 0 && Number.isFinite(v) ? v : null;
      }
      this.cardTrend = await CampusCardStore.record(amount);
    } catch (e) {
      warn('me card fail: ' + (e as Error).message);
      this.cardSnap = { entries: [], htmlSnippet: '', loggedIn: false, failed: true };
    }
  }

  private async loadNet(ctx: Context): Promise<void> {
    try {
      const r: CampusNetResult = await CampusNetService.fetchOnlineInfo(ctx);
      this.netResult = r;
      const bytes: number | null = r.kind === 'online' ? r.info.bytesTotal : null;
      this.netTrend = await CampusNetTrafficStore.record(bytes);
    } catch (e) {
      warn('me net fail: ' + (e as Error).message);
      this.netResult = { kind: 'failed', reason: (e as Error).message };
    }
  }

  private async loadLib(ctx: Context): Promise<void> {
    try {
      const r: LibBorrowResult = await LibBorrowService.fetchCurrent(ctx);
      this.libResult = r;
    } catch (e) {
      warn('me lib fail: ' + (e as Error).message);
      this.libResult = { kind: 'failed', reason: (e as Error).message };
    }
  }

  private async refresh(): Promise<void> {
    if (this.busy) {
      return;
    }
    this.busy = true;
    try {
      const snap: SessionSnapshot = await SessionStore.snapshot();
      this.studentId = snap.studentId;
      this.loggedIn = snap.hasSchoolCookies;
    } catch (e) {
      warn('me session fail: ' + JSON.stringify(e));
    }
    // 三卡**并行**且各自兜底：一个挂了不影响另外两张
    const ctx: Context = getContext(this) as Context;
    const tasks: Promise<void>[] = [this.loadCard(ctx), this.loadNet(ctx), this.loadLib(ctx)];
    await Promise.all(tasks);
    this.busy = false;
    info('me refresh done loggedIn=' + this.loggedIn);
  }

  onPageShow(): void {
    // 从详情页/登录页回来时要刷新（会话可能刚建立）
    this.refresh();
  }

  build() {
    // ⚠️ build() 根部不声明局部变量（编译器只认根节点起手）
    Column() {
      // ── 顶栏：‹ 返回 + 右侧三图标（刷新/通知/设置）──
      // 原版「我」是底部 tab 页无返回键（ref-03）；鸿蒙是 push 子页，
      // 保留返回；三图标 1:1 原版顶栏。
      Row() {
        if (!this.isEmbedded) {
          Text('‹ 返回')
            .fontSize(14).fontColor(this.p().primary)
            .onClick(() => {
              router.back();
            })
        }
        Blank().layoutWeight(1)
        // 右上三图标 = 原版 ref-03 的 ↻ / 🔔 / ⚙（Material Rounded 矢量，不再用 emoji：emoji
        // 在不同字重下形状不一致，且无法跟随 token 上色）
        Image($rawfile('icons/ic_refresh.svg'))
          .width(19).height(19)
          .fillColor(this.p().onSurfaceVariant)
          .margin({ right: 16 })
          .onClick(() => {
            this.refresh();
          })
        Image($rawfile('icons/ic_bell.svg'))
          .width(19).height(19)
          .fillColor(this.p().onSurfaceVariant)
          .margin({ right: 16 })
          .onClick(() => {
            router.pushUrl({ url: 'pages/NotifyListPage' }).catch((e: Error) => {
              warn('me -> notify fail: ' + JSON.stringify(e));
            });
          })
        Image($rawfile('icons/ic_settings.svg'))
          .width(19).height(19)
          .fillColor(this.p().onSurfaceVariant)
          .onClick(() => {
            router.pushUrl({ url: 'pages/SettingsPage' }).catch((e: Error) => {
              warn('me -> settings fail: ' + JSON.stringify(e));
            });
          })
      }
      .width('100%').padding({ left: 12, right: 12, top: 10, bottom: 4 })

      Scroll() {
        Column() {
          // ── 账号区（ref-03：居中直接铺在背景上，**无白卡**）──
          // 对照原版拆掉白卡（MIGRATION-BASELINE §12.3-4）；UID/签名/粉丝关注
          // 原版有但鸿蒙无数据源，不编造，只落「居中 + 无卡」这两条能落的。
          Column() {
            // 头像：品牌鸽（与桌面图标同源的前景图，透明底）+ primaryContainer 圆底
            Column() {
              Image($r('app.media.foreground'))
                .width(44).height(44)
                .objectFit(ImageFit.Contain)
            }
            .width(72).height(72)
            .justifyContent(FlexAlign.Center)
            .backgroundColor(this.p().primaryContainer)
            .borderRadius(36)

            Text(this.loggedIn ? (this.studentId.length > 0 ? this.studentId : '已登录') : '未登录')
              .fontSize(18).fontWeight(FontWeight.Medium).fontColor(this.p().onSurface)
              .margin({ top: 10 })
            Text(this.loggedIn ? '学校账号' : '登录后可同步课表与作业')
              .fontSize(12).fontColor(this.p().textPlaceholder).margin({ top: 4 })
            if (!this.loggedIn) {
              Button('去登录')
                .height(32).fontSize(13).margin({ top: 12 })
                .backgroundColor(this.p().primary).fontColor(this.p().onPrimary)
                .onClick(() => {
                  router.pushUrl({ url: 'pages/LoginPage' }).catch((e: Error) => {
                    warn('me -> login fail: ' + JSON.stringify(e));
                  });
                })
            }
          }
          .width('100%').padding({ top: 12 })
          .alignItems(HorizontalAlign.Center)

          // ── 现在去哪儿自习（ref-03：这张卡在「我」页，不在首页）──
          StudySpotCard()
            .margin({ top: 10 })

          // ── 双卡横排：一卡通 + 校园网（ref-03：secondaryContainer 底双卡）──
          Row() {
            Column() {
              // ⚠️ 不许加 layoutWeight：卡片 Column 的高度由内容决定，layoutWeight 会让它
              // 去抢「剩余高度」，真机上被撑成整屏高的大色块（2026-10-26 实机）。
              Text('一卡通')
                .fontSize(12).fontColor(this.p().onSecondaryContainer)
              Text(this.cardLine())
                .fontSize(20).fontWeight(FontWeight.Medium)
                .fontColor(this.p().onSecondaryContainer).margin({ top: 6 })
              if (this.cardTrendLine().length > 0) {
                Text(this.cardTrendLine())
                  .fontSize(10).fontColor(this.p().onSecondaryContainer)
                  .width('100%').margin({ top: 4 })
              }
            }
            .width('48%').padding(12)
            .backgroundColor(this.p().secondaryContainer).borderRadius(12)
            .alignItems(HorizontalAlign.Start)
            .accessibilityText(rowA11y('一卡通', this.cardLine(), '点按查看明细'))
            .onClick(() => {
              router.pushUrl({ url: 'pages/CardPage' }).catch((e: Error) => {
                warn('me -> card fail: ' + JSON.stringify(e));
              });
            })

            Column() {
              Text('校园网')
                .fontSize(12).fontColor(this.p().onSecondaryContainer)
              Text(this.netLine())
                .fontSize(15).fontWeight(FontWeight.Medium)
                .fontColor(this.p().onSecondaryContainer).margin({ top: 6 })
              if (this.netSubLine().length > 0) {
                Text(this.netSubLine())
                  .fontSize(10).fontColor(this.p().onSecondaryContainer)
                  .width('100%').margin({ top: 4 })
              }
            }
            .width('48%').padding(12)
            .backgroundColor(this.p().secondaryContainer).borderRadius(12)
            .alignItems(HorizontalAlign.Start)
            .accessibilityText(rowA11y('校园网',
              joinA11y([this.netLine(), this.netSubLine()]), '点按查看流量'))
            .onClick(() => {
              router.pushUrl({ url: 'pages/NetPage' }).catch((e: Error) => {
                warn('me -> net fail: ' + JSON.stringify(e));
              });
            })
          }
          .width('100%').margin({ top: 10 })
          .alignItems(VerticalAlign.Top)

          // ── 图书馆单卡 ──
          Column() {
            Row() {
              Text('图书馆')
                .fontSize(14).fontColor(this.p().onSurface).layoutWeight(1)
              Text(this.libLine()).fontSize(14).fontColor(this.p().onSurface)
              Text(' ›').fontSize(13).fontColor(this.p().textPlaceholder)
            }
            .width('100%')
            if (this.libSubLine().length > 0) {
              Text(this.libSubLine())
                .fontSize(11).fontColor(this.p().onSurfaceVariant)
                .width('100%').margin({ top: 4 })
            }
          }
          .width('100%').padding(12).margin({ top: 10 })
          .backgroundColor(this.p().surface).borderRadius(12)
          .alignItems(HorizontalAlign.Start)
          .accessibilityText(rowA11y('图书馆借阅',
            joinA11y([this.libLine(), this.libSubLine()]), '点按查看借阅'))
          .onClick(() => {
            router.pushUrl({ url: 'pages/LibBorrowPage' }).catch((e: Error) => {
              warn('me -> lib fail: ' + JSON.stringify(e));
            });
          })

          // ── 功能入口组已删（对照原版 ref-03：原版没有这组）──
          // 作业/座位 → 底部 tab 已覆盖；通知/设置 → 顶栏 🔔/⚙ 已覆盖；
          // 提醒设置 → 唯一入口先迁到设置页「提醒」组（先安置再拆）。
        }
        .width('100%').padding({ left: 12, right: 12, bottom: 24 })
      }
      .layoutWeight(1)
      // ⚠️ 顶对齐必须挂 Scroll 自身：加在内层 Column 上不生效（内容不足一屏会被垂直居中）
      .align(Alignment.Top)
    }
    .width('100%').height('100%')
    .backgroundColor(this.p().background)
  }
}
