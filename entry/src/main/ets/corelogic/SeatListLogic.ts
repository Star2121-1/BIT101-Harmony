/**
 * 座位列表 tab 纯逻辑（对齐 Android TaskListScreen / TaskListLogic / SeatRules）。
 * 只做字符串/数组/时间差判断，无 I/O、无 @kit 依赖，可离线单测。
 */

import type { ReservationTask } from '../model/SeatTask.ts';
import { TaskStatus, TaskMode, isTerminalStatus } from '../model/SeatTask.ts';

// ── 预约规则弹窗（对齐 Android SeatRules.kt）──

/** 一条规则要点（标题 + 说明）。 */
export interface SeatRule {
  title: string;
  body: string;
}

/** 规则要点表（源自 /api/index/booking_rules 原文，完整考证见 seatlib-contract.md §10）。 */
export function seatRules(): SeatRule[] {
  return [
    {
      title: '可预约时间',
      body: '每天 6:00 起可预约当日或次日的座位；馆内开放时间为 08:00-22:30。',
    },
    {
      title: '签到',
      body: '预约当日：需在预约开始后 60 分钟内刷卡入馆（系统自动签到）；预约次日：需在次日 9:00 前刷卡入馆。',
    },
    {
      title: '临时离开',
      body: '暂离后座位保留 60 分钟；用餐时段（11:00-12:00、16:00-17:00）延长至 120 分钟。超时未回，座位自动释放并记违约 1 次。',
    },
    {
      title: '离开馆',
      body: '刷卡出馆后座位自动释放。',
    },
    {
      title: '取消预约',
      body: '每天可取消 2 次；预约开始一段时间后将无法取消（时长由馆方配置，以下单页提示为准）。',
    },
    {
      title: '违约',
      body: '预约后未签到记违约 1 次；各类违约累计 5 次，暂停预约权 7 天。',
    },
  ];
}

/** 规则弹窗末尾免责声明（规则服务端可配置，不写成实时断言）。 */
export const RULES_DISCLAIMER: string = '依据座位系统预约规则整理，以图书馆最新公告为准。';

// ── 取消额度（本地计数，只作提示，不冒充服务端权威）──

/** 「我的预约」副标题：每天最多可取消 N 次 · 今天还剩 M 次。 */
export function quotaSubtitle(remaining: number, limit: number): string {
  return '每天最多可取消 ' + limit + ' 次 · 今天还剩 ' + remaining + ' 次';
}

/** 本地取消计数存储串「yyyy-MM-dd|used」（避开 ArkTS 动态对象字面量）。 */
export function encodeQuota(day: string, used: number): string {
  return day + '|' + used;
}

/** 解析本地计数串；坏值回落为「今天、0 次」，不猜服务端数据。 */
export function decodeQuota(raw: string, today: string): { day: string; used: number } {
  const parts: string[] = raw.split('|');
  if (parts.length !== 2 || parts[0].length === 0) return { day: today, used: 0 };
  const n: number = Number(parts[1]);
  if (!Number.isFinite(n) || n < 0) return { day: parts[0], used: 0 };
  return { day: parts[0], used: Math.floor(n) };
}

/** 今天还剩几次取消（存储日 != 今天自动重置；下限 0，不出现负数）。 */
export function remainingCancels(storedDay: string, used: number, today: string, limit: number): number {
  if (storedDay !== today || used <= 0) return limit;
  return Math.max(0, limit - used);
}

// ── 任务排序 / 分组（对齐 TaskListLogic.sort）──

/** 进行中优先、组内按创建时间倒序、id 稳定兜底；返回新数组不改入参。 */
export function sortTasks(tasks: ReservationTask[]): ReservationTask[] {
  const out: ReservationTask[] = tasks.slice();
  out.sort((a: ReservationTask, b: ReservationTask): number => {
    const aa: number = isTerminalStatus(a.status) ? 0 : 1;
    const bb: number = isTerminalStatus(b.status) ? 0 : 1;
    if (aa !== bb) return bb - aa;
    if (a.createdAt !== b.createdAt) return b.createdAt - a.createdAt;
    return a.id.localeCompare(b.id);
  });
  return out;
}

/** 进行中任务（FOUND 不是终态，仍在等用户确认，算活跃）。 */
export function activeTasks(tasks: ReservationTask[]): ReservationTask[] {
  const out: ReservationTask[] = [];
  for (const t of sortTasks(tasks)) {
    if (!isTerminalStatus(t.status)) out.push(t);
  }
  return out;
}

/** 已结束任务。 */
export function finishedTasks(tasks: ReservationTask[]): ReservationTask[] {
  const out: ReservationTask[] = [];
  for (const t of sortTasks(tasks)) {
    if (isTerminalStatus(t.status)) out.push(t);
  }
  return out;
}

// ── 任务卡文案（对齐 TaskListLogic）──

/** 状态徽章文案。 */
export function taskStatusBadge(status: TaskStatus): string {
  switch (status) {
    case TaskStatus.IDLE: return '等待中';
    case TaskStatus.RUNNING: return '运行中';
    case TaskStatus.FOUND: return '发现空位';
    case TaskStatus.SUCCESS: return '成功';
    case TaskStatus.FAILED: return '失败';
    case TaskStatus.CANCELLED: return '已取消';
    default: return '未知';
  }
}

/** 模式标签：优先模式区分「指定/不限」（行为差异大）。 */
export function taskModeLabel(task: ReservationTask): string {
  if (task.mode === TaskMode.MONITOR) return '监控';
  if (task.mode === TaskMode.PREFER) {
    return task.preferredSeats.length > 0 ? '优先·指定' : '优先·不限';
  }
  return '单次';
}

/** 座位标签：偏好清单按优先级，其次目标座位；都空返回空串由 UI 隐藏。 */
export function taskSeatLabel(task: ReservationTask): string {
  if (task.preferredSeats.length > 0) return task.preferredSeats.join(',');
  return task.seatNo;
}

/** 时段文案（模型里一直有，之前 UI 只显示日期，观感割裂）。 */
export function taskTimeRange(task: ReservationTask): string {
  const s: string = task.startTime.trim();
  const e: string = task.endTime.trim();
  if (s.length === 0 && e.length === 0) return '-';
  if (s.length === 0) return e;
  if (e.length === 0) return s;
  return s + ' - ' + e;
}

/** 「已等待 N」；createdAt<=0（老数据）返回 null，避免显示"已等待 56 年"。 */
export function waitedText(createdAt: number, now: number): string | null {
  if (createdAt <= 0) return null;
  const minutes: number = Math.max(0, Math.floor((now - createdAt) / 60000));
  if (minutes < 1) return '刚刚开始';
  if (minutes < 60) return '已等待 ' + minutes + ' 分钟';
  return '已等待 ' + Math.floor(minutes / 60) + ' 小时 ' + (minutes % 60) + ' 分钟';
}

/** 「最近尝试 N 前」；没尝试过返回 null，UI 应显示「尚未尝试」而不是静默省略。 */
export function lastAttemptText(lastAttemptAt: number, now: number): string | null {
  if (lastAttemptAt <= 0) return null;
  const seconds: number = Math.max(0, Math.floor((now - lastAttemptAt) / 1000));
  if (seconds < 60) return '最近尝试：' + seconds + ' 秒前';
  if (seconds < 3600) return '最近尝试：' + Math.floor(seconds / 60) + ' 分钟前';
  return '最近尝试：' + Math.floor(seconds / 3600) + ' 小时前';
}

/** 存活信息行：已等待 · 尝试 N 次 · 最近尝试（缺谁补谁，异常也可见）。 */
export function livenessText(
  createdAt: number, attempts: number, lastAttemptAt: number, now: number
): string {
  const parts: string[] = [];
  const waited: string | null = waitedText(createdAt, now);
  if (waited !== null) parts.push(waited);
  parts.push('尝试 ' + attempts + ' 次');
  parts.push(lastAttemptText(lastAttemptAt, now) ?? '尚未尝试');
  return parts.join(' · ');
}

/** 「N 前更新」；没刷新过返回 null（UI 不显示，区分「没变」与「刷新失败」）。 */
export function updatedAgoText(lastUpdatedAt: number, now: number): string | null {
  if (lastUpdatedAt <= 0) return null;
  const seconds: number = Math.max(0, Math.floor((now - lastUpdatedAt) / 1000));
  if (seconds < 10) return '刚刚更新';
  if (seconds < 60) return seconds + ' 秒前更新';
  if (seconds < 3600) return Math.floor(seconds / 60) + ' 分钟前更新';
  return Math.floor(seconds / 3600) + ' 小时前更新';
}

/** 签到倒计时（返回文案 + 是否已超时；已超时明确说，不说「还剩 0 分钟」）。 */
export function signInCountdown(deadlineMs: number, now: number): { text: string; expired: boolean } {
  const remain: number = deadlineMs - now;
  if (remain <= 0) return { text: '已超时', expired: true };
  const minutes: number = Math.floor(remain / 60000);
  if (minutes < 1) return { text: '还剩不到 1 分钟', expired: false };
  if (minutes < 60) return { text: '还剩 ' + minutes + ' 分钟', expired: false };
  return {
    text: '还剩 ' + Math.floor(minutes / 60) + ' 小时 ' + (minutes % 60) + ' 分钟',
    expired: false,
  };
}
