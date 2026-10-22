/**
 * DDL（作业截止）存储（M4-2）。
 *
 * 对照 Android Room 的 ddl_schedule 表，落在 Prefs（JSON）——
 * 数据量小（一个学生几十条），不值得引 RDB（M2-8 的覆盖层才需要）。
 *
 * ## 只存原始事实
 * 存 epoch day + 当天分钟数（DateTime 的两个数），**不存**格式化串
 * （铁律 0.8：派生结果现算，过期作业的「已截止 N 天」随看随算）。
 *
 * ## 合并规则在 corelogic/DdlRules.ts（纯函数、有单测）
 * 本类只负责：JSON 读写 + 调合并 + 记 done。合并语义 = Android EclassDdlSyncer：
 * 按 uid 插入/更新，已存在的保留 done，服务端消失的条目不删。
 */

import { Prefs } from './Prefs.ts';
import { DdlEntry, mergeDdl, sortDdl, toEntry } from '../corelogic/DdlRules.ts';
import type { EclassDdlItem } from '../corelogic/EclassDdlLogic.ts';
import type { JsonValue } from '../core/model/SchoolModels.ts';
import { info, warn } from '../core/log/BitLog.ts';

const KEY: string = 'ddl_schedule_v1';

/** 读穿缓存（写入时同步更新；页面每次进 load 都命中）。 */
let cached: DdlEntry[] | null = null;

export class DdlStore {
  /** 全部 DDL（已按截止升序）。损坏的条目跳过并计数，不抛。 */
  static async load(): Promise<DdlEntry[]> {
    if (cached !== null) {
      return cached;
    }
    try {
      const raw: string = await Prefs.getString(KEY, '');
      if (raw.length === 0) {
        cached = [];
        return cached;
      }
      const parsed: DdlEntry[] = DdlStore.parse(raw);
      cached = sortDdl(parsed);
      return cached;
    } catch (e) {
      warn('DdlStore load fail: ' + JSON.stringify(e));
      cached = [];
      return cached;
    }
  }

  /**
   * 把一批同步结果合并进库（保留 done）。
   * @returns added=新插入条数 updated=更新条数 total=合并后总数
   */
  static async mergeIncoming(items: EclassDdlItem[], group: string):
    Promise<{ added: number; updated: number; total: number }> {
    const existing: DdlEntry[] = await DdlStore.load();
    const oldUids: Set<string> = new Set();
    for (let i = 0; i < existing.length; i++) {
      oldUids.add(existing[i].uid);
    }
    const incoming: DdlEntry[] = [];
    let added: number = 0;
    for (let i = 0; i < items.length; i++) {
      const uid: string = items[i].uid;
      if (!oldUids.has(uid)) {
        added++;
      }
      incoming.push(toEntry(items[i], group, false));
    }
    const merged: DdlEntry[] = mergeDdl(existing, incoming);
    const updated: number = incoming.length - added;
    await DdlStore.saveAll(merged);
    info('DdlStore merge group=' + group + ' added=' + added + ' updated=' + updated +
      ' total=' + merged.length);
    return { added: added, updated: updated, total: merged.length };
  }

  /** 勾选/取消完成（按 uid）。找不到返回 false（调用方可提示「条目已消失」）。 */
  static async setDone(uid: string, done: boolean): Promise<boolean> {
    const all: DdlEntry[] = await DdlStore.load();
    let hit: boolean = false;
    for (let i = 0; i < all.length; i++) {
      if (all[i].uid === uid) {
        all[i].done = done;
        hit = true;
      }
    }
    if (!hit) {
      return false;
    }
    await DdlStore.saveAll(all);
    return true;
  }

  /** 全清（登出/调试用）。 */
  static async clear(): Promise<void> {
    try {
      await Prefs.remove(KEY);
    } catch (e) {
      warn('DdlStore clear fail: ' + JSON.stringify(e));
    }
    cached = [];
    info('DdlStore cleared');
  }

  private static async saveAll(entries: DdlEntry[]): Promise<void> {
    await Prefs.putString(KEY, JSON.stringify(entries));
    cached = sortDdl(entries);
  }

  /** JSON → DdlEntry[]。缺字段/类型不对的条目跳过（记数由 warn 出）。 */
  private static parse(raw: string): DdlEntry[] {
    const arr: JsonValue[] = JSON.parse(raw) as JsonValue[];
    const out: DdlEntry[] = [];
    let bad: number = 0;
    for (let i = 0; i < arr.length; i++) {
      const rec = arr[i] as Record<string, JsonValue>;
      const uid: JsonValue | undefined = rec['uid'];
      const group: JsonValue | undefined = rec['group'];
      const title: JsonValue | undefined = rec['title'];
      const day: JsonValue | undefined = rec['day'];
      const minutes: JsonValue | undefined = rec['minutes'];
      const done: JsonValue | undefined = rec['done'];
      if (typeof uid !== 'string' || (uid as string).length === 0 ||
        typeof group !== 'string' || typeof title !== 'string' ||
        typeof day !== 'number' || typeof minutes !== 'number' ||
        typeof done !== 'boolean') {
        bad++;
        continue;
      }
      out.push({
        uid: uid as string,
        group: group as string,
        title: title as string,
        text: typeof rec['text'] === 'string' ? rec['text'] as string : '',
        day: day as number,
        minutes: minutes as number,
        done: done as boolean
      });
    }
    if (bad > 0) {
      warn('DdlStore parse skipped ' + bad + ' bad entries');
    }
    return out;
  }
}
