/**
 * 课程动态页（M4-4）：延河课堂活动流。
 *
 * 验收判据（ROADMAP §4 M4-4）：能列出活动标题/类型/时间。
 *
 * 数据：EclassService.fetchAllActivities（课程 → 逐课程 activities →
 * toActivities → recent 倒序截断）。类型标签用保守分类（认不出的归「动态」，
 * 不编造标签）；时间文案 agoText 现算。点击进 App 内 Web 壳（带会话）。
 */

import { Context } from '@kit.AbilityKit';
import { router } from '@kit.ArkUI';
import { palette, Palette } from '../core/theme/AppColors.ts';
import { STORAGE_DARK } from '../data/ThemeStore.ts';
import { EclassService } from '../service/EclassService.ts';
import { EclassActivity, activityKindLabel, ActivityKind } from '../corelogic/EclassActivityLogic.ts';
import { agoText } from '../corelogic/EclassActivityLogic.ts';
import type { DateTime } from '../corelogic/timeutil.ts';
import { info, warn } from '../core/log/BitLog.ts';

@Entry
@Component
struct EclassActivityPage {
  @StorageLink(STORAGE_DARK) isDark: boolean = false;

  @State list: EclassActivity[] = [];
  @State status: string = '';
  @State busy: boolean = false;
  @State hasSession: boolean = false;

  private p(): Palette {
    return palette(this.isDark);
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

  private async load(): Promise<void> {
    if (this.busy) {
      return;
    }
    this.busy = true;
    this.status = '正在拉取课程动态…';
    try {
      const ctx: Context = getContext(this) as Context;
      this.hasSession = await EclassService.hasSession();
      const r = await EclassService.fetchAllActivities(ctx, 60);
      this.list = r.list;
      this.status = r.list.length + ' 条动态' +
        (r.failedCourses > 0 ? '（' + r.failedCourses + ' 门课取数失败）' : '');
      info('eclass activities page n=' + r.list.length);
    } catch (e) {
      warn('eclass activities page fail: ' + (e as Error).message);
      this.status = '⚠️ ' + (e as Error).message;
    }
    this.busy = false;
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

  build() {
    // ⚠️ 不在 build() 根部声明局部变量（本编译器只认「根节点起手」，见 DdlPage 踩坑记录）。
    Column() {
      Row() {
        Button('‹ 返回')
          .onClick(() => {
            router.back();
          })
        Text('课程动态').fontSize(16).fontWeight(FontWeight.Bold).layoutWeight(1)
          .textAlign(TextAlign.Center)
        Button('刷新').fontSize(13)
          .enabled(!this.busy)
          .onClick(() => {
            this.load();
          })
      }.width('100%').padding(12)

      if (this.status.length > 0) {
        Text(this.status)
          .fontSize(11).fontColor(this.p().textMuted)
          .width('100%').padding({ left: 12, right: 12, top: 4 })
      }

      Scroll() {
        Column() {
          if (this.list.length === 0 && !this.busy) {
            if (!this.hasSession) {
              Text('还没有动态。需要先在延河课堂登录。')
                .fontSize(12).fontColor(this.p().textMuted).width('100%').padding(16)
              Button('去延河课堂登录')
                .fontSize(13).margin({ top: 8 })
                .backgroundColor(this.p().accent).fontColor(this.p().textOnAccent)
                .onClick(() => {
                  router.pushUrl({ url: 'pages/EclassLoginPage' }).catch((e: Error) => {
                    warn('activity -> eclass login fail: ' + JSON.stringify(e));
                  });
                })
            } else {
              Text('暂无动态（可能所有课都还没有发布过内容）。')
                .fontSize(12).fontColor(this.p().textMuted).width('100%').padding(16)
            }
          } else {
            ForEach(this.list, (a: EclassActivity) => {
              Column() {
                Row() {
                  Text(activityKindLabel(a.kind))
                    .fontSize(10)
                    .fontColor(a.kind === ActivityKind.HOMEWORK ? this.p().textOnAccent : this.p().textMuted)
                    .backgroundColor(a.kind === ActivityKind.HOMEWORK ? this.p().accent : this.p().bgAlt)
                    .padding({ left: 6, right: 6, top: 2, bottom: 2 })
                    .borderRadius(4)
                  Text(a.courseName)
                    .fontSize(10).fontColor(this.p().textFaint).layoutWeight(1)
                    .margin({ left: 6 })
                    .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
                  Text(agoText(a.time, this.now()))
                    .fontSize(10).fontColor(this.p().textFaint)
                }
                .width('100%')

                Text(a.title)
                  .fontSize(14).fontWeight(FontWeight.Medium)
                  .fontColor(this.p().textPrimary)
                  .width('100%').margin({ top: 4 })
              }
              .width('100%').padding(12).margin({ top: 8 })
              .backgroundColor(this.p().bgCard)
              .borderRadius(10)
              .onClick(() => {
                this.openActivity(a);
              })
            }, (a: EclassActivity) => a.id + '_' + a.courseId)
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
