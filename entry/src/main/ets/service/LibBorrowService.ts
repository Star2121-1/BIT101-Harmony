/**
 * 图书馆「我的借阅」只读服务（M5-3）。
 *
 * 1:1 对照 Android：data/.../repo/DefaultLibBorrowRepo.kt。
 * 契约：BIT101-seat/docs/lib-borrow-contract.md（2026-09-28 实测）。
 *
 * ## 一次抓取的顺序（顺序有讲究，别调换 —— Android 原注释）
 * 1. 同步 Web 组件的 cookie 进 JAR_LIB；
 * 2. `GET /engine2/header/user-info` 判登录态 —— **不能省**：未登录时借阅接口
 *    一样返回 200，div 里同样是 `checkHasData([])`，直接解析会得出「0 本在借」
 *    这个危险结论，真正该提醒时反而告诉用户「你没借书」；
 * 3. 抓一次借阅页取 `sversion`（门户缓存失效参数，接口要带；取不到用兜底值）；
 * 4. 请求 `/application/<appId>/data` 并解析。
 *
 * ## 与 Android 的差异（鸿蒙侧实现）
 * Android 用 WebViewCookieSync 把 WebView cookie 同步进 OkHttp；
 * 鸿蒙用 WebCookieManager.fetchCookie 抽两个主机的 cookie 灌进 rcp 罐（同构）。
 *
 * ## 失败判据（可证伪）
 * - 未登录：user-info 的 `data.uid` 为空 ⇒ LoggedOut（**可处置**：去 Web 登录）。
 * - 响应形态不认识（锚点没了/code≠1）⇒ Failed，**绝不显示 0 条**。
 */

import { JAR_LIB } from '../core/net/CookieJars.ts';
import { rcp } from '@kit.RemoteCommunicationKit';
import { Context } from '@kit.AbilityKit';
import { RcpFactory, PersistedCookie } from '../core/net/RcpFactory.ts';
import { webview } from '@kit.ArkWeb';
import { LibCookieStore } from '../data/LibCookieStore.ts';
import { SsoCookieBroker } from './SsoCookieBroker.ts';
import { AutoReloginService } from './AutoReloginService.ts';
import { hasPendingSms } from './CasLoginService.ts';
import {
  BorrowRecord,
  HOST,
  LOGIN_URL,
  PAGE_URL,
  USER_INFO_URL,
  APP_ID_CURRENT,
  APP_ID_HISTORY,
  dataUrl,
  isLoggedIn,
  parseRecords,
  parseSversion
} from '../corelogic/LibBorrowLogic.ts';
import { info, warn } from '../core/log/BitLog.ts';

/** 与教务/eclass 同一张 Chrome UA（WAF 认客户端一致性）。 */
const LIB_UA: string =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36';

/**
 * 门户部署版本号兜底值：正常路径从借阅页现取，
 * 只有页面抓取失败时才用它（它只是缓存失效参数，不影响数据正确性）。
 * 与 Android DefaultLibBorrowRepo.FALLBACK_SVERSION 一致。
 */
const FALLBACK_SVERSION: string = '20260928388';

/** API 请求头（照搬 Android：Accept 通配 + X-Requested-With，门户按 XHR 对待）。
 *  ⚠️ 注释里不许出现星号斜杠星连写（会被当成注释结束符，后半截中文按代码解析炸一堆错）。 */
function apiHeaders(): rcp.RequestHeaders {
  return {
    'Accept': '*/*',
    'User-Agent': LIB_UA,
    'X-Requested-With': 'XMLHttpRequest'
  };
}

/**
 * 抓取结果。**必须把「取不到」和「没有」分开**（与 Android LibBorrowResult 同纪律）：
 * 借阅条数直接驱动到期提醒 —— 把「网络失败」显示成「0 本」，
 * 就会在真正该提醒的时候告诉用户「你没借书」。
 */
export type LibBorrowResult =
  | { kind: 'ok'; records: BorrowRecord[] }
  | { kind: 'loggedOut' }
  /** F01-03：自动重登触发短信二验，页面就地弹验证码框（不重输学号密码）。 */
  | { kind: 'smsPending' }
  | { kind: 'failed'; reason: string };

export class LibBorrowService {
  /** 当前在借（appId=1715437）。 */
  static async fetchCurrent(context: Context): Promise<LibBorrowResult> {
    return await fetch(context, APP_ID_CURRENT);
  }

  /** 历史借阅（appId=1697337，纯展示，失败不影响当前借阅）。 */
  static async fetchHistory(context: Context): Promise<LibBorrowResult> {
    return await fetch(context, APP_ID_HISTORY);
  }

  /**
   * 从 Web 组件抽 cookie，灌进 JAR_LIB 并落盘。
   *
   * 抽两个主机（与 Android WebViewCookieSync.sync 同款名单）：
   * - `PAGE_URL`（mylib 个人空间，数据接口所在主机）
   * - `LOGIN_URL`（lib 门户，CAS 登录后会话 cookie 的落点）
   *
   * @returns 灌入的 cookie 条数（0 = Web 里没有图书馆会话，用户还没登录）
   */
  static async syncFromWeb(): Promise<number> {
    const targets: { url: string; domain: string }[] = [
      { url: PAGE_URL, domain: 'mylib.bit.edu.cn' },
      { url: LOGIN_URL, domain: 'lib.bit.edu.cn' }
    ];
    const cookies: PersistedCookie[] = [];
    const seen: Set<string> = new Set<string>();
    for (let i = 0; i < targets.length; i++) {
      const t = targets[i];
      let raw: string = '';
      try {
        raw = await webview.WebCookieManager.fetchCookie(t.url);
      } catch (e) {
        // 该 URL 没有 cookie（未登录）——正常分支不是错误
        warn('lib fetchCookie none ' + t.url + ': ' + JSON.stringify(e));
        continue;
      }
      if (raw.length === 0) {
        continue;
      }
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
        const dedupeKey: string = name + '@' + t.domain;
        if (seen.has(dedupeKey)) {
          continue; // 同名同域后写覆盖先写，保留第一个即可（顺序固定，行为确定）
        }
        seen.add(dedupeKey);
        cookies.push({
          name: name,
          value: p.substring(eq + 1).trim(),
          domain: t.domain,
          path: '/'
        });
      }
    }
    if (cookies.length === 0) {
      return 0;
    }
    const repo: rcp.CookieRepository = RcpFactory.cookieRepo(JAR_LIB);
    await repo.setCookies(cookies);
    await LibCookieStore.snapshotAndSave(repo);
    info('lib syncFromWeb ok count=' + cookies.length);
    return cookies.length;
  }

  /** 建图书馆 session（先补 CAS 总钥匙 + 恢复落盘 cookie，再建 rcp 会话）。 */
  static async session(context: Context): Promise<rcp.Session> {
    const repo: rcp.CookieRepository = RcpFactory.cookieRepo(JAR_LIB);
    // 先把登录页的 CAS 会话复制进来：lib 门户 302 到 sso 时才会被认出来。
    await SsoCookieBroker.seed(JAR_LIB);
    await LibCookieStore.restoreInto(repo);
    // autoRedirect=false：user-info 未登录也返 200（uid 为空），本就不会跳；
    // 真出现 302（会话失效回登录页）时看得见，才判得出「失效」而不是「0 本」。
    return await RcpFactory.createSession(context, JAR_LIB, false);
  }

  /**
   * 用 CAS 总钥匙静默建立图书馆会话。
   *
   * 只走 `LOGIN_URL` 一次：它 302 → login.bit.edu.cn → sso.bit.edu.cn，
   * CAS cookie 已在罐里 ⇒ 不再要求用户输密码 ⇒ 回跳 lib 域并 Set-Cookie。
   * 之后快照回 `LibCookieStore`，再交给调用方重试 user-info。
   *
   * 返回 true 只表示「走完了链」，**不表示已登录**；调用方必须用 user-info 再判一次。
   */
  static async bootstrapFromSso(context: Context): Promise<boolean> {
    try {
      const seeded: number = await SsoCookieBroker.seed(JAR_LIB);
      if (seeded === 0) {
        return false;
      }
      const s: rcp.Session = await RcpFactory.createSession(context, JAR_LIB, true);
      const res = await RcpFactory.getText(s, LOGIN_URL, apiHeaders());
      const repo: rcp.CookieRepository = RcpFactory.cookieRepo(JAR_LIB);
      await LibCookieStore.snapshotAndSave(repo);
      info('lib bootstrap sso final=' + res.finalUrl + ' status=' + res.status + ' seeded=' + seeded);
      return true;
    } catch (e) {
      warn('lib bootstrap sso fail: ' + JSON.stringify(e));
      return false;
    }
  }

  /** 有没有可用的图书馆会话（判据 = 落盘快照非空）。 */
  static async hasSession(): Promise<boolean> {
    return await LibCookieStore.hasSession();
  }
}

async function fetch(context: Context, appId: string, allowRenew: boolean = true): Promise<LibBorrowResult> {
  try {
    let s: rcp.Session = await LibBorrowService.session(context);

    // ② 登录态检查（uid 为空 = 未登录；响应不认识 = 失败，都不许当成「0 本」）
    let who = await RcpFactory.getText(s, USER_INFO_URL, apiHeaders());
    let loginState: boolean | null = isLoggedIn(who.body);
    if (loginState === false) {
      // M16-1：图书馆没有独立会话时，用登录页拿到的 CAS 总钥匙静默走一次
      // LOGIN_URL → sso → lib/sso/login/3rd → 回跳，再重判 user-info。
      // 失败/仍 uid 空才如实返回 loggedOut，不把“没登成”说成“0 本”。
      const booted: boolean = await LibBorrowService.bootstrapFromSso(context);
      if (booted) {
        s = await LibBorrowService.session(context);
        who = await RcpFactory.getText(s, USER_INFO_URL, apiHeaders());
        loginState = isLoggedIn(who.body);
      }
    }
    if (loginState === false && allowRenew) {
      // CAS 总钥匙也过期时 bootstrapFromSso 救不回来（它靠 seed 的旧 CAS cookie）。
      // 有 opt-in 凭据就静默重登一次换新钥匙，再完整重试一遍（本次不再 renew，防递归）。
      const renewed = await AutoReloginService.renew(context);
      if (renewed.kind === 'renewed') {
        info('lib renew ok, retry fetch appId=' + appId);
        return await fetch(context, appId, false);
      }
      // F01-03：自动重登触发短信二验 → 交页面就地输码（不重输学号密码）
      if (renewed.kind === 'need_user' && hasPendingSms()) {
        info('lib renew need_user with sms pending appId=' + appId);
        return { kind: 'smsPending' };
      }
      // 没续上（未存密码/需短信/失败）⇒ 如实报未登录，并把原因带出去给 UI
      info('lib loggedOut (renew=' + renewed.kind + ') appId=' + appId);
      return { kind: 'loggedOut' };
    }
    if (loginState === false) {
      info('lib loggedOut (uid empty) appId=' + appId);
      return { kind: 'loggedOut' };
    }
    if (loginState === null) {
      warn('lib user-info unrecognized status=' + who.status);
      return { kind: 'failed', reason: '会话响应无法识别（status=' + who.status + '）' };
    }

    // ③ sversion（取不到用兜底值——它只是缓存失效参数）
    let sversion: string = FALLBACK_SVERSION;
    try {
      const page = await RcpFactory.getText(s, PAGE_URL, apiHeaders());
      const parsed = parseSversion(page.body);
      if (parsed !== null) {
        sversion = parsed;
      } else {
        warn('lib sversion not found, use fallback ' + FALLBACK_SVERSION);
      }
    } catch (e) {
      warn('lib page fetch fail, use fallback: ' + JSON.stringify(e));
    }

    // ④ 数据接口 + 解析
    const url = dataUrl(appId, sversion);
    const body = await RcpFactory.getText(s, url, apiHeaders());
    const records = parseRecords(body.body);
    if (records === null) {
      warn('lib records unrecognized appId=' + appId + ' status=' + body.status);
      return { kind: 'failed', reason: '借阅响应无法识别（门户可能已改版）' };
    }
    info('lib fetch ok appId=' + appId + ' sversion=' + sversion + ' n=' + records.length);
    return { kind: 'ok', records: records };
  } catch (e) {
    const msg = (e as Error).message;
    warn('lib fetch appId=' + appId + ' fail: ' + msg);
    return { kind: 'failed', reason: msg };
  }
}

/** 主机常量再导出（页面/登录页要用）。 */
export { HOST, LOGIN_URL, PAGE_URL };
