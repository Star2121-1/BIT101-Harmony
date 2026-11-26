/**
 * 地图设置的持久化（G07-05，对齐 Android `MapSettings.scale`）。
 *
 * key 用 `ui_map_scale` 前缀：Prefs 里 `ui_*` 是 UI 状态，不在
 * `CacheIndex.CACHE_SPECS` 的缓存清理白名单（schedule_cache_v2_ / exam_cache_v1_ /
 * score_cache_v1 等）里 —— 判据要求「清缓存不会把缩放倍率清掉」。
 */

import { Prefs } from './Prefs.ts';
import { DEFAULT_MAP_SCALE, normalizeScale } from '../corelogic/MapScaleLogic.ts';

const KEY_MAP_SCALE: string = 'ui_map_scale';

/** 读缩放倍率；没有存过或脏值一律回落默认 1。 */
export async function loadMapScale(): Promise<number> {
  const n: number = await Prefs.getNumber(KEY_MAP_SCALE, DEFAULT_MAP_SCALE);
  return normalizeScale(n);
}

/** 写缩放倍率（写入前同样归一化，避免 3.3 这种非法值落盘）。 */
export async function saveMapScale(value: number): Promise<void> {
  await Prefs.putNumber(KEY_MAP_SCALE, normalizeScale(value));
}
