/**
 * 脱敏纯函数（corelogic 层，裸 Node 可测；不许 import @kit.*）。
 *
 * 由来（2026-11-16 安全审查）：CAS 探针页把**活 SSO cookie 的前 60/80 字符**打进 hilog
 * 和屏幕；CAS 302 跳转 URL 带一次性 `ticket=ST-...` 也原样进日志。二者都是凭据外泄 ——
 * 探针页随正式包发布（开发者选项默认收起，但可打开），所以必须按「日志不写值」的红线修。
 */

/**
 * 只抽 cookie 的名字，绝不返回 `=` 后的值。
 *
 * 输入形如 `SESSION=abc123; path=/; HttpOnly; JSESSIONID=xyz` ⇒ `SESSION,JSESSIONID`。
 * 规则：按 `;` 切段，只取**含 `=` 且 key 看起来是 cookie 名**的段（key 只含 token 字符），
 * 排除 `path=/` / `HttpOnly` / `SameSite=Lax` 这类属性（它们要么无 `=`，要么 key 是保留属性名）。
 */
export function cookieNames(raw: string): string {
  if (raw.length === 0) {
    return '(none)';
  }
  const out: string[] = [];
  const parts: string[] = raw.split(';');
  for (let i = 0; i < parts.length; i++) {
    const seg: string = parts[i].trim();
    const eq: number = seg.indexOf('=');
    if (eq <= 0) {
      continue;
    }
    const key: string = seg.substring(0, eq).trim();
    // cookie 属性名（大小写不敏感）不是 cookie 本身，跳过
    if (isCookieAttr(key)) {
      continue;
    }
    if (!isTokenKey(key)) {
      continue;
    }
    if (out.indexOf(key) < 0) {
      out.push(key);
    }
  }
  return out.length > 0 ? out.join(',') : '(none)';
}

const ATTRS: string[] = ['path', 'domain', 'expires', 'max-age', 'secure', 'httponly', 'samesite', 'priority', 'partitioned'];

function isCookieAttr(key: string): boolean {
  return ATTRS.indexOf(key.toLowerCase()) >= 0;
}

function isTokenKey(key: string): boolean {
  for (let i = 0; i < key.length; i++) {
    const c: string = key.charAt(i);
    const ok: boolean = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
      (c >= '0' && c <= '9') || c === '_' || c === '-' || c === '.';
    if (!ok) {
      return false;
    }
  }
  return true;
}

/**
 * 对任意文本做保守 PII 脱敏，用于「落盘排查全文」的场景（教务 403 HTML / WAF 页）。
 * 不能砍掉全文 —— 历史靠它定位过 403；但原文可能回显学号/姓名，必须先抹。
 *
 * - 10 位学号：前 3 + **** + 后 2（`1120241355` → `112****55`）
 * - 11 位手机号：前 3 + **** + 后 4
 * - URL query 里的敏感键（ticket/token/code/password/username/session）整段值抹掉
 */
export function redactPii(text: string): string {
  if (text.length === 0) {
    return text;
  }
  // 学号（10 位连续数字，BIT 学号定长 10）；用回调只抹值，不动结构
  let out: string = text.replace(/\b(\d{10})\b/g, (m: string): string =>
    m.substring(0, 3) + '****' + m.substring(m.length - 2));
  // 手机号（11 位）
  out = out.replace(/\b(1[3-9]\d{9})\b/g, (m: string): string =>
    m.substring(0, 3) + '****' + m.substring(m.length - 4));
  // URL / 表单里的敏感键值：key=value → key=***（覆盖 ticket=ST-xxx 等）
  out = out.replace(/([?&;](?:ticket|token|access_token|code|password|passwd|pwd|username|session|jsessionid)=)([^&\s"'<>]+)/gi,
    (_m: string, key: string): string => key + '***');
  return out;
}

/**
 * 去掉 URL 的 query / fragment，防 `ticket=ST-...` / `code=` / `token=` 进日志。
 * `https://sso.bit.edu.cn/cas/login?ticket=ST-1&x=2#f` ⇒ `https://sso.bit.edu.cn/cas/login`。
 */
export function stripQuery(url: string): string {
  let end: number = url.length;
  const q: number = url.indexOf('?');
  const h: number = url.indexOf('#');
  if (q >= 0 && q < end) {
    end = q;
  }
  if (h >= 0 && h < end) {
    end = h;
  }
  return url.substring(0, end);
}
