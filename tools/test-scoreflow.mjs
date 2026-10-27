// 成绩流程纯逻辑守卫（M10-2）。
//
// 判据：契约形状解析得住、脏形状不被猜成可用、**失败分类不混**（密码错 ≠ 稍后重试）、
// 学期分组顺序与「未标注」末置、页头摘要**不含分数**。
//
//   node --experimental-transform-types tools/test-scoreflow.mjs

import {
  parseEnvelope, parseStatus, extractScoreTable, decide,
  termLabel, hasScore, groupByTerm, summarize, summaryLine,
} from '../entry/src/main/ets/corelogic/ScoreFlowLogic.ts';

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

// ── 1. 202 外层 `{detail:{…}}` ─────────────────────────────────────────────
const env = parseEnvelope(JSON.stringify({
  detail: {
    challenge_id: 'c1', access_token: 't1', status: 'running',
    ready_services: [], error: null, expires_in: 300,
  },
}));
ok(env !== null, 'parseEnvelope 解析 detail 包装');
ok(env.challengeId === 'c1', 'challenge_id 取出', env && env.challengeId);
ok(env.accessToken === 't1', 'access_token 取出');
ok(env.status === 'running', 'status 取出');
ok(Array.isArray(env.readyServices) && env.readyServices.length === 0, 'ready_services 空数组合法');
ok(env.error === '', 'error 非字符串 → 空串（不写成 null 混进判断）');

// 扁平形状（服务端两种都见过）
const flat = parseEnvelope(JSON.stringify({ challenge_id: 'c2', status: 'waiting_sms' }));
ok(flat !== null && flat.challengeId === 'c2' && flat.status === 'waiting_sms',
  'parseEnvelope 兼容扁平形状');

// 脏形状一律 null
ok(parseEnvelope('') === null, '空串 → null');
ok(parseEnvelope('not json') === null, '非 JSON → null');
ok(parseEnvelope('{"detail":{}}') === null, '既无 id 又无 status → null（不猜）');
ok(parseEnvelope('[1,2]') === null, '数组顶层 → null');

// ── 2. 轮询响应（字段在顶层）──────────────────────────────────────────────
const st = parseStatus(JSON.stringify({ status: 'running', ready_services: ['jwb'], error: null }));
ok(st !== null && st.status === 'running', 'parseStatus 解析顶层形状');
ok(st.readyServices.length === 1 && st.readyServices[0] === 'jwb', 'ready_services 取出 jwb');
ok(st.challengeId === '', '轮询响应没有 challenge_id → 空串（不是 null 崩）');
ok(parseStatus('{"foo":1}') === null, '既无 status 又无 ready_services → null');

// ── 3. 取数响应 ───────────────────────────────────────────────────────────
const table = extractScoreTable(JSON.stringify({ msg: 'ok', data: [['课程名称', '成绩'], ['高数', '95']] }));
ok(Array.isArray(table) && table.length === 2, 'extractScoreTable 取出 data 二维数组');
ok(extractScoreTable('{"data":"x"}') === null, 'data 非数组 → null');
ok(extractScoreTable('{}') === null, '无 data → null');

// ── 4. 下一步决策（顺序敏感：终结态必须排在 wait 前）──────────────────────
function snap(status, ready) {
  return { challengeId: 'c', accessToken: 't', status, readyServices: ready, error: '' };
}
ok(decide(snap('running', ['jwb'])) === 'fetch', 'jwb 就绪 ⇒ fetch（优先于 status 判断）');
ok(decide(snap('running', [])) === 'wait', 'running 未就绪 ⇒ wait');
ok(decide(snap('waiting_sms', [])) === 'need_sms', 'waiting_sms ⇒ need_sms');
ok(decide(snap('failed', [])) === 'auth_failed', 'failed ⇒ auth_failed（不是「稍后重试」）');
ok(decide(snap('expired', [])) === 'expired', 'expired ⇒ expired');
ok(decide(snap('cancelled', [])) === 'failed', 'cancelled ⇒ failed');
ok(decide(snap('authenticated', [])) === 'wait', 'authenticated 但服务未就绪 ⇒ wait');
ok(decide(snap('', [])) === 'failed', 'status 空 ⇒ failed（不猜 running）');
ok(decide(snap('weird_new_state', [])) === 'failed', '未知状态 ⇒ failed');

// ── 5. 学期展示名 ─────────────────────────────────────────────────────────
ok(termLabel('2025-2026-2') === '2025-2026 · 第二学期', '学期名含中文序数', termLabel('2025-2026-2'));
ok(termLabel('2025-2026-1') === '2025-2026 · 第一学期', '第一学期');
ok(termLabel('') === '未标注学期', '空学期 → 未标注');
ok(termLabel('2025-2026') === '2025-2026', '没有末位序数就原样返回（不编）');
ok(termLabel('乱七八糟') === '乱七八糟', '认不出格式原样返回');

// ── 6. 分数是否已出 ───────────────────────────────────────────────────────
ok(hasScore({ course: 'a', score: null, term: null }) === false, 'score=null ⇒ 未出分');
ok(hasScore({ course: 'a', score: '  ', term: null }) === false, '空白 ⇒ 未出分');
ok(hasScore({ course: 'a', score: '--', term: null }) === false, '`--` 占位 ⇒ 未出分');
ok(hasScore({ course: 'a', score: '-', term: null }) === false, '`-` 占位 ⇒ 未出分');
ok(hasScore({ course: 'a', score: '95', term: null }) === true, '有分数 ⇒ 已出分');
ok(hasScore({ course: 'a', score: '优', term: null }) === true, '等级制分数也算已出分');

// ── 7. 按学期分组 ─────────────────────────────────────────────────────────
const list = [
  { course: '高数', score: '95', term: '2024-2025-1' },
  { course: '线代', score: null, term: '2025-2026-1' },
  { course: '英语', score: '88', term: '2025-2026-1' },
  { course: '体育', score: '90', term: null },
  { course: '物理', score: '77', term: '2025-2026-2' },
];
const gs = groupByTerm(list);
ok(gs.length === 4, '4 个分组（3 个学期 + 未标注）', 'got=' + gs.length);
ok(gs[0].term === '2025-2026-2', '新学期在前', gs[0].term);
ok(gs[1].term === '2025-2026-1', '次新学期第二', gs[1].term);
ok(gs[2].term === '2024-2025-1', '旧学期在后', gs[2].term);
ok(gs[3].term === '', '未标注学期排最后');
ok(gs[1].entries.length === 2, '同学期凑到一组');
ok(gs[1].scored === 1, '组内已出分门数只数有分的', 'got=' + gs[1].scored);
ok(gs[1].entries[0].course === '线代', '组内保持表里原顺序（不重排）');
ok(groupByTerm([]).length === 0, '空表 → 空分组');

// ── 8. 汇总与页头文案 ─────────────────────────────────────────────────────
const sum = summarize(list);
ok(sum.total === 5, '总数 5');
ok(sum.scored === 4, '已出分 4');
ok(sum.pending === 1, '待出分 1');
ok(sum.terms === 3, '学期数 3（不含未标注）');
const line = summaryLine(sum);
ok(line.indexOf('共 5 门') >= 0, '摘要讲条数', line);
ok(line.indexOf('已出分 4') >= 0, '摘要讲已出分');
ok(line.indexOf('待出分 1') >= 0, '摘要讲待出分');
// 隐私边界：摘要里不许出现任何分数原文（95/88/90/77）
const noScoreInLine = ['95', '88', '90', '77'].every((s) => line.indexOf(s) < 0);
ok(noScoreInLine, '摘要**不含分数**（隐私边界）', line);
ok(summaryLine(summarize([])) === '还没有成绩数据', '空表摘要');

console.log('\n' + (fail === 0 ? 'ALL PASS' : 'FAILED') + '  pass=' + pass + ' fail=' + fail);
process.exit(fail === 0 ? 0 : 1);
