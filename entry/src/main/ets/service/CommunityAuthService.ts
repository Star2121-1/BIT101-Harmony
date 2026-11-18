/**
 * BIT101 社区（话廊）鉴权服务：换 fake-cookie + 401 静默刷新一次。
 *
 * ## 为什么现在能做（2026-11-18 纠正）
 * 之前以为话廊要"用户手工提供社区票据"，是误判。真相：票据 = `POST /user/login`
 * 的返回字段 `fakeCookie`， App 自己就能换。契约来自 Android `DefaultLoginRepo.loginBIT101`
 * + 我方只读探测（假票据 ⇒ 401「请先登录awa」；假凭据 ⇒ 500「用户名或密码错误Orz」）。
 *
 * ## 红线
 * - 密码只由用户在 App 内输入后进入本服务的调用栈，不打日志、不返回 UI；
 * - 静默刷新用的是**已 opt-in 存的学校凭据**（AutoLoginCredentialStore），没存就不自动；
 * - 401 只刷新一次（对齐 Android DefaultAPIManager），失败如实报，不循环；
 * - TLS：bit101.flwfdd.xyz 系统根证书即可（实测 ssl_verify=0），不需 seatlib 的中间证书。
 */

import { rcp } from '@kit.RemoteCommunicationKit';
import { Context } from '@kit.AbilityKit';
import { RcpFactory, HttpTextResult } from '../core/net/RcpFactory.ts';
import { CasCrypto } from '../core/crypto/CasCrypto.ts';
import { FakeCookieStore } from '../data/FakeCookieStore.ts';
import { AutoLoginCredentialStore } from '../data/AutoLoginCredentialStore.ts';
import {
  CommunityAuthKind, CommunityAuthDecision, canRefresh, classifyLogin, decision, messageFor
} from '../corelogic/CommunityAuthLogic.ts';
import { info, warn } from '../core/log/BitLog.ts';

const API_BASE: string = 'https://bit101.flwfdd.xyz';
const JAR_COMMUNITY: string = 'bit_community';

const UA: string =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function headers(fakeCookie: string): rcp.RequestHeaders {
  const h: rcp.RequestHeaders = {
    'User-Agent': UA,
    'Accept': 'application/json',
    'Accept-Language': 'zh-CN,zh;q=0.9'
  };
  if (fakeCookie.length > 0) {
    h['fake-cookie'] = fakeCookie;
  }
  return h;
}

/** 从响应体里取 msg（失败文案），不猜。 */
function msgOf(body: string): string {
  try {
    const o = JSON.parse(body) as Record<string, Object>;
    const v: Object | undefined = o['msg'];
    return typeof v === 'string' ? v as string : '';
  } catch (e) {
    return '';
  }
}

/** 从登录响应里取 fakeCookie（成功时）。 */
function cookieOf(body: string): string {
  try {
    const o = JSON.parse(body) as Record<string, Object>;
    // 原版模型是 fakeCookie（camelCase）；兼容服务端可能的 snake_case
    let v: Object | undefined = o['fakeCookie'];
    if (v === undefined) {
      v = o['fake_cookie'];
    }
    return typeof v === 'string' ? v as string : '';
  } catch (e) {
    return '';
  }
}

export class CommunityAuthService {
  /** 用户本人输密码登录（学号+明文密码）；密码 md5 后 POST，明文不落盘不打日志。 */
  static async login(context: Context, sid: string, password: string): Promise<CommunityAuthDecision> {
    if (sid.trim().length === 0 || password.length === 0) {
      return decision('no_cred', '学号或密码为空');
    }
    const session: rcp.Session = await RcpFactory.createSession(context, JAR_COMMUNITY, false);
    try {
      const md5: string = await CasCrypto.md5Hex(password);
      const body: string = JSON.stringify({ sid: sid.trim(), password: md5 });
      const res: HttpTextResult = await RcpFactory.postText(session,
        API_BASE + '/user/login', headers(''), body);
      const kind: CommunityAuthKind = classifyLogin(msgOf(res.body), res.status);
      if (kind === 'ok') {
        const fc: string = cookieOf(res.body);
        if (fc.length === 0) {
          warn('community login ok but no fakeCookie in body');
          return decision('failed', '登录返回里没有票据（服务端格式变化）');
        }
        await FakeCookieStore.save(fc);
        info('community login ok, cookie len=' + fc.length);
        return decision('ok', messageFor('ok'));
      }
      if (kind === 'bad_cred') {
        return decision('bad_cred', messageFor('bad_cred'));
      }
      return decision(kind, messageFor(kind));
    } catch (e) {
      warn('community login transport fail: ' + JSON.stringify(e));
      return decision('failed', messageFor('failed'));
    }
  }

  /**
   * 静默刷新票据：用已 opt-in 存的学校凭据（学号密码）再走一次 login。
   * 没存凭据 ⇒ no_cred，不自动。成功 ⇒ 新票据已落 FakeCookieStore。
   */
  static async renew(context: Context): Promise<CommunityAuthDecision> {
    const cred = await AutoLoginCredentialStore.load();
    if (cred === null) {
      return decision('no_cred', messageFor('no_cred'));
    }
    info('community renew: opt-in cred present');
    return await CommunityAuthService.login(context, cred.username, cred.password);
  }

  /** 带票据发 GET；401 时静默刷新一次再重试。返回最终响应。 */
  static async getWithAuth(context: Context, path: string, attempts: number = 0): Promise<HttpTextResult> {
    const session: rcp.Session = await RcpFactory.createSession(context, JAR_COMMUNITY, false);
    const fc: string = await FakeCookieStore.load();
    const res: HttpTextResult = await RcpFactory.getText(session, API_BASE + path, headers(fc));
    if (res.status === 401 && canRefresh(fc.length > 0, attempts)) {
      const renewed = await CommunityAuthService.renew(context);
      if (renewed.kind === 'ok') {
        info('community 401 → renewed, retry once');
        return await CommunityAuthService.getWithAuth(context, path, attempts + 1);
      }
      warn('community 401 renew failed: ' + renewed.kind);
    }
    return res;
  }

  /**
   * 带票据发 JSON POST（点赞/评论/举报等写操作）；401 静默刷新一次再重试。
   * ⚠️ 只负责传输，不决定"何时写"——调用方必须是用户主动点击后的 UI 动作。
   */
  static async postWithAuth(context: Context, path: string, body: string,
    attempts: number = 0): Promise<HttpTextResult> {
    const session: rcp.Session = await RcpFactory.createSession(context, JAR_COMMUNITY, false);
    const fc: string = await FakeCookieStore.load();
    const h: rcp.RequestHeaders = headers(fc);
    h['Content-Type'] = 'application/json';
    const res: HttpTextResult = await RcpFactory.postText(session, API_BASE + path, h, body);
    if (res.status === 401 && canRefresh(fc.length > 0, attempts)) {
      const renewed = await CommunityAuthService.renew(context);
      if (renewed.kind === 'ok') {
        info('community write 401 → renewed, retry once');
        return await CommunityAuthService.postWithAuth(context, path, body, attempts + 1);
      }
      warn('community write 401 renew failed: ' + renewed.kind);
    }
    return res;
  }
}
