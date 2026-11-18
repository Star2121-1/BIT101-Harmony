// Classic 全扇区只读 dump 单测（#153）
// 纯 JS（.mjs），被 import 的 .ts 才有类型。
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { runClassicScan, DEFAULT_KEY_A, defaultBlocksPerSector } from '../entry/src/main/ets/corelogic/ClassicScanLogic.ts';

let n = 0;
function ok(cond, name) {
  assert.ok(cond, name);
  n++;
  console.log('  ok ' + n + ' - ' + name);
}

// ── 1. 真卡模型：16 扇区 × 4 块，默认 KeyA 全通，块0 制造商块其余全零 ──
const MFU = [0x77, 0x75, 0xF0, 0x7B, 0x89, 0x28, 0x04, 0x00,
  0x90, 0x10, 0x15, 0x01, 0x00, 0x00, 0x00, 0x00];
const ZERO = new Array(16).fill(0);

function makeCard(opts) {
  const o = opts || {};
  const authCalls = [];
  const readCalls = [];
  return {
    authCalls, readCalls,
    config: {
      sectorCount: o.sectorCount === undefined ? 16 : o.sectorCount,
      blocksPerSector: defaultBlocksPerSector,
      authenticate: async (sector, key, isKeyA) => {
        authCalls.push({ sector, key: key.slice(), isKeyA });
        if (o.failSector !== undefined && sector === o.failSector) return false;
        if (o.throwSector !== undefined && sector === o.throwSector) throw new Error('card lost');
        return true;
      },
      readBlock: async (block) => {
        readCalls.push(block);
        if (o.throwBlock !== undefined && block === o.throwBlock) throw new Error('card lost');
        if (block === 0) return MFU.slice();
        return ZERO.slice();
      }
    }
  };
}

console.log('\n=== Classic 只读 dump ===');
(async () => {
  {
    const card = makeCard({});
    let progress = 0;
    const lines = await runClassicScan({
      ...card.config,
      onLine: () => { progress++; }
    });
    ok(lines.length === 16 * (1 + 4), '16 扇区 × (1 认证 + 4 读块) = 80 条流水');
    ok(progress === lines.length, 'onLine 每条都回调（边收边显示）');
    ok(card.authCalls.length === 16, '16 次认证');
    ok(card.readCalls.length === 64, '64 次读块');
    // 只发默认密钥 KeyA
    ok(card.authCalls.every(c => c.isKeyA === true), '全部是 KeyA 认证');
    ok(card.authCalls.every(c => c.key.join(',') === DEFAULT_KEY_A.join(',')),
      '全部用唯一默认密钥 FFFFFFFFFFFF');
    // 制造商块 + 全零
    const mfu = lines.find(l => l.block === 0);
    ok(mfu !== undefined && mfu.data.indexOf('77 75 F0 7B') === 0, '块0=制造商块，读出 UID');
    ok(mfu.note.indexOf('制造商块') >= 0, '块0 标注制造商块');
    const zeros = lines.filter(l => l.op === 'READ BLOCK' && l.status === 'ok' && l.block !== 0);
    ok(zeros.length === 63 && zeros.every(l => l.allZero), '其余 63 块全零且被标记 allZero');
  }

  // 认证失败扇区跳过，不试第二个密钥
  {
    const card = makeCard({ failSector: 5 });
    const lines = await runClassicScan(card.config);
    const s5 = lines.filter(l => l.sector === 5);
    ok(s5.length === 1 && s5[0].status === 'auth-fail', '认证失败扇区只留一行 auth-fail');
    ok(s5[0].note.indexOf('不试其他密钥') >= 0, '跳过时明确标注不试其他密钥');
    ok(card.authCalls.length === 16, '失败扇区也只有一次认证（没换密钥重试）');
    ok(card.readCalls.every(b => Math.floor(b / 4) !== 5), '认证失败扇区没有读任何块');
  }

  // 认证抛错也当失败跳过
  {
    const card = makeCard({ throwSector: 3 });
    const lines = await runClassicScan(card.config);
    ok(lines.filter(l => l.sector === 3 && l.status === 'auth-fail').length === 1,
      '认证抛错按 auth-fail 处理，不中断全程');
  }

  // 读块抛错（掉卡）保留已得流水，继续下一扇区
  {
    const card = makeCard({ throwBlock: 4 });
    const lines = await runClassicScan(card.config);
    const fail = lines.filter(l => l.status === 'read-fail');
    ok(fail.length === 1 && fail[0].block === 4, '掉卡块记 read-fail');
    ok(lines.filter(l => l.block === 5 && l.status === 'ok').length === 1,
      '掉卡后继续读后续块（保留已得）');
  }

  // 非零数据判定
  {
    const card = makeCard({});
    card.config.readBlock = async (block) => {
      if (block === 8) return [0x12, 0x34].concat(new Array(14).fill(0));
      return block === 0 ? MFU.slice() : ZERO.slice();
    };
    const lines = await runClassicScan(card.config);
    const b8 = lines.find(l => l.block === 8);
    ok(b8 !== undefined && !b8.allZero && b8.note === '非零数据', '非零块被识别，不误标全零');
  }

  // ── 源码栅栏：不写块、不写 NDEF、不试第二密钥 ──
  {
    const src = readFileSync('entry/src/main/ets/corelogic/ClassicScanLogic.ts', 'utf8');
    // 去掉注释行再扫，避免红线说明里的词触发误报
    const code = src.split('\n').filter(l => !/^\s*\*|^\s*\/\//.test(l)).join('\n');
    ok(!/writeSingleBlock|incrementBlock|decrementBlock|transferToBlock|restoreFromBlock|format|writeNdef/.test(code),
      '源码无任何写块/增值/NDEF 写入调用');
    ok(!/0xFF[\s,]*0xFF[\s,]*0xFF[\s,]*0xFF[\s,]*0x00/.test(code),
      '源码无第二个候选密钥（只有全 FF 默认密钥）');
    ok(code.indexOf('DEFAULT_KEY_A') >= 0, '认证统一走 DEFAULT_KEY_A 常量');
  }

  console.log('\nALL PASS ' + n + ' assertions');
})().catch(e => { console.error('FAIL', e); process.exit(1); });
