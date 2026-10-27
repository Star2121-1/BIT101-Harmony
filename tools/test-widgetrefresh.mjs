// 卡片刷新配额 + 点击深链守卫（M8-5 / M8-6）。
//
// 判据：
//  - 配额：30 分钟内不再装配、每天 50 次上限、跨天重置、时钟回拨不锁死；
//  - 给系统的分钟数**不小于 5**（小于 5 会被系统静默忽略，卡片就再也不自动刷新了）；
//  - 深链参数只认已知内容 id（卡片 payload 来自 JSON，脏值不能被当导航指令）。
//
//   node --experimental-transform-types tools/test-widgetrefresh.mjs

import {
  MIN_INTERVAL_MS, DAILY_QUOTA, MIN_SYSTEM_REFRESH_MINUTES,
  emptyState, encodeState, decodeState, decide, minutesUntil, remaining,
} from '../entry/src/main/ets/corelogic/WidgetRefreshLogic.ts';
import { contentIdForKind, sanitizeContentId, KEY_CARD_CONTENT } from '../entry/src/main/ets/corelogic/WidgetDeepLink.ts';

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

const NOW = 1700000000000;
const TODAY = 19723;

// ── 1. 状态编解码 ─────────────────────────────────────────────────────────
const st = { day: TODAY, count: 3, lastAt: NOW };
const rt = decodeState(encodeState(st));
ok(rt !== null, '状态能往返');
ok(rt.day === TODAY && rt.count === 3 && rt.lastAt === NOW, '三个字段都保留');
ok(decodeState('') === null, '空串 → null');
ok(decodeState('1|2') === null, '两段 → null（形状不对）');
ok(decodeState('a|b|c') === null, '非数字 → null');
ok(decodeState('1|-1|0') === null, '负数计数 → null');

// ── 2. 首次装配 ───────────────────────────────────────────────────────────
const first = decide(emptyState(), TODAY, NOW);
ok(first.allowed === true, '空状态 ⇒ 允许');
ok(first.state.count === 1, '计数变 1');
ok(first.state.lastAt === NOW, '记下时刻');
ok(first.nextAt === NOW + MIN_INTERVAL_MS, '下次 = 现在 + 30 分钟');

// ── 3. 太频繁 ─────────────────────────────────────────────────────────────
const soon = decide({ day: TODAY, count: 1, lastAt: NOW - 60000 }, TODAY, NOW);
ok(soon.allowed === false, '1 分钟前装配过 ⇒ 拒绝');
ok(soon.reason === 'too_soon', '原因 = too_soon', soon.reason);
ok(soon.state.count === 1, '拒绝时**不**加计数');
ok(soon.nextAt === NOW - 60000 + MIN_INTERVAL_MS, '下次刷新按上次时刻 + 间隔算');

// 恰好到 30 分钟 ⇒ 允许（闭区间）
const edge = decide({ day: TODAY, count: 1, lastAt: NOW - MIN_INTERVAL_MS }, TODAY, NOW);
ok(edge.allowed === true, '恰好 30 分钟 ⇒ 允许');

// ── 4. 每日配额 ───────────────────────────────────────────────────────────
const full = decide({ day: TODAY, count: DAILY_QUOTA, lastAt: NOW - MIN_INTERVAL_MS * 2 }, TODAY, NOW);
ok(full.allowed === false, '配额用满 ⇒ 拒绝');
ok(full.reason === 'daily_quota', '原因 = daily_quota', full.reason);
ok(full.state.count === DAILY_QUOTA, '配额满时计数不再增长');
const full2 = decide({ day: TODAY, count: DAILY_QUOTA - 1, lastAt: NOW - MIN_INTERVAL_MS * 2 }, TODAY, NOW);
ok(full2.allowed === true && full2.state.count === DAILY_QUOTA, '第 50 次仍然允许');

// ── 5. 跨天重置 ───────────────────────────────────────────────────────────
// ⚠️ 「跨天」重置的是**配额**，不是最小间隔：午夜刚过 1 分钟，如果上次装配在
//    23:59，仍然要被 30 分钟间隔挡住（避免 0 点前后连刷两次）。
const nextDay = decide(
  { day: TODAY - 1, count: DAILY_QUOTA, lastAt: NOW - MIN_INTERVAL_MS * 2 }, TODAY, NOW);
ok(nextDay.allowed === true, '跨天 + 已过间隔 ⇒ 配额重置后允许');
ok(nextDay.state.day === TODAY, '状态换到新的一天');
ok(nextDay.state.count === 1, '新一天从 1 开始（不是 51）');
const nextDaySoon = decide({ day: TODAY - 1, count: DAILY_QUOTA, lastAt: NOW - 60000 }, TODAY, NOW);
ok(nextDaySoon.allowed === false && nextDaySoon.reason === 'too_soon',
  '跨天但刚装配过 ⇒ 仍被最小间隔挡住（配额与间隔是两条闸门）');

// ── 6. 时钟回拨 ───────────────────────────────────────────────────────────
const back = decide({ day: TODAY, count: 2, lastAt: NOW + 3600000 }, TODAY, NOW);
ok(back.allowed === true, '时钟被往回调 ⇒ 仍允许（不锁死）');
ok(back.state.lastAt === NOW, '用当前时间重设基准');

// ── 7. 交给系统的分钟数 ───────────────────────────────────────────────────
ok(minutesUntil(NOW, NOW) === MIN_SYSTEM_REFRESH_MINUTES, '已过期 ⇒ 至少 5 分钟');
ok(minutesUntil(NOW + 60000, NOW) === MIN_SYSTEM_REFRESH_MINUTES, '1 分钟被夹到 5');
ok(minutesUntil(NOW + 31 * 60000, NOW) === 31, '31 分钟原样');
ok(MIN_SYSTEM_REFRESH_MINUTES === 5, '下限常量 = 5');

// ── 8. 剩余配额 ───────────────────────────────────────────────────────────
ok(remaining({ day: TODAY, count: 3, lastAt: NOW }, TODAY) === DAILY_QUOTA - 3, '当天剩余 = 50-3');
ok(remaining({ day: TODAY - 1, count: DAILY_QUOTA, lastAt: NOW }, TODAY) === DAILY_QUOTA,
  '跨天 ⇒ 剩余回到满额');
ok(remaining({ day: TODAY, count: DAILY_QUOTA + 5, lastAt: NOW }, TODAY) === 0, '超限 ⇒ 0（不出负数）');

// ── 9. 深链内容 id ────────────────────────────────────────────────────────
ok(contentIdForKind('COURSE') === 'timetable', 'COURSE → timetable');
ok(contentIdForKind('DDL') === 'ddl', 'DDL → ddl');
ok(contentIdForKind('ACTIVITY') === 'feed', 'ACTIVITY → feed');
ok(contentIdForKind('SEAT') === 'seat', 'SEAT → seat');
ok(contentIdForKind('STUDY') === 'classroom', 'STUDY → classroom');
ok(contentIdForKind('???') === 'timetable', '未知 kind 落回课表（明确值，不是空）');

ok(sanitizeContentId('ddl') === 'ddl', '已知页签 id 通过');
ok(sanitizeContentId(' seat ') === 'seat', '去空白后通过');
ok(sanitizeContentId('mine') === 'mine', '已知模块 id 通过');
ok(sanitizeContentId('drop_table') === '', '未知 id 丢掉（不回落）');
ok(sanitizeContentId('') === '', '空串丢掉');
ok(KEY_CARD_CONTENT === 'bit101Content', 'param 键固定（卡片与 App 两侧必须一致）');

console.log('\n' + (fail === 0 ? 'ALL PASS' : 'FAILED') + '  pass=' + pass + ' fail=' + fail);
process.exit(fail === 0 ? 0 : 1);
