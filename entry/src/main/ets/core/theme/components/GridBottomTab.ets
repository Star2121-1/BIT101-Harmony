/**
 * GridBottomTab —— 《一格 GRID》底部 Tab（原版 §5.5）。
 *
 * 自洽取色（读 `STORAGE_DARK`）。只负责单项渲染与排布，内容区骨架 / 空态由页面处理。
 *
 * 单项形态要点：
 * - 顶部指示条 2dp×24dp（圆角 full）；选中 primary，未选/禁用同 surface（视觉隐藏）
 * - 40dp 图标圆：选中 primaryContainer 底 + primary tint；未选透明底 + onSurfaceVariant tint
 * - 文字 label-2：选中 primary，未选 onSurfaceVariant，禁用 textDisabled
 * - 按压：80ms scale(.98)；禁用项无按压反馈
 *
 * 图标用 `iconText`（单字/字符）代替原版的线性/填充图标对——鸿蒙端暂未引入图标字体，
 * 沿用原版「单字 label」的紧凑风格（预览里也是 '卷/图/网/话/我/座'）。
 *
 * ⚠️ build() 根部不声明局部变量（编译器只认根节点起手）⇒ 派生值走私有方法，行内 this.xxx() 取。
 */

import { gridTokens } from '../GridTokens.ts';
import { STORAGE_DARK, STORAGE_PALETTE, getPalette } from '../../../data/ThemeStore.ts';
import {
  resolveTabStyle,
  TAB_INDICATOR_W,
  TAB_INDICATOR_H,
  TAB_ICON_SIZE,
  PRESS_DURATION_MS,
} from './gridStyle.ts';

/** 一个 Tab 的描述（图标由 iconText 给出，组件不依赖具体图标集）。 */
export interface GridTabItem {
  label: string;
  iconText: string;
  selected?: boolean;
  enabled?: boolean;
  onClick?: () => void;
}

@Component
struct GridBottomTabItemView {
  @StorageLink(STORAGE_DARK) private isDark: boolean = false;
  @StorageLink(STORAGE_PALETTE) paletteName: string = 'warm';
  label: string = '';
  iconText: string = '';
  selected: boolean = false;
  isEnabled: boolean = true;
  itemOnClick: (() => void) | null = null;

  /** 当前配色 token（行内取）。 */
  private tokens() {
    return gridTokens(this.isDark, getPalette(this.paletteName));
  }

  /** Tab 项状态 → tint/指示条（原版 GridBottomTabItem §5.5 判定）。 */
  private style() {
    return resolveTabStyle(gridTokens(this.isDark, getPalette(this.paletteName)), { enabled: this.isEnabled, selected: this.selected });
  }

  build() {
    Column() {
      // 顶部指示条
      Column()
        .width(TAB_INDICATOR_W)
        .height(TAB_INDICATOR_H)
        .borderRadius(99)
        .backgroundColor(this.style().indicator)
      // 图标圆
      Stack() {
        if (this.selected) {
          Circle().width(TAB_ICON_SIZE).height(TAB_ICON_SIZE).fill(this.tokens().primaryContainer)
        }
        Text(this.iconText)
          .fontSize(20)
          .fontColor(this.style().tint)
      }
      .width(TAB_ICON_SIZE)
      .height(TAB_ICON_SIZE)
      .margin({ top: 4 })
      .justifyContent(FlexAlign.Center)
      // 按压 80ms scale(.98)，禁用项无反馈
      .stateStyles({
        pressed: {
          .scale({ x: 0.98, y: 0.98 })
        }
      })
      .animation({ duration: PRESS_DURATION_MS, curve: Curve.EaseOut })
      .onClick(() => {
        if (this.isEnabled && this.itemOnClick !== null) {
          this.itemOnClick!();
        }
      })
      Text(this.label)
        .fontSize(11)
        .fontColor(this.style().tint)
        .margin({ top: 2 })
    }
    .alignItems(HorizontalAlign.Center)
    .layoutWeight(1)
  }
}

@Component
export struct GridBottomTabRow {
  @StorageLink(STORAGE_DARK) private isDark: boolean = false;
  @StorageLink(STORAGE_PALETTE) paletteName: string = 'warm';
  items: GridTabItem[] = [];

  build() {
    Row() {
      ForEach(this.items, (item: GridTabItem, idx: number) => {
        GridBottomTabItemView({
          label: item.label,
          iconText: item.iconText,
          selected: item.selected ?? false,
          isEnabled: item.enabled ?? true,
          itemOnClick: item.onClick ?? null,
        })
          .key(String(idx))
      }, (item: GridTabItem, idx: number) => String(idx))
    }
    .width('100%')
    .padding({ top: 4, bottom: 4 })
    .backgroundColor(gridTokens(this.isDark, getPalette(this.paletteName)).surface)
    .border({ width: 0.5, color: gridTokens(this.isDark, getPalette(this.paletteName)).outlineVariant })
  }
}
