/**
 * 首页：业务入口 + 「现在去哪儿自习」
 *
 * M1/M2 阶段的调试入口（座位树只读探针、教务接口诊断、R1 风险闸、裸协议探针）
 * 已移到**设置页 → 开发者选项**（默认收起）。
 * 理由：那是验证件，不是功能；留在首页会让 App 看起来像半成品。
 * 相关 service 文件都保留，随时能复跑。
 */

import { Context } from '@kit.AbilityKit';
import { router } from '@kit.ArkUI';
import { palette, Palette } from '../core/theme/AppColors.ts';
import { STORAGE_DARK } from '../data/ThemeStore.ts';
import { StudySpotService } from '../service/StudySpotService.ts';
import { Plan, SpotCard, studySpotCardOf } from '../corelogic/StudySpotLogic.ts';
import { DdlStore } from '../data/DdlStore.ts';
import type { DdlEntry } from '../corelogic/DdlRules.ts';
import { deadlineShort, remainTime } from '../corelogic/DdlFormat.ts';
import type { DateTime } from '../corelogic/timeutil.ts';

@Entry
@Component
struct Index {
  /** 订阅全局深浅色（由设置页切换、AppStorage 广播）。 */
  @StorageLink(STORAGE_DARK) isDark: boolean = false;

  // 「现在去哪儿自习」
  @State spotCard: SpotCard | null = null;
  @State spotPlan: Plan | null = null;
  @State spotError: string = '';
  @State spotMeta: string = '';
  @State spotLoading: boolean = false;
  @State spotIdx: number = 0;
  /** 错误类别（'none'|'nologin'|'network'|...），决定给什么处置入口。 */
  @State spotErrorKind: string = 'none';
  /** true = 用的是上次的课表缓存（当前学期没确认），必须标注周次可能不准。 */
  @State spotStale: boolean = false;
  /** 未完成作业（M4-3 首页卡片用；从 DDLStore 读，杀进程不丢）。 */
  @State ddlTodo: DdlEntry[] = [];

  /** 当前配色（语义色见 core/theme/AppColors.ts）。 */
  private p(): Palette {
    return palette(this.isDark);
  }

  /** 算一次「现在去哪儿自习」（逐栋并发查空教室，约 15~20 秒）。 */
  private async computeSpot(): Promise<void> {
    this.spotLoading = true;
    this.spotError = '';
    try {
      const ctx: Context = getContext(this) as Context;
      const r = await StudySpotService.compute(ctx);
      this.spotPlan = r.plan;
      this.spotCard = r.card;
      this.spotError = r.error;
      this.spotErrorKind = r.errorKind;
      this.spotStale = r.staleTerm;
      this.spotMeta = r.meta;
      this.spotIdx = 0;
    } catch (e) {
      this.spotError = '算不出来：' + (e as Error).message;
      this.spotErrorKind = 'other';
      this.spotStale = false;
    }
    this.spotLoading = false;
  }

  /** 换一个候选（取模循环，不改变已算出的 plan）。 */
  private nextSpot(): void {
    if (this.spotPlan === null) {
      return;
    }
    this.spotIdx = this.spotIdx + 1;
    this.spotCard = studySpotCardOf(this.spotPlan, this.spotIdx);
  }

  private go(url: string, what: string): void {
    router.pushUrl({ url: url }).catch((e: Error) => {
      this.spotError = '跳转' + what + '失败：' + JSON.stringify(e);
    });
  }

  /** 本地「现在」（展示层 impure 边界：截止文案现算，铁律 0.8）。 */
  private nowDt(): DateTime {
    const d: Date = new Date();
    const offsetMs: number = d.getTimezoneOffset() * 60000;
    return {
      day: Math.floor((d.getTime() - offsetMs) / 86400000),
      minutes: d.getHours() * 60 + d.getMinutes()
    };
  }

  /** 重读未完成作业（进首页 + 从子页回来时都要刷）。 */
  private async reloadDdl(): Promise<void> {
    const all: DdlEntry[] = await DdlStore.load();
    this.ddlTodo = all.filter((e: DdlEntry) => !e.done);
  }

  onPageShow(): void {
    this.reloadDdl();
  }

  build() {
    Column() {
      // 四个业务入口（登录入口在设置页「账号」区；未登录时自习卡也会给「去登录」）
      Row() {
        Button('课表')
          .height(38).fontSize(13).layoutWeight(1)
          .backgroundColor(this.p().accent).fontColor(this.p().textOnAccent)
          .onClick(() => {
            this.go('pages/SchedulePage', '课表');
          })
        Button('空教室')
          .height(38).fontSize(13).layoutWeight(1)
          .backgroundColor(this.p().accent).fontColor(this.p().textOnAccent).margin({ left: 8 })
          .onClick(() => {
            this.go('pages/ClassroomPage', '空教室');
          })
        Button('班车')
          .height(38).fontSize(13).layoutWeight(1)
          .backgroundColor(this.p().accent).fontColor(this.p().textOnAccent).margin({ left: 8 })
          .onClick(() => {
            this.go('pages/ShuttlePage', '班车');
          })
        Button('设置')
          .height(38).fontSize(13).layoutWeight(1)
          .backgroundColor(this.p().accent).fontColor(this.p().textOnAccent).margin({ left: 8 })
          .onClick(() => {
            this.go('pages/SettingsPage', '设置');
          })
      }
      .width('100%')
      .padding({ left: 12, right: 12, top: 12, bottom: 4 })

      // 「现在去哪儿自习」卡片
      Column() {
        Row() {
          Text('现在去哪儿自习')
            .fontSize(14).fontWeight(FontWeight.Bold)
            .fontColor(this.p().textPrimary)
            .layoutWeight(1)
          if (this.spotMeta.length > 0) {
            Text(this.spotMeta).fontSize(9).fontColor(this.p().textFaint)
          }
        }
        .width('100%')

        // 用的是上次的课表缓存 ⇒ 必须标注，不许当正常结果展示
        if (this.spotStale && !this.spotLoading) {
          Text('没确认到当前学期，下面按上次的课表算，周次可能不准')
            .fontSize(10).fontColor(this.p().warn).width('100%').margin({ top: 4 })
        }

        if (this.spotLoading) {
          Text('正在逐栋查空教室（约 20 秒）…')
            .fontSize(12).fontColor(this.p().textMuted).width('100%').margin({ top: 6 })
        } else if (this.spotCard !== null) {
          // ⚠️ 卡片优先于错误：降级时 card 里装的是**本地课表算出来的信息**，
          // 不该因为「查不了空教室」就整块消失（M3-5）。
          Text(this.spotCard.title)
            .fontSize(15).fontWeight(FontWeight.Medium)
            .fontColor(this.p().textPrimary)
            .width('100%').margin({ top: 6 })
          if (this.spotCard.detail !== null) {
            Text(this.spotCard.detail)
              .fontSize(12).fontColor(this.p().textSecondary)
              .width('100%').margin({ top: 2 })
          }
          // 有 card 又有 error ⇒ 是降级：如实说清缺了什么，不装作一切正常。
          // ⚠️ 去重：降级时 card.detail 本身就是原因文案，再渲染一次会连着出现两遍。
          if (this.spotError.length > 0 && this.spotError !== this.spotCard.detail) {
            Text(this.spotError)
              .fontSize(10).fontColor(this.p().warn).width('100%').margin({ top: 4 })
          }
        } else if (this.spotError.length > 0) {
          Text(this.spotError)
            .fontSize(12).fontColor(this.p().error).width('100%').margin({ top: 6 })
        } else {
          Text('点「算一下」看看现在能去哪个教室')
            .fontSize(12).fontColor(this.p().textMuted).width('100%').margin({ top: 6 })
        }

        Row() {
          Button(this.spotCard === null ? '算一下' : '重新算')
            .height(30).fontSize(12)
            .backgroundColor(this.p().accent).fontColor(this.p().textOnAccent)
            .enabled(!this.spotLoading)
            .onClick(() => {
              this.computeSpot();
            })
          if (this.spotPlan !== null && this.spotPlan.options.length > 1) {
            Button('换一个')
              .height(30).fontSize(12)
            .backgroundColor(this.p().accent).fontColor(this.p().textOnAccent).margin({ left: 8 })
              .onClick(() => {
                this.nextSpot();
              })
          }
          // 卡片只显示一个候选；排名全貌在详情页（M3-4）
          if (this.spotPlan !== null && this.spotPlan.options.length > 0) {
            Button('全部 ' + this.spotPlan.options.length + ' 个')
              .height(30).fontSize(12)
            .backgroundColor(this.p().accent).fontColor(this.p().textOnAccent).margin({ left: 8 })
              .onClick(() => {
                this.go('pages/SpotDetailPage', '详情');
              })
          }
          // 会话失效 ⇒ 直接把登录入口给到手，别让用户自己去找
          if (this.spotErrorKind === 'nologin') {
            Button('去登录')
              .height(30).fontSize(12)
            .backgroundColor(this.p().accent).fontColor(this.p().textOnAccent).margin({ left: 8 })
              .onClick(() => {
                this.go('pages/LoginPage', '登录');
              })
          }
        }
        .margin({ top: 8 })
      }
      .width('100%')
      .padding(12)
      .margin({ left: 12, right: 12, top: 10 })
      .backgroundColor(this.p().bgCard)
      .borderRadius(10)
      .alignItems(HorizontalAlign.Start)

      // 作业卡片（M4-3：最近一个未完成作业 + 计数；点整卡进 DDL 页）
      if (this.ddlTodo.length > 0) {
        Column() {
          Row() {
            Text('作业')
              .fontSize(14).fontWeight(FontWeight.Bold)
              .fontColor(this.p().textPrimary)
              .layoutWeight(1)
            Text(this.ddlTodo.length + ' 项未完成')
              .fontSize(9).fontColor(this.p().textFaint)
          }
          .width('100%')

          Text(this.ddlTodo[0].title)
            .fontSize(15).fontWeight(FontWeight.Medium)
            .fontColor(this.p().textPrimary)
            .width('100%').margin({ top: 6 })
          Text((this.ddlTodo[0].text.length > 0 ? this.ddlTodo[0].text + ' · ' : '') +
            deadlineShort({ day: this.ddlTodo[0].day, minutes: this.ddlTodo[0].minutes }) +
            ' · ' + remainTime({ day: this.ddlTodo[0].day, minutes: this.ddlTodo[0].minutes }, this.nowDt()))
            .fontSize(12).fontColor(this.p().textSecondary)
            .width('100%').margin({ top: 2 })

          Button('看全部')
            .height(30).fontSize(12).margin({ top: 8 })
            .backgroundColor(this.p().accent).fontColor(this.p().textOnAccent)
            .onClick(() => {
              this.go('pages/DdlPage', '作业');
            })
        }
        .width('100%')
        .padding(12)
        .margin({ left: 12, right: 12, top: 10 })
        .backgroundColor(this.p().bgCard)
        .borderRadius(10)
        .alignItems(HorizontalAlign.Start)
        .onClick(() => {
          this.go('pages/DdlPage', '作业');
        })
      }

      // 底部留白 + 一句说明（首页内容还少，空着比堆调试入口好）
      Column() {
        Text('课表、空教室、班车都在上面。更多功能在推进中。')
          .fontSize(11).fontColor(this.p().textMuted)
          .width('100%').textAlign(TextAlign.Center)
      }
      .width('100%')
      .layoutWeight(1)
      .padding({ top: 24, left: 24, right: 24 })
      .justifyContent(FlexAlign.Start)
    }
    .width('100%')
    .height('100%')
    .backgroundColor(this.p().bgPage)
  }
}
