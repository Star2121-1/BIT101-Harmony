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
import { palette, Palette } from '../core/theme/AppColors.ts';
import { STORAGE_DARK } from '../data/ThemeStore.ts';
import { SeatTreeNode } from '../model/SeatTreeModel.ts';
import { SeatService } from '../service/SeatService.ts';
import { SeatTreeService } from '../service/SeatTreeService.ts';
import {
  type SeatSnapshot, type DateTime,
} from '../corelogic/SeatLogic.ts';
import {
  groupTree,
  toSeatVM, summarizeSeats, myReservations,
  fmtMinutes,
  type CampusGroup, type FloorGroup, type AreaGroup,
  type SeatVM, type SeatSummaryVM, type MyReservationVM,
} from '../corelogic/SeatViewLogic.ts';

@Entry
@Component
struct SeatPage {
  @StorageLink(STORAGE_DARK) isDark: boolean = false;

  @State camps: CampusGroup[] = [];
  // ⚠️ 三级选择各用独立扁平 @State：ArkUI 里嵌套对象属性修改不触发刷新（除非 class+@Observed）
  @State selCampus: string = '';
  @State selFloor: string = '';
  @State selArea: string = '';
  @State treeLoading: boolean = true;
  @State treeErr: string = '';

  @State seats: SeatSnapshot[] = [];
  @State seatVMs: SeatVM[] = [];
  @State summary: SeatSummaryVM = { total: 0, free: 0, yours: 0, others: 0, freeRatio: '暂无座位' };
  @State mine: MyReservationVM[] = [];
  @State seatsLoading: boolean = false;
  @State seatsErr: string = '';
  @State seatsLoaded: boolean = false;

  @State nowText: string = '';
  @State myCount: number = 0;
  /** 取消二次确认态：null = 无；非 null = 正在等用户确认取消该预约。 */
  @State cancelTarget: string | null = null;
  @State cancelBusy: boolean = false;
  @State cancelResult: string = '';

  private svc: SeatService = new SeatService();
  private treeSvc: SeatTreeService = new SeatTreeService();

  private p(): Palette {
    return palette(this.isDark);
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

  /** 选中区域 → 拉当日座位快照。 */
  private async selectArea(areaId: string): Promise<void> {
    this.selArea = areaId;
    this.seatsErr = '';
    this.seats = [];
    this.seatsLoaded = false;
    if (areaId.length === 0) {
      this.myCount = 0;
      return;
    }
    this.loadSeats();
  }

  private async loadSeats(): Promise<void> {
    this.seatsLoading = true;
    this.seatsErr = '';
    try {
      const ctx: Context = getContext(this) as Context;
      const date: string = SeatTreeService.today();
      const user = await SeatService.getUserInfo(ctx);
      if (user === null) {
        this.seatsErr = '未登录（座位需要 seatlib 会话），先登录';
        this.seats = [];
        this.seatVMs = [];
        this.summary = { total: 0, free: 0, yours: 0, others: 0, freeRatio: '暂无座位' };
        this.mine = [];
        this.myCount = 0;
        this.seatsLoaded = true;
        this.seatsLoading = false;
        return;
      }
      const snaps: SeatSnapshot[] = await this.svc.fetchSeats(ctx, date, user.jwt);
      // ⚠️ 如实：快照不带区域归属（服务端没给 areaId），本页列出全部座位，
      // 不假装「只看当前区域」。
      this.seats = snaps;
      this.seatVMs = snaps.map((s: SeatSnapshot): SeatVM => toSeatVM(s));
      this.summary = summarizeSeats(snaps);
      this.mine = myReservations(snaps, this.nowDt());
      this.myCount = this.mine.length;
      this.seatsLoaded = true;
      this.cancelTarget = null;
    } catch (e) {
      this.seatsErr = '座位状态拉取失败：' + (e as Error).message;
      this.seats = [];
      this.seatVMs = [];
      this.mine = [];
      this.myCount = 0;
    }
    this.seatsLoading = false;
  }

  /** 点「取消」：先进确认态，不直接调接口。 */
  private requestCancel(reservationId: string): void {
    this.cancelTarget = reservationId;
    this.cancelResult = '';
  }

  /** 二次确认后才真正取消（有对外副作用）。 */
  private async confirmCancel(): Promise<void> {
    const rid: string | null = this.cancelTarget;
    if (rid === null) {
      return;
    }
    this.cancelBusy = true;
    this.cancelResult = '';
    try {
      // 找到这条预约对应的 seatId（取消接口要 seat_id + reservation_id）
      let seatId: string = '';
      for (let i = 0; i < this.seats.length; i++) {
        const s: SeatSnapshot = this.seats[i];
        if (s.reservationId === rid) {
          seatId = s.seatId;
          break;
        }
      }
      if (seatId.length === 0) {
        this.cancelResult = '找不到该预约对应的座位，无法取消';
        this.cancelBusy = false;
        this.cancelTarget = null;
        return;
      }
      const ctx: Context = getContext(this) as Context;
      const user = await SeatService.getUserInfo(ctx);
      if (user === null) {
        this.cancelResult = '未登录，无法取消';
        this.cancelBusy = false;
        this.cancelTarget = null;
        return;
      }
      const msg: string | null = await this.svc.cancel(ctx, {
        reservationId: rid,
        seatId: seatId,
      }, user.jwt);
      this.cancelTarget = null;
      if (msg === null) {
        this.cancelResult = '已取消';
        await this.loadSeats();
      } else {
        this.cancelResult = msg;
      }
    } catch (e) {
      this.cancelResult = '取消失败：' + (e as Error).message;
      this.cancelTarget = null;
    }
    this.cancelBusy = false;
  }

  build() {
    Column() {
      // 顶栏
      Row() {
        Button('‹ 返回')
          .onClick(() => {
            router.back();
          })
        Text('座位预约').fontSize(16).fontWeight(FontWeight.Bold).layoutWeight(1)
          .textAlign(TextAlign.Center)
        Text(this.nowText).fontSize(11).fontColor(this.p().textMuted)
      }
      .width('100%').padding(12)

      Scroll() {
        Column() {
          // ── 三级选择 ──
          Text('选择场地（校区 / 楼层 / 区域）')
            .fontSize(12).fontColor(this.p().textMuted).width('100%')
          if (this.treeLoading) {
            Text('加载座位树…').fontSize(12).fontColor(this.p().textMuted).width('100%').margin({ top: 6 })
          } else if (this.treeErr.length > 0) {
            Text(this.treeErr).fontSize(11).fontColor(this.p().error).width('100%').margin({ top: 6 })
          } else if (this.camps.length === 0) {
            Text('没有可用的座位树').fontSize(12).fontColor(this.p().textMuted).width('100%').margin({ top: 6 })
          } else {
            // 校区
            Text('校区').fontSize(11).fontColor(this.p().textFaint).width('100%').margin({ top: 8 })
            Flex({ wrap: FlexWrap.Wrap }) {
              ForEach(this.camps, (c: CampusGroup) => {
                Text(c.name)
                  .fontSize(12).padding({ left: 10, right: 10, top: 5, bottom: 5 })
                  .margin(3).borderRadius(6)
                  .fontColor(this.selCampus === c.id ? this.p().textOnAccent : this.p().textSecondary)
                  .backgroundColor(this.selCampus === c.id ? this.p().accent : this.p().bgAlt)
                  .onClick(() => {
                    this.selCampus = c.id;
                    this.selFloor = '';
                    this.selArea = '';
                  })
              }, (c: CampusGroup) => 'camp' + c.id)
            }
            .width('100%')

            // 楼层
            Text('楼层').fontSize(11).fontColor(this.p().textFaint).width('100%').margin({ top: 10 })
            Flex({ wrap: FlexWrap.Wrap }) {
              ForEach(this.floorsOf(this.selCampus), (f: FloorGroup) => {
                Text(f.name)
                  .fontSize(12).padding({ left: 10, right: 10, top: 5, bottom: 5 })
                  .margin(3).borderRadius(6)
                  .fontColor(this.selFloor === f.id ? this.p().textOnAccent : this.p().textSecondary)
                  .backgroundColor(this.selFloor === f.id ? this.p().accent : this.p().bgAlt)
                  .onClick(() => {
                    this.selFloor = f.id;
                    this.selArea = '';
                  })
              }, (f: FloorGroup) => 'floor' + f.id)
            }
            .width('100%')

            // 区域
            Text('区域').fontSize(11).fontColor(this.p().textFaint).width('100%').margin({ top: 10 })
            Flex({ wrap: FlexWrap.Wrap }) {
              ForEach(this.areasOf(this.selFloor), (a: AreaGroup) => {
                Text(a.name)
                  .fontSize(12).padding({ left: 10, right: 10, top: 5, bottom: 5 })
                  .margin(3).borderRadius(6)
                  .fontColor(this.selArea === a.id ? this.p().textOnAccent : this.p().textSecondary)
                  .backgroundColor(this.selArea === a.id ? this.p().accent : this.p().bgAlt)
                  .onClick(() => {
                    this.selectArea(a.id);
                  })
              }, (a: AreaGroup) => 'area' + a.id)
            }
            .width('100%')
          }

          // ── 座位状态 ──
          Text('座位状态' + (this.selArea.length > 0 ? '（' + this.selArea + '）' : ''))
            .fontSize(12).fontColor(this.p().textMuted).width('100%').margin({ top: 16 })
          if (this.seatsLoading) {
            Text('拉取座位状态…').fontSize(12).fontColor(this.p().textMuted).width('100%').margin({ top: 6 })
          } else if (this.seatsErr.length > 0) {
            Text(this.seatsErr).fontSize(11).fontColor(this.p().error).width('100%').margin({ top: 6 })
          } else if (this.selArea.length > 0 && this.seatVMs.length === 0) {
            Text('该区域暂未查到座位').fontSize(12).fontColor(this.p().textMuted).width('100%').margin({ top: 6 })
          } else if (this.selArea.length > 0) {
            // 汇总（派生，已算好）
            Text(this.summary.freeRatio)
              .fontSize(12).fontColor(this.p().textSecondary).width('100%').margin({ top: 6 })
            // 座位列表
            ForEach(this.seatVMs, (vm: SeatVM) => {
              this.seatRow(vm)
            }, (vm: SeatVM) => 'seat' + vm.seatId)
          }

          // ── 我的预约 ──
          Text('我的预约（' + this.myCount + '）')
            .fontSize(12).fontColor(this.p().textMuted).width('100%').margin({ top: 16 })
          this.myBlock()

          // ── 取消确认条 ──
          if (this.cancelTarget !== null || this.cancelResult.length > 0) {
            this.cancelBlock()
          }

          // ── 占位：研讨间 / 违约 ──
          Text('研讨间、违约记录：服务端接口待接，暂不显示（不造假数据）')
            .fontSize(10).fontColor(this.p().textFaint).width('100%').margin({ top: 12 })

          Text('取消 / 预约为对外操作，需设备端真机回归（当前离线未验）')
            .fontSize(10).fontColor(this.p().textFaint).width('100%').margin({ top: 4 })
        }
        .width('100%').padding({ left: 12, right: 12, bottom: 24 })
        .align(Alignment.Top)
      }
      .layoutWeight(1)
    }
    .width('100%').height('100%')
    .backgroundColor(this.p().bgPage)
  }

  /** 单个座位行（纯渲染，无局部变量）。 */
  @Builder
  seatRow(vm: SeatVM) {
    Row() {
      Text('')
        .width(10).height(10).borderRadius(5)
        .backgroundColor(this.isDark ? vm.statusColorDark : vm.statusColorLight)
      Text(vm.seatName)
        .fontSize(13).fontColor(this.p().textPrimary).margin({ left: 8 }).layoutWeight(1)
      Text(vm.statusText).fontSize(11).fontColor(this.p().textSecondary)
      if (vm.timeText.length > 0) {
        Text(vm.timeText).fontSize(11).fontColor(this.p().textFaint).margin({ left: 8 })
      }
    }
    .width('100%').padding({ top: 8, bottom: 8 })
    .backgroundColor(this.p().bgCard).borderRadius(8).margin({ top: 4 })
    .alignItems(VerticalAlign.Center)
  }

  /** 我的预约区块（数据来自状态 this.mine，不在 ForEach 里重算）。 */
  @Builder
  myBlock() {
    Column() {
      ForEach(this.mine, (m: MyReservationVM) => {
        this.myResRow(m)
      }, (m: MyReservationVM) => 'myres' + m.reservationId)
    }
    .width('100%')
  }

  /** 单条我的预约行。 */
  @Builder
  myResRow(m: MyReservationVM) {
    Row() {
      Text(m.seatName).fontSize(13).fontColor(this.p().textPrimary).layoutWeight(1)
      if (m.timeText.length > 0) {
        Text(m.timeText).fontSize(11).fontColor(this.p().textFaint)
      }
      Text(m.phase === 'active' ? '生效中' : '已过期')
        .fontSize(10).fontColor(m.phase === 'active' ? this.p().success : this.p().textMuted)
      if (m.cancellable && this.cancelTarget === m.reservationId) {
        Button('确认取消')
          .height(26).fontSize(11).margin({ left: 8 })
          .backgroundColor(this.p().error).fontColor('#FFFFFF')
          .enabled(!this.cancelBusy)
          .onClick(() => {
            this.confirmCancel();
          })
      } else if (m.cancellable) {
        Button('取消')
          .height(26).fontSize(11).margin({ left: 8 })
          .onClick(() => {
            this.requestCancel(m.reservationId);
          })
      }
    }
    .width('100%').padding(10).margin({ top: 4 })
    .backgroundColor(this.p().bgCard).borderRadius(8)
    .alignItems(VerticalAlign.Center)
  }

  /** 取消结果 / 确认提示条。 */
  @Builder
  cancelBlock() {
    Column() {
      if (this.cancelTarget !== null) {
        Text('确认取消该预约？此操作会释放座位，不可撤销。')
          .fontSize(11).fontColor(this.p().warn).width('100%')
      }
      if (this.cancelResult.length > 0) {
        Text(this.cancelResult).fontSize(11).fontColor(this.p().textSecondary).width('100%').margin({ top: 4 })
      }
    }
    .width('100%').padding(10).margin({ top: 8 })
    .backgroundColor(this.p().bgAlt).borderRadius(8)
  }
}
