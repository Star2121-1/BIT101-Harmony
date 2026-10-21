/**
 * 提醒设置存储（M7-5，落 Prefs；13 项 1:1 对照 Android `NotifySettings`）。
 *
 * 纯逻辑（类型 / 默认值 / 提前量选项 / toPolicy / clampLead / normalizeSettings）
 * 在 **corelogic/NotifySettingsLogic**（不碰 Prefs，单测直接打）。本类只做
 * Prefs 的 JSON 读写 + 调归一化：
 *  - load：读 JSON → normalizeSettings（逐项回落默认，不整块回退）→ clampAll（越界提前量自纠）
 *  - save：直接落库
 *
 * 13 项与 Android「逐屏对得上」；plan() 只消费 toPolicy 挑出的 10 项，
 * 多出的 3 项（总开关 enabled / 出分 scoreEnabled / 考试前一天 examDayEnabled）
 * 各有去处（enabled 决定排不排、scoreEnabled 是 M7-3 预留、examDayEnabled 被
 * plan 的 examReminders 消费）。见 corelogic 头注释。
 *
 * 改动即重排：设置页每次改一个开关/提前量都 save + reschedule（对照 Android write
 * 块）——已排的 reminderAgent 按旧设置定时，不重排就「改了提前量却不生效」。
 */

import { Prefs } from './Prefs.ts';
import {
  type NotifySettings,
  DEFAULT_NOTIFY_SETTINGS,
  CLASS_LEAD_OPTIONS,
  SEAT_LEAD_OPTIONS,
  EXAM_LEAD_OPTIONS,
  toPolicy,
  clampAll,
  normalizeSettings
} from '../corelogic/NotifySettingsLogic.ts';
import { info, warn } from '../core/log/BitLog.ts';

// re-export：页面/排期器沿用 `from '../data/NotifySettingsStore.ts'` 就能拿到纯逻辑
export {
  type NotifySettings,
  DEFAULT_NOTIFY_SETTINGS,
  CLASS_LEAD_OPTIONS,
  SEAT_LEAD_OPTIONS,
  EXAM_LEAD_OPTIONS,
  toPolicy,
  clampLead,
  clampAll,
  normalizeSettings
} from '../corelogic/NotifySettingsLogic.ts';

const KEY: string = 'notify_settings_v1';

export class NotifySettingsStore {
  /** 读当前设置；空 → 全默认；损坏/缺字段 → 逐项回落默认 + 钳制越界提前量。 */
  static async load(): Promise<NotifySettings> {
    let raw: string = '';
    try {
      raw = await Prefs.getString(KEY, '');
    } catch (e) {
      warn('NotifySettings load fail: ' + JSON.stringify(e));
      return { ...DEFAULT_NOTIFY_SETTINGS };
    }
    if (raw.length === 0) {
      return { ...DEFAULT_NOTIFY_SETTINGS };
    }
    try {
      const o: Object = JSON.parse(raw) as Object;
      const rec: Record<string, Object> | null = (o !== null && typeof o === 'object' && !Array.isArray(o))
        ? o as Record<string, Object> : null;
      // 先按字段回落，再把越界的提前量钳回最近档（老数据/手改都能自纠）
      return clampAll(normalizeSettings(rec));
    } catch (e) {
      warn('NotifySettings parse corrupt, use defaults: ' + JSON.stringify(e));
      return { ...DEFAULT_NOTIFY_SETTINGS };
    }
  }

  /** 落库（存的就是归一化后的 13 项；页面 commit 前已用本地 @State 保证合法）。 */
  static async save(s: NotifySettings): Promise<void> {
    try {
      await Prefs.putString(KEY, JSON.stringify(s as Object));
      info('NotifySettings saved enabled=' + s.enabled);
    } catch (e) {
      warn('NotifySettings save fail: ' + JSON.stringify(e));
    }
  }

  /** 全清（调试 / 关提醒时用；回到默认值）。 */
  static async clear(): Promise<void> {
    try {
      await Prefs.remove(KEY);
      info('NotifySettings cleared');
    } catch (e) {
      warn('NotifySettings clear fail: ' + JSON.stringify(e));
    }
  }
}
