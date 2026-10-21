/**
 * DDL 截止时间的展示口径 —— 纯函数（组件与测试共用）。
 *
 * 1:1 移植 Android `DDLScheduleViewModel.remainTime`：
 *  diff（分钟）取绝对值后分档：>=1440 → 「N天 N小时 N分钟」；
 *  >=60 → 「N小时 N分钟」；否则 「N分钟」。diff<0 ⇒ 前缀「已过」，否则「剩余」。
 *
 * ⚠️ 不存展示串（铁律 0.8）：每次渲染现算，「已过 3 分钟」这种文案
 * 放久了会变成假的。页面每次 onDidAppear / 状态变化重算。
 */

import type { DateTime } from './timeutil.ts';
import { isoDate } from './timeutil.ts';
import { fmtHM } from './timeutil.ts';

/** deadline 相对 now 的分钟差（正 = 未到）。 */
export function diffMinutes(deadline: DateTime, now: DateTime): number {
  return (deadline.day - now.day) * 1440 + (deadline.minutes - now.minutes);
}

/** 「剩余 3天 5小时 20分钟」/「已过 2小时 10分钟」（Android 同款口径）。 */
export function remainTime(deadline: DateTime, now: DateTime): string {
  const diff: number = diffMinutes(deadline, now);
  const a: number = Math.abs(diff);
  let span: string;
  if (a >= 1440) {
    span = Math.floor(a / 1440) + '天 ' + Math.floor((a % 1440) / 60) + '小时 ' + (a % 60) + '分钟';
  } else if (a >= 60) {
    span = Math.floor(a / 60) + '小时 ' + (a % 60) + '分钟';
  } else {
    span = a + '分钟';
  }
  return diff < 0 ? '已过 ' + span : '剩余 ' + span;
}

/** 绝对时间「MM-DD HH:mm」（从 epoch day 现算，不缓存字符串）。 */
export function deadlineShort(deadline: DateTime): string {
  return isoDate(deadline.day).substring(5) + ' ' + fmtHM(deadline.minutes);
}

/** 是否已截止（展示上标红用）。 */
export function isOverdue(deadline: DateTime, now: DateTime): boolean {
  return diffMinutes(deadline, now) < 0;
}
