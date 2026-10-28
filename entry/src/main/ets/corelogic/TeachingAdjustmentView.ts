/**
 * 教学调整（放假 / 补课）的**展示层纯逻辑**（零依赖）。
 *
 * 语义层已有 `TeachingAdjustment.dayPlanOf`（判断某天是放假还是补哪天的课），
 * 这里只做「把条目变成人话 + 排序 + 取近若干条」，供：
 *  - 课表顶部提示条（今日/本周调整）；
 *  - 教学调整列表页（未来、过去两段）；
 *  - 无障碍朗读。
 *
 * 取舍：
 *  - **不放宽口径**：只认 `NoClass` 与 `MakeUp` 两种；未知形态不下结论（`title = ''`）。
 *  - 补课必须点明「补周几的课」——只说「补课」等于没说，用户不知道带哪本书。
 *  - 排序：未来按日期升序（最近的先看）；过去按日期降序（最近的先看）。
 */

import { weekdayCn, dateLabelCn } from './TeachingAdjustment.ts';
import type { AdjustmentEntry } from './TeachingAdjustment.ts';

/** 一条可展示的调整。 */
export interface AdjustmentItem {
  day: number;        // epoch day
  dateLabel: string;  // 10/10（周六）
  title: string;      // 放假（不上课） / 补周二的课
  isMakeUp: boolean;
}

/** 单条 → 人话标题；不认识的形态返回空串（调用方据此跳过，不猜）。 */
export function titleOf(entry: AdjustmentEntry): string {
  if (entry.plan.kind === 'NoClass') {
    return '放假（不上课）';
  }
  if (entry.plan.kind === 'MakeUp') {
    const w: number = entry.plan.targetWeekday;
    if (w < 1 || w > 7) {
      return ''; // 脏数据（周几越界）不编文案
    }
    return '补周' + weekdayCn(w) + '的课';
  }
  return '';
}

/** 排序用比较（同日不可能重复，但重复时保持稳定：先出现的在前）。 */
function byDayAsc(a: AdjustmentEntry, b: AdjustmentEntry): number {
  return a.day - b.day;
}

/**
 * 未来（含今天）的调整，按日期升序，最多 `limit` 条（<=0 视为不限）。
 * 标题为空的条目直接丢弃（看不懂的不上报）。
 */
export function upcoming(entries: AdjustmentEntry[], todayEpochDay: number, limit: number): AdjustmentItem[] {
  const pool: AdjustmentEntry[] = [];
  for (let i = 0; i < entries.length; i++) {
    if (entries[i].day >= todayEpochDay) {
      pool.push(entries[i]);
    }
  }
  pool.sort(byDayAsc);
  const out: AdjustmentItem[] = [];
  for (let i = 0; i < pool.length; i++) {
    if (limit > 0 && out.length >= limit) {
      break;
    }
    const title: string = titleOf(pool[i]);
    if (title.length === 0) {
      continue;
    }
    out.push({
      day: pool[i].day,
      dateLabel: dateLabelCn(pool[i].day),
      title: title,
      isMakeUp: pool[i].plan.kind === 'MakeUp',
    });
  }
  return out;
}

/** 过去（不含今天）的调整，按日期降序（最近的在最前）。 */
export function past(entries: AdjustmentEntry[], todayEpochDay: number, limit: number): AdjustmentItem[] {
  const pool: AdjustmentEntry[] = [];
  for (let i = 0; i < entries.length; i++) {
    if (entries[i].day < todayEpochDay) {
      pool.push(entries[i]);
    }
  }
  pool.sort(byDayAsc);
  pool.reverse();
  const out: AdjustmentItem[] = [];
  for (let i = 0; i < pool.length; i++) {
    if (limit > 0 && out.length >= limit) {
      break;
    }
    const title: string = titleOf(pool[i]);
    if (title.length === 0) {
      continue;
    }
    out.push({
      day: pool[i].day,
      dateLabel: dateLabelCn(pool[i].day),
      title: title,
      isMakeUp: pool[i].plan.kind === 'MakeUp',
    });
  }
  return out;
}

/**
 * 课表顶部提示条文案：今天有调整才返回非空。
 * 只讲**今天**（本周其它天会在点进列表后看到），避免顶栏变成滚动公告。
 */
export function todayBadge(entries: AdjustmentEntry[], todayEpochDay: number): string {
  for (let i = 0; i < entries.length; i++) {
    if (entries[i].day !== todayEpochDay) {
      continue;
    }
    const title: string = titleOf(entries[i]);
    return title.length > 0 ? '今天' + title : '';
  }
  return '';
}

/** 未来 N 天内是否有调整（课表页角标「有调整」用）。 */
export function hasUpcomingWithin(entries: AdjustmentEntry[], todayEpochDay: number, days: number): boolean {
  for (let i = 0; i < entries.length; i++) {
    const d: number = entries[i].day;
    if (d >= todayEpochDay && d <= todayEpochDay + days && titleOf(entries[i]).length > 0) {
      return true;
    }
  }
  return false;
}
