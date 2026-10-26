/**
 * 登录页：学号 + 密码 → 学校统一身份认证（纯 HTTP，不经 Web 组件）。
 *
 * 为什么不是 Web 登录页：R1 已证伪 —— sso.bit.edu.cn 的登录表单在鸿蒙 Web 组件里不渲染
 * （M1 取证；Android 侧同款）。纯 HTTP 链路已全通（M1-5 真机验到 JWT 被业务接口认可）。
 *
 * 红线（继承探针 SOP，**代码里逐条落实**）：
 * - 密码只活在本次点击的调用栈里；请求返回后立刻 `this.password = ''`；
 * - 不打印、不落盘、不拼进 URL；
 * - 短信二次验证必须由用户本人在本页输入验证码（agent 不代收）。
 */
import { router } from '@kit.ArkUI';
import { palette, Palette } from '../core/theme/AppColors.ts';
import { STORAGE_DARK } from '../data/ThemeStore.ts';
import { Context } from '@kit.AbilityKit';
import { CasLoginService, LoginOutcome, hasPendingSms } from '../service/CasLoginService.ts';
import { ProbeCreds, getProbeCreds, clearProbeCreds } from '../probe/CasProbe.ts';
import { info } from '../core/log/BitLog.ts';

@Entry
@Component
struct LoginPage {
  /** 订阅全局深浅色（由设置页切换、AppStorage 广播）。 */
  @StorageLink(STORAGE_DARK) isDark: boolean = false;
  @State username: string = '';
  @State password: string = '';
  @State smsCode: string = '';
  @State loading: boolean = false;
  @State statusText: string = '请输入学号与密码';
  @State steps: string[] = [];
  @State needSms: boolean = false;
  @State errorColor: string = this.p().textMuted;
  /** 调试通道：`aa start --ps probe_user X --ps probe_pass Y` 注入时才为 true。 */
  @State hasInjectedCreds: boolean = false;

  aboutToAppear(): void {
    this.needSms = hasPendingSms();
    const creds: ProbeCreds = getProbeCreds();
    this.hasInjectedCreds = creds.user.length > 0 && creds.pass.length > 0;
    if (this.hasInjectedCreds) {
      this.username = creds.user;
    }
    info('LoginPage appear, pendingSms=' + (this.needSms ? 'yes' : 'no') +
      ' injected=' + (this.hasInjectedCreds ? 'yes' : 'no'));
  }

  private async doLogin(): Promise<void> {
    const creds: ProbeCreds = getProbeCreds();
    // 调试通道优先（凭据不经过输入框，减少暴露面）
    const u: string = this.hasInjectedCreds ? creds.user : this.username.trim();
    const p: string = this.hasInjectedCreds ? creds.pass : this.password;
    if (u.length === 0 || p.length === 0) {
      this.statusText = '学号或密码为空';
      this.errorColor = this.p().error;
      return;
    }
    this.loading = true;
    this.errorColor = this.p().textMuted;
    this.statusText = '正在登录（约 10~20 秒）…';
    this.steps = [];
    try {
      const ctx: Context = getContext(this) as Context;
      const out: LoginOutcome = await CasLoginService.login(ctx, u, p);
      // ⚠️ 密码用完立刻清（不管成败）；注入通道的凭据也不留在进程内存里
      this.password = '';
      if (this.hasInjectedCreds) {
        clearProbeCreds();
        this.hasInjectedCreds = false;
      }
      this.steps = out.steps;
      this.statusText = out.message;
      if (out.status === 'ok') {
        this.errorColor = this.p().success;
        this.statusText = '登录成功，正在打开课表…';
        router.replaceUrl({ url: 'pages/Index' }).catch((e: Error) => {
          this.statusText = '跳转课表失败：' + JSON.stringify(e);
        });
      } else if (out.status === 'sms_required') {
        this.needSms = true;
        this.errorColor = this.p().warn;
      } else {
        this.errorColor = this.p().error;
      }
    } catch (e) {
      this.password = '';
      this.errorColor = this.p().error;
      this.statusText = '登录异常（已停手，不自动重试）：' + JSON.stringify(e);
    }
    this.loading = false;
  }

  private async doSubmitSms(): Promise<void> {
    const code: string = this.smsCode.trim();
    if (code.length === 0) {
      this.statusText = '验证码为空';
      return;
    }
    this.loading = true;
    this.statusText = '正在校验验证码…';
    try {
      const ctx: Context = getContext(this) as Context;
      const out: LoginOutcome = await CasLoginService.submitSmsCode(ctx, code);
      this.steps = out.steps;
      this.statusText = out.message;
      this.smsCode = '';
      if (out.status === 'ok') {
        this.errorColor = this.p().success;
        this.needSms = false;
        router.replaceUrl({ url: 'pages/Index' }).catch((e: Error) => {
          this.statusText = '跳转课表失败：' + JSON.stringify(e);
        });
      } else {
        this.errorColor = this.p().error;
      }
    } catch (e) {
      this.errorColor = this.p().error;
      this.statusText = '验证码提交异常：' + JSON.stringify(e);
    }
    this.loading = false;
  }

  /** 当前配色（语义色见 core/theme/AppColors.ts）。 */
  private p(): Palette {
    return palette(this.isDark);
  }

  build() {
    Column() {
      Row() {
        Text('登录北京理工大学统一身份认证')
          .fontSize(17).fontWeight(FontWeight.Bold).layoutWeight(1)
      }.width('100%').padding({ left: 16, right: 16, top: 16, bottom: 4 })

      Text('学号与密码只用于本次登录，不会保存到本机')
        .fontSize(12).fontColor(this.p().textMuted)
        .width('100%').padding({ left: 16, right: 16, bottom: 12 })

      if (this.hasInjectedCreds) {
        Text('调试通道：凭据由启动参数注入，点「登录」即用（不会显示在输入框）')
          .fontSize(11).fontColor(this.p().warn)
          .width('100%').padding({ left: 16, right: 16, bottom: 8 })
      }

      Column({ space: 10 }) {
        TextInput({ placeholder: '学号', text: this.username })
          .type(InputType.Normal)
          .height(44)
          .enabled(!this.loading)
          .onChange((v: string) => {
            this.username = v;
          })

        TextInput({ placeholder: '密码', text: this.password })
          .type(InputType.Password)
          .height(44)
          .enabled(!this.loading)
          .onChange((v: string) => {
            this.password = v;
          })

        Button(this.loading ? '登录中…' : '登录')
          .width('100%').height(44)
          .enabled(!this.loading)
          .onClick(() => {
            this.doLogin();
          })
      }
      .width('100%')
      .padding({ left: 16, right: 16 })

      // 短信二次验证（学校风控触发时才出现）
      if (this.needSms) {
        Column({ space: 8 }) {
          Text('学校要求短信验证')
            .fontSize(13).fontColor(this.p().warn)
            .width('100%')
          Row() {
            TextInput({ placeholder: '短信验证码', text: this.smsCode })
              .type(InputType.Number)
              .maxLength(8)
              .height(44)
              .layoutWeight(1)
              .onChange((v: string) => {
                this.smsCode = v;
              })
            Button('提交')
              .height(44)
              .enabled(!this.loading)
              .onClick(() => {
                this.doSubmitSms();
              })
              .margin({ left: 8 })
          }.width('100%')
        }
        .width('100%')
        .padding({ left: 16, right: 16, top: 12 })
      }

      // 状态
      Text(this.statusText)
        .fontSize(13)
        .fontColor(this.errorColor)
        .width('100%')
        .padding({ left: 16, right: 16, top: 14 })

      // 诊断轨迹（已打码，可截图取证）
      if (this.steps.length > 0) {
        List() {
          ForEach(this.steps, (line: string, i: number) => {
            ListItem() {
              Text(line)
                .fontSize(11).fontColor(this.p().textMuted)
                .width('100%')
                .padding({ left: 16, right: 16, top: 2, bottom: 2 })
            }
          }, (line: string, i: number) => i.toString() + '_' + line)
        }
        .layoutWeight(1)
        .margin({ top: 8 })
      } else {
        Blank()
      }

      Row() {
        Text('返回')
          .fontSize(13).fontColor(this.p().accent)
          .onClick(() => {
            router.back();
          })
      }.width('100%').padding(16)
    }
    .width('100%')
    .height('100%')
  }
}
