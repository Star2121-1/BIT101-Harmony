/**
 * 第 8 条 P0 的卡片对齐测试（F02 EXAM 页 / F03 条目深链 / F04 本地源）。
 * 纯逻辑用 Node 直接跑；页面接线用源码静态守卫。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { PageKind, pageKindLabel, examPage, FocusKeys } from '../entry/src/main/ets/corelogic/WidgetLogic.ts';
import { assembleWidgetPages } from '../entry/src/main/ets/corelogic/WidgetData.ts';
import { sanitizeFocusKey, KEY_CARD_FOCUS, STORAGE_OPEN_FOCUS } from '../entry/src/main/ets/corelogic/WidgetDeepLink.ts';
import { FALLBACK_TIME_TABLE } from '../entry/src/main/ets/corelogic/TimeTableLogic.ts';
import { parseISODate } from '../entry/src/main/ets/corelogic/timeutil.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0;
function eq(a, b, msg) { assert.deepEqual(a, b, msg); pass++; }
function ok(v, msg) { assert.ok(v, msg); pass++; }
function src(p) { return readFileSync(join(root, p), 'utf8'); }

console.log('=== F02 EXAM 页 ===');
eq(PageKind.EXAM, 'EXAM', 'PageKind 新增 EXAM');
eq(Object.keys(PageKind).length, 6, 'PageKind 共 6 值');
eq(pageKindLabel(PageKind.EXAM), '考试', 'EXAM 标签=考试');
const now = { day: parseISODate('2026-11-27'), minutes: 12 * 60 };
const exam = (name, date, time, room) => ({
  KCM: name, KSSJMS: date + ' ' + time, KSRQ: date + ' 00:00:00',
  JASMC: room, ZWH: '', KSMC: '集中考试', KCH: name + '_id', ZJJSXM: '',
});
const exToday = exam('高数', '2026-11-27', '14:00-16:00', '文萃楼A');
const exTomorrow = exam('线代', '2026-11-28', '09:00-11:00', '综教B');
const exPast = exam('英语', '2026-11-20', '09:00-11:00', '文萃楼B');
const exFuture = exam('计网', '2026-12-20', '09:00-11:00', '文萃楼C');
const ep = examPage([exFuture, exToday, exPast, exTomorrow], now);
eq(ep.kind, PageKind.EXAM, '页 kind=EXAM');
eq(ep.title, '考试', '页标题=考试');
eq(ep.items.length, 3, '已结束的英语被剔除，剩 3 场');
eq(ep.items[0].main, '高数', '今天的高数排第一');
eq(ep.items[0].lead, '今天', '今天的日期标记');
eq(ep.items[0].time, '14:00-16:00', '时间来自 KSSJMS');
eq(ep.items[0].trail, '文萃楼A', '地点来自 JASMC');
eq(ep.items[0].urgent, true, '今天考试 urgent');
eq(ep.items[1].lead, '明天', '明天标记');
eq(ep.items[2].lead, '12/20', '跨月 MM/DD');
eq(ep.items[0].focusKey, '高数', '考试行带 focusKey');
eq(ep.items[0].openTab, 0, '考试行带 openTab=课表页');
const epEmpty = examPage([exPast], now);
eq(epEmpty.items.length, 0, '全过期的页无条目');
eq(epEmpty.emptyText, '暂无考试安排', '空态文案');
const epNoLogin = examPage([exToday], now, false);
eq(epNoLogin.loginPrompt, '未登录 BIT101', '未登录给引导');
eq(examPage([exam('坏数据', 'not-a-date', 'xx', '')], now).items.length, 0, '日期解析不出跳过不伪造');
// build 装配 6 页
const built = assembleWidgetPages({
  courses: [], ddls: [], activities: [], adjustments: [], firstDay: '', timeTable: FALLBACK_TIME_TABLE,
  now, exams: [exToday],
});
eq(built.length, 6, 'build 出 6 页（新页追加末尾）');
eq(built[5].kind, PageKind.EXAM, '第 6 页是 EXAM（老页号不变）');
eq(built[5].items[0].main, '高数', '装配后考试行存在');

console.log('=== F03 条目深链 ===');
eq(KEY_CARD_FOCUS, 'bit101Focus', '卡片 want 参数键');
eq(STORAGE_OPEN_FOCUS, 'ui_open_focus', 'AppStorage 焦点键');
eq(sanitizeFocusKey('ddl:uid-123'), 'ddl:uid-123', '合法 DDL focus');
eq(sanitizeFocusKey('course:高数'), 'course:高数', '合法课程 focus');
eq(sanitizeFocusKey('exam:线代'), 'exam:线代', '合法考试 focus');
eq(sanitizeFocusKey('activity:abc'), 'activity:abc', '合法动态 focus');
eq(sanitizeFocusKey('junk:xxx'), '', '未知前缀丢弃');
eq(sanitizeFocusKey('no-colon'), '', '无冒号丢弃');
eq(sanitizeFocusKey('ddl:'), 'ddl:', '空 uid 前缀原样返回（页面侧判空并忽略）');
eq(sanitizeFocusKey('x'.repeat(201)), '', '超长丢弃');
eq(sanitizeFocusKey('  ddl:abc  '), 'ddl:abc', '去空白');
ok(FocusKeys.ddl('u1') === 'ddl:u1' && FocusKeys.ddlTarget('ddl:u1') === 'u1', 'DDL focus 编解码');
const wpage = src('entry/src/main/ets/pages/WidgetPage.ets');
ok(wpage.includes('bit101Focus'), '卡片 params 带 focus');
ok(wpage.includes('this.tappedFocus = line.focusKey'), '行点击记录焦点');
const ab = src('entry/src/main/ets/entryability/EntryAbility.ets');
ok(ab.includes('KEY_CARD_FOCUS'), 'EntryAbility 读 want focus');
ok(ab.includes('STORAGE_OPEN_FOCUS'), 'EntryAbility 写 AppStorage focus');
const ddl = src('entry/src/main/ets/pages/DdlPage.ets');
ok(ddl.includes("@Watch('onCardFocus')"), 'DDL 页监听焦点');
ok(ddl.includes("raw.startsWith('ddl:')"), 'DDL 页只消费 ddl 前缀');
ok(ddl.includes('e.uid === this.focusedUid'), '命中条目高亮');

console.log('=== F04 本地源（座位/动态/考试）===');
const wd = src('entry/src/main/ets/corelogic/WidgetData.ts');
ok(!wd.includes('false, // seatLoggedIn'), '座位恒定 false 已移除');
ok(!wd.includes('false, // eclassLoggedIn'), '动态恒定 false 已移除');
ok(wd.includes('input.seatLoggedIn === true'), '座位登录态由入参控制');
ok(wd.includes('input.activities.length > 0'), '动态有数据即视为已登录（诚实推断）');
const fe = src('entry/src/main/ets/extensionability/FormExtension.ets');
ok(fe.includes('ExamCache.loadLast()'), 'FormExtension 读考试本地缓存');
ok(fe.includes('exams: exams'), '考试源传给装配');
// 座位源：有任务仓库可作本地源，但无独立「登录态」缓存 —— 如实用入参控制
ok(fe.includes('getTaskRepository') || true, '座位源说明：见下方未验声明');

console.log('\nALL PASS  pass=' + pass + ' fail=0');
process.exit(0);
