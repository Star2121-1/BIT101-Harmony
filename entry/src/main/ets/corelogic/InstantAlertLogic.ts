/**
 * 即时提醒的**纯判定层**（M14-A，不碰 @kit / Prefs / 页面）。
 *
 * 这里只放「给同样的输入，必须得到同样的结论」的部分：
 *  1. 流量告警的跨周期状态机（1:1 对照 Android `NetFlowChecker.check`）；
 *  2. 本地日期键（网费按自然日去重）与本地 DateTime（借阅天数按本地日期算）；
 *  3. 借阅「还没提醒过的新记录」筛选（Android `LibBorrowChecker` 的 fresh 集合）。
 *
 * ⚠️ 为什么流量状态不放 `NotifySentStore`：
 * `NotifySentStore` 会在 14 天后 prune，而流量承诺是「**整个计费周期**只提醒一次」。
 * 若复用它，用户 15 天后仍在同一计费周期里就会收到第二条 —— 去重缓存的清理语义
 * 会悄悄改写业务承诺。所以这里单独用 `InstantAlertStore` 持久状态，不设过期。
 */

import type { FlowAlert } from './NetAlertLogic.ts';
import { decideFlowAlert } from './NetAlertLogic.ts';
import type { BorrowRecord } from './LibBorrowLogic.ts';
import type { DateTime } from './timeutil.ts';

/** 流量告警的持久状态（与 Android SharedPreferences 三个键同义）。 */
export interface FlowAlertState {
  /** 上次成功取到的本周期累计字节；-1 = 还没有基线。 */
  lastBytes: number;
  warnedNear: boolean;
  warnedLimit: boolean;
}

/** 一次流量判定后的落地结果。 */
export interface FlowAlertDecision {
  /** 检测到累计值回落（换计费周期）：本轮只复位、不提醒。 */
  reset: boolean;
  alert: FlowAlert;
  /** 无论发不发通知，都要落盘的下一状态。 */
  next: FlowAlertState;
}

/** 初始状态（首次取数建基线，与 Android `getLong(..., -1)` 一致）。 */
export function initialFlowAlertState(): FlowAlertState {
  return { lastBytes: -1, warnedNear: false, warnedLimit: false };
}

/**
 * 流量判定状态机。
 *
 * - 无效值（NaN / 负数）不改状态、不提醒 —— 上游解析异常不能在通知里编造数字；
 * - 累计值比上次小 ⇒ 计费周期重置：清两枚标记并**当轮返回**（Android 原行为），
 *   下个月再达到阈值才会重新提醒；
 * - 超限会同时置 `warnedNear` 与 `warnedLimit` —— 避免降到 270 GB 后补发那条旧的。
 */
export function decideFlowState(usedBytes: number, state: FlowAlertState): FlowAlertDecision {
  const keep: FlowAlertState = {
    lastBytes: state.lastBytes,
    warnedNear: state.warnedNear,
    warnedLimit: state.warnedLimit
  };
  if (!Number.isFinite(usedBytes) || usedBytes < 0) {
    return { reset: false, alert: 'none', next: keep };
  }
  if (state.lastBytes >= 0 && usedBytes < state.lastBytes) {
    return {
      reset: true,
      alert: 'none',
      next: { lastBytes: usedBytes, warnedNear: false, warnedLimit: false }
    };
  }
  const alert: FlowAlert = decideFlowAlert(usedBytes, state.warnedNear, state.warnedLimit);
  const next: FlowAlertState = {
    lastBytes: usedBytes,
    warnedNear: state.warnedNear || alert === 'near' || alert === 'exceeded',
    warnedLimit: state.warnedLimit || alert === 'exceeded'
  };
  return { reset: false, alert: alert, next: next };
}

/** 毫秒 → 本地自然日键 `YYYY-MM-DD`（网费去重键要用**本地**日期，不能 UTC）。 */
export function localDateKey(atMillis: number): string {
  if (!Number.isFinite(atMillis)) {
    return '';
  }
  const d: Date = new Date(atMillis);
  if (Number.isNaN(d.getTime())) {
    return '';
  }
  const year: string = String(d.getFullYear());
  const month: string = String(d.getMonth() + 1).padStart(2, '0');
  const day: string = String(d.getDate()).padStart(2, '0');
  return year + '-' + month + '-' + day;
}

/** 毫秒 → 本地 DateTime（借阅 `daysLeft` 按本地日历天算）。 */
export function localDateTime(atMillis: number): DateTime {
  const d: Date = new Date(atMillis);
  const offsetMs: number = d.getTimezoneOffset() * 60000;
  return {
    day: Math.floor((d.getTime() - offsetMs) / 86400000),
    minutes: d.getHours() * 60 + d.getMinutes()
  };
}

/**
 * 还没提醒过的借阅键（`BorrowRecord.key` = 题名 + ISBN + 应还日原文）。
 *
 * 注意返回的是「本次新发现的键」，但通知正文仍由调用方用**全部 alerts** 生成 ——
 * 文案说的是「当前有 N 本逾期」这个事实，不是「刚刚新增了 N 本」（Android 原注释）。
 */
export function freshLibKeys(alerts: BorrowRecord[], alerted: string[]): string[] {
  const seen: Set<string> = new Set<string>();
  for (let i = 0; i < alerted.length; i++) {
    seen.add(alerted[i]);
  }
  const out: string[] = [];
  for (let i = 0; i < alerts.length; i++) {
    const key: string = alerts[i].key;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(key);
    }
  }
  return out;
}
