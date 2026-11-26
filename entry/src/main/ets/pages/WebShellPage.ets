/**
 * 通用 Web 壳（M4-4 点击动态跳课程页；M10-3 的 Web 壳雏形）。
 *
 * 为什么需要它而不是踢系统浏览器：eclass 会话 cookie 在**本 App 的 Web 组件**
 * 存储里（登录时留下的），系统浏览器不共享 ⇒ 踢过去 = 未登录状态看课程页。
 * App 内 Web 壳才能带着会话打开。
 *
 * 入参：router.pushUrl({ url: 'pages/WebShellPage', params: { url: 'https://…' } })
 * 只接受 http(s) 完整地址（契约：相对路径交给 Web 只会白屏）。
 */

import { webview } from '@kit.ArkWeb';
import { router, promptAction } from '@kit.ArkUI';
import { common } from '@kit.AbilityKit';
import { shouldHandOff, isHttpUrl } from '../corelogic/WebNavPolicy.ts';
import { warn } from '../core/log/BitLog.ts';

/** 默认页（拿不到入参时）：延河课堂首页。 */
const FALLBACK_URL: string = 'https://zy-eclass.bit.edu.cn/';

@Entry
@Component
struct WebShellPage {
  @State pageUrl: string = FALLBACK_URL;
  @State title: string = '';
  private controller: webview.WebviewController = new webview.WebviewController();

  aboutToAppear(): void {
    try {
      const params = router.getParams() as Record<string, string> | undefined;
      if (params !== undefined && typeof params['url'] === 'string') {
        const u: string = (params['url'] as string).trim();
        if (u.startsWith('http://') || u.startsWith('https://')) {
          this.pageUrl = u;
        }
      }
    } catch (e) {
      // 拿不到参数就用默认页，不崩
    }
    if (this.title.length === 0) {
      this.title = this.pageUrl.indexOf('zy-eclass.bit.edu.cn') >= 0 ? '延河课堂' : '网页';
    }
  }

  /** G07-06：外部链接交系统浏览器；内部域（含 CAS/eclass）留在 WebView 保住会话。 */
  private handOffExternal(url: string): boolean {
    if (!isHttpUrl(url) || !shouldHandOff(url)) {
      return false;
    }
    const ctx = getContext(this) as common.UIAbilityContext;
    ctx.startAbility({ action: 'ohos.want.action.viewData', uri: url })
      .catch((e: Error) => {
        warn('WebShell handoff fail: ' + JSON.stringify(e));
        promptAction.showToast({ message: '没有可用的浏览器。地址：' + url });
      });
    return true;
  }

  build() {
    Column() {
      Row() {
        Button('‹ 返回')
          .onClick(() => {
            router.back();
          })
        Text(this.title).fontSize(15).fontWeight(FontWeight.Bold).layoutWeight(1)
          .textAlign(TextAlign.Center).maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
        Button('刷新').fontSize(13)
          .onClick(() => {
            this.controller.refresh();
          })
      }.width('100%').padding(12)

      Web({
        src: this.pageUrl,
        controller: this.controller
      })
        .domStorageAccess(true)
        .javaScriptAccess(true)
        .onLoadIntercept((event: OnLoadInterceptEvent) => {
          return this.handOffExternal(event.data.getRequestUrl());
        })
        .layoutWeight(1)
    }
    .width('100%').height('100%')
  }
}
