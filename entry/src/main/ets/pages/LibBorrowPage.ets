/**
 * 图书馆借阅页（M5-3）：当前在借 / 历史借阅两栏。
 *
 * 验收判据（ROADMAP §4 M5-3，可证伪）：
 *  1. 有借阅时列出书名与剩余天数（statusText 现算，不存展示串）；
 *  2. 无借阅时也正常显示「当前没有在借的书」；
 *  3. **未登录 / 取不到 / 确实没有** 三态分明 —— 把「取不到」显示成「0 本」
 *     会在真正该提醒的时候告诉用户「你没借书」（Android 原注释就是这个风险）。
 *
 * 数据来源：LibBorrowService（user-info 判登录 → sversion → data 接口 → 解析）。
 */

import { Context } from '@kit.AbilityKit';
import { router } from '@kit.ArkUI';
import { gridTokens } from '../core/theme/GridTokens.ts';
import type { GridTokens } from '../core/theme/GridTokens.ts';
import { STORAGE_DARK, STORAGE_PALETTE, getPalette } from '../data/ThemeStore.ts';
import { LibBorrowService, LibBorrowResult } from '../service/LibBorrowService.ts';
import { BorrowRecord, cardSummary, statusText, dueText } from '../corelogic/LibBorrowLogic.ts';
import type { DateTime } from '../corelogic/timeutil.ts';
import { info, warn } from '../core/log/BitLog.ts';

@Entry
@Component
struct LibBorrowPage {
  @StorageLink(STORAGE_DARK) isDark: boolean = false;
  @StorageLink(STORAGE_PALETTE) paletteName: string = 'warm';

  /** 'current' = 当前在借；'history' = 历史借阅。 */
  @State tab: string = 'current';
  @State current: LibBorrowResult | null = null;
  @State history: LibBorrowResult | null = null;
  @State busy: boolean = false;
  @State loaded: boolean = false;

  private tk(): GridTokens {
    return gridTokens(this.isDark, getPalette(this.paletteName));
  }

  /** 本地「现在」（展示层 impure 边界：文案现算）。 */
  private now(): DateTime {
    const d: Date = new Date();
    const offsetMs: number = d.getTimezoneOffset() * 60000;
    return {
      day: Math.floor((d.getTime() - offsetMs) / 86400000),
      minutes: d.getHours() * 60 + d.getMinutes()
    };
  }

  private shown(): LibBorrowResult | null {
    return this.tab === 'current' ? this.current : this.history;
  }

  private shownRecords(): BorrowRecord[] {
    const r: LibBorrowResult | null = this.shown();
    return r !== null && r.kind === 'ok' ? r.records : [];
  }

  /**
   * 当前栏状态码（'none' | 'ok' | 'loggedOut' | 'failed'）。
   * ⚠️ 之所以绕这一层：UI 构建树里**不许声明局部变量**（本编译器直接拒
   * 「Only UI component syntax can be written here」），而多次调 this.shown()
   * 又没法做类型窄化 ⇒ 用字符串状态码绕开，判据仍然挂在同一个对象上。
   */
  private stateKind(): string {
    const r: LibBorrowResult | null = this.shown();
    return r === null ? 'none' : r.kind;
  }

  /** failed 态的原因文案。 */
  private failReason(): string {
    const r: LibBorrowResult | null = this.shown();
    return r !== null && r.kind === 'failed' ? r.reason : '';
  }

  /** 摘要行（当前栏才有意义；历史栏只报条数）。 */
  private summaryText(): string {
    if (this.tab === 'history') {
      const r: LibBorrowResult | null = this.history;
      if (r !== null && r.kind === 'ok') {
        return '历史共 ' + r.records.length + ' 条（纯展示，不参与提醒）';
      }
      return '';
    }
    const r: LibBorrowResult | null = this.current;
    if (r === null || r.kind !== 'ok') {
      return '';
    }
    return cardSummary(r.records, this.now());
  }

  private async refresh(): Promise<void> {
    if (this.busy) {
      return;
    }
    this.busy = true;
    try {
      const ctx: Context = getContext(this) as Context;
      // 两个来源并行（与 Android CampusServiceViewModel 的 async 同款）
      const cur: Promise<LibBorrowResult> = LibBorrowService.fetchCurrent(ctx);
      const his: Promise<LibBorrowResult> = LibBorrowService.fetchHistory(ctx);
      this.current = await cur;
      this.history = await his;
      this.loaded = true;
      info('lib page refresh cur=' + this.current.kind + ' his=' + this.history.kind);
    } catch (e) {
      warn('lib page refresh fail: ' + (e as Error).message);
      this.current = { kind: 'failed', reason: (e as Error).message };
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
      // ── 顶栏 ──
      Row() {
        Button('‹ 返回')
          .onClick(() => {
            router.back();
          })
        Text('图书馆').fontSize(16).fontWeight(FontWeight.Bold).layoutWeight(1)
          .textAlign(TextAlign.Center)
        Button('刷新').fontSize(13)
          .enabled(!this.busy)
          .onClick(() => {
            this.refresh();
          })
      }.width('100%').padding(12)

      // ── 两栏切换 ──
      Row() {
        Text('当前在借')
          .fontSize(13).layoutWeight(1).textAlign(TextAlign.Center)
          .fontColor(this.tab === 'current' ? this.tk().onPrimary : this.tk().onSurfaceVariant)
          .backgroundColor(this.tab === 'current' ? this.tk().primary : this.tk().surface2)
          .padding({ top: 8, bottom: 8 })
          .borderRadius(8)
          .onClick(() => {
            this.tab = 'current';
          })
        Text('历史借阅')
          .fontSize(13).layoutWeight(1).textAlign(TextAlign.Center)
          .fontColor(this.tab === 'history' ? this.tk().onPrimary : this.tk().onSurfaceVariant)
          .backgroundColor(this.tab === 'history' ? this.tk().primary : this.tk().surface2)
          .padding({ top: 8, bottom: 8 })
          .borderRadius(8)
          .margin({ left: 8 })
          .onClick(() => {
            this.tab = 'history';
          })
      }.width('100%').padding({ left: 12, right: 12, top: 4 })

      if (this.summaryText().length > 0) {
        Text(this.summaryText())
          .fontSize(12).fontColor(this.tk().onSurfaceVariant)
          .width('100%').padding({ left: 12, right: 12, top: 8 })
      }

      // ── 列表 / 三态 ──
      // ⚠️ 整棵树里不声明任何局部变量（见 stateKind 注释）；分支判据用取值方法
      Scroll() {
        Column() {
          if (this.busy && !this.loaded) {
            Text('正在查借阅…')
              .fontSize(12).fontColor(this.tk().onSurfaceVariant).width('100%').padding(16)
          } else if (this.stateKind() === 'none') {
            Text('还没有数据，点右上角刷新。')
              .fontSize(12).fontColor(this.tk().onSurfaceVariant).width('100%').padding(16)
          } else if (this.stateKind() === 'loggedOut') {
            // 未登录：可处置状态 —— 给登录入口，**不是**「0 本」
            Text('图书馆会话未建立。登录后即可查看在借图书。')
              .fontSize(12).fontColor(this.tk().onSurfaceVariant).width('100%').padding(16)
            Button('去图书馆登录')
              .fontSize(13).margin({ top: 8 })
              .backgroundColor(this.tk().primary).fontColor(this.tk().onPrimary)
              .onClick(() => {
                router.pushUrl({ url: 'pages/LibLoginPage' }).catch((e: Error) => {
                  warn('lib -> login fail: ' + JSON.stringify(e));
                });
              })
          } else if (this.stateKind() === 'failed') {
            // 取不到：如实说取不到，给重试 —— **绝不显示成「0 本」**
            Text('⚠️ 暂时取不到借阅数据：' + this.failReason())
              .fontSize(12).fontColor(this.tk().error).width('100%').padding(16)
            Button('重试').fontSize(13).margin({ top: 8 })
              .onClick(() => {
                this.refresh();
              })
          } else if (this.shownRecords().length === 0) {
            Text(this.tab === 'current' ? '当前没有在借的书。' : '没有历史借阅记录。')
              .fontSize(12).fontColor(this.tk().onSurfaceVariant).width('100%').padding(16)
          } else {
            // keyGenerator 单参（与 DdlPage 唯一编译得过的写法一致；
            // 双参 + 可选参在这个编译器下会连环报错）
            ForEach(this.shownRecords(), (rec: BorrowRecord) => {
                Column() {
                  Text(rec.title.length > 0 ? rec.title : '（无题名）')
                    .fontSize(14).fontWeight(FontWeight.Medium).layoutWeight(1)
                    .fontColor(this.tk().onSurface)
                  Text((rec.author.length > 0 ? rec.author + ' · ' : '') +
                    (rec.location.length > 0 ? rec.location : ''))
                    .fontSize(11).fontColor(this.tk().onSurfaceVariant)
                    .width('100%').margin({ top: 2 })
                  Row() {
                    Text('应还 ' + dueText(rec))
                      .fontSize(11).fontColor(this.tk().onSurfaceVariant).layoutWeight(1)
                    Text(statusText(rec, this.now()))
                      .fontSize(11)
                      .fontColor(this.isOverdue(rec) ? this.tk().error : this.tk().onSurfaceVariant)
                  }
                  .width('100%').margin({ top: 2 })
                }
                .width('100%').padding(12).margin({ top: 8 })
                .backgroundColor(this.tk().surface)
                .borderRadius(10)
                // 键内容派生：书名 + ISBN + 应还日（接口不给 id）
              }, (rec: BorrowRecord) => rec.key)
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

  /** 已逾期（状态文案标红用）。 */
  private isOverdue(rec: BorrowRecord): boolean {
    if (rec.dueAt === null) {
      return false;
    }
    return rec.dueAt.day < this.now().day;
  }
}
