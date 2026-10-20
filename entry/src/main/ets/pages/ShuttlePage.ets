/**
 * 校园班车时刻（M5-4）
 *
 * 数据全在 `corelogic/ShuttleLogic.ts`（1:1 移植，逐条抄自站牌实拍），本页只负责展示。
 *
 * ⚠️ 日类型**只按星期推**（周六周日 = 周末表），法定节假日/调休/寒暑假判断不了，
 * 所以必须给手动切换 —— 站牌原文就写着「长假期发车时间可能调整，请关注 i北理」。
 * 硬按星期判会让用户在假期白等一班车。
 */

import { router } from '@kit.ArkUI';
import {
  Stop, DayType, Departure,
  stopLabel, dayTypeLabel, dayTypeOf, timetable, nextDeparture, countdownText, fmtDeparture
} from '../corelogic/ShuttleLogic.ts';
import { dayOfWeekMon1 } from '../corelogic/timeutil.ts';

const DAY_LABELS: string[] = ['一', '二', '三', '四', '五', '六', '日'];

@Entry
@Component
struct ShuttlePage {
  @State stop: string = Stop.LIBRARY;
  /** 自动按星期推出来的日类型（未手动覆盖时用）。 */
  @State autoDayType: string = DayType.WORKDAY;
  /** 手动覆盖（空 = 用自动值）。 */
  @State manualDayType: string = '';
  @State nextText: string = '';
  @State nextCountdown: string = '';
  @State remaining: number[] = [];
  @State nowText: string = '';
  @State todayLabel: string = '';

  aboutToAppear(): void {
    this.refresh();
  }

  /** 当前生效的日类型（手动优先）。 */
  private effectiveDayType(): string {
    return this.manualDayType.length > 0 ? this.manualDayType : this.autoDayType;
  }

  private refresh(): void {
    const d: Date = new Date();
    const todayEpoch: number =
      Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
    this.autoDayType = dayTypeOf(todayEpoch);
    this.todayLabel = '周' + DAY_LABELS[dayOfWeekMon1(todayEpoch) - 1];
    const now: number = d.getHours() * 60 + d.getMinutes();
    this.nowText = fmtDeparture(now);

    const st: string = this.stop;
    const dt: string = this.effectiveDayType();
    const list: number[] = timetable(st === Stop.METRO ? Stop.METRO : Stop.LIBRARY,
      dt === DayType.WORKDAY ? DayType.WORKDAY : DayType.WEEKEND_HOLIDAY);
    const nx: Departure | null = nextDeparture(
      st === Stop.METRO ? Stop.METRO : Stop.LIBRARY,
      dt === DayType.WORKDAY ? DayType.WORKDAY : DayType.WEEKEND_HOLIDAY, now);
    if (nx === null) {
      this.nextText = '今天已发完';
      this.nextCountdown = '末班已过';
      this.remaining = [];
    } else {
      this.nextText = fmtDeparture(nx.at);
      this.nextCountdown = countdownText(nx.inMinutes) + ' · 今天还剩 ' + nx.remaining + ' 班';
      this.remaining = list.filter((t: number) => t >= now);
    }
  }

  private switchStop(s: string): void {
    this.stop = s;
    this.refresh();
  }

  private switchDayType(dt: string): void {
    this.manualDayType = dt;
    this.refresh();
  }

  build() {
    Column() {
      Row() {
        Button('返回').height(32).fontSize(12).onClick(() => {
          router.back();
        })
        Column() {
          Text('校园班车').fontSize(16).fontWeight(FontWeight.Bold)
          Text('现在 ' + this.nowText + ' · ' + this.todayLabel +
            ' · ' + dayTypeLabel(this.effectiveDayType() === DayType.WORKDAY
              ? DayType.WORKDAY : DayType.WEEKEND_HOLIDAY))
            .fontSize(11).fontColor('#888888')
        }
        .alignItems(HorizontalAlign.Start)
        .layoutWeight(1)
        .margin({ left: 10 })
        Button('刷新').height(32).fontSize(12).onClick(() => {
          this.refresh();
        })
      }
      .width('100%').padding({ left: 12, right: 12, top: 10, bottom: 6 })

      // 站点切换
      Row() {
        Button('图书馆 → 地铁站')
          .height(34).fontSize(12)
          .layoutWeight(1)
          .backgroundColor(this.stop === Stop.LIBRARY ? '#4A6FD4' : '#E8EAF0')
          .fontColor(this.stop === Stop.LIBRARY ? '#FFFFFF' : '#555555')
          .onClick(() => {
            this.switchStop(Stop.LIBRARY);
          })
        Button('地铁站 → 图书馆')
          .height(34).fontSize(12)
          .layoutWeight(1)
          .margin({ left: 8 })
          .backgroundColor(this.stop === Stop.METRO ? '#4A6FD4' : '#E8EAF0')
          .fontColor(this.stop === Stop.METRO ? '#FFFFFF' : '#555555')
          .onClick(() => {
            this.switchStop(Stop.METRO);
          })
      }
      .width('100%').padding({ left: 12, right: 12, bottom: 6 })

      Text('从「' + stopLabel(this.stop === Stop.METRO ? Stop.METRO : Stop.LIBRARY) + '」发车')
        .fontSize(11).fontColor('#888888')
        .width('100%').padding({ left: 12, right: 12, bottom: 6 })

      // 日类型（手动覆盖）
      Row() {
        Button('工作日')
          .height(28).fontSize(11)
          .backgroundColor(this.effectiveDayType() === DayType.WORKDAY ? '#1A7F37' : '#E8EAF0')
          .fontColor(this.effectiveDayType() === DayType.WORKDAY ? '#FFFFFF' : '#555555')
          .onClick(() => {
            this.switchDayType(DayType.WORKDAY);
          })
        Button('周末及节假日')
          .height(28).fontSize(11)
          .margin({ left: 8 })
          .backgroundColor(this.effectiveDayType() === DayType.WEEKEND_HOLIDAY ? '#1A7F37' : '#E8EAF0')
          .fontColor(this.effectiveDayType() === DayType.WEEKEND_HOLIDAY ? '#FFFFFF' : '#555555')
          .onClick(() => {
            this.switchDayType(DayType.WEEKEND_HOLIDAY);
          })
        if (this.manualDayType.length > 0) {
          Text('（手动）').fontSize(10).fontColor('#C77700').margin({ left: 6 })
          Button('按星期')
            .height(26).fontSize(10)
            .margin({ left: 6 })
            .backgroundColor('#F0F0F3').fontColor('#666666')
            .onClick(() => {
              this.manualDayType = '';
              this.refresh();
            })
        }
      }
      .width('100%').padding({ left: 12, right: 12, bottom: 8 })

      // 下一班
      Column() {
        Text('下一班').fontSize(11).fontColor('#888888').width('100%')
        Text(this.nextText)
          .fontSize(30).fontWeight(FontWeight.Bold).fontColor('#4A6FD4')
          .width('100%').margin({ top: 2 })
        Text(this.nextCountdown)
          .fontSize(12).fontColor('#555555').width('100%').margin({ top: 4 })
      }
      .width('100%')
      .padding(14)
      .margin({ left: 12, right: 12, top: 4 })
      .backgroundColor('#FFFFFF')
      .borderRadius(10)
      .alignItems(HorizontalAlign.Start)

      Text('今天剩余班次（共 ' + this.remaining.length + ' 班）')
        .fontSize(11).fontColor('#888888')
        .width('100%').padding({ left: 12, right: 12, top: 12, bottom: 6 })

      if (this.remaining.length === 0) {
        Text('今天已经发完了')
          .fontSize(13).fontColor('#888888').width('100%').padding(12)
      } else {
        List() {
          ForEach(this.remaining, (t: number) => {
            ListItem() {
              Row() {
                Text(fmtDeparture(t))
                  .fontSize(14).fontWeight(FontWeight.Medium)
                Text(t === this.remaining[0] ? '下一班' : '')
                  .fontSize(10).fontColor('#FFFFFF')
                  .backgroundColor('#4A6FD4')
                  .padding({ left: 6, right: 6, top: 1, bottom: 1 })
                  .borderRadius(4)
                  .margin({ left: 8 })
                Blank()
                Text(this.remaining.indexOf(t) + 1 + ' / ' + this.remaining.length)
                  .fontSize(10).fontColor('#AAAAAA')
              }
              .width('100%')
              .padding({ left: 12, right: 12, top: 10, bottom: 10 })
              .backgroundColor('#FFFFFF')
            }
            .margin({ bottom: 1 })
          }, (t: number) => 's_' + t)
        }
        .layoutWeight(1)
        .width('100%')
        .padding({ left: 12, right: 12 })
        .scrollBar(BarState.Auto)
      }

      Text('时刻表抄自站牌；长假期间可能调整，以 i北理 通知为准')
        .fontSize(10).fontColor('#AAAAAA')
        .width('100%').padding({ left: 12, right: 12, top: 6, bottom: 8 })
    }
    .width('100%').height('100%')
    .backgroundColor('#F5F6F8')
  }
}
