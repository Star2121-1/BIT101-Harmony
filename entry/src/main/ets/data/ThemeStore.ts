/**
 * 深浅色 + 配色方案（palette）状态（全局唯一来源）
 *
 * 两条轴，互不干涉：
 * - 深浅三档模式：`auto`（跟随系统）/ `light` / `dark`；
 * - palette 三选一：`brand` / `classic` / `warm`（默认 warm）。
 *
 * 页面不自己判断，统一订阅 `AppStorage`：
 *
 *   @StorageLink('ui_dark') isDark: boolean = false;
 *   @StorageLink('ui_palette') paletteName: string = 'warm';
 *   .backgroundColor(gridTokens(this.isDark, ThemeStore.getPalette(this.paletteName)).surface)
 *
 * ⚠️ 为什么不用 `resources/dark/element/color.json` 那套自动换肤：
 * 本工程的颜色是**语义化 + 有对比度判据**的（见 `core/theme/AppColors.ts`），
 * 走资源文件就没法在单测里算对比度。宁可自己管一份，换来的是一条能红的测试。
 *
 * ⚠️ palette 名 = Android `AppPalette.value` 冻结契约（brand/classic/warm），
 * 展示名映射反直觉（brand=「BIT101经典配色」/classic=「暖棕配色」/warm=「清新青绿配色」，
 * 见 GridTokens.ts 文件头）；脏值回落**显式默认 warm**，不用 first()（会把脏值变 brand）。
 */

import { Context } from '@kit.AbilityKit';
import { resourceManager } from '@kit.LocalizationKit';
import { Prefs } from './Prefs.ts';
import { info, warn } from '../core/log/BitLog.ts';
import { getPaletteName } from '../core/theme/GridTokens.ts';
import type { PaletteName } from '../core/theme/GridTokens.ts';

/** AppStorage 键：当前是否深色（页面用 @StorageLink 订阅它）。 */
export const STORAGE_DARK: string = 'ui_dark';

/** AppStorage 键：当前 palette 名（页面用 @StorageLink 订阅它）。 */
export const STORAGE_PALETTE: string = 'ui_palette';

/** 持久化键：深浅模式。 */
const KEY_MODE: string = 'ui_theme_mode';

/** 持久化键：palette。 */
const KEY_PALETTE: string = 'ui_theme_palette';

export const MODE_AUTO: string = 'auto';
export const MODE_LIGHT: string = 'light';
export const MODE_DARK: string = 'dark';

/** palette 常量（= 冻结 datastore 值；展示名映射见 GridTokens.ts）。 */
export const PALETTE_BRAND: PaletteName = 'brand';
export const PALETTE_CLASSIC: PaletteName = 'classic';
export const PALETTE_WARM: PaletteName = 'warm';

/**
 * 把任意字符串收敛成合法 palette；**脏值回落显式默认 warm**
 * （薄封装：实现在 GridTokens.getPaletteName，收敛规则全工程唯一）。
 */
export function getPalette(value: string): PaletteName {
  return getPaletteName(value);
}

export class ThemeStore {
  /** 当前模式（'auto' | 'light' | 'dark'）。进程内唯一。 */
  private static currentMode: string = MODE_AUTO;
  /** 当前 palette。进程内唯一。 */
  private static currentPalette: PaletteName = PALETTE_WARM;

  /** 启动时调一次：读回上次选择 + 计算并广播深浅/palette。 */
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
    let paletteRaw: string = PALETTE_WARM;
    try {
      paletteRaw = await Prefs.getString(KEY_PALETTE, PALETTE_WARM);
    } catch (e) {
      warn('ThemeStore read palette fail: ' + JSON.stringify(e));
    }
    ThemeStore.currentPalette = getPalette(paletteRaw);
    ThemeStore.apply(context);
  }

  static mode(): string {
    return ThemeStore.currentMode;
  }

  /** 当前 palette 名（已收敛）。 */
  static palette(): PaletteName {
    return ThemeStore.currentPalette;
  }

  /** 用户在设置页切换深浅。 */
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

  /** 用户在设置页切换配色；非法值直接拒收（不猜用户意图）。 */
  static async setPalette(context: Context, palette: PaletteName): Promise<void> {
    if (palette !== PALETTE_BRAND && palette !== PALETTE_CLASSIC && palette !== PALETTE_WARM) {
      return;
    }
    ThemeStore.currentPalette = palette;
    try {
      await Prefs.putString(KEY_PALETTE, palette);
    } catch (e) {
      warn('ThemeStore save palette fail: ' + JSON.stringify(e));
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
    AppStorage.setOrCreate<string>(STORAGE_PALETTE, ThemeStore.currentPalette);
    info('theme mode=' + ThemeStore.currentMode + ' dark=' + (dark ? 'yes' : 'no') +
      ' palette=' + ThemeStore.currentPalette);
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
