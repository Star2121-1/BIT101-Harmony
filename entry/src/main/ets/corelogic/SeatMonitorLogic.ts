/**
 * 座位监控服务逻辑（M9-8） - 纯逻辑版本。
 *
 * 对照 Android SeatMonitorService：
 * - 后台轮询座位状态
 * - 发现空闲座位时自动预约
 * - 指数退避策略
 *
 * ## ⚠️ 鸿蒙限制
 * 鸿蒙不支持长时间运行的后台服务。
 * 本模块仅提供前台监控的逻辑实现，
 * 实际使用时需要结合后台 Task 机制或用户保持 App 在前台。
 *
 * ## 铁律 0.6
 * - 监控轮询由用户显式启动
 * - 停止监控由用户显式触发
 * - 绝不自动在后台执行预约操作
 */

import { ReservationTask, TaskMode, TaskStatus } from '../model/SeatTask.ts';
import { getTaskRepository } from '../data/SeatTaskStore.ts';
import { type ISeatService } from './ISeatService.ts';

/** 最大运行时长（2小时）。 */
const MAX_TASK_DURATION_MS = 2 * 60 * 60 * 1000;
/** 基础轮询间隔（10秒）。 */
const BASE_POLL_INTERVAL_MS = 10_000;
/** 优先模式轮询间隔（5秒）。 */
const PREFER_POLL_INTERVAL_MS = 5_000;
/** 最大轮询间隔（5分钟）。 */
const MAX_POLL_INTERVAL_MS = 5 * 60 * 1000;

/**
 * 启动座位监控任务。
 *
 * @param task 监控任务
 * @param seatService 座位服务（用于登录检查和预约）
 * @returns 是否启动成功
 */
export async function startSeatMonitor(task: ReservationTask, seatService: ISeatService): Promise<boolean> {
  const repo = getTaskRepository();

  // 先保存任务
  repo.addTask(task);

  // 检查是否已登录
  const isLoggedIn = await seatService.checkLoginStatus();
  if (!isLoggedIn) {
    repo.updateStatus(task.id, TaskStatus.FAILED, '未登录座位系统');
    return false;
  }

  // 开始轮询（前台运行）
  runPollingLoop(task, seatService);
  return true;
}

/**
 * 停止座位监控任务。
 */
export function stopSeatMonitor(taskId: string): void {
  const repo = getTaskRepository();
  const task = repo.getTask(taskId);
  if (!task) {
    return;
  }

  if (task.status === TaskStatus.RUNNING || task.status === TaskStatus.IDLE) {
    repo.updateStatus(taskId, TaskStatus.CANCELLED, '已手动停止');
  }
}

/**
 * 轮询循环（前台运行）。
 */
async function runPollingLoop(task: ReservationTask, seatService: ISeatService): Promise<void> {
  const repo = getTaskRepository();

  repo.updateStatus(task.id, TaskStatus.RUNNING, '开始监控...');

  const startTime = Date.now();
  let interval = task.mode === TaskMode.PREFER ? PREFER_POLL_INTERVAL_MS : BASE_POLL_INTERVAL_MS;

  while (Date.now() - startTime < MAX_TASK_DURATION_MS) {
    // 检查任务是否被取消
    const currentTask = repo.getTask(task.id);
    if (!currentTask || currentTask.status === TaskStatus.CANCELLED) {
      break;
    }

    try {
      // 获取可用座位
      const seats = await seatService.getAvailableSeats(task.areaId, task.segment, task.reserveDate);

      if (seats.length === 0) {
        repo.updateStatus(task.id, TaskStatus.RUNNING, '暂无空闲座位，继续监控...');
        interval = Math.min(interval * 2, MAX_POLL_INTERVAL_MS);
        await sleep(interval);
        continue;
      }

      // 根据模式选择目标座位
      let targetSeat = null;
      if (task.mode === TaskMode.PREFER) {
        // 优先模式：按偏好列表查找
        for (const preferredNo of task.preferredSeats) {
          targetSeat = seats.find(s => s.no === preferredNo);
          if (targetSeat) break;
        }
        // 如果没有偏好或没找到，取第一个空位
        if (!targetSeat && task.preferredSeats.length > 0) {
          targetSeat = seats[0];
        } else if (!targetSeat) {
          targetSeat = seats[0];
        }
      } else {
        // 监控模式：查找指定座位
        targetSeat = seats.find(s => s.no === task.seatNo);
      }

      if (!targetSeat) {
        repo.updateStatus(task.id, TaskStatus.RUNNING, '目标座位不可用，继续监控...');
        interval = Math.min(interval * 2, MAX_POLL_INTERVAL_MS);
        await sleep(interval);
        continue;
      }

      // 发现目标座位，尝试预约
      repo.markAttempt(task.id);
      repo.updateStatus(task.id, TaskStatus.RUNNING, `发现座位 ${targetSeat.no}，正在预约...`);

      const result = await seatService.confirmReservation(
        targetSeat.id,
        task.segment,
        task.startTime,
        task.endTime
      );

      if (result.ok) {
        repo.updateStatus(task.id, TaskStatus.SUCCESS, `预约成功，座位 ${targetSeat.no}`);
        return;
      } else {
        repo.updateStatus(task.id, TaskStatus.RUNNING, `预约失败（${result.message}），继续尝试...`);
        interval = Math.min(interval * 2, MAX_POLL_INTERVAL_MS);
        await sleep(interval);
      }
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

  // 超时停止
  repo.updateStatus(task.id, TaskStatus.FAILED, '已超过最长运行时长（2小时），任务自动停止');
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
