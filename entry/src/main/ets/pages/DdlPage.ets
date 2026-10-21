/**
 * 作业页（M4-3）：未完成 / 已完成两栏。
 *
 * 验收判据（ROADMAP §4 M4-3，可证伪）：
 *  1. 点条目在两侧切换（done 落库，杀进程回来还在）；
 *  2. 重新同步保留手动完成状态（合并规则在 corelogic/DdlRules.ts，有单测）；
 *  3. 空库且无 eclass 会话 ⇒ 给登录入口，不给空白。
 *
 * 数据来源：DdlStore（M4-2 同步落库）。本页不发同步以外的请求。
 * 截止文案现算（DdlFormat.remainTime）——不存展示串（铁律 0.8）。
 */

import { Context } from '@kit.AbilityKit';
import { router } from '@kit.ArkUI';
import { palette, Palette } from '../core/theme/AppColors.ts';
import { STORAGE_DARK } from '../data/ThemeStore.ts';
import { DdlStore } from '../data/DdlStore.ts';
import { EclassSyncService } from '../service/EclassSyncService.ts';
import { EclassService } from '../service/EclassService.ts';
import { DdlEntry } from '../corelogic/DdlRules.ts';
import { deadlineShort, remainTime, isOverdue } from '../corelogic/DdlFormat.ts';
import type { DateTime } from '../corelogic/timeutil.ts';
import { info, warn } from '../core/log/BitLog.ts';

@Entry
@Component
struct DdlPage {
  @StorageLink(STORAGE_DARK) isDark: boolean = false;

  /** 'todo' = 未完成栏；'done' = 已完成栏。 */
  @State tab: string = 'todo';
  @State entries: DdlEntry[] = [];
  @State status: string = '';
  @State busy: boolean = false;
  /** 有没有 eclass 会话（决定空态给「去登录」还是「去同步」）。 */
  @State hasSession: boolean = false;

  private p(): Palette {
    return palette(this.isDark);
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

  private todoList(): DdlEntry[] {
    return this.entries.filter((e: DdlEntry) => !e.done);
  }

  private doneList(): DdlEntry[] {
    return this.entries.filter((e: DdlEntry) => e.done);
  }

  private shownList(): DdlEntry[] {
    return this.tab === 'todo' ? this.todoList() : this.doneList();
  }

  private async reload(): Promise<void> {
    this.entries = await DdlStore.load();
    this.hasSession = await EclassService.hasSession();
  }

  /** 勾选/取消（两侧切换的本质）。 */
  private async toggle(entry: DdlEntry): Promise<void> {
    const okDone: boolean = await DdlStore.setDone(entry.uid, !entry.done);
    if (!okDone) {
      this.status = '条目已不存在（可能刚被同步清理）';
      return;
    }
    await this.reload();
    info('ddl toggle ' + entry.uid + ' -> ' + (!entry.done));
  }

  /** 同步（M4-2 的 sync）。会话失效时错误原样上屏。 */
  private async sync(): Promise<void> {
    if (this.busy) {
      return;
    }
    this.busy = true;
    this.status = '正在同步作业…';
    try {
      const ctx: Context = getContext(this) as Context;
      const s = await EclassSyncService.sync(ctx);
      this.status = '同步完成：' + s.courses + ' 门课 / ' + s.items + ' 条作业' +
        '（新 ' + s.added + ' · 更 ' + s.updated + '）';
      await this.reload();
    } catch (e) {
      warn('ddl sync fail: ' + (e as Error).message);
      this.status = '⚠️ ' + (e as Error).message;
    }
    this.busy = false;
  }

  aboutToAppear(): void {
    this.reload();
  }

  build() {
    // ⚠️ 不在 build() 根部声明任何局部变量：本编译器的 UI 描述只认「根节点起手」
    // （2026-10-21 编译失败两次：Rollup Unexpected token + 「build 只能有一个根节点」，
    // 错误位置就钉在声明行上）。派生列表走取值方法，now 在用到处现算（铁律 0.8）。
    Column() {
      // ── 顶栏 ──
      Row() {
        Button('‹ 返回')
          .onClick(() => {
            router.back();
          })
        Text('作业').fontSize(16).fontWeight(FontWeight.Bold).layoutWeight(1)
          .textAlign(TextAlign.Center)
        Button('同步').fontSize(13)
          .enabled(!this.busy)
          .onClick(() => {
            this.sync();
          })
      }.width('100%').padding(12)

      // ── 两栏切换 ──
      Row() {
        Text('未完成 ' + this.todoList().length)
          .fontSize(13).layoutWeight(1).textAlign(TextAlign.Center)
          .fontColor(this.tab === 'todo' ? this.p().textOnAccent : this.p().textMuted)
          .backgroundColor(this.tab === 'todo' ? this.p().accent : this.p().bgAlt)
          .padding({ top: 8, bottom: 8 })
          .borderRadius(8)
          .onClick(() => {
            this.tab = 'todo';
          })
        Text('已完成 ' + this.doneList().length)
          .fontSize(13).layoutWeight(1).textAlign(TextAlign.Center)
          .fontColor(this.tab === 'done' ? this.p().textOnAccent : this.p().textMuted)
          .backgroundColor(this.tab === 'done' ? this.p().accent : this.p().bgAlt)
          .padding({ top: 8, bottom: 8 })
          .borderRadius(8)
          .margin({ left: 8 })
          .onClick(() => {
            this.tab = 'done';
          })
      }.width('100%').padding({ left: 12, right: 12, top: 4 })

      if (this.status.length > 0) {
        Text(this.status)
          .fontSize(11).fontColor(this.p().textMuted)
          .width('100%').padding({ left: 12, right: 12, top: 6 })
      }

      // ── 列表 ──
      Scroll() {
        Column() {
          if (this.shownList().length === 0) {
            // 空态分两种：没会话（引导登录）vs 有会话没数据（引导同步）
            if (this.entries.length === 0 && !this.hasSession) {
              Text('还没有作业数据。先在延河课堂登录，再同步。')
                .fontSize(12).fontColor(this.p().textMuted).width('100%').padding(16)
              Button('去延河课堂登录')
                .fontSize(13).margin({ top: 8 })
                .backgroundColor(this.p().accent).fontColor(this.p().textOnAccent)
                .onClick(() => {
                  router.pushUrl({ url: 'pages/EclassLoginPage' }).catch((e: Error) => {
                    warn('ddl -> eclass login fail: ' + JSON.stringify(e));
                  });
                })
            } else {
              Text(this.tab === 'todo' ? '没有未完成的作业。' : '还没有已完成的作业。')
                .fontSize(12).fontColor(this.p().textMuted).width('100%').padding(16)
            }
          } else {
            ForEach(this.shownList(), (e: DdlEntry) => {
              Column() {
                Row() {
                  Text(e.title)
                    .fontSize(14).fontWeight(FontWeight.Medium).layoutWeight(1)
                    .fontColor(this.p().textPrimary)
                  if (!e.done && isOverdue({ day: e.day, minutes: e.minutes }, this.now())) {
                    Text('已截止')
                      .fontSize(10)
                      .fontColor(this.p().error)
                  }
                }
                .width('100%')

                Text((e.text.length > 0 ? e.text + ' · ' : '') +
                  deadlineShort({ day: e.day, minutes: e.minutes }) +
                  ' · ' + remainTime({ day: e.day, minutes: e.minutes }, this.now()))
                  .fontSize(11)
                  .fontColor(this.p().textSecondary)
                  .width('100%').margin({ top: 2 })
              }
              .width('100%').padding(12).margin({ top: 8 })
              .backgroundColor(this.p().bgCard)
              .borderRadius(10)
              .onClick(() => {
                this.toggle(e);
              })
            }, (e: DdlEntry) => e.uid)
          }
        }
        .width('100%').padding({ left: 12, right: 12 })
        .align(Alignment.Top)
      }
      .layoutWeight(1)
    }
    .width('100%').height('100%')
    .backgroundColor(this.p().bgPage)
  }
}
