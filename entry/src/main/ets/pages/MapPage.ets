/**
 * 「图」页 —— 校园地图（1:1 对齐 BIT101-S 的 MapScreen / MapViewModel）。
 *
 * ## 实现形态
 * 原生 ArkUI 负责「壳」（左上 FAB 列 / 底部缩放栏 / ODbL 署名，配色走 gridTokens），
 * WebView 加载 rawfile/map.html 里的**内联瓦片引擎**负责「地图本身」：
 * - 瓦片源与 Android 完全同源：`https://map.bit101.flwfdd.xyz/tile/{z}/{col}/{row}.png`
 * - 坐标口径 = Web-Mercator 归一化 0..1，z15~z18（Android MapState(19, ...)）
 * - 拖拽 / 滚轮 / 双指缩放都在引擎里，经纬度换算见 corelogic/MapTileMath.ts
 *
 * ## 为什么不用系统地图 / 在线瓦片库
 * 用户拍板「按 Android 来、功能一样」——Android 就是自有瓦片地图 + 4 校区按钮。
 * 系统地图 `geo:` URI 只能跳出去、没有内嵌瓦片视野，做不到肉眼一致。
 *
 * ## ODbL 合规
 * 瓦片底图是 OpenStreetMap（自有服务只是反代，MapCampus.kt 注释实证），
 * ODbL 要求署名 ⇒ 右下角常驻「© OpenStreetMap contributors」（与 Android 一致）。
 */

import { webview } from '@kit.ArkWeb';
import { gridTokens } from '../core/theme/GridTokens.ts';
import type { GridTokens } from '../core/theme/GridTokens.ts';
import { STORAGE_DARK, STORAGE_PALETTE, getPalette } from '../data/ThemeStore.ts';
import { CAMPUSES, findCampus } from '../corelogic/CampusCenters.ts';
import type { CampusCenter } from '../corelogic/CampusCenters.ts';
import { info, warn } from '../core/log/BitLog.ts';

/** 地图缩放倍率（对齐 Android mapScale 默认 2f，范围 1..5，steps=7 ⇒ 每档 0.5）。 */
const SCALE_MIN: number = 1;
const SCALE_MAX: number = 5;
const SCALE_STEP: number = 0.5;

/** 倍率 → 瓦片层级（1 倍=z15 视野最大，5 倍=z18；与底栏缩放滑杆同一口径）。 */
function scaleToZoom(value: number): number {
  return 15 + (value - SCALE_MIN) / (SCALE_MAX - SCALE_MIN) * 3;
}

@Component
export struct MapPage {
  @StorageLink(STORAGE_DARK) isDark: boolean = false;
  @StorageLink(STORAGE_PALETTE) paletteName: string = 'brand';

  @State private currentCampus: string = '良乡校区';
  @State private showBottomBar: boolean = false;
  /** 默认 1 倍（用户拍板）：z15 视野最大，完整显示校区范围。 */
  @State private mapScale: number = 1;
  @State private tip: string = '';

  private controller: webview.WebviewController = new webview.WebviewController();

  private tk(): GridTokens {
    return gridTokens(this.isDark, getPalette(this.paletteName));
  }

  aboutToAppear(): void {
    this.currentCampus = CAMPUSES[0].name;
  }

  /** WebView 加载完本地引擎后定位到当前校区（Android init: goTo(ALL.first())）。 */
  private onPageEnd(): void {
    this.gotoCampus(this.currentCampus);
    const c: CampusCenter | null = findCampus(this.currentCampus);
    if (c !== null) {
      info('MapPage loaded, focus ' + c.name + ' (' + c.lon + ',' + c.lat + ')');
    }
  }

  /** 切校区：记高亮 + 通知引擎滚过去 + 弹一次提示（对齐 Android snackbar）。 */
  private gotoCampus(name: string): void {
    const c: CampusCenter | null = findCampus(name);
    if (c === null) {
      warn('MapPage unknown campus: ' + name);
      return;
    }
    this.currentCampus = name;
    this.controller.runJavaScript('window.MapEngine && window.MapEngine.goto(' +
      c.x.toFixed(6) + ',' + c.y.toFixed(6) + ',' + scaleToZoom(this.mapScale).toFixed(2) + ')')
      .catch((e: Error) => warn('MapEngine.goto fail: ' + JSON.stringify(e)));
    this.tip = '已切换到' + c.name;
  }

  /** 缩放滑杆 → 引擎层级（1..5 映射到 z15..18）。 */
  private onScaleChange(value: number): void {
    this.mapScale = value;
    const z: number = scaleToZoom(value);
    this.controller.runJavaScript('window.MapEngine && window.MapEngine.setZoom(' + z.toFixed(2) + ')')
      .catch((e: Error) => warn('MapEngine.setZoom fail: ' + JSON.stringify(e)));
  }

  build() {
    Stack({ alignContent: Alignment.TopStart }) {
      // ── 地图引擎（WebView 本地 HTML）──
      Web({
        src: $rawfile('map.html'),
        controller: this.controller,
      })
        .width('100%')
        .height('100%')
        .domStorageAccess(false)
        .javaScriptAccess(true)
        .zoomAccess(false)
        .onPageEnd(() => this.onPageEnd())

      // ── 左上 FAB 列（对齐 Android：设置 + 4 校区，50vp / 间距 10vp）──
      Column({ space: 10 }) {
        Stack() {
          Image($rawfile('icons/ic_settings.svg'))
            .width(22).height(22)
            .fillColor(this.tk().primary)
        }
        .width(50).height(50).borderRadius(25)
        .backgroundColor(this.tk().primaryContainer)
        .onClick(() => { this.showBottomBar = !this.showBottomBar; })

        ForEach(CAMPUSES, (c: CampusCenter) => {
          Button(c.short)
            .width(50).height(50).borderRadius(25)
            .fontSize(18).fontWeight(FontWeight.Medium)
            .fontColor(c.name === this.currentCampus ? this.tk().onPrimary : this.tk().primary)
            .backgroundColor(c.name === this.currentCampus ? this.tk().primary : this.tk().primaryContainer)
            .onClick(() => this.gotoCampus(c.name))
        }, (c: CampusCenter) => c.name)
      }
      .margin({ left: 10, top: 20 })

      // ── ODbL 署名：在 map.html 里用 CSS 固定定位渲染（右下角，底栏之上）──
      // 不放 ArkUI 层的原因：Stack 子元素默认 TopStart，position/markAnchor 在不同
      // 屏宽 vp 换算下反复飘（真机 alpha.28/29 署名跑到屏幕外）；HTML 层 absolute
      // 定位最稳，且底栏是原生层不在 WebView 内，署名 bottom 抬离底栏即可。

      // ── 切换提示条（对齐 Android snackbar：底部居中）──
      if (this.tip.length > 0) {
        Text(this.tip)
          .fontSize(13)
          .fontColor(this.tk().onSecondaryContainer)
          .backgroundColor(this.tk().secondaryContainer)
          .padding({ left: 14, right: 14, top: 8, bottom: 8 })
          .borderRadius(8)
          .position({ x: '50%', y: '100%' })
          .markAnchor({ x: '50%', y: 80 })
      }

      // ── 底部设置栏（缩放滑杆，对齐 Android 上滑面板）──
      if (this.showBottomBar) {
        Column() {
          Row() {
            Text('缩放倍率 ' + this.mapScale.toFixed(1))
              .fontSize(16).fontWeight(FontWeight.Medium)
              .fontColor(this.tk().onSurface)
              .layoutWeight(1)
            Text('×')
              .fontSize(22).fontColor(this.tk().onSurface)
              .width(36).textAlign(TextAlign.Center)
              .onClick(() => { this.showBottomBar = false; })
          }
          .width('100%')
          .margin({ bottom: 16 })

          Slider({
            value: this.mapScale,
            min: SCALE_MIN,
            max: SCALE_MAX,
            step: SCALE_STEP,
          })
            .width('100%')
            .onChange((value: number) => this.onScaleChange(value))
        }
        .width('100%')
        .padding(20)
        .backgroundColor(this.tk().surfaceElevated)
        .borderRadius({ topLeft: 16, topRight: 16 })
        .position({ x: 0, y: '100%' })
        .markAnchor({ x: 0, y: 0 })
      }
    }
    .width('100%')
    .height('100%')
    .backgroundColor(this.tk().background)
  }
}
