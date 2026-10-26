/**
 * 颜色工具：1:1 照搬 Android `features/common/utils/ColorUtils.kt` 的 mixColor。
 *
 * 语义：**第一个颜色占比为 ratio**（与 Kotlin 注释一致）——
 *   mixHex('#FFFFFF', '#F9DECC', 0.25) = 0.25*白 + 0.75*桃
 *
 * 用途（都经真机采样 + 源码双证，见 harmony/ui-ref/MIGRATION-BASELINE.md）：
 * - 课表今日列底色 = mixHex(primaryContainer, background, 0.5)
 *   （源码 CourseScheduleCalendar.kt:263 `primaryContainer.copy(alpha=0.5f)`，
 *     渲染复合后 = 两者各半；实测 #FAEBE0）
 * - 空教室教学楼卡 = mixHex(surface, primaryContainer, 0.25)
 *   （源码 FreeClassroomSearch.kt:185）
 *
 * ⚠️ Kotlin 版丢 alpha（三参 Color 构造恒 1）；本端口径一致：
 * 只算 RGB，需要半透明的地方调用方自己拼 8 位 hex（ArkUI 支持 '#RRGGBBAA'）。
 */

/** '#RRGGBB' → [r,g,b]（0..255）。非法输入抛错（不猜）。 */
function parseHex(hex: string): number[] {
  const s: string = hex.trim();
  if (s.length !== 7 || s.charAt(0) !== '#') {
    throw new Error('mixHex: 期望 #RRGGBB，收到 ' + JSON.stringify(hex));
  }
  const out: number[] = [];
  for (let i = 1; i <= 5; i += 2) {
    const v: number = parseInt(s.substring(i, i + 2), 16);
    if (isNaN(v)) {
      throw new Error('mixHex: 非法十六进制 ' + JSON.stringify(hex));
    }
    out.push(v);
  }
  return out;
}

function toHex(n: number): string {
  // 四舍五入到最近整数（Kotlin Float 运算后 toArgb 也是四舍五入口径）
  const v: number = Math.round(Math.max(0, Math.min(255, n)));
  const s: string = v.toString(16).toUpperCase();
  return s.length === 1 ? '0' + s : s;
}

/**
 * 混色：color1 占 ratio，color2 占 (1-ratio)。
 * ratio 不做 0..1 收拢（与 Kotlin 一致，调用方保证）。
 */
export function mixHex(color1: string, color2: string, ratio: number): string {
  const a: number[] = parseHex(color1);
  const b: number[] = parseHex(color2);
  return '#' + toHex(a[0] * ratio + b[0] * (1 - ratio)) +
    toHex(a[1] * ratio + b[1] * (1 - ratio)) +
    toHex(a[2] * ratio + b[2] * (1 - ratio));
}

/**
 * 把 '#RRGGBB' 变成 8 位 hex `#AARRGGBB`（**alpha 在前**，与 Android/ArkUI 一致）。
 * alpha 0..1；与 Compose `copy(alpha=)` 语义一致。
 *
 * ⚠️⚠️ 曾经写成「alpha 拼在末尾」(`#RRGGBBAA`)，注释还写着"ArkUI 支持"——**是错的**。
 *   2026-10-26 真机实证：FAB 底色 `#F9DECC` + 0.8α 期望复合 #F9E3D4，实际渲染 #DFCDCD
 *   （= A=F9 不透明、RGB=DECCCC 的 ARGB 解释）；表头渐变则被插值成黄色。
 *   判据：8 位 hex 的第一个字节是 alpha，不是最后一个。
 */
export function withAlpha(hex: string, alpha: number): string {
  parseHex(hex);
  const a: number = Math.round(Math.max(0, Math.min(1, alpha)) * 255);
  return '#' + toHex(a) + hex.substring(1);
}
