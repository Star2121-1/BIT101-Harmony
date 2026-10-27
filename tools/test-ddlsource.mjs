// 作业来源开关守卫（M4-5）。
//
// 判据：开关编解码不丢状态、认不出的源**默认显示**（数据不能静默消失）、
// 乐学条目永远不显示（本版不支持该源，那些截止时间没经过验证）。
//
//   node --experimental-transform-types tools/test-ddlsource.mjs

import {
  SRC_ECLASS, SRC_LOCAL, SRC_LEXUE, GROUP_LOCAL, DEFAULT_DDL_SOURCE,
  encodePrefs, decodePrefs, sourceOf, visibleEntries, noneEnabled, prefsSummary, DDL_SOURCES,
} from '../entry/src/main/ets/corelogic/DdlSourceLogic.ts';

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

function entry(uid, group) {
  return { uid, group, title: 't-' + uid, text: 'c', day: 1, minutes: 0, done: false };
}

// ── 1. 编解码 ─────────────────────────────────────────────────────────────
ok(encodePrefs({ eclass: true, local: false }) === 'eclass=1;local=0', '编码形状可读');
const rt = decodePrefs(encodePrefs({ eclass: false, local: true }));
ok(rt.eclass === false && rt.local === true, '往返不丢状态');
ok(decodePrefs('').eclass === true && decodePrefs('').local === true, '空串 ⇒ 两源都开');
ok(decodePrefs('garbage').eclass === true, '坏串 ⇒ 回落默认（不让用户以为作业全丢）');
const half = decodePrefs('eclass=0');
ok(half.eclass === false && half.local === true, '只写一半时另一半保持默认');
ok(DEFAULT_DDL_SOURCE.eclass === true && DEFAULT_DDL_SOURCE.local === true, '默认两源都开');

// ── 2. 源判定 ─────────────────────────────────────────────────────────────
ok(sourceOf(entry('local_1000', GROUP_LOCAL)) === SRC_LOCAL, 'local_ 前缀 ⇒ 本机条目');
ok(sourceOf(entry('local_1000', 'eclass')) === SRC_LOCAL, 'uid 前缀优先于 group（本地条目不会被当成教务的）');
ok(sourceOf(entry('eclass:88', 'eclass')) === SRC_ECLASS, 'eclass 分组');
ok(sourceOf(entry('lexue:1', 'lexue')) === SRC_LEXUE, 'lexue 分组');
ok(sourceOf(entry('weird:1', 'weird')) === SRC_ECLASS, '认不出的源默认当 eclass（显示，不消失）');

// ── 3. 过滤 ───────────────────────────────────────────────────────────────
const all = [
  entry('eclass:1', 'eclass'),
  entry('local_1', GROUP_LOCAL),
  entry('lexue:1', 'lexue'),
];
ok(visibleEntries(all, { eclass: true, local: true }).length === 2, '两源都开：乐学仍然不显示', 
  visibleEntries(all, { eclass: true, local: true }).length);
const onlyLocal = visibleEntries(all, { eclass: false, local: true });
ok(onlyLocal.length === 1 && onlyLocal[0].uid === 'local_1', '只开本地 ⇒ 只剩本机条目');
const onlyEclass = visibleEntries(all, { eclass: true, local: false });
ok(onlyEclass.length === 1 && onlyEclass[0].uid === 'eclass:1', '只开延河 ⇒ 只剩教务条目');
const none = visibleEntries(all, { eclass: false, local: false });
ok(none.length === 0, '两源都关 ⇒ 空列表');
ok(visibleEntries([], { eclass: true, local: true }).length === 0, '空库不炸');

// ── 4. 提示文案 ───────────────────────────────────────────────────────────
ok(noneEnabled({ eclass: false, local: false }) === true, '都关 ⇒ noneEnabled');
ok(noneEnabled({ eclass: true, local: false }) === false, '开一个就不算全关');
ok(prefsSummary({ eclass: false, local: false }) === '未启用任何来源', '全关文案');
ok(prefsSummary({ eclass: true, local: true }) === '延河课堂 + 本地', '全开文案');
ok(prefsSummary({ eclass: false, local: true }) === '本地', '只开本地文案');

// ── 5. 清单 ───────────────────────────────────────────────────────────────
ok(DDL_SOURCES.length === 3, '列出三个源（含不可用的乐学）');
const lexue = DDL_SOURCES.find((s) => s.key === SRC_LEXUE);
ok(lexue !== undefined && lexue.usable === false, '乐学标为不可用（不假装支持）');
ok(lexue.note.indexOf('未验证') >= 0, '乐学说明写清「接口未验证」');
const usable = DDL_SOURCES.filter((s) => s.usable).map((s) => s.key);
ok(usable.indexOf(SRC_ECLASS) >= 0 && usable.indexOf(SRC_LOCAL) >= 0, '两个可用源都在');

console.log('\n' + (fail === 0 ? 'ALL PASS' : 'FAILED') + '  pass=' + pass + ' fail=' + fail);
process.exit(fail === 0 ? 0 : 1);
