/**
 * 教学调整列表页（P3）：把「哪天放假、哪天补周几的课」一次说清。
 *
 * 数据源 `TeachingAdjustmentService`（免登录、独立 12h 缓存）。
 * 展示逻辑全在 `TeachingAdjustmentView`（未来升序 / 过去降序 / 补课点明周几 / 脏数据丢弃）。
 *
 * 为什么值得单独一页：课表顶部只放**今天**一条角标（顶栏不能变公告栏），
 * 而「下周三补周一的课」这种事用户需要提前知道 —— 那必须有一处能看到全量。
 */

import { router } from '@kit.ArkUI';
import { gridTokens } from '../core/theme/GridTokens.ts';
import type { GridTokens } from '../core/theme/GridTokens.ts';
import { STORAGE_DARK, STORAGE_PALETTE, getPalette } from '../data/ThemeStore.ts';
import { TeachingAdjustmentService } from '../service/TeachingAdjustmentService.ts';
import { upcoming, past } from '../corelogic/TeachingAdjustmentView.ts';
import type { AdjustmentItem } from '../corelogic/TeachingAdjustmentView.ts';
import type { AdjustmentEntry } from '../corelogic/TeachingAdjustment.ts';
import { info, warn } from '../core/log/BitLog.ts';

@Entry
@Component
export struct TeachingAdjustmentPage {
  @StorageLink(STORAGE_DARK) isDark: boolean = false;
  @StorageLink(STORAGE_PALETTE) paletteName: string = 'warm';

  @State future: AdjustmentItem[] = [];
  @State history: AdjustmentItem[] = [];
  @State status: string = '正在读取…';
  @State busy: boolean = true;

  private tk(): GridTokens {
    return gridTokens(this.isDark, getPalette(this.paletteName));
  }

  aboutToAppear(): void {
    this.load(false);
  }

  private async load(force: boolean): Promise<void> {
    this.busy = true;
    try {
      const ta = await TeachingAdjustmentService.load(getContext(this), force);
      const entries: AdjustmentEntry[] = ta.entries;
      const d: Date = new Date();
      const today: number = Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
      this.future = upcoming(entries, today, 0);
      this.history = past(entries, today, 30);
      if (entries.length === 0) {
        this.status = '教务没有返回教学调整（可能本学期的还没发布）';
      } else {
        this.status = (ta.fromCache ? '来自缓存' : '刚更新') +
          ' · 共 ' + String(entries.length) + ' 条 · 未来 ' + String(this.future.length) + ' 条';
      }
      info('TeachingAdjustmentPage entries=' + entries.length + ' future=' + this.future.length);
    } catch (e) {
      this.status = '读取失败（网络或教务不可用）';
      warn('TeachingAdjustmentPage fail: ' + JSON.stringify(e));
    }
    this.busy = false;
  }

  @Builder
  sectionTitle(text: string) {
    Text(text)
      .fontSize(12).fontWeight(FontWeight.Medium).fontColor(this.tk().primary)
      .width('100%').padding({ top: 16, bottom: 6 })
  }

  @Builder
  itemCard(item: AdjustmentItem) {
    Row() {
      Column() {
        Text(item.dateLabel)
          .fontSize(13).fontColor(this.tk().onSurface)
        Text(item.title)
          .fontSize(12)
          .fontColor(item.isMakeUp ? this.tk().error : this.tk().onSurfaceVariant)
          .margin({ top: 2 })
      }
      .layoutWeight(1).alignItems(HorizontalAlign.Start)
      Text(item.isMakeUp ? '补课' : '放假')
        .fontSize(10)
        .fontColor(item.isMakeUp ? this.tk().onError : this.tk().onSecondaryContainer)
        .backgroundColor(item.isMakeUp ? this.tk().error : this.tk().secondaryContainer)
        .borderRadius(4).padding({ left: 6, right: 6, top: 2, bottom: 2 })
    }
    .width('100%')
    .padding(12)
    .margin({ bottom: 8 })
    .backgroundColor(this.tk().surface)
    .borderRadius(10)
    .accessibilityText(item.dateLabel + '，' + item.title)
  }

  build() {
    Column() {
      Row() {
        Text('‹')
          .fontSize(28).fontColor(this.tk().onSurface).width(40)
          .textAlign(TextAlign.Center)
          .accessibilityText('返回')
          .onClick(() => router.back())
        Text('教学安排调整')
          .fontSize(17).fontWeight(FontWeight.Bold).fontColor(this.tk().onSurface)
          .layoutWeight(1)
        Text('刷新')
          .fontSize(13).fontColor(this.tk().primary)
          .padding({ left: 10, right: 14 })
          .accessibilityText('刷新教学调整')
          .onClick(() => {
            if (!this.busy) {
              this.load(true);
            }
          })
      }
      .width('100%').height(52)

      Text(this.status)
        .fontSize(11).fontColor(this.tk().onSurfaceVariant)
        .width('100%').padding({ left: 14, right: 14, bottom: 4 })

      Scroll() {
        Column() {
          if (this.busy) {
            Text('正在读取…')
              .fontSize(13).fontColor(this.tk().onSurfaceVariant)
              .width('100%').padding(24)
          } else {
            if (this.future.length > 0) {
              this.sectionTitle('接下来的调整')
              ForEach(this.future, (it: AdjustmentItem) => {
                this.itemCard(it)
              }, (it: AdjustmentItem) => 'f' + it.day)
            }
            if (this.history.length > 0) {
              this.sectionTitle('已经过去的')
              ForEach(this.history, (it: AdjustmentItem) => {
                this.itemCard(it)
              }, (it: AdjustmentItem) => 'p' + it.day)
            }
            if (this.future.length === 0 && this.history.length === 0) {
              Text('没有可显示的调整条目。')
                .fontSize(13).fontColor(this.tk().onSurfaceVariant)
                .width('100%').padding({ top: 24 })
            }
            Text('说明：放假与补课以教务发布为准；补课日的课表按「被指定那天的星期」上课。')
              .fontSize(10).fontColor(this.tk().textPlaceholder)
              .width('100%').padding({ top: 16, bottom: 24 })
          }
        }
        .width('100%')
        .padding({ left: 14, right: 14 })
      }
      .layoutWeight(1)
      .align(Alignment.Top)
      .width('100%')
      .scrollBar(BarState.Auto)
    }
    .width('100%').height('100%')
    .backgroundColor(this.tk().background)
  }
}
