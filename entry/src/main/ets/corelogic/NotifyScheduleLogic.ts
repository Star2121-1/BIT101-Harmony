/**
 * 代理提醒排期的**纯逻辑**（M7-2，不碰 SDK，单测直接打）。
 *
 * 干三件事：
 *  1. 把 `Reminder`（DateTime = 本地 epoch day + 当天分钟）翻成日历提醒要的
 *     **本地年月日时分**（reminderAgent 的 ReminderRequestCalendar.dateTime）；
 *  2. **配额裁剪**：reminderAgent 每个应用至多 N 条有效提醒（ROADMAP 风险 R10，
 *     官方文档 30 条、未实测），超出要主动裁，否则 publish 报 1700002；
 *  3. 把「该排哪条」的可证伪部分从 SDK 调用里剥出来。
 *
 * 对照 Android `NotifyScheduler`：每个提醒 = 一个一次性任务（唯一名 = 去重键），
 * 鸿蒙对应 reminderAgent 的日历提醒（系统代理，锁屏/App 退出后照样弹）。
 */

import { type Reminder, ReminderKind } from './NotifyLogic.ts';
import { type DateTime } from './timeutil.ts';

/** reminderAgent 每应用有效提醒上限（官方口径 30；R10 待真机核）。 */
export const AGENT_REMINDER_LIMIT: number = 30;

/** 一条「排给代理提醒」的纯数据（解耦 SDK，service 再映射成 ReminderRequestCalendar）。 */
export interface AgentReminderSpec {
  /** 去重键（Reminder.key；同键重排时先 cancel 再 publish，行为与 Android REPLACE 一致）。 */
  key: string;
  /** 提醒类型（写进 NotifyRecordStore 列表的分类 chip 用）。 */
  kind: ReminderKind;
  title: string;
  content: string;
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

/**
 * DateTime（本地 epoch day + 当天分钟）→ 本地年月日时分。
 *
 * ⚠️ 时区陷阱：epoch day 存的是**本地日历日**（东八区的 2026-11-30），
 * 不是 UTC 日。还原年月日必须 `new Date(day*86400000)` 后读 **UTC 分量**
 *（全仓 timeutil.isoDate / TeachingAdjustment 同款手法）；若误读本地分量，
 * 跨时区（CI 在 UTC）会整体错一天 —— 与一卡通趋势 DayOf 注入是同一族坑。
 *
 * @param nowLocalDay 仅作校验：若算出的日期早于「今天的 epoch day」，返回 null
 *   （**过去的提醒不该再排**，排了也白弹还占配额）。
 */
export function specOf(r: Reminder, nowLocalDay: number): AgentReminderSpec | null {
  const at: DateTime = r.at;
  if (at.day < nowLocalDay) {
    return null;
  }
  const d: Date = new Date(at.day * 86400000);
  const minuteOfDay: number = ((at.minutes % 1440) + 1440) % 1440;
  return {
    key: r.key,
    kind: r.kind,
    title: r.title,
    content: r.text,
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: Math.floor(minuteOfDay / 60),
    minute: minuteOfDay % 60
  };
}

/**
 * 配额裁剪：只保留**最近的前 limit 条**（plan() 已按 at 升序，即最早发生的在前）。
 *
 * 为什么裁最近的而不是最远的：
 *  - reminderAgent 的「有效提醒」指未过期的；越早越接近已过期，留着只占名额；
 *  - 被裁掉的远处提醒**下次重排会重新生成**（每次开 App / 数据变更都重排），
 *    不会永久丢；而近的不重排就会漏掉。
 *
 * ⚠️ 返回**新数组**，且保持入参顺序（升序）。
 */
export function selectForAgent(reminders: Reminder[], limit: number = AGENT_REMINDER_LIMIT): Reminder[] {
  if (reminders.length <= limit) {
    return reminders.slice();
  }
  return reminders.slice(0, limit);
}

/**
 * 一批提醒 → AgentReminderSpec[]（已裁配额、已剔过去的、按 at 升序）。
 * 这是 reschedule() 真正 publish 的清单。
 *
 * @returns { specs, droppedPast, droppedQuota } 两个 dropped 计数给日志/上报用，
 *            别静默丢（铁律 0.7：降级要看得到）。
 */
export function specsForPublish(
  reminders: Reminder[],
  nowLocalDay: number,
  limit: number = AGENT_REMINDER_LIMIT
): { specs: AgentReminderSpec[]; droppedPast: number; droppedQuota: number } {
  const specs: AgentReminderSpec[] = [];
  let droppedPast: number = 0;
  let droppedQuota: number = 0;
  // 先按「非过去」过滤，再在剩下的里取前 limit（否则被过去条目占掉名额）
  const future: Reminder[] = [];
  for (let i = 0; i < reminders.length; i++) {
    if (reminders[i].at.day >= nowLocalDay) {
      future.push(reminders[i]);
    } else {
      droppedPast++;
    }
  }
  const final: Reminder[] = selectForAgent(future, limit);
  if (future.length > limit) {
    droppedQuota = future.length - limit;
  }
  for (let i = 0; i < final.length; i++) {
    const s: AgentReminderSpec | null = specOf(final[i], nowLocalDay);
    if (s !== null) {
      specs.push(s);
    }
  }
  return { specs: specs, droppedPast: droppedPast, droppedQuota: droppedQuota };
}
