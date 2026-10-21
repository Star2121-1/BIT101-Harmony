/**
 * 我的预约逻辑测试（M9-5 纯逻辑层）。
 *
 * 覆盖：
 * 1. 预约状态判断
 * 2. 取消逻辑（是否可以取消、取消请求构建）
 * 3. 预约时长计算
 * 4. 响应解析
 */

import {
  getReservationStatus,
  buildCancelBody,
  parseCancelResponse,
  remainingReservationMinutes,
  isReservationActive,
  canCancelReservation,
} from "../entry/src/main/ets/corelogic/SeatReservationLogic.ts";
import { SeatStatus } from "../entry/src/main/ets/corelogic/SeatLogic.ts";

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
    id: 'res_001',
    seatId: '12345',
    seatNo: 'A001',
    areaId: 'area_1',
    segmentId: 'seg_001',
    startTime: { day: 0, minutes: 480 }, // 08:00
    endTime: { day: 0, minutes: 540 },   // 09:00
    signInDeadline: { day: 0, minutes: 465 }, // 07:45
    status: 2,
    isCheckedIn: false,
    ...overrides,
  };
}

// ── 1. 预约状态判断 ──────────────────────────────────────────────────────────
{
  // 未过期、未签到 → RESERVED_YOURS
  const record = makeRecord();
  const result = getReservationStatus(record, { day: 0, minutes: 470 }); // 07:50
  eq(result.status, SeatStatus.RESERVED_YOURS, "未到期 → RESERVED_YOURS");
  eq(result.isExpired, false, "未过期");
  ok(result.signInRemainingMinutes > 0, "有剩余签到时间");
}
{
  // 已签到 → CHECKED_IN
  const record = makeRecord({ isCheckedIn: true });
  const result = getReservationStatus(record, { day: 0, minutes: 490 }); // 08:10
  eq(result.status, SeatStatus.CHECKED_IN, "已签到 → CHECKED_IN");
}
{
  // 已过期 → EXPIRED
  const record = makeRecord();
  const result = getReservationStatus(record, { day: 0, minutes: 550 }); // 09:10
  eq(result.status, SeatStatus.EXPIRED, "已过期 → EXPIRED");
  eq(result.isExpired, true, "isExpired = true");
}
{
  // 即将截止（< 10 分钟）
  const record = makeRecord();
  const result = getReservationStatus(record, { day: 0, minutes: 456 }); // 07:36
  ok(result.isSignInUrgent, "剩余 < 10 分钟 → isSignInUrgent");
}

// ── 2. 取消逻辑 ──────────────────────────────────────────────────────────────
{
  const record = makeRecord();
  const body = buildCancelBody(record);
  eq(body.reservation_id, 'res_001', "reservation_id 正确");
  eq(body.seat_id, 12345, "seat_id 转为数字");
}
{
  const response = { code: 1, message: 'success' };
  const result = parseCancelResponse(response);
  ok(result.ok, "code=1 → 取消成功");
  eq(result.message, '取消成功', "消息正确");
}
{
  const response = { code: 0, message: '操作失败' };
  const result = parseCancelResponse(response);
  ok(!result.ok, "code≠1 → 取消失败");
  eq(result.message, '操作失败', "错误消息正确");
}

// ── 3. 预约时长计算 ──────────────────────────────────────────────────────────
{
  const record = makeRecord();
  const remaining = remainingReservationMinutes(record, { day: 0, minutes: 500 });
  eq(remaining, 40, "剩余 40 分钟");
}
{
  const record = makeRecord();
  const remaining = remainingReservationMinutes(record, { day: 0, minutes: 600 });
  eq(remaining, -60, "已结束后剩余为负");
}

// ── 4. 预约进行中判断 ────────────────────────────────────────────────────────
{
  const record = makeRecord();
  ok(isReservationActive(record, { day: 0, minutes: 500 }), "进行中时返回 true");
  ok(!isReservationActive(record, { day: 0, minutes: 470 }), "开始前返回 false");
  ok(!isReservationActive(record, { day: 0, minutes: 600 }), "结束后返回 false");
}

// ── 5. 取消资格判断 ──────────────────────────────────────────────────────────
{
  const record = makeRecord();
  ok(canCancelReservation(record, { day: 0, minutes: 400 }), "提前 1 小时可取消");
  ok(!canCancelReservation(record, { day: 0, minutes: 470 }), "提前 10 分钟不可取消");
  ok(!canCancelReservation(record, { day: 0, minutes: 490 }), "已开始不可取消");
}
{
  // 已签到不可取消
  const record = makeRecord({ isCheckedIn: true });
  ok(!canCancelReservation(record, { day: 0, minutes: 400 }), "已签到不可取消");
}

// ── 结果 ─────────────────────────────────────────────────────────────────────
if (failed > 0) {
  console.error(`\nFAIL: ${failed} assertions failed`);
  process.exit(1);
}
console.log(`\nALL PASS  pass=${passed} fail=${failed}`);
