/**
 * 校园网（深澜 Srun）`cgi-bin/rad_user_info` 响应的解析与格式化（纯函数）。
 * 1:1 对照 Android `data/school/CampusNetLogic.kt`。
 *
 * 响应是一行逗号分隔的 CSV，字段映射（Android 用两个间隔 6s 的样本对照得出）：
 * `[0]` 账号、`[1]` 本次上线时间、`[2]` 服务器时间、`[3]/[4]` 本次收/发字节、
 * `[6]` 已用流量（按计费周期累计 = 官方口径的「本月」）、`[7]` 累计在线时长(秒)、
 * `[8]` IP、`[11]` 账户余额(元)。
 *
 * 2026-10-21 本机实测（校园网内）响应形态与上表完全一致，字段位置未变；
 * **单测 fixture 用合成值**（真实响应含学号/IP，公开仓库不留）。
 *
 * ⚠️ **免登录**：该接口在校园网内任意 IP 可访问（返回请求方所在 NAT 的在线
 * 会话）；校外访问不通 —— UI 据此提示「需校园网环境」。
 */

/** 在线信息（解析产物）。 */
export interface CampusNetInfo {
  userName: string;
  /** 本次上线时间（epoch 秒）。 */
  loginEpochSeconds: number;
  /** 服务器时间（epoch 秒）。界面不直接展示，用于校验数据新鲜度/单测。 */
  nowEpochSeconds: number;
  bytesIn: number;
  bytesOut: number;
  /** 已用流量（字节）。按计费周期累计，官方门户显示为「本月」。 */
  bytesTotal: number;
  /** 本周期在线时长（秒）。⚠️ 按设备累计，同时多设备会各记一份，可能超过一个月。 */
  durationSeconds: number;
  ip: string;
  /** 账户余额（元）—— 网费不足提醒的数据源。 */
  balanceYuan: number;
}

/**
 * 请求结果。**必须分三种**（Android 原注释：三件事塌成 null 时，
 * UI 一律显示「需连接校园网」，用户明明在校内也无从下手，2026-09-25 实测踩到）。
 */
export type CampusNetResult =
  | { kind: 'online'; info: CampusNetInfo }
  /** 接口通了但请求方**没有在线会话**（`not_online`）—— 可处置：去认证页登录。 */
  | { kind: 'notOnline' }
  /** 连不上 / 超时 / 响应无法识别（多半不在校园网内）。 */
  | { kind: 'failed'; reason: string };

/** 限速阈值：本月 300 GB 后限速（套餐固定，硬编码；与官方门户同口径）。 */
export const LIMIT_BYTES: number = 300 * 1024 * 1024 * 1024;

/** 提前提醒线：270 GB（限速阈值的 90%）。 */
export const WARN_BYTES: number = 270 * 1024 * 1024 * 1024;

/** 只看「有数据」的调用方用（其余两种都返回 null）。 */
export function infoOrNull(r: CampusNetResult): CampusNetInfo | null {
  return r.kind === 'online' ? r.info : null;
}

/** 纯数字串 → number；空串/非数字 → null（`Number('') === 0` 不能直接用）。 */
function numOrNull(text: string): number | null {
  const t: string = text.trim();
  if (!/^-?\d+$/.test(t)) return null;
  const v: number = Number(t);
  return Number.isFinite(v) ? v : null;
}

/** 纯小数字串 → number；空串/非数字 → null。 */
function decOrNull(text: string): number | null {
  const t: string = text.trim();
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  const v: number = Number(t);
  return Number.isFinite(v) ? v : null;
}

/**
 * 解析 CSV；不是合法响应（`not_online` / 错误页 / 空串 / 字段不足）时返回 null。
 */
export function parse(body: string): CampusNetInfo | null {
  const fields: string[] = body.trim().split(',');
  const trimmed: string[] = [];
  for (let i = 0; i < fields.length; i++) {
    trimmed.push(fields[i].trim());
  }
  if (trimmed.length < 12) return null;
  if (trimmed[0].length === 0 || trimmed[0].indexOf(' ') >= 0) return null;

  const login: number | null = numOrNull(trimmed[1]);
  const nowSec: number | null = numOrNull(trimmed[2]);
  const bIn: number | null = numOrNull(trimmed[3]);
  const bOut: number | null = numOrNull(trimmed[4]);
  const bTotal: number | null = numOrNull(trimmed[6]);
  const dur: number | null = numOrNull(trimmed[7]);
  const balance: number | null = decOrNull(trimmed[11]);
  if (login === null || nowSec === null || bIn === null || bOut === null
    || bTotal === null || dur === null || balance === null) {
    return null; // 数字字段坏了 = 响应形态不认识，不猜
  }
  return {
    userName: trimmed[0],
    loginEpochSeconds: login,
    nowEpochSeconds: nowSec,
    bytesIn: bIn,
    bytesOut: bOut,
    bytesTotal: bTotal,
    durationSeconds: dur,
    ip: trimmed[8],
    balanceYuan: balance
  };
}

/**
 * 解析响应并**区分**「未在线」与「响应不可识别」。
 *
 * Srun 在请求方没有在线会话时返回短文本 `not_online`（不是 CSV）——
 * 这与「不在校内 / 请求失败」是两件事，分开才能给出可处置的提示。
 */
export function parseResult(body: string): CampusNetResult {
  const info: CampusNetInfo | null = parse(body);
  if (info !== null) return { kind: 'online', info: info };
  if (body.toLowerCase().indexOf('not_online') >= 0) return { kind: 'notOnline' };
  return { kind: 'failed', reason: '响应无法识别' };
}

/**
 * 本月流量的完整表述：`366.4 GB / 300.0 GB（已超限速阈值）`。
 */
export function trafficStatusText(bytes: number): string {
  const used: string = formatTraffic(bytes);
  const limit: string = formatTraffic(LIMIT_BYTES);
  return bytes >= LIMIT_BYTES ? used + ' / ' + limit + '（已超限速阈值）' : used + ' / ' + limit;
}

/** 字节 → GB（1024 进制，保留 1 位小数）。 */
export function formatTraffic(bytes: number): string {
  return (bytes / 1024 / 1024 / 1024).toFixed(1) + ' GB';
}

/** 秒 → 「x 天 x 小时」/「x 小时 x 分」/「x 分钟」。 */
export function formatDuration(seconds: number): string {
  const minutes: number = Math.floor(seconds / 60);
  if (minutes < 60) return minutes + ' 分钟';
  if (minutes < 60 * 48) return Math.floor(minutes / 60) + ' 小时 ' + (minutes % 60) + ' 分';
  return Math.floor(minutes / 60 / 24) + ' 天 ' + (Math.floor(minutes / 60) % 24) + ' 小时';
}

/** epoch 秒 → 「MM-dd HH:mm」（本机时区；展示专用，不参与任何判定）。 */
export function formatTime(epochSeconds: number): string {
  const d: Date = new Date(epochSeconds * 1000);
  const mo: string = String(d.getMonth() + 1).padStart(2, '0');
  const day: string = String(d.getDate()).padStart(2, '0');
  const h: string = String(d.getHours()).padStart(2, '0');
  const mi: string = String(d.getMinutes()).padStart(2, '0');
  return mo + '-' + day + ' ' + h + ':' + mi;
}
