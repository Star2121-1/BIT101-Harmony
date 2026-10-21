/**
 * 延河课堂（eclass）登录页（M4-1）。
 *
 * 形态照搬 Android：用户在 Web 组件里完成 Keycloak + CAS broker 登录，
 * App 抽 cookie 灌进 rcp 罐，之后 `/api/` 只读请求全走 rcp。
 *
 * 验收判据（ROADMAP §4 M4-1，可证伪）：
 *  1. 能拿到 eclass 会话 cookie —— syncFromWeb 条数 > 0；
 *  2. 拿到后 `/api/user/recently-visited-courses` 返回 200 且有 visited_courses；
 *  3. 失败时打出 **hop 轨迹**（每一次 onPageBegin/onPageEnd 的 URL 都上屏 + 进 hilog）。
 *
 * ⚠️ 本页不碰任何凭据：账号密码/验证码由用户在学校页面上自己输。
 * ⚠️ SameSite 风险 R8：Keycloak broker 的 cookie 能否被 fetchCookie 抽到、
 *    灌进 rcp 后能否过服务端校验——**只有真机能证伪**，单测证明不了。
 */

import { webview } from '@kit.ArkWeb';
import { router } from '@kit.ArkUI';
import { ECLASS_HOME, EclassService } from '../service/EclassService.ts';
import { EclassCookieStore } from '../data/EclassCookieStore.ts';
import { info, warn } from '../core/log/BitLog.ts';

/** hop 轨迹最多保留条数（防无限增长）。 */
const MAX_HOPS: number = 40;

@Entry
@Component
struct EclassLoginPage {
  @State status: string = '加载延河课堂…';
  @State hops: string = '';
  @State result: string = '';
  @State busy: boolean = false;
  /** 已验证成功过（成功过就不再自动重复验证，避免每帧都打接口）。 */
  private verified: boolean = false;
  private controller: webview.WebviewController = new webview.WebviewController();

  private hopCount: number = 0;

  /** 记一跳（上屏 + hilog）。url 是唯一事实，不加工。 */
  private addHop(phase: string, url: string): void {
    this.hopCount += 1;
    const line: string = '#' + this.hopCount + ' ' + phase + ' ' + url;
    info('eclass hop ' + line);
    const lines: string[] = this.hops.length > 0 ? this.hops.split('\n') : [];
    lines.push(line);
    if (lines.length > MAX_HOPS) {
      lines.splice(0, lines.length - MAX_HOPS);
    }
    this.hops = lines.join('\n');
  }

  /** 抽 cookie + 真调一次接口验证（同步入口）。 */
  private async syncAndVerify(): Promise<void> {
    if (this.busy) {
      return;
    }
    this.busy = true;
    this.status = '正在同步 cookie…';
    try {
      const ctx = getContext(this) as Context;
      const n: number = await EclassService.syncFromWeb();
      if (n === 0) {
        this.status = 'Web 里还没有 eclass 会话（未登录或登录未完成）';
        this.busy = false;
        return;
      }
      this.status = '已抽到 ' + n + ' 条 cookie，正在验证…';
      const courses = await EclassService.getVisitedCourses(ctx);
      this.verified = true;
      this.result = '课程 ' + courses.length + ' 门：' +
        courses.slice(0, 5).map((c) => c.name).join('、') +
        (courses.length > 5 ? ' …' : '');
      this.status = '✅ eclass 会话就绪（' + courses.length + ' 门课）';
      info('eclass verify ok courses=' + courses.length);
    } catch (e) {
      const msg: string = (e as Error).message;
      warn('eclass sync/verify fail: ' + msg);
      this.status = '⚠️ 验证失败：' + msg;
    }
    this.busy = false;
  }

  /** 清 eclass 会话（Prefs + rcp 罐 + Web 存储三处）。 */
  private async clearSession(): Promise<void> {
    await EclassCookieStore.clear();
    this.verified = false;
    this.result = '';
    this.status = '已清除 eclass 会话（可重新登录）';
    this.controller.refresh();
  }

  aboutToAppear(): void {
    info('eclass login page open');
  }

  build() {
    Column() {
      // ── 顶栏 ──
      Row() {
        Button('‹ 返回')
          .onClick(() => {
            router.back();
          })
        Text('延河课堂登录').fontSize(16).fontWeight(FontWeight.Bold).layoutWeight(1)
          .textAlign(TextAlign.Center)
        Button('验证').fontSize(13)
          .onClick(() => {
            this.syncAndVerify();
          })
      }.width('100%').padding(12)

      Text(this.status).fontSize(13).width('100%').padding({ left: 12, right: 12 })

      if (this.result.length > 0) {
        Text(this.result).fontSize(12).fontColor('#1A7F37')
          .width('100%').padding({ left: 12, right: 12, top: 4 })
      }

      // ── 操作行 ──
      Row() {
        Button('同步 cookie 并验证').fontSize(13)
          .enabled(!this.busy)
          .onClick(() => {
            this.syncAndVerify();
          })
        Button('清除会话').fontSize(13).margin({ left: 8 })
          .onClick(() => {
            this.clearSession();
          })
      }.width('100%').padding({ left: 12, right: 12, top: 8 })

      // ── hop 轨迹 ──
      Text('跳转轨迹（每一次页面加载）：')
        .fontSize(11).fontColor('#888888').width('100%')
        .padding({ left: 12, right: 12, top: 8 })
      Scroll() {
        Text(this.hops.length > 0 ? this.hops : '（暂无）')
          .fontSize(10).fontColor('#888888').width('100%')
      }
      .layoutWeight(1)
      .padding({ left: 12, right: 12 })
      .align(Alignment.Top)

      // ── Web 壳 ──
      Web({
        src: ECLASS_HOME,
        controller: this.controller
      })
        .domStorageAccess(true)
        .javaScriptAccess(true)
        .onPageBegin((e: OnPageBeginEvent) => {
          this.addHop('begin', e.url);
        })
        .onPageEnd((e: OnPageEndEvent) => {
          this.addHop('end  ', e.url);
          // 落回 eclass 本站且未验证过 ⇒ 登录链路大概走完了，自动试一次
          if (!this.verified && e.url.indexOf('zy-eclass.bit.edu.cn') >= 0) {
            this.syncAndVerify();
          }
        })
        .onErrorReceive((e: OnErrorReceiveEvent) => {
          const u: string = e.request ? e.request.getRequestUrl() : '';
          warn('eclass web error: ' + u);
          this.status = '⚠️ 页面资源加载出错：' + u;
        })
        .layoutWeight(2)
    }
    .width('100%').height('100%')
  }
}
