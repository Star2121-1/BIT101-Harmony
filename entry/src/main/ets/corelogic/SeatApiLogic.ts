/**
 * 座位接口纯逻辑层（M9）—— **Android 权威契约 1:1**。
 *
 * ## 为什么有这个文件（铁律 0.9 / 0）
 * 早期 `SeatService` 用了**臆造端点**（`/api/Seat/schedule`、`/api/Seat/reserve`、
 * `/api/Seat/cancel` 配自造 body），与 Android 实测契约不符 ⇒ 对真实服务端**全部静默失败**。
 * 本层把「端点 + body 构建 + 响应解析 + 状态映射 + 签到规则」抽成纯函数，
 * 每一条都对齐 `BIT101-seat` 的 `SeatApi.kt` / `SeatResponseParser.kt` / `Seat.kt` 实测，
 * 可离线单测证伪（不碰 @kit，Node 直接跑）。`SeatService` 只留 @kit 薄壳委托这里。
 *
 * ## Android 契约（逐条来源）
 * - 取时段  `POST /api/Seat/date`   body{}|{build_id} → data[{day, times:[{id,start,end}]}]
 *   实测 times[].id/start/end **恒为 null** ⇒ segment 回落到默认 "1"（正常路径，非边界）
 * - 取座位  `POST /api/Seat/seat`   body{area,segment,day,startTime,endTime}
 *   → data[{id,no,status(字符串),status_name,point_x,y,width,height}]
 * - 预约    `POST /api/Seat/confirm` body{seat_id(int), segment} → code===1 成功
 * - 我的预约 `POST /api/index/subscribe` body{type:"1"} → data[ReservationRecord]
 *   （`id`=预约记录 id、`space`=座位 id、`no`=座位号、`status "2"`=未签到有效）
 * - 取消    `POST /api/Space/cancel` body{id=预约记录id}
 *   ⚠️ 传座位 id 恒失败（2026-09-18 实测），必须先换成记录 id
 * - 违约    `POST /api/Member/reneges` body{type:1|2}
 * - 研讨间  `POST /api/Member/seminar` body{}
 * - 底图    `POST /api/seat/map` body{id=areaId}（参数名**必须**是 id，传 area 恒 500）
 * - 状态码（官方前端 seat-map.js）：1→空闲 / 2,10,11→已预约 / 6,8,9→在用 / 7→暂离 / 3,4,5→停用
 * - 签到截止：预约当日=开始+60min；次日=09:00（`/api/index/booking_rules` 原文）
 */

// ── 端点表（唯一事实源；service 不写死 URL）────────────────────────────────

export const ENDPOINTS = {
  tree: '/api/Seat/tree',
  date: '/api/Seat/date',
  seat: '/api/Seat/seat',
  confirm: '/api/Seat/confirm',
  subscribe: '/api/index/subscribe',
  cancel: '/api/Space/cancel',
  map: '/api/seat/map',
  reneges: '/api/Member/reneges',
  seminar: '/api/Member/seminar',
} as const;

/** 时段 id 的默认回落值（times[].id 实测恒 null ⇒ 用 "1"，是正常路径）。 */
export const DEFAULT_SEGMENT_ID: string = '1';

// ── 服务端状态码 → 归一状态（对齐官方前端 seat-map.js）────────────────────

/** 归一后的座位状态（5 类；「我的」是交叉标记，不由服务端给）。 */
export type WireSeatStatus =
  | 'AVAILABLE'   // 1 空闲可约
  | 'RESERVED'    // 2/10/11 已预约（不区分是不是本人）
  | 'IN_USE'      // 6/8/9 在用
  | 'LEAVE'       // 7 临时离开
  | 'UNAVAILABLE'; // 3/4/5/未知 暂停/不可用（宁可不让点）

/**
 * 服务端状态码（字符串）→ 归一状态。
 * 未知值一律 UNAVAILABLE（铁律：宁可不让点，也不要错报成可约）。
 */
export function seatStatusOf(raw: string | null | undefined): WireSeatStatus {
  switch ((raw ?? '').trim()) {
    case '1': return 'AVAILABLE';
    case '2':
    case '10':
    case '11': return 'RESERVED';
    case '6':
    case '8':
    case '9': return 'IN_USE';
    case '7': return 'LEAVE';
    default: return 'UNAVAILABLE';
  }
}

/** 是否可作为预约目标（单人预约只允许空位）。 */
export function isFree(status: WireSeatStatus): boolean {
  return status === 'AVAILABLE';
}

// ── 座位模型 + 解析 ───────────────────────────────────────────────────────

/** 单个座位（wire 形态，含底图百分比坐标）。 */
export interface WireSeat {
  id: string;
  /** 座位号（服务端为补零字符串，如 "001"）。 */
  no: string;
  /** 服务端原文状态码（"1".."11"）。 */
  statusRaw: string;
  /** 归一状态。 */
  status: WireSeatStatus;
  /** 服务端原文状态名（「空闲」「已预约」），比数字稳。 */
  statusName: string;
  areaId: string | null;
  /** 底图百分比坐标（服务端实测全量有值；缺失则 null）。 */
  pointX: number | null;
  pointY: number | null;
  width: number | null;
  height: number | null;
}

/** 坐标字段可能是字符串浮点（如 "69.106880000000004"），解析失败返回 null。 */
function optNum(v: unknown): number | null {
  if (v === undefined || v === null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** 解析 `/api/Seat/seat` 的 data 数组。 */
export function parseSeats(data: Array<Record<string, unknown>>, areaId: string): WireSeat[] {
  const out: WireSeat[] = [];
  for (const s of data) {
    const id: string = String(s['id'] ?? '');
    if (id.length === 0) continue;
    const statusRaw: string = String(s['status'] ?? '');
    const statusName: string = String(s['status_name'] ?? '');
    out.push({
      id,
      no: String(s['no'] ?? ''),
      statusRaw,
      status: seatStatusOf(statusRaw),
      statusName: statusName.length > 0 ? statusName : '',
      areaId: areaId.length > 0 ? areaId : null,
      pointX: optNum(s['point_x']),
      pointY: optNum(s['point_y']),
      width: optNum(s['width']),
      height: optNum(s['height']),
    });
  }
  return out;
}

// ── 时段模型 + 解析 ───────────────────────────────────────────────────────

/** `/api/Seat/date` 的一个时段（id/start/end 实测恒 null，回落默认是正常路径）。 */
export interface WireSeatDate {
  day: string;
  segmentId: string;
  start: string;
  end: string;
}

/** 解析时段：把每个 times 条目展开；id/start/end 缺失时回落（id→默认段、start/end→""）。 */
export function parseSeatDates(data: Array<Record<string, unknown>>): WireSeatDate[] {
  const out: WireSeatDate[] = [];
  for (const dayObj of data) {
    const day: string = String(dayObj['day'] ?? '');
    const timesRaw: unknown = dayObj['times'];
    if (!Array.isArray(timesRaw)) continue;
    const times: Array<Record<string, unknown>> = timesRaw as Array<Record<string, unknown>>;
    for (const t of times) {
      const id: unknown = t['id'];
      const start: unknown = t['start'];
      const end: unknown = t['end'];
      out.push({
        day,
        segmentId: id === null || id === undefined || id === '' ? '' : String(id),
        start: start === null || start === undefined ? '' : String(start),
        end: end === null || end === undefined ? '' : String(end),
      });
    }
  }
  return out;
}

/** 把（可能为空的）segmentId 回落到默认段。 */
export function usableSegment(segmentId: string): string {
  return segmentId.length > 0 ? segmentId : DEFAULT_SEGMENT_ID;
}

// ── 我的预约 + 解析 ───────────────────────────────────────────────────────

/** 「我的预约」记录（`/api/index/subscribe` type="1"）。 */
export interface MyReservation {
  /** 预约记录 id（取消时传这个，不是座位 id）。 */
  id: string;
  /** 座位 id（= 服务端 space 字段）。 */
  seatId: string;
  /** 座位号（= no）。 */
  seatNo: string;
  areaId: string | null;
  areaName: string;
  /** 预约时段开始（"2026-09-18 11:03:27"）。 */
  beginTime: string;
  endTime: string;
  /** 状态码（"2" = 未签到的有效预约）。 */
  status: string;
  statusName: string | null;
  leaveSince: number | null;
  /** 是否仍未签到（status "2"）。 */
  isActive: boolean;
}

/** 解析「我的预约」。⚠️ 服务端把座位 id 放在 `space`、座位号放在 `no`。 */
export function parseMyReservations(data: Array<Record<string, unknown>>): MyReservation[] {
  const out: MyReservation[] = [];
  for (const r of data) {
    const id: string = String(r['id'] ?? '');
    if (id.length === 0) continue;
    const status: string = String(r['status'] ?? '');
    const statusNameRaw: unknown = r['statusName'] ?? r['status_name'];
    const leaveSinceRaw: unknown = r['leaveSince'] ?? r['leave_since'];
    out.push({
      id,
      seatId: String(r['space'] ?? ''),
      seatNo: String(r['no'] ?? ''),
      areaId: optStrOrNull(r['areaId'] ?? r['area_id']),
      areaName: String(r['areaName'] ?? r['area_name'] ?? ''),
      beginTime: String(r['beginTime'] ?? r['begin_time'] ?? ''),
      endTime: String(r['endTime'] ?? r['end_time'] ?? ''),
      status,
      statusName: statusNameRaw === undefined || statusNameRaw === null ? null : String(statusNameRaw),
      leaveSince: optNum(leaveSinceRaw),
      isActive: status === '2',
    });
  }
  return out;
}

function optStrOrNull(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v);
  return s.length > 0 ? s : null;
}

// ── 违约 / 研讨间 解析 ────────────────────────────────────────────────────

/** 违约记录（`/api/Member/reneges`，type 1=座位 2=研讨室）。 */
export interface RenegeRecord {
  nameMerge: string;
  name: string;
  time: string;
  status: string;
  statusName: string;
}

/** 解析违约。⚠️ 接口不给 id，身份键 = nameMerge|name|time（去重/增量用）。 */
export function parseRenege(data: Array<Record<string, unknown>>): RenegeRecord[] {
  const out: RenegeRecord[] = [];
  for (const r of data) {
    out.push({
      nameMerge: String(r['nameMerge'] ?? r['name_merge'] ?? ''),
      name: String(r['name'] ?? ''),
      time: String(r['time'] ?? ''),
      status: String(r['status'] ?? ''),
      statusName: String(r['statusName'] ?? r['status_name'] ?? ''),
    });
  }
  return out;
}

/** 违约记录身份键（无 id，合成：合并名|具体名|时间精确到分）。 */
export function renegeKey(r: RenegeRecord): string {
  return r.nameMerge + '|' + r.name + '|' + r.time;
}

// ── body 构建（对齐 Android jsonBody，1:1）────────────────────────────────

/** 座位号 → 数字（服务端按 int 处理；补零 "001" → 1）。非法则原样返回字符串。 */
export function seatIdToNumber(seatId: string): number | string {
  const n: number = parseInt(seatId.trim(), 10);
  return Number.isFinite(n) ? n : seatId;
}

/** `/api/Seat/seat`：取某区域某时段的座位。 */
export function buildSeatBody(
  area: string, segment: string, day: string, startTime: string, endTime: string
): Record<string, unknown> {
  return { area, segment, day, startTime, endTime };
}

/** `/api/Seat/confirm`：seat_id 必须是 int，segment 用（回落后的）时段 id。 */
export function buildConfirmBody(seatId: string, segment: string): Record<string, unknown> {
  return { seat_id: seatIdToNumber(seatId), segment: usableSegment(segment) };
}

/** `/api/index/subscribe`：我的座位预约。 */
export function buildSubscribeBody(): Record<string, unknown> {
  return { type: '1' };
}

/** `/api/Space/cancel`：传**预约记录 id**（不是座位 id）。 */
export function buildCancelBody(recordId: string): Record<string, unknown> {
  return { id: recordId };
}

/** `/api/seat/map`：参数名**必须**是 id。 */
export function buildMapBody(areaId: string): Record<string, unknown> {
  return { id: areaId };
}

/** `/api/Member/reneges`：type 1=座位 2=研讨室。 */
export function buildRenegeBody(type: number): Record<string, unknown> {
  return { type };
}

/** `/api/Member/seminar`：无参数。 */
export function buildSeminarBody(): Record<string, unknown> {
  return {};
}

// ── 业务响应判定 ─────────────────────────────────────────────────────────

/**
 * 判定一个业务响应是否成功（seatlib 惯例：HTTP 200 + code===1）。
 * @returns ok / 错误文案（未登录时 code 常为 10001，如实报「登录失效」）。
 */
export function bizResult(
  envelope: Record<string, unknown>
): { ok: boolean; message: string; data: unknown } {
  const code: number = Number(envelope['code'] ?? -1);
  if (code === 1) {
    return { ok: true, message: '', data: envelope['data'] ?? null };
  }
  const msg: unknown = envelope['message'] ?? envelope['msg'];
  const text: string = typeof msg === 'string' && msg.length > 0 ? msg : '';
  // ⚠️ 不拼「预约失败」前缀——UI 会再拼一次（Android 真机见过双重前缀）
  if (code === 10001) {
    return { ok: false, message: '登录已失效，请重新登录', data: null };
  }
  return { ok: false, message: text.length > 0 ? text : '操作失败（code ' + code + '）', data: null };
}

// ── 签到截止规则（/api/index/booking_rules 原文）─────────────────────────

/**
 * 签到截止时刻（epoch day + 分钟，北京时间基准，与 timeutil.DateTime 同构）。
 * - 预约**当日**：开始 + 60 分钟
 * - 预约**次日**：次日 09:00
 * - 其它日期：null（无法判断）
 */
export function signInDeadline(
  beginDay: number, beginMin: number, nowDay: number
): { day: number; minutes: number } | null {
  if (beginDay === nowDay) {
    return { day: beginDay, minutes: beginMin + 60 };
  }
  if (beginDay === nowDay + 1) {
    return { day: beginDay, minutes: 9 * 60 };
  }
  return null;
}

/** 签到提示文案（对齐 Android signInHint；无法判断时返回 ''）。 */
export function signInHintText(
  beginDay: number, beginMin: number, nowDay: number
): string {
  const dl = signInDeadline(beginDay, beginMin, nowDay);
  if (dl === null) return '';
  const hm = (m: number): string => {
    const mm = ((m % 1440) + 1440) % 1440;
    return String(Math.floor(mm / 60)).padStart(2, '0') + ':' + String(mm % 60).padStart(2, '0');
  };
  if (beginDay === nowDay) {
    return '今日预约 · 请在 ' + hm(dl.minutes) + ' 前刷卡签到';
  }
  return '次日预约 · 请在 09:00 前刷卡签到';
}

// ── 座位号比较 / 排序（补零口径，Android 实测）───────────────────────────

/** 座位号相等：补零写法与裸数字视为相同（"001" == "1"）。 */
export function seatNumberEquals(actual: string, expected: string): boolean {
  const a = actual.trim();
  const b = expected.trim();
  if (a === b) return true;
  const na = parseInt(a, 10);
  const nb = parseInt(b, 10);
  return Number.isFinite(na) && Number.isFinite(nb) && na === nb;
}

/** 座位号比较器：数字按数值排（"10" 在 "9" 后），非数字排最后按字符串。 */
export function compareSeatNumber(a: string, b: string): number {
  const na = parseInt(a.trim(), 10);
  const nb = parseInt(b.trim(), 10);
  const av = Number.isFinite(na) ? na : Number.MAX_SAFE_INTEGER;
  const bv = Number.isFinite(nb) ? nb : Number.MAX_SAFE_INTEGER;
  if (av !== bv) return av - bv;
  return a.trim().localeCompare(b.trim());
}
