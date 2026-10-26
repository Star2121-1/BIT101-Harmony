/**
 * DDL 合并/排序规则单测（M4-2）
 *
 * 为什么值得单测：合并规则错一次 = 「勾掉完成的作业，同步后又变回未完成」，
 * 用户会认为自己的操作丢了（Android EclassDdlSyncer 的原注释就是这个风险）。
 *
 * 跑法：node --experimental-transform-types tools/test-ddl.mjs
 */

import { mergeDdl, sortDdl, toEntry, findDdl } from '../entry/src/main/ets/corelogic/DdlRules.ts';
import { toDdlItems, GROUP } from '../entry/src/main/ets/corelogic/EclassDdlLogic.ts';
import { remainTime, diffMinutes, deadlineShort, isOverdue } from '../entry/src/main/ets/corelogic/DdlFormat.ts';
import { remainTimeRatio, pendingList, doneList, cardColors, DDL_BEFORE_DAY } from '../entry/src/main/ets/corelogic/DdlListLogic.ts';
import { mixHex, withAlpha } from '../entry/src/main/ets/core/theme/colorUtil.ts';

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

console.log('\n=== 9. remainTime 展示口径（1:1 Android）===');

// diff = +3天5小时20分
eq(remainTime({ day: 103, minutes: 320 }, { day: 100, minutes: 0 }), '剩余 3天 5小时 20分钟', '天时分档');
// diff = +2小时10分
eq(remainTime({ day: 100, minutes: 130 }, { day: 100, minutes: 0 }), '剩余 2小时 10分钟', '小时分档');
// diff = +45分钟
eq(remainTime({ day: 100, minutes: 45 }, { day: 100, minutes: 0 }), '剩余 45分钟', '分钟档');
// 已过
eq(remainTime({ day: 99, minutes: 0 }, { day: 100, minutes: 0 }), '已过 1天 0小时 0分钟', '已过用前缀');
eq(remainTime({ day: 100, minutes: 0 }, { day: 100, minutes: 30 }), '已过 30分钟', '已过分钟档');
// 恰好现在
eq(remainTime({ day: 100, minutes: 0 }, { day: 100, minutes: 0 }), '剩余 0分钟', '差值 0 算剩余');
eq(diffMinutes({ day: 100, minutes: 30 }, { day: 100, minutes: 0 }), 30, 'diffMinutes 同日同时');
eq(diffMinutes({ day: 101, minutes: 0 }, { day: 100, minutes: 1439 }), 1, 'diffMinutes 跨天');

console.log('\n=== 10. deadlineShort / isOverdue ===');
eq(deadlineShort({ day: 20422, minutes: 1439 }), '11-30 23:59', 'MM-DD HH:mm（epoch 20422 = 2025-11-30）');
eq(deadlineShort({ day: 20422, minutes: 65 }), '11-30 01:05', '分钟补零');
eq(isOverdue({ day: 99, minutes: 0 }, { day: 100, minutes: 0 }), true, '昨天 = 已截止');
eq(isOverdue({ day: 100, minutes: 1 }, { day: 100, minutes: 0 }), false, '还有 1 分钟不算截止');

console.log('\n=== 11. remainTimeRatio（1:1 Android remainTimeRatio）===');
eq(DDL_BEFORE_DAY, 7, 'beforeDay 默认 7（Android 同款）');
eq(remainTimeRatio({ day: 100, minutes: 0 }, { day: 100, minutes: 0 }), 0, '恰好现在 = 0');
eq(remainTimeRatio({ day: 99, minutes: 0 }, { day: 100, minutes: 0 }), 0, '已过 = 0');
eq(remainTimeRatio({ day: 107, minutes: 0 }, { day: 100, minutes: 0 }), 1, '恰好 7 天 = 1（>=enoughTime）');
eq(remainTimeRatio({ day: 108, minutes: 0 }, { day: 100, minutes: 0 }), 1, '超过 7 天仍为 1');
eq(remainTimeRatio({ day: 100, minutes: 5040 }, { day: 100, minutes: 0 }), 0.5, '半程 = 0.5');
eq(remainTimeRatio({ day: 100, minutes: 1008 }, { day: 100, minutes: 0 }), 0.1, '1/10 程 = 0.1');
eq(remainTimeRatio({ day: 100, minutes: 1440 }, { day: 100, minutes: 0 }, 1), 1, 'beforeDay=1：1 天即满');
eq(remainTimeRatio({ day: 100, minutes: 720 }, { day: 100, minutes: 0 }, 1), 0.5, 'beforeDay=1：半程 = 0.5');

console.log('\n=== 12. mixHex / withAlpha（Android ColorUtils.mixColor 口径）===');
eq(mixHex('#FFFFFF', '#000000', 0.5), '#808080', '黑白各半 = 中灰');
eq(mixHex('#F4EFE8', '#FBE0DC', 1), '#F4EFE8', 'ratio=1 全是 color1');
eq(mixHex('#F4EFE8', '#FBE0DC', 0), '#FBE0DC', 'ratio=0 全是 color2');
eq(withAlpha('#D5E9DF', 0.5), '#80D5E9DF', '0.5α = 首字节 80（#AARRGGBB，真机实证）');
eq(withAlpha('#D5E9DF', 1), '#FFD5E9DF', 'α=1 = 首字节 FF（渲染等同 6 位）');
eq(withAlpha('#D5E9DF', 0), '#00D5E9DF', 'α=0 = 首字节 00（全透明）');

console.log('\n=== 13. cardColors（1:1 Android DDLScheduleItem）===');
const ddlTokens = {
  surfaceVariant: '#F4EFE8', errorContainer: '#FBE0DC',
  onSurfaceVariant: '#5F564E', onErrorContainer: '#8C1D18',
  secondaryContainer: '#D5E9DF', onSecondaryContainer: '#0F4A38'
};
// 未完成 + 时间充裕（>7 天）⇒ ratio=1 ⇒ 纯 surfaceVariant / onSurfaceVariant
const cc1 = cardColors(entry('eclass:1', 110, 0, false), { day: 100, minutes: 0 }, ddlTokens);
eq(cc1.bg, '#F4EFE8', '充裕卡底 = surfaceVariant');
eq(cc1.fg, '#5F564E', '充裕卡字 = onSurfaceVariant');
// 未完成 + 已过 ⇒ ratio=0 ⇒ 纯 errorContainer / onErrorContainer
const cc2 = cardColors(entry('eclass:1', 99, 0, false), { day: 100, minutes: 0 }, ddlTokens);
eq(cc2.bg, '#FBE0DC', '逾期卡底 = errorContainer');
eq(cc2.fg, '#8C1D18', '逾期卡字 = onErrorContainer');
// 未完成 + 半程（3.5 天）⇒ 各半混色：R=(244+251)/2=247.5→248=0xF8，
// G=(239+224)/2=231.5→232=0xE8，B=(232+220)/2=226=0xE2
const cc3 = cardColors(entry('eclass:1', 100, 5040, false), { day: 100, minutes: 0 }, ddlTokens);
eq(cc3.bg, '#F8E8E2', '半程卡底 = 混色（四舍五入口径）');
// 已完成 ⇒ secondaryContainer@0.5 + onSecondaryContainer（不随紧急度变）
const cc4 = cardColors(entry('eclass:1', 99, 0, true), { day: 100, minutes: 0 }, ddlTokens);
eq(cc4.bg, '#80D5E9DF', '已完成卡底 = 80D5E9DF（secondaryContainer@0.5，alpha 在前）');
eq(cc4.fg, '#0F4A38', '已完成卡字 = onSecondaryContainer');
// 守卫：完成卡即使已逾期也不许混入 errorContainer（防回归到「统一按紧急度」）
eq(cc4.bg.indexOf('FB') < 0, true, '已完成卡不掺 errorContainer 色相');

console.log('\n=== 14. 分区顺序（1:1 DdlListOrder）===');
const list14 = [
  entry('p2', 102, 30, false),
  entry('p1', 100, 600, false),
  entry('d1', 101, 0, true),
  entry('d2', 105, 0, true)
];
eq(pendingList(list14).map((e) => e.uid), ['p1', 'p2'], '未完成按截止升序（最急在上）');
eq(doneList(list14).map((e) => e.uid), ['d2', 'd1'], '已完成按截止倒序（最近在上）');
eq(pendingList(list14).length, 2, '未完成区只含未完成');
eq(doneList(list14).length, 2, '已完成区只含已完成');
// 同日同时刻保持原次序（稳定排序）
const list14b = [entry('b', 100, 600, false), entry('a', 100, 600, false)];
eq(pendingList(list14b).map((e) => e.uid), ['b', 'a'], '相等保持原次序（稳定排序）');
// 不改入参（filter 出新数组，sort 不碰原数组）
const orig14 = [entry('x', 100, 0, true), entry('y', 100, 0, false)];
pendingList(orig14);
doneList(orig14);
eq(orig14.map((e) => e.uid), ['x', 'y'], '分区函数不改入参');
eq(pendingList([]).length, 0, '空列表未完成区为空');
eq(doneList([]).length, 0, '空列表已完成区为空');
// 同日不同时刻：先比 day 再比 minutes
const list14c = [entry('late', 100, 700, false), entry('early', 100, 100, false)];
eq(pendingList(list14c).map((e) => e.uid), ['early', 'late'], '同日按时刻升序');

console.log('\n' + (failed === 0 ? 'ALL PASS' : 'FAILED') + '  pass=' + passed + ' fail=' + failed);
process.exit(failed > 0 ? 1 : 0);
