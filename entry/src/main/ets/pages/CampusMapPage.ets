/**
 * 校园楼栋索引页（P4）。
 *
 * ## 这不是地理地图（页面上也这么写）
 * `CampusLocations` 的坐标来自 OSM，精度约 31 米一格；同栋楼不同翼（文萃楼 H/I/K/M）
 * 归一化坐标只差 1e-6 —— 投影到画布上会重叠成一个点。所以本页做**楼栋目录**：
 * 按校区归类、可搜索、显示每栋楼在本机课表里出现的课程，并给出经纬度与「系统地图打开」。
 *
 * ## 为什么不用在线瓦片
 * 瓦片服务有配额与署名条款（ODbL），自建瓦片又要服务器。把「打开真实地图」交给系统地图应用
 * （`geo:` URI）是唯一不越界又真能用的做法。
 *
 * ## 数据
 * - 楼栋：`CampusDirectory`（48 栋，来自 OSM）
 * - 课程：`CourseCache.loadLast()`（本机缓存，没同步过就是空 —— 如实显示「本机没有课表缓存」）
 */

import { router } from '@kit.ArkUI';
import { common } from '@kit.AbilityKit';
import { promptAction } from '@kit.ArkUI';
import {
  groupByCampus, searchBuildings, coursesAt, lonLatText, geoUri,
} from '../corelogic/CampusDirectory.ts';
import type { CampusGroup, CoursePlace } from '../corelogic/CampusDirectory.ts';
import type { Location } from '../corelogic/CampusLocations.ts';
import { sanitizeBuildingName, STORAGE_FOCUS_BUILDING } from '../corelogic/SearchNav.ts';
import { gridTokens } from '../core/theme/GridTokens.ts';
import type { GridTokens } from '../core/theme/GridTokens.ts';
import { STORAGE_DARK, STORAGE_PALETTE, getPalette } from '../data/ThemeStore.ts';
import { CourseCache } from '../data/CourseCache.ts';
import { info, warn } from '../core/log/BitLog.ts';

/** 一栋楼的展示数据（楼栋 + 本机课程）。 */
interface BuildingCard {
  name: string;
  campus: string;
  courses: string[];
}

@Entry
@Component
export struct CampusMapPage {
  @StorageLink(STORAGE_DARK) isDark: boolean = false;
  @StorageLink(STORAGE_PALETTE) paletteName: string = 'warm';

  @State campus: string = '良乡校区';
  @State query: string = '';
  @State cards: BuildingCard[] = [];
  @State selected: BuildingCard | null = null;
  @State note: string = '';
  @State courseCount: number = 0;

  private groups: CampusGroup[] = [];
  private places: CoursePlace[] = [];

  private tk(): GridTokens {
    return gridTokens(this.isDark, getPalette(this.paletteName));
  }

  aboutToAppear(): void {
    this.groups = groupByCampus();
    this.init();
  }

  /**
   * ⚠️ 必须先 await 课表、再 refresh。
   *
   * 真机实踩（2026-10-28）：这里原来是 `this.loadCourses(); this.refresh();` 两条并列，
   * loadCourses 是 async 且没 await ⇒ refresh() 跑的时候 `places` 还是空数组，
   * 于是**每一栋楼都显示「课表里没有这栋楼的课」**，看起来像楼栋匹配坏了，
   * 实际匹配逻辑（有单测）完全正确。@State places 变了也不会自动重建 cards
   * （cards 是另一个 @State，只有 refresh 会写）。
   */
  private async init(): Promise<void> {
    await this.loadCourses();
    this.refresh();
  }

  /** 读本机课表缓存 → 归到楼栋上。 */
  private async loadCourses(): Promise<void> {
    try {
      const cached = await CourseCache.loadLast();
      if (cached === null) {
        this.note = '本机还没有课表缓存（去课表页同步后，这里会显示每栋楼上过什么课）';
        return;
      }
      const list: CoursePlace[] = [];
      for (let i = 0; i < cached.courses.length; i++) {
        const c = cached.courses[i];
        list.push({ name: c.KCM, place: c.JASMC });
      }
      this.places = list;
      this.courseCount = cached.courses.length;
      info('CampusMapPage courses=' + list.length);
    } catch (e) {
      warn('CampusMapPage course fail: ' + JSON.stringify(e));
      this.note = '读取课表缓存失败（不影响楼栋浏览）';
    }
  }

  /** 按校区 + 搜索词重建卡片。 */
  private refresh(): void {
    const hits: Location[] = searchBuildings(this.query, this.campus);
    const cards: BuildingCard[] = [];
    for (let i = 0; i < hits.length; i++) {
      cards.push({
        name: hits[i].name,
        campus: hits[i].campusName,
        courses: coursesAt(hits[i].name, this.places),
      });
    }
    this.cards = cards;
  }

  /** 从搜索页带过来的高亮楼栋。 */
  private applyInitialFocus(): void {
    try {
      const params = router.getParams() as Record<string, Object>;
      if (params === null || params === undefined) {
        return;
      }
      const raw = params['building'];
      const name: string = sanitizeBuildingName(typeof raw === 'string' ? raw as string : '');
      if (name.length === 0) {
        return;
      }
      // 切到该楼所在校区
      for (let i = 0; i < this.groups.length; i++) {
        for (let j = 0; j < this.groups[i].buildings.length; j++) {
          if (this.groups[i].buildings[j].name === name) {
            this.campus = this.groups[i].campus;
            this.query = '';
            this.refresh();
            this.selectByName(name);
            return;
          }
        }
      }
    } catch (e) {
      warn('CampusMapPage params fail: ' + JSON.stringify(e));
    }
  }

  private selectByName(name: string): void {
    for (let i = 0; i < this.cards.length; i++) {
      if (this.cards[i].name === name) {
        this.selected = this.cards[i];
        return;
      }
    }
  }

  /** 用系统地图打开（不在 App 内画瓦片）。 */
  private openInSystemMap(card: BuildingCard): void {
    const group: CampusGroup[] = this.groups;
    let loc: Location | null = null;
    for (let i = 0; i < group.length; i++) {
      for (let j = 0; j < group[i].buildings.length; j++) {
        if (group[i].buildings[j].name === card.name) {
          loc = group[i].buildings[j];
          break;
        }
      }
    }
    if (loc === null) {
      return;
    }
    const ctx = getContext(this) as common.UIAbilityContext;
    ctx.startAbility({
      action: 'ohos.want.action.viewData',
      uri: geoUri(loc),
    }).then(() => {
      info('CampusMapPage open system map ok ' + card.name);
    }).catch((e: Error) => {
      // 设备没有地图应用：把坐标给用户，别假装打开了
      promptAction.showToast({ message: '没有可用的地图应用。坐标：' + lonLatText(loc as Location) });
      warn('CampusMapPage startAbility fail: ' + JSON.stringify(e));
    });
  }

  @Builder
  campusChip(name: string) {
    Text(name)
      .fontSize(13)
      .fontColor(this.campus === name ? this.tk().onPrimary : this.tk().onSurfaceVariant)
      .backgroundColor(this.campus === name ? this.tk().primary : this.tk().surface2)
      .borderRadius(14)
      .padding({ left: 14, right: 14, top: 6, bottom: 6 })
      .margin({ right: 8 })
      .accessibilityText('校区 ' + name + (this.campus === name ? '，已选中' : ''))
      .onClick(() => {
        this.campus = name;
        this.selected = null;
        this.refresh();
      })
  }

  @Builder
  buildingCard(card: BuildingCard) {
    Column() {
      Text(card.name)
        .fontSize(14).fontColor(this.tk().onSurface)
        .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
        .width('100%')
      Text(card.courses.length > 0 ? '本机课表 ' + String(card.courses.length) + ' 门' : '课表里没有这栋楼的课')
        .fontSize(11)
        .fontColor(card.courses.length > 0 ? this.tk().primary : this.tk().textPlaceholder)
        .width('100%').margin({ top: 4 })
    }
    .width('47%')
    .padding(12)
    .margin({ bottom: 10 })
    .alignItems(HorizontalAlign.Start)
    .backgroundColor(this.selected !== null && this.selected.name === card.name
      ? this.tk().primaryContainer : this.tk().surface)
    .borderRadius(12)
    .accessibilityText(card.name + '，' + card.campus +
      (card.courses.length > 0 ? '，本机课表 ' + card.courses.length + ' 门课' : '，本机课表没有'))
    .onClick(() => {
      this.selected = card;
      AppStorage.setOrCreate<string>(STORAGE_FOCUS_BUILDING, card.name);
    })
  }

  build() {
    Column() {
      // 顶栏
      Row() {
        Text('‹')
          .fontSize(28).fontColor(this.tk().onSurface).width(40)
          .textAlign(TextAlign.Center)
          .accessibilityText('返回')
          .onClick(() => router.back())
        Text('校园楼栋')
          .fontSize(17).fontWeight(FontWeight.Bold).fontColor(this.tk().onSurface)
          .layoutWeight(1)
        Text(String(this.cards.length) + ' 栋')
          .fontSize(12).fontColor(this.tk().onSurfaceVariant)
          .margin({ right: 14 })
      }
      .width('100%').height(52)

      // 说明（诚实：这不是地图）
      Text('楼栋索引（不是地图）：坐标来自 OpenStreetMap，精度约 31 米，同栋不同翼会重合，因此按目录列出。')
        .fontSize(11).fontColor(this.tk().textPlaceholder)
        .width('100%').padding({ left: 14, right: 14, bottom: 6 })

      // 搜索
      Search({ value: this.query, placeholder: '搜楼栋（文萃 / 图书馆…）' })
        .width('100%').height(38)
        .margin({ left: 14, right: 14 })
        .backgroundColor(this.tk().surfaceVariant)
        .placeholderColor(this.tk().onSurfaceVariant)
        .fontColor(this.tk().onSurface)
        .onChange((v: string) => {
          this.query = v;
          this.refresh();
        })

      // 校区 chips
      Flex({ wrap: FlexWrap.Wrap }) {
        ForEach(this.groups, (g: CampusGroup) => {
          this.campusChip(g.campus)
        }, (g: CampusGroup) => g.campus)
      }
      .width('100%')
      .padding({ left: 14, right: 14, top: 10, bottom: 6 })

      if (this.note.length > 0) {
        Text(this.note)
          .fontSize(11).fontColor(this.tk().onSurfaceVariant)
          .width('100%').padding({ left: 14, right: 14, bottom: 6 })
      }

      // 楼栋列表
      Scroll() {
        Column() {
          if (this.cards.length === 0) {
            Text(this.query.length > 0 ? '这个校区没有匹配的楼栋' : '这个校区没有楼栋数据')
              .fontSize(13).fontColor(this.tk().onSurfaceVariant)
              .width('100%').padding(24)
          } else {
            Flex({ wrap: FlexWrap.Wrap, justifyContent: FlexAlign.SpaceBetween }) {
              ForEach(this.cards, (card: BuildingCard) => {
                this.buildingCard(card)
              }, (card: BuildingCard) => card.campus + '|' + card.name)
            }
            .width('100%')
          }

          // 选中详情
          if (this.selected !== null) {
            Column() {
              Text(this.selected!.name)
                .fontSize(15).fontWeight(FontWeight.Medium).fontColor(this.tk().onSurface)
                .width('100%')
              Text(this.selected!.campus)
                .fontSize(12).fontColor(this.tk().onSurfaceVariant)
                .width('100%').margin({ top: 2 })
              Text('坐标 ' + this.coordText(this.selected!.name))
                .fontSize(11).fontColor(this.tk().textPlaceholder)
                .width('100%').margin({ top: 6 })
              if (this.selected!.courses.length > 0) {
                Text('本机课表：' + this.selected!.courses.join('、'))
                  .fontSize(12).fontColor(this.tk().onSurfaceVariant)
                  .width('100%').margin({ top: 6 })
              } else {
                Text('本机课表里没有这门楼的课')
                  .fontSize(12).fontColor(this.tk().textPlaceholder)
                  .width('100%').margin({ top: 6 })
              }
              Row() {
                Button('在系统地图中打开')
                  .height(34).fontSize(13)
                  .backgroundColor(this.tk().primary)
                  .fontColor(this.tk().onPrimary)
                  .onClick(() => this.openInSystemMap(this.selected!))
                Button('关闭')
                  .height(34).fontSize(13).margin({ left: 10 })
                  .backgroundColor(this.tk().surface2)
                  .fontColor(this.tk().onSurfaceVariant)
                  .onClick(() => {
                    this.selected = null;
                  })
              }
              .width('100%').margin({ top: 12 })
            }
            .width('100%').padding(14).margin({ top: 10, bottom: 16 })
            .alignItems(HorizontalAlign.Start)
            .backgroundColor(this.tk().surfaceVariant)
            .borderRadius(12)
          }

          // 署名（ODbL 要求）
          Text('坐标数据 © OpenStreetMap 贡献者，ODbL 许可。本页仅做楼栋索引，不提供在线瓦片。')
            .fontSize(10).fontColor(this.tk().textPlaceholder)
            .width('100%').padding({ top: 8, bottom: 24 })
        }
        .width('100%')
        .padding({ left: 14, right: 14 })
      }
      .layoutWeight(1)
      .align(Alignment.Top)
      .width('100%')
      .scrollBar(BarState.Auto)
    }
    .width('100%').height('100%')
    .backgroundColor(this.tk().background)
    .onAppear(() => this.applyInitialFocus())
  }

  /** 楼栋坐标文本（找不到给空串，不显示「坐标 undefined」）。 */
  private coordText(name: string): string {
    for (let i = 0; i < this.groups.length; i++) {
      for (let j = 0; j < this.groups[i].buildings.length; j++) {
        const b: Location = this.groups[i].buildings[j];
        if (b.name === name) {
          return lonLatText(b);
        }
      }
    }
    return '';
  }
}
