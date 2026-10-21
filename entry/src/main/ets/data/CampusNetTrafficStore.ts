/**
 * 校园网流量历史的小存储（对照 Android `CampusNetTrafficStore` + TextFileCache）。
 *
 * 编码与趋势计算都在纯逻辑 `CampusNetTrafficLogic` 里（有单测），
 * 这里只做读写 Prefs 这点副作用。与 CampusCardStore 同一套约定。
 */

import { Prefs } from './Prefs.ts';
import {
  TrafficSample,
  TrafficTrend,
  append,
  decode,
  emptyTrafficTrend,
  encode,
  trend
} from '../corelogic/CampusNetTrafficLogic.ts';
import { DayOf, localEpochDay } from '../corelogic/CampusCardBalanceLogic.ts';
import { info } from '../core/log/BitLog.ts';

const KEY_HISTORY: string = 'campus_net_traffic_history';

export class CampusNetTrafficStore {
  /** 全部采样（坏行已丢弃）。 */
  static async samples(): Promise<TrafficSample[]> {
    const raw: string = await Prefs.getString(KEY_HISTORY, '');
    return decode(raw);
  }

  /** 读原始文本（调试用）。 */
  static async readRaw(): Promise<string> {
    return await Prefs.getString(KEY_HISTORY, '');
  }

  /**
   * 记一笔流量采样并返回**记完之后**的趋势。
   *
   * @param bytes 本次读到的本周期累计用量；null（未在线/失败）时只算已有历史，不新增采样
   */
  static async record(
    bytes: number | null,
    atMillis: number = Date.now(),
    dayOf: DayOf = localEpochDay
  ): Promise<TrafficTrend> {
    const existing: TrafficSample[] = await CampusNetTrafficStore.samples();

    const updated: TrafficSample[] = bytes === null
      ? existing
      : append(existing, bytes, atMillis, dayOf);

    // 内容没变（同日同值 / 没解析出数据）就别写盘 —— 页面每次进都会刷新一次
    if (encode(updated) !== encode(existing)) {
      await Prefs.putString(KEY_HISTORY, encode(updated));
      info('net traffic recorded n=' + updated.length);
    }

    return trend(updated, dayOf(atMillis), dayOf);
  }

  /** 清空历史（登出时调）。 */
  static async clear(): Promise<void> {
    await Prefs.remove(KEY_HISTORY);
  }

  /** 初始态（UI 用）。 */
  static emptyTrend(): TrafficTrend {
    return emptyTrafficTrend();
  }
}
