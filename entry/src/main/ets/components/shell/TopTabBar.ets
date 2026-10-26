/**
 * TopTabBar —— 「卷」模块顶部 5 页签（1:1 原版 `ScheduleTabRow`，实测 ref-01/02/06/07/08）。
 *
 * 形态（**照渲染结果，不照设计规范的圆点指示条**）：
 * - 整行高 44vp，页签等宽（`layoutWeight(1)`）；
 * - 选中项：`primaryContainer` 圆角 12 的胶囊，字 `onPrimaryContainer`；
 * - 未选：透明底，字 `onSurfaceVariant`；
 * - 胶囊内缩：左右各 3vp、上下各 5vp ⇒ 视觉高 34vp（源码
 *   `TabPage.kt` 的 `padding(horizontal=3.dp, vertical=5.dp)`）。
 *
 * ⚠️ 原版为什么不用 Material3 `TabRow`：`Tab` 自带约 16dp 左右内边距，
 *   5 个页签在字体放大到 1.3 时会**全部退化成 `…`**。等宽格子是自己排的，
 *   这里保持同一决定（`maxLines(1)` + 省略，不做自动降档——测过的字阶就一档）。
 *
 * ⚠️ build() 根部不声明局部变量（编译器只认根节点起手）⇒ 取色走 `tk()` 行内调用。
 */

import { gridTokens } from '../../core/theme/GridTokens.ts';
import { STORAGE_DARK, STORAGE_PALETTE, getPalette } from '../../data/ThemeStore.ts';
import type { ShellTab } from '../../corelogic/shellNav.ts';

@Component
export struct TopTabBar {
  @StorageLink(STORAGE_DARK) private isDark: boolean = false;
  @StorageLink(STORAGE_PALETTE) private paletteName: string = 'warm';

  /** 页签列表（顺序即布局，来自 `shellNav.SCHEDULE_TABS`；常量，不需要 @Prop）。 */
  tabs: ShellTab[] = [];
  /**
   * 当前选中页签 key。
   * ⚠️ **必须是 `@Prop`**：未装饰的成员只在创建时取一次父组件值，之后父组件状态变了
   * 也不会同步（2026-10-26 真机实证：点了「图」，内容切过去了，底栏高亮还停在「卷」）。
   */
  @Prop selectedKey: string = '';
  /** 点击回调（传 key，不传下标）。 */
  onSelect: (key: string) => void = () => {};

  private tk() {
    return gridTokens(this.isDark, getPalette(this.paletteName));
  }

  build() {
    Row() {
      ForEach(this.tabs, (tab: ShellTab) => {
        Column() {
          Text(tab.label)
            .fontSize(14)
            .fontWeight(tab.key === this.selectedKey ? FontWeight.Medium : FontWeight.Normal)
            .fontColor(tab.key === this.selectedKey ? this.tk().onPrimaryContainer : this.tk().onSurfaceVariant)
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .textAlign(TextAlign.Center)
        }
        .layoutWeight(1)
        .height(34)
        .margin({ left: 3, right: 3, top: 5, bottom: 5 })
        .borderRadius(12)
        .backgroundColor(tab.key === this.selectedKey ? this.tk().primaryContainer : Color.Transparent)
        .justifyContent(FlexAlign.Center)
        .onClick(() => {
          this.onSelect(tab.key);
        })
      }, (tab: ShellTab) => tab.key)
    }
    .width('100%')
    .height(44)
    .backgroundColor(this.tk().background)
  }
}
