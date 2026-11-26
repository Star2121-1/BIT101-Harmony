/**
 * WebView 导航策略的**判定层**（G07-06，对齐 A:InAppWebUrls.kt）。
 *
 * 全 App 只有 `shouldStayInApp` 一份判据（见 WebEntryLogic.ts）：
 * - true（内部域）→ Web 组件自己加载，CAS 会话 cookie 留在 App 内；
 * - false（外部域）→ 调用方 `startAbility` 交系统浏览器，**拦截掉 Web 内导航**。
 *
 * 这里只放纯判定：把一行 URL 变成「要不要拦下来」的布尔值，Node 可单测。
 * 真正的 `startAbility` 在页面侧（需要 UIAbilityContext），不进纯逻辑层。
 */

import { shouldStayInApp } from './WebEntryLogic.ts';

/** 这是一次「主框架导航」还是需要交出去的链接？返回 true 表示拦下交给系统。 */
export function shouldHandOff(url: string | null | undefined): boolean {
  if (url === null || url === undefined || url.trim().length === 0) {
    return false;
  }
  return !shouldStayInApp(url);
}

/** 非 http(s) 的导航（tel:/mailto:/about: 等）不交浏览器也不拦——让 WebView 按自身能力处理。 */
export function isHttpUrl(url: string | null | undefined): boolean {
  if (url === null || url === undefined) {
    return false;
  }
  const s: string = url.trim();
  return s.startsWith('http://') || s.startsWith('https://');
}
