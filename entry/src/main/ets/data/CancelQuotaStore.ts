/**
 * 座位取消额度（本地计数）。
 *
 * ⚠️ 口径：Android 也是**本地**计数（SharedPreferences `seat_cancels`），只统计本 App 内
 * 发起的取消；网页端或其它设备的取消不会计入。所以这里只作提示，绝不冒充服务端权威额度。
 * 规则原文「每天最多 2 次」是馆方配置，规则弹窗里已注明以最新公告为准。
 */

import { Prefs } from './Prefs.ts';
import {
  encodeQuota, decodeQuota, remainingCancels,
} from '../corelogic/SeatListLogic.ts';
import { warn } from '../core/log/BitLog.ts';

const KEY: string = 'seat_cancel_quota_v1';

/** 每天最多可取消次数（对齐 Android SeatViewModel.CANCELS_PER_DAY）。 */
export const CANCELS_PER_DAY: number = 2;

/** 额度状态（day=存储日，used=当天已用次数，left=今天还剩）。 */
export interface QuotaState {
  day: string;
  used: number;
  left: number;
}

export class CancelQuotaStore {
  /** 读额度；today 由页面传入（本层不依赖 service，只读写存储）。 */
  static async load(today: string): Promise<QuotaState> {
    try {
      const raw: string = await Prefs.getString(KEY, '');
      const q = decodeQuota(raw, today);
      return { day: q.day, used: q.used, left: remainingCancels(q.day, q.used, today, CANCELS_PER_DAY) };
    } catch (e) {
      warn('CancelQuotaStore.load fail: ' + JSON.stringify(e));
      return { day: today, used: 0, left: CANCELS_PER_DAY };
    }
  }

  /** 记一次本 App 内取消成功（只在用户显式确认取消后调用，无自动写）。 */
  static async markUsed(today: string): Promise<QuotaState> {
    const cur: QuotaState = await this.load(today);
    const used: number = cur.day === today ? cur.used + 1 : 1;
    try {
      await Prefs.putString(KEY, encodeQuota(today, used));
    } catch (e) {
      warn('CancelQuotaStore.markUsed fail: ' + JSON.stringify(e));
    }
    return { day: today, used, left: remainingCancels(today, used, today, CANCELS_PER_DAY) };
  }
}
