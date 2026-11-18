/**
 * 检查更新服务（#158）：只读 GET /version，不下载、不安装。
 *
 * ## 边界
 * - host `android.bit101.cn`（Android App 的版本接口），**无需 fake-cookie / 学校会话**；
 * - 用独立 cookie 罐，不碰任何业务会话；
 * - 解析与判定交给纯逻辑 `UpdateCheckLogic`（坏数据不谎报、结果不含 APK url）；
 * - 网络失败/非 200/坏 JSON 一律返回 NONE 档（显示空），**不弹错误吓人、不谎报有更新**。
 *
 * 更新一律引导去应用市场，本服务没有任何下载/安装/拉起动作。
 */

import { Context } from '@kit.AbilityKit';
import { RcpFactory } from '../core/net/RcpFactory.ts';
import {
  parseRemoteVersion, decideUpdate, UpdateLevel
} from '../corelogic/UpdateCheckLogic.ts';
import type { UpdateDecision, LocalVersion } from '../corelogic/UpdateCheckLogic.ts';
import { info, warn } from '../core/log/BitLog.ts';

// ⚠️ 必须带尾斜杠：服务端对 /version 回 308 永久重定向到 /version/，
// 而本 session autoRedirect=false（CAS 链纪律）不跟重定向 ⇒ 会拿到 308 而非 200。
// 直接请求 /version/ 绕过（2026-11-18 真机踩坑：曾因 308 误显示"已是最新"=假通过）。
const VERSION_URL: string = 'https://android.bit101.cn/version/';
const TIMEOUT_MS: number = 8000; // 版本检查是附加信息，别让用户等太久

/** 检查一次更新；永不抛，失败返回 NONE 档。 */
export async function checkForUpdate(
  context: Context, local: LocalVersion
): Promise<UpdateDecision> {
  let session: import('@kit.RemoteCommunicationKit').rcp.Session | null = null;
  try {
    session = await RcpFactory.createSession(context, 'bit_version', false, TIMEOUT_MS, TIMEOUT_MS);
    const headers: import('@kit.RemoteCommunicationKit').rcp.RequestHeaders = {
      'User-Agent': 'BIT101-Harmony/version-check',
      'Accept': 'application/json'
    };
    const res = await RcpFactory.getText(session, VERSION_URL, headers);
    if (res.status < 200 || res.status >= 300) {
      warn('VersionCheck http status=' + res.status + ' → no prompt');
      return emptyDecision();
    }
    let raw: Object | null = null;
    try {
      raw = JSON.parse(res.body) as Object;
    } catch (e) {
      warn('VersionCheck bad JSON → no prompt: ' + JSON.stringify(e));
      return emptyDecision();
    }
    const remote = parseRemoteVersion(raw);
    const decision: UpdateDecision = decideUpdate(remote, local);
    info('VersionCheck level=' + decision.level + ' remote=' + (remote !== null ? remote.versionName : 'none'));
    return decision;
  } catch (e) {
    warn('VersionCheck fail → no prompt: ' + JSON.stringify(e));
    return emptyDecision();
  }
}

function emptyDecision(): UpdateDecision {
  return { level: UpdateLevel.NONE, checked: false, message: '', latestName: '', note: '' };
}
