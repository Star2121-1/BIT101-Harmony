/**
 * 作业页（#88 UI 迁移：1:1 对齐原版 BIT101 `DDLSchedule` / ref-02-ddl.png）。
 *
 * 结构口径（原版 DDLSchedule.kt + DDLScheduleItem.kt）：
 *  - **分区标题**「未完成 · N」「已完成 · N」（labelLarge + onSurfaceVariant），
 *    单列表滚动（原版不是 tab 切换）；
 *  - 卡片：底/字色按紧急度现算（cardColors：done ⇒ secondaryContainer@0.5；
 *    否则 surfaceVariant→errorContainer 混色），M3 medium 12dp 圆角；
 *    左：标题（titleMedium）+ 课程副文本（bodySmall）+ 倒计时（bodyMedium，remainTime 现算）；
 *    右：勾选框（M3 Checkbox，选中 primary / 未选 outline）。
 *
 * 功能件保留（鸿蒙自有，验收判据 ROADMAP §4 M4-3）：
 *  1. 点卡片 = 勾选/取消切换（done 落库，杀进程回来还在）；
 *  2. 重新同步保留手动完成状态（合并规则在 corelogic/DdlRules.ts，有单测）；
 *  3. 空库且无 eclass 会话 ⇒ 给登录入口，不给空白。
 *
 * 数据来源：DdlStore（同步落库）。本页不发同步以外的请求。
 * ⚠️ 倒计时/卡片色现算不缓存（铁律 0.8）；派生列表走 pendingList/doneList 纯函数
 * （1:1 Android DdlListOrder，corelogic/DdlListLogic.ts 有单测）。
 */

import { Context } from '@kit.AbilityKit';
import { router } from '@kit.ArkUI';
import { FabColumn, FabAction } from '../components/shell/FabColumn.ets';
import { gridTokens } from '../core/theme/GridTokens.ts';
import type { GridTokens } from '../core/theme/GridTokens.ts';
import { STORAGE_DARK, STORAGE_PALETTE, getPalette } from '../data/ThemeStore.ts';
import { DdlStore } from '../data/DdlStore.ts';
import { EclassSyncService } from '../service/EclassSyncService.ts';
import { EclassService } from '../service/EclassService.ts';
import { DdlEntry } from '../corelogic/DdlRules.ts';
import { remainTime } from '../corelogic/DdlFormat.ts';
import { pendingList, doneList, cardColors } from '../corelogic/DdlListLogic.ts';
import type { DateTime } from '../corelogic/timeutil.ts';
import { info, warn } from '../core/log/BitLog.ts';

@Entry
@Component
export struct DdlPage {
  /** true = 被外壳（底部 tab）嵌入：不渲染返回键（原版这些是 pager 页签，没有页面级返回）。 */
  isEmbedded: boolean = false;

  @StorageLink(STORAGE_DARK) isDark: boolean = false;
  @StorageLink(STORAGE_PALETTE) paletteName: string = 'warm';

  @State entries: DdlEntry[] = [];
  @State status: string = '';
  @State busy: boolean = false;
  /** 有没有 eclass 会话（决定空态给「去登录」还是「去同步」）。 */
  @State hasSession: boolean = false;

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

  /** 未完成区（截止升序，1:1 DdlListOrder.pending）。 */
  private pending(): DdlEntry[] {
    return pendingList(this.entries);
  }

  /** 已完成区（截止倒序，1:1 DdlListOrder.done）。 */
  private done(): DdlEntry[] {
    return doneList(this.entries);
  }

  private async reload(): Promise<void> {
    this.entries = await DdlStore.load();
    this.hasSession = await EclassService.hasSession();
  }

  /** 勾选/取消（卡片与勾选框共用；同一帧内双触发也幂等——目标值同取自重前的快照）。 */
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

  /** 卡片底色（现算：done ⇒ secondaryContainer@0.5；否则按紧急度混色）。 */
  private cardBg(e: DdlEntry): string {
    return cardColors(e, this.now(), this.tk()).bg;
  }

  /** 卡片字色（与底色同源的 contentColor 口径）。 */
  private cardFg(e: DdlEntry): string {
    return cardColors(e, this.now(), this.tk()).fg;
  }

  aboutToAppear(): void {
    this.reload();
  }

  /** 右下角悬浮按钮（原版 PageFab 规格）。这里先只挂「设置」——与原版各页最下面那颗一致。 */
  private fabActions(): FabAction[] {
    const list: FabAction[] = [
      {
        icon: 'ic_settings.svg',
        label: '设置',
        onTap: () => {
          router.pushUrl({ url: 'pages/SettingsPage' }).catch((e: Error) => {
            warn('open settings fail: ' + JSON.stringify(e));
          });
        },
      },
    ];
    return list;
  }

  build() {
    Stack({ alignContent: Alignment.BottomEnd }) {
    // ⚠️ 不在 build() 根部声明任何局部变量：本编译器的 UI 描述只认「根节点起手」
    // （2026-10-21 编译失败两次，错误位置钉在声明行上）。派生列表走取值方法。
    Column() {
      // ── 顶栏（push 子页必需；原版是 pager 内 tab 无页头） ──
      Row() {
        if (!this.isEmbedded) {
          Button('‹ 返回')
            .height(32).fontSize(12)
            .backgroundColor(Color.Transparent)
            .fontColor(this.tk().primary)
            .onClick(() => {
              router.back();
            })
        }
        Text('作业')
          .fontSize(16).fontWeight(FontWeight.Bold).fontColor(this.tk().onSurface)
          .layoutWeight(1).margin({ left: 10 })
          .textAlign(TextAlign.Start)
        Button('同步')
          .height(32).fontSize(12)
          .backgroundColor(Color.Transparent)
          .fontColor(this.tk().primary)
          .enabled(!this.busy)
          .onClick(() => {
            this.sync();
          })
      }
      .width('100%').padding({ left: 12, right: 12, top: 10, bottom: 6 })

      if (this.status.length > 0) {
        Text(this.status)
          .fontSize(11).fontColor(this.tk().onSurfaceVariant)
          .width('100%').padding({ left: 12, right: 12, top: 2 })
      }

      // ── 列表（分区结构，1:1 ref-02） ──
      Scroll() {
        Column() {
          if (this.entries.length === 0) {
            // 空态分两种：没会话（引导登录）vs 有会话没数据（引导同步）。
            // 视觉对齐原版空态（secondaryContainer 卡），功能保持鸿蒙两分支。
            Column() {
              Text(this.hasSession
                ? '没有作业数据。点右上角「同步」从延河课堂拉取。'
                : '还没有作业数据。先在延河课堂登录，再同步。')
                .fontSize(12).fontColor(this.tk().onSecondaryContainer)
                .width('100%').textAlign(TextAlign.Center)
              if (!this.hasSession) {
                Button('去延河课堂登录')
                  .fontSize(13).margin({ top: 8 })
                  .backgroundColor(this.tk().primary).fontColor(this.tk().onPrimary)
                  .onClick(() => {
                    router.pushUrl({ url: 'pages/EclassLoginPage' }).catch((e: Error) => {
                      warn('ddl -> eclass login fail: ' + JSON.stringify(e));
                    });
                  })
              }
            }
            .width('100%').padding(16).margin({ top: 8 })
            .backgroundColor(this.tk().secondaryContainer).borderRadius(12)
          } else {
            // 未完成区（原版：分区标题 + 截止升序条目）
            if (this.pending().length > 0) {
              this.sectionTitle('未完成 · ' + this.pending().length, 0)
              ForEach(this.pending(), (e: DdlEntry) => {
                this.ddlCard(e)
              }, (e: DdlEntry) => e.uid)
            }
            // 已完成区（原版：分区标题 + 截止倒序条目）
            if (this.done().length > 0) {
              this.sectionTitle('已完成 · ' + this.done().length, this.pending().length > 0 ? 8 : 0)
              ForEach(this.done(), (e: DdlEntry) => {
                this.ddlCard(e)
              }, (e: DdlEntry) => e.uid)
            }
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

      // 原版 DDL 是 3 颗（+ / 学士帽 / ⚙）。目前只挂 ⚙：
      // 「+ 新增」与「去作业平台」要新增弹窗与平台选择，属下一页工作。
      FabColumn({ actions: this.fabActions() })
    }
    .width('100%').height('100%')
  }

  /** 分区标题（1:1 DdlSectionTitle：labelLarge + onSurfaceVariant）。 */
  @Builder
  sectionTitle(text: string, topMargin: number) {
    Text(text)
      .fontSize(14).fontWeight(FontWeight.Medium)
      .fontColor(this.tk().onSurfaceVariant)
      .width('100%').textAlign(TextAlign.Start)
      .padding({ top: topMargin, bottom: 2 })
  }

  /**
   * DDL 条目卡（1:1 DDLScheduleItem）：
   *  Row 内边距 15/15/5/15；左列 = 标题 + 副文本 + 倒计时（均 1 行截断）；
   *  右端 M3 勾选框。点卡片 = 勾选/取消（鸿蒙 M4-3 判据 1）。
   */
  @Builder
  ddlCard(e: DdlEntry) {
    Row() {
      Column() {
        Text(e.title)
          .fontSize(16).fontWeight(FontWeight.Medium)
          .fontColor(this.cardFg(e))
          .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
          .width('100%')
        Text(e.text)
          .fontSize(12)
          .fontColor(this.cardFg(e))
          .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
          .width('100%')
        Text(remainTime({ day: e.day, minutes: e.minutes }, this.now()))
          .fontSize(14)
          .fontColor(this.cardFg(e))
          .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
          .width('100%').margin({ top: 5 })
      }
      .layoutWeight(1)

      Checkbox()
        .select(e.done)
        .selectedColor(this.tk().primary)
        .unselectedColor(this.tk().outline)
        .onChange(() => {
          this.toggle(e);
        })
    }
    .width('100%')
    .padding({ left: 15, right: 5, top: 15, bottom: 15 })
    .margin({ top: 5, bottom: 5 })
    .backgroundColor(this.cardBg(e))
    .borderRadius(12)
    .alignItems(VerticalAlign.Center)
    .onClick(() => {
      this.toggle(e);
    })
  }
}
