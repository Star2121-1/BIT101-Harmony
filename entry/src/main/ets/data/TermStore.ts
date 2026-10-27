/**
 * 学期偏好（全局唯一来源）。
 *
 * 为什么要这一层（对照原版）：原版在 **设置 → 日历设置** 里切学期
 * （`CalendarSettingPage.kt` 的 `TermListDialog` → `setCurrentTerm`），课表页本身
 * **没有**学期选择器。我们之前把学期做成课表页里的一排 chip，和原版结构对不上；
 * 要删那排 chip，就得先把「切学期」搬到设置页 —— 搬到设置页就必须有地方存，
 * 否则一重启又回到教务默认学期。
 *
 * 语义（三条都要能被证伪）：
 * - **空字符串 = 跟随教务**（不覆盖）。`SchoolService.getCurrentTerm` 先问这里，
 *   空才去请求服务端；
 * - 所有取「当前学期」的地方（课表 / 空教室 / 考试 / 自习点）都走同一个
 *   `SchoolService.getCurrentTerm`，不各自读偏好 —— 否则四页能显示四个学期；
 * - 改了要立刻让在屏的课表重算：`AppStorage['ui_term_override']` 变化由
 *   `SchedulePage` 的 `@StorageLink + @Watch` 接住（壳里是 Stack 保活，
 *   `aboutToAppear` 不会再跑）。
 *
 * ⚠️ 不校验学期字符串合法性：教务给的历史学期就长 `2025-2026-2`，脏值只可能来自
 *   手改偏好，届时请求会失败并在页面上如实报错，不静默改成别的学期。
 */

import { Context } from '@kit.AbilityKit';
import { Prefs } from './Prefs.ts';
import { info, warn } from '../core/log/BitLog.ts';
import { splitTermsByRecentYears, TermSplit } from './termUtil.ts';

export { splitTermsByRecentYears, TermSplit } from './termUtil.ts';

/** AppStorage 键：学期覆盖值（'' = 跟随教务）。页面用 @StorageLink 订阅它。 */
export const STORAGE_TERM: string = 'ui_term_override';

/** 持久化键：学期覆盖值。 */
const KEY_TERM: string = 'ui_term_override';

/** 是否覆盖教务的当前学期（非空即覆盖）。 */
export function isTermOverride(value: string): boolean {
  return value.length > 0;
}

export class TermStore {
  /** 冷启动读回上次选的学期并灌进 AppStorage（EntryAbility 里排在 Prefs 之后）。 */
  static async init(context: Context): Promise<void> {
    let term: string = '';
    try {
      term = await Prefs.getString(KEY_TERM, '');
    } catch (e) {
      warn('TermStore read fail: ' + JSON.stringify(e));
    }
    AppStorage.setOrCreate<string>(STORAGE_TERM, term);
    info('TermStore init override=' + (term.length > 0 ? term : '(follow)'));
  }

  /** 当前覆盖值（'' = 跟随教务）。直接从 AppStorage 取，避免每处都 await 一次磁盘。 */
  static current(): string {
    const v: string | undefined = AppStorage.get<string>(STORAGE_TERM);
    return v === undefined ? '' : v;
  }

  /** 持久化的覆盖值（给 SchoolService 用；AppStorage 可能还没初始化）。 */
  static async load(context: Context): Promise<string> {
    try {
      return await Prefs.getString(KEY_TERM, '');
    } catch (e) {
      warn('TermStore load fail: ' + JSON.stringify(e));
      return '';
    }
  }

  /**
   * 设置覆盖值；`''` = 恢复跟随教务。
   * 先落盘再改 AppStorage：写失败就让页面停在旧学期，不出现「看起来切了、重启又回去」。
   */
  static async set(context: Context, term: string): Promise<void> {
    if (term.length === 0) {
      await Prefs.remove(KEY_TERM);
    } else {
      await Prefs.putString(KEY_TERM, term);
    }
    AppStorage.setOrCreate<string>(STORAGE_TERM, term);
    info('TermStore set override=' + (term.length > 0 ? term : '(follow)'));
  }
}
