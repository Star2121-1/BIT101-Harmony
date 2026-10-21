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
import { palette, Palette } from '../core/theme/AppColors.ts';
import { STORAGE_DARK } from '../data/ThemeStore.ts';
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

  @State studentId: string = '';
  @State loggedIn: boolean = false;

  @State cardSnap: CardSnapshot | null = null;
  @State cardTrend: BalanceTrend = emptyTrend();
  @State netResult: CampusNetResult | null = null;
  @State netTrend: TrafficTrend = emptyTrafficTrend();
  @State libResult: LibBorrowResult | null = null;

  @State busy: boolean = false;

  private p(): Palette {
    return palette(this.isDark);
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
      Row() {
        Button('‹ 返回')
          .onClick(() => {
            router.back();
          })
        Text('我').fontSize(16).fontWeight(FontWeight.Bold).layoutWeight(1)
          .textAlign(TextAlign.Center)
        Button('刷新').fontSize(13)
          .enabled(!this.busy)
          .onClick(() => {
            this.refresh();
          })
      }.width('100%').padding(12)

      Scroll() {
        Column() {
          // ── 账号 ──
          Column() {
            Row() {
              Text('学校账号')
                .fontSize(14).fontColor(this.p().textPrimary).layoutWeight(1)
              Text(this.loggedIn ? (this.studentId.length > 0 ? this.studentId : '已登录') : '未登录')
                .fontSize(13).fontColor(this.p().textMuted)
            }
            .width('100%')
            if (!this.loggedIn) {
              Button('去登录')
                .height(30).fontSize(12).margin({ top: 8 })
                .backgroundColor(this.p().accent).fontColor(this.p().textOnAccent)
                .onClick(() => {
                  router.pushUrl({ url: 'pages/LoginPage' }).catch((e: Error) => {
                    warn('me -> login fail: ' + JSON.stringify(e));
                  });
                })
            }
          }
          .width('100%').padding(12).margin({ top: 4 })
          .backgroundColor(this.p().bgCard).borderRadius(10)
          .alignItems(HorizontalAlign.Start)

          // ── 一卡通 ──
          Column() {
            Row() {
              Text('一卡通')
                .fontSize(14).fontColor(this.p().textPrimary).layoutWeight(1)
              Text(this.cardLine()).fontSize(14).fontColor(this.p().textPrimary)
              Text(' ›').fontSize(13).fontColor(this.p().textMuted)
            }
            .width('100%')
            if (this.cardTrendLine().length > 0) {
              Text(this.cardTrendLine())
                .fontSize(11).fontColor(this.p().textSecondary)
                .width('100%').margin({ top: 4 })
            }
          }
          .width('100%').padding(12).margin({ top: 10 })
          .backgroundColor(this.p().bgCard).borderRadius(10)
          .alignItems(HorizontalAlign.Start)
          .onClick(() => {
            router.pushUrl({ url: 'pages/CardPage' }).catch((e: Error) => {
              warn('me -> card fail: ' + JSON.stringify(e));
            });
          })

          // ── 校园网 ──
          Column() {
            Row() {
              Text('校园网')
                .fontSize(14).fontColor(this.p().textPrimary).layoutWeight(1)
              Text(this.netLine()).fontSize(13).fontColor(this.p().textPrimary)
              Text(' ›').fontSize(13).fontColor(this.p().textMuted)
            }
            .width('100%')
            if (this.netSubLine().length > 0) {
              Text(this.netSubLine())
                .fontSize(11).fontColor(this.p().textSecondary)
                .width('100%').margin({ top: 4 })
            }
          }
          .width('100%').padding(12).margin({ top: 10 })
          .backgroundColor(this.p().bgCard).borderRadius(10)
          .alignItems(HorizontalAlign.Start)
          .onClick(() => {
            router.pushUrl({ url: 'pages/NetPage' }).catch((e: Error) => {
              warn('me -> net fail: ' + JSON.stringify(e));
            });
          })

          // ── 图书馆 ──
          Column() {
            Row() {
              Text('图书馆')
                .fontSize(14).fontColor(this.p().textPrimary).layoutWeight(1)
              Text(this.libLine()).fontSize(13).fontColor(this.p().textPrimary)
              Text(' ›').fontSize(13).fontColor(this.p().textMuted)
            }
            .width('100%')
            if (this.libSubLine().length > 0) {
              Text(this.libSubLine())
                .fontSize(11).fontColor(this.p().textSecondary)
                .width('100%').margin({ top: 4 })
            }
          }
          .width('100%').padding(12).margin({ top: 10 })
          .backgroundColor(this.p().bgCard).borderRadius(10)
          .alignItems(HorizontalAlign.Start)
          .onClick(() => {
            router.pushUrl({ url: 'pages/LibBorrowPage' }).catch((e: Error) => {
              warn('me -> lib fail: ' + JSON.stringify(e));
            });
          })

          // ── 作业 / 设置 ──
          Column() {
            Row() {
              Text('作业（DDL）')
                .fontSize(14).fontColor(this.p().textPrimary).layoutWeight(1)
              Text(' ›').fontSize(13).fontColor(this.p().textMuted)
            }
            .width('100%')
            .onClick(() => {
              router.pushUrl({ url: 'pages/DdlPage' }).catch((e: Error) => {
                warn('me -> ddl fail: ' + JSON.stringify(e));
              });
            })

            Row() {
              Text('通知')
                .fontSize(14).fontColor(this.p().textPrimary).layoutWeight(1)
              Text('提醒记录').fontSize(13).fontColor(this.p().textMuted)
              Text(' ›').fontSize(13).fontColor(this.p().textMuted)
            }
            .width('100%').padding({ top: 12 })
            .onClick(() => {
              router.pushUrl({ url: 'pages/NotifyListPage' }).catch((e: Error) => {
                warn('me -> notify fail: ' + JSON.stringify(e));
              });
            })

            Row() {
              Text('提醒设置')
                .fontSize(14).fontColor(this.p().textPrimary).layoutWeight(1)
              Text('开关 / 提前量').fontSize(13).fontColor(this.p().textMuted)
              Text(' ›').fontSize(13).fontColor(this.p().textMuted)
            }
            .width('100%').padding({ top: 12 })
            .onClick(() => {
              router.pushUrl({ url: 'pages/NotifySettingsPage' }).catch((e: Error) => {
                warn('me -> notify settings fail: ' + JSON.stringify(e));
              });
            })

            Row() {
              Text('设置')
                .fontSize(14).fontColor(this.p().textPrimary).layoutWeight(1)
              Text(' ›').fontSize(13).fontColor(this.p().textMuted)
            }
            .width('100%').padding({ top: 12 })
            .onClick(() => {
              router.pushUrl({ url: 'pages/SettingsPage' }).catch((e: Error) => {
                warn('me -> settings fail: ' + JSON.stringify(e));
              });
            })
          }
          .width('100%').padding(12).margin({ top: 10 })
          .backgroundColor(this.p().bgCard).borderRadius(10)
        }
        .width('100%').padding({ left: 12, right: 12, bottom: 24 })
        .align(Alignment.Top)
      }
      .layoutWeight(1)
    }
    .width('100%').height('100%')
    .backgroundColor(this.p().bgPage)
  }
}
