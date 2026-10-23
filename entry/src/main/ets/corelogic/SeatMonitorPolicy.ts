/**
 * 座位监控的**纯决策逻辑**（M9-8，铁律 0.6 的可证伪守卫）。
 *
 * 为什么单独拆一个文件：`SeatMonitorLogic` 要 import `SeatTaskStore` → `Prefs`
 * （@kit.ArkData），Node 单测 import 不了。而「发现空位后怎么办」这条规则
 * （**只记录、绝不自动预约**）恰恰是最容易被后人「顺手改回自动约」的地方，
 * 必须有一条能跑的断言钉住它。
 *
 * 本文件**零 @kit 依赖**，Node 直接跑。

/** 轮询看到的一个空位（最小字段：id 供确认预约用，no 供展示用）。 */
export interface MonitorSeat {
  id: string;
  no: string;
}

/** 轮询决策。 */
export type MonitorDecision =
  /** 没找到目标，继续等（调用方负责退避 sleep）。 */
  | { kind: 'WAIT' }
  /** 找到目标空位：**只报告，不预约**（铁律 0.6；由用户显式确认后才约）。 */
  | { kind: 'FOUND'; seat: MonitorSeat };

import type { ReservationTask } from '../model/SeatTask.ts';
import { TaskMode } from '../model/SeatTask.ts';

/**
 * 这一轮轮询该干什么。
 *
 * 选座规则（对齐 Android SeatMonitorService 的挑选逻辑）：
 * - PREFER：按偏好列表顺序找，找不到就取第一个空位；
 * - MONITOR：只认任务指定的 seatNo；
 * - 其余模式：取第一个空位。
 *
 * ⚠️ 无论哪种模式，返回值只有 WAIT / FOUND 两种——
 * **没有「自动预约」这个选项**。要预约只能走 `confirmMonitoredSeat`
 *（用户显式点击）。这个类型就是守卫：加一个 auto-confirm 分支
 * 会直接改变返回类型，编译期就看得见。
 */
export function decideNext(task: ReservationTask, seats: MonitorSeat[]): MonitorDecision {
  if (seats.length === 0) {
    return { kind: 'WAIT' };
  }

  let target: MonitorSeat | null = null;
  if (task.mode === TaskMode.PREFER) {
    for (const preferredNo of task.preferredSeats) {
      target = seats.find(s => s.no === preferredNo) ?? null;
      if (target !== null) break;
    }
    if (target === null) {
      target = seats[0];
    }
  } else if (task.mode === TaskMode.MONITOR) {
    target = seats.find(s => s.no === task.seatNo) ?? null;
  } else {
    target = seats[0];
  }

  if (target === null) {
    return { kind: 'WAIT' };
  }
  return { kind: 'FOUND', seat: target };
}
