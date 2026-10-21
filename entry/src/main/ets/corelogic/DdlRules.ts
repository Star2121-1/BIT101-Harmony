/**
 * DDL（作业截止）合并与排序规则 —— 纯函数，组件与同步链路共用。
 *
 * 1:1 对照 Android `EclassDdlSyncer`（data/repo/EclassDdlSyncer.kt）：
 *  「按 uid 做『不存在插入 / 存在更新』；已存在的**保留 done** ——
 *   用户勾过的『已完成』不能被同步冲掉。」
 * 并且**不删除**服务端已消失的条目（Android 同样不删）——过期作业由页面
 * 标记展示，不由同步链路悄悄抹掉。
 *
 * 为什么值得单测：合并规则错一次 = 「勾掉完成的作业，同步后又变回未完成」，
 * 用户会认为自己的操作丢了。这是能证伪的规则，必须钉死。
 */

import type { EclassDdlItem } from './EclassDdlLogic.ts';

/** 一条 DDL（对照 Android DDLScheduleEntity，去掉自增 id）。 */
export interface DdlEntry {
  /** 稳定去重键（eclass:{activityId} / lexue:…）。 */
  uid: string;
  /** 来源分组（eclass / lexue，M4-5 切源用）。 */
  group: string;
  title: string;
  /** 课程名（Android 的 text 字段）。 */
  text: string;
  /** 截止：epoch day。 */
  day: number;
  /** 截止：当天分钟数。 */
  minutes: number;
  done: boolean;
}

/** EclassDdlItem → DdlEntry（done 由合并方决定，这里只搬字段）。 */
export function toEntry(item: EclassDdlItem, group: string, done: boolean): DdlEntry {
  return {
    uid: item.uid,
    group: group,
    title: item.title,
    text: item.text,
    day: item.time.day,
    minutes: item.time.minutes,
    done: done
  };
}

/**
 * 合并一批同步结果进现有列表（同一 group 内按 uid）。
 *
 * 规则（逐条对应 Android）：
 *  1. uid 不存在        ⇒ 插入，done=false（新作业默认未完成）
 *  2. uid 已存在        ⇒ 更新 title/text/day/minutes，**保留原 done**
 *  3. 服务端消失的 uid   ⇒ 原样保留（不删）
 *  4. 不同 group 的条目  ⇒ 原样保留
 */
export function mergeDdl(existing: DdlEntry[], incoming: DdlEntry[]): DdlEntry[] {
  const byUid: Map<string, DdlEntry> = new Map();
  for (let i = 0; i < existing.length; i++) {
    byUid.set(existing[i].uid, existing[i]);
  }
  for (let i = 0; i < incoming.length; i++) {
    const item: DdlEntry = incoming[i];
    const old: DdlEntry | undefined = byUid.get(item.uid);
    if (old === undefined) {
      // 新作业：done 强制 false（调用方传的 done 在插入时无意义，防误传 true）
      byUid.set(item.uid, { ...item, done: false });
    } else {
      // 已存在：保留 done；group 以旧记录为准（同 uid 只可能来自同一源）
      byUid.set(item.uid, {
        uid: old.uid,
        group: old.group,
        title: item.title,
        text: item.text,
        day: item.day,
        minutes: item.minutes,
        done: old.done
      });
    }
  }
  const out: DdlEntry[] = [];
  byUid.forEach((v: DdlEntry) => {
    out.push(v);
  });
  return sortDdl(out);
}

/** 按截止时间升序（day 优先，同日按 minutes）。稳定排序：相等保持原相对次序。 */
export function sortDdl(entries: DdlEntry[]): DdlEntry[] {
  const indexed = entries.map((e: DdlEntry, i: number) => ({ e: e, i: i }));
  indexed.sort((a, b) => {
    if (a.e.day !== b.e.day) {
      return a.e.day - b.e.day;
    }
    if (a.e.minutes !== b.e.minutes) {
      return a.e.minutes - b.e.minutes;
    }
    return a.i - b.i;
  });
  return indexed.map((x) => x.e);
}

/** 按 uid 找一条（页面勾完成时用）。 */
export function findDdl(entries: DdlEntry[], uid: string): DdlEntry | null {
  for (let i = 0; i < entries.length; i++) {
    if (entries[i].uid === uid) {
      return entries[i];
    }
  }
  return null;
}
