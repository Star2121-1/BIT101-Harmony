/**
 * 作业来源开关的落盘（M4-5）—— `Prefs` 薄壳，规则全在 `corelogic/DdlSourceLogic.ts`。
 *
 * 只有一个键：`ddl_source_prefs`，值形如 `eclass=1;local=1`。
 * 读坏了一律回落「两个都开」（宁可多显示，也不要让用户以为作业全丢了）。
 */

import { Prefs } from './Prefs.ts';
import { warn } from '../core/log/BitLog.ts';
import type { DdlSourcePrefs } from '../corelogic/DdlSourceLogic.ts';
import { decodePrefs, encodePrefs, DEFAULT_DDL_SOURCE } from '../corelogic/DdlSourceLogic.ts';

const KEY: string = 'ddl_source_prefs';

export class DdlSourceStore {
  static async load(): Promise<DdlSourcePrefs> {
    try {
      const raw: string = await Prefs.getString(KEY, '');
      return decodePrefs(raw);
    } catch (e) {
      warn('DdlSourceStore load fail: ' + JSON.stringify(e));
      return DEFAULT_DDL_SOURCE;
    }
  }

  static async save(p: DdlSourcePrefs): Promise<void> {
    await Prefs.putString(KEY, encodePrefs(p));
  }
}
