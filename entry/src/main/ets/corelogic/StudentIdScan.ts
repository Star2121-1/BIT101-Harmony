/**
 * 在卡内字节里找学号的纯逻辑（#152，移植自 Android StudentIdScan.kt）。
 *
 * ## 为什么这件事成立
 * 上游判「NFC 刷校园卡登录不可行」的根因是「卡号 → 学号」映射表只在一卡通中心。
 * 但真卡实测发现**学号就写在卡里**（文件 0016），那层映射根本不需要。
 *
 * ## 真卡实测的关键（第七次探测才找到）
 * 0016 第 2 段偏移 10 起是 ASCII 分段：`31 31 06 32 30 32 34 31 33 04 35 55`
 * = '1''1' + 0x06 + '2''0''2''4''1''3' + 0x04 + '5''5'，
 * 跳过两个 1 字节控制字符拼起来正好 1120241355。
 * ⇒ 连续匹配找不到 ≠ 卡里没有学号，可能是被分隔了。
 *
 * ## 判据收紧（宁可漏也不误报）
 * - 分隔符必须是**恰好 1 字节的控制字符 0x01~0x1F**，不是任意非数字
 *   （0x00/0xFF 补零到处都是，放行必然误报）；
 * - 分段拼起来必须**完全等于**完整学号；
 * - guess（不填学号时猜）只认 ASCII 分段/连续，不猜 BCD（随机二进制滑出几十个假学号）；
 * - guess 出的学号必须标「疑似/未核对」，只有 find 真命中才算确认。
 */

const ASCII_ZERO: number = 0x30;
const ASCII_NINE: number = 0x39;

/** 学号可能的编码形式（BCD / BCD 反序 / ASCII）。 */
export function encodingsOf(studentId: string): Array<{ name: string; bytes: number[] }> {
  const digits: string = studentId.trim();
  if (digits.length === 0 || !/^\d+$/.test(digits)) {
    return [];
  }
  const bcd: number[] | null = bcdOf(digits);
  if (bcd === null) {
    return [];
  }
  const ascii: number[] = [];
  for (let i = 0; i < digits.length; i++) {
    ascii.push(digits.charCodeAt(i));
  }
  return [
    { name: 'BCD', bytes: bcd },
    { name: 'BCD 反序', bytes: bcd.slice().reverse() },
    { name: 'ASCII', bytes: ascii }
  ];
}

/** 在 data 里找学号，命中返回「编码形式 + 偏移」说明，找不到返回 null。 */
export function find(data: number[], studentId: string): string | null {
  if (data.length === 0) {
    return null;
  }
  const contiguous: string | null = findContiguous(data, studentId);
  if (contiguous !== null) {
    return contiguous;
  }
  return findSegmented(data, studentId);
}

function findContiguous(data: number[], studentId: string): string | null {
  const forms = encodingsOf(studentId);
  for (let i = 0; i < forms.length; i++) {
    const at: number = indexOf(data, forms[i].bytes);
    if (at >= 0) {
      return forms[i].name + ' 形式，偏移 ' + at;
    }
  }
  return null;
}

function findSegmented(data: number[], studentId: string): string | null {
  const digits: string = studentId.trim();
  if (digits.length < 6 || !/^\d+$/.test(digits)) {
    return null;
  }
  const maxSegments: number = digits.length; // 上限=位数，别拍常数（真卡 3 段，10 位）
  for (let i = 0; i < data.length; i++) {
    const seg = segmentationAt(data, i, maxSegments);
    if (seg === null || seg.parts.length < 2) {
      continue;
    }
    if (seg.parts.join('') === digits) {
      return '分段形式（' + seg.parts.length + ' 段，' + seg.separatorText + '），偏移 ' + i;
    }
  }
  return null;
}

interface Segmentation {
  parts: string[];
  separators: number;
  separatorText: string;
}

/** 从 from 处按「数字段 + 单字节控制字符分隔」切分（find 与 guess 共用唯一实现）。 */
function segmentationAt(data: number[], from: number, maxSegments: number): Segmentation | null {
  const parts: string[] = [];
  let current: string = '';
  let separators: number = 0;
  let at: number = from;
  while (at < data.length && parts.length < maxSegments) {
    const b: number = data[at] & 0xff;
    if (b >= ASCII_ZERO && b <= ASCII_NINE) {
      current += String.fromCharCode(b);
      at++;
      continue;
    }
    const nextIsDigit: boolean = at + 1 < data.length &&
      ((data[at + 1] & 0xff) >= ASCII_ZERO && (data[at + 1] & 0xff) <= ASCII_NINE);
    if (current.length > 0 && nextIsDigit && isSeparator(b)) {
      parts.push(current);
      current = '';
      separators++;
      at++;
      continue;
    }
    break;
  }
  if (current.length > 0) {
    parts.push(current);
  }
  if (parts.length === 0) {
    return null;
  }
  return {
    parts: parts,
    separators: separators,
    separatorText: separators === 1 ? '1 个分隔符' : separators + ' 个分隔符'
  };
}

/** 分隔符只认 1 字节控制字符 0x01~0x1F（真卡是 0x06 与 0x04）。 */
function isSeparator(b: number): boolean {
  return b >= 0x01 && b <= 0x1F;
}

/** guess 的结果：学号数字 + 认出来的依据（必标「疑似」）。 */
export interface Guess {
  value: string;
  note: string;
}

const MIN_LEN: number = 8;
const MAX_LEN: number = 12;
const MIN_YEAR: number = 2000;
const MAX_YEAR: number = 2039;

/**
 * 不填学号，直接从卡里认（分段优先、连续次之）。
 * ⚠️ 返回的一律是「疑似/未核对」，只有 find 真命中才算确认。
 */
export function guess(data: number[]): Guess | null {
  if (data.length === 0) {
    return null;
  }
  return guessSegmented(data) || guessContiguous(data);
}

function guessSegmented(data: number[]): Guess | null {
  for (let i = 0; i < data.length; i++) {
    const seg = segmentationAt(data, i, MAX_LEN);
    if (seg === null || seg.parts.length < 2) {
      continue;
    }
    const digits: string = seg.parts.join('');
    if (!looksLikeStudentId(digits)) {
      continue;
    }
    return {
      value: digits,
      note: '分段形式（' + seg.parts.length + ' 段，' + seg.separatorText + '），偏移 ' + i
    };
  }
  return null;
}

function guessContiguous(data: number[]): Guess | null {
  let i: number = 0;
  while (i < data.length) {
    if (!isAsciiDigit(data[i])) {
      i++;
      continue;
    }
    let j: number = i;
    while (j < data.length && isAsciiDigit(data[j])) {
      j++;
    }
    const length: number = j - i;
    if (length >= MIN_LEN && length <= MAX_LEN) {
      const digits: string = bytesAscii(data, i, length);
      if (looksLikeStudentId(digits)) {
        return { value: digits, note: '连续 ASCII 数字，偏移 ' + i };
      }
    }
    i = j;
  }
  return null;
}

/** 像不像学号：8~12 位、首位非 0、靠前 0~5 位含 2000~2039 的入学年份。 */
function looksLikeStudentId(digits: string): boolean {
  if (digits.length < MIN_LEN || digits.length > MAX_LEN || digits[0] === '0') {
    return false;
  }
  const lastStart: number = Math.min(5, digits.length - 4);
  for (let i = 0; i <= lastStart; i++) {
    const year: number = parseInt(digits.substring(i, i + 4), 10);
    if (!isNaN(year) && year >= MIN_YEAR && year <= MAX_YEAR) {
      return true;
    }
  }
  return false;
}

function isAsciiDigit(b: number): boolean {
  const v: number = b & 0xff;
  return v >= ASCII_ZERO && v <= ASCII_NINE;
}

function bytesAscii(bytes: number[], start: number, length: number): string {
  let out: string = '';
  for (let i = start; i < start + length; i++) {
    out += String.fromCharCode(bytes[i] & 0xff);
  }
  return out;
}

/** 奇数位末尾补 0（卡里高位在前，补错位置就永远匹配不上）。 */
function bcdOf(digits: string): number[] | null {
  const padded: string = digits.length % 2 === 0 ? digits : digits + '0';
  const out: number[] = [];
  for (let i = 0; i < padded.length; i += 2) {
    const hi: number = parseInt(padded[i], 10);
    const lo: number = parseInt(padded[i + 1], 10);
    if (isNaN(hi) || isNaN(lo)) {
      return null;
    }
    out.push(hi * 16 + lo);
  }
  return out;
}

function indexOf(data: number[], needle: number[]): number {
  if (needle.length === 0 || needle.length > data.length) {
    return -1;
  }
  for (let i = 0; i <= data.length - needle.length; i++) {
    let same: boolean = true;
    for (let j = 0; j < needle.length; j++) {
      if (data[i + j] !== needle[j]) {
        same = false;
        break;
      }
    }
    if (same) {
      return i;
    }
  }
  return -1;
}
