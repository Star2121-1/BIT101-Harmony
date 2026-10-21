/**
 * rcp session 工厂。**网络客户端只有这一份**（对照 Android AppHttpClients 的
 * 「只消除重复不改行为」原则）。
 *
 * 三条从 M1 真机验来的硬约束：
 * 1. **TLS 带 Thawte 中间证书**：sso / seatlib / jxzxehallapp 同族缺陷（服务端只发叶证书），
 *    `remoteValidation: 'system'` 会 error 20（openssl 对照取证）。
 * 2. **autoRedirect=false**：CAS 票据链必须读 302 Location 手工跟跳 ——
 *    phpCAS 的 cas code 常出现在 Location 的 hash 片段里，自动跟随后永远看不到。
 * 3. **独立 cookieRepository**：每类用途一个罐（对照 Android IsolatedCookieJar）——
 *    共享 jar 里的陈旧 phpCAS 会话会让票据校验走岔（2026-09-18 真机实测）。
 *
 * ⚠️ CookieRepository identifier 只允许**字母+下划线**（带连字符报 1007900401）。
 */

import { rcp } from '@kit.RemoteCommunicationKit';
import { Context } from '@kit.AbilityKit';
import util from '@ohos.util';
import { error, info, warn } from '../log/BitLog.ts';

/** sso / seatlib 同族，复用同一张 Thawte TLS RSA CA G1 中间证书。 */
export const CA_RAWFILE: string = 'seatlib_tls_intermediate.pem';

/** 超时分档（对齐 Android：学校门户 15/20s；其余走默认）。 */
export const CONNECT_MS: number = 15000;
export const READ_MS: number = 30000;

export interface HttpTextResult {
  status: number;
  headers: Record<string, string>;
  body: string;
  /**
   * **跟随重定向之后的最终 URL**（`resp.effectiveUrl`；无重定向时 = 请求 URL）。
   * 对齐 OkHttp 的 `resp.request.url` —— 一卡通「未登录」判定就看它
   * （落在 sso.bit.edu.cn = 被踢去 CAS 了），见 CampusCardLogic.parse。
   */
  finalUrl: string;
}

export class RcpFactory {
  private static caPemCache: string | undefined = undefined;

  /** 读内置 Thawte 中间证书（进程内缓存，rawfile 每次读要 IO）。 */
  static async loadCaPem(context: Context): Promise<string> {
    if (RcpFactory.caPemCache !== undefined) {
      return RcpFactory.caPemCache;
    }
    let caPem: string = '';
    try {
      const bytes: Uint8Array = await context.resourceManager.getRawFileContent(CA_RAWFILE);
      caPem = util.TextDecoder.create('utf-8').decodeToString(bytes);
    } catch (e) {
      caPem = '';
      warn('CA rawfile read failed: ' + JSON.stringify(e));
    }
    RcpFactory.caPemCache = caPem;
    return caPem;
  }

  /**
   * 建一个隔离 session。
   * @param repoId cookie 罐标识（**只允许字母+下划线**）
   * @param autoRedirect 是否自动跟跳。
   *   - **false（默认）**：phpCAS 票据链必须这样 —— cas code 藏在 302 的 Location 里，
   *     自动跟随后就再也看不到了（M1 验过）；
   *   - **true**：教务（jxzxehall）必须这样 —— 它的 `index.do` 首次访问就是
   *     「302 → CAS 换票 → 302 回应用 → 200」的正常链路（Android 用的 Ktor 默认跟跳）。
   *     ⚠️ 2026-10-20 栽过：拿 false 去请求教务，把**正常的第一步 302 判成了会话失效**。
   */
  static async createSession(context: Context, repoId: string, autoRedirect: boolean = false): Promise<rcp.Session> {
    const caPem: string = await RcpFactory.loadCaPem(context);
    const repo: rcp.CookieRepository = rcp.CookieRepository.create(repoId);
    const transfer: rcp.TransferConfiguration = {
      autoRedirect: autoRedirect,
      timeout: { connectMs: CONNECT_MS, transferMs: READ_MS }
    };
    let security: rcp.SecurityConfiguration;
    if (caPem.length > 0) {
      const ca: rcp.CertificateAuthority = { content: caPem };
      security = { remoteValidation: ca };
    } else {
      security = { remoteValidation: 'system' };
      warn('CA empty, fallback system (likely error 20)');
    }
    const reqConfig: rcp.Configuration = { transfer: transfer, security: security };
    const sessionConfig: rcp.SessionConfiguration = {
      requestConfiguration: reqConfig,
      cookieRepository: repo
    };
    return rcp.createSession(sessionConfig);
  }

  /**
   * 清空一个 cookie 罐。
   *
   * ⚠️ `CookieRepository.create(id)` 是**进程级单例**：只删 Prefs 里的持久化数据，
   * 内存罐里的会话仍然有效 —— 表现是「界面显示已登出，教务接口照样能访问」。
   * 这里没有 delete API，只能把每条 cookie 覆盖成 `maxAge: 0`（立即过期）。
   *
   * @returns 实际作废的 cookie 条数（0 = 罐本来就是空的）
   */
  static async clearRepoCookies(repoId: string): Promise<number> {
    try {
      const repo: rcp.CookieRepository = rcp.CookieRepository.create(repoId);
      const all: rcp.ResponseCookie[] = await repo.getAllCookies();
      if (all.length === 0) {
        return 0;
      }
      const dead: rcp.ResponseCookie[] = [];
      for (let i = 0; i < all.length; i++) {
        const c: rcp.ResponseCookie = all[i];
        dead.push({
          name: c.name ?? '',
          value: '',
          domain: c.domain,
          path: c.path,
          maxAge: 0
        });
      }
      await repo.setCookies(dead);
      info('clearRepoCookies ' + repoId + ' killed=' + dead.length);
      return dead.length;
    } catch (e) {
      warn('clearRepoCookies ' + repoId + ' fail: ' + JSON.stringify(e));
      return 0;
    }
  }

  /** 取指定罐的 cookie 仓库句柄（登录流程要往里写 device cookie）。 */
  static cookieRepo(repoId: string): rcp.CookieRepository {
    return rcp.CookieRepository.create(repoId);
  }

  /** 从罐里读某个 cookie 的值；没有返回空串。 */
  static async getCookieValue(repo: rcp.CookieRepository, name: string): Promise<string> {
    try {
      const all: rcp.ResponseCookie[] = await repo.getAllCookies();
      for (let i = 0; i < all.length; i++) {
        if (all[i].name === name) {
          return all[i].value ?? '';
        }
      }
    } catch (e) {
      warn('getAllCookies error: ' + JSON.stringify(e));
    }
    return '';
  }

  /** 把罐里的 cookie 全量快照成可持久化结构（登录成功后调一次）。 */
  static async snapshotCookies(repo: rcp.CookieRepository): Promise<PersistedCookie[]> {
    const out: PersistedCookie[] = [];
    try {
      const all: rcp.ResponseCookie[] = await repo.getAllCookies();
      for (let i = 0; i < all.length; i++) {
        const c: rcp.ResponseCookie = all[i];
        out.push({
          name: c.name ?? '',
          value: c.value ?? '',
          domain: c.domain ?? '',
          path: (c.path !== undefined && c.path.length > 0) ? c.path : '/'
        });
      }
    } catch (e) {
      warn('snapshotCookies error: ' + JSON.stringify(e));
    }
    return out;
  }

  /**
   * 把持久化 cookie 灌回罐里（App 重启用）。
   * ⚠️ domain 为空的 cookie（host-only）**跳过**：rcp 的 setCookies 需要 domain，
   * 猜一个会把 cookie 发到错的主机（比丢 cookie 更糟）。调用方会把跳过数记进诊断。
   */
  static async restoreCookies(repo: rcp.CookieRepository, cookies: PersistedCookie[]): Promise<number> {
    let restored: number = 0;
    for (let i = 0; i < cookies.length; i++) {
      const c: PersistedCookie = cookies[i];
      if (c.name.length === 0 || c.domain.length === 0) {
        warn('restoreCookies skip (name/domain empty): ' + c.name);
        continue;
      }
      try {
        await repo.setCookies({
          name: c.name,
          value: c.value,
          domain: c.domain,
          path: c.path.length > 0 ? c.path : '/'
        });
        restored++;
      } catch (e) {
        warn('restoreCookies fail ' + c.name + ': ' + JSON.stringify(e));
      }
    }
    return restored;
  }

  /** GET，返回文本。transport 错误包装成带原因的中文错误。 */
  static async getText(session: rcp.Session, url: string, headers: rcp.RequestHeaders): Promise<HttpTextResult> {
    const request: rcp.Request = new rcp.Request(url, 'GET', headers);
    let resp: rcp.Response;
    try {
      resp = await session.fetch(request);
    } catch (err) {
      error('rcp GET transport error: ' + JSON.stringify(err));
      throw new Error('rcp 传输错误（TLS/网络/证书）: ' + JSON.stringify(err));
    }
    // effectiveUrl 仅在发生过重定向时有值；取不到就退回请求 URL（与 OkHttp request.url 同语义）
    let finalUrl: string = url;
    try {
      if (resp.effectiveUrl !== undefined) {
        finalUrl = resp.effectiveUrl.toString();
      }
    } catch (e) {
      warn('effectiveUrl read fail: ' + JSON.stringify(e));
    }
    return {
      status: resp.statusCode,
      headers: RcpFactory.normalizeHeaders(resp.headers),
      body: RcpFactory.decodeBody(resp.body),
      finalUrl: finalUrl
    };
  }

  /** POST（body 为原始串），返回文本。 */
  static async postText(session: rcp.Session, url: string, headers: rcp.RequestHeaders, body: string): Promise<HttpTextResult> {
    const request: rcp.Request = new rcp.Request(url, 'POST', headers, body);
    let resp: rcp.Response;
    try {
      resp = await session.fetch(request);
    } catch (err) {
      error('rcp POST transport error: ' + JSON.stringify(err));
      throw new Error('rcp 传输错误（TLS/网络/证书）: ' + JSON.stringify(err));
    }
    let finalUrl: string = url;
    try {
      if (resp.effectiveUrl !== undefined) {
        finalUrl = resp.effectiveUrl.toString();
      }
    } catch (e) {
      warn('effectiveUrl read fail: ' + JSON.stringify(e));
    }
    return {
      status: resp.statusCode,
      headers: RcpFactory.normalizeHeaders(resp.headers),
      body: RcpFactory.decodeBody(resp.body),
      finalUrl: finalUrl
    };
  }

  /** 表单 POST（application/x-www-form-urlencoded）。 */
  static async postForm(session: rcp.Session, url: string, headers: rcp.RequestHeaders,
    form: Record<string, string>): Promise<HttpTextResult> {
    const keys: string[] = Object.keys(form);
    const parts: string[] = [];
    for (let i = 0; i < keys.length; i++) {
      parts.push(encodeURIComponent(keys[i]) + '=' + encodeURIComponent(form[keys[i]]));
    }
    const body: string = parts.join('&');
    const merged: rcp.RequestHeaders = {};
    const keys2: string[] = Object.keys(headers);
    for (let i = 0; i < keys2.length; i++) {
      merged[keys2[i]] = headers[keys2[i]];
    }
    merged['content-type'] = 'application/x-www-form-urlencoded';
    return await RcpFactory.postText(session, url, merged, body);
  }

  /**
   * 响应头统一成小写键（rcp 大小写不稳定，探针期踩过）。
   * ⚠️ rcp 的 ResponseHeaders 值类型是 `string | string[]`（多值头），
   * 不能直接塞进 Record<string,string> —— 多值用 ", " 拼接。
   */
  static normalizeHeaders(headers: rcp.ResponseHeaders | undefined): Record<string, string> {
    const out: Record<string, string> = {};
    if (headers === undefined) {
      return out;
    }
    const keys: string[] = Object.keys(headers);
    for (let i = 0; i < keys.length; i++) {
      const raw: string | string[] = headers[keys[i]];
      out[keys[i].toLowerCase()] = Array.isArray(raw) ? (raw as string[]).join(', ') : String(raw ?? '');
    }
    return out;
  }

  static decodeBody(raw: ArrayBuffer | undefined): string {
    if (raw === undefined) {
      return '';
    }
    return util.TextDecoder.create('utf-8').decodeToString(new Uint8Array(raw));
  }
}

/** 可持久化的 cookie（rcp.ResponseCookie 的字段不全，抽平）。 */
export interface PersistedCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
}
