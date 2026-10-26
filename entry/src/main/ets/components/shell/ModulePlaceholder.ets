/**
 * ModulePlaceholder —— 底部导航里「有格子但还没功能」的模块占位（图 / 网 / 话）。
 *
 * ## 为什么保留格子而不是删掉
 * 原版底部是**固定 6 格**（`PageShowOnNav.allPages`）。删格子会让底栏只剩 3 格、
 * 每格变宽，整条导航的观感与原版相差更远；保留格子 + 如实说明缺什么，
 * 既保住版式，也不骗人（用户点进去看到的不是白屏，是「为什么没有」）。
 *
 * ⚠️ 文案只写**已知事实**（后端被封 / 未接入 / 未排期），不写推测原因，
 *   也不给「即将上线」这类承诺（铁律：别把推论写进用户可见文案）。
 */

import { gridTokens } from '../../core/theme/GridTokens.ts';
import { STORAGE_DARK, STORAGE_PALETTE, getPalette } from '../../data/ThemeStore.ts';

@Component
export struct ModulePlaceholder {
  @StorageLink(STORAGE_DARK) private isDark: boolean = false;
  @StorageLink(STORAGE_PALETTE) private paletteName: string = 'warm';

  /** 模块名（画面上最大的那行）。 */
  title: string = '';
  /** 现状说明（第二行，写事实）。 */
  reason: string = '';
  /** 图标文件（`rawfile/icons/`）。 */
  icon: string = 'nav_map.svg';

  private tk() {
    return gridTokens(this.isDark, getPalette(this.paletteName));
  }

  build() {
    Column() {
      Image($rawfile('icons/' + this.icon))
        .width(40)
        .height(40)
        .fillColor(this.tk().outline)
        .draggable(false)
        .margin({ bottom: 14 })
      Text(this.title)
        .fontSize(17)
        .fontWeight(FontWeight.Medium)
        .fontColor(this.tk().onSurface)
      Text(this.reason)
        .fontSize(12)
        .fontColor(this.tk().onSurfaceVariant)
        .textAlign(TextAlign.Center)
        .margin({ top: 8 })
        .padding({ left: 32, right: 32 })
    }
    .width('100%')
    .height('100%')
    .justifyContent(FlexAlign.Center)
    .alignItems(HorizontalAlign.Center)
    .backgroundColor(this.tk().background)
  }
}
