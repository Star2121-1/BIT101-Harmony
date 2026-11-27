/**
 * 节流状态持久化（纯数据，无网络）。配合 AutoReloginLogic 的 RenewThrottle。
 * 落盘是为了「进程重启后也不会立刻再撞一次 CAS 风控」——内存去重只挡同一次进程内并发。
 */

import { Prefs } from './Prefs.ts';
import { RenewThrottle, emptyThrottle } from '../corelogic/AutoReloginLogic.ts';

const KEY_THROTTLE: string = 'autorenew_throttle_v1';

export class RenewThrottleStore {
  static async load(): Promise<RenewThrottle> {
    const json: string = await Prefs.getString(KEY_THROTTLE, '');
    if (json.length === 0) {
      return emptyThrottle();
    }
    try {
      const o = JSON.parse(json) as RenewThrottle;
      if (o === null || typeof o !== 'object') {
        return emptyThrottle();
      }
      return {
        lastAttemptMs: typeof o.lastAttemptMs === 'number' ? o.lastAttemptMs : 0,
        consecutiveFails: typeof o.consecutiveFails === 'number' ? o.consecutiveFails : 0,
        freezeUntilMs: typeof o.freezeUntilMs === 'number' ? o.freezeUntilMs : 0,
        // F01-01：新字段 retryAtMs 落盘（判据④重启后冷却仍生效）；旧数据缺字段 → undefined 走兼容分支
        retryAtMs: typeof o.retryAtMs === 'number' ? o.retryAtMs : undefined
      };
    } catch (e) {
      return emptyThrottle();
    }
  }

  static async save(t: RenewThrottle): Promise<void> {
    await Prefs.putString(KEY_THROTTLE, JSON.stringify(t));
  }

  static async clear(): Promise<void> {
    await Prefs.remove(KEY_THROTTLE);
  }
}
