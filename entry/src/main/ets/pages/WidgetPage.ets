/**
 * 桌面卡片渲染页（M8）
 *
 * 对照 Android RemoteViews 渲染：
 * - 只使用基础组件：Column、Row、Text、List
 * - 数据经 formBindingData → LocalStorage 注入（官方模式：FormExtensionAbility 调
 *   `formBindingData.createFormBindingData({ widgetPayload: json })`，
 *   卡片页面用 `@LocalStorageProp('widgetPayload')` 收；API 12 起无 getFormBindingData）
 * - 5 页内容按 Tab 切换显示
 *
 * ⚠️ ArkTS 限制（2026-10-22 编译门实录）：
 * - UI 树中不允许局部变量声明（rollup 编译限制）⇒ 派生数据一律走取值方法现算
 * - ForEach 的 keyGenerator 只能单参（双参连环报错）⇒ index 用 indexOf 现取
 * - `Column`/`Row` 是 struct 不是类型，不能作方法返回类型 ⇒ UI 方法一律 @Builder
 * - WidgetLogic 的 WidgetPage（数据类型）与本 struct 同名 ⇒ import 重命名为 WidgetPageData
 */

import { WidgetPage as WidgetPageData, PageKind, ClassState } from '../corelogic/WidgetLogic.ts';
import { type WidgetLine } from '../corelogic/WidgetLogic.ts';
import { gridTokens, getPaletteName } from '../core/theme/GridTokens.ts';
import type { GridTokens } from '../core/theme/GridTokens.ts';
import { contentIdForKind } from '../corelogic/WidgetDeepLink.ts';
import { warn } from '../core/log/BitLog.ts';

/** 卡片的 router 动作参数（显式接口：ArkTS 不接受对象字面量当类型）。 */
interface CardRouterParams {
  bit101Content: string;
}

/** `postCardAction` 的 router 动作。 */
interface CardRouterAction {
  action: string;
  bundleName: string;
  abilityName: string;
  params: CardRouterParams;
}

// ── 卡片主组件 ─────────────────────────────────────────────────────────────

@Entry
@Component
struct WidgetPage {
  // 卡片数据（FormExtensionAbility 经 formBindingData 注入 LocalStorage）
  @LocalStorageProp('widgetPayload') widgetPayload: string = '';
  /**
   * 主题（由 FormExtension 随 binding data 下发）。
   * ⚠️ 卡片是独立进程，读不到主进程的 `AppStorage`，所以 palette/深色必须由扩展
   *   算好传进来；以前这里写死深绿 #1A7F37 + 白底，和 App 的三套配色完全不搭
   *   （2026-10-27 真机对照后改）。
   */
  @LocalStorageProp('widgetPalette') widgetPalette: string = 'warm';
  @LocalStorageProp('widgetDark') widgetDark: boolean = false;
  @State private currentTabIndex: number = 0;

  /** 5 个页面名称（对应 PageKind） */
  private readonly tabLabels: string[] = ['课程', 'DDL', '动态', '座位', '自习'];

  private tk(): GridTokens {
    return gridTokens(this.widgetDark, getPaletteName(this.widgetPalette));
  }

  /**
   * 现取现解析（铁律 0.8：卡片数据可能晚于 aboutToAppear 到达，不缓存派生）。
   * 解析失败或空 ⇒ 空态（卡片界面保持干净，不报错）。
   */
  private shownPages(): WidgetPageData[] {
    if (this.widgetPayload.length === 0) {
      return [];
    }
    try {
      const parsed: WidgetPageData[] = JSON.parse(this.widgetPayload);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    } catch (e) {
      // 解析失败按空处理
    }
    return [];
  }

  /** 当前页（越界返回 null，由调用方兜底）。 */
  private currentPage(): WidgetPageData | null {
    const pages: WidgetPageData[] = this.shownPages();
    if (this.currentTabIndex >= pages.length) {
      return null;
    }
    return pages[this.currentTabIndex];
  }

  /** 当前页的列表行（空页/越界 ⇒ 空数组）。 */
  private currentPageItems(): WidgetLine[] {
    const page: WidgetPageData | null = this.currentPage();
    if (page === null) {
      return [];
    }
    return page.items;
  }

  /** 当前页空态文案（页自带 emptyText 优先，否则「暂无数据」）。 */
  private currentEmptyText(): string {
    const page: WidgetPageData | null = this.currentPage();
    if (page !== null && page.emptyText.length > 0) {
      return page.emptyText;
    }
    return '暂无数据';
  }

  /** 当前页页脚（null/空串都不渲染）。 */
  private currentFooter(): string | null {
    const page: WidgetPageData | null = this.currentPage();
    if (page === null) {
      return null;
    }
    return page.footer;
  }

  /** 当前页页脚文本（无页脚 = 空串；UI 判长度用，避免可空串进 Text）。 */
  private currentFooterText(): string {
    const footer: string | null = this.currentFooter();
    if (footer !== null && footer.length > 0) {
      return footer;
    }
    return '';
  }

  /** 一行的背景色（按高亮态；普通方法才能写分支语句，@Builder 里只放 UI 语法）。 */
  private lineBg(line: WidgetLine): string {
    if (line.highlight === ClassState.ONGOING) {
      return this.tk().secondaryContainer;
    }
    if (line.highlight === ClassState.UPCOMING) {
      return this.tk().tertiaryContainer;
    }
    return this.tk().surface;
  }

  build() {
    Column() {
      // 顶部标题栏
      Row() {
        Text('BIT101')
          .fontSize(14)
          .fontWeight(FontWeight.Bold)
          .fontColor(this.tk().onPrimary)
        Blank()
        Text(this.getCurrentDateText())
          .fontSize(11)
          .fontColor(this.tk().onPrimary)
          .opacity(0.8)
      }
      .width('100%')
      .height(36)
      .backgroundColor(this.tk().primary)
      .padding({ left: 12, right: 12 })
      .alignItems(VerticalAlign.Center)

      // 页面内容区（5 页 Tab）
      if (this.shownPages().length > 0) {
        Column() {
          // Tab 切换栏（keyGenerator 单参：kind 每类一页，唯一）
          Row() {
            ForEach(this.shownPages(), (page: WidgetPageData) => {
              Text(page.title)
                .fontSize(11)
                .fontColor(this.shownPages().indexOf(page) === this.currentTabIndex
                  ? this.tk().primary : this.tk().onSurfaceVariant)
                .fontWeight(this.shownPages().indexOf(page) === this.currentTabIndex ? FontWeight.Bold : FontWeight.Normal)
                .padding({ left: 8, right: 8, top: 4, bottom: 4 })
                .onClick(() => {
                  this.currentTabIndex = this.shownPages().indexOf(page);
                })
            }, (page: WidgetPageData) => page.kind)
          }
          .width('100%')
          .justifyContent(FlexAlign.SpaceAround)
          .border({ width: { bottom: 1 } })
          .borderColor(this.tk().outlineVariant)

          // 当前页内容
          this.currentPageView()
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
            .fontColor(this.tk().primary)
          Text('桌面卡片')
            .fontSize(12)
            .fontColor(this.tk().onSurfaceVariant)
            .margin({ top: 8 })
          Text('请打开 App 查看完整功能')
            .fontSize(11)
            .fontColor(this.tk().textPlaceholder)
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
    .backgroundColor(this.tk().background)
    .borderRadius(12)
  }

  /** 当前选中页的内容（@Builder：UI 不能作方法返回类型；体内只写 UI 语法，逻辑走方法）。 */
  @Builder
  currentPageView() {
    if (this.currentPage() === null) {
      Column() {
      }
      .width('100%')
      .height(0)
    } else {
      Column() {
        // 列表内容
        if (this.currentPageItems().length > 0) {
          List({ space: 4 }) {
            ForEach(this.currentPageItems(), (line: WidgetLine) => {
              ListItem() {
                this.widgetLine(line)
              }
            }, (line: WidgetLine) => line.lead + '-' + line.main + '-' + line.time)
          }
          .width('100%')
          .layoutWeight(1)
        } else {
          // 空态文本
          Text(this.currentEmptyText())
            .fontSize(11)
            .fontColor(this.tk().onSurfaceVariant)
            .width('100%')
            .textAlign(TextAlign.Center)
            .margin({ top: 20 })
        }

        // 页脚
        if (this.currentFooterText().length > 0) {
          Text(this.currentFooterText())
            .fontSize(9)
            .fontColor(this.tk().textPlaceholder)
            .width('100%')
            .textAlign(TextAlign.Center)
            .margin({ top: 4 })
        }
      }
      .width('100%')
      .layoutWeight(1)
    }
  }

  /** 列表中的一行（@Builder：体内只写 UI 语法，背景色走 lineBg 方法）。 */
  @Builder
  widgetLine(line: WidgetLine) {
    Row() {
      // 时间列
      Column() {
        Text(line.time)
          .fontSize(9)
          .fontColor(this.tk().onSurfaceVariant)
          // ⚠️ 时间文本是 `09:55-12:20`（11 字符），36vp 放不下会折成两行
          //    （2026-10-27 真机卡片实拍：`08:00–2` / `0:55`）。这里钉单行 + 宽度给够。
          .maxLines(1)
          .textAlign(TextAlign.Center)
      }
      .width(54)
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
            .fontColor(line.muted ? this.tk().textPlaceholder : this.tk().onSurface)
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
        }
        .width('100%')
        .alignItems(VerticalAlign.Center)

        // 副标题
        if (line.lead.length > 0 || line.trail.length > 0) {
          Text((line.lead.length > 0 ? line.lead : '') + ' ' + (line.trail.length > 0 ? line.trail : ''))
            .fontSize(9)
            .fontColor(this.tk().onSurfaceVariant)
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
    .backgroundColor(this.lineBg(line))
    .borderRadius(4)
    .padding({ left: 6 })
    // M8-6：点条目直接落到对应的 App 页签（不是只把 App 拉起来）
    .onClick(() => {
      this.openApp();
    })
  }

  /**
   * 卡片 → 主 App 的深链（M8-6）。
   *
   * 用 `postCardAction` 的 `router` 动作把「该落到哪个内容」作为参数带进 want；
   * App 侧在 `EntryAbility.onCreate` 读参数、`Index` 消费。
   * ⚠️ 不用 `action:'message'`：那要起 FormExtension 的事件通道，链路更长且预览态收不到。
   */
  private openApp(): void {
    const page: WidgetPageData | null = this.currentPage();
    const kind: string = page === null ? 'COURSE' : page.kind;
    const params: CardRouterParams = { bit101Content: contentIdForKind(kind) };
    const action: CardRouterAction = {
      action: 'router',
      bundleName: 'cn.bit101.next',
      abilityName: 'EntryAbility',
      params: params
    };
    try {
      postCardAction(this, action);
    } catch (e) {
      warn('widget openApp fail: ' + JSON.stringify(e));
    }
  }

  /** 获取当前日期文本（北京时间） */
  private getCurrentDateText(): string {
    const now = new Date();
    const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
    const bjMs = utcMs + 8 * 3600000;
    const bjDate = new Date(bjMs);
    const month = bjDate.getUTCMonth() + 1;
    const day = bjDate.getUTCDate();
    const weekdays: string[] = ['日', '一', '二', '三', '四', '五', '六'];
    const weekday = bjDate.getUTCDay();
    return month + '月' + day + '日 周' + weekdays[weekday];
  }
}
