/**
 * 一卡通余额历史的小存储（对照 Android `CampusCardBalanceStore` + TextFileCache）。
 *
 * 编码与趋势计算都在纯逻辑 `CampusCardBalanceLogic` 里（有单测），
 * 这里只做「读 Prefs / 写 Prefs」这点副作用。
 *
 * 用 Prefs 而不是单独文件：沙箱里拿不到 filesDir 的便利通道，
 * 而 preferences 同样是本应用私有、卸载即清 —— 对「采样流水」足够
 * （它不该混进设置存储，也不该有迁移负担）。
 */

import { Prefs } from './Prefs.ts';
import {
  BalanceSample,
  BalanceTrend,
  DayOf,
  append,
  decode,
  emptyTrend,
  encode,
  localEpochDay,
  trend
} from '../corelogic/CampusCardBalanceLogic.ts';
import { info } from '../core/log/BitLog.ts';

const KEY_HISTORY: string = 'campus_card_balance_history';

export class CampusCardStore {
  /** 全部采样（坏行已在 decode 丢弃）。 */
  static async samples(): Promise<BalanceSample[]> {
    const raw: string = await Prefs.getString(KEY_HISTORY, '');
    return decode(raw);
  }

  /** 读原始文本（调试用）。 */
  static async readRaw(): Promise<string> {
    return await Prefs.getString(KEY_HISTORY, '');
  }

  /**
   * 记一笔余额并返回**记完之后**的趋势。
   *
   * @param amount 本次解析到的余额；null（没解析出来 / 未登录）时只算已有历史，不新增采样
   * @param atMillis 采样时刻（默认现在）
   * @param dayOf 日期解析器（默认本机时区；测试注入）
   */
  static async record(
    amount: number | null,
    atMillis: number = Date.now(),
    dayOf: DayOf = localEpochDay
  ): Promise<BalanceTrend> {
    const existing: BalanceSample[] = await CampusCardStore.samples();

    const updated: BalanceSample[] = amount === null
      ? existing
      : append(existing, amount, atMillis, dayOf);

    // 内容没变（同一天、余额也一样）就别写盘 —— 页面每次进都会刷新一次
    if (encode(updated) !== encode(existing)) {
      await Prefs.putString(KEY_HISTORY, encode(updated));
      info('card balance recorded n=' + updated.length);
    }

    return trend(updated, dayOf(atMillis), dayOf);
  }

  /** 清空历史（登出时调；与 Android 侧「换账号不串趋势」同纪律）。 */
  static async clear(): Promise<void> {
    await Prefs.remove(KEY_HISTORY);
  }

  /** 没有任何采样时的趋势（UI 初始态）。 */
  static emptyTrend(): BalanceTrend {
    return emptyTrend();
  }
}
