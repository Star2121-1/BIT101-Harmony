/**
 * 座位视图纯逻辑层测试（M9 UI 支撑）。
 *
 * 覆盖：
 * 1. 座位树 → 三级分组（校区/楼层/区域，孤儿容错）
 * 2. 座位快照 → 座位 VM + 汇总
 * 3. 预约时段选项 + 校验
 * 4. 我的预约抽取
 * 5. 违约展示
 * 6. 研讨间列表
 * 期望值全部对着 SeatViewLogic 的真实实现写（铁律 0②）。
 */

import { SeatTreeNode } from "../entry/src/main/ets/model/SeatTreeModel.ts";
import {
  groupTree, toSeatVM, summarizeSeats, fmtMinutes,
  buildSlotOptions, validateSlot, myReservations,
  buildViolationVM, seminarVMs,
} from "../entry/src/main/ets/corelogic/SeatViewLogic.ts";
import { SeatStatus } from "../entry/src/main/ets/corelogic/SeatLogic.ts";

let passed = 0;
let failed = 0;

function eq(actual, expected, name) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed++; return; }
  failed++;
  console.log("  FAIL " + name + "\n    expect " + e + "\n    got    " + a);
}
function ok(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.log("  FAIL " + name);
}

function node(id, name, type, parentId, imageUrl) {
  return new SeatTreeNode(id, name, type, parentId, imageUrl);
}

// ── 1. 座位树分组 ────────────────────────────────────────────────────────
{
  // 良乡(校区) → 1F(楼层, 带底图) / 2F → 1F: 自习区A/自习区B, 2F: 研讨区
  const nodes = [
    node('c1', '良乡', 0, null, null),
    node('f1', '1F', 0, 'c1', 'http://img/1f.png'),
    node('f2', '2F', 0, 'c1', null),
    node('a1', '自习区A', 1, 'f1', null),
    node('a2', '自习区B', 1, 'f1', null),
    node('a3', '研讨区', 1, 'f2', null),
  ];
  const g = groupTree(nodes);
  eq(g.length, 1, "1 个校区");
  eq(g[0].name, '良乡', "校区名");
  eq(g[0].floors.length, 2, "2 个楼层");
  // 楼层按名排序：1F < 2F
  eq(g[0].floors[0].name, '1F', "楼层排序 1F 在前");
  eq(g[0].floors[0].areas.length, 2, "1F 下 2 个区域");
  eq(g[0].floors[0].imageUrl, 'http://img/1f.png', "楼层带底图");
  // 区域按名排序
  eq(g[0].floors[0].areas[0].name, '自习区A', "区域排序 自习区A 在前");
}
{
  // 孤儿节点（parent 缺失）不进任何组
  const nodes = [
    node('c1', '良乡', 0, null, null),
    node('orphan', '孤儿区', 1, 'missing', null),
  ];
  const g = groupTree(nodes);
  eq(g[0].floors.length, 0, "孤儿节点被丢弃");
}
{
  // 空输入
  eq(groupTree([]), [], "空树 → 空数组");
}

// ── 2. 座位 VM + 汇总 ────────────────────────────────────────────────────
{
  const snap = {
    seatId: 's1', seatName: 'A01', status: SeatStatus.FREE,
    reservationId: null, otherName: null, timeRange: null,
    kind: 'SINGLE', signInKind: 'NFC_QR', signInDeadlineMinutes: null,
    isCheckedIn: false,
  };
  const vm = toSeatVM(snap);
  eq(vm.status, 'FREE', "空闲状态");
  eq(vm.statusText, '空闲', "空闲文案");
  eq(vm.reservable, true, "空闲可预约");
  eq(vm.isYours, false, "非自己的");
  eq(vm.timeText, '', "空闲无时段");
}
{
  const snap = {
    seatId: 's2', seatName: 'A02', status: SeatStatus.RESERVED_YOURS,
    reservationId: 'r1', otherName: null,
    timeRange: [{ day: 0, minutes: 480 }, { day: 0, minutes: 600 }],
    kind: 'SINGLE', signInKind: 'NFC_QR', signInDeadlineMinutes: 540,
    isCheckedIn: false,
  };
  const vm = toSeatVM(snap);
  eq(vm.reservable, false, "已预约不可再约");
  eq(vm.isYours, true, "是自己的预约");
  eq(vm.timeText, '08:00-10:00', "时段文案 08:00-10:00");
}
{
  const free = { seatId: '1', seatName: 'a', status: SeatStatus.FREE, reservationId: null,
    otherName: null, timeRange: null, kind: 'SINGLE', signInKind: 'NFC_QR',
    signInDeadlineMinutes: null, isCheckedIn: false };
  const yours = { seatId: '2', seatName: 'b', status: SeatStatus.RESERVED_YOURS, reservationId: 'r',
    otherName: null, timeRange: null, kind: 'SINGLE', signInKind: 'NFC_QR',
    signInDeadlineMinutes: null, isCheckedIn: false };
  const others = { seatId: '3', seatName: 'c', status: SeatStatus.RESERVED_OTHERS, reservationId: null,
    otherName: '张三', timeRange: null, kind: 'SINGLE', signInKind: 'NFC_QR',
    signInDeadlineMinutes: null, isCheckedIn: false };
  const sum = summarizeSeats([free, yours, others]);
  eq(sum.total, 3, "总数 3");
  eq(sum.free, 1, "空闲 1");
  eq(sum.yours, 1, "自己 1");
  eq(sum.others, 1, "他人 1");
  eq(sum.freeRatio, '空闲 1/3', "空闲率文案");
  eq(summarizeSeats([]).freeRatio, '暂无座位', "空座位汇总文案");
}
{
  eq(fmtMinutes(480), '08:00', "480 → 08:00");
  eq(fmtMinutes(0), '00:00', "0 → 00:00");
  eq(fmtMinutes(1439), '23:59', "1439 → 23:59");
  eq(fmtMinutes(1500), '01:00', "1500 归一化 → 01:00");
}

// ── 3. 时段选项 + 校验 ───────────────────────────────────────────────────
{
  const opt = buildSlotOptions(480, 30, 480);
  eq(opt.startSlots[0].label, '08:00', "开始时刻从 08:00 起");
  eq(opt.startSlots.length, (1440 - 480) / 30, "开始时刻数量");
  eq(opt.maxDuration, 480, "时长上限透传");
  ok(opt.endSlots.some(s => s.label === '08:00'), "结束时刻含 08:00");
}
{
  eq(validateSlot(480, 540, 480), '', "30 分钟合法");
  eq(validateSlot(480, 480, 480), '结束时刻必须晚于开始时刻', "结束=开始 报错");
  eq(validateSlot(480, 450, 480), '结束时刻必须晚于开始时刻', "结束早于开始 报错");
  eq(validateSlot(0, 1440, 480), '单次最长 8 小时（超出 1440 分钟）', "超时长上限");
  eq(validateSlot(480, 510, 480), '', "30 分钟合法（最小值）");
  eq(validateSlot(480, 495, 480), '单次至少 30 分钟', "15 分钟 不足 30 报错");
  eq(validateSlot(-1, 120, 480), '开始时刻无效', "开始时刻越界");
  eq(validateSlot(480, 1441, 480), '结束时刻无效', "结束时刻越界");
}

// ── 4. 我的预约抽取 ──────────────────────────────────────────────────────
{
  const active = { seatId: '1', seatName: 'A01', status: SeatStatus.RESERVED_YOURS,
    reservationId: 'r1', otherName: null,
    timeRange: [{ day: 0, minutes: 480 }, { day: 0, minutes: 600 }],
    kind: 'SINGLE', signInKind: 'NFC_QR', signInDeadlineMinutes: 540, isCheckedIn: false };
  const checked = { seatId: '2', seatName: 'A02', status: SeatStatus.CHECKED_IN,
    reservationId: 'r2', otherName: null,
    timeRange: [{ day: 0, minutes: 480 }, { day: 0, minutes: 600 }],
    kind: 'SINGLE', signInKind: 'NFC_QR', signInDeadlineMinutes: 540, isCheckedIn: true };
  const expired = { seatId: '3', seatName: 'A03', status: SeatStatus.RESERVED_YOURS,
    reservationId: 'r3', otherName: null,
    timeRange: [{ day: 0, minutes: 120 }, { day: 0, minutes: 180 }],
    kind: 'SINGLE', signInKind: 'NFC_QR', signInDeadlineMinutes: 150, isCheckedIn: false };
  const free = { seatId: '4', seatName: 'A04', status: SeatStatus.FREE,
    reservationId: null, otherName: null, timeRange: null,
    kind: 'SINGLE', signInKind: 'NFC_QR', signInDeadlineMinutes: null, isCheckedIn: false };
  // now = 08:00（480），active 还到 10:00（120 分钟），expired 到 03:00 已过
  const now = { day: 0, minutes: 480 };
  const mine = myReservations([active, checked, expired, free], now);
  eq(mine.length, 3, "3 条属于我（active+checked+expired）");
  // 按剩余分钟降序：active(120) > checked(120) > expired(0)
  const ids = mine.map(m => m.reservationId);
  ok(ids.indexOf('r3') > ids.indexOf('r1'), "已过期排后面");
  const r1 = mine.find(m => m.reservationId === 'r1');
  eq(r1.phase, 'active', "active 相位");
  eq(r1.remainingMin, 120, "剩余 120 分钟");
  eq(r1.cancellable, true, "未签到且未过期 → 可取消");
  const r2 = mine.find(m => m.reservationId === 'r2');
  eq(r2.cancellable, false, "已签到 → 不可取消");
  const r3 = mine.find(m => m.reservationId === 'r3');
  eq(r3.phase, 'expired', "已过期相位");
  eq(r3.cancellable, false, "已过期 → 不可取消");
}

// ── 5. 违约展示 ──────────────────────────────────────────────────────────
{
  const recs = [
    { id: 'v1', date: 100, seatNo: 'A01', areaName: '1F', reason: '未签到' },
    { id: 'v2', date: 99, seatNo: 'A02', areaName: '1F', reason: '未签到' },
    { id: 'v3', date: 60, seatNo: 'A03', areaName: '2F', reason: '未签到' }, // 40 天前，超 30 天 → 不计活跃
  ];
  const vm = buildViolationVM(recs, 100);
  eq(vm.countText, '2/5', "活跃违约 2/5");
  eq(vm.limitReached, false, "未达上限");
  eq(vm.items.length, 2, "2 条明细（30 天窗口）");
  ok(vm.items[0].indexOf('今天') >= 0, "最近的标「今天」");
}
{
  const five = [];
  for (let i = 0; i < 5; i++) {
    five.push({ id: 'v' + i, date: 100 - i, seatNo: 'A' + i, areaName: '1F', reason: '未签到' });
  }
  const vm = buildViolationVM(five, 100);
  eq(vm.countText, '5/5', "5/5 满上限");
  eq(vm.limitReached, true, "已达上限");
}

// ── 6. 研讨间列表 ───────────────────────────────────────────────────────
{
  const recs = [
    { id: 'sm1', nameMerge: '研讨间A-101', day: '2026-10-25', start: '14:00', end: '16:00', status: '2', statusName: '已预约' },
    { id: 'sm2', nameMerge: '研讨间B-202', day: '2026-10-24', start: '09:00', end: '10:00', status: '1', statusName: '已使用' },
  ];
  const vm = seminarVMs(recs);
  eq(vm.length, 2, "2 条研讨间");
  // 按时间文案排序：10-24 在前
  eq(vm[0].name, '研讨间B-202', "按时间升序");
  eq(vm[0].timeText, '2026-10-24 09:00-10:00', "时间文案");
  eq(vm[0].cancellable, false, "status=1 不可取消");
  eq(vm[1].cancellable, true, "status=2 可取消");
}

console.log("");
if (failed === 0) {
  console.log("ALL PASS  pass=" + passed + " fail=0");
} else {
  console.log("FAIL  pass=" + passed + " fail=" + failed);
  process.exit(1);
}
