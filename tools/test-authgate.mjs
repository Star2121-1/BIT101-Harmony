/**
 * AuthGateLogic 单测（#168）：认证门只读研究的判定规则 + 红线栅栏。
 */
import assert from 'node:assert/strict';
import {
  gateProbeSteps, analyzeGate, formatObservation, probeIsReadOnly
} from '../entry/src/main/ets/corelogic/AuthGateLogic.ts';
import { getChallenge, isReadOnly, toHex, parseHex, getResponse } from '../entry/src/main/ets/corelogic/CardProbeLogic.ts';

let pass = 0;
function ok(cond, name) {
  assert.ok(cond, name);
  pass++;
}
function obs(label, apdu, sw, swText, data, meaning) {
  return { label, apdu, sw, swText, data, meaning };
}

// ── 1. GET CHALLENGE 构造 ────────────────────────────────────────────────
ok(toHex(getChallenge(8)) === '00 84 00 00 08', 'GET CHALLENGE 8 字节');
ok(toHex(getChallenge(256)) === '00 84 00 00 00', 'GET CHALLENGE 256 → Le=00');
ok(isReadOnly(getChallenge(8)), 'GET CHALLENGE 在只读白名单');
ok(getChallenge(0).length === 0 && getChallenge(257).length === 0, '越界长度返空');
ok(!isReadOnly(parseHex('0082000000')), 'EXTERNAL AUTHENTICATE(82) 不在只读白名单');

// ── 2. 探测序列只读 ──────────────────────────────────────────────────────
const steps = gateProbeSteps();
ok(steps.length === 7, '探测序列 7 步');
ok(probeIsReadOnly(steps), '整条序列都是只读命令');
ok(steps.every(s => s.apdu.every(b => isReadOnly(s.apdu))), '每步都过 isReadOnly');
ok(!steps.some(s => (s.apdu[1] & 0xff) === 0x82), '没有任何 EXTERNAL AUTHENTICATE');
ok(steps[0].apdu.join(' ') === '0 164 0 0 2 63 0', '第一步回 MF');
ok(steps[6].apdu.join(' ') === '0 132 0 0 8', '最后一步 GET CHALLENGE');

// ── 3. 判定：质询-应答型 ─────────────────────────────────────────────────
{
  const observations = [
    obs('回 MF', '00 A4 00 00 02 3F 00', '9000', '成功', '', ''),
    obs('MF / SELECT 0004', '00 A4 02 00 02 00 04', '9000', '成功', '', ''),
    obs('MF / READ 0004', '00 B0 00 00 20', '6982', '不满足安全条件', '', ''),
    obs('SELECT 0010', '00 A4 02 00 02 00 10', '9000', '成功', '', ''),
    obs('目录内 / SELECT 0004', '00 A4 02 00 02 00 04', '9000', '成功', '', ''),
    obs('目录内 / READ 0004', '00 B0 00 00 20', '6982', '不满足安全条件', '', ''),
    obs('目录内 / GET CHALLENGE', '00 84 00 00 08', '9000', '成功', '3F 2A 91 04 7B C8 10 E6',
      '卡回了 8 字节数据 + 9000：支持质询-应答，门在等密钥算响应'),
  ];
  const report = analyzeGate(observations);
  ok(report.kind === 'challenge-response', '判为质询-应答型');
  ok(report.conclusion.indexOf('质询') >= 0, '结论说清锁类型');
  ok(report.known.some(k => k.indexOf('6982') >= 0), 'known 记录 6982 证据');
  ok(report.known.some(k => k.indexOf('文件存在') >= 0), 'known 记录 SELECT 9000');
  ok(report.unknown.some(u => u.indexOf('密钥') >= 0), 'unknown 明确密钥未知');
  ok(report.unknown.some(u => u.indexOf('门后') >= 0), 'unknown 明确门后内容未知');
  ok(report.conclusion.indexOf('门后') < 0, '结论不猜门后内容');
}

// ── 4. 判定：纯权限位型 ──────────────────────────────────────────────────
{
  const base = [
    obs('MF / SELECT 0004', '00 A4 02 00 02 00 04', '9000', '成功', '', ''),
    obs('MF / READ 0004', '00 B0 00 00 20', '6982', '不满足安全条件', '', ''),
  ];
  for (const sw of ['6D00', '6A88', '6985', '6A81']) {
    const withChall = base.concat([obs('GET CHALLENGE', '00 84 00 00 08', sw, '', '', sw)]);
    const r = analyzeGate(withChall);
    ok(r.kind === 'permission-bit', sw + ' → 判为权限位型');
  }
}

// ── 5. 判定：证据不足 / 不是门 ──────────────────────────────────────────
{
  const no6982 = [obs('READ 0004', '00 B0 00 00 20', '6A82', '找不到', '', '')];
  ok(analyzeGate(no6982).kind === 'not-a-gate', '没有 6982 → 不是认证门');
  const noChall = [obs('READ 0004', '00 B0 00 00 20', '6982', '', '', '')];
  ok(analyzeGate(noChall).kind === 'inconsistent', '有 6982 但无质询结果 → 证据不足');
  const emptyChall = [
    obs('READ 0004', '00 B0 00 00 20', '6982', '', '', ''),
    obs('GET CHALLENGE', '00 84 00 00 08', '9000', '成功', '', '没有字节'),
  ];
  ok(analyzeGate(emptyChall).kind === 'inconsistent', '9000 但无字节 → 不下结论');
}

// ── 6. 归档文本 ──────────────────────────────────────────────────────────
{
  const line = formatObservation(obs('READ 0004', '00 B0 00 00 20', '6982', '不满足安全条件', 'AA BB', '门'));
  ok(line.indexOf('6982') >= 0 && line.indexOf('AA BB') >= 0 && line.indexOf('门') >= 0,
    '归档文本含状态/数据/说明');
}

console.log('\nALL PASS pass=' + pass + ' fail=0');
