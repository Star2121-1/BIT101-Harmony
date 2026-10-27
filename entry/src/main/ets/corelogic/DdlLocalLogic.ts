/**
 * 本地作业条目（原版「＋」FAB 新增）的纯规则。
 *
 * 为什么单独抽出来：这里两条都是「写错了看起来也正常」的坑 ——
 *
 * 1. **uid 前缀决定「谁能删」**：同步来的条目（`eclass:` / `lexue:`）被删掉，下次同步又回来，
 *    用户会以为删除失败；反过来本地条目没有前缀标记，用户永远删不掉自己加的东西。
 * 2. **同毫秒连点两次会撞 uid**：两个条目共用一个键，勾选一个另一个跟着变（或者合并时丢一条）。
 *
 * 所以这两件事必须有单测。`DdlStore` 依赖 `Prefs`（@kit）在 node 下跑不了，
 * 把规则抽到这个零依赖模块，测试才能直接打真实函数。
 */

import type { DdlEntry } from './DdlRules.ts';

/** 本地条目的 uid 前缀（同步条目永远不带这个前缀）。 */
export const LOCAL_UID_PREFIX: string = 'local_';

/** 是否本地条目（只有本地条目允许删除）。 */
export function isLocalUid(uid: string): boolean {
  return uid.startsWith(LOCAL_UID_PREFIX);
}

/** 基础 uid：`local_<毫秒>`。 */
export function makeLocalUid(nowMs: number): string {
  return LOCAL_UID_PREFIX + Math.floor(nowMs).toString();
}

/**
 * 保证不撞键：同毫秒已经有同 uid 时，后缀 `_2`、`_3` …
 * （不用随机数：可复现才好写断言。）
 */
export function uniqueLocalUid(nowMs: number, existing: DdlEntry[]): string {
  const base: string = makeLocalUid(nowMs);
  let uid: string = base;
  let i: number = 2;
  while (existing.some((e: DdlEntry) => e.uid === uid)) {
    uid = base + '_' + i.toString();
    i++;
  }
  return uid;
}

/** 追加一条（返回新数组，不改入参：调用方可能还在用旧引用算列表）。 */
export function appendLocal(entries: DdlEntry[], entry: DdlEntry): DdlEntry[] {
  return entries.concat([entry]);
}

/** 删除结果：删除后的数组 + 是否真的删掉了（给调用方决定要不要 persist）。 */
export interface LocalRemoveResult {
  kept: DdlEntry[];
  removed: boolean;
}

/**
 * 删除本地条目。**只允许 `local_` 前缀** —— 同步来的条目归教务管，删了也会回来。
 * 找不到 / 非本地前缀 ⇒ removed=false 且原样返回（调用方据此提示，不写盘）。
 */
export function removeLocalEntry(entries: DdlEntry[], uid: string): LocalRemoveResult {
  if (!isLocalUid(uid)) {
    return { kept: entries, removed: false };
  }
  const kept: DdlEntry[] = entries.filter((e: DdlEntry) => e.uid !== uid);
  return { kept: kept, removed: kept.length !== entries.length };
}
