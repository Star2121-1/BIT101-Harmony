/**
 * 成绩本地存储的**序列化纯逻辑**（M10-2）。
 *
 * 三样东西要落盘，各有各的纪律：
 *  1. **快照**（`课程|学期 → 分数`）—— 出分提醒的基线。写坏/读坏都必须能被识别，
 *     否则会把历史成绩当「新出分」全报一遍（轰炸）。
 *  2. **成绩列表缓存** —— 成绩页打开时先出缓存，避免每次进页面都走一遍学校 SSO
 *     （那是**真登录**，会撞风控）。所以带 `atMillis` 与 TTL。
 *  3. **最近检查状态** —— 复用 `ScoreCheckLogic.encode/parse`（不在这里重写）。
 *
 * 为什么序列化要单独一层：`data/ScoreStore.ts` 依赖 `Prefs` → `@kit.ArkData`，
 * 裸 Node 下测不了；把「字符串 ↔ 结构」搬到纯模块，就能离线打真函数。
 */

import type { ScoreEntry } from './ScoreLogic.ts';

/** 成绩页缓存的复用窗口：30 分钟内再进页面直接用缓存，不再发起登录。 */
export const SCORE_CACHE_TTL_MS: number = 30 * 60 * 1000;

/** 带时间戳的成绩列表缓存。 */
export interface CachedScores {
  /** 拉取时刻（毫秒）。 */
  atMillis: number;
  /** 解析后的成绩条目。 */
  entries: ScoreEntry[];
}

/** 缓存是否还在窗口内可用。`atMillis <= 0` / 未来时间一律视为过期（时钟被改过也不信）。 */
export function isFresh(c: CachedScores, nowMillis: number, ttlMs: number): boolean {
  if (c.atMillis <= 0) {
    return false;
  }
  const age: number = nowMillis - c.atMillis;
  if (age < 0) {
    return false;
  }
  return age <= ttlMs;
}

/**
 * 编码成绩缓存。字段按顺序写、不含嵌套对象以外的动态键 ——
 * 解码侧只认 `course/score/term` 三个字段，多出来的字段一律丢弃（不猜扩展）。
 */
export function encodeCached(c: CachedScores): string {
  const rows: ScoreEntry[] = [];
  for (let i = 0; i < c.entries.length; i++) {
    const e: ScoreEntry = c.entries[i];
    rows.push({ course: e.course, score: e.score, term: e.term });
  }
  return JSON.stringify({ at: c.atMillis, rows: rows } as CachedScoresJson);
}

/** 解码成绩缓存；形状不对返回 null（不猜）。 */
export function decodeCached(raw: string): CachedScores | null {
  if (raw.length === 0) {
    return null;
  }
  let parsed: Object | null = null;
  try {
    parsed = JSON.parse(raw) as Object;
  } catch (e) {
    return null;
  }
  const root: Record<string, Object> | null = asRec(parsed);
  if (root === null) {
    return null;
  }
  const atVal: Object | undefined = root['at'];
  const at: number = typeof atVal === 'number' ? atVal as number : -1;
  if (!Number.isFinite(at) || at <= 0) {
    return null;
  }
  const rowsVal: Object | undefined = root['rows'];
  if (rowsVal === undefined || rowsVal === null || !Array.isArray(rowsVal)) {
    return null;
  }
  const rawRows: Object[] = rowsVal as Object[];
  const entries: ScoreEntry[] = [];
  for (let i = 0; i < rawRows.length; i++) {
    const rec: Record<string, Object> | null = asRec(rawRows[i]);
    if (rec === null) {
      continue; // 单行坏掉就跳过，不因为一行把整表判死
    }
    const course: string = strOr(rec['course'], '');
    if (course.trim().length === 0) {
      continue;
    }
    const score: string | null = optStr(rec['score']);
    const term: string | null = optStr(rec['term']);
    entries.push({ course: course, score: score, term: term });
  }
  return { atMillis: at, entries: entries };
}

/** 快照编码：`{"课程|学期":"分数"}`（与 Android `score_snapshot.json` 同形状）。 */
export function encodeSnapshot(snapshot: Record<string, string>): string {
  return JSON.stringify(snapshot);
}

/** 快照解码；形状不对返回 null（调用方据此决定「当首次运行、只建基线」）。 */
export function decodeSnapshot(raw: string): Record<string, string> | null {
  if (raw.length === 0) {
    return null;
  }
  let parsed: Object | null = null;
  try {
    parsed = JSON.parse(raw) as Object;
  } catch (e) {
    return null;
  }
  const root: Record<string, Object> | null = asRec(parsed);
  if (root === null) {
    return null;
  }
  const out: Record<string, string> = {};
  const keys: string[] = Object.keys(root);
  for (let i = 0; i < keys.length; i++) {
    const k: string = keys[i];
    const v: Object | undefined = root[k];
    if (typeof v === 'string') {
      out[k] = v as string;
    } else if (typeof v === 'number') {
      out[k] = String(v as number);
    }
    // 其它类型（对象/数组/null）丢掉：快照值只可能是分数原文
  }
  return out;
}

/** 只用于序列化的中间形状（ArkTS 要求显式接口，不能写对象字面量类型）。 */
interface CachedScoresJson {
  at: number;
  rows: ScoreEntry[];
}

function asRec(v: Object | null | undefined): Record<string, Object> | null {
  if (v === null || v === undefined || typeof v !== 'object' || Array.isArray(v)) {
    return null;
  }
  return v as Record<string, Object>;
}

function strOr(v: Object | undefined, fallback: string): string {
  return typeof v === 'string' ? v as string : fallback;
}

function optStr(v: Object | undefined): string | null {
  if (typeof v !== 'string') {
    return null;
  }
  const s: string = (v as string).trim();
  return s.length > 0 ? s : null;
}
