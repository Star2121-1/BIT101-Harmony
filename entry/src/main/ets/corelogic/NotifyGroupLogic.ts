/**
 * 通知列表的**分组与未读**（纯函数，零依赖）。
 *
 * 现状：通知页只有类型 tab，一屏几十条平铺，看不出「哪些是新的」。
 * 这里补两件事，且都保持「不造假」：
 *  1. **按天分组**：今天 / 昨天 / 本周 / 更早。分组靠**记录已按时间倒序**这个前提，
 *     函数只输出连续区间的边界（`GroupSpan`），页面切片即可 —— 不在页面里重写分组逻辑。
 *  2. **未读数**：以「上次打开通知页的时刻」为界，`firedMillis > lastSeen` 才算未读。
 *     **只统计真的发出去的**（`firedMillis > 0`）；排期了还没发的不是「未读」。
 */

/** 分组最少需要的字段（`NotifyRecord` 结构兼容，页面可直接传）。 */
export interface NotifyTimedItem {
  /** 排定时刻。 */
  atMillis: number;
  /** 实际发出时刻；0 = 还没发。 */
  firedMillis: number;
}

/** 一个连续分组（半开区间 `[start, end)`，作用于调用方传入的数组下标）。 */
export interface GroupSpan {
  label: string;
  start: number;
  end: number;
}

/** 一天的毫秒数。 */
export const DAY_MS: number = 86400000;

/** epoch 毫秒 → 本地日序号（按 UTC 偏移 0 处理会跨时区错一天，这里用调用方给的 offset）。 */
export function dayIndex(millis: number, tzOffsetMs: number): number {
  if (!Number.isFinite(millis) || millis <= 0) {
    return -1;
  }
  return Math.floor((millis + tzOffsetMs) / DAY_MS);
}

/** 日序号 → 分组名。 */
export function labelOfDay(day: number, todayDay: number): string {
  if (day < 0) {
    return '时间未定';
  }
  if (day === todayDay) {
    return '今天';
  }
  if (day === todayDay - 1) {
    return '昨天';
  }
  if (day >= todayDay - 6) {
    return '本周早些时候';
  }
  return '更早';
}

/**
 * 连续分组边界。要求 `items` **已按时间倒序**（`NotifyRecordStore` 的返回顺序）。
 */
export function groupSpans(items: NotifyTimedItem[], nowMillis: number, tzOffsetMs: number): GroupSpan[] {
  const out: GroupSpan[] = [];
  if (items.length === 0) {
    return out;
  }
  const today: number = dayIndex(nowMillis, tzOffsetMs);
  let curLabel: string = '';
  let start: number = 0;
  for (let i = 0; i < items.length; i++) {
    // 已发出的用发出时刻，未发出的用排定时刻（排期在未来时归「今天」，不因未发而消失）
    const t: number = items[i].firedMillis > 0 ? items[i].firedMillis : items[i].atMillis;
    const label: string = labelOfDay(dayIndex(t, tzOffsetMs), today);
    if (i === 0) {
      curLabel = label;
      start = 0;
      continue;
    }
    if (label !== curLabel) {
      out.push({ label: curLabel, start: start, end: i });
      curLabel = label;
      start = i;
    }
  }
  out.push({ label: curLabel, start: start, end: items.length });
  return out;
}

/**
 * 未读数：`firedMillis > lastSeenMillis` 的条数。
 * `lastSeenMillis <= 0`（从没打开过）时**全部已发都算未读** —— 这与「第一次进来看到红点」一致。
 */
export function unreadCount(items: NotifyTimedItem[], lastSeenMillis: number): number {
  let n: number = 0;
  for (let i = 0; i < items.length; i++) {
    const f: number = items[i].firedMillis;
    if (f > 0 && (lastSeenMillis <= 0 || f > lastSeenMillis)) {
      n += 1;
    }
  }
  return n;
}

/** 未读徽标文案：`0 → ''`、`>99 → '99+'`（避免把数字撑爆标题栏）。 */
export function badgeText(n: number): string {
  if (n <= 0) {
    return '';
  }
  return n > 99 ? '99+' : String(n);
}

/** 清空确认文案（页面上要问清楚删的是什么：「已发记录」而不是「提醒设置」）。 */
export function clearConfirmText(count: number): string {
  return '将删除本机保存的 ' + count + ' 条提醒记录（不影响提醒设置，也不影响学校的任何数据）。';
}
