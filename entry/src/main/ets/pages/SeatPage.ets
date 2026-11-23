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
import {
  STORAGE_DARK, STORAGE_PALETTE, STORAGE_SEAT_RETRY,
  STORAGE_SEAT_PICK_RESULT, STORAGE_SEAT_PICK_DONE,
  STORAGE_SEAT_RESERVE_DONE, STORAGE_SEAT_RESERVE_MSG,
  getPalette,
} from '../data/ThemeStore.ts';
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
  type SeatMapImages, type SeatSegmentParams,
  wireStatusText, wireStatusColor, isFree, renegeText, renegeKey, WireSeatStatus, buildMapPoints,
  emptySeatMapImages, isSeatMapImagesEmpty, resolveSeatSegment,
} from '../corelogic/SeatApiLogic.ts';
import { info, warn } from '../core/log/BitLog.ts';
import { CasLoginService } from '../service/CasLoginService.ts';
import { getTaskRepository } from '../data/SeatTaskStore.ts';
import { createTask, isTerminalStatus, TaskMode } from '../model/SeatTask.ts';
import { joinA11y } from '../corelogic/A11yText.ts';
import {
  type SeminarRecord, formatSeminarTime, getSeminarStatusText, isSeminarCancellable,
} from '../corelogic/SeminarLogic.ts';
import { signInHintFor } from '../corelogic/SeatReserveLogic.ts';
import {
  FormMode, modeLabel, dateLabel, tomorrowOf, primaryButtonLabel, pickedSeatTitle,
  pickedSeatHint, pickButtonLabel, dateOptions, validateForm,
} from '../corelogic/SeatFormLogic.ts';

@Entry
@Component
export struct SeatPage {
  /** true = 被外壳（底部 tab）嵌入：不渲染返回键（原版这些是 pager 页签，没有页面级返回）。 */
  isEmbedded: boolean = false;

  @StorageLink(STORAGE_DARK) isDark: boolean = false;
  @StorageLink(STORAGE_PALETTE) paletteName: string = 'brand';
  /**
   * 从 LoginPage 授权成功回跳时 +1（@Watch 触发自动重试）。
   * 用 AppStorage 而非 @Prop：SeatPage 既是 @Entry 又被内嵌，@Entry 页加 @Prop 有警告；
   * 且 router.back() 回来时本实例保留，三级选择态不丢，正好在此实例上重试。
   */
  @StorageLink(STORAGE_SEAT_RETRY) @Watch('onAuthRetry') seatRetry: number = 0;
  /** 阶段3：从独立座位图页选座回传（@Watch 回填 pickedSeatNos）。 */
  @StorageLink(STORAGE_SEAT_PICK_DONE) @Watch('onSeatPickBack') seatPickDone: number = 0;
  /** 阶段3：座位图页直接预约成功（@Watch 切列表 tab + 刷新）。 */
  @StorageLink(STORAGE_SEAT_RESERVE_DONE) @Watch('onSeatReserveDone') seatReserveDone: number = 0;
  /** 阶段3：座位图预约成功提示（含签到时限文案），列表 tab 顶部直出。 */
  @StorageLink(STORAGE_SEAT_RESERVE_MSG) seatReserveMsg: string = '';

  /** 座位页两个视图（对齐原版顶部「预约/列表」双 chip）：'book' 预约 / 'list' 列表。 */
  @State seatTab: string = 'book';

  // ── 新建预约表单（对齐 Android NewTaskScreen，阶段2）──
  /** 表单模式：单次预约 / 监控预约 / 优先预约。 */
  @State formMode: FormMode = FormMode.SINGLE;
  /** 模式 chip 数据源（不用数组字面量直接进 ForEach，避免 ArkUI 类型推断问题）。 */
  private readonly modeList: FormMode[] = [FormMode.SINGLE, FormMode.MONITOR, FormMode.PREFER];
  /** 预约日期（yyyy-MM-dd，默认设备本地今天）。 */
  @State reserveDate: string = '';
  /** 可选日期（服务端 availableDays，空则回落今天/明天）。 */
  @State availableDays: string[] = [];
  /** 已选座位号（监控/优先模式的选座结果；阶段3独立座位图页会回填）。 */
  @State pickedSeatNos: string[] = [];
  /** 表单校验/操作错误文案。 */
  @State formErr: string = '';
  /** 选座入口提示（阶段3未接前的诚实说明，不假装能用）。 */
  @State pickHint: string = '';

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
  /**
   * 当前区域当天解析出的真实查询时段（对齐 Android SeatQuery）。
   * 由 loadSeats 先 fetchSeatDates(build_id=区域 id) 再 resolveSeatSegment 得到；
   * confirmReserve 复用同一时段，保证「查得到 → 约得到」参数一致。
   * 普通私有字段（不驱动 UI），仅初始化一次。
   */
  private segParams: SeatSegmentParams = { segment: '1', startTime: '08:00', endTime: '22:30' };
  /** 本次座位查询的日期（loadSeats 设置）；签到提示按"预约日 vs 今天"给准确文案。 */
  private queryDay: string = '';
  /**
   * 座位会话失效门禁（对齐 Android SeatAuthGate）。
   * seatlib 契约（docs/seatlib-contract.md §1）：带失效 token 打 /api/Seat/seat → HTTP 500 + 空 body；
   * 不带 token 则 200。所以「响应解析失败（HTTP 500）」= token 死了，必须引导重新授权，
   * 不能只显示一句看不懂的「加载失败」。
   */
  @State seatAuthExpired: boolean = false;
  @State seatAuthorizing: boolean = false;
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
  /** 选中座位的展示号（对齐 Android ReserveBottomBar「预约 ${seat.no}」）。 */
  @State reserveSeatNo: string = '';
  @State reserveBusy: boolean = false;
  @State reserveResult: string = '';

  // 我的违约记录（权威 wire：/api/Member/reneges type=1；rename 直出，不造数据）
  @State reneges: RenegeRecord[] = [];
  @State renLoading: boolean = false;
  @State renErr: string = '';
  /** 我的研讨间预约（账号级，POST /api/Member/seminar；2026-11-22 真机探针证实有真实数据）。 */
  @State seminars: SeminarRecord[] = [];
  @State semLoading: boolean = false;
  @State semErr: string = '';
  /** 研讨间取消二次确认态（对外副作用，铁律 0.6：用户显式点 + 二次确认）。 */
  @State semCancelTarget: string | null = null;
  @State semCancelResult: string = '';
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

  /** 已选区域卡片的名称（按 id 从树里查，对齐 Android selectedCampus/Floor/Area.name）。 */
  private campusNameOf(id: string): string {
    for (let i = 0; i < this.camps.length; i++) {
      if (this.camps[i].id === id) return this.camps[i].name;
    }
    return id;
  }

  private floorNameOf(id: string): string {
    const floors: FloorGroup[] = this.floorsOf(this.selCampus);
    for (let i = 0; i < floors.length; i++) {
      if (floors[i].id === id) return floors[i].name;
    }
    return id;
  }

  private areaNameOf(id: string): string {
    const areas: AreaGroup[] = this.areasOf(this.selFloor);
    for (let i = 0; i < areas.length; i++) {
      if (areas[i].id === id) return areas[i].name;
    }
    return id;
  }

  aboutToAppear(): void {
    this.nowText = fmtMinutes(this.nowDt().minutes);
    // 表单日期默认设备本地今天（对齐 Android reserveDate=LocalDate.now()）
    const todayStr: string = SeatTreeService.today();
    if (this.reserveDate.length === 0) {
      this.reserveDate = todayStr;
      this.availableDays = dateOptions([], todayStr, tomorrowOf(todayStr));
    }
    this.loadTree();
  }

  /**
   * 从 LoginPage 授权成功回跳后自动重试座位取数（对齐 BIT101-S 授权闭环）。
   * router.back() 回来时本实例保留、三级选择态不丢；新 JWT 已由登录写入 SessionStore，
   * 所以直接 loadSeats(false)（不再走续期，避免二次换票）即可脱离门禁。
   */
  private onAuthRetry(): void {
    if (this.seatRetry <= 0 || this.selArea.length === 0) {
      return;
    }
    info('seat auth retry after login, area=' + this.selArea);
    this.loadSeats(false);
  }

  /** 阶段3：从独立座位图页选座返回，回填 pickedSeatNos（串格式 id|座位号;…，保序=优先级）。 */
  private onSeatPickBack(): void {
    if (this.seatPickDone <= 0) return;
    const raw: string = String(AppStorage.get<string>(STORAGE_SEAT_PICK_RESULT) ?? '');
    if (raw.length === 0) return;
    const nos: string[] = [];
    const items: string[] = raw.split(';');
    for (let i = 0; i < items.length; i++) {
      const kv: string[] = items[i].split('|');
      if (kv.length >= 2 && kv[1].length > 0) nos.push(kv[1]);
    }
    this.pickedSeatNos = nos;
    this.formErr = '';
    this.pickHint = '';
    info('seat pick back: ' + nos.join(','));
  }

  /** 阶段3：座位图页直接预约成功 → 对齐 Android onNavigateToTasks：切列表 tab 立即可见。 */
  private onSeatReserveDone(): void {
    if (this.seatReserveDone <= 0) return;
    this.seatTab = 'list';
    this.loadMyReservations();
    this.loadReneges();
    this.loadSeminars();
  }

  /** 阶段3：从新建预约表单跳独立座位图页（三种用途共用一页，mode 决定标题/底栏/可点语义）。 */
  private openSeatMap(mode: FormMode): void {
    this.formErr = validateForm(mode, this.selArea.length > 0, this.pickedSeatNos.length) ?? '';
    if (this.formErr.length > 0) return;
    this.pickHint = '';
    router.pushUrl({
      url: 'pages/SeatMapPage',
      params: {
        areaId: this.selArea,
        areaName: this.areaNameOf(this.selArea),
        day: this.reserveDate.length > 0 ? this.reserveDate : SeatTreeService.today(),
        mode: String(mode),
      },
    }).catch((e: Error) => {
      warn('open seat map fail: ' + JSON.stringify(e));
    });
  }

  /** 阶段3闭环：监控/优先模式选座回填后创建本地任务（对齐 Android addTask）。 */
  private createTaskFromForm(): void {
    this.formErr = validateForm(this.formMode, this.selArea.length > 0, this.pickedSeatNos.length) ?? '';
    if (this.formErr.length > 0) return;
    const mode: TaskMode = this.formMode === FormMode.MONITOR ? TaskMode.MONITOR : TaskMode.PREFER;
    const day: string = this.reserveDate.length > 0 ? this.reserveDate : SeatTreeService.today();
    const task = createTask(
      mode, this.selArea, this.segParams.segment,
      this.pickedSeatNos.length > 0 ? this.pickedSeatNos[0] : '',
      day, this.segParams.startTime, this.segParams.endTime,
      this.campusNameOf(this.selCampus), this.floorNameOf(this.selFloor), this.areaNameOf(this.selArea),
      this.formMode === FormMode.PREFER ? this.pickedSeatNos : [],
    );
    getTaskRepository().addTask(task);
    this.pickedSeatNos = [];
    this.pickHint = '';
    this.seatTab = 'list';
    this.taskHint = '已创建' + modeLabel(this.formMode) + '任务';
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
    this.loadSeminars();
  }

  /**
   * 门禁「授权座位系统」按钮（对齐 Android SeatViewModel.authorize）。
   * ⚠️ 红线：只在用户主动点击时调；自动路径绝不走到这里（避免学校风控短信无人输入）。
   * 第一步先做只读的 cookie 静默续期（安全、不发短信）；失败则跳登录页请用户本人重登——
   * 重登会重建 seatlib 域 phpCAS 会话并落新 PHPSESSID（A′ 落盘链路），这才是换 JWT 的前提。
   */
  private async authorizeSeat(): Promise<void> {
    if (this.seatAuthorizing) return;
    this.seatAuthorizing = true;
    this.seatsErr = '';
    try {
      const ctx: Context = getContext(this) as Context;
      if (await CasLoginService.silentRenewJwt(ctx)) {
        info('seat authorize: cookie silent renew ok');
        this.seatAuthExpired = false;
        await this.loadSeats(false);
        return;
      }
      // cookie 换不到 token ⇒ 旧 phpCAS 会话已死（seatlib 单会话互踢），必须本人重登
      this.seatsErr = '座位会话已过期，请重新登录学校账号后重试';
      // 带来源参数：登录成功要回座位页并自动重试（对齐 BIT101-S 授权闭环），不能回课表。
      router.pushUrl({ url: 'pages/LoginPage', params: { from: 'seat' } }).catch((e: Error) => {
        warn('seat -> login fail: ' + JSON.stringify(e));
      });
    } finally {
      this.seatAuthorizing = false;
    }
  }

  private async loadSeats(allowRenew: boolean = true): Promise<void> {
    this.seatsLoading = true;
    this.seatsErr = '';
    this.seatAuthExpired = false;
    this.reserveTarget = null;
    this.reserveSeatNo = '';
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
      // ⚠️ 根因修复（2026-11-21 evidence/seat-unauth-rootcause-20261121.md）：
      // /api/Seat/seat 的 segment 必须是**真实时段 id**。先按 build_id=区域 id 拉
      // /api/Seat/date 才有非 null 的 times[].id；传空 segment → HTTP 500 空 body，
      // 旧代码写死 '' 被误判成"未授权"。对齐 Android SeatViewModel.resolveSegmentParams。
      const day: string = SeatTreeService.today();
      this.queryDay = day;
      const datesRes = await this.svc.fetchSeatDates(ctx, user.jwt, this.selArea);
      this.segParams = datesRes.ok
        ? resolveSeatSegment(datesRes.dates, day)
        : { segment: '1', startTime: '08:00', endTime: '22:30' };
      info('seat segments resolved: ' + JSON.stringify(this.segParams)
        + ' (datesOk=' + datesRes.ok + ')');
      const res = await this.svc.fetchSeats(ctx, user.jwt, this.selArea,
        this.segParams.segment, day, this.segParams.startTime, this.segParams.endTime);
      if (!res.ok) {
        // 参数修正后仍 500 才可能是会话问题：先只读静默续期探一次（不删数据/不发短信/不撞风控）。
        if (allowRenew && (await CasLoginService.silentRenewJwt(ctx))) {
          info('seat JWT silent-renewed, retry fetchSeats');
          await this.loadSeats(false);
          return;
        }
        // 已用真实时段参数仍 500 ⇒ 服务端拒绝（契约 §1：带失效 token 打免认证接口 → 500 空 body）
        this.seatAuthExpired = (res.message ?? '').indexOf('HTTP 500') >= 0;
        this.seatsErr = this.seatAuthExpired
          ? '座位系统授权已失效（服务端拒绝旧会话）'
          : ((res.message ?? '').length > 0 ? res.message! : '座位拉取失败');
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

  /** 点空闲座位行：先进预约确认态，不直接调接口（铁律 0.6）。
   *  同时反查座位展示号，供底部固定栏显示「预约 XXX」（对齐 Android ReserveBottomBar）。 */
  private requestReserve(seatId: string): void {
    this.reserveTarget = seatId;
    this.reserveResult = '';
    let no: string = '';
    for (let i = 0; i < this.seats.length; i++) {
      if (this.seats[i].id === seatId) {
        no = this.seats[i].no.length > 0 ? this.seats[i].no : this.seats[i].id;
        break;
      }
    }
    this.reserveSeatNo = no;
  }

  /** 二次确认后才真正预约（有对外副作用，铁律 0.6）。
   *  权威契约 confirm 只传 {seat_id, segment}；segment 用 loadSeats 解析出的真实时段 id
   *  （与查座位同一时段，契约 §2 传非法 id → 500）。成功后刷新座位快照 + 我的预约。 */
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
      let res = await this.svc.confirmSeat(ctx, user.jwt, sid, this.segParams.segment);
      // 对齐 Android SeatApi.authed(): token 失效先静默续期（只 cookie，不发短信），
      // 成功则用新 JWT 重放**同一次**预约（仍是用户刚才点击的意图，不是自动预约）。
      if (!res.ok && (res.message ?? '').indexOf('登录已失效') >= 0) {
        info('seat confirm: token expired, try silent renew');
        if (await CasLoginService.silentRenewJwt(ctx)) {
          const fresh = await SeatService.getSession(ctx);
          if (fresh !== null) {
            res = await this.svc.confirmSeat(ctx, fresh.jwt, sid, this.segParams.segment);
          }
        }
      }
      this.reserveTarget = null;
      if (res.ok) {
        this.reserveResult = '预约成功！' + signInHintFor(this.queryDay, SeatTreeService.today());
        await this.loadSeats();
        await this.loadMyReservations();
        // 对齐 Android SeatMapScreen.onNavigateToTasks()：预约成功直接跳列表 tab，
        // 「我的预约」在最顶部——用户立刻看到结果，不用滚 184 条座位。
        this.seatTab = 'list';
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

  /** 拉我的研讨间预约（/api/Member/seminar；账号级，不按区域）。
   *  2026-11-22 真机探针证实接口 200 code=1 有真实数据，补齐 wire 解析后渲染真实列表。 */
  private async loadSeminars(): Promise<void> {
    this.semLoading = true;
    this.semErr = '';
    try {
      const ctx: Context = getContext(this) as Context;
      const user = await SeatService.getSession(ctx);
      if (user === null) {
        this.semErr = '未登录，未取到研讨间预约';
        this.seminars = [];
        this.semLoading = false;
        return;
      }
      const res = await this.svc.seminarReservations(ctx, user.jwt);
      if (!res.ok) {
        this.semErr = (res.message ?? '').length > 0 ? res.message! : '研讨间预约拉取失败';
        this.seminars = [];
      } else {
        this.seminars = res.records;
      }
    } catch (e) {
      this.semErr = '研讨间预约拉取失败：' + (e as Error).message;
      this.seminars = [];
    }
    this.semLoading = false;
  }

  /** 研讨间取消二次确认（对外副作用，仅用户点 + 二次确认才真调）。
   *  对齐 Android cancelReservation：POST /api/Space/cancel body {id: 记录id}。 */
  private async confirmSeminarCancel(): Promise<void> {
    const id: string | null = this.semCancelTarget;
    if (id === null) return;
    this.semCancelTarget = null;
    this.semCancelResult = '';
    try {
      const ctx: Context = getContext(this) as Context;
      const user = await SeatService.getSession(ctx);
      if (user === null) {
        this.semCancelResult = '未登录，无法取消';
        return;
      }
      const res = await this.svc.cancelReservation(ctx, user.jwt, id);
      this.semCancelResult = res.ok ? '研讨间预约已取消' : (res.message ?? '取消失败');
      if (res.ok) await this.loadSeminars();
    } catch (e) {
      this.semCancelResult = '取消失败：' + (e as Error).message;
    }
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
            // 对齐 Android TaskListScreen：切到列表 tab  refreshAll()
            // （账号级数据，不依赖选区域；用户主动切换=明确刷新意图）
            this.loadMyReservations();
            this.loadReneges();
            this.loadSeminars();
          },
        })
          .margin({ left: 8 })
      }
      .width('100%').padding({ left: 12, right: 12, bottom: 4 })

      Scroll() {
        Column() {
          if (this.seatTab === 'book') {
            // 预约 tab = 新建预约表单（对齐 Android NewTaskScreen，阶段2）
            this.newTaskForm()

            // ── 取消确认条 ──（我的预约取消走二次确认，铁律 0.6）
            if (this.cancelTarget !== null || this.cancelResult.length > 0) {
              this.cancelBlock()
            }
          } else {
            // ── 列表视图（对齐 Android TaskListScreen）──
            // 阶段3：从独立座位图页预约成功后回传的提示（含签到时限），与结果同屏可见。
            if (this.seatReserveMsg.length > 0) {
              Text(this.seatReserveMsg)
                .fontSize(12).fontColor(this.tk().stateAttention).width('100%')
                .padding(10).margin({ bottom: 8 })
                .backgroundColor(this.tk().secondaryContainer).borderRadius(8)
            }
            // 我的预约置顶：预约成功后自动切到本 tab，用户立刻看到结果。
            this.myReservationSection()
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

      // 底部固定预约操作栏（对齐 Android SeatMapScreen.ReserveBottomBar）：
      // 阶段2 预约 tab 改为纯表单（无座位选择），此栏暂不显示；
      // reserveBottomBar()/confirmReserve 完整保留，阶段3 独立座位图页复用。
    }
    .width('100%').height('100%')
    .backgroundColor(this.tk().background)
  }

  /** 底部固定预约栏（对齐 Android ReserveBottomBar，铁律 0.6）：
   *  未选座位 → 提示"先点选空闲座位"；已选 → 显示座位号 + 签到提示 + 确认按钮；
   *  点按钮才真调 confirmReserve（点座位本身只是选中，绝不自动预约）。 */
  @Builder
  reserveBottomBar() {
    Column() {
      if (this.reserveTarget !== null) {
        Row() {
          Text('已选座位 ' + (this.reserveSeatNo.length > 0 ? this.reserveSeatNo : this.reserveTarget))
            .fontSize(13).fontWeight(FontWeight.Bold).fontColor(this.tk().onSurface).layoutWeight(1)
          Text('取消选择')
            .fontSize(11).fontColor(this.tk().primary)
            .onClick(() => {
              this.reserveTarget = null;
              this.reserveSeatNo = '';
              this.reserveResult = '';
            })
        }
        .width('100%')
        Text(signInHintFor(this.queryDay, SeatTreeService.today()))
          .fontSize(11).fontColor(this.tk().stateAttention).width('100%').margin({ top: 4 })
        Button(this.reserveBusy ? '预约中…' : '确认预约 ' + (this.reserveSeatNo.length > 0 ? this.reserveSeatNo : this.reserveTarget))
          .width('100%').height(36).fontSize(13).margin({ top: 8 })
          .backgroundColor(this.tk().primary).fontColor(this.tk().onPrimary)
          .enabled(!this.reserveBusy)
          .onClick(() => {
            this.confirmReserve();
          })
      } else {
        Text('点选上方空闲座位后在此确认预约')
          .fontSize(11).fontColor(this.tk().onSurfaceVariant).width('100%').textAlign(TextAlign.Center)
      }
      if (this.reserveResult.length > 0) {
        Text(this.reserveResult).fontSize(11).fontColor(this.tk().onSurfaceVariant).width('100%').margin({ top: 6 })
      }
      // 会话失效（10001）时给重新授权入口，避免用户卡在一句死提示上。
      // 复用 authorizeSeat()（对齐 Android ensureSeatlibSession：静默续期失败→本人重登）。
      if (this.reserveResult.indexOf('登录已失效') >= 0) {
        Row() {
          Text('座位会话已过期，需要你本人重新授权')
            .fontSize(11).fontColor(this.tk().stateAttention).layoutWeight(1)
          Button(this.seatAuthorizing ? '恢复中…' : '去授权')
            .height(28).fontSize(11)
            .backgroundColor(this.tk().primary).fontColor(this.tk().onPrimary)
            .enabled(!this.seatAuthorizing)
            .onClick(() => {
              this.authorizeSeat();
            })
        }
        .width('100%').margin({ top: 8 }).alignItems(VerticalAlign.Center)
      }
    }
    .width('100%').padding({ left: 12, right: 12, top: 10, bottom: 10 })
    .backgroundColor(this.tk().surfaceVariant)
    .borderRadius({ topLeft: 12, topRight: 12 })
    .alignItems(HorizontalAlign.Start)
  }


  /** 新建预约表单（对齐 Android NewTaskScreen，阶段2）：
   *  标题 → 模式(单次/监控/优先) → 选择日期 → 三级选址 → 已选区域卡片 →
   *  选座区(非单次) → 底部主按钮。纯表单，选座/座位图阶段3接。 */
  @Builder
  newTaskForm() {
    Column() {
      Text('新建预约')
        .fontSize(20).fontWeight(FontWeight.Bold).fontColor(this.tk().onSurface).width('100%')

      // ── 座位授权门禁（对齐 Android SeatAuthGate；阶段3座位图查座位时置 seatAuthExpired）──
      if (this.seatAuthExpired) {
        Column() {
          Text('学校账号已登录，但座位系统尚未授权')
            .fontSize(12).fontColor(this.tk().onSurfaceVariant).width('100%').textAlign(TextAlign.Center)
          if (this.seatAuthorizing) {
            Text('正在恢复座位系统授权…')
              .fontSize(11).fontColor(this.tk().onSurfaceVariant).margin({ top: 6 })
          } else {
            Button('授权座位系统')
              .fontSize(13).height(34).margin({ top: 8 })
              .backgroundColor(this.tk().primary).fontColor(this.tk().onPrimary)
              .onClick(() => {
                this.authorizeSeat();
              })
          }
        }
        .width('100%').padding(10).margin({ top: 10 })
        .backgroundColor(this.tk().secondaryContainer).borderRadius(10)
      }

      // ── 模式选择（对齐 Android ModeSelector）──
      Row() {
        ForEach(this.modeList, (m: FormMode) => {
          SeatChip({
            label: modeLabel(m),
            selected: this.formMode === m,
            onTap: () => {
              this.formMode = m;
              this.formErr = '';
              this.pickHint = '';
            },
          })
            .margin({ right: 8 })
        }, (m: FormMode) => 'mode' + m)
      }
      .width('100%').margin({ top: 4 })

      // ── 选择日期（对齐 Android 选择日期 chip）──
      Text('选择日期')
        .fontSize(15).fontWeight(FontWeight.Bold).fontColor(this.tk().onSurface)
        .width('100%').margin({ top: 16 })
      Row() {
        ForEach(dateOptions(this.availableDays, SeatTreeService.today(),
          tomorrowOf(SeatTreeService.today())), (day: string) => {
          SeatChip({
            label: dateLabel(day, SeatTreeService.today(), tomorrowOf(SeatTreeService.today())),
            selected: this.reserveDate === day,
            onTap: () => {
              this.reserveDate = day;
              this.selCampus = '';
              this.selFloor = '';
              this.selArea = '';
            },
          })
            .margin({ right: 8 })
        }, (day: string) => 'day' + day)
      }
      .width('100%').margin({ top: 6 })
      Text('预约日期: ' + this.reserveDate)
        .fontSize(12).fontColor(this.tk().onSurfaceVariant).width('100%').margin({ top: 4 })

      // ── 三级选址（复用已真机验过的校区/楼层/区域 chip）──
      if (this.treeLoading) {
        Text('加载校区信息…').fontSize(12).fontColor(this.tk().onSurfaceVariant).width('100%').margin({ top: 12 })
      } else if (this.treeErr.length > 0) {
        Text('加载校区信息失败：' + this.treeErr)
          .fontSize(11).fontColor(this.tk().error).width('100%').margin({ top: 12 })
      } else if (this.camps.length === 0) {
        Text('没有可用的座位树').fontSize(12).fontColor(this.tk().onSurfaceVariant).width('100%').margin({ top: 12 })
      } else {
        Text('校区').fontSize(11).fontColor(this.tk().textPlaceholder).width('100%').margin({ top: 12 })
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

        if (this.selFloor.length > 0) {
          Text('区域').fontSize(11).fontColor(this.tk().textPlaceholder).width('100%').margin({ top: 10 })
          if (this.areasOf(this.selFloor).length === 0) {
            Text('该楼层暂无区域').fontSize(11).fontColor(this.tk().onSurfaceVariant).width('100%').margin({ top: 6 })
          } else {
            Flex({ wrap: FlexWrap.Wrap }) {
              ForEach(this.areasOf(this.selFloor), (a: AreaGroup) => {
                SeatChip({
                  label: a.name,
                  selected: this.selArea === a.id,
                  onTap: () => {
                    this.selArea = a.id;
                    this.formErr = '';
                  },
                })
              }, (a: AreaGroup) => 'area' + a.id)
            }
            .width('100%')
          }
        }
      }

      // ── 已选区域卡片（对齐 Android）──
      if (this.selArea.length > 0) {
        Column() {
          Text('已选区域').fontSize(11).fontColor(this.tk().onSurfaceVariant).width('100%')
          Text(this.campusNameOf(this.selCampus) + ' - ' + this.floorNameOf(this.selFloor) + ' - ' + this.areaNameOf(this.selArea))
            .fontSize(14).fontWeight(FontWeight.Bold).fontColor(this.tk().onSurface).width('100%').margin({ top: 4 })
        }
        .width('100%').padding(12).margin({ top: 14 })
        .backgroundColor(this.tk().secondaryContainer).borderRadius(12)
      }

      // ── 目标/偏好座位区（非单次模式，对齐 Android PickedSeatRow）──
      if (this.formMode !== FormMode.SINGLE) {
        Column() {
          Text(pickedSeatTitle(this.formMode))
            .fontSize(13).fontWeight(FontWeight.Bold).fontColor(this.tk().onSurface).width('100%')
          Text(pickedSeatHint(this.formMode))
            .fontSize(11).fontColor(this.tk().onSurfaceVariant).width('100%').margin({ top: 4 })
          Row() {
            if (this.pickedSeatNos.length > 0) {
              Text('已选：' + this.pickedSeatNos.join('、'))
                .fontSize(12).fontColor(this.tk().primary).layoutWeight(1).margin({ top: 6 })
              Text('清空').fontSize(12).fontColor(this.tk().primary).margin({ top: 6 })
                .onClick(() => { this.pickedSeatNos = []; })
            }
          }
          .width('100%')
          Button(pickButtonLabel(this.formMode))
            .height(34).fontSize(12).margin({ top: 8 })
            .backgroundColor(this.tk().primary).fontColor(this.tk().onPrimary)
            .onClick(() => {
              this.openSeatMap(this.formMode);
            })
        }
        .width('100%').padding(12).margin({ top: 14 })
        .backgroundColor(this.tk().surfaceVariant).borderRadius(12)
        .alignItems(HorizontalAlign.Start)
      }

      // ── 错误/提示 ──
      if (this.formErr.length > 0) {
        Text(this.formErr).fontSize(11).fontColor(this.tk().error).width('100%').margin({ top: 8 })
      }
      if (this.pickHint.length > 0) {
        Text(this.pickHint).fontSize(11).fontColor(this.tk().stateAttention).width('100%').margin({ top: 6 })
      }

      // ── 底部主按钮（对齐 Android：选择座位 / 创建任务）──
      Button(primaryButtonLabel(this.formMode))
        .width('100%').height(44).fontSize(14).fontWeight(FontWeight.Bold)
        .margin({ top: 16 })
        .backgroundColor(this.tk().primary).fontColor(this.tk().onPrimary)
        .onClick(() => {
          this.pickHint = '';
          this.formErr = validateForm(this.formMode, this.selArea.length > 0, this.pickedSeatNos.length) ?? '';
          if (this.formErr.length > 0) {
            return;
          }
          // 阶段3：单次=进独立座位图页直接预约；监控/优先=选座回填后建本地任务。
          if (this.formMode === FormMode.SINGLE) {
            this.openSeatMap(FormMode.SINGLE);
          } else {
            this.createTaskFromForm();
          }
        })
    }
    .width('100%').padding({ bottom: 24 })
    .alignItems(HorizontalAlign.Start)
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
    // M11-6：状态色和「点我预约」都是小字，读屏要一句话说清「哪个座位 + 能不能约」
    .accessibilityText(joinA11y([
      s.no.length > 0 ? s.no : s.id,
      isFree(s.status) ? '空闲，点我预约' : (s.statusName.length > 0 ? s.statusName : wireStatusText(s.status))
    ]))
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
    // M11-6：点位上的座位号是 9sp 白字压底图，读屏只听得到号码听不到状态
    .accessibilityText(joinA11y([pm.no, pm.reservable ? '空闲，可预约' : '不可预约']))
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

  /** 我的预约区块（列表 tab 顶部，对齐 Android TaskListScreen 的「我的预约」SectionHeader）。
   *  含标题+条数、刷新按钮、规则文案、卡片列表；预约成功后自动切到本 tab 立即可见。 */
  @Builder
  myReservationSection() {
    Column() {
      Row() {
        Text('我的预约（' + this.myCount + '）')
          .fontSize(13).fontWeight(FontWeight.Bold).fontColor(this.tk().onSurface).layoutWeight(1)
        Text('刷新')
          .fontSize(11).fontColor(this.tk().primary)
          .onClick(() => {
            this.loadMyReservations();
          })
      }
      .width('100%')
      Text('每天最多可取消 2 次 · 座位需刷卡签到')
        .fontSize(10).fontColor(this.tk().onSurfaceVariant).width('100%').margin({ top: 2 })
      if (this.mineLoading) {
        Text('拉取我的预约…').fontSize(11).fontColor(this.tk().onSurfaceVariant).width('100%').margin({ top: 6 })
      } else if (this.mineErr.length > 0) {
        Text(this.mineErr).fontSize(11).fontColor(this.tk().error).width('100%').margin({ top: 6 })
        if (this.mineErr.indexOf('登录已失效') >= 0) {
          Button(this.seatAuthorizing ? '恢复中…' : '去授权')
            .height(28).fontSize(11).margin({ top: 6 })
            .backgroundColor(this.tk().primary).fontColor(this.tk().onPrimary)
            .enabled(!this.seatAuthorizing)
            .onClick(() => {
              this.authorizeSeat();
            })
        }
      } else if (this.mine.length === 0) {
        Text('还没有座位预约').fontSize(11).fontColor(this.tk().onSurfaceVariant)
          .width('100%').margin({ top: 6 })
      } else {
        this.myBlock()
      }
    }
    .width('100%').padding(12).margin({ bottom: 10 })
    .backgroundColor(this.tk().surfaceVariant).borderRadius(12)
    .alignItems(HorizontalAlign.Start)
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

  /** 研讨间卡（列表视图；对齐 Android SeminarCards）。
   *  2026-11-22 补齐：接口真机探针可用（9 条真实数据），渲染真实列表 + 取消（仅 status=2）。
   *  App 内仍不能"发起"研讨间预约（要整间+时段+成员），故保留网页预约入口 + 空态说明。
   *  取消有对外副作用：用户点 → 二次确认 → 才调 cancelReservation（铁律 0.6）。 */
  @Builder
  seminarCard() {
    Column() {
      Row() {
        Text('我的研讨间预约')
          .fontSize(14).fontWeight(FontWeight.Bold)
          .fontColor(this.tk().onSurface).layoutWeight(1)
        Text('刷新')
          .fontSize(12).fontColor(this.tk().primary)
          .onClick(() => { this.loadSeminars(); })
      }
      .width('100%')

      if (this.semLoading) {
        Text('拉取研讨间预约…').fontSize(11).fontColor(this.tk().onSurfaceVariant)
          .width('100%').margin({ top: 6 })
      } else if (this.semErr.length > 0) {
        Text(this.semErr).fontSize(11).fontColor(this.tk().stateAttention)
          .width('100%').margin({ top: 6 })
        if (this.semErr.indexOf('登录已失效') >= 0) {
          Button(this.seatAuthorizing ? '恢复中…' : '去授权座位系统')
            .height(30).fontSize(11).margin({ top: 8 })
            .backgroundColor(this.tk().primary).fontColor(this.tk().onPrimary)
            .enabled(!this.seatAuthorizing)
            .onClick(() => {
              this.authorizeSeat();
            })
        }
      } else if (this.seminars.length > 0) {
        ForEach(this.seminars, (r: SeminarRecord) => {
          Column() {
            Text(r.nameMerge.length > 0 ? r.nameMerge : '研讨间预约')
              .fontSize(13).fontColor(this.tk().onSurface).width('100%')
            Text(formatSeminarTime(r))
              .fontSize(11).fontColor(this.tk().onSurfaceVariant).width('100%').margin({ top: 3 })
            Row() {
              if (!isSeminarCancellable(r) && getSeminarStatusText(r).length > 0) {
                Text(getSeminarStatusText(r))
                  .fontSize(11).fontColor(this.tk().onSurfaceVariant)
              }
              if (isSeminarCancellable(r)) {
                Text(this.semCancelTarget === r.id ? '确认取消?' : '取消预约')
                  .fontSize(11).fontColor(this.tk().stateAttention)
                  .onClick(() => {
                    if (this.semCancelTarget === r.id) {
                      this.confirmSeminarCancel();
                    } else {
                      this.semCancelTarget = r.id;
                      this.semCancelResult = '';
                    }
                  })
              }
            }
            .width('100%').margin({ top: 4 })
          }
          .width('100%').padding(10).margin({ top: 6 })
          .backgroundColor(this.tk().surface).borderRadius(8)
          .alignItems(HorizontalAlign.Start)
        }, (r: SeminarRecord) => r.id)
      } else {
        Text('还没有研讨间预约').fontSize(12).fontColor(this.tk().onSurfaceVariant)
          .width('100%').margin({ top: 6 })
        Text('研讨间要按「整间 + 时段 + 参与成员」提交申请，App 内还没做这一步；先用网页预约，约好后点刷新即可在这里查看和取消。')
          .fontSize(11).fontColor(this.tk().onSurfaceVariant).width('100%').margin({ top: 4 })
        Button('去图书馆网页预约')
          .height(32).fontSize(12).margin({ top: 10 })
          .backgroundColor(this.tk().primary).fontColor(this.tk().onPrimary)
          .onClick(() => {
            router.pushUrl({
              url: 'pages/WebShellPage',
              params: { url: 'https://seatlib.bit.edu.cn' },
            });
          })
      }
      if (this.semCancelResult.length > 0) {
        Text(this.semCancelResult).fontSize(10).fontColor(this.tk().stateAttention)
          .width('100%').margin({ top: 6 })
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
    // M11-6：整卡可点，读屏至少要说清点进去看什么
    .accessibilityText('预约任务，点按打开座位监控面板')
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
  @StorageLink(STORAGE_PALETTE) paletteName: string = 'brand';

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
      .accessibilityText(joinA11y([this.label, this.selected ? '已选中' : '未选中']))
      .onClick(() => {
        this.onTap();
      })
  }
}
