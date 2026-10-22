/**
 * 座位监控任务模型（M9-8）。
 *
 * 对照 Android Task.kt：
 * - TaskMode: SINGLE/MONITOR/PREFER
 * - TaskStatus: IDLE/RUNNING/SUCCESS/FAILED/CANCELLED
 * - ReservationTask: 任务数据模型
 */

/** 任务模式。 */
export const TaskMode = {
  /** 单次预约（手动触发）。 */
  SINGLE: 'SINGLE',
  /** 监控模式（自动轮询指定座位）。 */
  MONITOR: 'MONITOR',
  /** 优先模式（按偏好列表依次尝试）。 */
  PREFER: 'PREFER',
} as const;

export type TaskMode = (typeof TaskMode)[keyof typeof TaskMode];

/** 任务状态。 */
export const TaskStatus = {
  /** 空闲（等待开始）。 */
  IDLE: 'IDLE',
  /** 运行中。 */
  RUNNING: 'RUNNING',
  /** 成功。 */
  SUCCESS: 'SUCCESS',
  /** 失败。 */
  FAILED: 'FAILED',
  /** 已取消。 */
  CANCELLED: 'CANCELLED',
} as const;

export type TaskStatus = (typeof TaskStatus)[keyof typeof TaskStatus];

/** 任务是否处于活跃状态。 */
export function isActiveStatus(status: TaskStatus): boolean {
  return status === TaskStatus.IDLE || status === TaskStatus.RUNNING;
}

/** 任务是否处于终态。 */
export function isTerminalStatus(status: TaskStatus): boolean {
  return status === TaskStatus.SUCCESS ||
         status === TaskStatus.FAILED ||
         status === TaskStatus.CANCELLED;
}

/**
 * 预约任务。
 *
 * 对齐 Android ReservationTask：
 * - id: 唯一标识
 * - mode: 任务模式
 * - status: 当前状态
 * - areaId/segment: 区域和时段信息
 * - seatNo: 目标座位号
 * - preferredSeats: 优先模式的偏好座位列表
 * - reserveDate: 预约日期
 * - startTime/endTime: 预约时段
 * - campusName/floorName/areaName: 位置信息
 * - message: 当前状态消息
 * - createdAt: 创建时间（毫秒时间戳）
 * - attempts: 已尝试次数
 * - lastAttemptAt: 最近一次尝试时间
 */
export interface ReservationTask {
  id: string;
  mode: TaskMode;
  status: TaskStatus;
  areaId: string;
  segment: string;
  seatNo: string;
  preferredSeats: string[];
  reserveDate: string;
  startTime: string;
  endTime: string;
  campusName: string;
  floorName: string;
  areaName: string;
  message: string;
  createdAt: number;
  attempts: number;
  lastAttemptAt: number;
}

/**
 * 生成新的任务 ID（UUID v4）。
 */
export function generateTaskId(): string {
  // 简单实现：使用 Date.now() + 随机数
  const hex = () => Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0');
  return `${hex()}-${hex()}-${hex()}-${hex()}`;
}

/**
 * 创建新任务。
 */
export function createTask(
  mode: TaskMode,
  areaId: string,
  segment: string,
  seatNo: string,
  reserveDate: string,
  startTime: string,
  endTime: string,
  campusName: string = '',
  floorName: string = '',
  areaName: string = '',
  preferredSeats: string[] = []
): ReservationTask {
  return {
    id: generateTaskId(),
    mode,
    status: TaskStatus.IDLE,
    areaId,
    segment,
    seatNo,
    preferredSeats,
    reserveDate,
    startTime,
    endTime,
    campusName,
    floorName,
    areaName,
    message: '等待开始...',
    createdAt: Date.now(),
    attempts: 0,
    lastAttemptAt: 0,
  };
}

/**
 * 序列化任务为 JSON 字符串。
 */
export function serializeTask(task: ReservationTask): string {
  return JSON.stringify(task);
}

/**
 * 反序列化任务。
 */
export function deserializeTask(json: string): ReservationTask | null {
  try {
    const parsed = JSON.parse(json);
    // 验证必要字段
    if (!parsed.id || !parsed.mode || !parsed.status) {
      return null;
    }
    return parsed as ReservationTask;
  } catch {
    return null;
  }
}

/**
 * 序列化任务列表。
 */
export function serializeTasks(tasks: ReservationTask[]): string {
  return JSON.stringify(tasks);
}

/**
 * 反序列化任务列表。
 */
export function deserializeTasks(json: string): ReservationTask[] {
  if (!json || json.trim() === '') {
    return [];
  }
  try {
    const parsed: Object[] = JSON.parse(json) as Object[];
    if (!Array.isArray(parsed)) {
      return [];
    }
    const out: ReservationTask[] = [];
    for (let i = 0; i < parsed.length; i++) {
      const t: Object = parsed[i];
      if (typeof t !== 'object' || t === null || Array.isArray(t)) {
        continue;
      }
      const r: Record<string, Object> = t as Record<string, Object>;
      if (r['id'] !== undefined && r['mode'] !== undefined && r['status'] !== undefined) {
        out.push(t as ReservationTask);
      }
    }
    return out;
  } catch {
    return [];
  }
}
