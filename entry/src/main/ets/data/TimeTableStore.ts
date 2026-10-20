/**
 * 作息表存储（M6-2：时间表自定义）
 *
 * 学校作息不是永远不变（冬令时/夏令时、教学周调整），也不一定每个校区一样。
 * 所以允许用户覆盖那 13 节的开始/结束时刻，默认用学校官方表（`FALLBACK_TIME_TABLE`）。
 *
 * ## 只存「原始事实」
 * 存的是每节的 `startMinutes` / `endMinutes`（当天分钟数），**不存**任何格式化后的
 * "08:00-08:45" 字符串 —— 那是派生结果，时区/语言一变就得重算（铁律 0.8）。
 *
 * ## 校验
 * 读回来必须做完整性检查：13 项、每项 start < end、节次递增。
 * 任何一项不满足就**整表退回默认**，不修补 —— 半对的作息表会算出错误的「现在上什么课」。
 */

import { Prefs } from './Prefs.ts';
import { validateTimeTable, makeDefaultTable } from '../corelogic/TimeTableRules.ts';
import { FALLBACK_TIME_TABLE } from '../corelogic/TimeTableLogic.ts';
import type { TimeTable, TimeTableItem } from '../corelogic/timeutil.ts';
import { info, warn } from '../core/log/BitLog.ts';

const KEY: string = 'timetable_custom_v1';

/** 节数上限（与 FALLBACK_TIME_TABLE 一致）。 */
export const SECTION_COUNT: number = 13;

/** 缓存（避免每次取都读盘；写入时同步更新）。 */
let cached: TimeTable | null = null;

export { validateTimeTable as validate } from '../corelogic/TimeTableRules.ts';

export class TimeTableStore {
  /** 当前作息。没有自定义（或自定义非法）时返回学校官方表。 */
  static async load(): Promise<TimeTable> {
    if (cached !== null) {
      return cached;
    }
    try {
      const raw: string = await Prefs.getString(KEY, '');
      if (raw.length === 0) {
        cached = FALLBACK_TIME_TABLE;
        return cached;
      }
      const parsed: TimeTable = TimeTableStore.parse(raw);
      const bad: string = validateTimeTable(parsed);
      if (bad.length > 0) {
        warn('TimeTableStore 自定义作息非法（' + bad + '），退回默认');
        cached = FALLBACK_TIME_TABLE;
        return cached;
      }
      cached = parsed;
      info('TimeTableStore 使用自定义作息');
      return cached;
    } catch (e) {
      warn('TimeTableStore load fail: ' + JSON.stringify(e));
      cached = FALLBACK_TIME_TABLE;
      return cached;
    }
  }

  /** 是否在用自定义作息（设置页用来显示状态）。 */
  static async isCustom(): Promise<boolean> {
    const t: TimeTable = await TimeTableStore.load();
    return t !== FALLBACK_TIME_TABLE;
  }

  /** 保存自定义作息。非法时**不写**并返回原因。 */
  static async save(table: TimeTable): Promise<string> {
    const bad: string = validateTimeTable(table);
    if (bad.length > 0) {
      return bad;
    }
    try {
      const flat: Record<string, number>[] = [];
      for (let i = 0; i < table.length; i++) {
        flat.push({ 's': table[i].startMinutes, 'e': table[i].endMinutes });
      }
      await Prefs.putString(KEY, JSON.stringify(flat));
      cached = table;
      info('TimeTableStore saved');
      return '';
    } catch (e) {
      warn('TimeTableStore save fail: ' + JSON.stringify(e));
      return '保存失败：' + (e as Error).message;
    }
  }

  /** 恢复学校官方作息。 */
  static async reset(): Promise<void> {
    try {
      await Prefs.remove(KEY);
    } catch (e) {
      warn('TimeTableStore reset fail: ' + JSON.stringify(e));
    }
    cached = FALLBACK_TIME_TABLE;
    info('TimeTableStore reset to fallback');
  }

  /** 深拷贝一份默认表（编辑页要改它，绝不能改到共享常量）。 */
  static defaultTable(): TimeTable {
    return makeDefaultTable();
  }

  /** JSON → TimeTable。字段缺失当作非法（由 validate 兜住）。 */
  private static parse(raw: string): TimeTable {
    const arr: Object[] = JSON.parse(raw) as Object[];
    const out: TimeTableItem[] = [];
    for (let i = 0; i < arr.length; i++) {
      const rec: Record<string, Object> = arr[i] as Record<string, Object>;
      const s: number = typeof rec['s'] === 'number' ? rec['s'] as number : -1;
      const e: number = typeof rec['e'] === 'number' ? rec['e'] as number : -1;
      out.push({ startMinutes: s, endMinutes: e });
    }
    return out;
  }
}
