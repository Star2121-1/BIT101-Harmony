/**
 * 研讨间预约逻辑层（M9-7）。
 *
 * 对照 Android Seminar.kt：
 * - 研讨间与座位共用同一套后端（/api/Seminar/*）
 * - 我的研讨间预约：POST /api/Member/seminar（body 空 {}）
 * - 取消：POST /api/Space/cancel（与座位共用）
 * - status="2" 时可取消
 *
 * ## ⚠️ 铁律 0.6
 * - 取消操作必须由用户显式触发
 * - 本模块只做数据解析和状态判断
 */

import { num as jsonNum, str as jsonStr } from '../core/model/SchoolModels.ts';
import type { JsonValue } from '../core/model/SchoolModels.ts';
/** 研讨间预约记录。 */
export interface SeminarRecord {
  /** 预约 ID（取消时用）。 */
  id: string;
  /** 房间合并名（如 "研讨间A-101"）。 */
  nameMerge: string;
  /** 日期（如 "2026-10-25"）。 */
  day: string;
  /** 开始时间（如 "14:00"）。 */
  start: string;
  /** 结束时间（如 "16:00"）。 */
  end: string;
  /** 状态码（"2" = 可取消）。 */
  status: string;
  /** 状态文案（服务端返回）。 */
  statusName: string;
}

/** 可取消的状态码。 */
export const SEMINAR_STATUS_CANCELLABLE = '2';

/** 判断是否可取消。 */
export function isSeminarCancellable(record: SeminarRecord): boolean {
  return record.status === SEMINAR_STATUS_CANCELLABLE;
}

/**
 * 格式化时间文本。
 *
 * 格式：`2026-10-25 14:00-16:00`
 */
export function formatSeminarTime(record: SeminarRecord): string {
  const d = record.day.trim();
  const s = record.start.trim().substring(0, 5);
  const e = record.end.trim().substring(0, 5);
  const parts = [d, s && e ? `${s}-${e}` : ''].filter(Boolean);
  return parts.join(' ');
}

/**
 * 获取状态文案（优先用服务端返回的 statusName）。
 */
export function getSeminarStatusText(record: SeminarRecord): string {
  return record.statusName || record.status;
}

/**
 * 构建取消请求体。
 *
 * 对齐 Android：POST /api/Space/cancel，body = { seminar_id: id }
 */
export function buildCancelSeminarBody(record: SeminarRecord): Record<string, JsonValue> {
  return { seminar_id: record.id };
}

/**
 * 解析服务端响应。
 *
 * 格式：`{"code":1,"message":"success"}` 或 `{"code":0,"message":"错误信息"}`
 */
export function parseSeminarCancelResponse(response: Record<string, JsonValue>): { ok: boolean; message: string } {
  const code = jsonNum(response, 'code', 0);
  const message = jsonStr(response, 'message', '');
  return {
    ok: code === 1,
    message: code === 1 ? '取消成功' : (message.length > 0 ? message : '取消失败'),
  };
}
