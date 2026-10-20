/**
 * 日志 + 脱敏。**全 App 只有这一份**（对照 Android SeatLog.mask）。
 *
 * 红线（继承裸协议探针 SOP）：
 * - 密码 / ticket / cas code / JWT / cookie 一律先过 mask() 再进日志；
 * - 日志只写「长度、状态码、布尔」这类非敏感事实。
 *
 * 为什么不用 console.log：hilog 才能按 tag 过滤、才能在真机上用 hilog 工具捞。
 */

import { hilog } from '@kit.PerformanceAnalysisKit';

const DOMAIN: number = 0x00CC;
const TAG: string = 'BIT101';

/** 敏感串打码：保留前 4 + 后 4 + 长度，中间抹掉。 */
export function mask(s: string): string {
  if (s.length === 0) {
    return '(empty)';
  }
  if (s.length <= 10) {
    return '***(' + s.length + ')';
  }
  return s.substring(0, 4) + '***(' + s.length + ')' + s.substring(s.length - 4);
}

/** 只打「有没有」，绝不打值。 */
export function hasText(s: string): string {
  return s.length > 0 ? 'yes' : 'no';
}

export function info(msg: string): void {
  hilog.info(DOMAIN, TAG, '%{public}s', msg);
}

export function warn(msg: string): void {
  hilog.warn(DOMAIN, TAG, '%{public}s', msg);
}

export function error(msg: string): void {
  hilog.error(DOMAIN, TAG, '%{public}s', msg);
}

/** debug 日志（发布版由 hilog 级别天然过滤，这里不主动关闭）。 */
export function debug(msg: string): void {
  hilog.debug(DOMAIN, TAG, '%{public}s', msg);
}
