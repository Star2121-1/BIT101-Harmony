/**
 * 已发提醒的记录（M7-1，防重复打扰）。
 *
 * 1:1 对照 Android `NotifySentStore`：只记「这个键发过没有」+ 发出时刻。
 *
 * ## 为什么要它
 *
 * 排期是「每次启动/数据变更都重排」的 —— 没有去重键，每次打开 App 都会把
 * 未来几天的提醒再发一遍。这里记下已发的键，同键只发一次。
 *
 * ## 清理
 *
 * 记录只对「未来几天」有意义 ⇒ 定期清掉 14 天前的（否则课表跑一年会攒几千条）。
 * 只在排期时偶尔调 `prune`，不必每次开 App 都写盘。
 */

import { Prefs } from './Prefs.ts';
import { info, warn } from '../core/log/BitLog.ts';

const KEY_SENT: string = 'notify_sent_v1';

/** 记录保留天数。 */
export const KEEP_DAYS: number = 14;

export class NotifySentStore {
  /** 全部记录（键 → 发出时刻）。损坏时返回空表 —— 宁可重复发一次，也不要整块不发。 */
  private static async loadMap(): Promise<Record<string, number>> {
    const json: string = await Prefs.getString(KEY_SENT, '');
    if (json.length === 0) {
      return {};
    }
    try {
      const parsed = JSON.parse(json) as Record<string, number>;
      return parsed !== null && typeof parsed === 'object' ? parsed : {};
    } catch (e) {
      warn('NotifySentStore load corrupt: ' + JSON.stringify(e));
      return {};
    }
  }

  /** 已发过的键集合。 */
  static async read(): Promise<string[]> {
    const map: Record<string, number> = await NotifySentStore.loadMap();
    return Object.keys(map);
  }

  /** 这个键发过没有。 */
  static async contains(key: string): Promise<boolean> {
    const map: Record<string, number> = await NotifySentStore.loadMap();
    return map[key] !== undefined;
  }

  /** 记录「已发」。 */
  static async mark(key: string, atMillis: number): Promise<void> {
    const map: Record<string, number> = await NotifySentStore.loadMap();
    map[key] = atMillis;
    try {
      await Prefs.putString(KEY_SENT, JSON.stringify(map));
    } catch (e) {
      warn('NotifySentStore mark fail ' + key + ': ' + JSON.stringify(e));
    }
  }

  /** 清空（调试 / 关闭提醒时用）。 */
  static async clear(): Promise<void> {
    await Prefs.remove(KEY_SENT);
    info('NotifySentStore cleared');
  }

  /**
   * 清掉过期记录（默认 14 天前）。
   *
   * @returns 清掉的条数
   */
  static async prune(nowMillis: number): Promise<number> {
    const map: Record<string, number> = await NotifySentStore.loadMap();
    const deadline: number = nowMillis - KEEP_DAYS * 24 * 3600 * 1000;
    const keys: string[] = Object.keys(map);
    let removed: number = 0;
    for (let i = 0; i < keys.length; i++) {
      const at: number = map[keys[i]];
      if (!Number.isFinite(at) || at < deadline) {
        delete map[keys[i]];
        removed++;
      }
    }
    if (removed > 0) {
      await Prefs.putString(KEY_SENT, JSON.stringify(map));
      info('NotifySentStore pruned=' + removed);
    }
    return removed;
  }
}
