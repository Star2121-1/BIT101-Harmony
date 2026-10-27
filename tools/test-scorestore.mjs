// 成绩本地存储序列化守卫（M10-2）。
//
// 判据：坏数据**必须能被识别**（否则会把历史成绩当「新出分」轰炸）；
// 快照读不出来 ⇒ 调用方只建基线；成绩缓存带时刻、过期判定不信未来时间。
//
//   node --experimental-transform-types tools/test-scorestore.mjs

import {
  encodeCached, decodeCached, encodeSnapshot, decodeSnapshot, isFresh, SCORE_CACHE_TTL_MS,
} from '../entry/src/main/ets/corelogic/ScoreStoreLogic.ts';

let pass = 0;
let fail = 0;
function ok(cond, msg, extra) {
  if (cond) {
    pass++;
    console.log('PASS ' + msg);
  } else {
    fail++;
    console.log('FAIL ' + msg + (extra === undefined ? '' : '  → ' + extra));
  }
}

// ── 1. 成绩缓存往返 ───────────────────────────────────────────────────────
const entries = [
  { course: '高数', score: '95', term: '2025-2026-1' },
  { course: '体育', score: null, term: null },
];
const enc = encodeCached({ atMillis: 1700000000000, entries });
const dec = decodeCached(enc);
ok(dec !== null, '缓存能往返解码');
ok(dec.atMillis === 1700000000000, '时刻保留');
ok(dec.entries.length === 2, '条目数保留');
ok(dec.entries[0].course === '高数' && dec.entries[0].score === '95', '字段保留');
ok(dec.entries[1].score === null, 'null 分数仍是 null（不是空串）');

// ── 2. 坏缓存（不猜）──────────────────────────────────────────────────────
ok(decodeCached('') === null, '空串 → null');
ok(decodeCached('oops') === null, '非 JSON → null');
ok(decodeCached('{"rows":[]}') === null, '缺 at → null');
ok(decodeCached('{"at":0,"rows":[]}') === null, 'at=0 → null（视为没有缓存）');
ok(decodeCached('{"at":-5,"rows":[]}') === null, 'at 负数 → null');
ok(decodeCached('{"at":123,"rows":"x"}') === null, 'rows 非数组 → null');
const partly = decodeCached(JSON.stringify({
  at: 123,
  rows: [
    { course: '   ', score: '1', term: null },
    { course: '有效课', score: '80', term: '2025-2026-1' },
    { course: 42, score: '90', term: null },
    null,
  ],
}));
ok(partly !== null && partly.entries.length === 1,
  '坏行逐条跳过（课名空/类型错/整行 null 都不炸）', partly && partly.entries.length);
ok(partly.entries[0].course === '有效课', '好行保留');

// ── 3. 缓存新鲜度 ─────────────────────────────────────────────────────────
const now = 1700000000000;
ok(isFresh({ atMillis: now, entries: [] }, now, SCORE_CACHE_TTL_MS) === true, '刚拉取 ⇒ 新鲜');
ok(isFresh({ atMillis: now - SCORE_CACHE_TTL_MS, entries: [] }, now, SCORE_CACHE_TTL_MS) === true,
  '恰好到期 ⇒ 仍算新鲜（闭区间）');
ok(isFresh({ atMillis: now - SCORE_CACHE_TTL_MS - 1, entries: [] }, now, SCORE_CACHE_TTL_MS) === false,
  '超出窗口 ⇒ 过期');
ok(isFresh({ atMillis: 0, entries: [] }, now, SCORE_CACHE_TTL_MS) === false, 'at=0 ⇒ 过期');
ok(isFresh({ atMillis: now + 60000, entries: [] }, now, SCORE_CACHE_TTL_MS) === false,
  '未来时间 ⇒ 过期（时钟被改过也不信）');

// ── 4. 快照往返 ───────────────────────────────────────────────────────────
const snap = { '高数|2025-2026-1': '95', '体育|': '' };
const snapEnc = encodeSnapshot(snap);
const snapDec = decodeSnapshot(snapEnc);
ok(snapDec !== null, '快照能往返');
ok(snapDec['高数|2025-2026-1'] === '95', '快照值保留');
ok(snapDec['体育|'] === '', '空分数保留成空串');

// 坏快照 → null（调用方据此「只建基线不提醒」）
ok(decodeSnapshot('') === null, '空串快照 → null');
ok(decodeSnapshot('[]') === null, '顶层数组 → null（快照必须是对象）');
ok(decodeSnapshot('{bad') === null, '坏 JSON → null');
// 值类型不对的键丢掉，数字转字符串
const mixed = decodeSnapshot(JSON.stringify({ a: '1', b: 2, c: { x: 1 }, d: null }));
ok(mixed.a === '1', '字符串值保留');
ok(mixed.b === '2', '数字值转字符串');
ok(mixed.c === undefined && mixed.d === undefined, '对象/null 值丢掉（快照值只可能是分数原文）');

console.log('\n' + (fail === 0 ? 'ALL PASS' : 'FAILED') + '  pass=' + pass + ' fail=' + fail);
process.exit(fail === 0 ? 0 : 1);
