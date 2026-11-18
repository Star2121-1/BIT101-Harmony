/**
 * 深度只读扫描（#170）：把校园卡 CPU 侧**不设防区域**的字节全 dump 出来。
 *
 * 与 quickScan（只扫 0001~001F、每文件 2 段）的区别：
 *  - FID 扫 full 0000~00FF（不是只低区）；
 *  - 命中文件逐段读到 6B00（文件末尾），不是固定 2 段；
 *  - 回 6986 的目录下钻一层（0010 内 SFI 1~30 + FID 0000~0020）；
 *  - 回 6981 的定长记录文件改读记录（当前 EF + SFI 两种寻址都试）；
 *  - 回 6982 的认证门**记录后跳过**（红线：不认证、不猜门后）。
 *
 * ## 只读纪律
 * 全部命令走 CardProbeLogic 的构造函数，发出前过 isReadOnly 闸门；
 * 白名单之外（尤其 EXTERNAL AUTHENTICATE 82）永远不构造、不发送。
 *
 * ## 无 @kit
 * transmit / GBK decoder 全部注入，本模块可在 Node 单测里跑。
 */

import { parseResponse, remainingOf, shouldTryRecords, looksLikeDirectory,
  getResponse, withLe, readRecordCurrentEf, isReadOnly, toHex } from './CardProbeLogic.ts';
import type { ProbeResult } from './CardProbeLogic.ts';

/** 一条 dump 流水。 */
export interface DumpLine {
  /** 上下文：MF / DF:0010 等。 */
  context: string;
  /** 目标：FID 0016 / SFI 5 等。 */
  target: string;
  /** 操作：SELECT / READ BINARY / READ RECORD / GET RESPONSE。 */
  op: string;
  /** 发出的 APDU（hex）。 */
  apdu: string;
  /** 状态字。 */
  sw: string;
  /** 状态字解释（认不出为 null）。 */
  swText: string | null;
  /** 返回数据（hex）。 */
  data: string;
  /** 简短备注（全零/认证门/文件末尾等）。 */
  note: string;
  /** 是否全零数据段。 */
  allZero: boolean;
}

/** 深度扫描配置（注入）。 */
export interface DeepConfig {
  transmit: (apdu: number[]) => Promise<number[]>;
  /** 每条流水回调（边收边显示；掉卡保留已得）。 */
  onLine?: (line: DumpLine) => void;
  /** FID 扫描上限，默认 0x00FF；单测可收窄。 */
  fidTo?: number;
  /** 目录下钻时 SFI 上限，默认 30；单测可收窄。 */
  sfiTo?: number;
}

/** 发一条并自动跟 6Cxx/61xx（最多 3 轮），全部过闸门。 */
async function exchange(tx: (apdu: number[]) => Promise<number[]>,
  apdu: number[]): Promise<{ result: ProbeResult; note: string }> {
  if (!isReadOnly(apdu)) {
    return { result: { sw: '', swText: '被只读闸门拦下', data: [], success: false,
      hasMore: false, correctLe: null }, note: '非只读命令，未发出' };
  }
  let raw: number[];
  try {
    raw = await tx(apdu);
  } catch (e) {
    return { result: { sw: '', swText: 'transmit 失败（可能掉卡）', data: [], success: false,
      hasMore: false, correctLe: null }, note: '断连' };
  }
  let result: ProbeResult = parseResponse(raw);
  let note: string = '';
  let current: number[] = apdu;
  for (let guard = 0; guard < 3; guard++) {
    let next: number[] | null = null;
    if (result.hasMore) {
      const n: number | null = remainingOf(result.sw);
      if (n === null) {
        break;
      }
      note += (note ? '；' : '') + '61xx 取剩余 ' + n + ' 字节';
      next = getResponse(n);
    } else if (result.correctLe !== null) {
      note += (note ? '；' : '') + '6Cxx 按 Le=' + result.correctLe + ' 重发';
      next = withLe(current, result.correctLe);
    } else {
      break;
    }
    if (next.length === 0 || !isReadOnly(next)) {
      break;
    }
    current = next;
    try {
      raw = await tx(current);
    } catch (e) {
      note += '；跟进 transmit 失败';
      break;
    }
    result = parseResponse(raw);
  }
  return { result: result, note: note };
}

/** 字节是否全零。 */
export function isAllZero(bytes: number[]): boolean {
  for (let i = 0; i < bytes.length; i++) {
    if ((bytes[i] & 0xff) !== 0) {
      return false;
    }
  }
  return true;
}

/** 把一次回答包装成 DumpLine。 */
function line(context: string, target: string, op: string, apdu: number[],
  r: ProbeResult, note: string): DumpLine {
  return {
    context: context,
    target: target,
    op: op,
    apdu: toHex(apdu),
    sw: r.sw,
    swText: r.swText,
    data: toHex(r.data),
    note: note,
    allZero: r.data.length > 0 && isAllZero(r.data)
  };
}

/** APDU 的 INS → 操作名（给人看）。 */
function opName(apdu: number[]): string {
  if (apdu.length < 2) {
    return '?';
  }
  const ins: number = apdu[1] & 0xff;
  if (ins === 0xA4) {
    return 'SELECT';
  }
  if (ins === 0xB0) {
    return 'READ BINARY';
  }
  if (ins === 0xB2) {
    return 'READ RECORD';
  }
  if (ins === 0xC0) {
    return 'GET RESPONSE';
  }
  if (ins === 0x84) {
    return 'GET CHALLENGE';
  }
  return 'INS ' + ins.toString(16).toUpperCase();
}

/**
 * 跑深度扫描。边跑边回调，掉卡时已收到的流水保留。
 *
 * @returns 完整流水；顶层 error 由调用方根据最后一条 sw 判断（本函数不抛 transmit 异常）。
 */
export async function runDeepScan(config: DeepConfig): Promise<DumpLine[]> {
  const out: DumpLine[] = [];
  const fidTo: number = config.fidTo === undefined ? 0x00FF : config.fidTo;
  const sfiTo: number = config.sfiTo === undefined ? 30 : config.sfiTo;
  /** 连续 transmit 失败（sw 为空）计数；掉卡后及时熔断，不再空发几十条。 */
  const state: { fail: number; blown: boolean } = { fail: 0, blown: false };
  const MAX_FAIL: number = 3;
  const push = (l: DumpLine): void => {
    out.push(l);
    if (l.sw === '') {
      state.fail++;
    } else {
      state.fail = 0;
    }
    if (state.fail >= MAX_FAIL) {
      state.blown = true;
    }
    if (config.onLine !== undefined) {
      config.onLine(l);
    }
  };
  const tx: (apdu: number[]) => Promise<number[]> = config.transmit;

  // ① 回 MF，钉死上下文
  const mfApdu: number[] = [0x00, 0xA4, 0x00, 0x00, 0x02, 0x3F, 0x00];
  const mf = await exchange(tx, mfApdu);
  push(line('MF', 'MF', 'SELECT', mfApdu, mf.result,
    mf.result.sw === '9000' ? '回到主文件' : '回 MF 失败，后续结果可能不准'));

  // ② MF 下逐 FID 扫
  for (let fid = 0; fid <= fidTo && !state.blown; fid++) {
    const fidHex: string = hex4(fid);
    const target: string = 'FID ' + fidHex;
    const selApdu: number[] = [0x00, 0xA4, 0x02, 0x00, 0x02, (fid >>> 8) & 0xff, fid & 0xff];
    const sel = await exchange(tx, selApdu);
    push(line('MF', target, 'SELECT', selApdu, sel.result, sel.note));
    if (sel.result.sw !== '9000') {
      continue; // 6A82 = 文件不存在，跳过
    }

    // 选中成功：先读第 1 段，按状态分流
    const rd0Apdu: number[] = [0x00, 0xB0, 0x00, 0x00, 0x20];
    const rd0 = await exchange(tx, rd0Apdu);
    push(line('MF', target, 'READ BINARY', rd0Apdu, rd0.result, rd0.note));

    if (looksLikeDirectory(rd0.result.sw)) {
      // 6986：目录，下钻一层
      await drillDown(out, push, tx, fid, target, sfiTo, state);
      continue;
    }
    if (rd0.result.sw === '6982') {
      // 认证门：记录后跳过（红线）
      push(line('MF', target, '(跳过)', [], { sw: '6982', swText: '认证门', data: [],
        success: false, hasMore: false, correctLe: null }, '认证门：不认证、不猜门后'));
      continue;
    }
    if (shouldTryRecords(rd0.result.sw)) {
      await readRecords(out, push, tx, 'MF', target, 3, state);
      continue;
    }
    if (rd0.result.sw === '9000' && rd0.result.data.length > 0 && !isAllZero(rd0.result.data)) {
      // 普通文件：逐段读到 6B00 / 全零 / 非 9000
      await readMoreSegments(out, push, tx, 'MF', target, 0x20, state);
    }
  }
  return out;
}

/** 逐段读（offset 从 start 起，每段 32 字节），直到文件末尾。 */
async function readMoreSegments(out: DumpLine[], push: (l: DumpLine) => void,
  tx: (apdu: number[]) => Promise<number[]>, context: string, target: string,
  start: number, state: { fail: number; blown: boolean }): Promise<void> {
  let zeroRun: number = 0;
  for (let offset = start; offset <= 0x7F && !state.blown; offset += 0x20) {
    const apdu: number[] = [0x00, 0xB0, (offset >>> 8) & 0xff, offset & 0xff, 0x20];
    const ex = await exchange(tx, apdu);
    const l: DumpLine = line(context, target, 'READ BINARY', apdu, ex.result, ex.note);
    push(l);
    if (ex.result.sw === '6B00') {
      l.note = (l.note ? l.note + '；' : '') + '文件末尾';
      return;
    }
    if (shouldTryRecords(ex.result.sw)) {
      await readRecords(out, push, tx, context, target, 3, state);
      return;
    }
    if (ex.result.sw !== '9000') {
      return;
    }
    if (l.allZero) {
      zeroRun++;
      // 连续 2 段全零：多半是填充，再读一段确认 6B00 就停（避免无限）
      if (zeroRun >= 2) {
        return;
      }
    } else {
      zeroRun = 0;
    }
  }
}

/** 定长记录文件：读记录 1..max，直到非 9000。 */
async function readRecords(out: DumpLine[], push: (l: DumpLine) => void,
  tx: (apdu: number[]) => Promise<number[]>, context: string, target: string,
  max: number, state: { fail: number; blown: boolean }): Promise<void> {
  for (let rec = 1; rec <= max && !state.blown; rec++) {
    const apdu: number[] = [0x00, 0xB2, rec, 0x04, 0x00];
    const ex = await exchange(tx, apdu);
    push(line(context, target, 'READ RECORD', apdu, ex.result, ex.note));
    if (ex.result.sw !== '9000') {
      return;
    }
  }
}

/** 目录下钻：选中目录后，扫 SFI 1~N（不带 FID 的 readBinary），再扫 FID 0000~0020。 */
async function drillDown(out: DumpLine[], push: (l: DumpLine) => void,
  tx: (apdu: number[]) => Promise<number[]>, dfId: number, dfLabel: string,
  sfiTo: number, state: { fail: number; blown: boolean }): Promise<void> {
  const ctx: string = 'DF:' + hex4(dfId);

  // ① SFI 路：P1=0x80|SFI（与 FID 路的 offset 编码不同，真卡踩过坑）
  for (let sfi = 1; sfi <= sfiTo && !state.blown; sfi++) {
    const target: string = 'SFI ' + sfi;
    const apdu: number[] = [0x00, 0xB0, 0x80 | sfi, 0x00, 0x20];
    const ex = await exchange(tx, apdu);
    const l: DumpLine = line(ctx, target, 'READ BINARY(SFI)', apdu, ex.result, ex.note);
    push(l);
    if (ex.result.sw === '6982') {
      l.note = '认证门：不认证、不猜门后';
      continue;
    }
    if (shouldTryRecords(ex.result.sw)) {
      // 目录内记录文件：两种寻址都试（当前 EF + SFI）
      await readRecords(out, push, tx, ctx, target, 2, state);
      const sfiRec: number[] = [0x00, 0xB2, 0x01, ((sfi << 3) | 4) & 0xff, 0x00];
      const rex = await exchange(tx, sfiRec);
      push(line(ctx, target, 'READ RECORD(SFI)', sfiRec, rex.result, rex.note));
      continue;
    }
    if (ex.result.sw === '9000' && ex.result.data.length > 0 && !isAllZero(ex.result.data)) {
      // SFI 路续读用 P2=offset（不是 P1）
      let zeroRun: number = 0;
      for (let offset = 0x20; offset <= 0x7F && !state.blown; offset += 0x20) {
        const more: number[] = [0x00, 0xB0, 0x80 | sfi, offset & 0xff, 0x20];
        const mex = await exchange(tx, more);
        const ml: DumpLine = line(ctx, target, 'READ BINARY(SFI)', more, mex.result, mex.note);
        push(ml);
        if (mex.result.sw === '6B00' || mex.result.sw !== '9000') {
          break;
        }
        if (ml.allZero) {
          zeroRun++;
          if (zeroRun >= 2) {
            break;
          }
        } else {
          zeroRun = 0;
        }
      }
    }
  }

  // ② FID 路：目录内 0000~0020，命中读 1 段（不下钻第 3 层）
  for (let fid = 0; fid <= 0x20 && !state.blown; fid++) {
    const target: string = 'FID ' + hex4(fid);
    const selApdu: number[] = [0x00, 0xA4, 0x02, 0x00, 0x02, (fid >>> 8) & 0xff, fid & 0xff];
    const sel = await exchange(tx, selApdu);
    push(line(ctx, target, 'SELECT', selApdu, sel.result, sel.note));
    if (sel.result.sw !== '9000') {
      continue;
    }
    const rdApdu: number[] = [0x00, 0xB0, 0x00, 0x00, 0x20];
    const rd = await exchange(tx, rdApdu);
    const rl: DumpLine = line(ctx, target, 'READ BINARY', rdApdu, rd.result, rd.note);
    push(rl);
    if (rd.result.sw === '6982') {
      rl.note = '认证门：不认证、不猜门后';
      continue;
    }
    if (shouldTryRecords(rd.result.sw)) {
      await readRecords(out, push, tx, ctx, target, 2, state);
    }
    // 目录内不再下钻第 3 层（最多 2 层，贴卡时间有限）
  }
}

/** 4 位大写 hex FID。 */
function hex4(v: number): string {
  let s: string = (v & 0xffff).toString(16).toUpperCase();
  while (s.length < 4) {
    s = '0' + s;
  }
  return s;
}
