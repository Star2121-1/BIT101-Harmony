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
import { SchoolService, SchoolAuthError } from './SchoolService.ts';
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
  CourseAt, NextCourse, Plan, RoomFree, SpotCard,
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
  /** 卡片内容；null = 这次真的算不出来（error 里说明原因）。 */
  card: SpotCard | null;
  plan: Plan | null;
  error: string;
  /**
   * 错误类别。UI 据此给不同处置（不是所有错都该显示成红字）：
   * - `none`       正常
   * - `nologin`    没登录 / 会话失效 → 该给「去登录」入口
   * - `network`    网络不通 → 该说「联网后再试」，不是叫用户重登
   * - `nocache`    这学期还没课表缓存 → 该引导「先打开一次课表」
   * - `nofirstday` 开学日未知 → 算不出周次
   * - `notstarted` 还没开学
   * - `nodata`     接口通了但没数据
   * - `other`      其它
   */
  errorKind: string;
  /** 给人看的统计（「8 栋楼 / 312 间 / 12 秒」），用于确认并发真的生效。 */
  meta: string;
  /** 今天是否放假（放假时课表为空，但空教室仍可查）。 */
  dayOff: boolean;
  /**
   * true = 没能确认当前学期，用的是「上次打开的学期」缓存。
   * ⚠️ 这时周次可能不准，UI **必须**标注出来，不能当正常结果展示。
   */
  staleTerm: boolean;
}

export class StudySpotService {
  /**
   * 最近一次算出来的结果。
   *
   * 为什么要缓存：算一次要 20 秒（逐栋查空教室），详情页只是换个视角看同一个结果，
   * 不能重算。用模块级变量而不是页面间传参 —— plan 对象太大，塞 router params 既笨重又易丢。
   */
  private static lastResult: SpotResult | null = null;

  /** 最近一次结果；null = 本次进程还没算过（详情页据此提示「先算一次」）。 */
  static lastComputed(): SpotResult | null {
    return StudySpotService.lastResult;
  }

  /** 造一个「算不出来」的结果（统一构造，避免以后加字段时漏填）。 */
  private static fail(kind: string, message: string): SpotResult {
    const r: SpotResult = {
      card: null, plan: null, error: message, errorKind: kind,
      meta: '', dayOff: false, staleTerm: false
    };
    StudySpotService.lastResult = r;
    return r;
  }

  /**
   * 网络段失败时的降级结果：**课表信息照给**（那是本地缓存算的，不需要网），
   * 但把「查不了空教室」的原因说清楚，且不伪装成「真没有空教室」。
   */
  private static degraded(
    course: NextCourse | null, table: TimeTable, now: number,
    reason: string, kind: string, staleTerm: boolean, dayOff: boolean
  ): SpotResult {
    const plan: Plan = planOf(now, table, course, null, [], null);
    const base: SpotCard = studySpotCardOf(plan, 0);
    // 覆盖 detail：base.detail 在无候选时是「暂未查到空教室」，容易被读成「真的没有」。
    const card: SpotCard = { kind: base.kind, title: base.title, detail: reason };
    info('StudySpot degraded kind=' + kind + ' reason=' + reason);
    const r: SpotResult = {
      card: card, plan: plan, error: reason, errorKind: kind,
      meta: '', dayOff: dayOff, staleTerm: staleTerm
    };
    StudySpotService.lastResult = r;
    return r;
  }

  static async compute(context: Context): Promise<SpotResult> {
    const t0: number = Date.now();

    // ── ① 时间与学期 ──
    // ⚠️ 必须用**当前学期**的缓存，不能用「上次查看的学期」——
    // 栽过（2026-10-20）：用户看过 2025-2026-2 之后，自习卡按那个学期的开学日
    // 算出「第 34 周」，查出来的空教室是错的。
    //
    // 但「取不到当前学期」（断网 / 会话失效）时，用上次的缓存把**今天的课**算出来是有价值的：
    // 课表在本地，压根不需要网络。这时 staleTerm=true，UI 必须标注「周次可能不准」。
    let term: string = '';
    let cache: CachedSchedule | null = null;
    let staleTerm: boolean = false;
    let authFailed: boolean = false;
    try {
      term = await SchoolService.getCurrentTerm(context);
      cache = await CourseCache.load(term);
      if (cache === null) {
        // 学期拿到了、但这学期没有缓存（只打开过别的学期）⇒ 也用上次的，但标注
        const last: CachedSchedule | null = await CourseCache.loadLast();
        if (last !== null) {
          cache = last;
          term = last.term;
          staleTerm = true;
        }
      }
    } catch (e) {
      authFailed = (e instanceof SchoolAuthError);
      const last: CachedSchedule | null = await CourseCache.loadLast();
      if (last === null) {
        return StudySpotService.fail(
          authFailed ? 'nologin' : 'network',
          authFailed
            ? '学校会话已失效，请重新登录（登录后才能查空教室）'
            : '网络不通，取不到当前学期。连上网后再试。'
        );
      }
      cache = last;
      term = last.term;
      staleTerm = true;
      info('StudySpot term unknown, fallback to last cache term=' + term +
        ' authFailed=' + (authFailed ? 'yes' : 'no'));
    }
    if (cache === null) {
      return StudySpotService.fail('nocache',
        '这学期还没有课表缓存，请先打开一次课表（之后这里就能离线算）');
    }
    const firstEpoch: number | null = parseISODate(cache.firstDay);
    if (firstEpoch === null) {
      return StudySpotService.fail('nofirstday', '开学日未知，算不出「第几周」');
    }
    const d: Date = new Date();
    const todayEpoch: number = Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
    const week: number = weekOf(firstEpoch, todayEpoch);
    if (week < 1) {
      return StudySpotService.fail('notstarted', '今天还没开学（第 ' + week + ' 周）');
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
      for (let i = 0; i < cache.courses.length; i++) {
        const c: CourseRow = cache.courses[i];
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
    // 这一段全部需要网络。失败时**不要**丢掉课表信息：课程是本地缓存算出来的，
    // 把它连同「查不了空教室」的原因一起给出去（M3-5）。
    let campusCode: string = '';
    let buildings: BuildingInfo[] = [];
    try {
      const campuses: CampusInfo[] = await SchoolService.getCampuses(context);
      if (campuses.length === 0) {
        return StudySpotService.degraded(course, table, now,
          '教务没返回校区列表，查不了空教室', 'nodata', staleTerm, dayOff);
      }
      campusCode = campuses[0].code;
      buildings = await SchoolService.getBuildings(context, campusCode);
    } catch (e) {
      const auth: boolean = (e instanceof SchoolAuthError);
      return StudySpotService.degraded(course, table, now,
        auth ? '学校会话已失效，查不了空教室（请重新登录）'
             : '网络不通，查不了空教室',
        auth ? 'nologin' : 'network', staleTerm, dayOff);
    }
    if (buildings.length === 0) {
      return StudySpotService.degraded(course, table, now,
        '这个校区没有教学楼数据，查不了空教室', 'nodata', staleTerm, dayOff);
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
      ' rooms=' + rooms.length + ' meta=' + meta + (dayOff ? ' dayOff=yes' : '') +
      (staleTerm ? ' staleTerm=yes' : ''));

    const result: SpotResult = {
      card: card, plan: plan, error: '', errorKind: 'none',
      meta: meta, dayOff: dayOff, staleTerm: staleTerm
    };
    StudySpotService.lastResult = result;
    return result;
  }
}
