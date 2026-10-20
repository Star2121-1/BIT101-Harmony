/**
 * 深浅色状态（全局唯一来源）
 *
 * 三档模式：`auto`（跟随系统）/ `light` / `dark`。
 * 页面不自己判断深浅，统一订阅 `AppStorage` 里的 `ui_dark`：
 *
 *   @StorageLink('ui_dark') isDark: boolean = false;
 *   .backgroundColor(palette(this.isDark).bgPage)
 *
 * ⚠️ 为什么不用 `resources/dark/element/color.json` 那套自动换肤：
 * 本工程的颜色是**语义化 + 有对比度判据**的（见 `core/theme/AppColors.ts`），
 * 走资源文件就没法在单测里算对比度。宁可自己管一份，换来的是一条能红的测试。
 */

import { Context } from '@kit.AbilityKit';
import { resourceManager } from '@kit.LocalizationKit';
import { Prefs } from './Prefs.ts';
import { info, warn } from '../core/log/BitLog.ts';

/** AppStorage 键：当前是否深色（页面用 @StorageLink 订阅它）。 */
export const STORAGE_DARK: string = 'ui_dark';

/** 持久化键：模式。 */
const KEY_MODE: string = 'ui_theme_mode';

export const MODE_AUTO: string = 'auto';
export const MODE_LIGHT: string = 'light';
export const MODE_DARK: string = 'dark';

export class ThemeStore {
  /** 当前模式（'auto' | 'light' | 'dark'）。进程内唯一。 */
  private static currentMode: string = MODE_AUTO;

  /** 启动时调一次：读回上次选择 + 计算并广播深浅。 */
  static async init(context: Context): Promise<void> {
    let mode: string = MODE_AUTO;
    try {
      mode = await Prefs.getString(KEY_MODE, MODE_AUTO);
    } catch (e) {
      warn('ThemeStore read fail: ' + JSON.stringify(e));
    }
    // 存了非法值就退回 auto（不猜用户意图）
    if (mode !== MODE_AUTO && mode !== MODE_LIGHT && mode !== MODE_DARK) {
      mode = MODE_AUTO;
    }
    ThemeStore.currentMode = mode;
    ThemeStore.apply(context);
  }

  static mode(): string {
    return ThemeStore.currentMode;
  }

  /** 用户在设置页切换。 */
  static async setMode(context: Context, mode: string): Promise<void> {
    if (mode !== MODE_AUTO && mode !== MODE_LIGHT && mode !== MODE_DARK) {
      return;
    }
    ThemeStore.currentMode = mode;
    try {
      await Prefs.putString(KEY_MODE, mode);
    } catch (e) {
      warn('ThemeStore save fail: ' + JSON.stringify(e));
    }
    ThemeStore.apply(context);
  }

  /** 系统深浅色变化时（EntryAbility.onConfigurationUpdate）调。 */
  static onSystemChange(context: Context): void {
    if (ThemeStore.currentMode === MODE_AUTO) {
      ThemeStore.apply(context);
    }
  }

  private static apply(context: Context): void {
    let dark: boolean = false;
    if (ThemeStore.currentMode === MODE_DARK) {
      dark = true;
    } else if (ThemeStore.currentMode === MODE_LIGHT) {
      dark = false;
    } else {
      dark = ThemeStore.systemIsDark(context);
    }
    AppStorage.setOrCreate<boolean>(STORAGE_DARK, dark);
    info('theme mode=' + ThemeStore.currentMode + ' dark=' + (dark ? 'yes' : 'no'));
  }

  /**
   * 系统当前是否深色。取不到就当浅色（宁可亮着，也别给用户一块黑屏）。
   *
   * ⚠️ 两个坑都踩过：
   * 1. 不能用 `context.config` —— 那是 `UIAbilityContext` 的成员，基类 `Context` 没有（10505001）
   * 2. 不能用 `ConfigurationConstant.ColorMode` 去比 —— `getConfigurationSync()` 返回的是
   *    `resourceManager.ColorMode`，**两个不同枚举**即使值相同也不能比较（编译期报无重叠）。
   */
  private static systemIsDark(context: Context): boolean {
    try {
      const cfg = context.resourceManager.getConfigurationSync();
      return cfg.colorMode === resourceManager.ColorMode.DARK;
    } catch (e) {
      return false;
    }
  }
}
