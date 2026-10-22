/**
 * 座位预约纯逻辑层（M9-4 核心算法）。
 *
 * 对照 Android features/seat/.../logic/ 下各 Logic 类：
 * - SeatStatusLogic: 状态码解析
 * - SeatTimeLogic: 时间窗口计算
 * - SeatRiskLogic: 违约风险判定
 * - SeatRuleLogic: 规则校验（最大预约数/冲突检测）
 *
 * ## ⚠️ 铁律 0.6（有对外副作用的动作绝不上自动路径）
 * 本模块**只读**：解析数据、校验规则、计算状态。
 * 实际"提交预约""取消预约"必须通过 Service 层，并由 UI 用户显式触发。
 */

import { type DateTime } from './timeutil.ts';

// ── 内联定义（避免依赖 SessionStore 的 @kit.ArkData） ───────────────────────
export interface SessionSnapshot {
  hasToken: boolean;
  hasSchoolCookies: boolean;
  studentId: string;
  displayName: string;
  savedAtMs: number;
}

// ── 枚举 ─────────────────────────────────────────────────────────────────────

export enum SeatStatus {
  /** 空闲，可预约。 */
  FREE = 'FREE',
  /** 已被你预约，等待签到。 */
  RESERVED_YOURS = 'RESERVED_YOURS',
  /** 已被他人预约。 */
  RESERVED_OTHERS = 'RESERVED_OTHERS',
  /** 已签到，你在座位上。 */
  CHECKED_IN = 'CHECKED_IN',
  /** 已过期（预约时段已过但尚未清理）。 */
  EXPIRED = 'EXPIRED',
  /** 违约（迟到未签到，计入黑名单）。 */
  DEFAULTED = 'DEFAULTED',
  /** 已取消。 */
  CANCELLED = 'CANCELLED',
}

export enum ReservationKind {
  /** 单次预约（最常见）。 */
  SINGLE = 'SINGLE',
  /** 连续预约（连续多个时段）。 */
  CONTINUOUS = 'CONTINUOUS',
  /** 研讨间预约。 */
  SEMINAR_ROOM = 'SEMINAR_ROOM',
}

export enum SignInKind {
  /** NFC/二维码扫码签到（需要物理到场）。 */
  NFC_QR = 'NFC_QR',
  /** GPS 定位签到（需要物理到场）。 */
  GPS = 'GPS',
  /** 系统模拟签到（仅测试用，不允许生产）。 */
  SIMULATED = 'SIMULATED',
}

// ── 数据模型 ─────────────────────────────────────────────────────────────────

/** 一个座位节点（来自 SeatTree 或后端 API）。 */
export interface SeatNode {
  id: string;
  name: string;
  type: number; // 0=校区/楼层, 1=区域, 2=具体座位
  parentId: string | null;
  imageUrl: string | null;
}

/** 一个具体座位的状态快照（后端 API 返回）。 */
export interface SeatSnapshot {
  /** 座位 ID。 */
  seatId: string;
  /** 座位名称。 */
  seatName: string;
  /** 当前状态。 */
  status: SeatStatus;
  /** 预约 ID（status=RESERVED_YOURS/CHECKED_IN 时有值）。 */
  reservationId: string | null;
  /** 预约人姓名（status=RESERVED_OTHERS 时有值）。 */
  otherName: string | null;
  /** 预约时段（开始 epoch day + 分钟，结束 epoch day + 分钟）。 */
  timeRange: [DateTime, DateTime] | null;
  /** 预约类型。 */
  kind: ReservationKind;
  /** 签到方式。 */
  signInKind: SignInKind;
  /** 距离签到截止还有多少分钟（null = 未限制）。 */
  signInDeadlineMinutes: number | null;
  /** 已签到？ */
  isCheckedIn: boolean;
}

/** 预约请求（UI 发起） */
export interface ReserveRequest {
  seatId: string;
  seatName: string;
  startTime: DateTime;
  endTime: DateTime;
  kind: ReservationKind;
}

/** 签到请求。 */
export interface SignInRequest {
  reservationId: string;
  seatId: string;
  kind: SignInKind;
  /** GPS 签到时携带坐标（单位：度）。 */
  gps?: { lat: number; lng: number };
}

/** 取消预约请求。 */
export interface CancelRequest {
  reservationId: string;
  seatId: string;
}

/** 违约计数（与图书馆接口口径一致）。 */
export interface DefaultRecord {
  date: number; // epoch day
  seatName: string;
  reason: string;
}

/** 预约统计快照。 */
export interface ReservationStats {
  totalReserved: number;
  activeReservations: number;
  defaultedCount: number;
  maxDefaultsAllowed: number; // 通常为 5
}

// ── 时刻类型 ──────────────────────────────────────────────────────────────────

/** 时刻 = {epochDay, minutes}（对齐 Android Java epoch day + 分钟口径）。 */
export interface DateTime {
  day: number;
  minutes: number;
}

// ── 工具函数 ──────────────────────────────────────────────────────────────────

/** 把 DateTime 转回 epoch ms（与 Android 对齐）。 */
export function dateTimeToEpochMs(dt: DateTime): number {
  // 输入为北京时间，转为 UTC epoch ms
  return dt.day * 86400000 + dt.minutes * 60000 - 8 * 3600000;
}

/** 把 epoch ms 转回 DateTime（UTC+8 北京时区）。 */
export function epochMsToDateTime(ms: number): DateTime {
  // 将 UTC epoch ms 转为北京时间，再换算为天与分钟
  const beijingMs = ms + 8 * 3600000;
  const day = Math.floor(beijingMs / 86400000);
  const minutes = Math.floor(((beijingMs % 86400000) + 86400000) % 86400000 / 60000);
  return { day, minutes };
}

/** 两个时刻之间的分钟差（目标 - 当前，可为负）。 */
export function minutesBetween(from: DateTime, to: DateTime): number {
  return (to.day - from.day) * 1440 + (to.minutes - from.minutes);
}

/** 检查两个时段是否有重叠（含端点接触）。 */
export function timeOverlap(
  aStart: DateTime,
  aEnd: DateTime,
  bStart: DateTime,
  bEnd: DateTime
): boolean {
  return dateTimeToEpochMs(aStart) < dateTimeToEpochMs(bEnd) &&
         dateTimeToEpochMs(bStart) < dateTimeToEpochMs(aEnd);
}

/** 生成预约 ID（16 位十六进制，对齐 Android UUID 截断）。 */
export function generateReservationId(): string {
  const buf = new Uint8Array(8);
  crypto.getRandomValues(buf);
  return Array.from(buf, b => b.toString(16).padStart(2, '0')).join('');
}

/** 座位类型名称映射。 */
export function seatTypeName(type: number): string {
  switch (type) {
    case 0: return '区域';
    case 1: return '楼层';
    case 2: return '座位';
    default: return '未知';
  }
}

/** 预约状态中文文案。 */
export function statusText(status: SeatStatus): string {
  switch (status) {
    case SeatStatus.FREE: return '空闲';
    case SeatStatus.RESERVED_YOURS: return '已预约';
    case SeatStatus.RESERVED_OTHERS: return '被占';
    case SeatStatus.CHECKED_IN: return '签到中';
    case SeatStatus.EXPIRED: return '已过期';
    case SeatStatus.DEFAULTED: return '已违约';
    case SeatStatus.CANCELLED: return '已取消';
    default: return '未知';
  }
}

/** 预约状态颜色（浅色模式，深色模式反转）。 */
export function statusColor(status: SeatStatus, isDark: boolean): string {
  switch (status) {
    case SeatStatus.FREE:
      return isDark ? '#2E7D32' : '#4CAF50';
    case SeatStatus.RESERVED_YOURS:
      return isDark ? '#1565C0' : '#1976D2';
    case SeatStatus.RESERVED_OTHERS:
      return isDark ? '#C62828' : '#E53935';
    case SeatStatus.CHECKED_IN:
      return isDark ? '#2E7D32' : '#43A047';
    case SeatStatus.EXPIRED:
      return isDark ? '#546E7A' : '#78909C';
    case SeatStatus.DEFAULTED:
      return isDark ? '#BF360C' : '#FF5722';
    case SeatStatus.CANCELLED:
      return isDark ? '#37474F' : '#90A4AE';
    default:
      return isDark ? '#455A64' : '#B0BEC5';
  }
}

/** 计算剩余签到时间（分钟）。 */
export function remainingSignInMinutes(
  deadline: DateTime,
  now: DateTime
): number {
  return Math.max(0, minutesBetween(now, deadline));
}

/** 判断是否即将签到截止（< 10 分钟）。 */
export function isSignInUrgent(deadline: DateTime, now: DateTime): boolean {
  return remainingSignInMinutes(deadline, now) <= 10 &&
         remainingSignInMinutes(deadline, now) > 0;
}

// ── 规则校验 ──────────────────────────────────────────────────────────────────

/** 单次最大预约时段（分钟）。超过则拒绝。 */
export const MAX_RESERVATION_MINUTES: number = 480; // 8 小时

/** 最大连续预约数（同时段）。 */
export const MAX_CONCURRENT_RESERVATIONS: number = 3;

/** 预约提前量最小值（分钟）。不允许预约"过去"的时段。 */
export const MIN_RESERVATION_LEAD_MINUTES: number = 30;

/**
 * 校验预约请求是否合法。
 * @returns null = 通过；错误文案 = 失败。
 */
export function validateReserveRequest(
  req: ReserveRequest,
  userSessions: SessionSnapshot,
  existingReservations: SeatSnapshot[],
  now: DateTime
): string | null {
  // 登录态检查
  if (!userSessions.hasToken) {
    return '请先登录座位系统';
  }

  // 时段长度检查
  const duration = minutesBetween(req.startTime, req.endTime);
  if (duration <= 0) {
    return '结束时间必须晚于开始时间';
  }
  if (duration > MAX_RESERVATION_MINUTES) {
    return `单次预约最长 ${MAX_RESERVATION_MINUTES / 60} 小时`;
  }

  // 提前量检查（不能预约过去的时段）
  const leadMinutes = minutesBetween(now, req.startTime);
  if (leadMinutes < MIN_RESERVATION_LEAD_MINUTES) {
    return `请至少提前 ${MIN_RESERVATION_LEAD_MINUTES} 分钟预约`;
  }

  // 并发预约检查
  const conflicting = existingReservations.filter(r => {
    if (!r.timeRange) return false;
    return timeOverlap(
      req.startTime, req.endTime,
      r.timeRange[0], r.timeRange[1]
    ) && r.status !== SeatStatus.CANCELLED;
  });
  if (conflicting.length >= MAX_CONCURRENT_RESERVATIONS) {
    return `最多同时预约 ${MAX_CONCURRENT_RESERVATIONS} 个时段`;
  }

  return null;
}

// ── 违约判定 ──────────────────────────────────────────────────────────────────

/**
 * 判定一次预约是否违约。
 * 违约条件：预约后未在截止时间前签到。
 */
export function isDefaulted(
  reservation: SeatSnapshot,
  now: DateTime
): boolean {
  if (reservation.status !== SeatStatus.RESERVED_YOURS) return false;
  if (!reservation.signInDeadlineMinutes) return false;
  // 签到截止 = 预约开始时间 - signInDeadlineMinutes
  const deadline: DateTime = {
    day: reservation.timeRange![0].day,
    minutes: reservation.timeRange![0].minutes - reservation.signInDeadlineMinutes,
  };
  return minutesBetween(now, deadline) < 0;
}

/**
 * 计算违约计数（从历史违约记录聚合）。
 * 默认最大值 = 5（与图书馆口径一致）。
 */
export function countDefaults(records: DefaultRecord[]): number {
  return records.length;
}

/**
 * 判断是否达到违约上限（达到后禁止新预约，仅保留现有签到状态）。
 */
export function hitDefaultLimit(records: DefaultRecord[]): boolean {
  return countDefaults(records) >= 5;
}

/**
 * 格式化违约原因（人话）。
 */
export function defaultReasonText(record: DefaultRecord): string {
  const absDate = Math.abs(record.date);
  const hours = absDate > 1 ? `${absDate} 天前` : '今天';
  return `预约「${record.seatName}」未按时签到 · ${hours}`;
}

// ── 预约统计 ──────────────────────────────────────────────────────────────────

/**
 * 计算当前预约统计（基于快照列表，不含历史）。
 */
export function calcStats(
  snapshots: SeatSnapshot[],
  defaultRecords: DefaultRecord[]
): ReservationStats {
  const totalReserved = snapshots.filter(s =>
    s.status === SeatStatus.RESERVED_YOURS ||
    s.status === SeatStatus.CHECKED_IN
  ).length;

  const activeReservations = snapshots.filter(s =>
    s.status === SeatStatus.RESERVED_YOURS ||
    s.status === SeatStatus.CHECKED_IN
  ).length;

  return {
    totalReserved,
    activeReservations,
    defaultedCount: countDefaults(defaultRecords),
    maxDefaultsAllowed: 5,
  };
}

// ── 快捷签到任务 ID（卡片/通知用）。 */
export const QUICK_RESERVE_TASK_PREFIX: string = 'seat_quick_';
export function makeQuickReserveTaskId(seatId: string): string {
  return QUICK_RESERVE_TASK_PREFIX + seatId;
}
