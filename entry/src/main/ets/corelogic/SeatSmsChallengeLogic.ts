/**
 * S-02 座位短信二验「就地码框」纯决策逻辑（无 @kit / 无网络 / 无 I/O，离线单测可跑）。
 *
 * ## 对照 Android
 * - `A/features/seat/.../api/SeatSmsChallenge.kt`：WAIT_CODE_TIMEOUT_MS = 5*60_000，
 *   超时按登录失败处理、输入框自动收起、文案「验证码输入超时，请重新授权」；
 *   submit(code) trim 后空串不提交；cancel 复位 pending。
 * - `A/ui/component/SmsCodeDialog.kt`：座位页顶层就地码框（不是跳登录页）。
 *
 * ## 红线（与 Android 对齐且更严）
 * - 学校短信**只在用户显式点「去授权」**触发（SeatPage.authorizeSeat 的 4 个调用点全在 onClick）；
 *   自动路径（进页面/取数失效重试/预约重放）绝不走这里，绝不发无人短信。
 * - 本逻辑**不代收、不猜码、不发第二条短信**：验证码错误由 CasLoginService 停手，
 *   用户取消由 clearPending 复位。这里只判「该弹框 / 该收起 / 是否超时」。
 */

/** 等待用户输验证码的上限（对齐 Android SeatSmsChallengeHub.WAIT_CODE_TIMEOUT_MS）。 */
export const SMS_WAIT_TIMEOUT_MS: number = 5 * 60 * 1000; // 5 min

/** 座位重登结果之后，页面该走哪条路。 */
export type SeatSmsRoute =
  | 'retry-jwt'        // renewed：再换 seatlib JWT → 重试取数（原流程不变）
  | 'show-sms-dialog'  // need_user + 已有 pending：就地弹码框（S-02 新增）
  | 'goto-login';      // 无凭据/密码错/节流/失败/需图形验证码：跳登录页本人处理

/**
 * renew 结果 + 是否有 pending 短信 → 页面路由。纯函数。
 *
 * ⚠️ 只有 `need_user` **且** `hasPendingSms()` 才就地弹框——避免把
 * 「图形验证码」「密码错」也错误地引导到短信输入框（那种情况 pending 为空，
 * 仍应跳登录页本人处理）。这正是审计判据「未找到证据前不得写成已实现」的落点。
 */
export function seatSmsRoute(kind: string, hasPendingSms: boolean): SeatSmsRoute {
  if (kind === 'renewed') {
    return 'retry-jwt';
  }
  if (kind === 'need_user' && hasPendingSms) {
    return 'show-sms-dialog';
  }
  return 'goto-login';
}

/** 超时判定（对齐 Android withTimeoutOrNull）：到点即超时。注入 nowMs 便于单测。 */
export function smsWaitExpired(startedAtMs: number, nowMs: number, timeoutMs: number = SMS_WAIT_TIMEOUT_MS): boolean {
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(nowMs) || timeoutMs <= 0) {
    return false; // 脏值不误判超时（宁可多等，不把进行中的输入打断）
  }
  return nowMs - startedAtMs >= timeoutMs;
}

/** 超时文案（对齐 Android IOException("验证码输入超时，请重新授权")）。 */
export function smsTimeoutMessage(): string {
  return '验证码输入超时，请重新授权';
}

/** 是否是可提交的验证码（对齐 Android submit：trim 后非空）。 */
export function smsCodeSubmittable(raw: string): boolean {
  return raw.trim().length > 0;
}
