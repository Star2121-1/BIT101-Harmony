// 成绩学分与分档守卫（P5）。
//
// 判据：学分列能解析、解析不了就不给学分（不猜）、分档边界正确、等级制不进数字分档、
// 学分不全时用「≥」、**不算 GPA**（本模块不导出任何绩点函数）、学分不进去重键、
// 缓存往返保留学分、旧缓存（无 credit 字段）解码后仍是 undefined。
//
//   node --experimental-transform-types tools/test-scoresummary.mjs

import { parseTable, scoreKey } from '../entry/src/main/ets/corelogic/ScoreLogic.ts';
import { summarize as flowSummarize } from '../entry/src/main/ets/corelogic/ScoreFlowLogic.ts';
import {
  parseScoreNum, bucketOf, bucketLabel, ScoreBucket, creditSummary, creditLine,
  buckets, bucketLine, nonNumericCount, formatCredit,
} from '../entry/src/main/ets/corelogic/ScoreSummaryLogic.ts';
import { encodeCached, decodeCached } from '../entry/src/main/ets/corelogic/ScoreStoreLogic.ts';

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

function e(course, score, term, credit) {
  const o = { course: course, score: score, term: term };
  if (credit !== undefined) {
    o.credit = credit;
  }
  return o;
}

// ── 1. 学分列解析 ─────────────────────────────────────────────────────────
const table = [
  ['序号', '开课学期', '课程编号', '课程名称', '学分', '成绩'],
  ['1', '2025-2026-2', 'MATH101', '高等数学', '5', '92'],
  ['2', '2025-2026-2', 'CS201', '数据结构', '3.5', '88'],
  ['3', '2025-2026-2', 'PE101', '体育', '免修', '合格'],
];
const parsed = parseTable(table);
ok(parsed.length === 3, '解析 3 行', String(parsed.length));
ok(parsed[0].course === '高等数学' && parsed[0].credit === 5, '学分列被解析（5）', JSON.stringify(parsed[0]));
ok(parsed[1].credit === 3.5, '小学分 3.5 正常', String(parsed[1].credit));
ok(parsed[2].credit === undefined, '「免修」不编成数字（credit undefined）', String(parsed[2].credit));
ok(parsed[2].score === '合格', '等级制分数原样保留');

// 没有学分列 → 全 undefined
const noCredit = parseTable([['课程名称', '成绩'], ['线性代数', '90']]);
ok(noCredit.length === 1 && noCredit[0].credit === undefined, '表里没有学分列 → 不给 credit', JSON.stringify(noCredit[0]));

// ── 2. 学分不进去重键 ─────────────────────────────────────────────────────
ok(scoreKey(parsed[0]) === scoreKey({ course: '高等数学', score: '92', term: '2025-2026-2' }),
  'scoreKey 不受学分影响');
ok(scoreKey(parsed[0]) !== scoreKey(parsed[1]), '不同课不同键');

// ── 3. 分数解析边界 ───────────────────────────────────────────────────────
ok(parseScoreNum('95') === 95, "'95' → 95");
ok(parseScoreNum('95.5') === 95.5, "'95.5' → 95.5");
ok(parseScoreNum(' 88 ') === 88, '去空白');
ok(parseScoreNum('95分') === null, "'95分' → null（不做模糊猜测）");
ok(parseScoreNum('优秀') === null, "'优秀' → null");
ok(parseScoreNum('A') === null, "'A' → null");
ok(parseScoreNum('') === null, '空串 → null');
ok(parseScoreNum(null) === null, 'null → null');
ok(parseScoreNum('101') === null, '超出 100 → null');
ok(parseScoreNum('-5') === null, '负分 → null');
ok(parseScoreNum('9.5.1') === null, '多个小数点 → null');

// ── 4. 分档边界 ───────────────────────────────────────────────────────────
ok(bucketOf('100') === ScoreBucket.High, '100 → 90-100');
ok(bucketOf('90') === ScoreBucket.High, '90 → 90-100（边界含）');
ok(bucketOf('89.9') === ScoreBucket.Good, '89.9 → 80-89');
ok(bucketOf('80') === ScoreBucket.Good, '80 → 80-89');
ok(bucketOf('79') === ScoreBucket.Mid, '79 → 70-79');
ok(bucketOf('60') === ScoreBucket.Low, '60 → 60-69');
ok(bucketOf('59') === ScoreBucket.Under60, '59 → <60');
ok(bucketOf('优秀') === null, '等级制不归入任何数字档');
ok(bucketOf(null) === null, '未出分不归档');
ok(bucketLabel(ScoreBucket.Under60) === '60 以下', '分档中文名');

// ── 5. 学分汇总 ───────────────────────────────────────────────────────────
const full = [
  e('高等数学', '92', '2025-2026-2', 5),
  e('数据结构', '88', '2025-2026-2', 3.5),
  e('线性代数', '95', '2025-2026-1', 3),
];
const cf = creditSummary(full);
ok(cf.creditSum === 11.5, '学分合计 11.5', String(cf.creditSum));
ok(cf.partial === false, '学分完整 → partial=false');
ok(cf.credited === 3, '有学分 3 门');
ok(cf.terms.length === 2, '按学期 2 组', String(cf.terms.length));
ok(cf.terms[0].term === '2025-2026-2' && cf.terms[0].creditSum === 8.5, '新学期在前且小计 8.5',
  JSON.stringify(cf.terms[0]));

const partial = [
  e('高等数学', '92', '2025-2026-2', 5),
  e('体育', '合格', '2025-2026-2'),          // 缺学分
];
const cp = creditSummary(partial);
ok(cp.creditSum === 5 && cp.partial === true, '缺学分 → 合计是下界（partial）', JSON.stringify(cp));
ok(cp.terms[0].partial === true, '该学期 partial=true');

const none = creditSummary([e('体育', '合格', '2025-2026-2')]);
ok(none.creditSum === 0 && none.credited === 0, '全无学分 → credited=0');

// ── 6. 文案 ───────────────────────────────────────────────────────────────
ok(creditLine(cf) === '学分 11.5', '完整学分文案', creditLine(cf));
ok(creditLine(cp) === '学分 ≥ 5', '不全 → 用 ≥', creditLine(cp));
ok(creditLine(none) === '', '没有学分列 → 空串（整块不显示）', creditLine(none));
ok(formatCredit(3.0) === '3', '整数不带小数点');
ok(formatCredit(3.5) === '3.5', '小数保留');
ok(formatCredit(0.333333) === '0.33', '最多两位');
ok(formatCredit(0) === '0', '0 → 0');

const bk = buckets(full);
ok(bk.length === 2, '两个分档', JSON.stringify(bk));
ok(bk[0].bucket === ScoreBucket.High && bk[0].count === 2, '90-100 2 门（92 与 95）', JSON.stringify(bk[0]));
ok(bk[1].bucket === ScoreBucket.Good && bk[1].count === 1, '80-89 1 门（88）', JSON.stringify(bk[1]));
ok(bucketLine(bk) === '90+ 2 · 80–89 1', '分档条文案', bucketLine(bk));
ok(bucketLine([]) === '', '无数字分数 → 空串');
ok(nonNumericCount(partial) === 1, '等级制计数 1', String(nonNumericCount(partial)));

// 与 ScoreFlowLogic.summarize 口径一致（不重复实现，只做对照）
const fs = flowSummarize(full);
ok(fs.total === 3 && fs.scored === 3, 'ScoreFlowLogic 的 summarize 仍是 3/3');

// ── 7. 缓存往返 ───────────────────────────────────────────────────────────
const enc = encodeCached({ atMillis: 1000, entries: full });
const dec = decodeCached(enc);
ok(dec !== null && dec.entries.length === 3, '缓存往返 3 条');
ok(dec.entries[0].credit === 5, '往返保留学分 5', String(dec.entries[0].credit));
ok(dec.entries[1].credit === 3.5, '往返保留 3.5');

// 旧缓存（没有 credit 键）→ undefined，不崩
const legacy = JSON.stringify({ at: 1000, rows: [{ course: '高等数学', score: '92', term: '2025-2026-2' }] });
const legacyDec = decodeCached(legacy);
ok(legacyDec !== null && legacyDec.entries[0].credit === undefined, '旧缓存无 credit → undefined（不造假 0）',
  String(legacyDec === null ? 'null' : legacyDec.entries[0].credit));

console.log('\n' + (fail === 0 ? 'ALL PASS' : 'FAILED') + '  pass=' + pass + ' fail=' + fail);
process.exit(fail === 0 ? 0 : 1);
