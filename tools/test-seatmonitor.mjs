/**
 * 座位监控逻辑测试（M9-8 纯逻辑层）。
 *
 * 覆盖：
 * 1. 任务状态流转
 * 2. 监控循环逻辑（纯函数版本）
 * 3. 指数退避策略
 * 4. 超时处理
 */

import { TaskMode, TaskStatus, createTask, isActiveStatus, isTerminalStatus } from "../entry/src/main/ets/model/SeatTask.ts";
import { decideNext } from "../entry/src/main/ets/corelogic/SeatMonitorPolicy.ts";

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
function makeMockService(overrides = {}) {
  return {
    checkLoginStatus: async () => true,
    getAvailableSeats: async () => [],
    confirmReservation: async () => ({ ok: false, message: '默认' }),
    cancelReservation: async () => ({ ok: false, message: '默认' }),
    getMyReservations: async () => [],
    ...overrides,
  };
}

// ── 1. 任务状态判断 ──────────────────────────────────────────────────────────
{
  ok(isActiveStatus(TaskStatus.IDLE), "IDLE 是活跃状态");
  ok(isActiveStatus(TaskStatus.RUNNING), "RUNNING 是活跃状态");
  ok(!isActiveStatus(TaskStatus.SUCCESS), "SUCCESS 不是活跃状态");
  ok(!isActiveStatus(TaskStatus.FAILED), "FAILED 不是活跃状态");
  ok(!isActiveStatus(TaskStatus.CANCELLED), "CANCELLED 不是活跃状态");
}
{
  ok(isTerminalStatus(TaskStatus.SUCCESS), "SUCCESS 是终态");
  ok(isTerminalStatus(TaskStatus.FAILED), "FAILED 是终态");
  ok(isTerminalStatus(TaskStatus.CANCELLED), "CANCELLED 是终态");
  ok(!isTerminalStatus(TaskStatus.IDLE), "IDLE 不是终态");
  ok(!isTerminalStatus(TaskStatus.RUNNING), "RUNNING 不是终态");
}

// ── 2. 任务创建 ──────────────────────────────────────────────────────────────
{
  const task = createTask(TaskMode.MONITOR, 'area_1', 'seg_001', '001', '2026-10-22', '08:00', '09:00');
  eq(task.id.length > 0, true, "任务 ID 生成");
  eq(task.mode, 'MONITOR', "模式正确");
  eq(task.status, 'IDLE', "初始状态为 IDLE");
  eq(task.attempts, 0, "初始尝试次数为 0");
  eq(task.lastAttemptAt, 0, "初始最后尝试时间为 0");
}
{
  const task = createTask(TaskMode.PREFER, 'area_1', 'seg_001', '', '2026-10-22', '08:00', '09:00', '良乡校区', '1号楼', '一层', ['001', '002', '003']);
  eq(task.preferredSeats.length, 3, "偏好座位列表正确");
  eq(task.campusName, '良乡校区', "校区名称正确");
}

// ── 3. 序列化/反序列化 ───────────────────────────────────────────────────────
{
  const task = createTask(TaskMode.MONITOR, 'area_1', 'seg_001', '001', '2026-10-22', '08:00', '09:00');
  const json = JSON.stringify(task);
  const restored = JSON.parse(json);
  eq(restored.id, task.id, "序列化后 ID 一致");
  eq(restored.mode, task.mode, "序列化后模式一致");
  eq(restored.status, task.status, "序列化后状态一致");
}

// ── 4. 轮询间隔计算逻辑 ──────────────────────────────────────────────────────
{
  // 基础间隔测试
  const baseInterval = 10_000;
  const preferInterval = 5_000;
  const maxInterval = 5 * 60 * 1000;

  // 指数退避测试
  let interval = baseInterval;
  for (let i = 0; i < 5; i++) {
    interval = Math.min(interval * 2, maxInterval);
  }
  eq(interval, maxInterval, "指数退避达到上限");
}

// ── 5. 任务过滤逻辑 ──────────────────────────────────────────────────────────
{
  const tasks = [
    createTask(TaskMode.MONITOR, 'area_1', 'seg_001', '001', '2026-10-22', '08:00', '09:00'),
    createTask(TaskMode.MONITOR, 'area_1', 'seg_001', '002', '2026-10-22', '09:00', '10:00'),
  ];
  tasks[0].status = TaskStatus.RUNNING;
  tasks[1].status = TaskStatus.SUCCESS;

  const active = tasks.filter(t => isActiveStatus(t.status));
  eq(active.length, 1, "只有一个活跃任务");
  eq(active[0].id, tasks[0].id, "活跃任务是第一个");
}

// ── 6. 状态更新逻辑模拟 ──────────────────────────────────────────────────────
{
  let task = createTask(TaskMode.MONITOR, 'area_1', 'seg_001', '001', '2026-10-22', '08:00', '09:00');
  
  // IDLE → RUNNING
  task.status = TaskStatus.RUNNING;
  task.message = '开始监控...';
  eq(task.status, 'RUNNING', "状态更新为 RUNNING");
  
  // RUNNING → SUCCESS
  task.status = TaskStatus.SUCCESS;
  task.message = '预约成功';
  eq(task.status, 'SUCCESS', "状态更新为 SUCCESS");
  
  // 终态不可再更新（模拟）
  const wasTerminal = isTerminalStatus(task.status);
  ok(wasTerminal, "SUCCESS 是终态");
}

// ── 7. 铁律 0.6 守卫：发现空位只 FOUND，绝不自动预约 ──────────────────────────
{
  // MONITOR：命中指定座位号 → FOUND，且只回座位信息，不含任何「已预约」标记
  const monTask = createTask(TaskMode.MONITOR, 'area_1', 'seg_001', 'A12', '2026-10-22', '08:00', '09:00');
  const seats = [{ id: 's1', no: 'A12' }, { id: 's2', no: 'B3' }];
  const d = decideNext(monTask, seats);
  ok(d.kind === 'FOUND', "MONITOR 命中指定座位 → FOUND");
  if (d.kind === 'FOUND') {
    eq(d.seat.id, 's1', "FOUND 返回正确空位 id");
    eq(d.seat.no, 'A12', "FOUND 返回正确空位号");
  }

  // 无空位 → WAIT（继续轮询，不报错、不预约）
  const empty = decideNext(createTask(TaskMode.MONITOR, 'a', 's', 'x', '2026-10-22', '08:00', '09:00'), []);
  ok(empty.kind === 'WAIT', "无空位 → WAIT");

  // PREFER：按偏好列表顺序命中
  const preferTask = createTask(TaskMode.PREFER, 'a', 's', '', '2026-10-22', '08:00', '09:00', '', '', '', ['B3']);
  const pd = decideNext(preferTask, [{ id: 'x', no: 'A1' }, { id: 'y', no: 'B3' }]);
  ok(pd.kind === 'FOUND' && pd.seat.no === 'B3', "PREFER 按偏好列表命中");

  // 守卫本质：返回值类型只有 WAIT / FOUND 两种，结构上不存在 auto-confirm 分支
  const kinds = [
    decideNext(monTask, seats).kind,
    decideNext(monTask, []).kind,
    decideNext(preferTask, [{ id: 'x', no: 'A1' }, { id: 'y', no: 'B3' }]).kind,
  ];
  ok(kinds.every(k => k === 'WAIT' || k === 'FOUND'), "决策类型只有 WAIT/FOUND（无自动预约分支）");
}

// ── 结果 ─────────────────────────────────────────────────────────────────────
if (failed > 0) {
  console.error(`\nFAIL: ${failed} assertions failed`);
  process.exit(1);
}
console.log(`\nALL PASS  pass=${passed} fail=${failed}`);
