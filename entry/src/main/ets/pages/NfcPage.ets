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
import type { GateReport } from '../corelogic/AuthGateLogic.ts';
import type { DumpLine } from '../corelogic/DeepScanLogic.ts';
import type { ClassicLine } from '../corelogic/ClassicScanLogic.ts';
import {
  summarize as summarizeIdentity, hasPerson, cardNoCandidates
} from '../corelogic/CardIdentityLogic.ts';
import type { CardIdentity } from '../corelogic/CardIdentityLogic.ts';
import {
  SavedCard, mergeCard, sameContent, isBlank, cardLine
} from '../corelogic/SavedCardLogic.ts';
import {
  loadCard, saveCard, forgetCard, loadStudentInput, saveStudentInput
} from '../data/SavedCardStore.ts';
import { info, warn } from '../core/log/BitLog.ts';

@Entry
@Component
struct NfcPage {
  @StorageLink(STORAGE_DARK) isDark: boolean = false;
  @StorageLink(STORAGE_PALETTE) paletteName: string = 'brand';
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
  /** F05-01：本机名片（读卡后合并落盘，重进页面仍在）。 */
  @State savedCard: SavedCard | null = null;
  @State probing: boolean = false;
  @State probeLines: ProbeLine[] = [];
  @State identity: CardIdentity | null = null;
  @State probeError: string = '';
  /** 同一张卡贴着会连续触发 readerMode，按 UID 去重，不重复跑几十条 APDU。 */
  private lastProbedUid: string = '';
  // 认证门研究（#168）
  @State authMode: boolean = false;
  @State authBusy: boolean = false;
  @State authLines: string[] = [];
  @State authReport: GateReport | null = null;
  @State authError: string = '';
  // 深度只读扫描（#170）
  @State deepMode: boolean = false;
  @State deepBusy: boolean = false;
  @State deepLines: DumpLine[] = [];
  @State deepError: string = '';
  // Mifare Classic 全扇区只读 dump（#153）
  @State classicMode: boolean = false;
  @State classicBusy: boolean = false;
  @State classicLines: ClassicLine[] = [];
  @State classicError: string = '';

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
    this.authLines = [];
    this.authReport = null;
    this.authError = '';
    this.deepLines = [];
    this.deepError = '';
    this.classicLines = [];
    this.classicError = '';
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
      // 快速读/深度/认证门要 CPU 卡(APDU)；Classic dump 只要有 Classic 层。
      // 同一 UID 贴着反复触发时只跑一次。
      const canRun: boolean = this.classicMode ? r.classic : r.apdu;
      if (!canRun || r.uid === this.lastProbedUid) {
        return;
      }
      this.lastProbedUid = r.uid;
      if (this.classicMode) {
        this.runClassic(tagInfo);
      } else if (this.deepMode) {
        this.runDeep(tagInfo);
      } else if (this.authMode) {
        this.runAuthGate(tagInfo);
      } else {
        this.runProbe(tagInfo);
      }
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
      // F05-01：读卡成功后合并进本机名片并落盘（换卡整张替换，确认学号优先）。
      const id: CardIdentity | null = this.identity;
      const fresh: SavedCard = {
        name: id === null ? null : id.name,
        studentId: id === null ? null : id.studentId,
        sidConfirmed: id !== null && id.studentId !== null,
        cardNo: id === null ? null : id.cardNo,
        uid: result.uid.length > 0 ? result.uid : null,
        savedAt: Date.now()
      };
      this.persistCard(fresh);
      info('NFC page probe done lines=' + result.lines.length +
        ' person=' + (this.identity !== null && hasPerson(this.identity)));
    }).catch((e: Error) => {
      this.probeError = '快速读失败：' + e.message;
      warn('NFC page probe fail: ' + JSON.stringify(e));
    }).finally(() => {
      this.probing = false;
    });
  }

  /**
   * 认证门研究（#168）：跑 7 步只读探测，判定 6982 是哪种锁。
   * 全程不含 EXTERNAL AUTHENTICATE，不破密钥、不猜门后内容。
   */
  private runAuthGate(tagInfo: import('@kit.ConnectivityKit').tag.TagInfo): void {
    this.authBusy = true;
    this.authError = '';
    this.authLines = [];
    this.authReport = null;
    NfcService.probeAuthGate(tagInfo).then((result) => {
      this.authLines = result.lines;
      this.authReport = result.report;
      this.authError = result.error;
      info('NFC page authgate done report=' + (result.report !== null ? result.report.kind : 'none') +
        ' lines=' + result.lines.length);
    }).catch((e: Error) => {
      this.authError = '认证门研究失败：' + e.message;
      warn('NFC page authgate fail: ' + JSON.stringify(e));
    }).finally(() => {
      this.authBusy = false;
    });
  }

  /**
   * 深度只读扫描（#170）：dump 卡内所有不设防区域的字节。
   * 认证门(6982)记录后跳过；不认证、不破密钥、不猜门后内容。
   */
  private runDeep(tagInfo: import('@kit.ConnectivityKit').tag.TagInfo): void {
    this.deepBusy = true;
    this.deepError = '';
    this.deepLines = [];
    NfcService.probeDeep(tagInfo, (lines: DumpLine[]) => {
      this.deepLines = lines;
    }).then((result) => {
      this.deepLines = result.lines;
      this.deepError = result.error;
      info('NFC page deep done lines=' + result.lines.length);
    }).catch((e: Error) => {
      this.deepError = '深度扫描失败：' + e.message;
      warn('NFC page deep fail: ' + JSON.stringify(e));
    }).finally(() => {
      this.deepBusy = false;
    });
  }

  /**
   * Mifare Classic 全扇区只读 dump（#153）。
   * 只用默认密钥 KeyA，认证失败即跳过；不写块、不写 NDEF（红线）。
   */
  private runClassic(tagInfo: import('@kit.ConnectivityKit').tag.TagInfo): void {
    this.classicBusy = true;
    this.classicError = '';
    this.classicLines = [];
    NfcService.probeClassic(tagInfo, (lines: ClassicLine[]) => {
      this.classicLines = lines;
    }).then((result) => {
      this.classicLines = result.lines;
      this.classicError = result.error;
      info('NFC page classic done lines=' + result.lines.length);
    }).catch((e: Error) => {
      this.classicError = 'Classic 扫描失败：' + e.message;
      warn('NFC page classic fail: ' + JSON.stringify(e));
    }).finally(() => {
      this.classicBusy = false;
    });
  }

  aboutToAppear(): void {
    this.refreshCap();
    this.loadSaved();
  }

  /** F05-01：读回名片 + 学号输入框（读失败留空态，不阻塞诊断页）。 */
  private async loadSaved(): Promise<void> {
    try {
      this.savedCard = await loadCard();
      this.studentIdInput = await loadStudentInput();
    } catch (e) {
      warn('NFC load saved card fail: ' + JSON.stringify(e));
    }
  }

  /** F05-01：合并新读到的名片并落盘；内容没变就不写盘（sameContent 不含 savedAt）。 */
  private async persistCard(fresh: SavedCard): Promise<void> {
    const merged: SavedCard = mergeCard(this.savedCard, fresh, fresh.savedAt);
    if (sameContent(this.savedCard, merged)) {
      return;
    }
    try {
      await saveCard(merged);
      this.savedCard = merged;
      info('NFC saved card updated uid=' + (merged.uid === null ? 'none' : merged.uid));
    } catch (e) {
      warn('NFC save card fail: ' + JSON.stringify(e));
    }
  }

  /** F05-01：忘掉这张卡——名片清空，**学号输入框保留**。 */
  private async forgetSaved(): Promise<void> {
    try {
      await forgetCard();
      this.savedCard = null;
      info('NFC saved card forgotten');
    } catch (e) {
      warn('NFC forget card fail: ' + JSON.stringify(e));
    }
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
          // F05-01：本机名片（读卡后一直在；「忘掉」只清名片，不清学号输入框）
          if (!isBlank(this.savedCard)) {
            Column() {
              Row() {
                Text('我的校园卡').fontSize(13).fontWeight(FontWeight.Medium)
                  .fontColor(this.tk().onSurface).layoutWeight(1)
                Text('忘掉这张卡').fontSize(12).fontColor(this.tk().primary)
                  .onClick(() => { this.forgetSaved(); })
              }.width('100%')
              Text(cardLine(this.savedCard))
                .fontSize(12).fontColor(this.tk().onSurfaceVariant)
                .width('100%').margin({ top: 6 })
              if (this.savedCard !== null && this.savedCard.savedAt > 0) {
                Text('更新于 ' + new Date(this.savedCard.savedAt).toLocaleString())
                  .fontSize(10).fontColor(this.tk().textPlaceholder)
                  .width('100%').margin({ top: 4 })
              }
            }
            .width('100%').padding(12).margin({ bottom: 8 })
            .backgroundColor(this.tk().secondaryContainer).borderRadius(10)
          }

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
                saveStudentInput(v).catch((e: Error) => {
                  warn('NFC save student input fail: ' + JSON.stringify(e));
                });
              })

            Column() {
              Row() {
                Button('快速读名片')
                  .fontSize(11).layoutWeight(1).height(36)
                  .backgroundColor(!this.authMode && !this.deepMode && !this.classicMode
                    ? this.tk().primary : this.tk().surface2)
                  .fontColor(!this.authMode && !this.deepMode && !this.classicMode
                    ? this.tk().onPrimary : this.tk().onSurface)
                  .onClick(() => { this.authMode = false; this.deepMode = false; this.classicMode = false; })
                Button('研究 6982')
                  .fontSize(11).layoutWeight(1).height(36).margin({ left: 4 })
                  .backgroundColor(this.authMode ? this.tk().primary : this.tk().surface2)
                  .fontColor(this.authMode ? this.tk().onPrimary : this.tk().onSurface)
                  .onClick(() => { this.authMode = true; this.deepMode = false; this.classicMode = false; })
              }.width('100%')
              Row() {
                Button('深度 dump')
                  .fontSize(11).layoutWeight(1).height(36).margin({ top: 6 })
                  .backgroundColor(this.deepMode ? this.tk().primary : this.tk().surface2)
                  .fontColor(this.deepMode ? this.tk().onPrimary : this.tk().onSurface)
                  .onClick(() => { this.deepMode = true; this.authMode = false; this.classicMode = false; })
                Button('Classic dump')
                  .fontSize(11).layoutWeight(1).height(36).margin({ top: 6, left: 4 })
                  .backgroundColor(this.classicMode ? this.tk().primary : this.tk().surface2)
                  .fontColor(this.classicMode ? this.tk().onPrimary : this.tk().onSurface)
                  .onClick(() => { this.classicMode = true; this.authMode = false; this.deepMode = false; })
              }.width('100%')
            }.width('100%').margin({ top: 12 })
            if (this.authMode) {
              Text('只读探测：看 0004 的 6982 是质询-应答门还是权限位门。不认证、不破密钥、不猜门后内容。')
                .fontSize(11).fontColor(this.tk().onSurfaceVariant)
                .width('100%').padding({ top: 8 })
            }
            if (this.deepMode) {
              Text('全空间只读 dump：FID 0000~00FF + 目录下钻，逐段读到文件末尾。认证门(6982)记录后跳过，不认证、不破密钥。贴卡时间较长，请贴稳。')
                .fontSize(11).fontColor(this.tk().onSurfaceVariant)
                .width('100%').padding({ top: 8 })
            }
            if (this.classicMode) {
              Text('Mifare Classic 全扇区只读 dump：只用出厂默认密钥 FFFFFFFFFFFF 作 KeyA 认证，认证失败即跳过、不试其他密钥；只读块，绝不写块或写 NDEF（会损坏卡片）。')
                .fontSize(11).fontColor(this.tk().onSurfaceVariant)
                .width('100%').padding({ top: 8 })
            }

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

            if (this.authMode && (this.authBusy || this.authLines.length > 0 || this.authError.length > 0)) {
              Text('认证门研究（6982）')
                .fontSize(13).fontWeight(FontWeight.Medium).fontColor(this.tk().onSurface)
                .width('100%').padding({ top: 20 })
              if (this.authBusy) {
                Text('正在只读探测 0004 / 目录 0010 …')
                  .fontSize(12).fontColor(this.tk().onSurfaceVariant)
                  .width('100%').padding({ top: 6 })
              }
              if (this.authError.length > 0) {
                Text('⚠️ ' + this.authError)
                  .fontSize(11).fontColor(this.tk().error)
                  .width('100%').padding({ top: 6 })
              }
              if (this.authReport !== null) {
                Text(this.authReport!.conclusion)
                  .fontSize(13).fontColor(this.tk().primary)
                  .width('100%').padding({ top: 8 })
                Text('已知：' + this.authReport!.known.join('；'))
                  .fontSize(11).fontColor(this.tk().onSurfaceVariant)
                  .width('100%').padding({ top: 6 })
                Text('未知：' + this.authReport!.unknown.join('；'))
                  .fontSize(11).fontColor(this.tk().onSurfaceVariant)
                  .width('100%').padding({ top: 6 })
              }
              ForEach(this.authLines, (line: string, idx: number) => {
                Text(line)
                  .fontSize(10).fontColor(this.tk().onSurfaceVariant)
                  .width('100%').padding({ top: 4 })
              }, (line: string, idx: number) => 'auth-' + idx)
              Text('全程只发只读命令；不含 EXTERNAL AUTHENTICATE，不破密钥。')
                .fontSize(11).fontColor(this.tk().onSurfaceVariant)
                .width('100%').padding({ top: 10 })
            }

            if (this.deepMode && (this.deepBusy || this.deepLines.length > 0 || this.deepError.length > 0)) {
              Text('深度只读 dump（' + this.deepLines.length + ' 条）')
                .fontSize(13).fontWeight(FontWeight.Medium).fontColor(this.tk().onSurface)
                .width('100%').padding({ top: 20 })
              if (this.deepBusy) {
                Text('正在逐段读卡内文件，请保持贴卡…（已收 ' + this.deepLines.length + ' 条）')
                  .fontSize(12).fontColor(this.tk().onSurfaceVariant)
                  .width('100%').padding({ top: 6 })
              }
              if (this.deepError.length > 0) {
                Text('⚠️ ' + this.deepError)
                  .fontSize(11).fontColor(this.tk().error)
                  .width('100%').padding({ top: 6 })
              }
              ForEach(this.deepLines, (l: DumpLine, idx: number) => {
                Column() {
                  Text(l.context + ' · ' + l.target + ' · ' + l.op + ' → ' + l.sw +
                    (l.swText !== null ? '（' + l.swText + '）' : ''))
                    .fontSize(10).fontColor(this.tk().onSurface)
                  Text('APDU ' + l.apdu + (l.data.length > 0 ? '  DATA ' + l.data : ''))
                    .fontSize(9).fontColor(this.tk().onSurfaceVariant).padding({ top: 2 })
                  if (l.note.length > 0) {
                    Text(l.note).fontSize(9).fontColor(this.tk().onSurfaceVariant).padding({ top: 2 })
                  }
                }
                .width('100%').padding(6)
                .backgroundColor(this.tk().surface).borderRadius(6).margin({ top: 4 })
              }, (l: DumpLine, idx: number) => 'deep-' + idx + '-' + l.sw)
              Text('只发只读命令；6982 认证门记录后跳过，不认证、不破密钥、不猜门后内容。')
                .fontSize(11).fontColor(this.tk().onSurfaceVariant)
                .width('100%').padding({ top: 10 })
            }

            if (this.classicMode && (this.classicBusy || this.classicLines.length > 0 || this.classicError.length > 0)) {
              Text('Mifare Classic 全扇区只读 dump（' + this.classicLines.length + ' 条）')
                .fontSize(13).fontWeight(FontWeight.Medium).fontColor(this.tk().onSurface)
                .width('100%').padding({ top: 20 })
              if (this.classicBusy) {
                Text('正在逐扇区认证并读块，请保持贴卡…（已收 ' + this.classicLines.length + ' 条）')
                  .fontSize(12).fontColor(this.tk().onSurfaceVariant)
                  .width('100%').padding({ top: 6 })
              }
              if (this.classicError.length > 0) {
                Text('⚠️ ' + this.classicError)
                  .fontSize(11).fontColor(this.tk().error)
                  .width('100%').padding({ top: 6 })
              }
              ForEach(this.classicLines, (l: ClassicLine, idx: number) => {
                Column() {
                  Text('扇区 ' + l.sector + ' · ' + l.op + ' → ' + l.status +
                    (l.block >= 0 ? ' · 块 ' + l.block : ''))
                    .fontSize(10).fontColor(this.tk().onSurface)
                  if (l.data.length > 0) {
                    Text(l.data + (l.allZero ? '（全零）' : ''))
                      .fontSize(9).fontColor(this.tk().onSurfaceVariant).padding({ top: 2 })
                  }
                  if (l.note.length > 0) {
                    Text(l.note).fontSize(9).fontColor(this.tk().onSurfaceVariant).padding({ top: 2 })
                  }
                }
                .width('100%').padding(6)
                .backgroundColor(this.tk().surface).borderRadius(6).margin({ top: 4 })
              }, (l: ClassicLine, idx: number) => 'classic-' + idx + '-' + l.sector + '-' + l.block)
              Text('只用默认密钥 KeyA；认证失败跳过、不试其他密钥；只读块，不写块、不写 NDEF。')
                .fontSize(11).fontColor(this.tk().onSurfaceVariant)
                .width('100%').padding({ top: 10 })
            }
          }

          Text('说明：这里只读 UID / technology / NDEF / Classic 块。写校园卡、模拟刷卡、过闸机、支付都不在本功能范围内。')
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
