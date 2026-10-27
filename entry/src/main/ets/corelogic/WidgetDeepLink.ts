/**
 * 卡片点击 → App 内的落点（M8-6）。
 *
 * ## 为什么不能只「打开 App」
 * 用户看一眼卡片上的第 3 节课，点进去却落在课表首页还要自己找 —— 那就白点了。
 * 所以卡片把「当前页对应哪个内容」作为参数带进 want，App 起来后直接落到那个页签。
 *
 * ## 形状
 * 卡片侧：`postCardAction(this, { action:'router', bundleName, abilityName, params:{ bit101Content:'ddl' } })`
 * App 侧：`EntryAbility.onCreate` 读到参数 → `AppStorage['ui_open_content']` → `Index` 消费。
 *
 * ⚠️ 参数值只允许落在**已知内容 id** 上（未知值一律丢掉，不回落）：
 * 卡片 payload 来自 JSON 解析，脏值不能被当成导航指令。
 */

import { isKnownModule, isKnownTab, normalizeModule } from './shellNav.ts';

/** 卡片页 kind（与 `WidgetLogic.PageKind` 的字符串值一致）→ 内容 id。 */
export function contentIdForKind(kind: string): string {
  if (kind === 'COURSE') {
    return 'timetable';
  }
  if (kind === 'DDL') {
    return 'ddl';
  }
  if (kind === 'ACTIVITY') {
    return 'feed';
  }
  if (kind === 'SEAT') {
    return 'seat';
  }
  if (kind === 'STUDY') {
    return 'classroom';
  }
  // 认不出的 kind：落回课表（默认落地页），但仍然是个**明确**的值
  return 'timetable';
}

/**
 * 校验外来参数是否为合法内容 id。
 * @returns 合法则返回规范化后的值，非法返回空串（调用方据此忽略）
 */
export function sanitizeContentId(raw: string): string {
  const s: string = raw.trim();
  if (s.length === 0) {
    return '';
  }
  if (isKnownTab(s)) {
    return s;
  }
  if (isKnownModule(s)) {
    return normalizeModule(s);
  }
  return '';
}

/** 卡片动作用的 param 键（卡片侧与 App 侧两个常量必须一致，单独抽出来防手写错）。 */
export const KEY_CARD_CONTENT: string = 'bit101Content';

/** `AppStorage` 里传递深链目标的键（EntryAbility 写、Index 读并清空）。 */
export const STORAGE_OPEN_CONTENT: string = 'ui_open_content';
