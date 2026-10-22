/**
 * 桌面卡片渲染页（M8）
 *
 * 对照 Android RemoteViews 渲染：
 * - 只使用基础组件：Column、Row、Text、List
 * - 通过 formBindingData 接收 JSON 数据（WidgetPage[]）
 * - 5 页内容按 Tab 切换显示
 *
 * ⚠️ ArkTS 限制：
 * - UI 树中不允许局部变量声明（rollup 编译限制）
 * - 必须使用 @State/@Prop 等装饰器管理状态
 */

import { formBindingData } from '@kit.FormKit';
import { WidgetPage, PageKind, ClassState } from '../corelogic/WidgetLogic.ts';
import { type WidgetLine } from '../corelogic/WidgetLogic.ts';

// ── 卡片主组件 ─────────────────────────────────────────────────────────────

@Entry
@Component
struct WidgetPage {
  // 卡片数据（从 formBindingData 注入）
  @State private pages: WidgetPage[] = [];
  @State private currentTabIndex: number = 0;

  // 5 个页面名称（对应 PageKind）
  private readonly tabLabels: string[] = ['课程', 'DDL', '动态', '座位', '自习'];

  aboutToAppear(): void {
    this.loadDataFromForm();
  }

  /**
   * 从 formBindingData 读取卡片数据
   * 数据由 FormExtensionAbility 装配后通过 JSON 传入
   */
  private loadDataFromForm(): void {
    try {
      const formData: string = formBindingData.getFormBindingData();
      if (formData && formData.length > 0) {
        const parsed: WidgetPage[] = JSON.parse(formData);
        if (Array.isArray(parsed) && parsed.length > 0) {
          this.pages = parsed;
          // 确保 currentTabIndex 不越界
          if (this.currentTabIndex >= parsed.length) {
            this.currentTabIndex = 0;
          }
          return;
        }
      }
    } catch (e) {
      // 解析失败时使用默认空数据
    }
    // 兜底：空数据不显示错误，保持界面干净
    this.pages = [];
  }

  build() {
    Column() {
      // 顶部标题栏
      Row() {
        Text('BIT101')
          .fontSize(14)
          .fontWeight(FontWeight.Bold)
          .fontColor('#FFFFFF')
        Blank()
        Text(this.getCurrentDateText())
          .fontSize(11)
          .fontColor('#FFFFFF')
          .opacity(0.8)
      }
      .width('100%')
      .height(36)
      .backgroundColor('#1A7F37')
      .padding({ left: 12, right: 12 })
      .alignItems(VerticalAlign.Center)

      // 页面内容区（5 页 Tab）
      if (this.pages.length > 0) {
        Column() {
          // Tab 切换栏
          Row() {
            ForEach(this.pages, (page: WidgetPage, index: number) => {
              Text(page.title)
                .fontSize(11)
                .fontColor(index === this.currentTabIndex ? '#1A7F37' : '#888888')
                .fontWeight(index === this.currentTabIndex ? FontWeight.Bold : FontWeight.Normal)
                .padding({ left: 8, right: 8, top: 4, bottom: 4 })
                .onClick(() => {
                  this.currentTabIndex = index;
                })
            }, (page: WidgetPage, index: number) => `${page.kind}-${index}`)
          }
          .width('100%')
          .justifyContent(FlexAlign.SpaceAround)
          .border({ width: { bottom: 1 } })
          .borderColor('#E0E0E0')

          // 当前页内容
          this.renderCurrentPage()
        }
        .width('100%')
        .layoutWeight(1)
        .padding(8)
      } else {
        // 空态
        Column() {
          Text('BIT101')
            .fontSize(18)
            .fontWeight(FontWeight.Bold)
            .fontColor('#1A7F37')
          Text('桌面卡片')
            .fontSize(12)
            .fontColor('#888888')
            .margin({ top: 8 })
          Text('请打开 App 查看完整功能')
            .fontSize(11)
            .fontColor('#AAAAAA')
            .margin({ top: 4 })
        }
        .width('100%')
        .height(120)
        .justifyContent(FlexAlign.Center)
        .alignItems(HorizontalAlign.Center)
      }
    }
    .width('100%')
    .height('100%')
    .backgroundColor('#F5F5F5')
    .borderRadius(12)
  }

  /**
   * 渲染当前选中的页面内容
   */
  private renderCurrentPage(): Column {
    if (this.currentTabIndex >= this.pages.length) {
      return Column().width('100%').height(0);
    }
    const page: WidgetPage = this.pages[this.currentTabIndex];

    return Column() {
      // 列表内容
      if (page.items && page.items.length > 0) {
        List({ space: 4 }) {
          ForEach(page.items, (line: WidgetLine) => {
            ListItem() {
              this.renderLine(line)
            }
          }, (line: WidgetLine) => `${line.lead}-${line.main}-${line.time}`)
        }
        .width('100%')
        .layoutWeight(1)
      } else {
        // 空态文本
        Text(page.emptyText || '暂无数据')
          .fontSize(11)
          .fontColor('#999999')
          .width('100%')
          .textAlign(TextAlign.Center)
          .margin({ top: 20 })
      }

      // 页脚
      if (page.footer) {
        Text(page.footer)
          .fontSize(9)
          .fontColor('#AAAAAA')
          .width('100%')
          .textAlign(TextAlign.Center)
          .margin({ top: 4 })
      }
    }
    .width('100%')
    .layoutWeight(1)
  }

  /**
   * 渲染列表中的一行
   */
  private renderLine(line: WidgetLine): Row {
    // 根据 highlight 设置背景色
    let bgColor: string = '#FFFFFF';
    if (line.highlight === ClassState.ONGOING) {
      bgColor = '#E8F5E9';
    } else if (line.highlight === ClassState.UPCOMING) {
      bgColor = '#FFF3E0';
    }

    return Row() {
      // 时间列
      Column() {
        Text(line.time)
          .fontSize(9)
          .fontColor('#888888')
      }
      .width(36)
      .alignItems(HorizontalAlign.Center)
      .justifyContent(FlexAlign.Center)

      // 主体内容
      Column() {
        Row() {
          // 紧急标记
          if (line.urgent) {
            Text('🔥')
              .fontSize(10)
          }
          Text(line.main)
            .fontSize(12)
            .fontColor(line.muted ? '#AAAAAA' : '#333333')
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
        }
        .width('100%')
        .alignItems(VerticalAlign.Center)

        // 副标题
        if (line.lead || line.trail) {
          Text((line.lead || '') + ' ' + (line.trail || ''))
            .fontSize(9)
            .fontColor('#999999')
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
        }
      }
      .layoutWeight(1)
      .alignItems(HorizontalAlign.Start)
      .padding({ left: 4, right: 4, top: 2, bottom: 2 })
    }
    .width('100%')
    .height(28)
    .backgroundColor(bgColor)
    .borderRadius(4)
    .padding({ left: 6 })
  }

  /**
   * 获取当前日期文本（北京时间）
   */
  private getCurrentDateText(): string {
    const now = new Date();
    const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
    const bjMs = utcMs + 8 * 3600000;
    const bjDate = new Date(bjMs);
    const month = bjDate.getUTCMonth() + 1;
    const day = bjDate.getUTCDate();
    const weekdays: string[] = ['日', '一', '二', '三', '四', '五', '六'];
    const weekday = bjDate.getUTCDay();
    return `${month}月${day}日 周${weekdays[weekday]}`;
  }
}
