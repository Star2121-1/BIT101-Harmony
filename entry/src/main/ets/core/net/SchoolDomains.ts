/**
 * 「这个域名是不是学校的」—— **全 App 只有这一份判据**。
 * 1:1 照搬 Android `api/.../SchoolDomains.kt`（2026-09-30 SSO 审计后收殓的成果：
 * 同一条判据曾被抄 4 遍且抄得不一样，代价是 CAS 会话不回 App ⇒「明明登录了却还是未登录」）。
 *
 * 两个函数都保留，别合并：
 * - isSchoolDomain：**含**根域 bit.edu.cn。判 cookie 归属用这个。
 * - isSchoolSubdomain：**不含**根域，只要真子域。webvpn 复制 cookie 时用这个。
 */

const ROOT: string = 'bit.edu.cn';
const SSO_HOSTS: string[] = ['sso.bit.edu.cn', 'login.bit.edu.cn'];

function normalize(host: string | null | undefined): string {
  if (host === null || host === undefined) {
    return '';
  }
  return host.trim().replace(/^\.+/, '').toLowerCase();
}

/** 是否 CAS（统一身份认证）域。 */
export function isSsoDomain(host: string | null | undefined): boolean {
  const h: string = normalize(host);
  if (h.length === 0) {
    return false;
  }
  for (let i = 0; i < SSO_HOSTS.length; i++) {
    if (h === SSO_HOSTS[i] || h.endsWith('.' + SSO_HOSTS[i])) {
      return true;
    }
  }
  return false;
}

/** 是否学校域（**含**根域 bit.edu.cn 本身）。 */
export function isSchoolDomain(host: string | null | undefined): boolean {
  const h: string = normalize(host);
  return h === ROOT || h.endsWith('.' + ROOT);
}

/** 是否学校域的**真子域**（**不含**根域 bit.edu.cn 本身）。 */
export function isSchoolSubdomain(host: string | null | undefined): boolean {
  const h: string = normalize(host);
  return h.endsWith('.' + ROOT);
}
