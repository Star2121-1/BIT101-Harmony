/**
 * 「课表/考试教室 → 地图定位」的一次性目标中转（G07-04）。
 *
 * 对齐 Android `CampusPlaces.kt:110-126` 的 `MapTargetHolder`：
 * - 底栏模块切换只带 module key，传不了坐标 ⇒ 目标先放在这里，地图页进来消费。
 * - `consume()` **取完即清空**：旋转 / 重进地图不会重复弹「已定位到」。
 *
 * 只放纯逻辑（模块级单例），不碰 @kit，Node 可单测。
 */

import { match } from './CampusLocations.ts';

/** 一次定位请求。 */
export interface MapTarget {
  /** 展示名（如 文萃楼I），提示条用。 */
  name: string;
  /** 校区名（与地图页校区按钮对应）。 */
  campus: string;
  /** 归一化 Web-Mercator x。 */
  x: number;
  /** 归一化 Web-Mercator y。 */
  y: number;
  /** 目标倍率：地点级 z18（= 5），校区级用默认 1。 */
  scale: number;
}

/** 地点级倍率：z18（瓦片服务上限，不能再放大）。 */
export const PLACE_TARGET_SCALE: number = 5;

/**
 * AppStorage 导航请求键（G07-04）：课表写入 'map'，Index 的 @Watch 消费后清空。
 * 底栏切模块不传参数，所以用这个键触发切模块，坐标仍走上面的 pending。
 */
export const STORAGE_MAP_NAV: string = 'ui_map_nav';

let pending: MapTarget | null = null;

/** 放一个待定位目标（后写覆盖前写，与 Android `@Volatile pending =` 同）。 */
export function requestMapTarget(t: MapTarget): void {
  pending = t;
}

/** 取走待定位目标；**一次性**，取完清空。 */
export function consumeMapTarget(): MapTarget | null {
  const t: MapTarget | null = pending;
  pending = null;
  return t;
}

/**
 * 教室/考场自由文本 → 定位目标；匹配不到返回 null（明说「暂未收录」，不猜校区中心）。
 * 复用 `CampusLocations.match` 的**最长别名**规则（文萃楼I404 → 文萃楼I）。
 */
export function targetFromPlace(raw: string | null | undefined): MapTarget | null {
  const loc = match(raw);
  if (loc === null) {
    return null;
  }
  return {
    name: loc.name,
    campus: loc.campusName,
    x: loc.x,
    y: loc.y,
    scale: PLACE_TARGET_SCALE,
  };
}
