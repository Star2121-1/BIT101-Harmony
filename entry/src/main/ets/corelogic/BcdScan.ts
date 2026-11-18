/**
 * 在卡内裸字节里找**疑似 BCD 日期时间**（#152，移植自 Android BcdScan.kt）。
 *
 * 真卡 0018 交易记录里有 `20 26 03 22 11 08 43` = BCD 的 2026-03-22 11:08:43。
 * 三重收紧，宁可漏也不误报：①年份窗口 2020~2035；②重叠只留四字节那条；
 * ③时间只作日期后缀且 00:00:00 不附（那是空位不是时间）。
 * 界面展示必须带「疑似」二字。
 */

export interface BcdFound {
  at: number;
  length: number;
  text: string;
  display: string;
}

const DEFAULT_MIN_YEAR: number = 2020;
const DEFAULT_MAX_YEAR: number = 2035;

/** 扫一遍字节，按偏移升序返回所有疑似日期；没有返回空列表（不是 null）。 */
export function scan(bytes: number[], minYear: number = DEFAULT_MIN_YEAR,
  maxYear: number = DEFAULT_MAX_YEAR): BcdFound[] {
  const out: BcdFound[] = [];
  // ① 四字节 YYYYMMDD（首字节世纪 19/20）
  for (let i = 0; i <= bytes.length - 4; i++) {
    const day: string | null = date4(bytes, i, minYear, maxYear);
    if (day === null) {
      continue;
    }
    const text: string = day + timeSuffix(bytes, i + 4);
    out.push({ at: i, length: 4, text: text, display: '偏移 ' + i + '：' + text });
  }
  // ② 三字节 YYMMDD（隐含 20xx），与①重叠的跳过（同一天的另一种读法）
  for (let i = 0; i <= bytes.length - 3; i++) {
    let overlaps: boolean = false;
    for (let k = 0; k < out.length; k++) {
      if (i < out[k].at + out[k].length && out[k].at < i + 3) {
        overlaps = true;
        break;
      }
    }
    if (overlaps) {
      continue;
    }
    const day: string | null = date3(bytes, i, minYear, maxYear);
    if (day === null) {
      continue;
    }
    const text: string = day + timeSuffix(bytes, i + 3);
    out.push({ at: i, length: 3, text: text, display: '偏移 ' + i + '：' + text });
  }
  out.sort((a, b) => a.at - b.at);
  return out;
}

function timeSuffix(bytes: number[], at: number): string {
  const t: string | null = time3(bytes, at);
  return t === null ? '' : ' ' + t;
}

function time3(bytes: number[], at: number): string | null {
  const h: number | null = bcd(bytes, at);
  const m: number | null = bcd(bytes, at + 1);
  const s: number | null = bcd(bytes, at + 2);
  if (h === null || m === null || s === null) {
    return null;
  }
  if (h > 23 || m > 59 || s > 59) {
    return null;
  }
  if (h === 0 && m === 0 && s === 0) {
    return null;
  }
  return pad2(h) + ':' + pad2(m) + ':' + pad2(s);
}

function date4(bytes: number[], at: number, minYear: number, maxYear: number): string | null {
  const century: number | null = bcd(bytes, at);
  if (century === null || (century !== 19 && century !== 20)) {
    return null;
  }
  const yy: number | null = bcd(bytes, at + 1);
  const mm: number | null = bcd(bytes, at + 2);
  const dd: number | null = bcd(bytes, at + 3);
  if (yy === null || mm === null || dd === null) {
    return null;
  }
  return format(century * 100 + yy, mm, dd, minYear, maxYear);
}

function date3(bytes: number[], at: number, minYear: number, maxYear: number): string | null {
  const yy: number | null = bcd(bytes, at);
  const mm: number | null = bcd(bytes, at + 1);
  const dd: number | null = bcd(bytes, at + 2);
  if (yy === null || mm === null || dd === null) {
    return null;
  }
  return format(2000 + yy, mm, dd, minYear, maxYear);
}

function format(year: number, month: number, day: number, minYear: number, maxYear: number): string | null {
  if (year < minYear || year > maxYear || month < 1 || month > 12) {
    return null;
  }
  if (day < 1 || day > daysIn(year, month)) {
    return null;
  }
  return year.toString() + '-' + pad2(month) + '-' + pad2(day);
}

/** 二月按闰年算，否则 2028-02-29 会被当噪声丢掉。 */
function daysIn(year: number, month: number): number {
  if (month === 2) {
    return (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)) ? 29 : 28;
  }
  return (month === 4 || month === 6 || month === 9 || month === 11) ? 30 : 31;
}

/** 取一个字节的 BCD 值；任一半字节 >9 返回 null（挡掉长度/标志位/ASCII）。 */
function bcd(bytes: number[], at: number): number | null {
  if (at < 0 || at >= bytes.length) {
    return null;
  }
  const v: number = bytes[at] & 0xff;
  const hi: number = v >>> 4;
  const lo: number = v & 0x0F;
  if (hi > 9 || lo > 9) {
    return null;
  }
  return hi * 10 + lo;
}

function pad2(n: number): string {
  return (n < 10 ? '0' : '') + n.toString();
}
