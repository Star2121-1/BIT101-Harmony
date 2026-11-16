/**
 * 即时提醒的去重状态（M14-A）。
 *
 * 两个独立的持久状态，**都不做 14 天 prune**：
 *  - 流量：`lastBytes / warnedNear / warnedLimit`，只在计费周期重置时复位；
 *  - 借阅：已提醒过的 `BorrowRecord.key` 集合，同一本书不还就永不重报。
 *
 * 这两条与 Android 的 `netflow_alert` / `lib_due_alert` SharedPreferences 同义。
 * ⚠️ 不能塞进 `NotifySentStore`：那个表按 14 天清理，会把「每周期一次」
 * 悄悄变成「每 14 天一次」，属于用缓存策略改写业务承诺。
 */

import { Prefs } from './Prefs.ts';
import { initialFlowAlertState } from '../corelogic/InstantAlertLogic.ts';
import type { FlowAlertState } from '../corelogic/InstantAlertLogic.ts';
import { info, warn } from '../core/log/BitLog.ts';

const KEY_FLOW: string = 'instant_alert_flow_v1';
const KEY_LIB: string = 'instant_alert_lib_v1';

/** JSON → 对象记录；不是对象就返回 null（调用方回落默认）。 */
function asRecord(raw: string): Record<string, Object> | null {
  if (raw.length === 0) {
    return null;
  }
  try {
    const v: Object = JSON.parse(raw) as Object;
    if (v === null || typeof v !== 'object' || Array.isArray(v)) {
      return null;
    }
    return v as Record<string, Object>;
  } catch (e) {
    warn('InstantAlertStore parse fail: ' + JSON.stringify(e));
    return null;
  }
}

function boolOf(v: Object | undefined, fallback: boolean): boolean {
  return typeof v === 'boolean' ? (v as boolean) : fallback;
}

function numOf(v: Object | undefined, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v as number) ? (v as number) : fallback;
}

export class InstantAlertStore {
  /** 流量状态；损坏 → 初始态（宁可多提醒一次，也不要整块不发）。 */
  static async loadFlow(): Promise<FlowAlertState> {
    const rec: Record<string, Object> | null = asRecord(await Prefs.getString(KEY_FLOW, ''));
    if (rec === null) {
      return initialFlowAlertState();
    }
    return {
      lastBytes: numOf(rec['lastBytes'], -1),
      warnedNear: boolOf(rec['warnedNear'], false),
      warnedLimit: boolOf(rec['warnedLimit'], false)
    };
  }

  /** 落流量状态（同步 flush；force-stop 丢了标记就会重复提醒）。 */
  static async saveFlow(s: FlowAlertState): Promise<void> {
    try {
      await Prefs.putString(KEY_FLOW, JSON.stringify(s as Object));
    } catch (e) {
      warn('InstantAlertStore saveFlow fail: ' + JSON.stringify(e));
    }
  }

  /** 已提醒过的借阅键；损坏 → 空集合。 */
  static async loadLibKeys(): Promise<string[]> {
    const raw: string = await Prefs.getString(KEY_LIB, '');
    if (raw.length === 0) {
      return [];
    }
    try {
      const v: Object = JSON.parse(raw) as Object;
      if (!Array.isArray(v)) {
        return [];
      }
      const arr: Object[] = v as Object[];
      const out: string[] = [];
      for (let i = 0; i < arr.length; i++) {
        if (typeof arr[i] === 'string') {
          out.push(arr[i] as string);
        }
      }
      return out;
    } catch (e) {
      warn('InstantAlertStore loadLibKeys fail: ' + JSON.stringify(e));
      return [];
    }
  }

  /** 只追加新键（已有的不动；Android 用 `alerted + fresh.map` 同义）。 */
  static async markLibKeys(keys: string[]): Promise<void> {
    if (keys.length === 0) {
      return;
    }
    const existing: string[] = await InstantAlertStore.loadLibKeys();
    const seen: Set<string> = new Set<string>();
    for (let i = 0; i < existing.length; i++) {
      seen.add(existing[i]);
    }
    for (let i = 0; i < keys.length; i++) {
      seen.add(keys[i]);
    }
    const out: string[] = [];
    seen.forEach((k: string) => {
      out.push(k);
    });
    try {
      await Prefs.putString(KEY_LIB, JSON.stringify(out));
      info('InstantAlertStore lib keys=' + out.length);
    } catch (e) {
      warn('InstantAlertStore markLibKeys fail: ' + JSON.stringify(e));
    }
  }
}
