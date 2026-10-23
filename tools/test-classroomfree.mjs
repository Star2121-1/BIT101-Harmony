/**
 * 空教室「现在是否空闲」测试（#85）
 * =========================================================
 * 判据三条：
 * 1. **对齐原版语义**：Android `isFreeNow = nextBusyTime == MAX || nextBusyTime >= now`
 *    —— 下一段占用还没到（含课间/课外）就算空闲。逐场景对照，不是只测Happy Path。
 * 2. **区间口径 [start, end)**：下课瞬间算课间（原版 nextBusyTime 也是「下一段开始」）。
 * 3. 边界：空表、越界时刻、全天占用、全天空闲。
 *
 * 跑法：node --experimental-transform-types tools/test-classroomfree.mjs
 */

import { currentSection, isFreeNow } from '../entry/src/main/ets/corelogic/ClassroomFree.ts';
import { FALLBACK_TIME_TABLE } from '../entry/src/main/ets/corelogic/TimeTableLogic.ts';

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

const T = FALLBACK_TIME_TABLE; // 1: 08:00-08:45 / 2: 08:50-09:35 / 3: 09:55-10:40 / … / 13: 20:10-20:55

console.log('=== currentSection：节内 / 边界 / 课间 / 课外 ===');
eq(currentSection(T, 8 * 60 + 0), 1, '08:00（第1节开始，含端点）→ 1');
eq(currentSection(T, 8 * 60 + 44), 1, '08:44 → 1');
eq(currentSection(T, 8 * 60 + 45), null, '08:45（第1节结束瞬间）→ 课间');
eq(currentSection(T, 8 * 60 + 50), 2, '08:50 → 2');
eq(currentSection(T, 12 * 60 + 20), null, '12:20（第5节结束）→ 午间');
eq(currentSection(T, 13 * 60 + 20), 6, '13:20 → 6');
eq(currentSection(T, 20 * 60 + 54), 13, '20:54 → 13');
eq(currentSection(T, 20 * 60 + 55), null, '20:55（第13节结束）→ null');
eq(currentSection(T, 7 * 60 + 59), null, '07:59（早于第1节）→ null');
eq(currentSection(T, 23 * 60 + 30), null, '23:30 → null');
eq(currentSection([], 8 * 60), null, '空表 → null（不编节次）');

console.log('\n=== isFreeNow：对齐原版 nextBusyTime>=now 语义 ===');
// 占用节 = [3]（09:55-10:40），now=10:00（第3节内）⇒ nextBusyTime=09:55 < 10:00 → 占用
ok(isFreeNow([3], T, 10 * 60) === false, '第3节占用中 10:00 → 占用');
// ⚠️ 与原版的唯一边界差异（如实钉住，不装作一致）：
// 原版 isFreeNow 用 `nextBusyTime >= now + threshold*60`，threshold 默认 0，
// 「正好踩在节开始瞬间」（now == nextBusyTime）算**空闲**；本端口按 [start, end)
// 判**占用**——课在 09:55:00 就开始，报占用更诚实。差的是每节开头一瞬，不影响观感。
ok(isFreeNow([3], T, 9 * 60 + 55) === false, '09:55 第3节开始瞬间 → 占用（与原版 >= 边界差一瞬，取诚实侧）');
// 课间：占用节=[1,3]，now=08:45 ⇒ nextBusyTime=09:55 >= 08:45 → 空闲
ok(isFreeNow([1, 3], T, 8 * 60 + 45) === true, '课间 08:45（1、3节占用）→ 空闲');
// 下一节还没开始：占用节=[2]，now=08:00（第1节内）⇒ nextBusyTime=08:50 >= 08:00 → 空闲
ok(isFreeNow([2], T, 8 * 60 + 0) === true, '第2节待占用 08:00 → 空闲');
ok(isFreeNow([2], T, 8 * 60 + 50) === false, '第2节占用中 08:50 → 占用');
// 全天占用 / 全天空闲
ok(isFreeNow([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13], T, 8 * 60 + 10) === false, '全天占用 → 占用');
ok(isFreeNow([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13], T, 12 * 60 + 30) === true, '全天占用但午间 → 空闲（课间无课）');
ok(isFreeNow([], T, 8 * 60 + 10) === true, '无占用节 → 空闲');
ok(isFreeNow([], T, 7 * 60) === true, '无占用节且课外 → 空闲');
// 顺序无关（模型约定升序，但函数不该依赖顺序）
ok(isFreeNow([5, 1], T, 8 * 60 + 10) === false, '降序输入同样判占用（1节占用 08:10）');

console.log('\n=== 自定义作息表（用户改过时间表）===');
const custom = [
  { startMinutes: 9 * 60, endMinutes: 9 * 60 + 45 },
  { startMinutes: 10 * 60, endMinutes: 10 * 60 + 45 }
];
eq(currentSection(custom, 9 * 60 + 30), 1, '自定义表 09:30 → 1');
ok(isFreeNow([1], custom, 9 * 60 + 30) === false, '自定义表第1节占用 → 占用');
ok(isFreeNow([1], custom, 8 * 60) === true, '自定义表课前 → 空闲');

console.log('\n' + (failed === 0 ? 'ALL PASS' : 'FAILED') + '  pass=' + passed + ' fail=' + failed);
process.exit(failed === 0 ? 0 : 1);
