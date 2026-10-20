/**
 * 「现在去哪儿自习」详情页（M3-4）
 *
 * 首页卡片一次只显示**一个**候选，这里看全貌：全部候选按「能坐多久」排序，
 * 连带把「为什么只有这些 / 为什么一个都没有」说清楚。
 *
 * ## 为什么不在这个页面重新算
 * 算一次要 20 秒（逐栋查空教室）。详情页只是换个视角看**同一个结果**，
 * 数据从 `StudySpotService.lastComputed()` 取 —— 走模块级缓存，不塞 router params
 * （plan 对象太大，塞 params 既笨重又可能丢字段）。
 *
 * 代价：进程被杀后直接进本页会看到「先回首页算一次」的空态。这是诚实的空态，
 * 比转 20 秒圈再显示要好。
 */

import { router } from '@kit.ArkUI';
import { StudySpotService, SpotResult } from '../service/StudySpotService.ts';
import {
  Plan, SpotOption, spotOptionTitle, spotOptionDetail
} from '../corelogic/StudySpotLogic.ts';
import { info } from '../core/log/BitLog.ts';

/** 一行候选（渲染用，已把文案算好，渲染期不再调函数）。 */
interface DetailRow {
  rank: number;
  title: string;
  detail: string;
}

@Entry
@Component
struct SpotDetailPage {
  @State metaText: string = '';
  @State errorText: string = '';
  @State errorKind: string = 'none';
  @State stale: boolean = false;
  @State courseTitle: string = '';
  @State coursePlace: string = '';
  @State courseEndsAt: string = '';
  @State rows: DetailRow[] = [];
  @State hasResult: boolean = false;

  aboutToAppear(): void {
    const r: SpotResult | null = StudySpotService.lastComputed();
    if (r === null) {
      this.hasResult = false;
      info('SpotDetailPage no cached result');
      return;
    }
    this.hasResult = true;
    this.metaText = r.meta;
    this.errorText = r.error;
    this.errorKind = r.errorKind;
    this.stale = r.staleTerm;

    const p: Plan | null = r.plan;
    if (p !== null) {
      this.courseTitle = p.courseTitle === null ? '' : p.courseTitle;
      this.coursePlace = p.coursePlace === null ? '' : p.coursePlace;
      this.courseEndsAt = p.courseEndsAt === null ? '' : p.courseEndsAt;
      const out: DetailRow[] = [];
      for (let i = 0; i < p.options.length; i++) {
        const o: SpotOption = p.options[i];
        const d: string | null = spotOptionDetail(o);
        out.push({
          rank: i + 1,
          title: spotOptionTitle(o),
          detail: d === null ? '' : d
        });
      }
      this.rows = out;
    }
    info('SpotDetailPage rows=' + this.rows.length + ' kind=' + this.errorKind +
      (this.stale ? ' staleTerm=yes' : ''));
  }

  build() {
    Column() {
      // 顶部
      Row() {
        Text('‹ 返回')
          .fontSize(14).fontColor('#4A6FD4')
          .onClick(() => {
            router.back();
          })
        Text('自习候选')
          .fontSize(16).fontWeight(FontWeight.Bold)
          .layoutWeight(1).textAlign(TextAlign.Center)
        // 占位，让标题真居中
        Text('    ').fontSize(14)
      }
      .width('100%')
      .padding({ left: 12, right: 12, top: 10, bottom: 10 })

      if (!this.hasResult) {
        Column() {
          Text('还没有算过')
            .fontSize(15).fontWeight(FontWeight.Medium).margin({ top: 40 })
          Text('请回首页点「算一下」，那里会逐栋查空教室（约 20 秒）')
            .fontSize(12).fontColor('#888888').margin({ top: 6 })
        }
        .width('100%').layoutWeight(1).justifyContent(FlexAlign.Start)
      } else {
        Scroll() {
          Column() {
            // 统计（栋数/间数/耗时），用来确认并发真的生效
            if (this.metaText.length > 0) {
              Text(this.metaText)
                .fontSize(10).fontColor('#AAAAAA').width('100%').margin({ bottom: 6 })
            }

            // 用的是上次课表缓存 ⇒ 必须标注
            if (this.stale) {
              Text('没确认到当前学期，下面按上次的课表算，周次可能不准')
                .fontSize(11).fontColor('#B45309').width('100%').margin({ bottom: 6 })
            }

            // 降级/失败原因：如实说，不装作数据完整
            if (this.errorText.length > 0) {
              Text(this.errorText)
                .fontSize(11)
                .fontColor(this.errorKind === 'none' ? '#B45309' : '#C62828')
                .width('100%').margin({ bottom: 8 })
            }

            // 当前课程（本地课表算出来的，断网也有）
            if (this.courseTitle.length > 0) {
              Column() {
                Text(this.courseTitle)
                  .fontSize(14).fontWeight(FontWeight.Medium).width('100%')
                if (this.coursePlace.length > 0) {
                  Text('在 ' + this.coursePlace +
                    (this.courseEndsAt.length > 0 ? ' · ' + this.courseEndsAt + ' 下课' : ''))
                    .fontSize(12).fontColor('#666666').width('100%').margin({ top: 2 })
                }
              }
              .width('100%')
              .padding(12)
              .backgroundColor('#F1F4FF')
              .borderRadius(8)
              .margin({ bottom: 10 })
            }

            // 候选列表
            if (this.rows.length === 0) {
              // 原因已经在上面渲染过时不要重复说一遍
              if (this.errorText.length === 0) {
                Text('暂时没有符合条件（连续空 2 节以上）的教室')
                  .fontSize(12).fontColor('#888888').width('100%').margin({ top: 4 })
              } else {
                Text('所以这次没有候选')
                  .fontSize(12).fontColor('#888888').width('100%').margin({ top: 4 })
              }
            } else {
              ForEach(this.rows, (row: DetailRow) => {
                Row() {
                  // 排名：卡片默认显示第 1 个，这里说明其余的顺序
                  Text(String(row.rank))
                    .fontSize(11).fontColor('#FFFFFF')
                    .width(18).height(18)
                    .textAlign(TextAlign.Center)
                    .backgroundColor(row.rank === 1 ? '#4A6FD4' : '#B9C4DC')
                    .borderRadius(9)
                  Column() {
                    Text(row.title)
                      .fontSize(14).fontColor('#222222').width('100%')
                    if (row.detail.length > 0) {
                      Text(row.detail)
                        .fontSize(11).fontColor('#888888').width('100%').margin({ top: 2 })
                    }
                  }
                  .layoutWeight(1)
                  .margin({ left: 10 })
                  .alignItems(HorizontalAlign.Start)
                }
                .width('100%')
                .padding({ top: 10, bottom: 10 })
                .border({ width: { bottom: 0.5 }, color: '#EFEFEF' })
              }, (row: DetailRow) => 'r_' + row.rank + '_' + row.title)
            }

            // 口径说明：候选是怎么筛出来的（避免用户以为这是全部空教室）
            Text('口径：只看连续空闲 ≥ 2 节的教室，每栋楼最多取 2 间、总数最多 8 个，按「能坐多久」排序。')
              .fontSize(10).fontColor('#AAAAAA').width('100%').margin({ top: 14, bottom: 20 })
          }
          .width('100%')
          .padding({ left: 12, right: 12 })
          .alignItems(HorizontalAlign.Start)
        }
        .layoutWeight(1)
        .scrollBar(BarState.Off)
        // ⚠️ 必须显式顶对齐：ArkUI 的 Scroll 在内容不足一屏时会把内容**垂直居中**，
        // 真机上表现为标题下面空出一大块（2026-10-20 截图看到，meta 距标题 419px）。
        .align(Alignment.Top)
      }
    }
    .width('100%').height('100%')
    .backgroundColor('#FFFFFF')
  }
}
