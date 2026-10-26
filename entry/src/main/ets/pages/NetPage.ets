/**
 * 校园网页（M5-2）：本月流量 / 今日用量 / 日均与月末预测 / 在线时长 / 余额。
 *
 * 验收判据（ROADMAP §4 M5-2，可证伪）：
 *  1. 校内网显示本月流量（按计费周期累计 = 官方「本月」口径）；
 *  2. 校外显示「连不上（多半不在校园网内）」而**不是**报错堆栈；
 *  3. 在校内但没在认证页登录过 → `not_online`，给「去认证页登录」入口
 *     —— 三种状态塌成一种，用户在校内也会被告知「需连校园网」（Android 09-25 踩过）。
 *
 * 数据来源：CampusNetService（10.0.0.55 内网接口，免登录）；
 * 趋势采样在 CampusNetTrafficStore（换计费周期会自动重置）。
 */

import { Context } from '@kit.AbilityKit';
import { router } from '@kit.ArkUI';
import { gridTokens } from '../core/theme/GridTokens.ts';
import type { GridTokens } from '../core/theme/GridTokens.ts';
import { STORAGE_DARK, STORAGE_PALETTE, getPalette } from '../data/ThemeStore.ts';
import { CampusNetService, NET_AUTH_URL } from '../service/CampusNetService.ts';
import { CampusNetTrafficStore } from '../data/CampusNetTrafficStore.ts';
import {
  CampusNetInfo,
  CampusNetResult,
  LIMIT_BYTES,
  formatDuration,
  formatTime,
  trafficStatusText
} from '../corelogic/CampusNetLogic.ts';
import {
  TrafficTrend,
  emptyTrafficTrend,
  forecastText,
  todayText
} from '../corelogic/CampusNetTrafficLogic.ts';
import { info, warn } from '../core/log/BitLog.ts';

@Entry
@Component
struct NetPage {
  @StorageLink(STORAGE_DARK) isDark: boolean = false;
  @StorageLink(STORAGE_PALETTE) paletteName: string = 'warm';

  @State result: CampusNetResult | null = null;
  @State trend: TrafficTrend = emptyTrafficTrend();
  @State busy: boolean = false;
  @State loaded: boolean = false;

  private tk(): GridTokens {
    return gridTokens(this.isDark, getPalette(this.paletteName));
  }

  /** 三态码：'none' | 'online' | 'notOnline' | 'failed'（UI 树里不能声明局部变量）。 */
  private stateKind(): string {
    const r: CampusNetResult | null = this.result;
    return r === null ? 'none' : r.kind;
  }

  /** 在线信息（只有 online 才有）。 */
  private infoOrNull(): CampusNetInfo | null {
    const r: CampusNetResult | null = this.result;
    if (r === null || r.kind !== 'online') return null;
    return r.info;
  }

  /** failed 原因。 */
  private failReason(): string {
    const r: CampusNetResult | null = this.result;
    return r !== null && r.kind === 'failed' ? r.reason : '';
  }

  /** 本月流量完整表述（含限速阈值）。 */
  private usedLine(): string {
    const i: CampusNetInfo | null = this.infoOrNull();
    return i !== null ? trafficStatusText(i.bytesTotal) : '';
  }

  /** 在线时长。 */
  private durationLine(): string {
    const i: CampusNetInfo | null = this.infoOrNull();
    return i !== null ? formatDuration(i.durationSeconds) : '';
  }

  /** 本次上线时间。 */
  private loginLine(): string {
    const i: CampusNetInfo | null = this.infoOrNull();
    return i !== null ? formatTime(i.loginEpochSeconds) : '';
  }

  /** 账户余额。 */
  private balanceLine(): string {
    const i: CampusNetInfo | null = this.infoOrNull();
    return i !== null ? '¥' + i.balanceYuan.toFixed(2) : '';
  }

  /** 本机在校园网内的 IP。 */
  private ipLine(): string {
    const i: CampusNetInfo | null = this.infoOrNull();
    return i !== null ? i.ip : '';
  }

  /** 今日用量（算不出来显示 —，不显示 0）。 */
  private todayLine(): string {
    const text: string | null = todayText(this.trend);
    return text !== null ? text : '—';
  }

  /** 日均 + 月末预测（算不出来说「数据积累中」）。 */
  private forecastLine(): string {
    const text: string | null = forecastText(this.trend, LIMIT_BYTES);
    return text !== null ? text : '数据积累中（跨天采样后显示日均与月末预测）';
  }

  private async refresh(): Promise<void> {
    if (this.busy) {
      return;
    }
    this.busy = true;
    try {
      const ctx: Context = getContext(this) as Context;
      const r: CampusNetResult = await CampusNetService.fetchOnlineInfo(ctx);
      this.result = r;
      // 只有「在线」才记采样：NotOnline/Failed 时没有累计用量，
      // 用空值记会把趋势污染（Android 同款纪律）
      const bytes: number | null = r.kind === 'online' ? r.info.bytesTotal : null;
      this.trend = await CampusNetTrafficStore.record(bytes);
      this.loaded = true;
      info('net page refresh kind=' + r.kind);
    } catch (e) {
      warn('net page refresh fail: ' + (e as Error).message);
      this.result = { kind: 'failed', reason: (e as Error).message };
      this.loaded = true;
    }
    this.busy = false;
  }

  aboutToAppear(): void {
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
        Text('校园网').fontSize(16).fontWeight(FontWeight.Bold).layoutWeight(1)
          .textAlign(TextAlign.Center)
        Button('刷新').fontSize(13)
          .enabled(!this.busy)
          .onClick(() => {
            this.refresh();
          })
      }.width('100%').padding(12)

      Scroll() {
        Column() {
          if (this.busy && !this.loaded) {
            Text('正在查校园网…')
              .fontSize(12).fontColor(this.tk().onSurfaceVariant).width('100%').padding(16)
          } else if (this.stateKind() === 'online') {
            // ── 本月流量（官方口径：按计费周期累计） ──
            Text('本月流量')
              .fontSize(12).fontColor(this.tk().onSurfaceVariant).width('100%')
              .padding({ left: 16, right: 16, top: 8 })
            Text(this.usedLine())
              .fontSize(24).fontWeight(FontWeight.Bold).fontColor(this.tk().onSurface)
              .width('100%').padding({ left: 16, right: 16, top: 2 })
            Text(this.forecastLine())
              .fontSize(12).fontColor(this.tk().onSurfaceVariant)
              .width('100%').padding({ left: 16, right: 16, top: 4 })

            // ── 明细行 ──
            Column() {
              Row() {
                Text('今日用量').fontSize(13).fontColor(this.tk().onSurfaceVariant).layoutWeight(1)
                Text(this.todayLine()).fontSize(13).fontColor(this.tk().onSurface)
              }.width('100%').padding({ top: 10 })

              Row() {
                Text('在线时长').fontSize(13).fontColor(this.tk().onSurfaceVariant).layoutWeight(1)
                Text(this.durationLine())
                  .fontSize(13).fontColor(this.tk().onSurface)
              }.width('100%').padding({ top: 10 })

              Row() {
                Text('本次上线').fontSize(13).fontColor(this.tk().onSurfaceVariant).layoutWeight(1)
                Text(this.loginLine())
                  .fontSize(13).fontColor(this.tk().onSurface)
              }.width('100%').padding({ top: 10 })

              Row() {
                Text('账户余额').fontSize(13).fontColor(this.tk().onSurfaceVariant).layoutWeight(1)
                Text(this.balanceLine())
                  .fontSize(13).fontColor(this.tk().onSurface)
              }.width('100%').padding({ top: 10 })

              Row() {
                Text('IP').fontSize(13).fontColor(this.tk().onSurfaceVariant).layoutWeight(1)
                Text(this.ipLine())
                  .fontSize(13).fontColor(this.tk().onSurface)
              }.width('100%').padding({ top: 10 })
            }
            .width('100%').padding(12).margin({ top: 12 })
            .backgroundColor(this.tk().surface).borderRadius(10)

            Text('数据来自 10.0.0.55 内网接口；只在校园网内可查。限速阈值 300 GB。')
              .fontSize(11).fontColor(this.tk().onSurfaceVariant)
              .width('100%').padding({ left: 4, right: 4, top: 10 })
          } else if (this.stateKind() === 'notOnline') {
            // 接口通了但没有在线会话：可处置
            Text('接口通了，但本机当前没有校园网在线会话。')
              .fontSize(13).fontColor(this.tk().onSurface).width('100%').padding(16)
            Text('多半是还没在校园网认证页登录过。登录后回到本页刷新即可。')
              .fontSize(12).fontColor(this.tk().onSurfaceVariant).width('100%').padding({ left: 16, right: 16 })
            Button('去认证页登录')
              .fontSize(13).margin({ top: 12 })
              .backgroundColor(this.tk().primary).fontColor(this.tk().onPrimary)
              .onClick(() => {
                router.pushUrl({ url: 'pages/WebShellPage', params: { url: NET_AUTH_URL } })
                  .catch((e: Error) => {
                    warn('net -> auth page fail: ' + JSON.stringify(e));
                  });
              })
          } else if (this.stateKind() === 'failed') {
            // 连不上：多半不在校园网内 —— 别显示成「未登录」
            Text('⚠️ 连不上校园网接口（' + this.failReason() + '）')
              .fontSize(13).fontColor(this.tk().error).width('100%').padding(16)
            Text('该接口只在校园网内可访问。请确认已连上校园 Wi-Fi（或校园网 VPN）后重试。')
              .fontSize(12).fontColor(this.tk().onSurfaceVariant).width('100%').padding({ left: 16, right: 16 })
            Button('重试').fontSize(13).margin({ top: 12 })
              .onClick(() => {
                this.refresh();
              })
          } else {
            Text('还没有数据，点右上角刷新。')
              .fontSize(12).fontColor(this.tk().onSurfaceVariant).width('100%').padding(16)
          }
        }
        .width('100%').padding({ left: 12, right: 12 })
      }
      .layoutWeight(1)
      // ⚠️ 顶对齐必须挂 Scroll 自身：加在内层 Column 上不生效（内容不足一屏会被垂直居中）
      .align(Alignment.Top)
    }
    .width('100%').height('100%')
    .backgroundColor(this.tk().background)
  }
}
