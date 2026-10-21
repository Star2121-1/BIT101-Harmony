/**
 * eclass 作业同步（M4-2）：课程 → 动态 → DDL 条目 → 落库。
 *
 * 1:1 对照 Android `DefaultEclassRepo.fetchHomework` + `EclassDdlSyncer`：
 *  - 课程列表取 `/api/user/recently-visited-courses`，逐课程拉 activities；
 *  - **单门课失败不拖垮整次同步**（逐课程 try/catch，只丢它自己）——
 *    课程多、网络不稳时这一点很重要（Android 原注释）；
 *  - 作业判定不枚举 type，用字段存在性（corelogic/EclassDdlLogic.isHomework）；
 *  - 合并规则：按 uid 插入/更新、保留 done（corelogic/DdlRules.mergeDdl）。
 *
 * 验收判据（ROADMAP §4 M4-2）：有作业的账号能同步出至少 1 条截止时间。
 */

import { Context } from '@kit.AbilityKit';
import { EclassService } from './EclassService.ts';
import { EclassCourse, RawActivity } from '../core/model/EclassModels.ts';
import { toDdlItems, GROUP } from '../corelogic/EclassDdlLogic.ts';
import type { Activity, EclassDdlItem } from '../corelogic/EclassDdlLogic.ts';
import type { DateTime } from '../corelogic/timeutil.ts';
import { DdlStore } from '../data/DdlStore.ts';
import { info, warn } from '../core/log/BitLog.ts';

/** 一次同步的统计（上屏 + 进日志；数字必须与实际动作一致，铁律 0.4）。 */
export interface SyncStats {
  /** 拿到的课程数。 */
  courses: number;
  /** 拿到的动态总条数（含资料）。 */
  activities: number;
  /** 其中判定为作业的条数。 */
  items: number;
  /** 逐课程失败的课程数。 */
  failedCourses: number;
  /** 新入库条数。 */
  added: number;
  /** 更新（保留 done）条数。 */
  updated: number;
  /** 合并后库内总数。 */
  total: number;
}

export class EclassSyncService {
  /**
   * 本地「现在」（impure 边界：只有这里读系统时间）。
   * 纯函数一律由调用方传 now（timeutil 的约定）。
   */
  static nowLocal(): DateTime {
    const d: Date = new Date();
    const offsetMs: number = d.getTimezoneOffset() * 60000; // UTC - local
    return {
      day: Math.floor((d.getTime() - offsetMs) / 86400000),
      minutes: d.getHours() * 60 + d.getMinutes()
    };
  }

  /** RawActivity（模型层）→ Activity（逻辑层）：字段同名，逐个搬。 */
  private static toLogicActivity(a: RawActivity): Activity {
    return {
      id: a.id,
      title: a.title,
      type: a.type,
      courseId: a.courseId,
      startTime: a.startTime,
      endTime: a.endTime,
      visibleEndAt: a.visibleEndAt,
      isClosed: a.isClosed,
      submitTimes: a.submitTimes,
      lateSubmissionCount: a.lateSubmissionCount,
      isReviewHomework: a.isReviewHomework
    };
  }

  /**
   * 同步作业。会话失效时抛 EclassAuthError（调用方引导去登录）。
   *
   * @param now 可注入（测试/调试用）；缺省取本地当前时间
   */
  static async sync(context: Context, now?: DateTime): Promise<SyncStats> {
    const nowDt: DateTime = now !== undefined ? now : EclassSyncService.nowLocal();
    const courses: EclassCourse[] = await EclassService.getVisitedCourses(context);
    if (courses.length === 0) {
      // 课程为空 ≠ 没作业：可能是「没访问过任何课程」或接口变了。
      // 不写库（避免把旧数据合并成空），如实报空。
      warn('eclass sync: 0 courses (visited_courses empty)');
      return { courses: 0, activities: 0, items: 0, failedCourses: 0, added: 0, updated: 0, total: 0 };
    }

    let activities: number = 0;
    let failedCourses: number = 0;
    const items: EclassDdlItem[] = [];

    for (let i = 0; i < courses.length; i++) {
      const course: EclassCourse = courses[i];
      try {
        const acts: RawActivity[] = await EclassService.getActivities(context, course.id);
        activities += acts.length;
        const logic: Activity[] = acts.map((a: RawActivity) => EclassSyncService.toLogicActivity(a));
        const courseItems = toDdlItems(logic, course.name, nowDt);
        for (let j = 0; j < courseItems.length; j++) {
          items.push(courseItems[j]);
        }
      } catch (e) {
        // 单门课失败只丢它自己（Android 同款纪律）
        failedCourses++;
        warn('eclass sync course fail id=' + course.id + ' name=' + course.name +
          ': ' + (e as Error).message);
      }
    }

    if (items.length === 0 && failedCourses === courses.length) {
      // 全挂 ⇒ 多半是会话问题，不写库
      throw new Error('全部 ' + courses.length + ' 门课都取动态失败（会话或网络问题）');
    }

    const merged = await DdlStore.mergeIncoming(items, GROUP);
    const stats: SyncStats = {
      courses: courses.length,
      activities: activities,
      items: items.length,
      failedCourses: failedCourses,
      added: merged.added,
      updated: merged.updated,
      total: merged.total
    };
    info('eclass sync done ' + JSON.stringify(stats));
    return stats;
  }
}
