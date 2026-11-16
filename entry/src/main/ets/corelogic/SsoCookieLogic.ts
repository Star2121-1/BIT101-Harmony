/**
 * CAS 会话下沉的纯逻辑（M16-1）。
 *
 * ## 为什么需要它
 * 鸿蒙现在每个子系统一个 cookie 罐：`bit_school` / `bit_lib` / `bit_card` / `bit_eclass`。
 * 用户在登录页拿到的 CAS 会话只存在 `bit_login` 里，图书馆/一卡通各自去 Web 再登一次，
 * 表现就是「明明登录了，进图书馆还让登录」。
 *
 * Android 的做法是自定义 `SsoAwareCookieJar`：任何请求打到 `sso.bit.edu.cn` 时，
 * 把 CAS 域 cookie 临时补进请求。鸿蒙 rcp 没有自定义 jar 钩子，等价做法是
 * **在打业务入口前，把 CAS 域 cookie 复制进目标罐**；随后 302 到 CAS 时会按 domain
 * 自动带上，CAS 认人后回跳，业务域自己 Set-Cookie 建立会话。
 *
 * ## 只复制 CAS 域
 * 绝不把 `jxzxehall` / `lib` / `card` 的 cookie 乱灌：那会把 A 子系统的会话发给 B。
 * 判据唯一：`isSsoDomain(domain)`（`sso.bit.edu.cn` / `login.bit.edu.cn`）。
 */

import { isSsoDomain } from '../core/net/SchoolDomains.ts';

/** 只需要这四个字段；`PersistedCookie` 结构兼容。 */
export interface SsoSeedCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
}

/** 目标罐（纯字符串，避免 corelogic import @kit）。 */
export type SsoTargetJar = 'lib' | 'card' | 'seat';

/**
 * 从全量学校 cookie 里挑出可以下沉的 CAS cookie。
 * - 只保留 `isSsoDomain` 的域；
 * - 同名同域去重（保留第一条，顺序确定）；
 * - 空 name/domain 丢弃（rcp `setCookies` 需要 domain，猜一个会发错主机）。
 */
export function ssoSeedCookies(cookies: SsoSeedCookie[]): SsoSeedCookie[] {
  const seen: Set<string> = new Set<string>();
  const out: SsoSeedCookie[] = [];
  for (let i = 0; i < cookies.length; i++) {
    const c: SsoSeedCookie = cookies[i];
    if (c.name.length === 0 || c.domain.length === 0 || !isSsoDomain(c.domain)) {
      continue;
    }
    const key: string = c.name + '@' + c.domain.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path.length > 0 ? c.path : '/'
    });
  }
  return out;
}

/** 有没有 CAS 会话可下沉（只看 CAS 域 cookie 是否非空）。 */
export function hasSsoSeed(cookies: SsoSeedCookie[]): boolean {
  return ssoSeedCookies(cookies).length > 0;
}
