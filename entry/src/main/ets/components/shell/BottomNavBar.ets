/**
 * BottomNavBar —— 底部 6 模块导航（1:1 原版 `IndexScreenNavBar`，Material3 `NavigationBar`）。
 *
 * 形态（实测 ref-01/02/03/05/06/07/08）：
 * - 整条高 56vp，底 `surfaceElevated`（= surface 叠 primary 8.24%，即 M3 tonalElevation 3dp；
 *   ⚠️ 不是 `surface` 纯白——真机 ref-01 底栏实测 #F5F0ED，与原版并排一比就看出少了这一层色阶），
 *   上边 0.5vp `outlineVariant` 细线；
 * - 单项：图标 20vp + 文字 11vp 上下排；
 * - 选中：图标底 `secondaryContainer` 胶囊 56×30（圆角 15），图标与文字 `onSecondaryContainer`；
 * - 未选：透明底，图标与文字 `onSurfaceVariant`。
 *
 * 图标 = Material Rounded 24px 矢量（`rawfile/icons/nav_*.svg`，与原版
 * `IndexViewModel` 用的 `Icons.Rounded.Event/Map/Explore/Chat/AccountCircle/EventSeat`
 * 同名同源），用 `.fillColor()` 上色。
 */

import { gridTokens } from '../../core/theme/GridTokens.ts';
import { STORAGE_DARK, STORAGE_PALETTE, getPalette } from '../../data/ThemeStore.ts';
import type { ShellModule } from '../../corelogic/shellNav.ts';

@Component
export struct BottomNavBar {
  @StorageLink(STORAGE_DARK) private isDark: boolean = false;
  @StorageLink(STORAGE_PALETTE) private paletteName: string = 'warm';

  /** 模块列表（顺序即布局，来自 `shellNav.NAV_MODULES`；常量，不需要 @Prop）。 */
  items: ShellModule[] = [];
  /**
   * 当前选中模块 key。
   * ⚠️ **必须是 `@Prop`**：未装饰的成员只在创建时取一次父组件值，父组件后续变化不同步
   * （2026-10-26 真机实证：点「图」后内容切了、高亮仍是「卷」）。
   */
  @Prop selectedKey: string = '';
  /** 点击回调（传 key，不传下标）。 */
  onSelect: (key: string) => void = () => {};

  private tk() {
    return gridTokens(this.isDark, getPalette(this.paletteName));
  }

  private tint(key: string): string {
    return key === this.selectedKey ? this.tk().onSecondaryContainer : this.tk().onSurfaceVariant;
  }

  build() {
    Row() {
      ForEach(this.items, (m: ShellModule) => {
        Column() {
          Stack() {
            Image($rawfile('icons/' + m.icon))
              .width(20)
              .height(20)
              .fillColor(this.tint(m.key))
              .draggable(false)
          }
          .width(56)
          .height(30)
          .borderRadius(15)
          .backgroundColor(m.key === this.selectedKey ? this.tk().secondaryContainer : Color.Transparent)

          Text(m.label)
            .fontSize(11)
            .fontColor(this.tint(m.key))
            .margin({ top: 3 })
            .maxLines(1)
        }
        .layoutWeight(1)
        .justifyContent(FlexAlign.Center)
        .onClick(() => {
          this.onSelect(m.key);
        })
      }, (m: ShellModule) => m.key)
    }
    .width('100%')
    .height(56)
    .backgroundColor(this.tk().surfaceElevated)
    .border({ width: { top: 0.5 }, color: this.tk().outlineVariant })
  }
}
