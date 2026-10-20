/**
 * CAS 页面/URL 解析。1:1 照搬 Android BIT-Login SDK `jvmShared Parser.kt`。
 *
 * 全部是**已证伪过**的判据（真机 2026-10-20，evidence/m1-5-http-probe/）：
 * - 登录页六锚点：login-page-flowkey(execution) / login-croypto(AES key) /
 *   riskSystemSwitch / targetSystem / siteId / form action
 * - 短信二验页标记：smsLoginForm / secondSmsLoginForm / second-auth-tip /
 *   cas-gateway / current-login-type=smsLogin（普通登录页 HTML 里 0 次出现 ⇒ 判据特异）
 *
 * ⚠️ 本文件**零依赖**（不 import 日志/hilog）：解析必须是纯函数，
 * 这样它能被 Node 直接跑「拿真机抓下来的 HTML 回归」的用例（见 tools/test-parser.mjs）。
 */

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

/** 二次验证待决状态（发了短信、等用户验证码）。 */
export interface SfPending {
  execution: string;
  formAction: string;
  phone: string;
  userObjectId: string;
}

/** Python quote(safe='') 近似：保留非保留字符，其余 percent-encode。 */
export function urlEncode(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c: string) =>
    '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

/** 取 <p id="xxx">value</p> 的 value。 */
export function extractAnchor(html: string, id: string): string {
  const re: RegExp = new RegExp('<p id="' + id + '"[^>]*>([^<]*)</p>');
  const m: RegExpExecArray | null = re.exec(html);
  return m !== null && m.length > 1 ? m[1].trim() : '';
}

/** 取 <form ...> 的 action 属性；无则空串。 */
export function extractFormAction(html: string): string {
  const re: RegExp = new RegExp('<form[^>]*\\saction="([^"]*)"');
  const m: RegExpExecArray | null = re.exec(html);
  return m !== null && m.length > 1 ? m[1].trim() : '';
}

/** 从 URL/正文里取 ticket= 值。 */
export function extractTicket(s: string): string {
  const re: RegExp = /[?&]ticket=([A-Za-z0-9.\-]+)/;
  const m: RegExpExecArray | null = re.exec(s);
  return m !== null && m.length > 1 ? m[1] : '';
}

/** 从 URL（含 # hash 查询串）里取 cas= code。 */
export function extractCasCode(url: string): string {
  const re: RegExp = /[?&]cas=([A-Za-z0-9.\-]+)/;
  const m: RegExpExecArray | null = re.exec(url);
  return m !== null && m.length > 1 ? m[1] : '';
}

/** 短信二次验证页判定（对照 BitSsoClient loginMarkup + current-login-type=smsLogin）。 */
export function isSmsSecondFactor(body: string): boolean {
  if (body.indexOf('smsLoginForm') >= 0 || body.indexOf('secondSmsLoginForm') >= 0) {
    return true;
  }
  const re: RegExp = /current-login-type[^>]*>\s*smsLogin/i;
  return re.test(body);
}

/** 从登录页 HTML 里粗略取错误提示（登录被拒时页面重渲染带错误）。 */
export function extractLoginError(body: string): string {
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

/**
 * 解析二次验证页（1:1 照搬 jvmShared Parser.parseSecondFactorPage）：
 * execution=#login-page-flowkey，userObjectId=#user-object-id，phone=#phone-number；
 * 网关标记：secondSmsLoginForm / second-auth-tip / cas-gateway 任一。
 */
export function parseSecondFactorPage(html: string, responseUrl: string): SfPending | null {
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

/** 相对 Location 解析为绝对 URL（ArkTS 无全局 URL，手工拼）。 */
export function resolveUrl(base: string, location: string): string {
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

/** 解析登录页六锚点。 */
export function parseCasPage(status: number, html: string): CasPage {
  return {
    status: status,
    bodyLen: html.length,
    execution: extractAnchor(html, 'login-page-flowkey'),
    croypto: extractAnchor(html, 'login-croypto'),
    riskSystem: extractAnchor(html, 'riskSystemSwitch'),
    targetSystem: extractAnchor(html, 'targetSystem'),
    siteId: extractAnchor(html, 'siteId'),
    formAction: extractFormAction(html)
  };
}
