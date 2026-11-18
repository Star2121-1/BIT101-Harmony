/**
 * 瓦片地图的坐标换算（纯逻辑，可 Node 单测，不碰 @kit）。
 *
 * ## 口径：与 Android MapCompose / `map.bit101.flwfdd.xyz` 完全一致
 * - 世界坐标：归一化 0..1（x 向东、y 向南，Web-Mercator）。
 * - 层级：0..18（Android `MapState(19, ...)` = 19 级 ⇒ 可用层 0..18）。
 * - 瓦片：256×256，仅服务端提供 **z15~z18**（更低级返 403，MapCampus.kt 注释实证）。
 * - URL：`https://map.bit101.flwfdd.xyz/tile/{z}/{col}/{row}.png`
 *
 * ## 坐标换算
 * ```
 * x = (lon + 180) / 360
 * y = 0.5 - ln(tan(45° + lat/2)) / (2π)
 * ```
 * 反算（用于测试断言）：
 * ```
 * lon = x * 360 - 180
 * lat = atan(sinh(π * (1 - 2y))) * 180 / π
 * ```
 *
 * ## 为什么单独成模块
 * 地图页是 WebView + 内联 JS 引擎，ArkTS 侧只负责①算初始瓦片②校验坐标。
 * 把换算抽出来，Node 离线就能对着 Android 已验证的校区坐标断言，不必等真机。
 */

/** 瓦片服务主机（= Android MapViewModel 同一源，ODbL 署名见页面）。 */
export const TILE_HOST: string = 'https://map.bit101.flwfdd.xyz';

/** 瓦片边长（px），Web-Mercator 标准。 */
export const TILE_SIZE: number = 256;

/** 服务端实际提供的最小/最大层级（MapCampus.kt：只提供 z15~z18）。 */
export const MIN_ZOOM: number = 15;
export const MAX_ZOOM: number = 18;

/** 经纬度 → 归一化 Web-Mercator 坐标。 */
export function lonLatToNorm(lon: number, lat: number): { x: number; y: number } {
  const x: number = (lon + 180) / 360;
  // lat 夹到 ±85.0511°，避免 tan 发散（超过墨卡托有效范围）
  const clamped: number = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const rad: number = clamped * Math.PI / 180;
  const y: number = 0.5 - Math.log(Math.tan(Math.PI / 4 + rad / 2)) / (2 * Math.PI);
  return { x: x, y: y };
}

/** 归一化坐标 → 经纬度（换算正确性自检用）。 */
export function normToLonLat(x: number, y: number): { lon: number; lat: number } {
  const lon: number = x * 360 - 180;
  const lat: number = Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180 / Math.PI;
  return { lon: lon, lat: lat };
}

/** 归一化坐标 → 瓦片连续坐标（浮点，整数部分即 col/row）。 */
export function normToTile(x: number, y: number, zoom: number): { col: number; row: number } {
  const scale: number = Math.pow(2, zoom);
  return { col: x * scale, row: y * scale };
}

/** 瓦片整数坐标 → URL（对齐 Android：`/tile/{z}/{col}/{row}.png`）。 */
export function tileUrl(zoom: number, col: number, row: number): string {
  return TILE_HOST + '/tile/' + zoom.toString() + '/' + col.toString() + '/' + row.toString() + '.png';
}

/**
 * 计算覆盖视口的瓦片范围（用于预取/占位）。
 * @param centerX/centerY 视口中心的归一化坐标
 * @param zoom 层级
 * @param viewportW/viewportH 视口像素宽高
 * @returns col/row 的整数闭区间
 */
export function visibleTileRange(
  centerX: number, centerY: number, zoom: number, viewportW: number, viewportH: number,
): { colMin: number; colMax: number; rowMin: number; rowMax: number } {
  const centerTile = normToTile(centerX, centerY, zoom);
  const halfCol: number = viewportW / (2 * TILE_SIZE);
  const halfRow: number = viewportH / (2 * TILE_SIZE);
  return {
    colMin: Math.floor(centerTile.col - halfCol),
    colMax: Math.floor(centerTile.col + halfCol),
    rowMin: Math.floor(centerTile.row - halfRow),
    rowMax: Math.floor(centerTile.row + halfRow),
  };
}

/** 把层级夹到服务端可用范围。 */
export function clampZoom(zoom: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round(zoom)));
}
