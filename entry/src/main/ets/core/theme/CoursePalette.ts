/**
 * 课程 12 色板 + 五族（S01，1:1 照搬 Android `features/theme/CoursePalette.kt` +
 * `config/setting/base/CourseScheduleSettings.kt` 的 CourseColorFamily）。
 *
 * 分工与 Android 一致：
 * - 色号由 `corelogic/CourseColorLogic.of(课名)` 算（全仓唯一哈希实现）；
 * - 本文件只回答「族 family + 色号 i + 明暗 → 显示成什么」，**不含哈希**。
 *
 * 竖条一律用 ink，**不得用 mark**（§8.2；亮态 mark 对比不足）。
 *
 * ## 五族（value 字符串是发布后冻结契约，与 Android 同源）
 * - legacy：原版统色，12 支同值（默认族，保住「默认观感统一」）
 * - classic：经典 12 色（原 COURSE_LIGHT/DARK）
 * - morandi：莫兰迪低饱和 12 色
 * - brand：北理蓝 12 色（围绕校色 #1B4F9C）
 * - auto：跟随外观（Classic⇒Legacy 统色 / Warm、Brand⇒Classic 12 色）
 */

export interface CourseColors {
  fill: string;
  ink: string;
  mark: string;
}

/** 课程配色族（value 冻结契约，对齐 A:CourseColorFamily.name.lowercase()）。 */
export type CourseColorFamily = 'auto' | 'legacy' | 'classic' | 'morandi' | 'brand';

/** 默认族 = Legacy（原版统色，用户拍板；对齐 A:CourseScheduleSettings.kt:108）。 */
export const DEFAULT_COURSE_FAMILY: CourseColorFamily = 'legacy';

/** 全部族（UI 展示序：Auto 在前；对齐 A:CourseColorFamily.allFamilies）。 */
export const ALL_COURSE_FAMILIES: CourseColorFamily[] =
  ['auto', 'legacy', 'classic', 'morandi', 'brand'];

/** 展示名（对齐 A:CourseColorFamily.toCourseColorFamilyData）。 */
export function courseFamilyLabel(f: CourseColorFamily): string {
  if (f === 'auto') {
    return '跟随外观';
  }
  if (f === 'legacy') {
    return '原版统色';
  }
  if (f === 'classic') {
    return '经典 12 色';
  }
  if (f === 'morandi') {
    return '莫兰迪 12 色';
  }
  return '北理蓝 12 色';
}

/** 脏值回落显式默认 Legacy（对齐 A:CourseColorFamily.getFamily）。 */
export function normalizeCourseFamily(value: string): CourseColorFamily {
  for (let i = 0; i < ALL_COURSE_FAMILIES.length; i++) {
    if (ALL_COURSE_FAMILIES[i] === value) {
      return value as CourseColorFamily;
    }
  }
  return DEFAULT_COURSE_FAMILY;
}

/** 亮色 12 支 = 经典族（§8.2 权威表，A:CoursePalette.light）。 */
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

/** 暗色 12 支 = 经典族（mark 位按 §8.2 放 ink-d）。 */
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

/** 原版统色：12 支同值（A:CoursePalette.legacyLight/legacyDark）。 */
const LEGACY_LIGHT: CourseColors =
  { fill: '#E7ECF3', ink: '#3D5573', mark: '#5B7BA6' };
const LEGACY_DARK: CourseColors =
  { fill: '#2C3542', ink: '#C6D3E3', mark: '#C6D3E3' };

/** 莫兰迪 12 支（A:CoursePalette.morandiLight/morandiDark）。 */
const MORANDI_LIGHT: CourseColors[] = [
  { fill: '#D9DCE1', ink: '#4A4F58', mark: '#8A929E' }, // 灰蓝
  { fill: '#E3D9CF', ink: '#5C4A3A', mark: '#A08A72' }, // 陶土
  { fill: '#CFDCD3', ink: '#3F5245', mark: '#7E9A88' }, // 灰绿
  { fill: '#E2D2D3', ink: '#5A3D40', mark: '#A27578' }, // 灰玫
  { fill: '#D3DFE4', ink: '#3A5058', mark: '#77929C' }, // 灰青
  { fill: '#DEDBC6', ink: '#54503A', mark: '#948E6E' }, // 灰黄
  { fill: '#D9D1DE', ink: '#4C3D55', mark: '#8A7594' }, // 灰紫
  { fill: '#D5DCC9', ink: '#44503A', mark: '#869472' }, // 灰橄榄
  { fill: '#E0CFC9', ink: '#5A3F38', mark: '#A17E74' }, // 灰砖
  { fill: '#C9DCDC', ink: '#384F4F', mark: '#6E9494' }, // 灰青绿
  { fill: '#DCCBDA', ink: '#523A4E', mark: '#947289' }, // 灰梅
  { fill: '#CFDACB', ink: '#3E5040', mark: '#779075' }  // 灰苔
];
const MORANDI_DARK: CourseColors[] = [
  { fill: '#353A42', ink: '#C3CAD6', mark: '#C3CAD6' },
  { fill: '#453B31', ink: '#D8C9B6', mark: '#D8C9B6' },
  { fill: '#33403A', ink: '#C2D3C6', mark: '#C2D3C6' },
  { fill: '#423234', ink: '#D6C0C2', mark: '#D6C0C2' },
  { fill: '#2F3B40', ink: '#BFD0D6', mark: '#BFD0D6' },
  { fill: '#3B382B', ink: '#D6D2BE', mark: '#D6D2BE' },
  { fill: '#3A3240', ink: '#CDBFD4', mark: '#CDBFD4' },
  { fill: '#353D2F', ink: '#C8D4BC', mark: '#C8D4BC' },
  { fill: '#40322D', ink: '#D8C4BD', mark: '#D8C4BD' },
  { fill: '#2B3838', ink: '#BCD2D2', mark: '#BCD2D2' },
  { fill: '#3B2F3A', ink: '#D3BFCD', mark: '#D3BFCD' },
  { fill: '#313B30', ink: '#C4D2C1', mark: '#C4D2C1' }
];

/** 北理蓝 12 支（A:CoursePalette.brandLight/brandDark，校色 #1B4F9C）。 */
const BRAND_LIGHT: CourseColors[] = [
  { fill: '#D6E2F5', ink: '#10315E', mark: '#1B4F9C' }, // 0 校色蓝
  { fill: '#CCE0F0', ink: '#0B3350', mark: '#1E6FA6' }, // 1 青蓝
  { fill: '#D3DAF0', ink: '#141F52', mark: '#2C3D9C' }, // 2 靛蓝
  { fill: '#C9E4EC', ink: '#073039', mark: '#14788A' }, // 3 湖蓝
  { fill: '#E1E6F7', ink: '#1B2255', mark: '#3E4FA0' }, // 4 雾蓝
  { fill: '#BFD3EA', ink: '#0A2740', mark: '#2A5C90' }, // 5 钢蓝
  { fill: '#D8D3EE', ink: '#231C55', mark: '#5A45A0' }, // 6 蓝紫
  { fill: '#CBE8E6', ink: '#06322F', mark: '#126F69' }, // 7 蓝绿
  { fill: '#E4EAF2', ink: '#1B2530', mark: '#46586E' }, // 8 灰蓝
  { fill: '#C7D9F0', ink: '#0C2A4E', mark: '#245FA8' }, // 9 天蓝
  { fill: '#DDE7F4', ink: '#122A45', mark: '#356FA8' }, // 10 浅钢蓝
  { fill: '#EDE3C8', ink: '#3A2E08', mark: '#7A5A00' }  // 11 品牌金
];
const BRAND_DARK: CourseColors[] = [
  { fill: '#16305A', ink: '#C9D9F2', mark: '#C9D9F2' },
  { fill: '#123A52', ink: '#C2DDEE', mark: '#C2DDEE' },
  { fill: '#1B2358', ink: '#CCD3F0', mark: '#CCD3F0' },
  { fill: '#0C3540', ink: '#BCE3EC', mark: '#BCE3EC' },
  { fill: '#232A62', ink: '#D5DBF2', mark: '#D5DBF2' },
  { fill: '#123048', ink: '#C0D6E8', mark: '#C0D6E8' },
  { fill: '#2A2662', ink: '#D6D0F0', mark: '#D6D0F0' },
  { fill: '#08383A', ink: '#BCE6E3', mark: '#BCE6E3' },
  { fill: '#1E2836', ink: '#C8D2DE', mark: '#C8D2DE' },
  { fill: '#10314F', ink: '#C0D8EC', mark: '#C0D8EC' },
  { fill: '#182C46', ink: '#C3D4E6', mark: '#C3D4E6' },
  { fill: '#3A2E0A', ink: '#EBDDBA', mark: '#EBDDBA' }
];

const PALETTE_SIZE: number = 12;

/**
 * Auto 族按 palette 解析（对齐 A:CourseColorResolver.resolve + Palettes.tokens）：
 * Classic⇒Legacy 统色，Warm/Brand⇒Classic 12 色。显式选族永远优先。
 */
export function resolveCourseFamily(stored: CourseColorFamily,
  paletteName: string): CourseColorFamily {
  if (stored !== 'auto') {
    return stored;
  }
  if (paletteName === 'classic') {
    return 'legacy';
  }
  return 'classic';
}

/**
 * 按族 + 色号取一套课程色（越界按 mod 12 收拢，传 -1 也不崩）。
 * 与 Android `GridTokens.course(i)` + `Palettes.tokens(family)` 合成同义。
 */
export function courseColorsOf(family: CourseColorFamily, index: number,
  isDark: boolean, paletteName: string = 'brand'): CourseColors {
  const effective: CourseColorFamily = resolveCourseFamily(family, paletteName);
  let list: CourseColors[];
  if (effective === 'legacy') {
    const one: CourseColors = isDark ? LEGACY_DARK : LEGACY_LIGHT;
    list = [one, one, one, one, one, one, one, one, one, one, one, one];
  } else if (effective === 'morandi') {
    list = isDark ? MORANDI_DARK : MORANDI_LIGHT;
  } else if (effective === 'brand') {
    list = isDark ? BRAND_DARK : BRAND_LIGHT;
  } else {
    list = isDark ? COURSE_DARK : COURSE_LIGHT;
  }
  const i: number = ((index % PALETTE_SIZE) + PALETTE_SIZE) % PALETTE_SIZE;
  return list[i];
}

/** 兼容旧调用：默认经典族 12 色（保留原 courseColors 语义）。 */
export function courseColors(index: number, isDark: boolean): CourseColors {
  return courseColorsOf('classic', index, isDark);
}
