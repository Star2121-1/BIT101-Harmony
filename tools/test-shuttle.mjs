/**
 * 班车时刻表回归（M5-4）
 *
 * ⚠️ 时刻表是**逐条抄自站牌实拍照片**的（2026-09-27 用户提供），
 * 抄错一班车 = 用户在站台白等 20 分钟。所以班次数、严格递增、边界行为全部钉死。
 *
 * 跑法：node --experimental-transform-types tools/test-shuttle.mjs
 */

import {
  Stop, DayType, timetable, nextDeparture, remainingToday, dayTypeOf, countdownText, fmtDeparture,
  groupByHour, minuteText
} from '../entry/src/main/ets/corelogic/ShuttleLogic.ts';

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

function ok(cond, msg) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.log('FAIL  ' + msg);
  }
}

// ── 班次数：站牌上是 39 / 50 ─────────────────────────────────────────
const COMBO = [
  [Stop.LIBRARY, DayType.WORKDAY, 39, '图书馆·工作日'],
  [Stop.LIBRARY, DayType.WEEKEND_HOLIDAY, 50, '图书馆·周末节假日'],
  [Stop.METRO, DayType.WORKDAY, 39, '地铁站·工作日'],
  [Stop.METRO, DayType.WEEKEND_HOLIDAY, 50, '地铁站·周末节假日'],
];
for (const c of COMBO) {
  const list = timetable(c[0], c[1]);
  eq(list.length, c[2], c[3] + ' 班次数');
  // 严格递增（站牌是时间顺序，抄乱了两班会重叠）
  let increasing = true;
  for (let i = 1; i < list.length; i++) {
    if (list[i] <= list[i - 1]) {
      increasing = false;
      break;
    }
  }
  ok(increasing, c[3] + ' 严格递增');
  // 首班不早于 6:00、末班不晚于 24:00（合理范围，防止把 20:55 抄成 2055）
  ok(list[0] >= 6 * 60, c[3] + ' 首班不早于 6:00（实际 ' + fmtDeparture(list[0]) + '）');
  ok(list[list.length - 1] <= 24 * 60, c[3] + ' 末班不晚于 24:00（实际 ' + fmtDeparture(list[list.length - 1]) + '）');
}

// ── nextDeparture 边界 ──────────────────────────────────────────────
const wd = timetable(Stop.LIBRARY, DayType.WORKDAY);
const first = wd[0];
const last = wd[wd.length - 1];

eq(nextDeparture(Stop.LIBRARY, DayType.WORKDAY, 0)?.at, first, '早于首班 ⇒ 返回首班');
eq(nextDeparture(Stop.LIBRARY, DayType.WORKDAY, first)?.at, first, '恰好在首班时刻 ⇒ 就是首班');
eq(nextDeparture(Stop.LIBRARY, DayType.WORKDAY, last)?.at, last, '恰好在末班时刻 ⇒ 就是末班');
eq(nextDeparture(Stop.LIBRARY, DayType.WORKDAY, last + 1), null, '晚于末班 ⇒ null（不绕回明天）');

const nx = nextDeparture(Stop.LIBRARY, DayType.WORKDAY, first + 1);
ok(nx !== null && nx.remaining === wd.length - 1, '过了首班后剩余班次 = 总数-1');

// ── remainingToday ─────────────────────────────────────────────────
eq(remainingToday(Stop.LIBRARY, DayType.WORKDAY, 0).length, wd.length, '0 点时今天还剩全部');
eq(remainingToday(Stop.LIBRARY, DayType.WORKDAY, last + 1).length, 0, '末班后剩余 0');

// ── dayTypeOf：只按星期（6/7 = 周末）────────────────────────────────
// 2026-08-31 是周一（epoch 由外部算法保证，这里用已知值）
function epochOf(y, m, d) {
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}
eq(dayTypeOf(epochOf(2026, 8, 31)), DayType.WORKDAY, '周一 = 工作日表');
eq(dayTypeOf(epochOf(2026, 9, 5)), DayType.WEEKEND_HOLIDAY, '周六 = 周末表');
eq(dayTypeOf(epochOf(2026, 9, 6)), DayType.WEEKEND_HOLIDAY, '周日 = 周末表');
eq(dayTypeOf(epochOf(2026, 9, 7)), DayType.WORKDAY, '周一 = 工作日表（跨周边界）');

// ── 文案 ───────────────────────────────────────────────────────────
eq(countdownText(0), '即将发车', '0 分钟文案');
eq(countdownText(5), '5 分钟后', '分钟文案');
eq(countdownText(90), '1 小时 30 分钟后', '跨小时文案');

// ── groupByHour：展示分组（#86 从页内提纯）─────────────────────────
// 对齐原版 composable 的 times.groupBy { it.hour }.toSortedMap()
const wdList = timetable(Stop.LIBRARY, DayType.WORKDAY);
const groups = groupByHour(wdList);
// ① 不重不漏：拼回去必须等于原表（丢一班车 = 用户在站台白等）
const flat = [];
for (const g of groups) {
  for (const m of g.minutes) flat.push(m);
}
eq(flat, wdList, '分组拼回去 = 原表（不重不漏，升序输入）');
// ② 组按小时升序（扫读顺序；原版 toSortedMap）
let asc = true;
for (let i = 1; i < groups.length; i++) {
  if (groups[i].hour <= groups[i - 1].hour) asc = false;
}
ok(asc, '组间按小时严格升序');
// ③ 每组的分钟都属于该小时（7:30 不能显示在「8 时」行）
let allInHour = true;
for (const g of groups) {
  for (const m of g.minutes) {
    if (Math.floor(m / 60) !== g.hour) allInHour = false;
  }
}
ok(allInHour, '组内分钟都属于该小时（不放错行）');
// ④ 组数 = 表里不同小时数
const hourSet = new Set(wdList.map((t) => Math.floor(t / 60)));
eq(groups.length, hourSet.size, '组数 = 不同小时数');
// ⑤ 乱序输入也按小时升序且同小时合并（对齐 groupBy+toSortedMap 语义）
eq(groupByHour([482, 450, 498, 466]), [
  { hour: 7, minutes: [450, 466] },
  { hour: 8, minutes: [482, 498] },
], '乱序输入：同小时合并 + 组间升序');
// ⑥ 空表 → 空分组（调用方按「今天已发完」处理）
eq(groupByHour([]), [], '空表 → 空分组');
// ⑦ 单班次 / 跨到 23 时
eq(groupByHour([1439]), [{ hour: 23, minutes: [1439] }], '23:59 单班归 23 时组');

// ── minuteText：两位分钟串（原版 "%02d".format(t.minute)）──────────
eq(minuteText(450), '30', '07:30 → 30');
eq(minuteText(427), '07', '07:07 → 07（补零）');
eq(minuteText(0), '00', '00:00 → 00');
eq(minuteText(1439), '59', '23:59 → 59');

console.log('\n' + (fail === 0 ? 'ALL PASS' : 'HAS FAILURES') + '  pass=' + pass + ' fail=' + fail);
process.exitCode = fail === 0 ? 0 : 1;
