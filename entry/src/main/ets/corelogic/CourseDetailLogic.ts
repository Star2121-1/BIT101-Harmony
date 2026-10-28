/**
 * 课程详情的**文本装配**（纯函数，零依赖）。
 *
 * 为什么单独抽出来：
 *  1. 详情面板、搜索结果的副标题、无障碍朗读都要「一句话说清这门课」，三处各写一遍必然漂；
 *  2. 教务字段大量为空（`XF = 0`、`XXXQMC = ''`），**空字段必须整段不出现**，
 *     而不是渲染成「学分  · 学时 」这种残句 —— 这条需要能被测到；
 *  3. 字段顺序是设计决定（先身份、后归属），不是随手拼的。
 */

import { weekSpanText } from './WeekSpan.ts';

/** 详情需要的课程字段（`CourseRow` 结构兼容，测试可直接构造）。 */
export interface CourseMeta {
  KCM: string;             // 课程名
  KCH: string;             // 课程号
  SKJS: string;            // 教师（逗号分隔）
  JASMC: string;           // 教室
  XXXQMC: string;          // 校区
  YPSJDD: string;          // 原始安排串
  SKZC: string;            // 周次 01 串
  XF: number;              // 学分
  XS: number;              // 学时
  KCXZDM_DISPLAY: string;  // 性质
  KCLBDM_DISPLAY: string;  // 类别
  KKDWDM_DISPLAY: string;  // 开课单位
}

/** 一行详情：`label` + `value`，页面按顺序渲染。 */
export interface DetailLine {
  label: string;
  value: string;
}

/** 非空判断（只去首尾空白；空串 / 纯空格都算空）。 */
function has(s: string): boolean {
  return s.length > 0 && s.trim().length > 0;
}

/** 把「甲,乙,丙」这类分隔串统一成「甲、乙、丙」（教务用半角逗号）。 */
export function joinNames(raw: string): string {
  if (!has(raw)) {
    return '';
  }
  const parts: string[] = raw.split(/[,，;；]/);
  const out: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const p: string = parts[i].trim();
    if (p.length > 0) {
      out.push(p);
    }
  }
  return out.join('、');
}

/** `学分 3 · 学时 48`；都取不到 ⇒ 空串（整行不显示）。 */
export function creditText(m: CourseMeta): string {
  const parts: string[] = [];
  if (m.XF > 0) {
    parts.push('学分 ' + m.XF);
  }
  if (m.XS > 0) {
    parts.push('学时 ' + m.XS);
  }
  return parts.join(' · ');
}

/** `必修 · 学科基础课 · 计算机学院`；全空 ⇒ 空串。 */
export function categoryText(m: CourseMeta): string {
  const parts: string[] = [];
  if (has(m.KCXZDM_DISPLAY)) {
    parts.push(m.KCXZDM_DISPLAY.trim());
  }
  if (has(m.KCLBDM_DISPLAY)) {
    parts.push(m.KCLBDM_DISPLAY.trim());
  }
  if (has(m.KKDWDM_DISPLAY)) {
    parts.push(m.KKDWDM_DISPLAY.trim());
  }
  return parts.join(' · ');
}

/** 教室 + 校区：`文萃楼I404（良乡校区）`；都空 ⇒ `未标注`。 */
export function placeText(m: CourseMeta): string {
  const room: string = has(m.JASMC) ? m.JASMC.trim() : '';
  const campus: string = has(m.XXXQMC) ? m.XXXQMC.trim() : '';
  if (room.length === 0 && campus.length === 0) {
    return '未标注';
  }
  if (room.length === 0) {
    return campus;
  }
  return campus.length > 0 ? room + '（' + campus + '）' : room;
}

/** 周次（人话）：`1-16周` / `1-15周(单)`；取不到 ⇒ `未标注`。 */
export function weekText(m: CourseMeta): string {
  return weekSpanText(m.SKZC);
}

/** 课号（没有就空串，不显示「课号 」）。 */
export function courseNoText(m: CourseMeta): string {
  return has(m.KCH) ? '课号 ' + m.KCH.trim() : '';
}

/**
 * 详情面板的完整行序列（**顺序即设计**）：
 * 周次 / 学分学时 / 性质类别单位 / 课号 / 教师 / 地点 / 原始安排。
 * 值为空的整行**不出现**（不是空串占位），页面据此直接 ForEach。
 */
export function detailLines(m: CourseMeta): DetailLine[] {
  const out: DetailLine[] = [];
  const credits: string = creditText(m);
  const category: string = categoryText(m);
  const no: string = courseNoText(m);
  const teacher: string = joinNames(m.SKJS);
  const place: string = placeText(m);
  const arrange: string = has(m.YPSJDD) ? m.YPSJDD.trim() : '';
  if (m.SKZC.length > 0) {
    out.push({ label: '周次', value: weekText(m) });
  }
  if (credits.length > 0) {
    out.push({ label: '学分', value: credits });
  }
  if (category.length > 0) {
    out.push({ label: '课程属性', value: category });
  }
  if (no.length > 0) {
    out.push({ label: '课程号', value: no });
  }
  if (teacher.length > 0) {
    out.push({ label: '教师', value: teacher });
  }
  if (place.length > 0) {
    out.push({ label: '地点', value: place });
  }
  if (arrange.length > 0) {
    out.push({ label: '安排', value: arrange });
  }
  return out;
}

/**
 * 一句话摘要（搜索结果副标题 / 无障碍朗读用）：
 * `文萃楼I404 · 张老师 · 1-16周`。空字段自动跳过，不会出现连续分隔符。
 */
export function summaryText(m: CourseMeta): string {
  const parts: string[] = [];
  const room: string = has(m.JASMC) ? m.JASMC.trim() : '';
  const teacher: string = joinNames(m.SKJS);
  if (room.length > 0) {
    parts.push(room);
  }
  if (teacher.length > 0) {
    parts.push(teacher);
  }
  if (m.SKZC.length > 0) {
    parts.push(weekSpanText(m.SKZC));
  }
  return parts.join(' · ');
}
