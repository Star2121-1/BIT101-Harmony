/**
 * GridButton —— 《一格 GRID》按钮（原版 §5.2）。
 *
 * 自洽取色（读 `STORAGE_DARK`）。三种形态通过 `variant` 区分：
 * - 'filled'：primary 底 + onPrimary 白字（默认）
 * - 'outlined'：透明底 + primary 字 + 1dp primary 描边
 * - 'text'：透明底 + primary 字，无边框
 *
 * 形态要点：
 * - 高 48、圆角 12、左右内边距 24（text 形态 12）
 * - 按压：80ms scale(.98)；filled 额外 80ms 过渡到 pressedHeld
 * - 选中（分段控件）：surface2 底 + onSurface 字 + 1dp primary 描边
 * - 禁用：disabledBg + textDisabled（outlined 描边改 outlineVariant）；无 scale、无 state layer
 * - loading：文字替换为 20dp 环形进度（宽度锁定，文字 alpha=0 保留布局）
 *
 * ⚠️ build() 根部不声明局部变量（编译器只认根节点起手）⇒ 派生值走私有方法，行内 this.xxx() 取。
 */

import { gridTokens } from '../GridTokens.ts';
import { STORAGE_DARK, STORAGE_PALETTE, getPalette } from '../../../data/ThemeStore.ts';
import {
  resolveButtonStyle,
  BUTTON_HEIGHT,
  BUTTON_RADIUS,
  BUTTON_PAD_FILLED,
  BUTTON_PAD_TEXT,
  PRESS_DURATION_MS,
} from './gridStyle.ts';

@Component
export struct GridButton {
  @StorageLink(STORAGE_DARK) private isDark: boolean = false;
  @StorageLink(STORAGE_PALETTE) paletteName: string = 'warm';

  label: string = '';
  variant: string = 'filled';
  isEnabled: boolean = true;
  selected: boolean = false;
  loading: boolean = false;
  onTap: () => void = () => {};

  /** 当前配色 token（行内取）。 */
  private tokens() {
    return gridTokens(this.isDark, getPalette(this.paletteName));
  }

  /** 按钮状态 → 配色（原版 GridButton §5.2 判定）。 */
  private style() {
    return resolveButtonStyle(gridTokens(this.isDark, getPalette(this.paletteName)), this.variant, {
      enabled: this.isEnabled,
      selected: this.selected,
    });
  }

  /** 左右内边距（text 形态更窄）。 */
  private pad(): number {
    return this.variant === 'text' ? BUTTON_PAD_TEXT : BUTTON_PAD_FILLED;
  }

  /** 按压底色：filled 且可用时过渡到 pressedHeld，其余用常态底色。 */
  private pressBg(): string {
    const t = gridTokens(this.isDark, getPalette(this.paletteName));
    return this.variant === 'filled' && this.isEnabled && !this.loading ? t.pressedHeld : this.style().container;
  }

  build() {
    Column() {
      Row() {
        if (this.loading) {
          LoadingProgress().width(20).height(20).color(this.style().content)
        } else {
          Text(this.label)
            .fontSize(14)
            .fontWeight(FontWeight.Medium)
            .fontColor(this.style().content)
            .maxLines(1)
            .textAlign(TextAlign.Center)
        }
      }
      .height(BUTTON_HEIGHT)
      .borderRadius(BUTTON_RADIUS)
      .padding({ left: this.pad(), right: this.pad() })
      .backgroundColor(this.style().container)
      .border(this.style().border ? { width: 1, color: this.style().border } : { width: 0, color: '#00000000' })
      .width('100%')
      .justifyContent(FlexAlign.Center)
      .stateStyles({
        pressed: {
          .backgroundColor(this.pressBg())
          .scale({ x: 0.98, y: 0.98 })
        }
      })
      .animation({ duration: PRESS_DURATION_MS, curve: Curve.EaseOut })
      .onClick(() => {
        if (this.isEnabled && !this.loading) {
          this.onTap();
        }
      })
    }
    .width('100%')
  }
}
