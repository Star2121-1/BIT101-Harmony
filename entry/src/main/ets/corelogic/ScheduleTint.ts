/**
 * 课表调休 tint：1:1 照搬 Android
 * `features/schedule/.../course/ScheduleItemColor.kt` + `CourseScheduleCalendar.kt` 的调休变体。
 *
 * ## 为什么要有它（源码注释的忠实转述）
 * 学校调休时某天的意义和平时不一样，光靠列头角标（放假 / 按周X）容易看漏：
 * - **放假**那天：课表上原本有课，但**不上**。直接把课藏掉会让人以为「本来就没课」，
 *   所以**照常显示，只是换成灰调** —— 一眼就是「不作数」。
 * - **补课**那天：装的是**别的星期几**的课（10/10 周六按周四上课）。座位、老师、进度
 *   都跟标注的那天对不上，用主题第三色标出来，与提示条呼应。
 *
 * ⚠️ 色调只影响**观感**，不改变数据。
 * ⚠️ 靠拢程度刻意给得不低（源码注释原话：「淡一点就看不出来了，那这个功能就白做」）。
 *
 * blend 口径（Kotlin `ScheduleItemColor.tinted` 内私有 blend）：
 *   out = from*(1-ratio) + to*ratio，**保留 from 的 alpha**。
 * 即「朝 to 靠拢 ratio」。用本仓 mixHex(c1,c2,r)=c1*r+c2*(1-r) 表达：
 *   out = mixHex(to, from, ratio)（to 占 ratio）。
 * 本端口径：fill → container；ink/mark → onContainer。
 */

import type { CourseColors } from '../core/theme/CoursePalette.ts';
import { mixHex } from '../core/theme/colorUtil.ts';
import { gridTokens, getPaletteName } from '../core/theme/GridTokens.ts';

/** 调休色调档（源码 CourseScheduleCalendar.kt:419-420 私有常量）。 */
export const HOLIDAY_TINT: number = 0.85;
export const MAKEUP_TINT: number = 0.6;

/** 一列的调休状态：平常 / 放假 / 补课。 */
export type ScheduleTint = 'normal' | 'holiday' | 'makeup';

/**
 * 课块配色 = **所有课程同一个容器色** + 调休变体。
 *
 * ⚠️ 2026-10-31 对齐原版改口：原版 `CourseScheduleCalendar.kt` 的
 * `scheduleItemColors` 只有 3 档（normal/holiday/makeup），normal 恒为
 * `secondaryContainer`/`onSecondaryContainer` —— **没有按课程换色**。
 * 我方早先按课名哈希取 12 色（本文件旧版），真机对照官方课表一眼就看出不是一套。
 * 12 色板（CoursePalette）保留给别处用，课表不再引用。
 */
export function tintedScheduleColors(isDark: boolean, tint: ScheduleTint, paletteName: string = 'warm'): CourseColors {
  const t = gridTokens(isDark, getPaletteName(paletteName));
  const base: CourseColors = {
    fill: t.secondaryContainer,
    ink: t.onSecondaryContainer,
    mark: t.secondary,
  };
  if (tint === 'normal') {
    return base;
  }
  let ratio: number;
  let container: string;
  let onContainer: string;
  if (tint === 'holiday') {
    ratio = HOLIDAY_TINT;
    container = t.surfaceVariant;
    onContainer = t.onSurfaceVariant;
  } else {
    ratio = MAKEUP_TINT;
    container = t.tertiaryContainer;
    onContainer = t.onTertiaryContainer;
  }
  return {
    fill: mixHex(container, base.fill, ratio),
    ink: mixHex(onContainer, base.ink, ratio),
    mark: mixHex(onContainer, base.mark, ratio),
  };
}
