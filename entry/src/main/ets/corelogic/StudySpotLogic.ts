/**
 * 1:1 移植自 Android：data/src/main/java/cn/bit101/android/data/school/StudySpotLogic.kt（1248 行）
 *
 * 移植日期：2026-10-19（夜间任务 2）
 *
 * 必须一起搬的常量/规则（全部来自 Kotlin KDoc 与真机教训）：
 * - sectionFor 返回 **1-based**；课间返回**下一节**（不是 null）；全天结束才 null
 * - 「正在上」必须按**真实钟点**判（start<=now<=end），不能按节次号
 *   （9:40-10:00 课间把 10:00 的课判成「正在上」就是这么栽的）
 * - COMING_SOON_MINUTES=10（「马上要上」窗口，App 与组件共用一份）
 * - LAST_CLASS_FRESH_MINUTES=90（位置代理时限，超时不做推断）
 * - MIN_FREE_SECTIONS=2（空 1 节 = 坐下就走；但 0=算不出来**不挡**）
 * - MAX_ROOMS_PER_BUILDING=2 / MAX_ROOM_CANDIDATES=8
 * - 打分 = min(能空节数,4) + 同楼 2 + 紧挨着 1
 * - 楼级排序：freeCount(+同楼加成3 间) → freeSectionsAhead → 楼名（**必须确定性**，否则卡片自己跳）
 * - 教室级并列：score → freeSectionsAhead → buildingFreeCount → 楼名 → 教室名
 * - freeUntilTime 只返回**钟点**不返回整句（主语由调用方按「在说哪一级」拼）
 * - 三态优先级：今天上完了(DAY_OVER_TEXT) > 算得出钟点 > 只说地点（不编时间）
 * - 名字范围与数字范围必须一致（多层楼只说楼名，数字=楼的总数）
 * - hasContent：空闲态**恒 true**（取不到候选也必须出卡，说两句真话）
 *   ⚠️ 别改回 options.isNotEmpty() —— 那正是静默消失的成因
 * - planUpdate：重算拿不到 ⇒ 不动；候选从有变空 ⇒ 不动（宁可用略微过期的真话）
 * - retryDelayMillis：[15s, 30s] 两次，之后安静显示「暂未查到空教室」
 * - 房间号：先丢开头非英文/数字、取第一段、**至少两位**（线上考试2 → 一位数不认，
 *   退回原串显示「综合教学楼大楼B 线上考试2」）
 * - 房间名后缀原样展示，不做类型推断
 *
 * 时间表示：时刻 = 当天分钟数；节次 1-based（见 TimeTableLogic.ts）。
 */

import { fmtHM, type TimeTable, type DateTime } from "./timeutil.ts";
import type { TimeTableItem } from "./timeutil.ts";
import {
  ALL as LOCATIONS,
  match as matchLocation,
  distanceMeters,
  distanceOf as bucketOf,
  Distance,
  type Location,
} from "./CampusLocations.ts";

// ── 数据模型 ────────────────────────────────────────────────────────────

/** 空教室接口的一间教室（对齐 api 模型 ClassroomInfo 用到的字段）。 */
export interface ClassroomInfo {
  classroomName: string;
  /** 逗号分隔的占用节次号（如 "1,2,5,6"）；null/空串 = 全天空闲 */
  busyTimeStr: string | null;
}

/** 楼层粒度的原始事实。 */
export interface BuildingFree {
  buildingId: string;
  buildingName: string;
  freeCount: number;
  /** null = 教室名没解析出楼层 */
  floor: number | null;
  /** 从当前时段起还能连续空几节（含当前节）；0 = 算不出来/不适用 */
  freeSectionsAhead: number;
}

/** 当前或即将开始的一节课（调用方按 10 分钟窗口判好再传进来）。 */
export interface NextCourse {
  name: string;
  classroom: string;
  /** 下课后才能去自习 —— 副文案要用 */
  endsAt: number | null;
  /** 是否正在上；false = 还没开始，只是快了 */
  ongoing: boolean;
  /** 开课钟点（ongoing 为 false 时用来写「10:00 上 X」） */
  startsAt: number | null;
}

/** 「此刻算不算有课」所需的最小课程信息。⚠️ startSection/endSection 是 1-based 节次。 */
export interface CourseAt {
  name: string;
  classroom: string;
  startSection: number;
  endSection: number;
}

/** 进行中或 1 小时内的座位预约。 */
export interface Booking {
  place: string;
  timeText: string;
}

export const Kind = {
  IN_CLASS: "IN_CLASS",
  HAS_BOOKING: "HAS_BOOKING",
  FREE_ROOM: "FREE_ROOM",
} as const;
export type Kind = (typeof Kind)[keyof typeof Kind];

/** 楼级建议（组件走这条）。 */
export interface Suggestion {
  kind: Kind;
  title: string;
  detail: string;
  buildingName: string | null;
  buildingId: string | null;
  freeCount: number;
}

/** 一栋楼里某一层的空闲情况。 */
export interface FloorFree {
  floor: number | null;
  count: number;
  freeSectionsAhead: number;
}

/** 楼粒度候选。 */
export interface Candidate {
  buildingId: string;
  buildingName: string;
  freeCount: number;
  floors: FloorFree[];
  matchLastClass: boolean;
  freeSectionsAhead: number;
}

/** 教室级原始事实。 */
export interface RoomFree {
  buildingId: string;
  buildingName: string;
  classroomName: string;
  floor: number | null;
  freeSectionsAhead: number;
  buildingFreeCount: number;
}

/** 距离的参考点（代理，不是真实位置）。 */
export interface Reference {
  classroom: string;
  /** 主语，如 你上一节课 / 你现在上课 / 你下节课 */
  label: string;
}

/** 教室候选。 */
export interface RoomCandidate {
  room: RoomFree;
  distance: Distance | null;
}

/** 卡片/详情页上的一条候选取舍（文案已渲染好）。 */
export interface SpotOption {
  buildingId: string;
  buildingName: string;
  /** 「文萃楼C 501a」—— 楼名 + 房间号 */
  place: string;
  floor: number | null;
  buildingFreeCount: number;
  roomKind: string | null;
  distance: string | null;
  untilAt: string | null;
  dayOver: boolean;
}

/** 「现在去哪儿自习」完整结果。 */
export interface Plan {
  kind: Kind;
  courseTitle: string | null;
  coursePlace: string | null;
  courseEndsAt: string | null;
  bookingTitle: string | null;
  bookingDetail: string | null;
  options: SpotOption[];
}

/** 卡片要显示的两行。 */
export interface SpotCard {
  kind: Kind;
  title: string;
  detail: string | null;
}

/** 详情页一行候选。 */
export interface SpotDetailRow {
  buildingId: string;
  place: string;
  untilText: string;
  detail: string | null;
  top: boolean;
}

/** 详情页全部内容。 */
export interface SpotDetail {
  kind: Kind;
  headline: string;
  subline: string;
  rows: SpotDetailRow[];
  emptyHint: string | null;
}

// ── 常量 ────────────────────────────────────────────────────────────────

/** 「马上有课」的窗口（分钟）。App 内与桌面组件共用，别再各写一个 10。 */
export const COMING_SOON_MINUTES = 10;
/** 「上一节课的教室」当位置代理的时限（分钟）。 */
export const LAST_CLASS_FRESH_MINUTES = 90;
/** 「刚在这栋楼上过课」的楼级排序加成（等价于几间空教室）。 */
export const SAME_BUILDING_BONUS = 3;
/** 至少要能连续空这么多节（0 = 算不出来，不挡）。 */
export const MIN_FREE_SECTIONS = 2;
/** 同一栋楼最多出几间。 */
export const MAX_ROOMS_PER_BUILDING = 2;
/** 候选总数上限。 */
export const MAX_ROOM_CANDIDATES = 8;
const FREE_SECTIONS_CAP = 4;
const SAME_BUILDING_ROOM_BONUS = 2;
const NEXT_DOOR_ROOM_BONUS = 1;
/** 空闲到明天（与空教室页同一口径）。 */
export const DAY_OVER_TEXT = "空闲到明天";
export const NO_CANDIDATE_HINT = "下课后暂未查到空教室";
export const NO_CANDIDATE_HINT_NOW = "暂未查到空教室";
export const FREE_HEADLINE = "现在没课";
const RETRY_DELAYS_MS = [15000, 30000];

// ── 楼层与房间名解析 ────────────────────────────────────────────────────

/**
 * 从教室名解析楼层：去掉楼名，取**第一段**连续数字。
 * - 3 位（125）→ 首位是楼层
 * - 4 位（1001）→ 前两位是楼层
 * - 其它 → null（不给楼层，绝不硬猜）
 */
export function floorOf(classroomName: string, buildingName: string): number | null {
  const rest =
    buildingName.length > 0 && classroomName.startsWith(buildingName)
      ? classroomName.substring(buildingName.length)
      : classroomName;
  const digits = rest.replace(/^\D+/, "").match(/^\d+/)?.[0] ?? "";
  if (digits.length === 3) return Number(digits[0]);
  if (digits.length === 4) return Number(digits.substring(0, 2));
  return null;
}

/** 显示用的地点名（带楼层则「楼名 N 楼」）。 */
export function placeName(buildingName: string, floor: number | null): string {
  return floor === null ? buildingName : `${buildingName} ${floor} 楼`;
}

/** 教室名 → 房间号（解析不出返回原串）。 */
export function roomLabelOf(classroomName: string, buildingName: string): string {
  return roomParts(classroomName, buildingName).label;
}

/** 教室名里的房间名后缀（良乡二号机房）；没有则 null。原样返回，不做类型推断。 */
export function roomKindOf(classroomName: string, buildingName: string): string | null {
  return roomParts(classroomName, buildingName).kind;
}

interface RoomParts {
  label: string;
  kind: string | null;
}

function roomParts(classroomName: string, buildingName: string): RoomParts {
  const rest = roomRest(classroomName, buildingName);
  const tail = rest.replace(/^[^0-9A-Za-z]+/, "");
  if (tail.length === 0) {
    return { label: classroomName.trim().length > 0 ? classroomName : rest, kind: null };
  }
  const label = tail.match(/^[0-9A-Za-z]+/)![0];
  // ⚠️ 房间号至少两位，否则退回原教室名（线上考试2 的教训）
  if (label.length < 2) {
    return { label: classroomName.trim().length > 0 ? classroomName : rest, kind: null };
  }
  const kindRaw = tail.substring(label.length).replace(/^[\s\-_]+|[\s\-_]+$/g, "");
  return { label, kind: kindRaw.length > 0 ? kindRaw : null };
}

function roomRest(classroomName: string, buildingName: string): string {
  const s =
    buildingName.length > 0 && classroomName.startsWith(buildingName)
      ? classroomName.substring(buildingName.length)
      : classroomName;
  return s.trim();
}

// ── 「现在算不算有课」（唯一一份实现）────────────────────────────────────

interface TimedCourse {
  course: CourseAt;
  start: number;
  end: number;
}

/** 节次 → 真实钟点；取不到钟点的课直接跳过（异常数据不该编出一个时间）。 */
function timedOf(courses: CourseAt[], table: TimeTable): TimedCourse[] {
  const out: TimedCourse[] = [];
  for (const course of courses) {
    const start = table[course.startSection - 1]?.startMinutes;
    const end = table[course.endSection - 1]?.endMinutes;
    if (start === undefined || end === undefined) continue;
    out.push({ course, start, end });
  }
  return out;
}

/**
 * 「正在上 / 马上要上」那一句话。
 * ⚠️ 只有这一份实现 —— App 内卡片标题与桌面组件那一行共用，不许各写各的措辞。
 */
export function courseLine(course: NextCourse): string {
  if (course.ongoing) {
    return `正在上${course.name}（${course.classroom}）`;
  }
  const at = course.startsAt === null ? null : fmtHM(course.startsAt);
  if (at === null) return `马上要上${course.name}（${course.classroom}）`;
  return `${at} 上${course.name}（${course.classroom}）`;
}

/**
 * 当前正在上的课，或 comingSoonMinutes 分钟内就要开始的课；都没有则 null。
 * ⚠️ courses 必须是当天的课（调用方负责按星期几/周次/放假补课过滤）。
 * ⚠️ 「正在上」按真实钟点判（start<=now<=end），不是节次号比较。
 */
export function currentCourseOf(
  courses: CourseAt[],
  table: TimeTable,
  now: number,
  comingSoonMinutes: number = COMING_SOON_MINUTES,
): NextCourse | null {
  const timed = timedOf(courses, table);

  // 1. 正在上：now 落在真实钟点区间内
  for (const it of timed) {
    if (now >= it.start && now <= it.end) {
      return {
        name: it.course.name,
        classroom: it.course.classroom,
        endsAt: it.end,
        ongoing: true,
        startsAt: it.start,
      };
    }
  }

  // 2. 马上要上：还没开始、且离得最近的那节在窗口内
  let next: TimedCourse | null = null;
  for (const it of timed) {
    if (now < it.start && (next === null || it.start < next.start)) next = it;
  }
  if (next === null) return null;
  if (next.start - now > comingSoonMinutes) return null;

  return {
    name: next.course.name,
    classroom: next.course.classroom,
    endsAt: next.end,
    ongoing: false,
    startsAt: next.start,
  };
}

/**
 * 「上一节课的教室」—— 就近推断的位置代理；拿不到/太久以前则 null。
 * 返回的是教室名（文萃楼I404）不是楼名 —— 由调用方用 buildingOf 去认楼。
 */
export function recentClassroomOf(
  courses: CourseAt[],
  table: TimeTable,
  now: number,
  windowMinutes: number = LAST_CLASS_FRESH_MINUTES,
): string | null {
  let last: TimedCourse | null = null;
  for (const it of timedOf(courses, table)) {
    if (now >= it.end && (last === null || it.end > last.end)) last = it;
  }
  if (last === null) return null;
  if (now - last.end > windowMinutes) return null;
  return last.course.classroom.trim().length > 0 ? last.course.classroom : null;
}

// ── 节次与占用 ──────────────────────────────────────────────────────────

/**
 * 「当前时段」对应的节次（**1-based**，与 busyTimeStr 里的节次号一致）。
 * - 正在上课 → 当前这一节
 * - 课间 / 第一节之前 → **下一节**
 * - 全天课程结束 → null（此时所有教室都算空闲）
 */
export function sectionFor(table: TimeTable, now: number): number | null {
  for (let i = 0; i < table.length; i++) {
    if (now >= table[i].startMinutes && now < table[i].endMinutes) return i + 1;
  }
  for (let i = 0; i < table.length; i++) {
    if (now < table[i].startMinutes) return i + 1;
  }
  return null;
}

/**
 * 解析占用节次。busyTimeStr 是逗号分隔的节次号（如 1,2,5,6）。
 * ⚠️ null/空串 = 全天空闲，不是「数据缺失」。单条解析失败只跳过它自己。
 */
export function parseBusySections(busyTimeStr: string | null | undefined): Set<number> {
  if (busyTimeStr === null || busyTimeStr === undefined) return new Set();
  const out = new Set<number>();
  for (const part of busyTimeStr.split(",")) {
    const n = Number(part.trim());
    if (part.trim().length > 0 && Number.isInteger(n)) out.add(n);
  }
  return out;
}

/** 教室在当前时段是否空闲。 */
export function isFreeAt(busyTimeStr: string | null | undefined, section: number | null): boolean {
  if (section === null) return true;
  return !parseBusySections(busyTimeStr).has(section);
}

/** 一栋楼在当前时段的空闲教室数。 */
export function freeCountOf(classrooms: ClassroomInfo[], table: TimeTable, now: number): number {
  const section = sectionFor(table, now);
  let count = 0;
  for (const c of classrooms) if (isFreeAt(c.busyTimeStr, section)) count++;
  return count;
}

// ── 楼级候选与排序 ──────────────────────────────────────────────────────

/** 把楼层粒度的原始事实聚成楼粒度候选。只保留 freeCount > 0 的；floors 按空闲数降序。 */
export function groupByBuilding(buildings: BuildingFree[]): Candidate[] {
  const byId = new Map<string, BuildingFree[]>();
  for (const b of buildings) {
    if (b.freeCount <= 0) continue;
    const list = byId.get(b.buildingId);
    if (list) list.push(b);
    else byId.set(b.buildingId, [b]);
  }
  const out: Candidate[] = [];
  // ArkTS 禁解构赋值（arkts-no-destruct-assignment）⇒ Map 迭代走索引
  for (const entry of byId) {
    const buildingId: string = entry[0];
    const floors: BuildingFree[] = entry[1];
    let total = 0;
    let maxAhead = 0;
    const ff: FloorFree[] = [];
    for (const f of floors) {
      total += f.freeCount;
      if (f.freeSectionsAhead > maxAhead) maxAhead = f.freeSectionsAhead;
      ff.push({ floor: f.floor, count: f.freeCount, freeSectionsAhead: f.freeSectionsAhead });
    }
    ff.sort((a, b) => b.count - a.count);
    out.push({
      buildingId,
      buildingName: floors[0].buildingName,
      freeCount: total,
      floors: ff,
      matchLastClass: false,
      freeSectionsAhead: maxAhead,
    });
  }
  return out;
}

/**
 * 教室名（文萃楼I404）属于哪栋楼 —— 取**最长**的匹配前缀；
 * 前缀认不出时走坐标表别名（理教楼406 ↔ 理科教学大楼 只能靠别名映射）。
 */
export function buildingOf(classroom: string | null | undefined, candidates: Candidate[]): string | null {
  if (classroom === null || classroom === undefined || classroom.trim().length === 0) return null;

  // 1. 前缀最精确（能区分文萃楼I 与 文萃楼）
  let best: string | null = null;
  for (const c of candidates) {
    if (c.buildingName.trim().length > 0 && classroom.startsWith(c.buildingName)) {
      if (best === null || c.buildingName.length > best.length) best = c.buildingName;
    }
  }
  if (best !== null) return best;

  // 2. 前缀认不出 → 坐标表别名（比对匹配到的地点名，不是字符串）
  const here = matchLocation(classroom)?.name;
  if (here === undefined || here === null) return null;
  for (const c of candidates) {
    if (matchLocation(c.buildingName)?.name === here) return c.buildingName;
  }
  return null;
}

/**
 * 楼级排序：空教室多的在前，同楼加成，并列时按「还能空多久」再按楼名。
 * ⚠️ 必须有确定性：输入顺序来自并发请求，不兜住的话同一份数据两次排序第一个会不一样。
 */
export function rank(buildings: BuildingFree[], lastClassroom: string | null = null): Candidate[] {
  const groups = groupByBuilding(buildings);
  const lastBuilding = buildingOf(lastClassroom, groups);

  return groups
    .map((c) =>
      lastBuilding !== null && c.buildingName === lastBuilding ? { ...c, matchLastClass: true } : c,
    )
    .sort(
      (a, b) =>
        b.freeCount + (b.matchLastClass ? SAME_BUILDING_BONUS : 0) - (a.freeCount + (a.matchLastClass ? SAME_BUILDING_BONUS : 0)) ||
        b.freeSectionsAhead - a.freeSectionsAhead ||
        (a.buildingName < b.buildingName ? -1 : a.buildingName > b.buildingName ? 1 : 0),
    );
}

/** 候选的地点名：只有一层有空时才点名楼层，否则只说楼名（名字范围与数字范围必须一致）。 */
export function candidatePlace(candidate: Candidate): string {
  if (candidate.floors.length === 1) return placeName(candidate.buildingName, candidate.floors[0].floor);
  return candidate.buildingName;
}

/** 候选标题：`文萃楼I 3 楼现在有 12 间空教室`。 */
export function candidateTitle(candidate: Candidate): string {
  return `${candidatePlace(candidate)}现在有 ${candidate.freeCount} 间空教室`;
}

/**
 * 组件用的粗粒度文案 —— **刻意不含数量**。
 * ⚠️ 组件重绘不打网络，具体数字可能是几小时前的，写上去就是在骗人。
 * ⚠️ 上课中也走「哪栋楼有空教室」这一支，不说「正在上 X」——
 *    「正在上什么」是有时效的断言，组件改为每次重绘用本地课表现算。
 */
export function coarseTitle(suggestion: Suggestion): string | null {
  if (suggestion.kind === Kind.FREE_ROOM || suggestion.kind === Kind.IN_CLASS) {
    return suggestion.buildingName === null ? null : `${suggestion.buildingName}现在有空教室`;
  }
  return suggestion.title;
}

// ── 时间断言 ────────────────────────────────────────────────────────────

/**
 * 「这间教室能待到几点」的**钟点**（20:55）；算不出来返回 null。
 * ⚠️ 只返回钟点，不返回整句话 —— 主语必须由调用方按「在说哪一级」决定。
 */
export function freeUntilTime(table: TimeTable, at: number, freeSectionsAhead: number): string | null {
  if (freeSectionsAhead <= 0) return null;
  const section = sectionFor(table, at);
  if (section === null) return null;
  const last = Math.min(section + freeSectionsAhead - 1, table.length);
  const item = table[last - 1];
  if (!item) return null;
  return fmtHM(item.endMinutes);
}

/** 「今天的课是不是都上完了」—— at 已过作息表最后一节的结束时刻。 */
export function isDayOver(table: TimeTable, at: number): boolean {
  const last = table[table.length - 1];
  if (!last) return false;
  return at >= last.endMinutes;
}

/** 从 from 节起，某间教室还能连续空几节（含 from 这一节）。 */
export function freeSectionsAhead(busyTimeStr: string | null | undefined, from: number, lastSection: number): number {
  const busy = parseBusySections(busyTimeStr);
  let count = 0;
  let section = from;
  while (section <= lastSection && !busy.has(section)) {
    count++;
    section++;
  }
  return count;
}

// ── 教室级候选 ──────────────────────────────────────────────────────────

/** 教室名 → 房间号后的展示名：`文萃楼C 501a`。房间号取不出来只说楼名。 */
export function roomPlace(room: RoomFree): string {
  const label = roomLabelOf(room.classroomName, room.buildingName);
  if (label.trim().length === 0 || label === room.buildingName) return room.buildingName;
  return `${room.buildingName} ${label}`;
}

function roomScore(candidate: RoomCandidate): number {
  const time = Math.min(candidate.room.freeSectionsAhead, FREE_SECTIONS_CAP);
  let bonus = 0;
  if (candidate.distance === Distance.SAME) bonus = SAME_BUILDING_ROOM_BONUS;
  else if (candidate.distance === Distance.NEXT_DOOR) bonus = NEXT_DOOR_ROOM_BONUS;
  return time + bonus;
}

function distanceOfBuilding(buildingName: string, ref: Location | null): Distance | null {
  const from = matchLocation(buildingName);
  if (!from) return null;
  if (ref === null) return null;
  if (from.name === ref.name) return Distance.SAME;
  return bucketOf(distanceMeters(from, ref));
}

/**
 * 把教室候选筛出来并排好序：门槛 → 打分 → 同楼限流。
 * ⚠️ 必须有确定性：并列时按「这栋楼空几间」、再楼名、再教室名。
 */
export function rankRooms(rooms: RoomFree[], reference: Reference | null = null): RoomCandidate[] {
  const ref = reference === null ? null : matchLocation(reference.classroom);
  const scored: RoomCandidate[] = [];
  for (const room of rooms) {
    // 门槛只挡「知道它空得短」的（1 节）；0 = 算不出来，不因此排除
    if (room.freeSectionsAhead !== 0 && room.freeSectionsAhead < MIN_FREE_SECTIONS) continue;
    scored.push({ room, distance: distanceOfBuilding(room.buildingName, ref ?? null) });
  }
  scored.sort(
    (a, b) =>
      roomScore(b) - roomScore(a) ||
      b.room.freeSectionsAhead - a.room.freeSectionsAhead ||
      b.room.buildingFreeCount - a.room.buildingFreeCount ||
      (a.room.buildingName < b.room.buildingName ? -1 : a.room.buildingName > b.room.buildingName ? 1 : 0) ||
      (a.room.classroomName < b.room.classroomName ? -1 : a.room.classroomName > b.room.classroomName ? 1 : 0),
  );

  // 同楼限流 + 总数上限
  const taken = new Map<string, number>();
  const out: RoomCandidate[] = [];
  for (const candidate of scored) {
    const used = taken.get(candidate.room.buildingId) ?? 0;
    if (used >= MAX_ROOMS_PER_BUILDING) continue;
    taken.set(candidate.room.buildingId, used + 1);
    out.push(candidate);
    if (out.length >= MAX_ROOM_CANDIDATES) break;
  }
  return out;
}

/**
 * 距离档位 → 一句话。
 * ⚠️ label 是参考点的主语（「你上一节课」），必须带上。
 */
export function distanceText(distance: Distance | null, label: string): string | null {
  switch (distance) {
    case Distance.SAME:
      return `就在${label}那栋楼`;
    case Distance.NEXT_DOOR:
      return `紧挨着${label}那栋楼`;
    case Distance.NEAR:
      return `距${label}那栋楼一段路`;
    case Distance.FAR:
      return `距${label}那栋楼挺远`;
    default:
      return null;
  }
}

// ── SpotOption / Plan ───────────────────────────────────────────────────

/** SpotOption 标题：三态优先级固定 —— 今天上完了 > 算得出钟点 > 只说地点（不编时间）。 */
export function spotOptionTitle(o: SpotOption): string {
  if (o.dayOver) return `${o.place}，${DAY_OVER_TEXT}`;
  if (o.untilAt !== null) return `${o.place}，空到 ${o.untilAt}`;
  return o.place;
}

/** SpotOption 副文案：距哪儿多远 · 几层 · 房间名 · 这栋楼还有几间。全没有返回 null。 */
export function spotOptionDetail(o: SpotOption): string | null {
  const parts: string[] = [];
  if (o.distance !== null) parts.push(o.distance);
  if (o.floor !== null) parts.push(`${o.floor} 层`);
  if (o.roomKind !== null) parts.push(o.roomKind);
  if (o.buildingFreeCount > 0) parts.push(`这栋楼还有 ${o.buildingFreeCount} 间`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/**
 * 有东西可展示吗 —— 决定这张卡要不要出现。
 * ⚠️ 空闲态**恒 true**（至少有「现在没课」+「暂未查到空教室」两句真话可说）。
 * 别改回 options.isNotEmpty() —— 那正是静默消失的成因。
 */
export function planHasContent(plan: Plan): boolean {
  switch (plan.kind) {
    case Kind.IN_CLASS:
      return plan.courseTitle !== null;
    case Kind.HAS_BOOKING:
      return plan.bookingTitle !== null;
    default:
      return true;
  }
}

/**
 * 组装完整建议（教室级）。
 * @param at **用户实际会到那儿的时刻**（正在上课时传下课钟点，其余传当下）
 */
export function planOf(
  at: number,
  table: TimeTable,
  course: NextCourse | null,
  booking: Booking | null,
  rooms: RoomFree[],
  reference: Reference | null = null,
): Plan {
  const options: SpotOption[] = rankRooms(rooms, reference).map((c) =>
    optionOf(c, table, at, reference === null ? null : reference.label),
  );

  if (course !== null) {
    return {
      kind: Kind.IN_CLASS,
      courseTitle: courseLine(course),
      coursePlace: course.classroom,
      courseEndsAt: course.endsAt === null ? null : fmtHM(course.endsAt),
      bookingTitle: null,
      bookingDetail: null,
      options,
    };
  }
  if (booking !== null) {
    return {
      kind: Kind.HAS_BOOKING,
      courseTitle: null,
      coursePlace: null,
      courseEndsAt: null,
      bookingTitle: `你 ${booking.timeText} 在 ${booking.place} 有座位预约`,
      bookingDetail: "已约好，直接去就行",
      options: [],
    };
  }
  return {
    kind: Kind.FREE_ROOM,
    courseTitle: null,
    coursePlace: null,
    courseEndsAt: null,
    bookingTitle: null,
    bookingDetail: null,
    options,
  };
}

/** 把教室候选渲染成卡片/详情页上的一条。 */
export function optionOf(
  candidate: RoomCandidate,
  table: TimeTable,
  at: number,
  referenceLabel: string | null = null,
): SpotOption {
  const room = candidate.room;
  return {
    buildingId: room.buildingId,
    buildingName: room.buildingName,
    place: roomPlace(room),
    floor: room.floor,
    buildingFreeCount: room.buildingFreeCount,
    roomKind: roomKindOf(room.classroomName, room.buildingName),
    distance: referenceLabel === null ? null : distanceText(candidate.distance, referenceLabel),
    untilAt: freeUntilTime(table, at, room.freeSectionsAhead),
    dayOver: isDayOver(table, at),
  };
}

/**
 * 卡片上的第 index 个候选取舍（取模，循环）。
 * ⚠️ 一间候选都没有时**也必须出卡**（说两句真话：现在没课 + 暂未查到空教室）。
 */
export function studySpotCardOf(plan: Plan, index: number = 0): SpotCard {
  const options = plan.options;
  const option: SpotOption | null =
    options.length === 0
      ? null
      : options[((index % options.length) + options.length) % options.length];

  switch (plan.kind) {
    case Kind.HAS_BOOKING:
      return {
        kind: Kind.HAS_BOOKING,
        title: plan.bookingTitle ?? "你有座位预约",
        detail: plan.bookingDetail,
      };

    case Kind.IN_CLASS: {
      const title = plan.courseTitle ?? "有课";
      let head: string | null = null;
      if (option !== null) {
        let s = "";
        if (plan.courseEndsAt !== null) s += `${plan.courseEndsAt} 下课后 · `;
        s += `去${option.place}`;
        if (option.dayOver) s += `（${DAY_OVER_TEXT}）`;
        else if (option.untilAt !== null) s += `（空到 ${option.untilAt}）`;
        head = s;
      }
      const tail = option !== null ? spotOptionDetail(option) : null;
      const parts = [head, tail].filter((x): x is string => x !== null && x.length > 0);
      return { kind: Kind.IN_CLASS, title, detail: parts.length > 0 ? parts.join(" · ") : NO_CANDIDATE_HINT };
    }

    default: {
      if (option !== null) {
        return { kind: Kind.FREE_ROOM, title: spotOptionTitle(option), detail: spotOptionDetail(option) };
      }
      return { kind: Kind.FREE_ROOM, title: FREE_HEADLINE, detail: NO_CANDIDATE_HINT_NOW };
    }
  }
}

/**
 * 楼级建议（桌面组件走这条）。组件只说「哪栋楼有空教室」，数字留给 App 内（现拉现算）。
 */
export function suggest(
  now: number,
  course: NextCourse | null,
  booking: Booking | null,
  buildings: BuildingFree[],
  lastClassroom: string | null = null,
): Suggestion | null {
  const best = rank(buildings, lastClassroom)[0] ?? null;

  if (course !== null) {
    let detail: string;
    if (best !== null && course.endsAt !== null) {
      detail = `${fmtHM(course.endsAt)}下课后，${candidatePlace(best)}有 ${best.freeCount} 间空教室`;
    } else {
      detail = `地点：${course.classroom}`;
    }
    return {
      kind: Kind.IN_CLASS,
      title: courseLine(course),
      detail,
      buildingName: best === null ? null : best.buildingName,
      buildingId: best === null ? null : best.buildingId,
      freeCount: best === null ? 0 : best.freeCount,
    };
  }

  if (booking !== null) {
    return {
      kind: Kind.HAS_BOOKING,
      title: `你 ${booking.timeText} 在 ${booking.place} 有座位预约`,
      detail: "已约好，直接去就行",
      buildingName: null,
      buildingId: null,
      freeCount: 0,
    };
  }

  if (best === null) return null;
  return {
    kind: Kind.FREE_ROOM,
    title: candidateTitle(best),
    detail: "当前时段空闲",
    buildingName: best.buildingName,
    buildingId: best.buildingId,
    freeCount: best.freeCount,
  };
}

// ── 重算与重试 ──────────────────────────────────────────────────────────

export interface PlanUpdate {
  plan: Plan;
  resetIndex: boolean;
}

/**
 * 重算之后要怎么落到界面上。
 * 两条规矩：重算拿不到 ⇒ 什么都不动；候选从「有」变成「空」⇒ 不动。
 * @return null = 保持现状（别动 plan，也别动下标）
 */
export function planUpdate(current: Plan | null, fresh: Plan | null): PlanUpdate | null {
  if (fresh === null) return null;
  if (current === null) return { plan: fresh, resetIndex: true };
  if (fresh.options.length === 0 && current.options.length > 0) return null;
  return { plan: fresh, resetIndex: !plansEqual(fresh, current) };
}

function plansEqual(a: Plan, b: Plan): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * 取到空候选时，下一次重试要等多久（毫秒）；null = 不再重试。
 * 有限次 + 递增：空候选也可能是真的（那一节所有教室都有人）。
 */
export function retryDelayMillis(plan: Plan | null, attempt: number): number | null {
  if (plan !== null && plan.options.length > 0) return null;
  return RETRY_DELAYS_MS[attempt] ?? null;
}

// ── 详情页 ──────────────────────────────────────────────────────────────

/**
 * 组装详情页内容。⚠️ 与卡片用**同一份** Plan，不自己再算一遍。
 */
export function detailOf(plan: Plan): SpotDetail {
  const rows: SpotDetailRow[] = plan.options.map((option, index) => ({
    buildingId: option.buildingId,
    place: option.place,
    untilText: option.dayOver
      ? DAY_OVER_TEXT
      : option.untilAt !== null
        ? `空到 ${option.untilAt}`
        : "现在空着",
    detail: spotOptionDetail(option),
    top: index === 0,
  }));

  switch (plan.kind) {
    case Kind.HAS_BOOKING:
      return {
        kind: plan.kind,
        headline: plan.bookingTitle ?? "你有座位预约",
        subline: plan.bookingDetail ?? "",
        rows: [],
        emptyHint: null,
      };

    case Kind.IN_CLASS:
      return {
        kind: plan.kind,
        headline: plan.courseTitle ?? "有课",
        subline:
          plan.courseEndsAt !== null ? `${plan.courseEndsAt} 下课后可以去这些地方` : "下课后可以去这些地方",
        rows,
        emptyHint: rows.length === 0 ? NO_CANDIDATE_HINT : null,
      };

    default: {
      // ⚠️ 副标题是对用户的一句承诺，必须说真话：无参考点时排序退化，
      // 不能说「离你多近排的」（那是在承诺一个不在场的依据）
      const byDistance = plan.options.some((o) => o.distance !== null);
      return {
        kind: plan.kind,
        headline: FREE_HEADLINE,
        subline:
          rows.length === 0 ? "" : byDistance ? "按能待多久、离你多近排的" : "按能待多久、这栋楼空几间排的",
        rows,
        emptyHint: rows.length === 0 ? NO_CANDIDATE_HINT_NOW : null,
      };
    }
  }
}
