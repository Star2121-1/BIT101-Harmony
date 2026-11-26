/**
 * 「网」页 —— App 内 WebView 打开 BIT101 官网（1:1 对齐 BIT101-S 的 WebScreen）。
 *
 * ## 对齐 Android WebScreen.kt 的三件事
 * 1. 顶部 #FF9A57 橙色状态栏占位（原版 `Color(0xFFFF9A57)`），下方 WebView 全屏。
 * 2. onPageBegin 注入 localStorage.store：theme_mode=dark/light + fake_cookie（从已
 *    opt-in 的社区票据读，没有就只写主题）。对齐 Android「onPageStarted」的两段 JS。
 * 3. 顶部线性进度条（secondary 色）；非 bit101.cn 的链接交系统浏览器。
 *
 * ## 边界（如实）
 * BIT101 社区后端当前不可用，首页可能空白——这是服务端现状，不是 App 姿势错；
 * 页面仍按原版完整实现，用户可见真实加载结果，不伪造内容、不显示假占位。
 */

import { webview } from '@kit.ArkWeb';
import { router, promptAction } from '@kit.ArkUI';
import { common } from '@kit.AbilityKit';
import { shouldHandOff, isHttpUrl } from '../corelogic/WebNavPolicy.ts';
import { gridTokens } from '../core/theme/GridTokens.ts';
import type { GridTokens } from '../core/theme/GridTokens.ts';
import { STORAGE_DARK, STORAGE_PALETTE, getPalette } from '../data/ThemeStore.ts';
import { FakeCookieStore } from '../data/FakeCookieStore.ts';
import { warn } from '../core/log/BitLog.ts';

/** 对齐 Android WebViewModel.BASE_URL。 */
const BASE_URL: string = 'https://bit101.cn';
/** Android WebScreen 顶部状态栏品牌色。 */
const STATUS_BAR_COLOR: string = '#FF9A57';

@Component
export struct WorldWebPage {
  @StorageLink(STORAGE_DARK) isDark: boolean = false;
  @StorageLink(STORAGE_PALETTE) paletteName: string = 'brand';

  @State private progress: number = 0;
  private controller: webview.WebviewController = new webview.WebviewController();

  private tk(): GridTokens {
    return gridTokens(this.isDark, getPalette(this.paletteName));
  }

  /** 对齐 Android onPageStarted 的 localStorage 注入（theme + fakeCookie）。 */
  private injectStore(): void {
    const mode: string = this.isDark ? 'dark' : 'light';
    FakeCookieStore.load().then((fakeCookie: string) => {
      let js: string = this.storeScript('theme_mode', mode);
      if (fakeCookie.length > 0) {
        js = js + '\n' + this.storeScript('fake_cookie', fakeCookie);
      }
      this.controller.runJavaScript(js).catch((e: Error) => {
        warn('WorldWeb inject fail: ' + JSON.stringify(e));
      });
    }).catch((e: Error) => {
      warn('WorldWeb fakeCookie read fail: ' + JSON.stringify(e));
      // 读不到票据也注入主题（降级不中断）
      this.controller.runJavaScript(this.storeScript('theme_mode', mode)).catch(() => {});
    });
  }

  /** 构造「写 localStorage.store 某字段」的 JS（对齐 Android 两段 evaluateJavascript）。 */
  private storeScript(key: string, value: string): string {
    const safe: string = value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    return 'try{if(!window.localStorage.getItem("store")){window.localStorage.setItem("store",' +
      "JSON.stringify({'" + key + "':'" + safe + "'}))}else{var s=JSON.parse(window.localStorage.store);" +
      "s['" + key + "']='" + safe + "';window.localStorage.setItem('store',JSON.stringify(s))}}catch(e){}";
  }

  /**
   * G07-06：外部链接拦下并交系统浏览器（内部域放行，CAS 会话 cookie 不丢）。
   * 返回 true = 已交出去、Web 不再加载；无浏览器给提示不崩。
   */
  private handOffExternal(url: string): boolean {
    if (!isHttpUrl(url) || !shouldHandOff(url)) {
      return false;
    }
    const ctx = getContext(this) as common.UIAbilityContext;
    ctx.startAbility({ action: 'ohos.want.action.viewData', uri: url })
      .catch((e: Error) => {
        warn('WorldWeb handoff fail: ' + JSON.stringify(e));
        promptAction.showToast({ message: '没有可用的浏览器。地址：' + url });
      });
    return true;
  }

  build() {
    Column() {
      // ── 顶部品牌色状态栏占位（Android statusBarHeight 色块）──
      Row()
        .width('100%').height(28)
        .backgroundColor(STATUS_BAR_COLOR)

      // ── 线性进度条（secondary 色，对齐 Android LinearProgressIndicator）──
      if (this.progress < 100) {
        Progress({ value: this.progress, total: 100, type: ProgressType.Linear })
          .width('100%').height(3)
          .color(this.tk().secondary)
          .backgroundColor(Color.Transparent)
      }

      Web({
        src: BASE_URL,
        controller: this.controller,
      })
        .width('100%')
        .layoutWeight(1)
        .domStorageAccess(true)
        .javaScriptAccess(true)
        .onLoadIntercept((event: OnLoadInterceptEvent) => {
          return this.handOffExternal(event.data.getRequestUrl());
        })
        .onPageBegin(() => this.injectStore())
        .onPageEnd(() => { this.progress = 100; })
    }
    .width('100%').height('100%')
    .backgroundColor(this.tk().background)
  }
}
