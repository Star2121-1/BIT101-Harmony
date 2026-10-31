/**
 * 座位主页（M9）：校区/楼层/区域三级选择 → 当日座位快照 → 我的预约 / 取消。
 *
 * ## 设计纪律
 * - 树接口免认证（SeatTreeService），座位快照需 seatlib JWT（SeatService）。
 * - **取消预约有对外副作用**（铁律 0.6）：必须用户显式点击 + 二次确认，
 *   绝不在自动路径触发。本页只做「点一下进确认态、再点才真正调 cancel」。
 * - 违约 / 研讨间的数据源（SeatService.fetchDefaults / 研讨间接口）尚未接通，
 *   本页面**不强造假数据**，只如实标注「待接服务端接口」。
 * - ⚠️ 真机未验：设备离线中，取消/快照链路需设备恢复后回归。
 */

import { router } from '@kit.ArkUI';
import { Context } from '@kit.AbilityKit';
import { gridTokens } from '../core/theme/GridTokens.ts';
import { STORAGE_DARK, STORAGE_PALETTE, getPalette } from '../data/ThemeStore.ts';
import { SeatTreeNode } from '../model/SeatTreeModel.ts';
import { SeatService } from '../service/SeatService.ts';
import { SeatTreeService } from '../service/SeatTreeService.ts';
import { type DateTime } from '../corelogic/SeatLogic.ts';
import {
  groupTree, fmtMinutes,
  type CampusGroup, type FloorGroup, type AreaGroup,
} from '../corelogic/SeatViewLogic.ts';
import {
  type WireSeat, type MyReservation, type RenegeRecord, type MapPointVM,
  type SeatMapImages,
  wireStatusText, wireStatusColor, isFree, renegeText, renegeKey, WireSeatStatus, buildMapPoints,
  emptySeatMapImages, isSeatMapImagesEmpty,
} from '../corelogic/SeatApiLogic.ts';
import { warn } from '../core/log/BitLog.ts';
import { getTaskRepository } from '../data/SeatTaskStore.ts';
import { isTerminalStatus } from '../model/SeatTask.ts';

@Entry
@Component
export struct SeatPage {
  /** true = 被外壳（底部 tab）嵌入：不渲染返回键（原版这些是 pager 页签，没有页面级返回）。 */
  isEmbedded: boolean = false;

  @StorageLink(STORAGE_DARK) isDark: boolean = false;
  @StorageLink(STORAGE_PALETTE) paletteName: string = 'warm';

  /** 座位页两个视图（对齐原版顶部「预约/列表」双 chip）：'book' 预约 / 'list' 列表。 */
  @State seatTab: string = 'book';

  @State camps: CampusGroup[] = [];
  // ⚠️ 三级选择各用独立扁平 @State：ArkUI 里嵌套对象属性修改不触发刷新（除非 class+@Observed）
  @State selCampus: string = '';
  @State selFloor: string = '';
  @State selArea: string = '';
  @State treeLoading: boolean = true;
  @State treeErr: string = '';

  // 当前区域的座位（权威契约：/api/Seat/seat 按区域+时段取，无区域归属跨区混列）
  @State seats: WireSeat[] = [];
  @State seatsLoading: boolean = false;
  @State seatsErr: string = '';
  @State seatsLoaded: boolean = false;
  /** 座位视图模式：'list' 列表（默认）/ 'map' 点位（M9-3，buildMapPoints 百分比定位 + 实测底图裁图）。 */
  @State viewMode: string = 'list';

  // M9-3 区域底图（/api/seat/map 2026-10-22 真机实测：free/book/close/leave/use 五件套）
  @State mapImages: SeatMapImages = emptySeatMapImages();
  @State mapImgLoading: boolean = false;
  @State mapImgErr: string = '';
  /** 已加载过底图的区域 id（同区域不重复拉；切区域才重拉）。 */
  private mapLoadedArea: string = '';

  // 我的预约（权威列表：/api/index/subscribe；取消用 record.id 不是座位 id）
  @State mine: MyReservation[] = [];
  @State mineLoading: boolean = false;
  @State mineErr: string = '';

  @State nowText: string = '';
  @State myCount: number = 0;
  /** 取消二次确认态：null = 无；非 null = 正在等用户确认取消该预约记录。 */
  @State cancelTarget: string | null = null;
  @State cancelBusy: boolean = false;
  @State cancelResult: string = '';

  // 预约确认态（铁律 0.6 对称：点空闲座位 → 二次确认 → 才真调 confirm）
  @State reserveTarget: string | null = null;
  @State reserveBusy: boolean = false;
  @State reserveResult: string = '';

  // 我的违约记录（权威 wire：/api/Member/reneges type=1；rename 直出，不造数据）
  @State reneges: RenegeRecord[] = [];
  @State renLoading: boolean = false;
  @State renErr: string = '';
  /** 研讨间卡内的如实提示（研讨间接口未接通，铁律 0.9 不造假数据）。 */
  @State seminarHint: string = '';
  /** 任务卡操作结果提示（清除终态任务的条数）。 */
  @State taskHint: string = '';

  private svc: SeatService = new SeatService();
  private treeSvc: SeatTreeService = new SeatTreeService();

  /** 当前配色（语义色见 core/theme/GridTokens.ts；皮肤切换只换 token 档，页面不动）。 */
  private tk() {
    return gridTokens(this.isDark, getPalette(this.paletteName));
  }

  /** 当前时间（展示层 impure 边界，铁律 0.8：现算，不缓存）。 */
  private nowDt(): DateTime {
    const d: Date = new Date();
    const offsetMs: number = d.getTimezoneOffset() * 60000;
    return {
      day: Math.floor((d.getTime() - offsetMs) / 86400000),
      minutes: d.getHours() * 60 + d.getMinutes()
    };
  }

  /** 终态监控任务数（「已结束 N」；本地存储直出，不造数据）。 */
  private finishedTaskCount(): number {
    const all = getTaskRepository().getTasks();
    let n: number = 0;
    for (let i = 0; i < all.length; i++) {
      if (isTerminalStatus(all[i].status)) {
        n++;
      }
    }
    return n;
  }

  /** 清除终态任务记录（本地存储删除，无对外副作用；返回删除数供文案用）。 */
  private clearFinishedTasks(): void {
    const removed: number = getTaskRepository().clearFinished();
    this.taskHint = removed > 0 ? '已清除 ' + removed + ' 条结束的任务' : '没有可清除的任务';
  }

  /** 楼层列表（当前校区下）。 */
  private floorsOf(campusId: string): FloorGroup[] {
    for (let i = 0; i < this.camps.length; i++) {
      if (this.camps[i].id === campusId) {
        return this.camps[i].floors;
      }
    }
    return [];
  }

  /** 区域列表（当前楼层下）。 */
  private areasOf(floorId: string): AreaGroup[] {
    const floors: FloorGroup[] = this.selCampus.length > 0 ? this.floorsOf(this.selCampus) : [];
    for (let i = 0; i < floors.length; i++) {
      if (floors[i].id === floorId) {
        return floors[i].areas;
      }
    }
    return [];
  }

  aboutToAppear(): void {
    this.nowText = fmtMinutes(this.nowDt().minutes);
    this.loadTree();
  }

  private async loadTree(): Promise<void> {
    this.treeLoading = true;
    this.treeErr = '';
    try {
      const ctx: Context = getContext(this) as Context;
      const date: string = SeatTreeService.today();
      const nodes: SeatTreeNode[] = await this.treeSvc.fetchTree(ctx, date);
      this.camps = groupTree(nodes);
      if (this.camps.length > 0) {
        this.selCampus = this.camps[0].id;
      }
    } catch (e) {
      this.treeErr = '座位树加载失败：' + (e as Error).message;
    }
    this.treeLoading = false;
  }

  /** 选中区域 → 拉当日该区域的座位 + 我的预约。 */
  private async selectArea(areaId: string): Promise<void> {
    this.selArea = areaId;
    this.seatsErr = '';
    this.seats = [];
    this.seatsLoaded = false;
    this.cancelTarget = null;
    this.mineErr = '';
    this.mine = [];
    if (areaId.length === 0) {
      this.myCount = 0;
      return;
    }
    this.loadSeats();
    this.loadMyReservations();
    this.loadReneges();
  }

  private async loadSeats(): Promise<void> {
    this.seatsLoading = true;
    this.seatsErr = '';
    this.reserveTarget = null;
    this.reserveResult = '';
    try {
      const ctx: Context = getContext(this) as Context;
      const user = await SeatService.getSession(ctx);
      if (user === null) {
        this.seatsErr = '未登录（座位需要 seatlib 会话），先登录';
        this.seats = [];
        this.seatsLoaded = true;
        this.seatsLoading = false;
        return;
      }
      // 权威契约：/api/Seat/seat 按「区域 + 时段 + 日期 + 起讫时刻」取该区域的座位。
      // 时段：默认段 "1"（times[].id 实测恒 null，回落默认是正常路径）；
      // 起讫时刻：今天 00:00 → 24:00（服务端据此过滤状态，空时段照常返回全量）。
      const day: string = SeatTreeService.today();
      const res = await this.svc.fetchSeats(ctx, user.jwt, this.selArea, '', day, '00:00', '24:00');
      if (!res.ok) {
        this.seatsErr = (res.message ?? '').length > 0 ? res.message! : '座位拉取失败';
        this.seats = [];
      } else {
        this.seats = res.seats;
      }
      this.seatsLoaded = true;
    } catch (e) {
      this.seatsErr = '座位状态拉取失败：' + (e as Error).message;
      this.seats = [];
    }
    this.seatsLoading = false;
  }

  /**
   * 拉当前区域的底图五件套（M9-3，POST /api/seat/map）。
   * - 仅点位视图用；同区域不重复拉（URL 是原始事实，铁律 0.8 只缓存原始事实）。
   * - 失败/无图一律回落色块（mapLoadedArea 不记，下次切回会重试）。
   */
  private async loadMapImages(): Promise<void> {
    if (this.selArea.length === 0 || this.mapImgLoading) return;
    if (this.mapLoadedArea === this.selArea) return;
    this.mapImgLoading = true;
    this.mapImgErr = '';
    try {
      const ctx: Context = getContext(this) as Context;
      const user = await SeatService.getSession(ctx);
      if (user === null) {
        this.mapImgErr = '未登录，底图拉不了（先用色块）';
        this.mapImages = emptySeatMapImages();
        this.mapImgLoading = false;
        return;
      }
      const res = await this.svc.seatMap(ctx, user.jwt, this.selArea);
      if (res.ok && !isSeatMapImagesEmpty(res.images)) {
        this.mapImages = res.images;
        this.mapLoadedArea = this.selArea;
      } else {
        this.mapImages = emptySeatMapImages();
        this.mapImgErr = (res.message ?? '').length > 0 ? res.message! : '该区域没配底图（用色块）';
      }
    } catch (e) {
      warn('loadMapImages fail: ' + JSON.stringify(e));
      this.mapImgErr = '底图拉取异常（用色块）';
      this.mapImages = emptySeatMapImages();
    }
    this.mapImgLoading = false;
  }

  /** 拉「我的预约」权威列表（/api/index/subscribe，取消用这里的 record.id）。 */
  private async loadMyReservations(): Promise<void> {
    this.mineLoading = true;
    this.mineErr = '';
    try {
      const ctx: Context = getContext(this) as Context;
      const user = await SeatService.getSession(ctx);
      if (user === null) {
        this.mineErr = '未登录，未取到我的预约';
        this.mine = [];
        this.myCount = 0;
        this.mineLoading = false;
        return;
      }
      const res = await this.svc.myReservations(ctx, user.jwt);
      if (!res.ok) {
        this.mineErr = (res.message ?? '').length > 0 ? res.message! : '我的预约拉取失败';
        this.mine = [];
        this.myCount = 0;
      } else {
        this.mine = res.records;
        this.myCount = res.records.length;
      }
    } catch (e) {
      this.mineErr = '我的预约拉取失败：' + (e as Error).message;
      this.mine = [];
      this.myCount = 0;
    }
    this.mineLoading = false;
  }

  /** 点「取消」：先进确认态，不直接调接口。record.id 作取消目标。 */
  private requestCancel(recordId: string): void {
    this.cancelTarget = recordId;
    this.cancelResult = '';
  }

  /** 二次确认后才真正取消（有对外副作用，铁律 0.6）。取消接口传的是**预约记录 id**。 */
  private async confirmCancel(): Promise<void> {
    const rid: string | null = this.cancelTarget;
    if (rid === null) {
      return;
    }
    this.cancelBusy = true;
    this.cancelResult = '';
    try {
      const ctx: Context = getContext(this) as Context;
      const user = await SeatService.getSession(ctx);
      if (user === null) {
        this.cancelResult = '未登录，无法取消';
        this.cancelBusy = false;
        this.cancelTarget = null;
        return;
      }
      const res = await this.svc.cancelReservation(ctx, user.jwt, rid);
      this.cancelTarget = null;
      if (res.ok) {
        this.cancelResult = '已取消';
        await this.loadMyReservations();
      } else {
        this.cancelResult = res.message ?? '取消失败';
      }
    } catch (e) {
      this.cancelResult = '取消失败：' + (e as Error).message;
      this.cancelTarget = null;
    }
    this.cancelBusy = false;
  }

  /** 点空闲座位行：先进预约确认态，不直接调接口（铁律 0.6）。 */
  private requestReserve(seatId: string): void {
    this.reserveTarget = seatId;
    this.reserveResult = '';
  }

  /** 二次确认后才真正预约（有对外副作用，铁律 0.6）。
   *  权威契约 confirm 只传 {seat_id, segment}；segment 传 ''，buildConfirmBody 会回落默认段 "1"
   *  （times[].id 实测恒 null，回落是正常路径）。成功后刷新座位快照 + 我的预约。 */
  private async confirmReserve(): Promise<void> {
    const sid: string | null = this.reserveTarget;
    if (sid === null) {
      return;
    }
    this.reserveBusy = true;
    this.reserveResult = '';
    try {
      const ctx: Context = getContext(this) as Context;
      const user = await SeatService.getSession(ctx);
      if (user === null) {
        this.reserveResult = '未登录，无法预约';
        this.reserveBusy = false;
        this.reserveTarget = null;
        return;
      }
      const res = await this.svc.confirmSeat(ctx, user.jwt, sid, '');
      this.reserveTarget = null;
      if (res.ok) {
        this.reserveResult = '预约成功';
        await this.loadSeats();
        await this.loadMyReservations();
      } else {
        this.reserveResult = res.message ?? '预约失败';
      }
    } catch (e) {
      this.reserveResult = '预约失败：' + (e as Error).message;
      this.reserveTarget = null;
    }
    this.reserveBusy = false;
  }

  /** 拉我的违约记录（/api/Member/reneges type=1 座位；账号级，不按区域）。
   *  研讨间（type=2）与研讨间预约的 wire 字段未真机核对（铁律 0.9），本页不渲染，仅违约直出。 */
  private async loadReneges(): Promise<void> {
    this.renLoading = true;
    this.renErr = '';
    this.reneges = [];
    try {
      const ctx: Context = getContext(this) as Context;
      const user = await SeatService.getSession(ctx);
      if (user === null) {
        this.renErr = '未登录，未取到违约记录';
        this.renLoading = false;
        return;
      }
      const res = await this.svc.reneges(ctx, user.jwt, 1);
      if (!res.ok) {
        this.renErr = (res.message ?? '').length > 0 ? res.message! : '违约记录拉取失败';
      } else {
        this.reneges = res.records;
      }
    } catch (e) {
      this.renErr = '违约记录拉取失败：' + (e as Error).message;
    }
    this.renLoading = false;
  }

  build() {
    Column() {
      // 顶栏
      Row() {
        if (!this.isEmbedded) {
          Button('‹ 返回')
            .onClick(() => {
              router.back();
            })
        }
        Text('座位预约').fontSize(16).fontWeight(FontWeight.Bold).layoutWeight(1)
          .fontColor(this.tk().onSurface)
          .textAlign(TextAlign.Center)
        Text(this.nowText).fontSize(11).fontColor(this.tk().onSurfaceVariant)
      }
      .width('100%').padding(12)

      // 「预约 / 列表」双 chip（对齐原版顶部双 tab）
      Row() {
        SeatChip({
          label: '预约',
          selected: this.seatTab === 'book',
          onTap: () => {
            this.seatTab = 'book';
          },
        })
        SeatChip({
          label: '列表',
          selected: this.seatTab === 'list',
          onTap: () => {
            this.seatTab = 'list';
          },
        })
          .margin({ left: 8 })
      }
      .width('100%').padding({ left: 12, right: 12, bottom: 4 })

      Scroll() {
        Column() {
          if (this.seatTab === 'book') {
            // ── 三级选择 ──
            Text('选择场地（校区 / 楼层 / 区域）')
              .fontSize(12).fontColor(this.tk().onSurfaceVariant).width('100%')
            if (this.treeLoading) {
              Text('加载座位树…').fontSize(12).fontColor(this.tk().onSurfaceVariant).width('100%').margin({ top: 6 })
            } else if (this.treeErr.length > 0) {
              Text(this.treeErr).fontSize(11).fontColor(this.tk().error).width('100%').margin({ top: 6 })
            } else if (this.camps.length === 0) {
              Text('没有可用的座位树').fontSize(12).fontColor(this.tk().onSurfaceVariant).width('100%').margin({ top: 6 })
            } else {
              // 校区
              Text('校区').fontSize(11).fontColor(this.tk().textPlaceholder).width('100%').margin({ top: 8 })
              Flex({ wrap: FlexWrap.Wrap }) {
                ForEach(this.camps, (c: CampusGroup) => {
                  SeatChip({
                    label: c.name,
                    selected: this.selCampus === c.id,
                    onTap: () => {
                      this.selCampus = c.id;
                      this.selFloor = '';
                      this.selArea = '';
                    },
                  })
                }, (c: CampusGroup) => 'camp' + c.id)
              }
              .width('100%')

              // 楼层
              Text('楼层').fontSize(11).fontColor(this.tk().textPlaceholder).width('100%').margin({ top: 10 })
              Flex({ wrap: FlexWrap.Wrap }) {
                ForEach(this.floorsOf(this.selCampus), (f: FloorGroup) => {
                  SeatChip({
                    label: f.name,
                    selected: this.selFloor === f.id,
                    onTap: () => {
                      this.selFloor = f.id;
                      this.selArea = '';
                    },
                  })
                }, (f: FloorGroup) => 'floor' + f.id)
              }
              .width('100%')

              // 区域：没选楼层就不出现（2026-10-30 真机：未选楼层时留着光秃秃的「区域」一行）
              if (this.selFloor.length > 0) {
                Text('区域').fontSize(11).fontColor(this.tk().textPlaceholder).width('100%').margin({ top: 10 })
                if (this.areasOf(this.selFloor).length === 0) {
                  Text('该楼层暂无区域')
                    .fontSize(11).fontColor(this.tk().onSurfaceVariant).width('100%').margin({ top: 6 })
                } else {
                  Flex({ wrap: FlexWrap.Wrap }) {
                    ForEach(this.areasOf(this.selFloor), (a: AreaGroup) => {
                      SeatChip({
                        label: a.name,
                        selected: this.selArea === a.id,
                        onTap: () => {
                          this.selectArea(a.id);
                        },
                      })
                    }, (a: AreaGroup) => 'area' + a.id)
                  }
                  .width('100%')
                }
              }
            }

            // ── 座位状态（当前区域）：只在选了区域后出现，未选时整段不渲染（免得空标题）──
            if (this.selArea.length > 0) {
              Text('座位状态（' + this.selArea + '）')
                .fontSize(12).fontColor(this.tk().onSurfaceVariant).width('100%').margin({ top: 16 })
              if (this.seatsLoading) {
                Text('拉取座位状态…').fontSize(12).fontColor(this.tk().onSurfaceVariant).width('100%').margin({ top: 6 })
              } else if (this.seatsErr.length > 0) {
                Text(this.seatsErr).fontSize(11).fontColor(this.tk().error).width('100%').margin({ top: 6 })
              } else if (this.seats.length === 0) {
                Text('该区域暂未查到座位').fontSize(12).fontColor(this.tk().onSurfaceVariant).width('100%').margin({ top: 6 })
              } else {
                Text(this.freeText())
                  .fontSize(12).fontColor(this.tk().onSurfaceVariant).width('100%').margin({ top: 6 })
                // 视图切换（列表 / 点位）
                Row() {
                  SeatChip({
                    label: '列表',
                    selected: this.viewMode === 'list',
                    onTap: () => {
                      this.viewMode = 'list';
                    },
                  })
                  SeatChip({
                    label: '点位',
                    selected: this.viewMode === 'map',
                    onTap: () => {
                      this.viewMode = 'map';
                      this.loadMapImages();
                    },
                  })
                    .margin({ left: 8 })
                }
                .width('100%').margin({ top: 6 })
                if (this.viewMode === 'list') {
                  ForEach(this.seats, (s: WireSeat) => {
                    this.seatRow(s)
                  }, (s: WireSeat) => 'seat' + s.id)
                } else {
                  this.mapView()
                }
              }
            } else if (this.selFloor.length > 0) {
              Text('选择区域后显示座位状态')
                .fontSize(11).fontColor(this.tk().textPlaceholder).width('100%').margin({ top: 14 })
            }

            // ── 我的预约（权威列表 /api/index/subscribe）──
            Text('我的预约（' + this.myCount + '）')
              .fontSize(12).fontColor(this.tk().onSurfaceVariant).width('100%').margin({ top: 16 })
            if (this.mineLoading) {
              Text('拉取我的预约…').fontSize(11).fontColor(this.tk().onSurfaceVariant).width('100%').margin({ top: 4 })
            } else if (this.mineErr.length > 0) {
              Text(this.mineErr).fontSize(11).fontColor(this.tk().error).width('100%').margin({ top: 4 })
            }
            this.myBlock()

            // ── 取消确认条 ──
            if (this.cancelTarget !== null || this.cancelResult.length > 0) {
              this.cancelBlock()
            }

            // ── 预约确认条 ──
            if (this.reserveTarget !== null || this.reserveResult.length > 0) {
              this.reserveBlock()
            }

            Text('取消 / 预约为敏感操作，需设备端真机回归（当前离线未验）')
              .fontSize(10).fontColor(this.tk().textPlaceholder).width('100%').margin({ top: 12 })
          } else {
            // ── 列表视图（对齐原版 ref-05：违约卡 + 研讨间卡 + 预约任务卡 + 规则链接）──
            this.renCard()
            this.seminarCard()
            this.taskCard()
            Text('查看座位预约规则')
              .fontSize(12).fontColor(this.tk().primary).width('100%')
              .textAlign(TextAlign.Center).margin({ top: 16 })
              .onClick(() => {
                router.pushUrl({
                  url: 'pages/WebShellPage',
                  params: { url: 'https://seatlib.bit.edu.cn' },
                });
              })
          }
        }
        .width('100%').padding({ left: 12, right: 12, bottom: 24 })
      }
      .layoutWeight(1)
      // ⚠️ 顶对齐必须挂 Scroll 自身：加在内层 Column 上不生效（内容不足一屏会被垂直居中）
      .align(Alignment.Top)
    }
    .width('100%').height('100%')
    .backgroundColor(this.tk().background)
  }

  /** 单个座位行（纯渲染，无局部变量；状态色/文案走 SeatApiLogic）。
   *  空闲行整行可点（进预约确认态，铁律 0.6）；非空闲行不可点。 */
  @Builder
  seatRow(s: WireSeat) {
    Row() {
      Text('')
        .width(10).height(10).borderRadius(5)
        .backgroundColor(wireStatusColor(s.status))
      Text(s.no.length > 0 ? s.no : s.id)
        .fontSize(13).fontColor(this.tk().onSurface).margin({ left: 8 }).layoutWeight(1)
      if (isFree(s.status)) {
        Text('点我预约')
          .fontSize(11).fontColor(this.tk().primary)
      } else {
        Text(s.statusName.length > 0 ? s.statusName : wireStatusText(s.status))
          .fontSize(11).fontColor(this.tk().onSurfaceVariant)
      }
    }
    .width('100%').padding({ left: 12, right: 12, top: 10, bottom: 10 })
    .backgroundColor(this.tk().surface).borderRadius(12).margin({ top: 6 })
    .alignItems(VerticalAlign.Center)
    .opacity(isFree(s.status) ? 1 : 0.6)
    .onClick(() => {
      if (isFree(s.status) && this.reserveTarget === null && !this.reserveBusy) {
        this.requestReserve(s.id);
      }
    })
  }

  /** 空闲统计文案（现算，铁律 0.8）。 */
  private freeText(): string {
    let free = 0;
    for (let i = 0; i < this.seats.length; i++) {
      if (this.seats[i].status === WireSeatStatus.AVAILABLE) {
        free++;
      }
    }
    return '空闲 ' + free + '/' + this.seats.length;
  }

  /** 点位渲染规格（现算，铁律 0.8；buildMapPoints 过滤无坐标座位 + 百分比落值；
   *  mapImages 非空时按状态带裁图规格 tileUrl/imgScale/imgOffset）。 */
  private mapPoints(): MapPointVM[] {
    return buildMapPoints(this.seats, this.mapImages);
  }

  /** 点位视图（M9-3）：16:9 底图框 + 服务端坐标百分比定位的座位裁图。
   *  - 底图：mapImages.free（2026-10-22 真机实测五件套之一，承载房间轮廓/桌子/图例；
   *    五图的非座位区域一致，free 语义最中性 —— 对齐 Android SeatMapCanvas）。
   *  - 座位：色块兜底 + 状态图裁片覆盖（图没加载出来时色块照旧，不会出现「全绿」假态）；
   *    裁图 = 座位框内放一张容器全尺寸 Image，负偏移把对应区域移进框内
   *    （对齐 Android drawSeatTile 的 srcOffset/srcSize 裁剪）。
   *  - 点空闲座位进预约确认态（复用列表视图同一套 confirmSeat 链路，铁律 0.6）。 */
  @Builder
  mapView() {
    Column() {
      if (this.mapPoints().length === 0) {
        Text('该区域没有带坐标的座位，无法点位定位')
          .fontSize(11).fontColor(this.tk().onSurfaceVariant).width('100%').padding(12)
          .backgroundColor(this.tk().surfaceVariant).borderRadius(8)
      } else {
        Stack({ alignContent: Alignment.TopStart }) {
          // ① 底图：有 free 图铺真图，没有就露中性底（回落到纯色点位）
          if (this.mapImages.free.length > 0) {
            Image(this.mapImages.free)
              .width('100%').height('100%')
              .objectFit(ImageFit.Contain)
          } else {
            Row() {}
              .width('100%').height('100%')
              .backgroundColor(this.tk().surfaceVariant)
          }
          // ② 逐座位裁片
          ForEach(this.mapPoints(), (pm: MapPointVM) => {
            this.mapPointBlock(pm)
          }, (pm: MapPointVM) => 'pt' + pm.seatId)
        }
        .width('100%').aspectRatio(16 / 9)
        .clip(true).borderRadius(12)
        if (this.mapImgLoading) {
          Text('底图加载中…').fontSize(10).fontColor(this.tk().textPlaceholder).width('100%').margin({ top: 6 })
        } else if (this.mapImgErr.length > 0) {
          Text(this.mapImgErr).fontSize(10).fontColor(this.tk().textPlaceholder).width('100%').margin({ top: 6 })
        } else {
          Text('点位 = 座位状态（官方底图）；点空闲座位可预约')
            .fontSize(10).fontColor(this.tk().textPlaceholder).width('100%').margin({ top: 6 })
        }
      }
    }
    .width('100%').margin({ top: 8 })
  }

  /** 单个座位点位（百分比定位；空闲可点进预约确认，非空闲 0.5 透明不可点）。
   *  底层色块兜底，上层按状态裁官方底图（tileUrl 空 = 没图，只显示色块）。 */
  @Builder
  mapPointBlock(pm: MapPointVM) {
    Stack({ alignContent: Alignment.TopStart }) {
      // 兜底色块（裁图没加载出来时就是它，行为同 M9-3 之前）
      Text(pm.no)
        .fontSize(9).fontColor('#FFFFFF').textAlign(TextAlign.Center)
        .backgroundColor(pm.color)
        .borderRadius(2)
        .opacity(pm.reservable ? 1 : 0.5)
        .width('100%').height('100%')
      // 官方状态图裁片：容器全尺寸 + 负偏移回退（尺寸/偏移由纯逻辑层算好）
      if (pm.tileUrl.length > 0) {
        Image(pm.tileUrl)
          .width(pm.imgScaleX).height(pm.imgScaleY)
          .position({ x: pm.imgOffsetX, y: pm.imgOffsetY })
          .objectFit(ImageFit.Fill)
          .opacity(pm.reservable ? 1 : 0.85)
      }
    }
    .position({ x: pm.leftPct, y: pm.topPct })
    .width(pm.widthPct).height(pm.heightPct)
    .clip(true)
    .onClick(() => {
      if (pm.reservable && this.reserveTarget === null && !this.reserveBusy) {
        this.requestReserve(pm.seatId);
      }
    })
  }

  /** 我的预约区块（数据来自状态 this.mine，不在 ForEach 里重算）。 */
  @Builder
  myBlock() {
    Column() {
      ForEach(this.mine, (m: MyReservation) => {
        this.myResRow(m)
      }, (m: MyReservation) => 'myres' + m.id)
    }
    .width('100%')
  }

  /** 单条我的预约行。 */
  @Builder
  myResRow(m: MyReservation) {
    Row() {
      Text(m.seatNo.length > 0 ? m.seatNo : m.seatId)
        .fontSize(13).fontColor(this.tk().onSurface).layoutWeight(1)
      if (m.beginTime.length > 0) {
        Text(m.beginTime).fontSize(11).fontColor(this.tk().textPlaceholder)
      }
      Text(m.isActive ? '未签到' : m.statusName ?? m.status)
        .fontSize(10).fontColor(m.isActive ? this.tk().success : this.tk().onSurfaceVariant)
      if (m.isActive && this.cancelTarget === m.id) {
        Button('确认取消')
          .height(26).fontSize(11).margin({ left: 8 })
          .backgroundColor(this.tk().error).fontColor(this.tk().onError)
          .enabled(!this.cancelBusy)
          .onClick(() => {
            this.confirmCancel();
          })
      } else if (m.isActive) {
        Button('取消')
          .height(26).fontSize(11).margin({ left: 8 })
          .backgroundColor('#00000000').fontColor(this.tk().primary)
          .border({ width: 1, color: this.tk().primary })
          .onClick(() => {
            this.requestCancel(m.id);
          })
      }
    }
    .width('100%').padding({ left: 12, right: 12, top: 10, bottom: 10 }).margin({ top: 6 })
    .backgroundColor(this.tk().surface).borderRadius(12)
    .alignItems(VerticalAlign.Center)
  }

  /** 取消结果 / 确认提示条。 */
  @Builder
  cancelBlock() {
    Column() {
      if (this.cancelTarget !== null) {
        Text('确认取消该预约？此操作会释放座位，不可撤销。')
          .fontSize(11).fontColor(this.tk().stateAttention).width('100%')
      }
      if (this.cancelResult.length > 0) {
        Text(this.cancelResult).fontSize(11).fontColor(this.tk().onSurfaceVariant).width('100%').margin({ top: 4 })
      }
    }
    .width('100%').padding(10).margin({ top: 8 })
    .backgroundColor(this.tk().surfaceVariant).borderRadius(12)
  }

  /** 预约结果 / 确认提示条。 */
  @Builder
  reserveBlock() {
    Column() {
      if (this.reserveTarget !== null) {
        Text('确认预约该座位？预约后请在签到截止前刷卡，否则记违约。')
          .fontSize(11).fontColor(this.tk().stateAttention).width('100%')
        Button('确认预约')
          .height(26).fontSize(11).margin({ top: 6 })
          .backgroundColor(this.tk().primary).fontColor(this.tk().onPrimary)
          .enabled(!this.reserveBusy)
          .onClick(() => {
            this.confirmReserve();
          })
      }
      if (this.reserveResult.length > 0) {
        Text(this.reserveResult).fontSize(11).fontColor(this.tk().onSurfaceVariant).width('100%').margin({ top: 4 })
      }
    }
    .width('100%').padding(10).margin({ top: 8 })
    .backgroundColor(this.tk().surfaceVariant).borderRadius(12)
  }

  /** 违约卡（列表视图；对齐原版 ref-05：surfaceVariant 底 + 0/5 + 规则文案 + 刷新）。
   *  「5」是原版规则口径（累计 5 次暂停预约 7 天），写死不改。 */
  @Builder
  renCard() {
    Column() {
      Row() {
        Text('违约 ' + this.reneges.length + '/5')
          .fontSize(14).fontWeight(FontWeight.Bold)
          .fontColor(this.tk().onSurface).layoutWeight(1)
        Text('刷新')
          .fontSize(12).fontColor(this.tk().primary)
          .onClick(() => {
            this.loadReneges();
          })
      }
      .width('100%')

      if (this.renLoading) {
        Text('拉取违约记录…').fontSize(11).fontColor(this.tk().onSurfaceVariant).width('100%').margin({ top: 6 })
      } else if (this.renErr.length > 0) {
        Text(this.renErr).fontSize(11).fontColor(this.tk().error).width('100%').margin({ top: 6 })
      } else if (this.reneges.length === 0) {
        Text('暂无违约记录 · 累计 5 次将暂停预约 7 天')
          .fontSize(12).fontColor(this.tk().onSurfaceVariant).width('100%').margin({ top: 6 })
        Text('数据来自图书馆座位系统')
          .fontSize(10).fontColor(this.tk().textPlaceholder).width('100%').margin({ top: 2 })
      } else {
        ForEach(this.reneges, (r: RenegeRecord) => {
          this.renRow(r)
        }, (r: RenegeRecord) => 'ren' + renegeKey(r))
      }
    }
    .width('100%').padding(16).margin({ top: 10 })
    .backgroundColor(this.tk().surfaceVariant).borderRadius(12)
    .alignItems(HorizontalAlign.Start)
  }

  /** 研讨间卡（列表视图；对齐原版 ref-05 空态）。
   *  ⚠️ 研讨间 wire 字段未真机核对（铁律 0.9）⇒ 不渲染假列表、不放假刷新按钮，
   *  空态文案与原版一致，网页预约入口真实可用。 */
  @Builder
  seminarCard() {
    Column() {
      Text('我的研讨间预约')
        .fontSize(14).fontWeight(FontWeight.Bold)
        .fontColor(this.tk().onSurface).width('100%')
      Text('研讨间要按照「整间 + 时段 + 参与成员」提交申请，App 内还没做这一步；先用图书馆网页预约，约好后回到本页下拉刷新，就能在这里查看和取消。')
        .fontSize(12).fontColor(this.tk().onSurfaceVariant).width('100%').margin({ top: 6 })
      Row() {
        Button('去图书馆网页预约')
          .height(32).fontSize(12)
          .backgroundColor(this.tk().primary).fontColor(this.tk().onPrimary)
          .onClick(() => {
            router.pushUrl({
              url: 'pages/WebShellPage',
              params: { url: 'https://seatlib.bit.edu.cn' },
            });
          })
        Text('刷新')
          .fontSize(12).fontColor(this.tk().primary).margin({ left: 16 })
          .onClick(() => {
            // 研讨间接口未接通：不装能刷（铁律：假控件比没有更糟）
            this.seminarHint = '研讨间接口尚未接通（wire 字段未真机核对），暂时刷不出数据';
          })
      }
      .width('100%').margin({ top: 10 })
      if (this.seminarHint.length > 0) {
        Text(this.seminarHint)
          .fontSize(10).fontColor(this.tk().stateAttention).width('100%').margin({ top: 6 })
      }
    }
    .width('100%').padding(16).margin({ top: 10 })
    .backgroundColor(this.tk().surfaceVariant).borderRadius(12)
    .alignItems(HorizontalAlign.Start)
  }

  /** 预约任务卡（列表视图；对齐原版 ref-05：「抢到座位后会自动出现在『我的预约』里」）。
   *  点击进监控面板（M9-8）；「清除」删本地终态任务记录（本地存储，无对外副作用）。 */
  @Builder
  taskCard() {
    Column() {
      Row() {
        Text('预约任务')
          .fontSize(14).fontWeight(FontWeight.Bold)
          .fontColor(this.tk().onSurface).layoutWeight(1)
        Text('已结束 ' + this.finishedTaskCount())
          .fontSize(11).fontColor(this.tk().onSurfaceVariant).margin({ right: 12 })
        Text('清除')
          .fontSize(12).fontColor(this.tk().primary)
          .onClick(() => {
            this.clearFinishedTasks();
          })
        Text('∨').fontSize(12).fontColor(this.tk().textPlaceholder).margin({ left: 4 })
      }
      .width('100%')
      Text('抢到座位后会自动出现在「我的预约」里')
        .fontSize(12).fontColor(this.tk().onSurfaceVariant).width('100%').margin({ top: 6 })
      if (this.taskHint.length > 0) {
        Text(this.taskHint)
          .fontSize(10).fontColor(this.tk().textPlaceholder).width('100%').margin({ top: 6 })
      }
    }
    .width('100%').padding(16).margin({ top: 10 })
    .backgroundColor(this.tk().surfaceVariant).borderRadius(12)
    .alignItems(HorizontalAlign.Start)
    .onClick(() => {
      router.pushUrl({ url: 'pages/SeatMonitorPage' });
    })
  }

  /** 单条违约行（文案走 renegeText，wire 字段直出）。 */
  @Builder
  renRow(r: RenegeRecord) {
    Row() {
      Text(renegeText(r))
        .fontSize(12).fontColor(this.tk().onSurfaceVariant).layoutWeight(1)
    }
    .width('100%').padding({ left: 12, right: 12, top: 10, bottom: 10 })
    .backgroundColor(this.tk().surface).borderRadius(12).margin({ top: 6 })
    .alignItems(VerticalAlign.Center)
  }
}

/**
 * SeatChip —— 座位页筛选 chip（ref-05 实测口径，与 #86 交通页 ShuttleChip **不同**：
 * 原版交通页 chip 是透明底+描边款，座位页是实底款——以各自页面实测为准）：
 * 选中 = primaryContainer #F9DECC 底 + onPrimaryContainer 字；
 * 未选 = surfaceVariant #F4EFE8 底 + onSurfaceVariant 字；均无描边。
 * 高 32、圆角 8、左右内边距 16。
 */
@Component
struct SeatChip {
  @StorageLink(STORAGE_DARK) private isDark: boolean = false;
  @StorageLink(STORAGE_PALETTE) paletteName: string = 'warm';

  label: string = '';
  selected: boolean = false;
  onTap: () => void = () => {};

  private tk() {
    return gridTokens(this.isDark, getPalette(this.paletteName));
  }

  build() {
    Text(this.label)
      .fontSize(12)
      .fontColor(this.selected ? this.tk().onPrimaryContainer : this.tk().onSurfaceVariant)
      .padding({ left: 16, right: 16, top: 6, bottom: 6 })
      .borderRadius(8)
      .backgroundColor(this.selected ? this.tk().primaryContainer : this.tk().surfaceVariant)
      .onClick(() => {
        this.onTap();
      })
  }
}
