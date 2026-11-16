/**
 * 校园服务即时提醒的**编排层**（M14-A）：判定 → 去重 → 发即时通知。
 *
 * ## 触发时机（铁律）
 * 只在「**刚成功取到数据**」时调用：深澜接口只有校园网内可达、图书馆接口要活会话，
 * 挂周期任务会在校外永远落空，而页面取数成功那一刻就是人在校内/已登录的确证。
 * 传入 `null` 一律直接返回 ——「取不到」绝不能被当成「没超标 / 没借书」。
 *
 * ## 与日程提醒（ReminderScheduler）的区别
 * 这里发的是 `notificationManager` 即时通知，不进 reminderAgent、不占 30 条配额；
 * 因此也不解析成 NotifyRecord 历史（历史记录只描述「未来某刻要提醒什么」）。
 *
 * ## 三道闸
 * 1. 用户总开关 + 对应类型开关（提醒设置页可关，关了连去重标记都不写）；
 * 2. 系统通知开关（`isEnabled()`，关了就什么都不做，状态保持原样）；
 * 3. 各业务去重：网费按本地自然日、流量按整个计费周期、借阅按书键。
 *
 * ⚠️ 标记只在 `publishText` **确实发出去之后**才写。系统偶发发布失败时下一点还能重试；
 * 反过来先写标记再发，会把「从没提醒过」伪装成「已经提醒过」。
 */

import { info, warn } from '../core/log/BitLog.ts';
import type { CampusNetInfo } from '../corelogic/CampusNetLogic.ts';
import type { BorrowRecord } from '../corelogic/LibBorrowLogic.ts';
import type { DateTime } from '../corelogic/timeutil.ts';
import {
  decideFeeAlert,
  feeDedupeKey,
  feeAlertTitle,
  feeAlertBody,
  flowAlertTitle,
  flowAlertBody
} from '../corelogic/NetAlertLogic.ts';
import { alertRecords, noticeTitle, noticeBody } from '../corelogic/LibBorrowLogic.ts';
import {
  decideFlowState,
  freshLibKeys,
  localDateKey,
  localDateTime
} from '../corelogic/InstantAlertLogic.ts';
import { NotifySettingsStore } from '../data/NotifySettingsStore.ts';
import { NotifySentStore } from '../data/NotifySentStore.ts';
import { InstantAlertStore } from '../data/InstantAlertStore.ts';
import {
  isEnabled,
  publishText,
  NOTIFY_ID_NET_FEE,
  NOTIFY_ID_NET_FLOW,
  NOTIFY_ID_LIB_DUE
} from './InstantNotify.ts';

/** 一次检查的结果（页面只记日志，不拿它当成功提示 —— 通知发没发用户自己看状态栏）。 */
export interface InstantAlertOutcome {
  /** 是否过了开关闸门并开始检查。 */
  ran: boolean;
  /** 实际发出去的通知条数。 */
  published: number;
  /** 没跑的人话原因（ran=true 时为空串）。 */
  reason: string;
}

function skipped(reason: string): InstantAlertOutcome {
  return { ran: false, published: 0, reason: reason };
}

export class ServiceAlertRunner {
  /**
   * 校园网取到 `online` 数据时调一次。
   * `info` 为 null（notOnline / failed）时不判定、不写任何标记。
   */
  static async checkNet(net: CampusNetInfo | null, nowMillis: number = Date.now()): Promise<InstantAlertOutcome> {
    if (net === null) {
      return skipped('没有在线数据');
    }
    try {
      const s = await NotifySettingsStore.load();
      if (!s.enabled || !s.netAlertEnabled) {
        return skipped('提醒总开关或校园网提醒已关闭');
      }
      if (!(await isEnabled())) {
        return skipped('系统通知未开启');
      }
      let published: number = 0;

      // ── 网费：<10 元，按本地自然日去重（复用 NotifySentStore，14 天清理不影响「每天一次」）──
      if (decideFeeAlert(net.balanceYuan)) {
        const day: string = localDateKey(nowMillis);
        if (day.length > 0) {
          const key: string = feeDedupeKey(day);
          if (!(await NotifySentStore.contains(key))) {
            const ok: boolean = await publishText(
              NOTIFY_ID_NET_FEE, feeAlertTitle(), feeAlertBody(net.balanceYuan), 'pages/NetPage'
            );
            if (ok) {
              await NotifySentStore.mark(key, nowMillis);
              published++;
            }
          }
        }
      }

      // ── 流量：270 / 300 GB，整个计费周期各一次；累计值变小即换周期复位 ──
      const before = await InstantAlertStore.loadFlow();
      const decision = decideFlowState(net.bytesTotal, before);
      if (decision.reset || decision.next.lastBytes !== before.lastBytes ||
        decision.next.warnedNear !== before.warnedNear || decision.next.warnedLimit !== before.warnedLimit) {
        await InstantAlertStore.saveFlow(decision.next);
      }
      if (decision.alert !== 'none') {
        const ok: boolean = await publishText(
          NOTIFY_ID_NET_FLOW,
          flowAlertTitle(decision.alert),
          flowAlertBody(decision.alert, net.bytesTotal),
          'pages/NetPage'
        );
        if (ok) {
          published++;
        }
      }
      info('ServiceAlertRunner net published=' + published + ' flow=' + decision.alert);
      return { ran: true, published: published, reason: '' };
    } catch (e) {
      warn('ServiceAlertRunner checkNet fail: ' + JSON.stringify(e));
      return skipped('检查失败');
    }
  }

  /**
   * 借阅页**当前在借**取到 `ok` 时调一次。
   * `records` 为 null（loggedOut / failed / 历史栏）时不判定。
   */
  static async checkLib(records: BorrowRecord[] | null, nowMillis: number = Date.now()): Promise<InstantAlertOutcome> {
    if (records === null) {
      return skipped('没有取到在借数据');
    }
    try {
      const s = await NotifySettingsStore.load();
      if (!s.enabled || !s.libAlertEnabled) {
        return skipped('提醒总开关或借阅提醒已关闭');
      }
      if (!(await isEnabled())) {
        return skipped('系统通知未开启');
      }
      const now: DateTime = localDateTime(nowMillis);
      const alerts: BorrowRecord[] = alertRecords(records, now);
      if (alerts.length === 0) {
        return skipped('没有临期或逾期记录');
      }
      const fresh: string[] = freshLibKeys(alerts, await InstantAlertStore.loadLibKeys());
      if (fresh.length === 0) {
        return skipped('这些记录已经提醒过');
      }
      // 文案说的是「当前事实」，所以用全部 alerts；只标记 fresh（Android LibBorrowChecker 原语义）
      const title: string = noticeTitle(alerts, now);
      const body: string = noticeBody(alerts, now);
      if (title.length === 0 || body.length === 0) {
        return skipped('没有可发送的文案');
      }
      const ok: boolean = await publishText(NOTIFY_ID_LIB_DUE, title, body, 'pages/LibBorrowPage');
      if (ok) {
        await InstantAlertStore.markLibKeys(fresh);
      }
      info('ServiceAlertRunner lib fresh=' + fresh.length + ' published=' + (ok ? 1 : 0));
      return { ran: true, published: ok ? 1 : 0, reason: '' };
    } catch (e) {
      warn('ServiceAlertRunner checkLib fail: ' + JSON.stringify(e));
      return skipped('检查失败');
    }
  }
}
