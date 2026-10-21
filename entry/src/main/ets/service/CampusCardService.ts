/**
 * 一卡通首页抓取服务（M5-1）。
 *
 * 1:1 对照 Android：data/.../repo/DefaultCampusCardRepo.kt。
 *
 * ## 会话
 *
 * 与 eclass / 图书馆相同：用户在 App 内 Web 走一次 CAS 登录一卡通首页，
 * cookie 落在 `dkykt.info.bit.edu.cn` 域；每次抓取前先把 Web 的 cookie
 * 同步进 JAR_CARD。
 *
 * ## ⚠️ autoRedirect=true（与 eclass/lib 的 false 不同，有意为之）
 *
 * 首页是 CAS service：未登录时 302 去 sso，登录后直接 200。
 * 必须跟完重定向链，再看**最终 URL 的主机**判登录态 ——
 * 与 Android OkHttp（默认跟跳）的 `resp.request.url` 判据同构。
 * rcp 侧对应字段是 `resp.effectiveUrl`（RcpFactory.getText 已透传为 finalUrl）。
 *
 * ## 失败判据（可证伪，Android 原注释）
 * 请求失败**不能**当成「未登录」：那会让 UI 说「点开登录」（用户明明登录过），
 * 真正该说的是「获取失败，重试」⇒ `failed: true` 单独一路。
 */

import { JAR_CARD } from '../core/net/CookieJars.ts';
import { rcp } from '@kit.RemoteCommunicationKit';
import { Context } from '@kit.AbilityKit';
import { RcpFactory, PersistedCookie } from '../core/net/RcpFactory.ts';
import { webview } from '@kit.ArkWeb';
import { CardCookieStore } from '../data/CardCookieStore.ts';
import { CardSnapshot, HOME_URL, parse } from '../corelogic/CampusCardLogic.ts';
import { info, warn } from '../core/log/BitLog.ts';

/** 与教务/eclass/图书馆同一张 Chrome UA（WAF 认客户端一致性）。 */
const CARD_UA: string =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36';

export class CampusCardService {
  /**
   * 抓一次首页快照。
   *
   * 顺序（Android 原序，别调换）：同步 Web cookie → GET 首页 → 按最终 URL 解析。
   */
  static async fetchSnapshot(context: Context): Promise<CardSnapshot> {
    await CampusCardService.syncFromWeb();
    try {
      const s: rcp.Session = await CampusCardService.session(context);
      const res = await RcpFactory.getText(s, HOME_URL, {
        'Accept': 'text/html,application/xhtml+xml',
        'User-Agent': CARD_UA
      });
      const snap: CardSnapshot = parse(res.body, res.finalUrl);
      info('card snapshot ok finalUrl=' + res.finalUrl +
        ' loggedIn=' + snap.loggedIn + ' entries=' + snap.entries.length);
      return snap;
    } catch (e) {
      const msg: string = (e as Error).message;
      warn('card fetchSnapshot fail: ' + msg);
      // 请求失败 ≠ 未登录：单独一路，UI 说「重试」
      return { entries: [], htmlSnippet: '', loggedIn: false, failed: true };
    }
  }

  /**
   * 从 Web 组件抽 cookie，灌进 JAR_CARD 并落盘。
   *
   * 只抽 HOME_URL 所在主机（dkykt.info.bit.edu.cn）—— 与 Android
   * `WebViewCookieSync.sync(jar, listOf(HOME_URL))` 同名单：数据就在这个主机上。
   *
   * @returns 灌入的 cookie 条数（0 = Web 里没有一卡通会话，用户还没登录）
   */
  static async syncFromWeb(): Promise<number> {
    const domain: string = 'dkykt.info.bit.edu.cn';
    const cookies: PersistedCookie[] = [];
    const seen: Set<string> = new Set<string>();
    let raw: string = '';
    try {
      raw = await webview.WebCookieManager.fetchCookie(HOME_URL);
    } catch (e) {
      // 该 URL 没有 cookie（未登录）——正常分支不是错误
      warn('card fetchCookie none: ' + JSON.stringify(e));
      return 0;
    }
    if (raw.length > 0) {
      const parts: string[] = raw.split(';');
      for (let j = 0; j < parts.length; j++) {
        const p: string = parts[j].trim();
        if (p.length === 0) {
          continue;
        }
        const eq: number = p.indexOf('=');
        if (eq <= 0) {
          continue; // 没有 '=' 或名字为空——不是 cookie，跳过
        }
        const name: string = p.substring(0, eq).trim();
        if (seen.has(name)) {
          continue; // 同名后写覆盖先写，保留第一个即可（顺序固定，行为确定）
        }
        seen.add(name);
        cookies.push({
          name: name,
          value: p.substring(eq + 1).trim(),
          domain: domain,
          path: '/'
        });
      }
    }
    if (cookies.length === 0) {
      return 0;
    }
    const repo: rcp.CookieRepository = RcpFactory.cookieRepo(JAR_CARD);
    await repo.setCookies(cookies);
    await CardCookieStore.snapshotAndSave(repo);
    info('card syncFromWeb ok count=' + cookies.length);
    return cookies.length;
  }

  /** 建一卡通 session（先恢复落盘 cookie，再建 rcp 会话；跟完重定向链）。 */
  static async session(context: Context): Promise<rcp.Session> {
    const repo: rcp.CookieRepository = RcpFactory.cookieRepo(JAR_CARD);
    await CardCookieStore.restoreInto(repo);
    // autoRedirect=true：CAS 链必须跟完，最终 URL 落哪决定登录态
    //（与教务 jxzxehall 同款；eclass/lib 的 false 是另一类接口，别照搬）。
    return await RcpFactory.createSession(context, JAR_CARD, true);
  }

  /** 有没有可用的一卡通会话（判据 = 落盘快照非空）。 */
  static async hasSession(): Promise<boolean> {
    return await CardCookieStore.hasSession();
  }
}

/** 首页地址再导出（登录页/设置页要用，且必须与取数地址同一条）。 */
export { HOME_URL };
