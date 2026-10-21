/**
 * 1:1 移植自 Android：data/src/main/java/cn/bit101/android/data/school/LibBorrowLogic.kt（284 行）
 *  + data/school/BorrowRecord.kt
 *
 * 移植日期：2026-10-19（夜间任务 2）
 *
 * 必须一起搬的规则（两条硬判据，别改）：
 * 1. 有数据 = `checkHasData([{...}])`；没有数据 = `checkHasData([])` —— 两者**都有**锚点，
 *    所以「锚点找不到」= 门户改版 ⇒ 必须报失败（null），绝不能当成「0 本」
 * 2. 每个单元格自带字段名（`{"value":...,"key":"应还日"}`）⇒ 按字段名取值，不依赖列顺序
 * - 通知正文**不写书名**（隐私边界，Android 单测锁死：与「出分不含分数」同一条纪律）
 * - key = title|isbn|dueRaw（接口不给 id，只用于「新记录」判定，不当主键）
 * - DUE_SOON_DAYS = 3；daysLeft 按**日期**算（ChronoUnit.DAYS.between 口径）
 * - 响应不是干净 JSON：JSON 套 HTML，HTML 里 <script> 再内嵌 JS 数组字面量
 * - gson 语义保留：成员是 JSON null 时 asString 得 "null" 串 ⇒ str() 把 "null" 当空
 *
 * 时间表示：DateTime = { day: epochDay, minutes }（见 timeutil.ts）。
 */

import { parseDateTime, fmtShowDay, daysBetween, type DateTime } from "./timeutil.ts";
import type { JsonValue } from "../core/model/SchoolModels.ts";

// ── 常量（契约文档 lib-borrow-contract.md 实测值）────────────────────────

export const HOST = "https://mylib.bit.edu.cn";
export const LOGIN_URL = "https://lib.bit.edu.cn/login";
export const PAGE_URL = `${HOST}/page/330841/show`;
export const USER_INFO_URL = `${HOST}/engine2/header/user-info`;
export const APP_ID_CURRENT = "1715437";
export const APP_ID_HISTORY = "1697337";
export const PAGE_ID = "330841";
export const WEBSITE_ID = "162085";
export const WFW_FID = "2398";
export const DUE_SOON_DAYS = 3;

const ARRAY_MARKER = "checkHasData(";

const KEY_TITLE = "题名";
const KEY_AUTHOR = "作者";
const KEY_ISBN = "ISBN";
const KEY_LOCATION = "馆藏地";
const KEY_BORROWED = "借阅日";
const KEY_DUE = "应还日";

// ── 数据模型 ────────────────────────────────────────────────────────────

/** 一条借阅记录（对齐 Kotlin data class BorrowRecord）。 */
export class BorrowRecord {
  title: string;
  author: string;
  isbn: string;
  location: string;
  borrowedAt: DateTime | null;
  dueAt: DateTime | null;
  dueRaw: string;

  constructor(
    title = "",
    author = "",
    isbn = "",
    location = "",
    borrowedAt: DateTime | null = null,
    dueAt: DateTime | null = null,
    dueRaw = "",
  ) {
    this.title = title;
    this.author = author;
    this.isbn = isbn;
    this.location = location;
    this.borrowedAt = borrowedAt;
    this.dueAt = dueAt;
    this.dueRaw = dueRaw;
  }

  /** 稳定键：书名 + ISBN + 应还日（接口不给 id）。 */
  get key(): string {
    return `${this.title}|${this.isbn}|${this.dueRaw}`;
  }
}

// ── URL ────────────────────────────────────────────────────────────────

/** 数据接口。sversion 由 parseSversion 从页面取（门户用它做缓存失效）。 */
export function dataUrl(appId: string, sversion: string): string {
  return (
    `${HOST}/application/${appId}/data` +
    `?sversion=${sversion}&mobile=1&wfwfid=${WFW_FID}&websiteId=${WEBSITE_ID}&pageId=${PAGE_ID}`
  );
}

// ── 会话与页面 ──────────────────────────────────────────────────────────

/** 判定是否已登录。返回 null = 响应无法判定（别猜）。 */
export function isLoggedIn(body: string): boolean | null {
  const root = parseObj(body);
  if (root === null) return null;
  const data = obj(root, "data");
  if (data === null) return null;
  // uid 缺失（undefined）或为 null 都算未登录；空串也是未登录
  const uid = data["uid"];
  if (uid === undefined || uid === null) return false;
  return strOf(uid).trim().length > 0;
}

/** 从页面 HTML 里抠 `var sversion = '...'`。 */
export function parseSversion(html: string): string | null {
  const m = /\bvar\s+sversion\s*=\s*'([^']+)'/.exec(html);
  const v = m ? m[1] : null;
  return v !== null && v.trim().length > 0 ? v : null;
}

// ── 借阅记录解析 ────────────────────────────────────────────────────────

/**
 * 解析 /application/<appId>/data 的响应体。
 * @return 记录列表（空列表 = 服务端明确说没有）；null = 解析失败
 *         （不是 JSON / code≠1 / 没有 div / 找不到锚点 ⇒ 门户改版）。
 */
export function parseRecords(body: string): BorrowRecord[] | null {
  const root = parseObj(body);
  if (root === null) return null;
  if (strOf(root["code"]) !== "1") return null;
  const data = obj(root, "data");
  if (data === null) return null;
  const div = strOf(data["div"]);
  if (div.length === 0) return null;

  const array = extractEmbeddedArray(div);
  if (array === null) return null;
  const out: BorrowRecord[] = [];
  for (const element of array) {
    const row = asObject(element);
    if (row !== null) out.push(toRecord(row));
  }
  return out;
}

/**
 * 把内嵌在 checkHasData( ... ) 里的数组抠出来。
 * null = 锚点都没有（门户改版）；空数组 = 锚点在、确实是 []。两者语义不同，别合并。
 */
function extractEmbeddedArray(div: string): JsonValue[] | null {
  const marker = div.indexOf(ARRAY_MARKER);
  if (marker < 0) return null;
  const start = div.indexOf("[", marker);
  if (start < 0) return null;
  const end = matchBracket(div, start);
  if (end === null) return null;
  try {
    const parsed = JSON.parse(div.substring(start, end + 1)) as JsonValue[];
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** 从 start（必须是 [）出发，返回配对的 ] 下标；兼顾字符串与转义。 */
function matchBracket(s: string, start: number): number | null {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "[") depth++;
    else if (c === "]") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return null;
}

/** 一行 → BorrowRecord。按字段名取值，取不到的字段留空、不丢整条。 */
function toRecord(row: Record<string, JsonValue>): BorrowRecord {
  const cells = new Map<string, string>();
  const keys: string[] = Object.keys(row);
  for (const k of keys) {
    const cell = asObject(row[k]);
    if (cell === null) continue;
    const key = strOf(cell["key"]);
    if (key.length > 0) cells.set(key, strOf(cell["value"]));
  }
  const dueRaw = cells.get(KEY_DUE) ?? "";
  return new BorrowRecord(
    cells.get(KEY_TITLE) ?? "",
    cells.get(KEY_AUTHOR) ?? "",
    cells.get(KEY_ISBN) ?? "",
    cells.get(KEY_LOCATION) ?? "",
    parseTime(cells.get(KEY_BORROWED)),
    parseTime(dueRaw),
    dueRaw,
  );
}

/** "yyyy-MM-dd HH:mm:ss"；退一步接受纯日期。解析不出返回 null。 */
export function parseTime(raw: string | null | undefined): DateTime | null {
  const text = (raw ?? "").trim();
  if (text.length === 0) return null;
  const dt = parseDateTime(text);
  if (dt !== null) return dt;
  // 纯日期 → 当天 00:00（Kotlin: LocalDate.parse(...).atStartOfDay()）
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (m) {
    const d = parseDateTime(`${m[1]}-${m[2]}-${m[3]}T00:00`);
    if (d !== null) return d;
  }
  return null;
}

// ── 到期判定（提醒的核心）──────────────────────────────────────────────

/** 距应还日还有几天（按日期算，负数 = 已逾期；无应还日返回 null）。 */
export function daysLeft(record: BorrowRecord, now: DateTime): number | null {
  return record.dueAt === null ? null : daysBetween(now.day, record.dueAt.day);
}

/** 需要提醒的：已逾期 或 距到期不超过 soonDays 天。按应还时间升序（最急在前）。 */
export function alertRecords(
  records: BorrowRecord[],
  now: DateTime,
  soonDays: number = DUE_SOON_DAYS,
): BorrowRecord[] {
  return records
    .filter((r) => {
      const left = daysLeft(r, now);
      if (left === null) return false;
      return left <= soonDays;
    })
    .sort((a, b) => {
      const da = a.dueAt;
      const db = b.dueAt;
      if (da === null && db === null) return 0;
      if (da === null) return 1;
      if (db === null) return -1;
      return da.day - db.day || da.minutes - db.minutes;
    });
}

/** 一条记录的状态文案。 */
export function statusText(record: BorrowRecord, now: DateTime): string {
  const left = daysLeft(record, now);
  if (left === null) return record.dueRaw;
  if (left < 0) return `已逾期 ${-left} 天`;
  if (left === 0) return "今天到期";
  if (left === 1) return "明天到期";
  return `${left} 天后到期`;
}

/** 应还日的展示文本（解析不出就退回原文）。 */
export function dueText(record: BorrowRecord): string {
  return record.dueAt === null ? record.dueRaw : fmtShowDay(record.dueAt);
}

// ── 文案 ────────────────────────────────────────────────────────────────

/** 卡片副标题：借阅总览。 */
export function cardSummary(records: BorrowRecord[], now: DateTime): string {
  if (records.length === 0) return "当前没有在借的书";
  const alerts = alertRecords(records, now);
  const overdue = alerts.filter((r) => (daysLeft(r, now) ?? 0) < 0).length;
  if (overdue > 0) return `有 ${overdue} 本已逾期，尽快归还`;
  if (alerts.length > 0) return `有 ${alerts.length} 本快到应还日`;
  return `共 ${records.length} 本，暂未临近应还`;
}

/**
 * 通知正文。
 * ⚠️ 不写书名 —— 隐私边界（通知会在锁屏上显示，书目比分数更私人）。
 */
export function noticeBody(alerts: BorrowRecord[], now: DateTime): string {
  if (alerts.length === 0) return "";
  const overdue = alerts.filter((r) => (daysLeft(r, now) ?? 0) < 0);
  const soon = alerts.filter((r) => (daysLeft(r, now) ?? 0) >= 0);
  const parts: string[] = [];
  if (overdue.length > 0) parts.push(`有 ${overdue.length} 本已逾期，请尽快归还`);
  if (soon.length > 0) {
    const earliest = soon[0];
    parts.push(`有 ${soon.length} 本将在 ${DUE_SOON_DAYS} 天内到期，最早 ${dueText(earliest)} 应还`);
  }
  return parts.join("；");
}

/** 通知标题。 */
export function noticeTitle(alerts: BorrowRecord[], now: DateTime): string {
  return alerts.some((r) => (daysLeft(r, now) ?? 0) < 0) ? "图书馆借阅已逾期" : "图书馆借阅即将到期";
}

// ── gson 语义小工具 ─────────────────────────────────────────────────────

/** JSON null / 非对象 / 空对象 → null（对齐 asJsonObjectOrNull：size>0 才算）。
 *  窄化顺序照 SchoolModels.objOf（项目里唯一编译得过的写法）。 */
function asObject(v: JsonValue | undefined): Record<string, JsonValue> | null {
  if (v === undefined || v === null || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, JsonValue>;
  return Object.keys(o).length > 0 ? o : null;
}

/** 取子对象；不是对象（含 JSON null）返回 null。 */
function obj(root: Record<string, JsonValue>, name: string): Record<string, JsonValue> | null {
  return asObject(root[name]);
}

function parseObj(body: string): Record<string, JsonValue> | null {
  try {
    const v = JSON.parse(body) as JsonValue;
    return asObject(v);
  } catch {
    return null;
  }
}

/** 对齐 gson str()：primitive → 字符串；**字符串 "null" 当空**（接口把没有返回成 "null"）。 */
function strOf(v: JsonValue | undefined): string {
  if (v === undefined || v === null) return "";
  if (typeof v === "string") return v === "null" ? "" : v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
}
