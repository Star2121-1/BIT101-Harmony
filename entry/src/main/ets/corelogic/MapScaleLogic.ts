/**
 * 地图缩放倍率的**唯一口径**（G07-05）。
 *
 * 对齐 Android `MapSettings.scale`：范围 1..5、步进 0.5、默认 1（用户拍板，
 * Android 默认 2f 但鸿蒙按 z15 视野最大取 1，见 ROADMAP:75）。
 *
 * 这里只放纯函数：MapPage 的滑杆与持久化都走它，Node 侧可直接单测
 * 「滑到 3.0 重启后 scaleToZoom 输出仍一致」（判据 G07-05）。
 */

export const MAP_SCALE_MIN: number = 1;
export const MAP_SCALE_MAX: number = 5;
export const MAP_SCALE_STEP: number = 0.5;
/** 用户拍板默认 1（不是 Android 的 2f）。 */
export const DEFAULT_MAP_SCALE: number = 1;
/** 地点级定位用的倍率：z18（= 最大倍率 5），对齐 Android CampusPlace.SCALE=0.5f ≈ z18。 */
export const PLACE_MAP_SCALE: number = MAP_SCALE_MAX;

/**
 * 倍率 → 瓦片层级：1 倍 = z15，5 倍 = z18（线性映射，与旧 MapPage:34-36 完全一致）。
 */
export function scaleToZoom(value: number): number {
  return 15 + (value - MAP_SCALE_MIN) / (MAP_SCALE_MAX - MAP_SCALE_MIN) * 3;
}

/** 层级 → 倍率（自检/反解用；不用于滑杆）。 */
export function zoomToScale(zoom: number): number {
  return MAP_SCALE_MIN + (zoom - 15) / 3 * (MAP_SCALE_MAX - MAP_SCALE_MIN);
}

/**
 * 脏值回落：非有限数 → 默认 1；夹到 [1,5] 后按 0.5 量化。
 * ⚠️ 不写 `Number.isNaN` 之外的判断捷径，避免 `null`/空串在 ArkTS 里走成 0。
 */
export function normalizeScale(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_MAP_SCALE;
  }
  const clamped: number = Math.max(MAP_SCALE_MIN, Math.min(MAP_SCALE_MAX, value));
  return Math.round(clamped / MAP_SCALE_STEP) * MAP_SCALE_STEP;
}
