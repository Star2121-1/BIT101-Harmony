/**
 * 免打扰时段存储（M12-2，落 Prefs）。
 *
 * 纯逻辑在 `corelogic/QuietHoursLogic`（窗口判断 / 推迟算法，59 条断言），
 * 本类只做 JSON 读写 + 调 `normalizeQuietHours` 归一化。
 *
 * ⚠️ 与 `notify_settings_v1` **分开存**：免打扰是「什么时候别响」，
 * 提醒设置是「响什么」。合在一个 JSON 里，任一侧字段改名都会把另一侧拖下水；
 * 而且关掉提醒总开关时用户仍希望免打扰配置留着（再打开不用重设）。
 */

import { Prefs } from './Prefs.ts';
import {
  type QuietHours,
  DEFAULT_QUIET_HOURS,
  normalizeQuietHours
} from '../corelogic/QuietHoursLogic.ts';
import { info, warn } from '../core/log/BitLog.ts';

export {
  type QuietHours,
  DEFAULT_QUIET_HOURS,
  QUIET_PRESETS,
  minuteText,
  parseMinute,
  quietSummary,
  quietHint,
  clampMinute
} from '../corelogic/QuietHoursLogic.ts';
export type { QuietPreset } from '../corelogic/QuietHoursLogic.ts';

const KEY: string = 'quiet_hours_v1';

export class QuietHoursStore {
  /** 读设置；空/损坏 → 默认（关闭）。脏字段逐项回落，不整块回退。 */
  static async load(): Promise<QuietHours> {
    let raw: string = '';
    try {
      raw = await Prefs.getString(KEY, '');
    } catch (e) {
      warn('QuietHours load fail: ' + JSON.stringify(e));
      return { ...DEFAULT_QUIET_HOURS };
    }
    if (raw.length === 0) {
      return { ...DEFAULT_QUIET_HOURS };
    }
    try {
      const o: Object = JSON.parse(raw) as Object;
      const rec: Record<string, Object> | null = (o !== null && typeof o === 'object' && !Array.isArray(o))
        ? o as Record<string, Object> : null;
      return normalizeQuietHours(rec);
    } catch (e) {
      warn('QuietHours parse corrupt, use defaults: ' + JSON.stringify(e));
      return { ...DEFAULT_QUIET_HOURS };
    }
  }

  static async save(q: QuietHours): Promise<void> {
    try {
      await Prefs.putString(KEY, JSON.stringify(q as Object));
      info('QuietHours saved enabled=' + q.enabled + ' ' + q.startMinute + '-' + q.endMinute);
    } catch (e) {
      warn('QuietHours save fail: ' + JSON.stringify(e));
    }
  }

  static async clear(): Promise<void> {
    try {
      await Prefs.remove(KEY);
      info('QuietHours cleared');
    } catch (e) {
      warn('QuietHours clear fail: ' + JSON.stringify(e));
    }
  }
}
