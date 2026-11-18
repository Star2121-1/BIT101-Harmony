/**
 * 深度只读扫描单测（#170）。
 * 假 transmit 模拟真卡各状态字；验证覆盖全空间、目录下钻、认证门跳过、逐段读、只读闸门。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runDeepScan, isAllZero } from '../entry/src/main/ets/corelogic/DeepScanLogic.ts';
import { isReadOnly, readBinary, selectByFileId } from '../entry/src/main/ets/corelogic/CardProbeLogic.ts';

let pass = 0;
function ok(cond, name, extra) {
  if (cond) {
    pass++;
  } else {
    throw new Error('FAIL: ' + name + (extra ? ' | ' + extra : ''));
  }
}

function hx(s) {
  const clean = s.replace(/ /g, '');
  const out = [];
  for (let i = 0; i < clean.length; i += 2) {
    out.push(parseInt(clean.substring(i, i + 2), 16));
  }
  return out;
}
function ax(apdu) {
  return apdu.map((b) => (b < 16 ? '0' : '') + b.toString(16).toUpperCase()).join('');
}
function resp(dataHex, sw) {
  return hx(dataHex).concat(hx(sw));
}

// ── 1. isAllZero ────────────────────────────────────────────────
ok(isAllZero([0, 0, 0]), '全零判定');
ok(isAllZero([]) === true, '空数组算全零（保守，不误判有数据）');
ok(!isAllZero([0, 1, 0]), '含非零不算全零');
ok(!isAllZero([0, 0, 0xff]), '高位非零也不算全零');

// ── 2. 真卡模型（带「当前选中文件」状态，贴近真实卡片）──────────
// SELECT 3F00→9000；FID 0010 目录(READ→6986)、0016/0004→9000、其余→6A82
// 目录内 SFI4→6982 认证门；SFI5 第1段有数据、第2段→6B00；其余→6A82
function makeCard() {
  let selectedFid = -1;
  return async (apdu) => {
    const hex = ax(apdu);
    if (hex === '00A40000023F00') {
      selectedFid = 0x3f00;
      return resp('', '9000');
    }
    if (hex.startsWith('00A4020002')) {
      const fid = apdu[5] * 256 + apdu[6];
      selectedFid = fid;
      if (fid === 0x0010) {
        return resp('6F18', '9000');
      }
      if (fid === 0x0016 || fid === 0x0004) {
        return resp('', '9000');
      }
      return resp('', '6A82');
    }
    if (hex.startsWith('00B08')) {
      const sfi = apdu[2] & 0x7f;
      if (sfi === 4) {
        return resp('', '6982');
      }
      if (sfi === 5 && apdu[3] === 0) {
        return resp('AABBCCDD', '9000');
      }
      if (sfi === 5 && apdu[3] === 0x20) {
        return resp('', '6B00');
      }
      return resp('', '6A82');
    }
    if (hex.startsWith('00B000')) {
      const off = apdu[2] * 256 + apdu[3];
      if (selectedFid === 0x0010) {
        return resp('', '6986'); // 目录：READ BINARY 不允许
      }
      if (selectedFid === 0x0004) {
        return resp('', '6981'); // 定长记录文件
      }
      if (selectedFid === 0x0016 && off === 0) {
        return resp('B8DFCCECCFE8', '9000'); // 0016 姓名
      }
      return resp('', '6B00');
    }
    if (hex.startsWith('00B2')) {
      return resp('', '6981');
    }
    return resp('', '6D00');
  };
}
const fakeTx = makeCard();

// ── 3. 全空间扫描 ───────────────────────────────────────────────
const lines = await runDeepScan({ transmit: fakeTx, fidTo: 0x20, sfiTo: 6 });
ok(lines.length > 0, '有流水输出');
ok(lines[0].context === 'MF' && lines[0].op === 'SELECT' && lines[0].sw === '9000', '第一条是 SELECT MF 成功');

const mfFidSelects = lines.filter((l) => l.context === 'MF' && l.op === 'SELECT' && l.target.startsWith('FID '));
ok(mfFidSelects.length === 0x21, 'MF 下 FID SELECT 覆盖 0000~0020 全部 33 个', 'got=' + mfFidSelects.length);

const gateLines = lines.filter((l) => l.sw === '6982');
ok(gateLines.length > 0, '识别到认证门（6982）');
ok(gateLines.every((l) => l.note.indexOf('不认证') >= 0), '每条认证门都标「不认证、不猜门后」');

const eofLines = lines.filter((l) => l.sw === '6B00');
ok(eofLines.length >= 1, '遇到 6B00 文件末尾');

const dfLines = lines.filter((l) => l.context === 'DF:0010');
ok(dfLines.length > 0, '目录下钻到 DF:0010');
ok(dfLines.some((l) => l.target === 'SFI 5' && l.sw === '9000'), '目录内 SFI5 读到数据');
ok(dfLines.some((l) => l.target === 'SFI 4' && l.sw === '6982'), '目录内 SFI4 识别为认证门');

// ── 4. 掉卡保留 ─────────────────────────────────────────────────
let callN = 0;
const statefulCard = makeCard();
const flakyTx = async (apdu) => {
  callN++;
  if (callN > 5) {
    throw new Error('card gone');
  }
  return statefulCard(apdu);
};
const partial = await runDeepScan({ transmit: flakyTx, fidTo: 0x10, sfiTo: 3 });
ok(partial.length > 0 && partial.length < 12, '掉卡后保留已收到的前几条流水', 'got=' + partial.length);

// ── 5. 只读闸门 ─────────────────────────────────────────────────
ok(isReadOnly(selectByFileId(0x0016)), 'SELECT 是只读');
ok(isReadOnly(readBinary(5, 0)), 'READ BINARY 是只读');
ok(!isReadOnly([0x00, 0x82, 0x00, 0x00, 0x08]), 'EXTERNAL AUTHENTICATE(82) 被闸门拒绝');
ok(!isReadOnly([0x00, 0xD6, 0x00, 0x00, 0x01]), 'UPDATE BINARY(D6) 被闸门拒绝');

// 源码栅栏：只看代码行（去注释），不构造写认证/写块命令；exchange 过闸门；6982 明确跳过
const src = readFileSync('entry/src/main/ets/corelogic/DeepScanLogic.ts', 'utf8');
const code = src.split(/\r?\n/).filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//')).join('\n');
ok(!/0x82|0xD6|0xA8|EXTERNAL AUTHENTICATE/.test(code), '代码不含任何写认证/写块命令构造');
ok(src.indexOf('isReadOnly(apdu)') >= 0, 'exchange 入口有只读闸门');
ok(src.indexOf('6982') >= 0 && src.indexOf('不认证') >= 0, '6982 认证门明确跳过');

console.log('\nALL PASS  pass=' + pass + ' fail=0');
