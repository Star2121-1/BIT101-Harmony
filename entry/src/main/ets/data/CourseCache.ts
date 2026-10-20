/**
 * 课表本地缓存（离线可读 + 冷启动秒开）
 *
 * ## 为什么是 Preferences 而不是 RDB
 * 当前只需满足一件事：**没有网络也能看上次的课表**。
 * 存 JSON 一次写入、一次读出，字段与接口原样对应，没有迁移负担。
 *
 * ⚠️ RDB 留给 M2-8（手动改课表覆盖层）：那时才真正需要 `course_overlay` 与主表
 * 做关联查询。现在上 RDB 只是提前引入一层未验证的实现，收益为零。
 * **这条要如实写进报告**——它是「按需延后」，不是「假装做了」。
 *
 * ## ⚠️ 铁律 0.8：缓存只放**原始事实**
 * 这里存的是接口返回的原始行（CourseRow 全字段）+ 学期 + 开学日。
 * 派生结果（本周筛哪些课、节次文案、今日高亮）**一律现算**，绝不入缓存——
 * 否则界面上会出现「已经上完的那节课还显示着」。
 */

import { CourseRow } from '../core/model/SchoolModels.ts';
import { Prefs } from './Prefs.ts';
import { warn } from '../core/log/BitLog.ts';

const KEY_PREFIX: string = 'schedule_cache_v2_';
/** 上次查看的学期（冷启动时先上屏它）。 */
const KEY_LAST_TERM: string = 'schedule_last_term';

/** 缓存内容（原始事实，不带任何派生字段）。 */
export interface CachedSchedule {
  term: string;
  firstDay: string;
  fetchedAt: number;
  courses: CourseRow[];
}

export class CourseCache {
  /** 按学期分开存：切到历史学期也能离线看，且不会互相覆盖。 */
  static async save(term: string, firstDay: string, courses: CourseRow[]): Promise<void> {
    if (term.length === 0) {
      return;
    }
    const data: CachedSchedule = {
      term: term, firstDay: firstDay, fetchedAt: Date.now(), courses: courses
    };
    try {
      await Prefs.putString(KEY_PREFIX + term, JSON.stringify(data as Object));
      await Prefs.putString(KEY_LAST_TERM, term);
    } catch (e) {
      warn('CourseCache save fail: ' + JSON.stringify(e));
    }
  }

  /** 读指定学期的缓存；没有/损坏返回 null（**不抛错**）。 */
  static async load(term: string): Promise<CachedSchedule | null> {
    if (term.length === 0) {
      return null;
    }
    try {
      const raw: string = await Prefs.getString(KEY_PREFIX + term, '');
      return CourseCache.decode(raw, term);
    } catch (e) {
      warn('CourseCache load fail: ' + JSON.stringify(e));
      return null;
    }
  }

  /** 读「上次查看的学期」的缓存（冷启动先上屏用）。 */
  static async loadLast(): Promise<CachedSchedule | null> {
    try {
      const term: string = await Prefs.getString(KEY_LAST_TERM, '');
      return await CourseCache.load(term);
    } catch (e) {
      return null;
    }
  }

  private static decode(raw: string, expectTerm: string): CachedSchedule | null {
    if (raw.length === 0) {
      return null;
    }
    const rec: Record<string, Object> = JSON.parse(raw) as Record<string, Object>;
    const fetchedAt: number = typeof rec['fetchedAt'] === 'number' ? rec['fetchedAt'] as number : 0;
    const term: string = typeof rec['term'] === 'string' ? rec['term'] as string : '';
    // ⚠️ 学期必须对得上：key 写错或数据串了时宁可当没缓存，也不能把别的学期显示成这个学期
    if (fetchedAt <= 0 || term.length === 0 || term !== expectTerm) {
      return null;
    }
    return {
      term: term,
      firstDay: typeof rec['firstDay'] === 'string' ? rec['firstDay'] as string : '',
      fetchedAt: fetchedAt,
      courses: CourseCache.parseCourses(rec['courses'])
    };
  }

  /** 「12 分钟前」这类给人看的时效标签。 */
  static ageText(fetchedAt: number): string {
    const ms: number = Date.now() - fetchedAt;
    if (ms < 0) {
      return '刚刚';
    }
    const min: number = Math.floor(ms / 60000);
    if (min < 1) {
      return '刚刚';
    }
    if (min < 60) {
      return min + ' 分钟前';
    }
    const hour: number = Math.floor(min / 60);
    if (hour < 24) {
      return hour + ' 小时前';
    }
    return Math.floor(hour / 24) + ' 天前';
  }

  /** JSON → CourseRow：**逐字段重建**（脏数据只丢那一条，不整批失败）。 */
  private static parseCourses(v: Object | undefined): CourseRow[] {
    const out: CourseRow[] = [];
    if (!Array.isArray(v)) {
      return out;
    }
    const arr: Object[] = v as Object[];
    for (let i = 0; i < arr.length; i++) {
      const r: Record<string, Object> = arr[i] as Record<string, Object>;
      const kcm: string = CourseCache.str(r, 'KCM');
      if (kcm.length === 0) {
        continue;
      }
      out.push({
        XNXQDM: CourseCache.str(r, 'XNXQDM'),
        KCM: kcm,
        SKJS: CourseCache.str(r, 'SKJS'),
        JASMC: CourseCache.str(r, 'JASMC'),
        YPSJDD: CourseCache.str(r, 'YPSJDD'),
        SKZC: CourseCache.str(r, 'SKZC'),
        SKXQ: CourseCache.num(r, 'SKXQ'),
        KSJC: CourseCache.num(r, 'KSJC'),
        JSJC: CourseCache.num(r, 'JSJC'),
        XXXQMC: CourseCache.str(r, 'XXXQMC'),
        KCH: CourseCache.str(r, 'KCH'),
        XF: CourseCache.num(r, 'XF'),
        XS: CourseCache.num(r, 'XS'),
        KCXZDM_DISPLAY: CourseCache.str(r, 'KCXZDM_DISPLAY'),
        KCLBDM_DISPLAY: CourseCache.str(r, 'KCLBDM_DISPLAY'),
        KKDWDM_DISPLAY: CourseCache.str(r, 'KKDWDM_DISPLAY')
      });
    }
    return out;
  }

  private static str(r: Record<string, Object>, key: string): string {
    const v: Object | undefined = r[key];
    return typeof v === 'string' ? v as string : '';
  }

  private static num(r: Record<string, Object>, key: string): number {
    const v: Object | undefined = r[key];
    return typeof v === 'number' ? v as number : 0;
  }
}
