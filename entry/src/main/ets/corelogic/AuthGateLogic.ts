/**
 * 认证门（SW=6982）的**只读研究**纯逻辑（#168，不碰 @kit、不破密钥）。
 *
 * ## 我们在研究什么
 * 真卡实测：MF 下 `0004`、目录 `0010` 内 `SFI=4/0004` 读回 `6982`
 * （不满足安全条件）。这是**明确的认证门**，不是文件不存在。
 * 目标：只读取证「这是哪种锁」，把已知/未知写清楚，**不猜门后内容**。
 *
 * ## 红线（与 BIT101-seat/docs/nfc-card-probe.md §0 同源）
 * 1. 只发只读命令（SELECT / READ / GET CHALLENGE——全在 READ_ONLY_INS 白名单）。
 * 2. **绝不构造 EXTERNAL AUTHENTICATE（INS=82）**：那是带密钥的认证提交，
 *    既不在白名单，也不是"研究"该做的。
 * 3. 不跑 MFOC / nested authentication / 暴力猜密钥——那是撬锁，不是研究锁。
 * 4. 「没读到」的两种可能（不在卡里 / 锁着）永远分开写，不合并成「取不到」。
 *
 * ## 判定依据（ISO 7816-4）
 * - 文件 SELECT 成功(9000) + READ 回 6982 + GET CHALLENGE 回随机字节(9000)
 *   ⇒ 质询-应答型门：卡支持 challenge，等你用密钥算响应。
 * - GET CHALLENGE 回 6D00(INS不支持)/6A88(引用数据没找到)/6985(条件不满足)
 *   ⇒ 该上下文不支持质询，更像纯访问权限位门。
 * - 任何一步都只是观察，不给结论式的「门后是什么」。
 */

import type { ProbeStep, ProbeResult } from './CardProbeLogic.ts';
import {
  getChallenge, selectMasterFile, selectByFileId, readBinaryPlain, toHex
} from './CardProbeLogic.ts';

/** 一次认证门探测的观察结果（给人看的证据）。 */
export interface GateObservation {
  /** 步骤说明，如「MF/SELECT 0004」。 */
  label: string;
  /** 发出的 APDU（hex）。 */
  apdu: string;
  /** 卡的状态字。 */
  sw: string;
  /** 状态字解释。 */
  swText: string | null;
  /** 回答的数据部分（hex）——GET CHALLENGE 时是随机数。 */
  data: string;
  /** 这条回答说明什么（只描述机制，不猜门后内容）。 */
  meaning: string;
}

/** 锁的类型判定（含"还不知道"）。 */
export type GateKind =
  | 'challenge-response'  // 支持质询-应答：GET CHALLENGE 给了随机数
  | 'permission-bit'      // 不支持质询：更像纯权限位
  | 'inconsistent'        // 证据互相矛盾，不能下结论
  | 'not-a-gate';         // 根本不是 6982（比如文件不存在）

/** 判定总结。 */
export interface GateReport {
  kind: GateKind;
  /** 一句话结论（只说锁的类型，不说门后内容）。 */
  conclusion: string;
  /** 已知的证据点。 */
  known: string[];
  /** 明确未知、本次没证的。 */
  unknown: string[];
  observations: GateObservation[];
}

/**
 * 认证门探测步骤（只读）：
 * ① 回 MF；② SELECT 0004；③ READ 0004（预期 6982）；
 * ④ SELECT 0010（目录）；⑤ SELECT 0004（目录内同一文件号）；
 * ⑥ READ（预期 6982）；⑦ GET CHALLENGE 看是否支持质询。
 *
 * ⚠️ 全程没有 INS=82（EXTERNAL AUTHENTICATE），没有密钥，没有写。
 */
export function gateProbeSteps(): ProbeStep[] {
  return [
    { label: '回 MF（钉死上下文）', apdu: selectMasterFile() },
    { label: 'MF / SELECT 0004', apdu: selectByFileId(0x0004) },
    { label: 'MF / READ 0004 前 32 字节', apdu: readBinaryPlain() },
    { label: 'SELECT 目录 0010', apdu: selectByFileId(0x0010) },
    { label: '目录内 / SELECT 0004', apdu: selectByFileId(0x0004) },
    { label: '目录内 / READ 0004', apdu: readBinaryPlain() },
    { label: '目录内 / GET CHALLENGE 8 字节', apdu: getChallenge(8) },
  ];
}

/** GET CHALLENGE 的回答在说什么（不猜门后内容）。 */
function challengeMeaning(r: ProbeResult): string {
  if (r.success) {
    if (r.data.length === 0) {
      return '卡回 9000 但没有随机数字节：质询能力存疑，不下结论';
    }
    return '卡回了 ' + r.data.length + ' 字节数据 + 9000：支持质询-应答，门在等密钥算响应';
  }
  if (r.sw === '6D00' || r.sw === '6A88' || r.sw === '6985' || r.sw === '6A81') {
    return '卡回 ' + r.sw + '：该上下文不支持 GET CHALLENGE，更像纯访问权限位门';
  }
  return '卡回 ' + r.sw + '：不能据此判断认证方式，保持未知';
}

/**
 * 把一串观察汇总成判定报告。
 * @param observations 与 gateProbeSteps() 对齐的观察列表
 */
export function analyzeGate(observations: GateObservation[]): GateReport {
  const known: string[] = [];
  const unknown: string[] = [
    '门后的数据内容：本次不认证，无法读，保持未知',
    '认证所需的密钥：不猜、不试、不破',
    '认证算法（3DES / AES / 其它）：需要看卡的反应，本次不推断'
  ];

  const read6982 = observations.filter((o) => o.sw === '6982');
  const chall = observations.find((o) => o.apdu.replace(/ /g, '').startsWith('00840000'));
  const select0004 = observations.find((o) => o.label.indexOf('SELECT 0004') >= 0 && o.sw === '9000');

  if (read6982.length === 0) {
    return {
      kind: 'not-a-gate',
      conclusion: '本次没观察到 6982：文件状态与历史实测不同，不能当作认证门',
      known: ['本次各步状态见流水'],
      unknown: unknown,
      observations: observations
    };
  }
  known.push('读到 ' + read6982.length + ' 处 6982（不满足安全条件），确认是认证门而非文件不存在');
  if (select0004 !== undefined) {
    known.push('0004 文件存在（SELECT 回 9000），锁定的是读取权限不是文件本身');
  }

  if (chall === undefined) {
    return {
      kind: 'inconsistent',
      conclusion: '观察到 6982 但没拿到 GET CHALLENGE 结果，认证方式还不能定',
      known: known,
      unknown: unknown,
      observations: observations
    };
  }
  known.push(chall.meaning);

  if (chall.sw === '9000' && chall.data.length > 0) {
    return {
      kind: 'challenge-response',
      conclusion: '这扇门是质询-应答型：SELECT 成功、读被 6982 挡住、GET CHALLENGE 给了随机数',
      known: known,
      unknown: unknown,
      observations: observations
    };
  }
  if (chall.sw === '6D00' || chall.sw === '6A88' || chall.sw === '6985' || chall.sw === '6A81') {
    return {
      kind: 'permission-bit',
      conclusion: '这扇门更像纯权限位：读被 6982 挡住，且 GET CHALLENGE 不受支持',
      known: known,
      unknown: unknown,
      observations: observations
    };
  }
  return {
    kind: 'inconsistent',
    conclusion: '证据不足以判定认证类型，保持未知（不硬下结论）',
    known: known,
    unknown: unknown,
    observations: observations
  };
}

/** 把一次观察渲染成归档文本（给真机证据用）。 */
export function formatObservation(o: GateObservation): string {
  return o.label + ' | APDU ' + o.apdu + ' | SW ' + o.sw +
    (o.swText ? '（' + o.swText + '）' : '') +
    (o.data.length > 0 ? ' | DATA ' + o.data : '') +
    ' | ' + o.meaning;
}

/** 确认探测序列里没有任何写/认证提交命令（源码栅栏也查这个）。 */
export function probeIsReadOnly(steps: ProbeStep[]): boolean {
  for (let i = 0; i < steps.length; i++) {
    const apdu: number[] = steps[i].apdu;
    if (apdu.length < 2) {
      return false;
    }
    const ins: number = apdu[1] & 0xff;
    // 只读白名单：A4 SELECT / B0 READ BINARY / B2 READ RECORD / C0 GET RESPONSE / CA GET DATA / 84 GET CHALLENGE
    if (ins !== 0xA4 && ins !== 0xB0 && ins !== 0xB2 && ins !== 0xC0 && ins !== 0xCA && ins !== 0x84) {
      return false;
    }
  }
  return true;
}
