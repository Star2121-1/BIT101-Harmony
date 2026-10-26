/**
 * StudySpotCard —— 「现在去哪儿自习」卡片（原版 ref-03：这张卡在**「我」页**，不在首页）。
 *
 * 逻辑从旧 `Index.ets` 原样搬来（一次都没改算法），只换了一层皮：
 * - 卡片底 `secondaryContainer`（ref-03 实测薄荷底），标题行左侧一个 8×8 primary 小方块
 *   （原版那个小色块），右侧「看详情 ›」；
 * - 主标题 15 Medium；副标题 12 `onSecondaryContainer`；
 * - 底部左「1/8」分页计数、右「换一个 ↻」。
 *
 * ⚠️ 降级路径必须保留：`spotPlan` 算不出来时卡片里装的是本地课表算出的信息 +
 *   一行原因，**不能因为查不了空教室就整块消失**（M3-5 的老要求）。
 * ⚠️ 错误去重：降级时 `card.detail` 本身就是原因文案，再渲染 `spotError` 会重复两遍。
 */

import { Context } from '@kit.AbilityKit';
import { router } from '@kit.ArkUI';
import { gridTokens } from '../../core/theme/GridTokens.ts';
import { STORAGE_DARK, STORAGE_PALETTE, getPalette } from '../../data/ThemeStore.ts';
import { StudySpotService } from '../../service/StudySpotService.ts';
import { Plan, SpotCard, studySpotCardOf } from '../../corelogic/StudySpotLogic.ts';

@Component
export struct StudySpotCard {
  @StorageLink(STORAGE_DARK) private isDark: boolean = false;
  @StorageLink(STORAGE_PALETTE) private paletteName: string = 'warm';

  @State private spotCard: SpotCard | null = null;
  @State private spotPlan: Plan | null = null;
  @State private spotError: string = '';
  @State private spotMeta: string = '';
  @State private spotLoading: boolean = false;
  @State private spotIdx: number = 0;
  /** 错误类别（'none'|'nologin'|'network'|...），决定给什么处置入口。 */
  @State private spotErrorKind: string = 'none';
  /** true = 用的是上次的课表缓存（当前学期没确认），必须标注周次可能不准。 */
  @State private spotStale: boolean = false;

  private tk() {
    return gridTokens(this.isDark, getPalette(this.paletteName));
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

  build() {
    Column() {
      // 标题行：小方块 + 「现在去哪儿自习」+ 右侧「看详情 ›」
      Row() {
        Column()
          .width(8)
          .height(8)
          .borderRadius(2)
          .backgroundColor(this.tk().primary)
          .margin({ right: 6 })
        Text('现在去哪儿自习')
          .fontSize(13)
          .fontColor(this.tk().onSecondaryContainer)
          .layoutWeight(1)
        if (this.spotPlan !== null && this.spotPlan.options.length > 0) {
          Text('看详情 ›')
            .fontSize(12)
            .fontColor(this.tk().onSecondaryContainer)
            .onClick(() => {
              this.go('pages/SpotDetailPage', '详情');
            })
        }
      }
      .width('100%')

      // 用上次课表算的：如实标注，不装作正常
      if (this.spotStale && !this.spotLoading) {
        Text('没确认到当前学期，下面按上次的课表算，周次可能不准')
          .fontSize(10).fontColor(this.tk().stateAttention).width('100%').margin({ top: 4 })
      }

      if (this.spotLoading) {
        Text('正在逐栋查空教室（约 20 秒）…')
          .fontSize(12).fontColor(this.tk().onSecondaryContainer)
          .width('100%').margin({ top: 10 })
      } else if (this.spotCard !== null) {
        Text(this.spotCard.title)
          .fontSize(20).fontWeight(FontWeight.Medium)
          .fontColor(this.tk().onSecondaryContainer)
          .width('100%').margin({ top: 10 })
        if (this.spotCard.detail !== null) {
          Text(this.spotCard.detail)
            .fontSize(12).fontColor(this.tk().onSecondaryContainer)
            .width('100%').margin({ top: 4 })
        }
        // 有 card 又有 error ⇒ 降级：说清缺了什么（与 detail 重复时不再渲染）
        if (this.spotError.length > 0 && this.spotError !== this.spotCard.detail) {
          Text(this.spotError)
            .fontSize(10).fontColor(this.tk().stateAttention).width('100%').margin({ top: 4 })
        }
      } else if (this.spotError.length > 0) {
        Text(this.spotError)
          .fontSize(12).fontColor(this.tk().error).width('100%').margin({ top: 10 })
      } else {
        Text('点「算一下」看看现在能去哪个教室')
          .fontSize(12).fontColor(this.tk().onSecondaryContainer)
          .width('100%').margin({ top: 10 })
      }

      // 底部：左分页计数 / 右动作
      Row() {
        Text(this.spotPlan !== null && this.spotPlan.options.length > 0
          ? (this.spotIdx % this.spotPlan.options.length + 1) + '/' + this.spotPlan.options.length
          : this.spotMeta)
          .fontSize(12).fontColor(this.tk().onSecondaryContainer)
          .layoutWeight(1)
        if (this.spotCard === null) {
          Text(this.spotLoading ? '计算中…' : '算一下')
            .fontSize(12).fontColor(this.tk().primary)
            .onClick(() => {
              if (!this.spotLoading) {
                this.computeSpot();
              }
            })
        } else {
          Text('换一个 ↻')
            .fontSize(12).fontColor(this.tk().primary)
            .onClick(() => {
              if (this.spotLoading) {
                return;
              }
              if (this.spotPlan !== null) {
                this.nextSpot();
              } else {
                this.computeSpot();
              }
            })
        }
      }
      .width('100%')
      .margin({ top: 10 })

      // 会话失效 ⇒ 直接给登录入口
      if (this.spotErrorKind === 'nologin') {
        Text('去登录 ›')
          .fontSize(12).fontColor(this.tk().primary)
          .width('100%').margin({ top: 8 })
          .onClick(() => {
            this.go('pages/LoginPage', '登录');
          })
      }
    }
    .width('100%')
    .padding({ left: 14, right: 14, top: 12, bottom: 12 })
    .borderRadius(10)
    .backgroundColor(this.tk().secondaryContainer)
    .alignItems(HorizontalAlign.Start)
  }
}
