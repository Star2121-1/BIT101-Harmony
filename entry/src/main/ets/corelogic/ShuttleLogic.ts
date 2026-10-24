/**
 * 1:1 移植自 Android：data/src/main/java/cn/bit101/android/data/bus/ShuttleLogic.kt（165 行）
 *
 * 移植日期：2026-10-19（夜间任务 2）
 *
 * 必须一起搬的规则/数据：
 * - 时刻表**逐条抄自站点站牌实拍照片**（2026-09-27 用户提供），**用字符串存**
 *  （Kotlin 原注释：数字列表没法对着站牌核对，字符串与照片顺序一一对应，抄错一眼看出来）
 * - 工作日 39 班 / 周末及节假日 50 班；两站（徐特立图书馆 / 良乡大学城北地铁站）各自存
 * - 工作日午间与下午空档（图书馆 9:22→11:30、13:10→15:30）**是真实编排不是漏抄**
 * - dayTypeOf **只按星期**：法定节假日/调休/寒暑假判断不了，调用方必须允许用户手动覆盖
 * - nextDeparture：早于首班返回首班；晚于末班返回 null（不绕回明天）；秒被忽略
 *
 * 时间表示：时刻 = 当天分钟数；日期 = epoch day（dayTypeOf 收 epochDay）。
 */

import { dayOfWeekMon1, fmtHM, parseHM } from "./timeutil.ts";

/** 有固定发车时刻的两个站点（对齐 Kotlin enum Stop）。 */
export enum Stop {
  METRO = "METRO",
  LIBRARY = "LIBRARY",
}

export function stopLabel(stop: Stop): string {
  return stop === Stop.METRO ? "良乡大学城北（地铁站）" : "北校区 徐特立图书馆";
}

/** 一天属于哪套表（对齐 Kotlin enum DayType）。⚠️ 只有这两类。 */
export enum DayType {
  WORKDAY = "WORKDAY",
  WEEKEND_HOLIDAY = "WEEKEND_HOLIDAY",
}

export function dayTypeLabel(dayType: DayType): string {
  return dayType === DayType.WORKDAY ? "工作日" : "周末及节假日";
}

/** 一班车。 */
export interface Departure {
  /** 发车时刻（当天分钟数） */
  at: number;
  /** 距 now 还有几分钟（now 早于首班时 = 到首班的分钟数） */
  inMinutes: number;
  /** 今天总共还剩几班（含这一班） */
  remaining: number;
  /** 今天的第几班（从 1 开始） */
  sequence: number;
}

// ------------------------------------------------------------ 时刻表（原样抄录，勿改）

const RAW: Map<string, string> = new Map([
  // ---- 北校区 徐特立图书馆 发 ----
  [`${Stop.LIBRARY}|${DayType.WORKDAY}`,
    "7:30 7:46 8:02 8:18 8:34 8:50 9:06 9:22 11:30 11:50 12:10 12:30 12:50 13:10 " +
    "15:30 15:46 16:02 16:18 16:34 16:50 17:06 17:46 18:02 18:18 18:34 18:50 " +
    "19:06 19:22 19:38 19:54 20:10 20:26 20:42 20:58 21:14 21:30 21:50 22:10 22:30"],

  [`${Stop.LIBRARY}|${DayType.WEEKEND_HOLIDAY}`,
    "7:30 7:46 8:02 8:18 8:34 8:50 9:06 9:22 9:38 9:50 10:10 10:30 10:50 " +
    "11:30 11:50 12:10 12:30 12:50 13:10 13:30 13:50 14:10 14:30 14:50 15:10 " +
    "15:30 15:46 16:02 16:18 16:34 16:50 17:06 17:46 18:02 18:18 18:34 18:50 " +
    "19:06 19:22 19:38 19:54 20:10 20:26 20:42 20:58 21:14 21:30 21:50 22:10 22:30"],

  // ---- 良乡大学城北站（地铁站）发 ----
  [`${Stop.METRO}|${DayType.WORKDAY}`,
    "7:38 7:54 8:10 8:26 8:42 8:58 9:14 9:30 11:40 12:00 12:20 12:40 13:00 13:20 " +
    "15:38 15:54 16:10 16:26 16:42 16:58 17:14 17:54 18:10 18:26 18:42 18:58 " +
    "19:14 19:30 19:46 20:02 20:18 20:34 20:50 21:06 21:22 21:40 22:00 22:20 22:40"],

  [`${Stop.METRO}|${DayType.WEEKEND_HOLIDAY}`,
    "7:38 7:54 8:10 8:26 8:42 8:58 9:14 9:30 9:46 10:00 10:20 10:40 11:00 " +
    "11:40 12:00 12:20 12:40 13:00 13:20 13:40 14:00 14:20 14:40 15:00 15:20 " +
    "15:38 15:54 16:10 16:26 16:42 16:58 17:14 17:54 18:10 18:26 18:42 18:58 " +
    "19:14 19:30 19:46 20:02 20:18 20:34 20:50 21:06 21:22 21:40 22:00 22:20 22:40"],
]);

/** 解析 "7:30 7:46 …" → 分钟数列表（不排序，保持站牌原始顺序）。 */
function parseTimes(raw: string): number[] {
  const out: number[] = [];
  for (const token of raw.trim().split(/\s+/)) {
    const m = parseHM(token);
    if (m !== null) out.push(m);
  }
  return out;
}

const TIMES: Map<string, number[]> = new Map();
// ArkTS 禁解构赋值（arkts-no-destruct-assignment）⇒ 走索引
for (const kv of RAW) TIMES.set(kv[0], parseTimes(kv[1]));

/** 某站点、某类日子的完整时刻表（升序 = 站牌顺序）。 */
export function timetable(stop: Stop, dayType: DayType): number[] {
  const list = TIMES.get(`${stop}|${dayType}`);
  if (!list) throw new Error(`未知站点/日类型组合: ${stop}/${dayType}`);
  return list;
}

// ------------------------------------------------------------ 推算

/**
 * 推算**下一班**。
 * @param nowMinutes 当前时刻（当天分钟数；秒在传入前就被调用方丢掉 —— 站牌精度就是分钟）
 * @return 下一班；今天已发完最后一班返回 null；早于首班返回首班。
 */
export function nextDeparture(stop: Stop, dayType: DayType, nowMinutes: number): Departure | null {
  const list = timetable(stop, dayType);
  const idx = list.findIndex((t) => t >= nowMinutes);
  if (idx < 0) return null;
  const next = list[idx];
  return {
    at: next,
    inMinutes: next - nowMinutes,
    remaining: list.length - idx,
    sequence: idx + 1,
  };
}

/** 从 now 起今天还剩的所有班次（含恰好等于 now 的那一班）；已发完为空。 */
export function remainingToday(stop: Stop, dayType: DayType, nowMinutes: number): number[] {
  return timetable(stop, dayType).filter((t) => t >= nowMinutes);
}

/**
 * 按**星期**给默认日类型。
 * ⚠️ 只管周六周日 —— 法定节假日、调休补班、寒暑假调整都判断不了，
 * 页面必须允许用户手动覆盖（站牌原文：长假期发车时间可能调整，请关注 i北理）。
 */
export function dayTypeOf(epochDay: number): DayType {
  const dow = dayOfWeekMon1(epochDay); // 1=周一 … 7=周日
  return dow === 6 || dow === 7 ? DayType.WEEKEND_HOLIDAY : DayType.WORKDAY;
}

/** 「还有 N 分钟」的人话说法（Departure.inMinutes 的展示用）。 */
export function countdownText(inMinutes: number): string {
  if (inMinutes <= 0) return "即将发车";
  if (inMinutes < 60) return `${inMinutes} 分钟后`;
  return `${Math.floor(inMinutes / 60)} 小时 ${inMinutes % 60} 分钟后`;
}

/** 展示用：时刻 → "HH:mm"（fmtHM 的转发，保持本文件自证）。 */
export function fmtDeparture(minutes: number): string {
  return fmtHM(minutes);
}

// ------------------------------------------------------------ 展示分组（#86 从页内提纯）

/** 一小时一组的班次（原版在 composable 里 `groupBy { it.hour }.toSortedMap()`，这里提纯可测）。 */
export interface HourGroup {
  hour: number;
  minutes: number[];
}

/**
 * 把时刻表按小时分组，**小时升序**（对齐 Kotlin `groupBy{it.hour}.toSortedMap()`）：
 * 同小时的分钟合并且保持相遇顺序；组间按小时排序（对乱序输入也与原版同结果）。
 *
 * 空表 → 空分组（调用方按「今天已发完」处理，不给空白让人猜）。
 */
export function groupByHour(times: number[]): HourGroup[] {
  const groups: HourGroup[] = [];
  for (const t of times) {
    const h: number = Math.floor(t / 60);
    let idx: number = -1;
    for (let i = 0; i < groups.length; i++) {
      if (groups[i].hour === h) {
        idx = i;
        break;
      }
    }
    if (idx < 0) {
      groups.push({ hour: h, minutes: [] });
      idx = groups.length - 1;
    }
    groups[idx].minutes.push(t);
  }
  groups.sort((a: HourGroup, b: HourGroup) => a.hour - b.hour);
  return groups;
}

/** 分钟数 → 两位分钟串（"07"/"46"）——组行里只显示分钟，小时在行首（原版 "%02d".format））。 */
export function minuteText(minutes: number): string {
  const m: number = minutes % 60;
  return (m < 10 ? '0' : '') + m;
}
