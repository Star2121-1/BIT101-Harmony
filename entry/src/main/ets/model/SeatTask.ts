/**
 * 座位监控任务模型（M9-8）。
 *
 * 对照 Android Task.kt：
 * - TaskMode: SINGLE/MONITOR/PREFER
 * - TaskStatus: IDLE/RUNNING/SUCCESS/FAILED/CANCELLED
 * - ReservationTask: 任务数据模型
 */

/** 任务模式。 */
export enum TaskMode {
  /** 单次预约（手动触发）。 */
  SINGLE = 'SINGLE',
  /** 监控模式（自动轮询指定座位）。 */
  MONITOR = 'MONITOR',
  /** 优先模式（按偏好列表依次尝试）。 */
  PREFER = 'PREFER',
}

/** 任务状态。 */
export enum TaskStatus {
  /** 空闲（等待开始）。 */
  IDLE = 'IDLE',
  /** 运行中。 */
  RUNNING = 'RUNNING',
  /** 发现空位，等用户确认预约（铁律 0.6：绝不自动预约）。 */
  FOUND = 'FOUND',
  /** 成功。 */
  SUCCESS = 'SUCCESS',
  /** 失败。 */
  FAILED = 'FAILED',
  /** 已取消。 */
  CANCELLED = 'CANCELLED',
}

/** 任务是否处于活跃状态（轮询中）。FOUND 已停轮询，不算活跃。 */
export function isActiveStatus(status: TaskStatus): boolean {
  return status === TaskStatus.IDLE || status === TaskStatus.RUNNING;
}

/** 任务是否处于终态。FOUND 不是终态（用户还能确认或取消）。 */
export function isTerminalStatus(status: TaskStatus): boolean {
  return status === TaskStatus.SUCCESS ||
         status === TaskStatus.FAILED ||
         status === TaskStatus.CANCELLED;
}

/** 是否在等用户确认预约（FOUND 态；UI 据此显示「去预约」按钮）。 */
export function needsUserConfirm(status: TaskStatus): boolean {
  return status === TaskStatus.FOUND;
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
 * - foundSeatId/foundSeatNo: FOUND 态下发现的空位（用户确认预约时用；铁律 0.6）
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
  /** FOUND 态：发现的空位 id（用户点「去预约」时确认用）。 */
  foundSeatId: string;
  /** FOUND 态：发现的空位编号（展示用）。 */
  foundSeatNo: string;
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
    foundSeatId: '',
    foundSeatNo: '',
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
 * ⚠️ 旧存档没有 foundSeatId/foundSeatNo 字段（FOUND 态是后加的），
 * 这里补齐空串，避免 UI 读 undefined。
 */
export function deserializeTask(json: string): ReservationTask | null {
  try {
    const parsed = JSON.parse(json);
    // 验证必要字段
    if (!parsed.id || !parsed.mode || !parsed.status) {
      return null;
    }
    const task: ReservationTask = parsed as ReservationTask;
    backfillFound(task, parsed as Record<string, Object>);
    return task;
  } catch {
    return null;
  }
}

/** 旧存档补齐 found 字段（FOUND 态后加，老数据没有这两个键）。 */
function backfillFound(task: ReservationTask, raw: Record<string, Object>): void {
  if (raw['foundSeatId'] === undefined) task.foundSeatId = '';
  if (raw['foundSeatNo'] === undefined) task.foundSeatNo = '';
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
        const task: ReservationTask = t as ReservationTask;
        backfillFound(task, r);
        out.push(task);
      }
    }
    return out;
  } catch {
    return [];
  }
}
