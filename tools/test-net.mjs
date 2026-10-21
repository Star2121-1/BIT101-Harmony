/**
 * 校园网逻辑单测（M5-2）—— 1:1 移植 Android：
 *  - data/src/test/.../CampusNetLogicTest.kt（CSV 解析 + 三类结果 + 文案）
 *  - data/src/test/.../CampusNetTrafficLogicTest.kt（采样/周期重置/趋势/预测）
 *
 * ⚠️ fixture 用**合成学号与 IP**：真实响应含学号/IP（2026-10-21 本机实测形态
 *    与字段位置完全一致），公开仓库不留个人数据。字节数/余额不是身份信息，保留。
 *
 * 这里最该锁死的是**计费周期重置**：接口 [6] 换周期会归零，不检测就会算出负增量。
 *
 * 跑法：node --experimental-strip-types tools/test-net.mjs
 */

import {
  parse,
  parseResult,
  infoOrNull,
  trafficStatusText,
  formatTraffic,
  formatDuration,
  formatTime,
  LIMIT_BYTES,
  WARN_BYTES
} from '../entry/src/main/ets/corelogic/CampusNetLogic.ts';
import {
  append,
  trend,
  encode,
  decode,
  todayText,
  forecastText,
  emptyTrafficTrend,
  monthLastEpochDay,
  MAX_DAYS
} from '../entry/src/main/ets/corelogic/CampusNetTrafficLogic.ts';
import { shanghaiEpochDay } from '../entry/src/main/ets/corelogic/CampusCardBalanceLogic.ts';

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
    console.log('FAIL ' + msg + '\n  expect=' + JSON.stringify(expected) + '\n  actual=' + JSON.stringify(actual));
  }
}

/** 2026-09-day hh:00 东八区 → epoch 毫秒。 */
function at(day, hour) {
  return Date.UTC(2026, 8, day, (hour === undefined ? 10 : hour) - 8, 0);
}

/** 2026-09-22 的 epoch day（趋势的「今天」）。 */
const nowDay = shanghaiEpochDay(at(22, 12));

const GB = 1024 * 1024 * 1024;

// 真实响应形态（2026-09-24 抓取），学号/IP 换成合成值
const sample =
  '2024010101,1790237818,1790242108,373674937,147058240,0,389049551406,7156454,' +
  '10.1.2.3,0,,40.01,0,0,0,0,0,0,0,0,0,1.01.20220802';

console.log('=== 1. CSV 解析 ===');
const info = parse(sample);
eq(info !== null, true, '真实形态样本可解析');
eq(info.userName, '2024010101', '账号');
eq(info.loginEpochSeconds, 1790237818, '上线时间');
eq(info.nowEpochSeconds, 1790242108, '服务器时间');
eq(info.bytesIn, 373674937, '本次收字节');
eq(info.bytesOut, 147058240, '本次发字节');
eq(info.bytesTotal, 389049551406, '本周期累计流量');
eq(info.durationSeconds, 7156454, '累计在线时长');
eq(info.ip, '10.1.2.3', 'IP');
eq(info.balanceYuan, 40.01, '账户余额');

eq(parse('not_online_error'), null, 'not_online 不是 CSV → null');
eq(parse(''), null, '空串 → null');
eq(parse('<html>error</html>'), null, '错误页 → null');
eq(parse('2024010101,1790237818,1790242108,1,2'), null, '字段不足 → null（不能越界）');
eq(parse('2024010101,NaN,1790242108,1,2,0,3,4,10.0.0.1,0,,x,0'), null, '数字字段损坏 → null 而不是抛异常');
eq(parse('a b,1790237818,1790242108,1,2,0,3,4,10.0.0.1,0,,1.5,0'), null, '账号含空格 → null');
eq(parse(',1790237818,1790242108,1,2,0,3,4,10.0.0.1,0,,1.5,0'), null, '账号为空 → null');

console.log('\n=== 2. 三类结果（UI 文案全靠这个区分） ===');
eq(parseResult(sample).kind, 'online', '有数据 → online');
eq(infoOrNull(parseResult(sample)).balanceYuan, 40.01, 'online 里带 info');
eq(parseResult('not_online').kind, 'notOnline', 'not_online → notOnline');
eq(parseResult('Not_Online\n').kind, 'notOnline', '大小写/换行不敏感');
eq(parseResult('<html>error</html>').kind, 'failed', '错误页 → failed');
eq(parseResult('').kind, 'failed', '空串 → failed');
eq(infoOrNull(parseResult('not_online')), null, 'notOnline 无 info');
eq(infoOrNull(parseResult('<html>x</html>')), null, 'failed 无 info');

console.log('\n=== 3. 格式化文案 ===');
eq(formatTraffic(389049551406), '362.3 GB', '字节 → GB（1 位小数）');
eq(formatTraffic(1610612736), '1.5 GB', '1.5 GB');
eq(formatTraffic(107374182), '0.1 GB', '0.1 GB');
eq(formatDuration(300), '5 分钟', '5 分钟');
eq(formatDuration(7500), '2 小时 5 分', '2 小时 5 分');
eq(formatDuration(2 * 86400 + 3 * 3600), '2 天 3 小时', '2 天 3 小时');
eq(/^\d{2}-\d{2} \d{2}:\d{2}$/.test(formatTime(1790237818)), true, '时间格式 MM-dd HH:mm');
eq(info.nowEpochSeconds >= info.loginEpochSeconds, true, '服务器时间在登录时间之后');
eq(info.durationSeconds >= 0, true, '在线时长非负');

eq(trafficStatusText(393385877215), '366.4 GB / 300.0 GB（已超限速阈值）', '超限要标出');
eq(trafficStatusText(100 * GB), '100.0 GB / 300.0 GB', '未超不标');
eq(trafficStatusText(LIMIT_BYTES), '300.0 GB / 300.0 GB（已超限速阈值）', '阈值边界算「已超」');
eq(WARN_BYTES, 270 * GB, '提前提醒线 270 GB');

console.log('\n=== 4. 采样追加（周期重置是重点） ===');
const beforeReset = [
  { atMillis: at(10), bytes: 50 * GB },
  { atMillis: at(15), bytes: 290 * GB }
];
const afterReset = append(beforeReset, 3 * GB, at(23), shanghaiEpochDay);
eq(afterReset.length, 1, '周期重置：旧采样全部作废');
eq(afterReset[0].bytes, 3 * GB, '重置后只留新值');
eq(afterReset[0].atMillis, at(23), '重置后时刻正确');

const grow = append([{ atMillis: at(20), bytes: 100 * GB }], 110 * GB, at(21), shanghaiEpochDay);
eq(grow.length, 2, '正常增长 → 追加');
eq(grow[1].bytes, 110 * GB, '追加值正确');

eq(append([{ atMillis: at(22), bytes: 130 * GB }], 130 * GB, at(22, 12), shanghaiEpochDay).length,
  1, '同一天同一个值不重复记');
eq(append([{ atMillis: at(22), bytes: 130 * GB }], 135 * GB, at(22, 12), shanghaiEpochDay).length,
  2, '同一天不同值要保留（今日用量靠它）');
const neg = [{ atMillis: at(22), bytes: 130 * GB }];
eq(append(neg, -1, at(22, 12), shanghaiEpochDay), neg, '负数用量不记');
eq(MAX_DAYS, 120, 'MAX_DAYS 与 Android 一致');

console.log('\n=== 5. 趋势与月末预测 ===');
eq(trend([], nowDay, shanghaiEpochDay), emptyTrafficTrend(), '没有采样 → 趋势全空');
eq(todayText(emptyTrafficTrend()), null, '空趋势无今日文案');
eq(forecastText(emptyTrafficTrend()), null, '空趋势无预测文案');

eq(trend([{ atMillis: at(22), bytes: 130 * GB }], nowDay, shanghaiEpochDay).todayBytes,
  null, '今天只采一次 → 今日用量 null');

const twoToday = trend([
  { atMillis: at(21), bytes: 110 * GB },
  { atMillis: at(22, 8), bytes: 130 * GB },
  { atMillis: at(22, 12), bytes: 135 * GB }
], nowDay, shanghaiEpochDay);
eq(twoToday.usedBytes, 135 * GB, '已用 = 最新采样');
eq(twoToday.todayBytes, 5 * GB, '今日用量 = 今天最早到最新');
eq(todayText(twoToday), '5.0 GB', '今日用量文案');
eq(trend([{ atMillis: at(22), bytes: 130 * GB }], nowDay, shanghaiEpochDay).todayBytes,
  null, '单条采样今日文案为 null（UI 显示 —，不是 0）');

const threeDays = trend([
  { atMillis: at(20), bytes: 100 * GB },
  { atMillis: at(21), bytes: 110 * GB },
  { atMillis: at(22), bytes: 130 * GB }
], nowDay, shanghaiEpochDay);
eq(threeDays.spanDays, 2, '日均按自然日跨度算（9/20→9/22 = 2 天）');
eq(threeDays.dailyAverageBytes, 15 * GB, '日均 15 GB');
eq(threeDays.projectedMonthBytes, 250 * GB, '月末预测 = 130 + 15×8 = 250 GB');
eq(forecastText(threeDays), '日均 15.0 GB（近 2 天） · 月末约 250.0 GB', '日均+预测文案');
eq(forecastText(threeDays, 150 * GB).indexOf('会超限速阈值') >= 0, true, '预测越过阈值要警示');
eq(forecastText(threeDays, 150 * GB).indexOf('月末约 250.0 GB') >= 0, true, '警示里仍带预测值');

const sameDay = trend([
  { atMillis: at(22, 8), bytes: 130 * GB },
  { atMillis: at(22, 12), bytes: 135 * GB }
], nowDay, shanghaiEpochDay);
eq(sameDay.dailyAverageBytes, null, '同一天的采样算不出日均');
eq(sameDay.spanDays, 0, '跨度 0');
eq(sameDay.projectedMonthBytes, null, '算不出预测就 null');
eq(forecastText(sameDay), null, '采样不足时预测文案为空');

const lastDay = shanghaiEpochDay(at(30, 12));
const monthEnd = trend([
  { atMillis: at(29), bytes: 200 * GB },
  { atMillis: at(30), bytes: 210 * GB }
], lastDay, shanghaiEpochDay);
eq(monthEnd.projectedMonthBytes, 210 * GB, '月末当天剩余 0 天 → 预测 = 已用');
eq(monthLastEpochDay(lastDay), lastDay, 'monthLastEpochDay 在月末当天自指');
eq(monthLastEpochDay(nowDay) - nowDay, 8, '9/22 → 9/30 剩 8 天');

const outside = trend([
  { atMillis: at(1), bytes: 0 },
  { atMillis: at(20), bytes: 100 * GB },
  { atMillis: at(22), bytes: 130 * GB }
], nowDay, shanghaiEpochDay);
eq(outside.spanDays, 2, '窗口外老采样不作为基准');
eq(outside.dailyAverageBytes, 15 * GB, '基准取窗口内最早（9/20 的 100 GB）');

// 窗口为空（最新采样也早于 7 天前）→ 退化成只报最新，不崩
const stale = trend([{ atMillis: at(1), bytes: 10 * GB }], nowDay, shanghaiEpochDay);
eq(stale.spanDays, 0, '窗口为空 → 跨度 0，不崩');
eq(stale.dailyAverageBytes, null, '窗口为空 → 日均 null');
eq(stale.usedBytes, 10 * GB, '窗口为空仍报已用');

console.log('\n=== 6. 编解码 ===');
eq(decode(encode([
  { atMillis: at(20), bytes: 100 * GB },
  { atMillis: at(22), bytes: 130 * GB + 12345 }
])), [
  { atMillis: at(20), bytes: 100 * GB },
  { atMillis: at(22), bytes: 130 * GB + 12345 }
], '编解码往返');
eq(decode('1000|2000\n坏了的行\n\n3000|abc').length, 1, '形状不对的行整条丢弃');
eq(decode(null).length, 0, 'null → 空表');
eq(decode('').length, 0, '空串 → 空表');

console.log('\n' + (failed === 0 ? 'ALL PASS' : 'FAILED') + '  pass=' + passed + ' fail=' + failed);
process.exit(failed > 0 ? 1 : 0);
