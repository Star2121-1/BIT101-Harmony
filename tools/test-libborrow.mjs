/**
 * 图书馆「我的借阅」解析与到期判定单测（M5-3）
 *
 * 1:1 移植 Android：data/src/test/java/cn/bit101/android/data/school/LibBorrowLogicTest.kt
 * 输入形态照抄 2026-09-28 真实抓到的响应（契约 docs/lib-borrow-contract.md §4.3）：
 * 接口不是干净 JSON —— JSON 套 HTML，HTML 里 <script> 再内嵌一段 JS 数组字面量。
 *
 * 为什么值得单测：把「取不到」当成「0 本」会在真正该提醒的时候告诉用户「你没借书」
 * （Android 原注释就是这个风险）。锚点找不到 = 门户改版 = 必须失败，不是空列表。
 *
 * 跑法：node --experimental-strip-types tools/test-libborrow.mjs
 */

import {
  parseRecords,
  isLoggedIn,
  parseSversion,
  parseTime,
  dataUrl,
  daysLeft,
  alertRecords,
  statusText,
  dueText,
  cardSummary,
  noticeBody,
  noticeTitle,
  BorrowRecord,
  APP_ID_CURRENT,
  DUE_SOON_DAYS
} from '../entry/src/main/ets/corelogic/LibBorrowLogic.ts';
import { parseISODate } from '../entry/src/main/ets/corelogic/timeutil.ts';

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
    console.log('FAIL ' + msg + ' => ' + JSON.stringify(actual) + ' (expected ' + JSON.stringify(expected) + ')');
  }
}

// ── 构造真实形态的响应（与 Android 测试同款）────────────────────────

/** 一个单元格：真实响应里每格都自带 key（字段名）。
 *  ⚠️ 数字键必须带引号（"0":…）—— 无引号键不是合法 JSON，JSON.parse 会直接失败
 *  （Android 侧是 Kotlin 字符串拼接 "\"$index\":"，天然带引号）。 */
function cell(index, key, value) {
  return '"' + index + '":' + JSON.stringify({
    pageType: 1,
    subs: null,
    srcKey: null,
    value: value,
    key: key,
    url: "",
    others: null
  });
}

/** 一行：数字键 + id，顺序与真实响应一致。 */
function row(...cells) {
  const body = cells.map(([k, v], i) => cell(i, k, v)).join(',');
  return '{"pckedDetail":true,"url":null,"content":null,"pop":null,' + body + ',"pageType":null,"id":null}';
}

/** 完整响应：data.div 是 HTML，checkHasData( ... ) 的实参就是数据。 */
function response(...rows) {
  const arrayLiteral = '[' + rows.join(',') + ']';
  const div = '<style>.x{}</style><div class="eng"><script>o.init();this.checkHasData(' + arrayLiteral + ');' +
    'bind:function(){}</script></div>';
  return JSON.stringify({ code: 1, data: { div: div, hide: false } });
}

function oneRecord() {
  return row(
    ["题名", "Excel & AI数据计算处理与分析之深度学习"],
    ["作者", "(日) 涌井良幸, 涌井贞美著"],
    ["ISBN", "978-7-5153-6161-1"],
    ["馆藏地", "良乡自然科学图书第二阅览室"],
    ["借阅日", "2024-08-20 11:24:28"],
    ["应还日", "2024-09-19 11:24:28"]
  );
}

/** now = 2026-09-28 20:00（与 Android 测试同一定时刻）。 */
const NOW = { day: parseISODate('2026-09-28'), minutes: 20 * 60 };
ok(NOW.day !== null, '前置：now 日期可解析');

function record(title, due) {
  const r = new BorrowRecord(title, "", "", "", null, null, due);
  r.dueAt = parseTime(due);
  return r;
}

// ── 1. 解析 ────────────────────────────────────────────────────────

console.log('=== 1. 解析真实响应的一条借阅 ===');
const recs1 = parseRecords(response(oneRecord()));
ok(recs1 !== null, '解析成功（非 null）');
eq(recs1 && recs1.length, 1, '一条记录');
if (recs1 && recs1.length === 1) {
  const r = recs1[0];
  eq(r.title, 'Excel & AI数据计算处理与分析之深度学习', '题名');
  eq(r.author, '(日) 涌井良幸, 涌井贞美著', '作者');
  eq(r.isbn, '978-7-5153-6161-1', 'ISBN');
  eq(r.location, '良乡自然科学图书第二阅览室', '馆藏地');
  eq(r.dueAt, { day: parseISODate('2024-09-19'), minutes: 11 * 60 + 24 }, '应还日解析');
  eq(r.borrowedAt, { day: parseISODate('2024-08-20'), minutes: 11 * 60 + 24 }, '借阅日解析');
}

console.log('=== 2. 空数组 = 空列表（确定没有），不是失败 ===');
eq(parseRecords(response()), [], 'checkHasData([]) → []');

console.log('=== 3. 找不到锚点 = 门户改版 = 失败，绝不是 0 条 ===');
{
  const div = '<style>.y{}</style><div>空空如也</div>';
  const body = JSON.stringify({ code: 1, data: { div: div } });
  eq(parseRecords(body), null, '无锚点 → null');
}

console.log('=== 4. 不是 JSON → null ===');
eq(parseRecords('<html>504 Gateway Timeout</html>'), null, '504 页 → null');
eq(parseRecords(''), null, '空串 → null');

console.log('=== 5. code ≠ 1 → null ===');
{
  const div = '<script>this.checkHasData([' + oneRecord() + ']);</script>';
  const body = JSON.stringify({ code: 0, data: { div: div } });
  eq(parseRecords(body), null, 'code=0 → null');
}

console.log('=== 6. 没有 data 或 div → null ===');
eq(parseRecords('{"code":1,"data":null}'), null, 'data=null → null');
eq(parseRecords('{"code":1,"data":{}}'), null, 'data={} → null');
eq(parseRecords('{"code":1,"data":{"div":""}}'), null, 'div 空串 → null');

console.log('=== 7. 字段顺序打乱仍按 key 取值 ===');
{
  const shuffled = row(
    ["应还日", "2026-09-30 10:00:00"],
    ["馆藏地", "中关村自然科学阅览室"],
    ["题名", "操作系统概念"],
    ["ISBN", "978-7-111-12345-6"],
    ["作者", "Silberschatz"],
    ["借阅日", "2026-08-31 10:00:00"]
  );
  const rs = parseRecords(response(shuffled));
  ok(rs !== null && rs.length === 1, '解析出一条');
  if (rs && rs.length === 1) {
    eq(rs[0].title, '操作系统概念', '题名');
    eq(rs[0].author, 'Silberschatz', '作者');
    eq(rs[0].dueRaw, '2026-09-30 10:00:00', 'dueRaw 原样');
    eq(rs[0].dueAt, { day: parseISODate('2026-09-30'), minutes: 600 }, '应还日');
  }
}

console.log('=== 8. 日期解析失败不丢记录 ===');
{
  const broken = row(["题名", "线性代数"], ["馆藏地", "良乡"], ["应还日", "待定"]);
  const rs = parseRecords(response(broken));
  ok(rs !== null && rs.length === 1, '仍解析出一条');
  if (rs && rs.length === 1) {
    eq(rs[0].title, '线性代数', '题名还在');
    eq(rs[0].dueAt, null, '应还日解析不出 → null');
    eq(rs[0].dueRaw, '待定', '原文保留');
  }
}

console.log('=== 9. 多条按出现顺序解析 ===');
{
  const first = row(["题名", "A"], ["应还日", "2026-09-30 08:00:00"]);
  const second = row(["题名", "B"], ["应还日", "2026-10-10 08:00:00"]);
  const rs = parseRecords(response(first, second));
  eq(rs && rs.map((r) => r.title), ['A', 'B'], '顺序保持');
}

console.log('=== 10. 值里含引号与括号不误切 ===');
{
  const tricky = row(["题名", 'C++ 与 [设计] "模式"'], ["应还日", "2026-09-30 08:00:00"]);
  const rs = parseRecords(response(tricky));
  ok(rs !== null && rs.length === 1, '仍是一条（括号配对没被字符串里的符号骗到）');
  if (rs && rs.length === 1) {
    eq(rs[0].title, 'C++ 与 [设计] "模式"', '原样取出');
  }
}

// ── 2. 会话判定 ────────────────────────────────────────────────────

console.log('=== 11. uid 为空即未登录 ===');
eq(isLoggedIn('{"code":1,"data":{"uid":null}}'), false, 'uid=null → false');
eq(isLoggedIn('{"code":1,"data":{"uid":""}}'), false, 'uid 空串 → false');
eq(isLoggedIn('{"code":1,"data":{"uid":"343326964"}}'), true, 'uid 非空 → true');

console.log('=== 12. 会话响应无法识别 → null（不猜）===');
eq(isLoggedIn('<html>portal</html>'), null, 'HTML → null');
eq(isLoggedIn('{"code":1}'), null, '没有 data → null');

console.log('=== 13. 从页面取 sversion ===');
{
  const html = "<script>var pageId = 330841;\n var sversion = '20260928388';\n var x=1;</script>";
  eq(parseSversion(html), '20260928388', '取到');
  eq(parseSversion('<html>no version</html>'), null, '没有 → null');
}

console.log('=== 14. 数据接口 URL 形状 ===');
{
  const url = dataUrl(APP_ID_CURRENT, '20260928388');
  ok(url.startsWith('https://mylib.bit.edu.cn/application/1715437/data?'), '前缀: ' + url);
  ok(url.indexOf('pageId=330841') >= 0, '带 pageId');
  ok(url.indexOf('websiteId=162085') >= 0, '带 websiteId');
  ok(url.indexOf('sversion=20260928388') >= 0, '带 sversion');
  ok(url.indexOf('wfwfid=2398') >= 0, '带 wfwfid');
}

// ── 3. 到期判定与提醒 ──────────────────────────────────────────────

console.log('=== 15. 距应还日按日期算（ChronoUnit.DAYS 口径）===');
eq(daysLeft(record('A', '2026-09-30 23:59:59'), NOW), 2, '23:59:59 也算整天差 2');
eq(daysLeft(record('A', '2026-09-28 08:00:00'), NOW), 0, '今天早上 = 0 天');
eq(daysLeft(record('A', '2026-09-25 08:00:00'), NOW), -3, '已逾期 3 天');
eq(daysLeft(new BorrowRecord('无到期'), NOW), null, '无应还日 → null');

console.log('=== 16. 提醒范围 = 逾期 + ' + DUE_SOON_DAYS + ' 天内，按最急排序 ===');
{
  const rs = [
    record('四天后', '2026-10-02 09:00:00'),
    record('今天', '2026-09-28 18:00:00'),
    record('已逾期', '2026-09-20 09:00:00'),
    record('两天后', '2026-09-30 09:00:00')
  ];
  const alerts = alertRecords(rs, NOW);
  eq(alerts.map((r) => r.title), ['已逾期', '今天', '两天后'], '四天后的被排除，其余按应还日升序');
}

console.log('=== 17. 状态文案 ===');
eq(statusText(record('A', '2026-09-25 08:00:00'), NOW), '已逾期 3 天', '逾期');
eq(statusText(record('A', '2026-09-28 08:00:00'), NOW), '今天到期', '今天');
eq(statusText(record('A', '2026-09-29 08:00:00'), NOW), '明天到期', '明天');
eq(statusText(record('A', '2026-09-30 08:00:00'), NOW), '2 天后到期', 'N 天后');
eq(statusText(new BorrowRecord('', '', '', '', null, null, '待定'), NOW), '待定', '解析不出 → 原文');

console.log('=== 18. 应还日展示为月日 ===');
eq(dueText(record('A', '2024-09-19 11:24:28')), '9月19日', 'M月d日');
eq(dueText(new BorrowRecord('', '', '', '', null, null, '待定')), '待定', '解析不出 → 原文');

console.log('=== 19. 卡片摘要 ===');
eq(cardSummary([], NOW), '当前没有在借的书', '空');
eq(cardSummary([record('A', '2026-09-20 09:00:00')], NOW), '有 1 本已逾期，尽快归还', '有逾期');
eq(cardSummary([record('A', '2026-09-30 09:00:00')], NOW), '有 1 本快到应还日', '有临期');
eq(cardSummary([record('A', '2026-10-30 09:00:00')], NOW), '共 1 本，暂未临近应还', '都还早');

console.log('=== 20. 通知正文不含书名（隐私边界）===');
{
  const alerts = [
    record('非常私人的一本书名', '2026-09-20 09:00:00'),
    record('另一本也别说', '2026-09-30 09:00:00')
  ];
  const body = noticeBody(alerts, NOW);
  ok(body.indexOf('非常私人的一本书名') < 0, '不出现书名 1');
  ok(body.indexOf('另一本也别说') < 0, '不出现书名 2');
  ok(body.indexOf('有 1 本已逾期') >= 0, '写逾期条数');
  ok(body.indexOf('有 1 本将在 3 天内到期') >= 0, '写临期条数');
  ok(body.indexOf('9月30日') >= 0, '写最早应还日');
}

console.log('=== 21. 通知标题区分逾期与否 ===');
eq(noticeTitle([record('A', '2026-09-20 09:00:00')], NOW), '图书馆借阅已逾期', '逾期');
eq(noticeTitle([record('A', '2026-09-30 09:00:00')], NOW), '图书馆借阅即将到期', '临期');

console.log('=== 22. 没有要提醒的就不发通知 ===');
{
  const alerts = alertRecords([record('A', '2026-10-30 09:00:00')], NOW);
  eq(alerts.length, 0, '无提醒对象');
  eq(noticeBody(alerts, NOW), '', '正文空');
}

console.log('=== 23. 去重键 = 书名 + ISBN + 应还日原文 ===');
{
  const a = new BorrowRecord('A', '', '1', '', null, null, '2026-09-30');
  const b = new BorrowRecord('A', '', '1', '', null, null, '2026-10-30');
  const c = new BorrowRecord('A', '', '1', '', null, null, '2026-09-30');
  ok(a.key !== b.key, '应还日不同 ⇒ 键不同');
  eq(a.key, c.key, '同三要素 ⇒ 键相同');
}

console.log('\nALL PASS  pass=' + passed + ' fail=' + failed);
if (failed > 0) {
  process.exit(1);
}
