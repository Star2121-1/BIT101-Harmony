/**
 * BIT101 社区（话廊）鉴权的**纯决策逻辑**（无 @kit、无网络、无 I/O，离线单测可跑）。
 *
 * ## fake-cookie 是什么（2026-11-18 纠正 erf 判断）
 * 不是用户手工抓的票据。`POST https://bit101.flwfdd.xyz/user/login` 传
 * `{sid, password(md5)}` 返回 `{fakeCookie}`，之后每个社区请求带 `fake-cookie` 头。
 * 契约来自 Android 原版 `DefaultLoginRepo.loginBIT101`（api.user.register / login），
 * 我方只读探测确认：假票据 ⇒ 401「请先登录awa」，接口活着。
 *
 * ## 铁律
 * - 密码**只在用户本人 opt-in 并在 App 内输入**时进入 `login` 调用栈，agent 不碰明文；
 * - 401 静默刷新**最多一次**（对齐 Android `DefaultAPIManager`），失败清票据、告知重新登录；
 * - 刷新也要用存的用户凭据；没有凭据 ⇒ 不自动，报「需登录」；
 * - 刷新成功只表示拿到新票据，调用方必须重试原请求再判结果，不假通过。
 */

/** 社区鉴权结果分类（与网络层解耦，纯字符串）。 */
export type CommunityAuthKind =
  | 'ok'          // 拿到 fakeCookie
  | 'no_cred'     // 没存学号密码，需用户手动登录
  | 'bad_cred'    // 用户名/密码错，清凭据
  | 'need_user'   // 需要用户介入（短信/验证码等）
  | 'failed';     // 其它失败（网络/服务端），如实报

export interface CommunityAuthDecision {
  kind: CommunityAuthKind;
  message: string;
}

/** 是否有资格自动刷新票据（对齐 Android：401 只静默刷一次）。 */
export function canRefresh(hasCredential: boolean, attempts: number): boolean {
  return hasCredential && attempts < 1;
}

export function decision(kind: CommunityAuthKind, message: string): CommunityAuthDecision {
  return { kind: kind, message: message };
}

/** 服务端 msg → 结果分类（唯一映射处，别在各处散着写）。 */
export function classifyLogin(msg: string, httpStatus: number): CommunityAuthKind {
  if (httpStatus >= 200 && httpStatus < 300) {
    return 'ok';
  }
  if (msg.indexOf('密码') >= 0 || msg.indexOf('用户名') >= 0 || httpStatus === 500) {
    // 原版探测：假凭据 ⇒ HTTP 500 +「用户名或密码错误Orz」
    return 'bad_cred';
  }
  if (msg.indexOf('验证') >= 0 || msg.indexOf('captcha') >= 0) {
    return 'need_user';
  }
  return 'failed';
}

export function messageFor(kind: CommunityAuthKind): string {
  if (kind === 'no_cred') {
    return '社区未登录，请在话廊页登录';
  }
  if (kind === 'bad_cred') {
    return '社区账号密码已失效，请重新登录';
  }
  if (kind === 'need_user') {
    return '社区要求验证，请手动登录';
  }
  if (kind === 'failed') {
    return '社区登录失败（网络或服务端），请稍后重试';
  }
  return '社区会话已续期';
}
