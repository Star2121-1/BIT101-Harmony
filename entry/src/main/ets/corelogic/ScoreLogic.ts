/**
 * 成绩表的**纯逻辑**（M7-3 出分提醒 + M10-2 成绩查询共用）：解析 + 差分 + 文案。
 *
 * 1:1 移植自 Android `data/school/ScoreLogic.kt`（220 行测试）。
 *
 * ## 数据形状
 * 入参是**认证主机**异步挑战流程返回的 `data`，二维数组、第 0 行表头：
 * `["课程名称","课程编号","成绩","学期",…] , ["高等数学","MA10001","92",…] , …]`。
 * ⚠️ 旧的 `GET /scores`（业务主机）已恒 404，别按旧形状改。
 *
 * ## 为什么保持防御式（三选一，宁漏不炸）
 * 1. **绝不猜列含义** —— 找不到表头 / 课程列就返回空；
 * 2. 解析失败也返回空 —— 成绩是「尽力而为」，崩或误报都不可接受；
 * 3. **文案里绝不出现分数**（用户明确定的隐私边界）。
 *
 * 数据源 / 表头一变，这里会**安静返回空**（而不是误报「新出分」）—— 刻意取舍。
 */

import type { JsonValue } from '../core/model/SchoolModels.ts';

/** 一门课的成绩。 */
export interface ScoreEntry {
  /** 课程名（快照去重键之一）。 */
  course: string;
  /** 分数原文；解析不出列时为 null。 */
  score: string | null;
  /** 学期（如 2025-2026-2）；表头没有该列时为 null。 */
  term: string | null;
  /**
   * 学分（表里有「学分」列且能解析成数字时才有；否则 undefined）。
   * ⚠️ **不进 `scoreKey`**：改学分不该触发「新出分」提醒。
   */
  credit?: number;
}

/**
 * 快照去重键：课程 + 学期（分数**不在键里** —— 改分不重新提醒，避免刷屏）。
 * 对应 Android `ScoreEntry.key`。
 */
export function scoreKey(e: ScoreEntry): string {
  return e.course.trim() + '|' + (e.term === null ? '' : e.term.trim());
}

/** 按优先级找列用的关键词（与 Android 完全一致，顺序敏感）。 */
const COURSE_KEYWORDS: string[] = ['课程名', '课程'];
const COURSE_EXCLUDE: string[] = ['编号', '代码', '号'];
const SCORE_KEYWORDS: string[] = ['成绩', '分数', '总评', '得分'];
const TERM_KEYWORDS: string[] = ['学期', '学年'];
/** 学分列（真实表头里有「学分」；取不到就不给学分统计，不猜）。 */
const CREDIT_KEYWORDS: string[] = ['学分'];

/** 一个单元格取成字符串（primitive → 串；对象/数组/null → 空）。 */
function cellToString(v: JsonValue | undefined): string {
  if (v === undefined || v === null) {
    return '';
  }
  if (typeof v === 'string') {
    return v;
  }
  if (typeof v === 'number' || typeof v === 'boolean') {
    return String(v);
  }
  return ''; // 对象 / 数组不是合法单元格
}

/**
 * 行 → 单元格数组（两种形状，与 Android rowsOf 一致）：
 * - 每行是数组：取其中的 primitive（string/number/boolean）；
 * - 每行是字符串：按空白切列。
 */
function rowToCells(row: JsonValue | undefined): string[] {
  if (row === undefined || row === null) {
    return [];
  }
  if (Array.isArray(row)) {
    const out: string[] = [];
    for (let i = 0; i < row.length; i++) {
      const c: JsonValue | undefined = row[i];
      if (c === null || c === undefined || typeof c === 'object') {
        out.push('');
      } else {
        out.push(cellToString(c));
      }
    }
    return out;
  }
  if (typeof row === 'string') {
    // 含空格的课程名会被切开 —— 但错误方向是安全的（列错位 → 表头对不上 → 返回空）
    const parts: string[] = row.trim().split(/\s+/);
    return parts;
  }
  return [];
}

function isHeaderCell(cell: string): boolean {
  const all: string[] = COURSE_KEYWORDS.concat(SCORE_KEYWORDS).concat(TERM_KEYWORDS);
  for (let i = 0; i < all.length; i++) {
    if (cell.indexOf(all[i]) >= 0) {
      return true;
    }
  }
  return false;
}

/**
 * 按**关键词优先级**找列（与 Android findColumn 一致）。
 *
 * ⚠️ 真实表头（2026-09-26 实测）是
 * `['序号','开课学期','课程编号','课程名称','成绩','成绩标识',…]`——
 * 直接 `contains('课程')` 取第一个会命中**课程编号**（拿到 09000410 当课名）。
 * 所以先试「课程名」，再退回「课程」并排除 编号/代码/号。
 */
function findColumn(header: string[], keywords: string[], exclude: string[]): number {
  for (let k = 0; k < keywords.length; k++) {
    const kw: string = keywords[k];
    for (let i = 0; i < header.length; i++) {
      const cell: string = header[i];
      if (cell.indexOf(kw) < 0) {
        continue;
      }
      let bad: boolean = false;
      for (let e = 0; e < exclude.length; e++) {
        if (cell.indexOf(exclude[e]) >= 0) {
          bad = true;
          break;
        }
      }
      if (!bad) {
        return i;
      }
    }
  }
  return -1;
}

/**
 * 解析成绩表。无法确定表头 / 课程列时返回**空列表**（不猜）。
 * @param data 异步挑战返回的 `data`（期望是二维数组；其它一律返回空）
 */
export function parseTable(data: JsonValue | null): ScoreEntry[] {
  if (data === null || !Array.isArray(data)) {
    return [];
  }
  const rows: JsonValue[] = data;
  if (rows.length === 0) {
    return [];
  }
  const all: string[][] = [];
  for (let i = 0; i < rows.length; i++) {
    all.push(rowToCells(rows[i]));
  }

  // 表头行：第一个含任一关键词的行。找不到就不猜 —— 返回空。
  let headerIndex: number = -1;
  for (let i = 0; i < all.length; i++) {
    let hit: boolean = false;
    for (let j = 0; j < all[i].length; j++) {
      if (isHeaderCell(all[i][j])) {
        hit = true;
        break;
      }
    }
    if (hit) {
      headerIndex = i;
      break;
    }
  }
  if (headerIndex < 0) {
    return [];
  }
  const header: string[] = all[headerIndex];
  const courseCol: number = findColumn(header, COURSE_KEYWORDS, COURSE_EXCLUDE);
  if (courseCol < 0) {
    return [];
  }
  const scoreCol: number = findColumn(header, SCORE_KEYWORDS, []);
  const termCol: number = findColumn(header, TERM_KEYWORDS, []);
  const creditCol: number = findColumn(header, CREDIT_KEYWORDS, []);

  const out: ScoreEntry[] = [];
  for (let i = headerIndex + 1; i < all.length; i++) {
    const row: string[] = all[i];
    const course: string = (courseCol < row.length ? row[courseCol] : '').trim();
    if (course.length === 0) {
      continue; // 课名为空的行跳过
    }
    const score: string | null = scoreCol >= 0 && scoreCol < row.length ? (row[scoreCol].trim().length > 0 ? row[scoreCol].trim() : null) : null;
    const term: string | null = termCol >= 0 && termCol < row.length ? (row[termCol].trim().length > 0 ? row[termCol].trim() : null) : null;
    // 学分：只有解析成有限正数才带上（「3.0」→ 3；「免修」之类原文不动，给 undefined）
    const creditRaw: string = creditCol >= 0 && creditCol < row.length ? row[creditCol].trim() : '';
    if (creditRaw.length > 0) {
      const n: number = Number(creditRaw);
      if (Number.isFinite(n) && n > 0) {
        out.push({ course: course, score: score, term: term, credit: n });
        continue;
      }
    }
    out.push({ course: course, score: score, term: term });
  }
  return out;
}

/**
 * 与快照差分，找出**新出分**的课程（1:1 Android diff）。
 * - 首次运行（snapshot = null）→ **只建基线不提醒**（否则第一次打开把历史全报一遍 = 轰炸）；
 * - 只认「快照里没有的键」；改分（键已存在）不提醒 —— 改分通知要展示分数差才有意义，
 *   那会突破「不显示分数」的隐私边界。
 * @returns 需提醒的新成绩；无新成绩或首次建基线时返回空。
 */
export function diff(snapshot: Record<string, string> | null, entries: ScoreEntry[]): ScoreEntry[] {
  if (entries.length === 0) {
    return [];
  }
  if (snapshot === null) {
    return []; // 首次运行：只建基线
  }
  const out: ScoreEntry[] = [];
  for (let i = 0; i < entries.length; i++) {
    const e: ScoreEntry = entries[i];
    if (Object.prototype.hasOwnProperty.call(snapshot, scoreKey(e))) {
      continue; // 已知键（含改分）不报
    }
    out.push(e);
  }
  return out;
}

/** 快照序列化：`{"课程|学期": "分数"}`（分数只存本地，不上通知）。 */
export function snapshotOf(entries: ScoreEntry[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < entries.length; i++) {
    const e: ScoreEntry = entries[i];
    out[scoreKey(e)] = e.score === null ? '' : e.score;
  }
  return out;
}

/**
 * 通知正文。⚠️ **绝不包含分数**（用户明确定的隐私边界，单测锁死）。
 * - 一门：`「操作系统」成绩已发布`
 * - 多门：`操作系统、数据结构 等 3 门课成绩已发布`（最多列 3 个课名）
 */
export function summaryText(newEntries: ScoreEntry[]): string {
  const names: string[] = [];
  const seen: Set<string> = new Set<string>();
  for (let i = 0; i < newEntries.length; i++) {
    const n: string = newEntries[i].course;
    if (n.trim().length === 0 || seen.has(n)) {
      continue;
    }
    seen.add(n);
    names.push(n);
  }
  if (names.length === 0) {
    return '';
  }
  if (names.length === 1) {
    return '「' + names[0] + '」成绩已发布';
  }
  const head: string[] = names.slice(0, 3);
  return head.join('、') + ' 等 ' + names.length + ' 门课成绩已发布';
}
