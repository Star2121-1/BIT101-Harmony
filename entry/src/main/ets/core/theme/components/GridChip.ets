/**
 * GridChip —— 《一格 GRID》筛选 Chip（原版 §5.3）。
 *
 * 自洽取色（读 `STORAGE_DARK`）。
 *
 * 形态要点：
 * - 高 40、圆角 8、左右内边距 12，横向滚动
 * - 默认：surface2 底 + onSurfaceVariant 字 + 可选 16dp 前置图标
 * - 按压：80ms scale(.98)（stateStyles）
 * - 选中：primaryContainer 底 + onPrimaryContainer 字 + 1dp primary 描边 + 16dp 勾选图标
 * - 禁用：disabledBg 底 + textDisabled 字 + 无按压反馈；**不移除**，保留条件可见性
 *
 * ⚠️ build() 根部不声明局部变量（编译器只认根节点起手）⇒ 派生值走私有方法，行内 this.xxx() 取。
 */

import { gridTokens } from '../GridTokens.ts';
import { STORAGE_DARK, STORAGE_PALETTE, getPalette } from '../../../data/ThemeStore.ts';
import {
  resolveChipStyle,
  CHIP_HEIGHT,
  CHIP_RADIUS,
  CHIP_PAD,
  CHIP_ICON,
  PRESS_DURATION_MS,
} from './gridStyle.ts';

@Component
export struct GridChip {
  @StorageLink(STORAGE_DARK) private isDark: boolean = false;
  @StorageLink(STORAGE_PALETTE) paletteName: string = 'warm';

  label: string = '';
  selected: boolean = false;
  isEnabled: boolean = true;
  /** 前置图标（未选中且没有勾选时显示）。 */
  iconText: string = '';
  onTap: () => void = () => {};

  /** Chip 状态 → 配色（原版 GridFilterChip §5.3 判定）。 */
  private style() {
    return resolveChipStyle(gridTokens(this.isDark, getPalette(this.paletteName)), { enabled: this.isEnabled, selected: this.selected });
  }

  build() {
    Row() {
      if (this.style().showCheck) {
        Text('✓').fontSize(CHIP_ICON).fontColor(this.style().content)
      } else if (this.iconText.length > 0) {
        Text(this.iconText).fontSize(CHIP_ICON).fontColor(this.style().content)
      }
      Text(this.label)
        .fontSize(13)
        .fontColor(this.style().content)
        .maxLines(1)
    }
    .height(CHIP_HEIGHT)
    .borderRadius(CHIP_RADIUS)
    .padding({ left: CHIP_PAD, right: CHIP_PAD })
    .backgroundColor(this.style().container)
    .border(this.style().border ? { width: 1, color: this.style().border } : { width: 0, color: '#00000000' })
    .stateStyles({
      pressed: {
        .scale({ x: 0.98, y: 0.98 })
      }
    })
    .animation({ duration: PRESS_DURATION_MS, curve: Curve.EaseOut })
    .onClick(() => {
      if (this.isEnabled) {
        this.onTap();
      }
    })
  }
}
