/**
 * 1:1 移植自 Android：config/src/main/java/cn/bit101/android/config/setting/base/TimeTableLogic.kt
 * （56 行，含 FALLBACK_TIME_TABLE 13 节官方作息）
 *
 * 移植日期：2026-10-19（夜间任务 2）
 *
 * 必须一起搬的常量/规则：
 * - FALLBACK_TIME_TABLE = 学校官方作息（党政办公室印发，2021-08-23 起实行）13 节：
 *   1 08:00-08:45 / 2 08:50-09:35 / 3 09:55-10:40 / 4 10:45-11:30 / 5 11:35-12:20 /
 *   6 13:20-14:05 / 7 14:10-14:55 / 8 15:15-16:00 / 9 16:05-16:50 / 10 16:55-17:40 /
 *   11 18:30-19:15 / 12 19:20-20:05 / 13 20:10-20:55
 * - ⚠️⚠️ sectionStart/sectionEnd 是 **1-based**（节次从 1 开始）；
 *   而课表数据（KSJC/JSJC）是 **0-based**？—— 不：课表接口给的就是节次数，
 *   这里的 section 参数一律按"第几节（1 起）"传入。调用方做换算时必须注明基准
 *   （Android 侧 StudySpotLogic.sectionFor 返回 1-based，课表 grids 用 0-based，栽过）。
 * - 节次越界 → 返回 null / 空串，**绝不编时间**（Kotlin 原注释）。
 *
 * 时间表示：时刻 = 当天分钟数（见 timeutil.ts）。
 */

import { fmtHM, type TimeTable, type TimeTableItem } from "./timeutil.ts";

export type { TimeTable, TimeTableItem } from "./timeutil.ts";

/** 学校官方作息（良乡校区，2021-08-23 起实行）。正常用设置里的用户时间表，这是保底。 */
export const FALLBACK_TIME_TABLE: TimeTable = [
  { startMinutes: 8 * 60 + 0, endMinutes: 8 * 60 + 45 },
  { startMinutes: 8 * 60 + 50, endMinutes: 9 * 60 + 35 },
  { startMinutes: 9 * 60 + 55, endMinutes: 10 * 60 + 40 },
  { startMinutes: 10 * 60 + 45, endMinutes: 11 * 60 + 30 },
  { startMinutes: 11 * 60 + 35, endMinutes: 12 * 60 + 20 },
  { startMinutes: 13 * 60 + 20, endMinutes: 14 * 60 + 5 },
  { startMinutes: 14 * 60 + 10, endMinutes: 14 * 60 + 55 },
  { startMinutes: 15 * 60 + 15, endMinutes: 16 * 60 + 0 },
  { startMinutes: 16 * 60 + 5, endMinutes: 16 * 60 + 50 },
  { startMinutes: 16 * 60 + 55, endMinutes: 17 * 60 + 40 },
  { startMinutes: 18 * 60 + 30, endMinutes: 19 * 60 + 15 },
  { startMinutes: 19 * 60 + 20, endMinutes: 20 * 60 + 5 },
  { startMinutes: 20 * 60 + 10, endMinutes: 20 * 60 + 55 },
];

/** 某一小节的开始时刻（**节次 1-based**）；越界返回 null。 */
export function sectionStart(table: TimeTable, section: number): number | null {
  const item = table[section - 1];
  return item ? item.startMinutes : null;
}

/** 某一小节的结束时刻（**节次 1-based**）；越界返回 null。 */
export function sectionEnd(table: TimeTable, section: number): number | null {
  const item = table[section - 1];
  return item ? item.endMinutes : null;
}

/**
 * 连续节次的时间段文本，如 "09:55-12:20"。
 * 节次越界返回空串（宁可少显示，也不要显示错时间）。
 */
export function courseTimeText(table: TimeTable, startSection: number, endSection: number): string {
  const start = sectionStart(table, startSection);
  const end = sectionEnd(table, endSection);
  if (start === null || end === null) return "";
  return `${fmtHM(start)}-${fmtHM(end)}`;
}
