/**
 * 提醒设置的**纯逻辑**（M7-5，不碰 Prefs，单测直接打）。
 *
 * 对照 Android `NotifySettings` 的 13 项 + `NotifySettingViewModel` 的提前量选项。
 * 存储（Prefs 读写）在 data/NotifySettingsStore，这里只放：类型、默认值、
 * 提前量选项、`toPolicy`（挑 plan 消费的 10 项）、`clampLead`（越界钳回最近档）、
 * `normalizeSettings`（JSON 解析后逐项回落，损坏不整块回退）。
 *
 * 与 13 项设置对齐 Android「逐屏对得上」；`plan()` 只消费 `NotifyPolicy` 的 10 项，
 * 多出的 3 项各有去处（见 data/NotifySettingsStore 头注释）。
 */

import { DEFAULT_NOTIFY_POLICY, type NotifyPolicy } from './NotifyLogic.ts';

/** 13 项（字段与 Android `NotifySettings` 一一对应）。 */
export interface NotifySettings {
  /** 总开关：关掉后不再排任何提醒（reschedule 据此 cancelAll）。 */
  enabled: boolean;
  classEnabled: boolean;
  classLeadMinutes: number;
  ddlEnabled: boolean;
  ddlDayEnabled: boolean;
  ddlHourEnabled: boolean;
  seatEnabled: boolean;
  seatSignInLeadMinutes: number;
  /** 出分提醒（M7-3 预留；plan 暂不消费，先默认关）。 */
  scoreEnabled: boolean;
  examEnabled: boolean;
  examDayEnabled: boolean;
  examLeadMinutes: number;
  adjustmentEnabled: boolean;
}

/** 默认值：对齐 `DEFAULT_NOTIFY_POLICY` + 总开关开 + 出分关（未做）。 */
export const DEFAULT_NOTIFY_SETTINGS: NotifySettings = {
  enabled: true,
  classEnabled: DEFAULT_NOTIFY_POLICY.classEnabled,
  classLeadMinutes: DEFAULT_NOTIFY_POLICY.classLeadMinutes,
  ddlEnabled: DEFAULT_NOTIFY_POLICY.ddlEnabled,
  ddlDayEnabled: DEFAULT_NOTIFY_POLICY.ddlDayEnabled,
  ddlHourEnabled: DEFAULT_NOTIFY_POLICY.ddlHourEnabled,
  seatEnabled: DEFAULT_NOTIFY_POLICY.seatEnabled,
  seatSignInLeadMinutes: DEFAULT_NOTIFY_POLICY.seatSignInLeadMinutes,
  scoreEnabled: false,
  examEnabled: DEFAULT_NOTIFY_POLICY.examEnabled,
  examDayEnabled: DEFAULT_NOTIFY_POLICY.examDayEnabled,
  examLeadMinutes: DEFAULT_NOTIFY_POLICY.examLeadMinutes,
  adjustmentEnabled: DEFAULT_NOTIFY_POLICY.adjustmentEnabled
};

/** 提前量可选项（分钟，与 Android leadOptions 完全一致；不给自由输入）。 */
export const CLASS_LEAD_OPTIONS: number[] = [5, 10, 15, 20, 30];
export const SEAT_LEAD_OPTIONS: number[] = [5, 15, 30, 60];
export const EXAM_LEAD_OPTIONS: number[] = [30, 60, 90, 120];

/**
 * 设置 → plan 消费的 `NotifyPolicy`（挑 10 项；horizonDays 恒 7，
 * 与 Android「只排未来一周」同口径，不开放给用户改）。
 */
export function toPolicy(s: NotifySettings): NotifyPolicy {
  return {
    classEnabled: s.classEnabled,
    classLeadMinutes: s.classLeadMinutes,
    ddlEnabled: s.ddlEnabled,
    ddlDayEnabled: s.ddlDayEnabled,
    ddlHourEnabled: s.ddlHourEnabled,
    seatEnabled: s.seatEnabled,
    seatSignInLeadMinutes: s.seatSignInLeadMinutes,
    examEnabled: s.examEnabled,
    examDayEnabled: s.examDayEnabled,
    examLeadMinutes: s.examLeadMinutes,
    adjustmentEnabled: s.adjustmentEnabled,
    horizonDays: 7
  };
}

/** 归一化：提前量若不在选项里（老数据/越界）钳回最近档，避免排「提前 200 分钟」怪值。 */
export function clampLead(current: number, options: number[]): number {
  if (options.length === 0) {
    return current;
  }
  let best: number = options[0];
  let bestDist: number = Math.abs(current - options[0]);
  for (let i = 0; i < options.length; i++) {
    const dist: number = Math.abs(current - options[i]);
    if (dist < bestDist) {
      best = options[i];
      bestDist = dist;
    }
  }
  return best;
}

/** 三项提前量各自钳回最近档（落库后调用，老数据/手改的越界值都能自纠）。 */
export function clampAll(s: NotifySettings): NotifySettings {
  return {
    enabled: s.enabled,
    classEnabled: s.classEnabled,
    classLeadMinutes: clampLead(s.classLeadMinutes, CLASS_LEAD_OPTIONS),
    ddlEnabled: s.ddlEnabled,
    ddlDayEnabled: s.ddlDayEnabled,
    ddlHourEnabled: s.ddlHourEnabled,
    seatEnabled: s.seatEnabled,
    seatSignInLeadMinutes: clampLead(s.seatSignInLeadMinutes, SEAT_LEAD_OPTIONS),
    scoreEnabled: s.scoreEnabled,
    examEnabled: s.examEnabled,
    examDayEnabled: s.examDayEnabled,
    examLeadMinutes: clampLead(s.examLeadMinutes, EXAM_LEAD_OPTIONS),
    adjustmentEnabled: s.adjustmentEnabled
  };
}

/**
 * JSON 对象 → NotifySettings（逐项回落默认；保留用户改过的其它项，不整块回退）。
 * 给 data 层的 load() 用：把「脏 JSON 的归一化」这个可测的纯函数剥出来。
 */
export function normalizeSettings(rec: Record<string, Object> | null): NotifySettings {
  const out: NotifySettings = { ...DEFAULT_NOTIFY_SETTINGS };
  if (rec === null) {
    return out;
  }
  out.enabled = boolOf(rec['enabled'], out.enabled);
  out.classEnabled = boolOf(rec['classEnabled'], out.classEnabled);
  out.classLeadMinutes = numOf(rec['classLeadMinutes'], out.classLeadMinutes);
  out.ddlEnabled = boolOf(rec['ddlEnabled'], out.ddlEnabled);
  out.ddlDayEnabled = boolOf(rec['ddlDayEnabled'], out.ddlDayEnabled);
  out.ddlHourEnabled = boolOf(rec['ddlHourEnabled'], out.ddlHourEnabled);
  out.seatEnabled = boolOf(rec['seatEnabled'], out.seatEnabled);
  out.seatSignInLeadMinutes = numOf(rec['seatSignInLeadMinutes'], out.seatSignInLeadMinutes);
  out.scoreEnabled = boolOf(rec['scoreEnabled'], out.scoreEnabled);
  out.examEnabled = boolOf(rec['examEnabled'], out.examEnabled);
  out.examDayEnabled = boolOf(rec['examDayEnabled'], out.examDayEnabled);
  out.examLeadMinutes = numOf(rec['examLeadMinutes'], out.examLeadMinutes);
  out.adjustmentEnabled = boolOf(rec['adjustmentEnabled'], out.adjustmentEnabled);
  return out;
}

function boolOf(v: Object | undefined, fallback: boolean): boolean {
  return typeof v === 'boolean' ? (v as boolean) : fallback;
}

function numOf(v: Object | undefined, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? (v as number) : fallback;
}
