/**
 * 1:1 移植自 Android：data/src/main/java/cn/bit101/android/data/school/CourseWeekdayLogic.kt（42 行）
 *
 * 移植日期：2026-10-19（夜间任务 2）
 *
 * 规则：「那一天实际上按哪个星期几上课」—— 全 App 只有这一份。
 * 放假 → null（那天的课不作数）；补课 → 被指定那天；没覆盖 → 当天星期几。
 * weekOf 判不出来返回 -1，调用方据此**跳过周次过滤**（宁可多算也不能漏）。
 */

import { dayOfWeekMon1 } from "./timeutil.ts";
import { dayPlanOf, type DayPlan } from "./TeachingAdjustment.ts";

/**
 * @param dateEpochDay 那一天（epoch day）
 * @param planOf 取那天的教学安排
 * @return 有效星期几（1~7，1=周一）；null = 那天不上课（放假）
 */
export function effectiveWeekday(
  dateEpochDay: number,
  planOf: (epochDay: number) => DayPlan | null,
): number | null {
  const plan = planOf(dateEpochDay);
  if (plan !== null) {
    if (plan.kind === "MakeUp") return plan.targetWeekday;
    return null; // NoClass
  }
  return dayOfWeekMon1(dateEpochDay);
}

/** 教学周（1-based）。判不出来返回 -1。 */
export function weekOf(firstDayEpochDay: number | null, dateEpochDay: number): number {
  if (firstDayEpochDay === null) return -1;
  const days = dateEpochDay - firstDayEpochDay;
  if (days < 0) return -1;
  return Math.floor(days / 7) + 1;
}

/** 周次串（[1][2][3]）是否包含第 week 周。必须按完整标记匹配。 */
export function weeksContains(weeks: string, week: number): boolean {
  return weeks.includes(`[${week}]`);
}

/** 便捷转发：TeachingAdjustment.planOf（避免调用方反向依赖）。 */
export function planOfDate(
  entries: { day: number; plan: DayPlan }[],
  dateEpochDay: number,
): DayPlan | null {
  return dayPlanOf(entries, dateEpochDay);
}
