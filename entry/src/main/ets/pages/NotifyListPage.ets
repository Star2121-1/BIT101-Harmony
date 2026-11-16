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
import { gridTokens } from '../core/theme/GridTokens.ts';
import type { GridTokens } from '../core/theme/GridTokens.ts';
import { STORAGE_DARK, STORAGE_PALETTE, getPalette } from '../data/ThemeStore.ts';
import { NotifyRecord, kindLabel, dedupeByKey } from '../corelogic/NotifyRecordLogic.ts';
import { NotifyRecordStore } from '../data/NotifyRecordStore.ts';
import { NotifySeenStore } from '../data/NotifySeenStore.ts';
import { GroupSpan, groupSpans, badgeText, clearConfirmText, compareNewestFirst } from '../corelogic/NotifyGroupLogic.ts';
import {
  NotifyReadSnapshot,
  firedKeys,
  seedSnapshotFromLegacy,
  unreadFromSnapshot
} from '../corelogic/NotifyReadLogic.ts';
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
  @StorageLink(STORAGE_PALETTE) paletteName: string = 'warm';
  @State tabs: TabItem[] = [];
  @State activeTab: number = 0;
  @State records: NotifyRecord[] = [];
  @State busy: boolean = false;
  @State emptyMsg: string = '';
  @State unread: number = 0;
  @State spans: GroupSpan[] = [];
  @State clearing: boolean = false;
  /** reload 代次：并发时只让最后一次的结果落状态，防旧结果覆盖新结果。 */
  private reloadSeq: number = 0;

  private tk(): GridTokens {
    return gridTokens(this.isDark, getPalette(this.paletteName));
  }

  aboutToAppear(): void {
    this.tabs = NotifyRecordStore.filterTabs();
    // ⚠️ 这里原来也调 this.reload()，与 onPageShow 的那次并发：两次各自读 seen 算 unread，
    // 只有 onPageShow 那次会 markSeen。竞态下若这次的 load() 在 markSeen 之后完成，
    // 就用「新的 seen」把未读算成 0 ⇒ 徽标消失。改为只让 onPageShow 那次带 markSeen，
    // 且把 markSeen 收进同一次 reload 内（算完 unread 立刻标记），顺序不再跨调用。
    this.reload(false);
  }

  onPageShow(): void {
    this.reload(true);
  }

  /** 清空要二次确认，且说清「不影响提醒设置」。 */
  private confirmClear(): void {
    AlertDialog.show({
      title: '清空提醒记录',
      message: clearConfirmText(this.records.length),
      primaryButton: {
        value: '取消',
        action: () => {
        },
      },
      secondaryButton: {
        value: '清空',
        fontColor: this.tk().error,
        action: () => {
          this.doClear();
        },
      },
    });
  }

  private async doClear(): Promise<void> {
    if (this.clearing) {
      return;
    }
    this.clearing = true;
    try {
      await NotifyRecordStore.clear();
      await this.reload();
    } catch (e) {
      warn('NotifyListPage clear fail: ' + JSON.stringify(e));
    }
    this.clearing = false;
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

  private async reload(markSeenAfter: boolean = false): Promise<void> {
    const seq: number = ++this.reloadSeq;
    this.busy = true;
    try {
      const all: NotifyRecord[] = await NotifyRecordStore.load();
      const tab: TabItem | null = this.tabs.length > this.activeTab ? this.tabs[this.activeTab] : null;
      const kind: ReminderKind | null = tab !== null ? tab.kind : null;
      // 未读与分组：全量算一次（不按 tab 算 —— 徽标要反映「所有没看的」，不是当前 tab 的）
      // M15-B3：优先用已读键快照；没有快照时把旧时间戳语义迁一次，迁完不再依赖时钟。
      const snapshot: NotifyReadSnapshot | null = await NotifySeenStore.loadSnapshot();
      const legacySeen: number = snapshot === null ? await NotifySeenStore.loadLegacySeen() : 0;
      const effective: NotifyReadSnapshot = snapshot !== null
        ? snapshot
        : seedSnapshotFromLegacy(all, legacySeen);
      const unread: number = unreadFromSnapshot(all, effective);
      // ⚠️ 先算 unread、再标记已读：顺序反了就会把本次该显示的徽标自己清成 0。
      // 只标记「已发出」的键；排期中/永远不会发的不是未读。
      if (markSeenAfter) {
        try {
          await NotifySeenStore.markKeys(firedKeys(all));
        } catch (e) {
          warn('NotifyListPage markKeys fail: ' + JSON.stringify(e));
        }
      }
      // 过期结果（有更新的 reload 已发起）直接丢弃，不写 @State
      if (seq !== this.reloadSeq) {
        return;
      }
      // 分组函数要求新→旧；`byKind` 返回旧→新，必须显式转序（否则同标签区间重复，
      // ForEach 的 label key 会撞键）。再按 key 去重兜住老数据里的重复行。
      const filtered: NotifyRecord[] = NotifyRecordStore.byKind(all, kind);
      filtered.sort(compareNewestFirst);
      this.records = dedupeByKey(filtered);
      this.unread = unread;
      this.spans = groupSpans(this.records, Date.now(), -new Date().getTimezoneOffset() * 60000);
      if (this.records.length === 0) {
        this.emptyMsg = kind === null
          ? '还没有排入提醒。开课后第一次打开「我」页会生成。'
          : '这一类还没有提醒记录。';
      }
    } catch (e) {
      warn('NotifyListPage reload fail: ' + JSON.stringify(e));
      if (seq === this.reloadSeq) {
        this.emptyMsg = '读取记录失败。';
      }
    }
    if (seq === this.reloadSeq) {
      this.busy = false;
    }
  }

  build() {
    Column() {
      // 顶部：返回 + 标题 + 刷新
      Row() {
        Text('‹')
          .fontSize(28).fontColor(this.tk().onSurface).width(44)
          .textAlign(TextAlign.Center).margin({ left: 8 })
          .onClick(() => router.back())
        Text('通知')
          .fontSize(18).fontWeight(FontWeight.Bold).fontColor(this.tk().onSurface)
        if (this.unread > 0) {
          Text(badgeText(this.unread))
            .fontSize(10).fontColor(this.tk().onError)
            .backgroundColor(this.tk().error)
            .borderRadius(8).padding({ left: 5, right: 5, top: 1, bottom: 1 })
            .margin({ left: 6 })
            .accessibilityText(String(this.unread) + ' 条未读')
        }
        Text('')
          .layoutWeight(1)
        if (this.records.length > 0) {
          Text('清空')
            .fontSize(14).fontColor(this.tk().error)
            .padding({ left: 8, right: 12 })
            .accessibilityText('清空提醒记录')
            .onClick(() => this.confirmClear())
        }
        Text('刷新')
          .fontSize(14).fontColor(this.tk().primary)
          .onClick(() => this.reload())
          .margin({ right: 12 })
      }
      .width('100%').height(56).backgroundColor(this.tk().background)

      // 类型 tab
      Row() {
        ForEach(this.tabs, (t: TabItem) => {
          Text(t.label)
            .fontSize(13)
            .fontColor(this.activeTab === this.tabs.indexOf(t) ? this.tk().onPrimary : this.tk().onSurfaceVariant)
            .backgroundColor(this.activeTab === this.tabs.indexOf(t) ? this.tk().primary : this.tk().surface2)
            .borderRadius(14).padding({ left: 12, right: 12, top: 6, bottom: 6 })
            .margin({ right: 8 })
            .onClick(() => {
              this.activeTab = this.tabs.indexOf(t);
              this.reload();
            })
        }, (t: TabItem) => (t.kind === null ? 'all' : t.kind))
      }
      .width('100%').padding({ left: 12, right: 12, top: 8, bottom: 8 })
      .backgroundColor(this.tk().background)

      // 列表
      if (this.busy) {
        Text('正在读记录…')
          .fontSize(13).fontColor(this.tk().onSurfaceVariant)
          .width('100%').padding(24)
      } else if (this.records.length === 0) {
        Text(this.emptyMsg)
          .fontSize(13).fontColor(this.tk().onSurfaceVariant)
          .width('100%').padding(24)
      } else {
        Scroll() {
          Column() {
            ForEach(this.spans, (span: GroupSpan) => {
              Text(span.label)
                .fontSize(11).fontColor(this.tk().primary)
                .width('100%').padding({ top: 10, bottom: 4 })
              ForEach(this.records.slice(span.start, span.end), (rec: NotifyRecord) => {
              Column() {
                Row() {
                  Text(kindLabel(rec.kind))
                    .fontSize(11)
                    .fontColor(this.tk().onPrimary)
                    .backgroundColor(this.tk().primary)
                    .borderRadius(4).padding({ left: 6, right: 6, top: 2, bottom: 2 })
                  Text(rec.title)
                    .fontSize(14).fontWeight(FontWeight.Medium)
                    .fontColor(this.tk().onSurface)
                    .margin({ left: 8 }).layoutWeight(1)
                    .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
                }.width('100%')

                Text(rec.text)
                  .fontSize(13).fontColor(this.tk().onSurfaceVariant)
                  .margin({ top: 4 }).width('100%')

                Row() {
                  Text(NotifyRecordStore.fmtAt(rec))
                    .fontSize(12).fontColor(this.tk().onSurfaceVariant)
                  if (rec.firedMillis > 0) {
                    Text(' · 已发')
                      .fontSize(12).fontColor(this.tk().onSurfaceVariant)
                  } else {
                    Text(' · ' + this.remainText(rec, Date.now()))
                      .fontSize(12).fontColor(this.tk().onSurfaceVariant)
                  }
                }
                .width('100%').margin({ top: 4 })
              }
              .width('100%').padding(12)
              .backgroundColor(this.tk().surface2)
              .borderRadius(10).margin({ bottom: 8 })
              .accessibilityText(kindLabel(rec.kind) + '，' + rec.title + '，' + rec.text +
                (rec.firedMillis > 0 ? '，已发出' : '，' + this.remainText(rec, Date.now())))
              }, (rec: NotifyRecord) => rec.key)
            }, (span: GroupSpan) => span.label + '#' + span.start)
          }
          .width('100%')
        }
        .width('100%').layoutWeight(1)
        // ⚠️ 顶对齐必须挂 Scroll 自身：加在内层 Column 上不生效（内容不足一屏会被垂直居中）
        .align(Alignment.Top)
      }
    }
    .width('100%').height('100%')
    .backgroundColor(this.tk().background)
  }
}
