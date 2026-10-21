/**
 * 一卡通会话 cookie 持久化（对照 Android `LoginStatus.cookieManager` + WebViewCookieSync）。
 *
 * 与 EclassCookieStore/LibCookieStore：**模式相同、罐不同**（JAR_CARD）。
 * 一卡通登录同样在 App 内 Web 完成（CAS 链），所以也有「Web 存储」这一处要管。
 *
 * ⚠️ 登出三处都要清（Prefs 快照 / rcp 内存罐 / Web 组件存储），
 * 少一处就是「显示已登出、接口照样能取数」。
 */

import { JAR_CARD } from '../core/net/CookieJars.ts';
import { PersistedCookie, RcpFactory } from '../core/net/RcpFactory.ts';
import { rcp } from '@kit.RemoteCommunicationKit';
import { webview } from '@kit.ArkWeb';
import { Prefs } from './Prefs.ts';
import { info, warn } from '../core/log/BitLog.ts';

const KEY_COOKIES: string = 'card_cookies_v1';

export class CardCookieStore {
  /** 保存一份 cookie 快照（同步成功后调）。 */
  static async save(cookies: PersistedCookie[]): Promise<void> {
    const json: string = JSON.stringify(cookies);
    await Prefs.putString(KEY_COOKIES, json);
    info('CardCookieStore save count=' + cookies.length);
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
      warn('CardCookieStore load corrupt: ' + JSON.stringify(e));
      return [];
    }
  }

  /** 直接从 rcp 罐里快照并落盘（同步流程末尾调一次，避免中间态）。 */
  static async snapshotAndSave(repo: rcp.CookieRepository): Promise<void> {
    const cookies: PersistedCookie[] = await RcpFactory.snapshotCookies(repo);
    await CardCookieStore.save(cookies);
  }

  /** 把落盘的 cookie 灌回罐里（发起一卡通请求前调）。 */
  static async restoreInto(repo: rcp.CookieRepository): Promise<number> {
    const cookies: PersistedCookie[] = await CardCookieStore.load();
    if (cookies.length === 0) {
      return 0;
    }
    await RcpFactory.restoreCookies(repo, cookies);
    return cookies.length;
  }

  /**
   * 登出：清 Prefs + rcp 内存罐 + **Web 组件 cookie 存储**。
   *
   * ⚠️ 不清 Web 存储的后果是「登了也白登」：下次 syncFromWeb 从 Web 抽到旧
   * cookie 灌回罐里，会话复活（2026-10-20 自习卡同款事故）。
   */
  static async clear(): Promise<void> {
    await Prefs.remove(KEY_COOKIES);
    let killed: number = 0;
    killed += await RcpFactory.clearRepoCookies(JAR_CARD);
    try {
      await webview.WebCookieManager.clearAllCookies();
      info('CardCookieStore cleared (prefs + jar killed=' + killed + ' + web store)');
    } catch (e) {
      // Web 存储清理失败不该阻塞登出主链（Prefs/罐已清），但必须留痕
      warn('CardCookieStore clearAllCookies fail: ' + JSON.stringify(e));
    }
  }

  /** 有没有可用的一卡通会话（判据 = 至少一条 cookie）。 */
  static async hasSession(): Promise<boolean> {
    const cookies: PersistedCookie[] = await CardCookieStore.load();
    return cookies.length > 0;
  }
}
