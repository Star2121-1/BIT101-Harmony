/**
 * DDL 列表展示口径（纯函数，单测锁）——1:1 移植 Android：
 *  - 卡片底/字色（`DDLScheduleItem.kt:32-41`）：
 *      done ⇒ `secondaryContainer.copy(alpha = 0.5f)` + onSecondaryContainer；
 *      否则 ⇒ `mixColor(surfaceVariant, errorContainer, remainTimeRatio)`
 *      及对应字色混色（越接近截止越偏 errorContainer 红）。
 *      `mixColor` 口径 = 本仓 `core/theme/colorUtil.ts` 的 mixHex（已照搬
 *      `ColorUtils.kt`，四舍五入口径一致）。
 *  - remainTimeRatio（`DDLScheduleViewModel.kt:186-193`）：
 *      enoughTime = 1440 * beforeDay；已过 = 0；≥ enoughTime = 1；否则线性。
 *  - 分区顺序（`DdlListOrder.kt`）：未完成按截止**升序**（最急在上），
 *      已完成按截止**倒序**（最近在上）。
 *
 * ⚠️ 不存展示串/不缓存颜色（铁律 0.8）：每次渲染现算，now 由调用方传入
 * （测试可钉死）。beforeDay 鸿蒙设置暂无该项 ⇒ 取 Android 默认 7。
 */

import type { DateTime } from './timeutil.ts';
import { diffMinutes } from './DdlFormat.ts';
import type { DdlEntry } from './DdlRules.ts';
import { mixHex, withAlpha } from '../core/theme/colorUtil.ts';

/** Android `DDLScheduleViewModel.beforeDay` 默认值（鸿蒙设置暂无该项）。 */
export const DDL_BEFORE_DAY: number = 7;

/** 卡片配色用到的 token 子集（页面传 gridTokens()，测试传字面量）。 */
export interface DdlCardTokens {
  surfaceVariant: string;
  errorContainer: string;
  onSurfaceVariant: string;
  onErrorContainer: string;
  secondaryContainer: string;
  onSecondaryContainer: string;
}

/** 卡片底/字色（bg 可能是 8 位带 alpha hex）。 */
export interface DdlCardColors {
  bg: string;
  fg: string;
}

/** 截止的当天表示（remainTimeRatio 复用 diffMinutes）。 */
function deadlineOf(entry: DdlEntry): DateTime {
  return { day: entry.day, minutes: entry.minutes };
}

/**
 * 剩余时间比例 0~1（Android remainTimeRatio）：
 *  diff ≤ 0（已过/恰好）⇒ 0；diff ≥ 1440*beforeDay ⇒ 1；否则 diff / enoughTime。
 */
export function remainTimeRatio(
  deadline: DateTime,
  now: DateTime,
  beforeDay: number = DDL_BEFORE_DAY
): number {
  const enoughTime: number = 1440 * beforeDay;
  const diff: number = diffMinutes(deadline, now);
  if (diff <= 0) {
    return 0;
  }
  if (diff >= enoughTime) {
    return 1;
  }
  return diff / enoughTime;
}

/** 未完成区：截止升序，最急在上（Android DdlListOrder.pending）。不改入参。 */
export function pendingList(entries: DdlEntry[]): DdlEntry[] {
  return entries
    .filter((e: DdlEntry) => !e.done)
    .sort((a: DdlEntry, b: DdlEntry) => (a.day - b.day) || (a.minutes - b.minutes));
}

/** 已完成区：截止倒序，最近在上（Android DdlListOrder.done）。不改入参。 */
export function doneList(entries: DdlEntry[]): DdlEntry[] {
  return entries
    .filter((e: DdlEntry) => e.done)
    .sort((a: DdlEntry, b: DdlEntry) => (b.day - a.day) || (b.minutes - a.minutes));
}

/**
 * 卡片底/字色（Android DDLScheduleItem 的 Surface color/contentColor）：
 *  done ⇒ bg = secondaryContainer@0.5、fg = onSecondaryContainer；
 *  否则 ⇒ bg = mixHex(surfaceVariant, errorContainer, ratio)、
 *         fg = mixHex(onSurfaceVariant, onErrorContainer, ratio)。
 */
export function cardColors(
  entry: DdlEntry,
  now: DateTime,
  t: DdlCardTokens,
  beforeDay: number = DDL_BEFORE_DAY
): DdlCardColors {
  if (entry.done) {
    return { bg: withAlpha(t.secondaryContainer, 0.5), fg: t.onSecondaryContainer };
  }
  const ratio: number = remainTimeRatio(deadlineOf(entry), now, beforeDay);
  return {
    bg: mixHex(t.surfaceVariant, t.errorContainer, ratio),
    fg: mixHex(t.onSurfaceVariant, t.onErrorContainer, ratio)
  };
}
