// 通知分组/深链 + 教学调整展示守卫（P3/P5/P6）。
//
// 判据：分组按「今天/昨天/本周/更早」连续切、未读只算**已发出**的、深链只认白名单
// （未知 kind 不乱跳、非白名单页面一律拒绝）、教学调整补课文案必须点明「补周几」。
//
//   node --experimental-transform-types tools/test-notifygroup.mjs

import {
  dayIndex, labelOfDay, groupSpans, unreadCount, badgeText, clearConfirmText, DAY_MS,
} from '../entry/src/main/ets/corelogic/NotifyGroupLogic.ts';
import {
  routeOfKind, sanitizeContent, sanitizePage, KEY_NOTIFY_CONTENT, KEY_NOTIFY_PAGE,
} from '../entry/src/main/ets/corelogic/NotifyDeepLink.ts';
import {
  titleOf, upcoming, past, todayBadge, hasUpcomingWithin,
} from '../entry/src/main/ets/corelogic/TeachingAdjustmentView.ts';
import { NO_CLASS, makeUp } from '../entry/src/main/ets/corelogic/TeachingAdjustment.ts';

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

// ── 1. 日序号与标签 ───────────────────────────────────────────────────────
const TODAY = 20300;                     // 任取一个 epoch day
const NOW = TODAY * DAY_MS + 3600000;    // 当天 01:00 UTC
ok(dayIndex(NOW, 0) === TODAY, 'dayIndex 取整到天', String(dayIndex(NOW, 0)));
ok(dayIndex(0, 0) === -1, '0 毫秒 → -1（时间未定）');
ok(dayIndex(-5, 0) === -1, '负数 → -1');

ok(labelOfDay(TODAY, TODAY) === '今天', '同一天 → 今天');
ok(labelOfDay(TODAY - 1, TODAY) === '昨天', '前一天 → 昨天');
ok(labelOfDay(TODAY - 3, TODAY) === '本周早些时候', '3 天前 → 本周早些时候');
ok(labelOfDay(TODAY - 7, TODAY) === '更早', '7 天前 → 更早（边界不含）');
ok(labelOfDay(TODAY - 6, TODAY) === '本周早些时候', '6 天前仍在「本周」');
ok(labelOfDay(-1, TODAY) === '时间未定', '-1 → 时间未定');

// ── 2. 连续分组 ───────────────────────────────────────────────────────────
function item(fired) {
  return { atMillis: fired > 0 ? fired : NOW, firedMillis: fired };
}
const day = (n) => n * DAY_MS + 3600000;

const items = [
  item(day(TODAY)),            // 今天
  item(day(TODAY)),            // 今天
  item(day(TODAY - 1)),        // 昨天
  item(day(TODAY - 4)),        // 本周
  item(day(TODAY - 20)),       // 更早
];
const spans = groupSpans(items, NOW, 0);
ok(spans.length === 4, '切成 4 组', JSON.stringify(spans));
ok(spans[0].label === '今天' && spans[0].start === 0 && spans[0].end === 2, '今天 [0,2)');
ok(spans[1].label === '昨天' && spans[1].start === 2 && spans[1].end === 3, '昨天 [2,3)');
ok(spans[2].label === '本周早些时候' && spans[2].start === 3 && spans[2].end === 4, '本周 [3,4)');
ok(spans[3].label === '更早' && spans[3].start === 4 && spans[3].end === 5, '更早 [4,5)');
ok(groupSpans([], NOW, 0).length === 0, '空数组 → 无分组');

// 未发出的（fired=0）用排定时刻；排定在今天 → 归今天（不因未发而消失）
const pending = [{ atMillis: day(TODAY), firedMillis: 0 }];
const ps = groupSpans(pending, NOW, 0);
ok(ps.length === 1 && ps[0].label === '今天', '未发出但排期今天 → 今天');

// ── 3. 未读数 ─────────────────────────────────────────────────────────────
const mixed = [
  item(day(TODAY)),
  item(day(TODAY - 1)),
  item(0),                     // 未发出
];
ok(unreadCount(mixed, 0) === 2, '从没看过 → 已发的 2 条都未读', String(unreadCount(mixed, 0)));
ok(unreadCount(mixed, day(TODAY - 1)) === 1, '看过昨天之后 → 只有今天的未读', String(unreadCount(mixed, day(TODAY - 1))));
ok(unreadCount(mixed, day(TODAY) + 1000) === 0, '看过今天 → 全部已读');
ok(unreadCount([item(0)], 0) === 0, '只有未发出的 → 0 未读');

ok(badgeText(0) === '', '0 → 空徽标');
ok(badgeText(5) === '5', '5 → "5"');
ok(badgeText(120) === '99+', '>99 → "99+"');

ok(clearConfirmText(3).indexOf('3 条') > 0, '清空文案点明条数');
ok(clearConfirmText(3).indexOf('不影响提醒设置') > 0, '清空文案说明不影响设置');

// ── 4. 深链映射 ───────────────────────────────────────────────────────────
const rClass = routeOfKind('CLASS');
ok(rClass.content === 'timetable' && rClass.page === '', 'CLASS → 课表页签');
ok(routeOfKind('DDL').content === 'ddl', 'DDL → ddl');
ok(routeOfKind('SEAT_SIGN_IN').content === 'seat', 'SEAT_SIGN_IN → seat');
ok(routeOfKind('EXAM').page === 'pages/ExamPage', 'EXAM → 考试页');
ok(routeOfKind('ADJUSTMENT').page === 'pages/TeachingAdjustmentPage', 'ADJUSTMENT → 教学调整页');
ok(routeOfKind('SCORE').page === 'pages/ScorePage', 'SCORE → 成绩页');

const unknown = routeOfKind('WHATEVER');
ok(unknown.content === '' && unknown.page === '', '未知 kind → 空落点（不乱跳）', JSON.stringify(unknown));
ok(routeOfKind('').content === '', '空 kind → 空落点');

// 大小写/空白容错
ok(routeOfKind(' class ').content === 'timetable', 'kind 去空白 + 大小写不敏感');

// ── 5. 白名单校验 ─────────────────────────────────────────────────────────
ok(sanitizeContent('timetable') === 'timetable', '合法页签通过');
ok(sanitizeContent('ddl') === 'ddl', 'ddl 通过');
ok(sanitizeContent('score') === '', '非页签值 → 空（不猜）', sanitizeContent('score'));
ok(sanitizeContent('') === '', '空 → 空');

ok(sanitizePage('pages/ScorePage') === 'pages/ScorePage', '白名单页面通过');
ok(sanitizePage('pages/EvilPage') === '', '非白名单页面 → 空（绝不 pushUrl 任意串）', sanitizePage('pages/EvilPage'));
ok(sanitizePage('https://evil.com') === '', 'URL 不被当页面路径');
ok(sanitizePage(' pages/ScorePage ') === 'pages/ScorePage', '去空白后仍在白名单');

ok(KEY_NOTIFY_CONTENT === 'bit101Content' && KEY_NOTIFY_PAGE === 'bit101Page', '参数键名固定（与卡片深链共用 bit101Content）');

// ── 6. 教学调整展示 ───────────────────────────────────────────────────────
const entries = [
  { day: TODAY, plan: NO_CLASS },
  { day: TODAY + 3, plan: makeUp(2) },
  { day: TODAY - 5, plan: makeUp(4) },
  { day: TODAY + 10, plan: makeUp(9) },   // 脏数据：周几越界
];

ok(titleOf({ day: 0, plan: NO_CLASS }) === '放假（不上课）', '放假文案');
ok(titleOf({ day: 0, plan: makeUp(2) }) === '补周二的课', '补课文案点明周几', titleOf({ day: 0, plan: makeUp(2) }));
ok(titleOf({ day: 0, plan: makeUp(0) }) === '', '周几越界 → 空（不编）');
ok(titleOf({ day: 0, plan: makeUp(9) }) === '', '周几 9 → 空');

const up = upcoming(entries, TODAY, 0);
ok(up.length === 2, '未来含今天 2 条（越界那条被丢）', JSON.stringify(up.map((x) => x.title)));
ok(up[0].day === TODAY && up[0].isMakeUp === false, '今天的放假排最前');
ok(up[1].day === TODAY + 3 && up[1].isMakeUp === true, '补课在第二');
ok(up[0].dateLabel.indexOf('（周') > 0, '日期标签含星期', up[0].dateLabel);

ok(upcoming(entries, TODAY, 1).length === 1, 'limit 生效');

const pastList = past(entries, TODAY, 0);
ok(pastList.length === 1 && pastList[0].day === TODAY - 5, '过去 1 条', JSON.stringify(pastList));

ok(todayBadge(entries, TODAY) === '今天放假（不上课）', '今日角标', todayBadge(entries, TODAY));
ok(todayBadge(entries, TODAY + 1) === '', '非调整日 → 空角标');
ok(todayBadge([{ day: TODAY, plan: makeUp(3) }], TODAY) === '今天补周三的课', '今日补课角标');

ok(hasUpcomingWithin(entries, TODAY, 7) === true, '7 天内（含今天）有调整');
ok(hasUpcomingWithin(entries, TODAY + 4, 0) === false, '只看当天且当天无调整 → false');
ok(hasUpcomingWithin([{ day: TODAY + 3, plan: makeUp(2) }], TODAY, 2) === false, '3 天后超出 2 天窗口 → false');

console.log('\n' + (fail === 0 ? 'ALL PASS' : 'FAILED') + '  pass=' + pass + ' fail=' + fail);
process.exit(fail === 0 ? 0 : 1);
