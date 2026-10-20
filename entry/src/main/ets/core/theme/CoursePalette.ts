/**
 * 课程 12 色板。1:1 照搬 Android `features/theme/CoursePalette.kt`（规范 §8.2 权威表）。
 *
 * 分工与 Android 一致：
 * - 色号由 `corelogic/CourseColorLogic.of(课名)` 算（全仓唯一哈希实现）；
 * - 本文件只回答「色号 i 显示成什么」，**不含哈希**。
 *
 * 竖条一律用 ink，**不得用 mark**（§8.2；亮态 mark 对比不足）。
 */

export interface CourseColors {
  fill: string;
  ink: string;
  mark: string;
}

/** 亮色 12 支（fill / ink / mark，§8.2 表列序）。 */
export const COURSE_LIGHT: CourseColors[] = [
  { fill: '#94A4E6', ink: '#112369', mark: '#2143CA' }, // 0 靛蓝
  { fill: '#F4DBC2', ink: '#734211', mark: '#E18A33' }, // 1 赭橘
  { fill: '#B6ECCF', ink: '#17633B', mark: '#66D69A' }, // 2 松绿
  { fill: '#F1C5CF', ink: '#71142A', mark: '#DE6884' }, // 3 玫红
  { fill: '#CBE6F6', ink: '#0F5076', mark: '#7EC0E7' }, // 4 天蓝
  { fill: '#EBD898', ink: '#6A5510', mark: '#E8CF7D' }, // 5 芥黄
  { fill: '#DBBFED', ink: '#481769', mark: '#A151D6' }, // 6 紫罗兰
  { fill: '#DDF2CA', ink: '#3D6A16', mark: '#80CE3B' }, // 7 草绿
  { fill: '#EB9E98', ink: '#6F1711', mark: '#A92319' }, // 8 朱红
  { fill: '#90DDE0', ink: '#135B5D', mark: '#25A3A7' }, // 9 青碧
  { fill: '#E090C5', ink: '#63174A', mark: '#A7257C' }, // 10 品紫
  { fill: '#92DDA1', ink: '#145722', mark: '#207932' }  // 11 竹青
];

/** 暗色 12 支（mark 位按 §8.2 放 ink-d）。 */
export const COURSE_DARK: CourseColors[] = [
  { fill: '#2F3D74', ink: '#C9D1ED', mark: '#C9D1ED' }, // 0 靛蓝
  { fill: '#6D4C2C', ink: '#EFDBC8', mark: '#EFDBC8' }, // 1 赭橘
  { fill: '#31684B', ink: '#CAECDA', mark: '#CAECDA' }, // 2 松绿
  { fill: '#491D27', ink: '#EEC9D1', mark: '#EEC9D1' }, // 3 玫红
  { fill: '#275068', ink: '#C9E0EE', mark: '#C9E0EE' }, // 4 天蓝
  { fill: '#504521', ink: '#EFE6C8', mark: '#EFE6C8' }, // 5 芥黄
  { fill: '#422357', ink: '#E1CEEE', mark: '#E1CEEE' }, // 6 紫罗兰
  { fill: '#46632C', ink: '#DAECCA', mark: '#DAECCA' }, // 7 草绿
  { fill: '#682B27', ink: '#EECBC9', mark: '#EECBC9' }, // 8 朱红
  { fill: '#265354', ink: '#CAEBEC', mark: '#CAEBEC' }, // 9 青碧
  { fill: '#6D2C57', ink: '#EDC9E1', mark: '#EDC9E1' }, // 10 品紫
  { fill: '#234D2B', ink: '#C7EACE', mark: '#C7EACE' }  // 11 竹青
];

const PALETTE_SIZE: number = 12;

/** 按色号取一套课程色（越界按 mod 12 收拢，传 -1 也不崩）。 */
export function courseColors(index: number, isDark: boolean): CourseColors {
  const list: CourseColors[] = isDark ? COURSE_DARK : COURSE_LIGHT;
  const i: number = ((index % PALETTE_SIZE) + PALETTE_SIZE) % PALETTE_SIZE;
  return list[i];
}
