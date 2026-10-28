/**
 * 「通知页上次打开时刻」——未读数的唯一依据。
 *
 * 为什么单独一个键而不是塞进 `notify_records_v1`：
 * 记录是**业务数据**（会被清空/重建），已读位置是**阅读状态**；混在一起时清空记录
 * 会把「读到哪」一起丢掉，下次进来所有历史又变未读。
 */

import { Prefs } from './Prefs.ts';

const KEY_LAST_SEEN: string = 'notify_last_seen_v1';

export class NotifySeenStore {
  /** 上次打开通知页的时刻（毫秒）；从没打开过返回 0。 */
  static async load(): Promise<number> {
    return await Prefs.getNumber(KEY_LAST_SEEN, 0);
  }

  /** 记下「刚看过」（当前时刻）。失败不抛 —— 顶多下次多几条未读。 */
  static async markSeen(nowMillis: number): Promise<void> {
    await Prefs.putNumber(KEY_LAST_SEEN, nowMillis);
  }
}
