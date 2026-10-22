/**
 * 桌面卡片的**数据装配**（M8-1~M8-4 共用，纯函数，单测直接打）。
 *
 * 为什么要单独这一层：ArkTS 服务卡片运行在**独立进程**的受限渲染环境，
 * 它读不了主进程的 Prefs / 本地缓存，数据只能由主进程算好后经
 * `formBindingData`（可 JSON 序列化）塞进去。所以「本地源 → build() 入参」
 * 的映射必须是**纯函数**（不碰 IO），映射对不对就靠单测证伪；
 * 真正读 CourseCache/DdlStore 那一步留在 service（M8 平台壳接）。
 *
 * 对照 Android `WidgetRepository`（把各数据源组装进 WidgetLogic）：
 * 这里只搬**本地能拿到**的三源——课表（CourseCache）、DDL（DdlStore）、
 * 教学调整（TeachingAdjustmentService 缓存）。动态（eclass）与座位（M9）
 * 本地没有落地源，给空 ⇒ 卡片只显示课程/DDL/自习，不猜。
 */

import { type CourseRow, skzcToWeeks } from '../core/model/SchoolModels.ts';
import { type DdlEntry } from './DdlRules.ts';
import {
  type CourseSchedule,
  type DDLSchedule,
  type SeatSnapshot,
  type WidgetPage,
  build as buildWidgetPages
} from './WidgetLogic.ts';
import { type AdjustmentEntry, type DayPlan } from './TeachingAdjustment.ts';
import { type EclassActivity } from './EclassActivityLogic.ts';
import { type DateTime, type TimeTable, parseISODate } from './timeutil.ts';

/** 课表行 → 卡片用的课程（1:1 字段映射；周次必须走 skzcToWeeks，与 M7-2 同款坑）。 */
export function coursesToSchedule(rows: CourseRow[]): CourseSchedule[] {
  const out: CourseSchedule[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r: CourseRow = rows[i];
    if (r.SKXQ < 1 || r.SKXQ > 7 || r.KSJC < 1) {
      continue; // 非渲染行不进卡片
    }
    out.push({
      name: r.KCM,
      teacher: r.SKJS,
      classroom: r.JASMC,
      weeks: skzcToWeeks(r.SKZC),
      weekday: r.SKXQ,
      start_section: r.KSJC,
      end_section: r.JSJC,
      campus: r.XXXQMC
    });
  }
  return out;
}

/** DDL 存储条目 → 卡片用的 DDL（字段同名直搬，time = {day, minutes}）。 */
export function ddlsToSchedule(entries: DdlEntry[]): DDLSchedule[] {
  const out: DDLSchedule[] = [];
  for (let i = 0; i < entries.length; i++) {
    const e: DdlEntry = entries[i];
    out.push({
      group: e.group,
      uid: e.uid,
      title: e.title,
      text: e.text,
      time: { day: e.day, minutes: e.minutes },
      done: e.done
    });
  }
  return out;
}

/** 空座位快照（M9 未做；卡片座位页据此显示「没预约 / 去登录」引导，不猜）。 */
export function emptySeatSnapshot(): SeatSnapshot {
  return { lines: [], quickReserveTaskId: null, activeNotice: null };
}

export interface WidgetAssembleInput {
  courses: CourseSchedule[];
  ddls: DDLSchedule[];
  activities: EclassActivity[];
  adjustments: AdjustmentEntry[];
  firstDay: string; // 开学日 ISO（CourseCache.firstDay）；空 = 未知
  timeTable: TimeTable;
  now: DateTime;
}

/**
 * 把本地源装配成卡片要渲染的 WidgetPage[]（课程/DDL/动态/座位/自习 5 页）。
 * 纯函数：不读 IO，全部入参显式传（可测）。无登录 / 无课表时各页走 loginPrompt /
 * emptyText 兜底（WidgetLogic 内已处理，这里只负责把入参喂对）。
 */
export function assembleWidgetPages(input: WidgetAssembleInput): WidgetPage[] {
  const todayEpochDay: number = input.now.day;
  const firstDayEpochDay: number | null = parseISODate(input.firstDay);
  const planOf: (day: number) => DayPlan | null =
    (day: number) => {
      for (let i = 0; i < input.adjustments.length; i++) {
        if (input.adjustments[i].day === day) {
          return input.adjustments[i].plan;
        }
      }
      return null;
    };

  // 卡片 5 页里课程/DDL/自习靠本地；动态源鸿蒙未落地 → 空；座位 M9 未做 → 空快照。
  return buildWidgetPages(
    input.courses,
    input.ddls,
    emptySeatSnapshot(),
    todayEpochDay,
    input.now,
    firstDayEpochDay,
    input.timeTable,
    true, // bit101LoggedIn：卡片不区分学校登录态（本地有课表就能显示，没课表走空态）
    false, // seatLoggedIn：座位源未接，按未登录给引导
    input.activities,
    false, // eclassLoggedIn：动态源未接
    planOf,
    null // studySpotLine：空教室要网络，卡片不碰，给 null 走「暂时看不了」
  );
}

/** 卡片 payload 必须可 JSON 序列化（formBindingData 只吃 JSON 友好的结构）。 */
export function isSerializablePayload(pages: WidgetPage[]): boolean {
  try {
    const s: string = JSON.stringify(pages);
    return s.length > 0 && s.indexOf('undefined') < 0;
  } catch (e) {
    return false;
  }
}
