/**
 * 成绩查询用的**学校统一身份认证凭据**（M10-2）。
 *
 * ## 为什么必须有它
 * 成绩取数走 BIT101 认证主机的异步挑战流程，**每一步都要账密**（`/api/jwb/bit101/score`
 * 的 body 就是 username+password）。而本工程一直坚持「密码只活在登录调用栈里、不落盘」
 * —— 两者冲突，取舍如下：
 *
 *  - **默认不保存**：不开启就只在**本次会话内存**里用，杀进程即忘（成绩页临时输入）；
 *  - **显式开启才保存**：用户勾「记住密码以便自动检查出分」后才落盘，
 *    且落在**系统密钥库**（`@kit.AssetStoreKit`，`DEVICE_FIRST_UNLOCKED`：首次解锁后可读，
 *    设备未解锁时读不到），不是明文偏好。
 *  - 学号不敏感，存普通偏好；密码只走密钥库。
 *
 * ## 为什么不写进 `Prefs` 明文
 * `Prefs` 是 EL2 沙箱明文（JWT/cookie 已经这么存了，见该类注释）。密码与那些不同：
 * 它是**学校统一身份认证的凭据**，泄露影响面远大于一次会话 token，所以单独走密钥库。
 *
 * ⚠️ 本类只负责存取，不做任何网络动作；失败一律如实抛错，不静默降级。
 */

import { asset } from '@kit.AssetStoreKit';
import util from '@ohos.util';
import { Prefs } from './Prefs.ts';
import { info, warn } from '../core/log/BitLog.ts';

/** 密码在密钥库里的别名（同一应用内唯一）。 */
const ALIAS_PWD: string = 'bit101_score_pwd';
/** 学号存普通偏好（不敏感，且要在设置页做打码展示）。 */
const KEY_USER: string = 'score_cred_user';

/** 一组凭据。 */
export interface ScoreCredential {
  username: string;
  password: string;
}

function strToBytes(s: string): Uint8Array {
  const enc: util.TextEncoder = new util.TextEncoder();
  return enc.encodeInto(s);
}

function bytesToStr(b: Uint8Array): string {
  const dec: util.TextDecoder = util.TextDecoder.create('utf-8');
  return dec.decodeToString(b);
}

export class ScoreCredentialStore {
  /** 是否已保存密码（= 可以走后台自动检查）。 */
  static async has(): Promise<boolean> {
    const user: string = await Prefs.getString(KEY_USER, '');
    if (user.length === 0) {
      return false;
    }
    return (await ScoreCredentialStore.readPassword()) !== null;
  }

  /** 已保存的学号（没保存返回空串；设置页打码展示用）。 */
  static async savedUsername(): Promise<string> {
    return Prefs.getString(KEY_USER, '');
  }

  /**
   * 保存凭据（**用户显式开启时**才调）。
   * 先删后加：密钥库同别名重复 add 会报冲突，删除不存在的条目则安全。
   */
  static async save(username: string, password: string): Promise<void> {
    const u: string = username.trim();
    if (u.length === 0 || password.length === 0) {
      throw new Error('学号与密码都不能为空');
    }
    await Prefs.putString(KEY_USER, u);
    await ScoreCredentialStore.removePassword();
    const attrs: asset.AssetMap = new Map<asset.Tag, asset.Value>();
    attrs.set(asset.Tag.SECRET, strToBytes(password));
    attrs.set(asset.Tag.ALIAS, strToBytes(ALIAS_PWD));
    // 首次解锁后可读：自动检查发生在「App 启动/进页面」，那时设备必然已解锁
    attrs.set(asset.Tag.ACCESSIBILITY, asset.Accessibility.DEVICE_FIRST_UNLOCKED);
    try {
      await asset.add(attrs);
      info('ScoreCredentialStore saved user=' + u);
    } catch (e) {
      // 学号已经写进去了但密码没写成功 → 回滚学号，避免「以为保存了其实没有」
      await Prefs.remove(KEY_USER);
      warn('ScoreCredentialStore save fail: ' + JSON.stringify(e));
      throw new Error('保存密码失败（系统密钥库不可用）');
    }
  }

  /** 读凭据；任一半缺失返回 null（不猜）。 */
  static async load(): Promise<ScoreCredential | null> {
    const user: string = await Prefs.getString(KEY_USER, '');
    if (user.length === 0) {
      return null;
    }
    const pwd: string | null = await ScoreCredentialStore.readPassword();
    if (pwd === null || pwd.length === 0) {
      return null;
    }
    return { username: user, password: pwd };
  }

  /** 清除（设置页「忘记密码」/ 退出登录时调）。 */
  static async clear(): Promise<void> {
    await ScoreCredentialStore.removePassword();
    await Prefs.remove(KEY_USER);
    info('ScoreCredentialStore cleared');
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
      if (secret === undefined) {
        return null;
      }
      if (typeof secret === 'boolean' || typeof secret === 'number') {
        return null;
      }
      return bytesToStr(secret as Uint8Array);
    } catch (e) {
      // NOT_FOUND 是正常路径（还没存过），其余错误也按「读不到」处理 ——
      // 凭据读不到的最坏后果只是需要用户重新输入，不该让页面崩
      warn('ScoreCredentialStore query fail: ' + JSON.stringify(e));
      return null;
    }
  }

  private static async removePassword(): Promise<void> {
    const query: asset.AssetMap = new Map<asset.Tag, asset.Value>();
    query.set(asset.Tag.ALIAS, strToBytes(ALIAS_PWD));
    try {
      await asset.remove(query);
    } catch (e) {
      // 删不存在的条目会报 NOT_FOUND，属正常路径
      warn('ScoreCredentialStore remove fail (ignored): ' + JSON.stringify(e));
    }
  }
}
