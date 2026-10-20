/**
 * 边界自查（M2-9）：周次串 / 周次包含 / 周次换算 / 日期合法性 / 可渲染判据 / 有效星期。
 *
 * 这些函数是课表一切渲染的判据，边界错一天 = 学生少上一节课，所以逐条钉死。
 * 跑法：node --experimental-strip-types tools/test-edges.mjs
 */

import { skzcToWeeks, maxWeekOf, parseCourseRow, isRenderableCourse } from '../entry/src/main/ets/core/model/SchoolModels.ts';
import { weeksContains, weekOf, effectiveWeekday } from '../entry/src/main/ets/corelogic/CourseWeekdayLogic.ts';
import { dayOfWeekMon1 } from '../entry/src/main/ets/corelogic/timeutil.ts';
import { epochDayOf } from '../entry/src/main/ets/corelogic/TeachingAdjustmentParser.ts';

let pass = 0;
let fail = 0;

function eq(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    pass++;
  } else {
    fail++;
    console.log('FAIL  ' + msg + '\n      实际=' + a + ' 期望=' + e);
  }
}

// ── SKZC「01 串」→「[n]」标记 ─────────────────────────────────────────
// 对照 Android CourseScheduleEntity.toEntity：'1' 的位置 index+1 变成 [index+1]

eq(skzcToWeeks('1'), '[1]', 'SKZC 只有第 1 周');
eq(skzcToWeeks('111'), '[1][2][3]', 'SKZC 前三周');
eq(skzcToWeeks('1100'), '[1][2]', 'SKZC 1、2 周（后面全 0）');
eq(skzcToWeeks('00000000001000000000'), '[11]', 'SKZC 第 11 周');
eq(skzcToWeeks(''), '', 'SKZC 空串');
eq(skzcToWeeks('0000'), '', 'SKZC 全 0');
// 21 个 1（一学期满周）
eq(skzcToWeeks('1'.repeat(21)).split('][' ).length, 21, 'SKZC 21 周全命中');

// ── maxWeekOf ────────────────────────────────────────────────────────
eq(maxWeekOf('1100'), 4, 'maxWeek 取串长（不是最后一个 1 的位置）');
eq(maxWeekOf(''), 0, 'maxWeek 空串 = 0');
eq(maxWeekOf('1'), 1, 'maxWeek 单周');

// ── weeksContains：必须按**完整标记**匹配 ─────────────────────────────
// 这是最容易栽的一条：'[11]' 里不能把 '[1]' 当成命中
eq(weeksContains('[11]', 1), false, '第 11 周不含第 1 周（字符串子串陷阱）');
eq(weeksContains('[11]', 11), true, '第 11 周含第 11 周');
eq(weeksContains('[1][2]', 1), true, '1、2 周含第 1 周');
eq(weeksContains('[1][2]', 2), true, '1、2 周含第 2 周');
eq(weeksContains('[1][2]', 3), false, '1、2 周不含第 3 周');
eq(weeksContains('[1][11]', 11), true, '1、11 周含第 11 周');
eq(weeksContains('', 1), false, '空串不含任何周');

// ── weekOf：开学日在第一周的周一 ─────────────────────────────────────
const first = epochDayOf(2026, 8, 31); // 周一
eq(weekOf(first, first), 1, '开学当天 = 第 1 周');
eq(weekOf(first, first + 6), 1, '开学后第 6 天仍是第 1 周');
eq(weekOf(first, first + 7), 2, '开学后第 7 天 = 第 2 周');
eq(weekOf(first, first + 20), 3, '开学后第 20 天 = 第 3 周');
eq(weekOf(first, first - 1), -1, '开学前一天判不出（-1，调用方跳过周次过滤）');
eq(weekOf(null, first), -1, '开学日未知返回 -1');

// ── 日期合法性：非法日期必须 -1，不许溢出到下一月 ─────────────────────
eq(epochDayOf(2026, 2, 30), -1, '2月30日非法');
eq(epochDayOf(2026, 13, 1), -1, '13 月非法');
eq(epochDayOf(2026, 0, 1), -1, '0 月非法');
eq(epochDayOf(2026, 4, 31), -1, '4月31日非法');
eq(epochDayOf(2026, 2, 29), -1, '2026 非闰年 2月29日非法');
eq(epochDayOf(2028, 2, 29) > 0, true, '2028 闰年 2月29日合法');

// ── isRenderableCourse：缺任一关键字段就不上屏 ───────────────────────
const base = { KCM: 'X', SKXQ: 1, KSJC: 1, JSJC: 2 };
eq(isRenderableCourse(parseCourseRow(base)), true, '正常行可渲染');
eq(isRenderableCourse(parseCourseRow({ ...base, KCM: '' })), false, '无课名不渲染');
eq(isRenderableCourse(parseCourseRow({ ...base, SKXQ: 0 })), false, '星期 0 不渲染');
eq(isRenderableCourse(parseCourseRow({ ...base, SKXQ: 8 })), false, '星期 8 不渲染');
eq(isRenderableCourse(parseCourseRow({ ...base, KSJC: 0 })), false, '开始节次 0 不渲染');
eq(isRenderableCourse(parseCourseRow({ ...base, KSJC: 3, JSJC: 2 })), false, '结束 < 开始 不渲染');
eq(isRenderableCourse(parseCourseRow({ ...base, KSJC: 13, JSJC: 13 })), true, '第 13 节可渲染');

// ── effectiveWeekday：放假 / 补课 / 无覆盖 ──────────────────────────
const MAKEUP_DAY = 100;
const HOLD_DAY = 200;
const NORMAL_DAY = 300;
const planOf = (d) => {
  if (d === MAKEUP_DAY) return { kind: 'MakeUp', targetWeekday: 4 };
  if (d === HOLD_DAY) return { kind: 'NoClass' };
  return null;
};
eq(effectiveWeekday(MAKEUP_DAY, planOf), 4, '补课日按被指定的星期几');
eq(effectiveWeekday(HOLD_DAY, planOf), null, '放假日返回 null（那天的课不作数）');
eq(effectiveWeekday(NORMAL_DAY, planOf), dayOfWeekMon1(NORMAL_DAY), '无覆盖用当天星期几');

// dayOfWeekMon1 基准：1970-01-01 是周四（4）
eq(dayOfWeekMon1(0), 4, 'epoch 0 = 1970-01-01 周四');

console.log('\n' + (fail === 0 ? 'ALL PASS' : 'HAS FAILURES') + '  pass=' + pass + ' fail=' + fail);
process.exitCode = fail === 0 ? 0 : 1;
