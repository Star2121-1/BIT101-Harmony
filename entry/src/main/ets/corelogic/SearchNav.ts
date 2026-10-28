/**
 * 页面之间的**导航契约**（纯常量 + 校验，零依赖）。
 *
 * 为什么单列：搜索页会往 `AppStorage` 写「要定位哪门课」，课表页读它。
 * 两个字符串写错一个，症状是「点了没反应」——最难查的一类 bug。
 * 键名集中在这里，页面只 import 常量。
 *
 * 脏值处理：`AppStorage` 是全局可写的（卡片深链、通知深链都会写），
 * 读到的字符串必须过一遍长度/空白校验，不能直接当年份/课程名用。
 */

/** 要定位的课程名（搜索 → 课表）。 */
export const STORAGE_FOCUS_COURSE: string = 'ui_focus_course';

/** 要定位的楼栋名（搜索/课程详情 → 楼栋索引页）。 */
export const STORAGE_FOCUS_BUILDING: string = 'ui_focus_building';

/** 搜索页路由。 */
export const PAGE_SEARCH: string = 'pages/SearchPage';

/** 楼栋索引页路由。 */
export const PAGE_CAMPUS_MAP: string = 'pages/CampusMapPage';

/** 教学调整页路由。 */
export const PAGE_TEACHING_ADJUSTMENT: string = 'pages/TeachingAdjustmentPage';

/** 诊断页路由。 */
export const PAGE_DIAGNOSTICS: string = 'pages/DiagnosticsPage';

/** 存储与清理页路由。 */
export const PAGE_CACHE_CLEAN: string = 'pages/CacheCleanPage';

/** 课程名最大长度（教务课名不会超过这个；超长视为脏值）。 */
const MAX_NAME_LEN: number = 80;

/** 校验课程名：去空白、限长；非法返回空串（调用方据此忽略）。 */
export function sanitizeCourseName(raw: string): string {
  const s: string = raw.trim();
  if (s.length === 0 || s.length > MAX_NAME_LEN) {
    return '';
  }
  return s;
}

/** 校验楼栋名（同规则；楼栋名更短，但共用一套校验避免各写一遍）。 */
export function sanitizeBuildingName(raw: string): string {
  return sanitizeCourseName(raw);
}
