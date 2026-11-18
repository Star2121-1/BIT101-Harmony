/**
 * 自动重登的**纯决策逻辑**（无 @kit、无网络、无 I/O，离线单测可跑）。
 *
 * 依据 `BIT101-seat/docs/session-map.md`：CAS 登录**占用一次额度**，短时间多次会触发
 * 学校风控（短信二次验证、冷却约 8 小时）。所以自动重登必须克制，判据全部在这里：
 *
 * 1. 只有「会话确实失效」的取数失败才触发（由调用方判定，不靠这里猜）；
 * 2. 两次自动重登之间至少 `MIN_RETRY_MS`（默认 10 分钟）—— 挡住多子系统同时报失效
 *    造成的连发；进程级单例 + 时间闸门双保险；
 * 3. 连续失败达到 `MAX_FAILS_BEFORE_FREEZE` 次 ⇒ 冻结到 `freezeUntilMs`，期间不再自动试
 *    （防止密码错了还反复撞 CAS 风控）；
 * 4. 需要短信二验 / 图形验证码 ⇒ 一律停手交回用户，绝不自动猜码；
 * 5. 凭据为空 ⇒ 不自动重登，如实报「需手动登录」。
 *
 * ⚠️ 「重登成功」只表示拿到新会话，**不表示业务数据可用**；调用方必须重试原请求并
 *    再判一次结果。这里不做任何「降级后看着正常」的假通过。
 */

/** 触发一次自动重登所需的最小间隔（毫秒）。10 分钟：足够挡同一次失效的连锁触发。 */
export const MIN_RETRY_MS: number = 10 * 60 * 1000;
/** 连续失败达到这个次数就冻结（默认 3 次）。 */
export const MAX_FAILS_BEFORE_FREEZE: number = 3;
/** 冻结时长（毫秒）：默认 8 小时，对齐 CAS 风控冷却量级。 */
export const FREEZE_MS: number = 8 * 60 * 60 * 1000;

/** 会话失效后自动重登的结果分类（与 CasLoginService.LoginStatus 解耦，纯字符串）。 */
export type RenewKind =
  | 'renewed'      // 重登成功，调用方应重试原请求
  | 'skipped'      // 节流窗口内 / 冻结中，本次不试
  | 'no_credential'// 用户没开启记住密码，需手动登录
  | 'need_user'    // 触发短信/图形验证码，必须用户介入（不自动猜码）
  | 'bad_cred'     // 密码错误，凭据应清除
  | 'failed';      // 其它失败（网络/服务端），如实报

export interface RenewDecision {
  kind: RenewKind;
  /** 给用户看的一句话（中文，不含敏感值）。 */
  message: string;
}

/** 可序列化的节流状态（落盘，防进程重启绕过闸门）。 */
export interface RenewThrottle {
  lastAttemptMs: number;
  consecutiveFails: number;
  freezeUntilMs: number;
}

export function emptyThrottle(): RenewThrottle {
  return { lastAttemptMs: 0, consecutiveFails: 0, freezeUntilMs: 0 };
}

/**
 * 本次是否允许发起自动重登。纯函数，不改入参。
 * @param hasCredential 是否已 opt-in 存了凭据
 * @param nowMs 当前时间戳（注入，便于单测）
 */
export function canAttempt(t: RenewThrottle, hasCredential: boolean, nowMs: number): boolean {
  if (!hasCredential) {
    return false;
  }
  if (t.freezeUntilMs > nowMs) {
    return false;
  }
  if (t.lastAttemptMs > 0 && nowMs - t.lastAttemptMs < MIN_RETRY_MS) {
    return false;
  }
  return true;
}

/**
 * 为什么不允许（用于如实告诉用户/日志），仅在 canAttempt=false 时调用。
 * 优先级：无凭据 > 冻结中 > 冷却中。
 */
export function skipReason(t: RenewThrottle, hasCredential: boolean, nowMs: number): string {
  if (!hasCredential) {
    return '未开启记住密码，需要手动登录';
  }
  if (t.freezeUntilMs > nowMs) {
    const mins: number = Math.ceil((t.freezeUntilMs - nowMs) / 60000);
    return '连续失败已暂停自动续期，约 ' + mins + ' 分钟后可再试（或手动登录）';
  }
  return '刚刚尝试过，稍后再试（或手动登录）';
}

/** 把一次尝试的结果折算成「下一次节流状态」。纯函数，不改入参。 */
export function nextThrottle(t: RenewThrottle, kind: RenewKind, nowMs: number): RenewThrottle {
  if (kind === 'renewed') {
    return { lastAttemptMs: nowMs, consecutiveFails: 0, freezeUntilMs: 0 };
  }
  // need_user / no_credential / skipped 不算「撞风控的失败」，不加失败计数；
  // bad_cred / failed 才算（这两类才是反复重试会加重风控的）。
  if (kind !== 'bad_cred' && kind !== 'failed') {
    return { lastAttemptMs: nowMs, consecutiveFails: t.consecutiveFails, freezeUntilMs: t.freezeUntilMs };
  }
  const fails: number = t.consecutiveFails + 1;
  return {
    lastAttemptMs: nowMs,
    consecutiveFails: fails,
    freezeUntilMs: fails >= MAX_FAILS_BEFORE_FREEZE ? nowMs + FREEZE_MS : t.freezeUntilMs
  };
}

/** CAS 登录状态字符串 → 自动重登结果分类（唯一映射处）。 */
export function classifyCasStatus(status: string): RenewKind {
  if (status === 'ok') {
    return 'renewed';
  }
  if (status === 'sms_required' || status === 'captcha_required') {
    return 'need_user';
  }
  if (status === 'bad_credentials') {
    return 'bad_cred';
  }
  return 'failed';
}

export function decision(kind: RenewKind, message: string): RenewDecision {
  return { kind: kind, message: message };
}

/** 各类结果的默认用户文案。 */
export function messageFor(kind: RenewKind): string {
  if (kind === 'need_user') {
    return '会话已过期，学校要求短信/图形验证，请到登录页手动登录';
  }
  if (kind === 'bad_cred') {
    return '记住的密码已失效，请到登录页重新登录';
  }
  if (kind === 'no_credential') {
    return '会话已过期，请登录';
  }
  if (kind === 'renewed') {
    return '会话已自动续期';
  }
  if (kind === 'skipped') {
    return '会话已过期，请稍后重试或手动登录';
  }
  return '会话续期失败，请手动登录';
}
