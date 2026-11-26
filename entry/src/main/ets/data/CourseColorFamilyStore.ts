/**
 * 课程配色族 + 单课改色覆盖的读写（S01/S02）。只做 I/O，不做判断。
 *
 * 对齐 Android：
 * - 族偏好 = `CourseScheduleSettings.courseColorFamily`（默认 legacy，脏值回落 legacy）
 * - 单课覆盖 = `colorOverrides: Map<课名,色号>`（`ScheduleItemColor.itemColorIndex`）
 *
 * ⚠️ ArkTS 禁 `Object.assign` + 动态 key `Record`，改用 `string[]` + `split()`：
 * 每条覆盖项存成 `课名\u0001色号` 一行（与 Android OVERRIDE_KV_SEP 同分隔符），
 * 课名本身不含 \u0001（教务课名是自然语言），所以 split 安全。
 */

import { Prefs } from './Prefs.ts';
import {
  CourseColorFamily, DEFAULT_COURSE_FAMILY, normalizeCourseFamily
} from '../core/theme/CoursePalette.ts';

/** 族偏好键。 */
export const KEY_COURSE_FAMILY: string = 'course_color_family';
/** 单课覆盖键（值是多行 `课名\u0001色号`）。 */
export const KEY_COURSE_OVERRIDES: string = 'course_color_overrides';
/** 与 Android CourseScheduleSettings.OVERRIDE_KV_SEP 同源。 */
const SEP: string = '\u0001';

/** 读族（脏值回落默认 legacy）。 */
export async function loadCourseFamily(): Promise<CourseColorFamily> {
  const raw: string = await Prefs.getString(KEY_COURSE_FAMILY, DEFAULT_COURSE_FAMILY);
  return normalizeCourseFamily(raw);
}

/** 写族（归一化后落盘）。 */
export async function saveCourseFamily(f: CourseColorFamily): Promise<void> {
  await Prefs.putString(KEY_COURSE_FAMILY, normalizeCourseFamily(f));
}

/** 一条覆盖项（纯数据）。 */
export interface CourseColorOverride {
  title: string;
  index: number;
}

/** 读全部单课覆盖；解析失败的行跳过，不把脏数据带进取色。 */
export async function loadOverrides(): Promise<CourseColorOverride[]> {
  const raw: string = await Prefs.getString(KEY_COURSE_OVERRIDES, '');
  if (raw.length === 0) {
    return [];
  }
  const out: CourseColorOverride[] = [];
  const lines: string[] = raw.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const parts: string[] = lines[i].split(SEP);
    if (parts.length !== 2 || parts[0].length === 0) {
      continue;
    }
    const idx: number = Number(parts[1]);
    if (!Number.isInteger(idx) || idx < 0) {
      continue;
    }
    out.push({ title: parts[0], index: idx });
  }
  return out;
}

/** 写全部单课覆盖（有序序列化，课名去重后一次落盘）。 */
export async function saveOverrides(list: CourseColorOverride[]): Promise<void> {
  const lines: string[] = [];
  for (let i = 0; i < list.length; i++) {
    if (list[i].title.length > 0 && Number.isInteger(list[i].index) && list[i].index >= 0) {
      lines.push(list[i].title + SEP + list[i].index);
    }
  }
  await Prefs.putString(KEY_COURSE_OVERRIDES, lines.join('\n'));
}

/** 查某门课的覆盖色号；无覆盖返回 -1（调用方据此回落哈希）。 */
export function indexOfOverride(list: CourseColorOverride[], title: string): number {
  for (let i = 0; i < list.length; i++) {
    if (list[i].title === title) {
      return list[i].index;
    }
  }
  return -1;
}
