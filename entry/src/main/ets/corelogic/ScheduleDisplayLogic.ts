/**
 * 课表显示开关纯逻辑（对齐 Android SettingDataStore 的 COURSE_SCHEDULE_SHOW_*）。
 * 默认值严格对齐 SettingDataStore.kt:85/89/93/97/101/105/109。
 * ⚠️ 不 import @kit（Prefs 适配在 ScheduleDisplayStore.ts）——可离线单测。
 */

export const KEY_SHOW_SATURDAY: string = 'course_schedule_show_saturday';
export const KEY_SHOW_SUNDAY: string = 'course_schedule_show_sunday';
export const KEY_SHOW_BORDER: string = 'course_schedule_show_border';
export const KEY_SHOW_HIGHLIGHT_TODAY: string = 'course_schedule_show_highlight_today';
export const KEY_SHOW_DIVIDER: string = 'course_schedule_show_divider';
export const KEY_SHOW_CURRENT_TIME: string = 'course_schedule_show_current_time';
export const KEY_SHOW_EXAM_INFO: string = 'course_schedule_show_exam_info';

export interface ScheduleDisplayFlags {
  showSaturday: boolean;
  showSunday: boolean;
  showBorder: boolean;
  showHighlightToday: boolean;
  showDivider: boolean;
  showCurrentTime: boolean;
  showExamInfo: boolean;
}

export function defaultScheduleDisplay(): ScheduleDisplayFlags {
  return {
    showSaturday: true,
    showSunday: true,
    showBorder: false,
    showHighlightToday: true,
    showDivider: true,
    showCurrentTime: true,
    showExamInfo: true
  };
}

/** 与 Prefs 同签名的读接口（便于离线注入 fake，不碰 @kit）。 */
export interface BoolReader {
  getBool(key: string, fallback: boolean): Promise<boolean>;
}

/** 纯逻辑：从任意 BoolReader 读全部开关，缺省走 default。 */
export async function readScheduleDisplay(reader: BoolReader): Promise<ScheduleDisplayFlags> {
  const d: ScheduleDisplayFlags = defaultScheduleDisplay();
  return {
    showSaturday: await reader.getBool(KEY_SHOW_SATURDAY, d.showSaturday),
    showSunday: await reader.getBool(KEY_SHOW_SUNDAY, d.showSunday),
    showBorder: await reader.getBool(KEY_SHOW_BORDER, d.showBorder),
    showHighlightToday: await reader.getBool(KEY_SHOW_HIGHLIGHT_TODAY, d.showHighlightToday),
    showDivider: await reader.getBool(KEY_SHOW_DIVIDER, d.showDivider),
    showCurrentTime: await reader.getBool(KEY_SHOW_CURRENT_TIME, d.showCurrentTime),
    showExamInfo: await reader.getBool(KEY_SHOW_EXAM_INFO, d.showExamInfo)
  };
}
