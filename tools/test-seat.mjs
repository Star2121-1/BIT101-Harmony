/**
 * 座位预约纯逻辑层测试（M9-4 核心算法）。
 *
 * 覆盖：
 * 1. 枚举值正确性
 * 2. DateTime 转换
 * 3. 时段重叠检测
 * 4. 预约 ID 生成唯一性
 * 5. 状态文案
 * 6. 状态颜色
 * 7. 签到紧急度判定
 * 8. 规则校验（登录态/时段长度/提前量/并发）
 * 9. 违约判定
 * 10. 统计计算
 */

import {
  SeatStatus, ReservationKind, SignInKind,
  dateTimeToEpochMs, epochMsToDateTime, minutesBetween,
  timeOverlap, generateReservationId, seatTypeName,
  statusText, statusColor, remainingSignInMinutes,
  isSignInUrgent, validateReserveRequest,
  isDefaulted, countDefaults, hitDefaultLimit,
  defaultReasonText, calcStats,
  MAX_RESERVATION_MINUTES, MAX_CONCURRENT_RESERVATIONS, MIN_RESERVATION_LEAD_MINUTES,
} from "../entry/src/main/ets/corelogic/SeatLogic.ts";

/** 简化的 SessionSnapshot（测试用，不依赖真实数据层） */
const makeSession = (overrides = {}) => ({
  hasToken: true,
  hasSchoolCookies: true,
  studentId: '20240001',
  displayName: '测试学生',
  savedAtMs: Date.now(),
  ...overrides,
});

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

// ── 1. 枚举正确性 ────────────────────────────────────────────────────────────
{
  const statuses = Object.values(SeatStatus);
  eq(statuses.length, 7, "SeatStatus 枚举有 7 项");
  eq(statuses.includes('FREE'), true, "FREE 在枚举中");
  eq(statuses.includes('RESERVED_YOURS'), true, "RESERVED_YOURS 在枚举中");
  eq(statuses.includes('RESERVED_OTHERS'), true, "RESERVED_OTHERS 在枚举中");
  eq(statuses.includes('CHECKED_IN'), true, "CHECKED_IN 在枚举中");
  eq(statuses.includes('EXPIRED'), true, "EXPIRED 在枚举中");
  eq(statuses.includes('DEFAULTED'), true, "DEFAULTED 在枚举中");
  eq(statuses.includes('CANCELLED'), true, "CANCELLED 在枚举中");
}
{
  eq(Object.values(ReservationKind).includes('SINGLE'), true, "ReservationKind SINGLE");
  eq(Object.values(ReservationKind).includes('CONTINUOUS'), true, "ReservationKind CONTINUOUS");
  eq(Object.values(ReservationKind).includes('SEMINAR_ROOM'), true, "ReservationKind SEMINAR_ROOM");
}
{
  eq(Object.values(SignInKind).includes('NFC_QR'), true, "SignInKind NFC_QR");
  eq(Object.values(SignInKind).includes('GPS'), true, "SignInKind GPS");
  eq(Object.values(SignInKind).includes('SIMULATED'), true, "SignInKind SIMULATED");
}

// ── 2. DateTime 转换 ──────────────────────────────────────────────────────────
{
  const dt = { day: 20356, minutes: 480 };
  const ms = dateTimeToEpochMs(dt);
  const roundTrip = epochMsToDateTime(ms);
  eq(roundTrip.day, 20356, "epochDay 往返一致");
  eq(roundTrip.minutes, 480, "minutes 往返一致");
}
{
  const midnight = epochMsToDateTime(0);
  eq(midnight.day, 0, "epoch=0 → day=0");
  // epoch=0 = 1970-01-01 00:00 UTC = 1970-01-01 08:00 北京时间
  eq(midnight.minutes, 480, "epoch=0 → minutes=480 (北京时间 08:00)");
}

// ── 3. 时段计算 ───────────────────────────────────────────────────────────────
{
  const a = { day: 0, minutes: 0 };
  const b = { day: 0, minutes: 1440 };
  eq(minutesBetween(a, b), 1440, "跨天分钟差 = 1440");
}
{
  const start = { day: 0, minutes: 480 };
  const end = { day: 0, minutes: 600 };
  const dur = minutesBetween(start, end);
  eq(dur, 120, "2 小时 = 120 分钟");
  ok(dur > 0, "结束晚于开始 → 正数");
}
{
  const a = { day: 0, minutes: 600 };
  const b = { day: 0, minutes: 480 };
  eq(minutesBetween(a, b), -120, "反向差为负");
}

// ── 4. 时段重叠检测 ──────────────────────────────────────────────────────────
{
  const a1 = { day: 0, minutes: 480 };
  const a2 = { day: 0, minutes: 600 };
  const b1 = { day: 0, minutes: 500 };
  const b2 = { day: 0, minutes: 580 };
  ok(timeOverlap(a1, a2, b1, b2), "时段部分重叠 = true");
}
{
  const a1 = { day: 0, minutes: 480 };
  const a2 = { day: 0, minutes: 600 };
  const b1 = { day: 0, minutes: 600 };
  const b2 = { day: 0, minutes: 720 };
  ok(!timeOverlap(a1, a2, b1, b2), "端点接触不重叠 = false");
}
{
  const a1 = { day: 0, minutes: 480 };
  const a2 = { day: 0, minutes: 720 };
  const b1 = { day: 0, minutes: 540 };
  const b2 = { day: 0, minutes: 660 };
  ok(timeOverlap(a1, a2, b1, b2), "包含关系重叠 = true");
}
{
  const a1 = { day: 0, minutes: 480 };
  const a2 = { day: 0, minutes: 540 };
  const b1 = { day: 0, minutes: 600 };
  const b2 = { day: 0, minutes: 720 };
  ok(!timeOverlap(a1, a2, b1, b2), "无交集重叠 = false");
}

// ── 5. 预约 ID 生成 ───────────────────────────────────────────────────────────
{
  const id1 = generateReservationId();
  const id2 = generateReservationId();
  ok(id1.length === 16, "ID 长度 = 16");
  ok(id1 !== id2, "两次生成不同");
  ok(/^[0-9a-f]+$/.test(id1), "ID 为十六进制");
}

// ── 6. 座位类型名称 ──────────────────────────────────────────────────────────
{
  eq(seatTypeName(0), '区域', "type=0 → 区域");
  eq(seatTypeName(1), '楼层', "type=1 → 楼层");
  eq(seatTypeName(2), '座位', "type=2 → 座位");
  eq(seatTypeName(99), '未知', "type=99 → 未知");
}

// ── 7. 状态文案 ───────────────────────────────────────────────────────────────
{
  eq(statusText(SeatStatus.FREE), '空闲', "FREE → 空闲");
  eq(statusText(SeatStatus.RESERVED_YOURS), '已预约', "RESERVED_YOURS → 已预约");
  eq(statusText(SeatStatus.RESERVED_OTHERS), '被占', "RESERVED_OTHERS → 被占");
  eq(statusText(SeatStatus.CHECKED_IN), '签到中', "CHECKED_IN → 签到中");
  eq(statusText(SeatStatus.EXPIRED), '已过期', "EXPIRED → 已过期");
  eq(statusText(SeatStatus.DEFAULTED), '已违约', "DEFAULTED → 已违约");
  eq(statusText(SeatStatus.CANCELLED), '已取消', "CANCELLED → 已取消");
}

// ── 8. 状态颜色 ───────────────────────────────────────────────────────────────
{
  eq(statusColor(SeatStatus.FREE, false), '#4CAF50', "FREE 浅色绿");
  eq(statusColor(SeatStatus.RESERVED_OTHERS, false), '#E53935', "RESERVED_OTHERS 浅色红");
  eq(statusColor(SeatStatus.RESERVED_YOURS, false), '#1976D2', "RESERVED_YOURS 浅色蓝");
  eq(statusColor(SeatStatus.CHECKED_IN, false), '#43A047', "CHECKED_IN 浅色深绿");
  eq(statusColor(SeatStatus.DEFAULTED, false), '#FF5722', "DEFAULTED 浅色橙");
  eq(statusColor(SeatStatus.FREE, true), '#2E7D32', "FREE 深色绿");
  eq(statusColor(SeatStatus.RESERVED_YOURS, true), '#1565C0', "RESERVED_YOURS 深色蓝");
  eq(statusColor(SeatStatus.RESERVED_OTHERS, true), '#C62828', "RESERVED_OTHERS 深色红");
}

// ── 9. 签到紧急度 ─────────────────────────────────────────────────────────────
{
  const now = { day: 0, minutes: 530 };
  const deadline = { day: 0, minutes: 600 };
  eq(remainingSignInMinutes(deadline, now), 70, "剩余签到时间 = 70 分钟");
  ok(!isSignInUrgent(deadline, now), "70 分钟 > 10 → 不紧急");
}
{
  const now = { day: 0, minutes: 595 };
  const deadline = { day: 0, minutes: 600 };
  eq(remainingSignInMinutes(deadline, now), 5, "剩余签到时间 = 5 分钟");
  ok(isSignInUrgent(deadline, now), "5 分钟 ≤ 10 → 紧急");
}
{
  const now = { day: 0, minutes: 610 };
  const deadline = { day: 0, minutes: 600 };
  eq(remainingSignInMinutes(deadline, now), 0, "已过期 → 剩余 0");
  ok(!isSignInUrgent(deadline, now), "已过期 → 不判紧急");
}

// ── 10. 预约规则校验 ──────────────────────────────────────────────────────────
{
  const validReq = {
    seatId: 'seat_001',
    seatName: '文萃楼 101',
    startTime: { day: 0, minutes: 600 },
    endTime: { day: 0, minutes: 720 },
    kind: 'SINGLE',
  };
  const validSession = {
    hasToken: true, hasSchoolCookies: true,
    studentId: '20240001', displayName: '测试学生',
    savedAtMs: Date.now(),
  };
  const emptyReservations = [];
  const now = { day: 0, minutes: 480 };

  ok(validateReserveRequest(validReq, validSession, emptyReservations, now) === null, "合法请求 → 通过");

  const noTokenSession = { ...validSession, hasToken: false };
  ok(validateReserveRequest(validReq, noTokenSession, emptyReservations, now) !== null, "未登录 → 拒绝");

  const zeroDurReq = { ...validReq, endTime: { ...validReq.startTime } };
  ok(validateReserveRequest(zeroDurReq, validSession, emptyReservations, now) !== null, "零时长 → 拒绝");

  const maxReq = { ...validReq, startTime: { day: 0, minutes: 0 }, endTime: { day: 0, minutes: 481 } };
  ok(validateReserveRequest(maxReq, validSession, emptyReservations, now) !== null, `超过 ${MAX_RESERVATION_MINUTES} 分钟 → 拒绝`);

  const earlyReq = {
    ...validReq,
    startTime: { day: 0, minutes: now.minutes + MIN_RESERVATION_LEAD_MINUTES - 1 },
  };
  ok(validateReserveRequest(earlyReq, validSession, emptyReservations, now) !== null, `提前量不足 ${MIN_RESERVATION_LEAD_MINUTES} 分钟 → 拒绝`);

  const existing = [
    { seatId: 'seat_001', seatName: '', status: 'RESERVED_YOURS', reservationId: 'r1', otherName: null,
      timeRange: [{ day: 0, minutes: 500 }, { day: 0, minutes: 600 }], kind: 'SINGLE',
      signInKind: 'NFC_QR', signInDeadlineMinutes: 540, isCheckedIn: false },
    { seatId: 'seat_002', seatName: '', status: 'RESERVED_YOURS', reservationId: 'r2', otherName: null,
      timeRange: [{ day: 0, minutes: 540 }, { day: 0, minutes: 610 }], kind: 'SINGLE',
      signInKind: 'NFC_QR', signInDeadlineMinutes: 580, isCheckedIn: false },
    { seatId: 'seat_003', seatName: '', status: 'RESERVED_YOURS', reservationId: 'r3', otherName: null,
      timeRange: [{ day: 0, minutes: 590 }, { day: 0, minutes: 680 }], kind: 'SINGLE',
      signInKind: 'NFC_QR', signInDeadlineMinutes: 630, isCheckedIn: false },
  ];
  const overlapReq = { ...validReq, startTime: { day: 0, minutes: 590 }, endTime: { day: 0, minutes: 650 } };
  ok(validateReserveRequest(overlapReq, validSession, existing, now) !== null, `并发超 ${MAX_CONCURRENT_RESERVATIONS} → 拒绝`);
}

// ── 11. 违约判定 ──────────────────────────────────────────────────────────────
{
  const normal = {
    seatId: 's1', seatName: 'A101', status: 'RESERVED_YOURS', reservationId: 'r1',
    otherName: null, timeRange: [{ day: 1, minutes: 480 }, { day: 1, minutes: 600 }],
    kind: 'SINGLE', signInKind: 'NFC_QR', signInDeadlineMinutes: 540, isCheckedIn: false,
  };
  ok(!isDefaulted(normal, { day: 0, minutes: 1000 }), "未到期 → 不违约");
}
{
  const expired = {
    seatId: 's1', seatName: 'A101', status: 'RESERVED_YOURS', reservationId: 'r1',
    otherName: null, timeRange: [{ day: 0, minutes: 480 }, { day: 0, minutes: 600 }],
    kind: 'SINGLE', signInKind: 'NFC_QR', signInDeadlineMinutes: 540, isCheckedIn: false,
  };
  ok(isDefaulted(expired, { day: 0, minutes: 610 }), "已逾期 → 违约");
}
{
  const free = {
    seatId: 's1', seatName: 'A101', status: 'FREE', reservationId: null,
    otherName: null, timeRange: null, kind: 'SINGLE',
    signInKind: 'NFC_QR', signInDeadlineMinutes: null, isCheckedIn: false,
  };
  ok(!isDefaulted(free, { day: 0, minutes: 0 }), "FREE 状态 → 不违约");
}

// ── 12. 违约计数 ──────────────────────────────────────────────────────────────
{
  const records = [
    { date: -1, seatName: 'A101', reason: '未签到' },
    { date: -2, seatName: 'B202', reason: '未签到' },
    { date: -5, seatName: 'C303', reason: '未签到' },
  ];
  eq(countDefaults(records), 3, "违约计数 = 3");
  ok(!hitDefaultLimit(records), "3 < 5 → 未达上限");
}
{
  const records = Array(5).fill(null).map((_, i) => ({
    date: -(i + 1), seatName: `seat_${i}`, reason: '未签到',
  }));
  eq(countDefaults(records), 5, "违约计数 = 5");
  ok(hitDefaultLimit(records), "5 >= 5 → 达上限");
}
{
  eq(countDefaults([]), 0, "空记录 = 0");
  ok(!hitDefaultLimit([]), "0 < 5 → 未达上限");
}

// ── 13. 违约文案 ──────────────────────────────────────────────────────────────
{
  eq(defaultReasonText({ date: -1, seatName: '文萃楼 101', reason: '未签到' }),
    '预约「文萃楼 101」未按时签到 · 今天', "今天是违约文案");
  eq(defaultReasonText({ date: -3, seatName: '自习区 A', reason: '未签到' }),
    '预约「自习区 A」未按时签到 · 3 天前', "3 天前文案");
}

// ── 14. 统计计算 ──────────────────────────────────────────────────────────────
{
  const snapshots = [
    { seatId: 's1', seatName: 'A101', status: 'RESERVED_YOURS', reservationId: 'r1',
      otherName: null, timeRange: [{ day: 0, minutes: 480 }, { day: 0, minutes: 600 }],
      kind: 'SINGLE', signInKind: 'NFC_QR', signInDeadlineMinutes: 540, isCheckedIn: false },
    { seatId: 's2', seatName: 'A102', status: 'CHECKED_IN', reservationId: 'r2',
      otherName: null, timeRange: [{ day: 0, minutes: 600 }, { day: 0, minutes: 720 }],
      kind: 'SINGLE', signInKind: 'NFC_QR', signInDeadlineMinutes: 660, isCheckedIn: true },
    { seatId: 's3', seatName: 'A103', status: 'RESERVED_OTHERS', reservationId: null,
      otherName: '他人', timeRange: [{ day: 0, minutes: 480 }, { day: 0, minutes: 600 }],
      kind: 'SINGLE', signInKind: 'NFC_QR', signInDeadlineMinutes: null, isCheckedIn: false },
    { seatId: 's4', seatName: 'A104', status: 'FREE', reservationId: null,
      otherName: null, timeRange: null, kind: 'SINGLE',
      signInKind: 'NFC_QR', signInDeadlineMinutes: null, isCheckedIn: false },
  ];
  const defaults = [{ date: -1, seatName: 'A999', reason: '未签到' }];
  const stats = calcStats(snapshots, defaults);
  eq(stats.totalReserved, 2, "总预约数 = 2");
  eq(stats.activeReservations, 2, "活跃预约数 = 2");
  eq(stats.defaultedCount, 1, "违约数 = 1");
  eq(stats.maxDefaultsAllowed, 5, "最大违约上限 = 5");
}

// ── 结果 ───────────────────────────────────────────────────────────────────────
if (failed > 0) {
  console.error(`\nFAIL: ${failed} assertions failed`);
  process.exit(1);
}
console.log(`\nALL PASS  pass=${passed} fail=${failed}`);
