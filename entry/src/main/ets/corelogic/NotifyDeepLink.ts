/**
 * 通知点击 → App 内落点（M7 收尾）。
 *
 * ## 为什么通知必须带落点
 * 「您有 1 门课 10:00 开始」点进去落在首页，用户还得自己找课表 —— 通知的价值就是省这一步。
 *
 * ## 两条通路（与卡片深链共用同一套校验）
 *  - **页签**：写 `bit101Content`（`timetable`/`ddl`/`seat`…），`EntryAbility` → AppStorage → `Index`；
 *  - **独立页**：写 `bit101Page`（`pages/ScorePage` 等），`EntryAbility` → AppStorage → `Index` pushUrl。
 *
 * ⚠️ 校验纪律：页面路径必须是**白名单**里的（来自 `main_pages.json` 的已知页面）。
 *   通知参数由系统透传，形状不可信；脏值一律丢弃，不当作导航指令。
 */

import { sanitizeContentId } from './WidgetDeepLink.ts';

/** 通知种类 → 落点。`kind` 用 `ReminderKind` 的字符串值（不 import 枚举，避免环依赖）。 */
export interface NotifyRoute {
  /** 页签内容 id；空串表示不用页签 */
  content: string;
  /** 独立页路径；空串表示不 push 页面 */
  page: string;
}

/** 空落点（未知通知类型：只打开 App，不乱跳）。 */
const EMPTY_ROUTE: NotifyRoute = { content: '', page: '' };

/** 允许被通知打开的独立页（白名单，与 main_pages.json 中的注册名一致）。 */
const PAGE_WHITELIST: string[] = [
  'pages/ScorePage',
  'pages/DdlPage',
  'pages/ExamPage',
  'pages/TeachingAdjustmentPage',
  'pages/SeatPage',
  'pages/NotifyListPage',
  'pages/SettingsPage',
];

/** 通知种类 → 内容 id / 页面。 */
export function routeOfKind(kind: string): NotifyRoute {
  const k: string = kind.trim().toUpperCase();
  if (k === 'CLASS') {
    return { content: 'timetable', page: '' };
  }
  if (k === 'DDL') {
    return { content: 'ddl', page: '' };
  }
  if (k === 'SEAT_SIGN_IN') {
    return { content: 'seat', page: '' };
  }
  if (k === 'EXAM') {
    return { content: '', page: 'pages/ExamPage' };
  }
  if (k === 'ADJUSTMENT') {
    return { content: '', page: 'pages/TeachingAdjustmentPage' };
  }
  if (k === 'SCORE') {
    return { content: '', page: 'pages/ScorePage' };
  }
  return EMPTY_ROUTE;
}

/**
 * 校验外来内容 id；非法 → 空串（不回落成「首页」以外的猜测）。
 *
 * ⚠️ 直接复用卡片的 `sanitizeContentId`，**不再手抄一份**：
 * 两份「已知内容 id」白名单迟早会漂移（一份加了新页签、另一份没加），
 * 表现就是「卡片能跳、通知跳不了」这种查半天的问题。
 */
export function sanitizeContent(raw: string): string {
  return sanitizeContentId(raw);
}

/** 校验外来页面路径；不在白名单 → 空串（绝不 `pushUrl` 任意串）。 */
export function sanitizePage(raw: string): string {
  const s: string = raw.trim();
  if (s.length === 0) {
    return '';
  }
  for (let i = 0; i < PAGE_WHITELIST.length; i++) {
    if (PAGE_WHITELIST[i] === s) {
      return s;
    }
  }
  return '';
}

/** 通知参数的键（发通知侧与 EntryAbility 侧共用，防手写错）。 */
export const KEY_NOTIFY_CONTENT: string = 'bit101Content';
export const KEY_NOTIFY_PAGE: string = 'bit101Page';

/**
 * 应用包名 / 入口 Ability —— 与 `AppScope/app.json5` 的 `bundleName` 一致。
 *
 * ⚠️ 这里和 `InstantNotify`、`ReminderScheduler`、卡片三处都要用，**只能有一份**：
 * 复制出去改包名时漏改一处，那条通路的点击就「静默失效」——点了没反应且没有任何报错。
 */
export const BUNDLE_NAME: string = 'cn.bit101.next';
export const ENTRY_ABILITY: string = 'EntryAbility';

/** AppStorage 键（EntryAbility 写、Index 读后清空）。 */
export const STORAGE_OPEN_PAGE: string = 'ui_open_page';
