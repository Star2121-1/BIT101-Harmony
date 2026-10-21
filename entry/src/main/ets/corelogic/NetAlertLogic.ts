/**
 * 校园网提醒的**判定逻辑**（M7-4，纯函数；发送在 M7-2 的代理提醒里）。
 *
 * 1:1 对照 Android：
 *  - `features/notify/NetFlowChecker.kt`（流量 270 / 300 GB，每周期各一次）
 *  - `features/notify/NetFeeCheckWorker.kt` 里的 `NetFeeChecker`（余额 < 10 元，按天去重）
 *  - `features/notify/NotifyCenter.kt` 的两段文案（逐字照搬）
 *
 * ## 两条提醒的关键差异
 *
 * | | 流量 270/300 GB | 余额 < 10 元 |
 * |---|---|---|
 * | 频率 | **每计费周期各一次**（之后不再打扰） | **每天最多一次** |
 * | 复位 | 换周期（累计值变小）自动复位 | 天然按天 |
 * | 阈值 | 硬编码（套餐固定，与官方门户同口径） | 硬编码 10 元 |
 *
 * ## 判断时机
 *
 * 深澜接口**只有校园网内可达**，每日定时任务的触发时刻固定，人在校外就永远落空；
 * 而「**刚成功取到数据**」正是人在校内的确证 ⇒ 前台取数成功那一刻判一次，
 * 定时任务只是兜底（Android 原注释）。
 */

import { LIMIT_BYTES, WARN_BYTES, formatTraffic } from './CampusNetLogic.ts';

/** 余额低于该值（元）提醒充值。 */
export const NET_FEE_THRESHOLD_YUAN: number = 10.0;

/** 流量提醒类型：'none' 表示不发。 */
export type FlowAlert = 'none' | 'near' | 'exceeded';

/**
 * 该发哪种流量提醒。
 *
 * 已越过 300 GB 时**不再补发 270 GB 那条** —— 两条一起弹是打扰，且 300 那条更准确。
 */
export function decideFlowAlert(usedBytes: number, warnedNear: boolean, warnedLimit: boolean): FlowAlert {
  if (usedBytes >= LIMIT_BYTES && !warnedLimit) return 'exceeded';
  if (usedBytes >= WARN_BYTES && !warnedNear) return 'near';
  return 'none';
}

/** 余额是否低于阈值（要不要发网费提醒）。 */
export function decideFeeAlert(balanceYuan: number): boolean {
  return balanceYuan < NET_FEE_THRESHOLD_YUAN;
}

/** 网费提醒的去重键（按自然日；与 Android `netfee_low_<date>` 同格式）。 */
export function feeDedupeKey(isoDate: string): string {
  return 'netfee_low_' + isoDate;
}

/** 流量提醒标题。 */
export function flowAlertTitle(alert: FlowAlert): string {
  if (alert === 'near') return '校园网流量接近限速阈值';
  if (alert === 'exceeded') return '校园网流量已超限速阈值';
  return '';
}

/** 流量提醒正文（与 Android 逐字一致）。 */
export function flowAlertBody(alert: FlowAlert, usedBytes: number): string {
  const used: string = formatTraffic(usedBytes);
  const limit: string = formatTraffic(LIMIT_BYTES);
  if (alert === 'near') return '本月已用 ' + used + '（限速阈值 ' + limit + '），超出后将限速';
  if (alert === 'exceeded') return '本月已用 ' + used + '，已超过 ' + limit + '，网速可能被限制';
  return '';
}

/** 网费提醒正文（与 Android 逐字一致：`¥%.2f` 两位小数）。 */
export function feeAlertBody(balanceYuan: number): string {
  return '校园网余额仅剩 ¥' + balanceYuan.toFixed(2) + '（低于 ' + NET_FEE_THRESHOLD_YUAN + ' 元），记得充值';
}

/** 网费提醒标题。 */
export function feeAlertTitle(): string {
  return '网费不足';
}
