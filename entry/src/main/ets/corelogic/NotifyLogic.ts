/**
 * 1:1 移植自 Android：features/notify/src/main/java/cn/bit101/android/features/notify/NotifyLogic.kt（765 行）
 *
 * 移植日期：2026-10-19（夜间任务 2）
 *
 * 必须一起搬的规则：
 * - 排期只排**未来 horizonDays（默认 7）天**内
 * - 上课提醒**看教学调整**：放假不排（错的提醒比不发更糟）；补课按被指定那天排
 * - 方向差异（核心，四个 kind 三种方向）：
 *   上课/考试/补课 —— **过时不补发**（迟发的相对时间标题是假话）
 *   座位签到 —— **发现得晚也立刻补发**（截止未到就还能补救；违约代价大）
 * - 标题相对时间（「10 分钟后上课」）到点按**实际剩余重算**；正文一律**绝对时间**
 * - 考试提醒**双窗口**（前一天 24h + 考前 N 分钟），不按教学周过滤（服务端给绝对日期）
 * - 补课提醒**只报 MakeUp 不报放假**；固定补课日前一天 **20:00**（睡前）；过时不补发
 * - 去重键设计（防重复打扰，也别把该发的静默丢掉）：
 *   course:{课程号或课名}:{日期}:{起始节次}:{提前量}（提前量进键 = 改策略应再提醒一次）
 *   ddl:{uid}:{窗口}（uid 可能含冒号 ⇒ 不能按位置 split）
 *   exam:{id}:{日期}:{窗口}（**刻意不带时刻**：服务端微调时间不重复提醒）
 *   seat:{座位号}:{截止时刻}:{提前量}
 *   adjustment:{日期}（不带时刻不带课名）
 * - 键解析**按格式认不按位置取**（dateOfKey 找能解析成日期的那段；
 *   ddlUidOfKey/seatDeadlineOfKey 先切末段再取中段）
 */

import { fmtHM, type DateTime, type TimeTable } from "./timeutil.ts";
import { sectionStart, courseTimeText } from "./TimeTableLogic.ts";
import { effectiveWeekday, weekOf, weeksContains } from "./CourseWeekdayLogic.ts";
import { weekdayCn, dateLabelCn, type AdjustmentEntry, type DayPlan } from "./TeachingAdjustment.ts";

// ── 数据模型 ────────────────────────────────────────────────────────────

export const ReminderKind = {
  CLASS: "CLASS",
  DDL: "DDL",
  SEAT_SIGN_IN: "SEAT_SIGN_IN",
  EXAM: "EXAM",
  ADJUSTMENT: "ADJUSTMENT",
} as const;
export type ReminderKind = (typeof ReminderKind)[keyof typeof ReminderKind];

/** 座位提醒的输入（notify 不依赖座位模块，由座位侧转换后传入）。 */
export interface SeatReminderInput {
  seatNo: string;
  /** 签到截止时刻（座位侧已按规则算好） */
  signInDeadline: DateTime;
}

/** 一条已排定的提醒（纯数据）。 */
export interface Reminder {
  key: string;
  kind: ReminderKind;
  at: DateTime;
  title: string;
  text: string;
  route: string;
}

/** 提醒策略（由设置项组装；单测直接给不同策略）。 */
export interface NotifyPolicy {
  classEnabled: boolean;
  classLeadMinutes: number;
  ddlEnabled: boolean;
  ddlDayEnabled: boolean;
  ddlHourEnabled: boolean;
  seatEnabled: boolean;
  seatSignInLeadMinutes: number;
  examEnabled: boolean;
  adjustmentEnabled: boolean;
  examDayEnabled: boolean;
  examLeadMinutes: number;
  /** 只排未来这么多天内的提醒 */
  horizonDays: number;
}

export const DEFAULT_NOTIFY_POLICY: NotifyPolicy = {
  classEnabled: true,
  classLeadMinutes: 10,
  ddlEnabled: true,
  ddlDayEnabled: true,
  ddlHourEnabled: true,
  seatEnabled: true,
  seatSignInLeadMinutes: 15,
  examEnabled: true,
  adjustmentEnabled: true,
  examDayEnabled: true,
  examLeadMinutes: 60,
  horizonDays: 7,
};

/** DDL 的两个提醒窗口（键会进去重键，改这里等于改历史记录，谨慎）。 */
export const DDL_WINDOW_DAY = "1d";
export const DDL_WINDOW_HOUR = "1h";
/** 考试「前一天」窗口。 */
export const EXAM_WINDOW_DAY = "1d";

/** 课表数据的最小形态。 */
export interface NotifyCourse {
  name: string;
  number: string;
  classroom: string;
  campus: string;
  weeks: string;
  weekday: number;
  start_section: number;
  end_section: number;
}

/** DDL 数据的最小形态。 */
export interface NotifyDDL {
  uid: string;
  title: string;
  text: string;
  time: DateTime;
  done: boolean;
}

/** 考试数据的最小形态。 */
export interface NotifyExam {
  name: string;
  courseId: string;
  classroom: string;
  date: number;
  beginTime: number;
  endTime: number;
  seatId: string;
}

/** 补课提醒的钟点 —— 补课日的前一天 20:00（写死，见 KDoc）。 */
const ADJUSTMENT_AT_MINUTES = 20 * 60;

// ── 排期总入口 ──────────────────────────────────────────────────────────

/**
 * 该排哪些提醒（纯函数：不碰数据库、不碰 Android、不碰设置读取）。
 * @param now 当前时刻（epoch day + 分钟）
 */
export function plan(
  courses: NotifyCourse[],
  ddls: NotifyDDL[],
  now: DateTime,
  firstDayEpochDay: number | null,
  table: TimeTable,
  policy: NotifyPolicy = DEFAULT_NOTIFY_POLICY,
  sentKeys: Set<string> = new Set(),
  seatSignIns: SeatReminderInput[] = [],
  exams: NotifyExam[] = [],
  adjustments: AdjustmentEntry[] = [],
): Reminder[] {
  const until = addDays(now, policy.horizonDays);
  const out: Reminder[] = [];

  const planOf = (dateEpochDay: number): DayPlan | null => {
    for (const a of adjustments) if (a.day === dateEpochDay) return a.plan;
    return null;
  };

  if (policy.classEnabled) out.push(...classReminders(courses, now, until, firstDayEpochDay, table, policy, sentKeys, planOf));
  if (policy.ddlEnabled) out.push(...ddlReminders(ddls, now, until, policy, sentKeys));
  if (policy.seatEnabled) out.push(...seatReminders(seatSignIns, now, until, policy, sentKeys));
  if (policy.examEnabled) out.push(...examReminders(exams, now, until, policy, sentKeys));
  if (policy.adjustmentEnabled) out.push(...adjustmentReminders(adjustments, now, until, sentKeys));

  return out.sort((a, b) => cmpDt(a.at, b.at));
}

// ── 座位签到提醒（过时也补发）──────────────────────────────────────────

function seatReminders(
  signIns: SeatReminderInput[],
  now: DateTime,
  until: DateTime,
  policy: NotifyPolicy,
  sentKeys: Set<string>,
): Reminder[] {
  const lead = Math.max(0, policy.seatSignInLeadMinutes);
  const out: Reminder[] = [];

  for (const input of signIns) {
    // 截止时刻已过：不补发（违约已成事实，提醒只会让人懊恼）
    if (cmpDt(input.signInDeadline, now) <= 0) continue;
    if (cmpDt(input.signInDeadline, until) > 0) continue;

    // 「该提醒的时刻」已过去 → 立刻发（截止未到就还能补救）
    const at = clampAtLeast(addMinutes(input.signInDeadline, -lead), now);

    const key = seatKey(input, lead);
    if (sentKeys.has(key)) continue;

    out.push({
      key,
      kind: ReminderKind.SEAT_SIGN_IN,
      at,
      title: seatTitle(lead),
      text: seatText(input),
      route: "seat",
    });
  }
  return out;
}

/** 「15 分钟后截止签到」；提前量为 0 时不写「0 分钟后」。 */
export function seatTitle(leadMinutes: number): string {
  return leadMinutes <= 0 ? "签到即将截止" : `${leadMinutes} 分钟后截止签到`;
}

/** 通知正文用**绝对时刻**（通知可能因系统调度晚到，绝对时刻永远是对的）。 */
export function seatText(input: SeatReminderInput): string {
  const seat = input.seatNo.trim();
  const prefix = seat.length === 0 ? "座位预约" : `座位 ${seat}`;
  return `${prefix} · 请在 ${fmtHM(input.signInDeadline.minutes)} 前刷卡`;
}

// ── 上课提醒（过时不补发；放假不排、补课按指定那天排）───────────────────

function classReminders(
  courses: NotifyCourse[],
  now: DateTime,
  until: DateTime,
  firstDayEpochDay: number | null,
  table: TimeTable,
  policy: NotifyPolicy,
  sentKeys: Set<string>,
  planOf: (epochDay: number) => DayPlan | null,
): Reminder[] {
  const lead = Math.max(0, policy.classLeadMinutes);
  const out: Reminder[] = [];

  // 逐日扫描（而不是逐课程 × 逐日）
  for (let date = now.day; date <= until.day; date++) {
    const weekday = effectiveWeekday(date, planOf);
    if (weekday === null) continue; // 放假 ⇒ 不排
    const week = weekOf(firstDayEpochDay, date);
    for (const course of courses) {
      if (course.weekday !== weekday) continue;
      if (week > 0 && !weeksContains(course.weeks, week)) continue;
      const start = sectionStart(table, course.start_section);
      if (start === null) continue;
      const startAt: DateTime = { day: date, minutes: start };
      const at = addMinutes(startAt, -lead);
      if (cmpDt(at, now) < 0 || cmpDt(at, until) > 0) continue;

      const key = courseKey(course, date, lead);
      if (sentKeys.has(key)) continue;

      out.push({
        key,
        kind: ReminderKind.CLASS,
        at,
        title: classTitle(lead),
        text: classText(course, table, start),
        route: "schedule",
      });
    }
  }
  return out;
}

/** 「马上上课」/「10 分钟后上课」——提前量为 0 时不写「0 分钟后」。 */
export function classTitle(leadMinutes: number): string {
  return leadMinutes <= 0 ? "马上上课" : `${leadMinutes} 分钟后上课`;
}

/** 通知正文写**绝对时间**（如 `09:55-12:20 操作系统 · 文萃楼I404`）。 */
export function classText(course: NotifyCourse, table: TimeTable, startMinutes: number): string {
  const span = courseTimeText(table, course.start_section, course.end_section) || fmtHM(startMinutes);
  const where = course.classroom.trim().length > 0 ? course.classroom : course.campus;
  return [span, course.name, where].filter((s) => s.trim().length > 0).join(" · ");
}

// ── DDL 提醒 ────────────────────────────────────────────────────────────

function ddlReminders(
  ddls: NotifyDDL[],
  now: DateTime,
  until: DateTime,
  policy: NotifyPolicy,
  sentKeys: Set<string>,
): Reminder[] {
  const windows: [string, number][] = [];
  if (policy.ddlDayEnabled) windows.push([DDL_WINDOW_DAY, 1]);
  if (policy.ddlHourEnabled) windows.push([DDL_WINDOW_HOUR, 0]);
  const out: Reminder[] = [];

  for (const ddl of ddls) {
    // 已完成的不提醒；已过期的也不提醒（迟到的提醒只添堵）
    if (ddl.done) continue;
    if (cmpDt(ddl.time, now) <= 0) continue;
    for (const [windowKey, days] of windows) {
      const at = days > 0 ? addDays(ddl.time, -days) : addMinutes(ddl.time, -60);
      if (cmpDt(at, now) < 0 || cmpDt(at, until) > 0) continue;

      const key = ddlKey(ddl, windowKey);
      if (sentKeys.has(key)) continue;

      out.push({
        key,
        kind: ReminderKind.DDL,
        at,
        title: "作业即将截止",
        text: ddlText(ddl, now),
        route: "schedule",
      });
    }
  }
  return out;
}

/** `操作系统第三次作业 · 明天 23:59 截止`。 */
export function ddlText(ddl: NotifyDDL, now: DateTime): string {
  const title = (ddl.title.trim().length > 0 ? ddl.title : ddl.text).trim();
  const hint = deadlineHint(ddl.time, now);
  return title.length === 0 ? hint : `${title} · ${hint}`;
}

/** 截止时刻的人话描述：今天 / 明天 / 后天 / 8月25日 + 时分。跨年才写年份。 */
export function deadlineHint(deadline: DateTime, now: DateTime): string {
  const dayDiff = deadline.day - now.day;
  const iso = isoOf(deadline.day);
  const month = Number(iso.slice(5, 7));
  const day = Number(iso.slice(8, 10));
  const year = Number(iso.slice(0, 4));
  const nowYear = Number(isoOf(now.day).slice(0, 4));
  const dayText =
    dayDiff === 0
      ? "今天"
      : dayDiff === 1
        ? "明天"
        : dayDiff === 2
          ? "后天"
          : year === nowYear
            ? `${month}月${day}日`
            : `${year}年${month}月${day}日`;
  return `${dayText} ${fmtHM(deadline.minutes)} 截止`;
}

// ── 考试提醒（双窗口；过时不补发；不按教学周过滤）───────────────────────

function examReminders(
  exams: NotifyExam[],
  now: DateTime,
  until: DateTime,
  policy: NotifyPolicy,
  sentKeys: Set<string>,
): Reminder[] {
  const lead = Math.max(0, policy.examLeadMinutes);
  const out: Reminder[] = [];

  for (const exam of exams) {
    const start = examStartAt(exam);
    // 已经开考（或更早）的跳过
    if (cmpDt(start, now) <= 0) continue;

    const windows: { window: string; at: DateTime; title: string }[] = [];
    if (policy.examDayEnabled) {
      windows.push({ window: EXAM_WINDOW_DAY, at: addDays(start, -1), title: "明天有考试" });
    }
    windows.push({ window: examLeadWindow(lead), at: addMinutes(start, -lead), title: examTitle(lead) });

    for (const w of windows) {
      // 与上课提醒同一口径：过时不补、超出窗口不排
      if (cmpDt(w.at, now) < 0 || cmpDt(w.at, until) > 0) continue;

      const key = examKey(exam, w.window);
      if (sentKeys.has(key)) continue;

      out.push({
        key,
        kind: ReminderKind.EXAM,
        at: w.at,
        title: w.title,
        text: examText(exam),
        route: "schedule",
      });
    }
  }
  return out;
}

/** 考试开始的绝对时刻。 */
export function examStartAt(exam: NotifyExam): DateTime {
  return { day: exam.date, minutes: exam.beginTime };
}

/** 考前提醒标题：「1 小时后开考」。整小时写「N 小时」；提前量为 0 时不写「0 分钟后」。 */
export function examTitle(leadMinutes: number): string {
  if (leadMinutes <= 0) return "马上开考";
  if (leadMinutes % 60 === 0) return `${leadMinutes / 60} 小时后开考`;
  return `${leadMinutes} 分钟后开考`;
}

/** 通知正文（座位号必须写：考试按座位号入座）。 */
export function examText(exam: NotifyExam): string {
  const span = `${fmtHM(exam.beginTime)}-${fmtHM(exam.endTime)}`;
  const seat = exam.seatId.trim().length === 0 ? "" : `座位 ${exam.seatId.trim()}`;
  return [span, exam.name, exam.classroom, seat].filter((s) => s.trim().length > 0).join(" · ");
}

/** 考试提醒的去重键：`exam:{课程号或课名}:{日期}:{窗口}`。⚠️ 刻意不带具体时刻。 */
export function examKey(exam: NotifyExam, window: string): string {
  const id = exam.courseId.trim().length > 0 ? exam.courseId : exam.name;
  return `exam:${id}:${isoOf(exam.date)}:${window}`;
}

/** 考前 N 分钟的窗口标识（提前量进键：改了提前量应按新策略再提醒一次）。 */
export function examLeadWindow(leadMinutes: number): string {
  return `lead${leadMinutes}`;
}

// ── 补课提醒（只报 MakeUp；固定前一天 20:00；过时不补发）────────────────

function adjustmentReminders(
  adjustments: AdjustmentEntry[],
  now: DateTime,
  until: DateTime,
  sentKeys: Set<string>,
): Reminder[] {
  const out: Reminder[] = [];

  for (const entry of adjustments) {
    if (entry.plan.kind !== "MakeUp") continue; // 只报补课、不报放假
    const target = entry.plan.targetWeekday;
    const at: DateTime = { day: entry.day - 1, minutes: ADJUSTMENT_AT_MINUTES };
    if (cmpDt(at, now) < 0 || cmpDt(at, until) > 0) continue;

    const key = adjustmentKey(entry);
    if (sentKeys.has(key)) continue;

    const title = adjustmentTitleAtFireTime(entry.day, target, now);
    if (title === null) continue; // 补课日已过 ⇒ 不发

    out.push({
      key,
      kind: ReminderKind.ADJUSTMENT,
      at,
      title,
      text: adjustmentText(entry.day, target),
      route: "schedule",
    });
  }
  return out;
}

/**
 * 补课提醒的标题：**按到点时的实际日期重算**。
 * 补课日已过返回 null = 不发（标题是相对时间，可能被 Doze 拖到跨天）。
 */
export function adjustmentTitleAtFireTime(dateEpochDay: number, targetWeekday: number, now: DateTime): string | null {
  const wd = weekdayCn(targetWeekday);
  if (now.day < dateEpochDay) return `明天按周${wd}课表上课`;
  if (now.day === dateEpochDay) return `今天按周${wd}课表上课`;
  return null;
}

/** 通知正文写**绝对日期**（如 `10/10（周六）按周四课表上课`）。 */
export function adjustmentText(dateEpochDay: number, targetWeekday: number): string {
  return `${dateLabelCn(dateEpochDay)}按周${weekdayCn(targetWeekday)}课表上课`;
}

/** 补课提醒的去重键：`adjustment:{日期}`。刻意不带时刻、不带课名。 */
export function adjustmentKey(entry: AdjustmentEntry): string {
  return `adjustment:${isoOf(entry.day)}`;
}

// ── 键解析（按格式认，不按位置取）───────────────────────────────────────

/**
 * 从去重键里取回**日期段**。
 * ⚠️ 不能按位置取：键第二段是课程号或课名（自由文本，带冒号就整段错位）。
 * 改为按格式认：键里唯一能解析成日期的就是日期段。取不到返回 null。
 */
export function dateOfKey(key: string): number | null {
  for (const seg of key.split(":")) {
    const d = parseISODay(seg);
    if (d !== null) return d;
  }
  return null;
}

/** 考试日期段（等价于 dateOfKey，保留旧名给调用方）。 */
export function examDateOfKey(key: string): number | null {
  return dateOfKey(key);
}

/**
 * 从座位去重键里取回**签到截止时刻**（`seat:018:2026-09-23T11:03:15:15`）。
 * ⚠️ 不能 split(':') 按位置取：截止时刻自身含冒号，一拆就碎。
 * 先切掉末段的提前量，再取「第二个冒号之后」的整段。
 * 截止时刻段兼容 `yyyy-MM-ddTHH:mm` 与 `yyyy-MM-ddTHH:mm:ss`
 * （Kotlin LocalDateTime.toString 秒为零时省略秒位）。
 */
export function seatDeadlineOfKey(key: string): DateTime | null {
  if (key.substring(0, key.indexOf(":")) !== "seat") return null;
  if (key.indexOf(":") < 0) return null;
  const withoutLead = key.substring(0, key.lastIndexOf(":"));
  const rest = withoutLead.substring(withoutLead.indexOf(":") + 1);
  const deadline = rest.substring(rest.indexOf(":") + 1);
  return parseKeyDateTime(deadline);
}

/** 解析键里的 `yyyy-MM-ddTHH:mm[:ss]`。 */
function parseKeyDateTime(text: string): DateTime | null {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(text);
  if (!m) return null;
  const day = parseISODay(m[1]);
  if (day === null) return null;
  return { day, minutes: Number(m[2]) * 60 + Number(m[3]) };
}

/** 从去重键**末段**取提前量（上课/座位提醒的键都以裸数字结尾）。 */
export function trailingLeadMinutes(key: string): number | null {
  const seg = key.substring(key.lastIndexOf(":") + 1);
  return /^\d+$/.test(seg) ? Number(seg) : null;
}

/** 从去重键末段取**考试提醒的提前量**（键末段形如 `lead15`）。 */
export function trailingExamLeadMinutes(key: string): number | null {
  const seg = key.substring(key.lastIndexOf(":") + 1);
  const m = /^lead(\d+)$/.exec(seg);
  return m ? Number(m[1]) : null;
}

// ── 到点时的「实际提前量」（相对时间标题重算）──────────────────────────

/** 上课时刻 = 提醒时刻 + 提前量（提前量跨零点时两者不在同一天）。 */
export function classStartAt(at: DateTime, leadMinutes: number): DateTime {
  return addMinutes(at, leadMinutes);
}

/** [target] 距 [now] 还有几分钟（向下取整，已过则为负）。 */
export function minutesUntil(target: DateTime, now: DateTime): number {
  return (target.day - now.day) * 1440 + (target.minutes - now.minutes);
}

/**
 * 上课提醒**到点时的实际提前量**；**课已开始返回 null**（= 不该再发）。
 * ⚠️ 实机被 Doze 拖后 2 小时 23 分钟，下课之后才弹「10 分钟后上课」比不弹更糟。
 */
export function classLeadAtFireTime(at: DateTime, leadMinutes: number, now: DateTime): number | null {
  const startAt = classStartAt(at, leadMinutes);
  return cmpDt(now, startAt) < 0 ? minutesUntil(startAt, now) : null;
}

/**
 * 座位签到提醒**到点时的实际提前量**。
 * ⚠️ **已过截止也要返回负数，而不是 null**（与考试方向相反：发现得晚也必须补发）。
 */
export function seatLeadAtFireTime(deadline: DateTime, now: DateTime): number {
  return minutesUntil(deadline, now);
}

/** 考试提醒**到点时的实际提前量**；**已开考返回 null**（过了时刻就不补发）。 */
export function examLeadAtFireTime(startAt: DateTime, now: DateTime): number | null {
  return cmpDt(now, startAt) < 0 ? minutesUntil(startAt, now) : null;
}

// ── 去重键 ──────────────────────────────────────────────────────────────

/** 上课提醒的去重键：`course:{课程号或课名}:{日期}:{起始节次}:{提前量}`。 */
export function courseKey(course: NotifyCourse, dateEpochDay: number, leadMinutes: number): string {
  const id = course.number.trim().length > 0 ? course.number : course.name;
  return `course:${id}:${isoOf(dateEpochDay)}:${course.start_section}:${leadMinutes}`;
}

/** DDL 提醒的去重键：`ddl:{uid}:{窗口}`。 */
export function ddlKey(ddl: NotifyDDL, window: string): string {
  return `ddl:${ddl.uid}:${window}`;
}

/**
 * 从 DDL 去重键里取回 uid（键形如 `ddl:{uid}:{窗口}`）。
 * ⚠️ 不能 split(':') 按位置取：uid 自身可能含冒号（eclass 的 uid 形如 eclass:123）。
 * 先切掉末段的窗口，再取「第一个冒号之后」的整段。
 */
export function ddlUidOfKey(key: string): string | null {
  if (key.substring(0, key.indexOf(":")) !== "ddl") return null;
  if (key.indexOf(":") < 0) return null;
  const withoutWindow = key.substring(0, key.lastIndexOf(":"));
  const uid = withoutWindow.substring(withoutWindow.indexOf(":") + 1);
  return uid.trim().length > 0 ? uid : null;
}

/** 座位签到提醒的去重键：`seat:{座位号}:{截止时刻}:{提前量}`。 */
export function seatKey(input: SeatReminderInput, leadMinutes: number): string {
  return `seat:${input.seatNo.trim()}:${fmtDT(input.signInDeadline)}:${leadMinutes}`;
}

/** 从去重键里取座位号（截止时刻自身含冒号，所以只用前两段）。 */
export function seatNoOfKey(key: string): string | null {
  const parts = key.split(":");
  const seat = parts.length > 1 ? parts[1] : "";
  return seat.trim().length > 0 ? seat : null;
}

// ── 小工具 ──────────────────────────────────────────────────────────────

function cmpDt(a: DateTime, b: DateTime): number {
  return a.day - b.day || a.minutes - b.minutes;
}

function addDays(dt: DateTime, days: number): DateTime {
  return { day: dt.day + days, minutes: dt.minutes };
}

function addMinutes(dt: DateTime, minutes: number): DateTime {
  const total = dt.minutes + minutes;
  const day = dt.day + Math.floor(total / 1440);
  const m = ((total % 1440) + 1440) % 1440;
  return { day, minutes: m };
}

function clampAtLeast(dt: DateTime, floor: DateTime): DateTime {
  return cmpDt(dt, floor) < 0 ? floor : dt;
}

function isoOf(epochDay: number): string {
  const d = new Date(epochDay * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function parseISODay(text: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const d = Date.UTC(Number(text.slice(0, 4)), Number(text.slice(5, 7)) - 1, Number(text.slice(8, 10))) / 86400000;
  return isoOf(d) === text ? d : null;
}

/** 去重键里的截止时刻形态（日期 + 时分，无秒 —— 与 Kotlin LocalDateTime.toString 对齐到分）。 */
function fmtDT(dt: DateTime): string {
  return `${isoOf(dt.day)}T${fmtHM(dt.minutes)}`;
}
