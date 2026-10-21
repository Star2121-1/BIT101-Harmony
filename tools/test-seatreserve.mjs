/**
 * 座位预约逻辑测试（M9-4 纯逻辑层）。
 *
 * 覆盖：
 * 1. 参数校验（空值/时间倒序/超时/缺 segmentId）
 * 2. 请求体格式化（seat_id 转数字）
 * 3. 响应解析（预约 ID 提取）
 * 4. 错误信息解析
 * 5. 签到截止时间计算
 */

import {
  validateReserveParams,
  buildReserveBody,
  extractReservationId,
  parseReserveError,
  calcSignInDeadline,
} from "../entry/src/main/ets/corelogic/SeatReserveLogic.ts";

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

// ── 1. 参数校验 ──────────────────────────────────────────────────────────────
{
  const valid = {
    seatId: '12345',
    seatNo: 'A001',
    areaId: 'area_1',
    segmentId: 'seg_001',
    startTime: { day: 0, minutes: 480 },
    endTime: { day: 0, minutes: 540 },
  };
  eq(validateReserveParams(valid), null, "合法参数通过");
}
{
  const invalid = {
    seatId: '',
    seatNo: 'A001',
    areaId: 'area_1',
    segmentId: 'seg_001',
    startTime: { day: 0, minutes: 480 },
    endTime: { day: 0, minutes: 540 },
  };
  ok(validateReserveParams(invalid) !== null, "空 seatId → 拒绝");
}
{
  const invalid = {
    seatId: '123',
    seatNo: 'A001',
    areaId: '',
    segmentId: 'seg_001',
    startTime: { day: 0, minutes: 480 },
    endTime: { day: 0, minutes: 540 },
  };
  ok(validateReserveParams(invalid) !== null, "空 areaId → 拒绝");
}
{
  const invalid = {
    seatId: '123',
    seatNo: 'A001',
    areaId: 'area_1',
    segmentId: '',
    startTime: { day: 0, minutes: 480 },
    endTime: { day: 0, minutes: 540 },
  };
  ok(validateReserveParams(invalid) !== null, "空 segmentId → 拒绝");
}
{
  // 结束时间早于开始时间
  const invalid = {
    seatId: '123',
    seatNo: 'A001',
    areaId: 'area_1',
    segmentId: 'seg_001',
    startTime: { day: 0, minutes: 540 },
    endTime: { day: 0, minutes: 480 },
  };
  ok(validateReserveParams(invalid) !== null, "结束早于开始 → 拒绝");
}
{
  // 超过 8 小时（480 分钟）
  const invalid = {
    seatId: '123',
    seatNo: 'A001',
    areaId: 'area_1',
    segmentId: 'seg_001',
    startTime: { day: 0, minutes: 0 },
    endTime: { day: 1, minutes: 0 },
  };
  ok(validateReserveParams(invalid) !== null, "超 8 小时 → 拒绝");
}
{
  // 恰好 8 小时应通过
  const valid = {
    seatId: '123',
    seatNo: 'A001',
    areaId: 'area_1',
    segmentId: 'seg_001',
    startTime: { day: 0, minutes: 0 },
    endTime: { day: 0, minutes: 480 },
  };
  eq(validateReserveParams(valid), null, "恰好 8 小时通过");
}

// ── 2. 请求体格式化 ──────────────────────────────────────────────────────────
{
  const body = buildReserveBody({
    seatId: '12345', seatNo: 'A001', areaId: 'area_1',
    segmentId: 'seg_001',
    startTime: { day: 0, minutes: 480 },
    endTime: { day: 0, minutes: 540 },
  });
  eq(body.seat_id, 12345, "seat_id 转为数字");
  eq(body.segment, 'seg_001', "segment 保持字符串");
}
{
  // seatId 非数字时也保留原值
  const body = buildReserveBody({
    seatId: 'abc', seatNo: 'A001', areaId: 'area_1',
    segmentId: 'seg_002',
    startTime: { day: 0, minutes: 480 },
    endTime: { day: 0, minutes: 540 },
  });
  eq(body.seat_id, 'abc', "非数字 seatId 保留原值");
}

// ── 3. 响应解析 ──────────────────────────────────────────────────────────────
{
  const id = extractReservationId({ id: '12345', code: 1 });
  eq(id, '12345', "提取 id 字段");
}
{
  const id = extractReservationId({ reservation_id: '67890', code: 1 });
  eq(id, '67890', "提取 reservation_id 字段");
}
{
  const id = extractReservationId({ code: 1 });
  ok(id === null, "无 id 字段返回 null");
}

// ── 4. 错误信息解析 ──────────────────────────────────────────────────────────
{
  const msg = parseReserveError(401, '{"message":"登录已失效"}');
  eq(msg, '登录已失效', "401 错误提取 message");
}
{
  const msg = parseReserveError(500, '{"message":"服务器错误"}');
  eq(msg, '服务端错误（500）', "500 错误统一格式");
}
{
  const msg = parseReserveError(400, '{"error":"参数错误"}');
  eq(msg, '参数错误', "400 错误提取 error 字段");
}
{
  const msg = parseReserveError(400, 'plain error text');
  eq(msg, 'plain error text', "非 JSON 响应原样返回");
}

// ── 5. 签到截止时间计算 ──────────────────────────────────────────────────────
{
  const deadline = calcSignInDeadline({ day: 0, minutes: 480 });
  eq(deadline.day, 0, "签到截止 day 不变");
  eq(deadline.minutes, 465, "签到截止 minutes = 480-15");
}
{
  // 跨天边界：00:10 - 15分钟 = 前一天的 23:55
  const deadline = calcSignInDeadline({ day: 0, minutes: 10 });
  eq(deadline.day, -1, "跨天 day = -1");
  eq(deadline.minutes, 1435, "跨天 minutes = 1440-5");
}

// ── 结果 ─────────────────────────────────────────────────────────────────────
if (failed > 0) {
  console.error(`\nFAIL: ${failed} assertions failed`);
  process.exit(1);
}
console.log(`\nALL PASS  pass=${passed} fail=${failed}`);
