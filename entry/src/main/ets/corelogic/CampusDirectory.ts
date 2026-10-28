/**
 * 校园楼栋索引（纯逻辑，零 @kit 依赖）。
 *
 * ⚠️ **这不是地理地图**，是本模块最重要的取舍，写清楚免得后人误解：
 *  - `CampusLocations` 的坐标来自 OSM（Overpass 2026-09-28），精度约 31 米一格；
 *  - 同栋楼的不同翼（文萃楼 H/I/K/M）归一化坐标只差 1e-6，投影到 800px 画布上
 *    差 0.001px —— **画出来就是一个点**，做成「地理图」纯属骗人；
 *  - 因此这里做**楼栋目录**：按校区归类、按名称排序、可搜索、可关联「今天在哪栋楼有课」，
 *    每栋给出经纬度与「在地图中打开」所需信息。真相（坐标）照给，但不假装是地图。
 *
 * 依赖 `CampusLocations.match()`（别名最长匹配、匹配不到给 null，绝不猜）。
 */

import { ALL, match, normalize } from './CampusLocations.ts';
import type { Location } from './CampusLocations.ts';

/** 一个校区的楼栋集合。 */
export interface CampusGroup {
  campus: string;
  buildings: Location[];
}

/** 课程（只取本模块需要的两列）。 */
export interface CoursePlace {
  name: string;   // 课程名
  place: string;  // 教室/地点原文
}

/** 一栋楼 + 在这栋楼上过的课（按首次出现顺序、去重）。 */
export interface BuildingCourses {
  building: Location;
  courses: string[];
}

/** 校区顺序固定：良乡在前（主校区），中关村在后。未知校区追加到末尾。 */
const CAMPUS_ORDER: string[] = ['良乡校区', '中关村校区'];

/** 按校区归类，校区内按名称排序（字典序，稳定）。 */
export function groupByCampus(): CampusGroup[] {
  const map: Map<string, Location[]> = new Map<string, Location[]>();
  for (let i = 0; i < ALL.length; i++) {
    const loc: Location = ALL[i];
    const list: Location[] | undefined = map.get(loc.campusName);
    if (list === undefined) {
      map.set(loc.campusName, [loc]);
    } else {
      list.push(loc);
    }
  }
  const out: CampusGroup[] = [];
  for (let i = 0; i < CAMPUS_ORDER.length; i++) {
    const c: string = CAMPUS_ORDER[i];
    const list: Location[] | undefined = map.get(c);
    if (list !== undefined) {
      list.sort((a: Location, b: Location) => a.name < b.name ? -1 : (a.name > b.name ? 1 : 0));
      out.push({ campus: c, buildings: list });
    }
  }
  // 未来若新增校区（表里出现未知 campusName），不丢数据：追加到末尾
  map.forEach((list: Location[], c: string) => {
    if (CAMPUS_ORDER.indexOf(c) >= 0) {
      return;
    }
    const sorted: Location[] = list.slice();
    sorted.sort((a: Location, b: Location) => a.name < b.name ? -1 : (a.name > b.name ? 1 : 0));
    out.push({ campus: c, buildings: sorted });
  });
  return out;
}

/** 全部校区名（顺序同 `groupByCampus`）。 */
export function campusNames(): string[] {
  const groups: CampusGroup[] = groupByCampus();
  const out: string[] = [];
  for (let i = 0; i < groups.length; i++) {
    out.push(groups[i].campus);
  }
  return out;
}

/**
 * 楼栋搜索：先按名称/别名包含，再按名称前缀优先。
 * 空查询返回**该校区全部**（调用方传 campus 过滤；传空串表示不过滤）。
 */
export function searchBuildings(query: string, campus: string): Location[] {
  const q: string = normalize(query);
  const out: Location[] = [];
  for (let i = 0; i < ALL.length; i++) {
    const loc: Location = ALL[i];
    if (campus.length > 0 && loc.campusName !== campus) {
      continue;
    }
    if (q.length === 0) {
      out.push(loc);
      continue;
    }
    let hit: boolean = false;
    for (let a = 0; a < loc.aliases.length; a++) {
      if (normalize(loc.aliases[a]).indexOf(q) >= 0) {
        hit = true;
        break;
      }
    }
    if (hit) {
      out.push(loc);
    }
  }
  // 名称前缀命中的排前面（搜「文萃」时 文萃楼A… 先于 其他含「文萃」的别名）
  out.sort((a: Location, b: Location) => {
    const ap: number = normalize(a.name).indexOf(q) === 0 ? 0 : 1;
    const bp: number = normalize(b.name).indexOf(q) === 0 ? 0 : 1;
    if (ap !== bp) {
      return ap - bp;
    }
    return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0);
  });
  return out;
}

/**
 * 把课程按楼栋归集：**只返回真有课的楼栋**（空楼不占位），
 * 课程名去重（同一门课在同一栋楼上两次只算一次），楼栋顺序沿用 `ALL` 的顺序。
 */
export function coursesByBuilding(courses: CoursePlace[]): BuildingCourses[] {
  const map: Map<string, string[]> = new Map<string, string[]>();
  for (let i = 0; i < courses.length; i++) {
    const c: CoursePlace = courses[i];
    const loc: Location | null = match(c.place);
    if (loc === null) {
      continue; // 匹配不到就跳过（不猜、不建「未知楼栋」）
    }
    const list: string[] | undefined = map.get(loc.name);
    if (list === undefined) {
      map.set(loc.name, [c.name]);
      continue;
    }
    if (list.indexOf(c.name) < 0) {
      list.push(c.name);
    }
  }
  const out: BuildingCourses[] = [];
  for (let i = 0; i < ALL.length; i++) {
    const loc: Location = ALL[i];
    const list: string[] | undefined = map.get(loc.name);
    if (list !== undefined && list.length > 0) {
      out.push({ building: loc, courses: list });
    }
  }
  return out;
}

/** 某栋楼今天的课（没有 ⇒ 空数组，调用方显示「今天这里没课」）。 */
export function coursesAt(buildingName: string, courses: CoursePlace[]): string[] {
  const target: Location | null = match(buildingName);
  const out: string[] = [];
  if (target === null) {
    return out;
  }
  for (let i = 0; i < courses.length; i++) {
    const loc: Location | null = match(courses[i].place);
    if (loc !== null && loc.name === target.name && out.indexOf(courses[i].name) < 0) {
      out.push(courses[i].name);
    }
  }
  return out;
}

/** 经纬度文本（`39.7315, 116.1682`，5 位小数 ≈ 1 米，够用且不假装更准）。 */
export function lonLatText(loc: Location): string {
  const lon: number = 360 * loc.x - 180;
  const lat: number = (2 * (Math.atan(Math.exp(2 * Math.PI * (0.5 - loc.y))) - Math.PI / 4)) * (180 / Math.PI);
  return lon.toFixed(5) + ', ' + lat.toFixed(5);
}

/** 「在地图中打开」用的 URI（系统地图应用按 geo: 协议打开，不依赖任何在线瓦片服务）。 */
export function geoUri(loc: Location): string {
  const lon: number = 360 * loc.x - 180;
  const lat: number = (2 * (Math.atan(Math.exp(2 * Math.PI * (0.5 - loc.y))) - Math.PI / 4)) * (180 / Math.PI);
  return 'geo:' + lat.toFixed(6) + ',' + lon.toFixed(6) + '?q=' + lat.toFixed(6) + ',' + lon.toFixed(6);
}
