/**
 * CardProbeRunner 单测（#152）：用假 transmit 模拟真卡，验证状态机全部关键路径。
 */
import assert from 'node:assert/strict';
import { runQuickProbe } from '../entry/src/main/ets/corelogic/CardProbeRunner.ts';
import { quickScan, selectByFileId, readBinaryPlain, readRecordCurrentEf, getResponse } from '../entry/src/main/ets/corelogic/CardProbeLogic.ts';
import { summarize, hasPerson, cardNoCandidates } from '../entry/src/main/ets/corelogic/CardIdentityLogic.ts';

let pass = 0;
function ok(cond, name) {
  assert.ok(cond, name);
  pass++;
}
function hx(s) {
  const out = [];
  for (let i = 0; i < s.length; i += 2) out.push(parseInt(s.substring(i, i + 2), 16));
  return out;
}
function toHexStr(bytes) {
  return bytes.map(b => (b < 16 ? '0' : '') + b.toString(16).toUpperCase()).join(' ');
}
function gbkDecoder(bytes) {
  const t = { B8DF: '高', CCEC: '天', CFE8: '翔' };
  let out = '';
  for (let i = 0; i < bytes.length;) {
    const b = bytes[i] & 0xff;
    if (b < 0x80) { out += String.fromCharCode(b); i++; }
    else { out += t[toHexStr([bytes[i], bytes[i + 1]]).replace(/ /g, '')] || '\uFFFD'; i += 2; }
  }
  return out;
}
// 真卡 0016：第 1 段是姓名（GBK），第 2 段是分段学号
const NAME_BYTES = hx('0000B8DFCCECCFE80000');
const ID_BYTES = hx('3131063230323431330435350000');

// 模拟一张「只有 0016 有数据」的卡
function fakeCard(overrides = {}) {
  const calls = [];
  const tx = async (apdu) => {
    calls.push(toHexStr(apdu));
    const hex = toHexStr(apdu).replace(/ /g, '');
    if (overrides.before) {
      const r = overrides.before(apdu, calls.length);
      if (r !== undefined) return r;
    }
    // SELECT 0016 → 9000
    if (hex === '00A40200020016') return hx('9000');
    // READ 0016 第 1 段（00B0000020）→ 姓名（GBK）；第 2 段（00B0002020）→ 分段学号
    if (hex === '00B0000020') return NAME_BYTES.concat([0x90, 0x00]);
    if (hex === '00B0002020') return ID_BYTES.concat([0x90, 0x00]);
    // 其它 SELECT 成功、READ 找不到文件
    if (hex.startsWith('00A4')) return hx('9000');
    if (hex.startsWith('00B0')) return hx('6A82');
    return hx('6D00');
  };
  return { tx, calls };
}

async function main() {
  // ── 1. 基本：跑完不崩，能找到 0016 的姓名 ──────────────────────────────
  {
    const card = fakeCard();
    const lines = await runQuickProbe(quickScan(), { studentId: null, decodeGbk: gbkDecoder, transmit: card.tx });
    ok(lines.length > 0, '产出流水');
    ok(lines.some(l => l.text === '高天翔'), '0016 解出姓名高天翔');
    ok(card.calls[0] === '00 A4 00 00 02 3F 00', '第一条是 SELECT MF');
    ok(card.calls.some(c => c === '00 A4 02 00 02 00 16'), '扫到 0016');
  }

  // ── 2. 不填学号 → guess 疑似学号；填学号 → 核对命中，互斥 ──────────────
  {
    const card = fakeCard();
    const lines = await runQuickProbe(quickScan(), { studentId: null, decodeGbk: gbkDecoder, transmit: card.tx });
    const gl = lines.filter(l => l.guessedStudentId !== null);
    ok(gl.length > 0 && gl[0].guessedStudentId === '1120241355', '不填学号猜出 1120241355');
    ok(lines.every(l => l.studentIdHit === null), '不填学号时无核对命中');
  }
  {
    const card = fakeCard();
    const lines = await runQuickProbe(quickScan(), { studentId: '1120241355', decodeGbk: gbkDecoder, transmit: card.tx });
    const hl = lines.filter(l => l.studentIdHit !== null);
    ok(hl.length > 0 && hl[0].studentIdHit.indexOf('分段形式') >= 0, '填学号核对命中（学号在第 2 段）');
    ok(lines.every(l => l.guessedStudentId === null), '填学号时不猜（两条路互斥）');
  }

  // ── 3. BCD 日期被点出来 ────────────────────────────────────────────────
  {
    const withDate = hx('202603221108439000');
    const card = fakeCard({ before: (apdu) => {
      if (toHexStr(apdu).replace(/ /g, '') === '00B0000020') return withDate;
      return undefined;
    } });
    const lines = await runQuickProbe(quickScan(), { studentId: null, decodeGbk: gbkDecoder, transmit: card.tx });
    const d = lines.filter(l => l.dates.length > 0);
    ok(d.length > 0 && d[0].dates[0].indexOf('2026-03-22 11:08:43') >= 0, 'BCD 日期时间被点出来');
  }

  // ── 4. 6Cxx 改 Le 重发（真卡 0015）─────────────────────────────────────
  {
    let readCount = 0;
    const card = fakeCard({ before: (apdu) => {
      const hex = toHexStr(apdu).replace(/ /g, '');
      if (hex === '00B0000020' || hex.startsWith('00B00000')) {
        readCount++;
        if (readCount === 1) return hx('6C1E'); // 第一次说 Le 该是 0x1E
        return hx('AABB9000');
      }
      return undefined;
    } });
    const lines = await runQuickProbe(quickScan(0x0015, 0x0015), { studentId: null, decodeGbk: gbkDecoder, transmit: card.tx });
    ok(card.calls.some(c => c.endsWith('1E')), '按 6C1E 用 Le=1E 重发');
    ok(lines.some(l => l.note.indexOf('Le 该是 30') >= 0), 'note 记录改 Le 原因');
    ok(lines.some(l => l.data === 'AA BB'), '重发后拿到数据');
  }

  // ── 5. 61xx → GET RESPONSE ─────────────────────────────────────────────
  {
    const card = fakeCard({ before: (apdu) => {
      const hex = toHexStr(apdu).replace(/ /g, '');
      if (hex === '00B0000020') return hx('6102');
      if (hex === '00C0000002') return hx('CCDD9000');
      return undefined;
    } });
    const lines = await runQuickProbe(quickScan(0x0016, 0x0016), { studentId: null, decodeGbk: gbkDecoder, transmit: card.tx });
    ok(card.calls.some(c => c === '00 C0 00 00 02'), '发了 GET RESPONSE');
    ok(lines.some(l => l.note.indexOf('GET RESPONSE') >= 0), 'note 记录 GET RESPONSE');
    ok(lines.some(l => l.data === 'CC DD'), '取到剩余数据');
  }

  // ── 6. 6981 → 改读记录 ─────────────────────────────────────────────────
  {
    const card = fakeCard({ before: (apdu) => {
      const hex = toHexStr(apdu).replace(/ /g, '');
      if (hex === '00B0000020') return hx('6981');
      if (hex === '00B2010400') return hx('12349000');
      if (hex.startsWith('00B201')) return hx('6A83'); // 记录 2 没有
      return undefined;
    } });
    const lines = await runQuickProbe(quickScan(0x0016, 0x0016), { studentId: null, decodeGbk: gbkDecoder, transmit: card.tx });
    ok(card.calls.some(c => c === '00 B2 01 04 00'), '6981 后改发 READ RECORD 记录1');
    ok(lines.some(l => l.label.indexOf('改读记录') >= 0 && l.sw === '9000'), '记录读到数据');
    ok(card.calls.filter(c => c.startsWith('00 B2')).length === 2, '记录2失败后停止（不多发）');
  }

  // ── 7. 只读闸门：写命令注入被拦（永不发出）─────────────────────────────
  {
    const steps = [{ label: '恶意写', apdu: hx('00D6000000') }];
    let txCalled = false;
    const lines = await runQuickProbe(steps, {
      studentId: null, decodeGbk: gbkDecoder,
      transmit: async () => { txCalled = true; return hx('9000'); }
    });
    ok(!txCalled, '写命令没被 transmit 发出（闸门拦下）');
    ok(lines[0].swText.indexOf('只读闸门') >= 0, '标注被闸门拦下');
  }

  // ── 8. 掉卡保留已得：中途 transmit 抛错，前面的结果还在 ────────────────
  {
    let n = 0;
    const seen = [];
    const tx = async (apdu) => {
      n++;
      if (n > 5) throw new Error('card gone');
      return hx('9000');
    };
    const lines = await runQuickProbe(quickScan(0x0001, 0x0005), {
      studentId: null, decodeGbk: gbkDecoder, transmit: tx,
      onLine: (l) => seen.push(l.label)
    });
    ok(lines.length >= 5, '掉卡前的 5 条结果保留');
    ok(seen.length === lines.length, 'onLine 逐条回调（边收边显示）');
    ok(lines.some(l => l.sw === '' && l.swText.indexOf('掉卡') >= 0), '掉卡标明确原因');
  }

  // ── 9. 汇总名片（端到端）───────────────────────────────────────────────
  {
    const card = fakeCard();
    const lines = await runQuickProbe(quickScan(), { studentId: '1120241355', decodeGbk: gbkDecoder, transmit: card.tx });
    const id = summarize(lines, cardNoCandidates(hx('7775F07B')), '1120241355');
    ok(id.name === '高天翔' && id.studentId === '1120241355', '端到端得到姓名+学号');
    ok(hasPerson(id), '认出了人（不必开深度扫描）');
  }

  console.log('\nALL PASS pass=' + pass + ' fail=0');
}

main().catch((e) => { console.error(e); process.exit(1); });
