/**
 * 空教室查询设置（G07-01 / G07-02）——只做读写，不写业务判断。
 *
 * 对齐 Android `FreeClassroomSettings`：
 * - hideBusyClassroom：隐藏当前不空闲的教室（默认 true）
 * - freeMinutesThreshold：空闲时段阈值（默认 5 分钟）
 *
 * 默认值一律从 corelogic/ClassroomFree.ts 取（唯一来源），本文件不写死数字。
 * 读写键与「默认校区」分开放：校区Preference仍在 SettingsPage 的
 * KEY_DEFAULT_CAMPUS，这里只管这两项新增设置，互不覆盖。
 */

import { Prefs } from './Prefs.ts';
import { DEFAULT_FREE_MINUTES, DEFAULT_HIDE_BUSY } from '../corelogic/ClassroomFree.ts';

/** 隐藏当前不空闲教室的持久化键。 */
export const KEY_HIDE_BUSY_CLASSROOM: string = 'classroom_hide_busy';
/** 空闲时段阈值的持久化键。 */
export const KEY_FREE_MINUTES: string = 'classroom_free_minutes';

/** 读「隐藏当前不空闲」。读失败回落到默认 true（宁可多显示，不隐藏事实）。 */
export async function loadHideBusyClassroom(): Promise<boolean> {
  return await Prefs.getBool(KEY_HIDE_BUSY_CLASSROOM, DEFAULT_HIDE_BUSY);
}

/** 写「隐藏当前不空闲」。 */
export async function saveHideBusyClassroom(value: boolean): Promise<void> {
  await Prefs.putBool(KEY_HIDE_BUSY_CLASSROOM, value);
}

/**
 * 读空闲时段阈值。脏值（NaN / 负数 / 非整数）一律回落默认 5，
 * 不把坏数据带进 isFreeNow 的临界判定。
 */
export async function loadFreeMinutes(): Promise<number> {
  const v: number = await Prefs.getNumber(KEY_FREE_MINUTES, DEFAULT_FREE_MINUTES);
  return normalizeFreeMinutes(v);
}

/** 写空闲时段阈值（先归一化，保证落盘的是合法值）。 */
export async function saveFreeMinutes(value: number): Promise<void> {
  await Prefs.putNumber(KEY_FREE_MINUTES, normalizeFreeMinutes(value));
}

/** 阈值归一化纯函数：合法整数 0..120 原样，其余回落默认 5。 */
export function normalizeFreeMinutes(value: number): number {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0 || value > 120) {
    return DEFAULT_FREE_MINUTES;
  }
  return value;
}
