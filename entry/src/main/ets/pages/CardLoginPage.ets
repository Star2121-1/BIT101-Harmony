/**
 * 一卡通登录页（M5-1）：用户在 Web 组件里走 CAS 登录一卡通首页，
 * App 抽 cookie 灌进 JAR_CARD，之后首页抓取只带 cookie。
 *
 * 链路（对照 Android DefaultCampusCardRepo）：
 *   GET dkykt.info.bit.edu.cn/home/openHomePageByCas
 *     → 302 sso.bit.edu.cn（CAS）→ 登录 → 302 回 dkykt（带 ticket）→ 200
 * 会话 cookie 落在 dkykt 域；登录判定看**最终 URL 主机**（ CampusCardLogic.parse）。
 *
 * ⚠️ 本页不碰任何凭据：学工号密码由用户在学校页面上自己输。
 */

import { webview } from '@kit.ArkWeb';
import { router } from '@kit.ArkUI';
import { Context } from '@kit.AbilityKit';
import { HOME_URL, CampusCardService } from '../service/CampusCardService.ts';
import { CardCookieStore } from '../data/CardCookieStore.ts';
import { CampusCardStore } from '../data/CampusCardStore.ts';
import { info, warn } from '../core/log/BitLog.ts';

@Entry
@Component
struct CardLoginPage {
  @State status: string = '加载一卡通首页…';
  @State detail: string = '';
  @State busy: boolean = false;
  /** 已验证成功过（成功过就不再自动重复验证）。 */
  private verified: boolean = false;
  private controller: webview.WebviewController = new webview.WebviewController();

  /** 抽 cookie + 抓一次首页验登录态（同步入口）。 */
  private async syncAndVerify(): Promise<void> {
    if (this.busy) {
      return;
    }
    this.busy = true;
    this.status = '正在同步 cookie…';
    try {
      const n: number = await CampusCardService.syncFromWeb();
      if (n === 0) {
        this.status = 'Web 里还没有一卡通会话（未登录或登录未完成）';
        this.busy = false;
        return;
      }
      this.status = '已抽到 ' + n + ' 条 cookie，正在验证…';
      const ctx: Context = getContext(this) as Context;
      const snap = await CampusCardService.fetchSnapshot(ctx);
      if (snap.failed) {
        // 请求失败 ≠ 未登录：说清楚是取数失败，别把用户指去登录
        this.status = '⚠️ 暂时取不到一卡通首页（网络或接口问题），稍后重试';
        this.busy = false;
        return;
      }
      if (!snap.loggedIn) {
        // 抽到了 cookie 但最终 URL 仍落在 sso ⇒ 会话没真正建立
        this.status = '⚠️ 已抽到 cookie 但服务端认为未登录（会话可能未完成）';
        this.busy = false;
        return;
      }
      this.verified = true;
      const first = snap.entries.length > 0 ? snap.entries[0] : null;
      this.detail = first !== null ? '余额 ¥' + first.value : '已登录，但未识别到余额字段';
      this.status = first !== null
        ? '✅ 一卡通会话就绪（余额 ¥' + first.value + '）'
        : '✅ 一卡通会话就绪（未识别到余额字段）';
      info('card verify ok entries=' + snap.entries.length);
    } catch (e) {
      warn('card sync/verify fail: ' + (e as Error).message);
      this.status = '⚠️ 验证失败：' + (e as Error).message;
    }
    this.busy = false;
  }

  /** 清除一卡通过会话（含落在 Web 组件里的登录态）。 */
  private async clearSession(): Promise<void> {
    await CardCookieStore.clear();
    await CampusCardStore.clear();
    this.verified = false;
    this.detail = '';
    this.status = '已清除一卡通过会话（Web 组件内的学校登录态一并清除，需重新登录）';
  }

  aboutToAppear(): void {
    info('card login page open');
  }

  build() {
    // ⚠️ build() 根部不声明局部变量（编译器只认根节点起手，2026-10-21 踩过）
    Column() {
      Row() {
        Button('‹ 返回')
          .onClick(() => {
            router.back();
          })
        Text('一卡通登录').fontSize(16).fontWeight(FontWeight.Bold).layoutWeight(1)
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

      Row() {
        Button('同步 cookie 并验证').fontSize(13)
          .enabled(!this.busy)
          .onClick(() => {
            this.syncAndVerify();
          })
        Button('清除会话').fontSize(13).margin({ left: 8 })
          .enabled(!this.busy)
          .onClick(() => {
            this.clearSession();
          })
      }
      .margin({ left: 12, top: 8 })

      Web({
        src: HOME_URL,
        controller: this.controller
      })
        .domStorageAccess(true)
        .javaScriptAccess(true)
        .onPageEnd((e: OnPageEndEvent) => {
          // 落回 dkykt 本站（不在 sso 上）且未验证过 ⇒ 登录链大概走完了，自动试一次
          if (!this.verified &&
            e.url.indexOf('dkykt.info.bit.edu.cn') >= 0 &&
            e.url.indexOf('sso.bit.edu.cn') < 0) {
            this.syncAndVerify();
          }
        })
        .layoutWeight(1)
    }
    .width('100%').height('100%')
  }
}
