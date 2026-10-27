/**
 * 桌面卡片**刷新配额**的纯逻辑（M8-5）。
 *
 * ## 为什么要限
 * 卡片的更新时间由系统按 `setFormNextRefreshTime` 决定，但「系统来敲门」时我们还会
 * 主动装配一次数据（读缓存 + 拼 payload）。不加约束会有两个后果：
 *  1. 用户在桌面放多张卡片 ⇒ 每张都独立触发，装配次数翻倍；
 *  2. 厂商调度可能比我们以为的频繁 ⇒ 无谓的 CPU / 电量，且没有可见收益
 *     （课表/作业本来就按天变）。
 *
 * 所以两条闸门（与 ROADMAP M8-5 判据一致）：
 *  - **最小间隔 30 分钟**：刚装配过就再来一次，直接跳过；
 *  - **每天 50 次**：跨天自动重置（按**本地日**，即 epoch day，与卡片口径一致）。
 *
 * ## 为什么状态要落盘
 * 卡片跑在**独立进程**，进程随时可能被回收。计数放内存 = 重启归零 = 配额形同虚设。
 * 状态由 `FormExtension` 自己读写在 `Prefs`（主进程也会读到同一份，但不依赖它）。
 */

/** 两次装配的最小间隔。 */
export const MIN_INTERVAL_MS: number = 30 * 60 * 1000;

/** 每日装配次数上限。 */
export const DAILY_QUOTA: number = 50;

/** `setFormNextRefreshTime` 允许的最小分钟数（系统限制，小于 5 会被拒）。 */
export const MIN_SYSTEM_REFRESH_MINUTES: number = 5;

/** 落盘状态。 */
export interface RefreshState {
  /** 计数所属的本地日（epoch day）。 */
  day: number;
  /** 当天已装配次数。 */
  count: number;
  /** 上次装配时刻（毫秒）。 */
  lastAt: number;
}

/** 一次判断的结果。 */
export interface RefreshDecision {
  /** 是否允许这一次装配。 */
  allowed: boolean;
  /** 更新后的状态（**无论允许与否**都要写回：拒绝也要保留跨天重置的结果）。 */
  state: RefreshState;
  /** 不允许的原因（允许时为空串，便于日志）。 */
  reason: string;
  /** 建议的下次刷新时刻（毫秒）。 */
  nextAt: number;
}

/** 空状态（从未装配过）。 */
export function emptyState(): RefreshState {
  return { day: 0, count: 0, lastAt: 0 };
}

/** 编码：`day|count|lastAt`（三段短串，比 JSON 省事且不会带出奇怪字符）。 */
export function encodeState(s: RefreshState): string {
  return s.day + '|' + s.count + '|' + s.lastAt;
}

/** 解码；形状不对返回 null（调用方按空状态处理）。 */
export function decodeState(raw: string): RefreshState | null {
  if (raw.length === 0) {
    return null;
  }
  const parts: string[] = raw.split('|');
  if (parts.length !== 3) {
    return null;
  }
  const day: number = Number(parts[0]);
  const count: number = Number(parts[1]);
  const lastAt: number = Number(parts[2]);
  if (!Number.isFinite(day) || !Number.isFinite(count) || !Number.isFinite(lastAt)) {
    return null;
  }
  if (count < 0 || lastAt < 0) {
    return null;
  }
  return { day: day, count: count, lastAt: lastAt };
}

/**
 * 判断这一次更新该不该真装配。
 *
 * @param state 上次落盘的状态
 * @param today 今天的本地日（epoch day）
 * @param nowMillis 现在（毫秒）
 */
export function decide(state: RefreshState, today: number, nowMillis: number): RefreshDecision {
  // 跨天：先重置计数，再按新的一天判
  let s: RefreshState = state;
  if (s.day !== today) {
    s = { day: today, count: 0, lastAt: s.lastAt };
  }
  if (s.count >= DAILY_QUOTA) {
    // 配额用完：下次刷新放到「明天 00:00 之后 1 分钟」太粗；这里给 1 小时后再试
    return { allowed: false, state: s, reason: 'daily_quota', nextAt: nowMillis + 60 * 60 * 1000 };
  }
  if (s.lastAt > 0) {
    const elapsed: number = nowMillis - s.lastAt;
    if (elapsed >= 0 && elapsed < MIN_INTERVAL_MS) {
      return {
        allowed: false, state: s, reason: 'too_soon',
        nextAt: s.lastAt + MIN_INTERVAL_MS
      };
    }
    if (elapsed < 0) {
      // 时钟被往回调过：不信 lastAt，按「可以刷」处理并重设时间基准
      const fixed: RefreshState = { day: today, count: s.count, lastAt: nowMillis };
      return {
        allowed: true, state: { day: fixed.day, count: fixed.count + 1, lastAt: nowMillis },
        reason: '', nextAt: nowMillis + MIN_INTERVAL_MS
      };
    }
  }
  const next: RefreshState = { day: today, count: s.count + 1, lastAt: nowMillis };
  return { allowed: true, state: next, reason: '', nextAt: nowMillis + MIN_INTERVAL_MS };
}

/**
 * 距下次刷新的分钟数（喂 `setFormNextRefreshTime`）。
 * 向下取整并夹到 ≥ `MIN_SYSTEM_REFRESH_MINUTES`：系统不接受更小的值，
 * 传 1 会被静默忽略，卡片就再也不自动刷新了。
 */
export function minutesUntil(nextAt: number, nowMillis: number): number {
  const delta: number = nextAt - nowMillis;
  if (delta <= 0) {
    return MIN_SYSTEM_REFRESH_MINUTES;
  }
  const m: number = Math.floor(delta / 60000);
  return m < MIN_SYSTEM_REFRESH_MINUTES ? MIN_SYSTEM_REFRESH_MINUTES : m;
}

/** 剩余配额（展示/日志用）。 */
export function remaining(state: RefreshState, today: number): number {
  const used: number = state.day === today ? state.count : 0;
  const left: number = DAILY_QUOTA - used;
  return left > 0 ? left : 0;
}
