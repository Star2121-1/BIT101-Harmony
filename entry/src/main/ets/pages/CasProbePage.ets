/**
 * 裸协议探针触发页（阶段 A / B / C）。可整删。
 * - 「跑阶段A」：零凭据（取页 + 解析 + AES 自证）。
 * - 「跑阶段B」：真登录；若服务端要求短信二次验证 ⇒ 自动发短信并停在等码状态。
 * - 「提交验证码」：阶段 C，用户授权后接验证码续跑到 JWT。
 * 凭据来自 `aa start --ps` 运行时参数（只进进程内存），页面只展示**脱敏**结果。
 */
import { Context } from '@kit.AbilityKit';
import {
  CasProbe, ProbeCreds, mask, getProbeCreds, clearProbeCreds, getSfPending, clearSfPending
} from '../probe/CasProbe.ts';
import { hilog } from '@kit.PerformanceAnalysisKit';

const DOMAIN: number = 0x00CC;
const TAG: string = 'BIT101Probe';

@Entry
@Component
struct CasProbePage {
  @State status: string = '尚未运行';
  @State detail: string = '';
  @State hasCreds: string = '检查中…';
  @State smsCode: string = '';
  private probe: CasProbe = new CasProbe();

  aboutToAppear(): void {
    const creds: ProbeCreds = getProbeCreds();
    const u: string = creds.user;
    const p: string = creds.pass;
    if (u.length > 0 && p.length > 0) {
      this.hasCreds = '凭据已就绪（学号 ' + mask(u) + '，密码已收）';
    } else {
      this.hasCreds = '未收到凭据（需 aa start --ps probe_user --ps probe_pass 启动）';
    }
    hilog.info(DOMAIN, TAG, 'page appear, hasUser=%{public}s hasPass=%{public}s',
      u.length > 0 ? 'yes' : 'no', p.length > 0 ? 'yes' : 'no');
  }

  private async runStageA(): Promise<void> {
    this.status = '阶段A 运行中…';
    this.detail = '';
    try {
      const ctx: Context = getContext(this) as Context;
      const out: Record<string, string> = await this.probe.runStageA(ctx);
      this.detail = formatDetail(out);
      const aesMatch: string = out['aes_match'] ?? '?';
      const fetchOk: string = out['http_status'] === '200' ? 'true' : 'false';
      this.status = '阶段A完成：AES match=' + aesMatch + '  HTTP200=' + fetchOk;
      hilog.info(DOMAIN, TAG, 'stageA done aes=%{public}s http200=%{public}s', aesMatch, fetchOk);
    } catch (e) {
      this.status = '❌ 阶段A异常（已停手，不重试）';
      this.detail = JSON.stringify(e);
      hilog.error(DOMAIN, TAG, 'stageA fatal: %{public}s', JSON.stringify(e));
    }
  }

  private async runStageB(): Promise<void> {
    const creds: ProbeCreds = getProbeCreds();
    const username: string = creds.user;
    const password: string = creds.pass;
    if (username.length === 0 || password.length === 0) {
      this.status = '❌ 无凭据，停手';
      this.detail = '需经 aa start --ps probe_user <学号> --ps probe_pass <密码> 启动后重试';
      return;
    }
    this.status = '阶段B 运行中（一次性，请稍候 ~15s）…';
    this.detail = '';
    try {
      const ctx: Context = getContext(this) as Context;
      const out: Record<string, string> = await this.probe.runStageB(ctx, username, password);
      this.detail = formatDetail(out);
      const st: string = out['status'] ?? '?';
      this.status = '阶段B结束：status=' + st;
      hilog.info(DOMAIN, TAG, 'stageB done status=%{public}s', st);
      if (st !== 'sms_sent') {
        // 只有"短信已发送"才保留凭据（阶段 C 续跑要用用户名）；其余情况用完即清
        clearProbeCreds();
        this.hasCreds = '凭据已用并清除';
      }
    } catch (e) {
      this.status = '❌ 阶段B异常（已停手，不重试）';
      this.detail = JSON.stringify(e);
      hilog.error(DOMAIN, TAG, 'stageB fatal: %{public}s', JSON.stringify(e));
    }
  }

  private async submitCode(): Promise<void> {
    const code: string = this.smsCode.trim();
    if (code.length === 0) {
      this.status = '❌ 验证码为空';
      return;
    }
    this.status = '阶段C 提交验证码中…';
    this.detail = '';
    try {
      const out: Record<string, string> = await this.probe.submitSmsCode(code);
      this.detail = formatDetail(out);
      const st: string = out['status'] ?? '?';
      this.status = '阶段C结束：status=' + st;
      hilog.info(DOMAIN, TAG, 'stageC done status=%{public}s', st);
      // 用完即清：验证码 + 凭据 + 待决态全部抹掉
      this.smsCode = '';
      clearProbeCreds();
      clearSfPending();
      this.hasCreds = '凭据已用并清除';
    } catch (e) {
      this.status = '❌ 阶段C异常（已停手，不重试）';
      this.detail = JSON.stringify(e);
      hilog.error(DOMAIN, TAG, 'stageC fatal: %{public}s', JSON.stringify(e));
    }
  }

  build() {
    Column() {
      Row() {
        Text('裸协议探针')
          .fontSize(16).fontWeight(FontWeight.Bold).layoutWeight(1)
        Button('跑阶段A')
          .onClick(() => {
            this.runStageA();
          })
          .margin({ left: 4 })
        Button('跑阶段B')
          .onClick(() => {
            this.runStageB();
          })
          .margin({ left: 8 })
      }.width('100%').padding(12)

      Text(this.hasCreds).fontSize(12).fontColor('#666666')
        .padding({ left: 12, right: 12, bottom: 4 })

      Row() {
        Text(this.status).fontSize(13).layoutWeight(1)
      }.width('100%').padding({ left: 12, right: 12 })

      // 阶段 C：短信验证码输入（仅当有待决二验时显示）
      if (getSfPending() !== null) {
        Row() {
          TextInput({ placeholder: '输入短信验证码', text: this.smsCode })
            .type(InputType.Number)
            .maxLength(8)
            .onChange((v: string) => {
              this.smsCode = v;
            })
            .layoutWeight(1)
            .height(36)
          Button('提交验证码')
            .onClick(() => {
              this.submitCode();
            })
            .margin({ left: 8 })
        }.width('100%').padding({ left: 12, right: 12, top: 6, bottom: 6 })
      }

      Text(this.detail)
        .fontSize(12).fontColor('#888888')
        .padding({ left: 12, right: 12 }).layoutWeight(1)
    }
    .width('100%').height('100%')
  }
}

/** 结果字典 → 屏上明细（再次脱敏，防任何敏感值明文露出）。 */
function formatDetail(out: Record<string, string>): string {
  const sensitive: string[] = ['ticket', 'jwt', 'b5_location', 'b6_cas_code', 'c2_location',
    'c3_cas_code', 'b0_user', 'sf_phone'];
  const keys: string[] = Object.keys(out);
  const lines: string[] = [];
  for (let i = 0; i < keys.length; i++) {
    const k: string = keys[i];
    let v: string = out[k];
    if (sensitive.indexOf(k) >= 0) {
      v = mask(v);
    }
    if ((k === 'b5_body_head' || k === 'c2_body_head' || k === 'sf_send_body_head' ||
      k === 'c1_check_body_head') && v.length > 160) {
      v = v.substring(0, 160) + '…';
    }
    lines.push(k + ' = ' + v);
  }
  return lines.join('\n');
}
