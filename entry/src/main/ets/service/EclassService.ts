/**
 * 延河课堂（eclass）只读服务。
 *
 * ## 会话形态（照搬 Android 契约，不靠猜）
 * 纯 cookie：用户在 Web 组件里走 Keycloak（zy-identity.bit.edu.cn/auth/realms/bit）
 * + CAS broker 登录后，eclass 域下的一组 cookie 就是全部凭据，
 * 之后 `/api/` 请求只带 cookie，无 token 头。
 * 契约：BIT101-seat/docs/ddl-source-contract.md §二（2026-09-22/23 实测）。
 *
 * ## 与 Android 的差异（鸿蒙侧实现）
 * Android 用 WebView + OkHttp 双 cookie 存储同步（WebViewCookieSync）；
 * 鸿蒙用 **Web 组件 + WebCookieManager.fetchCookie** 抽 cookie，
 * 灌进 rcp 的 CookieRepository（JAR_ECLASS）——同构，且
 * CasLoginProbe.ets:311 早在 M1 就预留了这条路线。
 *
 * ## 失败判据（可证伪）
 * - 未登录/会话失效：接口返回 **302**（autoRedirect=false 下看得见）或登录页 HTML
 *   ⇒ 抛 EclassAuthError，调用方引导去 Web 登录，**不静默当成「没有课」**。
 * - 网络/证书错误：rcp 抛传输错误（RcpFactory 已包装中文原因）。
 */

import { JAR_ECLASS } from '../core/net/CookieJars.ts';
import { rcp } from '@kit.RemoteCommunicationKit';
import { Context } from '@kit.AbilityKit';
import { RcpFactory, PersistedCookie } from '../core/net/RcpFactory.ts';
import { webview } from '@kit.ArkWeb';
import { EclassCookieStore } from '../data/EclassCookieStore.ts';
import { EclassCourse, RawActivity, parseCourses, parseActivities } from '../core/model/EclassModels.ts';
import { info, warn } from '../core/log/BitLog.ts';

export const ECLASS_BASE: string = 'https://zy-eclass.bit.edu.cn';
export const ECLASS_HOME: string = ECLASS_BASE + '/';

/** 与教务侧同一张 Chrome UA（WAF 认客户端一致性，少一组头就 403 的教训见 SchoolService）。 */
const ECLASS_UA: string =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36';

/** eclass 会话失效（区别于网络错误：这个要引导重新登录）。 */
export class EclassAuthError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'EclassAuthError';
  }
}

/** API 请求头。先最小集（Accept + UA），真机验不过再按取证加，不预先堆。 */
function apiHeaders(): rcp.RequestHeaders {
  return {
    'Accept': 'application/json, text/plain, */*',
    'User-Agent': ECLASS_UA
  };
}

export class EclassService {
  /**
   * 从 Web 组件抽 cookie，灌进 JAR_ECLASS 并落盘。
   *
   * `WebCookieManager.fetchCookie(url)` 返回该 URL 下浏览器会发的全部 cookie，
   * 形如 `k1=v1; k2=v2`（分号分隔，**不含 domain/path/expiry**）。
   * ⇒ 统一按 eclass 主机域写回 rcp 罐（我们只用这个罐访问 eclass，域收窄无害）。
   *
   * @returns 灌入的 cookie 条数（0 = Web 里没有 eclass 会话，用户还没登录）
   */
  static async syncFromWeb(): Promise<number> {
    let raw: string = '';
    try {
      raw = await webview.WebCookieManager.fetchCookie(ECLASS_HOME);
    } catch (e) {
      // 17100002 = 该 URL 没有 cookie（未登录）——这是正常分支不是错误
      warn('eclass fetchCookie none: ' + JSON.stringify(e));
      return 0;
    }
    if (raw.length === 0) {
      return 0;
    }
    const parts: string[] = raw.split(';');
    const cookies: PersistedCookie[] = [];
    for (let i = 0; i < parts.length; i++) {
      const p: string = parts[i].trim();
      if (p.length === 0) {
        continue;
      }
      const eq: number = p.indexOf('=');
      if (eq <= 0) {
        continue; // 没有 '=' 或名字为空——不是 cookie，跳过
      }
      cookies.push({
        name: p.substring(0, eq).trim(),
        value: p.substring(eq + 1).trim(),
        domain: 'zy-eclass.bit.edu.cn',
        path: '/'
      });
    }
    if (cookies.length === 0) {
      return 0;
    }
    const repo: rcp.CookieRepository = RcpFactory.cookieRepo(JAR_ECLASS);
    await repo.setCookies(cookies);
    await EclassCookieStore.snapshotAndSave(repo);
    info('eclass syncFromWeb ok count=' + cookies.length);
    return cookies.length;
  }

  /** 建 eclass session（先恢复落盘 cookie，再建 rcp 会话）。 */
  static async session(context: Context): Promise<rcp.Session> {
    const repo: rcp.CookieRepository = RcpFactory.cookieRepo(JAR_ECLASS);
    await EclassCookieStore.restoreInto(repo);
    // autoRedirect=false：未登录时 eclass 回 302 → sso，看得见才能判「会话失效」
    return await RcpFactory.createSession(context, JAR_ECLASS, false);
  }

  /** 有没有可用的 eclass 会话（判据 = 落盘快照非空）。 */
  static async hasSession(): Promise<boolean> {
    return await EclassCookieStore.hasSession();
  }

  /**
   * 最近访问的课程（`/api/user/recently-visited-courses`）。
   * 这是「我的课程」唯一可用源（契约：/api/courses 403、其余 404）。
   */
  static async getVisitedCourses(context: Context): Promise<EclassCourse[]> {
    const session: rcp.Session = await EclassService.session(context);
    const resp = await RcpFactory.getText(session, ECLASS_BASE + '/api/user/recently-visited-courses', apiHeaders());
    if (resp.status !== 200) {
      throw new EclassAuthError('eclass 课程接口 status=' + resp.status +
        '（302 = 会话失效，需重新登录）');
    }
    if (resp.body.indexOf('visited_courses') < 0) {
      // 200 但不是期望结构 ⇒ 多半是登录页 HTML，按会话失效处理
      throw new EclassAuthError('eclass 课程接口返回非预期结构（疑似登录页）');
    }
    const parsed = parseCourses(resp.body);
    info('eclass courses ok n=' + parsed.courses.length + ' skipped=' + parsed.skipped);
    return parsed.courses;
  }

  /**
   * 某门课程的动态（`/api/courses/{id}/activities`）。
   * 资料与作业混在同一张表，判定规则在 corelogic/EclassDdlLogic.ts（字段存在性）。
   */
  static async getActivities(context: Context, courseId: number): Promise<RawActivity[]> {
    const session: rcp.Session = await EclassService.session(context);
    const resp = await RcpFactory.getText(session,
      ECLASS_BASE + '/api/courses/' + courseId + '/activities', apiHeaders());
    if (resp.status !== 200) {
      throw new EclassAuthError('eclass 动态接口 status=' + resp.status);
    }
    if (resp.body.indexOf('activities') < 0) {
      throw new EclassAuthError('eclass 动态接口返回非预期结构（疑似登录页）');
    }
    const parsed = parseActivities(resp.body);
    return parsed.activities;
  }
}
