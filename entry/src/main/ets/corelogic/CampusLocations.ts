/**
 * 1:1 移植自 Android：data/src/main/java/cn/bit101/android/data/school/CampusLocations.kt（342 行）
 *
 * 移植日期：2026-10-19（夜间任务 2）
 *
 * 必须一起搬的规则：
 * - 坐标全部来自 OpenStreetMap（Overpass API 2026-09-28 拉取），**不是编的**；
 *   Android 侧有 CampusOsmSurveyTest 双向守卫（表⊆OSM 两格内 / OSM 教学楼必须在表内或豁免）。
 *   ⚠️ 鸿蒙侧今晚**没有**移植该守卫（需要 OSM fixture），坐标数据原样照抄——
 *   改坐标前必须先看 Android 侧守卫与 `docs/` 记录，别手改。
 * - 坐标精度约 31 米一格 ⇒ 只能分档（distanceOf），**绝不报米数**
 * - 同栋楼阈值 40 米（文萃楼 H/I/K/M 是同一栋不同翼，被舍入进同一格）
 * - match() 取**命中的最长别名**（文萃楼I404 同时命中 文萃楼I(4字) 与 文萃楼(3字)，必须选长的）
 * - 匹配不到返回 null 而不是猜（前沿楼 就不在表里 ⇒ 不给距离）
 * - 别名里的坑（跨校区错配）：良乡图书馆 ≠ 中关村图书馆；体育馆（良乡）≠ 中关村体育馆；
 *   裸别名「图书馆」「体育馆」只归中关村那条
 * - normalize：去空白、全角（FF01-FF5E）转半角、字母大写（教务数据混全角 Ｉ４０４）
 * - distanceMeters：**同一校区才比**，跨校区返回 null
 */

/** 一个地点（建筑）。 */
export interface Location {
  /** 展示名，如 文萃楼I */
  name: string;
  /** 校区名（与地图页校区按钮对应） */
  campusName: string;
  /** 归一化 Web-Mercator 横坐标 (lon+180)/360 */
  x: number;
  /** 归一化 Web-Mercator 纵坐标 0.5-ln(tan(45°+lat/2))/2π */
  y: number;
  /** 课表/考试地点里可能的写法（匹配用别名） */
  aliases: string[];
}

/** 全部地点（良乡 30 + 中关村 20，与 Android 表逐条一致）。 */
export const ALL: Location[] = [
  // ── 良乡校区 ──
  { name: "文萃楼A", campusName: "良乡校区", x: 0.822690, y: 0.379552, aliases: ["文萃楼A", "文萃A"] },
  { name: "文萃楼B", campusName: "良乡校区", x: 0.822689, y: 0.379554, aliases: ["文萃楼B", "文萃B"] },
  { name: "文萃楼C", campusName: "良乡校区", x: 0.822689, y: 0.379555, aliases: ["文萃楼C", "文萃C"] },
  { name: "文萃楼D", campusName: "良乡校区", x: 0.822688, y: 0.379555, aliases: ["文萃楼D", "文萃D"] },
  { name: "文萃楼E", campusName: "良乡校区", x: 0.822687, y: 0.379555, aliases: ["文萃楼E", "文萃E"] },
  { name: "文萃楼F", campusName: "良乡校区", x: 0.822688, y: 0.379553, aliases: ["文萃楼F", "文萃F"] },
  { name: "文萃楼G", campusName: "良乡校区", x: 0.822687, y: 0.379554, aliases: ["文萃楼G", "文萃G"] },
  { name: "文萃楼H", campusName: "良乡校区", x: 0.822687, y: 0.379549, aliases: ["文萃楼H", "文萃H"] },
  { name: "文萃楼I", campusName: "良乡校区", x: 0.822688, y: 0.379549, aliases: ["文萃楼I", "文萃I"] },
  { name: "文萃楼J", campusName: "良乡校区", x: 0.822687, y: 0.379548, aliases: ["文萃楼J", "文萃J"] },
  { name: "文萃楼K", campusName: "良乡校区", x: 0.822688, y: 0.379548, aliases: ["文萃楼K", "文萃K"] },
  { name: "文萃楼L", campusName: "良乡校区", x: 0.822689, y: 0.379548, aliases: ["文萃楼L", "文萃L"] },
  { name: "文萃楼M", campusName: "良乡校区", x: 0.822689, y: 0.379549, aliases: ["文萃楼M", "文萃M"] },
  // 不带区号的写法（教务偶尔只写「文萃楼305」）用各分区的几何中心
  { name: "文萃楼", campusName: "良乡校区", x: 0.822688, y: 0.379551, aliases: ["文萃楼", "文萃"] },
  // ⚠️「文萃楼圆形报告厅」是空教室接口里的真实楼名，独立一栋；
  // 别名绝不能含「文萃楼」——那会把整个文萃楼群吞掉
  {
    name: "文萃楼圆形报告厅",
    campusName: "良乡校区",
    x: 0.822687,
    y: 0.379551,
    aliases: ["文萃楼圆形报告厅", "圆形报告厅"],
  },
  { name: "理学楼A", campusName: "良乡校区", x: 0.822682, y: 0.379565, aliases: ["理学楼A", "理学A"] },
  { name: "理学楼B", campusName: "良乡校区", x: 0.822682, y: 0.379564, aliases: ["理学楼B", "理学B"] },
  { name: "理学楼C", campusName: "良乡校区", x: 0.822682, y: 0.379562, aliases: ["理学楼C", "理学C"] },
  { name: "理学楼", campusName: "良乡校区", x: 0.822682, y: 0.379564, aliases: ["理学楼", "理学"] },
  // 「综合教学楼大楼A/B」是接口真名（比课表「综教B301」多一个「楼」字），不收就永远认不出
  {
    name: "综合教学大楼",
    campusName: "良乡校区",
    x: 0.822681,
    y: 0.379549,
    aliases: ["综合教学大楼", "综合教学楼大楼", "综教", "综教楼"],
  },
  // 「理教楼」是真机课表写法；「理科教学大楼」是接口写法；同一栋两种叫法
  {
    name: "理科教学楼",
    campusName: "良乡校区",
    x: 0.822681,
    y: 0.379560,
    aliases: ["理科教学楼", "理科教学大楼", "理科楼", "理教楼", "理教"],
  },
  { name: "工业生态楼", campusName: "良乡校区", x: 0.822680, y: 0.379575, aliases: ["工业生态楼", "生态楼"] },
  { name: "物理实验中心", campusName: "良乡校区", x: 0.822679, y: 0.379564, aliases: ["物理实验中心", "物理实验楼"] },
  { name: "化学实验中心", campusName: "良乡校区", x: 0.822679, y: 0.379568, aliases: ["化学实验中心", "化学实验楼"] },
  // 「工训楼」与「工程训练中心」互不为子串；同一栋（真机取证：楼下房间就叫工程训练中心）
  {
    name: "工程训练中心",
    campusName: "良乡校区",
    x: 0.822688,
    y: 0.379575,
    aliases: ["工程训练中心", "工训楼"],
  },
  // 「体育馆（良乡）」是接口楼名；别名不加裸「体育馆」（中关村那条已有，等长并列顺序不确定）
  {
    name: "文化体育中心",
    campusName: "良乡校区",
    x: 0.822697,
    y: 0.379554,
    aliases: ["文化体育中心", "文体中心", "体育馆（良乡）"],
  },
  { name: "学生服务中心", campusName: "良乡校区", x: 0.822671, y: 0.379552, aliases: ["学生服务中心"] },
  { name: "行政楼", campusName: "良乡校区", x: 0.822682, y: 0.379552, aliases: ["行政楼"] },
  { name: "文博中心", campusName: "良乡校区", x: 0.822696, y: 0.379549, aliases: ["文博中心"] },
  // 「良乡图书馆」别名不加裸「图书馆」（留给中关村，避免跨校区错配）
  {
    name: "良乡图书馆",
    campusName: "良乡校区",
    x: 0.822681,
    y: 0.379554,
    aliases: ["良乡图书馆", "徐特立图书馆"],
  },
  // 「前沿交叉大楼」= 官方「融创楼A」= OSM「前沿交叉研究院大楼」；
  // ⚠️ 绝不能加「前沿楼」——官方资料显示那是一组楼（A/B/C），名字本身有歧义
  {
    name: "前沿交叉大楼",
    campusName: "良乡校区",
    x: 0.822688,
    y: 0.379569,
    aliases: ["前沿交叉大楼", "前沿交叉研究院大楼", "融创楼A"],
  },
  { name: "丹枫园C", campusName: "良乡校区", x: 0.822674, y: 0.379534, aliases: ["丹枫园C", "丹枫C"] },
  { name: "至善园", campusName: "良乡校区", x: 0.822671, y: 0.379574, aliases: ["至善园"] },
  // 「信创楼」接口里归「未归类」但物理在良乡且有教室 ⇒ 要收
  { name: "信创楼", campusName: "良乡校区", x: 0.822696, y: 0.379560, aliases: ["信创楼", "信创楼-A", "信创楼A"] },

  // ── 中关村校区（已按校区多边形筛过，排除人大/农科院的楼）──
  { name: "主楼", campusName: "中关村校区", x: 0.823098, y: 0.378730, aliases: ["主楼"] },
  { name: "中心教学楼", campusName: "中关村校区", x: 0.823086, y: 0.378731, aliases: ["中心教学楼", "中教"] },
  { name: "信息教学楼", campusName: "中关村校区", x: 0.823086, y: 0.378737, aliases: ["信息教学楼", "信息楼"] },
  { name: "研究生教学楼", campusName: "中关村校区", x: 0.823089, y: 0.378738, aliases: ["研究生教学楼", "研究生楼"] },
  { name: "信息科技实验楼", campusName: "中关村校区", x: 0.823092, y: 0.378737, aliases: ["信息科技实验楼", "信息科学实验楼"] },
  { name: "1#教学楼", campusName: "中关村校区", x: 0.823098, y: 0.378727, aliases: ["1#教学楼", "1号教学楼", "一号教学楼"] },
  { name: "3#教学楼", campusName: "中关村校区", x: 0.823090, y: 0.378728, aliases: ["3#教学楼", "3号教学楼", "三号教学楼"] },
  { name: "4#教学楼", campusName: "中关村校区", x: 0.823090, y: 0.378734, aliases: ["4#教学楼", "4号教学楼", "四号教学楼"] },
  { name: "5#教学楼", campusName: "中关村校区", x: 0.823099, y: 0.378733, aliases: ["5#教学楼", "5号教学楼", "五号教学楼"] },
  { name: "7#教学楼", campusName: "中关村校区", x: 0.823086, y: 0.378734, aliases: ["七号教学楼", "7号教学楼", "7#教学楼"] },
  // 「6号教学楼」是接口真名，人工比对补入（中关村无 OSM 守卫）
  { name: "6#教学楼", campusName: "中关村校区", x: 0.823067, y: 0.378713, aliases: ["6号教学楼", "6#教学楼", "六号教学楼"] },
  { name: "车辆重点实验楼", campusName: "中关村校区", x: 0.823098, y: 0.378737, aliases: ["车辆重点实验楼"] },
  { name: "图书馆", campusName: "中关村校区", x: 0.823094, y: 0.378734, aliases: ["图书馆"] },
  { name: "体育馆", campusName: "中关村校区", x: 0.823079, y: 0.378732, aliases: ["体育馆"] },
];

/**
 * 归一化：去空白、全角转半角、字母转大写。
 * ⚠️ 教务数据里混着全角数字与全角字母（Ｉ４０４），不转就匹配不上。
 */
export function normalize(raw: string): string {
  let sb = "";
  for (const ch of raw) {
    const code = ch.codePointAt(0)!;
    if (/\s/.test(ch)) continue;
    if (code >= 0xff01 && code <= 0xff5e) {
      sb += String.fromCodePoint(code - 0xfee0);
    } else if (code === 0x3000) {
      continue;
    } else {
      sb += ch.toUpperCase();
    }
  }
  return sb;
}

/**
 * 把教室/考试/楼名字符串匹配到地点；匹配不到返回 null。
 * ⚠️ 取命中的**最长别名**；匹配不到返回 null 而不是猜一个。
 */
export function match(raw: string | null | undefined): Location | null {
  if (raw === null || raw === undefined) return null;
  const text = normalize(raw);
  if (text.length === 0) return null;
  let best: Location | null = null;
  let bestLen = 0;
  for (const place of ALL) {
    for (const alias of place.aliases) {
      const a = normalize(alias);
      if (a.length > bestLen && text.includes(a)) {
        best = place;
        bestLen = a.length;
      }
    }
  }
  return best;
}

/** 按展示名查地点（文萃楼I 这种精确名）；找不到返回 null。 */
export function find(name: string | null | undefined): Location | null {
  if (name === null || name === undefined) return null;
  for (const p of ALL) if (p.name === name) return p;
  return null;
}

// ── 距离 ────────────────────────────────────────────────────────────────

const METERS_PER_LAT_DEGREE = 110540.0;
const METERS_PER_LON_DEGREE = 111320.0;

/** 归一化 → 经度（x 的逆运算）。 */
export function lonOf(location: Location): number {
  return 360 * location.x - 180;
}

/** 归一化 → 纬度（y 的逆运算，与地图组件同一套公式）。 */
export function latOf(location: Location): number {
  return (2 * (Math.atan(Math.exp(2 * Math.PI * (0.5 - location.y))) - Math.PI / 4)) * (180 / Math.PI);
}

/**
 * 两点直线距离（米）。任一为 null、或两点不在同一校区 → null。
 * ⚠️ 同一校区才比：良乡与中关村隔着十几公里，跨校区比出来的数没有意义。
 */
export function distanceMeters(a: Location | null, b: Location | null): number | null {
  if (a === null || b === null) return null;
  if (a.campusName !== b.campusName) return null;
  const mlat = ((latOf(a) + latOf(b)) / 2) * (Math.PI / 180);
  const dx = (lonOf(b) - lonOf(a)) * METERS_PER_LON_DEGREE * Math.cos(mlat);
  const dy = (latOf(b) - latOf(a)) * METERS_PER_LAT_DEGREE;
  return Math.hypot(dx, dy);
}

/** 距离分档 —— 只给档位、不给米数（坐标精度约 31 米一格，米数是假的精度）。 */
export const Distance = {
  SAME: "SAME",
  NEXT_DOOR: "NEXT_DOOR",
  NEAR: "NEAR",
  FAR: "FAR",
} as const;
export type Distance = (typeof Distance)[keyof typeof Distance];

export function distanceLabel(d: Distance): string {
  switch (d) {
    case Distance.SAME:
      return "同一栋楼";
    case Distance.NEXT_DOOR:
      return "紧挨着";
    case Distance.NEAR:
      return "隔一段路";
    default:
      return "在另一片";
  }
}

const SAME_BUILDING_METERS = 40.0;
const NEXT_DOOR_METERS = 80.0;
const NEAR_METERS = 400.0;

/** 把直线距离分档；null（算不出来）返回 null。 */
export function distanceOf(meters: number | null): Distance | null {
  if (meters === null || meters < 0 || Number.isNaN(meters) || !Number.isFinite(meters)) return null;
  if (meters <= SAME_BUILDING_METERS) return Distance.SAME;
  if (meters <= NEXT_DOOR_METERS) return Distance.NEXT_DOOR;
  if (meters <= NEAR_METERS) return Distance.NEAR;
  return Distance.FAR;
}
