/**
 * NFC 校园卡诊断页（M16-2 + M16-3 快速读）。
 *
 * 只读：UID / technology / NDEF / APDU 快速读（姓名·学号·疑似日期）。
 * 明确不做写卡、HCE、支付、闸机。
 */

import { router } from '@kit.ArkUI';
import { gridTokens } from '../core/theme/GridTokens.ts';
import type { GridTokens } from '../core/theme/GridTokens.ts';
import { STORAGE_DARK, STORAGE_PALETTE, getPalette } from '../data/ThemeStore.ts';
import { NfcService, NfcScanResult } from '../service/NfcService.ts';
import type { NfcCapability } from '../corelogic/NfcLogic.ts';
import type { ProbeLine } from '../corelogic/CardProbeRunner.ts';
import {
  summarize as summarizeIdentity, hasPerson, cardNoCandidates
} from '../corelogic/CardIdentityLogic.ts';
import type { CardIdentity } from '../corelogic/CardIdentityLogic.ts';
import { info, warn } from '../core/log/BitLog.ts';

@Entry
@Component
struct NfcPage {
  @StorageLink(STORAGE_DARK) isDark: boolean = false;
  @StorageLink(STORAGE_PALETTE) paletteName: string = 'warm';
  @State cap: NfcCapability = 'unsupported';
  @State scanning: boolean = false;
  @State gotCard: boolean = false;
  @State uid: string = '';
  @State techs: string = '';
  @State apdu: boolean = false;
  @State classic: boolean = false;
  @State ndef: string[] = [];
  @State error: string = '';
  // APDU 快速读（M16-3）
  @State studentIdInput: string = '';
  @State probing: boolean = false;
  @State probeLines: ProbeLine[] = [];
  @State identity: CardIdentity | null = null;
  @State probeError: string = '';
  /** 同一张卡贴着会连续触发 readerMode，按 UID 去重，不重复跑几十条 APDU。 */
  private lastProbedUid: string = '';

  private tk(): GridTokens {
    return gridTokens(this.isDark, getPalette(this.paletteName));
  }

  private capTitle(): string {
    if (this.cap === 'enabled') return 'NFC 可用';
    if (this.cap === 'disabled') return 'NFC 已关闭';
    return '本设备不支持 NFC';
  }

  private capHint(): string {
    if (this.cap === 'enabled') {
      return '把校园卡或 NFC 贴纸贴在手机背面。只读 UID / technology / NDEF，不写卡、不模拟刷卡。';
    }
    if (this.cap === 'disabled') {
      return '系统报告有 NFC 能力，但现在关着。请到「设置 → 更多连接 → NFC」打开后再回来（应用无权替你打开）。';
    }
    return '系统没有报告 NFC 能力。模拟器不支持 NFC；换一台带 NFC 的鸿蒙手机才能读卡。';
  }

  private ndefText(): string {
    if (this.ndef.length === 0) {
      return '';
    }
    return this.ndef.join('\n');
  }

  private refreshCap(): void {
    this.cap = NfcService.capability();
    if (this.cap !== 'enabled') {
      NfcService.stop();
      this.scanning = false;
    }
  }

  private toggleScan(): void {
    if (this.scanning) {
      NfcService.stop();
      this.scanning = false;
      return;
    }
    this.error = '';
    this.gotCard = false;
    // 重新读卡时清掉上次结果，避免「正在等卡」却显示旧 UID 误导（真机 2026-11-18 发现）
    this.uid = '';
    this.techs = '';
    this.apdu = false;
    this.classic = false;
    this.ndef = [];
    this.probeLines = [];
    this.identity = null;
    this.probeError = '';
    this.lastProbedUid = '';
    const ok: boolean = NfcService.start((r: NfcScanResult) => {
      this.gotCard = true;
      this.uid = r.uid;
      this.techs = r.techs;
      this.apdu = r.apdu;
      this.classic = r.classic;
      this.ndef = r.ndef;
      this.error = r.ndefError.length > 0 ? ('NDEF 读取失败：' + r.ndefError) : '';
      info('NFC page scan uid=' + r.uid + ' tech=' + r.techs);
    }, (tagInfo, r) => {
      // CPU 卡才跑 APDU；同一 UID 贴着反复触发时只跑一次
      if (!r.apdu || r.uid === this.lastProbedUid) {
        return;
      }
      this.lastProbedUid = r.uid;
      this.runProbe(tagInfo);
    });
    if (!ok) {
      this.error = '读卡启动失败：请确认 NFC 已打开，且本机支持 NFC。';
      this.refreshCap();
      return;
    }
    this.scanning = true;
  }

  /**
   * 跑 APDU 快速读并汇总名片（#152）。
   * 学号输入框留空则不填 —— 走「猜测」路径（结果标「疑似」）；
   * 填了则只做核对，不猜。
   */
  private runProbe(tagInfo: import('@kit.ConnectivityKit').tag.TagInfo): void {
    this.probing = true;
    this.probeError = '';
    const sid: string | null = this.studentIdInput.trim().length > 0
      ? this.studentIdInput.trim() : null;
    NfcService.probeApdu(tagInfo, sid, (lines: ProbeLine[]) => {
      this.probeLines = lines;
    }).then((result) => {
      this.probeLines = result.lines;
      this.probeError = result.error;
      const uidNums: number[] = [];
      const parts: string[] = result.uid.split(' ');
      for (let i = 0; i < parts.length; i++) {
        const n: number = parseInt(parts[i], 16);
        if (!isNaN(n)) {
          uidNums.push(n);
        }
      }
      this.identity = summarizeIdentity(result.lines, cardNoCandidates(uidNums), sid);
      info('NFC page probe done lines=' + result.lines.length +
        ' person=' + (this.identity !== null && hasPerson(this.identity)));
    }).catch((e: Error) => {
      this.probeError = '快速读失败：' + e.message;
      warn('NFC page probe fail: ' + JSON.stringify(e));
    }).finally(() => {
      this.probing = false;
    });
  }

  aboutToAppear(): void {
    this.refreshCap();
  }

  aboutToDisappear(): void {
    NfcService.stop();
    info('NFC page disappear, reader stopped');
  }

  build() {
    Column() {
      Row() {
        Button('‹ 返回')
          .onClick(() => {
            router.back();
          })
        Text('NFC 校园卡').fontSize(16).fontWeight(FontWeight.Bold).layoutWeight(1)
          .textAlign(TextAlign.Center)
        Button('刷新').fontSize(13)
          .onClick(() => {
            this.refreshCap();
          })
      }.width('100%').padding(12)

      Scroll() {
        Column() {
          Row() {
            Text(this.capTitle())
              .fontSize(15).fontWeight(FontWeight.Medium)
              .fontColor(this.cap === 'enabled' ? this.tk().primary : this.tk().error)
              .layoutWeight(1)
            Text(this.cap === 'enabled' ? '只读' : '不可用')
              .fontSize(11).fontColor(this.tk().onSurfaceVariant)
          }
          .width('100%').padding(14)
          .backgroundColor(this.tk().surface).borderRadius(10)

          Text(this.capHint())
            .fontSize(12).fontColor(this.tk().onSurfaceVariant)
            .width('100%').padding({ top: 10 })

          if (this.cap === 'enabled') {
            Text('学号（选填，填了才做核对；留空则自动识别并标「疑似」）')
              .fontSize(12).fontColor(this.tk().onSurfaceVariant)
              .width('100%').padding({ top: 14 })
            TextInput({ text: this.studentIdInput, placeholder: '如 1120241355' })
              .fontSize(14).width('100%').height(40)
              .onChange((v: string) => {
                this.studentIdInput = v;
              })

            Button(this.scanning ? '停止读卡' : '开始读卡')
              .fontSize(14).width('100%').height(42).margin({ top: 14 })
              .backgroundColor(this.scanning ? this.tk().surface2 : this.tk().primary)
              .fontColor(this.scanning ? this.tk().onSurface : this.tk().onPrimary)
              .onClick(() => {
                this.toggleScan();
              })
            Text(this.scanning
              ? (this.gotCard ? '已读到卡：可继续贴其它卡，或点「停止读卡」' : '正在等卡：请把卡贴到手机背面（亮屏解锁状态）')
              : '点「开始读卡」后贴卡')
              .fontSize(12).fontColor(this.tk().onSurfaceVariant)
              .width('100%').padding({ top: 8 })
          }

          if (this.error.length > 0) {
            Text('⚠️ ' + this.error)
              .fontSize(12).fontColor(this.tk().error)
              .width('100%').padding({ top: 12 })
          }

          if (this.uid.length > 0) {
            Text('UID')
              .fontSize(12).fontColor(this.tk().onSurfaceVariant)
              .width('100%').padding({ top: 18 })
            Text(this.uid)
              .fontSize(20).fontWeight(FontWeight.Bold).fontColor(this.tk().onSurface)
              .width('100%').padding({ top: 2 })

            Text('technology')
              .fontSize(12).fontColor(this.tk().onSurfaceVariant)
              .width('100%').padding({ top: 14 })
            Text(this.techs)
              .fontSize(13).fontColor(this.tk().onSurface)
              .width('100%').padding({ top: 2 })

            Row() {
              Text(this.apdu ? 'CPU 卡（可 APDU）' : '非 CPU 卡')
                .fontSize(11)
                .fontColor(this.apdu ? this.tk().onPrimary : this.tk().onSurfaceVariant)
                .backgroundColor(this.apdu ? this.tk().primary : this.tk().surface2)
                .borderRadius(8).padding({ left: 8, right: 8, top: 3, bottom: 3 })
              if (this.classic) {
                Text('Mifare Classic')
                  .fontSize(11).fontColor(this.tk().onSurface)
                  .backgroundColor(this.tk().surface2)
                  .borderRadius(8).padding({ left: 8, right: 8, top: 3, bottom: 3 })
                  .margin({ left: 8 })
              }
            }.width('100%').padding({ top: 12 })

            if (this.ndefText().length > 0) {
              Text('NDEF')
                .fontSize(12).fontColor(this.tk().onSurfaceVariant)
                .width('100%').padding({ top: 18 })
              Text(this.ndefText())
                .fontSize(13).fontColor(this.tk().onSurface)
                .width('100%').padding({ top: 2 })
            }

            if (this.apdu && (this.probing || this.probeLines.length > 0 || this.probeError.length > 0)) {
              Text('快速读（只读 APDU）')
                .fontSize(13).fontWeight(FontWeight.Medium).fontColor(this.tk().onSurface)
                .width('100%').padding({ top: 18 })
              if (this.probing) {
                Text('正在读卡内文件，请保持贴卡…（' + this.probeLines.length + ' 步）')
                  .fontSize(12).fontColor(this.tk().onSurfaceVariant)
                  .width('100%').padding({ top: 6 })
              }
              if (this.probeError.length > 0) {
                Text('⚠️ ' + this.probeError)
                  .fontSize(11).fontColor(this.tk().error)
                  .width('100%').padding({ top: 6 })
              }
              if (this.identity !== null && hasPerson(this.identity)) {
                Column() {
                  if (this.identity!.name !== null) {
                    Text('姓名  ' + this.identity!.name)
                      .fontSize(16).fontWeight(FontWeight.Bold).fontColor(this.tk().onSurface)
                      .width('100%').padding({ top: 6 })
                  }
                  if (this.identity!.studentId !== null) {
                    Text('学号  ' + this.identity!.studentId + '（已核对）')
                      .fontSize(14).fontColor(this.tk().primary)
                      .width('100%').padding({ top: 6 })
                  }
                  if (this.identity!.guessedStudentId !== null) {
                    Text('疑似学号  ' + this.identity!.guessedStudentId + '（未核对，填学号可确认）')
                      .fontSize(14).fontColor(this.tk().onSurface)
                      .width('100%').padding({ top: 6 })
                  }
                  if (this.identity!.dates.length > 0) {
                    Text('卡上日期（疑似）  ' + this.identity!.dates.join('、'))
                      .fontSize(12).fontColor(this.tk().onSurfaceVariant)
                      .width('100%').padding({ top: 6 })
                  }
                  if (this.identity!.cardNo !== null) {
                    Text('卡号候选  ' + this.identity!.cardNo)
                      .fontSize(11).fontColor(this.tk().onSurfaceVariant)
                      .width('100%').padding({ top: 6 })
                  }
                }
                .width('100%').padding(12)
                .backgroundColor(this.tk().surface).borderRadius(10).margin({ top: 8 })
              } else if (!this.probing) {
                Text('没认出姓名/学号。快速读只扫低区文件 0001~001F，换批次卡可能落在别处。')
                  .fontSize(11).fontColor(this.tk().onSurfaceVariant)
                  .width('100%').padding({ top: 6 })
              }
              Text('命中 ' + this.probeLines.length + ' 条 APDU 流水（只读，不写卡）')
                .fontSize(11).fontColor(this.tk().onSurfaceVariant)
                .width('100%').padding({ top: 8 })
            }
          }

          Text('说明：这里只读 UID / technology / NDEF。写校园卡、模拟刷卡、过闸机、支付都不在本功能范围内。')
            .fontSize(11).fontColor(this.tk().onSurfaceVariant)
            .width('100%').padding({ top: 22, bottom: 12 })
        }
        .width('100%').padding({ left: 12, right: 12, top: 8 })
      }
      .layoutWeight(1)
      .align(Alignment.Top)
    }
    .width('100%').height('100%')
    .backgroundColor(this.tk().background)
  }
}
