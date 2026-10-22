/**
 * 作息表规则单测（M6-2）
 *
 * 为什么值得单测：一张**半对**的作息表比没有更糟 —— 它会算出错误的「现在上什么课」，
 * 而且用户很难察觉（时间列看起来是正常的）。
 *
 * 跑法：node --experimental-transform-types tools/test-timetable.mjs
 */

import {
  validateTimeTable, makeDefaultTable, minutesToHM, hmToMinutes, SECTION_COUNT
} from '../entry/src/main/ets/corelogic/TimeTableRules.ts';
import { FALLBACK_TIME_TABLE } from '../entry/src/main/ets/corelogic/TimeTableLogic.ts';
import { courseTimeText } from '../entry/src/main/ets/corelogic/TimeTableLogic.ts';

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
  const okv = JSON.stringify(actual) === JSON.stringify(expected);
  if (okv) {
    passed++;
  } else {
    failed++;
    console.log('FAIL ' + msg + ' => ' + JSON.stringify(actual) + ' (expected ' + JSON.stringify(expected) + ')');
  }
}

console.log('=== 1. 官方表必须合法 ===');
eq(validateTimeTable(FALLBACK_TIME_TABLE), '', '学校官方表校验通过');
eq(FALLBACK_TIME_TABLE.length, SECTION_COUNT, '官方表 13 节');

console.log('\n=== 2. 各种非法输入都要被拦下（并说明原因）===');
const short = makeDefaultTable().slice(0, 12);
eq(validateTimeTable(short), '节数应为 13，实际 12', '节数不足');

const reversed = makeDefaultTable();
reversed[0] = { startMinutes: 600, endMinutes: 540 };
ok(validateTimeTable(reversed).includes('必须晚于开始'), '结束早于开始');

const overlap = makeDefaultTable();
overlap[1] = { startMinutes: 500, endMinutes: 560 }; // 第 1 节 08:00-08:45(480-525)
ok(validateTimeTable(overlap).includes('重叠'), '与上一节重叠');

const negative = makeDefaultTable();
negative[0] = { startMinutes: -5, endMinutes: 45 };
ok(validateTimeTable(negative).includes('越界'), '开始时刻为负');

const tooLate = makeDefaultTable();
tooLate[12] = { startMinutes: 1400, endMinutes: 1500 };
ok(validateTimeTable(tooLate).includes('不合法'), '结束超过 1440');

const sameTime = makeDefaultTable();
sameTime[0] = { startMinutes: 480, endMinutes: 480 };
ok(validateTimeTable(sameTime).length > 0, '开始=结束也算非法');

console.log('\n=== 3. 深拷贝：改副本不能污染常量 ===');
const copy = makeDefaultTable();
const origFirst = FALLBACK_TIME_TABLE[0].startMinutes;
copy[0] = { startMinutes: 999, endMinutes: 1000 };
eq(FALLBACK_TIME_TABLE[0].startMinutes, origFirst, 'FALLBACK 未被副本改动');
ok(copy[0].startMinutes === 999, '副本本身确实改了');

console.log('\n=== 4. 时间格式化往返 ===');
eq(minutesToHM(480), '08:00', '480 → 08:00');
eq(minutesToHM(0), '00:00', '0 → 00:00');
eq(minutesToHM(1439), '23:59', '1439 → 23:59');
eq(minutesToHM(1440), '', '1440 越界返回空串');
eq(minutesToHM(-1), '', '-1 越界返回空串');
eq(hmToMinutes('08:00'), 480, '08:00 → 480');
eq(hmToMinutes('23:59'), 1439, '23:59 → 1439');
eq(hmToMinutes('8:00'), -1, '单位数小时格式非法');
eq(hmToMinutes('25:00'), -1, '25:00 非法');
eq(hmToMinutes('08:60'), -1, '08:60 非法');
eq(hmToMinutes(''), -1, '空串非法');

// 官方表 13 节往返全部一致
let roundTripOk = true;
for (const it of FALLBACK_TIME_TABLE) {
  if (hmToMinutes(minutesToHM(it.startMinutes)) !== it.startMinutes) roundTripOk = false;
  if (hmToMinutes(minutesToHM(it.endMinutes)) !== it.endMinutes) roundTripOk = false;
}
ok(roundTripOk, '13 节起止时刻往返全部一致');

console.log('\n=== 5. 自定义作息真的影响课表时间文案 ===');
const custom = makeDefaultTable();
// ⚠️ 改第 1 节要连结束时刻一起看：第 2 节 08:50 开始，
// 若把第 1 节改成 08:30-09:15 就会**重叠**（那一版测试数据是错的，校验器把它拦下来了 —— 正说明校验有效）。
// 这里改成 08:30-08:45 才合法。
custom[0] = { startMinutes: 510, endMinutes: 525 };
eq(validateTimeTable(custom), '', '自定义表本身合法');

// 顺带钉住「重叠会被拦」这条：08:30-09:15 压到第 2 节的 08:50
const wouldOverlap = makeDefaultTable();
wouldOverlap[0] = { startMinutes: 510, endMinutes: 555 };
ok(validateTimeTable(wouldOverlap).includes('重叠'), '第 1 节拖到 09:15 会压到第 2 节，被拦下');
const beforeText = courseTimeText(FALLBACK_TIME_TABLE, 1, 1);
const afterText = courseTimeText(custom, 1, 1);
ok(beforeText !== afterText, '改第 1 节后时间文案发生变化（' + beforeText + ' → ' + afterText + '）');
ok(afterText.includes('08:30'), '新文案含 08:30');
ok(!afterText.includes('08:00'), '新文案不含 08:00');

// 只改第 1 节时，第 2 节不应受影响
eq(courseTimeText(custom, 2, 2), courseTimeText(FALLBACK_TIME_TABLE, 2, 2), '未改动的节次文案不变');

console.log('\n' + (failed === 0 ? 'ALL PASS' : 'FAILED') + '  pass=' + passed + ' fail=' + failed);
process.exit(failed === 0 ? 0 : 1);
