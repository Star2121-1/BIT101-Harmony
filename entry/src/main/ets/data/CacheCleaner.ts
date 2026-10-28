/**
 * 缓存清理的**执行层**（`CacheIndex` 提供白名单，这里只做 I/O）。
 *
 * 纪律：
 *  - **只删白名单命中的键**（`assignKeys` 决定），绝不按「前缀模糊匹配」扫全库；
 *  - 清理后**不主动刷新页面**（调用方知道自己在看什么数据），但返回清了几个键；
 *  - 单个键删失败不中断（继续删下一个，最后汇总失败数）—— 一个坏键不该让整次清理白做。
 */

import { Prefs } from './Prefs.ts';
import { assignKeys, specs } from '../corelogic/CacheIndex.ts';
import type { CacheSpec } from '../corelogic/CacheIndex.ts';
import { info, warn } from '../core/log/BitLog.ts';

/** 一个可清理项的实际占用。 */
export interface CacheUsage {
  spec: CacheSpec;
  keys: string[];
  bytes: number;
}

/** 一次清理的结果。 */
export interface ClearResult {
  /** 删掉的键数。 */
  removed: number;
  /** 删除失败的键数。 */
  failed: number;
}

/**
 * 统计各项占用。
 * 读不到键（Prefs 未初始化/异常）⇒ 返回空数组，页面显示「0 项」而不是崩。
 */
export async function measure(includeUserData: boolean): Promise<CacheUsage[]> {
  const allKeys: string[] = await Prefs.keys();
  const assigned: Map<string, string[]> = assignKeys(allKeys, includeUserData);
  const out: CacheUsage[] = [];
  const list: CacheSpec[] = specs(includeUserData);
  for (let i = 0; i < list.length; i++) {
    const keys: string[] | undefined = assigned.get(list[i].kind);
    if (keys === undefined || keys.length === 0) {
      continue; // 没有实际键的项不显示（避免「课表缓存 0 B」这种噪音）
    }
    let bytes: number = 0;
    for (let k = 0; k < keys.length; k++) {
      bytes += await Prefs.rawSize(keys[k]);
    }
    out.push({ spec: list[i], keys: keys, bytes: bytes });
  }
  return out;
}

/** 清空某一项（只删它的白名单键）。 */
export async function clearKind(kind: string, includeUserData: boolean): Promise<ClearResult> {
  const list: CacheSpec[] = specs(includeUserData);
  let target: CacheSpec | null = null;
  for (let i = 0; i < list.length; i++) {
    if (list[i].kind === kind) {
      target = list[i];
      break;
    }
  }
  if (target === null) {
    return { removed: 0, failed: 0 }; // 不在白名单：什么都不做
  }
  const allKeys: string[] = await Prefs.keys();
  const assigned: Map<string, string[]> = assignKeys(allKeys, includeUserData);
  const keys: string[] | undefined = assigned.get(kind);
  if (keys === undefined) {
    return { removed: 0, failed: 0 };
  }
  let removed: number = 0;
  let failed: number = 0;
  for (let i = 0; i < keys.length; i++) {
    try {
      await Prefs.remove(keys[i]);
      removed += 1;
    } catch (e) {
      failed += 1;
      warn('CacheCleaner remove fail key=' + keys[i] + ': ' + JSON.stringify(e));
    }
  }
  info('CacheCleaner cleared kind=' + kind + ' removed=' + removed + ' failed=' + failed);
  return { removed: removed, failed: failed };
}

/** 批量清理（页面「全部清理」用）。 */
export async function clearKinds(kinds: string[], includeUserData: boolean): Promise<ClearResult> {
  let removed: number = 0;
  let failed: number = 0;
  for (let i = 0; i < kinds.length; i++) {
    const r: ClearResult = await clearKind(kinds[i], includeUserData);
    removed += r.removed;
    failed += r.failed;
  }
  return { removed: removed, failed: failed };
}
