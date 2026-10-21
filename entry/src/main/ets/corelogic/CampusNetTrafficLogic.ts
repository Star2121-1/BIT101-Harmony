/**
 * 校园网流量的**本地历史与趋势**（1:1 对照 Android `CampusNetTrafficLogic`）。
 * 文件读写在 `data/CampusNetTrafficStore.ts`；本文件纯逻辑、可单测。
 *
 * ## 为什么要有它
 *
 * 校园网只给一个「本月已用 366 GB」的累计数字 —— 它回答不了用户真正想知道的：
 * **我这个月会不会用超（300 GB 后限速）**。既然每次刷新都能拿到这个累计值，
 * 就把它攒起来，用**增量速率**推算月末用量。
 *
 * ## ⚠️ 与一卡通余额最大的不同：计费周期会重置
 *
 * `[6]` 是**按计费周期累计**的，换周期就从很小的值重新开始。
 * ⇒ 采样必须**检测重置**：新的累计值 < 上一条 ⇒ 上周期采样全废，清空重来 ——
 * 否则会算出「负的增量」这种荒谬结果。
 *
 * ## 口径
 *
 * - 每次成功取到校园网数据记一条 `(时刻, 累计字节)`
 * - 同一天、同一个累计值**不重复记**（页面每次进都会刷新一次）
 * - 「今日」= 今天最早采样 → 最新；「日均」= 窗口内最早 → 最新，跨 N 个自然日
 * - **月末预测假设计费周期 = 自然月** → `已用 + 日均 × 到月末剩余天数`（估算，UI 要说清）
 *
 * 日期归属用注入的 `DayOf`（理由同 CampusCardBalanceLogic：CI 在 UTC 上跑）。
 */

import type { DayOf } from './CampusCardBalanceLogic.ts';
import { localEpochDay } from './CampusCardBalanceLogic.ts';
import { LIMIT_BYTES, formatTraffic } from './CampusNetLogic.ts';

/** 一次流量采样。 */
export interface TrafficSample {
  /** 采样时刻（epoch 毫秒） */
  atMillis: number;
  /** 当时**本计费周期累计用量**（接口 [6]） */
  bytes: number;
}

/**
 * 流量趋势与月末预测。**所有结论字段都可为 null**：
 * 采样没攒够就算不出来 —— 那就空着，绝不给看着像真的假数字。
 */
export interface TrafficTrend {
  /** 本周期已用（= 最新采样值） */
  usedBytes: number | null;
  /** 今日用量；今天只采到一次时为 null */
  todayBytes: number | null;
  /** 近 N 天日均；跨度不满一个自然日时为 null */
  dailyAverageBytes: number | null;
  /** dailyAverageBytes 实际跨了几个自然日；0 = 不可用 */
  spanDays: number;
  /** 按当前日均推到本自然月末的总用量；算不出时为 null */
  projectedMonthBytes: number | null;
}

/** 空趋势。 */
export function emptyTrafficTrend(): TrafficTrend {
  return { usedBytes: null, todayBytes: null, dailyAverageBytes: null, spanDays: 0, projectedMonthBytes: null };
}

/** 趋势窗口（自然日）。 */
export const WINDOW_DAYS: number = 7;

/** 最多保留多少条采样。 */
export const MAX_COUNT: number = 400;

/** 最多保留多少天。 */
export const MAX_DAYS: number = 120;

/** epoch day → 该月最后一天的 epoch day（月末预测用）。 */
export function monthLastEpochDay(epochDay: number): number {
  const dt: Date = new Date(epochDay * 86400000);
  const y: number = dt.getUTCFullYear();
  const mo: number = dt.getUTCMonth(); // 0-based
  // 下个月第 0 天 = 本月最后一天
  return Math.floor(Date.UTC(y, mo + 1, 0) / 86400000);
}

// ------------------------------------------------------------ 追加采样

/**
 * 追加一条采样，返回追加（并裁剪）后的完整列表。
 */
export function append(
  samples: TrafficSample[],
  bytes: number,
  atMillis: number,
  dayOf: DayOf = localEpochDay
): TrafficSample[] {
  if (bytes < 0) return samples;

  const last: TrafficSample | undefined = samples[samples.length - 1];

  // ⚠️ 计费周期重置：累计用量变小 ⇒ 上周期采样全部作废，从这条重新开始
  if (last !== undefined && bytes < last.bytes) {
    return [{ atMillis: atMillis, bytes: bytes }];
  }

  // 同一天、同一个累计值 → 不重复记
  if (last !== undefined && dayOf(last.atMillis) === dayOf(atMillis) && last.bytes === bytes) {
    return samples;
  }

  const cutoff: number = atMillis - MAX_DAYS * 24 * 3600 * 1000;
  const kept: TrafficSample[] = samples.concat([{ atMillis: atMillis, bytes: bytes }])
    .filter((s: TrafficSample) => s.atMillis >= cutoff);
  return kept.length <= MAX_COUNT ? kept : kept.slice(kept.length - MAX_COUNT);
}

// ------------------------------------------------------------ 趋势

/**
 * 算趋势与月末预测。
 *
 * @param nowEpochDay 今天（自然日），用于「今日」与「到月末还剩几天」
 */
export function trend(
  samples: TrafficSample[],
  nowEpochDay: number,
  dayOf: DayOf = localEpochDay
): TrafficTrend {
  if (samples.length === 0) return emptyTrafficTrend();
  const latest: TrafficSample = samples[samples.length - 1];
  const used: number = latest.bytes;

  // 今日：今天最早的采样 → 最新（今天只采到一次就是 null）
  const todaySamples: TrafficSample[] = samples.filter((s: TrafficSample) => dayOf(s.atMillis) === nowEpochDay);
  const todayBytes: number | null = todaySamples.length >= 2
    ? latest.bytes - todaySamples[0].bytes
    : null;

  // 日均：窗口内最早 → 最新，按**自然日**跨度算（不是按 24 小时）
  const windowStart: number = nowEpochDay - WINDOW_DAYS;
  const window: TrafficSample[] = samples.filter((s: TrafficSample) => dayOf(s.atMillis) >= windowStart);
  // ⚠️ 窗口可能为空：用户很久没在校内，最新采样早于窗口起点。
  // 退化成只看最新那条（spanDays = 0 ⇒ 日均 null），**而不是崩**
  const base: TrafficSample = window.length > 0 ? window[0] : latest;
  const spanDays: number = dayOf(latest.atMillis) - dayOf(base.atMillis);
  const dailyAverageBytes: number | null = spanDays >= 1
    ? Math.floor((latest.bytes - base.bytes) / spanDays)
    : null;

  // 月末预测：已用 + 日均 × 到月末剩余天数
  const remainingDays: number = monthLastEpochDay(nowEpochDay) - nowEpochDay;
  const projectedMonthBytes: number | null = dailyAverageBytes !== null
    ? used + dailyAverageBytes * remainingDays
    : null;

  return {
    usedBytes: used,
    todayBytes: todayBytes,
    dailyAverageBytes: dailyAverageBytes,
    spanDays: dailyAverageBytes !== null ? spanDays : 0,
    projectedMonthBytes: projectedMonthBytes
  };
}

// ------------------------------------------------------------ 编解码

/** 编码成单行文本：`毫秒|字节`，一行一条。 */
export function encode(samples: TrafficSample[]): string {
  const lines: string[] = [];
  for (let i = 0; i < samples.length; i++) {
    lines.push(samples[i].atMillis + '|' + samples[i].bytes);
  }
  return lines.join('\n');
}

/** 解析；形状不对的**整条丢弃**（不猜）。 */
export function decode(raw: string | null): TrafficSample[] {
  if (raw === null || raw.length === 0) return [];
  const out: TrafficSample[] = [];
  const lines: string[] = raw.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const parts: string[] = lines[i].trim().split('|');
    if (parts.length !== 2) continue;
    if (!/^-?\d+$/.test(parts[0]) || !/^-?\d+$/.test(parts[1])) continue;
    out.push({ atMillis: Number(parts[0]), bytes: Number(parts[1]) });
  }
  return out;
}

// ------------------------------------------------------------ 展示文案

/**
 * 「今日用量」文案；算不出（今天只采到一次）返回 null。
 *
 * ⚠️ 调用方据此显示「—」而不是 0 —— 0 会让人以为今天没用流量，而真相是「不知道」。
 */
export function todayText(t: TrafficTrend): string | null {
  return t.todayBytes !== null ? formatTraffic(t.todayBytes) : null;
}

/**
 * 「日均 + 月末预测」文案：`日均 15.0 GB（近 2 天）· 月末约 250.0 GB`。
 *
 * ⚠️ 采样跨不满一个自然日时返回 null —— 此时 UI 说「数据积累中」，**绝不编一个数**。
 */
export function forecastText(t: TrafficTrend, limitBytes: number = LIMIT_BYTES): string | null {
  const avg: number | null = t.dailyAverageBytes;
  const projected: number | null = t.projectedMonthBytes;
  const days: number = t.spanDays;
  if (avg === null || projected === null || days < 1) return null;

  const head: string = '日均 ' + formatTraffic(avg) + '（近 ' + days + ' 天）';
  const tail: string = '月末约 ' + formatTraffic(projected);
  return projected >= limitBytes ? head + ' · ' + tail + '（按此速度会超限速阈值）' : head + ' · ' + tail;
}
