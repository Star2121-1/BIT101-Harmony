// 版本号与更新说明守卫（M10-4）。
//
// 判据：预发布排序正确（`1.0.0` > `1.0.0-alpha.9`、`alpha.9` < `alpha.10`）、
// 认不出的版本号不被猜、坏条目逐条丢弃而不是整页空白。
//
//   node --experimental-transform-types tools/test-version.mjs

import {
  parseVersion, compareVersion, parseChangelog, latestVersion, versionLine, hasNewerNotes,
} from '../entry/src/main/ets/corelogic/VersionLogic.ts';

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

// ── 1. 解析 ───────────────────────────────────────────────────────────────
const a = parseVersion('1.0.0-alpha.9');
ok(a !== null && a.major === 1 && a.minor === 0 && a.patch === 0, '三段 + 预发布解析');
ok(a.pre === 'alpha.9', '预发布标记保留', a.pre);
const b = parseVersion('1.2');
ok(b !== null && b.major === 1 && b.minor === 2 && b.patch === 0 && b.pre === '', '两段视作 patch=0');
ok(parseVersion('1.0.0.0') === null, '四段 → null');
ok(parseVersion('x.y.z') === null, '非数字 → null');
ok(parseVersion('') === null, '空串 → null');
ok(parseVersion('1.-2.0') === null, '负段 → null');

// ── 2. 比较 ───────────────────────────────────────────────────────────────
ok(compareVersion('1.0.0', '1.0.0-alpha.9') === 1, '正式版 > 预发布');
ok(compareVersion('1.0.0-alpha.9', '1.0.0') === -1, '预发布 < 正式版（反向）');
ok(compareVersion('1.0.0-alpha.9', '1.0.0-alpha.10') === -1, 'alpha.9 < alpha.10（按段比数字）');
ok(compareVersion('2.0.0', '1.9.9') === 1, '主版本优先');
ok(compareVersion('1.10.0', '1.9.0') === 1, '次版本按数字不是字典序');
ok(compareVersion('1.0.1', '1.0.1') === 0, '相同版本相等');
ok(compareVersion('bad', '1.0.0') === 0, '无法比较 ⇒ 0（不谎报有更新）');

// ── 3. 更新说明解析 ───────────────────────────────────────────────────────
const raw = JSON.stringify([
  { version: '1.0.0-alpha.7', date: '2026-10-22', items: ['旧功能'] },
  { version: '1.0.0-alpha.9', date: '2026-10-28', items: ['成绩查询', '卡片配额'] },
  { version: '1.0.0-alpha.8', date: '2026-10-25', items: ['UI 迁移'] },
]);
const list = parseChangelog(raw);
ok(list.length === 3, '三条都能解析');
ok(list[0].version === '1.0.0-alpha.9', '新→旧排序（首条最新）', list[0].version);
ok(list[2].version === '1.0.0-alpha.7', '末条最旧');
ok(list[0].items.length === 2, '条目保留');

// 坏条目逐条丢
const mixed = parseChangelog(JSON.stringify([
  { version: '1.0.0', date: 'x', items: ['ok'] },
  { version: 'not-a-version', date: 'x', items: ['bad version'] },
  { version: '1.0.1', date: 'x', items: [] },
  { date: 'x', items: ['no version'] },
  'not an object',
]));
ok(mixed.length === 1 && mixed[0].version === '1.0.0', '坏条目被丢，好条目保留', mixed.length);
ok(parseChangelog('') .length === 0, '空串 → 空列表');
ok(parseChangelog('oops').length === 0, '坏 JSON → 空列表');
ok(parseChangelog('{}').length === 0, '对象而非数组 → 空列表');

// ── 4. 最新版本 / 页头 / 更新提示 ─────────────────────────────────────────
ok(latestVersion(list) === '1.0.0-alpha.9', '取到最新版本');
ok(latestVersion([]) === '', '空清单 → 空串');
ok(versionLine('1.0.0-alpha.9', 9) === '1.0.0-alpha.9 (9)', '版本行格式', versionLine('1.0.0-alpha.9', 9));
ok(versionLine('', 1) === '取不到版本号', '空版本名给明确文案');

ok(hasNewerNotes('1.0.0-alpha.8', list) === true, '当前 alpha.8、说明有 alpha.9 ⇒ 提示');
ok(hasNewerNotes('1.0.0-alpha.9', list) === false, '当前已是最新 ⇒ 不提示');
ok(hasNewerNotes('1.0.0', list) === false, '当前正式版 ≥ 说明 ⇒ 不提示');
ok(hasNewerNotes('', list) === false, '版本号未知 ⇒ 不提示（不谎报更新）');
ok(hasNewerNotes('1.0.0-alpha.8', []) === false, '空说明 ⇒ 不提示');

console.log('\n' + (fail === 0 ? 'ALL PASS' : 'FAILED') + '  pass=' + pass + ' fail=' + fail);
process.exit(fail === 0 ? 0 : 1);
