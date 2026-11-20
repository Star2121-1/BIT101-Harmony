/**
 * 课表显示开关 —— Prefs 适配层（纯逻辑在 corelogic/ScheduleDisplayLogic.ts）。
 * 键名/默认值逻辑不在这里，避免离线单测被 @kit.ArkData 卡住。
 */

import { Prefs } from './Prefs.ts';
import {
  ScheduleDisplayFlags, BoolReader, readScheduleDisplay
} from '../corelogic/ScheduleDisplayLogic.ts';

export {
  KEY_SHOW_SATURDAY, KEY_SHOW_SUNDAY, KEY_SHOW_BORDER, KEY_SHOW_HIGHLIGHT_TODAY,
  KEY_SHOW_DIVIDER, KEY_SHOW_CURRENT_TIME, KEY_SHOW_EXAM_INFO,
  ScheduleDisplayFlags, defaultScheduleDisplay, readScheduleDisplay
} from '../corelogic/ScheduleDisplayLogic.ts';

/** Prefs 适配的读。 */
export async function loadScheduleDisplay(): Promise<ScheduleDisplayFlags> {
  const reader: BoolReader = {
    getBool: (key: string, fallback: boolean): Promise<boolean> => Prefs.getBool(key, fallback)
  };
  return await readScheduleDisplay(reader);
}

/** 写单个开关（设置页切换用）。 */
export async function saveScheduleDisplayFlag(key: string, value: boolean): Promise<void> {
  await Prefs.putBool(key, value);
}
