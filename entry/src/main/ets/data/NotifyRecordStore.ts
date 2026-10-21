/**
 * 通知历史记录（M7-1，落在 Prefs JSON）。
 *
 * 对照 Android `NotifySentStore`（14 天保留 + 已发键只增不减）：
 * 这里多存了 title/text/at 三个**排期时**的快照 —— 列表要显示「当时说了什么」，
 * 而课表/设置随时会变，现算的文案会说假话（与「缓存只存原始事实」不冲突：
 * 事实是「这条通知当时长这样」，相对时间（还剩 N 分钟）仍在页面现算）。
 *
 * 数据量：一周内几门课 × 提前量，几百条封顶 ⇒ Prefs 够用，不引 RDB
 *（与 DdlStore 同一取舍，见其头注释）。
 *
 * 合并 / 筛选 / 清理语义在 corelogic/NotifyRecordLogic.ts（纯函数、有单测），
 * 本类只负责 JSON 读写。
 */

import { Prefs } from './Prefs.ts';
import {
  NotifyRecord,
  allKinds,
  filterByKind,
  isFired,
  kindLabel,
  mergeNotifyRecords,
  pruneNotifyRecords,
  NOTIFY_KEEP_DAYS
} from '../corelogic/NotifyRecordLogic.ts';
import type { ReminderKind } from '../corelogic/NotifyLogic.ts';
import { info, warn } from '../core/log/BitLog.ts';

const KEY: string = 'notify_records_v1';

/** 单条记录的上界：超过说明键值被人写坏了，整条跳过（宁可丢一条不污染列表）。 */
const MAX_LEN: number = 512;

/** 读穿缓存（写入同步更新；列表页每次进入 load 都命中）。 */
let cached: NotifyRecord[] | null = null;

export class NotifyRecordStore {
  /** 全部记录（atMillis 升序）。损坏条目跳过并计数，不抛。 */
  static async load(): Promise<NotifyRecord[]> {
    if (cached !== null) {
      return cached;
    }
    try {
      const raw: string = await Prefs.getString(KEY, '');
      if (raw.length === 0) {
        cached = [];
        return cached;
      }
      cached = NotifyRecordStore.parse(raw);
      cached.sort((a: NotifyRecord, b: NotifyRecord) => a.atMillis - b.atMillis);
      return cached;
    } catch (e) {
      warn('NotifyRecordStore load fail: ' + JSON.stringify(e));
      cached = [];
      return cached;
    }
  }

  /**
   * 排期后写入一批（含旧记录的重排更新 + 已发回滚保护，
   * 语义 = NotifyRecordLogic.mergeNotifyRecords）。
   *
   * @returns 写入后的总数
   */
  static async merge(incoming: NotifyRecord[]): Promise<number> {
    const existing: NotifyRecord[] = await NotifyRecordStore.load();
    const merged: NotifyRecord[] = mergeNotifyRecords(existing, incoming);
    // 顺手清 14 天前的（不另设入口，排期本来每次开 App 就重跑）
    const now: number = Date.now();
    const pruned: { kept: NotifyRecord[]; removed: number } = pruneNotifyRecords(merged, now);
    if (pruned.removed > 0) {
      info('NotifyRecordStore pruned=' + pruned.removed);
    }
    await NotifyRecordStore.saveAll(pruned.kept);
    return pruned.kept.length;
  }

  /** 标记「已发」（M7-2 触发通知时回填；firedMillis 传发出时刻）。 */
  static async markFired(key: string, firedMillis: number): Promise<void> {
    const all: NotifyRecord[] = await NotifyRecordStore.load();
    for (let i = 0; i < all.length; i++) {
      if (all[i].key === key) {
        all[i].firedMillis = firedMillis;
        await NotifyRecordStore.saveAll(all);
        return;
      }
    }
    // 记录被剪掉才找不到（14 天外）——正常路径不会走到，记个日志
    warn('NotifyRecordStore markFired miss ' + key);
  }

  /** 全清（调试 / 关提醒时用；不动 NotifySentStore 的已发键）。 */
  static async clear(): Promise<void> {
    try {
      await Prefs.remove(KEY);
    } catch (e) {
      warn('NotifyRecordStore clear fail: ' + JSON.stringify(e));
    }
    cached = [];
    info('NotifyRecordStore cleared');
  }

  /** 未发的条数（列表页 chip 显示用，现算不缓存）。 */
  static pendingCount(records: NotifyRecord[]): number {
    let n: number = 0;
    for (let i = 0; i < records.length; i++) {
      if (!isFired(records[i])) {
        n++;
      }
    }
    return n;
  }

  /** 按类型筛（null = 全部），atMillis 升序。 */
  static byKind(records: NotifyRecord[], kind: ReminderKind | null): NotifyRecord[] {
    return filterByKind(records, kind);
  }

  /** 类型筛选 tab（顺序固定：全部 + 五类，标签 = 中文）。 */
  static filterTabs(): { kind: ReminderKind | null; label: string }[] {
    const out: { kind: ReminderKind | null; label: string }[] = [];
    out.push({ kind: null, label: '全部' });
    const kinds: ReminderKind[] = allKinds();
    for (let i = 0; i < kinds.length; i++) {
      out.push({ kind: kinds[i], label: kindLabel(kinds[i]) });
    }
    return out;
  }

  /** 展示用的相对/绝对时间（「12-08 08:40」+ 已发时补「已发」由页面控制）。 */
  static fmtAt(rec: NotifyRecord): string {
    const d: Date = new Date(rec.atMillis);
    const mm: string = (d.getMonth() + 1).toString().padStart(2, '0');
    const dd: string = d.getDate().toString().padStart(2, '0');
    const hh: string = d.getHours().toString().padStart(2, '0');
    const mi: string = d.getMinutes().toString().padStart(2, '0');
    return mm + '-' + dd + ' ' + hh + ':' + mi;
  }

  private static async saveAll(records: NotifyRecord[]): Promise<void> {
    await Prefs.putString(KEY, JSON.stringify(records));
    cached = records;
  }

  private static parse(raw: string): NotifyRecord[] {
    const arr: Object[] = JSON.parse(raw) as Object[];
    const out: NotifyRecord[] = [];
    let bad: number = 0;
    const kinds: Set<string> = new Set<string>();
    const kk: ReminderKind[] = allKinds();
    for (let i = 0; i < kk.length; i++) {
      kinds.add(kk[i]);
    }
    for (let i = 0; i < arr.length; i++) {
      const rec = arr[i] as Record<string, Object>;
      const key: unknown = rec['key'];
      const kind: unknown = rec['kind'];
      const title: unknown = rec['title'];
      const text: unknown = rec['text'];
      const at: unknown = rec['atMillis'];
      const fired: unknown = rec['firedMillis'];
      if (typeof key !== 'string' || key.length === 0 || key.length > MAX_LEN ||
        typeof kind !== 'string' || !kinds.has(kind) ||
        typeof title !== 'string' || title.length > MAX_LEN ||
        typeof text !== 'string' || text.length > MAX_LEN ||
        typeof at !== 'number' || !Number.isFinite(at) ||
        typeof fired !== 'number' || !Number.isFinite(fired)) {
        bad++;
        continue;
      }
      out.push({
        key: key as string,
        kind: kind as ReminderKind,
        title: title as string,
        text: text as string,
        atMillis: at as number,
        firedMillis: fired as number
      });
    }
    if (bad > 0) {
      warn('NotifyRecordStore parse skipped ' + bad + ' bad entries');
    }
    return out;
  }
}

/** 记录保留天数（re-export 给页面/设置文案用）。 */
export const NOTIFY_RECORD_KEEP_DAYS: number = NOTIFY_KEEP_DAYS;
