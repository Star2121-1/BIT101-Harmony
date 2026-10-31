/**
 * Index —— 应用外壳（App Shell）
 *
 * ## 对齐原版（`IndexScreen.kt` + `ScheduleScreen` 的 `TabPager`）
 * 原版**没有「首页」**：一进 App 就是「卷 · 课表」。所以这个文件不再是一个
 * 功能页，而是两层导航的容器：
 *   底部 6 模块（卷/图/网/话/我/座） → 其中「卷」内部再分 5 页签
 *   （课表/DDL/动态/空教室/交通）。
 * 旧版本这里是「4 个按钮 + 自习卡 + 作业卡」，那是自造结构，与原版无关 —— 已拆掉：
 * 自习卡搬进「我」页（原版就在那儿，ref-03），作业卡删掉（DDL 本来就是一个页签）。
 *
 * ## 保活策略（借鉴 `yang-kun-long/BIT101-HarmonyNext` 的 Stack + visibility）
 * 切页签不销毁页面 ⇒ 不重复打网络、不丢滚动位置。但**不能一次性建 7 页**
 * （冷启动会同时发 7 个请求），所以再叠一层「访问过才建」的白名单 `visited`。
 *
 * ⚠️ 状态用 key 不用下标：见 `corelogic/shellNav.ts` 的说明。
 * ⚠️ build() 根部不声明局部变量（编译器只认根节点起手）⇒ 派生值走私有方法。
 */

import { router } from '@kit.ArkUI';
import { gridTokens } from '../core/theme/GridTokens.ts';
import { warn } from '../core/log/BitLog.ts';
import { STORAGE_DARK, STORAGE_PALETTE, getPalette } from '../data/ThemeStore.ts';
import {
  NAV_MODULES,
  SCHEDULE_TABS,
  DEFAULT_MODULE,
  DEFAULT_TAB,
  contentIdOf,
  normalizeModule,
  normalizeTab,
  showsTopTabs,
  shellStateOf,
} from '../corelogic/shellNav.ts';
import type { ShellSelection } from '../corelogic/shellNav.ts';
import { STORAGE_OPEN_CONTENT } from '../corelogic/WidgetDeepLink.ts';
import { STORAGE_OPEN_PAGE, sanitizePage } from '../corelogic/NotifyDeepLink.ts';
import { TopTabBar } from '../components/shell/TopTabBar.ets';
import { BottomNavBar } from '../components/shell/BottomNavBar.ets';
import { ModulePlaceholder } from '../components/shell/ModulePlaceholder.ets';
import { SchedulePage } from './SchedulePage.ets';
import { DdlPage } from './DdlPage.ets';
import { EclassActivityPage } from './EclassActivityPage.ets';
import { ClassroomPage } from './ClassroomPage.ets';
import { ShuttlePage } from './ShuttlePage.ets';
import { MePage } from './MePage.ets';
import { SeatPage } from './SeatPage.ets';

@Entry
@Component
struct Index {
  @StorageLink(STORAGE_DARK) isDark: boolean = false;
  @StorageLink(STORAGE_PALETTE) paletteName: string = 'warm';

  /** 当前模块 key（卷/图/网/话/我/座）。 */
  @State private moduleKey: string = DEFAULT_MODULE;
  /** 当前「卷」内页签 key（其余模块保持上次值，切回来不丢位置）。 */
  @State private tabKey: string = DEFAULT_TAB;
  /** 已访问过的内容标识（懒建白名单，避免冷启动同时建 7 页）。 */
  @State private visited: string[] = [DEFAULT_TAB];
  /**
   * 外壳重新可见的序号：从登录页/详情页 back 回来时自增，
   * 传给「我」页触发刷新 —— 壳里的页是保活的，收不到 onPageShow（2026-10-31）。
   */
  @State private epoch: number = 0;

  private tk() {
    return gridTokens(this.isDark, getPalette(this.paletteName));
  }

  /** 当前该渲染哪个内容（= 页签 key 或模块 key）。 */
  private currentId(): string {
    return contentIdOf(this.moduleKey, this.tabKey);
  }

  /** 该内容是否已建过（没建过就不渲染，触发懒建）。 */
  private isVisited(id: string): boolean {
    return this.visited.indexOf(id) >= 0;
  }

  /** 内容可见性：只有当前内容可见，其余保留状态但隐藏。 */
  private visOf(id: string): Visibility {
    return this.currentId() === id ? Visibility.Visible : Visibility.None;
  }

  /** 记一次访问（幂等）。 */
  private markVisited(id: string): void {
    if (this.visited.indexOf(id) < 0) {
      const next: string[] = this.visited.slice();
      next.push(id);
      this.visited = next;
    }
  }

  /** 切页签（仅「卷」内）。 */
  private selectTab(key: string): void {
    this.tabKey = normalizeTab(key);
    this.markVisited(contentIdOf('schedule', this.tabKey));
  }

  /** 切模块。 */
  private selectModule(key: string): void {
    this.moduleKey = normalizeModule(key);
    this.markVisited(contentIdOf(this.moduleKey, this.tabKey));
  }

  /**
   * M8-6：卡片深链落点。
   * `EntryAbility.onCreate` 把卡片带来的内容 id 写进 AppStorage，这里消费一次就清空
   * （否则每次回首页都会被它拽回同一页）。
   */
  aboutToAppear(): void {
    const raw: string | undefined = AppStorage.get<string>(STORAGE_OPEN_CONTENT);
    if (raw === undefined || raw.length === 0) {
      return;
    }
    AppStorage.setOrCreate<string>(STORAGE_OPEN_CONTENT, '');
    const sel: ShellSelection = shellStateOf(raw);
    this.moduleKey = sel.module;
    this.tabKey = sel.tab;
    this.markVisited(contentIdOf(this.moduleKey, this.tabKey));
  }

  /**
   * 通知深链带来的独立页（`bit101Page`）：读完清空再 pushUrl。
   * 路径已在 `NotifyDeepLink.sanitizePage` 过白名单，这里不重复判断（但清空是必须的）。
   */
  private consumeOpenPage(): void {
    const raw: string | undefined = AppStorage.get<string>(STORAGE_OPEN_PAGE);
    if (raw === undefined || raw.length === 0) {
      return;
    }
    AppStorage.setOrCreate<string>(STORAGE_OPEN_PAGE, '');
    const page: string = sanitizePage(raw);
    if (page.length === 0) {
      return;
    }
    router.pushUrl({ url: page }).catch((e: Error) => {
      warn('Index open page fail: ' + JSON.stringify(e));
    });
  }

  onPageShow(): void {
    // 通知点击进来时 App 可能已在运行 ⇒ 每次可见都消费一次（读完即清）
    this.consumeOpenPage();
    // 从登录页/详情页回来：「我」页要重读会话（壳内子组件收不到 onPageShow）
    this.epoch = this.epoch + 1;
  }

  build() {
    Column() {
      // ── 顶部 5 页签：只有「卷」有（座位页自带「预约/列表」双 chip，不共用这行）──
      if (showsTopTabs(this.moduleKey)) {
        TopTabBar({
          tabs: SCHEDULE_TABS,
          selectedKey: this.tabKey,
          onSelect: (key: string) => {
            this.selectTab(key);
          },
        })
      }

      // ── 内容区：Stack + visibility 保活 ──
      Stack() {
        if (this.isVisited('timetable')) {
          Column() {
            SchedulePage({ isEmbedded: true })
          }
          .width('100%').height('100%')
          .visibility(this.visOf('timetable'))
        }

        if (this.isVisited('ddl')) {
          Column() {
            DdlPage({ isEmbedded: true })
          }
          .width('100%').height('100%')
          .visibility(this.visOf('ddl'))
        }

        if (this.isVisited('feed')) {
          Column() {
            EclassActivityPage({ isEmbedded: true })
          }
          .width('100%').height('100%')
          .visibility(this.visOf('feed'))
        }

        if (this.isVisited('classroom')) {
          Column() {
            ClassroomPage({ isEmbedded: true })
          }
          .width('100%').height('100%')
          .visibility(this.visOf('classroom'))
        }

        if (this.isVisited('transport')) {
          Column() {
            ShuttlePage({ isEmbedded: true })
          }
          .width('100%').height('100%')
          .visibility(this.visOf('transport'))
        }

        if (this.isVisited('mine')) {
          Column() {
            MePage({
              isEmbedded: true,
              active: this.currentId() === 'mine',
              epoch: this.epoch,
            })
          }
          .width('100%').height('100%')
          .visibility(this.visOf('mine'))
        }

        if (this.isVisited('seat')) {
          Column() {
            SeatPage({ isEmbedded: true })
          }
          .width('100%').height('100%')
          .visibility(this.visOf('seat'))
        }

        // 图 / 网 / 话：格子保留（原版固定 6 格），内容如实说明现状
        if (this.currentId() === 'map') {
          // 原版这页是地图；鸿蒙侧不做在线瓦片（配额 + ODbL 条款），
          // 改成「楼栋索引 + 系统地图打开」——能真用，且不假装是地图。
          Column() {
            Text('校园楼栋')
              .fontSize(18).fontWeight(FontWeight.Bold).fontColor(this.tk().onSurface)
              .width('100%')
            Text('按校区列出 48 栋楼，可查「本机课表里在这栋楼上过什么课」，并可用系统地图打开。')
              .fontSize(12).fontColor(this.tk().onSurfaceVariant)
              .width('100%').margin({ top: 8 })
            Button('打开楼栋索引')
              .height(36).fontSize(13).margin({ top: 16 })
              .backgroundColor(this.tk().primary).fontColor(this.tk().onPrimary)
              .onClick(() => {
                router.pushUrl({ url: 'pages/CampusMapPage' }).catch((e: Error) => {
                  warn('Index -> map fail: ' + JSON.stringify(e));
                });
              })
          }
          .width('100%').height('100%')
          .padding({ left: 20, right: 20, top: 40 })
          .alignItems(HorizontalAlign.Start)
          .backgroundColor(this.tk().background)
        }
        if (this.currentId() === 'web') {
          ModulePlaceholder({
            title: 'BIT101 网页',
            reason: '这个入口打开的是 BIT101 站点的网页视图。当前 BIT101 后端不可用，打开只会是空白页，所以先不挂进去。',
            icon: 'nav_web.svg',
          })
        }
        if (this.currentId() === 'gallery') {
          ModulePlaceholder({
            title: '话廊',
            reason: '社区（发帖 / 评论 / 关注）不在当前排期里，鸿蒙侧未实现。',
            icon: 'nav_gallery.svg',
          })
        }
      }
      .width('100%')
      .layoutWeight(1)
      .backgroundColor(this.tk().background)

      // ── 底部 6 模块 ──
      BottomNavBar({
        items: NAV_MODULES,
        selectedKey: this.moduleKey,
        onSelect: (key: string) => {
          this.selectModule(key);
        },
      })
    }
    .width('100%')
    .height('100%')
    .backgroundColor(this.tk().background)
  }
}
