/**
 * 《一格 GRID》设计 token 层 · 鸿蒙 ArkTS 移植版
 * =========================================================
 * 1:1 照搬 Android `features/theme/GridTokens.kt` + `palette/` 三张表
 * （`SharedGridTokens` + `ClassicColor` / `WarmColor` / `BrandColor`），
 * 色值与原文逐一对齐。
 *
 * 三层结构（对齐 Android P5-B「随 palette 变」分层）：
 * 1. **跨 palette 共享段**（`SHARED_LIGHT` / `SHARED_DARK`）：语义色不随
 *    品牌变——success / accent / info 族、state 三档、error 族、num 三档
 *    （§5.2：「同一语义跨 Tab 同色」）；
 * 2. **随 palette 段**（`PALETTE_CLASSIC` / `PALETTE_WARM` / `PALETTE_BRAND`）：
 *    M3 角色 + 面色族（surface2/3、disabledBg、skeleton）+ 文字档
 *    （textPlaceholder/textDisabled）+ 按压档（pressed/pressedHeld）；
 * 3. **组装入口** `gridTokens(isDark, paletteName)`：对应 Android
 *    `Palettes.tokens(palette, isDark, family)`。
 *
 * ⚠️ palette 名（`classic` / `warm` / `brand`）= Android `AppPalette.value`，
 *   **发布后冻结的数据兼容契约**，永不随展示名改。展示名映射（反直觉！）：
 *   Brand → 「BIT101经典配色」（深蓝占位，experimental）
 *   Classic → 「暖棕配色」
 *   Warm → 「清新青绿配色」**默认**
 *   ⚠️ 展示序 Brand 在前 ≠ 默认值——默认 Warm，脏值回落也必须显式 Warm。
 *
 * ⚠️ 缺档 **fail-fast**（对齐 Android `Palettes.paletteSchemeByName` 的
 *   `error()`）：查不到 palette 表直接抛，绝不静默回退——静默回退会让
 *   「用户选了却没效果」变成查不到原因的幽灵 bug。
 *
 * 与 Android 的分工一致：
 * - 课程 12 色板不在此重复，委托 `core/theme/CoursePalette.ts`
 *   （那一份已经是 Android `CoursePalette.kt` 的 1:1 照搬）；
 *   本文件只提供 `gridCourse(index, isDark)` 透传，保证「色号 → 颜色」唯一出口。
 *
 * ⚠️ 取用入口只有 `gridTokens(isDark, paletteName)`（对应 Android 的
 *   `GridTheme.tokens`）——禁止各页面另立第二份色值。深浅与 palette 都由
 *   调用方传入（来自 `@StorageLink('ui_dark')` / `@StorageLink('ui_palette')`，
 *   持久化与收敛在 `data/ThemeStore.ts`）。
 *
 * 忠实度判定：见 `tools/test-gridtokens.mjs` 的「与原版逐值比对」断言，
 * 任意一处色值与 Android 源不一致即红——这不是装饰性测试。
 *
 * 关于 ArkTS 严格性：本文件不引入 `any` / `unknown` / `as const`，
 * 纯 `interface` + 常量对象 + 函数，可被 `.ets` 页面直接 import。
 */

import { courseColors } from './CoursePalette.ts';
import type { CourseColors } from './CoursePalette.ts';

/** 数字排版档（§8.7：字阶自带 tabular 等宽，不是可选工具类）。 */
export interface NumericStyle {
  /** 字号（vp）。 */
  fontSize: number;
  /** 行高（vp）。 */
  lineHeight: number;
  /** 字重（400/600/700，对应 Regular/SemiBold/Bold）。 */
  fontWeight: number;
  /** ArkUI `.fontFeature('tnum')` 用的特性串——等宽数字，防位数抖动（9:58 → 10:02 跳宽）。 */
  fontFeature: string;
}

/**
 * 一套《一格 GRID》语义 token（明暗两档共用同一份字段名与语义；
 * 值由 `gridTokens(isDark, paletteName)` 组装派发）。
 */
export interface GridTokens {
  // ── 语义色（跨 palette 共享，原 SharedGridTokens）──
  /** Success 主色（--success）。 */
  success: string;
  /** Success 容器底。 */
  successContainer: string;
  /** Success 容器上的文字。 */
  onSuccessContainer: string;

  /**
   * Accent 银杏金 `#E8A317`（亮）/ `#F2BE55`（暗）：**仅作填充**；
   * 文字与 <24px 图标一律用 [accentText]（原版 §0 红线）。
   */
  accent: string;
  /** Accent 上的文字/图标安全档 `#8A5A00`（亮）/ `#F2BE55`（暗）。 */
  accentText: string;
  /** Accent 容器底。 */
  accentContainer: string;
  /** Accent 容器上的文字。 */
  onAccentContainer: string;

  /** Info 容器底（信息提示条）。 */
  infoContainer: string;
  /** Info 容器上的文字。 */
  onInfoContainer: string;

  // ── 状态语义层（§8.8：颜色 + 非颜色线索，attention 档强制额外线索）──
  /** 倒计时 >30min｜流量 ≤90%｜借阅 >3 天。 */
  stateCalm: string;
  /** 倒计时 ≤30min｜流量 >90%｜**必须**配「即将开始」Chip/图标/「已用 N%」文案。 */
  stateAttention: string;
  /** 倒计时 ≤10min｜流量 >100%｜借阅 ≤3 天（含逾期）。 */
  stateUrgent: string;

  // ── error 族（M3 语义色，跨 palette 共享）──
  error: string;
  onError: string;
  errorContainer: string;
  onErrorContainer: string;

  // ── M3 角色（随 palette，组件层用，对应 Android `MaterialTheme.colorScheme`）──
  /** 主色（选中态文字/图标、填充按钮底、底部 Tab 指示条与选中填充）。warm 亮=棕 #8A4E26。 */
  primary: string;
  /** 主色上的文字（填充按钮白字）。 */
  onPrimary: string;
  /** 主色容器底（卡片选中态、Chip 选中底）。 */
  primaryContainer: string;
  /** 主色容器上的文字（Chip 选中文字）。 */
  onPrimaryContainer: string;
  /** 面（卡片/面板底）。warm 亮=纯白 #FFFFFF。 */
  surface: string;
  /** 面之上的正文。 */
  onSurface: string;
  /** 面之上的次要文字（副标题）。 */
  onSurfaceVariant: string;
  /** 面色（网格线、次级分割）。warm 亮=#F4EFE8（与 surface2 同值）。 */
  surfaceVariant: string;
  /** 页面底（App 背景）。warm 亮=暖白 #FBF8F4。 */
  background: string;
  /** 页面底之上的正文（与 onSurface 同值）。 */
  onBackground: string;
  /** 描边（控件轮廓）。 */
  outline: string;
  /** 描边变体（Outlined 按钮禁用态描边）。 */
  outlineVariant: string;
  /** 次级主色（底部导航选中 pill 底、列头渐变）。warm 亮=青绿 #1E6B55。 */
  secondary: string;
  /** 次级主色上的文字。 */
  onSecondary: string;
  /** 次级容器底（底部导航选中 pill、普通列头渐变、双卡片）。warm 亮=薄荷 #D5E9DF。 */
  secondaryContainer: string;
  /** 次级容器上的文字（底部导航选中项）。warm 亮=深绿 #0F4A38。 */
  onSecondaryContainer: string;
  /** 第三色（调课横幅底、补课 tint 目标）。warm 亮=#8A5A00。 */
  tertiary: string;
  /** 第三色上的文字。 */
  onTertiary: string;
  /** 第三色容器底（调课横幅）。warm 亮=#FBEBCC。 */
  tertiaryContainer: string;
  /** 第三色容器上的文字。warm 亮=#8A5A00。 */
  onTertiaryContainer: string;

  // ── 面色族 + 文字档 + 按压档（随 palette，对应 `PaletteScheme`）──
  /** 次级面（Chip 未选底、提示条底）。 */
  surface2: string;
  /** 三级面（分割线、空态图标底、热度条底）。 */
  surface3: string;
  /** 禁用态容器底（禁用不得仅靠颜色，须同时换容器底）。 */
  disabledBg: string;
  /** 骨架屏底色。 */
  skeleton: string;
  /** 三级可读（占位符 / 弱读数 / 组标题 / 缺值「—」）。 */
  textPlaceholder: string;
  /** 仅禁用控件文字/图标。 */
  textDisabled: string;
  /** 按压 80ms 过渡档（填充按钮按下过渡目标）。 */
  pressed: string;
  /** 按压保持档（填充按钮按住不放的底色）。 */
  pressedHeld: string;

  // ── 数字排版档（§8.7）──
  /** num-lg：44/52/700（hero 大数字，如倒计时分钟）。 */
  numLg: NumericStyle;
  /** num-md：22/30/700（余额 / 空教室数 / 借阅天数）。 */
  numMd: NumericStyle;
  /** num-sm：15/22/600（时间线时刻 `08:00` / 空到时间 `20:55`）。 */
  numSm: NumericStyle;
}

/** 跨 palette 共享字段（除 num 三档外均仍分明暗两档）。 */
interface SharedTokens {
  success: string;
  successContainer: string;
  onSuccessContainer: string;
  accent: string;
  accentText: string;
  accentContainer: string;
  onAccentContainer: string;
  infoContainer: string;
  onInfoContainer: string;
  stateCalm: string;
  stateAttention: string;
  stateUrgent: string;
  error: string;
  onError: string;
  errorContainer: string;
  onErrorContainer: string;
}

/**
 * palette 名 = Android `AppPalette.value`（`name.lowercase()`），**冻结契约**。
 * 展示名映射见文件头（Brand=「BIT101经典配色」/ Classic=「暖棕配色」/ Warm=「清新青绿配色」）。
 */
export type PaletteName = 'classic' | 'warm' | 'brand';

/** 默认 palette：**Warm**（对齐 Android `AppPalette` 默认；⚠️ 不是展示序首位 Brand）。 */
export const DEFAULT_PALETTE: PaletteName = 'warm';

/** 全部 palette（UI 展示序：Brand 在前——Android `allPalettes` 展示序，用户拍板）。 */
export const ALL_PALETTES: PaletteName[] = ['brand', 'classic', 'warm'];

/** 一套 palette 的明暗两档（对齐 Android `PaletteTokens`）。 */
interface PaletteTokens {
  light: PaletteScheme;
  dark: PaletteScheme;
}

/**
 * 一套 palette 里**随 palette 变**的那部分 token（对应 Android `PaletteScheme`
 * 去掉 `ColorScheme` 包装后的字段；鸿蒙 GridTokens 只搬了用到的 M3 角色，
 * 故本表也只在鸿蒙 interface 出现过的字段范围内对齐）。
 */
export interface PaletteScheme {
  primary: string;
  onPrimary: string;
  primaryContainer: string;
  onPrimaryContainer: string;
  secondary: string;
  onSecondary: string;
  secondaryContainer: string;
  onSecondaryContainer: string;
  tertiary: string;
  onTertiary: string;
  tertiaryContainer: string;
  onTertiaryContainer: string;
  surface: string;
  onSurface: string;
  onSurfaceVariant: string;
  surfaceVariant: string;
  background: string;
  onBackground: string;
  outline: string;
  outlineVariant: string;
  surface2: string;
  surface3: string;
  disabledBg: string;
  skeleton: string;
  textPlaceholder: string;
  textDisabled: string;
  pressed: string;
  pressedHeld: string;
}

// ── 数字排版档（跨 palette 共享，原样未动）──

const NUM_LG: NumericStyle = { fontSize: 44, lineHeight: 52, fontWeight: 700, fontFeature: 'tnum' };
const NUM_MD: NumericStyle = { fontSize: 22, lineHeight: 30, fontWeight: 700, fontFeature: 'tnum' };
const NUM_SM: NumericStyle = { fontSize: 15, lineHeight: 22, fontWeight: 600, fontFeature: 'tnum' };

// ── 第一层：跨 palette 共享段（原 SharedGridTokens，仍分明暗两档）──
// 值 = 原 warm 亮/暗色 GridTokens 的对应项，未动。

/** 共享字段 · 亮色档。 */
const SHARED_LIGHT: SharedTokens = {
  success: '#2F7D5A',
  successContainer: '#D8EFE3',
  onSuccessContainer: '#1B5B3F',

  accent: '#E8A317',
  accentText: '#8A5A00',
  accentContainer: '#FBEBCC',
  onAccentContainer: '#3D2A00',

  infoContainer: '#CFE7F6',
  onInfoContainer: '#0F5076',

  stateCalm: '#1E1A16',
  stateAttention: '#8A5A00',
  stateUrgent: '#B3261E',

  error: '#B3261E',
  onError: '#FFFFFF',
  errorContainer: '#FBE0DC',
  onErrorContainer: '#8C1D18',
};

/** 共享字段 · 暗色档。 */
const SHARED_DARK: SharedTokens = {
  success: '#7FDCB4',
  successContainer: '#0E3A2A',
  onSuccessContainer: '#7FDCB4',

  accent: '#F2BE55',
  accentText: '#F2BE55',
  accentContainer: '#3A2E12',
  onAccentContainer: '#F2BE55',

  infoContainer: '#123244',
  onInfoContainer: '#9FD3F0',

  stateCalm: '#F3EDE6',
  stateAttention: '#F2BE55',
  stateUrgent: '#FFB3A7',

  error: '#FFB3A7',
  onError: '#5C0E0A',
  errorContainer: '#571310',
  onErrorContainer: '#FFB3A7',
};

// ── 第二层：三张随 palette 表（1:1 Android palette/ 目录，值逐格对齐）──

/**
 * 暖棕配色（Android `ClassicColor`，展示名「暖棕配色」）。
 * M3 角色 = master `Color.kt` 逐格回迁；面色族/文字档/按压档的非 M3 token
 * 是 Android 侧【提案】值（master 从无这些概念），此处照搬含提案值在内。
 */
const PALETTE_CLASSIC: PaletteTokens = {
  light: {
    primary: '#8B4F26',
    onPrimary: '#FFFFFF',
    primaryContainer: '#FFDBC8',
    onPrimaryContainer: '#6F3810',
    secondary: '#755847',
    onSecondary: '#FFFFFF',
    secondaryContainer: '#FFDBC8',
    onSecondaryContainer: '#5C4131',
    tertiary: '#616033',
    onTertiary: '#FFFFFF',
    tertiaryContainer: '#E8E5AC',
    onTertiaryContainer: '#49491E',
    surface: '#FFF8F5',
    onSurface: '#221A15',
    onSurfaceVariant: '#52443C',
    surfaceVariant: '#F4DED3',
    background: '#FFF8F5',
    onBackground: '#221A15',
    outline: '#85746B',
    outlineVariant: '#D7C2B8',
    surface2: '#F4DED3',
    surface3: '#D7C2B8',
    disabledBg: '#CDB7A7',
    skeleton: '#E5D0C5',
    textPlaceholder: '#61524A',
    textDisabled: '#74645C',
    pressed: '#74411E',
    pressedHeld: '#6B3B1B',
  },
  dark: {
    primary: '#FFB68A',
    onPrimary: '#522300',
    primaryContainer: '#6F3810',
    onPrimaryContainer: '#FFDBC8',
    secondary: '#E5BFA9',
    onSecondary: '#432B1C',
    secondaryContainer: '#5C4131',
    onSecondaryContainer: '#FFDBC8',
    tertiary: '#CBC992',
    onTertiary: '#323209',
    tertiaryContainer: '#49491E',
    onTertiaryContainer: '#E8E5AC',
    surface: '#1A120D',
    onSurface: '#F0DFD7',
    onSurfaceVariant: '#D7C2B8',
    surfaceVariant: '#52443C',
    background: '#1A120D',
    onBackground: '#F0DFD7',
    outline: '#9F8D84',
    outlineVariant: '#52443C',
    surface2: '#52443C',
    surface3: '#5F5049',
    disabledBg: '#3D332D',
    skeleton: '#2A211B',
    textPlaceholder: '#C1ADA4',
    textDisabled: '#A7958C',
    pressed: '#E6AC82',
    pressedHeld: '#F6C6A0',
  },
};

/**
 * 清新青绿配色（Android `WarmColor`，展示名「清新青绿配色」，**默认**）。
 * 值 = 鸿蒙原 GRID_TOKENS_LIGHT/DARK 的对应字段，即 P1 分支落地现状。
 */
const PALETTE_WARM: PaletteTokens = {
  light: {
    primary: '#8A4E26',
    onPrimary: '#FFFFFF',
    primaryContainer: '#F9DECC',
    onPrimaryContainer: '#5C3216',
    secondary: '#1E6B55',
    onSecondary: '#FFFFFF',
    secondaryContainer: '#D5E9DF',
    onSecondaryContainer: '#0F4A38',
    tertiary: '#8A5A00',
    onTertiary: '#FFFFFF',
    tertiaryContainer: '#FBEBCC',
    onTertiaryContainer: '#8A5A00',
    surface: '#FFFFFF',
    onSurface: '#1E1A16',
    onSurfaceVariant: '#5F564E',
    surfaceVariant: '#F4EFE8',
    background: '#FBF8F4',
    onBackground: '#1E1A16',
    outline: '#9C8F82',
    outlineVariant: '#EAE3DA',
    surface2: '#F4EFE8',
    surface3: '#EAE3DA',
    disabledBg: '#E3DBD1',
    skeleton: '#E7E0D7',
    textPlaceholder: '#726759',
    textDisabled: '#8A7F72',
    pressed: '#73401E',
    pressedHeld: '#6A3A1B',
  },
  dark: {
    primary: '#EFB392',
    onPrimary: '#3D1F08',
    primaryContainer: '#4A2A12',
    onPrimaryContainer: '#EFB392',
    secondary: '#86D9C0',
    onSecondary: '#06352A',
    secondaryContainer: '#1F4A3D',
    onSecondaryContainer: '#B5E8D8',
    tertiary: '#F2BE55',
    onTertiary: '#3D2A00',
    tertiaryContainer: '#3A2E12',
    onTertiaryContainer: '#F2BE55',
    surface: '#1E1A16',
    onSurface: '#F3EDE6',
    onSurfaceVariant: '#C4B8AA',
    surfaceVariant: '#272219',
    background: '#16130F',
    onBackground: '#F3EDE6',
    outline: '#7A7069',
    outlineVariant: '#322C26',
    surface2: '#272219',
    surface3: '#332C24',
    disabledBg: '#2A251F',
    skeleton: '#231F1A',
    textPlaceholder: '#A79A8C',
    textDisabled: '#857B72',
    pressed: '#D6A98A',
    pressedHeld: '#E6C3A8',
  },
};

/**
 * BIT101经典配色（Android `BrandColor`，展示名「BIT101经典配色」）。
 * ⚠️ **深蓝占位表，全部未验证**（无官方 VI 手册可引，禁止表述为「官方色」）；
 * Android 侧带 `experimental = true`，UI 层必须标「实验性」。
 */
const PALETTE_BRAND: PaletteTokens = {
  light: {
    primary: '#1B4F9C',
    onPrimary: '#FFFFFF',
    primaryContainer: '#D6E2F5',
    onPrimaryContainer: '#10315E',
    secondary: '#4A5B75',
    onSecondary: '#FFFFFF',
    secondaryContainer: '#DEE4EE',
    onSecondaryContainer: '#2E3A4E',
    tertiary: '#7A5A00',
    onTertiary: '#FFFFFF',
    tertiaryContainer: '#F5E7C6',
    onTertiaryContainer: '#4A3800',
    surface: '#FFFFFF',
    onSurface: '#191C21',
    onSurfaceVariant: '#454C58',
    surfaceVariant: '#E4E9F1',
    background: '#F7F9FC',
    onBackground: '#191C21',
    outline: '#757D8B',
    outlineVariant: '#C6CEDA',
    surface2: '#E4E9F1',
    surface3: '#C6CEDA',
    disabledBg: '#D3DAE6',
    skeleton: '#DCE3EE',
    textPlaceholder: '#5A626E',
    textDisabled: '#737B88',
    pressed: '#173F7E',
    pressedHeld: '#123466',
  },
  dark: {
    primary: '#A8C6F5',
    onPrimary: '#10315E',
    primaryContainer: '#2C4E7C',
    onPrimaryContainer: '#D6E2F5',
    secondary: '#A9B7CC',
    onSecondary: '#25303F',
    secondaryContainer: '#3A4657',
    onSecondaryContainer: '#C7D3E5',
    tertiary: '#E3BC63',
    onTertiary: '#3D2E00',
    tertiaryContainer: '#4F3D14',
    onTertiaryContainer: '#E3BC63',
    surface: '#161B21',
    onSurface: '#E2E6EC',
    onSurfaceVariant: '#BEC5D0',
    surfaceVariant: '#262D37',
    background: '#101418',
    onBackground: '#E2E6EC',
    outline: '#8B93A0',
    outlineVariant: '#39414C',
    surface2: '#262D37',
    surface3: '#39414C',
    disabledBg: '#1F252D',
    skeleton: '#1A2027',
    textPlaceholder: '#A6AEBA',
    textDisabled: '#818995',
    pressed: '#C2D8F9',
    pressedHeld: '#D6E5FC',
  },
};

/**
 * 把任意字符串收敛成合法 palette；**脏值回落显式默认 warm**
 * （对齐 Android `AppPalette.getPalette`；展示序首位是 brand，默认却是 warm，
 * 所以不能用 first() 兜底——那会把脏值回落成 Brand）。
 *
 * 纯函数（不碰 kit）：corelogic 层（如 ScheduleTint）与 ThemeStore 共用，
 * 保证「收敛规则只有一个实现」。ThemeStore.getPalette 是它的薄封装。
 */
export function getPaletteName(value: string): PaletteName {
  if (value === 'brand' || value === 'classic' || value === 'warm') {
    return value;
  }
  return DEFAULT_PALETTE;
}

/** 登记表：palette 名 → 明暗两档（对齐 Android `Palettes.registry`）。 */
const PALETTES: Record<PaletteName, PaletteTokens> = {
  classic: PALETTE_CLASSIC,
  warm: PALETTE_WARM,
  brand: PALETTE_BRAND,
};

// ── 第三层：组装入口 ──

/**
 * 按 palette 名取档；**缺档 fail-fast**（对齐 Android `paletteSchemeByName`）。
 * 脏值（如旧包遗留的未知字符串）在此炸掉，而不是静默变成别的配色。
 */
function paletteSchemeByName(paletteName: PaletteName, isDark: boolean): PaletteScheme {
  const pt: PaletteTokens | undefined = PALETTES[paletteName];
  if (pt === undefined) {
    throw new Error(
      'GridTokens 缺档：palette=' + paletteName + '（isDark=' + (isDark ? 'dark' : 'light') +
      '）没有注册配色表——新增 palette 必须在 PALETTES 登记；' +
      '静默回退会让「选了没效果」变幽灵 bug，故 fail-fast'
    );
  }
  return isDark ? pt.dark : pt.light;
}

/**
 * 取当前配色（对应 Android `Palettes.tokens`）：
 * 随 palette 字段来自对应表，共享字段 + num 三档来自共享段。
 *
 * @param isDark 深浅（页面 `@StorageLink('ui_dark')`）
 * @param paletteName palette 名（页面 `@StorageLink('ui_palette')`，收敛在 ThemeStore）
 */
export function gridTokens(isDark: boolean, paletteName: PaletteName = DEFAULT_PALETTE): GridTokens {
  const ps: PaletteScheme = paletteSchemeByName(paletteName, isDark);
  const shared: SharedTokens = isDark ? SHARED_DARK : SHARED_LIGHT;
  // 显式组装（不用对象展开）：ArkTS 编译器对 spread 支持有限，逐字段最稳，
  // 也保证「漏一个字段」是编译错误而不是运行期 undefined。
  return {
    // ── 共享段 ──
    success: shared.success,
    successContainer: shared.successContainer,
    onSuccessContainer: shared.onSuccessContainer,
    accent: shared.accent,
    accentText: shared.accentText,
    accentContainer: shared.accentContainer,
    onAccentContainer: shared.onAccentContainer,
    infoContainer: shared.infoContainer,
    onInfoContainer: shared.onInfoContainer,
    stateCalm: shared.stateCalm,
    stateAttention: shared.stateAttention,
    stateUrgent: shared.stateUrgent,
    error: shared.error,
    onError: shared.onError,
    errorContainer: shared.errorContainer,
    onErrorContainer: shared.onErrorContainer,

    // ── 随 palette ──
    primary: ps.primary,
    onPrimary: ps.onPrimary,
    primaryContainer: ps.primaryContainer,
    onPrimaryContainer: ps.onPrimaryContainer,
    secondary: ps.secondary,
    onSecondary: ps.onSecondary,
    secondaryContainer: ps.secondaryContainer,
    onSecondaryContainer: ps.onSecondaryContainer,
    tertiary: ps.tertiary,
    onTertiary: ps.onTertiary,
    tertiaryContainer: ps.tertiaryContainer,
    onTertiaryContainer: ps.onTertiaryContainer,
    surface: ps.surface,
    onSurface: ps.onSurface,
    onSurfaceVariant: ps.onSurfaceVariant,
    surfaceVariant: ps.surfaceVariant,
    background: ps.background,
    onBackground: ps.onBackground,
    outline: ps.outline,
    outlineVariant: ps.outlineVariant,
    surface2: ps.surface2,
    surface3: ps.surface3,
    disabledBg: ps.disabledBg,
    skeleton: ps.skeleton,
    textPlaceholder: ps.textPlaceholder,
    textDisabled: ps.textDisabled,
    pressed: ps.pressed,
    pressedHeld: ps.pressedHeld,

    // ── 数字排版档（共享）──
    numLg: NUM_LG,
    numMd: NUM_MD,
    numSm: NUM_SM,
  };
}

/** 供单测遍历用：3 palette × 明暗两档（展示序 brand/classic/warm）。 */
export function allGridTokens(): GridTokens[] {
  const out: GridTokens[] = [];
  for (const name of ALL_PALETTES) {
    out.push(gridTokens(false, name));
    out.push(gridTokens(true, name));
  }
  return out;
}

/**
 * 按色号取课程色（委托 `CoursePalette`，越界按 mod 12 收拢，传 -1 也不崩）。
 * 与 Android `GridTokens.course(i)` 同一语义——这里不含哈希，哈希在 `:corelogic`。
 */
export function gridCourse(index: number, isDark: boolean): CourseColors {
  return courseColors(index, isDark);
}
