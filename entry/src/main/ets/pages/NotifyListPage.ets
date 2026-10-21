/**
 * 通知列表（M7-1：历史通知 + 分类型筛选）。
 *
 * 数据来源 = NotifyRecordStore（排期时写入，触发后回填 firedMillis）。
 * 列表里只放**当时的事实**（标题/正文/排期时刻/是否已发），
 * 相对时间（「还剩 N 分钟」）不存 —— 未发条目的「还剩」现算。
 *
 * 入口在「我」页（M5-5）。
 */

import { router } from '@kit.ArkUI';
import { palette, type Palette } from '../core/theme/AppColors.ts';
import { STORAGE_DARK } from '../data/ThemeStore.ts';
import { NotifyRecord, kindLabel } from '../corelogic/NotifyRecordLogic.ts';
import { NotifyRecordStore } from '../data/NotifyRecordStore.ts';
import { ReminderKind } from '../corelogic/NotifyLogic.ts';
import { warn } from '../core/log/BitLog.ts';

interface TabItem {
  kind: ReminderKind | null;
  label: string;
}

@Entry
@Component
struct NotifyListPage {
  @StorageLink(STORAGE_DARK) isDark: boolean = false;
  @State tabs: TabItem[] = [];
  @State activeTab: number = 0;
  @State records: NotifyRecord[] = [];
  @State busy: boolean = false;
  @State emptyMsg: string = '';

  private p(): Palette {
    return palette(this.isDark);
  }

  aboutToAppear(): void {
    this.tabs = NotifyRecordStore.filterTabs();
    this.reload();
  }

  onPageShow(): void {
    this.reload();
  }

  /** 现算「还剩 N 分钟 / 已过 N 分钟」（未发条目才显示）。 */
  private remainText(rec: NotifyRecord, nowMs: number): string {
    const diffMin: number = Math.round((rec.atMillis - nowMs) / 60000);
    if (diffMin > 0) {
      return '还剩 ' + diffMin + ' 分钟';
    }
    if (diffMin === 0) {
      return '即将触发';
    }
    return '已过 ' + (-diffMin) + ' 分钟';
  }

  private async reload(): Promise<void> {
    this.busy = true;
    try {
      const all: NotifyRecord[] = await NotifyRecordStore.load();
      const tab: TabItem | null = this.tabs.length > this.activeTab ? this.tabs[this.activeTab] : null;
      const kind: ReminderKind | null = tab !== null ? tab.kind : null;
      this.records = NotifyRecordStore.byKind(all, kind);
      if (this.records.length === 0) {
        this.emptyMsg = kind === null
          ? '还没有排入提醒。开课后第一次打开「我」页会生成。'
          : '这一类还没有提醒记录。';
      }
    } catch (e) {
      warn('NotifyListPage reload fail: ' + JSON.stringify(e));
      this.emptyMsg = '读取记录失败。';
    }
    this.busy = false;
  }

  build() {
    Column() {
      // 顶部：返回 + 标题 + 刷新
      Row() {
        Text('‹')
          .fontSize(28).fontColor(this.p().textPrimary).width(44)
          .textAlign(TextAlign.Center).margin({ left: 8 })
          .onClick(() => router.back())
        Text('通知')
          .fontSize(18).fontWeight(FontWeight.Bold).fontColor(this.p().textPrimary).layoutWeight(1)
        Text('刷新')
          .fontSize(14).fontColor(this.p().accent)
          .onClick(() => this.reload())
          .margin({ right: 12 })
      }
      .width('100%').height(56).backgroundColor(this.p().bgPage)

      // 类型 tab
      Row() {
        ForEach(this.tabs, (t: TabItem) => {
          Text(t.label)
            .fontSize(13)
            .fontColor(this.activeTab === this.tabs.indexOf(t) ? this.p().textOnAccent : this.p().textMuted)
            .backgroundColor(this.activeTab === this.tabs.indexOf(t) ? this.p().accent : this.p().bgAlt)
            .borderRadius(14).padding({ left: 12, right: 12, top: 6, bottom: 6 })
            .margin({ right: 8 })
            .onClick(() => {
              this.activeTab = this.tabs.indexOf(t);
              this.reload();
            })
        }, (t: TabItem) => (t.kind === null ? 'all' : t.kind))
      }
      .width('100%').padding({ left: 12, right: 12, top: 8, bottom: 8 })
      .backgroundColor(this.p().bgPage)

      // 列表
      if (this.busy) {
        Text('正在读记录…')
          .fontSize(13).fontColor(this.p().textMuted)
          .width('100%').padding(24)
      } else if (this.records.length === 0) {
        Text(this.emptyMsg)
          .fontSize(13).fontColor(this.p().textMuted)
          .width('100%').padding(24)
      } else {
        Scroll() {
          Column() {
            ForEach(this.records, (rec: NotifyRecord) => {
              Column() {
                Row() {
                  Text(kindLabel(rec.kind))
                    .fontSize(11)
                    .fontColor(this.p().textOnAccent)
                    .backgroundColor(this.p().accent)
                    .borderRadius(4).padding({ left: 6, right: 6, top: 2, bottom: 2 })
                  Text(rec.title)
                    .fontSize(14).fontWeight(FontWeight.Medium)
                    .fontColor(this.p().textPrimary)
                    .margin({ left: 8 }).layoutWeight(1)
                    .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
                }.width('100%')

                Text(rec.text)
                  .fontSize(13).fontColor(this.p().textSecondary)
                  .margin({ top: 4 }).width('100%')

                Row() {
                  Text(NotifyRecordStore.fmtAt(rec))
                    .fontSize(12).fontColor(this.p().textMuted)
                  if (rec.firedMillis > 0) {
                    Text(' · 已发')
                      .fontSize(12).fontColor(this.p().textMuted)
                  } else {
                    Text(' · ' + this.remainText(rec, Date.now()))
                      .fontSize(12).fontColor(this.p().textMuted)
                  }
                }
                .width('100%').margin({ top: 4 })
              }
              .width('100%').padding(12)
              .backgroundColor(this.p().bgAlt)
              .borderRadius(10).margin({ bottom: 8 })
            }, (rec: NotifyRecord) => rec.key)
          }
          .width('100%')
        }
        .width('100%').layoutWeight(1)
      }
    }
    .width('100%').height('100%')
    .backgroundColor(this.p().bgPage)
  }
}
