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
import { gridTokens } from '../core/theme/GridTokens.ts';
import type { GridTokens } from '../core/theme/GridTokens.ts';
import { STORAGE_DARK, STORAGE_PALETTE, STORAGE_SEAT_RETRY, getPalette } from '../data/ThemeStore.ts';
import { Context } from '@kit.AbilityKit';
import { CasLoginService, LoginOutcome, hasPendingSms } from '../service/CasLoginService.ts';
import { ProbeCreds, getProbeCreds, clearProbeCreds } from '../probe/CasProbe.ts';
import { AutoLoginCredentialStore } from '../data/AutoLoginCredentialStore.ts';
import { CommunityAuthService } from '../service/CommunityAuthService.ts';
import { info, warn } from '../core/log/BitLog.ts';

@Entry
@Component
struct LoginPage {
  /** 订阅全局深浅色（由设置页切换、AppStorage 广播）。 */
  @StorageLink(STORAGE_DARK) isDark: boolean = false;
  @StorageLink(STORAGE_PALETTE) paletteName: string = 'brand';
  @State username: string = '';
  @State password: string = '';
  @State smsCode: string = '';
  @State loading: boolean = false;
  @State statusText: string = '请输入学号与密码';
  @State steps: string[] = [];
  @State needSms: boolean = false;
  /**
   * 提示文案的语义档位：'muted' | 'error' | 'success' | 'warn'。
   * ⚠️ 存**档位**而不是颜色字符串：颜色若在 @State 里落地，切皮肤或冷启动时主题
   *    异步就绪（ThemeStore.init 在 .then 里）都会留下过期色值。渲染时现算才跟得上。
   */
  @State errorTone: string = 'muted';
  /** 调试通道：`aa start --ps probe_user X --ps probe_pass Y` 注入时才为 true。 */
  @State hasInjectedCreds: boolean = false;
  /**
   * F01-02（用户拍板 B）：无条件存密码，本字段仅保留兼容（aboutToAppear 读存量状态），
   * 不再控制是否保存 —— 登录成功即存，见 doLogin。
   * 页面出现时按「是否已存凭据」回填，已经是开启态就显示勾选（不撒谎）。
   */
  @State remember: boolean = false;
  /**
   * 来源页：'seat' = 从座位页「授权座位系统」跳来，登录成功后要回座位页并触发重试，
   * 其余（含直接打开）回 Index 课表。对齐 BIT101-S：授权成功留在座位流程，不回课表。
   */
  @State fromSeat: boolean = false;

  aboutToAppear(): void {
    try {
      const params = router.getParams() as Record<string, string> | undefined;
      this.fromSeat = params !== undefined && params !== null && params['from'] === 'seat';
    } catch (e) {
      this.fromSeat = false;
    }
    this.needSms = hasPendingSms();
    const creds: ProbeCreds = getProbeCreds();
    this.hasInjectedCreds = creds.user.length > 0 && creds.pass.length > 0;
    if (this.hasInjectedCreds) {
      this.username = creds.user;
    }
    AutoLoginCredentialStore.has().then((on: boolean) => {
      this.remember = on;
    });
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
      this.errorTone = 'error';
      return;
    }
    this.loading = true;
    this.errorTone = 'muted';
    this.statusText = '正在登录（约 10~20 秒）…';
    this.steps = [];
    try {
      const ctx: Context = getContext(this) as Context;
      const out: LoginOutcome = await CasLoginService.login(ctx, u, p);
      // ⚠️ 密码用完立刻清（不管成败）；注入通道的凭据也不留在进程内存里
      // 但 opt-in 要存密码：必须在清空前、且用「用户实际登录用的那组」存。
      // 存失败不阻塞已成功的登录，只如实提示（登录态本身已经建立）。
      let credNote: string = '';
      // F01-02（用户拍板 B，对齐 Android 无条件存）：登录成功即把凭据加密存入系统密钥库，
      // 不再依赖 remember 勾选。sms_required 也存（本页输验证码完成登录，那之后就没密码了）。
      // 只有真正走完（ok 或待短信）才存；失败/验证码错误的凭据不落地。
      const reachedLogin: boolean = out.status === 'ok' || out.status === 'sms_required';
      if (reachedLogin) {
        try {
          await AutoLoginCredentialStore.save(u, p);
          credNote = '（已记住密码，会话过期可自动续期）';
        } catch (e) {
          credNote = '（自动续期未开启：' + (e as Error).message + '）';
        }
      }
      this.password = '';
      if (this.hasInjectedCreds) {
        clearProbeCreds();
        this.hasInjectedCreds = false;
      }
      this.steps = out.steps;
      this.statusText = out.message + credNote;
      if (out.status === 'ok') {
        this.errorTone = 'success';
        // 一次登录全通（对齐 BIT101-S DefaultLoginRepo.login L382）：
        // 校园 CAS 成功后用同一学号密码 best-effort 连 BIT101 社区换 fake-cookie，
        // 让话廊/成绩等社区能力免二次登录。失败只提示，不影响校园功能。
        const communityNote: string = await this.autoConnectCommunity(ctx, u, p);
        this.finishLogin(credNote + communityNote);
      } else if (out.status === 'sms_required') {
        this.needSms = true;
        this.errorTone = 'warn';
      } else {
        this.errorTone = 'error';
      }
    } catch (e) {
      this.password = '';
      this.errorTone = 'error';
      this.statusText = '登录异常（已停手，不自动重试）：' + JSON.stringify(e);
    }
    this.loading = false;
  }

  /**
   * 校园登录后 best-effort 连 BIT101 社区（对齐 A 的 loginBIT101）。
   * 只读换票：POST /user/login {sid, md5(pwd)} → fakeCookie 落盘，不发帖不预约。
   * 失败只返回一句提示，绝不阻塞校园登录（社区挂了校内功能照常用）。
   */
  private async autoConnectCommunity(ctx: Context, sid: string, password: string): Promise<string> {
    try {
      const d = await CommunityAuthService.login(ctx, sid, password);
      if (d.kind === 'ok') {
        info('LoginPage: community auto-connect ok');
        return '；BIT101 社区已自动连接';
      }
      info('LoginPage: community auto-connect skip, kind=' + d.kind);
      return '；社区未自动连接（可稍后在话廊登录）';
    } catch (e) {
      warn('LoginPage community auto-connect fail: ' + JSON.stringify(e));
      return '；社区未自动连接（可稍后在话廊登录）';
    }
  }

  /**
   * 登录成功后的回跳（对齐 BIT101-S：授权成功留在原流程，不回课表）。
   * - from=seat：写 seat_auth_retry 计数（SeatPage 的 @StorageLink+@Watch 会据此自动重试 loadSeats），
   *   再 router.back() 回到栈底的座位页（pushUrl 压栈，座位页实例与三级选择态都还在）。
   * - 其它：维持原行为回 Index 课表。
   */
  private finishLogin(note: string): void {
    if (this.fromSeat) {
      const n: number = Number(AppStorage.get<number>(STORAGE_SEAT_RETRY) ?? 0) + 1;
      AppStorage.setOrCreate<number>(STORAGE_SEAT_RETRY, n);
      this.statusText = '登录成功，正在返回座位页…' + note;
      router.back();
    } else {
      this.statusText = '登录成功，正在打开课表…' + note;
      router.replaceUrl({ url: 'pages/Index' }).catch((e: Error) => {
        this.statusText = '跳转课表失败：' + JSON.stringify(e);
      });
    }
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
        this.errorTone = 'success';
        this.needSms = false;
        // 短信路径手头没有明文密码；仅当 opt-in 存过凭据时补连社区（不凭空猜）
        let communityNote: string = '';
        const cred = await AutoLoginCredentialStore.load();
        if (cred !== null) {
          communityNote = await this.autoConnectCommunity(ctx, cred.username, cred.password);
        }
        this.statusText = out.message + communityNote;
        this.finishLogin(communityNote);
      } else {
        this.errorTone = 'error';
      }
    } catch (e) {
      this.errorTone = 'error';
      this.statusText = '验证码提交异常：' + JSON.stringify(e);
    }
    this.loading = false;
  }

  /** 档位 → 实际色值（渲染期现算，跟着皮肤/深浅走）。 */
  private toneColor(): string {
    const t: GridTokens = this.tk();
    if (this.errorTone === 'error') {
      return t.error;
    }
    if (this.errorTone === 'success') {
      return t.success;
    }
    if (this.errorTone === 'warn') {
      return t.accentText;
    }
    return t.onSurfaceVariant;
  }

  /** 当前配色（语义色见 core/theme/GridTokens.ts）。 */
  private tk(): GridTokens {
    return gridTokens(this.isDark, getPalette(this.paletteName));
  }

  build() {
    Column() {
      Row() {
        Text('登录北京理工大学统一身份认证')
          .fontSize(17).fontWeight(FontWeight.Bold).layoutWeight(1)
      }.width('100%').padding({ left: 16, right: 16, top: 16, bottom: 4 })

      // F01-02（用户拍板 B，对齐 Android 无条件存）：登录成功即加密存凭据。
      // 说明文字如实告知，不再声称「默认不保存」。
      Text('登录成功后密码加密存入本机系统密钥库，会话过期时自动续期（对齐 Android 端）')
        .fontSize(12).fontColor(this.tk().onSurfaceVariant)
        .width('100%').padding({ left: 16, right: 16, bottom: 12 })

      if (this.hasInjectedCreds) {
        Text('调试通道：凭据由启动参数注入，点「登录」即用（不会显示在输入框）')
          .fontSize(11).fontColor(this.tk().accentText)
          .width('100%').padding({ left: 16, right: 16, bottom: 8 })
      }

      Column({ space: 10 }) {
        TextInput({ placeholder: '学号', text: this.username })
          .type(InputType.Normal)
          .height(44)
          .enabled(!this.loading)
          // M11-6：placeholder 输入后就没了，读屏焦点回来时要还能听出是哪个框
          .accessibilityText('学号输入框')
          .onChange((v: string) => {
            this.username = v;
          })

        TextInput({ placeholder: '密码', text: this.password })
          .type(InputType.Password)
          .height(44)
          .enabled(!this.loading)
          .accessibilityText('密码输入框，输入内容不显示')
          .onChange((v: string) => {
            this.password = v;
          })

        Button(this.loading ? '登录中…' : '登录')
          .width('100%').height(44)
          .enabled(!this.loading)
          .onClick(() => {
            this.doLogin();
          })

        Row() {
          // F01-02：无条件存，勾选框退化为状态展示（isOn 恒 true、不可关闭）。
          // 保留控件而非删除：避免改动 build() 结构导致布局回归，且如实展示当前行为。
          Toggle({ type: ToggleType.Checkbox, isOn: true })
            .enabled(false)
          Text('已启用自动续期（本机加密保存）')
            .fontSize(13).fontColor(this.tk().onSurfaceVariant)
            .margin({ left: 8 })
            .accessibilityText('已启用自动续期，密码在本机加密保存')
        }
        .width('100%')
      }
      .width('100%')
      .padding({ left: 16, right: 16 })

      // 短信二次验证（学校风控触发时才出现）
      if (this.needSms) {
        Column({ space: 8 }) {
          Text('学校要求短信验证')
            .fontSize(13).fontColor(this.tk().accentText)
            .width('100%')
          Row() {
            TextInput({ placeholder: '短信验证码', text: this.smsCode })
              .type(InputType.Number)
              .maxLength(8)
              .height(44)
              .layoutWeight(1)
              .accessibilityText('短信验证码输入框')
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
        .fontColor(this.toneColor())
        .width('100%')
        .padding({ left: 16, right: 16, top: 14 })

      // 诊断轨迹（已打码，可截图取证）
      if (this.steps.length > 0) {
        List() {
          ForEach(this.steps, (line: string, i: number) => {
            ListItem() {
              Text(line)
                .fontSize(11).fontColor(this.tk().onSurfaceVariant)
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
          .fontSize(13).fontColor(this.tk().primary)
          .accessibilityText('返回上一页')
          .onClick(() => {
            router.back();
          })
      }.width('100%').padding(16)
    }
    .width('100%')
    .height('100%')
  }
}
