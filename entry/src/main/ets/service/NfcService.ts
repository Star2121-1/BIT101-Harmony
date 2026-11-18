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
