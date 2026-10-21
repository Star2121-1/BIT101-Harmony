/**
 * 图书馆（mylib.bit.edu.cn）会话 cookie 持久化。
 *
 * 模式与 EclassCookieStore 相同、罐不同（JAR_LIB）。
 * 多一份而不是复用：图书馆会话同样来自 **Web 组件**（用户在 App 内 Web
 * 里走 CAS 登录 lib 门户），登出三处都要清（Prefs + rcp 罐 + Web 存储）。
 *
 * 契约：BIT101-seat/docs/lib-borrow-contract.md（2026-09-28 实测）。
 */

import { JAR_LIB } from '../core/net/CookieJars.ts';
import { PersistedCookie, RcpFactory } from '../core/net/RcpFactory.ts';
import { rcp } from '@kit.RemoteCommunicationKit';
import { webview } from '@kit.ArkWeb';
import { Prefs } from './Prefs.ts';
import { info, warn } from '../core/log/BitLog.ts';

const KEY_COOKIES: string = 'lib_cookies_v1';

export class LibCookieStore {
  /** 保存一份 cookie 快照（同步成功后调）。 */
  static async save(cookies: PersistedCookie[]): Promise<void> {
    const json: string = JSON.stringify(cookies);
    await Prefs.putString(KEY_COOKIES, json);
    info('LibCookieStore save count=' + cookies.length);
  }

  /** 读回 cookie 列表；没有或损坏返回空数组（不抛，调用方按「未登录」处理）。 */
  static async load(): Promise<PersistedCookie[]> {
    const json: string = await Prefs.getString(KEY_COOKIES, '');
    if (json.length === 0) {
      return [];
    }
    try {
      const parsed: PersistedCookie[] = JSON.parse(json) as PersistedCookie[];
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      warn('LibCookieStore load corrupt: ' + JSON.stringify(e));
      return [];
    }
  }

  /** 直接从 rcp 罐里快照并落盘（同步流程末尾调一次，避免中间态）。 */
  static async snapshotAndSave(repo: rcp.CookieRepository): Promise<void> {
    const cookies: PersistedCookie[] = await RcpFactory.snapshotCookies(repo);
    await LibCookieStore.save(cookies);
  }

  /** 把落盘的 cookie 灌回罐里（发起借阅请求前调）。返回灌入条数。 */
  static async restoreInto(repo: rcp.CookieRepository): Promise<number> {
    const cookies: PersistedCookie[] = await LibCookieStore.load();
    if (cookies.length === 0) {
      return 0;
    }
    await RcpFactory.restoreCookies(repo, cookies);
    return cookies.length;
  }

  /**
   * 登出：清 Prefs + rcp 内存罐 + **Web 组件 cookie 存储**。
   * 不清 Web 存储 ⇒ 下次 syncFromWeb 把旧会话抽回来，登了也白登（eclass 同款教训）。
   */
  static async clear(): Promise<void> {
    await Prefs.remove(KEY_COOKIES);
    let killed: number = 0;
    killed += await RcpFactory.clearRepoCookies(JAR_LIB);
    try {
      await webview.WebCookieManager.clearAllCookies();
      info('LibCookieStore cleared (prefs + jar killed=' + killed + ' + web store)');
    } catch (e) {
      warn('LibCookieStore clearAllCookies fail: ' + JSON.stringify(e));
    }
  }

  /** 有没有可用的图书馆会话（判据 = 至少一条 cookie）。 */
  static async hasSession(): Promise<boolean> {
    const cookies: PersistedCookie[] = await LibCookieStore.load();
    return cookies.length > 0;
  }
}
