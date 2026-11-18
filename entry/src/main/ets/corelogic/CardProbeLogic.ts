/**
 * CPU 校园卡 APDU 探测的**纯逻辑**（M16-3 / #152，不碰 @kit）。
 *
 * 1:1 移植自 BIT101-seat/features/nfc/.../logic/CardProbeLogic.kt，
 * 那里每一条结论都来自真卡实测（北理工校园卡，UID 77 75 F0 7B）。
 * 关键实测结论（改代码前先读）：
 *  - 走 PSE `1PAY.SYS.DDF01`（接触式目录），不是 PPSE `2PAY…`（后者回 6A82）；
 *  - READ BINARY 的 P1 = 0x80 | SFI，P2 才是偏移（与 READ RECORD 的 P2=(SFI<<3)|4 不同）；
 *  - 卡回 6Cxx 是「Le 写错了，按 xx 重发」；61xx 是「还有数据，发 GET RESPONSE」；
 *  - 6981 = 定长记录文件，改发 READ RECORD；6986 = 选中了目录，不是文件；
 *  - 业务数据（姓名/学号）落在 FID 0010~001B，0016 是姓名+学号（GBK/ASCII 分段）；
 *  - quickScan 只扫 0001~001F，够用即止；扫不到要提示开深度扫描，不能静默给空。
 *
 * ## 只读纪律（与 Android 同源）
 * 校园卡是别人的资产。本模块**只有读指令白名单**，没有任何写命令构造入口；
 * 每次 transmit 前还要过 isReadOnly 闸门（见 NfcService 的 send）。
 *
 * ## 无 @kit
 * GBK 解码通过 decodeGbk 注入（NfcService 传 util.TextDecoder('gbk')），
 * 这样本文件可在 Node 单测里跑，不需要鸿蒙运行时。
 */

/** 允许发出的 ISO 7816-4 指令（INS 字节）：白名单而非黑名单。 */
export const READ_ONLY_INS: number[] = [
  0xA4, // SELECT
  0xB0, // READ BINARY
  0xB2, // READ RECORD
  0xC0, // GET RESPONSE
  0xCA, // GET DATA
  0x84, // GET CHALLENGE
];

/** PPSE 应用名 `2PAY.SYS.DDF01`（非接触式目录，真卡回 6A82，作对照）。 */
export const PPSE_AID: string = '325041592E5359532E4444463031';
/** PSE 应用名 `1PAY.SYS.DDF01`（接触式目录，真卡实测走这条）。 */
export const PSE_AID: string = '315041592E5359532E4444463031';

/** GBK 解码器签名：输入字节，输出字符串；解不出由调用方判空。 */
export type GbkDecoder = (bytes: number[]) => string;

/** 单字节转无符号。 */
function u8(v: number): number {
  return v & 0xff;
}

/** 两位大写 hex。 */
export function hexByte(v: number): string {
  const n: number = u8(v);
  return (n < 16 ? '0' : '') + n.toString(16).toUpperCase();
}

/** 字节 → 空格分隔 hex。 */
export function toHex(bytes: number[]): string {
  const out: string[] = [];
  for (let i = 0; i < bytes.length; i++) {
    out.push(hexByte(bytes[i]));
  }
  return out.join(' ');
}

/** 字节 → 紧凑 hex。 */
export function toHexCompact(bytes: number[]): string {
  return toHex(bytes).replace(/ /g, '');
}

/** 十六进制串 → 字节；长度必须偶数且字符合法，否则返回 null（早失败好过静默错位）。 */
export function parseHex(hex: string): number[] | null {
  const clean: string = hex.replace(/ /g, '').toUpperCase();
  if (clean.length % 2 !== 0) {
    return null;
  }
  if (!/^[0-9A-F]*$/.test(clean)) {
    return null;
  }
  const out: number[] = [];
  for (let i = 0; i < clean.length; i += 2) {
    out.push(parseInt(clean.substring(i, i + 2), 16));
  }
  return out;
}

/**
 * 发出前的总闸门：不是白名单 INS、或 CLA 不在 0~3，一律不许发。
 * 带安全报文标记的 CLA 语义完全不同，宁可不放行。
 */
export function isReadOnly(apdu: number[]): boolean {
  if (apdu.length < 4) {
    return false;
  }
  const cla: number = u8(apdu[0]);
  if (cla < 0 || cla > 3) {
    return false;
  }
  return READ_ONLY_INS.indexOf(u8(apdu[1])) >= 0;
}

/** SELECT by DF name（AID）：00 A4 04 00 Lc <AID> 00。 */
export function selectByName(aidHex: string): number[] {
  const aid: number[] | null = parseHex(aidHex);
  if (aid === null || aid.length < 5 || aid.length > 16) {
    return [];
  }
  const out: number[] = [0x00, 0xA4, 0x04, 0x00, aid.length];
  for (let i = 0; i < aid.length; i++) {
    out.push(aid[i]);
  }
  out.push(0x00);
  return out;
}

/** SELECT MF：`00 A4 00 00 02 3F 00`，确认通道通不通。 */
export function selectMasterFile(): number[] {
  return [0x00, 0xA4, 0x00, 0x00, 0x02, 0x3F, 0x00];
}

/** SELECT PSE（真卡走这条）。 */
export function selectPse(): number[] {
  return selectByName(PSE_AID);
}

/** SELECT PPSE（对照，真卡回 6A82）。 */
export function selectPpse(): number[] {
  return selectByName(PPSE_AID);
}

/**
 * READ BINARY（带 SFI）：00 B0 (0x80|SFI) offset length。
 * ⚠️ P1 编码踩过坑：不是 (SFI<<3)|4（那是 READ RECORD 的 P2），真卡按错的写全回 6A82。
 */
export function readBinary(sfi: number, offset: number = 0, length: number = 32): number[] {
  if (sfi < 1 || sfi > 30 || offset < 0 || offset > 255 || length < 1 || length > 256) {
    return [];
  }
  const le: number = length === 256 ? 0 : length;
  return [0x00, 0xB0, 0x80 | sfi, offset, le];
}

/**
 * READ BINARY（不带 SFI）：00 B0 <offset高> <offset低> <length>。
 * ⚠️ 偏移量是 16 位拆两个字节，不是塞进 P1——踩过一次「读第 2 段实为 offset 8192」的坑。
 */
export function readBinaryPlain(offset: number = 0, length: number = 32): number[] {
  if (offset < 0 || offset > 0x7FFF || length < 1 || length > 256) {
    return [];
  }
  const le: number = length === 256 ? 0 : length;
  return [0x00, 0xB0, (offset >>> 8) & 0xff, offset & 0xff, le];
}

/** READ RECORD（当前已选中的 EF）：00 B2 record 04 length。 */
export function readRecordCurrentEf(record: number, length: number = 0): number[] {
  if (record < 1 || record > 254 || length < 0 || length > 256) {
    return [];
  }
  const le: number = length === 256 ? 0 : length;
  return [0x00, 0xB2, record, 0x04, le];
}

/** SELECT by FID：00 A4 02 00 02 <fid高> <fid低>。 */
export function selectByFileId(fid: number): number[] {
  if (fid < 0 || fid > 0xFFFF) {
    return [];
  }
  return [0x00, 0xA4, 0x02, 0x00, 0x02, (fid >>> 8) & 0xff, fid & 0xff];
}

/** GET RESPONSE：00 C0 00 00 length。 */
export function getResponse(length: number): number[] {
  if (length < 1 || length > 256) {
    return [];
  }
  const le: number = length === 256 ? 0 : length;
  return [0x00, 0xC0, 0x00, 0x00, le];
}

/**
 * 把读指令末尾的 Le 换成 n（回 6Cxx 时按卡说的重发）。
 * 只允许 B0/B2/C0 —— SELECT 末尾那个字节是 FID 的一部分，换掉就选错文件了。
 */
export function withLe(apdu: number[], length: number): number[] {
  if (length < 1 || length > 256 || apdu.length < 5) {
    return [];
  }
  const ins: number = u8(apdu[1]);
  if (ins !== 0xB0 && ins !== 0xB2 && ins !== 0xC0) {
    return [];
  }
  const out: number[] = apdu.slice();
  out[out.length - 1] = length === 256 ? 0 : length;
  return out;
}

/** 一条探测步骤：给人看的 label + 待发 apdu + 成功后连着发的后续。 */
export interface ProbeStep {
  label: string;
  apdu: number[];
  followUp?: number[];
  followUpLabel?: string;
  followUpMore?: number[];
  fid?: number;
  sfi?: number;
}

/**
 * 快速读：先回 MF 钉死上下文，再挨个 SELECT 0001~001F，命中读两段。
 * 真卡上有数据的文件全在 0010~001B，两头留余量。段数=2 就够（0016 学号在第 2 段）。
 */
export function quickScan(from: number = 0x0001, to: number = 0x001F): ProbeStep[] {
  const steps: ProbeStep[] = [{ label: 'SELECT 主文件 3F00（快速读起点）', apdu: selectMasterFile() }];
  for (let fid = from; fid <= to; fid++) {
    steps.push({
      label: 'SELECT 文件 ' + hexByte((fid >>> 8) & 0xff) + hexByte(fid & 0xff),
      apdu: selectByFileId(fid),
      followUp: readBinaryPlain(),
      followUpLabel: 'READ 文件 ' + hexByte((fid >>> 8) & 0xff) + hexByte(fid & 0xff) + ' 前 32 字节',
      followUpMore: readBinaryPlain(0x20),
      fid: fid
    });
  }
  return steps;
}

/** transceive 回答的解析结果。 */
export interface ProbeResult {
  sw: string;
  swText: string | null;
  data: number[];
  success: boolean;
  hasMore: boolean;
  /** 卡回 6Cxx：Le 写错了，正确值是 xx（00 按规范代表 256）。 */
  correctLe: number | null;
}

/** 状态字解释；认不出返回 null（UI 显示「未知状态 XXXX」，不自作主张解释成成功）。 */
export function statusText(sw: string): string | null {
  switch (sw) {
    case '9000': return '成功';
    case '6283': return '文件已失效（被停用，数据还在）';
    case '6A81': return '不支持该功能';
    case '6A82': return '找不到这个文件/应用';
    case '6A83': return '记录没找到';
    case '6A84': return '空间不足';
    case '6A86': return 'P1/P2 参数不对';
    case '6A87': return 'Lc 与指令长度不符';
    case '6A88': return '找不到引用数据';
    case '6D00': return '指令（INS）不支持';
    case '6E00': return '类别（CLA）不支持';
    case '6F00': return '未指明的错误';
    case '6981': return '命令与文件结构不兼容（多半要改用 READ RECORD）';
    case '6986': return '当前文件不允许这条命令（选中的多半是目录）';
    case '6982': return '不满足安全条件（要认证/要密钥）';
    case '6983': return '已被锁定（别再试了）';
    case '6985': return '使用条件不满足';
    case '6700': return '长度不对';
    case '6B00': return '偏移量超界（多半已读到文件末尾）';
    default: return null;
  }
}

/** 61xx 里的「还有多少字节」；00 按规范代表 256。 */
export function remainingOf(sw: string): number | null {
  if (!sw.startsWith('61') || sw.length !== 4) {
    return null;
  }
  const n: number = parseInt(sw.substring(2), 16);
  if (isNaN(n)) {
    return null;
  }
  return n === 0 ? 256 : n;
}

/** 解析 transceive 回答；短于 2 字节标失败并把原文留给上层，不猜不补零。 */
export function parseResponse(bytes: number[]): ProbeResult {
  if (bytes.length < 2) {
    return { sw: '', swText: null, data: bytes.slice(), success: false, hasMore: false, correctLe: null };
  }
  const sw: string = hexByte(bytes[bytes.length - 2]) + hexByte(bytes[bytes.length - 1]);
  const data: number[] = bytes.slice(0, bytes.length - 2);
  let correctLe: number | null = null;
  if (sw.startsWith('6C')) {
    const n: number = parseInt(sw.substring(2), 16);
    correctLe = isNaN(n) ? null : (n === 0 ? 256 : n);
  }
  return {
    sw: sw,
    swText: statusText(sw),
    data: data,
    success: sw === '9000',
    hasMore: sw.startsWith('61'),
    correctLe: correctLe
  };
}

/** 6981 → 文件在但命令用错，要换 READ RECORD（6986 不算——那是目录）。 */
export function shouldTryRecords(sw: string): boolean {
  return sw === '6981';
}

/** 6986 → 选中的多半是目录，要进去再扫一层。 */
export function looksLikeDirectory(sw: string): boolean {
  return sw === '6986';
}

/**
 * 把一段数据当 GBK 文本读：trim 首尾 0x00，用注入的 decoder 解，
 * 有不可打印字符（<0x20 或 U+FFFD）就返回 null（宁可只显示 hex，也不端乱码）。
 */
export function decodeGbkText(bytes: number[], decoder: GbkDecoder): string | null {
  let from: number = 0;
  let to: number = bytes.length;
  while (from < to && bytes[from] === 0) {
    from++;
  }
  while (to > from && bytes[to - 1] === 0) {
    to--;
  }
  if (from === to) {
    return null;
  }
  const trimmed: number[] = bytes.slice(from, to);
  let decoded: string = '';
  try {
    decoded = decoder(trimmed);
  } catch (e) {
    return null;
  }
  if (decoded.length === 0) {
    return null;
  }
  for (let i = 0; i < decoded.length; i++) {
    const code: number = decoded.charCodeAt(i);
    if (code < 0x20 || code === 0xFFFD) {
      return null;
    }
  }
  return decoded.trim();
}

/** 一个 BER-TLV 条目。 */
export interface Tlv {
  tag: string;
  value: number[];
  constructed: boolean;
}

/** 解析 ISO 7816-4 BER-TLV；构造型递归（实测 `6F...A5 03 88 01 01` 不递归就漏掉 SFI）。 */
export function parseTlvs(bytes: number[]): Tlv[] {
  const out: Tlv[] = [];
  walkTlv(bytes, 0, bytes.length, out, 0);
  return out;
}

function walkTlv(bytes: number[], from: number, to: number, out: Tlv[], depth: number): void {
  if (depth > 6) {
    return;
  }
  let i: number = from;
  while (i + 1 < to) {
    const first: number = u8(bytes[i]);
    let tag: string = '';
    if ((first & 0x1F) === 0x1F && i + 1 < to) {
      tag = hexByte(first) + hexByte(bytes[i + 1]);
      i += 2;
    } else {
      tag = hexByte(first);
      i += 1;
    }
    if (i >= to) {
      return;
    }
    let len: number = u8(bytes[i]);
    i += 1;
    if (len >= 0x80) {
      const n: number = len - 0x80;
      if (n < 1 || n > 3 || i + n > to) {
        return;
      }
      len = 0;
      for (let k = 0; k < n; k++) {
        len = (len << 8) + u8(bytes[i + k]);
      }
      i += n;
    }
    if (len < 0 || i + len > to) {
      return;
    }
    const constructed: boolean = (first & 0x20) !== 0;
    out.push({ tag: tag, value: bytes.slice(i, i + len), constructed: constructed });
    if (constructed) {
      walkTlv(bytes, i, i + len, out, depth + 1);
    }
    i += len;
  }
}

/** 从 TLV 里挑 ADF 名（tag 4F，5~16 字节），去重。 */
export function aidsOf(tlvs: Tlv[]): number[][] {
  const out: number[][] = [];
  const seen: string[] = [];
  for (let i = 0; i < tlvs.length; i++) {
    const t: Tlv = tlvs[i];
    if (t.tag === '4F' && t.value.length >= 5 && t.value.length <= 16) {
      const key: string = toHexCompact(t.value);
      if (seen.indexOf(key) < 0) {
        seen.push(key);
        out.push(t.value);
      }
    }
  }
  return out;
}
