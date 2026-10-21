/**
 * DDL 合并/排序规则单测（M4-2）
 *
 * 为什么值得单测：合并规则错一次 = 「勾掉完成的作业，同步后又变回未完成」，
 * 用户会认为自己的操作丢了（Android EclassDdlSyncer 的原注释就是这个风险）。
 *
 * 跑法：node --experimental-strip-types tools/test-ddl.mjs
 */

import { mergeDdl, sortDdl, toEntry, findDdl } from '../entry/src/main/ets/corelogic/DdlRules.ts';
import { toDdlItems, GROUP } from '../entry/src/main/ets/corelogic/EclassDdlLogic.ts';

let passed = 0;
let failed = 0;

function ok(cond, msg) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.log('FAIL ' + msg);
  }
}

function eq(actual, expected, msg) {
  const same = JSON.stringify(actual) === JSON.stringify(expected);
  if (same) {
    passed++;
  } else {
    failed++;
    console.log('FAIL ' + msg + ' => ' + JSON.stringify(actual) + ' (expected ' + JSON.stringify(expected) + ')');
  }
}

function entry(uid, day, minutes, done, group = 'eclass', title = 'T', text = 'C') {
  return { uid, group, title, text, day, minutes, done };
}

console.log('=== 1. 新作业插入，done=false ===');
const r1 = mergeDdl([], [entry('eclass:1', 100, 600, false)]);
eq(r1.length, 1, '插入一条');
eq(r1[0].done, false, '新作业默认未完成');

// 防误传：调用方即使传 done=true，插入时也必须 false
const r1b = mergeDdl([], [entry('eclass:1', 100, 600, true)]);
eq(r1b[0].done, false, '插入时 done 强制 false（防误传）');

console.log('\n=== 2. 已存在 ⇒ 更新字段但保留 done（核心规则）===');
const existing = [entry('eclass:1', 100, 600, true, 'eclass', '旧标题', '旧课程')];
const r2 = mergeDdl(existing, [entry('eclass:1', 105, 720, false, 'eclass', '新标题', '新课程')]);
eq(r2.length, 1, '不重复插入');
eq(r2[0].done, true, 'done=true 被保留（用户勾过的不被冲掉）');
eq(r2[0].title, '新标题', '标题更新');
eq(r2[0].text, '新课程', '课程更新');
eq(r2[0].day, 105, '截止日期更新');
eq(r2[0].minutes, 720, '截止时刻更新');
eq(r2[0].group, 'eclass', 'group 以旧记录为准');

const existing2 = [entry('eclass:1', 100, 600, false)];
const r2b = mergeDdl(existing2, [entry('eclass:1', 105, 720, true)]);
eq(r2b[0].done, false, 'done=false 也不被同步改成 true');

console.log('\n=== 3. 服务端消失的条目不删（Android 同款）===');
const r3 = mergeDdl(
  [entry('eclass:1', 100, 600, true), entry('eclass:2', 101, 600, false)],
  [entry('eclass:1', 100, 600, false)]
);
eq(r3.length, 2, '消失的 eclass:2 保留');
eq(findDdl(r3, 'eclass:2') !== null, true, 'eclass:2 还在');

console.log('\n=== 4. 不同 group 互不干扰 ===');
const r4 = mergeDdl(
  [entry('eclass:1', 100, 600, true, 'eclass'), entry('lexue:9', 100, 600, false, 'lexue')],
  [entry('eclass:2', 101, 600, false, 'eclass')]
);
eq(r4.length, 3, 'eclass 新条 + lexue 旧条都在');
eq(findDdl(r4, 'lexue:9') !== null, true, 'lexue 条目原样保留');
eq(findDdl(r4, 'lexue:9').done, false, 'lexue done 不被碰');

console.log('\n=== 5. 排序：截止升序、同日按时刻、稳定 ===');
const r5 = sortDdl([
  entry('b', 102, 30, false),
  entry('a', 100, 600, false),
  entry('d', 102, 30, false),
  entry('c', 100, 600, false)
]);
eq(r5.map((e) => e.uid), ['a', 'c', 'b', 'd'], 'day→minutes 升序，相等保持原次序');

console.log('\n=== 6. toEntry 字段搬运 ===');
const item = { uid: 'eclass:7', title: '实验二', text: '操作系统', time: { day: 110, minutes: 1439 } };
const e6 = toEntry(item, 'eclass', true);
eq(e6, { uid: 'eclass:7', group: 'eclass', title: '实验二', text: '操作系统', day: 110, minutes: 1439, done: true },
  'EclassDdlItem → DdlEntry');

console.log('\n=== 7. 端到端：toDdlItems → toEntry → mergeDdl ===');
const now = { day: 100, minutes: 0 };
const acts = [
  // 资料：不是作业
  { id: 1, title: '课件', type: 'material', courseId: 42, startTime: null, endTime: null, visibleEndAt: null, isClosed: false, submitTimes: null, lateSubmissionCount: null, isReviewHomework: null },
  // 作业 A：晚截止
  { id: 2, title: '作业A', type: 'homework', courseId: 42, startTime: null, endTime: '2026-11-10 23:59:00', visibleEndAt: null, isClosed: false, submitTimes: 0, lateSubmissionCount: null, isReviewHomework: null },
  // 作业 B：早截止
  { id: 3, title: '作业B', type: 'homework', courseId: 42, startTime: null, endTime: '2026-11-01 23:59:00', visibleEndAt: null, isClosed: false, submitTimes: null, lateSubmissionCount: 2, isReviewHomework: null }
];
const ddlItems = toDdlItems(acts, '操作系统', now);
eq(ddlItems.length, 2, '两条作业（资料被滤掉）');
eq(ddlItems[0].title, '作业B', '作业按截止升序（B 早于 A）');
const incoming = ddlItems.map((it) => toEntry(it, GROUP, false));
const merged = mergeDdl([], incoming);
eq(merged.map((e) => e.title), ['作业B', '作业A'], '入库仍按截止升序');
eq(merged.every((e) => e.done === false), true, '首次入库全部未完成');

// 再同步一次（服务端数据不变）：done 应保留
const withDone = merged.map((e, i) => ({ ...e, done: i === 0 }));
const merged2 = mergeDdl(withDone, incoming);
eq(merged2[0].done, true, '重同步后 B 仍是已完成');
eq(merged2[1].done, false, '重同步后 A 仍是未完成');
eq(merged2.length, 2, '重同步不产生重复');

console.log('\n=== 8. findDdl ===');
eq(findDdl(merged, 'eclass:999'), null, '找不到返回 null');
eq(findDdl(merged, 'eclass:3').title, '作业B', '找到返回条目');

console.log('\n' + (failed === 0 ? 'ALL PASS' : 'FAILED') + '  pass=' + passed + ' fail=' + failed);
process.exit(failed > 0 ? 1 : 0);
