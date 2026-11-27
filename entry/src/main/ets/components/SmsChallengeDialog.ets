/**
 * F01-03：短信二验**就地续输**对话框（红线最严的一块）。
 *
 * ## 为什么需要它
 * 自动重登（一卡通/图书馆取数失效路径）调 `CasLoginService.login` 时，学校风控可能要求短信
 * 二验 —— 那条路**已经真的发了一条短信**并留下 pending。以前调用方把 `need_user` 当普通未登录，
 * 跳登录页要用户重输学号密码；现在直接在本页弹这个框，用户只输验证码即可续上。
 *
 * ## 红线（判据②③ + 全局副作用纪律）
 * - 本组件**绝不发短信**：短信只在 `CasLoginService.login` 内由学校风控触发一次；
 * - 验证码错误 ⇒ `submitSmsCode` 内部已停手不重试（c2 rejected，见 CasLoginService:373-378），
 *   本组件也**不再提交第二次**；
 * - 取消 ⇒ `CasLoginService.clearPending()`，不留下半截会话；
 * - 不代收、不自动猜码、不打印验证码。
 */

import { Context } from '@kit.AbilityKit';
import { CasLoginService, LoginOutcome, clearPending } from '../service/CasLoginService.ts';
import { gridTokens } from '../core/theme/GridTokens.ts';
import type { GridTokens } from '../core/theme/GridTokens.ts';
import { STORAGE_DARK, STORAGE_PALETTE, getPalette } from '../data/ThemeStore.ts';
import { info, warn } from '../core/log/BitLog.ts';

@Component
export struct SmsChallengeDialog {
  @StorageLink(STORAGE_DARK) isDark: boolean = false;
  @StorageLink(STORAGE_PALETTE) paletteName: string = 'brand';

  /** 是否展示（由页面根据服务返回的 smsPending 控制）。 */
  @Prop show: boolean = false;
  /** 用户登录成功后的回调（页面据此重新取数）。 */
  onSuccess: () => void = () => {};
  /** 用户取消的回调（页面据此复位状态）。 */
  onCancel: () => void = () => {};
  /**
   * S-02：等待用户输码的上限（ms）。0 = 不启用（CardPage/LibBorrowPage 的老用法保持默认）。
   * 座位页传 SMS_WAIT_TIMEOUT_MS（5min），对齐 Android SeatSmsChallengeHub：到点自动收起。
   */
  @Prop timeoutMs: number = 0;
  /** 超时回调（页面据此复位 + 报「验证码输入超时，请重新授权」）。 */
  onTimeout: () => void = () => {};

  @State private code: string = '';
  @State private status: string = '';
  @State private busy: boolean = false;
  private timerId: number = 0;

  private tk(): GridTokens {
    return gridTokens(this.isDark, getPalette(this.paletteName));
  }

  aboutToAppear(): void {
    // 一次性定时器：页面用 `if (smsShow)` 挂载，每次显示都是新实例，无需监听 show 变化。
    if (this.timeoutMs > 0) {
      this.timerId = setTimeout(() => {
        clearPending();
        this.onTimeout();
      }, this.timeoutMs);
    }
  }

  aboutToDisappear(): void {
    if (this.timerId !== 0) {
      clearTimeout(this.timerId);
      this.timerId = 0;
    }
  }

  /** 提交验证码：一次点击只提交一次；失败就地显示原因，不重试不发第二条。 */
  private async submit(): Promise<void> {
    if (this.busy || this.code.trim().length === 0) {
      return;
    }
    this.busy = true;
    this.status = '正在校验…';
    try {
      const ctx: Context = getContext(this) as Context;
      const out: LoginOutcome = await CasLoginService.submitSmsCode(ctx, this.code.trim());
      this.code = '';
      if (out.status === 'ok') {
        info('SmsChallengeDialog: sms login ok');
        this.status = '';
        // 成功即停计时器（防页面尚未卸载时超时回调误触发）
        if (this.timerId !== 0) {
          clearTimeout(this.timerId);
          this.timerId = 0;
        }
        this.onSuccess();
        return;
      }
      // 错误不重试、不发第二条短信：只如实展示（submitSmsCode 已停手）
      this.status = out.message.length > 0 ? out.message : '验证码未通过，请手动登录';
      warn('SmsChallengeDialog: sms rejected, stop (no retry)');
    } catch (e) {
      this.code = '';
      this.status = '验证异常：' + JSON.stringify(e);
    } finally {
      this.busy = false;
    }
  }

  /** 取消：pending 复位，不留半截会话。 */
  private cancel(): void {
    if (this.timerId !== 0) {
      clearTimeout(this.timerId);
      this.timerId = 0;
    }
    clearPending();
    this.code = '';
    this.status = '';
    this.onCancel();
  }

  build() {
    if (this.show) {
      Column() {
        Text('学校要求短信验证')
          .fontSize(16).fontWeight(FontWeight.Medium).fontColor(this.tk().onSurface)
        Text('验证码已由学校发送到你的手机。只需输入验证码，不用重新输入学号密码。')
          .fontSize(12).fontColor(this.tk().onSurfaceVariant)
          .width('100%').margin({ top: 6 })

        TextInput({ placeholder: '短信验证码', text: this.code })
          .fontSize(14).fontColor(this.tk().onSurface)
          .width('100%').margin({ top: 12 })
          .onChange((v: string) => { this.code = v; })

        if (this.status.length > 0) {
          Text(this.status)
            .fontSize(12).fontColor(this.tk().error)
            .width('100%').margin({ top: 6 })
        }

        Row({ space: 12 }) {
          Button('取消')
            .fontColor(this.tk().onSurfaceVariant)
            .backgroundColor(this.tk().surface2)
            .layoutWeight(1)
            .onClick(() => this.cancel())
          Button(this.busy ? '校验中…' : '提交验证码')
            .fontColor(this.tk().onPrimary)
            .backgroundColor(this.tk().primary)
            .layoutWeight(1)
            .enabled(!this.busy && this.code.trim().length > 0)
            .onClick(() => { this.submit(); })
        }
        .width('100%').margin({ top: 14 })
      }
      .width('88%')
      .padding(18)
      .backgroundColor(this.tk().surfaceElevated)
      .borderRadius(16)
      .shadow({ radius: 18, color: '#33000000', offsetX: 0, offsetY: 6 })
    }
  }
}
