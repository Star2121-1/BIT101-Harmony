/**
 * 《一格 GRID》共享组件的「纯逻辑」层（与 ArkUI 渲染解耦）。
 * =========================================================
 * 原版 Android 组件把「状态 → 颜色/尺寸」的判定写死在 Composable 里，
 * 没法单测。这里把判定抽成纯函数，供 Node 侧 `tools/test-gridcomponents.mjs`
 * 逐条断言，**任意一处与原版状态矩阵不一致即红**（项目铁律：每条判断要能被证伪）。
 *
 * 本文件不 import 任何 ArkUI 运行时，只依赖 `GridTokens` 的**类型**，
 * 因此 `.ets` 组件与 Node 测试都能直接消费。
 */

import type { GridTokens } from '../GridTokens.ts';

// ── 尺寸常量（vp；与原版 dp 一对一）──
export const PRESS_DURATION_MS = 80;
export const CARD_RADIUS = 12;
export const CARD_PADDING = 16;
export const CARD_STRIPE_WIDTH = 4;
export const CARD_SELECTED_BORDER = 1.5;
export const CARD_CHECK_SIZE = 20;
export const BUTTON_HEIGHT = 48;
export const BUTTON_RADIUS = 12;
export const BUTTON_PAD_FILLED = 24;
export const BUTTON_PAD_TEXT = 12;
export const CHIP_HEIGHT = 40;
export const CHIP_RADIUS = 8;
export const CHIP_PAD = 12;
export const CHIP_ICON = 16;
export const TAB_INDICATOR_W = 24;
export const TAB_INDICATOR_H = 2;
export const TAB_ICON_SIZE = 40;

export interface CardStyle {
  /** 容器底。 */
  container: string;
  /** 正文色。 */
  content: string;
  /** 选中描边色；非选中为 null。 */
  border: string | null;
  /** 左竖条色；无竖条为 null。 */
  stripe: string | null;
  /** 是否显示右上勾选圆（仅选中且非禁用）。 */
  showCheck: boolean;
}

/**
 * 卡片状态矩阵（原版 GridCard §5.1）：
 * - 禁用：`disabledBg` 底 + `textDisabled` 字 + 竖条降饱和 50% + 无勾选
 * - 选中：`primaryContainer` 底 + `onSurface` 字 + 1.5dp `primary` 描边 + 右上勾选圆
 * - 默认：`surface` 底 + `onSurface` 字
 * - 竖条：courseColorIndex≥0 时取课程 `ink`；禁用时降饱和 50%
 */
export function resolveCardStyle(
  t: GridTokens,
  opts: { selected: boolean; disabled: boolean; courseColorIndex: number; courseInk: string | null },
): CardStyle {
  let container: string;
  let content: string;
  let border: string | null = null;

  if (opts.disabled) {
    container = t.disabledBg;
    content = t.textDisabled;
  } else if (opts.selected) {
    container = t.primaryContainer;
    content = t.onSurface;
    border = t.primary;
  } else {
    container = t.surface;
    content = t.onSurface;
  }

  let stripe: string | null = null;
  if (opts.courseColorIndex >= 0 && opts.courseInk !== null) {
    stripe = opts.disabled ? desaturate(opts.courseInk, 0.5) : opts.courseInk;
  }

  const showCheck: boolean = opts.selected && !opts.disabled;
  return { container, content, border, stripe, showCheck };
}

export interface ButtonStyle {
  container: string;
  content: string;
  border: string | null;
}

/**
 * 按钮状态矩阵（原版 GridButton §5.2）：
 * - 禁用：Filled → `disabledBg`+`textDisabled`；其余透明底+`textDisabled`+Outlined 描边改 `outlineVariant`
 * - 选中（分段控件）：`surface2` 底 + `onSurface` 字 + 1dp `primary` 描边
 * - Filled：`primary` 底 + `onPrimary` 字
 * - Outlined：透明底 + `primary` 字 + 1dp `primary` 描边
 * - Text：透明底 + `primary` 字
 */
export function resolveButtonStyle(
  t: GridTokens,
  variant: string,
  opts: { enabled: boolean; selected: boolean },
): ButtonStyle {
  if (!opts.enabled) {
    if (variant === 'filled') {
      return { container: t.disabledBg, content: t.textDisabled, border: null };
    }
    if (variant === 'outlined') {
      return { container: '#00000000', content: t.textDisabled, border: t.outlineVariant };
    }
    return { container: '#00000000', content: t.textDisabled, border: null };
  }
  if (opts.selected) {
    return { container: t.surface2, content: t.onSurface, border: t.primary };
  }
  switch (variant) {
    case 'filled':
      return { container: t.primary, content: t.onPrimary, border: null };
    case 'outlined':
      return { container: '#00000000', content: t.primary, border: t.primary };
    default:
      return { container: '#00000000', content: t.primary, border: null };
  }
}

export interface ChipStyle {
  container: string;
  content: string;
  border: string | null;
  showCheck: boolean;
}

/**
 * 筛选 Chip 状态矩阵（原版 GridFilterChip §5.3）：
 * - 禁用：`disabledBg`+`textDisabled`+无勾选
 * - 选中：`primaryContainer`+`onPrimaryContainer`+1dp `primary` 描边+勾选
 * - 默认：`surface2`+`onSurfaceVariant`
 */
export function resolveChipStyle(
  t: GridTokens,
  opts: { enabled: boolean; selected: boolean },
): ChipStyle {
  if (!opts.enabled) {
    return { container: t.disabledBg, content: t.textDisabled, border: null, showCheck: false };
  }
  if (opts.selected) {
    return {
      container: t.primaryContainer,
      content: t.onPrimaryContainer,
      border: t.primary,
      showCheck: true,
    };
  }
  return { container: t.surface2, content: t.onSurfaceVariant, border: null, showCheck: false };
}

export interface TabStyle {
  /** 图标 / 文字 tint。 */
  tint: string;
  /** 顶部指示条色。 */
  indicator: string;
}

/**
 * 底部 Tab 项状态矩阵（原版 GridBottomTabItem §5.5）：
 * - 禁用：`textDisabled` tint + 指示条为 surface（不亮）
 * - 选中：`primary` tint + 指示条 `primary`
 * - 默认：`onSurfaceVariant` tint + 指示条 surface
 */
export function resolveTabStyle(
  t: GridTokens,
  opts: { enabled: boolean; selected: boolean },
): TabStyle {
  const tint: string = !opts.enabled ? t.textDisabled : opts.selected ? t.primary : t.onSurfaceVariant;
  const indicator: string = opts.selected && opts.enabled ? t.primary : t.surface;
  return { tint, indicator };
}

/**
 * 降饱和（禁用态竖条用）。与原版 `GridCard.desaturate` 同算法：
 * 每个通道向亮度 `l = 0.299R+0.587G+0.114B` 线性混合 `amount` 比例。
 * 解析失败（非 #RRGGBB）原样返回，不猜。
 */
export function desaturate(hex: string, amount: number): string {
  const h: string = hex.trim();
  if (h.length !== 7 || h.charAt(0) !== '#') {
    return hex;
  }
  const r: number = parseInt(h.substring(1, 3), 16) / 255;
  const g: number = parseInt(h.substring(3, 5), 16) / 255;
  const b: number = parseInt(h.substring(5, 7), 16) / 255;
  const l: number = 0.299 * r + 0.587 * g + 0.114 * b;
  const ch = (x: number): string =>
    Math.round(Math.max(0, Math.min(1, x)) * 255)
      .toString(16)
      .padStart(2, '0');
  return '#' + ch(r + (l - r) * amount) + ch(g + (l - g) * amount) + ch(b + (l - b) * amount);
}
