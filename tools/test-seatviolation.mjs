/**
 * 座位违约记录逻辑测试（M9-6 纯逻辑层）。
 *
 * 覆盖：
 * 1. 违约计数（活跃/过期）
 * 2. 上限判定
 * 3. 文案格式化
 * 4. 记录清理
 */

import {
  MAX_VIOLATIONS,
  VIOLATION_RETAIN_DAYS,
  isViolationLimitReached,
  countActiveViolations,
  getActiveViolations,
  formatViolationText,
  getViolationCountText,
  canReserve,
  pruneExpiredViolations,
} from "../entry/src/main/ets/corelogic/SeatViolationLogic.ts";

let passed = 0;
let failed = 0;

function eq(actual, expected, name) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}\n  actual   = ${a}\n  expected = ${e}`);
}

function ok(cond, name) {
  if (cond) passed++; else { failed++; console.error("FAIL: " + name); }
}

// ── 辅助函数 ──────────────────────────────────────────────────────────────────
/** @param {Object} overrides */
function makeRecord(overrides = {}) {
  return {
    id: 'v_001',
    date: 0,
    seatNo: 'A001',
    areaName: '文萃楼',
    reason: '未签到',
    ...overrides,
  };
}

const NOW = 100; // 测试基准日

// ── 1. 违约计数 ──────────────────────────────────────────────────────────────
{
  const records = [
    makeRecord({ date: 90 }),  // 10 天前，活跃
    makeRecord({ date: 95 }),  // 5 天前，活跃
    makeRecord({ date: 80 }),  // 20 天前，活跃
  ];
  eq(countActiveViolations(records, NOW), 3, "3 条活跃记录");
}
{
  // 边界测试：30 天边界（< 30 才算活跃）
  const records = [
    makeRecord({ date: 71 }),  // 29 天前，活跃
    makeRecord({ date: 70 }),  // 30 天前，边界不活跃（30 < 30 为 false）
    makeRecord({ date: 69 }),  // 31 天前，过期
  ];
  eq(countActiveViolations(records, NOW), 1, "只有 1 条活跃（30 天边界）");
}
{
  eq(countActiveViolations([], NOW), 0, "空记录返回 0");
}

// ── 2. 上限判定 ──────────────────────────────────────────────────────────────
{
  const records = Array(MAX_VIOLATIONS).fill(null).map((_, i) => makeRecord({ date: 100 - i }));
  eq(countActiveViolations(records, NOW), MAX_VIOLATIONS, `${MAX_VIOLATIONS} 条记录`);
  ok(isViolationLimitReached(records, NOW), "达到上限");
  ok(!canReserve(records, NOW), "达到上限不可预约");
}
{
  const records = Array(MAX_VIOLATIONS - 1).fill(null).map((_, i) => makeRecord({ date: 100 - i }));
  ok(!isViolationLimitReached(records, NOW), "未达上限");
  ok(canReserve(records, NOW), "未达上限可预约");
}

// ── 3. 文案格式化 ────────────────────────────────────────────────────────────
{
  const record = makeRecord({ date: 100, seatNo: 'A001' });
  eq(formatViolationText(record, 100), '预约「A001」未按时签到 · 今天', "今天");
}
{
  const record = makeRecord({ date: 99, seatNo: 'B002' });
  eq(formatViolationText(record, 100), '预约「B002」未按时签到 · 昨天', "昨天");
}
{
  const record = makeRecord({ date: 90, seatNo: 'C003' });
  eq(formatViolationText(record, 100), '预约「C003」未按时签到 · 10 天前', "N 天前");
}

// ── 4. 计数文案 ──────────────────────────────────────────────────────────────
{
  const records = [makeRecord({ date: 90 }), makeRecord({ date: 95 })];
  eq(getViolationCountText(records, NOW), '2/5', "计数文案 2/5");
}
{
  eq(getViolationCountText([], NOW), '0/5', "空记录文案 0/5");
}

// ── 5. 记录清理 ──────────────────────────────────────────────────────────────
{
  const records = [
    makeRecord({ date: 90 }),   // 活跃
    makeRecord({ date: 69 }),   // 过期
    makeRecord({ date: 50 }),   // 过期
  ];
  const pruned = pruneExpiredViolations(records, NOW);
  eq(pruned.length, 1, "清理后剩 1 条");
  eq(pruned[0].date, 90, "保留最新的记录");
}

// ── 结果 ─────────────────────────────────────────────────────────────────────
if (failed > 0) {
  console.error(`\nFAIL: ${failed} assertions failed`);
  process.exit(1);
}
console.log(`\nALL PASS  pass=${passed} fail=${failed}`);
