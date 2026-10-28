/**
 * 通知**免打扰时段**的纯逻辑（M12-2，不碰 SDK / Prefs，单测直接打）。
 *
 * ## 语义定死（每一条都能被证伪）
 *  - 窗口用「当天分钟」（0..1439）表示，`start > end` 表示**跨零点**（23:00→07:00）；
 *  - `start === end` ⇒ 窗口长度为 0 ⇒ **不静默**（不是「全天」）。
 *    用户手滑把两端拖到同一格时，绝不能变成「所有提醒消失」。
 *  - 静默期内的提醒**不丢弃，而是推到窗口结束那一刻**（`shiftOutOfQuiet`）。
 *    半夜的 DDL 提醒延迟到早上 7 点仍有意义；直接丢就真没了。
 *  - 推出窗口后若**已过事件本身的时间**，调用方应丢弃（本模块提供 `dropIfAfter`，
 *    但判断权留给排期器——它才知道「这件事几点发生」）。
 *
 * ## 为什么纯逻辑要单独一层
 * 时间窗口判断是典型的「边界一错就全错」：23:59 / 00:00 / 窗口首尾点归谁，
 * 在真机上几乎无法穷举，只能靠单测把 24×24 边界全钉住。
 */

import { type AgentReminderSpec } from './NotifyScheduleLogic.ts';

export const MINUTES_PER_DAY: number = 1440;

/** 免打扰设置（存 Prefs，字段与 UI 一一对应）。 */
export interface QuietHours {
  enabled: boolean;
  /** 开始（当天分钟，0..1439）。 */
  startMinute: number;
  /** 结束（当天分钟，0..1439）。跨零点时 start > end。 */
  endMinute: number;
}

/** 默认：关。不替用户做「半夜别吵我」的决定。 */
export const DEFAULT_QUIET_HOURS: QuietHours = {
  enabled: false,
  startMinute: 23 * 60,
  endMinute: 7 * 60
};

/** 常用预设（UI 三选一，也给用户少点几下）。 */
export interface QuietPreset {
  label: string;
  startMinute: number;
  endMinute: number;
}

export const QUIET_PRESETS: QuietPreset[] = [
  { label: '23:00 – 07:00', startMinute: 23 * 60, endMinute: 7 * 60 },
  { label: '22:00 – 08:00', startMinute: 22 * 60, endMinute: 8 * 60 },
  { label: '00:00 – 06:00', startMinute: 0, endMinute: 6 * 60 }
];

/** 分钟数钳到 [0, 1439]；NaN 回落到 fallback。 */
export function clampMinute(v: number, fallback: number): number {
  if (!Number.isFinite(v)) {
    return fallback;
  }
  const m: number = Math.floor(v);
  if (m < 0) {
    return 0;
  }
  if (m >= MINUTES_PER_DAY) {
    return MINUTES_PER_DAY - 1;
  }
  return m;
}

/** 分钟数 → `HH:mm`。 */
export function minuteText(m: number): string {
  const v: number = clampMinute(m, 0);
  const h: number = Math.floor(v / 60);
  const mm: number = v % 60;
  return (h < 10 ? '0' + h : String(h)) + ':' + (mm < 10 ? '0' + mm : String(mm));
}

/** `HH:mm` / `H:m` → 分钟数；解析不出返回 fallback（不抛错）。 */
export function parseMinute(text: string, fallback: number): number {
  const s: string = text.trim();
  const i: number = s.indexOf(':');
  if (i <= 0) {
    return fallback;
  }
  const h: number = Number(s.substring(0, i));
  const m: number = Number(s.substring(i + 1));
  if (!Number.isFinite(h) || !Number.isFinite(m)) {
    return fallback;
  }
  if (h < 0 || h > 23 || m < 0 || m > 59) {
    return fallback;
  }
  return Math.floor(h) * 60 + Math.floor(m);
}

/**
 * 窗口是否**有实际长度**（跨零点也算有长度；相等则无）。
 *
 * ⚠️ 必须先挡 NaN：`NaN !== NaN` 恒为 true，只用「起止不等」判会得到
 * 「窗口有效、且按跨零点算」⇒ 午夜后整天静默，所有提醒消失。单测钉死。
 */
export function windowValid(q: QuietHours): boolean {
  if (!Number.isFinite(q.startMinute) || !Number.isFinite(q.endMinute)) {
    return false;
  }
  return clampMinute(q.startMinute, 0) !== clampMinute(q.endMinute, 0);
}

/** 该时刻是否落在静默窗口内（`minute` 为当天分钟）。 */
export function inQuiet(minute: number, q: QuietHours): boolean {
  if (!q.enabled || !windowValid(q)) {
    return false;
  }
  // 越界/脏值一律当「不在窗口内」：静默是"别吵"，不能因为算错就吞掉提醒
  if (!Number.isFinite(minute)) {
    return false;
  }
  const m: number = Math.floor(minute);
  if (m < 0 || m >= MINUTES_PER_DAY) {
    return false;
  }
  const s: number = clampMinute(q.startMinute, 0);
  const e: number = clampMinute(q.endMinute, 0);
  if (s < e) {
    // 同日窗口 [s, e)：结束点**不属于**窗口（07:00 该响了）
    return m >= s && m < e;
  }
  // 跨零点：[s, 1440) ∪ [0, e)
  return m >= s || m < e;
}

/** 窗口结束的当天分钟（把提醒推到这一刻）。窗口非法时返回 -1。 */
export function windowEndMinute(q: QuietHours): number {
  if (!windowValid(q)) {
    return -1;
  }
  return clampMinute(q.endMinute, 0);
}

/** 调整结果：`changed=false` 表示不静默、原样。`ts` 是毫秒时间戳。 */
export interface QuietShift {
  ts: number;
  changed: boolean;
}

/**
 * 若 `ts` 落在静默窗口，推到**窗口结束那一刻**；否则原样返回。
 *
 * 跨零点的窗口：若当前在 `[start, 24:00)` 段，推到**次日**的 end；
 * 若在 `[00:00, end)` 段，推到**当天**的 end。
 */
export function shiftOutOfQuiet(ts: number, q: QuietHours): QuietShift {
  if (!q.enabled || !windowValid(q) || !Number.isFinite(ts)) {
    return { ts: ts, changed: false };
  }
  const d: Date = new Date(ts);
  const minute: number = d.getHours() * 60 + d.getMinutes();
  if (!inQuiet(minute, q)) {
    return { ts: ts, changed: false };
  }
  const end: number = windowEndMinute(q);
  const s: number = clampMinute(q.startMinute, 0);
  const crossNight: boolean = s > end;
  // 落在 [start, 24:00) 且跨零点 ⇒ 结束在明天；其余结束在今天
  const addDay: number = crossNight && minute >= s ? 1 : 0;
  // ⚠️ 秒/毫秒归零：提醒按分钟粒度，「07:00:37」会让用户觉得随机
  const target: Date = new Date(d.getFullYear(), d.getMonth(), d.getDate() + addDay, 0, end, 0, 0);
  const to: number = target.getTime();
  if (to <= ts) {
    // 理论上不该发生（窗口有长度、结束必然在起点之后）；保险起见不动
    return { ts: ts, changed: false };
  }
  return { ts: to, changed: true };
}

/**
 * 批量把 spec 推出静默窗口。
 *
 * 返回新的 spec 数组（**不修改入参**）、被推迟的条数与**被丢弃**的条数。
 * 推迟后**日期可能跨天**，所以年月日时分全部重算。
 *
 * ## ⚠️ 为什么会「丢弃」而不是全部推迟
 * 「还有 10 分钟上课」推到第二天早上 7 点送达，比不发更糟——它是**假信息**。
 * 所以给每类提醒一个「推迟预算」（`QuietBudget`）：推迟后超过预算的，
 * 说明这件事已经发生了，直接不排。调用方从提醒设置里算预算传进来。
 */
export interface QuietApplyResult {
  specs: AgentReminderSpec[];
  delayed: number;
  dropped: number;
}

/** 各类提醒能接受的最大推迟分钟数；负值 = 不限（事件尚未到点，晚点提醒仍成立）。 */
export interface QuietBudget {
  classMax: number;
  examMax: number;
  seatMax: number;
  ddlMax: number;
  otherMax: number;
}

/** 默认预算：所有类型都不接受推迟（最保守，调用方没给预算时的行为）。 */
export const NO_DELAY_BUDGET: QuietBudget = {
  classMax: 0, examMax: 0, seatMax: 0, ddlMax: 0, otherMax: 0
};

/** 从 kind 取预算；未知类型用 otherMax。 */
export function budgetFor(kind: string, b: QuietBudget): number {
  if (kind === 'CLASS') {
    return b.classMax;
  }
  if (kind === 'EXAM') {
    return b.examMax;
  }
  if (kind === 'SEAT_SIGN_IN') {
    return b.seatMax;
  }
  if (kind === 'DDL') {
    return b.ddlMax;
  }
  return b.otherMax;
}

export function applyQuiet(
  specs: AgentReminderSpec[],
  q: QuietHours,
  budget: QuietBudget = NO_DELAY_BUDGET
): QuietApplyResult {
  if (!q.enabled || !windowValid(q)) {
    return { specs: specs, delayed: 0, dropped: 0 };
  }
  const out: AgentReminderSpec[] = [];
  let delayed: number = 0;
  let dropped: number = 0;
  for (let i = 0; i < specs.length; i++) {
    const s: AgentReminderSpec = specs[i];
    const ts: number = new Date(s.year, s.month - 1, s.day, s.hour, s.minute, 0, 0).getTime();
    const shifted: QuietShift = shiftOutOfQuiet(ts, q);
    if (!shifted.changed) {
      out.push(s);
      continue;
    }
    const maxDelay: number = budgetFor(String(s.kind), budget);
    const delayMin: number = Math.floor((shifted.ts - ts) / 60000);
    // maxDelay < 0 ⇒ 不限（事件还没到，晚点提醒仍成立）
    if (maxDelay >= 0 && delayMin > maxDelay) {
      dropped++;
      continue;
    }
    delayed++;
    const d: Date = new Date(shifted.ts);
    out.push({
      key: s.key,
      kind: s.kind,
      title: s.title,
      content: s.content,
      year: d.getFullYear(),
      month: d.getMonth() + 1,
      day: d.getDate(),
      hour: d.getHours(),
      minute: d.getMinutes()
    });
  }
  return { specs: out, delayed: delayed, dropped: dropped };
}

/** 设置页一行文案：`23:00 – 07:00（次日）`；未启用时给「已关闭」。 */
export function quietSummary(q: QuietHours): string {
  if (!q.enabled) {
    return '已关闭';
  }
  if (!windowValid(q)) {
    return '未生效（起止相同）';
  }
  const s: string = minuteText(q.startMinute);
  const e: string = minuteText(q.endMinute);
  const cross: string = clampMinute(q.startMinute, 0) > clampMinute(q.endMinute, 0) ? '（次日）' : '';
  return s + ' – ' + e + cross;
}

/** 设置页解释文案（把「推迟」而不是「丢弃」讲清楚，别让用户以为提醒会没）。 */
export function quietHint(q: QuietHours): string {
  if (!q.enabled) {
    return '关闭时全天都会提醒';
  }
  if (!windowValid(q)) {
    return '起止时间相同，当前不生效';
  }
  return '该时段内的提醒会推到 ' + minuteText(q.endMinute) + '，不会丢';
}

/** Prefs 里的 JSON → QuietHours（逐项回落，脏值不整块回退）。 */
export function normalizeQuietHours(rec: Record<string, Object> | null): QuietHours {
  const out: QuietHours = {
    enabled: DEFAULT_QUIET_HOURS.enabled,
    startMinute: DEFAULT_QUIET_HOURS.startMinute,
    endMinute: DEFAULT_QUIET_HOURS.endMinute
  };
  if (rec === null) {
    return out;
  }
  const on: Object | undefined = rec['enabled'];
  if (typeof on === 'boolean') {
    out.enabled = on as boolean;
  }
  out.startMinute = clampMinute(numOf(rec['startMinute'], out.startMinute), out.startMinute);
  out.endMinute = clampMinute(numOf(rec['endMinute'], out.endMinute), out.endMinute);
  return out;
}

function numOf(v: Object | undefined, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v as number : fallback;
}
