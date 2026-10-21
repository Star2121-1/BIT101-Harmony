/**
 * 延河课堂（eclass）会话 cookie 持久化。
 *
 * 与 SchoolCookieStore 的关系：**模式相同、罐不同**（JAR_ECLASS）。
 * 多这一份而不是复用，是因为 eclass 的会话来自 **Web 组件**
 * （WebCookieManager），比教务（纯 rcp 登录链）多一个「Web 存储」要管。
 *
 * ⚠️ 登出必须三处都清，少一处就是「显示已登出、其实还能用」：
 *   ① Prefs 里的快照  ② rcp 内存罐（CookieRepository 进程级单例）
 *   ③ **Web 组件的 cookie 存储**——不清它，下次 syncFromWeb 会把旧会话同步回来
 *   （2026-10-20 真机栽过同款：只清 Prefs，自习卡照样出数据）。
 */

import { JAR_ECLASS } from '../core/net/CookieJars.ts';
import { PersistedCookie, RcpFactory } from '../core/net/RcpFactory.ts';
import { rcp } from '@kit.RemoteCommunicationKit';
import { webview } from '@kit.ArkWeb';
import { Prefs } from './Prefs.ts';
import { info, warn } from '../core/log/BitLog.ts';

const KEY_COOKIES: string = 'eclass_cookies_v1';

export class EclassCookieStore {
  /** 保存一份 cookie 快照（同步成功后调）。 */
  static async save(cookies: PersistedCookie[]): Promise<void> {
    const json: string = JSON.stringify(cookies);
    await Prefs.putString(KEY_COOKIES, json);
    info('EclassCookieStore save count=' + cookies.length);
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
      warn('EclassCookieStore load corrupt: ' + JSON.stringify(e));
      return [];
    }
  }

  /** 直接从 rcp 罐里快照并落盘（同步流程末尾调一次，避免中间态）。 */
  static async snapshotAndSave(repo: rcp.CookieRepository): Promise<void> {
    const cookies: PersistedCookie[] = await RcpFactory.snapshotCookies(repo);
    await EclassCookieStore.save(cookies);
  }

  /** 把落盘的 cookie 灌回罐里（发起 eclass 请求前调）。返回灌入条数。 */
  static async restoreInto(repo: rcp.CookieRepository): Promise<number> {
    const cookies: PersistedCookie[] = await EclassCookieStore.load();
    if (cookies.length === 0) {
      return 0;
    }
    await RcpFactory.restoreCookies(repo, cookies);
    return cookies.length;
  }

  /**
   * 登出：清 Prefs + rcp 内存罐 + **Web 组件 cookie 存储**。
   *
   * ⚠️ Web 存储不清的后果不是「会话泄漏」而是「登了也白登」：
   * 下次 syncFromWeb 从 Web 抽到旧 cookie，灌回罐里，会话复活。
   */
  static async clear(): Promise<void> {
    await Prefs.remove(KEY_COOKIES);
    let killed: number = 0;
    killed += await RcpFactory.clearRepoCookies(JAR_ECLASS);
    try {
      await webview.WebCookieManager.clearAllCookies();
      info('EclassCookieStore cleared (prefs + jar killed=' + killed + ' + web store)');
    } catch (e) {
      // Web 存储清理失败不该阻塞登出主链（Prefs/罐已清），但必须留痕
      warn('EclassCookieStore clearAllCookies fail: ' + JSON.stringify(e));
    }
  }

  /** 有没有可用的 eclass 会话（判据 = 至少一条 cookie）。 */
  static async hasSession(): Promise<boolean> {
    const cookies: PersistedCookie[] = await EclassCookieStore.load();
    return cookies.length > 0;
  }
}
