/**
 * 「现在去哪儿自习」的取数与装配（M3-3）
 *
 * 纯算法在 `corelogic/StudySpotLogic.ts`（1:1 移植，922 行），这里只做三件事：
 * ① 把「课程 + 空教室 + 教学调整」拼成它的输入；② 逐栋并发拉教室；③ 翻译成人话。
 *
 * ## ⚠️ 为什么逐栋并发而不是一次全拉
 * 空教室接口**按教学楼**查（`JXLDM` 参数），全校十几栋楼 ⇒ 只能一栋一个请求。
 * Android 实测要 20~40 秒。这里限制并发 4，既不让服务端难堪，也比串行快 3~4 倍。
 *
 * ## ⚠️ 铁律 0.6：这**只是查询**，不排期、不写远端，可以自动跑
 * （对比：座位预约有对外副作用，必须用户显式点击）
 */

import { Context } from '@kit.AbilityKit';
import { SchoolService } from './SchoolService.ts';
import { ClassroomService } from './ClassroomService.ts';
import { CourseCache, CachedSchedule } from '../data/CourseCache.ts';
import { TeachingAdjustmentService } from './TeachingAdjustmentService.ts';
import {
  BuildingInfo, CampusInfo, ClassroomRow, CourseRow
} from '../core/model/SchoolModels.ts';
import { skzcToWeeks } from '../core/model/SchoolModels.ts';
import { weeksContains, weekOf, effectiveWeekday } from '../corelogic/CourseWeekdayLogic.ts';
import { FALLBACK_TIME_TABLE } from '../corelogic/TimeTableLogic.ts';
import { parseISODate } from '../corelogic/timeutil.ts';
import type { TimeTable } from '../corelogic/timeutil.ts';
import {
  CourseAt, Plan, RoomFree, SpotCard,
  MIN_FREE_SECTIONS, MAX_ROOMS_PER_BUILDING, MAX_ROOM_CANDIDATES,
  currentCourseOf, planOf, sectionFor, studySpotCardOf
} from '../corelogic/StudySpotLogic.ts';
import { DayPlan, dayPlanOf } from '../corelogic/TeachingAdjustment.ts';
import type { TeachingEntry } from '../corelogic/TeachingAdjustmentParser.ts';
import { info, warn } from '../core/log/BitLog.ts';

const SECTIONS: number = 13;
/** 并发上限：一栋楼一次请求，4 个并行。 */
const CONCURRENCY: number = 4;

export interface SpotResult {
  /** 卡片内容；null = 这次算不出来（error 里说明原因）。 */
  card: SpotCard | null;
  plan: Plan | null;
  error: string;
  /** 给人看的统计（「8 栋楼 / 312 间 / 12 秒」），用于确认并发真的生效。 */
  meta: string;
  /** 今天是否放假（放假时课表为空，但空教室仍可查）。 */
  dayOff: boolean;
}

export class StudySpotService {
  static async compute(context: Context): Promise<SpotResult> {
    const t0: number = Date.now();
    const empty: SpotResult = { card: null, plan: null, error: '', meta: '', dayOff: false };

    // ── ① 时间与学期 ──
    // ⚠️ 必须用**当前学期**的缓存，不能用「上次查看的学期」——
    // 栽过（2026-10-20）：用户看过 2025-2026-2 之后，自习卡按那个学期的开学日
    // 算出「第 34 周」，查出来的空教室是错的。
    let term: string = '';
    try {
      term = await SchoolService.getCurrentTerm(context);
    } catch (e) {
      empty.error = '取当前学期失败（' + (e as Error).message + '）';
      return empty;
    }
    const cached: CachedSchedule | null = await CourseCache.load(term);
    if (cached === null) {
      empty.error = '这学期还没有课表缓存，请先打开一次课表（之后这里就能离线算）';
      return empty;
    }
    const firstEpoch: number | null = parseISODate(cached.firstDay);
    if (firstEpoch === null) {
      empty.error = '开学日未知，算不出「第几周」';
      return empty;
    }
    const d: Date = new Date();
    const todayEpoch: number = Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
    const week: number = weekOf(firstEpoch, todayEpoch);
    if (week < 1) {
      empty.error = '今天还没开学（第 ' + week + ' 周）';
      return empty;
    }
    const mm: string = String(d.getMonth() + 1).padStart(2, '0');
    const dd: string = String(d.getDate()).padStart(2, '0');
    const dateStr: string = d.getFullYear() + '-' + mm + '-' + dd;
    const now: number = d.getHours() * 60 + d.getMinutes();
    const table: TimeTable = FALLBACK_TIME_TABLE;

    // ── ② 教学调整（有缓存，快）──
    let entries: TeachingEntry[] = [];
    try {
      const ta = await TeachingAdjustmentService.load(context, false);
      entries = ta.entries;
    } catch (e) {
      warn('StudySpot ta fail: ' + JSON.stringify(e));
    }
    const planOfDay = (epochDay: number): DayPlan | null => dayPlanOf(entries, epochDay);
    const effDow: number | null = effectiveWeekday(todayEpoch, planOfDay);
    const dayOff: boolean = effDow === null;

    // ── ③ 今天的课（放假 ⇒ 没有课）──
    const todays: CourseAt[] = [];
    if (effDow !== null) {
      for (let i = 0; i < cached.courses.length; i++) {
        const c: CourseRow = cached.courses[i];
        if (c.SKXQ !== effDow) {
          continue;
        }
        if (!weeksContains(skzcToWeeks(c.SKZC), week)) {
          continue;
        }
        todays.push({
          name: c.KCM, classroom: c.JASMC,
          startSection: c.KSJC, endSection: c.JSJC
        });
      }
    }
    const course = currentCourseOf(todays, table, now);

    // ── ④ 校区 → 楼 → 教室（逐栋并发）──
    let campusCode: string = '';
    let buildings: BuildingInfo[] = [];
    try {
      const campuses: CampusInfo[] = await SchoolService.getCampuses(context);
      if (campuses.length === 0) {
        empty.error = '没有取到校区列表';
        return empty;
      }
      campusCode = campuses[0].code;
      buildings = await SchoolService.getBuildings(context, campusCode);
    } catch (e) {
      empty.error = '取校区/教学楼失败（' + (e as Error).message + '）';
      return empty;
    }
    if (buildings.length === 0) {
      empty.error = '这个校区没有教学楼数据';
      return empty;
    }

    const perBuilding: ClassroomRow[][] = [];
    for (let i = 0; i < buildings.length; i++) {
      perBuilding.push([]);
    }
    let cursor: number = 0;
    const fetchOne = async (): Promise<void> => {
      while (cursor < buildings.length) {
        const idx: number = cursor;
        cursor++;
        try {
          perBuilding[idx] = await ClassroomService.getClassrooms(
            context, term, week, effDow === null ? 1 : effDow, dateStr,
            buildings[idx].buildingIndex);
        } catch (e) {
          // 单栋失败不拖累其它楼（并把这些楼如实计入 meta 的失败数）
          perBuilding[idx] = [];
          warn('StudySpot building fail ' + buildings[idx].buildingIndex + ': ' + JSON.stringify(e));
        }
      }
    };
    const workers: Promise<void>[] = [];
    for (let k = 0; k < Math.min(CONCURRENCY, buildings.length); k++) {
      workers.push(fetchOne());
    }
    await Promise.all(workers);

    // ── ⑤ 拼 RoomFree ──
    const section: number | null = sectionFor(table, now);
    // 全天课程结束（section=null）⇒ 所有教室从此以后都空闲
    const from: number = section === null ? 1 : section;
    const counted: RoomFree[] = [];
    let emptyBuildings: number = 0;
    let totalRooms: number = 0;
    for (let b = 0; b < perBuilding.length; b++) {
      const rows: ClassroomRow[] = perBuilding[b];
      if (rows.length === 0) {
        emptyBuildings++;
        continue;
      }
      totalRooms += rows.length;
      const bName: string = buildings[b].buildingName.length > 0
        ? buildings[b].buildingName : buildings[b].buildingIndex;
      // 这栋楼「现在能用的」教室数（连续空闲 ≥ 2 节）
      let freeCount: number = 0;
      const candidates: RoomFree[] = [];
      for (let i = 0; i < rows.length; i++) {
        const ahead: number = section === null ? SECTIONS : ClassroomService.freeRunFrom(rows[i], from);
        if (ahead >= MIN_FREE_SECTIONS) {
          freeCount++;
        }
        candidates.push({
          buildingId: buildings[b].buildingIndex,
          buildingName: bName,
          classroomName: rows[i].JASMC,
          floor: null, // 楼层由 StudySpotLogic.floorOf 从教室名解析，这里不猜
          freeSectionsAhead: ahead,
          buildingFreeCount: 0 // 先占位，下面回填
        });
      }
      // 回填 buildingFreeCount（必须全楼统计完才知道）
      for (let i = 0; i < candidates.length; i++) {
        candidates[i].buildingFreeCount = freeCount;
      }
      // 每栋楼只保留空得最久的 2 间（对照 MAX_ROOMS_PER_BUILDING）
      candidates.sort((a: RoomFree, b2: RoomFree) => b2.freeSectionsAhead - a.freeSectionsAhead);
      for (let i = 0; i < Math.min(MAX_ROOMS_PER_BUILDING, candidates.length); i++) {
        if (candidates[i].freeSectionsAhead >= MIN_FREE_SECTIONS) {
          counted.push(candidates[i]);
        }
      }
    }

    // 总候选上限（对照 MAX_ROOM_CANDIDATES）
    counted.sort((a: RoomFree, b2: RoomFree) => b2.freeSectionsAhead - a.freeSectionsAhead);
    const rooms: RoomFree[] = counted.slice(0, MAX_ROOM_CANDIDATES);

    // ── ⑥ 交给纯逻辑 ──
    const plan: Plan = planOf(now, table, course, null, rooms, null);
    const card: SpotCard = studySpotCardOf(plan, 0);

    const sec: number = Math.round((Date.now() - t0) / 100) / 10;
    const meta: string = buildings.length + ' 栋楼 / ' + totalRooms + ' 间 / ' +
      (emptyBuildings > 0 ? emptyBuildings + ' 栋没数据 / ' : '') + sec + ' 秒';
    info('StudySpot kind=' + plan.kind + ' options=' + plan.options.length +
      ' rooms=' + rooms.length + ' meta=' + meta + (dayOff ? ' dayOff=yes' : ''));

    return { card: card, plan: plan, error: '', meta: meta, dayOff: dayOff };
  }
}
