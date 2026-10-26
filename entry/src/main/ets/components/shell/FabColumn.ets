/**
 * FabColumn —— 页面右下角悬浮按钮组（1:1 原版 `PageFab`，`features/common/component/PageFab.kt`）。
 *
 * 原版规格（源码常量，别在页面里另写数字）：
 * - 圆 42vp（`PAGE_FAB_SIZE`），零海拔；
 * - 底色 `primaryContainer` **× 0.8 不透明度**（`PAGE_FAB_CONTAINER_ALPHA`）——
 *   叠在页面底 `background` #FBF8F4 上复合后实测 #F9E4D4（ref-01）；
 * - 前景 `primary`；
 * - 按钮间距 10vp，离右 10vp、离底 20vp（`padding(10.dp, 20.dp)` + `Spacer(10.dp)`）。
 *
 * 原版把"回到顶部"抽成 `BackToTopFab`（滚过一段才淡入）；这里只做按钮组本体，
 * 出现时机由页面自己决定（原版也是刻意交给调用方的：话廊首屏高、空教室不一样）。
 */

import { gridTokens } from '../../core/theme/GridTokens.ts';
import { withAlpha } from '../../core/theme/colorUtil.ts';
import { STORAGE_DARK, STORAGE_PALETTE, getPalette } from '../../data/ThemeStore.ts';

/** 一个悬浮按钮。 */
export interface FabAction {
  /** 图标文件（`rawfile/icons/` 下的文件名，Material 24px 矢量）。 */
  icon: string;
  /** 无障碍描述（原版 `PageFab(description=)`；鸿蒙侧用作 accessibleDescription）。 */
  label: string;
  /** 点击。 */
  onTap: () => void;
}

/** 原版常量：按钮直径。 */
export const FAB_SIZE: number = 42;
/** 原版常量：底色不透明度。 */
export const FAB_CONTAINER_ALPHA: number = 0.8;

@Component
export struct FabColumn {
  @StorageLink(STORAGE_DARK) private isDark: boolean = false;
  @StorageLink(STORAGE_PALETTE) private paletteName: string = 'warm';

  /** 自下而上排布（原版 Column 的书写顺序即视觉顺序，从上到下）。 */
  actions: FabAction[] = [];

  private tk() {
    return gridTokens(this.isDark, getPalette(this.paletteName));
  }

  private fabBg(): string {
    return withAlpha(this.tk().primaryContainer, FAB_CONTAINER_ALPHA);
  }

  build() {
    Column({ space: 10 }) {
      ForEach(this.actions, (a: FabAction) => {
        Stack() {
          Image($rawfile('icons/' + a.icon))
            .width(20)
            .height(20)
            .fillColor(this.tk().primary)
            .draggable(false)
        }
        .width(FAB_SIZE)
        .height(FAB_SIZE)
        .borderRadius(FAB_SIZE / 2)
        .backgroundColor(this.fabBg())
        .accessibilityText(a.label)
        .stateStyles({
          pressed: {
            .scale({ x: 0.94, y: 0.94 })
          }
        })
        .animation({ duration: 80, curve: Curve.EaseOut })
        .onClick(() => {
          a.onTap();
        })
      }, (a: FabAction, idx: number) => String(idx) + a.icon)
    }
    .alignItems(HorizontalAlign.End)
    .padding({ right: 10, bottom: 20 })
  }
}
