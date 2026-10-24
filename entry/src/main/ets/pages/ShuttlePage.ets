/**
 * 校园班车时刻（#86 UI 迁移 · 对齐原版 TransportScreen.kt）
 *
 * 基准：`harmony/ui-ref/MIGRATION-BASELINE.md` §7（ref-08-transport.png 平板实拍逐值核对）。
 * 逻辑全在 `corelogic/ShuttleLogic.ts`（1:1 移植，时刻表逐条抄自站牌实拍），本页只展示。
 *
 * 与原版的差异（如实记录）：
 * - 原版是「课表」区内的顶部 tab，无页头；鸿蒙侧是 Index push 的子页，
 *   故保留‹ 返回顶栏（与 DdlPage 等同级页面一致的 chrome）。
 * - 原版 displaySmall 用 SemiBold(600)，本 SDK 无 FontWeight.SemiBold ⇒ 用 Bold(700)，
 *   36sp 下视觉无差（编译门可证）。
 * - 筛选 chip 未复用 GridChip：GridChip 选中态是 primaryContainer + ✓ 勾选图标（GRID 自家语义），
 *   而原版 M3 FilterChip 选中态是 secondaryContainer 薄荷底、无勾选 —— 实测截图如此，按原版做。
 *
 * ⚠️ 日类型只按星期推（法定节假日/调休/寒暑假判断不了），必须给手动切换 ——
 * 站牌原文：「长假期发车时间可能调整，请关注 i北理」。硬按星期判会让用户在假期白等一班车。
 */

import { router } from '@kit.ArkUI';
import { gridTokens } from '../core/theme/GridTokens.ts';
import type { GridTokens } from '../core/theme/GridTokens.ts';
import { withAlpha } from '../core/theme/colorUtil.ts';
import { STORAGE_DARK, STORAGE_PALETTE, getPalette } from '../data/ThemeStore.ts';
import type { HourGroup } from '../corelogic/ShuttleLogic.ts';
import {
  Stop, DayType,
  stopLabel, dayTypeLabel, dayTypeOf, timetable, nextDeparture, countdownText, fmtDeparture,
  groupByHour, minuteText
} from '../corelogic/ShuttleLogic.ts';

/**
 * M3 FilterChip 语义的筛选 chip（原版 TransportScreen.kt:88-111）。
 *
 * 实测（ref-08 平板截图，中位色法）：
 * - 选中：secondaryContainer #D5E9DF 底 + onSecondaryContainer #0F4A38 字，无描边
 * - 未选中：透明底（露出页面 background #FBF8F4）+ 1dp outline #9C8F82 描边 + onSurfaceVariant #5F564E 字
 * - 高 32dp、圆角 8dp、左右内边距 16dp、标签 14sp（M3 labelLarge）
 */
@Component
struct ShuttleChip {
  @StorageLink(STORAGE_DARK) private isDark: boolean = false;
  @StorageLink(STORAGE_PALETTE) paletteName: string = 'warm';

  label: string = '';
  selected: boolean = false;
  marginLeft: number = 0;
  onTap: () => void = () => {};

  private p(): GridTokens {
    return gridTokens(this.isDark, getPalette(this.paletteName));
  }

  build() {
    Row() {
      Text(this.label)
        .fontSize(14)
        .fontColor(this.selected ? this.p().onSecondaryContainer : this.p().onSurfaceVariant)
        .maxLines(1)
    }
    .height(32)
    .borderRadius(8)
    .padding({ left: 16, right: 16 })
    .backgroundColor(this.selected ? this.p().secondaryContainer : this.p().background)
    .border(this.selected
      ? { width: 0, color: '#00000000' }
      : { width: 1, color: this.p().outline })
    .margin({ left: this.marginLeft })
    .stateStyles({
      pressed: {
        .scale({ x: 0.98, y: 0.98 })
      }
    })
    .animation({ duration: 80, curve: Curve.EaseOut })
    .onClick(() => {
      this.onTap();
    })
  }
}

@Entry
@Component
struct ShuttlePage {
  /** 订阅全局深浅色（由设置页切换、AppStorage 广播）。 */
  @StorageLink(STORAGE_DARK) isDark: boolean = false;
  @StorageLink(STORAGE_PALETTE) paletteName: string = 'warm';

  @State stop: string = Stop.LIBRARY;
  /** 自动按星期推出来的日类型（未手动覆盖时用）。 */
  @State autoDayType: string = DayType.WORKDAY;
  /** 手动覆盖（空 = 用自动值；对齐原版 override == null）。 */
  @State manualDayType: string = '';
  /** 「现在」的快照：分钟数。倒计时、已发车淡色、还剩班次都基于同一份（同口径，不各算各的）。 */
  @State nowMinutes: number = 0;
  /** 下一班；-1 = 今天已发完。 */
  @State nextAt: number = -1;
  @State nextIn: number = 0;
  @State nextRemaining: number = 0;
  @State nextSeq: number = 0;
  @State totalCount: number = 0;
  @State hourGroups: HourGroup[] = [];

  private timer: number = -1;

  aboutToAppear(): void {
    this.refresh();
    // 原版 LaunchedEffect(active)：页面在场时每 20s 刷一次「现在」
    // （比整分钟细一点，切页回来也不会停太久）
    this.timer = setInterval(() => {
      this.refresh();
    }, 20000);
  }

  aboutToDisappear(): void {
    if (this.timer >= 0) {
      clearInterval(this.timer);
      this.timer = -1;
    }
  }

  /** 当前生效的日类型（手动优先）。 */
  private effectiveDayType(): DayType {
    return this.manualDayType.length > 0
      ? (this.manualDayType === DayType.WORKDAY ? DayType.WORKDAY : DayType.WEEKEND_HOLIDAY)
      : (this.autoDayType === DayType.WORKDAY ? DayType.WORKDAY : DayType.WEEKEND_HOLIDAY);
  }

  private refresh(): void {
    const d: Date = new Date();
    const todayEpoch: number =
      Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
    this.autoDayType = dayTypeOf(todayEpoch);
    const now: number = d.getHours() * 60 + d.getMinutes();
    this.nowMinutes = now;

    const st: Stop = this.stop === Stop.METRO ? Stop.METRO : Stop.LIBRARY;
    const dt: DayType = this.effectiveDayType();
    const list: number[] = timetable(st, dt);
    this.totalCount = list.length;

    const nx = nextDeparture(st, dt, now);
    if (nx === null) {
      this.nextAt = -1;
      this.nextIn = 0;
      this.nextRemaining = 0;
      this.nextSeq = 0;
    } else {
      this.nextAt = nx.at;
      this.nextIn = nx.inMinutes;
      this.nextRemaining = nx.remaining;
      this.nextSeq = nx.sequence;
    }

    // 按小时分组（提纯在 ShuttleLogic.groupByHour，有单测：同小时合并 + 组间升序）
    this.hourGroups = groupByHour(list);
  }

  private switchStop(s: string): void {
    this.stop = s;
    this.refresh();
  }

  /** 手动覆盖日类型；传 DayType.WORKDAY/WEEKEND_HOLIDAY 之外的即视为取消覆盖（回自动）。 */
  private switchDayType(dt: string): void {
    this.manualDayType = dt;
    this.refresh();
  }

  /**
   * 「自动 · 工作日」chip 的标签。
   * ⚠️ 口径：跟着**自动判定值**（autoDayType）走，不跟手动覆盖走 ——
   * 原版 `"自动 · ${autoDayType.label}"` 用的就是 autoDayType：用户手动切到周末时，
   * 这个 chip 仍显示「自动 · 工作日」，提示「不覆盖的话本来是工作日」。
   */
  private autoChipLabel(): string {
    return '自动 · ' + dayTypeLabel(this.autoDayType === DayType.WORKDAY
      ? DayType.WORKDAY : DayType.WEEKEND_HOLIDAY);
  }

  /**
   * 已发车的分钟用浅色（原版 onSurfaceVariant @ 0.45 alpha），未发车用正文色。
   * 判定与「下一班」同用 this.nowMinutes 一份快照 —— 不会出现「卡说还有 2 班、分钟行全灰」的分裂。
   */
  private minuteColor(t: number): string {
    const tk: GridTokens = this.p();
    return t < this.nowMinutes ? withAlpha(tk.onSurfaceVariant, 0.45) : tk.onSurface;
  }

  /** 当前配色（语义色见 core/theme/GridTokens.ts）。 */
  private p(): GridTokens {
    return gridTokens(this.isDark, getPalette(this.paletteName));
  }

  /** 小节标题（原版 SectionLabel：labelMedium + onSurfaceVariant + 下距 6dp）。 */
  @Builder
  sectionLabel(text: string, topMargin: number) {
    Column() {
      Text(text)
        .fontSize(12)
        .fontColor(this.p().onSurfaceVariant)
        .fontWeight(FontWeight.Medium)
        .width('100%')
        .textAlign(TextAlign.Start)
        .padding({ bottom: 6 })
    }
    .width('100%')
    .margin({ top: topMargin })
  }

  build() {
    Column() {
      // ── 顶栏（push 子页必需；原版是 tab 无页头，见文件头说明） ──
      Row() {
        Button('‹ 返回')
          .height(32).fontSize(12)
          .backgroundColor(Color.Transparent)
          .fontColor(this.p().primary)
          .onClick(() => {
            router.back();
          })
        Text('校园班车')
          .fontSize(16).fontWeight(FontWeight.Bold).fontColor(this.p().onSurface)
          .layoutWeight(1).margin({ left: 10 })
          .textAlign(TextAlign.Start)
      }
      .width('100%').padding({ left: 12, right: 12, top: 10, bottom: 6 })

      Scroll() {
        Column() {
          // ── 发车站点 ──
          this.sectionLabel('发车站点', 0)
          Row() {
            ShuttleChip({
              label: stopLabel(Stop.LIBRARY),
              selected: this.stop === Stop.LIBRARY,
              marginLeft: 0,
              onTap: () => {
                this.switchStop(Stop.LIBRARY);
              }
            })
            ShuttleChip({
              label: stopLabel(Stop.METRO),
              selected: this.stop === Stop.METRO,
              marginLeft: 8,
              onTap: () => {
                this.switchStop(Stop.METRO);
              }
            })
          }
          .width('100%')
          .alignItems(VerticalAlign.Top)

          // ── 时刻表版本（站牌上就是两套） ──
          this.sectionLabel('时刻表版本（站牌上就是两套）', 10)
          Row() {
            ShuttleChip({
              label: this.autoChipLabel(),
              selected: this.manualDayType.length === 0,
              marginLeft: 0,
              onTap: () => {
                this.switchDayType('');
              }
            })
            ShuttleChip({
              label: dayTypeLabel(DayType.WORKDAY),
              selected: this.manualDayType === DayType.WORKDAY,
              marginLeft: 8,
              onTap: () => {
                this.switchDayType(DayType.WORKDAY);
              }
            })
            ShuttleChip({
              label: dayTypeLabel(DayType.WEEKEND_HOLIDAY),
              selected: this.manualDayType === DayType.WEEKEND_HOLIDAY,
              marginLeft: 8,
              onTap: () => {
                this.switchDayType(DayType.WEEKEND_HOLIDAY);
              }
            })
          }
          .width('100%')
          .alignItems(VerticalAlign.Top)

          // ── 下一班（primaryContainer 大卡；今天已发完时给明确结论，不留空让人猜） ──
          Column() {
            if (this.nextAt < 0) {
              Text('今天的车已发完')
                .fontSize(16).fontWeight(FontWeight.Medium)
                .fontColor(this.p().onPrimaryContainer)
                .width('100%')
              Text('末班 ' + (this.stop === Stop.METRO ? '22:40' : '22:30') + ' 已过，明天见')
                .fontSize(12)
                .fontColor(this.p().onPrimaryContainer)
                .width('100%').margin({ top: 4 })
            } else {
              Text('下一班')
                .fontSize(12)
                .fontColor(this.p().onPrimaryContainer)
                .width('100%')
              Row() {
                Text(fmtDeparture(this.nextAt))
                  .fontSize(36).fontWeight(FontWeight.Bold)
                  .fontColor(this.p().onPrimaryContainer)
                Text(countdownText(this.nextIn))
                  .fontSize(16)
                  .fontColor(this.p().onPrimaryContainer)
                  .margin({ left: 10, bottom: 6 })
              }
              .width('100%')
              .margin({ top: 2 })
              .alignItems(VerticalAlign.Bottom)
              Text('今天还剩 ' + this.nextRemaining + ' 班 · 这是第 ' + this.nextSeq + ' 班')
                .fontSize(12)
                .fontColor(this.p().onPrimaryContainer)
                .width('100%').margin({ top: 4 })
            }
          }
          .width('100%')
          .padding(16)
          .margin({ top: 12 })
          .backgroundColor(this.p().primaryContainer)
          .borderRadius(12)
          .alignItems(HorizontalAlign.Start)

          // ── 今日班次（按小时分组 —— 跟站牌上的排法一致，比竖着列 39 行好扫） ──
          this.sectionLabel('今日班次（' + dayTypeLabel(this.effectiveDayType()) +
            ' · 共 ' + this.totalCount + ' 班）', 14)
          ForEach(this.hourGroups, (g: HourGroup) => {
            Row() {
              Text(g.hour + ' 时')
                .fontSize(14)
                .fontWeight(FontWeight.Medium)
                .fontColor(this.p().onSurfaceVariant)
                .width(48)
              ForEach(g.minutes, (t: number, idx: number) => {
                Text(minuteText(t))
                  .fontSize(16)
                  .fontColor(this.minuteColor(t))
                  .margin({ left: idx === 0 ? 0 : 12 })
              }, (t: number) => 'm_' + t)
            }
            .width('100%')
            .padding({ top: 3, bottom: 3 })
            .alignItems(VerticalAlign.Top)
          }, (g: HourGroup) => 'h_' + g.hour)

          // ── 数据来源与免责（站牌原文口径） ──
          Text('数据来源：站点站牌（2026-09-27 抄录）。工作日 39 班 / 周末及节假日 50 班。\n' +
            '⚠️ 法定节假日与调休 App 判断不了，请手动切上面的版本；寒暑假发车时间可能调整，以 i北理 为准。\n' +
            '东校区南门可以中途上车，但那里没有固定发车时间，在门口等即可。\n' +
            '摆渡车刷校园卡免费，不需要预约。')
            .fontSize(12)
            .fontColor(this.p().onSurfaceVariant)
            .width('100%')
            .margin({ top: 16 })
            .textAlign(TextAlign.Start)
        }
        .width('100%')
        .padding({ left: 12, right: 12, top: 8, bottom: 24 })
      }
      .layoutWeight(1)
      .width('100%')
      .scrollBar(BarState.Auto)
    }
    .width('100%').height('100%')
    .backgroundColor(this.p().background)
  }
}
