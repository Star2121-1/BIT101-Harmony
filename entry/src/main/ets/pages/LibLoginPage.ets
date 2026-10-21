/**
 * 图书馆登录页（M5-3）：用户在 Web 组件里走 CAS 登录 lib 门户，
 * App 抽 cookie 灌进 JAR_LIB，之后借阅接口只带 cookie。
 *
 * 契约：BIT101-seat/docs/lib-borrow-contract.md §2 ——
 * GET lib.bit.edu.cn/login → 302 login.bit.edu.cn（跳转站）→ 302 sso.bit.edu.cn（真实登录页）
 *   → POST → 302 lib.bit.edu.cn/sso/login/3rd?ticket=ST-… → 200（会话 cookie 落 lib 域）。
 *
 * ⚠️ 本页不碰任何凭据：学号密码由用户在学校页面上自己输。
 * ⚠️ SameSite/域风险：lib 门户 cookie 能否被 fetchCookie 抽到、灌进 rcp 后能否过
 *    服务端校验——只有真机能证伪（与 eclass R8 同性质）。
 */

import { webview } from '@kit.ArkWeb';
import { router } from '@kit.ArkUI';
import { Context } from '@kit.AbilityKit';
import { LOGIN_URL, PAGE_URL, LibBorrowService, syncFromWeb } from '../service/LibBorrowService.ts';
import { info, warn } from '../core/log/BitLog.ts';

@Entry
@Component
struct LibLoginPage {
  @State status: string = '加载图书馆登录页…';
  @State detail: string = '';
  @State busy: boolean = false;
  /** 已验证成功过（成功过就不再自动重复验证）。 */
  private verified: boolean = false;
  private controller: webview.WebviewController = new webview.WebviewController();

  /** 抽 cookie + 用 user-info 验一次（同步入口）。 */
  private async syncAndVerify(): Promise<void> {
    if (this.busy) {
      return;
    }
    this.busy = true;
    this.status = '正在同步 cookie…';
    try {
      const n: number = await syncFromWeb();
      if (n === 0) {
        this.status = 'Web 里还没有图书馆会话（未登录或登录未完成）';
        this.busy = false;
        return;
      }
      this.status = '已抽到 ' + n + ' 条 cookie，正在验证…';
      const ctx: Context = getContext(this) as Context;
      const r = await LibBorrowService.fetchCurrent(ctx);
      if (r.kind === 'loggedOut') {
        // 抽到了 cookie 但 uid 仍空 ⇒ 会话没真正建立（域不匹配/未完成登录）
        this.status = '⚠️ 已抽到 cookie 但服务端认为未登录（会话可能未完成）';
        this.busy = false;
        return;
      }
      if (r.kind === 'failed') {
        this.status = '⚠️ 验证失败：' + r.reason;
        this.busy = false;
        return;
      }
      this.verified = true;
      this.detail = '当前在借 ' + r.records.length + ' 本';
      this.status = '✅ 图书馆会话就绪（在借 ' + r.records.length + ' 本）';
      info('lib verify ok n=' + r.records.length);
    } catch (e) {
      warn('lib sync/verify fail: ' + (e as Error).message);
      this.status = '⚠️ 验证失败：' + (e as Error).message;
    }
    this.busy = false;
  }

  aboutToAppear(): void {
    info('lib login page open');
  }

  build() {
    // ⚠️ build() 根部不声明局部变量（编译器只认根节点起手，2026-10-21 踩过）
    Column() {
      Row() {
        Button('‹ 返回')
          .onClick(() => {
            router.back();
          })
        Text('图书馆登录').fontSize(16).fontWeight(FontWeight.Bold).layoutWeight(1)
          .textAlign(TextAlign.Center)
        Button('验证').fontSize(13)
          .enabled(!this.busy)
          .onClick(() => {
            this.syncAndVerify();
          })
      }.width('100%').padding(12)

      Text(this.status).fontSize(13).width('100%').padding({ left: 12, right: 12 })

      if (this.detail.length > 0) {
        Text(this.detail).fontSize(12).fontColor('#1A7F37')
          .width('100%').padding({ left: 12, right: 12, top: 4 })
      }

      Button('同步 cookie 并验证').fontSize(13)
        .enabled(!this.busy)
        .margin({ left: 12, top: 8 })
        .onClick(() => {
          this.syncAndVerify();
        })

      Web({
        src: LOGIN_URL,
        controller: this.controller
      })
        .domStorageAccess(true)
        .javaScriptAccess(true)
        .onPageEnd((e: OnPageEndEvent) => {
          // 落回 lib/mylib 本站且未验证过 ⇒ 登录链大概走完了，自动试一次
          if (!this.verified &&
            (e.url.indexOf('lib.bit.edu.cn') >= 0)) {
            this.syncAndVerify();
          }
        })
        .layoutWeight(1)
    }
    .width('100%').height('100%')
  }
}
