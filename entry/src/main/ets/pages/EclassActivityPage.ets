/**
 * 课程动态页（M4-4）：延河课堂活动流。
 *
 * 验收判据（ROADMAP §4 M4-4）：能列出活动标题/类型/时间。
 *
 * 数据：EclassService.fetchAllActivities（课程 → 逐课程 activities →
 * toActivities → recent 倒序截断）。类型标签用保守分类（认不出的归「动态」，
 * 不编造标签）；时间文案 agoText 现算。点击进 App 内 Web 壳（带会话）。
 *
 * ## 视觉 1:1 对齐原版 ref-06（2026-10-27 真机对照后重排）
 *
 * 原版（`EclassActivityScreen.kt` / `ActivityRow`）与本页的对应关系：
 *
 * | 元素 | 原版 | 本页 |
 * |---|---|---|
 * | 页头 | **没有**（页签即页头），无标题、无刷新钮 | 同（`isEmbedded` 时整行不渲染） |
 * | 卡片底 | `colorScheme.secondaryContainer`（warm 亮 = 薄荷 #D5E9DF） | `tk().secondaryContainer` |
 * | 卡片外形 | `padding(10dp, 5dp)` + `clip(shapes.medium=12dp)` + 内 `padding(10dp)` | 同 |
 * | 类型标签 | **恒** `primaryContainer` 底 + `primary` 字（不按类型染色） | 同 |
 * | 标题 | `bodyMedium`/Medium，`onSecondaryContainer`，2 行省略 | 14sp，2 行省略 |
 * | 副行 | `课程名 · 相对时间`（空项过滤后 `joinToString(" · ")`） | `subLine()` |
 * | 刷新 | 下拉刷新（PullToRefreshContainer） | ArkUI 内置 `Refresh` 容器 |
 * | FAB | 只有 ⚙ 一颗（`:164`） | 同 |
 *
 * ⚠️ 之前这里用了旧 `AppColors`（`accent` = 系统蓝 #2F55C0），刷新按钮是**全站唯一
 *   一处蓝**，和整套棕/青绿体系完全不搭。已随本次一并切到 gridTokens。
 * ⚠️ 之前把「课程名」放在右上、「时间」放最右，两段分开；原版是**副行一句话**。
 * ⚠️ 之前类型标签按 HOMEWORK 用 accent 实底、其余用 bgAlt —— 原版**不按类型染色**。
 */

import { Context } from '@kit.AbilityKit';
import { router } from '@kit.ArkUI';
import { FabColumn, FabAction } from '../components/shell/FabColumn.ets';
import { gridTokens } from '../core/theme/GridTokens.ts';
import type { GridTokens } from '../core/theme/GridTokens.ts';
import { STORAGE_DARK, STORAGE_PALETTE, getPalette } from '../data/ThemeStore.ts';
import { EclassService } from '../service/EclassService.ts';
import { EclassActivity, activityKindLabel } from '../corelogic/EclassActivityLogic.ts';
import { agoText } from '../corelogic/EclassActivityLogic.ts';
import type { DateTime } from '../corelogic/timeutil.ts';
import { info, warn } from '../core/log/BitLog.ts';

@Entry
@Component
export struct EclassActivityPage {
  /** true = 被外壳（底部 tab）嵌入：不渲染返回键（原版这些是 pager 页签，没有页面级返回）。 */
  isEmbedded: boolean = false;

  @StorageLink(STORAGE_DARK) isDark: boolean = false;
  @StorageLink(STORAGE_PALETTE) paletteName: string = 'warm';

  @State list: EclassActivity[] = [];
  @State status: string = '';
  @State busy: boolean = false;
  @State hasSession: boolean = false;
  /** 下拉刷新指示器（原版 PullToRefreshContainer 的 ArkUI 对应物）。 */
  @State refreshing: boolean = false;

  private tk(): GridTokens {
    return gridTokens(this.isDark, getPalette(this.paletteName));
  }

  /** 本地「现在」（展示层 impure 边界：相对文案现算）。 */
  private now(): DateTime {
    const d: Date = new Date();
    const offsetMs: number = d.getTimezoneOffset() * 60000;
    return {
      day: Math.floor((d.getTime() - offsetMs) / 86400000),
      minutes: d.getHours() * 60 + d.getMinutes()
    };
  }

  /**
   * 副行文案 = `课程名 · 相对时间`（原版 `listOf(courseName, agoText).filter{ notBlank }.joinToString(" · ")`）。
   * 两段都可能为空，空项**不参与拼接**——否则会出现「 · 3 分钟前」这种脏串。
   */
  private subLine(a: EclassActivity): string {
    const parts: string[] = [];
    if (a.courseName.length > 0) {
      parts.push(a.courseName);
    }
    const ago: string = agoText(a.time, this.now());
    if (ago.length > 0) {
      parts.push(ago);
    }
    return parts.join(' · ');
  }

  /**
   * 状态行只在**出问题时**才显示（⚠️ 错误 / 取数失败）。
   * 正常状态的「N 条动态」是冗余的——列表本身就是答案（原版也没有这行）。
   */
  private statusIsProblem(): boolean {
    return this.status.indexOf('⚠️') >= 0 || this.status.indexOf('失败') >= 0;
  }

  private async load(): Promise<void> {
    if (this.busy) {
      return;
    }
    this.busy = true;
    this.status = '';
    try {
      const ctx: Context = getContext(this) as Context;
      this.hasSession = await EclassService.hasSession();
      const r = await EclassService.fetchAllActivities(ctx, 60);
      this.list = r.list;
      // 正常不显示条数；只有「部分课取数失败」这种需要人知道的情况才留话。
      this.status = r.failedCourses > 0 ? '⚠️ ' + r.failedCourses + ' 门课取数失败' : '';
      info('eclass activities page n=' + r.list.length);
    } catch (e) {
      warn('eclass activities page fail: ' + (e as Error).message);
      this.status = '⚠️ ' + (e as Error).message;
    }
    this.busy = false;
    this.refreshing = false;
  }

  /** 点条目 → App 内 Web 壳打开课程页（带 eclass 会话）。 */
  private openActivity(a: EclassActivity): void {
    router.pushUrl({
      url: 'pages/WebShellPage',
      params: { url: a.targetUrl }
    }).catch((e: Error) => {
      warn('activity -> web shell fail: ' + JSON.stringify(e));
      this.status = '⚠️ 打不开课程页：' + JSON.stringify(e);
    });
  }

  aboutToAppear(): void {
    this.load();
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

  /** 单条动态卡（原版 `ActivityRow`，1:1）。 */
  @Builder
  activityCard(a: EclassActivity) {
    Column() {
      Row() {
        Text(activityKindLabel(a.kind))
          .fontSize(11)
          .fontColor(this.tk().primary)
          .backgroundColor(this.tk().primaryContainer)
          .padding({ left: 6, right: 6, top: 2, bottom: 2 })
          .borderRadius(6)
        Text(a.title)
          .fontSize(14)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.tk().onSecondaryContainer)
          .layoutWeight(1)
          .margin({ left: 6 })
          .maxLines(2)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
      }
      .width('100%')
      .alignItems(VerticalAlign.Center)

      Text(this.subLine(a))
        .fontSize(12)
        .fontColor(this.tk().onSecondaryContainer)
        .opacity(0.75)
        .width('100%')
        .margin({ top: 4 })
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
    }
    .width('100%')
    .padding(10)
    .margin({ top: 5, bottom: 5 })
    .backgroundColor(this.tk().secondaryContainer)
    .borderRadius(12)
    .onClick(() => {
      this.openActivity(a);
    })
  }

  /** 空态卡（原版 `ActivityEmptyCard`，1:1 结构；文案随会话有无切换）。 */
  @Builder
  emptyCard() {
    Column() {
      Text(this.hasSession ? '暂时没有课程动态' : '还没登录延河课堂')
        .fontSize(14)
        .fontColor(this.tk().onSecondaryContainer)
      Text(this.hasSession ? '老师发布资料或作业后，这里会显示出来'
        : '登录后即可看到课程动态（作业、资料、公告）')
        .fontSize(12)
        .fontColor(this.tk().onSecondaryContainer)
        .opacity(0.75)
        .textAlign(TextAlign.Center)
        .margin({ top: 6 })
      Row() {
        if (this.hasSession) {
          Button('刷新')
            .fontSize(13)
            .height(34)
            .backgroundColor(this.tk().primary)
            .fontColor(this.tk().onPrimary)
            .onClick(() => {
              this.load();
            })
        } else {
          Button('去登录')
            .fontSize(13)
            .height(34)
            .backgroundColor(this.tk().primary)
            .fontColor(this.tk().onPrimary)
            .onClick(() => {
              router.pushUrl({ url: 'pages/EclassLoginPage' }).catch((e: Error) => {
                warn('activity -> eclass login fail: ' + JSON.stringify(e));
              });
            })
        }
      }
      .margin({ top: 10 })
    }
    .width('100%')
    .padding(12)
    .margin({ top: 5, bottom: 5 })
    .backgroundColor(this.tk().secondaryContainer)
    .borderRadius(12)
  }

  build() {
    Stack({ alignContent: Alignment.BottomEnd }) {
      // ⚠️ 不在 build() 根部声明局部变量（本编译器只认「根节点起手」，见 DdlPage 踩坑记录）。
      Column() {
        // 页头只在「被 push 进来」时才有：原版是 pager 页签，页签即页头。
        if (!this.isEmbedded) {
          Row() {
            Button('‹ 返回')
              .backgroundColor(Color.Transparent)
              .fontColor(this.tk().primary)
              .onClick(() => {
                router.back();
              })
            Text('课程动态')
              .fontSize(16)
              .fontWeight(FontWeight.Bold)
              .fontColor(this.tk().onSurface)
              .layoutWeight(1)
              .textAlign(TextAlign.Center)
            // 占位：让标题在视觉上居中（左右等宽）
            Text('')
              .width(64)
          }
          .width('100%')
          .padding(12)
        }

        if (this.statusIsProblem()) {
          Text(this.status)
            .fontSize(11)
            .fontColor(this.tk().error)
            .width('100%')
            .padding({ left: 12, right: 12, top: 4, bottom: 4 })
        }

        // 下拉刷新（原版 PullToRefreshContainer）
        Refresh({ refreshing: this.refreshing }) {
          Scroll() {
            Column() {
              if (this.list.length === 0) {
                if (this.busy) {
                  Row() {
                    LoadingProgress().width(28).height(28).color(this.tk().primary)
                  }
                  .width('100%')
                  .justifyContent(FlexAlign.Center)
                  .padding(24)
                } else {
                  this.emptyCard()
                }
              } else {
                ForEach(this.list, (a: EclassActivity) => {
                  this.activityCard(a)
                }, (a: EclassActivity) => a.id + '_' + a.courseId)
              }
            }
            .width('100%')
            .padding({ left: 10, right: 10, bottom: 88 })
          }
          .width('100%')
          .height('100%')
          .scrollBar(BarState.Off)
          // ⚠️ 顶部对齐必须加在 **Scroll 自身**：`.align()` 的语义是「组件内容在组件区域内的
          //    对齐方式」，Scroll 的内容才是它的子节点。加在子 Column 上不生效——
          //    内容不足一屏时会被垂直居中（2026-10-27 真机实证，DDL 页同病）。
          .align(Alignment.Top)
        }
        .onRefreshing(() => {
          this.refreshing = true;
          this.load();
        })
        .layoutWeight(1)
      }
      .width('100%')
      .height('100%')
      .backgroundColor(this.tk().background)

      // 原版「动态」只有一个 FAB：⚙ 设置（EclassActivityScreen.kt:164）
      FabColumn({ actions: this.fabActions() })
    }
    .width('100%')
    .height('100%')
  }
}
