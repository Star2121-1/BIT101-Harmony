/**
 * GridCard —— 《一格 GRID》卡片容器（原版 §5.1）。
 *
 * 自洽取色：组件内部读 `STORAGE_DARK` 调 `gridTokens()`，调用方只传内容与状态，
 * 不必逐层透传 tokens（与原版读 `GridTheme.tokens` 一致）。
 *
 * 形态要点：
 * - 默认：surface 底 + 圆角 12 + 内边距 16 + 左竖条（courseColorIndex≥0 时取 ink 4px）
 * - 按压：80ms scale(.98)（stateStyles 提供，禁用态无）
 * - 选中：1.5dp primary 描边 + primaryContainer 底 + 右上 20dp 勾选圆（多选模式）
 * - 禁用：disabledBg 底 + textDisabled 字 + 竖条降饱和 50% + 无按压反馈
 *
 * 注意：未登录不是第七态，组件层不做登录引导；空态由页面级 GridEmptyState 整块替换。
 * ⚠️ build() 根部不声明局部变量（编译器只认根节点起手）⇒ 派生值走私有方法，行内 this.xxx() 取。
 */

import { gridTokens, gridCourse } from '../GridTokens.ts';
import { STORAGE_DARK, STORAGE_PALETTE, getPalette } from '../../../data/ThemeStore.ts';
import {
  resolveCardStyle,
  CARD_RADIUS,
  CARD_PADDING,
  CARD_STRIPE_WIDTH,
  CARD_SELECTED_BORDER,
  CARD_CHECK_SIZE,
  PRESS_DURATION_MS,
} from './gridStyle.ts';

@Component
export struct GridCard {
  @StorageLink(STORAGE_DARK) private isDark: boolean = false;
  @StorageLink(STORAGE_PALETTE) paletteName: string = 'warm';

  /** 卡片正文（由调用方在 @Builder 里写）。 */
  @BuilderParam content: () => void;

  /** 多选模式选中态。 */
  selected: boolean = false;
  /** 禁用态（第二编码：禁用不得仅靠颜色，组件已配合 disabledBg / 无按压 / 竖条降饱和）。 */
  isDisabled: boolean = false;
  /** 课程色号 0..11；-1 表示无竖条（借阅行、纯文字行）。 */
  courseColorIndex: number = -1;
  /** 点击事件；传 null 则卡片不可点（无按压反馈）。 */
  onTap: (() => void) | null = null;

  /** 当前配色 token（行内取，避免 build 根部局部变量）。 */
  private tokens() {
    return gridTokens(this.isDark, getPalette(this.paletteName));
  }

  /** 卡片状态 → 配色/边框/竖条/勾选（原版 GridCard §5.1 判定）。 */
  private cardStyle() {
    const ink: string | null =
      this.courseColorIndex >= 0 ? gridCourse(this.courseColorIndex, this.isDark).ink : null;
    return resolveCardStyle(gridTokens(this.isDark, getPalette(this.paletteName)), {
      selected: this.selected,
      disabled: this.isDisabled,
      courseColorIndex: this.courseColorIndex,
      courseInk: ink,
    });
  }

  /** 是否可点（非禁用且挂了 onTap）。 */
  private isClickable(): boolean {
    return !this.isDisabled && this.onTap !== null;
  }

  build() {
    Stack({ alignContent: Alignment.TopStart }) {
      Row() {
        // 左竖条（4px 课程色；无竖条时不占位）
        if (this.cardStyle().stripe !== null) {
          Column()
            .width(CARD_STRIPE_WIDTH)
            .height('100%')
            .backgroundColor(this.cardStyle().stripe)
        }
        Column() {
          this.content();
        }
        .layoutWeight(1)
        .padding(CARD_PADDING)
        .alignItems(HorizontalAlign.Start)
      }
      .width('100%')
      .borderRadius(CARD_RADIUS)
      .backgroundColor(this.cardStyle().container)
      .border(this.cardStyle().border ? { width: CARD_SELECTED_BORDER, color: this.cardStyle().border } : { width: 0, color: '#00000000' })
      .clip(true)
      .stateStyles({
        pressed: {
          .scale({ x: 0.98, y: 0.98 })
        }
      })
      .animation({ duration: PRESS_DURATION_MS, curve: Curve.EaseOut })
      .onClick(() => {
        if (this.isClickable()) {
          this.onTap!();
        }
      })

      // 选中勾选圆（叠在右上角，多选模式出现）
      if (this.cardStyle().showCheck) {
        Stack() {
          Circle().width(CARD_CHECK_SIZE).height(CARD_CHECK_SIZE).fill(this.tokens().primary)
          Text('✓').fontSize(14).fontColor(this.tokens().onPrimary).fontWeight(FontWeight.Bold)
        }
        .align(Alignment.TopEnd)
        .margin({ top: 12, right: 12 })
      }
    }
    .width('100%')
  }
}
