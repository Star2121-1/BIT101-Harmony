/**
 * 座位授权「点一下免输密码」的**纯决策逻辑**（无 @kit、无网络、无 I/O，离线单测可跑）。
 *
 * ## 背景（2026-11-24 用户诉求）
 * 每次 seatlib 会话失效都要跳登录页输密码，太烦。Android `SeatAutoLogin.renew(allowCredentials=true)`
 * 在**用户点「去授权」**时用已 opt-in 存的凭据自动重登，不用手输。鸿蒙把这条线接上：
 * `AutoReloginService.renew()` 已经存在（一卡通/图书馆在用），座位页之前没调。
 *
 * ## 红线（与 Android SeatAutoLogin 注释一致）
 * - **只在用户显式点击「去授权」时**才允许走凭据直登（会打学校 CAS，风控可能发短信）。
 *   自动路径（进页面、取数失效重试、预约重放）一律只走 cookie 静默续期，绝不走这里。
 * - 短信/图形验证码 ⇒ `need_user`，停手交回登录页本人输码，**绝不自动猜码**。
 * - 没 opt-in 存凭据 ⇒ `no_credential`，跳登录页手输（不猜密码）。
 * - 重登成功（renewed）只表示拿到新 CAS 会话，**还要再换一次 seatlib JWT** 才算座位会话可用；
 *   这一步由调用方做（本逻辑只判"该不该继续"）。
 *
 * 判定全部在这里，页面只负责按结果做 I/O，便于证伪。
 */

import type { RenewKind } from './AutoReloginLogic.ts';

/** 凭据重登后座位页的下一步动作。 */
export type SeatRenewAction =
  | 'renew-jwt-and-retry'  // 重登成功 → 再换 seatlib JWT → 重试取数
  | 'goto-login';          // 需本人介入（无凭据/验证码/密码错/节流/失败）→ 跳登录页

/**
 * 凭据重登结果 → 座位页下一步。纯函数。
 *
 * 只有 `renewed` 才继续（且必须由调用方再换一次 seatlib JWT 才算成功）；
 * 其余（含 skipped/no_credential/need_user/bad_cred/failed）一律交回登录页本人处理。
 */
export function seatRenewAction(kind: RenewKind): SeatRenewAction {
  if (kind === 'renewed') {
    return 'renew-jwt-and-retry';
  }
  return 'goto-login';
}

/** 重登后二次换 JWT 失败时的用户文案（不伪装成功，明确还需本人登录）。 */
export function seatJwtStillExpiredMessage(): string {
  return '账号已重新登录，但座位会话仍未恢复，请点「去授权」重试或重新登录学校账号';
}

/** 未 opt-in 时的入口提示（区别于真失效，引导用户以后可勾选记住密码）。 */
export function seatNoCredentialHint(): string {
  return '座位会话已过期，请重新登录学校账号；下次登录可勾选「记住密码」以免再输密码';
}
