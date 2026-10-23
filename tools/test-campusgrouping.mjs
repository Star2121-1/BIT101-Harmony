/**
 * 校区分组忠实度测试（#85）
 * =========================================================
 * 1:1 照搬 Android `CampusGroupingTest.kt` 的 6 条用例（含那条
 * **实机发现的 `null` 校区 bug**），另补鸿蒙侧边界。
 *
 * 判据对着**语义**写，不是对着实现写：
 * - 分组键退化链：code → name → __unknown__（显示「未归类」）
 * - 当前校区排最前（代码优先，名字只在不设代码时兜底）
 * - 字面量 "null"（任意大小写）= 没有校区
 * - 空输入 → 空分组（不造校区）
 *
 * 跑法：node --experimental-transform-types tools/test-campusgrouping.mjs
 */

import { groupCampuses, UNKNOWN_CODE, UNKNOWN_NAME } from '../entry/src/main/ets/corelogic/CampusGrouping.ts';

let failed = 0;
let passed = 0;

function eq(actual, expected, msg) {
  const a = String(actual);
  const e = String(expected);
  if (a === e) { passed++; }
  else { failed++; console.log('FAIL ' + msg + '：实际 ' + actual + ' ≠ 期望 ' + expected); }
}

function ok(cond, msg) {
  if (cond) { passed++; } else { failed++; console.log('FAIL ' + msg); }
}

function b(name, index, campusName, campusCode) {
  return { buildingName: name, buildingIndex: index, campusName, campusCode };
}

const lx1 = b('综合教学楼', 'A', '良乡校区', 'LX');
const lx2 = b('理科教学楼', 'B', '良乡校区', 'LX');
const zg = b('主楼', 'C', '中关村校区', 'ZG');

console.log('=== 照搬 Kotlin：按校区分组并保持服务端顺序 ===');
{
  const g = groupCampuses([lx1, zg, lx2], '', '');
  eq(g.length, 2, '两个校区');
  eq(g[0].campusName, '良乡校区', '组0=良乡校区');
  eq(g[0].buildings.map((x) => x.buildingName).join(','), '综合教学楼,理科教学楼', '组内保持服务端顺序');
  eq(g[1].campusName, '中关村校区', '组1=中关村校区');
  eq(g[1].buildings.length, 1, '组1 一栋楼');
}

console.log('\n=== 照搬 Kotlin：当前校区排最前 ===');
{
  const g = groupCampuses([lx1, zg], 'ZG', '中关村校区');
  eq(g[0].campusName, '中关村校区', '当前校区排最前');
  ok(g[0].isCurrent === true, '组0 isCurrent');
  ok(g[1].isCurrent === false, '组1 非当前');
}

console.log('\n=== 照搬 Kotlin：代码为空时按名字判定当前校区 ===');
{
  const g = groupCampuses([lx1, zg], '', '中关村校区');
  ok(g[0].isCurrent === true, '按名字判当前');
  eq(g[0].campusName, '中关村校区', '排最前的是中关村');
}

console.log('\n=== 照搬 Kotlin：未设置校区时无当前校区 ===');
{
  const g = groupCampuses([lx1, zg], '', '');
  ok(g.every((x) => !x.isCurrent), '谁也不标当前');
  eq(g[0].campusName, '良乡校区', '保持服务端顺序（良乡在前）');
}

console.log('\n=== 照搬 Kotlin：校区代码缺失时退化成校区名 ===');
{
  const a = b('一号楼', 'A', '', '');
  const c = b('一号楼', 'B', '沙河校区', '');
  const g = groupCampuses([a, c], '', '');
  eq(g.length, 2, '两栋楼不合成一个校区');
  eq(g[0].campusCode, UNKNOWN_CODE, '组0 落兜底桶');
  eq(g[0].campusName, UNKNOWN_NAME, '兜底桶显示「未归类」而非下划线键');
  eq(g[1].campusCode, '沙河校区', '组1 键退化成校区名');
}

console.log('\n=== 照搬 Kotlin（实机 bug）：校区名字面量 null 当作没有 ===');
{
  const weird = b('某栋楼', 'A', 'null', 'null');
  const g = groupCampuses([lx1, weird], '', '');
  eq(g.length, 2, 'null 楼单独成组');
  const un = g.find((x) => x.buildings.length === 1 && x.buildings[0].buildingName === '某栋楼');
  eq(un.campusName, UNKNOWN_NAME, '显示「未归类」');
  ok(g.every((x) => x.campusName.toLowerCase().indexOf('null') < 0),
    '任何组名都不含 null：' + g.map((x) => x.campusName).join('/'));
}

console.log('\n=== 照搬 Kotlin：空输入得到空分组 ===');
eq(groupCampuses([], '', '').length, 0, '空输入');

console.log('\n=== 鸿蒙侧补充边界 ===');
// 大小写不敏感的 null 清洗（服务端哪天改大小写不该让页面重新长出 null 校区）
{
  const weird = b('某栋楼', 'A', 'NULL', 'Null');
  const g = groupCampuses([lx1, weird], '', '');
  ok(g.every((x) => x.campusName.toLowerCase().indexOf('null') < 0), 'NULL/Null 一样清洗');
}
// 代码给了就必须按代码判：名字再匹配也不换组（源码 when 分支顺序）
{
  const g = groupCampuses([lx1, zg], 'ZG', '良乡校区');
  eq(g[0].campusName, '中关村校区', '代码优先：ZG 当前，尽管名字写的是良乡');
  ok(g[0].isCurrent === true && g[1].isCurrent === false, '只有代码匹配组 isCurrent');
}
// 代码有、名字空的组：显示名退化成代码（不是未归类）
{
  const g = groupCampuses([b('信科楼', 'X', '', 'XK')], '', '');
  eq(g[0].campusCode, 'XK', '键=代码');
  eq(g[0].campusName, 'XK', '名字空 ⇒ 显示代码');
}
// 同一校区多栋楼的顺序 + 当前校区插在中间时也要排最前
{
  const g = groupCampuses([zg, lx1, zg2(), lx2], 'LX', '良乡校区');
  eq(g[0].campusName, '良乡校区', '当前校区排最前（即使第一个是中关村）');
  eq(g[0].buildings.map((x) => x.buildingName).join(','), '综合教学楼,理科教学楼', '组内顺序不乱');
  eq(g[1].campusName, '中关村校区', '其余保持服务端顺序');
}
function zg2() { return b('中心教学楼', 'D', '中关村校区', 'ZG'); }

console.log('\n' + (failed === 0 ? 'ALL PASS' : 'FAILED') + '  pass=' + passed + ' fail=' + failed);
process.exit(failed === 0 ? 0 : 1);
