/**
 * 校区级中心点（#156）：1:1 移植自 Android `features/map/.../MapCampus.kt`。
 *
 * ## 数据可查证
 * 4 个校区中心点的真实 WGS-84 经纬度都在 Android 源码注释里标注了出处
 * （公开地址/教育部批文/百度 POI 换算），不是编的：
 * - 良乡  116.1666°E, 39.7290°N（房山区良乡高教园区）
 * - 中关村 116.3099°E, 39.9584°N（海淀区中关村南大街 5 号）
 * - 珠海  113.5370°E, 22.3708°N（香洲区唐家湾镇金凤路 6 号，原珠海学院）
 * - 嘉兴  120.7399°E, 30.8326°N（秀洲区油车港镇东方北路 1940 号，北理都灵理工）
 *
 * x/y 为归一化 Web-Mercator，与 Android MapCampus / 鸿蒙 CampusLocations 同口径，
 * 直接采用 Android 已算好的值（0.822685 等），不自己重算（避免口径漂移）。
 *
 * ## 边界（诚实）
 * 珠海/嘉兴**只有校区中心点，没有建筑级坐标**：Android 的 CampusLocations 明确
 * "那两片 OSM 数据太稀，没有可信的建筑坐标"。所以切到这两个校区时建筑索引为空，
 * 只提供"在系统地图查看校区"，不编造建筑、不伪造可点卡片。
 *
 * ## 无 @kit
 * 经纬度→geo URI 的拼装是纯字符串，可在 Node 单测跑。
 */

/** 一个校区的中心点。 */
export interface CampusCenter {
  name: string;
  short: string;
  /** 归一化 Web-Mercator x/y（与 CampusLocations 同口径）。 */
  x: number;
  y: number;
  /** 真实 WGS-84 经纬度（用于系统地图定位，已查证）。 */
  lon: number;
  lat: number;
  /** 是否有可信的建筑级坐标索引（良乡/中关村有，珠海/嘉兴无）。 */
  hasBuildingIndex: boolean;
}

/** 全部校区，顺序 = 页面 chip 顺序，第一个是默认定位。 */
export const CAMPUSES: CampusCenter[] = [
  { name: '良乡校区', short: '乡', x: 0.822685, y: 0.379560,
    lon: 116.1666, lat: 39.7290, hasBuildingIndex: true },
  { name: '中关村校区', short: '村', x: 0.823083, y: 0.378730,
    lon: 116.3099, lat: 39.9584, hasBuildingIndex: true },
  { name: '珠海校区', short: '珠', x: 0.815381, y: 0.436217,
    lon: 113.5370, lat: 22.3708, hasBuildingIndex: false },
  { name: '嘉兴校区', short: '嘉', x: 0.835389, y: 0.409893,
    lon: 120.7399, lat: 30.8326, hasBuildingIndex: false },
];

/** 按名字找校区；找不到返回 null（不猜）。 */
export function findCampus(name: string): CampusCenter | null {
  for (let i = 0; i < CAMPUSES.length; i++) {
    if (CAMPUSES[i].name === name) {
      return CAMPUSES[i];
    }
  }
  return null;
}

/** 校区中心点的系统地图 geo URI（与 CampusDirectory.geoUri 同格式）。 */
export function campusGeoUri(c: CampusCenter): string {
  const lat: string = c.lat.toFixed(6);
  const lon: string = c.lon.toFixed(6);
  return 'geo:' + lat + ',' + lon + '?q=' + lat + ',' + lon;
}

/** 无建筑索引校区的诚实说明文案。 */
export function noIndexHint(c: CampusCenter): string {
  return c.hasBuildingIndex ? '' :
    c.name + '暂无可信的建筑坐标（公开数据只有校区位置）。可用「在系统地图查看校区」定位到校区中心。';
}
