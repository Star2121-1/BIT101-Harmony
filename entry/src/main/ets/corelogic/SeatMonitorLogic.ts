/**
 * 座位监控服务逻辑（M9-8） - 纯逻辑版本。
 *
 * 对照 Android SeatMonitorService：
 * - 后台轮询座位状态
 * - 发现空闲座位时提示用户（**鸿蒙侧绝不自动预约**，见铁律 0.6）
 * - 指数退避策略
 *
 * ## ⚠️ 鸿蒙限制
 * 鸿蒙不支持长时间运行的后台服务。
 * 本模块仅提供前台监控的逻辑实现，
 * 实际使用时需要结合后台 Task 机制或用户保持 App 在前台。
 *
 * ## 铁律 0.6（与 Android 的刻意差异）
 * - 监控轮询由用户显式启动
 * - 停止监控由用户显式触发
 * - **发现空位只记录（FOUND 态），绝不自动预约** ——
 *   Android 的 SeatMonitorService 会在前台服务里自动 confirm，但鸿蒙 M9-8 的
 *   验收标准是「发现空位并提示」，且预约是对外副作用动作：
 *   必须由用户在界面上点「去预约」二次确认后才发生。
 *   （`confirmMonitoredSeat` 就是那个唯一入口。）
 */

import type { ReservationTask } from '../model/SeatTask.ts';
import { TaskMode, TaskStatus, isTerminalStatus } from '../model/SeatTask.ts';
import { getTaskRepository } from '../data/SeatTaskStore.ts';
import { type ISeatService } from './ISeatService.ts';
import { decideNext, type MonitorSeat } from './SeatMonitorPolicy.ts';
import { isForegroundNow } from '../core/AppForegroundState.ts';

/** 最大运行时长（2小时）。 */
const MAX_TASK_DURATION_MS = 2 * 60 * 60 * 1000;
/** 基础轮询间隔（10秒）。 */
const BASE_POLL_INTERVAL_MS = 10_000;
/** 优先模式轮询间隔（5秒）。 */
const PREFER_POLL_INTERVAL_MS = 5_000;
/** 最大轮询间隔（5分钟）。 */
const MAX_POLL_INTERVAL_MS = 5 * 60 * 1000;

/** 正在运行的轮询循环（防重入：同一任务不重复起第二个循环）。 */
const runningLoops = new Set<string>();

/**
 * 启动座位监控任务。
 *
 * @param task 监控任务
 * @param seatService 座位服务（用于登录检查和预约）
 * @returns 是否启动成功
 */
export async function startSeatMonitor(task: ReservationTask, seatService: ISeatService): Promise<boolean> {
  const repo = getTaskRepository();

  // 防重入：同一任务已在轮询循环中，不再起第二个
  if (runningLoops.has(task.id)) {
    return true;
  }

  const existing = repo.getTask(task.id);
  if (existing === null) {
    // 先保存任务
    repo.addTask(task);
  } else if (isTerminalStatus(existing.status)) {
    // 终态任务不能从原 id 直接重启（SUCCESS/FAILED/CANCELLED）
    return false;
  }

  // 检查是否已登录
  const isLoggedIn = await seatService.checkLoginStatus();
  if (!isLoggedIn) {
    repo.updateStatus(task.id, TaskStatus.FAILED, '未登录座位系统');
    return false;
  }

  // 开始轮询（前台运行）
  runningLoops.add(task.id);
  runPollingLoop(task, seatService);
  return true;
}

/**
 * 恢复监控（M9-8 前台生命周期）：App 回到前台后，用户点「继续监控」时调用。
 * 仅对活跃/暂停（IDLE/RUNNING/FOUND）态任务生效；终态与已运行的防重入。
 */
export function resumeMonitor(taskId: string, seatService: ISeatService): void {
  const repo = getTaskRepository();
  const task = repo.getTask(taskId);
  if (task === null || isTerminalStatus(task.status) || runningLoops.has(taskId)) {
    return;
  }
  runningLoops.add(taskId);
  runPollingLoop(task, seatService);
}

/**
 * 停止座位监控任务。
 * FOUND 态（等用户确认）也停——用户显式点了停止。
 */
export function stopSeatMonitor(taskId: string): void {
  const repo = getTaskRepository();
  const task = repo.getTask(taskId);
  if (!task) {
    return;
  }

  if (task.status === TaskStatus.RUNNING || task.status === TaskStatus.IDLE ||
      task.status === TaskStatus.FOUND) {
    repo.updateStatus(taskId, TaskStatus.CANCELLED, '已手动停止');
  }
}

/**
 * 用户显式确认预约（铁律 0.6 的唯一预约入口）。
 *
 * 轮询发现空位后任务停在 FOUND 态；只有用户点「去预约」才会走到这里。
 * 确认成功后任务转 SUCCESS；失败转 FAILED（消息带服务端真话）。
 */
export async function confirmMonitoredSeat(taskId: string, seatService: ISeatService): Promise<boolean> {
  const repo = getTaskRepository();
  const task = repo.getTask(taskId);
  if (task === null || task.status !== TaskStatus.FOUND || task.foundSeatId.length === 0) {
    return false;
  }

  repo.updateStatus(taskId, TaskStatus.RUNNING, '正在预约 ' + task.foundSeatNo + '…');
  const result = await seatService.confirmReservation(
    task.foundSeatId,
    task.segment,
    task.startTime,
    task.endTime
  );

  if (result.ok) {
    repo.updateStatus(taskId, TaskStatus.SUCCESS, '预约成功，座位 ' + task.foundSeatNo);
    return true;
  }
  repo.updateStatus(taskId, TaskStatus.FAILED, '预约失败：' + result.message);
  return false;
}

/**
 * 轮询循环（前台运行）。
 */
async function runPollingLoop(task: ReservationTask, seatService: ISeatService): Promise<void> {
  const repo = getTaskRepository();

  repo.updateStatus(task.id, TaskStatus.RUNNING, '开始监控...');

  const startTime = Date.now();
  let interval = task.mode === TaskMode.PREFER ? PREFER_POLL_INTERVAL_MS : BASE_POLL_INTERVAL_MS;

  try {
    while (Date.now() - startTime < MAX_TASK_DURATION_MS) {
      // 检查任务是否被取消
      const currentTask = repo.getTask(task.id);
      if (!currentTask || currentTask.status === TaskStatus.CANCELLED) {
        break;
      }

      // 前台监控铁律：App 退后台立即暂停轮询，避免后台抢座（鸿蒙限制 + 铁律 0.6）。
      // 任务保留 RUNNING 态，由 UI 状态条明确提示「已暂停」，回前台后用户点「继续监控」恢复。
      if (!isForegroundNow()) {
        repo.updateStatus(task.id, TaskStatus.RUNNING, 'App 在后台，监控已暂停（回到前台后点「继续监控」）');
        break;
      }

      try {
        // 获取可用座位
        const seats = await seatService.getAvailableSeats(
          task.areaId, task.segment, task.reserveDate, task.startTime, task.endTime
        );

        // 决策完全交给纯函数 decideNext（铁律 0.6 守卫）：
        // 返回值只有 WAIT / FOUND 两种，不存在「自动预约」分支；
        // 要预约只能走 confirmMonitoredSeat（用户显式点击）。
        const decision = decideNext(task, seats.map(s => ({ id: s.id, no: s.no })));
        if (decision.kind === 'WAIT') {
          repo.updateStatus(task.id, TaskStatus.RUNNING, '暂无空闲座位，继续监控...');
          interval = Math.min(interval * 2, MAX_POLL_INTERVAL_MS);
          await sleep(interval);
          continue;
        }

        // FOUND：**只记录，不预约**（铁律 0.6）。任务转 FOUND 态停在这里，
        // 等用户在界面上点「去预约」（confirmMonitoredSeat 是唯一预约入口）。
        repo.markFound(task.id, decision.seat.id, decision.seat.no);
        return;
      } catch (e) {
        // 处理认证失效
        const errorMsg = String(e);
        if (errorMsg.includes('TOKEN_EXPIRED') || errorMsg.includes('未登录')) {
          repo.stopAll('登录已失效，请重新登录');
          return;
        }

        repo.updateStatus(task.id, TaskStatus.RUNNING, `查询失败，${Math.floor(interval / 1000)}秒后重试...`);
        interval = Math.min(interval * 2, MAX_POLL_INTERVAL_MS);
        await sleep(interval);
      }
    }
  } finally {
    // 无论正常结束 / 取消 / 后台暂停 / 超时 / 异常，都清理运行标记，允许后续 resume
    runningLoops.delete(task.id);
  }

  // 超时收尾：仅当确实跑满时长且仍处活跃态（未被取消、未后台暂停、未发现空位）
  const cur = repo.getTask(task.id);
  if (cur !== null && cur.status === TaskStatus.RUNNING && Date.now() - startTime >= MAX_TASK_DURATION_MS) {
    repo.updateStatus(task.id, TaskStatus.FAILED, '已超过最长运行时长（2小时），任务自动停止');
  }
}

/**
 * 睡眠函数。
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 获取监控状态信息。
 */
export interface MonitorStatus {
  isRunning: boolean;
  activeTaskCount: number;
  lastAttemptTime: number | null;
  attempts: number;
}

export function getMonitorStatus(): MonitorStatus {
  const repo = getTaskRepository();
  const activeTasks = repo.getActiveTasks();

  let lastAttemptTime: number | null = null;
  let totalAttempts = 0;

  activeTasks.forEach(task => {
    totalAttempts += task.attempts;
    if (task.lastAttemptAt > (lastAttemptTime ?? 0)) {
      lastAttemptTime = task.lastAttemptAt;
    }
  });

  return {
    isRunning: activeTasks.length > 0,
    activeTaskCount: activeTasks.length,
    lastAttemptTime,
    attempts: totalAttempts,
  };
}
