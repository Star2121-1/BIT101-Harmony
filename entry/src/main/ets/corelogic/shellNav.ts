/**
 * 应用外壳（shell）导航模型 —— 纯逻辑，无 ArkUI 依赖，可 node 直跑单测。
 *
 * ## 对齐对象（真机基准，不是设计规范）
 * 原版 Android `IndexScreen.kt` + `PageSettings.kt` + `TabPage.kt`：
 * - **底部 6 个模块**：卷 / 图 / 网 / 话 / 我 / 座（`PageShowOnNav.allPages` 顺序，
 *   标签取自 `toPageData().name`）；
 * - **「卷」模块内 5 个页签**：课表 / DDL / 动态 / 空教室 / 交通
 *   （`ScheduleScreen` 的 `TabPager`，实测见 `harmony/ui-ref/ref-01..08`）。
 *
 * ## 为什么用「字符串 key」而不是下标
 * 原版 `PageSettings` 允许用户**改页面顺序、隐藏页面**，下标不是稳定身份；
 * 鸿蒙这版暂不做排序设置，但状态仍用 key 表达 —— 将来接排序时只需换列表来源，
 * 判断分支不用动（下标一旦写进 if，改顺序就静默错页）。
 *
 * ⚠️ 两个列表的顺序是**用户可见布局**，也是 `contentIdOf` 的兜底来源；
 *   改动顺序 = 改 UI，必须同步 `harmony/ui-ref/MIGRATION-BASELINE.md` 与截图基准。
 */

/** 底部导航的一个模块（对应原版 `PageShowOnNav` 一项）。 */
export interface ShellModule {
  /** 稳定身份（= 原版 `PageData.value` 语义），永不随展示名改。 */
  key: string;
  /** 导航上的单字标签（原版就是单字：卷/图/网/话/我/座）。 */
  label: string;
  /** 图标文件（`resources/rawfile/icons/` 下的文件名，Material Rounded 矢量）。 */
  icon: string;
}

/**
 * 「卷」模块内的一个页签（对应原版 `TabPager.items` 一项）。
 * ⚠️ 没有 icon 字段：原版这行页签**只有文字**（ref-01/02/06/07/08 实证），
 *   给个用不上的图标字段只会诱导后人把它画上去。
 */
export interface ShellTab {
  key: string;
  label: string;
}

/** 底部 6 模块，顺序 = 原版 `PageShowOnNav.allPages`。 */
export const NAV_MODULES: ShellModule[] = [
  { key: 'schedule', label: '卷', icon: 'nav_schedule.svg' },
  { key: 'map', label: '图', icon: 'nav_map.svg' },
  { key: 'web', label: '网', icon: 'nav_web.svg' },
  { key: 'gallery', label: '话', icon: 'nav_gallery.svg' },
  { key: 'mine', label: '我', icon: 'nav_mine.svg' },
  { key: 'seat', label: '座', icon: 'nav_seat.svg' },
];

/** 「卷」内 5 页签，顺序 = 原版 `ScheduleScreen` 的 `TAB_IDS`（新页签只能追加在末尾）。 */
export const SCHEDULE_TABS: ShellTab[] = [
  { key: 'timetable', label: '课表' },
  { key: 'ddl', label: 'DDL' },
  { key: 'feed', label: '动态' },
  { key: 'classroom', label: '空教室' },
  { key: 'transport', label: '交通' },
];

/** 默认落地模块（原版 `PageSettings.homePage` 默认 = 第一个 = 卷）。 */
export const DEFAULT_MODULE: string = 'schedule';

/** 默认落地页签（原版 `TabPager` 起始页 0 = 课表）。 */
export const DEFAULT_TAB: string = 'timetable';

/** 按 key 找下标；找不到返回 -1（**不**回落到 0，调用方自己决定兜底）。 */
export function indexOfKey(items: ShellModule[] | ShellTab[], key: string): number {
  for (let i = 0; i < items.length; i++) {
    if (items[i].key === key) {
      return i;
    }
  }
  return -1;
}

/** 模块 key 是否合法。 */
export function isKnownModule(key: string): boolean {
  return indexOfKey(NAV_MODULES, key) >= 0;
}

/** 页签 key 是否合法。 */
export function isKnownTab(key: string): boolean {
  return indexOfKey(SCHEDULE_TABS, key) >= 0;
}

/**
 * 规整模块 key：脏值（空串 / 未知 / 历史遗留）一律回落默认模块。
 * ⚠️ 不做 `list[0]` 兜底 —— 那会把「未知」悄悄变成「卷」，
 *   将来加模块时会变成查不到原因的错页。
 */
export function normalizeModule(key: string): string {
  return isKnownModule(key) ? key : DEFAULT_MODULE;
}

/** 规整页签 key：同上，脏值回落默认页签。 */
export function normalizeTab(key: string): string {
  return isKnownTab(key) ? key : DEFAULT_TAB;
}

/**
 * (模块, 页签) → 内容标识。外壳据此决定渲染哪个子视图。
 *
 * 内容标识口径：**「卷」内就是页签 key 本身；其余模块就是模块 key 本身。**
 * 这样 `contentId` 是一个单值，路由参数、状态恢复、深链都只需要一个字段。
 */
export function contentIdOf(moduleKey: string, tabKey: string): string {
  const m: string = normalizeModule(moduleKey);
  if (m === 'schedule') {
    return normalizeTab(tabKey);
  }
  return m;
}

/** `contentIdOf` 的逆运算：给一个内容标识，还原出「哪个模块 + 哪个页签」。 */
export function shellStateOf(contentId: string): ShellSelection {
  if (isKnownTab(contentId)) {
    return { module: 'schedule', tab: contentId };
  }
  if (isKnownModule(contentId)) {
    // 非「卷」模块没有页签概念，页签位保持默认值（切回卷时用它）
    return { module: contentId, tab: DEFAULT_TAB };
  }
  return { module: DEFAULT_MODULE, tab: DEFAULT_TAB };
}

/** 外壳选中态（模块 key + 页签 key）。 */
export interface ShellSelection {
  module: string;
  tab: string;
}

/** 只有「卷」模块显示顶部 5 页签（原版：座位页自带「预约/列表」双 chip，不共用这行）。 */
export function showsTopTabs(moduleKey: string): boolean {
  return normalizeModule(moduleKey) === 'schedule';
}

/** 底部导航项的选中态：模块 key 与当前模块一致。 */
export function isModuleSelected(moduleKey: string, current: string): boolean {
  return moduleKey === normalizeModule(current);
}

/** 顶部页签的选中态：模块必须是卷，且页签 key 一致。 */
export function isTabSelected(tabKey: string, moduleKey: string, tab: string): boolean {
  if (!showsTopTabs(moduleKey)) {
    return false;
  }
  return tabKey === normalizeTab(tab);
}
