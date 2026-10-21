/**
 * 通知历史的合并 / 筛选 / 清理（M7-1，纯函数，单测直接打）。
 *
 * 对照 Android `NotifySentStore`（14 天保留）+ 各 Checker 的去重纪律。
 * 存储只存**原始事实**（epoch millis），「还剩 N 分钟」这类相对文案在
 * 页面里现算（铁律 0.8：缓存绝不放与当前时间相关的派生值）。
 */

import { ReminderKind } from './NotifyLogic.ts';

/** 一条通知记录（排期时写入，触发后回填 firedMillis）。 */
export interface NotifyRecord {
  /** 去重键（与 Reminder.key 同一口径；重排只改显示字段，键不变）。 */
  key: string;
  kind: ReminderKind;
  title: string;
  text: string;
  /** 排定的触发时刻。 */
  atMillis: number;
  /** 实际发出时刻；0 = 排期了还没发（或永远不会发，到点被剪掉）。 */
  firedMillis: number;
}

/** 记录保留天数（与 Android NotifySentStore.KEEP_DAYS 一致）。 */
export const NOTIFY_KEEP_DAYS: number = 14;

/**
 * 合并新排的一批记录进旧表。
 *
 * 规则：
 * - 按 key 去重，新记录**覆盖**旧记录的 title/text/at（设置改了提前量重排
 *   后要以新排期为准）；
 * - **已发不回滚**：旧记录 firedMillis > 0 时保留（Android 同纪律：
 *   sentKeys 只增不减，「发过的事」不因重排而假装没发过）；
 * - 旧表里有、新表没有的记录**保留**（那门课可能只是这次没排进来，
 *   删了历史列表就出现「记录蒸发」）。
 *
 * ⚠️ 返回新数组，不改入参。
 */
export function mergeNotifyRecords(existing: NotifyRecord[], incoming: NotifyRecord[]): NotifyRecord[] {
  const out: NotifyRecord[] = [];
  const seen: Set<string> = new Set<string>();
  for (let i = 0; i < existing.length; i++) {
    out.push(existing[i]);
    seen.add(existing[i].key);
  }
  for (let i = 0; i < incoming.length; i++) {
    const rec: NotifyRecord = incoming[i];
    let idx: number = -1;
    for (let j = 0; j < out.length; j++) {
      if (out[j].key === rec.key) {
        idx = j;
        break;
      }
    }
    if (idx >= 0) {
      const old: NotifyRecord = out[idx];
      out[idx] = {
        key: rec.key,
        kind: rec.kind,
        title: rec.title,
        text: rec.text,
        atMillis: rec.atMillis,
        // 已发的保留原触发时刻；没发过的更新排期（firedMillis 保持 0）
        firedMillis: old.firedMillis > 0 ? old.firedMillis : 0
      };
    } else {
      out.push(rec);
    }
  }
  return out;
}

/**
 * 剪掉过期记录。
 *
 * - 已发（firedMillis > 0）且早于 now - 14 天 ⇒ 剪；
 * - 排期（firedMillis = 0）且 atMillis 早于 now - 14 天（烂尾没发）⇒ 剪；
 * - 其余一律保留（未来 / 最近 14 天的都留）。
 *
 * @returns { kept, removed }
 */
export function pruneNotifyRecords(records: NotifyRecord[], nowMillis: number): { kept: NotifyRecord[]; removed: number } {
  const deadline: number = nowMillis - NOTIFY_KEEP_DAYS * 24 * 3600 * 1000;
  const kept: NotifyRecord[] = [];
  let removed: number = 0;
  for (let i = 0; i < records.length; i++) {
    const rec: NotifyRecord = records[i];
    const anchor: number = rec.firedMillis > 0 ? rec.firedMillis : rec.atMillis;
    if (anchor < deadline) {
      removed++;
      continue;
    }
    kept.push(rec);
  }
  return { kept: kept, removed: removed };
}

/** 按类型筛（null = 全部）。结果按 atMillis 升序。 */
export function filterByKind(records: NotifyRecord[], kind: ReminderKind | null): NotifyRecord[] {
  const out: NotifyRecord[] = [];
  for (let i = 0; i < records.length; i++) {
    if (kind === null || records[i].kind === kind) {
      out.push(records[i]);
    }
  }
  out.sort((a: NotifyRecord, b: NotifyRecord) => a.atMillis - b.atMillis);
  return out;
}

/** 类型中文（列表 chip 与筛选用，逐字对照 Android 通知渠道名）。 */
export function kindLabel(kind: ReminderKind): string {
  switch (kind) {
    case ReminderKind.CLASS:
      return '上课';
    case ReminderKind.DDL:
      return '作业';
    case ReminderKind.SEAT_SIGN_IN:
      return '座位签到';
    case ReminderKind.EXAM:
      return '考试';
    case ReminderKind.ADJUSTMENT:
      return '教学调整';
    default:
      return '提醒';
  }
}

/** 全部类型（筛选项渲染用，顺序固定）。 */
export function allKinds(): ReminderKind[] {
  return [
    ReminderKind.CLASS,
    ReminderKind.DDL,
    ReminderKind.SEAT_SIGN_IN,
    ReminderKind.EXAM,
    ReminderKind.ADJUSTMENT
  ];
}

/**
 * 记录是否「已发」。 firedMillis > atMillis 才算（fired=0 是排期中；
 * fired 恰好等于 at 的边界也当作已发 —— 发过就是发过）。
 */
export function isFired(rec: NotifyRecord): boolean {
  return rec.firedMillis >= rec.atMillis && rec.firedMillis > 0;
}
