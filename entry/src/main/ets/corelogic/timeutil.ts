/**
 * 时间与日期的纯函数工具（java.time 的鸿蒙替代，决策记录见 README）。
 *
 * 表示法（与 Android 侧语义严格对齐）：
 * - 时刻 = 当天分钟数（0..1439），LocalTime 只用 HH:mm（源码注释：站牌/作息精度就是分钟）
 * - 日期 = epoch day（1970-01-01 = 0，与 java.time.LocalDate.toEpochDay 同口径）
 * - 星期 = 1..7（周一..周日，与 java.time.DayOfWeek.getValue 同口径）
 *
 * ⚠️ 全部纯函数：不读系统时间。调用方（含测试）显式传 now/today ——
 * 这是 Android 缓存铁律 0.8 的鸿蒙版：函数内部拿时间=不可测=会缓存出错。
 */

/** 时刻 → "HH:mm"（对齐 Kotlin "%02d:%02d".format）。 */
export function fmtHM(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

/** 时刻 → "H:mm"（对齐站牌原始记法，ShuttleLogic 数据校对用）。 */
export function fmtHMLoose(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
}

/** "HH:mm" 或 "H:mm" → 时刻；解析失败返回 null。 */
export function parseHM(text: string): number | null {
  const m = /^(\d{1,2}):(\d{1,2})$/.exec(text.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (h > 23 || mm > 59) return null;
  return h * 60 + mm;
}

/** 构造时刻（不校验范围，调用方保证）。 */
export function hm(hour: number, minute: number): number {
  return hour * 60 + minute;
}

/** "yyyy-MM-dd" → epoch day；不合法返回 null。 */
export function parseISODate(text: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const days = Date.UTC(y, mo - 1, d) / 86400000;
  // 校验回环（过滤 2 月 30 日之类）
  if (isoDate(days) !== `${String(y).padStart(4, "0")}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`) {
    return null;
  }
  return days;
}

/** epoch day → "yyyy-MM-dd"。 */
export function isoDate(epochDay: number): string {
  const dt = new Date(epochDay * 86400000);
  const y = dt.getUTCFullYear();
  const mo = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  return `${String(y).padStart(4, "0")}-${mo}-${d}`;
}

/** epoch day → 星期（1=周一 … 7=周日，对齐 java.time.DayOfWeek.getValue）。 */
export function dayOfWeekMon1(epochDay: number): number {
  // 1970-01-01 是周四（=4）；公式 ((d + 3) % 7) + 1
  return (((epochDay + 3) % 7) + 7) % 7 + 1;
}

/** 中文星期（对齐 Android 侧 weekdayCn 的"周X"口径）。 */
export function weekdayCn(epochDay: number): string {
  return `周${"一二三四五六日".charAt(dayOfWeekMon1(epochDay) - 1)}`;
}

/** 日期差（b - a，单位天；对齐 ChronoUnit.DAYS.between）。 */
export function daysBetween(fromEpochDay: number, toEpochDay: number): number {
  return toEpochDay - fromEpochDay;
}

/** 周数差（对齐 firstDay.until(today, ChronoUnit.WEEKS) + 1 的"第几周"口径）。 */
export function weeksBetween(fromEpochDay: number, toEpochDay: number): number {
  return Math.floor((toEpochDay - fromEpochDay) / 7);
}

/** 时刻 + 日期 组合值（EclassDdlLogic 等需要"截止时刻"的场合）。 */
export interface DateTime {
  /** epoch day */
  day: number;
  /** 当天分钟数 */
  minutes: number;
}

/** 作息表的一节（TimeTableLogic 的数据形态）。 */
export interface TimeTableItem {
  /** 开始时刻（当天分钟数） */
  startMinutes: number;
  /** 结束时刻（当天分钟数） */
  endMinutes: number;
}

/** 作息表（= 若干节次）。⚠️ 别名定义在此（timeutil.ts），
 * 与 TimeTableItem 同源；TimeTableLogic.ts 仅 re-export，避免多处定义分裂。 */
export type TimeTable = TimeTableItem[];

/** 解析 Android 侧见过的时间格式（EclassDdlLogic.parseTime 同款多格式）。
 *
 * ⚠️ 偏移量语义对齐 Kotlin `OffsetDateTime.parse(text).toLocalDateTime()`：
 * **直接丢弃偏移，不做时区换算**（Android 侧注释原话：「接口给的就是北京时间，
 * 不做时区换算」）。带 Z 的串同理 —— OffsetDateTime 先于 Instant 匹配成功，
 * 所以 Instant→Asia/Shanghai 那条分支实际不会走到。
 */
export function parseDateTime(raw: string | null | undefined): DateTime | null {
  const text = (raw ?? "").trim();
  if (text.length === 0 || text.toLowerCase() === "null") return null;

  // ISO：2026-10-01T23:59:00 / 23:59 / 带 Z / 带 +08:00（偏移丢弃）
  let m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/.exec(text);
  if (m) {
    const day = parseISODate(m[1]);
    if (day === null) return null;
    return { day, minutes: Number(m[2]) * 60 + Number(m[3]) };
  }

  // 2026-10-01 23:59(:00) / 2026/10/01 23:59(:00)
  m = /^(\d{4})[-/](\d{2})[-/](\d{2})[ ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(text);
  if (m) {
    const day = parseISODate(`${m[1]}-${m[2]}-${m[3]}`);
    if (day === null) return null;
    return { day, minutes: Number(m[4]) * 60 + Number(m[5]) };
  }
  return null;
}

/** 纯日期 → 当天 00:00。 */
export function parseDateAsDateTime(raw: string | null | undefined): DateTime | null {
  const day = parseISODate((raw ?? "").trim());
  return day === null ? null : { day, minutes: 0 };
}

/** 把溢出的一天折到下一天（如 25:30 → 次日 01:30）。 */
export function normalize(day: number, minutes: number): DateTime {
  let d = day;
  let mm = minutes;
  while (mm < 0) {
    mm += 1440;
    d -= 1;
  }
  while (mm >= 1440) {
    mm -= 1440;
    d += 1;
  }
  return { day: d, minutes: mm };
}

/** DateTime → "yyyy-MM-dd HH:mm"（展示用）。 */
export function fmtDateTime(dt: DateTime): string {
  return `${isoDate(dt.day)} ${fmtHM(dt.minutes)}`;
}

/** DateTime → "M月d日"（对齐 LibBorrowLogic 的 SHOW_DAY）。 */
export function fmtShowDay(dt: DateTime): string {
  const iso = isoDate(dt.day);
  const mo = Number(iso.slice(5, 7));
  const d = Number(iso.slice(8, 10));
  return `${mo}月${d}日`;
}
