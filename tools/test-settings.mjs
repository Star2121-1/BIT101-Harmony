/**
 * 提醒设置存储（M7-5）：默认值对齐、toPolicy 字段挑选、提前量钳制。
 *
 * 钉住的口径：
 * 1. 默认 13 项与 `DEFAULT_NOTIFY_POLICY` 逐项一致（总开关开、出分关）；
 * 2. toPolicy 挑出的 10 项 = plan() 真正消费的字段（不串、不漏）；
 * 3. clampLead 把越界/老数据的提前量钳回最近档（不排「提前 200 分钟」怪值）。
 */
import {
  DEFAULT_NOTIFY_SETTINGS,
  CLASS_LEAD_OPTIONS,
  SEAT_LEAD_OPTIONS,
  EXAM_LEAD_OPTIONS,
  toPolicy,
  clampLead,
  clampAll,
  normalizeSettings
} from "../entry/src/main/ets/corelogic/NotifySettingsLogic.ts";
import { DEFAULT_NOTIFY_POLICY } from "../entry/src/main/ets/corelogic/NotifyLogic.ts";

let passed = 0;
let failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}\n  actual   = ${a}\n  expected = ${b}`);
}
function ok(cond, name) {
  if (cond) passed++; else { failed++; console.error("FAIL: " + name); }
}

// ── 默认值对齐 Android/DEFAULT_POLICY ──
{
  const d = DEFAULT_NOTIFY_SETTINGS;
  eq(d.enabled, true, "总开关默认开");
  eq(d.scoreEnabled, false, "出分默认关（M7-3 未做）");
  eq(d.classEnabled, DEFAULT_NOTIFY_POLICY.classEnabled, "上课开关对齐");
  eq(d.classLeadMinutes, DEFAULT_NOTIFY_POLICY.classLeadMinutes, "上课提前量对齐");
  eq(d.ddlEnabled, DEFAULT_NOTIFY_POLICY.ddlEnabled, "DDL 开关对齐");
  eq(d.ddlDayEnabled, DEFAULT_NOTIFY_POLICY.ddlDayEnabled, "DDL 前一天对齐");
  eq(d.ddlHourEnabled, DEFAULT_NOTIFY_POLICY.ddlHourEnabled, "DDL 前一小时对齐");
  eq(d.seatEnabled, DEFAULT_NOTIFY_POLICY.seatEnabled, "座位开关对齐");
  eq(d.seatSignInLeadMinutes, DEFAULT_NOTIFY_POLICY.seatSignInLeadMinutes, "座位提前量对齐");
  eq(d.examEnabled, DEFAULT_NOTIFY_POLICY.examEnabled, "考试开关对齐");
  eq(d.examDayEnabled, DEFAULT_NOTIFY_POLICY.examDayEnabled, "考试前一天对齐");
  eq(d.examLeadMinutes, DEFAULT_NOTIFY_POLICY.examLeadMinutes, "考试提前量对齐");
  eq(d.adjustmentEnabled, DEFAULT_NOTIFY_POLICY.adjustmentEnabled, "教学调整对齐");
}

// ── toPolicy：挑 10 项，不串不漏 ──
{
  const s = { ...DEFAULT_NOTIFY_SETTINGS, classLeadMinutes: 25, examLeadMinutes: 120 };
  const p = toPolicy(s);
  eq(p.classEnabled, s.classEnabled, "toPolicy 取上课开关");
  eq(p.classLeadMinutes, 25, "toPolicy 取改后的上课提前量");
  eq(p.examLeadMinutes, 120, "toPolicy 取改后的考试提前量");
  eq(p.horizonDays, 7, "horizonDays 恒 7（不开放给用户）");
  // 13 项里 scoreEnabled 是 M7-3 预留，policy 不含它（plan 暂不消费）
  ok(!("scoreEnabled" in p), "toPolicy 不含 scoreEnabled（未做）");
  // 逐字段全在
  const keys = ["classEnabled","classLeadMinutes","ddlEnabled","ddlDayEnabled","ddlHourEnabled",
    "seatEnabled","seatSignInLeadMinutes","examEnabled","examDayEnabled","examLeadMinutes","adjustmentEnabled","horizonDays"];
  for (const k of keys) ok(k in p, "policy 含字段 " + k);
}

// ── 提前量选项（与 Android 完全一致）──
{
  eq(CLASS_LEAD_OPTIONS, [5, 10, 15, 20, 30], "上课 5/10/15/20/30");
  eq(SEAT_LEAD_OPTIONS, [5, 15, 30, 60], "座位 5/15/30/60");
  eq(EXAM_LEAD_OPTIONS, [30, 60, 90, 120], "考试 30/60/90/120");
}

// ── clampLead：越界钳回最近档 ──
{
  eq(clampLead(10, CLASS_LEAD_OPTIONS), 10, "合法值原样");
  eq(clampLead(12, CLASS_LEAD_OPTIONS), 10, "12→最近档 10");
  eq(clampLead(200, CLASS_LEAD_OPTIONS), 30, "超大值钳到上限 30");
  eq(clampLead(0, CLASS_LEAD_OPTIONS), 5, "0 钳到下限 5");
  eq(clampLead(11, SEAT_LEAD_OPTIONS), 15, "座位 11→15");
  eq(clampLead(45, EXAM_LEAD_OPTIONS), 30, "考试 45→最近档 30");
}

// ── normalizeSettings：逐项回落，不整块回退 ──
{
  // 空 rec（无数据）= 全默认
  eq(normalizeSettings(null).enabled, true, "null → 默认总开关开");
  eq(normalizeSettings(null).scoreEnabled, false, "null → 默认出分关");
  // 只改了上课提前量，其余回落默认
  const s = normalizeSettings({ classLeadMinutes: 25 });
  eq(s.classLeadMinutes, 25, "改过的字段保留");
  eq(s.enabled, true, "没改的字段回落默认");
  eq(s.examLeadMinutes, DEFAULT_NOTIFY_POLICY.examLeadMinutes, "考试提前量回落默认");
  // 脏类型（boolean 给成字符串）→ 回落默认
  const s2 = normalizeSettings({ enabled: "yes" });
  eq(s2.enabled, true, "脏类型回落默认");
  const s3 = normalizeSettings({ classLeadMinutes: "x" });
  eq(s3.classLeadMinutes, DEFAULT_NOTIFY_POLICY.classLeadMinutes, "脏提前量回落默认");
}

// ── clampAll：落库/读取后越界值自纠 ──
{
  const raw = { ...DEFAULT_NOTIFY_SETTINGS, classLeadMinutes: 999, seatSignInLeadMinutes: 0, examLeadMinutes: 80 };
  const clamped = clampAll(raw);
  eq(clamped.classLeadMinutes, 30, "999 钳到上限 30");
  eq(clamped.seatSignInLeadMinutes, 5, "0 钳到下限 5");
  eq(clamped.examLeadMinutes, 90, "80 → 最近档 90（|80-90|=10 < |80-60|=20）");
  eq(clamped.enabled, true, "非提前量字段不动");
}

console.log("pass=" + passed + " fail=" + failed);
if (failed > 0) process.exit(1);
console.log("ALL PASS  pass=" + passed + " fail=" + failed);
