/**
 * 考试安排本地缓存（M7-2：让**代理提醒排期**能离线拿到考试）。
 *
 * 为什么要它：提醒排期在「每次开 App」时重跑（EntryAbility 启动即执行），
 * 那时未必有网 / 教务会话。课表有 CourseCache、教学调整有缓存、DDL 在本地库，
 * 唯独考试之前只有「取数就显示、不落地」——排期器拿不到，考试类提醒就静默失效。
 *
 * 与 CourseCache 同一取舍：存**原始 ExamRow**（接口字段原样），不存解析出的时刻
 *（时刻在排期时用 NotifyAdapter 现算；铁律 0.8：缓存只放原始事实）。
 *
 * ⚠️ 按 term 分存（同 CourseCache）：切学期不互相覆盖；loadLast 读上次查看的 term。
 */

import { ExamRow } from '../core/model/SchoolModels.ts';
import { Prefs } from './Prefs.ts';
import { warn, info } from '../core/log/BitLog.ts';

const KEY_PREFIX: string = 'exam_cache_v1_';
const KEY_LAST_TERM: string = 'exam_last_term';

/** 缓存内容（原始事实，不带派生字段）。 */
export interface CachedExams {
  term: string;
  fetchedAt: number;
  exams: ExamRow[];
}

export class ExamCache {
  /** 取数成功后写入（ExamPage / 排期器共用）。 */
  static async save(term: string, exams: ExamRow[]): Promise<void> {
    if (term.length === 0) {
      return;
    }
    const data: CachedExams = { term: term, fetchedAt: Date.now(), exams: exams };
    try {
      await Prefs.putString(KEY_PREFIX + term, JSON.stringify(data as Object));
      await Prefs.putString(KEY_LAST_TERM, term);
    } catch (e) {
      warn('ExamCache save fail: ' + JSON.stringify(e));
    }
  }

  /** 读指定 term 的考试缓存；没有/损坏返回 null（不抛）。 */
  static async load(term: string): Promise<CachedExams | null> {
    if (term.length === 0) {
      return null;
    }
    try {
      const raw: string = await Prefs.getString(KEY_PREFIX + term, '');
      if (raw.length === 0) {
        return null;
      }
      const parsed: CachedExams = JSON.parse(raw) as CachedExams;
      if (parsed === null || parsed.term !== term || !Array.isArray(parsed.exams)) {
        return null;
      }
      return parsed;
    } catch (e) {
      warn('ExamCache load fail: ' + JSON.stringify(e));
      return null;
    }
  }

  /** 读「上次查看的 term」的考试（排期器冷启动离线取数用）。 */
  static async loadLast(): Promise<CachedExams | null> {
    try {
      const term: string = await Prefs.getString(KEY_LAST_TERM, '');
      if (term.length === 0) {
        return null;
      }
      return await ExamCache.load(term);
    } catch (e) {
      warn('ExamCache loadLast fail: ' + JSON.stringify(e));
      return null;
    }
  }

  /** 全清（登出用：换账号不串上一个人的考试）。 */
  static async clearAll(): Promise<void> {
    try {
      await Prefs.remove(KEY_LAST_TERM);
      info('ExamCache cleared last-term key');
    } catch (e) {
      warn('ExamCache clearAll fail: ' + JSON.stringify(e));
    }
  }
}
