/**
 * 成绩检查的**结果状态**纯逻辑（M7-3）：分类码 + 编码/解析 + 人话文案。
 *
 * 1:1 移植自 Android `data/score/ScoreCheckStore.kt` 里**不碰文件**的那部分
 *（`Code` / `Status` / `encode` / `parse` / `humanReason` / `statusText`）。
 * 文件读写（`filesDir/score_last_check_status`）留给 M10-2 的取数管道。
 *
 * ## 为什么要有它
 * 成绩检查走「用账密做一次学校 SSO 登录」的异步流程，**是否被学校风控拦下
 * 由学校决定**（可能 `waiting_sms`），而检查又是后台静默跑的 —— 不给用户一个
 * 可见状态，「出分提醒为什么没响」就完全无从判断。
 *
 * ## 失败分类的纪律（照 Android 原注释）
 * `AUTH_FAILED`（学校明确拒绝登录，典型=学号密码错）**绝不能**写成「稍后重试」
 * —— 重试永远不会成功；`FAILED`（网络/接口异常）才值得「稍后重试」。
 */

/** 检查结果分类（值与 Android `Code.name` 一致，编码时直接写进存储串）。 */
export const ScoreCheckCode = {
  /** 成功拿到成绩表（Status.count 是解析出的课程数）。 */
  OK: 'OK',
  /** 学校要求短信二次验证 —— 后台没有交互通道，本次放弃。 */
  NEED_SMS: 'NEED_SMS',
  /** 轮询超时（挑战一直没就绪）。 */
  TIMEOUT: 'TIMEOUT',
  /** 学校未通过本次登录（重试无效；典型=学号密码错，先确认凭据）。 */
  AUTH_FAILED: 'AUTH_FAILED',
  /** 网络 / 接口异常（这类才值得「稍后重试」）。 */
  FAILED: 'FAILED',
  /** 没登录（学号密码为空）。 */
  NOT_LOGGED_IN: 'NOT_LOGGED_IN'
} as const;
export type ScoreCheckCode = (typeof ScoreCheckCode)[keyof typeof ScoreCheckCode];

/** 全部合法码（parse 校验用；未知码 → 整条丢弃，不猜）。 */
export const ALL_SCORE_CODES: ScoreCheckCode[] = [
  ScoreCheckCode.OK,
  ScoreCheckCode.NEED_SMS,
  ScoreCheckCode.TIMEOUT,
  ScoreCheckCode.AUTH_FAILED,
  ScoreCheckCode.FAILED,
  ScoreCheckCode.NOT_LOGGED_IN
];

/** 最近一次检查的状态。 */
export interface ScoreCheckStatus {
  atMillis: number;
  code: ScoreCheckCode;
  /** 解析出的课程数（仅 OK 有意义）。 */
  count: number;
  /** 服务端给的失败原因原文（如 `用户名或密码错误 [status=401, …]`）。 */
  detail: string | null;
}

/** 编码为存储串（`毫秒|CODE|条数[|原因]`；detail 没有就不写第 4 段）。 */
export function encode(status: ScoreCheckStatus): string {
  const base: string = status.atMillis + '|' + status.code + '|' + status.count;
  const d: string = sanitizeDetail(status.detail);
  return d.length > 0 ? base + '|' + d : base;
}

/**
 * 解析存储串；形状不对返回 null（不猜）。
 * 兼容两种格式：老三段 `时刻|CODE|条数`、新四段 `时刻|CODE|条数|原因`。
 */
export function parse(raw: string | null): ScoreCheckStatus | null {
  if (raw === null) {
    return null;
  }
  const trimmed: string = raw.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const parts: string[] = trimmed.split('|');
  if (parts.length < 2) {
    return null;
  }
  const at: number = Number(parts[0]);
  if (!Number.isFinite(at)) {
    return null;
  }
  // 码必须是已知值之一（未知码不猜，整条丢弃）
  let code: ScoreCheckCode | null = null;
  for (let i = 0; i < ALL_SCORE_CODES.length; i++) {
    if (ALL_SCORE_CODES[i] === parts[1]) {
      code = ALL_SCORE_CODES[i];
      break;
    }
  }
  if (code === null) {
    return null;
  }
  const countRaw: number = Number(parts[2]);
  const count: number = Number.isFinite(countRaw) ? countRaw : 0;
  // 第 4 段之后重新拼起来：万一原因里混进了 `|` 也不至于丢内容
  const detail: string = parts.slice(3).join('|');
  return { atMillis: at, code: code, count: count, detail: detail.length > 0 ? detail : null };
}

/**
 * 服务端原因里**对人有用**的那一段。
 *
 * 真实形状 `用户名或密码错误 [status=401, redirects=0, …]` —— 方括号里是排查用的
 * 技术细节，直接摆出来只会淹没真正的原因。所以只取 `[` 之前；没有方括号原样返回。
 */
export function humanReason(detail: string | null): string | null {
  if (detail === null) {
    return null;
  }
  const head: string = detail.substring(0, detail.indexOf('[') < 0 ? detail.length : detail.indexOf('[')).trim();
  if (head.length === 0) {
    return null;
  }
  return head.length > 60 ? head.substring(0, 60) : head;
}

/** 设置页显示文案（纯函数，可单测；时间由 atMillis 取本地 MM-dd HH:mm）。 */
export function statusText(status: ScoreCheckStatus | null): string {
  if (status === null) {
    return '还没检查过（下次打开 App 时检查）';
  }
  const time: string = fmtCheckTime(status.atMillis);
  const what: string = whatText(status);
  return '最近检查：' + time + ' · ' + what;
}

function whatText(s: ScoreCheckStatus): string {
  switch (s.code) {
    case ScoreCheckCode.OK:
      return '已同步 ' + s.count + ' 门课';
    case ScoreCheckCode.NEED_SMS:
      return '学校要求短信验证，已暂停自动检查';
    case ScoreCheckCode.TIMEOUT:
      return '认证超时，稍后重试';
    case ScoreCheckCode.AUTH_FAILED: {
      // ⚠️ 不能写「稍后重试」：学校明确拒绝了，重试还是同样结果
      let t: string = '学校未通过本次登录';
      const reason: string | null = humanReason(s.detail);
      if (reason !== null) {
        t = t + '：' + reason;
      }
      return t + '（重试无效，请先确认学号与密码）';
    }
    case ScoreCheckCode.FAILED:
      return '获取失败，稍后重试';
    case ScoreCheckCode.NOT_LOGGED_IN:
      return '未登录，先登录才能检查';
    default:
      return '未知状态';
  }
}

/** atMillis → 本地 `MM-dd HH:mm`（与 Android TIME_FORMAT 同口径）。 */
export function fmtCheckTime(atMillis: number): string {
  const d: Date = new Date(atMillis);
  const mm: string = String(d.getMonth() + 1).padStart(2, '0');
  const dd: string = String(d.getDate()).padStart(2, '0');
  const hh: string = String(d.getHours()).padStart(2, '0');
  const mi: string = String(d.getMinutes()).padStart(2, '0');
  return mm + '-' + dd + ' ' + hh + ':' + mi;
}

/** 落盘前净化 detail（限长 200；去换行避免破坏单行存储格式）。 */
function sanitizeDetail(detail: string | null): string {
  if (detail === null) {
    return '';
  }
  const clean: string = detail.replace(/[\r\n\t|]/g, ' ');
  return clean.length > 200 ? clean.substring(0, 200) : clean;
}
