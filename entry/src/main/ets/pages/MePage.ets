/**
 * 「我」页（M5-5）：账号状态 + 三卡摘要（一卡通 / 校园网 / 图书馆）+ 设置入口。
 *
 * 验收判据（ROADMAP §4 M5-5，可证伪）：
 *  1. 三张卡**常显摘要**（不是空白）：取不到/未登录/确实没有各有各的话；
 *  2. 未登录时给登录入口，而不是让人自己去找；
 *  3. 点卡片进对应详情页；进详情页回来后数字会刷新（onPageShow）。
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
import { info, warn } from '../core/log/BitLog.ts';

@Entry
@Component
struct MePage {
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
        Text('‹ 返回')
          .fontSize(14).fontColor(this.p().primary)
          .onClick(() => {
            router.back();
          })
        Blank().layoutWeight(1)
        Text('↻')
          .fontSize(18).fontColor(this.p().onSurfaceVariant)
          .margin({ right: 16 })
          .onClick(() => {
            this.refresh();
          })
        Text('🔔')
          .fontSize(15).fontColor(this.p().onSurfaceVariant)
          .margin({ right: 16 })
          .onClick(() => {
            router.pushUrl({ url: 'pages/NotifyListPage' }).catch((e: Error) => {
              warn('me -> notify fail: ' + JSON.stringify(e));
            });
          })
        Text('⚙')
          .fontSize(16).fontColor(this.p().onSurfaceVariant)
          .onClick(() => {
            router.pushUrl({ url: 'pages/SettingsPage' }).catch((e: Error) => {
              warn('me -> settings fail: ' + JSON.stringify(e));
            });
          })
      }
      .width('100%').padding({ left: 12, right: 12, top: 10, bottom: 4 })

      Scroll() {
        Column() {
          // ── 账号区（ref-03：头像 + 账号 + 状态）──
          Column() {
            Row() {
              // 头像圆：primaryContainer 底 + 主色人形字（无头像图源，用字符兜底）
              Text('👤')
                .fontSize(22)
                .width(48).height(48)
                .textAlign(TextAlign.Center)
                .backgroundColor(this.p().primaryContainer)
                .borderRadius(24)
              Column() {
                Text(this.loggedIn ? (this.studentId.length > 0 ? this.studentId : '已登录') : '未登录')
                  .fontSize(16).fontWeight(FontWeight.Medium).fontColor(this.p().onSurface)
                Text('学校账号')
                  .fontSize(11).fontColor(this.p().textPlaceholder).margin({ top: 2 })
              }
              .alignItems(HorizontalAlign.Start).layoutWeight(1).margin({ left: 12 })
            }
            .width('100%')
            if (!this.loggedIn) {
              Button('去登录')
                .height(32).fontSize(13).margin({ top: 10 })
                .backgroundColor(this.p().primary).fontColor(this.p().onPrimary)
                .onClick(() => {
                  router.pushUrl({ url: 'pages/LoginPage' }).catch((e: Error) => {
                    warn('me -> login fail: ' + JSON.stringify(e));
                  });
                })
            }
          }
          .width('100%').padding(14).margin({ top: 4 })
          .backgroundColor(this.p().surface).borderRadius(12)
          .alignItems(HorizontalAlign.Start)

          // ── 双卡横排：一卡通 + 校园网（ref-03：secondaryContainer 底双卡）──
          Row() {
            Column() {
              Text('一卡通')
                .fontSize(12).fontColor(this.p().onSecondaryContainer).layoutWeight(1)
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
            .onClick(() => {
              router.pushUrl({ url: 'pages/CardPage' }).catch((e: Error) => {
                warn('me -> card fail: ' + JSON.stringify(e));
              });
            })

            Column() {
              Text('校园网')
                .fontSize(12).fontColor(this.p().onSecondaryContainer).layoutWeight(1)
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
            .onClick(() => {
              router.pushUrl({ url: 'pages/NetPage' }).catch((e: Error) => {
                warn('me -> net fail: ' + JSON.stringify(e));
              });
            })
          }
          .width('100%').margin({ top: 10 })

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
          .onClick(() => {
            router.pushUrl({ url: 'pages/LibBorrowPage' }).catch((e: Error) => {
              warn('me -> lib fail: ' + JSON.stringify(e));
            });
          })

          // ── 功能入口组（原版走底部 tab/设置页；鸿蒙无 tab 框架，入口收在这）──
          Column() {
            Row() {
              Text('作业（DDL）')
                .fontSize(14).fontColor(this.p().onSurface).layoutWeight(1)
              Text(' ›').fontSize(13).fontColor(this.p().textPlaceholder)
            }
            .width('100%')
            .onClick(() => {
              router.pushUrl({ url: 'pages/DdlPage' }).catch((e: Error) => {
                warn('me -> ddl fail: ' + JSON.stringify(e));
              });
            })

            Row() {
              Text('座位预约')
                .fontSize(14).fontColor(this.p().onSurface).layoutWeight(1)
              Text('选座 / 我的预约').fontSize(11).fontColor(this.p().textPlaceholder)
              Text(' ›').fontSize(13).fontColor(this.p().textPlaceholder)
            }
            .width('100%').padding({ top: 12 })
            .onClick(() => {
              router.pushUrl({ url: 'pages/SeatPage' }).catch((e: Error) => {
                warn('me -> seat fail: ' + JSON.stringify(e));
              });
            })

            Row() {
              Text('通知')
                .fontSize(14).fontColor(this.p().onSurface).layoutWeight(1)
              Text('提醒记录').fontSize(13).fontColor(this.p().textPlaceholder)
              Text(' ›').fontSize(13).fontColor(this.p().textPlaceholder)
            }
            .width('100%').padding({ top: 12 })
            .onClick(() => {
              router.pushUrl({ url: 'pages/NotifyListPage' }).catch((e: Error) => {
                warn('me -> notify fail: ' + JSON.stringify(e));
              });
            })

            Row() {
              Text('提醒设置')
                .fontSize(14).fontColor(this.p().onSurface).layoutWeight(1)
              Text('开关 / 提前量').fontSize(13).fontColor(this.p().textPlaceholder)
              Text(' ›').fontSize(13).fontColor(this.p().textPlaceholder)
            }
            .width('100%').padding({ top: 12 })
            .onClick(() => {
              router.pushUrl({ url: 'pages/NotifySettingsPage' }).catch((e: Error) => {
                warn('me -> notify settings fail: ' + JSON.stringify(e));
              });
            })

            Row() {
              Text('设置')
                .fontSize(14).fontColor(this.p().onSurface).layoutWeight(1)
              Text('外观 / 账号 / 校区').fontSize(13).fontColor(this.p().textPlaceholder)
              Text(' ›').fontSize(13).fontColor(this.p().textPlaceholder)
            }
            .width('100%').padding({ top: 12 })
            .onClick(() => {
              router.pushUrl({ url: 'pages/SettingsPage' }).catch((e: Error) => {
                warn('me -> settings fail: ' + JSON.stringify(e));
              });
            })
          }
          .width('100%').padding(12).margin({ top: 10 })
          .backgroundColor(this.p().surface).borderRadius(12)
          .alignItems(HorizontalAlign.Start)
        }
        .width('100%').padding({ left: 12, right: 12, bottom: 24 })
        .align(Alignment.Top)
      }
      .layoutWeight(1)
    }
    .width('100%').height('100%')
    .backgroundColor(this.p().background)
  }
}
