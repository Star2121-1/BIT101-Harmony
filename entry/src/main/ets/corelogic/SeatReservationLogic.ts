/**
 * 我的预约逻辑层（M9-5）。
 *
 * 对照 Android SeatViewModel 中的预约记录管理逻辑。
 *
 * ## ⚠️ 铁律 0.6（有对外副作用的动作绝不上自动路径）
 * - 取消操作必须由 UI 用户显式点击触发
 * - 本模块只做「数据管理 + 校验」，不发起网络请求
 */

import { type DateTime } from './timeutil.ts';
import { num as jsonNum, str as jsonStr } from '../core/model/SchoolModels.ts';
import type { JsonValue } from '../core/model/SchoolModels.ts';
import { SeatStatus, type Seat } from '../model/SeatModel.ts';
import { SeatStatus as LogicSeatStatus } from './SeatLogic.ts';

/**
 * 一条预约记录（来自服务端 /api/index/subscribe）。
 */
export interface ReservationRecord {
  /** 预约记录 ID（用于取消操作）。 */
  id: string;
  /** 座位 ID。 */
  seatId: string;
  /** 座位号。 */
  seatNo: string;
  /** 所属区域 ID。 */
  areaId: string;
  /** 预约时段 ID。 */
  segmentId: string;
  /** 预约开始时间。 */
  startTime: DateTime;
  /** 预约结束时间。 */
  endTime: DateTime;
  /** 签到截止时间。 */
  signInDeadline: DateTime;
  /** 当前状态。 */
  status: number;
  /** 是否已签到。 */
  isCheckedIn: boolean;
}

/**
 * 预约状态判断。
 */
export function getReservationStatus(record: ReservationRecord, now: DateTime): {
  status: SeatStatus;
  isExpired: boolean;
  isSignInUrgent: boolean;
  signInRemainingMinutes: number;
} {
  const signInDeadline = record.signInDeadline;
  const signInRemaining = minutesBetween(now, signInDeadline);
  const isExpired = signInRemaining < 0;
  const isSignInUrgent = signInRemaining > 0 && signInRemaining <= 10;

  let status: SeatStatus;
  if (record.isCheckedIn) {
    status = LogicSeatStatus.CHECKED_IN;
  } else if (isExpired) {
    status = LogicSeatStatus.EXPIRED;
  } else {
    status = LogicSeatStatus.RESERVED_YOURS;
  }

  return {
    status,
    isExpired,
    isSignInUrgent,
    signInRemainingMinutes: Math.max(0, signInRemaining),
  };
}

/**
 * 构建取消请求参数。
 *
 * 对齐 Android SeatApi.cancelSeat：
 *   val body = jsonBody(JSONObject().put("reservation_id", recordId))
 */
export function buildCancelBody(record: ReservationRecord): Record<string, JsonValue> {
  return {
    reservation_id: record.id,
    seat_id: parseInt(record.seatId, 10) || record.seatId,
  };
}

/**
 * 从服务响应中解析取消结果。
 */
export function parseCancelResponse(response: Record<string, JsonValue>): { ok: boolean; message: string } {
  const code = jsonNum(response, 'code', 0);
  if (code === 1) {
    return { ok: true, message: '取消成功' };
  }
  const byMessage = jsonStr(response, 'message', '');
  const byError = jsonStr(response, 'error', '');
  const message = byMessage.length > 0 ? byMessage : (byError.length > 0 ? byError : '取消失败');
  return { ok: false, message };
}

/**
 * 计算预约剩余时长（分钟）。
 */
export function remainingReservationMinutes(record: ReservationRecord, now: DateTime): number {
  return minutesBetween(now, record.endTime);
}

/**
 * 判断预约是否正在进行中（已开始但未结束）。
 */
export function isReservationActive(record: ReservationRecord, now: DateTime): boolean {
  const startMs = dateTimeToEpochMs(record.startTime);
  const endMs = dateTimeToEpochMs(record.endTime);
  const nowMs = dateTimeToEpochMs(now);
  return nowMs >= startMs && nowMs < endMs;
}

/**
 * 判断预约是否可以取消（开始时间前 15 分钟内不可取消）。
 */
export function canCancelReservation(record: ReservationRecord, now: DateTime): boolean {
  const minutesToStart = minutesBetween(now, record.startTime);
  return minutesToStart > 15 && !record.isCheckedIn;
}

// ── 工具函数 ──────────────────────────────────────────────────────────────────

function minutesBetween(from: DateTime, to: DateTime): number {
  return (to.day - from.day) * 1440 + (to.minutes - from.minutes);
}

function dateTimeToEpochMs(dt: DateTime): number {
  return dt.day * 86400000 + dt.minutes * 60000;
}
