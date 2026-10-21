/**
 * 提醒排期的**数据适配**（M7-2，纯函数，单测直接打）。
 *
 * 把本地各数据源（CourseCache / DdlStore / ExamCache / 教学调整）翻译成
 * `NotifyLogic.plan()` 的输入。干两件危险的事：
 *
 *  1. **课程**：`CourseRow.SKZC`（01 串）→ `NotifyCourse.weeks`（[n] 串）必须走
 *     `skzcToWeeks` —— 直接用 01 串喂 `weeksContains`（它按 `[n]` 匹配）会**一条课都排不出**
 *     （`铁律 0.1`：对着语义写，别对着「有值」写）。
 *  2. **考试**：时刻藏在 `KSSJMS` 文本里（如「星期五 08:00-10:00」），解析失败就
 *     **fail-closed 跳过这场**（`铁律 7`：不确定不排——「错提醒比不发更糟」是 M7 的
 *     设计约束）。Android 用字符串 drop 取 HH:mm，这里用更稳的区间正则，
 *     真机样本缺失时宁可漏排也不猜时刻（ROADMAP R10/考试时刻 记为未验）。
 */

import { type CourseRow, skzcToWeeks } from '../core/model/SchoolModels.ts';
import { parseISODate } from './timeutil.ts';
import type { NotifyCourse, NotifyDDL, NotifyExam } from './NotifyLogic.ts';
import type { DdlEntry } from './DdlRules.ts';
import type { ExamRow } from '../core/model/SchoolModels.ts';

/** 课表行 → 提醒用课程（周次串 01 → [n]，这是最容易写错的一步）。 */
export function coursesToNotify(courses: CourseRow[]): NotifyCourse[] {
  const out: NotifyCourse[] = [];
  for (let i = 0; i < courses.length; i++) {
    const c: CourseRow = courses[i];
    if (c.SKXQ < 1 || c.SKXQ > 7 || c.KSJC < 1) {
      continue; // 非渲染行不排提醒
    }
    out.push({
      name: c.KCM,
      number: c.KCH,
      classroom: c.JASMC,
      campus: c.XXXQMC,
      weeks: skzcToWeeks(c.SKZC),
      weekday: c.SKXQ,
      start_section: c.KSJC,
      end_section: c.JSJC
    });
  }
  return out;
}

/** DDL 存储条目 → 提醒用 DDL（字段同名，直接搬）。 */
export function ddlsToNotify(ddls: DdlEntry[]): NotifyDDL[] {
  const out: NotifyDDL[] = [];
  for (let i = 0; i < ddls.length; i++) {
    const d: DdlEntry = ddls[i];
    out.push({
      uid: d.uid,
      title: d.title,
      text: d.text,
      time: { day: d.day, minutes: d.minutes },
      done: d.done
    });
  }
  return out;
}

/**
 * 从考试描述里取「开始/结束分钟」。
 *
 * `KSSJMS` 形如 `星期五 08:00-10:00（2小时）`。取第一个 `HH:MM-HH:MM` 区间；
 * 取不到返回 null（调用方据此跳过这场考试 —— 不猜时刻）。
 *
 * ⚠️ 这是 Android 字符串 drop 取法的**稳健超集**：对常见「星期 + 区间」给同样的数，
 * 对未知格式宁缺毋滥。真实 `KSSJMS` 样本缺失，故单测只用**合成样本**并标注未验。
 */
export function examTimeOfMinutes(kssjms: string): { begin: number; end: number } | null {
  if (kssjms.length === 0) {
    return null;
  }
  const m: RegExpMatchArray | null = kssjms.match(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/);
  if (m === null) {
    return null;
  }
  const begin: number = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  const end: number = parseInt(m[3], 10) * 60 + parseInt(m[4], 10);
  if (begin > 24 * 60 || end > 24 * 60 || end <= begin) {
    return null; // 越界/倒挂 ⇒ 不是合法时刻，fail-closed
  }
  return { begin: begin, end: end };
}

/**
 * 考试日期（`KSRQ`，形如 `2026-11-05 00:00:00`）→ 本地 epoch day。
 * 解析不出返回 null。
 */
export function examDateOf(kssj: string, ksrq: string): number | null {
  const dayFromKsrq: number | null = parseISODate((ksrq.split(' ')[0] ?? '').trim());
  if (dayFromKsrq !== null) {
    return dayFromKsrq;
  }
  const m: RegExpMatchArray | null = kssj.match(/(\d{4}-\d{2}-\d{2})/);
  if (m === null) {
    return null;
  }
  return parseISODate(m[1]);
}

/** 考试行 → 提醒用考试。时刻解析不出（或日期解析不出）的整场跳过。 */
export function examsToNotify(exams: ExamRow[]): NotifyExam[] {
  const out: NotifyExam[] = [];
  for (let i = 0; i < exams.length; i++) {
    const e: ExamRow = exams[i];
    const time = examTimeOfMinutes(e.KSSJMS);
    const day = examDateOf(e.KSSJMS, e.KSRQ);
    if (time === null || day === null) {
      continue; // fail-closed：排不确定的时刻 = 错提醒，宁可漏
    }
    out.push({
      name: e.KCM,
      courseId: e.KCH,
      classroom: e.JASMC,
      date: day,
      beginTime: time.begin,
      endTime: time.end,
      seatId: e.ZWH
    });
  }
  return out;
}
