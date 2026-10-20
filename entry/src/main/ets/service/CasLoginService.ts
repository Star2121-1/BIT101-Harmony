/**
 * CAS 登录服务：把 M1 的「裸协议探针」固化成正式能力。
 *
 * 与探针的区别（不是复制粘贴，是升级）：
 * 1. **不接凭据参数**，学号/密码由登录页在设备上输入（agent 不碰凭据）；
 * 2. **结果落盘**：学校 cookie → SchoolCookieStore，seatlib JWT → SessionStore；
 * 3. **可静默续期**：`silentRenewJwt()` 用已存的 phpCAS cookie 换新 JWT，不需要密码；
 * 4. **诊断可复核**：每一跳的 status/location 都记进 `LoginOutcome.steps`（打码）。
 *
 * 已验事实（2026-10-20 真机，evidence/m1-5-http-probe/report-final-jwt-verified.md）：
 * 六步全通 —— 登录页 200/30490+SESSION → captchaInvisible=false → USTC fp 200+responsetoken(24)
 * → 表单 POST 302 ticket → phpCAS 链 → cas/user 200/744 → JWT(513) → 业务接口 code=1。
 *
 * 红线：
 * - 单发不重试（失败即停，把原始状态交回上层）；
 * - 需要图形验证码 / 短信二验 ⇒ 停手上抛，不自动绕；
 * - 密码只在本次调用的栈上，不写日志、不落盘、不返回到 UI。
 */

import { JAR_LOGIN, JAR_CAS } from '../core/net/CookieJars.ts';
import { rcp } from '@kit.RemoteCommunicationKit';
import { Context } from '@kit.AbilityKit';
import { CasCrypto } from '../core/crypto/CasCrypto.ts';
import {
  CasPage, SfPending, extractCasCode, extractLoginError, extractTicket, isSmsSecondFactor,
  parseCasPage, parseSecondFactorPage, resolveUrl, urlEncode
} from '../core/crypto/CasParser.ts';
import { RcpFactory, PersistedCookie } from '../core/net/RcpFactory.ts';
import { SessionStore } from '../data/SessionStore.ts';
import { SchoolCookieStore } from '../data/SchoolCookieStore.ts';
import { info, mask, warn } from '../core/log/BitLog.ts';

const SSO_BASE: string = 'https://sso.bit.edu.cn';
const SEATLIB_BASE: string = 'https://seatlib.bit.edu.cn';
const CAS_SERVICE: string = 'https://seatlib.bit.edu.cn/api/cas/cas';
const CAS_LOGIN_URL: string = SSO_BASE + '/cas/login?service=' + encodeURIComponent(CAS_SERVICE);
const USTC_FP_URL: string = SSO_BASE + '/ustc-rba-front/fp';
const CAS_USER_URL: string = SEATLIB_BASE + '/api/cas/user';
/** protected 接口都在 /cas 前缀下（BitSsoClient: casUrl = baseUrl + "/cas"）。 */
const CAS_API: string = SSO_BASE + '/cas/api';
const FIND_CAPTCHA_URL: string = CAS_API + '/protected/user/findCaptchaCount/';
const SEND_SMS_URL: string = CAS_API + '/protected/sms/publicNoToken/sendSmsCode';
const CHECK_TOKEN_URL: string = CAS_API + '/protected/sms/checkToken';

/** 与风控指纹的 userAgent 字段必须一致（BitSsoClient.DEFAULT_USER_AGENT）。 */
const MAC_UA: string =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36';

const MAX_CAS_HOPS: number = 8;

/** cookie 罐标识（只允许字母+下划线）。 */

/** 登录结果状态。 */
export type LoginStatus =
  'ok' | 'sms_required' | 'captcha_required' | 'bad_credentials' | 'error';

export interface LoginOutcome {
  status: LoginStatus;
  /** ok / sms_required 时可能已有 jwt（sms 时为空） */
  jwt: string;
  studentId: string;
  displayName: string;
  /** 诊断轨迹（已打码，可安全上报） */
  steps: string[];
  /** 给用户看的一句话（中文，不含敏感值） */
  message: string;
}

/** 跨页面的待决登录态（页面 struct 会被路由器重建，会话不能丢）。 */
interface PendingLogin {
  jarLogin: rcp.Session;
  repoLogin: rcp.CookieRepository;
  sf: SfPending;
  username: string;
}

let pending: PendingLogin | null = null;

export function hasPendingSms(): boolean {
  return pending !== null;
}

export function clearPending(): void {
  pending = null;
}

export class CasLoginService {
  // ─────────────────────────────────────────────
  // 主流程：学号 + 密码 → 学校会话 + JWT
  // ─────────────────────────────────────────────
  static async login(context: Context, username: string, password: string): Promise<LoginOutcome> {
    const steps: string[] = [];
    const outcome: LoginOutcome = {
      status: 'error', jwt: '', studentId: '', displayName: '', steps: steps, message: ''
    };

    const session: rcp.Session = await RcpFactory.createSession(context, JAR_LOGIN);
    const repo: rcp.CookieRepository = RcpFactory.cookieRepo(JAR_LOGIN);
    const sessionC: rcp.Session = await RcpFactory.createSession(context, JAR_CAS);

    // ── 步骤 1：GET 登录页 + 解析六锚点 ──
    let page: CasPage;
    try {
      const res = await RcpFactory.getText(session, CAS_LOGIN_URL, {
        'content-type': 'text/html',
        'User-Agent': MAC_UA,
        'Accept-Language': 'zh-CN,zh;q=0.9',
        'lang': 'zh'
      });
      page = parseCasPage(res.status, res.body);
      steps.push('step1 http=' + res.status + ' bodyLen=' + res.body.length +
        ' executionLen=' + page.execution.length + ' croyptoLen=' + page.croypto.length);
    } catch (e) {
      outcome.message = '取登录页失败（网络或证书）';
      steps.push('step1 fail ' + JSON.stringify(e));
      return outcome;
    }
    if (page.execution.length === 0 || page.croypto.length === 0) {
      outcome.message = '登录页结构异常（未解析到 execution/croypto）';
      steps.push('step1 parse_empty（服务端可能改版）');
      return outcome;
    }

    // ── 步骤 2：要不要图形验证码 ──
    try {
      const cap = await CasLoginService.findCaptchaInvisible(session, username);
      steps.push('step2 captchaInvisible=' + cap);
      if (cap === 'true') {
        outcome.status = 'captcha_required';
        outcome.message = '学校要求图形验证码，当前版本不支持（已停手，请到浏览器登录一次后重试）';
        return outcome;
      }
    } catch (e) {
      // 查不到不等于要验证码，也不等于不要 —— 如实记，继续（风控兜底）
      steps.push('step2 captcha_check_failed ' + JSON.stringify(e));
    }

    // ── 步骤 3：USTC 风控载荷 ──
    let riskPayload: string;
    try {
      riskPayload = await CasLoginService.buildRiskPayload(session, repo, page);
      steps.push('step3 risk=ok');
    } catch (e) {
      riskPayload = await CasCrypto.aesEcbEncrypt(page.croypto, '{"error":true}');
      steps.push('step3 risk=fallback ' + JSON.stringify(e));
    }

    // ── 步骤 4：组装 13 字段表单 ──
    let passwordEnc: string;
    let captchaPayloadEnc: string;
    try {
      passwordEnc = await CasCrypto.aesEcbEncrypt(page.croypto, password);
      captchaPayloadEnc = await CasCrypto.aesEcbEncrypt(page.croypto, '{}');
    } catch (e) {
      outcome.message = '密码加密失败（AES）';
      steps.push('step4 encrypt_fail ' + JSON.stringify(e));
      return outcome;
    }
    const form: Record<string, string> = {
      'type': 'UsernamePassword',
      '_eventId': 'submit',
      'geolocation': '',
      'execution': page.execution,
      'username': username,
      'croypto': page.croypto,
      'captcha_code': '',
      'password': passwordEnc,
      'captcha_payload': captchaPayloadEnc,
      'risk_payload': riskPayload,
      'targetSystem': page.targetSystem.length > 0 ? page.targetSystem : 'sso',
      'siteId': page.siteId.length > 0 ? page.siteId : 'sourceId',
      'riskEngine': 'true'
    };

    // ── 步骤 5：POST 登录，判三态 ──
    const postUrl: string = page.formAction.length > 0 ? page.formAction : CAS_LOGIN_URL;
    let post;
    try {
      post = await RcpFactory.postForm(session, postUrl, {
        'User-Agent': MAC_UA,
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        'lang': 'zh',
        'Origin': SSO_BASE,
        'Referer': CAS_LOGIN_URL,
        'X-Requested-With': 'XMLHttpRequest'
      }, form);
    } catch (e) {
      outcome.message = '登录请求发送失败（网络）';
      steps.push('step5 transport_fail ' + JSON.stringify(e));
      return outcome;
    }
    const location: string = post.headers['location'] ?? '';
    steps.push('step5 http=' + post.status + ' location=' + (location.length > 0 ? mask(location) : '(none)'));

    const ticket: string = extractTicket(location + '|' + post.body);
    if (post.status === 302 && ticket.length > 0) {
      steps.push('step5 ticket=' + mask(ticket));
    } else if (isSmsSecondFactor(post.body)) {
      // 短信二次验证：解析页面 → 发短信 → 停手等用户输码
      const sf: SfPending | null = parseSecondFactorPage(post.body, postUrl);
      if (sf === null) {
        outcome.message = '学校要求短信验证，但页面解析失败（请到浏览器登录一次）';
        steps.push('step5 sms_page_parse_failed');
        return outcome;
      }
      if (sf.phone.length === 0) {
        outcome.message = '学校要求短信验证，但页面未给出手机号（请到浏览器登录一次）';
        steps.push('step5 sms_page_no_phone');
        return outcome;
      }
      try {
        const sent = await CasLoginService.sendSmsCode(session, sf.phone);
        steps.push('step5 sms_send http=' + sent.status + ' phone=' + mask(sf.phone));
        pending = { jarLogin: session, repoLogin: repo, sf: sf, username: username };
        outcome.status = 'sms_required';
        outcome.message = '已向 ' + mask(sf.phone) + ' 发送验证码，请输入后继续';
        return outcome;
      } catch (e) {
        outcome.message = '短信验证码发送失败';
        steps.push('step5 sms_send_fail ' + JSON.stringify(e));
        return outcome;
      }
    } else {
      const errMsg: string = extractLoginError(post.body);
      outcome.status = 'bad_credentials';
      outcome.message = errMsg.length > 0 ? errMsg : '登录被拒绝（账号或密码错误，或风控拦截）';
      steps.push('step5 rejected bodyLen=' + post.body.length);
      return outcome;
    }

    // ── 步骤 6：phpCAS 链取 cas code → 换 JWT（隔离罐） ──
    try {
      const code: string = await CasLoginService.followForCasCode(sessionC, location);
      steps.push('step6 cas_code=' + mask(code));
      if (code.length === 0) {
        outcome.message = '票据校验未完成（phpCAS 链断）';
        return outcome;
      }
      const jwt: string = await CasLoginService.exchangeJwt(sessionC, code);
      steps.push('step6 jwt=' + mask(jwt));
      if (jwt.length === 0) {
        outcome.message = '换取 JWT 失败（响应无 token）';
        return outcome;
      }
      outcome.jwt = jwt;
      outcome.status = 'ok';
      outcome.message = '登录成功';
    } catch (e) {
      outcome.message = '换取 JWT 失败（网络或服务端异常）';
      steps.push('step6 fail ' + JSON.stringify(e));
      return outcome;
    }

    // ── 步骤 7：建立教务（jxzxehall）会话 —— 失败不算登录失败，但要说清楚 ──
    // ⚠️ 顺序很重要：教务会话建立在步骤 8 才会往罐里写 cookie，
    // 所以**必须建立之后再落盘**（2026-10-20 栽过：先落盘只存下 4 条，教务 cookie 全丢）。
    let jxDetail: string = '';
    try {
      const jx = await CasLoginService.ensureJxzxSession(context, repo);
      jxDetail = jx.detail;
      info('login step7 jxzx ' + jx.detail);
      if (!jx.ok) {
        outcome.message = '登录成功，但教务会话未建立（' + jx.detail + '）';
      }
    } catch (e) {
      jxDetail = 'exception ' + JSON.stringify(e);
      info('login step7 jxzx exception ' + JSON.stringify(e));
      outcome.message = '登录成功，但教务会话建立异常';
    }

    // ── 步骤 8：落盘（学校 cookie 全量快照 + JWT）──
    try {
      await SchoolCookieStore.snapshotAndSave(repo);
      await SessionStore.saveToken(outcome.jwt, username, '');
      const n: number = (await SchoolCookieStore.load()).length;
      steps.push('step8 persisted cookies=' + n + ' jxzx=' + jxDetail);
      info('login step8 persisted cookies=' + n);
    } catch (e) {
      steps.push('step8 persist_fail ' + JSON.stringify(e));
    }

    return outcome;
  }

  // ─────────────────────────────────────────────
  // 短信二次验证（用户已授权输入验证码）
  // ─────────────────────────────────────────────
  static async submitSmsCode(context: Context, code: string): Promise<LoginOutcome> {
    const steps: string[] = [];
    const outcome: LoginOutcome = {
      status: 'error', jwt: '', studentId: '', displayName: '', steps: steps, message: ''
    };
    const p: PendingLogin | null = pending;
    if (p === null) {
      outcome.message = '没有待验证的登录（请重新登录）';
      return outcome;
    }
    if (code.trim().length === 0) {
      outcome.message = '验证码为空';
      return outcome;
    }

    // 校验验证码
    try {
      const checked = await CasLoginService.checkToken(p.jarLogin, p.sf.phone, code.trim());
      steps.push('c1 checkToken http=' + checked.status);
    } catch (e) {
      outcome.message = '验证码校验失败（网络）';
      steps.push('c1 fail ' + JSON.stringify(e));
      return outcome;
    }

    // 以 smsLogin 重投表单（8 字段，password=原始验证码，不加密）
    const form: Record<string, string> = {
      'username': p.username,
      'password': code.trim(),
      'type': 'smsLogin',
      '_eventId': 'submit',
      'geolocation': '',
      'execution': p.sf.execution,
      'captcha_code': '',
      'trustDevice': 'false'
    };
    let post;
    try {
      post = await RcpFactory.postForm(p.jarLogin, p.sf.formAction, {
        'User-Agent': MAC_UA,
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        'lang': 'zh',
        'Referer': CAS_LOGIN_URL,
        'X-Requested-With': 'XMLHttpRequest'
      }, form);
    } catch (e) {
      outcome.message = '验证码提交失败（网络）';
      steps.push('c2 transport_fail ' + JSON.stringify(e));
      return outcome;
    }
    const location: string = post.headers['location'] ?? '';
    steps.push('c2 http=' + post.status + ' location=' + (location.length > 0 ? mask(location) : '(none)'));
    const ticket: string = extractTicket(location + '|' + post.body);
    if (post.status !== 302 || ticket.length === 0) {
      outcome.message = isSmsSecondFactor(post.body)
        ? '验证码不正确或已过期（已停手，不重试）'
        : '短信登录被拒绝';
      steps.push('c2 rejected');
      return outcome;
    }

    // phpCAS 链 → JWT（新建隔离罐）
    try {
      const sessionC: rcp.Session = await RcpFactory.createSession(context, JAR_CAS);
      const casCode: string = await CasLoginService.followForCasCode(sessionC, location);
      steps.push('c3 cas_code=' + mask(casCode));
      if (casCode.length === 0) {
        outcome.message = '票据校验未完成';
        return outcome;
      }
      const jwt: string = await CasLoginService.exchangeJwt(sessionC, casCode);
      steps.push('c3 jwt=' + mask(jwt));
      if (jwt.length === 0) {
        outcome.message = '换取 JWT 失败';
        return outcome;
      }
      outcome.jwt = jwt;
      outcome.status = 'ok';
      outcome.message = '登录成功';
      await SchoolCookieStore.snapshotAndSave(p.repoLogin);
      await SessionStore.saveToken(jwt, p.username, '');
      pending = null;
      try {
        const jx = await CasLoginService.ensureJxzxSession(context, p.repoLogin);
        steps.push('c4 jxzx ' + jx.detail);
      } catch (e) {
        steps.push('c4 jxzx_fail ' + JSON.stringify(e));
      }
      return outcome;
    } catch (e) {
      outcome.message = '换取 JWT 失败（网络）';
      steps.push('c3 fail ' + JSON.stringify(e));
      return outcome;
    }
  }

  // ─────────────────────────────────────────────
  // 静默续期：不用密码，靠已存的会话 cookie 换新 JWT
  // ─────────────────────────────────────────────
  /**
   * 判据（可证伪）：phpCAS 会话仍有效 ⇒ cas/user 返回 200 且 member.token 非空；
   * 会话已死 ⇒ 200 但无 token（Android ERR_SESSION_GONE 的地面真相）。
   * 超时/断网/5xx **不算**会话死（否则会把用户假登出）。
   */
  static async silentRenewJwt(context: Context): Promise<boolean> {
    const cookies: PersistedCookie[] = await SchoolCookieStore.load();
    if (cookies.length === 0) {
      info('silentRenew: no cookies, skip');
      return false;
    }
    const session: rcp.Session = await RcpFactory.createSession(context, JAR_CAS);
    const repo: rcp.CookieRepository = RcpFactory.cookieRepo(JAR_CAS);
    await RcpFactory.restoreCookies(repo, cookies);
    try {
      const jwt: string = await CasLoginService.exchangeJwt(session, '');
      if (jwt.length === 0) {
        warn('silentRenew: no token in response (session likely gone)');
        return false;
      }
      await SessionStore.saveToken(jwt, await SessionStore.getStudentId(), await SessionStore.getDisplayName());
      info('silentRenew: ok token=' + mask(jwt));
      return true;
    } catch (e) {
      warn('silentRenew: transport/5xx, treat as unknown: ' + JSON.stringify(e));
      return false;
    }
  }

  // ─────────────────────────────────────────────
  // 教务（jxzxehall）会话：把 CAS 会话换成 jxzxehall 的应用会话
  // ─────────────────────────────────────────────
  /**
   * 教务（jxzxehall）会话：把 CAS 会话换成 jxzxehall 的应用会话。
   *
   * 链路（对照 Android：WebView 里就是浏览器自然走这条链，Ktor/WebView 都自动跟跳）：
   *   GET `.../jwapp/sys/wdkbby/*default/index.do`
   *     → 302 到 CAS（SSO 会话有效则**静默**发 ticket）
   *     → 302 回 jxzxehallapp（Set-Cookie 建立应用会话）
   *     → 200 应用首页
   *
   * ⚠️ 所以这里**必须用 autoRedirect=true** 的会话：首次 302 是正常起点，不是失效。
   * 判据（可证伪）：最终 200 且正文**不是** CAS 登录页（不含 `login-page-flowkey`）。
   * 兜底：若首页链路没建立会话，再试一次 `auth-protocol-core` 授权入口，并把两者都记进 detail。
   */
  static async ensureJxzxSession(context: Context, repo: rcp.CookieRepository): Promise<JxzxResult> {
    const session: rcp.Session = await RcpFactory.createSession(context, JAR_LOGIN, true);
    const indexUrl: string = 'https://jxzxehallapp.bit.edu.cn/jwapp/sys/wdkbby/*default/index.do';
    // 授权入口：这一跳才会带着 SSO 会话去 CAS 换 jxzxehall 自己的票。
    // ⚠️ 顺序不能省：`index.do` 是**免认证页面**（未登录也回 200），
    // 2026-10-20 栽过 —— 只看 index.do=200 就认为「会话已建立」，结果 API 403。
    const authUrl: string = 'https://jxzxehall.bit.edu.cn/auth-protocol-core/login?service=' +
      encodeURIComponent('https://jxzxehallapp.bit.edu.cn/jwapp/sys/xsfacx/*default/index.do');

    let detail: string = '';
    try {
      const auth = await RcpFactory.getText(session, authUrl, {
        'Accept': 'text/html,application/xhtml+xml',
        'User-Agent': MAC_UA,
        'Accept-Language': 'zh-CN,zh;q=0.9'
      });
      const authLoginPage: boolean = auth.body.indexOf('login-page-flowkey') >= 0;
      detail = 'auth=' + auth.status + ' len=' + auth.body.length +
        ' loginPage=' + (authLoginPage ? 'yes' : 'no');
      info('jxzx ' + detail);
    } catch (e) {
      detail = 'auth_transport_error ' + JSON.stringify(e);
      info('jxzx auth transport error ' + JSON.stringify(e));
    }

    try {
      const res = await RcpFactory.getText(session, indexUrl, {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'User-Agent': MAC_UA,
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Upgrade-Insecure-Requests': '1'
      });
      const isLoginPage: boolean = res.body.indexOf('login-page-flowkey') >= 0;
      detail += ' | index=' + res.status + ' len=' + res.body.length +
        ' loginPage=' + (isLoginPage ? 'yes' : 'no');
      info('jxzx index final=' + res.status + ' len=' + res.body.length +
        ' loginPage=' + (isLoginPage ? 'yes' : 'no'));
      // 诊断：只打 cookie **名**（值一律不打），用来判断 CAS 换票到底有没有发生
      const snapForNames: PersistedCookie[] = await RcpFactory.snapshotCookies(repo);
      const names: string[] = [];
      for (let i = 0; i < snapForNames.length; i++) {
        names.push(snapForNames[i].name + '@' + snapForNames[i].domain);
      }
      info('jxzx cookies(' + names.length + ')= ' + names.join(','));
      return {
        ok: res.status === 200 && !isLoginPage,
        detail: detail + ' cookies=' + snapForNames.length
      };
    } catch (e) {
      return { ok: false, detail: detail + ' | index_error ' + JSON.stringify(e) };
    }
  }

  // ─────────────────────────────────────────────
  // 子步骤实现
  // ─────────────────────────────────────────────

  /** findCaptchaCount → captchaInvisible（'true' = 要图形验证码）。 */
  private static async findCaptchaInvisible(session: rcp.Session, username: string): Promise<string> {
    const url: string = FIND_CAPTCHA_URL + encodeURIComponent(username);
    const res = await RcpFactory.getText(session, url, {
      'content-type': 'application/json',
      'User-Agent': MAC_UA,
      'Accept': 'application/json',
      'lang': 'zh',
      'X-Requested-With': 'XMLHttpRequest'
    });
    try {
      const o: Record<string, JsonLike> = JSON.parse(res.body) as Record<string, JsonLike>;
      const data: Record<string, JsonLike> =
        (o['data'] !== undefined && o['data'] !== null && typeof o['data'] === 'object')
          ? o['data'] as Record<string, JsonLike> : o;
      return String(data['captchaInvisible'] ?? 'false');
    } catch (e) {
      throw new Error('findCaptchaCount 解析失败 status=' + res.status);
    }
  }

  /** USTC 风控：device cookie + 13 字段指纹 → responsetoken → AES(risk_payload)。 */
  private static async buildRiskPayload(session: rcp.Session, repo: rcp.CookieRepository,
    page: CasPage): Promise<string> {
    let device: string = await RcpFactory.getCookieValue(repo, 'device');
    if (device.length === 0) {
      device = await CasCrypto.sha256Hex(String(Date.now()));
      await repo.setCookies({ name: 'device', value: device, domain: 'sso.bit.edu.cn', path: '/' });
      info('risk: device cookie created len=' + device.length);
    }
    const groupId: string = await RcpFactory.getCookieValue(repo, 'riskSystemGroupId');
    const fpJson: string = await CasCrypto.buildFingerprintJsonAsync(device, MAC_UA, groupId);
    const res = await RcpFactory.postText(session, USTC_FP_URL, {
      'content-type': 'application/json',
      'User-Agent': MAC_UA,
      'Accept': 'application/json',
      'lang': 'zh',
      'Referer': CAS_LOGIN_URL,
      'X-Requested-With': 'XMLHttpRequest'
    }, fpJson);
    let token: string = '';
    try {
      const o: Record<string, JsonLike> = JSON.parse(res.body) as Record<string, JsonLike>;
      token = String(o['responsetoken'] ?? '');
      if (token.length === 0 && o['data'] !== undefined && o['data'] !== null &&
        typeof o['data'] === 'object') {
        const d: Record<string, JsonLike> = o['data'] as Record<string, JsonLike>;
        token = String(d['responsetoken'] ?? '');
      }
    } catch (e) {
      // 落到下面的 throw
    }
    if (token.length === 0) {
      throw new Error('USTC 响应无 responsetoken status=' + res.status);
    }
    info('risk: responsetoken len=' + token.length);
    const payload: string = JSON.stringify({ token: token, groupId: groupId });
    return await CasCrypto.aesEcbEncrypt(page.croypto, payload);
  }

  /** 手工跟 phpCAS 链取 cas=code；code 常出现在 Location 的 hash 片段里。 */
  private static async followForCasCode(session: rcp.Session, startUrl: string): Promise<string> {
    let next: string = startUrl;
    for (let hop = 0; hop < MAX_CAS_HOPS && next.length > 0; hop++) {
      const code: string = extractCasCode(next);
      if (code.length > 0) {
        return code;
      }
      const res = await RcpFactory.getText(session, next, {
        'content-type': 'text/html',
        'User-Agent': MAC_UA,
        'Accept-Language': 'zh-CN,zh;q=0.9'
      });
      const loc: string = res.headers['location'] ?? '';
      const resolved: string = loc.length > 0 ? resolveUrl(next, loc) : '';
      const code2: string = extractCasCode(resolved);
      if (code2.length > 0) {
        return code2;
      }
      if (resolved.length === 0) {
        return '';
      }
      next = resolved;
    }
    return '';
  }

  /** POST /api/cas/user 换 JWT。ticket 为空串 ⇒ 静默认证（靠已有 cookie）。 */
  private static async exchangeJwt(session: rcp.Session, ticket: string): Promise<string> {
    const body: string = ticket.length > 0 ? JSON.stringify({ cas: ticket }) : '{}';
    const res = await RcpFactory.postText(session, CAS_USER_URL, {
      'content-type': 'application/json',
      'User-Agent': MAC_UA,
      'Accept': 'application/json',
      'lang': 'zh',
      'X-Requested-With': 'XMLHttpRequest'
    }, body);
    if (res.status !== 200) {
      throw new Error('cas/user HTTP ' + res.status);
    }
    try {
      const o: Record<string, JsonLike> = JSON.parse(res.body) as Record<string, JsonLike>;
      const member: Record<string, JsonLike> =
        (o['member'] !== undefined && o['member'] !== null && typeof o['member'] === 'object')
          ? o['member'] as Record<string, JsonLike> : {};
      return String(member['token'] ?? '');
    } catch (e) {
      return '';
    }
  }

  /** 发短信验证码（protected 接口要 CSRF 头）。 */
  private static async sendSmsCode(session: rcp.Session, phone: string) {
    const csrf: Record<string, string> = await CasCrypto.protectedCsrfHeaders();
    return await RcpFactory.postText(session, SEND_SMS_URL, {
      'content-type': 'application/json',
      'User-Agent': MAC_UA,
      'Accept': 'application/json',
      'lang': 'zh',
      'Sid-Language': 'zh_CN',
      'X-Requested-With': 'XMLHttpRequest',
      'Csrf-Key': csrf['Csrf-Key'],
      'Csrf-Value': csrf['Csrf-Value']
    }, JSON.stringify({ phone: phone, businessNo: '0008' }));
  }

  /** 校验短信验证码。 */
  private static async checkToken(session: rcp.Session, phone: string, code: string) {
    const csrf: Record<string, string> = await CasCrypto.protectedCsrfHeaders();
    return await RcpFactory.postText(session, CHECK_TOKEN_URL, {
      'content-type': 'application/json',
      'User-Agent': MAC_UA,
      'Accept': 'application/json',
      'lang': 'zh',
      'Sid-Language': 'zh_CN',
      'X-Requested-With': 'XMLHttpRequest',
      'Csrf-Key': csrf['Csrf-Key'],
      'Csrf-Value': csrf['Csrf-Value']
    }, JSON.stringify({ phone: phone, token: code, delete: false, trustDevice: false }));
  }
}

/** 教务会话建立结果。 */
export interface JxzxResult {
  ok: boolean;
  detail: string;
}

/** JSON 里可能出现的值（ArkTS 不允许 any，统一用它下钻）。 */
type JsonLike = string | number | boolean | null | object;

/** 取 URL 的主机名（诊断用，不抛）。 */
function hostOf(url: string): string {
  const idx: number = url.indexOf('://');
  if (idx < 0) {
    return url;
  }
  const rest: string = url.substring(idx + 3);
  const slash: number = rest.indexOf('/');
  return slash > 0 ? rest.substring(0, slash) : rest;
}
