/**
 * BIT101 社区票据（fake-cookie）持久化。
 *
 * 对照 Android `UserDataStore.fakeCookie`（Preferences DataStore 明文）——票据是会话令牌，
 * 泄露影响面小于学校密码，且 Android 现状就是明文存，这里同款。学校密码另走系统密钥库
 * （AutoLoginCredentialStore），两者分开。
 *
 * 只在用户本人 opt-in 登录后有值；登出/换账号时由 SessionStore.logoutAll 清。
 */

import { Prefs } from './Prefs.ts';
import { info } from '../core/log/BitLog.ts';

const KEY_FAKE_COOKIE: string = 'bit101_fake_cookie_v1';
const KEY_SAVED_AT: string = 'bit101_fake_cookie_saved_at';

export class FakeCookieStore {
  static async save(fakeCookie: string): Promise<void> {
    if (fakeCookie.length === 0) {
      throw new Error('fake-cookie 为空，不保存');
    }
    await Prefs.putString(KEY_FAKE_COOKIE, fakeCookie);
    await Prefs.putString(KEY_SAVED_AT, String(Date.now()));
    // 只记长度，不记票据内容（票据等价于登录态，不进日志）
    info('FakeCookieStore saved len=' + fakeCookie.length);
  }

  static async load(): Promise<string> {
    return await Prefs.getString(KEY_FAKE_COOKIE, '');
  }

  static async has(): Promise<boolean> {
    return (await Prefs.getString(KEY_FAKE_COOKIE, '')).length > 0;
  }

  static async clear(): Promise<void> {
    await Prefs.remove(KEY_FAKE_COOKIE);
    await Prefs.remove(KEY_SAVED_AT);
    info('FakeCookieStore cleared');
  }
}
