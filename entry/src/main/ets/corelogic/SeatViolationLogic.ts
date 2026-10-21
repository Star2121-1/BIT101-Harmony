/**
 * 座位违约记录逻辑层（M9-6）。
 *
 * 对照 Android SeatViolationLogic：
 * - 违约计数上限 = 5（与图书馆接口口径一致）
 * - 违约记录保留 30 天
 *
 * ## ⚠️ 铁律 0.6（有对外副作用的动作绝不上自动路径）
 * - 违约判定由服务端控制，本地只做存储和展示
 * - 本模块只做「数据管理 + 显示逻辑」，不发起网络请求
 */

import { type DateTime } from './timeutil.ts';

/**
 * 违约记录（来自服务端 /api/seat/violations 或本地缓存）。
 */
export interface ViolationRecord {
  /** 违约记录 ID。 */
  id: string;
  /** 违约发生日期（epoch day）。 */
  date: number;
  /** 座位号。 */
  seatNo: string;
  /** 所属区域。 */
  areaName: string;
  /** 违约原因（服务端返回）。 */
  reason: string;
}

/**
 * 违约计数上限（与图书馆接口口径一致）。
 */
export const MAX_VIOLATIONS = 5;

/**
 * 违约记录保留天数。
 */
export const VIOLATION_RETAIN_DAYS = 30;

/**
 * 判断是否达到违约上限。
 */
export function isViolationLimitReached(records: ViolationRecord[]): boolean {
  return countActiveViolations(records) >= MAX_VIOLATIONS;
}

/**
 * 计算活跃违约数（30 天内的）。
 */
export function countActiveViolations(records: ViolationRecord[], nowEpochDay?: number): number {
  const now = nowEpochDay ?? 0; // 测试时可用固定值
  let count = 0;
  for (const record of records) {
    if (now - record.date < VIOLATION_RETAIN_DAYS) {
      count++;
    }
  }
  return count;
}

/**
 * 过滤出活跃违约记录（30 天内）。
 */
export function getActiveViolations(records: ViolationRecord[], nowEpochDay?: number): ViolationRecord[] {
  const now = nowEpochDay ?? 0;
  return records.filter(r => now - r.date < VIOLATION_RETAIN_DAYS);
}

/**
 * 格式化违约文案。
 *
 * 对齐 Android 的 violationText：
 * - 1 条：「今天」
 * - 2+ 条：「N 天前」
 */
export function formatViolationText(record: ViolationRecord, nowEpochDay: number): string {
  const daysAgo = nowEpochDay - record.date;
  let timeText: string;
  if (daysAgo === 0) {
    timeText = '今天';
  } else if (daysAgo === 1) {
    timeText = '昨天';
  } else {
    timeText = `${daysAgo} 天前`;
  }
  return `预约「${record.seatNo}」未按时签到 · ${timeText}`;
}

/**
 * 获取违约计数文案（如 "2/5"）。
 */
export function getViolationCountText(records: ViolationRecord[], nowEpochDay?: number): string {
  const active = countActiveViolations(records, nowEpochDay);
  return `${active}/${MAX_VIOLATIONS}`;
}

/**
 * 判断当前是否可以预约（未达上限）。
 */
export function canReserve(records: ViolationRecord[], nowEpochDay?: number): boolean {
  return countActiveViolations(records, nowEpochDay) < MAX_VIOLATIONS;
}

/**
 * 清理过期违约记录（30 天以上）。
 *
 * @returns 清理后的记录列表
 */
export function pruneExpiredViolations(records: ViolationRecord[], nowEpochDay: number): ViolationRecord[] {
  return records.filter(r => nowEpochDay - r.date < VIOLATION_RETAIN_DAYS);
}
