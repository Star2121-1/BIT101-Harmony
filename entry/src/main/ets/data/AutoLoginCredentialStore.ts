/**
 * 自动重登用的**学校统一身份认证凭据**（opt-in，默认不存）。
 *
 * ## 为什么单独一份（而不是复用 ScoreCredentialStore）
 * 两者存的其实是同一套学号+密码，但**语义与生命周期不同**：
 * - `ScoreCredentialStore` 是「查成绩」专用的，用户忘了它会连带清成绩缓存；
 * - 这里是「会话过期后自动续期」用的，跟着登录态走（登出即清）。
 * 混用会让「我在成绩页忘记密码」意外关掉自动续期，或反过来。独立 alias + 独立 key，
 * 互不牵连；登出时两边都要清（见 SessionStore.logoutAll）。
 *
 * ## 红线
 * - **默认不存**：用户不在登录页勾「记住密码以便自动续期」，这里永远是空的；
 * - opt-in 后密码落**系统密钥库**（AssetStoreKit，DEVICE_FIRST_UNLOCKED），不是明文偏好；
 * - 学号存普通偏好（不敏感，设置页打码展示）；
 * - 密码只经 `load()` 进入自动重登调用栈，绝不打印、不进 LoginOutcome.steps。
 *
 * ⚠️ 本类只负责存取，不做任何网络动作；失败如实抛错/返回 null，不静默降级成「没存过」
 *    掩盖密钥库故障（那会让用户以为开了 opt-in 其实没生效）。
 */

import { asset } from '@kit.AssetStoreKit';
import util from '@ohos.util';
import { Prefs } from './Prefs.ts';
import { info, warn, mask } from '../core/log/BitLog.ts';

/** 密码在密钥库里的别名（与成绩那份分开，互不影响）。 */
const ALIAS_PWD: string = 'bit101_autologin_pwd';
/** 学号存普通偏好。 */
const KEY_USER: string = 'autologin_cred_user';

export interface AutoLoginCredential {
  username: string;
  password: string;
}

function strToBytes(s: string): Uint8Array {
  return new util.TextEncoder().encodeInto(s);
}

function bytesToStr(b: Uint8Array): string {
  return util.TextDecoder.create('utf-8').decodeToString(b);
}

export class AutoLoginCredentialStore {
  /** 是否已经 opt-in 存了凭据（= 允许会话失效时自动重登）。 */
  static async has(): Promise<boolean> {
    return (await AutoLoginCredentialStore.load()) !== null;
  }

  /** 已保存的学号（设置页打码展示用；没存返回空串）。 */
  static async savedUsername(): Promise<string> {
    return await Prefs.getString(KEY_USER, '');
  }

  /**
   * 保存凭据（**仅登录页 opt-in 勾选时调**）。
   * 先删后加：密钥库同别名重复 add 会报冲突，删不存在的条目安全。
   */
  static async save(username: string, password: string): Promise<void> {
    const u: string = username.trim();
    if (u.length === 0 || password.length === 0) {
      throw new Error('学号与密码都不能为空');
    }
    await AutoLoginCredentialStore.removePassword();
    const attrs: asset.AssetMap = new Map<asset.Tag, asset.Value>();
    attrs.set(asset.Tag.SECRET, strToBytes(password));
    attrs.set(asset.Tag.ALIAS, strToBytes(ALIAS_PWD));
    attrs.set(asset.Tag.ACCESSIBILITY, asset.Accessibility.DEVICE_FIRST_UNLOCKED);
    try {
      await asset.add(attrs);
      // 学号先写：下面 add 失败要把学号回滚，避免「以为存了其实只存了一半」
      await Prefs.putString(KEY_USER, u);
      info('AutoLoginCredentialStore saved user=' + mask(u));
    } catch (e) {
      warn('AutoLoginCredentialStore save fail: ' + JSON.stringify(e));
      throw new Error('保存登录凭据失败（系统密钥库不可用）');
    }
  }

  /** 读凭据；任一半缺失返回 null（不猜）。 */
  static async load(): Promise<AutoLoginCredential | null> {
    const user: string = await Prefs.getString(KEY_USER, '');
    if (user.length === 0) {
      return null;
    }
    const pwd: string | null = await AutoLoginCredentialStore.readPassword();
    if (pwd === null || pwd.length === 0) {
      return null;
    }
    return { username: user, password: pwd };
  }

  /** 清除（「关闭自动续期」/ 退出登录时调）。 */
  static async clear(): Promise<void> {
    await AutoLoginCredentialStore.removePassword();
    await Prefs.remove(KEY_USER);
    info('AutoLoginCredentialStore cleared');
  }

  private static async readPassword(): Promise<string | null> {
    const query: asset.AssetMap = new Map<asset.Tag, asset.Value>();
    query.set(asset.Tag.ALIAS, strToBytes(ALIAS_PWD));
    query.set(asset.Tag.RETURN_TYPE, asset.ReturnType.ALL);
    try {
      const rows: Array<asset.AssetMap> = await asset.query(query);
      if (rows.length === 0) {
        return null;
      }
      const secret: asset.Value | undefined = rows[0].get(asset.Tag.SECRET);
      if (secret === undefined || typeof secret === 'boolean' || typeof secret === 'number') {
        return null;
      }
      return bytesToStr(secret as Uint8Array);
    } catch (e) {
      // 读不到最坏后果只是「需要手动登录」，不该让页面崩
      warn('AutoLoginCredentialStore query fail: ' + JSON.stringify(e));
      return null;
    }
  }

  private static async removePassword(): Promise<void> {
    const query: asset.AssetMap = new Map<asset.Tag, asset.Value>();
    query.set(asset.Tag.ALIAS, strToBytes(ALIAS_PWD));
    try {
      await asset.remove(query);
    } catch (e) {
      // 删不存在的条目报 NOT_FOUND，正常路径
      warn('AutoLoginCredentialStore remove fail (ignored): ' + JSON.stringify(e));
    }
  }
}
