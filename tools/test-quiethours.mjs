// 免打扰时段守卫（M12-2）。
//
// 判据：24×24 的窗口边界一个个钉住；跨零点按「[start,24:00) ∪ [0,end)」算；
// 起止相同 ⇒ 不生效（绝不等于全天静默）；静默期的提醒**推到窗口结束**而不是丢弃；
// 推出后日期可跨天；非法输入不抛错且倾向于「不静默」（宁可多响一次，不可吞掉提醒）。
//
//   node --experimental-transform-types tools/test-quiethours.mjs

import {
  inQuiet, shiftOutOfQuiet, applyQuiet, windowValid, clampMinute, minuteText,
  parseMinute, quietSummary, quietHint, normalizeQuietHours, QUIET_PRESETS,
  DEFAULT_QUIET_HOURS, MINUTES_PER_DAY, budgetFor,
} from '../entry/src/main/ets/corelogic/QuietHoursLogic.ts';

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

const hhmm = (h, m) => h * 60 + m;
/** 造一个本地时间戳（2026-10-28 是周三）。 */
const at = (h, m) => new Date(2026, 9, 28, h, m, 0, 0).getTime();
/** 时间戳 → 'MM-DD HH:mm'，方便断言跨天。 */
function stamp(ts) {
  const d = new Date(ts);
  return String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') +
    ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

// ── 1. 同日窗口 [09:00, 12:00) ──────────────────────────────────────────
const day = { enabled: true, startMinute: hhmm(9, 0), endMinute: hhmm(12, 0) };
ok(inQuiet(hhmm(9, 0), day) === true, '同日：起点算在窗口内（含）');
ok(inQuiet(hhmm(11, 59), day) === true, '同日：终点前 1 分钟在内');
ok(inQuiet(hhmm(12, 0), day) === false, '同日：终点不算在窗口内（该响了）');
ok(inQuiet(hhmm(8, 59), day) === false, '同日：起点前 1 分钟在外');
ok(inQuiet(hhmm(0, 0), day) === false, '同日：零点在外');
ok(inQuiet(hhmm(23, 59), day) === false, '同日：23:59 在外');

// ── 2. 跨零点窗口 [23:00, 07:00) ────────────────────────────────────────
const night = { enabled: true, startMinute: hhmm(23, 0), endMinute: hhmm(7, 0) };
ok(inQuiet(hhmm(23, 0), night) === true, '跨零点：23:00 在内');
ok(inQuiet(hhmm(23, 59), night) === true, '跨零点：23:59 在内');
ok(inQuiet(hhmm(0, 0), night) === true, '跨零点：00:00 在内');
ok(inQuiet(hhmm(6, 59), night) === true, '跨零点：06:59 在内');
ok(inQuiet(hhmm(7, 0), night) === false, '跨零点：07:00 结束（该响了）');
ok(inQuiet(hhmm(22, 59), night) === false, '跨零点：22:59 在外');
ok(inQuiet(hhmm(12, 0), night) === false, '跨零点：中午在外');

// ── 3. 关闭 / 起止相同 ──────────────────────────────────────────────────
ok(inQuiet(hhmm(23, 30), { enabled: false, startMinute: 0, endMinute: 1439 }) === false, '总开关关 → 永不静默');
const zero = { enabled: true, startMinute: hhmm(7, 0), endMinute: hhmm(7, 0) };
ok(windowValid(zero) === false, '起止相同 → 窗口无效');
ok(inQuiet(hhmm(7, 0), zero) === false, '起止相同 → 不静默（不是全天）');
ok(inQuiet(hhmm(12, 0), zero) === false, '起止相同 → 任何时刻都不静默');

// ── 4. 脏输入不抛错，且倾向「不静默」 ───────────────────────────────────
ok(inQuiet(NaN, night) === false, 'minute=NaN → 不静默');
ok(inQuiet(-1, night) === false, 'minute=-1 → 不静默');
ok(inQuiet(MINUTES_PER_DAY, night) === false, 'minute=1440 → 不静默');
ok(inQuiet(hhmm(2, 0), { enabled: true, startMinute: NaN, endMinute: NaN }) === false, '边界 NaN → 不静默');

// ── 5. shiftOutOfQuiet：不静默时原样 ────────────────────────────────────
let s = shiftOutOfQuiet(at(15, 0), night);
ok(s.changed === false && s.ts === at(15, 0), '窗口外原样返回');
s = shiftOutOfQuiet(at(3, 0), { ...night, enabled: false });
ok(s.changed === false, '关闭时不动');

// ── 6. shiftOutOfQuiet：跨零点 → 推到次日 07:00 ─────────────────────────
s = shiftOutOfQuiet(at(23, 30), night);
ok(s.changed === true, '23:30 被推迟');
ok(stamp(s.ts) === '10-29 07:00', '23:30 → 次日 07:00', stamp(s.ts));

s = shiftOutOfQuiet(at(0, 30), night);
ok(stamp(s.ts) === '10-28 07:00', '00:30 → 当天 07:00（已在次日段）', stamp(s.ts));
ok(s.ts > at(0, 30), '推迟后一定晚于原时刻');

// ── 7. shiftOutOfQuiet：同日窗口 → 推到当天结束 ─────────────────────────
s = shiftOutOfQuiet(at(10, 15), day);
ok(stamp(s.ts) === '10-28 12:00', '10:15 → 当天 12:00', stamp(s.ts));

// ── 8. 秒/毫秒归零（提醒按分钟粒度） ────────────────────────────────────
const withSec = new Date(2026, 9, 28, 23, 30, 37, 500).getTime();
const s2 = shiftOutOfQuiet(withSec, night);
ok(new Date(s2.ts).getSeconds() === 0 && new Date(s2.ts).getMilliseconds() === 0,
  '推迟后秒/毫秒归零', String(new Date(s2.ts).getSeconds()));

// ── 9. applyQuiet：批量、不修改入参、跨天重算年月日 ─────────────────────
const specs = [
  { key: 'a', kind: 'CLASS', title: 'A', content: '', year: 2026, month: 10, day: 28, hour: 23, minute: 30 },
  { key: 'b', kind: 'DDL', title: 'B', content: '', year: 2026, month: 10, day: 28, hour: 15, minute: 0 },
];
// 23:30 → 次日 07:00 共推迟 450 分钟；给 600 分钟预算才留得住
const generous = { classMax: 600, examMax: 600, seatMax: 600, ddlMax: 600, otherMax: 600 };
const beforeA = JSON.stringify(specs[0]);
const res = applyQuiet(specs, night, generous);
ok(res.delayed === 1, '只推迟窗口内那一条', String(res.delayed));
ok(res.dropped === 0, '预算够 → 一条不丢', String(res.dropped));
ok(res.specs.length === 2, '条数不变（不丢提醒）');
ok(res.specs[0].day === 29 && res.specs[0].hour === 7 && res.specs[0].minute === 0, '跨天：日/时/分都重算',
  res.specs[0].day + ' ' + res.specs[0].hour + ':' + res.specs[0].minute);
ok(res.specs[1].hour === 15, '窗口外那条不动');
ok(JSON.stringify(specs[0]) === beforeA, '不修改入参（纯函数）');
ok(res.specs[0].key === 'a' && res.specs[0].title === 'A', '去重键/标题保留');

const off = applyQuiet(specs, { ...night, enabled: false }, generous);
ok(off.delayed === 0 && off.specs === specs, '关闭时直接返回原数组（零拷贝）');

// ── 9b. 推迟预算：过了事件时刻的提醒**必须丢**（迟到 8 小时的上课提醒是假信息） ──
const tight = { classMax: 15, examMax: 60, seatMax: 30, ddlMax: -1, otherMax: 0 };
const mixed = [
  { key: 'c1', kind: 'CLASS', title: '上课', content: '', year: 2026, month: 10, day: 28, hour: 23, minute: 30 },
  { key: 'd1', kind: 'DDL', title: 'DDL', content: '', year: 2026, month: 10, day: 28, hour: 23, minute: 30 },
  { key: 'e1', kind: 'EXAM', title: '考试', content: '', year: 2026, month: 10, day: 28, hour: 23, minute: 30 },
];
const mr = applyQuiet(mixed, night, tight);
ok(mr.specs.length === 1, '只留 DDL（预算不限）', String(mr.specs.length));
ok(mr.specs[0].key === 'd1', '留下的是 DDL', mr.specs.length > 0 ? mr.specs[0].key : '(空)');
ok(mr.dropped === 2, '上课 + 考试被丢（推迟 450 分钟 > 预算）', String(mr.dropped));
ok(mr.delayed === 1, 'DDL 记为推迟', String(mr.delayed));

// 默认预算（不传）⇒ 全部丢弃，绝不发过期提醒
const strict = applyQuiet(mixed, night);
ok(strict.dropped === 3 && strict.delayed === 0, '默认零预算 → 静默期一条不发', JSON.stringify(strict.delayed));

// ── 9c. 预算边界：正好等于预算算「留」 ──────────────────────────────────
const exact = applyQuiet(
  [{ key: 'x', kind: 'CLASS', title: 'x', content: '', year: 2026, month: 10, day: 28, hour: 23, minute: 30 }],
  night, { classMax: 450, examMax: 0, seatMax: 0, ddlMax: 0, otherMax: 0 });
ok(exact.delayed === 1 && exact.dropped === 0, '推迟 450 = 预算 450 → 保留', JSON.stringify(exact.delayed));
const over = applyQuiet(
  [{ key: 'x', kind: 'CLASS', title: 'x', content: '', year: 2026, month: 10, day: 28, hour: 23, minute: 30 }],
  night, { classMax: 449, examMax: 0, seatMax: 0, ddlMax: 0, otherMax: 0 });
ok(over.dropped === 1, '推迟 450 > 预算 449 → 丢弃', JSON.stringify(over.dropped));

// ── 10. 工具函数 ────────────────────────────────────────────────────────
ok(clampMinute(-5, 0) === 0, 'clampMinute 负 → 0');
ok(clampMinute(2000, 0) === 1439, 'clampMinute 超上限 → 1439');
ok(clampMinute(NaN, 42) === 42, 'clampMinute NaN → fallback');
ok(minuteText(0) === '00:00', 'minuteText 零点');
ok(minuteText(hhmm(7, 5)) === '07:05', 'minuteText 补零');
ok(minuteText(hhmm(23, 59)) === '23:59', 'minuteText 末点');
ok(parseMinute('07:30', -1) === hhmm(7, 30), 'parseMinute 正常');
ok(parseMinute('7:5', -1) === hhmm(7, 5), 'parseMinute 不补零也认');
ok(parseMinute('24:00', -1) === -1, 'parseMinute 小时越界 → fallback');
ok(parseMinute('07:60', -1) === -1, 'parseMinute 分钟越界 → fallback');
ok(parseMinute('abc', -1) === -1, 'parseMinute 乱码 → fallback');
ok(parseMinute('', -1) === -1, 'parseMinute 空串 → fallback');

ok(quietSummary(night) === '23:00 – 07:00（次日）', 'summary 跨零点标注次日', quietSummary(night));
ok(quietSummary(day) === '09:00 – 12:00', 'summary 同日不加次日', quietSummary(day));
ok(quietSummary({ ...night, enabled: false }) === '已关闭', 'summary 关闭态');
ok(quietSummary(zero) === '未生效（起止相同）', 'summary 无效窗口说实话');
ok(quietHint(zero).indexOf('不生效') >= 0, 'hint 讲清无效窗口');
ok(quietHint(night).indexOf('不会丢') >= 0, 'hint 讲清「推迟不丢」');

// ── 11. normalizeQuietHours：脏 JSON 逐项回落 ───────────────────────────
let q = normalizeQuietHours(null);
ok(q.enabled === false && q.startMinute === 23 * 60, 'null → 默认值');
q = normalizeQuietHours({ enabled: 'yes', startMinute: 'x', endMinute: 500 });
ok(q.enabled === false && q.startMinute === 23 * 60 && q.endMinute === 500, '脏字段各自回落，不整块回退',
  JSON.stringify(q));
q = normalizeQuietHours({ enabled: true, startMinute: -100, endMinute: 99999 });
ok(q.startMinute === 0 && q.endMinute === 1439, '越界钳回区间', JSON.stringify(q));

// ── 12. 预设必须自洽（防止以后手改预设改出「无效窗口」） ────────────────
let allValid = true;
for (const p of QUIET_PRESETS) {
  if (!windowValid({ enabled: true, startMinute: p.startMinute, endMinute: p.endMinute })) {
    allValid = false;
  }
}
ok(allValid && QUIET_PRESETS.length >= 2, '所有预设都是有效窗口', String(QUIET_PRESETS.length));
ok(DEFAULT_QUIET_HOURS.enabled === false, '默认不打扰用户（静默默认关）');

// ── 13. budgetFor：类型映射不能串行（串了就等于给错预算） ────────────────
const bb = { classMax: 1, examMax: 2, seatMax: 3, ddlMax: 4, otherMax: 5 };
ok(budgetFor('CLASS', bb) === 1, 'budgetFor CLASS');
ok(budgetFor('EXAM', bb) === 2, 'budgetFor EXAM');
ok(budgetFor('SEAT_SIGN_IN', bb) === 3, 'budgetFor 座位签到');
ok(budgetFor('DDL', bb) === 4, 'budgetFor DDL');
ok(budgetFor('ADJUSTMENT', bb) === 5, 'budgetFor 未知/其它 → otherMax');
ok(budgetFor('WHATEVER', bb) === 5, 'budgetFor 完全不认识的类型 → otherMax');

console.log('\n' + (fail === 0 ? 'ALL PASS' : 'FAILED') + '  pass=' + pass + ' fail=' + fail);
process.exit(fail === 0 ? 0 : 1);
