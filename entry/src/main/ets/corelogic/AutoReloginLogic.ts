/**
 * 自动重登的**纯决策逻辑**（无 @kit、无网络、无 I/O，离线单测可跑）。
 *
 * 依据 `BIT101-seat/docs/session-map.md`：CAS 登录**占用一次额度**，短时间多次会触发
 * 学校风控（短信二次验证、冷却约 8 小时）。所以自动重登必须克制，判据全部在这里。
 *
 * ## F01-01：两套限流口径（对齐 Android）
 * - **学校身份验证**（identity）：24h × 2^(n-1)，封顶 192h（A:LoginRetryPolicy）
 * - **座位凭据直登**（seat）：成功 30s 冷却 / 失败 5min 退避（A:SeatAutoLogin）
 * - 服务端 `Retry-After`（秒数 / RFC1123）与本地估算**取较大值**。
 *
 * ## 红线（不可放宽）
 * - `need_user` / `no_credential` **不加失败计数、不加冷却**（判据⑤）；
 * - 短信/图形验证码 ⇒ 停手交回用户，绝不自动猜码；
 * - 凭据为空 ⇒ 不自动重登；
 * - 「重登成功」只是拿到新会话，业务数据须调用方重试再判，不做假通过。
 */

/** 学校身份验证基准冷却：24h（A:LoginRetryPolicy.IDENTITY_INTERVAL_MS）。 */
export const IDENTITY_INTERVAL_MS: number = 24 * 60 * 60 * 1000;
/** 座位直登成功后的冷却：30s（A:SeatAutoLogin.SUCCESS_COOLDOWN_MS）。 */
export const SEAT_SUCCESS_COOLDOWN_MS: number = 30 * 1000;
/** 座位直登失败后的退避：5min（A:SeatAutoLogin.FAIL_BACKOFF_MS）。 */
export const SEAT_FAIL_BACKOFF_MS: number = 5 * 60 * 1000;

/** 兼容旧字段：通用最小间隔（10min）。新口径下仅作没有 retryAtMs 的旧数据兜底。 */
export const MIN_RETRY_MS: number = 10 * 60 * 1000;
/** 兼容旧字段：失败冻结阈值（3 次）。新口径下 identity/seat 都按 attempt 退避，此值仅日志参考。 */
export const MAX_FAILS_BEFORE_FREEZE: number = 3;
/** 兼容旧字段：冻结时长（8h）。 */
export const FREEZE_MS: number = 8 * 60 * 60 * 1000;

/** 限流模式：identity = 学校身份验证（长冷却）；seat = 座位凭据直登（短冷却）。 */
export type RenewMode = 'identity' | 'seat';

export type RenewKind =
  | 'renewed'
  | 'skipped'
  | 'no_credential'
  | 'need_user'
  | 'bad_cred'
  | 'failed';

export interface RenewDecision {
  kind: RenewKind;
  message: string;
}

/**
 * 可序列化节流状态。
 * - `retryAtMs`：下一次允许尝试的时间戳（新口径主字段，0 = 无冷却）；
 * - 其余三个字段保留：兼容已落盘的旧数据 + 给 UI 展示失败次数。
 */
export interface RenewThrottle {
  lastAttemptMs: number;
  consecutiveFails: number;
  freezeUntilMs: number;
  retryAtMs?: number;
}

export function emptyThrottle(): RenewThrottle {
  return { lastAttemptMs: 0, consecutiveFails: 0, freezeUntilMs: 0, retryAtMs: 0 };
}

/**
 * 本地冷却时延（毫秒）。attempt 从 1 起，0/负数按 1，>4 截断（A:LoginRetryPolicy）。
 * - identity：24h → 48h → 96h → 192h
 * - seat：失败按 5min 固定退避（成功走 SEAT_SUCCESS_COOLDOWN_MS，见 nextThrottle）
 */
export function localDelay(attempt: number, mode: RenewMode): number {
  const safe: number = Math.max(1, Math.min(4, Math.floor(attempt)));
  if (mode === 'seat') {
    return SEAT_FAIL_BACKOFF_MS;
  }
  return IDENTITY_INTERVAL_MS * (1 << (safe - 1));
}

/**
 * 解析 `Retry-After`（A:LoginRetryPolicy.parseRetryAfter）。
 * 支持纯秒数（'3600'）与 RFC1123（'Wed, 21 Oct 2026 07:28:00 GMT'）。
 * 解析不了返回 null（不抛异常：服务端给的脏头不该影响登录流程）。
 * ⚠️ 秒数用乘法前检查有限性，避免溢出成 Infinity 被当成「永不明显」。
 */
export function parseRetryAfter(nowMs: number, raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined) {
    return null;
  }
  const s: string = raw.trim();
  if (s.length === 0) {
    return null;
  }
  // 纯数字（含负号）按秒处理；负数秒一律无效，别落到 Date.parse 被当成年份
  if (/^-?[0-9]+$/.test(s)) {
    const sec: number = Number(s);
    if (!Number.isFinite(sec) || sec < 0) {
      return null;
    }
    const ms: number = nowMs + sec * 1000;
    return Number.isFinite(ms) ? ms : null;
  }
  const parsed: number = Date.parse(s);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * 下一次允许尝试的时间戳（A:LoginRetryPolicy.retryAt）：
 * 本地估算与服务端 Retry-After **取较大值**（服务端要求晚则听服务端，否则守本地下限）。
 */
export function retryAt(
  nowMs: number, attempt: number, retryAfter: string | null | undefined, mode: RenewMode,
): number {
  const local: number = nowMs + localDelay(attempt, mode);
  const requested: number | null = parseRetryAfter(nowMs, retryAfter);
  return requested === null ? local : Math.max(local, requested);
}

/** 冷却是否已过（A:LoginRetryPolicy.shouldAttempt）。 */
export function shouldAttempt(nowMs: number, atMs: number): boolean {
  return nowMs >= atMs;
}

/**
 * 本次是否允许发起自动重登。纯函数，不改入参。
 * 优先新字段 retryAtMs；旧持久化数据（无 retryAtMs）回落到 freezeUntilMs / MIN_RETRY_MS 闸门。
 */
export function canAttempt(t: RenewThrottle, hasCredential: boolean, nowMs: number): boolean {
  if (!hasCredential) {
    return false;
  }
  const at: number = t.retryAtMs !== undefined ? t.retryAtMs : t.freezeUntilMs;
  if (at > 0 && nowMs < at) {
    return false;
  }
  if (t.retryAtMs === undefined && t.lastAttemptMs > 0 && nowMs - t.lastAttemptMs < MIN_RETRY_MS) {
    return false;
  }
  return true;
}

/** 为什么不允许（仅在 canAttempt=false 时调用）。优先级：无凭据 > 冷却中。 */
export function skipReason(t: RenewThrottle, hasCredential: boolean, nowMs: number): string {
  if (!hasCredential) {
    return '未开启记住密码，需要手动登录';
  }
  const at: number = t.retryAtMs !== undefined ? t.retryAtMs : t.freezeUntilMs;
  const mins: number = Math.ceil((at - nowMs) / 60000);
  return '登录冷却中，约 ' + mins + ' 分钟后可再试（或手动登录）';
}

/**
 * 把一次尝试结果折算成下一次节流状态。纯函数，不改入参。
 * @param retryAfter 服务端 Retry-After 原值（仅失败时参与，与本地估算取大）
 * @param mode 限流模式（默认 identity，座位调用方显式传 'seat'）
 */
export function nextThrottle(
  t: RenewThrottle, kind: RenewKind, nowMs: number,
  mode: RenewMode = 'identity', retryAfter: string | null | undefined = null,
): RenewThrottle {
  if (kind === 'renewed') {
    // 成功：身份模式清冷却；座位模式留 30s 冷却（防止刚成功就再撞一次）
    const at: number = mode === 'seat' ? nowMs + SEAT_SUCCESS_COOLDOWN_MS : 0;
    return {
      lastAttemptMs: nowMs, consecutiveFails: 0, freezeUntilMs: at, retryAtMs: at
    };
  }
  // ⚠️ 红线：need_user / no_credential / skipped 不加失败计数、不加冷却（判据⑤）
  if (kind === 'need_user' || kind === 'no_credential' || kind === 'skipped') {
    return {
      lastAttemptMs: nowMs,
      consecutiveFails: t.consecutiveFails,
      freezeUntilMs: t.freezeUntilMs,
      retryAtMs: t.retryAtMs !== undefined ? t.retryAtMs : 0,
    };
  }
  // bad_cred / failed 才算撞风控的失败 → 退避
  const fails: number = t.consecutiveFails + 1;
  const at: number = retryAt(nowMs, fails, retryAfter, mode);
  return {
    lastAttemptMs: nowMs,
    consecutiveFails: fails,
    freezeUntilMs: at,
    retryAtMs: at,
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
