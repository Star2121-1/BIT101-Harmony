/**
 * 作息表的纯规则（不碰存储、不碰 UI，可直接被 Node 单测）。
 *
 * 抽出来的原因：`TimeTableStore` 依赖 `Prefs`（鸿蒙 API），在 Node 里跑不了，
 * 而「校验规则对不对」恰恰是最该被单测盯住的部分 —— 一张半对的作息表会算出
 * 错误的「现在上什么课」，比没有作息表更糟。
 */

import { FALLBACK_TIME_TABLE } from './TimeTableLogic.ts';
import type { TimeTable, TimeTableItem } from './timeutil.ts';

/** 节数上限（与学校官方表一致）。 */
export const SECTION_COUNT: number = 13;

/** 一天的分钟数。 */
const MINUTES_PER_DAY: number = 1440;

/**
 * 校验一张作息表是否自洽。返回空串 = 合法，否则返回**人能看懂的原因**。
 *
 * 规则（缺一不可）：
 * - 13 节
 * - 每节 0 ≤ start < end ≤ 1440
 * - 后一节不得早于前一节结束（不允许重叠）
 */
export function validateTimeTable(table: TimeTable): string {
  if (table.length !== SECTION_COUNT) {
    return '节数应为 ' + SECTION_COUNT + '，实际 ' + table.length;
  }
  let prevEnd: number = -1;
  for (let i = 0; i < table.length; i++) {
    const it: TimeTableItem = table[i];
    if (!(it.startMinutes >= 0 && it.startMinutes < MINUTES_PER_DAY)) {
      return '第 ' + (i + 1) + ' 节开始时刻越界';
    }
    if (!(it.endMinutes > it.startMinutes && it.endMinutes <= MINUTES_PER_DAY)) {
      return '第 ' + (i + 1) + ' 节结束时刻不合法（必须晚于开始）';
    }
    if (it.startMinutes < prevEnd) {
      return '第 ' + (i + 1) + ' 节与上一节重叠';
    }
    prevEnd = it.endMinutes;
  }
  return '';
}

/** 深拷贝学校官方表（编辑页要改它，绝不能改到共享常量）。 */
export function makeDefaultTable(): TimeTable {
  const out: TimeTableItem[] = [];
  for (let i = 0; i < FALLBACK_TIME_TABLE.length; i++) {
    out.push({
      startMinutes: FALLBACK_TIME_TABLE[i].startMinutes,
      endMinutes: FALLBACK_TIME_TABLE[i].endMinutes
    });
  }
  return out;
}

/** 当天分钟数 → `HH:MM`。越界返回空串（不猜）。 */
export function minutesToHM(minutes: number): string {
  if (!(minutes >= 0 && minutes < MINUTES_PER_DAY)) {
    return '';
  }
  const h: number = Math.floor(minutes / 60);
  const m: number = minutes % 60;
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

/** `HH:MM` → 当天分钟数。格式不对返回 -1（不猜）。 */
export function hmToMinutes(text: string): number {
  const t: string = text.trim();
  if (t.length !== 5 || t.charAt(2) !== ':') {
    return -1;
  }
  const h: number = parseInt(t.substring(0, 2), 10);
  const m: number = parseInt(t.substring(3, 5), 10);
  if (isNaN(h) || isNaN(m) || h < 0 || h > 23 || m < 0 || m > 59) {
    return -1;
  }
  return h * 60 + m;
}
