/**
 * 即时通知（`notificationManager.publish`）—— 与 `ReminderScheduler` 的**日程提醒**不同：
 * 后者是 `reminderAgent` 的「到点弹」，这里是「事件已经发生了，现在就告诉用户」。
 *
 * ## 现在的唯一用途
 * 出分提醒（M7-3）：成绩是「某天服务端突然多了几行」的事件，没有确定的未来时刻，
 * 排不进日历提醒。Android 侧同样用即时通知（`NotifyCenter.notifyScores`）。
 *
 * ## 纪律
 * - **系统通知开关没开就静默失败**（`isNotificationEnabled` 为 false 时 publish 会报 1700001）；
 *   这不是错误路径，用户关了通知就该什么都不发生；
 * - 通知文案由调用方给（出分提醒的文案在 `ScoreLogic.summaryText`，那里锁死了「不含分数」）；
 * - 本模块不拼业务文案、不读业务数据。
 */

import { notificationManager } from '@kit.NotificationKit';
import { wantAgent } from '@kit.AbilityKit';
import { info, warn } from '../core/log/BitLog.ts';

/**
 * 应用包名 —— 与 `AppScope/app.json5` 的 `bundleName` 一致。
 * ⚠️ 改包名时必须同步（否则通知点击打不开 App，且**没有任何报错**，只是点了没反应）。
 */
const BUNDLE_NAME: string = 'cn.bit101.next';
const ENTRY_ABILITY: string = 'EntryAbility';

/** 通知 id（同 id 会覆盖前一条；出分提醒固定用一个，避免刷屏堆叠）。 */
export const NOTIFY_ID_SCORES: number = 1001;

/**
 * 发一条纯文本通知。
 * @returns 是否真的发出去了（开关关闭/无权限 → false，不抛）
 */
export async function publishText(id: number, title: string, text: string, page: string = ''): Promise<boolean> {
  if (title.length === 0 || text.length === 0) {
    return false;
  }
  let enabled: boolean = false;
  try {
    enabled = await notificationManager.isNotificationEnabled();
  } catch (e) {
    warn('InstantNotify isNotificationEnabled fail: ' + JSON.stringify(e));
    return false;
  }
  if (!enabled) {
    info('InstantNotify skipped: notification disabled');
    return false;
  }
  const request: notificationManager.NotificationRequest = {
    id: id,
    content: {
      notificationContentType: notificationManager.ContentType.NOTIFICATION_CONTENT_BASIC_TEXT,
      normal: {
        title: title,
        text: text
      }
    }
  };
  // 点击落点：带 `bit101Page` 参数，EntryAbility 校验后由 Index pushUrl。
  // 失败（系统不支持 wantAgent）不影响通知本身 —— 退化成「只打开 App」。
  if (page.length > 0) {
    try {
      const info2: wantAgent.WantAgentInfo = {
        wants: [{
          bundleName: BUNDLE_NAME,
          abilityName: ENTRY_ABILITY,
          // 键名必须与 `NotifyDeepLink.KEY_NOTIFY_PAGE` 一致（对象字面量里不能用计算属性，故写字面量）
          parameters: { bit101Page: page },
        }],
        actionType: wantAgent.OperationType.START_ABILITY,
        requestCode: id,
      };
      request.wantAgent = await wantAgent.getWantAgent(info2);
      info('InstantNotify wantAgent page=' + page);
    } catch (e) {
      warn('InstantNotify wantAgent fail (通知仍会发): ' + JSON.stringify(e));
    }
  }
  try {
    await notificationManager.publish(request);
    info('InstantNotify published id=' + id);
    return true;
  } catch (e) {
    warn('InstantNotify publish fail id=' + id + ': ' + JSON.stringify(e));
    return false;
  }
}
