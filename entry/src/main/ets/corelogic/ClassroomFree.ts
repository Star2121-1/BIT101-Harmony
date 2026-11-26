/**
 * 空教室「现在是否空闲」纯函数（#85 UI 迁移 / G07-02 阈值补齐）
 * =========================================================
 * 对齐 Android `FreeClassroomSearchViewModel.isFreeNow` 的语义：
 *
 *   isFreeNow = nextBusyTime == LocalTime.MAX            （今天再也没有占用）
 *            || nextBusyTime >= now + threshold           （下一段占用还没到）
 *
 * 鸿蒙侧教室数据是**节次粒度**的（`ClassroomRow.busySections`，1-based 升序），
 * 没有原版的精确到分的 nextBusyTime。等价移植：
 *   - 「现在落在某一节的时间里」且那一节被占 ⇒ 占用中；
 *   - 否则取「下一个被占用节的开始时刻」：距今不足 freeMinutes 分钟 ⇒ 占用中
 *     （马上要上课了，这段空档太短不算空闲），否则空闲。
 *
 * ## 空闲时段阈值（对齐 Android freeMinutesThreshold，默认 5 分钟）
 * 原版默认值见 `A:features/setting/viewmodel/FreeClassroomViewModel.kt:23` = 5L，
 * 不是历史注释里误写的 0。两个默认值是本模块**唯一来源**，
 * `data/ClassroomSettings.ts` 与设置页都从这里取，不许在别处写死。
 *
 * ⚠️ 「节开头一瞬」的诚实侧差异保留：now 正好落在被占用节的 [start,end)
 * 起点时判占用（原版 `>=` 边界会判空闲，本端口取更严格的一侧）。
 *
 * ⚠️ 调用方传入的 nowMinutes 必须与 busySections 同一天（页面查的是
 * 「今天」的教室）；跨天调用没有意义。
 */

import type { TimeTable } from './TimeTableLogic.ts';

/** 空闲时段阈值默认值（分钟）——对齐 Android FreeClassroomViewModel.default。 */
export const DEFAULT_FREE_MINUTES: number = 5;
/** 「隐藏当前不空闲的教室」默认值——对齐 Android（G07-01）。 */
export const DEFAULT_HIDE_BUSY: boolean = true;

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
 * 下一个「被占用」节的开始时刻（当天分钟数）；今天之后再无占用返回 -1
 * （对应原版 LocalTime.MAX）。只看严格晚于 nowMinutes 的节：
 * 当前正落在被占用节内的情形由 isFreeNow 先行判忙，不在这里重复。
 */
export function nextBusyStartMinutes(busySections: number[], table: TimeTable,
  nowMinutes: number): number {
  let best: number = -1;
  for (let i = 0; i < busySections.length; i++) {
    const section: number = busySections[i];
    if (section < 1 || section > table.length) {
      continue;
    }
    const start: number = table[section - 1].startMinutes;
    if (start > nowMinutes && (best < 0 || start < best)) {
      best = start;
    }
  }
  return best;
}

/**
 * 这间教室**现在**是否空闲。
 *
 * @param busySections 今天被占用的节次（1-based，升序；由 ClassroomService 给）
 * @param table 当天作息表（用户自定义或 FALLBACK_TIME_TABLE）
 * @param nowMinutes 当前时刻（当天分钟数）
 * @param freeMinutes 空闲时段阈值（分钟，默认 5）；不足该时长的空档不算空闲
 */
export function isFreeNow(busySections: number[], table: TimeTable, nowMinutes: number,
  freeMinutes: number = DEFAULT_FREE_MINUTES): boolean {
  const now: number | null = currentSection(table, nowMinutes);
  // 当前落在被占用节内 ⇒ 忙（[start,end) 口径，含节开头一瞬的诚实侧）
  if (now !== null) {
    for (let i = 0; i < busySections.length; i++) {
      if (busySections[i] === now) {
        return false;
      }
    }
  }
  // 否则看下一个被占节：距今不足阈值 ⇒ 忙；今天再无占用 / 还早 ⇒ 空闲
  const next: number = nextBusyStartMinutes(busySections, table, nowMinutes);
  if (next < 0) {
    return true;
  }
  return next - nowMinutes >= freeMinutes;
}
