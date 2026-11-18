/**
 * NFC 前台读卡（M16-2）：唯一直接碰 `@kit.ConnectivityKit` 的地方。
 *
 * ## 只读
 * 本服务只读 UID / technology / NDEF；**没有写卡、没有 HCE、没有支付**。
 * 后续 APDU/Classic 读卡也会走这里，但写路径永远不会加进来。
 *
 * ## 生命周期
 * 页面 `aboutToAppear` 后调 `start`，`aboutToDisappear` 必须 `stop`。
 * `tag.on('readerMode')` 同一 elementName 重复注册会报 3100202（真机待验），
 * 所以服务内部用 `running` 做幂等，页面不需要自己防重。
 *
 * ## 线程
 * 回调里只做纯解析 + NDEF 读取；APDU 等阻塞操作后续放异步链，不在这里做。
 */

import { tag, nfcController } from '@kit.ConnectivityKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { bundleManager } from '@kit.AbilityKit';
import { util } from '@kit.ArkTS';
import { BUNDLE_NAME, ENTRY_ABILITY } from '../corelogic/NotifyDeepLink.ts';
import { quickScan } from '../corelogic/CardProbeLogic.ts';
import { runQuickProbe } from '../corelogic/CardProbeRunner.ts';
import type { ProbeLine } from '../corelogic/CardProbeRunner.ts';
import {
  gateProbeSteps, analyzeGate, formatObservation, probeIsReadOnly
} from '../corelogic/AuthGateLogic.ts';
import type { GateObservation, GateReport } from '../corelogic/AuthGateLogic.ts';
import {
  capabilityFrom,
  hasTech,
  ndefRecordText,
  summarizeTag,
  techListText
} from '../corelogic/NfcLogic.ts';
import type { NfcCapability } from '../corelogic/NfcLogic.ts';
import type { NfcTagInfoLike } from '../corelogic/NfcModels.ts';
import { info, warn } from '../core/log/BitLog.ts';

/** 一次读卡结果（页面直接用）。 */
export interface NfcScanResult {
  uid: string;
  techs: string;
  apdu: boolean;
  classic: boolean;
  ndef: string[];
  /** 取 NDEF 失败时的可读原因；正常为空串。 */
  ndefError: string;
}

/** APDU 快速读的一次完整结果（#152）。 */
export interface NfcProbeResult {
  uid: string;
  lines: ProbeLine[];
  /** 探测过程的可读错误（掉卡/无 IsoDep 等）；正常为空串。 */
  error: string;
}

/** 认证门研究的一次结果（#168）。 */
export interface AuthGateResult {
  uid: string;
  report: GateReport | null;
  /** 归档文本（逐行观察）。 */
  lines: string[];
  error: string;
}

function emptyResult(): NfcScanResult {
  return { uid: '', techs: '', apdu: false, classic: false, ndef: [], ndefError: '' };
}

/**
 * 真机 GBK 解码器：util.TextDecoder 官方支持 gbk（@ohos.util 文档列出）。
 * 解不出或运行时不支持时抛错，由 decodeGbkText 捕获后只显示 hex。
 */
function gbkDecoder(bytes: number[]): string {
  const dec: util.TextDecoder = util.TextDecoder.create('gbk');
  return dec.decodeToString(new Uint8Array(bytes));
}

export class NfcService {
  private static running: boolean = false;
  private static element: bundleManager.ElementName = {
    bundleName: BUNDLE_NAME,
    abilityName: ENTRY_ABILITY,
    moduleName: 'entry'
  };
  private static callback: ((err: BusinessError, info: tag.TagInfo) => void) | null = null;

  /** 三态能力检测；不抛。 */
  static capability(): NfcCapability {
    let hasCore: boolean = false;
    try {
      hasCore = canIUse('SystemCapability.Communication.NFC.Core');
    } catch (e) {
      hasCore = false;
    }
    if (!hasCore) {
      return 'unsupported';
    }
    try {
      return capabilityFrom(true, nfcController.isNfcOpen());
    } catch (e) {
      warn('NfcService isNfcOpen fail: ' + JSON.stringify(e));
      return 'unsupported';
    }
  }

  /**
   * 开始前台读卡。
   * @returns false = 注册失败/无 NFC 能力；调用方要显示明确文案。
   */
  static start(onResult: (r: NfcScanResult) => void,
    onCard?: (tagInfo: tag.TagInfo, r: NfcScanResult) => void): boolean {
    if (NfcService.running) {
      return true;
    }
    if (NfcService.capability() !== 'enabled') {
      return false;
    }
    const cb = (err: BusinessError, info: tag.TagInfo): void => {
      if (err) {
        warn('NfcService reader callback err: ' + JSON.stringify(err));
        return;
      }
      if (!info) {
        return;
      }
      NfcService.readTag(info).then((r: NfcScanResult) => {
        onResult(r);
        if (onCard !== undefined) {
          onCard(info, r);
        }
      }).catch((e: Error) => {
        const r: NfcScanResult = emptyResult();
        r.ndefError = '读取失败：' + e.message;
        onResult(r);
      });
    };
    try {
      tag.on('readerMode', NfcService.element, [
        tag.NFC_A, tag.NFC_B, tag.NFC_F, tag.NFC_V
      ], cb);
      NfcService.callback = cb;
      NfcService.running = true;
      info('NfcService reader started');
      return true;
    } catch (e) {
      warn('NfcService start fail: ' + JSON.stringify(e));
      return false;
    }
  }

  /**
   * 对一张已发现的卡跑 APDU 快速读（#152）。
   *
   * ⚠️ 只读：transmit 前由 CardProbeRunner 逐条过 isReadOnly 闸门；
   * 这里绝不做写块/卡模拟/支付。读失败/掉卡保留已收到的流水。
   *
   * @param studentId 用户填的学号（填了只核对、不填则猜）；传 null 表示不填。
   */
  static async probeApdu(tagInfo: tag.TagInfo, studentId: string | null,
    onProgress?: (lines: ProbeLine[]) => void): Promise<NfcProbeResult> {
    const uid: string = NfcService.uidHex(tagInfo.uid);
    if (!hasTech(tagInfo.technology, tag.ISO_DEP)) {
      return { uid: uid, lines: [], error: '这张卡不支持 APDU（非 CPU 卡）' };
    }
    let iso: tag.IsoDepTag;
    try {
      iso = tag.getIsoDep(tagInfo);
      iso.connect();
    } catch (e) {
      warn('NfcService probe connect fail: ' + JSON.stringify(e));
      return { uid: uid, lines: [], error: '连接卡片失败：' + (e as Error).message };
    }
    const transmit = async (apdu: number[]): Promise<number[]> => {
      return await iso.transmit(apdu);
    };
    let lines: ProbeLine[] = [];
    const collected: ProbeLine[] = [];
    let err: string = '';
    try {
      lines = await runQuickProbe(quickScan(), {
        studentId: studentId,
        decodeGbk: gbkDecoder,
        transmit: transmit,
        onLine: (line: ProbeLine) => {
          collected.push(line);
          if (onProgress !== undefined) {
            onProgress(collected.slice());
          }
        }
      });
      info('NfcService probe done uid=' + uid + ' steps=' + lines.length);
    } catch (e) {
      err = '读卡中断：' + (e as Error).message;
      warn('NfcService probe fail: ' + JSON.stringify(e));
    } finally {
      try {
        iso.resetConnection();
      } catch (e) {
        warn('NfcService iso.resetConnection fail: ' + JSON.stringify(e));
      }
    }
    return { uid: uid, lines: lines, error: err };
  }

  /**
   * 认证门（SW=6982）的只读研究（#168）。
   *
   * ⚠️ 红线：只发只读白名单命令（SELECT/READ/GET CHALLENGE）。
   * 绝不发 EXTERNAL AUTHENTICATE(82)，不破密钥，不猜门后内容。
   * 目的是判定「这是哪种锁」，把已知/未知写清楚。
   */
  static async probeAuthGate(tagInfo: tag.TagInfo): Promise<AuthGateResult> {
    const uid: string = NfcService.uidHex(tagInfo.uid);
    const steps = gateProbeSteps();
    if (!probeIsReadOnly(steps)) {
      return { uid: uid, report: null, lines: [], error: '探测序列含非只读命令（被拒绝执行）' };
    }
    if (!hasTech(tagInfo.technology, tag.ISO_DEP)) {
      return { uid: uid, report: null, lines: [], error: '这张卡不支持 APDU' };
    }
    let iso: tag.IsoDepTag;
    try {
      iso = tag.getIsoDep(tagInfo);
      iso.connect();
    } catch (e) {
      return { uid: uid, report: null, lines: [], error: '连接卡片失败：' + (e as Error).message };
    }
    const observations: GateObservation[] = [];
    const lines: string[] = [];
    let err: string = '';
    try {
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        const apdu: number[] = step.apdu;
        if (!NfcService.isReadOnlyLocal(apdu)) {
          lines.push(step.label + ' | 被只读闸门拦下，未发出');
          continue;
        }
        let raw: number[];
        try {
          raw = await iso.transmit(apdu);
        } catch (e) {
          err = '第 ' + (i + 1) + ' 步 transmit 失败（可能掉卡）：' + (e as Error).message;
          break;
        }
        const r = NfcService.parseLocal(raw);
        const meaning: string = NfcService.meaningOf(step.label, r);
        const o: GateObservation = {
          label: step.label,
          apdu: NfcService.hexLocal(apdu),
          sw: r.sw,
          swText: r.swText,
          data: NfcService.hexLocal(r.data),
          meaning: meaning
        };
        observations.push(o);
        lines.push(formatObservation(o));
        info('AUTHGATE ' + formatObservation(o));
      }
    } finally {
      try {
        iso.resetConnection();
      } catch (e) {
        warn('NfcService authgate resetConnection fail: ' + JSON.stringify(e));
      }
    }
    const report: GateReport | null = observations.length > 0 ? analyzeGate(observations) : null;
    if (report !== null) {
      lines.push('=== 判定：' + report.conclusion + ' ===');
      lines.push('已知：' + report.known.join('；'));
      lines.push('未知：' + report.unknown.join('；'));
    }
    return { uid: uid, report: report, lines: lines, error: err };
  }

  /** 本地只读判断（与 CardProbeLogic.isReadOnly 同语义，避免 service 再 import 一堆）。 */
  private static isReadOnlyLocal(apdu: number[]): boolean {
    if (apdu.length < 4) {
      return false;
    }
    const cla: number = apdu[0] & 0xff;
    if (cla > 3) {
      return false;
    }
    const ins: number = apdu[1] & 0xff;
    return ins === 0xA4 || ins === 0xB0 || ins === 0xB2 || ins === 0xC0 || ins === 0xCA || ins === 0x84;
  }

  /** 本地状态字解析（简化：只取 SW1SW2 与数据）。 */
  private static parseLocal(raw: number[]): { sw: string; swText: string | null; data: number[] } {
    if (raw.length < 2) {
      return { sw: '', swText: null, data: raw.slice() };
    }
    const sw: string = NfcService.hexLocal([raw[raw.length - 2], raw[raw.length - 1]]).replace(/ /g, '');
    const texts: Record<string, string> = {
      '9000': '成功', '6982': '不满足安全条件（要认证）', '6A82': '找不到文件',
      '6D00': 'INS 不支持', '6A88': '找不到引用数据', '6985': '使用条件不满足',
      '6A81': '不支持该功能', '61': '还有数据', '6C': 'Le 不对'
    };
    let swText: string | null = texts[sw] || null;
    if (swText === null && sw.length >= 2) {
      swText = texts[sw.substring(0, 2)] || null;
    }
    return { sw: sw, swText: swText, data: raw.slice(0, raw.length - 2) };
  }

  /** 每步观察的机制说明（只描述，不猜门后内容）。 */
  private static meaningOf(label: string, r: { sw: string; data: number[] }): string {
    if (label.indexOf('GET CHALLENGE') >= 0) {
      if (r.sw === '9000' && r.data.length > 0) {
        return '返回 ' + r.data.length + ' 字节随机数 + 9000：卡支持质询-应答';
      }
      if (r.sw === '6D00' || r.sw === '6A88' || r.sw === '6985' || r.sw === '6A81') {
        return '回 ' + r.sw + '：该上下文不支持质询';
      }
      return '回 ' + r.sw + '：保持未知';
    }
    if (r.sw === '6982') {
      return '读权限被锁（认证门），非文件不存在';
    }
    if (r.sw === '9000') {
      return '命令成功';
    }
    return '状态 ' + r.sw;
  }

  /** 字节 → 大写 hex（空格分隔）。 */
  private static hexLocal(bytes: number[]): string {
    const out: string[] = [];
    for (let i = 0; i < bytes.length; i++) {
      const n: number = bytes[i] & 0xff;
      out.push((n < 16 ? '0' : '') + n.toString(16).toUpperCase());
    }
    return out.join(' ');
  }

  /** UID 字节 → 大写 hex（空格分隔）。 */
  private static uidHex(uid: number[]): string {
    const out: string[] = [];
    for (let i = 0; i < uid.length; i++) {
      const n: number = uid[i] & 0xff;
      out.push((n < 16 ? '0' : '') + n.toString(16).toUpperCase());
    }
    return out.join(' ');
  }

  /** 停止前台读卡；未启动时静默返回（不抛 3100203）。 */
  static stop(): void {
    if (!NfcService.running) {
      return;
    }
    try {
      if (NfcService.callback !== null) {
        tag.off('readerMode', NfcService.element, NfcService.callback);
      } else {
        tag.off('readerMode', NfcService.element);
      }
      info('NfcService reader stopped');
    } catch (e) {
      warn('NfcService stop fail: ' + JSON.stringify(e));
    }
    NfcService.running = false;
    NfcService.callback = null;
  }

  /** 读一张卡：UID/tech + 可选 NDEF。只读，不 connect IsoDep。 */
  private static async readTag(tagInfo: tag.TagInfo): Promise<NfcScanResult> {
    const like: NfcTagInfoLike = { uid: tagInfo.uid, technology: tagInfo.technology };
    const ndef: string[] = [];
    let ndefError: string = '';
    if (hasTech(tagInfo.technology, tag.NDEF)) {
      try {
        const ntag: tag.NdefTag = tag.getNdef(tagInfo);
        const msg = await ntag.readNdef();
        const records = msg.getNdefRecords();
        for (let i = 0; i < records.length; i++) {
          const r = records[i];
          ndef.push(ndefRecordText(r.tnf, r.rtdType, r.payload));
        }
      } catch (e) {
        ndefError = (e as Error).message;
        warn('NfcService readNdef fail: ' + ndefError);
      }
    }
    const s = summarizeTag(like, ndef);
    info('NfcService scan uid=' + s.uid + ' tech=' + s.techs + ' ndef=' + ndef.length);
    return {
      uid: s.uid,
      techs: techListText(tagInfo.technology),
      apdu: s.apdu,
      classic: s.classic,
      ndef: s.ndef,
      ndefError: ndefError
    };
  }
}
