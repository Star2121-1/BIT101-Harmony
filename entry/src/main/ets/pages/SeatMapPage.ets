/**
 * 独立座位图页（阶段3，对齐 Android SeatMapScreen）。
 *
 * 三种用途由入口带过来（FormMode 复用为 SeatPickMode）：
 * - SINGLE：直接预约，点空闲/我的座位 → 底部「预约 xxx / 取消预约」；
 * - MONITOR：选目标座位（已被占的也能选，那正是要等它空出来的），单选 + 反选清空；
 * - PREFER：选偏好座位，可多选，点选顺序 = 优先级。
 *
 * 纪律：
 * - 选座结果通过 AppStorage 回传新建预约表单（SeatPage @Watch 回填），不在页面里建任务；
 * - 预约/取消有对外副作用（铁律 0.6）：只在用户显式点击后触发，取消额外二次确认；
 * - 时段与查询同源（先 fetchSeatDates 再 fetchSeats），confirm 复用同一 segment；
 * - 「我的预约」交叉标记 MINE（对齐 Android Seat.asMine()），不是服务端下的状态。
 */

import { router } from '@kit.ArkUI';
import { Context } from '@kit.AbilityKit';
import { gridTokens } from '../core/theme/GridTokens.ts';
import {
  STORAGE_DARK, STORAGE_PALETTE, STORAGE_SEAT_RETRY,
  STORAGE_SEAT_PICK_RESULT, STORAGE_SEAT_PICK_DONE,
  STORAGE_SEAT_RESERVE_DONE, STORAGE_SEAT_RESERVE_MSG,
  getPalette,
} from '../data/ThemeStore.ts';
import { FormMode } from '../corelogic/SeatFormLogic.ts';
import type {
  WireSeat, MapPointVM, SeatSegmentParams, MyReservation, SeatMapImages,
} from '../corelogic/SeatApiLogic.ts';
import {
  WireSeatStatus, resolveSeatSegment, buildMapPoints, emptySeatMapImages,
  isSeatMapImagesEmpty, wireStatusColor, isFree,
} from '../corelogic/SeatApiLogic.ts';
import { signInHintFor } from '../corelogic/SeatReserveLogic.ts';
import {
  isPickingMode, mapTitle, pickable, togglePicked, mineSeatIds, markMineSeats,
  mapPointsForMode, sortedSeatsForGrid, pickedSummary, pickerConfirmLabel, pickerGuard,
  reserveButtonLabel, reserveHint, isCancelInstead, statusShortLabel, canUseMapCanvas,
} from '../corelogic/SeatMapPageLogic.ts';
import type { PickedLabel } from '../corelogic/SeatMapPageLogic.ts';
import { SeatService } from '../service/SeatService.ts';
import { SeatTreeService } from '../service/SeatTreeService.ts';
import { CasLoginService } from '../service/CasLoginService.ts';
import { info, warn } from '../core/log/BitLog.ts';
import { joinA11y } from '../corelogic/A11yText.ts';

/** 路由参数（router.getParams 只有字符串，枚举用字符串传）。 */
interface SeatMapParams {
  areaId: string;
  areaName: string;
  day: string;
  mode: string;
}

/** 方格兜底图例项。 */
interface LegendItem {
  color: string;
  label: string;
}

@Entry
@Component
struct SeatMapPage {
  @StorageLink(STORAGE_DARK) isDark: boolean = false;
  @StorageLink(STORAGE_PALETTE) paletteName: string = 'brand';
  /** 从 LoginPage 授权成功回跳时 +1（@Watch 触发重新拉座位图）。 */
  @StorageLink(STORAGE_SEAT_RETRY) @Watch('onAuthRetry') seatRetry: number = 0;

  @State areaId: string = '';
  @State areaName: string = '';
  @State day: string = '';
  @State mode: FormMode = FormMode.SINGLE;

  @State loading: boolean = true;
  @State errText: string = '';
  @State authExpired: boolean = false;
  @State authorizing: boolean = false;
  @State seats: WireSeat[] = [];
  @State images: SeatMapImages = emptySeatMapImages();
  @State segId: string = '1';
  @State startTime: string = '08:00';
  @State endTime: string = '22:30';

  /** SINGLE：当前选中座位 id；选座模式：空的（走 pickedIds）。 */
  @State selectedId: string = '';
  /** MONITOR/PREFER：已选座位 id，顺序 = 优先级。 */
  @State pickedIds: string[] = [];
  @State mineRecords: MyReservation[] = [];
  @State busy: boolean = false;
  @State hint: string = '';
  /** 取消预约二次确认态（对外副作用，铁律 0.6）。 */
  @State cancelTarget: string | null = null;

  private svc: SeatService = new SeatService();
  private readonly legendList: LegendItem[] = [
    { color: '#4CAF50', label: '空闲' },
    { color: '#2E7D32', label: '我已预约' },
    { color: '#FF9800', label: '已预约' },
    { color: '#9E9E9E', label: '在用' },
  ];

  private tk() {
    return gridTokens(this.isDark, getPalette(this.paletteName));
  }

  aboutToAppear(): void {
    const p = router.getParams() as SeatMapParams | undefined;
    if (p !== undefined) {
      this.areaId = p.areaId ?? '';
      this.areaName = p.areaName ?? '';
      this.day = p.day ?? '';
      const m: string = p.mode ?? 'SINGLE';
      this.mode = m === 'MONITOR' ? FormMode.MONITOR
        : (m === 'PREFER' ? FormMode.PREFER : FormMode.SINGLE);
    }
    if (this.day.length === 0) this.day = SeatTreeService.today();
    void this.reload();
  }

  private onAuthRetry(): void {
    if (this.seatRetry > 0) void this.reload();
  }

  /** 拉时段 → 座位 → 我的预约（标记 MINE）→ 底图。与 SeatPage 同源，参数不猜。 */
  private async reload(): Promise<void> {
    this.loading = true;
    this.errText = '';
    this.authExpired = false;
    this.hint = '';
    this.seats = [];
    try {
      const ctx: Context = getContext(this) as Context;
      const user = await SeatService.getSession(ctx);
      if (user === null) {
        this.authExpired = true;
        this.errText = '未登录，需要先授权座位系统';
        this.loading = false;
        return;
      }
      let jwt: string = user.jwt;
      const datesRes = await this.svc.fetchSeatDates(ctx, jwt, this.areaId);
      const seg: SeatSegmentParams = datesRes.ok
        ? resolveSeatSegment(datesRes.dates, this.day)
        : { segment: '1', startTime: '08:00', endTime: '22:30' };
      this.segId = seg.segment;
      this.startTime = seg.startTime;
      this.endTime = seg.endTime;
      info('seat map segments: ' + JSON.stringify(seg) + ' (datesOk=' + datesRes.ok + ')');

      let res = await this.svc.fetchSeats(ctx, jwt, this.areaId,
        seg.segment, this.day, seg.startTime, seg.endTime);
      if (!res.ok && (res.message ?? '').indexOf('登录已失效') >= 0
        && await CasLoginService.silentRenewJwt(ctx)) {
        const fresh = await SeatService.getSession(ctx);
        if (fresh !== null) {
          jwt = fresh.jwt;
          res = await this.svc.fetchSeats(ctx, jwt, this.areaId,
            seg.segment, this.day, seg.startTime, seg.endTime);
        }
      }
      if (!res.ok) {
        this.authExpired = (res.message ?? '').indexOf('HTTP 500') >= 0
          || (res.message ?? '').indexOf('登录已失效') >= 0;
        this.errText = this.authExpired
          ? '座位系统授权已失效，请重新授权'
          : ((res.message ?? '').length > 0 ? res.message! : '座位加载失败');
        this.loading = false;
        return;
      }

      const mineRes = await this.svc.myReservations(ctx, jwt);
      this.mineRecords = mineRes.ok ? mineRes.records : [];
      const ids: string[] = [];
      for (let i = 0; i < this.mineRecords.length; i++) {
        ids.push(this.mineRecords[i].seatId);
      }
      this.seats = markMineSeats(res.seats, mineSeatIds(ids));

      const mapRes = await this.svc.seatMap(ctx, jwt, this.areaId);
      this.images = mapRes.ok ? mapRes.images : emptySeatMapImages();
    } catch (e) {
      this.errText = '座位图加载失败：' + (e as Error).message;
    }
    this.loading = false;
  }

  /** 授权：先静默换票（只读），失败才本人重登；回跳靠 STORAGE_SEAT_RETRY 自动重试。 */
  private async authorize(): Promise<void> {
    if (this.authorizing) return;
    this.authorizing = true;
    try {
      const ctx: Context = getContext(this) as Context;
      if (await CasLoginService.silentRenewJwt(ctx)) {
        info('seat map: silent renew ok');
        this.authExpired = false;
        await this.reload();
        return;
      }
      this.hint = '座位会话已过期，需要你本人重新登录';
      router.pushUrl({ url: 'pages/LoginPage', params: { from: 'seat' } })
        .catch((e: Error) => {
          warn('seat map -> login fail: ' + JSON.stringify(e));
        });
    } finally {
      this.authorizing = false;
    }
  }

  private seatById(id: string): WireSeat | null {
    for (let i = 0; i < this.seats.length; i++) {
      if (this.seats[i].id === id) return this.seats[i];
    }
    return null;
  }

  private selectedSeat(): WireSeat | null {
    return this.selectedId.length > 0 ? this.seatById(this.selectedId) : null;
  }

  private isSelected(id: string): boolean {
    return this.mode === FormMode.SINGLE && this.selectedId === id;
  }

  private isPicked(id: string): boolean {
    return this.pickedIds.indexOf(id) >= 0;
  }

  /** 图上/方格点一下 —— 选座模式切换选中集合；预约模式只选中，绝不直接预约。 */
  private onSeatTap(s: WireSeat): void {
    this.hint = '';
    if (!pickable(this.mode, s.status)) {
      this.hint = s.no + ' ' + statusShortLabel(s.status) + '，不能预约';
      return;
    }
    if (isPickingMode(this.mode)) {
      this.pickedIds = togglePicked(this.mode, this.pickedIds, s.id);
    } else {
      this.selectedId = this.selectedId === s.id ? '' : s.id;
      this.cancelTarget = null;
    }
  }

  /** 底图点位在用途重算后的规格（坐标/裁图原样，可点性按模式）。 */
  private points(): MapPointVM[] {
    return mapPointsForMode(buildMapPoints(this.seats, this.images), this.mode);
  }

  private useCanvas(): boolean {
    return canUseMapCanvas(!isSeatMapImagesEmpty(this.images), this.seats);
  }

  private freeCount(): number {
    let n: number = 0;
    for (let i = 0; i < this.seats.length; i++) {
      if (this.seats[i].status === WireSeatStatus.AVAILABLE) n++;
    }
    return n;
  }

  private mineCount(): number {
    let n: number = 0;
    for (let i = 0; i < this.seats.length; i++) {
      if (this.seats[i].status === WireSeatStatus.MINE) n++;
    }
    return n;
  }

  private pickedLabels(): PickedLabel[] {
    const out: PickedLabel[] = [];
    for (let i = 0; i < this.pickedIds.length; i++) {
      const s: WireSeat | null = this.seatById(this.pickedIds[i]);
      if (s !== null) {
        out.push({ no: s.no.length > 0 ? s.no : s.id, statusShort: statusShortLabel(s.status) });
      }
    }
    return out;
  }

  /** 选中座位的展示号（@Builder 里禁局部 const，统一走 helper）。 */
  private selectedNo(): string {
    const s: WireSeat | null = this.selectedSeat();
    return s === null ? '' : (s.no.length > 0 ? s.no : s.id);
  }

  private selectedStatus(): WireSeatStatus {
    const s: WireSeat | null = this.selectedSeat();
    return s === null ? WireSeatStatus.UNAVAILABLE : s.status;
  }

  private bottomButtonLabel(): string {
    if (this.busy) return this.cancelTarget !== null ? '取消中…' : '预约中…';
    if (this.cancelTarget !== null) return '确认取消预约';
    return reserveButtonLabel(this.selectedNo());
  }

  /** 选座确定：MONITOR 必须选 1 个；结果写 AppStorage 给 SeatPage 回填后返回。 */
  private confirmPick(): void {
    this.hint = '';
    const guard: string | null = pickerGuard(this.mode, this.pickedIds.length);
    if (guard !== null) {
      this.hint = guard;
      return;
    }
    // ArkTS 禁动态对象字面量进 AppStorage ⇒ 用「id|座位号;id|座位号」串（split 可还原，保序=优先级）。
    const parts: string[] = [];
    for (let i = 0; i < this.pickedIds.length; i++) {
      const s: WireSeat | null = this.seatById(this.pickedIds[i]);
      if (s !== null) {
        parts.push(s.id + '|' + (s.no.length > 0 ? s.no : s.id));
      }
    }
    AppStorage.setOrCreate<string>(STORAGE_SEAT_PICK_RESULT, parts.join(';'));
    AppStorage.setOrCreate<number>(STORAGE_SEAT_PICK_DONE, Date.now());
    router.back();
  }

  /** 预约（有对外副作用）：显式点击 confirm；成功写回执并回表单页切列表 tab。 */
  private async doReserve(): Promise<void> {
    const s: WireSeat | null = this.selectedSeat();
    if (s === null) {
      this.hint = reserveHint('');
      return;
    }
    if (isCancelInstead(s.status)) {
      this.cancelTarget = s.id;
      this.hint = '再次点击「取消预约」确认取消 ' + (s.no.length > 0 ? s.no : s.id);
      return;
    }
    if (!isFree(s.status)) {
      this.hint = s.no + ' ' + statusShortLabel(s.status) + '，不能预约';
      return;
    }
    this.busy = true;
    this.hint = '';
    try {
      const ctx: Context = getContext(this) as Context;
      const user = await SeatService.getSession(ctx);
      if (user === null) {
        this.hint = '未登录，无法预约';
        this.busy = false;
        return;
      }
      let jwt: string = user.jwt;
      let res = await this.svc.confirmSeat(ctx, jwt, s.id, this.segId);
      if (!res.ok && (res.message ?? '').indexOf('登录已失效') >= 0
        && await CasLoginService.silentRenewJwt(ctx)) {
        const fresh = await SeatService.getSession(ctx);
        if (fresh !== null) {
          jwt = fresh.jwt;
          res = await this.svc.confirmSeat(ctx, jwt, s.id, this.segId);
        }
      }
      if (res.ok) {
        AppStorage.setOrCreate<string>(STORAGE_SEAT_RESERVE_MSG,
          '预约座位 ' + (s.no.length > 0 ? s.no : s.id) + ' 成功！'
          + signInHintFor(this.day, SeatTreeService.today()));
        AppStorage.setOrCreate<number>(STORAGE_SEAT_RESERVE_DONE, Date.now());
        router.back();
      } else {
        this.hint = res.message ?? '预约失败';
        if ((res.message ?? '').indexOf('登录已失效') >= 0) this.authExpired = true;
      }
    } catch (e) {
      this.hint = '预约失败：' + (e as Error).message;
    }
    this.busy = false;
  }

  /** 取消预约二次确认（对外副作用）：record.id 不是座位 id，从我的预约里反查。 */
  private async doCancel(): Promise<void> {
    const sid: string | null = this.cancelTarget;
    if (sid === null) return;
    this.cancelTarget = null;
    let recordId: string = '';
    for (let i = 0; i < this.mineRecords.length; i++) {
      if (this.mineRecords[i].seatId === sid) {
        recordId = this.mineRecords[i].id;
        break;
      }
    }
    if (recordId.length === 0) {
      this.hint = '未找到对应的预约记录，无法取消';
      return;
    }
    this.busy = true;
    this.hint = '';
    try {
      const ctx: Context = getContext(this) as Context;
      const user = await SeatService.getSession(ctx);
      if (user === null) {
        this.hint = '未登录，无法取消';
        this.busy = false;
        return;
      }
      const res = await this.svc.cancelReservation(ctx, user.jwt, recordId);
      if (res.ok) {
        this.selectedId = '';
        await this.reload();
        this.hint = '已取消该座位预约';
      } else {
        this.hint = res.message ?? '取消失败';
      }
    } catch (e) {
      this.hint = '取消失败：' + (e as Error).message;
    }
    this.busy = false;
  }

  build() {
    Column() {
      // 顶栏（对齐 Android 40dp 蓝条：primary 底 + onPrimary 字 + 返回）
      Row() {
        Text('←')
          .fontSize(22).fontColor(this.tk().onPrimary)
          .width(40).height(40).textAlign(TextAlign.Center)
          .accessibilityText('返回')
          .onClick(() => { router.back(); })
        Text(mapTitle(this.mode))
          .fontSize(15).fontWeight(FontWeight.Medium).fontColor(this.tk().onPrimary)
          .layoutWeight(1).textAlign(TextAlign.Start)
        Text(this.areaName.length > 0 ? this.areaName : ('区域 ' + this.areaId))
          .fontSize(11).fontColor(this.tk().onPrimary).margin({ right: 12 })
      }
      .width('100%').height(44).padding({ left: 4 })
      .backgroundColor(this.tk().primary).alignItems(VerticalAlign.Center)

      if (this.loading) {
        Column() {
          Text('加载座位图…').fontSize(13).fontColor(this.tk().onSurfaceVariant)
        }
        .width('100%').layoutWeight(1).justifyContent(FlexAlign.Center)
      } else if (this.authExpired) {
        Column() {
          Text(this.errText.length > 0 ? this.errText : '座位系统授权已失效')
            .fontSize(13).fontColor(this.tk().onSurfaceVariant).width('100%').textAlign(TextAlign.Center)
          Button(this.authorizing ? '恢复中…' : '去授权')
            .height(36).fontSize(13).margin({ top: 14 })
            .backgroundColor(this.tk().primary).fontColor(this.tk().onPrimary)
            .enabled(!this.authorizing)
            .onClick(() => { void this.authorize(); })
          if (this.hint.length > 0) {
            Text(this.hint).fontSize(11).fontColor(this.tk().stateAttention).margin({ top: 10 })
          }
        }
        .width('100%').layoutWeight(1).justifyContent(FlexAlign.Center).padding(20)
      } else if (this.errText.length > 0) {
        Column() {
          Text('加载失败').fontSize(14).fontWeight(FontWeight.Bold).fontColor(this.tk().onSurface)
          Text(this.errText).fontSize(12).fontColor(this.tk().onSurfaceVariant).margin({ top: 6 })
          Button('重试').height(34).fontSize(12).margin({ top: 14 })
            .backgroundColor(this.tk().primary).fontColor(this.tk().onPrimary)
            .onClick(() => { void this.reload(); })
        }
        .width('100%').layoutWeight(1).justifyContent(FlexAlign.Center).padding(20)
      } else {
        // 信息条：自动换行（Android FlowRow），不让「空闲/换区域」被挤出屏幕
        Flex({ wrap: FlexWrap.Wrap }) {
          SeatMapChip({ label: this.areaName.length > 0 ? this.areaName : ('区域 ' + this.areaId), selected: true })
          SeatMapChip({ label: this.day + ' ' + this.startTime + '-' + this.endTime, selected: false })
          SeatMapChip({ label: '空闲 ' + this.freeCount() + '/' + this.seats.length, selected: false })
          if (this.mineCount() > 0) {
            SeatMapChip({ label: '我的 ' + this.mineCount(), selected: false })
          }
          Text('换区域')
            .fontSize(12).fontColor(this.tk().primary)
            .padding({ left: 10, right: 10, top: 5, bottom: 5 })
            .onClick(() => { router.back(); })
        }
        .width('100%').padding({ left: 12, right: 12, top: 6, bottom: 4 })

        // 座位主体：有底图+全坐标走叠图，否则走按座位号排序的方格兜底
        Column() {
          if (this.seats.length === 0) {
            Text('该区域暂无座位数据').fontSize(13)
              .fontColor(this.tk().onSurfaceVariant).width('100%').textAlign(TextAlign.Center)
          } else if (this.useCanvas()) {
            this.canvasView()
          } else {
            this.gridView()
            this.legend()
          }
        }
        .width('100%').layoutWeight(1).padding({ left: 12, right: 12 })
        .alignItems(HorizontalAlign.Start)
        .align(Alignment.Top)

        if (this.hint.length > 0) {
          Text(this.hint).fontSize(11).fontColor(this.tk().stateAttention)
            .width('100%').padding({ left: 12, right: 12, bottom: 4 })
        }

        if (isPickingMode(this.mode)) {
          this.pickerBottomBar()
        } else {
          this.reserveBottomBar()
        }
      }
    }
    .width('100%').height('100%')
    .backgroundColor(this.tk().background)
  }

  /** 底图叠图：底图铺底 + 每座位按百分比定位裁片；选中用主色描边 + ✓ 角标。 */
  @Builder
  canvasView() {
    Column() {
      Stack({ alignContent: Alignment.TopStart }) {
        if (this.images.free.length > 0) {
          Image(this.images.free).width('100%').height('100%').objectFit(ImageFit.Contain)
        } else {
          Row().width('100%').height('100%').backgroundColor(this.tk().surfaceVariant)
        }
        ForEach(this.points(), (pm: MapPointVM) => {
          this.mapPoint(pm)
        }, (pm: MapPointVM) => 'pt' + pm.seatId)
      }
      .width('100%').aspectRatio(16 / 9).clip(true).borderRadius(12)
      Text('点位 = 座位状态（官方底图）；' + (isPickingMode(this.mode) ? '点任意座位可选' : '点空闲座位后确认预约'))
        .fontSize(10).fontColor(this.tk().textPlaceholder).width('100%').margin({ top: 6 })
    }
    .width('100%')
  }

  @Builder
  mapPoint(pm: MapPointVM) {
    Stack({ alignContent: Alignment.TopStart }) {
      Text(pm.no).fontSize(9).fontColor('#FFFFFF').textAlign(TextAlign.Center)
        .backgroundColor(pm.color).borderRadius(2)
        .width('100%').height('100%')
      if (pm.tileUrl.length > 0) {
        Image(pm.tileUrl)
          .width(pm.imgScaleX).height(pm.imgScaleY)
          .position({ x: pm.imgOffsetX, y: pm.imgOffsetY })
          .objectFit(ImageFit.Fill)
          .opacity(pm.reservable ? 1 : 0.85)
      }
      if (this.isSelected(pm.seatId) || this.isPicked(pm.seatId)) {
        Text(this.isPicked(pm.seatId) && this.mode === FormMode.PREFER
          ? String(this.pickedIds.indexOf(pm.seatId) + 1) : '✓')
          .fontSize(8).fontColor('#FFFFFF').fontWeight(FontWeight.Bold)
          .textAlign(TextAlign.Center).backgroundColor(this.tk().primary)
          .borderRadius(6).width(12).height(12)
          .position({ x: '0%', y: '0%' })
      }
    }
    .position({ x: pm.leftPct, y: pm.topPct })
    .width(pm.widthPct).height(pm.heightPct)
    .clip(true)
    .border({ width: (this.isSelected(pm.seatId) || this.isPicked(pm.seatId)) ? 1 : 0,
      color: this.tk().primary })
    .opacity(pm.reservable ? 1 : 0.5)
    .accessibilityText(joinA11y([pm.no, statusShortLabel(pm.status)]))
    .onClick(() => {
      const s: WireSeat | null = this.seatById(pm.seatId);
      if (s !== null) this.onSeatTap(s);
    })
  }

  /** 无底图兜底：密集方格，按座位号数值排序（服务端返回顺序是乱的）。 */
  @Builder
  gridView() {
    Flex({ wrap: FlexWrap.Wrap }) {
      ForEach(sortedSeatsForGrid(this.seats), (s: WireSeat) => {
        Column() {
          Text(s.no.length > 0 ? s.no : s.id).fontSize(12).fontColor('#FFFFFF')
          Text(statusShortLabel(s.status)).fontSize(9).fontColor('#FFFFFF').margin({ top: 2 })
        }
        .width(64).height(52).borderRadius(6)
        .backgroundColor(wireStatusColor(s.status))
        .margin({ right: 8, bottom: 8 })
        .opacity(pickable(this.mode, s.status) ? 1 : 0.55)
        .border({ width: (this.isSelected(s.id) || this.isPicked(s.id)) ? 2 : 0,
          color: this.tk().primary })
        .accessibilityText(joinA11y([
          s.no.length > 0 ? s.no : s.id,
          statusShortLabel(s.status),
          this.isSelected(s.id) || this.isPicked(s.id) ? '已选中' : '未选中',
        ]))
        .onClick(() => { this.onSeatTap(s); })
      }, (s: WireSeat) => 'seat' + s.id)
    }
    .width('100%')
  }

  @Builder
  legend() {
    Flex({ wrap: FlexWrap.Wrap }) {
      ForEach(this.legendList, (it: LegendItem) => {
        Row() {
          Text('').width(8).height(8).borderRadius(4).backgroundColor(it.color)
          Text(it.label).fontSize(10).fontColor(this.tk().onSurfaceVariant).margin({ left: 4 })
        }
        .margin({ right: 12, top: 2 })
      }, (it: LegendItem) => 'legend' + it.label)
    }
    .width('100%')
  }

  /** 选座底栏（对齐 Android PickerBottomBar）。 */
  @Builder
  pickerBottomBar() {
    Column() {
      Row() {
        Text(pickedSummary(this.mode, this.pickedLabels()))
          .fontSize(12).layoutWeight(1)
          .fontColor(this.pickedIds.length > 0 ? this.tk().primary : this.tk().onSurfaceVariant)
        if (this.pickedIds.length > 0) {
          Text('清空').fontSize(12).fontColor(this.tk().primary)
            .onClick(() => { this.pickedIds = []; })
        }
      }
      .width('100%').alignItems(VerticalAlign.Center)
      Button(pickerConfirmLabel(this.mode, this.pickedIds.length))
        .width('100%').height(40).fontSize(13).margin({ top: 8 })
        .backgroundColor(this.tk().primary).fontColor(this.tk().onPrimary)
        .onClick(() => { this.confirmPick(); })
    }
    .width('100%').padding({ left: 16, right: 16, top: 10, bottom: 10 })
    .backgroundColor(this.tk().surfaceVariant)
    .alignItems(HorizontalAlign.Start)
  }

  /** 预约底栏（对齐 Android ReserveBottomBar）：任务列表入口在 SeatPage 列表 tab，
   *  这里只保留「取消预约 / 预约 xxx」主操作 + 未选提示。 */
  @Builder
  reserveBottomBar() {
    Column() {
      Row() {
        if (this.selectedSeat() !== null) {
          Text('已选 ' + this.selectedNo())
            .fontSize(12).fontColor(this.tk().onSurface).layoutWeight(1)
          if (isCancelInstead(this.selectedStatus())) {
            Text(this.cancelTarget !== null ? '再点一次确认' : '我的预约')
              .fontSize(11).fontColor(this.tk().stateAttention)
          } else {
            Text(signInHintFor(this.day, SeatTreeService.today()))
              .fontSize(10).fontColor(this.tk().stateAttention)
          }
        } else {
          Text(reserveHint('')).fontSize(11)
            .fontColor(this.tk().onSurfaceVariant).layoutWeight(1)
        }
      }
      .width('100%').alignItems(VerticalAlign.Center)
      Button(this.bottomButtonLabel())
        .width('100%').height(40).fontSize(13).margin({ top: 8 })
        .backgroundColor(this.cancelTarget !== null ? this.tk().error : this.tk().primary)
        .fontColor(this.cancelTarget !== null ? this.tk().onError : this.tk().onPrimary)
        .enabled(!this.busy)
        .onClick(() => {
          if (this.cancelTarget !== null) {
            void this.doCancel();
          } else {
            void this.doReserve();
          }
        })
    }
    .width('100%').padding({ left: 16, right: 16, top: 10, bottom: 10 })
    .backgroundColor(this.tk().surfaceVariant)
    .alignItems(HorizontalAlign.Start)
  }
}

/** 信息条 chip（与 SeatPage 的 SeatChip 同款：实底、无描边、高 32）。 */
@Component
struct SeatMapChip {
  @StorageLink(STORAGE_DARK) private isDark: boolean = false;
  @StorageLink(STORAGE_PALETTE) paletteName: string = 'brand';

  label: string = '';
  selected: boolean = false;

  private tk() {
    return gridTokens(this.isDark, getPalette(this.paletteName));
  }

  build() {
    Text(this.label)
      .fontSize(12)
      .fontColor(this.selected ? this.tk().onPrimaryContainer : this.tk().onSurfaceVariant)
      .padding({ left: 10, right: 10, top: 5, bottom: 5 })
      .borderRadius(8)
      .backgroundColor(this.selected ? this.tk().primaryContainer : this.tk().surfaceVariant)
      .margin({ right: 8, bottom: 4 })
  }
}
