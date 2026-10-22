/**
 * 裸协议探针：阶段 A（零凭据，已验全绿）+ 阶段 B（真登录，一次性）。
 *
 * 设计纪律（来自交接 SOP + Android 参照 BIT-Login / SeatSession）：
 * - 只验协议，不接 UI 架构、不做完整登录、不加登录页。本文件可整删。
 * - **红线 1**：密码/ticket/token/cookie 绝不写进源码、绝不打印明文。日志一律走 mask()。
 * - **红线 2**：单发不重试。失败即停，把原始响应交回上层。
 * - **红线 3**：服务端返回短信二次验证页 ⇒ 立即停手（返回 sms_challenge 状态），不接验证码。
 * - **红线 4**：凭据经 `aa start --ps` 的 Want 参数运行时传入，不落任何文件。
 * - TLS：sso/seatlib 同族缺陷（只发叶证书），rcp remoteValidation 必须带 Thawte 中间证书。
 * - 阶段 B 步骤 6（phpCAS 链 + 换 JWT）用**全新独立 session**（对照 Android IsolatedCookieJar：
 *   共享 jar 里的陈旧 phpCAS 会话会让票据校验走岔）。
 *
 * 阶段 A（已验）：rcp GET CAS 页 → 解析锚点 → AES 测试向量 == R4lDIBO/32oRLZSjtsPrGQ==
 * 阶段 B（照 BitSsoClient.loginWithPassword + SOP 六步）：
 *   1 GET 登录页解析 → 2 findCaptchaCount（captchaInvisible=true 则停）→
 *   3 USTC 风控（device cookie + 13 字段指纹 + POST /ustc-rba-front/fp + AES risk_payload）→
 *   4 组装 13 字段表单 → 5 POST 判三态（302 ticket / 200 短信页 / 200 错误）→
 *   6 phpCAS 链取 cas code → POST seatlib /api/cas/user 换 JWT
 */
import { rcp } from '@kit.RemoteCommunicationKit';
import { cryptoFramework } from '@kit.CryptoArchitectureKit';
import util from '@ohos.util';
import { Context } from '@kit.AbilityKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import type { JsonValue } from '../core/model/SchoolModels.ts';
import { objOf as jsonObjOf, str as jsonStr } from '../core/model/SchoolModels.ts';

const DOMAIN: number = 0x00CC;
const TAG: string = 'BIT101Probe';

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

/** 阶段 B 用 BitSsoClient.DEFAULT_USER_AGENT（Mac Chrome 150）：风控指纹的 userAgent 字段必须与请求头一致。 */
const MAC_UA: string =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36';
/** 阶段 A 用桌面 UA（已验 200）。 */
const DESKTOP_UA: string =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/** sso 与 seatlib 同族，复用同一张 Thawte TLS RSA CA G1 中间证书。 */
const CA_RAWFILE: string = 'seatlib_tls_intermediate.pem';
const CONNECT_MS: number = 15000;
const READ_MS: number = 30000;
const MAX_CAS_HOPS: number = 8;

/** AES 测试向量自证基准（BitSsoClient CryptoTest.kt：AES matches Python protocol vector）。 */
const TEST_KEY_B64: string = 'MDEyMzQ1Njc4OWFiY2RlZg==';
const TEST_PLAIN: string = 'password';
const TEST_EXPECT: string = 'R4lDIBO/32oRLZSjtsPrGQ==';

/** CAS 登录页解析结果。 */
export interface CasPage {
  status: number;
  bodyLen: number;
  execution: string;
  croypto: string;
  riskSystem: string;
  targetSystem: string;
  siteId: string;
  formAction: string;
}

/** 敏感串打码：红线 1——密码/ticket/token/cookie 一律走这里。 */
export function mask(s: string): string {
  if (s.length === 0) {
    return '(empty)';
  }
  if (s.length <= 10) {
    return '***(' + s.length + ')';
  }
  return s.substring(0, 4) + '***(' + s.length + ')' + s.substring(s.length - 4);
}

/** 阶段 B 凭据结构（仅内存中转，不落任何文件/磁盘）。 */
export interface ProbeCreds {
  user: string;
  pass: string;
}

/**
 * 阶段 B 凭据的**仅内存**中转（进程级模块变量，不落任何文件/磁盘）。
 * 为什么不用 AppStorage：实测 Ability onCreate 里 set 的值，页面读不到（跨实例怪癖）——
 * 按铁律 0.3（核验方法不对会假否定），换确定可用的机制，不猜。
 */
let credsUser: string = '';
let credsPass: string = '';

export function setProbeCreds(user: string, pass: string): void {
  credsUser = user;
  credsPass = pass;
}

export function getProbeCreds(): ProbeCreds {
  return { user: credsUser, pass: credsPass };
}

export function clearProbeCreds(): void {
  credsUser = '';
  credsPass = '';
}

/**
 * 阶段 B/C 的 session 提到模块级：页面（struct）会被路由器重建，
 * 实例字段会丢；而二次验证要跨"发短信 → 用户输码 → 续跑"两段，
 * session/cookie 罐必须活着（铁律 0.5：guard 须与被保护数据同生命周期）。
 */
let gSessionB: rcp.Session | null = null;
let gRepoB: rcp.CookieRepository | null = null;
let gSessionC: rcp.Session | null = null;

/** 二次验证待决状态（发了短信、等用户验证码）。 */
export interface SfPending {
  execution: string;
  formAction: string;
  phone: string;
  userObjectId: string;
}

let sfPending: SfPending | null = null;

export function getSfPending(): SfPending | null {
  return sfPending;
}

export function clearSfPending(): void {
  sfPending = null;
}

export class CasProbe {
  private sessionA: rcp.Session | null = null; // 阶段 A
  // 阶段 B/C 的 sessionB/repoB/sessionC 已提升为模块级（gSessionB/gRepoB/gSessionC）：
  // 二次验证要跨"发短信→用户输码→续跑"两段，页面重建不能丢会话。
  private repoC: rcp.CookieRepository | null = null; // phpCAS 链 cookie 罐（再隔离）

  // ─────────────────────────────────────────────
  // 公共：rcp session 工厂（带 Thawte 中间证书 + 关自动重定向 + 独立 cookie 罐）
  // ─────────────────────────────────────────────
  private async buildSession(context: Context, repoId: string): Promise<rcp.Session> {
    let caPem: string = '';
    try {
      const bytes: Uint8Array = await context.resourceManager.getRawFileContent(CA_RAWFILE);
      caPem = util.TextDecoder.create('utf-8').decodeToString(bytes);
    } catch (e) {
      caPem = '';
      hilog.warn(DOMAIN, TAG, 'CA rawfile read failed: %{public}s', JSON.stringify(e));
    }
    const repo: rcp.CookieRepository = rcp.CookieRepository.create(repoId);
    if (repoId === 'probe_b') {
      gRepoB = repo;
    } else if (repoId === 'probe_c') {
      // phpCAS 链罐：仅占位，sessionC 在下方赋值
    }
    const transfer: rcp.TransferConfiguration = {
      autoRedirect: false, // 票据链要读 302 Location，绝不跟随
      timeout: { connectMs: CONNECT_MS, transferMs: READ_MS }
    };
    let security: rcp.SecurityConfiguration;
    if (caPem.length > 0) {
      const ca: rcp.CertificateAuthority = { content: caPem };
      security = { remoteValidation: ca };
    } else {
      security = { remoteValidation: 'system' };
      hilog.warn(DOMAIN, TAG, 'CA empty, fallback system (likely error 20)');
    }
    const reqConfig: rcp.Configuration = { transfer: transfer, security: security };
    const sessionConfig: rcp.SessionConfiguration = {
      requestConfiguration: reqConfig,
      cookieRepository: repo // 独立 cookie 罐（对照 Android IsolatedCookieJar）
    };
    const s: rcp.Session = rcp.createSession(sessionConfig);
    if (repoId === 'probe_b') {
      gSessionB = s;
    } else if (repoId === 'probe_c') {
      gSessionC = s;
    }
    return s;
  }

  private async ensureSessionA(context: Context): Promise<rcp.Session> {
    if (this.sessionA === null) {
      this.sessionA = await this.buildSession(context, 'probe_a');
    }
    return this.sessionA;
  }

  // ─────────────────────────────────────────────
  // 阶段 A（已验全绿）：取页 + 解析 + AES 自证
  // ─────────────────────────────────────────────
  async fetchCasPage(context: Context): Promise<CasPage> {
    const session: rcp.Session = await this.ensureSessionA(context);
    const headers: rcp.RequestHeaders = {
      'content-type': 'text/html',
      'User-Agent': DESKTOP_UA,
      'Accept-Language': 'zh-CN,zh;q=0.9',
      'lang': 'zh'
    };
    const request: rcp.Request = new rcp.Request(CAS_LOGIN_URL, 'GET', headers);
    hilog.info(DOMAIN, TAG, 'A.step1 GET begin');
    let resp: rcp.Response;
    try {
      resp = await session.fetch(request);
    } catch (err) {
      hilog.error(DOMAIN, TAG, 'A.step1 transport error: %{public}s', JSON.stringify(err));
      throw new Error('rcp 传输错误（TLS/网络/证书）: ' + JSON.stringify(err));
    }
    const status: number = resp.statusCode;
    const rawBody: ArrayBuffer | undefined = resp.body;
    if (rawBody === undefined) {
      throw new Error('响应体为空（status=' + status + '）');
    }
    const html: string = util.TextDecoder.create('utf-8').decodeToString(new Uint8Array(rawBody));
    hilog.info(DOMAIN, TAG, 'A.step1 GET ok status=%{public}d bodyLen=%{public}d', status, html.length);
    const page: CasPage = {
      status: status,
      bodyLen: html.length,
      execution: extractAnchor(html, 'login-page-flowkey'),
      croypto: extractAnchor(html, 'login-croypto'),
      riskSystem: extractAnchor(html, 'riskSystemSwitch'),
      targetSystem: extractAnchor(html, 'targetSystem'),
      siteId: extractAnchor(html, 'siteId'),
      formAction: extractFormAction(html)
    };
    hilog.info(DOMAIN, TAG,
      'A.step2 parsed execution=%{public}s croypto=%{public}s risk=%{public}s target=%{public}s siteId=%{public}s',
      mask(page.execution), mask(page.croypto), page.riskSystem, page.targetSystem, page.siteId);
    return page;
  }

  async aesTestVector(): Promise<string> {
    const actual: string = await CasProbe.aesEcbEncrypt(TEST_KEY_B64, TEST_PLAIN);
    hilog.info(DOMAIN, TAG, 'A.step3 AES vector match=%{public}s',
      actual === TEST_EXPECT ? 'true' : 'false');
    return actual;
  }

  async runStageA(context: Context): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    try {
      const actual: string = await this.aesTestVector();
      out['aes_actual'] = actual;
      out['aes_match'] = actual === TEST_EXPECT ? 'true' : 'false';
    } catch (e) {
      out['aes_match'] = 'error';
      out['aes_error'] = JSON.stringify(e);
    }
    try {
      const page: CasPage = await this.fetchCasPage(context);
      out['http_status'] = String(page.status);
      out['bodyLen'] = String(page.bodyLen);
      out['execution_len'] = String(page.execution.length);
      out['croypto_len'] = String(page.croypto.length);
      out['croypto_decoded_bytes'] = String(CasProbe.b64ToBytes(page.croypto).length);
      out['riskSystem'] = page.riskSystem;
      out['targetSystem'] = page.targetSystem;
      out['siteId'] = page.siteId;
      out['formAction'] = page.formAction;
    } catch (e) {
      out['fetch_error'] = JSON.stringify(e);
    }
    return out;
  }

  // ─────────────────────────────────────────────
  // 阶段 B：真登录（一次性，红线全守）
  // ─────────────────────────────────────────────
  /**
   * 跑完整登录。username/password 只来自运行时参数，绝不落文件、绝不打印。
   * 返回结果字典（全部脱敏）；遇短信二次验证 ⇒ status=sms_challenge 即停。
   */
  async runStageB(context: Context, username: string, password: string): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    out['b0_user'] = mask(username);
    // 每次都新建隔离 session + 独立 cookie 罐：一次性探针，避免任何陈旧会话
    gSessionB = await this.buildSession(context, 'probe_b');
    gSessionC = await this.buildSession(context, 'probe_c');

    // ── 步骤 1：GET 登录页 + 解析 ──
    let page: CasPage;
    try {
      page = await this.bGetLoginPage();
      out['b1_status'] = String(page.status);
      out['b1_bodyLen'] = String(page.bodyLen);
      out['b1_execution_len'] = String(page.execution.length);
      out['b1_croypto_bytes'] = String(CasProbe.b64ToBytes(page.croypto).length);
      out['b1_risk'] = page.riskSystem;
      out['b1_target'] = page.targetSystem;
      out['b1_siteId'] = page.siteId;
    } catch (e) {
      out['status'] = 'fail_step1';
      out['error'] = JSON.stringify(e);
      return out;
    }
    if (page.execution.length === 0 || page.croypto.length === 0) {
      out['status'] = 'fail_step1_parse';
      out['error'] = 'execution/croypto 解析为空';
      return out;
    }

    // ── 步骤 2：查要不要图形验证码 ──
    try {
      const captchaInfo: Record<string, string> = await this.bFindCaptchaCount(username);
      const invisible: string = captchaInfo['captchaInvisible'] ?? '';
      out['b2_captchaInvisible'] = invisible;
      if (invisible === 'true') {
        out['status'] = 'stop_captcha_required';
        out['note'] = '服务端要求图形验证码，本轮不识别，停手';
        hilog.warn(DOMAIN, TAG, 'B.step2 captchaInvisible=true => 停手');
        return out;
      }
    } catch (e) {
      out['b2_error'] = JSON.stringify(e);
      hilog.warn(DOMAIN, TAG, 'B.step2 findCaptchaCount error: %{public}s', JSON.stringify(e));
    }

    // ── 步骤 3：USTC 风控载荷 ──
    let riskPayload: string;
    try {
      riskPayload = await this.bUstcRiskPayload(page);
      out['b3_risk'] = 'ok';
    } catch (e) {
      riskPayload = await CasProbe.aesEcbEncrypt(page.croypto, '{"error":true}');
      out['b3_risk'] = 'fallback';
      out['b3_error'] = JSON.stringify(e);
      hilog.warn(DOMAIN, TAG, 'B.step3 USTC fallback: %{public}s', JSON.stringify(e));
    }

    // ── 步骤 4：组装表单（13 字段） ──
    let passwordEnc: string;
    let captchaPayloadEnc: string;
    try {
      passwordEnc = await CasProbe.aesEcbEncrypt(page.croypto, password);
      captchaPayloadEnc = await CasProbe.aesEcbEncrypt(page.croypto, '{}');
    } catch (e) {
      out['status'] = 'fail_step4_encrypt';
      out['error'] = JSON.stringify(e);
      return out;
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

    // ── 步骤 5：POST 登录 + 三态判定 ──
    const postUrl: string = page.formAction.length > 0 ? page.formAction : CAS_LOGIN_URL;
    let post: { status: number; location: string; body: string };
    try {
      post = await this.bLoginPost(postUrl, form);
    } catch (e) {
      out['status'] = 'fail_step5_transport';
      out['error'] = JSON.stringify(e);
      return out;
    }
    out['b5_http'] = String(post.status);
    out['b5_location'] = post.location.length > 0 ? mask(post.location) : '(none)';
    hilog.info(DOMAIN, TAG, 'B.step5 POST http=%{public}d location=%{public}s bodyLen=%{public}d',
      post.status, mask(post.location), post.body.length);

    const ticket: string = extractTicket(post.location + '|' + post.body);
    if (post.status === 302 && ticket.length > 0) {
      out['status'] = 'ticket_ok';
      out['ticket'] = mask(ticket);
      hilog.info(DOMAIN, TAG, 'B.step5 ticket=%{public}s', mask(ticket));
    } else if (isSmsSecondFactor(post.body)) {
      // ── 阶段 C 步骤 1：解析二次验证页 + 发短信，等用户验证码 ──
      hilog.warn(DOMAIN, TAG, 'B.step5 命中二次验证页，解析并发短信');
      const sf: SfPending | null = parseSecondFactorPage(post.body, postUrl);
      if (sf === null) {
        out['status'] = 'sf_parse_failed';
        out['note'] = '命中二次验证页但解析不出 execution/userObjectId';
        return out;
      }
      out['sf_execution_len'] = String(sf.execution.length);
      out['sf_userObjectId_len'] = String(sf.userObjectId.length);
      out['sf_phone'] = sf.phone.length > 0 ? mask(sf.phone) : '(empty)';
      if (sf.phone.length === 0) {
        // 页面没带手机号 ⇒ 需要 RSA 那套 getPhoneNumberByUserId（本轮未实现）
        out['status'] = 'sf_no_phone';
        out['note'] = '二验页无 #phone-number，需 RSA 取号路径（未实现），停手';
        hilog.warn(DOMAIN, TAG, 'B.step5 二验页无 phone，停手');
        return out;
      }
      try {
        const sent: { status: number; body: string } = await this.bSendSmsCode(sf.phone);
        out['sf_send_http'] = String(sent.status);
        out['sf_send_body_head'] = sent.body.substring(0, Math.min(120, sent.body.length));
        hilog.info(DOMAIN, TAG, 'B.step5 sendSmsCode http=%{public}d', sent.status);
        sfPending = sf;
        out['status'] = 'sms_sent';
        out['note'] = '验证码已发送；请在页面输入验证码后点「提交验证码」';
      } catch (e) {
        out['status'] = 'sf_send_failed';
        out['error'] = JSON.stringify(e);
        hilog.error(DOMAIN, TAG, 'sendSmsCode error: %{public}s', JSON.stringify(e));
      }
      return out;
    } else {
      out['status'] = 'login_failed';
      out['b5_body_head'] = post.body.substring(0, Math.min(200, post.body.length));
      const errMsg: string = extractLoginError(post.body);
      if (errMsg.length > 0) {
        out['b5_error_msg'] = errMsg;
      }
      hilog.warn(DOMAIN, TAG, 'B.step5 登录失败 body=%{public}s',
        post.body.substring(0, Math.min(200, post.body.length)));
      return out;
    }

    // ── 步骤 6：phpCAS 链取 cas code（全新隔离 session）→ 换 JWT ──
    try {
      const code: string = await this.bFollowForCasCode(post.location);
      out['b6_cas_code'] = mask(code);
      if (code.length === 0) {
        out['status'] = 'fail_step6_no_code';
        return out;
      }
      const jwt: string = await this.bExchangeJwt(code);
      out['jwt'] = mask(jwt);
      out['status'] = jwt.length > 0 ? 'jwt_ok' : 'fail_step6_no_token';
      hilog.info(DOMAIN, TAG, 'B.step6 jwt=%{public}s', mask(jwt));

      // ── 步骤 7（阶段 D）：用 JWT 调只读业务接口，验证票据**真的可用** ──
      if (jwt.length > 0) {
        await this.bVerifyJwt(jwt, out);
      }
    } catch (e) {
      out['status'] = 'fail_step6';
      out['error'] = JSON.stringify(e);
      hilog.error(DOMAIN, TAG, 'B.step6 error: %{public}s', JSON.stringify(e));
    }
    return out;
  }

  /**
   * 阶段 D：用拿到的 JWT 调 seatlib 只读接口 `/api/Member/reneges`。
   * 判据（可证伪）：未登录时 seatlib 惯例是 **HTTP 200 + code 10001**；
   * 登录成功则 code=1 且 data 有内容 ⇒ 说明票据被服务端认可。
   * ⚠️ 只读接口，不产生任何副作用；token 只进请求头，不打日志。
   */
  private async bVerifyJwt(jwt: string, out: Record<string, string>): Promise<void> {
    try {
      const session: rcp.Session = gSessionC as rcp.Session;
      const headers: rcp.RequestHeaders = {
        'content-type': 'application/json',
        'lang': 'zh',
        'X-Requested-With': 'XMLHttpRequest',
        'Authorization': 'bearer' + jwt,
        'User-Agent': MAC_UA,
        'Accept-Language': 'zh-CN,zh;q=0.9'
      };
      const body: string = JSON.stringify({ type: 1, authorization: 'bearer' + jwt });
      const request: rcp.Request = new rcp.Request(SEATLIB_BASE + '/api/Member/reneges', 'POST', headers, body);
      const resp: rcp.Response = await session.fetch(request);
      const raw: ArrayBuffer | undefined = resp.body;
      const text: string = raw === undefined
        ? ''
        : util.TextDecoder.create('utf-8').decodeToString(new Uint8Array(raw));
      const code: string = this.bExtractJsonField(text, 'code');
      const dataLen: number = this.bCountDataItems(text);
      out['d_http'] = String(resp.statusCode);
      out['d_code'] = code;
      out['d_data_items'] = String(dataLen);
      out['d_body_len'] = String(text.length);
      // code=1 视为登录态被认可；10001 = 未登录
      out['d_verdict'] = (code === '1' || code === '0')
        ? 'jwt_accepted' : (code === '10001' ? 'jwt_rejected_10001' : 'unexpected_code');
      hilog.info(DOMAIN, TAG,
        'B.step7 http=%{public}d code=%{public}s dataItems=%{public}d verdict=%{public}s',
        resp.statusCode, code, dataLen, out['d_verdict']);
    } catch (e) {
      out['d_verdict'] = 'verify_error';
      out['d_error'] = JSON.stringify(e);
      hilog.error(DOMAIN, TAG, 'B.step7 error: %{public}s', JSON.stringify(e));
    }
  }

  /** 从 JSON 文本里取某个顶层字段的原始值（够用即可，不做完整 JSON 解析）。 */
  private bExtractJsonField(text: string, field: string): string {
    const needle: string = '"' + field + '"';
    const idx: number = text.indexOf(needle);
    if (idx < 0) {
      return '';
    }
    const colon: number = text.indexOf(':', idx + needle.length);
    if (colon < 0) {
      return '';
    }
    let i: number = colon + 1;
    while (i < text.length && (text.charAt(i) === ' ' || text.charAt(i) === '"')) {
      i++;
    }
    let out: string = '';
    while (i < text.length) {
      const ch: string = text.charAt(i);
      if (ch === ',' || ch === '}' || ch === ']') {
        break;
      }
      out += ch;
      i++;
    }
    return out.trim();
  }

  /** 数 data 数组里有多少个元素（浅层计数，够判"有无数据"）。 */
  private bCountDataItems(text: string): number {
    const key: string = '"data"';
    const idx: number = text.indexOf(key);
    if (idx < 0) {
      return -1;
    }
    const open: number = text.indexOf('[', idx);
    if (open < 0) {
      return -1;
    }
    const close: number = text.indexOf(']', open);
    if (close < 0) {
      return -1;
    }
    const inner: string = text.substring(open + 1, close);
    if (inner.trim().length === 0) {
      return 0;
    }
    // 按顶层逗号数（够这个响应结构用）
    let depth: number = 0;
    let count: number = 1;
    for (let i = 0; i < inner.length; i++) {
      const ch: string = inner.charAt(i);
      if (ch === '{' || ch === '[') {
        depth++;
      } else if (ch === '}' || ch === ']') {
        depth--;
      } else if (ch === ',' && depth === 0) {
        count++;
      }
    }
    return count;
  }

  // ── 阶段 B 子步骤 ──

  private async bGetLoginPage(): Promise<CasPage> {
    const session: rcp.Session = gSessionB as rcp.Session;
    const headers: rcp.RequestHeaders = {
      'content-type': 'text/html',
      'User-Agent': MAC_UA,
      'Accept-Language': 'zh-CN,zh;q=0.9',
      'lang': 'zh'
    };
    const request: rcp.Request = new rcp.Request(CAS_LOGIN_URL, 'GET', headers);
    hilog.info(DOMAIN, TAG, 'B.step1 GET begin');
    const resp: rcp.Response = await session.fetch(request);
    const rawBody: ArrayBuffer | undefined = resp.body;
    if (rawBody === undefined) {
      throw new Error('登录页响应体为空 status=' + resp.statusCode);
    }
    const html: string = util.TextDecoder.create('utf-8').decodeToString(new Uint8Array(rawBody));
    const cookies: rcp.ResponseCookie[] = resp.cookies ?? [];
    for (let i = 0; i < cookies.length; i++) {
      hilog.info(DOMAIN, TAG, 'B.step1 set-cookie name=%{public}s', cookies[i].name);
    }
    hilog.info(DOMAIN, TAG, 'B.step1 ok status=%{public}d bodyLen=%{public}d', resp.statusCode, html.length);
    return {
      status: resp.statusCode,
      bodyLen: html.length,
      execution: extractAnchor(html, 'login-page-flowkey'),
      croypto: extractAnchor(html, 'login-croypto'),
      riskSystem: extractAnchor(html, 'riskSystemSwitch'),
      targetSystem: extractAnchor(html, 'targetSystem'),
      siteId: extractAnchor(html, 'siteId'),
      formAction: extractFormAction(html)
    };
  }

  private async bFindCaptchaCount(username: string): Promise<Record<string, string>> {
    const session: rcp.Session = gSessionB as rcp.Session;
    const url: string = FIND_CAPTCHA_URL + encodeURIComponent(username);
    const headers: rcp.RequestHeaders = {
      'content-type': 'application/json',
      'User-Agent': MAC_UA,
      'Accept': 'application/json',
      'lang': 'zh',
      'X-Requested-With': 'XMLHttpRequest'
    };
    const request: rcp.Request = new rcp.Request(url, 'GET', headers);
    const resp: rcp.Response = await session.fetch(request);
    const rawBody: ArrayBuffer | undefined = resp.body;
    if (rawBody === undefined) {
      throw new Error('findCaptchaCount 空响应 status=' + resp.statusCode);
    }
    const text: string = util.TextDecoder.create('utf-8').decodeToString(new Uint8Array(rawBody));
    hilog.info(DOMAIN, TAG, 'B.step2 http=%{public}d bodyLen=%{public}d', resp.statusCode, text.length);
    const out: Record<string, string> = {};
    try {
      const o: Record<string, JsonValue> = JSON.parse(text) as Record<string, JsonValue>;
      const data: Record<string, JsonValue> = jsonObjOf(o, 'data') ?? o;
      const ci: JsonValue | undefined = data['captchaInvisible'];
      out['captchaInvisible'] = (ci === undefined || ci === null) ? 'false' : String(ci);
    } catch (e) {
      out['parse_error'] = JSON.stringify(e);
    }
    return out;
  }

  private async bUstcRiskPayload(page: CasPage): Promise<string> {
    const session: rcp.Session = gSessionB as rcp.Session;
    // a. device cookie：没有则造 sha256(当前毫秒)
    let device: string = await this.bGetCookieValue('device');
    if (device.length === 0) {
      device = await CasProbe.sha256Hex(String(Date.now()));
      const repo: rcp.CookieRepository = gRepoB as rcp.CookieRepository;
      await repo.setCookies({ name: 'device', value: device, domain: 'sso.bit.edu.cn', path: '/' });
      hilog.info(DOMAIN, TAG, 'B.step3 device cookie 新建 len=%{public}d', device.length);
    }
    // b. groupId
    const groupId: string = await this.bGetCookieValue('riskSystemGroupId');
    // c+d. 指纹 JSON → POST /ustc-rba-front/fp → responsetoken
    const fpJson: string = await CasProbe.buildFingerprintJsonAsync(device, MAC_UA, groupId);
    const headers: rcp.RequestHeaders = {
      'content-type': 'application/json',
      'User-Agent': MAC_UA,
      'Accept': 'application/json',
      'lang': 'zh',
      'Referer': CAS_LOGIN_URL,
      'X-Requested-With': 'XMLHttpRequest'
    };
    const request: rcp.Request = new rcp.Request(USTC_FP_URL, 'POST', headers, fpJson);
    const resp: rcp.Response = await session.fetch(request);
    const rawBody: ArrayBuffer | undefined = resp.body;
    if (rawBody === undefined) {
      throw new Error('ustc fp 空响应 status=' + resp.statusCode);
    }
    const text: string = util.TextDecoder.create('utf-8').decodeToString(new Uint8Array(rawBody));
    hilog.info(DOMAIN, TAG, 'B.step3 fp http=%{public}d bodyLen=%{public}d', resp.statusCode, text.length);
    let token: string = '';
    try {
      const o: Record<string, JsonValue> = JSON.parse(text) as Record<string, JsonValue>;
      token = jsonStr(o, 'responsetoken', '');
      if (token.length === 0) {
        const d: Record<string, JsonValue> | null = jsonObjOf(o, 'data');
        if (d !== null) {
          token = jsonStr(d, 'responsetoken', '');
        }
      }
    } catch (e) {
      hilog.warn(DOMAIN, TAG, 'B.step3 fp parse error: %{public}s', JSON.stringify(e));
    }
    if (token.length === 0) {
      throw new Error('USTC 响应无 responsetoken');
    }
    hilog.info(DOMAIN, TAG, 'B.step3 responsetoken len=%{public}d', token.length);
    const payload: string = JSON.stringify({ token: token, groupId: groupId });
    return await CasProbe.aesEcbEncrypt(page.croypto, payload);
  }

  private async bGetCookieValue(name: string): Promise<string> {
    const repo: rcp.CookieRepository | null = gRepoB;
    if (repo === null) {
      return '';
    }
    try {
      const all: rcp.ResponseCookie[] = await repo.getAllCookies();
      for (let i = 0; i < all.length; i++) {
        if (all[i].name === name) {
          return all[i].value ?? '';
        }
      }
    } catch (e) {
      hilog.warn(DOMAIN, TAG, 'getAllCookies error: %{public}s', JSON.stringify(e));
    }
    return '';
  }

  private async bLoginPost(url: string, form: Record<string, string>):
    Promise<{ status: number; location: string; body: string }> {
    const session: rcp.Session = gSessionB as rcp.Session;
    const headers: rcp.RequestHeaders = {
      'content-type': 'application/x-www-form-urlencoded',
      'User-Agent': MAC_UA,
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'zh-CN,zh;q=0.9',
      'lang': 'zh',
      'Origin': SSO_BASE,
      'Referer': CAS_LOGIN_URL,
      'X-Requested-With': 'XMLHttpRequest'
    };
    const keys: string[] = Object.keys(form);
    const parts: string[] = [];
    for (let i = 0; i < keys.length; i++) {
      parts.push(urlEncode(keys[i]) + '=' + urlEncode(form[keys[i]]));
    }
    const body: string = parts.join('&');
    const request: rcp.Request = new rcp.Request(url, 'POST', headers, body);
    const resp: rcp.Response = await session.fetch(request);
    const rawBody: ArrayBuffer | undefined = resp.body;
    const text: string = rawBody === undefined
      ? ''
      : util.TextDecoder.create('utf-8').decodeToString(new Uint8Array(rawBody));
    const loc: string = String(resp.headers['location'] ?? '');
    return { status: resp.statusCode, location: loc, body: text };
  }

  /** 跟 phpCAS 回调链取 cas=code（全新隔离 session，不跟随重定向，手工跟跳）。 */
  private async bFollowForCasCode(startUrl: string): Promise<string> {
    const session: rcp.Session = gSessionC as rcp.Session;
    const headers: rcp.RequestHeaders = {
      'content-type': 'text/html',
      'User-Agent': MAC_UA,
      'Accept-Language': 'zh-CN,zh;q=0.9'
    };
    let next: string = startUrl;
    for (let hop = 0; hop < MAX_CAS_HOPS && next.length > 0; hop++) {
      const code: string = extractCasCode(next);
      if (code.length > 0) {
        return code;
      }
      const request: rcp.Request = new rcp.Request(next, 'GET', headers);
      const resp: rcp.Response = await session.fetch(request);
      const loc: string = String(resp.headers['location'] ?? '');
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

  private async bExchangeJwt(code: string): Promise<string> {
    const session: rcp.Session = gSessionC as rcp.Session;
    const headers: rcp.RequestHeaders = {
      'content-type': 'application/json',
      'User-Agent': MAC_UA,
      'Accept': 'application/json',
      'lang': 'zh',
      'X-Requested-With': 'XMLHttpRequest'
    };
    const body: string = JSON.stringify({ cas: code });
    const request: rcp.Request = new rcp.Request(CAS_USER_URL, 'POST', headers, body);
    const resp: rcp.Response = await session.fetch(request);
    const rawBody: ArrayBuffer | undefined = resp.body;
    if (rawBody === undefined) {
      throw new Error('cas/user 空响应 status=' + resp.statusCode);
    }
    const text: string = util.TextDecoder.create('utf-8').decodeToString(new Uint8Array(rawBody));
    hilog.info(DOMAIN, TAG, 'B.step6 cas/user http=%{public}d bodyLen=%{public}d', resp.statusCode, text.length);
    if (resp.statusCode !== 200) {
      throw new Error('cas/user HTTP ' + resp.statusCode);
    }
    try {
      const o: Record<string, JsonValue> = JSON.parse(text) as Record<string, JsonValue>;
      const member: Record<string, JsonValue> | null = jsonObjOf(o, 'member');
      return member === null ? '' : jsonStr(member, 'token', '');
    } catch (e) {
      hilog.warn(DOMAIN, TAG, 'B.step6 parse error: %{public}s', JSON.stringify(e));
      return '';
    }
  }

  // ── 阶段 C：二次验证（用户已授权接验证码） ──

  /**
   * 续跑：校验验证码 → 以 type=smsLogin 重投表单 → 拿 ticket → phpCAS 链 → JWT。
   * 对照 BitSsoClient.completeSecondFactor（:202-256）。
   */
  async submitSmsCode(code: string): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    const sf: SfPending | null = sfPending;
    if (sf === null) {
      out['status'] = 'no_pending';
      out['note'] = '没有待决的二次验证（需先跑阶段B到短信已发送）';
      return out;
    }
    if (code.trim().length === 0) {
      out['status'] = 'empty_code';
      return out;
    }
    const username: string = credsUser;
    if (username.length === 0 || gSessionB === null) {
      out['status'] = 'session_lost';
      out['note'] = '会话或凭据已丢（App 可能被重启），需重跑阶段B';
      return out;
    }

    // C1：校验验证码
    try {
      const checked: { status: number; body: string } = await this.bCheckToken(sf.phone, code.trim());
      out['c1_check_http'] = String(checked.status);
      out['c1_check_body_head'] = checked.body.substring(0, Math.min(120, checked.body.length));
      hilog.info(DOMAIN, TAG, 'C.step1 checkToken http=%{public}d bodyLen=%{public}d',
        checked.status, checked.body.length);
    } catch (e) {
      out['status'] = 'fail_c1_check';
      out['error'] = JSON.stringify(e);
      hilog.error(DOMAIN, TAG, 'C.step1 checkToken error: %{public}s', JSON.stringify(e));
      return out;
    }

    // C2：以 smsLogin 重投表单（8 字段，password=原始验证码，不加密）
    const form: Record<string, string> = {
      'username': username,
      'password': code.trim(),
      'type': 'smsLogin',
      '_eventId': 'submit',
      'geolocation': '',
      'execution': sf.execution,
      'captcha_code': '',
      'trustDevice': 'false'
    };
    let post: { status: number; location: string; body: string };
    try {
      post = await this.bLoginPost(sf.formAction, form);
    } catch (e) {
      out['status'] = 'fail_c2_post';
      out['error'] = JSON.stringify(e);
      hilog.error(DOMAIN, TAG, 'C.step2 post error: %{public}s', JSON.stringify(e));
      return out;
    }
    out['c2_http'] = String(post.status);
    out['c2_location'] = post.location.length > 0 ? mask(post.location) : '(none)';
    hilog.info(DOMAIN, TAG, 'C.step2 smsLogin POST http=%{public}d location=%{public}s bodyLen=%{public}d',
      post.status, mask(post.location), post.body.length);

    const ticket: string = extractTicket(post.location + '|' + post.body);
    if (post.status === 302 && ticket.length > 0) {
      out['status'] = 'ticket_ok';
      out['ticket'] = mask(ticket);
      hilog.info(DOMAIN, TAG, 'C.step2 ticket=%{public}s', mask(ticket));
    } else if (isSmsSecondFactor(post.body)) {
      out['status'] = 'sms_challenge_again';
      out['note'] = '重投后仍是二次验证页（验证码可能错/失效），停手不重试';
      out['c2_body_head'] = post.body.substring(0, Math.min(120, post.body.length));
      hilog.warn(DOMAIN, TAG, 'C.step2 仍是二次验证页 => 停手');
      return out;
    } else {
      out['status'] = 'sms_login_failed';
      out['c2_body_head'] = post.body.substring(0, Math.min(200, post.body.length));
      const errMsg: string = extractLoginError(post.body);
      if (errMsg.length > 0) {
        out['c2_error_msg'] = errMsg;
      }
      hilog.warn(DOMAIN, TAG, 'C.step2 失败 body=%{public}s',
        post.body.substring(0, Math.min(200, post.body.length)));
      return out;
    }

    // C3：phpCAS 链取 cas code → 换 JWT
    try {
      const casCode: string = await this.bFollowForCasCode(post.location);
      out['c3_cas_code'] = mask(casCode);
      if (casCode.length === 0) {
        out['status'] = 'fail_c3_no_code';
        return out;
      }
      const jwt: string = await this.bExchangeJwt(casCode);
      out['jwt'] = mask(jwt);
      out['status'] = jwt.length > 0 ? 'jwt_ok' : 'fail_c3_no_token';
      hilog.info(DOMAIN, TAG, 'C.step3 jwt=%{public}s', mask(jwt));
    } catch (e) {
      out['status'] = 'fail_c3';
      out['error'] = JSON.stringify(e);
      hilog.error(DOMAIN, TAG, 'C.step3 error: %{public}s', JSON.stringify(e));
    }
    return out;
  }

  /** 发短信验证码（publicNoToken，但要带 protected CSRF 头）。 */
  private async bSendSmsCode(phone: string): Promise<{ status: number; body: string }> {
    const session: rcp.Session = gSessionB as rcp.Session;
    const csrf: Record<string, string> = await CasProbe.protectedCsrfHeaders();
    const headers: rcp.RequestHeaders = {
      'content-type': 'application/json',
      'User-Agent': MAC_UA,
      'Accept': 'application/json',
      'lang': 'zh',
      'Sid-Language': 'zh_CN',
      'X-Requested-With': 'XMLHttpRequest',
      'Csrf-Key': csrf['Csrf-Key'],
      'Csrf-Value': csrf['Csrf-Value']
    };
    const body: string = JSON.stringify({ phone: phone, businessNo: '0008' });
    const request: rcp.Request = new rcp.Request(SEND_SMS_URL, 'POST', headers, body);
    const resp: rcp.Response = await session.fetch(request);
    const rawBody: ArrayBuffer | undefined = resp.body;
    const text: string = rawBody === undefined
      ? ''
      : util.TextDecoder.create('utf-8').decodeToString(new Uint8Array(rawBody));
    return { status: resp.statusCode, body: text };
  }

  /** 校验短信验证码（/protected/，带 CSRF 头）。 */
  private async bCheckToken(phone: string, code: string): Promise<{ status: number; body: string }> {
    const session: rcp.Session = gSessionB as rcp.Session;
    const csrf: Record<string, string> = await CasProbe.protectedCsrfHeaders();
    const headers: rcp.RequestHeaders = {
      'content-type': 'application/json',
      'User-Agent': MAC_UA,
      'Accept': 'application/json',
      'lang': 'zh',
      'Sid-Language': 'zh_CN',
      'X-Requested-With': 'XMLHttpRequest',
      'Csrf-Key': csrf['Csrf-Key'],
      'Csrf-Value': csrf['Csrf-Value']
    };
    const body: string = JSON.stringify({
      phone: phone,
      token: code,
      delete: false,
      trustDevice: false
    });
    const request: rcp.Request = new rcp.Request(CHECK_TOKEN_URL, 'POST', headers, body);
    const resp: rcp.Response = await session.fetch(request);
    const rawBody: ArrayBuffer | undefined = resp.body;
    const text: string = rawBody === undefined
      ? ''
      : util.TextDecoder.create('utf-8').decodeToString(new Uint8Array(rawBody));
    return { status: resp.statusCode, body: text };
  }

  // ─────────────────────────────────────────────
  // 静态工具：AES / base64 / sha256 / md5 / 指纹 / CSRF
  // ─────────────────────────────────────────────

  /** AES128/192/256 ECB PKCS7 加密，base64 key → base64 密文。 */
  static async aesEcbEncrypt(keyB64: string, plaintext: string): Promise<string> {
    const b64: util.Base64Helper = new util.Base64Helper();
    const keyBytes: Uint8Array = b64.decodeSync(keyB64);
    let algName: string = 'AES128';
    if (keyBytes.length === 24) {
      algName = 'AES192';
    } else if (keyBytes.length === 32) {
      algName = 'AES256';
    }
    const transformation: string = algName + '|ECB|PKCS7'; // 竖线分隔；ECB params=null（官方文档）
    const gen: cryptoFramework.SymKeyGenerator = cryptoFramework.createSymKeyGenerator(algName);
    const symKey: cryptoFramework.SymKey = await gen.convertKey({ data: keyBytes });
    const cipher: cryptoFramework.Cipher = cryptoFramework.createCipher(transformation);
    await cipher.init(cryptoFramework.CryptoMode.ENCRYPT_MODE, symKey, null);
    const enc: util.TextEncoder = new util.TextEncoder();
    const plainBytes: Uint8Array = enc.encodeInto(plaintext);
    const ct: cryptoFramework.DataBlob = await cipher.doFinal({ data: plainBytes });
    return b64.encodeToStringSync(ct.data);
  }

  static b64ToBytes(b64: string): Uint8Array {
    const helper: util.Base64Helper = new util.Base64Helper();
    return helper.decodeSync(b64);
  }

  static async sha256Hex(input: string): Promise<string> {
    const md: cryptoFramework.Md = cryptoFramework.createMd('SHA256');
    const enc: util.TextEncoder = new util.TextEncoder();
    await md.update({ data: enc.encodeInto(input) });
    const out: cryptoFramework.DataBlob = await md.digest();
    return bytesToHex(out.data);
  }

  static async md5Hex(input: string): Promise<string> {
    const md: cryptoFramework.Md = cryptoFramework.createMd('MD5');
    const enc: util.TextEncoder = new util.TextEncoder();
    await md.update({ data: enc.encodeInto(input) });
    const out: cryptoFramework.DataBlob = await md.digest();
    return bytesToHex(out.data);
  }

  /**
   * protected 接口的 CSRF 头（1:1 照搬 Crypto.protectedCsrfHeaders）：
   * key = 32 位随机字母数字；encoded = base64(key)；
   * mixed = encoded[:mid] + encoded + encoded[mid:]；Csrf-Value = MD5(mixed)。
   */
  static async protectedCsrfHeaders(): Promise<Record<string, string>> {
    const key: string = randomAlnum(32);
    const b64: util.Base64Helper = new util.Base64Helper();
    const enc: util.TextEncoder = new util.TextEncoder();
    const encoded: string = b64.encodeToStringSync(enc.encodeInto(key));
    const mid: number = Math.floor(encoded.length / 2);
    const mixed: string = encoded.substring(0, mid) + encoded + encoded.substring(mid);
    const value: string = await CasProbe.md5Hex(mixed);
    return { 'Csrf-Key': key, 'Csrf-Value': value };
  }

  /**
   * 13 字段风控指纹（1:1 照搬 Fingerprint.kt build()）：
   * fonts/deviceMemory/hardwareConcurrency/cpuClass 取 sha256；
   * timezone/platform/language/screenResolution 取原始 JS 字面量；
   * fingerprint = sha256(前 8 项原始值拼接)；localgroupId/cookieValue/userAgent 原样。
   */
  static async buildFingerprintJsonAsync(deviceCookie: string, ua: string, groupId: string): Promise<string> {
    const fontsJs: string = '["Arial","Helvetica Neue","PingFang SC","Times New Roman"]';
    const devMemJs: string = '16';
    const hwConcJs: string = '10';
    const tzJs: string = '"Asia/Shanghai"';
    const cpuJs: string = '"not available"';
    const platJs: string = '"MacIntel"';
    const langJs: string = '"zh-CN"';
    const scrJs: string = '[956,1470]';
    const combined: string = fontsJs + devMemJs + hwConcJs + tzJs + cpuJs + platJs + langJs + scrJs;
    const fp: Record<string, string> = {
      'fonts': await CasProbe.sha256Hex(fontsJs),
      'deviceMemory': await CasProbe.sha256Hex(devMemJs),
      'hardwareConcurrency': await CasProbe.sha256Hex(hwConcJs),
      'localgroupId': groupId,
      'timezone': tzJs,
      'cpuClass': await CasProbe.sha256Hex(cpuJs),
      'platform': platJs,
      'language': langJs,
      'screenResolution': scrJs,
      'fingerprint': await CasProbe.sha256Hex(combined),
      'cookieValue': deviceCookie,
      'userAgent': ua,
      'platformAuthenticator': 'support'
    };
    return JSON.stringify(fp);
  }
}

// ─────────────────────────────────────────────
// 模块级工具函数
// ─────────────────────────────────────────────

function bytesToHex(bytes: Uint8Array): string {
  let s: string = '';
  for (let i = 0; i < bytes.length; i++) {
    const b: number = bytes[i] & 0xff;
    s += (b < 16 ? '0' : '') + b.toString(16);
  }
  return s;
}

/** n 位随机字母数字（CSRF key 用）。 */
function randomAlnum(n: number): string {
  const chars: string = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let s: string = '';
  for (let i = 0; i < n; i++) {
    s += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return s;
}

/**
 * 解析二次验证页（1:1 照搬 jvmShared Parser.parseSecondFactorPage）：
 * execution=#login-page-flowkey，userObjectId=#user-object-id，phone=#phone-number；
 * 网关标记：secondSmsLoginForm / second-auth-tip / cas-gateway 任一。
 */
function parseSecondFactorPage(html: string, responseUrl: string): SfPending | null {
  const execution: string = extractAnchor(html, 'login-page-flowkey');
  const userObjectId: string = extractAnchor(html, 'user-object-id');
  const hasMarker: boolean = html.indexOf('secondSmsLoginForm') >= 0 ||
    html.indexOf('second-auth-tip') >= 0 || html.indexOf('cas-gateway') >= 0;
  if (execution.length === 0 || userObjectId.length === 0 || !hasMarker) {
    return null;
  }
  const action: string = extractFormAction(html);
  const formAction: string = action.length > 0
    ? resolveUrl(responseUrl, action)
    : resolveUrl(responseUrl, 'login');
  return {
    execution: execution,
    formAction: formAction,
    phone: extractAnchor(html, 'phone-number'),
    userObjectId: userObjectId
  };
}

/** Python quote(safe='') 近似：保留非保留字符，其余 percent-encode。 */
function urlEncode(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c: string) =>
    '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

/** 取 <p id="xxx">value</p> 的 value。 */
function extractAnchor(html: string, id: string): string {
  const re: RegExp = new RegExp('<p id="' + id + '"[^>]*>([^<]*)</p>');
  const m: RegExpExecArray | null = re.exec(html);
  return m !== null && m.length > 1 ? m[1].trim() : '';
}

/** 取 <form ...> 的 action 属性；无则空串。 */
function extractFormAction(html: string): string {
  const re: RegExp = new RegExp('<form[^>]*\\saction="([^"]*)"');
  const m: RegExpExecArray | null = re.exec(html);
  return m !== null && m.length > 1 ? m[1].trim() : '';
}

/** 从 URL/正文里取 ticket= 值。 */
function extractTicket(s: string): string {
  const re: RegExp = /[?&]ticket=([A-Za-z0-9.\-]+)/;
  const m: RegExpExecArray | null = re.exec(s);
  return m !== null && m.length > 1 ? m[1] : '';
}

/** 从 URL（含 # hash 查询串）里取 cas= code。 */
function extractCasCode(url: string): string {
  const re: RegExp = /[?&]cas=([A-Za-z0-9.\-]+)/;
  const m: RegExpExecArray | null = re.exec(url);
  return m !== null && m.length > 1 ? m[1] : '';
}

/** 短信二次验证页判定（对照 BitSsoClient loginMarkup + current-login-type=smsLogin）。 */
function isSmsSecondFactor(body: string): boolean {
  if (body.indexOf('smsLoginForm') >= 0 || body.indexOf('secondSmsLoginForm') >= 0) {
    return true;
  }
  const re: RegExp = /current-login-type[^>]*>\s*smsLogin/i;
  return re.test(body);
}

/** 从登录页 HTML 里粗略取错误提示（登录被拒时页面重渲染带错误）。 */
function extractLoginError(body: string): string {
  const patterns: RegExp[] = [
    /id="login-error"[^>]*>([^<]+)/,
    /class="[^"]*error[^"]*"[^>]*>([^<]{2,80})/,
    /(用户名或密码错误|密码错误|账号或密码错误|登录失败|认证失败)/
  ];
  for (let i = 0; i < patterns.length; i++) {
    const m: RegExpExecArray | null = patterns[i].exec(body);
    if (m !== null && m.length > 1 && m[1].trim().length > 0) {
      return m[1].trim().substring(0, 80);
    }
  }
  return '';
}

/** 相对 Location 解析为绝对 URL（ArkTS 无全局 URL，手工拼）。 */
function resolveUrl(base: string, location: string): string {
  if (location.indexOf('http://') === 0 || location.indexOf('https://') === 0) {
    return location;
  }
  const schemeIdx: number = base.indexOf('://');
  if (schemeIdx < 0) {
    return location;
  }
  const scheme: string = base.substring(0, schemeIdx);
  const hostStart: number = schemeIdx + 3;
  const pathStart: number = base.indexOf('/', hostStart);
  const origin: string = pathStart > 0 ? base.substring(0, pathStart) : base;
  // 协议相对
  if (location.indexOf('//') === 0) {
    return scheme + ':' + location;
  }
  // 绝对路径
  if (location.charAt(0) === '/') {
    return origin + location;
  }
  // 相对路径：取 base 的目录部分
  const qIdx: number = base.indexOf('?');
  const hIdx: number = base.indexOf('#');
  let cut: number = base.length;
  if (qIdx >= 0) {
    cut = Math.min(cut, qIdx);
  }
  if (hIdx >= 0) {
    cut = Math.min(cut, hIdx);
  }
  const noQuery: string = base.substring(0, cut);
  const lastSlash: number = noQuery.lastIndexOf('/');
  const dir: string = lastSlash >= 0 ? noQuery.substring(0, lastSlash + 1) : noQuery + '/';
  return dir + location;
}
