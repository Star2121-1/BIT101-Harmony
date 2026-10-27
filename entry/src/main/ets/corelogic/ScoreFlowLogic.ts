/**
 * 成绩查询的**流程决策 + 展示分组**纯逻辑（M10-2，与 M7-3 取数管道共用）。
 *
 * ## 为什么单独一层
 * 取数管道是「起挑战 → 轮询 → 取数」三步网络流程（`service/ScoreService.ts`），
 * 离线测不了；但**每一步该干什么**是纯判断，可以离线打。所以这里只放：
 *  - 挑战快照的解析（`202 {detail:{…}}` 与轮询顶层两种形状）；
 *  - 「下一步」的单一决策函数 `decide()`（不做 I/O、不 sleep、不重试）；
 *  - 成绩表 → 按学期分组的展示结构。
 *
 * ## 失败分类纪律（照 Android `DefaultScoreRepo` + 本地 ScoreQueryLogic）
 * - `auth_failed`：学校明确拒绝登录（典型=学号密码错）—— **重试无效**，必须让用户改；
 * - `need_sms`：学校要短信二次验证，后台无交互通道 —— 本次放弃，不是「再试一次」；
 * - `expired` / `timeout`：这次没赶上 —— 才值得「稍后重试」；
 * - `failed`：形状不对 / 状态未知 —— 不猜，报失败。
 *
 * 契约来源：`bit-login/docs/rest-api.md`（挑战快照字段）+ Android
 * `ScoreQueryModel/ScoreQueryApiService`（三步路径与头）。
 */

import type { JsonValue } from '../core/model/SchoolModels.ts';
import type { ScoreEntry } from './ScoreLogic.ts';
import { isReady, needsSms, isRejected, isExpired } from './ScoreQueryLogic.ts';

/** 挑战快照（`POST /api/auth/start` 与 `202` 响应、以及轮询响应的并集）。 */
export interface ChallengeSnapshot {
  /** 挑战 id；顶层的轮询响应没有这个字段 ⇒ 空串。 */
  challengeId: string;
  /** 仅创建/`202` 响应带 access_token；轮询不带 ⇒ 空串。 */
  accessToken: string;
  /** running / waiting_captcha / waiting_sms / processing / authenticated / failed / expired / cancelled。 */
  status: string;
  /** 已就绪的服务名（含 'jwb' 才可取数）。 */
  readyServices: string[];
  /** 失败原因原文（仅 failed 时有值）。 */
  error: string;
}

/** 下一步动作（由 `decide()` 唯一给出）。 */
export type ScoreStep = 'fetch' | 'wait' | 'need_sms' | 'auth_failed' | 'expired' | 'failed';

/** 取一个字符串字段（缺失/非字符串 → 空串，不猜）。 */
function strOf(obj: Record<string, JsonValue>, key: string): string {
  const v: JsonValue | undefined = obj[key];
  return typeof v === 'string' ? v : '';
}

/** 取字符串数组字段（缺失/形状不对 → 空数组）。 */
function strArrayOf(obj: Record<string, JsonValue>, key: string): string[] {
  const v: JsonValue | undefined = obj[key];
  if (v === null || v === undefined || !Array.isArray(v)) {
    return [];
  }
  const out: string[] = [];
  for (let i = 0; i < v.length; i++) {
    const one: JsonValue = v[i];
    if (typeof one === 'string') {
      out.push(one);
    }
  }
  return out;
}

function asObject(v: JsonValue | null | undefined): Record<string, JsonValue> | null {
  if (v === null || v === undefined) {
    return null;
  }
  if (typeof v !== 'object' || Array.isArray(v)) {
    return null;
  }
  return v as Record<string, JsonValue>;
}

function snapshotFrom(obj: Record<string, JsonValue>): ChallengeSnapshot {
  return {
    challengeId: strOf(obj, 'challenge_id'),
    accessToken: strOf(obj, 'access_token'),
    status: strOf(obj, 'status'),
    readyServices: strArrayOf(obj, 'ready_services'),
    error: strOf(obj, 'error')
  };
}

/**
 * 解析 `202 Accepted` 的外层包装 `{"detail":{…}}`。
 * 也兼容服务端**直接**给扁平的形状（`{challenge_id:…}`）—— 选它是因为
 * 2026-09-26 Android 侧两种都见过；形状都不对时返回 null（不猜）。
 */
export function parseEnvelope(body: string): ChallengeSnapshot | null {
  const root: Record<string, JsonValue> | null = parseObject(body);
  if (root === null) {
    return null;
  }
  const detail: Record<string, JsonValue> | null = asObject(root['detail']);
  const src: Record<string, JsonValue> = detail !== null ? detail : root;
  const snap: ChallengeSnapshot = snapshotFrom(src);
  // 一个可用快照至少要有 challenge_id 或 status 之一，否则视为形状不对
  if (snap.challengeId.length === 0 && snap.status.length === 0) {
    return null;
  }
  return snap;
}

/** 解析轮询响应（`GET /api/auth/{id}`，字段在**顶层**）。 */
export function parseStatus(body: string): ChallengeSnapshot | null {
  const root: Record<string, JsonValue> | null = parseObject(body);
  if (root === null) {
    return null;
  }
  const snap: ChallengeSnapshot = snapshotFrom(root);
  if (snap.status.length === 0 && snap.readyServices.length === 0) {
    return null;
  }
  return snap;
}

/** 解析取数响应 `{"data":[[…]]}`，返回 data 的二维数组（形状不对 → 空数组）。 */
export function extractScoreTable(body: string): JsonValue | null {
  const root: Record<string, JsonValue> | null = parseObject(body);
  if (root === null) {
    return null;
  }
  const data: JsonValue | undefined = root['data'];
  if (data === undefined || data === null || !Array.isArray(data)) {
    return null;
  }
  return data;
}

function parseObject(body: string): Record<string, JsonValue> | null {
  if (body.length === 0) {
    return null;
  }
  let parsed: JsonValue | null = null;
  try {
    parsed = JSON.parse(body) as JsonValue;
  } catch (e) {
    return null;
  }
  return asObject(parsed);
}

/**
 * 下一步做什么 —— **唯一决策点**。
 *
 * 顺序是有意的（与 Android `DefaultScoreRepo.query()` 的判断顺序一致）：
 * 先看服务是否就绪（就绪就直接取数），再看「要短信 / 被拒 / 过期」这三个终结态，
 * 最后才是「继续等」。把终结态放在 `wait` 前面，才不会白轮询 25 次再报错。
 */
export function decide(snap: ChallengeSnapshot): ScoreStep {
  if (isReady(snap.readyServices)) {
    return 'fetch';
  }
  if (needsSms(snap.status)) {
    return 'need_sms';
  }
  if (isRejected(snap.status)) {
    return 'auth_failed';
  }
  if (isExpired(snap.status)) {
    return 'expired';
  }
  if (snap.status === 'cancelled') {
    return 'failed';
  }
  if (snap.status === 'running' || snap.status === 'processing' ||
    snap.status === 'waiting_captcha' || snap.status === 'authenticated') {
    // ⚠️ waiting_captcha 也归「等」：图形验证码需要交互，后台管道没有通道，
    //    最终由轮询次数用尽落到 timeout —— 这是**已知取舍**，不在这里假装能过。
    return 'wait';
  }
  return 'failed';
}

/** 一个学期的成绩分组（展示用）。 */
export interface ScoreTermGroup {
  /** 学期原文（如 `2025-2026-2`）；`''` = 表里没这一列。 */
  term: string;
  /** 展示名（如 `2025-2026 · 第二学期`）。 */
  label: string;
  entries: ScoreEntry[];
  /** 该学期有分数的门数。 */
  scored: number;
}

/** 学期串 → 展示名。认不出格式就原样返回（不猜）。 */
export function termLabel(term: string): string {
  const t: string = term.trim();
  if (t.length === 0) {
    return '未标注学期';
  }
  // 形状：`YYYY-YYYY-N`；末尾 N=1/2/3
  const parts: string[] = t.split('-');
  if (parts.length === 3) {
    const n: number = Number(parts[2]);
    if (Number.isFinite(n) && n >= 1 && n <= 3) {
      return parts[0] + '-' + parts[1] + ' · 第' + cnNum(n) + '学期';
    }
  }
  return t;
}

function cnNum(n: number): string {
  if (n === 1) {
    return '一';
  }
  if (n === 2) {
    return '二';
  }
  if (n === 3) {
    return '三';
  }
  return String(n);
}

/** 分数是否已出（有非空文本即算；`--` / `-` 这类占位不算）。 */
export function hasScore(e: ScoreEntry): boolean {
  if (e.score === null) {
    return false;
  }
  const s: string = e.score.trim();
  return s.length > 0 && s !== '--' && s !== '-';
}

/**
 * 按学期分组。学期**新→旧**排序（字符串比较即可，`YYYY-YYYY-N` 是定长可比格式），
 * 无学期的分组永远排最后；组内保持表里原顺序（不重排，避免「看起来像排名」）。
 */
export function groupByTerm(entries: ScoreEntry[]): ScoreTermGroup[] {
  const order: string[] = [];
  const buckets: Map<string, ScoreEntry[]> = new Map<string, ScoreEntry[]>();
  for (let i = 0; i < entries.length; i++) {
    const e: ScoreEntry = entries[i];
    const key: string = e.term === null ? '' : e.term.trim();
    if (!buckets.has(key)) {
      buckets.set(key, []);
      order.push(key);
    }
    const list: ScoreEntry[] = buckets.get(key) as ScoreEntry[];
    list.push(e);
  }
  // 排序：非空学期倒序在前，空学期最后
  const named: string[] = [];
  let hasUnknown: boolean = false;
  for (let i = 0; i < order.length; i++) {
    if (order[i].length === 0) {
      hasUnknown = true;
    } else {
      named.push(order[i]);
    }
  }
  named.sort((a: string, b: string) => (a < b ? 1 : (a > b ? -1 : 0)));

  const out: ScoreTermGroup[] = [];
  for (let i = 0; i < named.length; i++) {
    const term: string = named[i];
    const list: ScoreEntry[] = buckets.get(term) as ScoreEntry[];
    let scored: number = 0;
    for (let j = 0; j < list.length; j++) {
      if (hasScore(list[j])) {
        scored++;
      }
    }
    out.push({ term: term, label: termLabel(term), entries: list, scored: scored });
  }
  if (hasUnknown) {
    const list: ScoreEntry[] = buckets.get('') as ScoreEntry[];
    let scored: number = 0;
    for (let j = 0; j < list.length; j++) {
      if (hasScore(list[j])) {
        scored++;
      }
    }
    out.push({ term: '', label: termLabel(''), entries: list, scored: scored });
  }
  return out;
}

/** 全表汇总。 */
export interface ScoreSummary {
  /** 课程总条数。 */
  total: number;
  /** 已出分门数。 */
  scored: number;
  /** 未出分（或分数列为空）门数。 */
  pending: number;
  /** 学期个数（不含「未标注」）。 */
  terms: number;
}

export function summarize(entries: ScoreEntry[]): ScoreSummary {
  let scored: number = 0;
  const termSet: Set<string> = new Set<string>();
  for (let i = 0; i < entries.length; i++) {
    const e: ScoreEntry = entries[i];
    if (hasScore(e)) {
      scored++;
    }
    const t: string = e.term === null ? '' : e.term.trim();
    if (t.length > 0) {
      termSet.add(t);
    }
  }
  return {
    total: entries.length,
    scored: scored,
    pending: entries.length - scored,
    terms: termSet.size
  };
}

/** 页头一行摘要（**不含任何分数**，只讲条数 —— 与通知文案同一条隐私纪律）。 */
export function summaryLine(s: ScoreSummary): string {
  if (s.total === 0) {
    return '还没有成绩数据';
  }
  let t: string = '共 ' + s.total + ' 门 · 已出分 ' + s.scored;
  if (s.pending > 0) {
    t = t + ' · 待出分 ' + s.pending;
  }
  if (s.terms > 0) {
    t = t + ' · ' + s.terms + ' 个学期';
  }
  return t;
}
