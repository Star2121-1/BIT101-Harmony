/**
 * 校园网在线信息抓取服务（M5-2）。
 *
 * 1:1 对照 Android `data/repo/DefaultCampusNetRepo.kt`：
 * GET `http://10.0.0.55/cgi-bin/rad_user_info`（经典深澜 Srun 接口）。
 *
 * ## 性质
 *
 * - **免登录、免 cookie**：返回请求方所在 NAT 的在线会话；罐永远是空的（JAR_NET）。
 * - **仅校园网内可达** ⇒ 超时给 5/5 秒（内网要么秒回要么根本不通，
 *   等默认 30 秒只会让页面一直转圈）。
 * - **明文 http**：Android 侧需要 network_security_config 放行；HarmonyOS 侧
 *   没有该开关（SDK 里无 cleartext 相关配置项）——真机待验（ROADMAP 风险 R4）。
 *
 * ## 失败要分两类送出（见 CampusNetResult）
 *
 * 「接口通了但没有在线会话（not_online）」与「连不上」是两件事：
 * 前者可处置（去认证页登录），后者多半是不在校园网内。
 */

import { JAR_NET } from '../core/net/CookieJars.ts';
import { Context } from '@kit.AbilityKit';
import { rcp } from '@kit.RemoteCommunicationKit';
import { RcpFactory } from '../core/net/RcpFactory.ts';
import { CampusNetResult, parseResult } from '../corelogic/CampusNetLogic.ts';
import { info, warn } from '../core/log/BitLog.ts';

/** 深澜接口地址（内网明文，固定 IP）。 */
export const NET_API_URL: string = 'http://10.0.0.55/cgi-bin/rad_user_info';

/** 校园网认证页（`not_online` 时引导用户去登录）。 */
export const NET_AUTH_URL: string = 'http://10.0.0.55/';

/** 内网超时（秒级返回，别等默认 30s）。 */
const NET_CONNECT_MS: number = 5000;
const NET_READ_MS: number = 5000;

export class CampusNetService {
  /**
   * 取本机所在 NAT 的校园网在线会话。
   *
   * 结果三态（online / notOnline / failed）原样返回 —— **不在这里塌成 null**。
   */
  static async fetchOnlineInfo(context: Context): Promise<CampusNetResult> {
    try {
      const s: rcp.Session = await RcpFactory.createSession(
        context, JAR_NET, true, NET_CONNECT_MS, NET_READ_MS);
      const headers: rcp.RequestHeaders = {};
      const res = await RcpFactory.getText(s, NET_API_URL, headers);
      if (res.status !== 200) {
        warn('net http status=' + res.status);
        return { kind: 'failed', reason: 'HTTP ' + res.status };
      }
      const result: CampusNetResult = parseResult(res.body);
      info('net fetch kind=' + result.kind + ' len=' + res.body.length);
      return result;
    } catch (e) {
      const msg: string = (e as Error).message;
      warn('net fetch fail: ' + msg);
      return { kind: 'failed', reason: msg };
    }
  }
}
