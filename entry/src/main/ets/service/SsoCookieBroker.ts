/**
 * CAS 会话下沉（M16-1）：把登录页拿到的 `sso.bit.edu.cn` / `login.bit.edu.cn` cookie
 * 复制进业务罐，让图书馆/一卡通在 302 到 CAS 时能被静默认出来。
 *
 * 背景见 `corelogic/SsoCookieLogic.ts`。这里只做 I/O：
 * - 从 `SchoolCookieStore` 读全量学校 cookie；
 * - 纯函数筛出 CAS 域；
 * - 灌进目标 `CookieRepository`。
 *
 * ⚠️ 只复制 CAS 域，不复制 jxzx/lib/card 业务 cookie。跨子系统串 cookie 会让
 * 服务端把 A 子系统的会话当成 B 的，比“没登录”更难查。
 */

import { PersistedCookie, RcpFactory } from '../core/net/RcpFactory.ts';
import { SchoolCookieStore } from '../data/SchoolCookieStore.ts';
import { ssoSeedCookies } from '../corelogic/SsoCookieLogic.ts';
import { rcp } from '@kit.RemoteCommunicationKit';
import { info, warn } from '../core/log/BitLog.ts';

export class SsoCookieBroker {
  /**
   * 把 CAS 域 cookie 灌进目标罐。
   * @returns 灌入条数；0 = 没有 CAS 会话（用户还没登录过 / 已登出）
   */
  static async seed(targetJar: string): Promise<number> {
    try {
      const all: PersistedCookie[] = await SchoolCookieStore.load();
      const seed: PersistedCookie[] = ssoSeedCookies(all);
      if (seed.length === 0) {
        return 0;
      }
      const repo: rcp.CookieRepository = RcpFactory.cookieRepo(targetJar);
      const n: number = await RcpFactory.restoreCookies(repo, seed);
      info('SsoCookieBroker seed jar=' + targetJar + ' count=' + n);
      return n;
    } catch (e) {
      warn('SsoCookieBroker seed fail jar=' + targetJar + ': ' + JSON.stringify(e));
      return 0;
    }
  }
}
