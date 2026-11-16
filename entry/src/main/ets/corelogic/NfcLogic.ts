/**
 * NFC 诊断的纯逻辑（M16-2，不碰 @kit）。
 *
 * 这里只做三件可单测的事：
 *  1. 能力三态（无能力 / 已关闭 / 可用）；
 *  2. UID / technology 的人话化；
 *  3. NDEF 记录的最小解析（URI / 文本，其它类型给 hex）。
 *
 * ⚠️ 不在这里做 APDU / Mifare 的收发：那是 `NfcService` + 后续 `ProbeRunner` 的事。
 * 也不做写卡、HCE、支付；本模块没有写路径。
 */

import type { NfcTagInfoLike } from './NfcModels.ts';

/** 设备 NFC 能力三态（与 Android `NfcCapability` 同语义）。 */
export type NfcCapability = 'unsupported' | 'disabled' | 'enabled';

/** 由「系统能力是否存在」+「NFC 开关是否打开」得出三态。 */
export function capabilityFrom(hasCore: boolean, isOpen: boolean): NfcCapability {
  if (!hasCore) {
    return 'unsupported';
  }
  return isOpen ? 'enabled' : 'disabled';
}

/** NDEF URI 前缀码表（NFC Forum RTD-URI，0x00~0x23）。 */
const URI_PREFIXES: string[] = [
  '', 'http://www.', 'https://www.', 'http://', 'https://', 'tel:', 'mailto:',
  'ftp://anonymous:anonymous@', 'ftp://ftp.', 'ftps://', 'sftp://', 'smb://',
  'nfs://', 'ftp://', 'dav://', 'news:', 'telnet://', 'imap:', 'rtsp://',
  'urn:', 'pop:', 'sip:', 'sips:', 'tftp:', 'btspp://', 'btl2cap://',
  'btgoep://', 'tcpobex://', 'irdaobex://', 'file://', 'urn:epc:id:',
  'urn:epc:tag:', 'urn:epc:pat:', 'urn:epc:raw:', 'urn:epc:', 'urn:nfc:'
];

/** 单字节 → 两位 hex。 */
function hexByte(v: number): string {
  const n: number = v & 0xff;
  return (n < 16 ? '0' : '') + n.toString(16).toUpperCase();
}

/** 字节数组 → 连续 hex（默认空格分隔）。 */
export function bytesHex(bytes: number[], sep: string = ' '): string {
  const out: string[] = [];
  for (let i = 0; i < bytes.length; i++) {
    out.push(hexByte(bytes[i]));
  }
  return out.join(sep);
}

/** UID → 大写 hex，用空格分隔（4/7 字节都按原样）。 */
export function uidText(uid: number[]): string {
  return bytesHex(uid, ' ');
}

/** ISO 14443 技术编号 → 人话。 */
export function techName(tech: number): string {
  switch (tech) {
    case 1: return 'NfcA';
    case 2: return 'NfcB';
    case 3: return 'IsoDep';
    case 4: return 'NfcF';
    case 5: return 'NfcV';
    case 6: return 'Ndef';
    case 7: return 'NdefFormatable';
    case 8: return 'MifareClassic';
    case 9: return 'MifareUltralight';
    case 10: return 'NfcBarcode';
    default: return 'Tech' + tech;
  }
}

/** technology 数组 → `NfcA / IsoDep / ...`。 */
export function techListText(tech: number[]): string {
  const out: string[] = [];
  for (let i = 0; i < tech.length; i++) {
    out.push(techName(tech[i]));
  }
  return out.join(' / ');
}

/** 是否含指定技术。 */
export function hasTech(tech: number[], id: number): boolean {
  for (let i = 0; i < tech.length; i++) {
    if (tech[i] === id) {
      return true;
    }
  }
  return false;
}

/** 是否 CPU 卡（IsoDep）—— 只有这类才能跑 APDU。 */
export function supportsApdu(tech: number[]): boolean {
  return hasTech(tech, 3);
}

/** 是否 Mifare Classic（读扇区要密钥，不等同于 IsoDep）。 */
export function isMifareClassic(tech: number[]): boolean {
  return hasTech(tech, 8);
}

/** ASCII 字节 → 字符串（非 ASCII 用 `?`，避免把二进制当文本展示）。 */
function asciiOf(bytes: number[], start: number = 0): string {
  let out: string = '';
  for (let i = start; i < bytes.length; i++) {
    const b: number = bytes[i] & 0xff;
    out += b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : '?';
  }
  return out;
}

/** NDEF URI payload：首字节是前缀码，其余是 ASCII URL。 */
export function decodeUriPayload(payload: number[]): string {
  if (payload.length === 0) {
    return '';
  }
  const code: number = payload[0] & 0xff;
  const prefix: string = code < URI_PREFIXES.length ? URI_PREFIXES[code] : '';
  return prefix + asciiOf(payload, 1);
}

/** NDEF 文本 payload：首字节 status（语言码长度），随后 language code，再随后文本。 */
export function decodeTextPayload(payload: number[]): string {
  if (payload.length < 2) {
    return '';
  }
  const status: number = payload[0] & 0xff;
  const langLen: number = status & 0x3f;
  const start: number = 1 + langLen;
  if (start >= payload.length) {
    return '';
  }
  return asciiOf(payload, start);
}

/** 一条 NDEF 记录的最小人话。 */
export function ndefRecordText(tnf: number, rtdType: number[], payload: number[]): string {
  if (tnf === 1 && rtdType.length > 0) {
    if (rtdType[0] === 0x55) {
      return 'URI：' + decodeUriPayload(payload);
    }
    if (rtdType[0] === 0x54) {
      return '文本：' + decodeTextPayload(payload);
    }
  }
  const shown: number[] = payload.length > 64 ? payload.slice(0, 64) : payload;
  return 'TNF ' + tnf + ' / RTD ' + bytesHex(rtdType) + ' / ' + bytesHex(shown) +
    (payload.length > 64 ? ' …' : '');
}

/** 一帧扫描结果的摘要（页面直接用）。 */
export interface NfcReadSummary {
  uid: string;
  techs: string;
  apdu: boolean;
  classic: boolean;
  ndef: string[];
}

/** TagInfo → 页面摘要；NDEF 文本由调用方先读好传入。 */
export function summarizeTag(tag: NfcTagInfoLike, ndefLines: string[]): NfcReadSummary {
  return {
    uid: uidText(tag.uid),
    techs: techListText(tag.technology),
    apdu: supportsApdu(tag.technology),
    classic: isMifareClassic(tag.technology),
    ndef: ndefLines
  };
}
