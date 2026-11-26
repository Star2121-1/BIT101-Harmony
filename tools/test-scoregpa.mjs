/**
 * GPA 统计（G-01）——教〔2022〕16号口径，逐条对齐 Android ScoreTable.kt。
 *
 * 判据：
 * 1. 数值边界：90→3.8 / 85→3.6 / 80→**3.3**（非 ties-even）/ 60→1.0 / 59→0 / 100→4.0
 * 2. 等级制 + 0 分标记（缺考/旷考/作弊/无效=0；缓考/免修=null 跳过）
 * 3. 85/3 + 45/4 → 1.5429（网页版 3.5781 是错的，别拿它当基准）
 * 4. 校公选不及格整门剔除；必修/专选不及格进分母
 * 5. 重修只在全量行上取最高；skipped/electiveFailed 按门不按行
 * 6. parseTable 抽课程编号/种类但不改 scoreKey（出分提醒契约）
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  gpaOf, scoreOf, round1, summarizeGpa, gpaKeyOf
} from '../entry/src/main/ets/corelogic/ScoreGpaLogic.ts';
import {
  parseTable, scoreKey
} from '../entry/src/main/ets/corelogic/ScoreLogic.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const code = (p) => readFileSync(join(root, p), 'utf8');

let pass = 0;
const eq = (a, b, m) => { assert.equal(a, b, m); pass++; };
const near = (a, b, m) => { assert.ok(a !== null && Math.abs(a - b) < 1e-9, m + '：' + a + ' ≈ ' + b); pass++; };
const ok = (c, m) => { assert.ok(c, m); pass++; };

console.log('=== 1. gpaOf 数值边界（half-up，非 ties-even）===');
near(gpaOf('100'), 4.0, '100→4.0');
near(gpaOf('90'), 3.8, '90→3.8');
near(gpaOf('85'), 3.6, '85→3.6');
near(gpaOf('80'), 3.3, '80→3.3（3.25 half-up，银行家舍入会错成 3.2）');
near(gpaOf('60'), 1.0, '60→1.0');
near(gpaOf('59'), 0, '59→0（不及格记 0，不是剔除）');
near(gpaOf('0'), 0, '0→0');
near(gpaOf('90分'), 3.8, '带「分」后缀可解析');
near(gpaOf(' 85 '), 3.6, '带空白可解析');
eq(round1(3.25), 3.3, 'round1(3.25)=3.3（half-up 直测）');
eq(round1(3.24), 3.2, 'round1(3.24)=3.2');

console.log('\n=== 2. 等级制 + 0 分标记 + 跳过 ===');
near(gpaOf('优秀'), 4.0, '优秀→4.0');
near(gpaOf('良好'), 3.6, '良好→3.6');
near(gpaOf('中等'), 2.8, '中等→2.8');
near(gpaOf('及格'), 1.7, '及格→1.7');
near(gpaOf('不及格'), 0, '不及格→0');
near(scoreOf('优秀'), 95, 'scoreOf 优秀→95');
near(scoreOf('及格'), 65, 'scoreOf 及格→65');
for (const z of ['缺考', '旷考', '作弊', '无效']) {
  near(gpaOf(z), 0, z + ' 绩点 0（真 0 分，办发〔2019〕75号）');
  near(scoreOf(z), 0, z + ' 分数 0');
}
near(gpaOf('作弊（违纪）'), 0, '含标记的组合写法也判 0');
eq(gpaOf('缓考'), null, '缓考→null（跳过，不是 0）');
eq(gpaOf('免修'), null, '免修→null');
eq(gpaOf('—'), null, '破折号→null');
eq(gpaOf(''), null, '空串→null');
eq(scoreOf(null), null, 'null→null');

console.log('\n=== 3. 关键对照：85/3 + 45/4 → 1.5429 ===');
const two = summarizeGpa([
  { course: 'A', score: '85', term: '2025-2026-1', credit: 3 },
  { course: 'B', score: '45', term: '2025-2026-1', credit: 4 },
]);
eq(Number(two.weightedGpa.toFixed(4)), 1.5429, 'GPA=1.5429（4 位展示；网页版 3.5781 是错的）');
eq(Number(two.weightedScore.toFixed(4)), 62.1429, '加权平均分 62.1429');
eq(two.courseCount, 2, '2 门都计入（不及格进分母）');
eq(two.totalCredit, 7, '总学分 7（含不及格）');
near(two.earnedCredit, 3, '已获学分只有及格的 3');
eq(two.skipped, 0, '无跳过');
eq(two.electiveFailed, 0, '无校公选剔除');

console.log('\n=== 4. 校公选课不及格剔除（唯一可整门剔除）===');
const elec = summarizeGpa([
  { course: '公选A', score: '50', term: 't', credit: 2, category: '校公选课' },
  { course: '必修B', score: '50', term: 't', credit: 2, category: '专业' },
  { course: '通识C', score: '40', term: 't', credit: 1, category: '文化素质通识课' },
]);
eq(elec.courseCount, 1, '只剩必修 B 计入');
eq(elec.electiveFailed, 2, '校公选+通识两门不及格剔除（按门）');
eq(elec.totalCredit, 2, '分母只剩必修 2 学分');
// 反例：公选及格不剔除
const elecPass = summarizeGpa([
  { course: '公选A', score: '90', term: 't', credit: 2, category: '校公选课' },
]);
eq(elecPass.courseCount, 1, '校公选及格照常计入');
eq(elecPass.electiveFailed, 0, '及格的不剔除');
// 「公共选修课」不是精确取值，不剔除（宁可绩点偏低）
const fuzzy = summarizeGpa([
  { course: '公选X', score: '50', term: 't', credit: 2, category: '公共选修课' },
]);
eq(fuzzy.courseCount, 1, '「公共选修课」不在精确集合，照常计入（防绩点虚高）');

console.log('\n=== 5. 重修去重 + skipped 按门 ===');
const redo = summarizeGpa([
  { course: '数据结构', score: '60', term: 't1', credit: 3, courseNumber: 'CS101' },
  { course: '数据结构', score: '85', term: 't2', credit: 3, courseNumber: 'CS101' },
  { course: '缓考课', score: '缓考', term: 't1', credit: 2 },
  { course: '缓考课', score: '90', term: 't2', credit: 2 },
]);
eq(redo.courseCount, 2, '两门课（数据结构取最高 + 缓考课有及格那条）');
near(redo.weightedGpa, (3.6 * 3 + 3.8 * 2) / 5, '重修取最高 85 绩点 3.6');
eq(redo.skipped, 0, '缓考课因另有一条及格，不重复计入 skipped（按门）');
// 无编号退回课程名去重
eq(gpaKeyOf({ course: '数据结构', score: '85', term: 't' }), 'c:数据结构', '无编号→课程名键');
eq(gpaKeyOf({ course: '任意', score: '85', term: 't', courseNumber: ' CS101 ' }), 'n:cs101', '有编号→编号键（去空格小写）');
// 全缓考一门 → skipped=1
const allSkip = summarizeGpa([{ course: '缓考课', score: '缓考', term: 't', credit: 2 }]);
eq(allSkip.skipped, 1, '整门缓考 skipped=1');
eq(allSkip.courseCount, 0, '计入 0 门');
eq(allSkip.weightedGpa, null, '无课可统计 GPA=null（不编造）');

console.log('\n=== 6. parseTable 抽新列但不破坏出分提醒契约 ===');
const table = [
  ['序号', '开课学期', '课程编号', '课程名称', '成绩', '成绩标识', '学分', '课程种类'],
  ['1', '2025-2026-1', 'CS101', '数据结构', '85', '正常考试', '3', '专业'],
];
const parsed = parseTable(table);
eq(parsed.length, 1, '解析出 1 门');
eq(parsed[0].course, '数据结构', '课名正确（没被「课程编号」列带偏）');
eq(parsed[0].score, '85', '成绩取「成绩」列不是「成绩标识」');
eq(parsed[0].courseNumber, 'CS101', '课程编号已抽');
eq(parsed[0].category, '专业', '课程种类已抽');
eq(parsed[0].credit, 3, '学分已抽');
eq(scoreKey(parsed[0]), '数据结构|2025-2026-1', 'scoreKey 仍是「课程|学期」，未被新字段污染');
// 列序调换：成绩标识在前，也不能误取
const swapped = [
  ['序号', '成绩标识', '课程名称', '成绩', '学分'],
  ['1', '正常考试', '数据结构', '85', '3'],
];
eq(parseTable(swapped)[0].score, '85', '列序调换后成绩仍取「成绩」列（排除词生效）');

console.log('\n=== 7. 源码守卫（静态）===');
const gpaSrc = code('entry/src/main/ets/corelogic/ScoreGpaLogic.ts');
const logicSrc = code('entry/src/main/ets/corelogic/ScoreLogic.ts');
ok(gpaSrc.includes('Math.floor(x * 10 + 0.5) / 10'), 'half-up 用 floor(x*10+0.5)，非 Math.round');
ok(gpaSrc.includes("'校公选课', '校公选', '文化素质通识课', '实践训练通识课', '拓展英语'"),
  '校公选精确集合（不收「公共选修课」）');
ok(gpaSrc.includes("ZERO_MARKERS: string[] = ['缺考', '旷考', '作弊', '无效']"), '0 分标记齐全');
ok(logicSrc.includes("['标识', '性质', '方式', '类型', '备注', '说明', '绩点']"), '成绩列排除词已加');
ok(logicSrc.includes("courseNumber?: string") && logicSrc.includes("category?: string"),
  'ScoreEntry 新增两个可选字段');

console.log('\n=== 8. CSV 导出 RFC 4180 转义（G-02）===');
const { csvCell, scoreCsv, CSV_HEADER } = await import('../entry/src/main/ets/corelogic/ScoreCsvLogic.ts');
eq(csvCell('数据结构'), '数据结构', '普通字段不加引号');
eq(csvCell('数学, 英语'), '"数学, 英语"', '含逗号加引号');
eq(csvCell('他说"好"'), '"他说""好"""', '含引号 doubled');
eq(csvCell('a\nb'), '"a\nb"', '含换行加引号');
const csv = scoreCsv([{ course: '数据结构, 实验', score: '85', term: '2025-2026-1', credit: 3 }]);
ok(csv.startsWith(CSV_HEADER + '\r\n'), '表头 + CRLF');
ok(csv.includes('"数据结构, 实验"'), '课名逗号已转义（官方那版不转义会错列）');
ok(!csv.includes('undefined'), 'CSV 不含 undefined');
const emptyCsv = scoreCsv([]);
eq(emptyCsv, CSV_HEADER + '\r\n', '空表只给表头');

console.log('\n' + 'ALL PASS  pass=' + pass + ' fail=0');
process.exit(0);
