/**
 * 全局搜索页（P1）。
 *
 * ## 数据来源（全部本地，不发请求）
 * - **课程**：`CourseCache.loadLast()`（上次同步的课表；没登录过就是空）
 * - **作业**：`DdlStore.load()`（含本地新增条目）
 * - **地点**：`CampusLocations.ALL`（48 栋楼，OSM 坐标）
 * - **班车**：`ShuttleLogic` 的线路表（静态时刻）
 *
 * 为什么只搜本地：搜索是「找我已经有的东西」，不该因为搜一次就触发登录/风控。
 * 没缓存时如实说「还没有课表缓存，先去课表页同步」。
 *
 * ## 点击去哪
 * - 课程 → 写 `AppStorage[ui_focus_course]` 并回到课表（Index 消费后选中该课）
 * - 作业 → 作业页
 * - 地点 → 楼栋索引页（高亮该楼）
 * - 班车 → 交通页签
 */

import { router } from '@kit.ArkUI';
import { SearchKind, search, totalHits, kindLabel } from '../corelogic/SearchLogic.ts';
import type { SearchDoc, SearchGroup, SearchHit } from '../corelogic/SearchLogic.ts';
import { summaryText } from '../corelogic/CourseDetailLogic.ts';
import type { CourseMeta } from '../corelogic/CourseDetailLogic.ts';
import { gridTokens } from '../core/theme/GridTokens.ts';
import type { GridTokens } from '../core/theme/GridTokens.ts';
import { STORAGE_DARK, STORAGE_PALETTE, getPalette } from '../data/ThemeStore.ts';
import { CourseCache } from '../data/CourseCache.ts';
import { DdlStore } from '../data/DdlStore.ts';
import { ALL } from '../corelogic/CampusLocations.ts';
import type { Location } from '../corelogic/CampusLocations.ts';
import { STORAGE_FOCUS_COURSE, STORAGE_FOCUS_BUILDING } from '../corelogic/SearchNav.ts';
import { ddlDisplayName } from '../corelogic/TeachingAdjustment.ts';
import { info, warn } from '../core/log/BitLog.ts';

@Entry
@Component
export struct SearchPage {
  @StorageLink(STORAGE_DARK) isDark: boolean = false;
  @StorageLink(STORAGE_PALETTE) paletteName: string = 'warm';

  @State query: string = '';
  @State groups: SearchGroup[] = [];
  @State docCount: number = 0;
  @State loadNote: string = '';
  @State busy: boolean = true;

  private docs: SearchDoc[] = [];

  private tk(): GridTokens {
    return gridTokens(this.isDark, getPalette(this.paletteName));
  }

  aboutToAppear(): void {
    this.loadDocs();
  }

  /** 把四个数据源压成统一文档（一次装载，之后纯内存搜索）。 */
  private async loadDocs(): Promise<void> {
    const out: SearchDoc[] = [];
    // 课程
    try {
      const cached = await CourseCache.loadLast();
      if (cached !== null) {
        for (let i = 0; i < cached.courses.length; i++) {
          const c = cached.courses[i];
          if (c.KCM.trim().length === 0) {
            continue;
          }
          const meta: CourseMeta = {
            KCM: c.KCM, KCH: c.KCH, SKJS: c.SKJS, JASMC: c.JASMC, XXXQMC: c.XXXQMC,
            YPSJDD: c.YPSJDD, SKZC: c.SKZC, XF: c.XF, XS: c.XS,
            KCXZDM_DISPLAY: c.KCXZDM_DISPLAY, KCLBDM_DISPLAY: c.KCLBDM_DISPLAY,
            KKDWDM_DISPLAY: c.KKDWDM_DISPLAY,
          };
          // 同一门课多个时间段会重复出现：id 带上节次，保证唯一
          out.push({
            id: 'course:' + c.KCM + ':' + c.KCH + ':' + c.SKXQ + '-' + c.KSJC,
            kind: SearchKind.Course,
            title: c.KCM,
            subtitle: summaryText(meta),
            extra: c.KCH + ' ' + c.SKJS + ' ' + c.JASMC,
          });
        }
      }
    } catch (e) {
      warn('SearchPage course fail: ' + JSON.stringify(e));
    }
    // 作业
    try {
      const ddls = await DdlStore.load();
      for (let i = 0; i < ddls.length; i++) {
        const d = ddls[i];
        out.push({
          id: 'ddl:' + d.uid,
          kind: SearchKind.Ddl,
          title: d.title,
          subtitle: ddlDisplayName(d.group) + (d.text.length > 0 ? ' · ' + d.text : ''),
          extra: d.group,
        });
      }
    } catch (e) {
      warn('SearchPage ddl fail: ' + JSON.stringify(e));
    }
    // 地点（楼栋）
    for (let i = 0; i < ALL.length; i++) {
      const loc: Location = ALL[i];
      out.push({
        id: 'room:' + loc.name,
        kind: SearchKind.Room,
        title: loc.name,
        subtitle: loc.campusName,
        extra: loc.aliases.join(' '),
      });
    }
    this.docs = out;
    this.docCount = out.length;
    this.busy = false;
    this.loadNote = out.length === 0
      ? '还没有可搜索的数据。先去课表页同步一次。'
      : '';
    info('SearchPage docs=' + out.length);
    if (this.query.length > 0) {
      this.groups = search(this.docs, this.query, 8);
    }
  }

  private onQuery(text: string): void {
    this.query = text;
    this.groups = search(this.docs, text, 8);
  }

  /** 结果总数提示。 */
  private resultLine(): string {
    if (this.query.trim().length === 0) {
      return '';
    }
    const n: number = totalHits(this.groups);
    return n === 0 ? '没有匹配结果' : '找到 ' + n + ' 个结果';
  }

  /** 点击一条结果。 */
  private open(hit: SearchHit): void {
    const kind: SearchKind = hit.doc.kind;
    if (kind === SearchKind.Course) {
      AppStorage.setOrCreate<string>(STORAGE_FOCUS_COURSE, hit.doc.title);
      AppStorage.setOrCreate<string>('ui_open_content', 'timetable');
      router.replaceUrl({ url: 'pages/Index' }).catch((e: Error) => {
        warn('SearchPage -> index fail: ' + JSON.stringify(e));
      });
      return;
    }
    if (kind === SearchKind.Ddl) {
      router.pushUrl({ url: 'pages/DdlPage' }).catch((e: Error) => {
        warn('SearchPage -> ddl fail: ' + JSON.stringify(e));
      });
      return;
    }
    if (kind === SearchKind.Room) {
      router.pushUrl({
        url: 'pages/CampusMapPage',
        params: { building: hit.doc.title },
      }).catch((e: Error) => {
        warn('SearchPage -> map fail: ' + JSON.stringify(e));
      });
      return;
    }
    AppStorage.setOrCreate<string>('ui_open_content', 'transport');
    router.replaceUrl({ url: 'pages/Index' }).catch((e: Error) => {
      warn('SearchPage -> index fail: ' + JSON.stringify(e));
    });
  }

  @Builder
  groupTitle(kind: SearchKind, count: number) {
    Row() {
      Text(kindLabel(kind))
        .fontSize(12).fontWeight(FontWeight.Medium)
        .fontColor(this.tk().primary)
      Text(String(count))
        .fontSize(11).fontColor(this.tk().onSurfaceVariant)
        .margin({ left: 6 })
    }
    .width('100%')
    .padding({ left: 12, right: 12, top: 14, bottom: 6 })
  }

  @Builder
  hitRow(hit: SearchHit) {
    Column() {
      Text(hit.doc.title)
        .fontSize(15).fontColor(this.tk().onSurface)
        .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
        .width('100%')
      if (hit.doc.subtitle.length > 0) {
        Text(hit.doc.subtitle)
          .fontSize(12).fontColor(this.tk().onSurfaceVariant)
          .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
          .width('100%').margin({ top: 2 })
      }
    }
    .width('100%')
    .padding({ left: 12, right: 12, top: 10, bottom: 10 })
    .alignItems(HorizontalAlign.Start)
    // 无障碍：整行可读（标题 + 副标题 + 类型），否则读屏只念标题
    .accessibilityText(hit.doc.title +
      (hit.doc.subtitle.length > 0 ? '，' + hit.doc.subtitle : '') +
      '，' + kindLabel(hit.doc.kind))
    .onClick(() => this.open(hit))
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
        Text('搜索')
          .fontSize(17).fontWeight(FontWeight.Bold).fontColor(this.tk().onSurface)
          .layoutWeight(1)
      }
      .width('100%').height(52)
      .backgroundColor(this.tk().background)

      // 搜索框
      Search({ value: this.query, placeholder: '课程 / 作业 / 楼栋' })
        .width('100%')
        .height(40)
        .margin({ left: 12, right: 12 })
        .backgroundColor(this.tk().surfaceVariant)
        .placeholderColor(this.tk().onSurfaceVariant)
        .fontColor(this.tk().onSurface)
        .onChange((v: string) => this.onQuery(v))

      // 提示 / 结果
      if (this.busy) {
        Text('正在读取本地数据…')
          .fontSize(13).fontColor(this.tk().onSurfaceVariant)
          .width('100%').padding(24)
      } else if (this.loadNote.length > 0) {
        Text(this.loadNote)
          .fontSize(13).fontColor(this.tk().onSurfaceVariant)
          .width('100%').padding(24)
      } else if (this.query.trim().length === 0) {
        Column() {
          Text('可以搜这些')
            .fontSize(13).fontColor(this.tk().onSurfaceVariant)
            .width('100%')
          Text('· 课程名、教师、教室、课程号\n· 作业标题与说明\n· 楼栋名（文萃楼I404、图书馆…）')
            .fontSize(12).fontColor(this.tk().textPlaceholder)
            .width('100%').margin({ top: 8 })
          Text('当前可搜 ' + String(this.docCount) + ' 条（全部来自本机缓存）')
            .fontSize(11).fontColor(this.tk().textPlaceholder)
            .width('100%').margin({ top: 12 })
        }
        .width('100%').padding(16)
        .alignItems(HorizontalAlign.Start)
      } else {
        Text(this.resultLine())
          .fontSize(11).fontColor(this.tk().onSurfaceVariant)
          .width('100%').padding({ left: 12, right: 12, top: 8 })
        Scroll() {
          Column() {
            ForEach(this.groups, (g: SearchGroup) => {
              this.groupTitle(g.kind, g.hits.length)
              ForEach(g.hits, (hit: SearchHit) => {
                this.hitRow(hit)
              }, (hit: SearchHit) => hit.doc.id)
            }, (g: SearchGroup) => g.kind)
          }
          .width('100%')
        }
        .layoutWeight(1)
        .align(Alignment.Top)
        .width('100%')
        .scrollBar(BarState.Auto)
      }
    }
    .width('100%').height('100%')
    .backgroundColor(this.tk().background)
  }
}
