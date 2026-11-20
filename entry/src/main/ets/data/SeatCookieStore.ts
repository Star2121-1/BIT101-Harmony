/**
 * 座位专用 cookie 持久化（座位 500 方案 A′）。
 *
 * 独立 key `seatlib_cookies_v1`，**不动** school_cookies_v1：
 * - 登录成功后从 JAR_CAS 罐筛 seatlib 域 cookie 落盘（appendFromCas）；
 * - silentRenewJwt 恢复时把这份 cookie 一并灌进 JAR_CAS，打 /api/cas/user 才带得上。
 *
 * 好处：test-seat500rc「school_cookies_v1 无 seatlib」的事实继续成立，
 * test-sso「只下沉 sso 域不串罐」语义不破；登出时清空本 key（接入 SessionStore.logoutAll）。
 */

import { rcp } from '@kit.RemoteCommunicationKit';
import { Prefs } from './Prefs.ts';
import { PersistedCookie, RcpFactory } from '../core/net/RcpFactory.ts';
import { filterSeatlibCookies } from '../corelogic/SeatCookieLogic.ts';
import { info, warn } from '../core/log/BitLog.ts';

const KEY_SEATLIB_COOKIES: string = 'seatlib_cookies_v1';

export class SeatCookieStore {
  /** 读回 seatlib cookie；无或损坏返回 []（不抛）。 */
  static async load(): Promise<PersistedCookie[]> {
    const json: string = await Prefs.getString(KEY_SEATLIB_COOKIES, '');
    if (json.length === 0) return [];
    try {
      const arr: Object = JSON.parse(json) as Object;
      if (!Array.isArray(arr)) return [];
      const out: PersistedCookie[] = [];
      for (const raw of arr as Array<Object>) {
        if (raw === null || typeof raw !== 'object') continue;
        const o = raw as Record<string, Object>;
        const name: string = typeof o['name'] === 'string' ? o['name'] as string : '';
        const domain: string = typeof o['domain'] === 'string' ? o['domain'] as string : '';
        if (name.length === 0 || domain.length === 0) continue;
        out.push({
          name: name,
          value: typeof o['value'] === 'string' ? o['value'] as string : '',
          domain: domain,
          path: typeof o['path'] === 'string' ? o['path'] as string : '/'
        });
      }
      return out;
    } catch (e) {
      warn('SeatCookieStore load bad json: ' + JSON.stringify(e));
      return [];
    }
  }

  /**
   * 登录步骤8之后调用：从 JAR_CAS 罐筛 seatlib 域 cookie 落盘。
   * 只写 seatlib 域，校验是纯逻辑 filterSeatlibCookies（离线单测覆盖）。
   * @returns 新增记录数（0 = 罐里此刻没有 seatlib cookie，如实报，不假装成功）
   */
  static async appendFromCas(casRepo: rcp.CookieRepository): Promise<number> {
    const casAll: PersistedCookie[] = await RcpFactory.snapshotCookies(casRepo);
    const seat: PersistedCookie[] = filterSeatlibCookies(casAll);
    if (seat.length === 0) {
      info('SeatCookieStore: no seatlib cookie in JAR_CAS (skip)');
      return 0;
    }
    // read-modify-write：与已有记录按 name@domain 合并，幂等
    const old: PersistedCookie[] = await SeatCookieStore.load();
    const seen: Set<string> = new Set<string>();
    for (const c of old) seen.add(c.name + '@' + c.domain.toLowerCase());
    const merged: PersistedCookie[] = old.slice();
    for (const c of seat) {
      const key: string = c.name + '@' + c.domain.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(c);
    }
    await Prefs.putString(KEY_SEATLIB_COOKIES, JSON.stringify(merged));
    info('SeatCookieStore append count=' + (merged.length - old.length));
    return merged.length - old.length;
  }

  /** 登出清空（接入 SessionStore.logoutAll）。 */
  static async clear(): Promise<void> {
    await Prefs.remove(KEY_SEATLIB_COOKIES);
    info('SeatCookieStore cleared');
  }
}
