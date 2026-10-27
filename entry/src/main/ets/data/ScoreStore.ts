/**
 * 成绩本地存储（M10-2）—— `Prefs` 薄壳，序列化全在 `corelogic/ScoreStoreLogic.ts`。
 *
 * ## 三份数据与它们的纪律
 * | 键 | 内容 | 写者 | 读坏时的行为 |
 * |---|---|---|---|
 * | `score_cache_v1` | 上次拉到的成绩列表 + 时刻 | 取数管道（唯一） | 当作没有缓存，重新拉 |
 * | `score_snapshot_v1` | `课程\|学期 → 分数`（出分提醒基线） | 取数管道（唯一） | **当作首次运行，只建基线不提醒** |
 * | `score_last_check_v1` | 最近检查结果（`ScoreCheckLogic` 编码） | 取数管道（唯一） | 当作没检查过 |
 *
 * ## 为什么快照坏了不能"重建后继续提醒"
 * 快照是「上次见过的全部课程」。读不出来就说明基线丢了，此时如果把当前全表当作
 * 「新出分」去通知，用户会被历史成绩轰炸一遍。所以 `decodeSnapshot` 返回 null 时，
 * 调用方必须走「只建基线」分支（`ScoreLogic.diff(null, …)` 返回空，正是这个语义）。
 *
 * ⚠️ 本类**不做任何网络请求**，也不判断该不该检查 —— 那是 `ScoreService` 的事。
 */

import { Prefs } from './Prefs.ts';
import { info, warn } from '../core/log/BitLog.ts';
import type { ScoreEntry } from '../corelogic/ScoreLogic.ts';
import { snapshotOf } from '../corelogic/ScoreLogic.ts';
import type { CachedScores } from '../corelogic/ScoreStoreLogic.ts';
import { decodeCached, decodeSnapshot, encodeCached, encodeSnapshot } from '../corelogic/ScoreStoreLogic.ts';
import type { ScoreCheckStatus } from '../corelogic/ScoreCheckLogic.ts';
import { encode, parse, ScoreCheckCode } from '../corelogic/ScoreCheckLogic.ts';

const KEY_CACHE: string = 'score_cache_v1';
const KEY_SNAPSHOT: string = 'score_snapshot_v1';
const KEY_LAST_CHECK: string = 'score_last_check_v1';

export class ScoreStore {
  /** 成绩列表缓存（策略由调用方用 `isFresh` 判）。 */
  static async loadCache(): Promise<CachedScores | null> {
    const raw: string = await Prefs.getString(KEY_CACHE, '');
    return decodeCached(raw);
  }

  static async saveCache(entries: ScoreEntry[], atMillis: number): Promise<void> {
    const payload: CachedScores = { atMillis: atMillis, entries: entries };
    await Prefs.putString(KEY_CACHE, encodeCached(payload));
  }

  /**
   * 出分提醒基线。`null` = 从未成功同步过 / 存储坏了 ⇒ 调用方**只建基线不提醒**。
   */
  static async loadSnapshot(): Promise<Record<string, string> | null> {
    const raw: string = await Prefs.getString(KEY_SNAPSHOT, '');
    return decodeSnapshot(raw);
  }

  /** 用本次拉到的全表覆盖基线（无论有没有新课都要写，否则下次还会重报）。 */
  static async saveSnapshot(entries: ScoreEntry[]): Promise<void> {
    await Prefs.putString(KEY_SNAPSHOT, encodeSnapshot(snapshotOf(entries)));
  }

  static async loadLastCheck(): Promise<ScoreCheckStatus | null> {
    const raw: string = await Prefs.getString(KEY_LAST_CHECK, '');
    return parse(raw.length > 0 ? raw : null);
  }

  /** 记录一次检查结果（设置页/成绩页可见）。 */
  static async saveLastCheck(code: ScoreCheckCode, count: number, detail: string | null): Promise<void> {
    const status: ScoreCheckStatus = {
      atMillis: Date.now(),
      code: code,
      count: count,
      detail: detail
    };
    await Prefs.putString(KEY_LAST_CHECK, encode(status));
    info('ScoreStore lastCheck=' + code + ' count=' + count);
  }

  /** 清空所有成绩本地数据（"清除成绩数据"用；不动偏好开关）。 */
  static async clear(): Promise<void> {
    try {
      await Prefs.remove(KEY_CACHE);
      await Prefs.remove(KEY_SNAPSHOT);
      await Prefs.remove(KEY_LAST_CHECK);
    } catch (e) {
      warn('ScoreStore clear fail: ' + JSON.stringify(e));
    }
  }
}
