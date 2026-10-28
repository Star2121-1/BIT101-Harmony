/**
 * 排期结果的**人话文案**（M12-8，纯函数）。
 *
 * ## 为什么必须抽出来
 * `ReminderScheduler.reschedule()` 会返回 7 种结果（发布成功 / 用户关了 / 系统没授权 /
 * 本地没数据 / 免打扰吃掉全部 / 配额裁了 / 发布失败），而**页面有两个入口**调用它
 * （提醒设置页改开关、免打扰设置改窗口）。两边各写一份 if-else 的后果已经发生过：
 * 免打扰那边只处理了 `all_in_quiet_hours`，其余全落到 else，于是
 * **「系统通知没授权」被显示成「已重排 0 条」**——用户以为「没有提醒可排」，
 * 实际是权限没开、一条都没排。这不是文案瑕疵，是把原因说反了。
 *
 * 所以把「结果 → 文案」做成纯函数，两个入口共用一份，单测钉住每条 reason
 * 都有**自己的**文案（不许再落到兜底分支里被当成成功）。
 */

/** 排期结果的形状（与 `ReminderScheduler.ScheduleResult` 结构一致；不 import 避免依赖 service）。 */
export interface ScheduleOutcome {
  published: number;
  quotaDropped: number;
  pastDropped: number;
  quietDelayed: number;
  quietDropped: number;
  failed: number;
  /** 被系统以 1700002 拒掉的条数（真机上可能表示「本机不允许代理提醒」，不只是配额）。 */
  quotaRejected?: number;
  /** '' = 正常排了；其余是整批未排的原因。 */
  reason: string;
}

/** reason 取值（与 service 侧字符串一致，改一侧必须改另一侧 —— 有单测对照）。 */
export const REASON_USER_DISABLED: string = 'user_disabled';
export const REASON_NOTIFICATION_DISABLED: string = 'notification_disabled';
export const REASON_EMPTY_PLAN: string = 'empty_plan';
export const REASON_ALL_IN_QUIET: string = 'all_in_quiet_hours';

/** 这个结果是否「需要用户去开系统通知」（页面据此显示授权按钮而不是干说一句）。 */
export function needsNotificationPermission(reason: string): boolean {
  return reason === REASON_NOTIFICATION_DISABLED;
}

/** 数字后缀：只在 >0 时出现，不产生「· 0 条」这种噪音。 */
function suffix(n: number, text: string): string {
  return n > 0 ? ' · ' + n + ' ' + text : '';
}

/** 排期结果 → 一行给人看的状态。**任何 reason 都有专属文案**。 */
export function scheduleStatusText(r: ScheduleOutcome): string {
  if (r.reason === REASON_USER_DISABLED) {
    return '提醒总开关已关闭，一条都不会排（打开总开关即恢复）。';
  }
  if (r.reason === REASON_NOTIFICATION_DISABLED) {
    return '系统没有给本应用通知权限，提醒一条都没排。点下面的「开启通知」允许后再试。';
  }
  if (r.reason === REASON_EMPTY_PLAN) {
    return '本地暂无可排的提醒（还没同步课表 / 没有 DDL）。';
  }
  if (r.reason === REASON_ALL_IN_QUIET) {
    return '未来一周的 ' + r.quietDropped + ' 条提醒全落在免打扰时段，已全部跳过。';
  }
  // 一条都没排进去，且全是被系统拒的 ⇒ 这是「提醒功能在本机不可用」，必须说清楚
  const rejected: number = r.quotaRejected === undefined ? 0 : r.quotaRejected;
  if (r.published === 0 && rejected > 0 && rejected >= r.failed) {
    return '提醒没能交给系统：' + rejected + ' 条全部被系统拒绝（错误码 1700002）。' +
      '本机可能不支持代理提醒，或系统通知仍被限制 —— 可在系统「设置 → 通知」再确认一次。';
  }

  // 走到这里才是「真的排了」
  return '已重排 ' + r.published + ' 条' +
    suffix(r.quotaDropped, '条超配额被裁') +
    suffix(r.quietDelayed, '条推迟出免打扰') +
    suffix(r.quietDropped, '条在免打扰内已过期跳过') +
    suffix(rejected, '条被系统拒绝（1700002）') +
    suffix(r.failed - rejected, '条发布失败');
}

/** 结果是否算「有提醒在生效」（发布 >0 且无致命 reason）。 */
export function isEffective(r: ScheduleOutcome): boolean {
  return r.reason.length === 0 && r.published > 0;
}
