/**
 * M14-A 即时提醒接线单测。
 *
 * 两层判据：
 *  1. **纯逻辑**：流量跨周期状态机 / 本地日期键 / 借阅新键筛选，直接打真源码；
 *  2. **源码栅栏**：三个页面必须只在「取到数据成功」时调用 runner、开关必须落到设置页、
 *     去重标记必须在发布成功之后、通知深链白名单必须含两个目标页。
 *
 * 栅栏读源码统一按 `/\r?\n/` 切（工作副本可能是 CRLF，入库是 LF —— 2026-10-30 踩过）。
 */

import { readFileSync } from 'node:fs';
import {
  initialFlowAlertState,
  decideFlowState,
  localDateKey,
  localDateTime,
  freshLibKeys
} from '../entry/src/main/ets/corelogic/InstantAlertLogic.ts';
import { BorrowRecord } from '../entry/src/main/ets/corelogic/LibBorrowLogic.ts';
import { parseISODate } from '../entry/src/main/ets/corelogic/timeutil.ts';
import { LIMIT_BYTES, WARN_BYTES } from '../entry/src/main/ets/corelogic/CampusNetLogic.ts';

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
function text(rel) {
  return readFileSync(new URL(rel, import.meta.url), 'utf8').split(/\r?\n/);
}
function has(lines, needle) {
  return lines.some((l) => l.indexOf(needle) >= 0);
}
function idx(lines, needle) {
  return lines.findIndex((l) => l.indexOf(needle) >= 0);
}

const GB = 1024 * 1024 * 1024;

console.log('=== 1. 流量状态机（对照 Android NetFlowChecker.check）===');
eq(initialFlowAlertState(), { lastBytes: -1, warnedNear: false, warnedLimit: false }, '初始基线 -1');
{
  const d = decideFlowState(269 * GB, initialFlowAlertState());
  eq(d.alert, 'none', '269 GB 不发');
  eq(d.reset, false, '未换周期');
  eq(d.next.lastBytes, 269 * GB, '未达阈值也更新基线');
  eq(d.next.warnedNear, false, '未达阈值不置标记');
}
{
  const d = decideFlowState(WARN_BYTES, initialFlowAlertState());
  eq(d.alert, 'near', '270 GB 发接近');
  eq(d.next.warnedNear, true, '发接近后置 warnedNear');
  eq(d.next.warnedLimit, false, '接近不置超限标记');
}
{
  const state = { lastBytes: 280 * GB, warnedNear: true, warnedLimit: false };
  const d = decideFlowState(LIMIT_BYTES, state);
  eq(d.alert, 'exceeded', '已提醒 270 后到 300 仍发超限');
  eq(d.next.warnedNear, true, '超限同时置 warnedNear（防回落补发）');
  eq(d.next.warnedLimit, true, '超限置 warnedLimit');
}
{
  const state = { lastBytes: 310 * GB, warnedNear: true, warnedLimit: true };
  const d = decideFlowState(400 * GB, state);
  eq(d.alert, 'none', '两档都提醒过 → 静默');
  eq(d.next.lastBytes, 400 * GB, '基线仍刷新');
}
{
  const state = { lastBytes: 302 * GB, warnedNear: true, warnedLimit: true };
  const d = decideFlowState(88 * GB, state);
  eq(d.reset, true, '累计值回落 = 换计费周期');
  eq(d.alert, 'none', '复位当轮不提醒（Android 原行为）');
  eq(d.next, { lastBytes: 88 * GB, warnedNear: false, warnedLimit: false }, '复位清两枚标记');
  const next = decideFlowState(LIMIT_BYTES, d.next);
  eq(next.alert, 'exceeded', '新周期到 300 能重新提醒');
}
{
  const state = { lastBytes: 10 * GB, warnedNear: false, warnedLimit: false };
  const d = decideFlowState(Number.NaN, state);
  eq(d.alert, 'none', 'NaN 不发（不编造数字）');
  eq(d.next, state, 'NaN 不改状态');
  const neg = decideFlowState(-1, state);
  eq(neg.alert, 'none', '负字节不发');
  eq(neg.next, state, '负字节不改状态');
}

console.log('\n=== 2. 本地日期 / 时间 ===');
{
  const millis = new Date(2026, 10, 16, 12, 34, 0).getTime();
  eq(localDateKey(millis), '2026-11-16', '网费去重键用本地自然日');
  const dt = localDateTime(millis);
  eq(dt.day, parseISODate('2026-11-16'), '借阅天数用本地日历日');
  eq(dt.minutes, 12 * 60 + 34, '分钟取本地小时');
  eq(localDateKey(Number.NaN), '', '无效时刻不给假日期');
}

console.log('\n=== 3. 借阅新键筛选 ===');
{
  function rec(title, isbn, due) {
    const r = new BorrowRecord(title, '', isbn, '', null, null, due);
    return r;
  }
  const a = rec('A', '1', '2026-11-20');
  const b = rec('B', '2', '2026-11-21');
  const dup = rec('A', '1', '2026-11-20');
  eq(freshLibKeys([a, b], []), [a.key, b.key], '首次两条都算新');
  eq(freshLibKeys([a, b], [a.key]), [b.key], '已提醒过的不再发');
  eq(freshLibKeys([a, dup, b], []), [a.key, b.key], '同一次取数内重复键只算一次');
  eq(freshLibKeys([a], [a.key]), [], '全提醒过 → 空');
}

console.log('\n=== 4. 源码栅栏：接线点与纪律 ===');
{
  const net = text('../entry/src/main/ets/pages/NetPage.ets');
  ok(has(net, "import { ServiceAlertRunner }"), 'NetPage 引入编排层');
  ok(has(net, 'ServiceAlertRunner.checkNet(r.info)'), 'NetPage 在取到 online 后判定');
  const onlineGuard = idx(net, "if (r.kind === 'online')");
  const call = idx(net, 'ServiceAlertRunner.checkNet(r.info)');
  ok(onlineGuard >= 0 && call > onlineGuard, 'checkNet 位于 online 守卫之后');
  ok(!has(net, 'ServiceAlertRunner.checkNet(null)'), '不把「没数据」当在线数据传进去');
}
{
  const lib = text('../entry/src/main/ets/pages/LibBorrowPage.ets');
  ok(has(lib, 'ServiceAlertRunner.checkLib('), 'LibBorrowPage 引入判定');
  const guard = idx(lib, "if (this.current.kind === 'ok')");
  const call = idx(lib, 'ServiceAlertRunner.checkLib(');
  ok(guard >= 0 && call > guard, '只在 current=ok 时判定（取不到不静默吃掉）');
  ok(!has(lib, 'ServiceAlertRunner.checkLib(this.history'), '历史栏不参与提醒');
}
{
  const page = text('../entry/src/main/ets/pages/NotifySettingsPage.ets');
  ok(has(page, 'netAlertEnabled'), '设置页有网费/流量开关');
  ok(has(page, 'libAlertEnabled'), '设置页有借阅开关');
  ok(has(page, 'this.commit(false)'), '即时提醒开关不触发日程重排');
}
{
  const runner = text('../entry/src/main/ets/service/ServiceAlertRunner.ts');
  ok(has(runner, '!s.enabled || !s.netAlertEnabled'), '网费提醒受总开关 + 类型开关约束');
  ok(has(runner, '!s.enabled || !s.libAlertEnabled'), '借阅提醒受总开关 + 类型开关约束');
  ok(has(runner, '!(await isEnabled())'), '系统通知关闭时直接跳过');
  ok(!has(runner, 'confirmSeat') && !has(runner, 'cancelSeat'), '即时提醒不碰任何对外副作用接口');
  const publishNet = idx(runner, 'NOTIFY_ID_NET_FEE');
  const markNet = idx(runner, 'NotifySentStore.mark(key, nowMillis)');
  ok(publishNet >= 0 && markNet > publishNet, '网费去重标记写在发布之后');
  const publishLib = idx(runner, 'NOTIFY_ID_LIB_DUE');
  const markLib = idx(runner, 'InstantAlertStore.markLibKeys(fresh)');
  ok(publishLib >= 0 && markLib > publishLib, '借阅去重标记写在发布之后');
}
{
  const store = text('../entry/src/main/ets/data/InstantAlertStore.ts');
  ok(!has(store, 'KEEP_DAYS') && !has(store, 'prune('), '即时提醒去重表不做 14 天清理（否则改写每周期一次）');
}
{
  const deeplink = text('../entry/src/main/ets/corelogic/NotifyDeepLink.ts');
  ok(has(deeplink, "'pages/NetPage'"), '网费通知点击可进校园网');
  ok(has(deeplink, "'pages/LibBorrowPage'"), '借阅通知点击可进图书馆');
}

console.log('\nALL PASS pass=' + passed + ' fail=' + failed);
if (failed > 0) {
  process.exit(1);
}
