/**
 * DDL 列表**排序模式**（M12-5，纯函数）。
 *
 * 为什么需要：默认「按截止升序」在「快到期了，先看看有什么」时最好用，
 * 但「今晚要做操作系统作业」时，用户想的是**按课程聚拢**——同一门课的作业
 * 挨在一起，一眼看全。两种需求都真实，所以给一个两档切换，而不是替用户选一个。
 *
 * ## 口径（可证伪）
 *  - 分区不变：未完成在前、已完成在后（与 `DdlListLogic` 分区一致），
 *    排序模式**只在分区内部**生效；
 *  - `due`：截止升序（默认，沿用原逻辑）；
 *  - `course`：课程名升序，同名课程内按截止升序；**无课程名**（本地新增手写）
 *    统一排在最后，不假装它属于某门课；
 *  - 已完成区永远按截止**倒序**（最近完成的在上），不随模式变——
 *    「刚从待办里划掉那条」应该留在最上面。
 *  - 排序必须**稳定**：截止完全相同（同一天同一分钟）时按 uid 兜底，
 *    否则同一条记录在两次渲染间会跳位。
 */

import type { DdlEntry } from './DdlRules.ts';

/** 排序模式（字符串值直接落 Prefs，改名会读不出老值 —— 所以别随便改）。 */
export enum DdlSortMode {
  /** 按截止时间升序（默认）。 */
  DUE = 'due',
  /** 按课程聚拢，组内按截止升序。 */
  COURSE = 'course'
}

export const DEFAULT_DDL_SORT: DdlSortMode = DdlSortMode.DUE;

/** 外来字符串 → 模式；认不出回默认（老数据/手改都不炸）。 */
export function parseSortMode(raw: string): DdlSortMode {
  if (raw === DdlSortMode.COURSE) {
    return DdlSortMode.COURSE;
  }
  return DdlSortMode.DUE;
}

/** 截止比较：天 → 分 → uid（uid 兜底保证稳定）。 */
function cmpDue(a: DdlEntry, b: DdlEntry): number {
  const d: number = a.day - b.day;
  if (d !== 0) {
    return d;
  }
  const m: number = a.minutes - b.minutes;
  if (m !== 0) {
    return m;
  }
  if (a.uid === b.uid) {
    return 0;
  }
  return a.uid < b.uid ? -1 : 1;
}

/** 课程比较：空课程名排最后，其余按名字（同分走截止）。 */
function cmpCourse(a: DdlEntry, b: DdlEntry): number {
  const ca: string = a.text.trim();
  const cb: string = b.text.trim();
  if (ca.length === 0 && cb.length === 0) {
    return cmpDue(a, b);
  }
  if (ca.length === 0) {
    return 1;
  }
  if (cb.length === 0) {
    return -1;
  }
  if (ca !== cb) {
    // ⚠️ 必须用 localeCompare 而不是 `ca < cb`：课程名是中文，
    // 码点序对用户毫无意义（「操作系统」和「计算机网络」按码点排出来的
    // 顺序和拼音序常常不一致，看起来就是「随机」）。
    // 具体顺序跟随系统的中文排序规则，所以单测只钉「聚拢/组内按截止/空名靠后」，
    // 不钉跨课程的具体次序 —— 那是语言环境相关的，钉死了反而在别的机器上假红。
    const c: number = ca.localeCompare(cb, 'zh-Hans-CN');
    return c !== 0 ? (c < 0 ? -1 : 1) : cmpDue(a, b);
  }
  return cmpDue(a, b);
}

/** 未完成区按模式排序（不改入参）。 */
export function sortPending(entries: DdlEntry[], mode: DdlSortMode): DdlEntry[] {
  const list: DdlEntry[] = entries.slice().filter((e: DdlEntry) => !e.done);
  list.sort(mode === DdlSortMode.COURSE
    ? (a: DdlEntry, b: DdlEntry) => cmpCourse(a, b)
    : (a: DdlEntry, b: DdlEntry) => cmpDue(a, b));
  return list;
}

/** 已完成区：截止倒序（最近完成的在上），与模式无关。 */
export function sortDone(entries: DdlEntry[]): DdlEntry[] {
  const list: DdlEntry[] = entries.slice().filter((e: DdlEntry) => e.done);
  list.sort((a: DdlEntry, b: DdlEntry) => cmpDue(b, a));
  return list;
}

/** 模式标签（筛选 chip 用）。 */
export function sortLabel(mode: DdlSortMode): string {
  return mode === DdlSortMode.COURSE ? '按课程' : '按截止';
}

/** 两档循环（点一下切下一个；chip 只有一个，避免占一行）。 */
export function nextSortMode(mode: DdlSortMode): DdlSortMode {
  return mode === DdlSortMode.DUE ? DdlSortMode.COURSE : DdlSortMode.DUE;
}
