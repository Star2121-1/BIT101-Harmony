/**
 * 语义化配色（浅色 / 深色两套）
 *
 * ⚠️⚠️ **2026-10-27 起：页面已全部迁到 `GridTokens.ts`，本文件不再是取色入口。**
 *   - 取色一律走 `gridTokens(isDark, paletteName)`（三套 palette × 明暗，可在设置页切）；
 *   - 本文件只剩两样东西仍有生产价值：`contrastRatio` / `relativeLuminance`（度量函数，
 *     `tools/test-gridcontrast.mjs` 与 `tools/test-colors.mjs` 在用）；
 *   - 下面的 `LIGHT` / `DARK` 两套值**仅作历史基线**保留，不代表任何界面的现状；
 *     照它写新页面 = 绕过 palette 轴、用户切皮肤不生效。
 *   - 栅栏：`tools/test-uiconventions.mjs` 规则 3 禁止 `pages/` 下再 import 本文件。
 *
 * ## 为什么当初要有这一层
 * 之前 130 处颜色直接写死在页面里（`'#888888'` 这种）。深色模式一来，全部要改，
 * 而且改的时候没判据可依 —— Android 侧 WIDGET-001 就栽在「深色下白卡浅字」，
 * 对比度只有 1.22~1.48:1，肉眼几乎看不见，返工代价很大。
 *
 * 所以这里做三件事：
 * 1. 只暴露**语义名**（textPrimary / bgCard …），页面不再出现十六进制
 * 2. 深浅两套值放在一起，改一个能同时看到另一个
 * 3. 提供 WCAG 对比度计算，用 `tools/test-colors.mjs` 把「正文 ≥4.5」钉死
 *
 * ## 关于 textFaint
 * 它只用于**非信息性装饰**（例如「15.3 秒」里的「秒」这种可省略的量词）。
 * 单测里对它放宽到 ≥3.0（WCAG 大文本标准），其余文本一律 ≥4.5。
 * 如果哪天要用它承载信息，必须升级成 textMuted。
 */

export interface Palette {
  /** 页面底色 */
  bgPage: string;
  /** 卡片/面板底色（与 bgPage 有轻微层次差） */
  bgCard: string;
  /** 需要强调的区块（今日列、当前课程卡） */
  bgSubtle: string;
  /** 正文主色 */
  textPrimary: string;
  /** 次要信息（地点、时间） */
  textSecondary: string;
  /** 弱化信息但仍需可读（口径说明、单位） */
  textMuted: string;
  /** 仅装饰，不承载信息 */
  textFaint: string;
  /** 强调色底上的文字 */
  textOnAccent: string;
  /** 分隔线 */
  divider: string;
  /** 强调色（可点文字、排名徽章、今日列头） */
  accent: string;
  /** 警告（降级提示） */
  warn: string;
  /** 错误 */
  error: string;
  /** 成功 / 空闲（「现在没课」「可用」这类正向状态） */
  success: string;
  /** 中性区块底（表格条纹、次要面板）。与 bgPage 有轻微层次差但不用彩色 */
  bgAlt: string;
  /** 需要「留意」的区块底（补课日列）。带一点暖色，但不足以抢占注意力 */
  bgWarnSubtle: string;
  /** 课程块上的文字（课程色块通常较深，文字统一用浅色） */
  textOnCourse: string;
}

/** 浅色 */
const LIGHT: Palette = {
  bgPage: '#FFFFFF',
  bgCard: '#FFFFFF',
  bgSubtle: '#F1F4FF',
  textPrimary: '#1A1A1A',
  textSecondary: '#4F4F4F',
  // ⚠️ 原来用 #888888（3.54:1）与 #AAAAAA（2.19:1），都低于 4.5。这里提亮到实测达标的值。
  textMuted: '#666666',
  textFaint: '#767676',
  textOnAccent: '#FFFFFF',
  divider: '#E4E4E4',
  accent: '#2F55C0',
  warn: '#8A5200',
  error: '#B3261E',
  success: '#1A6B31',
  bgAlt: '#F4F4F6',
  bgWarnSubtle: '#FBF3E2',
  textOnCourse: '#FFFFFF'
};

/** 深色 */
const DARK: Palette = {
  bgPage: '#121212',
  bgCard: '#1E1E1E',
  bgSubtle: '#1B2333',
  textPrimary: '#ECECEC',
  textSecondary: '#C2C2C2',
  textMuted: '#A0A0A0',
  textFaint: '#8A8A8A',
  textOnAccent: '#0F1115',
  divider: '#333333',
  // 深色下强调色要更亮，否则与深底对比不足
  accent: '#8FAEFF',
  warn: '#F0B25E',
  error: '#FF8A80',
  success: '#6FD08C',
  bgAlt: '#242424',
  bgWarnSubtle: '#2B2419',
  textOnCourse: '#FFFFFF'
};

/** 取当前配色。`dark=true` 返深色。 */
export function palette(dark: boolean): Palette {
  return dark ? DARK : LIGHT;
}

/** 供单测遍历用（不要在业务代码里拿来当默认值）。 */
export function allPalettes(): Palette[] {
  return [LIGHT, DARK];
}

export function paletteNames(): string[] {
  return ['light', 'dark'];
}

// ── WCAG 对比度 ────────────────────────────────────────────────────────

/** `#RRGGBB` → 三个 0..1 的 sRGB 分量；解析失败返回 null（不猜）。 */
function parseHex(hex: string): number[] | null {
  const h: string = hex.trim();
  if (h.length !== 7 || h.charAt(0) !== '#') {
    return null;
  }
  const out: number[] = [];
  for (let i = 1; i < 7; i += 2) {
    const v: number = parseInt(h.substring(i, i + 2), 16);
    if (isNaN(v)) {
      return null;
    }
    out.push(v / 255);
  }
  return out;
}

/** sRGB 分量线性化（WCAG 2.1 定义）。 */
function linearize(c: number): number {
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** 相对亮度；解析失败返回 -1。 */
export function relativeLuminance(hex: string): number {
  const rgb: number[] | null = parseHex(hex);
  if (rgb === null) {
    return -1;
  }
  return 0.2126 * linearize(rgb[0]) + 0.7152 * linearize(rgb[1]) + 0.0722 * linearize(rgb[2]);
}

/** 两色对比度（1..21）；任一解析失败返回 -1。 */
export function contrastRatio(a: string, b: string): number {
  const la: number = relativeLuminance(a);
  const lb: number = relativeLuminance(b);
  if (la < 0 || lb < 0) {
    return -1;
  }
  const hi: number = Math.max(la, lb);
  const lo: number = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}
