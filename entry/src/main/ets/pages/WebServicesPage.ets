/**
 * 网页服务入口页（M10-3）。
 *
 * 为什么要有这一页：学校很多事（改密码、成绩单原件、图书馆续借）只有网页版。
 * 踢去系统浏览器 = **未登录**（会话 cookie 在本 App 的 Web 组件里），所以统一用
 * App 内 `WebShellPage` 打开，复用已经登录的会话。
 *
 * 清单与「留在 App 内」的判定都在 `corelogic/WebEntryLogic.ts`（纯函数、有单测）：
 * 学校域名（`*.bit.edu.cn`）+ bit101.cn + 校园网门户留 App 内（CAS 会话 cookie 在此），
 * 其它域名交系统浏览器（G07-06，对齐 A:InAppWebUrls.kt）；无可用浏览器给提示不崩。
 */

import { router, promptAction } from '@kit.ArkUI';
import { common } from '@kit.AbilityKit';
import { gridTokens } from '../core/theme/GridTokens.ts';
import type { GridTokens } from '../core/theme/GridTokens.ts';
import { STORAGE_DARK, STORAGE_PALETTE, getPalette } from '../data/ThemeStore.ts';
import type { WebEntry } from '../corelogic/WebEntryLogic.ts';
import { WEB_ENTRIES, shouldStayInApp } from '../corelogic/WebEntryLogic.ts';
import { info, warn } from '../core/log/BitLog.ts';

@Entry
@Component
export struct WebServicesPage {
  @StorageLink(STORAGE_DARK) isDark: boolean = false;
  @StorageLink(STORAGE_PALETTE) paletteName: string = 'brand';

  @State note: string = '';

  private tk(): GridTokens {
    return gridTokens(this.isDark, getPalette(this.paletteName));
  }

  /** 打开入口：内部域留 App 内 WebView（保住会话）；外部域交系统浏览器。 */
  private open(e: WebEntry): void {
    if (!shouldStayInApp(e.url)) {
      this.openExternal(e.url);
      return;
    }
    this.note = '';
    router.pushUrl({ url: 'pages/WebShellPage', params: { url: e.url } }).catch((err: Error) => {
      warn('open web entry fail: ' + JSON.stringify(err));
      this.note = '打开失败：' + err.message;
    });
  }

  /** 外部链接交系统浏览器（对齐 A:WebScreen.kt）；没有浏览器给提示，不崩。 */
  private openExternal(url: string): void {
    this.note = '';
    const ctx = getContext(this) as common.UIAbilityContext;
    ctx.startAbility({
      action: 'ohos.want.action.viewData',
      uri: url,
    }).then(() => {
      info('WebServices open external ok: ' + url);
    }).catch((err: Error) => {
      warn('WebServices open external fail: ' + JSON.stringify(err));
      promptAction.showToast({ message: '没有可用的浏览器。地址：' + url });
    });
  }

  build() {
    Column() {
      Row() {
        Text('‹ 返回')
          .fontSize(14).fontColor(this.tk().primary)
          .onClick(() => {
            router.back();
          })
        Text('网页服务')
          .fontSize(16).fontWeight(FontWeight.Bold).fontColor(this.tk().onSurface)
          .layoutWeight(1).textAlign(TextAlign.Center)
        Text('    ').fontSize(14)
      }
      .width('100%')
      .padding({ left: 12, right: 12, top: 10, bottom: 4 })

      Scroll() {
        Column() {
          Text('这些页面在本 App 内打开，共用已有登录会话；不需要重新登录时不会重新登录。')
            .fontSize(11).fontColor(this.tk().onSurfaceVariant)
            .width('100%').margin({ top: 6, bottom: 10 })

          Column() {
            ForEach(WEB_ENTRIES, (e: WebEntry, idx: number) => {
              if (idx > 0) {
                Text('')
                  .width('100%').height(1)
                  .backgroundColor(this.tk().outlineVariant)
              }
              Row() {
                Column() {
                  Text(e.label)
                    .fontSize(14).fontColor(this.tk().onSurface)
                    .width('100%')
                  Text(e.note)
                    .fontSize(11).fontColor(this.tk().onSurfaceVariant)
                    .width('100%').margin({ top: 2 })
                }
                .layoutWeight(1).alignItems(HorizontalAlign.Start)
                Text('›').fontSize(14).fontColor(this.tk().onSurfaceVariant)
              }
              .width('100%')
              .padding({ top: 10, bottom: 10 })
              .onClick(() => {
                this.open(e);
              })
            }, (e: WebEntry) => e.key)
          }
          .width('100%').padding({ left: 12, right: 12 })
          .backgroundColor(this.tk().surface).borderRadius(12)

          if (this.note.length > 0) {
            Text(this.note)
              .fontSize(11).fontColor(this.tk().stateAttention)
              .width('100%').margin({ top: 10 })
          }

          Text('页面内容由学校站点提供；登录凭据只提交给学校统一身份认证，本应用不保存。')
            .fontSize(11).fontColor(this.tk().onSurfaceVariant)
            .width('100%').margin({ top: 14 })

          Text('')
            .height(24)
        }
        .width('100%').padding({ left: 12, right: 12 })
        .alignItems(HorizontalAlign.Start)
      }
      .width('100%')
      .layoutWeight(1)
      .scrollBar(BarState.Off)
      .align(Alignment.Top)
    }
    .width('100%').height('100%')
    .backgroundColor(this.tk().background)
  }
}
