/**
 * 座位预约纯逻辑层（M9-4）。
 *
 * 对照 Android SeatViewModel 中的校验 + 请求组装逻辑。
 *
 * ## ⚠️ 铁律 0.6（有对外副作用的动作绝不上自动路径）
 * - 本模块只做「参数校验 + 请求体构建」，不发起网络请求
 * - 网络请求由 SeatService（外部依赖）负责，UI 层直接调用 Service
 */

import { type DateTime } from './timeutil.ts';

/** 预约请求参数（由 UI 组装后传入）。 */
export interface ReserveParams {
  /** 座位 ID（来自 SeatMapEntry.seatId）。 */
  seatId: string;
  /** 座位号（展示用）。 */
  seatNo: string;
  /** 所属区域 ID。 */
  areaId: string;
  /** 预约时段 ID（来自 /api/Seat/date 接口）。 */
  segmentId: string;
  /** 预约开始时间。 */
  startTime: DateTime;
  /** 预约结束时间。 */
  endTime: DateTime;
}

/** 预约结果。 */
export type ReserveResult =
  | { ok: true; reservationId: string; seatId: string }
  | { ok: false; error: string };

/**
 * 校验预约参数。
 *
 * @returns null = 通过；错误文案 = 失败。
 */
export function validateReserveParams(params: ReserveParams): string | null {
  if (!params.seatId || params.seatId.length === 0) {
    return '座位 ID 无效';
  }
  if (!params.areaId || params.areaId.length === 0) {
    return '区域信息缺失';
  }
  if (!params.segmentId || params.segmentId.length === 0) {
    return '时段 ID 缺失';
  }
  const duration = minutesBetween(params.startTime, params.endTime);
  if (duration <= 0) {
    return '结束时间必须晚于开始时间';
  }
  if (duration > 480) {
    return '单次预约最长 8 小时';
  }
  return null;
}

/**
 * 构建服务端请求体。
 *
 * 对齐 Android SeatApi.confirmSeat：
 *   val body = jsonBody(
 *     JSONObject().apply { put("seat_id", seatIdNum); put("segment", segment) }
 *   )
 */
export function buildReserveBody(params: ReserveParams): Record<string, unknown> {
  // seat_id 必须是数字（服务端按 int 处理）
  const seatIdNum = parseInt(params.seatId, 10) || params.seatId;
  return {
    seat_id: seatIdNum,
    segment: params.segmentId,
  };
}

/**
 * 从服务响应中提取预约 ID。
 *
 * Android 侧：`json.optLong("id")` 或 `json.optString("reservation_id")`
 * 鸿蒙侧对齐此逻辑。
 */
export function extractReservationId(response: Record<string, unknown>): string | null {
  const id = response['id'] ?? response['reservation_id'];
  if (id === undefined || id === null) return null;
  return String(id);
}

/**
 * 解析服务端的错误信息。
 */
export function parseReserveError(statusCode: number, responseBody: string): string {
  let message: string = '';
  try {
    const json = JSON.parse(responseBody) as Record<string, unknown>;
    message = String(json['message'] ?? json['error'] ?? responseBody);
  } catch {
    message = responseBody;
  }
  // 不要在这里拼前缀 —— UI 会再拼一次，避免双重前缀
  if (statusCode === 401) {
    return message || '登录已失效，请重新登录';
  }
  if (statusCode >= 500) {
    return `服务端错误（${statusCode}）`;
  }
  return message || `预约失败（HTTP ${statusCode}）`;
}

/**
 * 计算预约的签到截止时间。
 *
 * 规则：签到截止 = 开始时间 - 15 分钟（默认提前量）。
 * 处理跨天边界：负分钟借位到前一天。
 */
export function calcSignInDeadline(startTime: DateTime): DateTime {
  let day = startTime.day;
  let minutes = startTime.minutes - 15;
  while (minutes < 0) {
    minutes += 1440;
    day -= 1;
  }
  return { day, minutes };
}

/**
 * 两个时刻之间的分钟差（目标 - 当前，可为负）。
 */
function minutesBetween(from: DateTime, to: DateTime): number {
  return (to.day - from.day) * 1440 + (to.minutes - from.minutes);
}
