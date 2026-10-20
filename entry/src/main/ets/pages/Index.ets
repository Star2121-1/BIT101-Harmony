import { Context } from '@kit.AbilityKit';
import { router } from '@kit.ArkUI';
import { SeatTreeNode } from '../model/SeatTreeModel.ts';
import { SeatTreeService } from '../service/SeatTreeService.ts';
import { JxzxProbe } from '../service/JxzxProbe.ts';
import { StudySpotService } from '../service/StudySpotService.ts';
import { Plan, SpotCard, studySpotCardOf } from '../corelogic/StudySpotLogic.ts';

@Entry
@Component
struct Index {
  @State status: string = '尚未查询';
  @State detail: string = '';
  @State nodes: string[] = [];
  @State loading: boolean = false;
  // 「现在去哪儿自习」
  @State spotCard: SpotCard | null = null;
  @State spotPlan: Plan | null = null;
  @State spotError: string = '';
  @State spotMeta: string = '';
  @State spotLoading: boolean = false;
  @State spotIdx: number = 0;
  private service: SeatTreeService = new SeatTreeService();

  /** type → 中文层级标签（对齐 Android 实测：0=校区/楼层，1=区域）。 */
  private typeLabel(type: number): string {
    return type === 1 ? '区域' : '校区/楼层';
  }

  /** 冷启动自动查一次（免手点按钮，直接产 M1 验收证据）。 */
  aboutToAppear(): void {
    this.doQuery();
  }

  /** 算一次「现在去哪儿自习」（逐栋并发查空教室，约 20 秒）。 */
  private async computeSpot(): Promise<void> {
    this.spotLoading = true;
    this.spotError = '';
    try {
      const ctx: Context = getContext(this) as Context;
      const r = await StudySpotService.compute(ctx);
      this.spotPlan = r.plan;
      this.spotCard = r.card;
      this.spotError = r.error;
      this.spotMeta = r.meta;
      this.spotIdx = 0;
    } catch (e) {
      this.spotError = '算不出来：' + (e as Error).message;
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

  build() {
    Column() {
      // M2 主入口：登录 + 课表（业务能力，不再是探针）
      Row() {
        Button('登录')
          .height(38)
          .fontSize(13)
          .layoutWeight(1)
          .onClick(() => {
            router.pushUrl({ url: 'pages/LoginPage' }).catch((e: Error) => {
              this.detail = '跳转登录失败：' + JSON.stringify(e);
            });
          })
        Button('课表')
          .height(38)
          .fontSize(13)
          .layoutWeight(1)
          .margin({ left: 8 })
          .onClick(() => {
            router.pushUrl({ url: 'pages/SchedulePage' }).catch((e: Error) => {
              this.detail = '跳转课表失败：' + JSON.stringify(e);
            });
          })
        Button('空教室')
          .height(38)
          .fontSize(13)
          .layoutWeight(1)
          .margin({ left: 8 })
          .onClick(() => {
            router.pushUrl({ url: 'pages/ClassroomPage' }).catch((e: Error) => {
              this.detail = '跳转空教室失败：' + JSON.stringify(e);
            });
          })
        Button('班车')
          .height(38)
          .fontSize(13)
          .layoutWeight(1)
          .margin({ left: 8 })
          .onClick(() => {
            router.pushUrl({ url: 'pages/ShuttlePage' }).catch((e: Error) => {
              this.detail = '跳转班车失败：' + JSON.stringify(e);
            });
          })
      }
      .width('100%')
      .padding({ left: 12, right: 12, top: 12, bottom: 4 })

      // 「现在去哪儿自习」卡片（M3-3）
      Column() {
        Row() {
          Text('现在去哪儿自习')
            .fontSize(14).fontWeight(FontWeight.Bold).layoutWeight(1)
          if (this.spotMeta.length > 0) {
            Text(this.spotMeta).fontSize(9).fontColor('#AAAAAA')
          }
        }
        .width('100%')

        if (this.spotLoading) {
          Text('正在逐栋查空教室（约 20 秒）…')
            .fontSize(12).fontColor('#888888').width('100%').margin({ top: 6 })
        } else if (this.spotError.length > 0) {
          Text(this.spotError)
            .fontSize(12).fontColor('#C62828').width('100%').margin({ top: 6 })
        } else if (this.spotCard !== null) {
          Text(this.spotCard.title)
            .fontSize(15).fontWeight(FontWeight.Medium).width('100%').margin({ top: 6 })
          if (this.spotCard.detail !== null) {
            Text(this.spotCard.detail)
              .fontSize(12).fontColor('#666666').width('100%').margin({ top: 2 })
          }
        } else {
          Text('点「算一下」看看现在能去哪个教室')
            .fontSize(12).fontColor('#888888').width('100%').margin({ top: 6 })
        }

        Row() {
          Button(this.spotCard === null ? '算一下' : '重新算')
            .height(30).fontSize(12)
            .enabled(!this.spotLoading)
            .onClick(() => {
              this.computeSpot();
            })
          if (this.spotPlan !== null && this.spotPlan.options.length > 1) {
            Button('换一个')
              .height(30).fontSize(12)
              .margin({ left: 8 })
              .onClick(() => {
                this.nextSpot();
              })
          }
        }
        .margin({ top: 8 })
      }
      .width('100%')
      .padding(12)
      .margin({ left: 12, right: 12, top: 10 })
      .backgroundColor('#FFFFFF')
      .borderRadius(10)
      .alignItems(HorizontalAlign.Start)

      // 顶部：操作区
      Row() {
        Text('seatlib 座位树（M1 只读探针）')
          .fontSize(16)
          .fontWeight(FontWeight.Bold)
          .layoutWeight(1)
        Button('查今天')
          .onClick(() => {
            this.doQuery();
          })
          .margin({ left: 8 })
      }
      .width('100%')
      .padding(12)

      // M2 诊断：教务接口 403 变体矩阵（结果写沙箱 jxzx_probe.txt）
      Row() {
        Text('教务接口诊断（403 变体矩阵）')
          .fontSize(13).fontColor('#666666').layoutWeight(1)
        Button('跑一遍')
          .onClick(() => {
            this.runJxzxProbe();
          })
          .margin({ left: 8 })
      }
      .width('100%')
      .padding({ left: 12, right: 12, top: 4, bottom: 4 })

      // M1 R1 风险闸入口：跳转 CAS 登录页探针（验证 Web 组件能否渲染表单，不碰凭据）
      Row() {
        Text('M1 · R1 风险闸：CAS 登录页 Web 组件渲染探测')
          .fontSize(13)
          .fontColor('#666666')
          .layoutWeight(1)
        Button('打开探针')
          .onClick(() => {
            router.pushUrl({ url: 'pages/CasLoginProbe' }).catch((e: Error) => {
              this.detail = '跳转探针失败：' + JSON.stringify(e);
            });
          })
          .margin({ left: 8 })
      }
      .width('100%')
      .padding({ left: 12, right: 12, top: 4, bottom: 4 })

      // 裸协议探针入口：纯 HTTP 取 CAS 页 + 解析锚点 + AES 自证（零凭据、单发、可删）
      Row() {
        Text('裸协议探针（阶段A）：rcp 取页 + AES 向量自证')
          .fontSize(13)
          .fontColor('#666666')
          .layoutWeight(1)
        Button('跑阶段A')
          .onClick(() => {
            router.pushUrl({ url: 'pages/CasProbePage' }).catch((e: Error) => {
              this.detail = '跳转探针失败：' + JSON.stringify(e);
            });
          })
          .margin({ left: 8 })
      }
      .width('100%')
      .padding({ left: 12, right: 12, top: 4, bottom: 4 })

      // 状态条
      Row() {
        Text(this.status)
          .fontSize(14)
          .layoutWeight(1)
        if (this.loading) {
          Text('…').fontSize(14)
        }
      }
      .width('100%')
      .padding({ left: 12, right: 12, top: 4, bottom: 4 })

      // 结果明细
      if (this.detail.length > 0) {
        Text(this.detail)
          .fontSize(12)
          .fontColor('#666666')
          .padding({ left: 12, right: 12 })
      }

      // 节点列表
      List() {
        ForEach(this.nodes, (line: string, index: number) => {
          ListItem() {
            Text(line)
              .fontSize(14)
              .width('100%')
              .padding({ left: 12, right: 12, top: 8, bottom: 8 })
          }
          .border({ width: { bottom: 0.5 }, color: '#EEEEEE' })
        }, (line: string, index: number) => index.toString() + '_' + line)
      }
      .layoutWeight(1)
    }
    .width('100%')
    .height('100%')
  }

  private async runJxzxProbe(): Promise<void> {
    this.status = '教务诊断中…';
    this.detail = '';
    try {
      const ctx: Context = getContext(this) as Context;
      const report: string = await JxzxProbe.run(ctx);
      this.status = '✅ 诊断完成（结果已写入 jxzx_probe.txt）';
      this.detail = report;
    } catch (e) {
      this.status = '❌ 诊断失败';
      this.detail = JSON.stringify(e);
    }
  }

  private async doQuery(): Promise<void> {
    this.loading = true;
    this.status = '查询中…';
    this.nodes = [];
    this.detail = '';
    try {
      const ctx: Context = getContext(this) as Context;
      const date: string = SeatTreeService.today();
      const result: SeatTreeNode[] = await this.service.fetchTree(ctx, date);
      // 取前 30 条展示（M1 探针只需证明「真机上能看到数据」）
      const lines: string[] = [];
      const cap: number = Math.min(result.length, 30);
      for (let i = 0; i < cap; i++) {
        const n: SeatTreeNode = result[i];
        lines.push(n.name + '（' + n.id + ' / ' + this.typeLabel(n.type) +
          (n.imageUrl !== null ? ' · 有图' : '') + '）');
      }
      this.nodes = lines;
      this.detail = 'date=' + date + '  共 ' + result.length + ' 节点' +
        (result.length > cap ? '（显示前 ' + cap + '）' : '');
      this.status = '✅ 已验：seatlib Seat/tree 通';
    } catch (e) {
      this.status = '❌ 失败';
      this.detail = 'date=' + SeatTreeService.today() + '  错误：' + JSON.stringify(e);
    }
    this.loading = false;
  }
}
