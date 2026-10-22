/**
 * 教学安排调整解析器回归测试
 *
 * 期望值**逐条抄自 Android 单测**
 * （BIT101-seat/data/src/test/java/cn/bit101/android/data/school/TeachingAdjustmentLogicTest.kt），
 * fixture 是**同一批真机抓下来的门户页面**（tools/fixtures/teaching/，一字未改）。
 *
 * 跑法：node --experimental-transform-types tools/test-teaching.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  parseNotice,
  parseNoticeList,
  isAdjustmentNotice,
  visibleText,
  epochDayOf,
} from '../entry/src/main/ets/corelogic/TeachingAdjustmentParser.ts';
import { dayPlanOf } from '../entry/src/main/ets/corelogic/TeachingAdjustment.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, 'fixtures', 'teaching');

let pass = 0;
let fail = 0;

function ok(cond, msg) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.log('FAIL  ' + msg);
  }
}

function eq(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    pass++;
  } else {
    fail++;
    console.log('FAIL  ' + msg + '\n      实际=' + a + '\n      期望=' + e);
  }
}

function fixture(name) {
  return readFileSync(join(FIX, name), 'utf8');
}

function parse(name) {
  return parseNotice(fixture(name), name, 'https://jxzx.bit.edu.cn/jxyx/kctz/' + name);
}

/** 某天（y,m,d）的安排；无覆盖返回 null。 */
function planAt(entries, y, m, d) {
  return dayPlanOf(entries, epochDayOf(y, m, d));
}

// ── 表格型：2026 国庆（本次事故的回归点）──────────────────────────────

const t2026 = parse('notice-2026-guqing.html');

eq(planAt(t2026, 2026, 10, 10), { kind: 'MakeUp', targetWeekday: 4 },
  '2026 国庆：10/10 周六按周四课表上课');

for (let d = 1; d <= 8; d++) {
  eq(planAt(t2026, 2026, 10, d), { kind: 'NoClass' }, '2026 国庆：10月' + d + '日放假');
}
eq(planAt(t2026, 2026, 10, 9), null, '2026 国庆：10/9 恢复上课（无覆盖）');

for (let d = 25; d <= 27; d++) {
  eq(planAt(t2026, 2026, 9, d), { kind: 'NoClass' }, '2026 中秋：9月' + d + '日放假');
}
eq(planAt(t2026, 2026, 9, 20), { kind: 'NoClass' }, '2026 中秋：9/20 补休');

eq(t2026.length, 13, '2026 国庆：条目数 13（9/20 + 9/25~27 + 10/1~8 + 10/10）');
eq(t2026[0].day, epochDayOf(2026, 9, 20), '2026 国庆：首条 = 9/20');
eq(t2026[t2026.length - 1].day, epochDayOf(2026, 10, 10), '2026 国庆：末条 = 10/10');

// note 必须来自原文，用户才能自己核对
const oct10 = t2026.find((x) => x.day === epochDayOf(2026, 10, 10));
ok(oct10 !== undefined && oct10.note.includes('按') && oct10.note.includes('课表'),
  '2026 国庆：note 保留原文措辞（实际：' + (oct10 ? oct10.note : 'undefined') + '）');

// ── 文字型：2025 国庆（无表格，只能靠句式）────────────────────────────

const t2025 = parse('notice-2025-guqing.html');
eq(planAt(t2025, 2025, 9, 30), { kind: 'NoClass' }, '2025 国庆：9/30 放假');
for (let d = 1; d <= 9; d++) {
  eq(planAt(t2025, 2025, 10, d), { kind: 'NoClass' }, '2025 国庆：10月' + d + '日放假');
}
eq(planAt(t2025, 2025, 9, 28), { kind: 'MakeUp', targetWeekday: 2 }, '2025 国庆：9/28 周日按周二');
eq(planAt(t2025, 2025, 10, 11), { kind: 'MakeUp', targetWeekday: 4 }, '2025 国庆：10/11 周六按周四');

// ── 跨年：元旦（发布日期在 2025 年，正文写 1 月 ⇒ 算到 2026）──────────

const tyd = parse('notice-2026-yuandan.html');
for (let d = 1; d <= 3; d++) {
  eq(planAt(tyd, 2026, 1, d), { kind: 'NoClass' }, '2026 元旦：1月' + d + '日放假');
}
eq(planAt(tyd, 2026, 1, 4), { kind: 'MakeUp', targetWeekday: 5 }, '2026 元旦：1/4 按周五');
eq(planAt(tyd, 2025, 1, 1), null, '2026 元旦：不能落到 2025 年');

// ── 反面：认不出就不产出（绝不猜）────────────────────────────────────

eq(parseNotice('<html><body><p>各位同学：今天天气不错。</p><p>1月1日无安排说明。</p></body></html>', 'x', 'u'),
  [], '反面：看不懂的正文不产出任何条目');

eq(parseNotice('<html><body>' +
  '<p>9月20日（星期日）补休校庆开放日，原教学计划安排取消。</p>' +
  '<p>10月10日（星期六）上班、上课，按照星期四教学计划安排上课。</p>' +
  '</body></html>', 'x', 'u'),
  [], '反面：没有发布日期 ⇒ 整条放弃（否则会算到错年份）');

eq(parseNotice('<html><body>' +
  '<p>发布日期:2026-09-03</p>' +
  '<p>10月10日（星期六）上班、上课，原有教学安排取消。</p>' +
  '</body></html>', 'x', 'u'),
  [], '反面：只提「上班上课」没写按哪份课表 ⇒ 不算补课');

// ── 文本归一化 ───────────────────────────────────────────────────────

const norm = visibleText('<p>26 <span>中秋假</span> 期</p><p>补休·无 教学安排</p>');
ok(norm.includes('中秋假期'), '归一化：汉字之间的空格必须去掉（实际：' + norm + '）');
ok(norm.includes('无教学安排'), '归一化：词内空格去掉后关键词能命中（实际：' + norm + '）');
ok(visibleText('<p>放假，共 3 天</p>').includes('共 3 天'), '归一化：数字与汉字之间的空格要保留');

// ── 列表页 ───────────────────────────────────────────────────────────

const list = parseNoticeList(fixture('list.html'), 'https://jxzx.bit.edu.cn/jxyx/kctz/');
const hits = list.filter((n) => isAdjustmentNotice(n.title));
ok(hits.length >= 3, '列表页：至少认出 3 条教学安排调整（实际 ' + hits.length + '）');
ok(hits.some((n) => n.title.includes('2026年中秋节、国庆节')),
  '列表页：标题含「2026年中秋节、国庆节」');
ok(hits.every((n) => n.url.startsWith('https://jxzx.bit.edu.cn/')), '列表页：链接补全成绝对地址');
ok(!list.some((n) => n.title.includes('封楼') && isAdjustmentNotice(n.title)),
  '列表页：非该类通知（封楼）不混入');

// ── planOf 语义 ──────────────────────────────────────────────────────

eq(planAt(t2026, 2026, 10, 12), null, 'planOf：查不到返回 null（调用方保持原样，不改课表）');

// ── 表格路径必须能被**单独**证伪 ──────────────────────────────────────
//
// ⚠️ 这条是被「故意拆坏」实验逼出来的（2026-10-20）：
// 把表格补课正则改坏后，10/10 那条断言**仍然绿** —— 说明它是靠正文文字兜底命中的，
// 表格解析根本没被测到。真实通知里存在「只有表格标注、正文没写」的形态，
// 那时表格一坏就会静默丢一天。所以这里单独构造一份**只有表格**的最小页面。
const tableOnly = '<html><body>' +
  '<p>发布日期:2026-09-03</p>' +
  '<p>2026年10月</p>' +
  '<table>' +
  '<tr><td>1 放假</td></tr>' +
  '<tr><td>10 上班、上课，按 10月8日（周四）课表上课</td></tr>' +
  '</table></body></html>';
const tOnly = parseNotice(tableOnly, 'table-only', 'u');
eq(tOnly.length, 2, '表格路径：只有表格时也能解析出 2 条');
eq(planAt(tOnly, 2026, 10, 1), { kind: 'NoClass' }, '表格路径：10/1 放假');
eq(planAt(tOnly, 2026, 10, 10), { kind: 'MakeUp', targetWeekday: 4 }, '表格路径：10/10 按周四（不靠正文兜底）');

// 同年份推断：没有「发布日期」时表格也整条放弃（宁可少一条，不算错年份）
const tableNoPub = '<html><body><p>2026年10月</p><table><tr><td>1</td><td>放假</td></tr></table></body></html>';
eq(parseNotice(tableNoPub, 'x', 'u'), [], '表格路径：没有发布日期也整条放弃');

// ── 汇总 ─────────────────────────────────────────────────────────────

console.log('\n' + (fail === 0 ? 'ALL PASS' : 'HAS FAILURES') + '  pass=' + pass + ' fail=' + fail);
process.exitCode = fail === 0 ? 0 : 1;
