/**
 * 1:1 移植自 Android：features/widget/src/main/java/cn/bit101/android/features/widget/WidgetLogic.kt（997 行）
 *
 * 移植日期：2026-10-19（夜间任务 2）
 *
 * 必须一起搬的规则：
 * - 显示哪一天（pickDay）：现在过了今天最后一个时段就切明天（哪怕明天没课）；
 *   今天没课不切，停在今天
 * - 教学调整**必须生效**（放假→那天的课不作数；补课→装被指定那天的课），
 *   且必须走 CourseWeekdayLogic.effectiveWeekday（提醒/自习/组件/课表页同一套）
 * - weeksContains 按完整标记匹配（[1] 不能匹配 [11]）
 * - firstDay 为 null ⇒ **不按周过滤**（宁可多显示，也不能显示错的空态）
 * - buildDayBlocks：相邻空闲合并成一段；整天没课给一整段空闲；
 *   时间表之外还有课（异常数据）时扫描范围扩到最后一节，避免漏课
 * - focusOf：正在上 → ONGOING；否则今天还没开始的最近一节 → UPCOMING；都上完 → null
 * - DDL 页**不看登录态**（数据在本地库）；已完成的按时间倒序；remainText 已过期说「已过期」
 * - 动态页不筛选、按时间倒序；MAX_ITEMS=60；URGENT_HOURS=24
 * - 「正在上什么」每次重绘**现算**（本地数据），不读快照；快照只放「哪栋楼有空教室」
 * - dayFooter 前缀（今天/明天/后天）不能省 —— 晚上切到明天不标会被当成日期 bug
 * - 页序 = PageKind 枚举顺序；新页只能追加在末尾（页号存页名）
 */

import { fmtHM, type TimeTable, type DateTime } from "./timeutil.ts";
import { sectionStart, sectionEnd, courseTimeText, FALLBACK_TIME_TABLE } from "./TimeTableLogic.ts";
import { of as courseColorOf } from "./CourseColorLogic.ts";
import { currentCourseOf, courseLine, type CourseAt } from "./StudySpotLogic.ts";
import { effectiveWeekday, weekOf, weeksContains } from "./CourseWeekdayLogic.ts";
import { NO_CLASS, type DayPlan } from "./TeachingAdjustment.ts";
import {
  activityKindLabel,
  shortAgoText,
  type EclassActivity,
} from "./EclassActivityLogic.ts";
import { ddlDisplayName } from "./TeachingAdjustment.ts";

// ── 常量（对应 Android config 侧的共享约定）─────────────────────────────

export enum PageKind {
  COURSE = "COURSE",
  DDL = "DDL",
  ACTIVITY = "ACTIVITY",
  SEAT = "SEAT",
  STUDY = "STUDY",
}

export function pageKindLabel(kind: PageKind): string {
  switch (kind) {
    case PageKind.COURSE:
      return "课程";
    case PageKind.DDL:
      return "DDL";
    case PageKind.ACTIVITY:
      return "动态";
    case PageKind.SEAT:
      return "座位";
    default:
      return "自习";
  }
}

/** 课程 12 色板下标（0..11）；非课程行 = -1。 */
export const NO_COLOR_INDEX = -1;

/** App 课表页各 tab 的下标（与 ScheduleScreen 的顺序约定一致，改顺序必须同步）。 */
export enum ScheduleTabs {
  COURSE = 0,
  DDL = 1,
  ACTIVITY = 2,
  FREE_CLASSROOM = 3,
  TRANSPORT = 4,
  COUNT = 5,
}

/** 底部导航路由值（PageShowOnNav.toPageData().value 口径）。 */
export enum Routes {
  SCHEDULE = "schedule",
  SEAT = "seat",
  LOGIN = "login",
}

/** 「定位到哪一条」的键格式（带归属前缀，防两个列表抢同一个键）。 */
export const FocusKeys = {
  ddl: (uid: string): string => `ddl:${uid}`,
  activity: (id: string): string => `activity:${id}`,
  ddlTarget: (key: string | null): string | null =>
    key !== null && key.startsWith("ddl:") ? key.substring(4) : null,
  activityTarget: (key: string | null): string | null =>
    key !== null && key.startsWith("activity:") ? key.substring(9) : null,
};

// ── 数据模型 ────────────────────────────────────────────────────────────

export const URGENT_HOURS = 24;
export const MAX_ITEMS = 60;
export const FREE_LABEL = "空闲";

export enum ClassState {
  ONGOING = "ONGOING",
  UPCOMING = "UPCOMING",
}

export enum BlockKind {
  COURSE = "COURSE",
  FREE = "FREE",
}

/** 列表里的一行。 */
export interface WidgetLine {
  lead: string;
  main: string;
  trail: string;
  urgent: boolean;
  time: string;
  highlight: ClassState | null;
  muted: boolean;
  openRoute: string | null;
  /** ⚠️ 不要留 null：GotoRequest.Focus(tab=null) 会被 takeIf 丢掉导致不切页 */
  openTab: number | null;
  /** 课程 12 色号；非课程行 = -1 */
  colorIndex: number;
  focusKey: string | null;
  header: boolean;
}

/** 一天时间轴上的一个区块。 */
export interface DayBlock {
  kind: BlockKind;
  startSection: number;
  endSection: number;
  /** BlockKind.COURSE 时非空 */
  course: CourseSchedule | null;
}

/** 组件的一页。 */
export interface WidgetPage {
  kind: PageKind;
  title: string;
  items: WidgetLine[];
  emptyText: string;
  /** 非 null = 该页应显示登录引导而不是内容 */
  loginPrompt: string | null;
  footer: string | null;
  scrollTo: number;
  quickReserveTaskId: string | null;
}

/** 页面底部的动作键。 */
export interface WidgetAction {
  label: string;
  route: string;
  quickReserveTaskId: string | null;
}

/** pickDay 的结果。 */
export interface DayChoice {
  /** epoch day */
  date: number;
  isTomorrow: boolean;
  blocks: DayBlock[];
  plan: DayPlan | null;
}

/** 课表数据的最小形态（对应 CourseScheduleEntity 用到的字段）。 */
export interface CourseSchedule {
  name: string;
  teacher: string;
  classroom: string;
  weeks: string;
  weekday: number;
  start_section: number;
  end_section: number;
  campus: string;
}

/** DDL 数据的最小形态（对应 DDLScheduleEntity）。 */
export interface DDLSchedule {
  group: string;
  uid: string;
  title: string;
  text: string;
  /** epoch day + 分钟 */
  time: DateTime;
  done: boolean;
}

/** 座位快照的最小形态（座位侧推来，组件只透传）。 */
export interface SeatSnapshot {
  lines: WidgetLine[];
  quickReserveTaskId: string | null;
  /** 结果提示（60 秒后自动消失，由座位侧管） */
  activeNotice: string | null;
}

// ── 一天的时间轴 ────────────────────────────────────────────────────────

/**
 * 把某一天的课程铺成**完整的时间轴**：课与课之间的空档自动合并成「空闲」区块。
 * @param courses 该天的课程，无需预先排序
 */
export function buildDayBlocks(courses: CourseSchedule[], table: TimeTable): DayBlock[] {
  // 节次 → 课。同一节次被多门课占用时取先出现的（异常数据，取一个就够）
  const occupied = new Map<number, CourseSchedule>();
  for (const course of courses) {
    const from = Math.max(1, course.start_section);
    const to = Math.max(course.end_section, from);
    for (let s = from; s <= to; s++) {
      if (!occupied.has(s)) occupied.set(s, course);
    }
  }

  if (occupied.size === 0) {
    return table.length === 0 ? [] : [{ kind: BlockKind.FREE, startSection: 1, endSection: table.length, course: null }];
  }

  let lastSection = table.length;
  for (const s of occupied.keys()) if (s > lastSection) lastSection = s;

  const blocks: DayBlock[] = [];
  let section = 1;
  while (section <= lastSection) {
    const course = occupied.get(section);
    if (course !== undefined) {
      const end = Math.max(course.end_section, course.start_section);
      blocks.push({ kind: BlockKind.COURSE, startSection: course.start_section, endSection: end, course });
      section = end + 1;
    } else {
      const start = section;
      while (section <= lastSection && !occupied.has(section)) section++;
      blocks.push({ kind: BlockKind.FREE, startSection: start, endSection: section - 1, course: null });
    }
  }
  return blocks;
}

/** 某一天的时间轴（含周次过滤与节次排序；教学调整必须在这里生效）。 */
function blocksOf(
  courses: CourseSchedule[],
  dateEpochDay: number,
  firstDayEpochDay: number | null,
  table: TimeTable,
  plan: DayPlan | null,
): DayBlock[] {
  const week = weekOf(firstDayEpochDay, dateEpochDay);
  const weekday = effectiveWeekday(dateEpochDay, () => plan);
  const thatDay = weekday === null ? [] : courses.filter((c) => c.weekday === weekday);

  return buildDayBlocks(
    thatDay
      .filter((c) => week <= 0 || weeksContains(c.weeks, week))
      .sort((a, b) => a.start_section - b.start_section),
    table,
  );
}

/** 「现在」是否已经晚于 blocks 里最后一个区块的结束时刻。 */
function isAfterAll(blocks: DayBlock[], now: number, table: TimeTable): boolean {
  const last = blocks[blocks.length - 1];
  if (!last) return true;
  const end = sectionEnd(table, last.endSection);
  if (end === null) return false;
  return now > end;
}

/**
 * 决定组件此刻显示哪一天。
 * 规则：**只要「现在」过了今天最后一个时段就切明天**（哪怕明天没课）；
 * 今天没课不切，停在今天。
 */
export function pickDay(
  courses: CourseSchedule[],
  todayEpochDay: number,
  now: number | null,
  firstDayEpochDay: number | null,
  table: TimeTable = FALLBACK_TIME_TABLE,
  planOf: (epochDay: number) => DayPlan | null = () => null,
): DayChoice {
  const todayBlocks = blocksOf(courses, todayEpochDay, firstDayEpochDay, table, planOf(todayEpochDay));
  const tomorrow = todayEpochDay + 1;

  if (now !== null && isAfterAll(todayBlocks, now, table)) {
    return {
      date: tomorrow,
      isTomorrow: true,
      blocks: blocksOf(courses, tomorrow, firstDayEpochDay, table, planOf(tomorrow)),
      plan: planOf(tomorrow),
    };
  }
  return {
    date: todayEpochDay,
    isTomorrow: false,
    blocks: todayBlocks,
    plan: planOf(todayEpochDay),
  };
}

/** 教学安排调整在组件上的一行说明；没覆盖返回 null。 */
export function adjustmentNote(plan: DayPlan | null): string | null {
  if (plan === null) return null;
  if (plan.kind === "NoClass") return "放假";
  return `按周${weekdayCnChar(plan.targetWeekday)}课表上课`;
}

function weekdayCnChar(weekday: number): string {
  return ["一", "二", "三", "四", "五", "六", "日"][weekday - 1] ?? "?";
}

/**
 * 初次渲染时列表应滚到第几条。
 * - 显示的是明天 / 时间未知 → 顶部
 * - 「现在」正落在某个区块内（含课间所在的空闲区块）→ 那一条
 * - 「现在」早于所有区块的第一节 → 第 0 条
 */
export function scrollIndexOf(
  blocks: DayBlock[],
  now: number | null,
  table: TimeTable = FALLBACK_TIME_TABLE,
  isTomorrow: boolean = false,
): number {
  if (now === null || isTomorrow) return 0;

  for (let i = 0; i < blocks.length; i++) {
    const start = sectionStart(table, blocks[i].startSection);
    const end = sectionEnd(table, blocks[i].endSection);
    if (start === null || end === null) continue;
    if (now >= start && now <= end) return i;
  }
  for (let i = 0; i < blocks.length; i++) {
    const start = sectionStart(table, blocks[i].startSection);
    if (start === null) continue;
    if (now < start) return i;
  }
  return 0;
}

/**
 * 底部说明行：`今天 · 9月21日 周一 · 第3周`。
 * ⚠️ 前缀（今天/明天/后天）不是装饰：晚上组件会自动切到明天，没有前缀会被当成日期 bug。
 */
export function dayFooter(todayEpochDay: number, dateEpochDay: number, week: number): string {
  const diff = dateEpochDay - todayEpochDay;
  const prefix = diff === 0 ? "今天" : diff === 1 ? "明天" : diff === 2 ? "后天" : "";
  const dateText = `${monthOf(dateEpochDay)}月${dayOf(dateEpochDay)}日 ${weekdayName(dayOfWeekMon1Of(dateEpochDay))}`;
  const weekText = week > 0 ? ` · 第${week}周` : "";
  const head = [prefix, dateText].filter((s) => s.length > 0).join(" · ");
  return head + weekText;
}

/** 1=周一 … 7=周日 */
export function weekdayName(weekday: number): string {
  switch (weekday) {
    case 1:
      return "周一";
    case 2:
      return "周二";
    case 3:
      return "周三";
    case 4:
      return "周四";
    case 5:
      return "周五";
    case 6:
      return "周六";
    default:
      return "周日";
  }
}

function monthOf(epochDay: number): number {
  return Number(isoOfDay(epochDay).slice(5, 7));
}
function dayOf(epochDay: number): number {
  return Number(isoOfDay(epochDay).slice(8, 10));
}
function isoOfDay(epochDay: number): string {
  const dt = new Date(epochDay * 86400000);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}
function dayOfWeekMon1Of(epochDay: number): number {
  return ((((epochDay + 3) % 7) + 7) % 7) + 1;
}

// ── 组装 ────────────────────────────────────────────────────────────────

/**
 * 组装组件数据（5 页，顺序 = PageKind 枚举顺序）。
 * @param studySpotLine 「哪栋楼有空教室」那一句（已粗化到不含数字）；null = 取不到/已过期
 */
export function build(
  courses: CourseSchedule[],
  ddls: DDLSchedule[],
  seat: SeatSnapshot,
  todayEpochDay: number,
  now: DateTime,
  firstDayEpochDay: number | null,
  timeTable: TimeTable = FALLBACK_TIME_TABLE,
  bit101LoggedIn: boolean = true,
  seatLoggedIn: boolean = true,
  activities: EclassActivity[] = [],
  eclassLoggedIn: boolean = true,
  planOf: (epochDay: number) => DayPlan | null = () => null,
  studySpotLine: string | null = null,
): WidgetPage[] {
  return [
    coursePage(courses, todayEpochDay, now, firstDayEpochDay, timeTable, bit101LoggedIn, planOf),
    // ⚠️ DDL 页不看登录态：它的数据来自本地库
    ddlPage(ddls, now),
    activityPage(activities, now, eclassLoggedIn),
    seatPage(seat, seatLoggedIn),
    // 课程那一句在这里现算（本地数据，重绘不违规），不读快照
    studyPage(
      studyCourseLine(courses, todayEpochDay, now, firstDayEpochDay, timeTable, planOf),
      studySpotLine,
    ),
  ];
}

/**
 * 「现在去哪儿自习」页 —— 最多两行，且刻意不含数量。
 * 1. 「正在上 / 马上要上 X」—— 每次重绘用本地课表现算
 * 2. 「XX现在有空教室」—— 来自快照（要网络）
 */
export function studyPage(courseLine: string | null, freeLine: string | null): WidgetPage {
  const items: WidgetLine[] = [];
  if (courseLine !== null && courseLine.trim().length > 0) items.push(line("", courseLine));
  if (freeLine !== null && freeLine.trim().length > 0) items.push(line("", freeLine));
  return {
    kind: PageKind.STUDY,
    title: pageKindLabel(PageKind.STUDY),
    items,
    emptyText: "暂时看不了空教室",
    loginPrompt: null,
    footer: null,
    scrollTo: 0,
    quickReserveTaskId: null,
  };
}

/**
 * 「正在上 / 马上要上」那一行 —— 每次重绘用本地数据现算，不走快照。
 * 「正在上什么」是有时效的断言，存快照会变成几小时后的假话；
 * 「有没有课」全在本地 ⇒ 现算既准又不打网络。
 */
export function studyCourseLine(
  courses: CourseSchedule[],
  todayEpochDay: number,
  now: DateTime,
  firstDayEpochDay: number | null,
  timeTable: TimeTable = FALLBACK_TIME_TABLE,
  planOf: (epochDay: number) => DayPlan | null = () => null,
): string | null {
  const choice = pickDay(courses, todayEpochDay, now.minutes, firstDayEpochDay, timeTable, planOf);
  if (choice.isTomorrow) return null;

  const ofDay = choice.blocks.map((b) => b.course).filter((c): c is CourseSchedule => c !== null);
  if (ofDay.length === 0) return null;

  const course = currentCourseOf(
    ofDay.map(
      (c): CourseAt => ({ name: c.name, classroom: c.classroom, startSection: c.start_section, endSection: c.end_section }),
    ),
    timeTable,
    now.minutes,
  );
  if (course === null) return null;
  return courseLineOf(course);
}

function courseLineOf(course: Parameters<typeof courseLine>[0]): string {
  return courseLine(course);
}

// ── 登录引导与动作键 ────────────────────────────────────────────────────

/** 未登录时该页应显示的引导文案；已登录返回 null。⚠️ DDL 页刻意不用它。 */
export function loginPromptOf(kind: PageKind, loggedIn: boolean): string | null {
  if (loggedIn) return null;
  if (kind === PageKind.SEAT) return "未登录座位系统";
  if (kind === PageKind.ACTIVITY) return "在 App 里登录延河课堂后显示动态";
  return "未登录 BIT101";
}

/** 未登录时点「登录」应该去哪（两套登录体系入口不同）。 */
export function loginRoute(kind: PageKind): string {
  if (kind === PageKind.SEAT) return Routes.SEAT;
  if (kind === PageKind.ACTIVITY) return Routes.SCHEDULE;
  return Routes.LOGIN;
}

/** 该页底部的动作键；不需要时返回 null。优先级：登录引导 > 一键预约 > 立即预约。 */
export function actionOf(page: WidgetPage): WidgetAction | null {
  if (page.loginPrompt !== null) {
    return { label: "登录", route: loginRoute(page.kind), quickReserveTaskId: null };
  }
  if (page.kind === PageKind.SEAT && page.quickReserveTaskId !== null) {
    return { label: "一键预约", route: Routes.SEAT, quickReserveTaskId: page.quickReserveTaskId };
  }
  if (page.kind === PageKind.SEAT) {
    return { label: "立即预约", route: Routes.SEAT, quickReserveTaskId: null };
  }
  return null;
}

// ── 课程页 ──────────────────────────────────────────────────────────────

/**
 * 当日行程页：课程 + 合并后的空闲时段。
 * ⚠️ firstDay 为 null（教学周未知）时不做周次过滤 —— 强行过滤会显示「今日无课」，
 *    用户会以为是数据没同步。宁可多显示几条也不能显示错的空态。
 */
export function coursePage(
  courses: CourseSchedule[],
  todayEpochDay: number,
  now: DateTime | null,
  firstDayEpochDay: number | null,
  timeTable: TimeTable = FALLBACK_TIME_TABLE,
  loggedIn: boolean = true,
  planOf: (epochDay: number) => DayPlan | null = () => null,
): WidgetPage {
  if (!loggedIn) {
    return page(PageKind.COURSE, [], "今日无课", loginPromptOf(PageKind.COURSE, false));
  }

  const choice = pickDay(courses, todayEpochDay, now === null ? null : now.minutes, firstDayEpochDay, timeTable, planOf);

  // 高亮只标「今天」：显示明天时，没有哪一节是"正在上/马上上"
  let focus: { index: number; state: ClassState } | null = null;
  if (!choice.isTomorrow && now !== null) {
    const only = choice.blocks.map((b) => b.course).filter((c): c is CourseSchedule => c !== null);
    focus = focusOf(only, now.minutes, timeTable);
  }

  let courseNo = -1;
  const items: WidgetLine[] = choice.blocks.map((block) => {
    if (block.kind === BlockKind.COURSE && block.course !== null) {
      courseNo++;
      const state = focus !== null && focus.index === courseNo ? focus.state : null;
      return {
        ...courseToLine(block.course, state, timeTable),
        openRoute: Routes.SCHEDULE,
        openTab: ScheduleTabs.COURSE,
      };
    }
    // 空闲行同样可点：整页的语义都是「进 App 看课表」
    return { ...freeToLine(block, timeTable), openRoute: Routes.SCHEDULE, openTab: ScheduleTabs.COURSE };
  });

  // 调休说明同时放在列表第一行和页尾后缀 —— 两处同一个 note，不会各说各的
  const note = adjustmentNote(choice.plan);
  const lined = note === null ? items : [headerLine(note), ...items];

  const footer = dayFooter(todayEpochDay, choice.date, weekOf(firstDayEpochDay, choice.date));

  return {
    kind: PageKind.COURSE,
    title: pageKindLabel(PageKind.COURSE),
    items: lined,
    emptyText: choice.plan !== null && choice.plan.kind === "NoClass" ? "放假" : "今日无课",
    loginPrompt: null,
    footer: note === null ? footer : `${footer} · ${note}`,
    // 顶部多了一行，滚动位置要跟着下移一位
    scrollTo: scrollIndexOf(choice.blocks, now === null ? null : now.minutes, timeTable, choice.isTomorrow) + (note === null ? 0 : 1),
    quickReserveTaskId: null,
  };
}

function courseToLine(course: CourseSchedule, state: ClassState | null, table: TimeTable): WidgetLine {
  return {
    lead: sectionLabel(course.start_section, course.end_section),
    main: course.name,
    trail: course.classroom.trim().length > 0 ? course.classroom : course.campus,
    time: courseTimeText(table, course.start_section, course.end_section),
    highlight: state,
    colorIndex: courseColorOf(course.name),
    urgent: false,
    muted: false,
    openRoute: null,
    openTab: null,
    focusKey: null,
    header: false,
  };
}

function freeToLine(block: DayBlock, table: TimeTable): WidgetLine {
  return {
    lead: FREE_LABEL,
    main: "",
    trail: "",
    urgent: false,
    time: courseTimeText(table, block.startSection, block.endSection),
    highlight: null,
    muted: true,
    openRoute: null,
    openTab: null,
    focusKey: null,
    header: false,
    colorIndex: NO_COLOR_INDEX,
  };
}

/** 节次区间 → 「3-5节」。单节次不显示区间，避免「5-5节」这种别扭写法。 */
export function sectionLabel(start: number, end: number): string {
  return start === end ? `${start} 节` : `${start}-${end}节`;
}

/**
 * 找出「现在最该被关注的那节课」。
 * @return 课程在 courses 中的下标 + 状态；courses 必须已按节次升序。
 */
export function focusOf(courses: CourseSchedule[], now: number, table: TimeTable): { index: number; state: ClassState } | null {
  for (let i = 0; i < courses.length; i++) {
    const start = sectionStart(table, courses[i].start_section);
    const end = sectionEnd(table, courses[i].end_section);
    if (start === null || end === null) continue;
    if (now >= start && now <= end) return { index: i, state: ClassState.ONGOING };
  }
  for (let i = 0; i < courses.length; i++) {
    const start = sectionStart(table, courses[i].start_section);
    if (start === null) continue;
    if (now < start) return { index: i, state: ClassState.UPCOMING };
  }
  return null;
}

// ── DDL 页 ──────────────────────────────────────────────────────────────

/**
 * DDL 页：未完成 / 已完成两栏。
 * ⚠️ 这页没有「未登录」门禁（数据在本地库，与 BIT101 会话无关）。
 * ⚠️ 不再限制时间范围（用户要求「显示里面所有的 DDL」）。
 */
export function ddlPage(ddls: DDLSchedule[], now: DateTime): WidgetPage {
  const pending = ddls.filter((d) => !d.done).sort((a, b) => cmpDt(a.time, b.time));
  // 已完成的按时间倒序：最近完成的排前面，翻旧账的往下沉
  const done = ddls.filter((d) => d.done).sort((a, b) => cmpDt(b.time, a.time));

  const items: WidgetLine[] = [];
  if (pending.length > 0) {
    items.push(headerLine(`未完成 · ${pending.length}`));
    for (const d of pending) items.push(ddlToLine(d, now));
  }
  if (done.length > 0) {
    items.push(headerLine(`已完成 · ${done.length}`));
    for (const d of done) items.push(ddlToLine(d, now));
  }

  return page(PageKind.DDL, items.slice(0, MAX_ITEMS), "暂无待办");
}

function ddlToLine(d: DDLSchedule, now: DateTime): WidgetLine {
  return {
    // ⚠️ 必须转成中文（以前直接写 group，组件上出现「lexue 第三次作业」）
    lead: ddlDisplayName(d.group),
    main: d.title,
    // 已完成的没有「剩余时间」可言 —— 写剩余时间反而误导
    trail: d.done ? "" : remainText(d.time, now),
    // 已过期或 24 小时内到期都算紧急（已完成的不再标红）
    // ⚠️ Kotlin 判据是 time.isBefore(now.plusHours(24)) —— 含未来 24 小时内，不只是已过期
    urgent: !d.done && minutesBetween(now, d.time) < 24 * 60,
    muted: d.done,
    openRoute: Routes.SCHEDULE,
    openTab: ScheduleTabs.DDL,
    focusKey: FocusKeys.ddl(d.uid),
    time: "",
    highlight: null,
    colorIndex: NO_COLOR_INDEX,
    header: false,
  };
}

/** now → target 的分钟数（target 早于 now 为负）。 */
function minutesBetween(now: DateTime, target: DateTime): number {
  return (target.day - now.day) * 1440 + (target.minutes - now.minutes);
}

/**
 * 剩余时间文案。
 * ⚠️ 已过期要说「已过期」，不能显示负数。
 */
export function remainText(target: DateTime, now: DateTime): string {
  if (cmpDt(target, now) <= 0) return "已过期";
  const minutes = (target.day - now.day) * 1440 + (target.minutes - now.minutes);
  if (minutes < 60) return `${minutes} 分钟`;
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)} 小时`;
  return `${Math.floor(minutes / (60 * 24))} 天`;
}

// ── 延河课堂动态 ────────────────────────────────────────────────────────

/** 动态页：不筛选、按时间倒序（最近发生的在上）。 */
export function activityPage(activities: EclassActivity[], now: DateTime, loggedIn: boolean = true): WidgetPage {
  if (!loggedIn) {
    return page(PageKind.ACTIVITY, [], "暂无动态", loginPromptOf(PageKind.ACTIVITY, false));
  }
  return {
    ...page(PageKind.ACTIVITY, [], "暂无动态"),
    items: activities.slice(0, MAX_ITEMS).map((a) => activityToLine(a, now)),
  };
}

function activityToLine(a: EclassActivity, now: DateTime): WidgetLine {
  return {
    lead: activityKindLabel(a.kind),
    main: a.title,
    trail: shortAgoText(a.time, now),
    urgent: false,
    time: "",
    highlight: null,
    muted: false,
    openRoute: Routes.SCHEDULE,
    openTab: ScheduleTabs.ACTIVITY,
    focusKey: FocusKeys.activity(a.id),
    colorIndex: NO_COLOR_INDEX,
    header: false,
  };
}

// ── 座位页 ──────────────────────────────────────────────────────────────

/**
 * 座位预约页。行由座位模块组装后随快照推来，组件只显示，不重复实现那套规则。
 * 未登录时整页换成登录引导（动作键在未登录时没有意义）。
 */
export function seatPage(snapshot: SeatSnapshot, loggedIn: boolean = true): WidgetPage {
  if (!loggedIn) {
    return page(PageKind.SEAT, [], "暂无预约", loginPromptOf(PageKind.SEAT, false));
  }
  const noticeLine: WidgetLine[] =
    snapshot.activeNotice !== null && snapshot.activeNotice.length > 0
      ? [{ ...line("提示", snapshot.activeNotice), muted: true }]
      : [];
  return {
    ...page(PageKind.SEAT, [], "暂无预约"),
    items: (noticeLine.concat(snapshot.lines)).slice(0, MAX_ITEMS),
    quickReserveTaskId: snapshot.quickReserveTaskId,
  };
}

// ── 小工具 ──────────────────────────────────────────────────────────────

function page(kind: PageKind, items: WidgetLine[], emptyText: string, loginPrompt: string | null = null): WidgetPage {
  return {
    kind,
    title: pageKindLabel(kind),
    items,
    emptyText,
    loginPrompt,
    footer: null,
    scrollTo: 0,
    quickReserveTaskId: null,
  };
}

function line(lead: string, main: string): WidgetLine {
  return {
    lead,
    main,
    trail: "",
    urgent: false,
    time: "",
    highlight: null,
    muted: false,
    openRoute: null,
    openTab: null,
    focusKey: null,
    colorIndex: NO_COLOR_INDEX,
    header: false,
  };
}

/** 栏目标题行（「未完成 · 3」）：不可点、无第二行。 */
function headerLine(text: string): WidgetLine {
  return { ...line("", text), header: true, muted: true };
}

function cmpDt(a: DateTime, b: DateTime): number {
  return a.day - b.day || a.minutes - b.minutes;
}
