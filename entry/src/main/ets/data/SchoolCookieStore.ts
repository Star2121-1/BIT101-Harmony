/**
 * 学校会话 cookie 持久化（对照 Android `data/net/SchoolCookieStore.kt`）。
 *
 * 为什么要落盘：教务（jxzxehall）接口认的是 **cookie 会话**（不是 JWT）。
 * App 重启后若不恢复 cookie，用户每次都要重新过 CAS —— 而 CAS 会触发学校短信风控。
 *
 * 只存 cookie 本身（name/value/domain/path），不存任何密码。
 */

import { PersistedCookie, RcpFactory } from '../core/net/RcpFactory.ts';
import { rcp } from '@kit.RemoteCommunicationKit';
import { Prefs } from './Prefs.ts';
import { info, warn } from '../core/log/BitLog.ts';

const KEY_COOKIES: string = 'school_cookies_v1';

export class SchoolCookieStore {
  /** 保存一份 cookie 快照（登录成功后调）。 */
  static async save(cookies: PersistedCookie[]): Promise<void> {
    const json: string = JSON.stringify(cookies);
    await Prefs.putString(KEY_COOKIES, json);
    info('SchoolCookieStore save count=' + cookies.length);
  }

  /** 读回 cookie 列表；没有或损坏返回空数组（不抛，调用方按"未登录"处理）。 */
  static async load(): Promise<PersistedCookie[]> {
    const json: string = await Prefs.getString(KEY_COOKIES, '');
    if (json.length === 0) {
      return [];
    }
    try {
      const parsed: PersistedCookie[] = JSON.parse(json) as PersistedCookie[];
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      warn('SchoolCookieStore load corrupt: ' + JSON.stringify(e));
      return [];
    }
  }

  /** 直接从 rcp 罐里快照并落盘（登录流程末尾调一次，避免中间态）。 */
  static async snapshotAndSave(repo: rcp.CookieRepository): Promise<void> {
    const cookies: PersistedCookie[] = await RcpFactory.snapshotCookies(repo);
    await SchoolCookieStore.save(cookies);
  }

  /** 把落盘的 cookie 灌回指定罐（发起教务请求前调）。返回灌入条数。 */
  static async restoreInto(repo: rcp.CookieRepository): Promise<number> {
    const cookies: PersistedCookie[] = await SchoolCookieStore.load();
    if (cookies.length === 0) {
      return 0;
    }
    await RcpFactory.restoreCookies(repo, cookies);
    return cookies.length;
  }

  static async clear(): Promise<void> {
    await Prefs.remove(KEY_COOKIES);
    info('SchoolCookieStore cleared');
  }

  /** 有没有可用的学校会话（判据 = 至少一条 cookie；空列表 = 没登录过）。 */
  static async hasSession(): Promise<boolean> {
    const cookies: PersistedCookie[] = await SchoolCookieStore.load();
    return cookies.length > 0;
  }
}
