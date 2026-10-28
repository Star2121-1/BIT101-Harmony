/**
 * 成绩的**学分与分档**统计（纯函数，零依赖）。
 *
 * ## 与 `ScoreFlowLogic` 的分工（避免写两遍）
 *  - `ScoreFlowLogic` 已有：`groupByTerm`（学期新→旧、组内保序）、`termLabel`、`summarize`
 *    （门数/已出分/待出分/学期数）、`summaryLine`。**这里一律复用**，不重新实现。
 *  - 本文件只补它没有的：**学分合计**（新增 `credit` 列）、**分数分档**。
 *
 * ## 能算的与**故意不算**（写在最前面）
 *  - 算：学分合计、按学期学分、数字分数分档。
 *  - **不算 GPA / 加权绩点**：绩点换算表（90→4.0 还是 4.3、五级制怎么折）各院系不同，
 *    原始表里也没有绩点列。没有数据源就不造数字 —— 用户看到 3.8 会当真。
 *  - **不算及格率**：等级制（优秀/合格/通过）、缓考、重修标记会让「<60 = 挂科」变成假结论。
 *  - 等级制分数（优秀/合格）**不进数字分档**，单独计数：不把「优秀」当 95。
 *  - 学分不全时 `creditPartial = true`，UI 只能写「≥ 96」——不许假装精确。
 */

import { groupByTerm } from './ScoreFlowLogic.ts';
import type { ScoreEntry } from './ScoreLogic.ts';

/** 分数区间（只用于展示分布，不用于判断是否及格）。 */
export enum ScoreBucket {
  High = '90-100',
  Good = '80-89',
  Mid = '70-79',
  Low = '60-69',
  Under60 = '<60',
}

/** 一个分档的计数。 */
export interface BucketCount {
  bucket: ScoreBucket;
  count: number;
}

/** 一个学期的学分小计。 */
export interface TermCredit {
  term: string;
  creditSum: number;
  /** 该学期有课缺学分 ⇒ 小计是下界。 */
  partial: boolean;
}

/** 学分汇总。 */
export interface CreditSummary {
  /** 学分合计（只累加有 credit 的课）。 */
  creditSum: number;
  /** 有课程缺学分 ⇒ 合计是下界。 */
  partial: boolean;
  /** 有学分的门数。 */
  credited: number;
  /** 按学期（新→旧，复用 ScoreFlowLogic.groupByTerm 的顺序）。 */
  terms: TermCredit[];
}

/**
 * 分数原文 → 数字（0~100）。只接受**整串都是数字**（允许小数）。
 * 「90分」「优秀」「A」「缓考」一律 null —— 不做模糊猜测。
 */
export function parseScoreNum(score: string | null): number | null {
  if (score === null) {
    return null;
  }
  const s: string = score.trim();
  if (s.length === 0) {
    return null;
  }
  for (let i = 0; i < s.length; i++) {
    const c: string = s.charAt(i);
    const isDigit: boolean = c >= '0' && c <= '9';
    if (!isDigit && c !== '.') {
      return null;
    }
  }
  const n: number = Number(s);
  if (!Number.isFinite(n) || n < 0 || n > 100) {
    return null;
  }
  return n;
}

/** 数字分数 → 分档；null 表示不进分档。 */
export function bucketOf(score: string | null): ScoreBucket | null {
  const n: number | null = parseScoreNum(score);
  if (n === null) {
    return null;
  }
  if (n >= 90) {
    return ScoreBucket.High;
  }
  if (n >= 80) {
    return ScoreBucket.Good;
  }
  if (n >= 70) {
    return ScoreBucket.Mid;
  }
  if (n >= 60) {
    return ScoreBucket.Low;
  }
  return ScoreBucket.Under60;
}

/** 分档中文名（UI 与无障碍共用）。 */
export function bucketLabel(b: ScoreBucket): string {
  if (b === ScoreBucket.High) {
    return '90 分以上';
  }
  if (b === ScoreBucket.Good) {
    return '80–89';
  }
  if (b === ScoreBucket.Mid) {
    return '70–79';
  }
  if (b === ScoreBucket.Low) {
    return '60–69';
  }
  return '60 以下';
}

/** 学分显示：整数不带小数点，小数最多两位。 */
export function formatCredit(n: number): string {
  if (!Number.isFinite(n) || n <= 0) {
    return '0';
  }
  const rounded: number = Math.round(n * 100) / 100;
  if (Math.abs(rounded - Math.round(rounded)) < 1e-9) {
    return String(Math.round(rounded));
  }
  return String(rounded);
}

/** 学分汇总（含按学期）；顺序与 `groupByTerm` 一致，便于页面并排渲染。 */
export function creditSummary(entries: ScoreEntry[]): CreditSummary {
  let sum: number = 0;
  let partial: boolean = false;
  let credited: number = 0;
  for (let i = 0; i < entries.length; i++) {
    const c: number | undefined = entries[i].credit;
    if (c !== undefined && c > 0) {
      sum += c;
      credited += 1;
    } else {
      partial = true;
    }
  }
  const terms: TermCredit[] = [];
  const groups = groupByTerm(entries);
  for (let g = 0; g < groups.length; g++) {
    let s: number = 0;
    let p: boolean = false;
    const list: ScoreEntry[] = groups[g].entries;
    for (let i = 0; i < list.length; i++) {
      const c: number | undefined = list[i].credit;
      if (c !== undefined && c > 0) {
        s += c;
      } else {
        p = true;
      }
    }
    terms.push({ term: groups[g].term, creditSum: s, partial: p });
  }
  return { creditSum: sum, partial: partial, credited: credited, terms: terms };
}

/** 分档计数（只含有命中的档；空表返回空数组）。 */
export function buckets(entries: ScoreEntry[]): BucketCount[] {
  const counts: Map<ScoreBucket, number> = new Map<ScoreBucket, number>();
  for (let i = 0; i < entries.length; i++) {
    const b: ScoreBucket | null = bucketOf(entries[i].score);
    if (b === null) {
      continue;
    }
    const prev: number | undefined = counts.get(b);
    counts.set(b, prev === undefined ? 1 : prev + 1);
  }
  const order: ScoreBucket[] = [ScoreBucket.High, ScoreBucket.Good, ScoreBucket.Mid, ScoreBucket.Low, ScoreBucket.Under60];
  const out: BucketCount[] = [];
  for (let i = 0; i < order.length; i++) {
    const c: number | undefined = counts.get(order[i]);
    if (c !== undefined && c > 0) {
      out.push({ bucket: order[i], count: c });
    }
  }
  return out;
}

/** 非数字分数（等级制/未出分）门数。 */
export function nonNumericCount(entries: ScoreEntry[]): number {
  let n: number = 0;
  for (let i = 0; i < entries.length; i++) {
    if (bucketOf(entries[i].score) === null) {
      n += 1;
    }
  }
  return n;
}

/**
 * 学分那一句话：没有学分列 ⇒ 空串（整块不显示，不写「学分 0」骗人）；
 * 有缺学分 ⇒ `学分 ≥ 96.5`；完整 ⇒ `学分 102`。
 */
export function creditLine(c: CreditSummary): string {
  if (c.credited === 0) {
    return '';
  }
  return '学分 ' + (c.partial ? '≥ ' : '') + formatCredit(c.creditSum);
}

/** 分档条的一句话：`90+ 8 · 80-89 12 · …`；没有数字分数 ⇒ 空串。 */
export function bucketLine(list: BucketCount[]): string {
  if (list.length === 0) {
    return '';
  }
  const parts: string[] = [];
  for (let i = 0; i < list.length; i++) {
    parts.push(bucketLabel(list[i].bucket).replace(' 分以上', '+') + ' ' + list[i].count);
  }
  return parts.join(' · ');
}
