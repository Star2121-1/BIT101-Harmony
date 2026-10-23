// M9-8 前台生命周期单测：AppForegroundState + SeatMonitorLogic 前台暂停/恢复
// 运行：node --experimental-transform-types tools/test-appforeground.mjs

import { AppForegroundState, isForegroundNow, setForeground } from '../entry/src/main/ets/core/AppForegroundState.ts';
import { startSeatMonitor, resumeMonitor, stopSeatMonitor } from '../entry/src/main/ets/corelogic/SeatMonitorLogic.ts';
import { getTaskRepository } from '../entry/src/main/ets/data/SeatTaskStore.ts';
import { createTask, TaskMode, TaskStatus } from '../entry/src/main/ets/model/SeatTask.ts';

let pass = 0;
let fail = 0;
function ok(cond, name) {
  if (cond) {
    pass++;
    console.log('  ✓ ' + name);
  } else {
    fail++;
    console.error('  ✗ ' + name);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // 重置前台状态，避免污染
  setForeground(true);
  const repo = getTaskRepository();
  await repo.init();

  // 1) AppForegroundState 通知语义
  setForeground(false);
  ok(isForegroundNow() === false, 'setForeground(false) → isForegroundNow false');
  let changed = 0;
  const off = AppForegroundState.get().onChange(() => { changed++; });
  setForeground(true);
  ok(changed === 1, '值变化触发一次 onChange');
  setForeground(true);
  ok(changed === 1, '值不变不重复通知');
  setForeground(false);
  ok(changed === 2, '再次变化再触发一次');
  off();
  setForeground(false);
  ok(changed === 2, '取消订阅后不再触发');

  // 2) 后台启动监控：轮询循环应 break，任务保留 RUNNING 且 message 标记「已暂停」
  setForeground(false);
  const svc = {
    checkLoginStatus: async () => true,
    getAvailableSeats: async () => [], // 后台分支不会调用，给保底 stub
    confirmReservation: async () => ({ ok: true, message: '' }),
  };
  const task = createTask(TaskMode.MONITOR, 'a1', 'seg1', '005', '2026-10-24', '08:00', '22:30', '', '1楼', 'A区');
  const okStart = await startSeatMonitor(task, svc);
  ok(okStart === true, '后台启动也返回 true（已登记任务）');
  const t1 = repo.getTask(task.id);
  ok(t1 !== null, '任务已登记到仓库');
  ok(t1.status === TaskStatus.RUNNING, '后台启动后状态 RUNNING（保留，由 UI 状态条提示已暂停）');
  ok(t1.message.includes('已暂停'), '后台启动后 message 标记「已暂停」');

  // 3) resume 终态不应重启
  repo.updateStatus(task.id, TaskStatus.SUCCESS, '预约成功');
  resumeMonitor(task.id, svc);
  ok(repo.getTask(task.id).status === TaskStatus.SUCCESS, '终态任务 resume 不被重启');

  // 4) 前台恢复：回到前台后启动能进入轮询（WAIT 分支保持 RUNNING）
  setForeground(true);
  const task2 = createTask(TaskMode.MONITOR, 'a2', 'seg2', '006', '2026-10-24', '08:00', '22:30', '', '2楼', 'B区');
  await startSeatMonitor(task2, svc);
  await sleep(80);
  const t2 = repo.getTask(task2.id);
  ok(t2.status === TaskStatus.RUNNING, '前台启动后进入轮询（WAIT 分支保持 RUNNING）');
  stopSeatMonitor(task2.id);
  await sleep(20);
  ok(repo.getTask(task2.id).status === TaskStatus.CANCELLED, 'stopSeatMonitor 能终止轮询（CANCELLED）');

  console.log(`\n[appforeground] pass=${pass} fail=${fail}`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
