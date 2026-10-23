/**
 * 空教室「现在是否空闲」纯函数（#85 UI 迁移）
 * =========================================================
 * 对齐 Android `FreeClassroomSearchViewModel.isFreeNow` 的语义：
 *
 *   isFreeNow = nextBusyTime == LocalTime.MAX            （今天再也没有占用）
 *            || nextBusyTime >= now + threshold           （下一段占用还没到）
 *
 * 鸿蒙侧教室数据是**节次粒度**的（`ClassroomRow.busySections`，1-based 升序），
 * 没有原版的精确到分的 nextBusyTime。等价移植：
 *   - 「现在落在某一节的时间里」且那一节被占 ⇒ 占用中；
 *   - 课间 / 课外（不在任何一节的时间里）⇒ 空闲（下一段占用必然还没到）。
 *
 * ⚠️ 原版的 freeMinutesThreshold（设置项，默认 0）鸿蒙没有对应设置，
 * 这里按 0 处理；真要搬那个设置时必须连 UI 一起搬，不许只改阈值。
 *
 * ⚠️ 调用方传入的 nowMinutes 必须与 busySections 同一天（页面查的就是
 * 「今天」的教室）；跨天调用没有意义。
 */

import type { TimeTable } from './TimeTableLogic.ts';

/**
 * 当前所在节次（**1-based**）；不在任何一节课的时间内（课间 / 课外）返回 null。
 *
 * 区间口径 `[start, end)`：下课瞬间（endMinutes）算课间，不算这一节。
 */
export function currentSection(table: TimeTable, nowMinutes: number): number | null {
  for (let i = 0; i < table.length; i++) {
    const item = table[i];
    if (nowMinutes >= item.startMinutes && nowMinutes < item.endMinutes) {
      return i + 1;
    }
  }
  return null;
}

/**
 * 这间教室**现在**是否空闲。
 *
 * @param busySections 今天被占用的节次（1-based，升序；由 ClassroomService 给）
 * @param table 当天作息表（用户自定义或 FALLBACK_TIME_TABLE）
 * @param nowMinutes 当前时刻（当天分钟数）
 */
export function isFreeNow(busySections: number[], table: TimeTable, nowMinutes: number): boolean {
  const now: number | null = currentSection(table, nowMinutes);
  // 课间 / 课外：没有任何一节课正在进行 ⇒ 空闲
  if (now === null) {
    return true;
  }
  for (let i = 0; i < busySections.length; i++) {
    if (busySections[i] === now) {
      return false;
    }
  }
  return true;
}
