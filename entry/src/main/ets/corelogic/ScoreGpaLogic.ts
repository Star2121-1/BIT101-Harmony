/**
 * 加权 GPA 统计（G-01）——1:1 照搬 Android `data/score/ScoreTable.kt` 的
 * 教〔2022〕16号口径。纯函数、零依赖、可离线单测。
 *
 * ## 口径（红头文件，不跟网页版）
 * - 百分制：`X<60 ⇒ 绩点 0`（照常进分母）；否则 `4 - 3*(100-X)²/1600`
 * - **逐课绩点 half-up 到 0.1 再加权**（80 分 = 3.3，不是银行家舍入的 3.2）
 * - 等级制：优秀4.0 / 良好3.6 / 中等2.8 / 及格1.7 / 不及格0
 * - 缺考 / 旷考 / 作弊 / 无效 = **真的 0 分**（办发〔2019〕75号），照常计入
 * - 缓考 / 免修 / 认不出的成绩 / 0 学分：整门跳过
 * - **只有校公选课不及格不计入绩点**（唯一可整门剔除的情况）
 * - 同一门课多条（重修/补考）：**在全量行上**只取最高成绩
 *
 * ⚠️ 与网页版刻意分叉：网页版把所有不及格整门剔除且无逐课舍入，
 * 85/3 + 45/4 它算 3.5781，本端口径算 1.5429。别拿网页版当基准。
 *
 * ⚠️ ArkTS 禁动态 key `Record<string,X>` + `Object.assign`；去重表用平行
 * `string[]` + `ScoreEntry[]` 实现，语义等价 LinkedHashMap。
 */

import type { ScoreEntry } from './ScoreLogic.ts';

/** 等级制 → [百分制等值, 绩点]（A:ScoreTable.gradeOf）。 */
function gradeOf(raw: string): number[] | null {
  const t: string = raw.trim();
  if (t === '优秀') {
    return [95, 4.0];
  }
  if (t === '良好') {
    return [85, 3.6];
  }
  if (t === '中等') {
    return [75, 2.8];
  }
  if (t === '及格') {
    return [65, 1.7];
  }
  if (t === '不及格') {
    return [0, 0.0];
  }
  return null;
}

/** 按 0 分记的几种写法（A:ScoreTable.ZERO_MARKERS）。 */
const ZERO_MARKERS: string[] = ['缺考', '旷考', '作弊', '无效'];

function isZeroMarker(t: string): boolean {
  for (let i = 0; i < ZERO_MARKERS.length; i++) {
    if (t === ZERO_MARKERS[i] || t.indexOf(ZERO_MARKERS[i]) >= 0) {
      return true;
    }
  }
  return false;
}

/**
 * 逐课绩点 half-up 到 0.1。
 * ⚠️ 禁用 `Math.round`（JS 的 round 对 3.25 → 3.3 其实 OK，但为避免与
 * 其他语言的 ties-even 混淆，统一用显式 floor(x*10+0.5)/10，与 A:round1 逐字同义）。
 */
export function round1(x: number): number {
  return Math.floor(x * 10 + 0.5) / 10;
}

/** 成绩原文 → 统计用百分制数值；认不出返回 null（缓考/免修/空串要跳过，不是 0 分）。 */
export function scoreOf(raw: string | null): number | null {
  if (raw === null) {
    return null;
  }
  const g: number[] | null = gradeOf(raw);
  if (g !== null) {
    return g[0];
  }
  const t: string = raw.trim().replace(/分$/, '').trim();
  if (isZeroMarker(t)) {
    return 0;
  }
  const x: number = Number(t);
  if (!Number.isFinite(x) || t.length === 0) {
    return null;
  }
  return x >= 0 && x <= 100 ? x : null;
}

/** 成绩原文 → 课程绩点；认不出返回 null（校公选剔除由 summarize 判，不在这里）。 */
export function gpaOf(raw: string | null): number | null {
  if (raw === null) {
    return null;
  }
  const g: number[] | null = gradeOf(raw);
  if (g !== null) {
    return g[1];
  }
  const t: string = raw.trim().replace(/分$/, '').trim();
  if (isZeroMarker(t)) {
    return 0;
  }
  const x: number = Number(t);
  if (!Number.isFinite(x) || t.length === 0 || x < 0 || x > 100) {
    return null;
  }
  if (x < 60) {
    return 0;
  }
  return round1(4 - 3 * (100 - x) * (100 - x) / 1600);
}

/** 校公选课的精确取值集合（A:ScoreTable.PUBLIC_ELECTIVE_NAMES，不收「公共选修/公选课」）。 */
const PUBLIC_ELECTIVE_NAMES: string[] = [
  '校公选课', '校公选', '文化素质通识课', '实践训练通识课', '拓展英语'
];

function isPublicElective(e: ScoreEntry): boolean {
  const c: string = (e.category === undefined ? '' : e.category).trim();
  for (let i = 0; i < PUBLIC_ELECTIVE_NAMES.length; i++) {
    if (c === PUBLIC_ELECTIVE_NAMES[i]) {
      return true;
    }
  }
  return false;
}

/** 去重键：优先课程编号，没有编号退回课程名（A:ScoreTable.keyOf）。 */
export function gpaKeyOf(e: ScoreEntry): string {
  const number: string = e.courseNumber === undefined ? '' : e.courseNumber.replace(/\s/g, '').toLowerCase();
  if (number.length > 0) {
    return 'n:' + number;
  }
  const name: string = e.course.replace(/\s/g, '').toLowerCase();
  if (name.length > 0) {
    return 'c:' + name;
  }
  return 'c:';
}

/** 加权统计结果（字段语义与 A:ScoreTable.Summary 对齐）。 */
export interface GpaSummary {
  /** 计入绩点的门数（去重后）。 */
  courseCount: number;
  /** 计入绩点的学分合计（不及格也进分母；校公选不及格、缓考不算）。 */
  totalCredit: number;
  /** 加权平均分（百分制）；无可统计课时为 null。 */
  weightedScore: number | null;
  /** 加权平均学分绩点（4 分制）；无可统计课时为 null。 */
  weightedGpa: number | null;
  /** 整门没计入的门数（缓考/免修/学分不明），按门不按行。 */
  skipped: number;
  /** 校公选课不及格被排除的门数。 */
  electiveFailed: number;
  /** 已获得学分（只有及格才拿到）。 */
  earnedCredit: number;
}

export const EMPTY_GPA: GpaSummary = {
  courseCount: 0, totalCredit: 0, weightedScore: null, weightedGpa: null,
  skipped: 0, electiveFailed: 0, earnedCredit: 0
};

/**
 * 加权统计（A:ScoreTable.summarize 逐条对齐）。
 * 去重在全量行上做：先挑每门最高成绩，再统计；缓考与及格并存时这门算进去，
 * 不重复计入 skipped（按门不按行）。
 */
export function summarizeGpa(rows: ScoreEntry[]): GpaSummary {
  if (rows.length === 0) {
    return EMPTY_GPA;
  }
  // 平行数组模拟 LinkedHashMap<String,ScoreEntry> + 保留插入序
  const bestKeys: string[] = [];
  const bestRows: ScoreEntry[] = [];
  const noScoreKeys: string[] = [];
  const electiveFailedKeys: string[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row: ScoreEntry = rows[i];
    const key: string = gpaKeyOf(row);
    const score: number | null = scoreOf(row.score);
    const gpa: number | null = gpaOf(row.score);
    const credit: number | undefined = row.credit;
    if (score === null || gpa === null || credit === undefined || credit <= 0) {
      if (noScoreKeys.indexOf(key) < 0) {
        noScoreKeys.push(key);
      }
      continue;
    }
    if (gpa <= 0 && isPublicElective(row)) {
      if (electiveFailedKeys.indexOf(key) < 0) {
        electiveFailedKeys.push(key);
      }
      continue;
    }
    const pos: number = bestKeys.indexOf(key);
    if (pos < 0) {
      bestKeys.push(key);
      bestRows.push(row);
    } else {
      const existingScore: number = scoreOf(bestRows[pos].score) ?? 0;
      if (existingScore < score) {
        bestRows[pos] = row;
      }
    }
  }
  // 按门报数：两遍都排除 best，skipped 再排除 electiveFailed
  let electiveFailed: number = 0;
  for (let i = 0; i < electiveFailedKeys.length; i++) {
    if (bestKeys.indexOf(electiveFailedKeys[i]) < 0) {
      electiveFailed++;
    }
  }
  let skipped: number = 0;
  for (let i = 0; i < noScoreKeys.length; i++) {
    const k: string = noScoreKeys[i];
    if (bestKeys.indexOf(k) < 0 && electiveFailedKeys.indexOf(k) < 0) {
      skipped++;
    }
  }
  let creditSum: number = 0;
  let scoreSum: number = 0;
  let gpaSum: number = 0;
  let earnedSum: number = 0;
  let count: number = 0;
  for (let i = 0; i < bestRows.length; i++) {
    const row: ScoreEntry = bestRows[i];
    const credit: number | undefined = row.credit;
    const score: number | null = scoreOf(row.score);
    const gpa: number | null = gpaOf(row.score);
    if (credit === undefined || score === null || gpa === null) {
      continue;
    }
    creditSum += credit;
    scoreSum += score * credit;
    gpaSum += gpa * credit;
    if (score >= 60) {
      earnedSum += credit;
    }
    count++;
  }
  if (creditSum <= 0) {
    return {
      courseCount: 0, totalCredit: 0, weightedScore: null, weightedGpa: null,
      skipped: skipped, electiveFailed: electiveFailed, earnedCredit: 0
    };
  }
  return {
    courseCount: count,
    totalCredit: creditSum,
    weightedScore: scoreSum / creditSum,
    weightedGpa: gpaSum / creditSum,
    skipped: skipped,
    electiveFailed: electiveFailed,
    earnedCredit: earnedSum
  };
}
