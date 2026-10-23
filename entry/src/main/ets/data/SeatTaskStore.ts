/**
 * 座位监控任务仓库（M9-8）。
 *
 * 对照 Android SeatTaskRepository：
 * - 管理预约任务的生命周期
 * - 支持持久化（Prefs，沙箱 EL2 preferences）
 * - 提供增删改查接口
 *
 * ## ⚠️ 鸿蒙限制说明
 * 由于鸿蒙后台任务限制（最长 2 分钟），无法实现真正的后台轮询。
 * 本仓库只负责数据的持久化和状态管理，实际的轮询逻辑需要
 * 在前台 Service 或 Worker 中实现。
 */

import { ReservationTask, TaskStatus, isActiveStatus, isTerminalStatus, serializeTasks, deserializeTasks } from '../model/SeatTask.ts';
import { Prefs } from './Prefs.ts';
import { info, warn } from '../core/log/BitLog.ts';

const STORAGE_KEY = 'seat_tasks_v1';

/**
 * 座位监控任务仓库。
 *
 * 提供任务的增删改查和持久化功能。
 */
export class SeatTaskRepository {
  private tasks: ReservationTask[] = [];
  private loaded: boolean = false;
  private onChangeCallbacks: Array<() => void> = [];

  /**
   * 初始化仓库，从存储加载数据。
   */
  async init(): Promise<void> {
    if (this.loaded) return;

    try {
      const stored = await this.loadFromStorage();
      if (stored && stored.length > 0) {
        this.tasks = stored;
        info('SeatTaskRepository', `Loaded ${stored.length} tasks from storage`);
      }
    } catch (e) {
      warn('SeatTaskRepository', `Failed to load tasks: ${e}`);
    }

    this.loaded = true;
  }

  /**
   * 获取所有任务。
   */
  getTasks(): ReservationTask[] {
    return [...this.tasks];
  }

  /**
   * 获取活跃任务（IDLE 或 RUNNING 状态）。
   */
  getActiveTasks(): ReservationTask[] {
    return this.tasks.filter(t => isActiveStatus(t.status));
  }

  /**
   * 获取单个任务。
   */
  getTask(id: string): ReservationTask | null {
    return this.tasks.find(t => t.id === id) ?? null;
  }

  /**
   * 添加新任务。
   */
  addTask(task: ReservationTask): void {
    this.tasks.push(task);
    this.persist();
    this.notifyChange();
    info('SeatTaskRepository', `Added task ${task.id}`);
  }

  /**
   * 更新任务状态。
   *
   * @param id 任务 ID
   * @param status 新状态
   * @param message 状态消息
   */
  updateStatus(id: string, status: TaskStatus, message: string): void {
    const task = this.tasks.find(t => t.id === id);
    if (!task || isTerminalStatus(task.status)) {
      return;
    }

    task.status = status;
    task.message = message;
    this.persist();
    this.notifyChange();
    info('SeatTaskRepository', `Updated task ${id} to ${status}: ${message}`);
  }

  /**
   * 标记发现空位（铁律 0.6：只记录，绝不自动预约）。
   * 轮询循环看到 FOUND 态即退出；之后由用户显式确认预约。
   */
  markFound(id: string, seatId: string, seatNo: string): void {
    const task = this.tasks.find(t => t.id === id);
    if (!task || isTerminalStatus(task.status)) {
      return;
    }

    task.status = TaskStatus.FOUND;
    task.foundSeatId = seatId;
    task.foundSeatNo = seatNo;
    task.message = '发现空位 ' + seatNo + '，等待确认';
    this.persist();
    this.notifyChange();
    info('SeatTaskRepository', `Task ${id} found seat ${seatNo} (${seatId}), awaiting user confirm`);
  }

  /**
   * 取消任务。
   */
  cancelTask(id: string): void {
    const task = this.tasks.find(t => t.id === id);
    if (!task || isTerminalStatus(task.status)) {
      return;
    }

    task.status = TaskStatus.CANCELLED;
    task.message = '已手动取消';
    this.persist();
    this.notifyChange();
    info('SeatTaskRepository', `Cancelled task ${id}`);
  }

  /**
   * 记录一次尝试。
   *
   * 用于监控任务，表明服务仍在运行。
   */
  markAttempt(id: string): void {
    const task = this.tasks.find(t => t.id === id);
    if (!task || isTerminalStatus(task.status)) {
      return;
    }

    task.attempts += 1;
    task.lastAttemptAt = Date.now();
    this.persist();
    info('SeatTaskRepository', `Marked attempt for task ${id}, total: ${task.attempts}`);
  }

  /**
   * 清除所有终态任务。
   */
  clearFinished(): number {
    const before = this.tasks.length;
    this.tasks = this.tasks.filter(t => !isTerminalStatus(t.status));
    const removed = before - this.tasks.length;
    if (removed > 0) {
      this.persist();
      this.notifyChange();
    }
    return removed;
  }

  /**
   * 删除单个任务。
   */
  remove(id: string): void {
    const before = this.tasks.length;
    this.tasks = this.tasks.filter(t => t.id !== id);
    if (this.tasks.length < before) {
      this.persist();
      this.notifyChange();
    }
  }

  /**
   * 终止所有活跃任务。
   *
   * 用于认证失效等场景。FOUND 态（等用户确认）也一并终止——
   * 登录都没了，那个空位确认也无从谈起。
   */
  stopAll(reason: string): void {
    let changed = false;
    this.tasks.forEach(task => {
      if (isActiveStatus(task.status) || task.status === TaskStatus.FOUND) {
        task.status = TaskStatus.FAILED;
        task.message = reason;
        changed = true;
      }
    });
    if (changed) {
      this.persist();
      this.notifyChange();
    }
  }

  /**
   * 注册状态变化回调。
   */
  onChange(callback: () => void): () => void {
    this.onChangeCallbacks.push(callback);
    return () => {
      this.onChangeCallbacks = this.onChangeCallbacks.filter(cb => cb !== callback);
    };
  }

  /**
   * 通知状态变化。
   */
  private notifyChange(): void {
    this.onChangeCallbacks.forEach(cb => cb());
  }

  /**
   * 持久化到 Prefs（对照 Android DataStore；原 globalThis.prefs 写法 ArkTS 禁 globalThis）。
   */
  private async persist(): Promise<void> {
    try {
      const json = serializeTasks(this.tasks);
      await Prefs.putString(STORAGE_KEY, json);
    } catch (e) {
      warn('SeatTaskRepository', `Failed to persist tasks: ${e}`);
    }
  }

  /**
   * 从 Prefs 加载。
   */
  private async loadFromStorage(): Promise<ReservationTask[] | null> {
    try {
      const json = await Prefs.getString(STORAGE_KEY, '');
      if (!json || json.trim() === '') {
        return null;
      }
      return deserializeTasks(json);
    } catch (e) {
      warn('SeatTaskRepository', `Failed to load from storage: ${e}`);
      return null;
    }
  }
}

// 单例
let instance: SeatTaskRepository | null = null;

export function getTaskRepository(): SeatTaskRepository {
  if (!instance) {
    instance = new SeatTaskRepository();
  }
  return instance;
}
