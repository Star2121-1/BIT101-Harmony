/**
 * Preferences 封装（对照 Android DataStore / EncryptedPreferences）。
 *
 * 落盘位置：应用沙箱 EL2 级 preferences（只有本应用可读，卸载即清）。
 * ⚠️ 权衡（如实记录，不粉饰）：JWT / 学校会话 cookie **明文**存在沙箱里，
 * 与 Android 侧现状一致（DataStore 也是明文）。若日后要加固，换成
 * `@ohos.security.asset`（系统密钥库）是单点改动，调用方不用动。
 *
 * ⚠️ 初始化时序：EntryAbility.onCreate 里 `Prefs.init(appContext)`（不 await），
 * 之后所有读写都会 `await` 同一个 promise —— 页面不会抢在 init 完成前读。
 * （曾栽过：直接 require 立刻抛「未初始化」，页面白屏。）
 */

import { preferences } from '@kit.ArkData';
import { Context } from '@kit.AbilityKit';
import { error, warn } from '../core/log/BitLog.ts';

const STORE_NAME: string = 'bit101_prefs';

export class Prefs {
  private static store: preferences.Preferences | null = null;
  private static initPromise: Promise<void> | null = null;

  /** 初始化（幂等）。EntryAbility.onCreate 调一次。 */
  static init(context: Context): Promise<void> {
    if (Prefs.initPromise === null) {
      Prefs.initPromise = Prefs.doInit(context);
    }
    return Prefs.initPromise;
  }

  private static async doInit(context: Context): Promise<void> {
    try {
      Prefs.store = await preferences.getPreferences(context, STORE_NAME);
    } catch (e) {
      error('Prefs init failed: ' + JSON.stringify(e));
      throw new Error('本地存储初始化失败');
    }
  }

  private static async ready(): Promise<preferences.Preferences> {
    if (Prefs.initPromise === null) {
      throw new Error('Prefs 未初始化（需先 Prefs.init(context)）');
    }
    await Prefs.initPromise;
    const s: preferences.Preferences | null = Prefs.store;
    if (s === null) {
      throw new Error('本地存储不可用');
    }
    return s;
  }

  static async getString(key: string, fallback: string): Promise<string> {
    try {
      const s: preferences.Preferences = await Prefs.ready();
      const v: preferences.ValueType = await s.get(key, fallback);
      return typeof v === 'string' ? v as string : fallback;
    } catch (e) {
      warn('Prefs getString fail key=' + key + ': ' + JSON.stringify(e));
      return fallback;
    }
  }

  static async getBool(key: string, fallback: boolean): Promise<boolean> {
    try {
      const s: preferences.Preferences = await Prefs.ready();
      const v: preferences.ValueType = await s.get(key, fallback);
      return typeof v === 'boolean' ? v as boolean : fallback;
    } catch (e) {
      warn('Prefs getBool fail key=' + key + ': ' + JSON.stringify(e));
      return fallback;
    }
  }

  /** 写字符串并立即 flush（会话类数据不许"延迟落盘"，进程被杀就丢）。 */
  static async putString(key: string, value: string): Promise<void> {
    try {
      const s: preferences.Preferences = await Prefs.ready();
      await s.put(key, value);
      await s.flush();
    } catch (e) {
      error('Prefs putString fail key=' + key + ': ' + JSON.stringify(e));
      throw new Error('本地存储写入失败');
    }
  }

  static async remove(key: string): Promise<void> {
    try {
      const s: preferences.Preferences = await Prefs.ready();
      await s.delete(key);
      await s.flush();
    } catch (e) {
      warn('Prefs remove fail key=' + key + ': ' + JSON.stringify(e));
    }
  }
}
