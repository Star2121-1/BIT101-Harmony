/**
 * 座位 wire 探针触发页（M9-3 底图 / M9-7 研讨间 / authed 回归）。可整删。
 * - 只读端点：tree / date / subscribe / reneges / seminar / map。
 * - 绝不触发 confirm / cancel（铁律 0.6：有对外副作用的动作只能用户显式点）。
 * - 原始响应落沙箱 `seatprobe-<name>.txt`，hdc file recv 拉回 evidence/。
 */
import { Context } from '@kit.AbilityKit';
import { SeatProbe, SeatProbeItem } from '../probe/SeatProbe.ts';
import { hilog } from '@kit.PerformanceAnalysisKit';

const DOMAIN: number = 0x00CE;
const TAG: string = 'BIT101SeatProbe';

@Entry
@Component
struct SeatProbePage {
  @State status: string = '尚未运行';
  @State items: SeatProbeItem[] = [];

  private async runProbe(): Promise<void> {
    this.status = '探针运行中（只读端点，约 10 秒）…';
    this.items = [];
    try {
      const ctx: Context = getContext(this) as Context;
      const out: SeatProbeItem[] = await new SeatProbe().run(ctx);
      this.items = out;
      let okCount: number = 0;
      for (let i = 0; i < out.length; i++) {
        if (out[i].ok) okCount++;
      }
      this.status = '探针完成：' + okCount + '/' + out.length + ' 个端点 bizCode=1';
      hilog.info(DOMAIN, TAG, 'probe done ok=%{public}d/%{public}d', okCount, out.length);
    } catch (e) {
      this.status = '❌ 探针异常（已停手，不重试）';
      hilog.error(DOMAIN, TAG, 'probe fatal: %{public}s', JSON.stringify(e));
    }
  }

  build() {
    Column() {
      Row() {
        Text('座位 wire 探针')
          .fontSize(16).fontWeight(FontWeight.Bold).layoutWeight(1)
        Button('跑座位探针')
          .onClick(() => {
            this.runProbe();
          })
          .margin({ left: 4 })
      }.width('100%').padding(12)

      Text('红线：只读端点（tree/date/subscribe/reneges/seminar/map/seat-anon），' +
        '绝不触发预约/取消。未登录时 authed 端点预期 bizCode=10001，这本身也是结论。')
        .fontSize(12).fontColor('#666666')
        .padding({ left: 12, right: 12, bottom: 4 })

      Text(this.status).fontSize(13)
        .padding({ left: 12, right: 12, bottom: 4 })

      Scroll() {
        Column() {
          ForEach(this.items, (item: SeatProbeItem) => {
            Column() {
              Text(item.name + ' · HTTP ' + item.httpStatus +
                ' · code ' + item.bizCode + ' · ' + (item.ok ? '✅' : '❌'))
                .fontSize(13).fontWeight(FontWeight.Medium)
              Text(item.note)
                .fontSize(11).fontColor('#888888')
            }.align(Alignment.Start)
              .width('100%').padding({ left: 12, right: 12, top: 6, bottom: 6 })
          }, (item: SeatProbeItem) => item.name)
        }.align(Alignment.Top).width('100%')
      }.align(Alignment.Top).layoutWeight(1)

      Text('raw 全文：files 目录 seatprobe-<name>.txt（hdc file recv 拉回 evidence/）')
        .fontSize(11).fontColor('#999999')
        .padding({ left: 12, right: 12, bottom: 12 })
    }
    .width('100%').height('100%')
  }
}
