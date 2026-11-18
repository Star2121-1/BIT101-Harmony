/**
 * CPU 卡快速读的状态机（#152，不碰 @kit）。
 *
 * 把 Android NfcController.probeApdu/runStep/exchange 的**决策逻辑**抽成纯逻辑：
 * 注入一个 transmit 函数，跑 quickScan，自动处理 6Cxx 改 Le / 61xx GET RESPONSE，
 * 每条回答喂给 GBK/学号/BCD 解析，边收边回调（掉卡时保留已得结果）。
 *
 * ## 只读（与 Android 同源的最后一道门）
 * 每一条 APDU（含跟进命令）发出前都过 isReadOnly；闸门拦下的不发、标失败。
 *
 * ## 为什么注入 transmit
 * 鸿蒙的 `IsoDep.transmit` 是 @kit API，放 corelogic 会破坏「corelogic 不 import @kit」铁律。
 * 注入后这个状态机能在 Node 单测里用假 transmit 验证全部真卡路径。
 */

import type { GbkDecoder, ProbeResult, ProbeStep } from './CardProbeLogic.ts';
import {
  getResponse, isReadOnly, readRecordCurrentEf, remainingOf, shouldTryRecords,
  looksLikeDirectory, withLe, parseResponse, toHex, decodeGbkText
} from './CardProbeLogic.ts';
import { find as findStudentId, guess as guessStudentId } from './StudentIdScan.ts';
import { scan as scanBcd } from './BcdScan.ts';

/** transmit 注入：发一条 APDU，回答字节（不含异常；失败由实现方返回空或抛）。 */
export type TransmitFn = (apdu: number[]) => Promise<number[]>;

/** 一条探测流水（页面/汇总直接用）。 */
export interface ProbeLine {
  label: string;
  apdu: string;
  sw: string;
  swText: string | null;
  data: string;
  note: string;
  text: string | null;
  studentIdHit: string | null;
  guessedStudentId: string | null;
  guessedStudentIdNote: string | null;
  dates: string[];
  /** 原始字节，留给 TLV/AID 后续；不展示。 */
  bytes: number[];
}

/** 跑一次读卡的配置。 */
export interface ProbeConfig {
  /** 用户填的学号：填了只做核对(find)，不填只做猜测(guess)——两条路互斥。 */
  studentId: string | null;
  /** GBK 解码器（NfcService 注入 util.TextDecoder('gbk')）。 */
  decodeGbk: GbkDecoder;
  /** 发命令的实现。 */
  transmit: TransmitFn;
  /** 每收到一条就回调（边收边显示；掉卡时已收到的还在）。 */
  onLine?: (line: ProbeLine) => void;
}

/** 发一条命令并解析回答；闸门拦下返回明确失败，不发出去。 */
async function send(tx: TransmitFn, apdu: number[]): Promise<ProbeResult> {
  if (!isReadOnly(apdu)) {
    return { sw: '', swText: '被只读闸门拦下（拒绝发出）', data: [], success: false,
      hasMore: false, correctLe: null };
  }
  let raw: number[];
  try {
    raw = await tx(apdu);
  } catch (e) {
    return { sw: '', swText: 'transceive 失败（可能掉卡）', data: [], success: false,
      hasMore: false, correctLe: null };
  }
  return parseResponse(raw);
}

/**
 * 发一条并自动跟进（最多 3 轮）：
 * - `6C xx` → 按卡说的 Le 重发（真卡 0015 回 6C1E，不重发就拿不到那 30 字节）；
 * - `61 xx` → 发 GET RESPONSE 取剩余。
 * 每轮补发前都过只读闸门（GET RESPONSE / 改 Le 仍是读）。
 */
async function exchange(tx: TransmitFn, apdu: number[]): Promise<{ result: ProbeResult; note: string }> {
  let current: number[] = apdu;
  let result: ProbeResult = await send(tx, current);
  let note: string = '';
  for (let guard = 0; guard < 3; guard++) {
    let next: number[] | null = null;
    if (result.hasMore) {
      const n: number | null = remainingOf(result.sw);
      if (n === null) {
        break;
      }
      note += (note ? '；' : '') + '卡说还有 ' + n + ' 字节，发 GET RESPONSE 取';
      next = getResponse(n);
    } else if (result.correctLe !== null) {
      const n: number = result.correctLe;
      note += (note ? '；' : '') + '卡说 Le 该是 ' + n + '，按它重发';
      next = withLe(current, n);
    } else {
      break;
    }
    if (next.length === 0 || !isReadOnly(next)) {
      break;
    }
    current = next;
    result = await send(tx, current);
  }
  return { result: result, note: note };
}

/** 把一次回答翻译成 ProbeLine。 */
function makeLine(label: string, apdu: number[], r: ProbeResult, note: string,
  config: ProbeConfig): ProbeLine {
  const bytes: number[] = r.data;
  const hit: string | null = config.studentId !== null
    ? findStudentId(bytes, config.studentId) : null;
  const g = config.studentId === null ? guessStudentId(bytes) : null;
  const dates: string[] = scanBcd(bytes).map((d) => d.display);
  return {
    label: label,
    apdu: toHex(apdu),
    sw: r.sw,
    swText: r.swText,
    data: toHex(bytes),
    note: note,
    text: decodeGbkText(bytes, config.decodeGbk),
    studentIdHit: hit,
    guessedStudentId: g !== null ? g.value : null,
    guessedStudentIdNote: g !== null ? g.note : null,
    dates: dates,
    bytes: bytes
  };
}

/**
 * 跑快速读：先 SELECT MF，再挨个 FID，命中连读两段；
 * 主命令回 6981 改读记录；6986 记成「疑似目录」但不下钻（快速读不下钻）。
 */
export async function runQuickProbe(steps: ProbeStep[], config: ProbeConfig): Promise<ProbeLine[]> {
  const lines: ProbeLine[] = [];
  const push = (line: ProbeLine): void => {
    lines.push(line);
    if (config.onLine !== undefined) {
      config.onLine(line);
    }
  };

  for (let i = 0; i < steps.length; i++) {
    const step: ProbeStep = steps[i];
    const ex = await exchange(config.transmit, step.apdu);
    const out: ProbeLine = makeLine(step.label, step.apdu, ex.result, ex.note, config);
    push(out);

    // 6981：主命令本身就是记录文件，改读当前 EF 的记录（followUp 此时还没发，
    // 不能等 followUp——否则这一支永远够不着，真卡 0018 就是这样漏的）。
    if (shouldTryRecords(out.sw)) {
      for (let rec = 1; rec <= 3; rec++) {
        const recApdu: number[] = readRecordCurrentEf(rec);
        const rex = await exchange(config.transmit, recApdu);
        const rline: ProbeLine = makeLine(step.label + ' 改读记录 ' + rec, recApdu,
          rex.result, rex.note, config);
        push(rline);
        if (rex.result.sw !== '9000') {
          break;
        }
      }
      continue;
    }
    if (looksLikeDirectory(out.sw)) {
      continue; // 快速读不下钻目录，留给深度扫描
    }

    // 接着读：只在主命令 9000 时发（选中成功才有意义，中间不能夹别的 SELECT）
    if (step.followUp !== undefined && out.sw === '9000') {
      const fex = await exchange(config.transmit, step.followUp!);
      push(makeLine(step.followUpLabel || '「' + step.label + '」接着读', step.followUp!,
        fex.result, fex.note, config));
      // 6981：读命令回「记录文件」，这里也要单独判一次（每一条命令的结果各自判）
      if (shouldTryRecords(fex.result.sw)) {
        for (let rec = 1; rec <= 3; rec++) {
          const recApdu: number[] = readRecordCurrentEf(rec);
          const rex = await exchange(config.transmit, recApdu);
          push(makeLine(step.label + ' 改读记录 ' + rec, recApdu, rex.result, rex.note, config));
          if (rex.result.sw !== '9000') {
            break;
          }
        }
      } else if (step.followUpMore !== undefined && fex.result.sw === '9000') {
        // 继续往下读：一次 32 字节不代表文件到头（0016 学号在第 2 段）
        const mex = await exchange(config.transmit, step.followUpMore!);
        push(makeLine(step.label + ' 第 2 段', step.followUpMore!, mex.result, mex.note, config));
      }
    }
  }
  return lines;
}
