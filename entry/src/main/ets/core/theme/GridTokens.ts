/**
 * 《一格 GRID》设计 token 层 · 鸿蒙 ArkTS 移植版
 * =========================================================
 * 1:1 照搬 Android `features/theme/GridTokens.kt` 的 `SharedGridTokens` +
 * `GridTokens`（语义色 / 数字排版档），色值与原文逐一对齐。
 *
 * 与 Android 的分工一致：
 * - 课程 12 色板不在此重复，委托 `core/theme/CoursePalette.ts`
 *   （那一份已经是 Android `CoursePalette.kt` 的 1:1 照搬）；
 *   本文件只提供 `gridCourse(index, isDark)` 透传，保证「色号 → 颜色」唯一出口。
 *
 * ⚠️ 取用入口只有 `gridTokens(isDark)`（对应 Android 的 `GridTheme.tokens`）——
 *   禁止各页面另立第二份色值。深浅由调用方传入 `isDark`（来自 `@StorageLink('ui_dark')`）。
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
 * 值分明暗，由 `gridTokens(isDark)` 派发）。
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

  // ── M3 角色（warm 默认 palette；组件层用，对应 Android `MaterialTheme.colorScheme`）──
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
  /** 描边变体（Outlined 按钮禁用态描边）。 */
  outlineVariant: string;

  // ── 面色族 + 文字档 + 按压档（warm 默认 palette；随 palette 变，对应 `PaletteScheme`）──
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

// ── 跨 palette 共享段（原 SharedGridTokens，仍分明暗两档）──
// 值 = 原 warm 亮/暗色 GridTokens 的对应项，未动。

const NUM_LG: NumericStyle = { fontSize: 44, lineHeight: 52, fontWeight: 700, fontFeature: 'tnum' };
const NUM_MD: NumericStyle = { fontSize: 22, lineHeight: 30, fontWeight: 700, fontFeature: 'tnum' };
const NUM_SM: NumericStyle = { fontSize: 15, lineHeight: 22, fontWeight: 600, fontFeature: 'tnum' };

/** 共享字段 · 亮色档。 */
const GRID_TOKENS_LIGHT: GridTokens = {
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

  // M3 角色（warm 默认 palette 亮色）
  primary: '#8A4E26',
  onPrimary: '#FFFFFF',
  primaryContainer: '#F9DECC',
  onPrimaryContainer: '#5C3216',
  surface: '#FFFFFF',
  onSurface: '#1E1A16',
  onSurfaceVariant: '#5F564E',
  outlineVariant: '#EAE3DA',
  // 面色族 + 文字档 + 按压档（warm 默认 palette 亮色）
  surface2: '#F4EFE8',
  surface3: '#EAE3DA',
  disabledBg: '#E3DBD1',
  skeleton: '#E7E0D7',
  textPlaceholder: '#726759',
  textDisabled: '#8A7F72',
  pressed: '#73401E',
  pressedHeld: '#6A3A1B',

  numLg: NUM_LG,
  numMd: NUM_MD,
  numSm: NUM_SM,
};

/** 共享字段 · 暗色档。 */
const GRID_TOKENS_DARK: GridTokens = {
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

  // M3 角色（warm 默认 palette 暗色）
  primary: '#EFB392',
  onPrimary: '#3D1F08',
  primaryContainer: '#4A2A12',
  onPrimaryContainer: '#EFB392',
  surface: '#1E1A16',
  onSurface: '#F3EDE6',
  onSurfaceVariant: '#C4B8AA',
  outlineVariant: '#322C26',
  // 面色族 + 文字档 + 按压档（warm 默认 palette 暗色）
  surface2: '#272219',
  surface3: '#332C24',
  disabledBg: '#2A251F',
  skeleton: '#231F1A',
  textPlaceholder: '#A79A8C',
  textDisabled: '#857B72',
  pressed: '#D6A98A',
  pressedHeld: '#E6C3A8',

  numLg: NUM_LG,
  numMd: NUM_MD,
  numSm: NUM_SM,
};

/** 取当前配色。`isDark=true` 返暗色档（对应 Android `GridTheme.tokens`）。 */
export function gridTokens(isDark: boolean): GridTokens {
  return isDark ? GRID_TOKENS_DARK : GRID_TOKENS_LIGHT;
}

/** 供单测遍历用。 */
export function allGridTokens(): GridTokens[] {
  return [GRID_TOKENS_LIGHT, GRID_TOKENS_DARK];
}

/**
 * 按色号取课程色（委托 `CoursePalette`，越界按 mod 12 收拢，传 -1 也不崩）。
 * 与 Android `GridTokens.course(i)` 同一语义——这里不含哈希，哈希在 `:corelogic`。
 */
export function gridCourse(index: number, isDark: boolean): CourseColors {
  return courseColors(index, isDark);
}
