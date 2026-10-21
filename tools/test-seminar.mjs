/**
 * 研讨间逻辑测试（M9-7 纯逻辑层）。
 *
 * 覆盖：
 * 1. 可取消状态判断
 * 2. 时间文本格式化
 * 3. 状态文案获取
 * 4. 取消请求体构建
 * 5. 响应解析
 */

import {
  isSeminarCancellable,
  formatSeminarTime,
  getSeminarStatusText,
  buildCancelSeminarBody,
  parseSeminarCancelResponse,
} from "../entry/src/main/ets/corelogic/SeminarLogic.ts";

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

/** @param {Object} overrides */
function makeRecord(overrides = {}) {
  return {
    id: 'sem_001',
    nameMerge: '研讨间A-101',
    day: '2026-10-25',
    start: '14:00',
    end: '16:00',
    status: '2',
    statusName: '可取消',
    ...overrides,
  };
}

// ── 1. 可取消状态判断 ──────────────────────────────────────────────────────────
{
  const record = makeRecord({ status: '2' });
  ok(isSeminarCancellable(record), "status=2 可取消");
}
{
  const record = makeRecord({ status: '1' });
  ok(!isSeminarCancellable(record), "status=1 不可取消");
}
{
  const record = makeRecord({ status: '3' });
  ok(!isSeminarCancellable(record), "status=3 不可取消");
}

// ── 2. 时间文本格式化 ──────────────────────────────────────────────────────────
{
  const record = makeRecord();
  eq(formatSeminarTime(record), '2026-10-25 14:00-16:00', "标准格式");
}
{
  const record = makeRecord({ start: '', end: '' });
  eq(formatSeminarTime(record), '2026-10-25', "空时间段只显日期");
}
{
  const record = makeRecord({ day: '', start: '14:00', end: '16:00' });
  eq(formatSeminarTime(record), '14:00-16:00', "空日期只显时间");
}

// ── 3. 状态文案获取 ────────────────────────────────────────────────────────────
{
  const record = makeRecord({ statusName: '可取消' });
  eq(getSeminarStatusText(record), '可取消', "使用 statusName");
}
{
  const record = makeRecord({ statusName: '' });
  eq(getSeminarStatusText(record), '2', "空 statusName 退回 status");
}

// ── 4. 取消请求体构建 ──────────────────────────────────────────────────────────
{
  const record = makeRecord({ id: 'sem_123' });
  const body = buildCancelSeminarBody(record);
  eq(body.seminar_id, 'sem_123', "seminar_id 正确");
}

// ── 5. 响应解析 ────────────────────────────────────────────────────────────────
{
  const result = parseSeminarCancelResponse({ code: 1, message: 'success' });
  ok(result.ok, "code=1 成功");
  eq(result.message, '取消成功', "成功消息");
}
{
  const result = parseSeminarCancelResponse({ code: 0, message: '参数错误' });
  ok(!result.ok, "code=0 失败");
  eq(result.message, '参数错误', "错误消息透传");
}
{
  const result = parseSeminarCancelResponse({ code: 0 });
  ok(!result.ok, "无 message 时默认失败");
  eq(result.message, '取消失败', "默认失败消息");
}

// ── 结果 ──────────────────────────────────────────────────────────────────────
if (failed > 0) {
  console.error(`\nFAIL: ${failed} assertions failed`);
  process.exit(1);
}
console.log(`\nALL PASS  pass=${passed} fail=${failed}`);
