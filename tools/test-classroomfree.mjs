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

import {
  currentSection, isFreeNow, nextBusyStartMinutes,
  DEFAULT_FREE_MINUTES, DEFAULT_HIDE_BUSY
} from '../entry/src/main/ets/corelogic/ClassroomFree.ts';
import { FALLBACK_TIME_TABLE } from '../entry/src/main/ets/corelogic/TimeTableLogic.ts';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const __root = join(dirname(fileURLToPath(import.meta.url)), '..');
const code = (p) => readFileSync(join(__root, p), 'utf8');

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

console.log('\n=== G07-02：空闲阈值（默认 5，对齐 Android）===');
eq(DEFAULT_FREE_MINUTES, 5, '默认阈值 5 分钟（A:FreeClassroomViewModel.kt:23，不是历史误写的 0）');
eq(DEFAULT_HIDE_BUSY, true, '默认隐藏当前不空闲（A:FreeClassroomViewModel.kt:22）');
// nextBusyStartMinutes：第2节 08:50=530 开始；now=08:46=526 课间
eq(nextBusyStartMinutes([2], T, 8 * 60 + 46), 8 * 60 + 50, '下一占用节起点=第2节 08:50');
eq(nextBusyStartMinutes([2], T, 8 * 60 + 50), -1, 'now 已在第2节内时不再把它当"下一个"（-1=今天再无）');
eq(nextBusyStartMinutes([], T, 8 * 60), -1, '无占用节 → -1（对应 LocalTime.MAX）');
// 临界样本：占用节 08:50 开始、now=08:46，空档只有 4 分钟
ok(isFreeNow([2], T, 8 * 60 + 46, 0) === true, '阈值 0：空档 4 分钟 ≥ 0 → 空闲');
ok(isFreeNow([2], T, 8 * 60 + 46, 5) === false, '阈值 5：空档 4 分钟 < 5 → 不算空闲（两值结果不同）');
ok(isFreeNow([2], T, 8 * 60 + 46) === false, '不传阈值走默认 5 → 占用');
ok(isFreeNow([2], T, 8 * 60 + 40, 5) === true, '空档 10 分钟 ≥ 5 → 空闲（非临界侧不误杀）');
ok(isFreeNow([5], T, 12 * 60 + 20, 5) === true, '午间 12:20 距第5节(13:20) 60 分钟 → 空闲');

console.log('\n=== G07-01/02：源码接线守卫（静态）===');
const settingsSrc = code('entry/src/main/ets/pages/SettingsPage.ets');
const classSrc = code('entry/src/main/ets/pages/ClassroomPage.ets');
const storeSrc = code('entry/src/main/ets/data/ClassroomSettings.ts');
const freeSrc = code('entry/src/main/ets/corelogic/ClassroomFree.ts');
ok(settingsSrc.includes("this.groupTitle('空教室')"), '设置页有空教室设置组');
ok(settingsSrc.includes('隐藏当前不空闲的教室') && settingsSrc.includes('toggleHideBusy(on)'),
  '设置页有隐藏开关且绑定 toggleHideBusy');
ok(settingsSrc.includes('空闲时段阈值') && settingsSrc.includes('this.saveMinutes()'),
  '设置页有阈值设置且能保存');
ok(settingsSrc.includes('空闲时段阈值已设为'), '保存成功有可见反馈（非静默）');
ok(classSrc.includes('this.visibleRooms()') && classSrc.includes('this.hideBusy && this.rooms.length'),
  '空教室页按 hideBusy 过滤列表且处理整栋被过滤的空态');
ok(classSrc.includes('this.nowMinutes, this.freeMinutes'), 'roomFree 把阈值传给 isFreeNow');
ok(classSrc.includes('loadHideBusyClassroom()') && classSrc.includes('loadFreeMinutes()'),
  '空教室页加载两项设置');
ok(!freeSrc.includes('默认 0'), '源码注释不再写"默认 0"（订正历史错误）');
ok(storeSrc.includes('DEFAULT_FREE_MINUTES, DEFAULT_HIDE_BUSY'), '设置存储从 corelogic 取默认值（单一来源）');
ok(storeSrc.includes('Number.isInteger(value)') && storeSrc.includes('value > 120'),
  '阈值归一化拦脏值（非整数 / 越界回落默认）');

console.log('\n' + (failed === 0 ? 'ALL PASS' : 'FAILED') + '  pass=' + passed + ' fail=' + failed);
process.exit(failed === 0 ? 0 : 1);
