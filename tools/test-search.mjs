// 全局搜索纯逻辑守卫（P1）。
//
// 判据：归一化能吃全角、多词是**与**关系、打分优先级固定、分组顺序固定、
// 空查询不猜「推荐」、同分排序可复现。
//
//   node --experimental-transform-types tools/test-search.mjs

import { SearchKind, norm, termsOf, scoreTerm, scoreDoc, search, totalHits, kindLabel } from '../entry/src/main/ets/corelogic/SearchLogic.ts';
import { moduleFullName } from '../entry/src/main/ets/corelogic/shellNav.ts';

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

function doc(id, kind, title, subtitle, extra) {
  return { id: id, kind: kind, title: title, subtitle: subtitle, extra: extra };
}

const DOCS = [
  doc('c1', SearchKind.Course, '高等数学（A）', '文萃楼I404 · 张伟 · 1-16周', 'MATH101'),
  doc('c2', SearchKind.Course, '数据结构与算法', '文萃楼J201 · 李娜 · 1-15周(单)', 'CS201'),
  doc('c3', SearchKind.Course, '大学物理', '理科教学楼A305 · 王强', 'PHYS101'),
  doc('d1', SearchKind.Ddl, '数据结构第三次作业', '10/30（周五）前提交', ''),
  doc('r1', SearchKind.Room, '文萃楼I404', '良乡校区 · 60 座', 'Ｉ４０４'),
  doc('s1', SearchKind.Shuttle, '良乡 ↔ 中关村', '08:00 首班', ''),
];

// ── 1. 归一化 ─────────────────────────────────────────────────────────────
ok(norm('Ｉ４０４') === 'i404', '全角 Ｉ４０４ → i404', norm('Ｉ４０４'));
ok(norm(' 文萃 楼\u3000A ') === '文萃楼a', '去空白（含全角空格）+ 小写', norm(' 文萃 楼\u3000A '));
ok(norm('ABC') === 'abc', '字母转小写');
ok(norm('') === '', '空串归一化仍是空串');

// ── 2. 分词 ───────────────────────────────────────────────────────────────
const t1 = termsOf(' 文萃   Ｉ４０４ ');
ok(t1.length === 2 && t1[0] === '文萃' && t1[1] === 'i404', '多词切开并各自归一化', JSON.stringify(t1));
ok(termsOf('   ').length === 0, '纯空白 → 无词');
ok(termsOf('').length === 0, '空串 → 无词');

// ── 3. 打分优先级 ─────────────────────────────────────────────────────────
const course = DOCS[0];
ok(scoreTerm(course, '高等') === 100, '标题前缀 = 100');
ok(scoreTerm(course, '数学') === 60, '标题包含 = 60');
ok(scoreTerm(course, '文萃') === 30, '副标题 = 30');
ok(scoreTerm(course, 'math101') === 15, '附加字段 = 15（且大小写不敏感）');
ok(scoreTerm(course, '物理') === 0, '不命中 = 0');
// 全角查询也能命中副标题
ok(scoreTerm(course, norm('ｉ４０４')) === 30, '全角 i404 命中副标题（归一化生效）');

// ── 4. 多词是与关系 ───────────────────────────────────────────────────────
ok(scoreDoc(course, ['文萃', '数学']) > 0, '两个词都命中 → 有分');
ok(scoreDoc(course, ['文萃', '物理']) === 0, '任一词不命中 → 0（与关系）', String(scoreDoc(course, ['文萃', '物理'])));
ok(scoreDoc(course, []) === 0, '空词表 → 0');

// ── 5. 搜索与分组 ─────────────────────────────────────────────────────────
const g1 = search(DOCS, '文萃', 0);
ok(g1.length === 2, '「文萃」命中两组（课程 + 教室）', 'groups=' + g1.length);
ok(g1[0].kind === SearchKind.Course && g1[1].kind === SearchKind.Room,
  '分组顺序固定：课程在教室前', g1.map((g) => g.kind).join(','));
ok(totalHits(g1) === 3, '「文萃」共 3 条（2 课程 + 1 教室，DDL 不含文萃）', String(totalHits(g1)));

const g2 = search(DOCS, '数据结构', 0);
ok(g2.length === 2, '「数据结构」命中课程与作业两组');
ok(g2[0].hits.length === 1 && g2[0].hits[0].doc.id === 'c2', '课程组命中 c2');
ok(g2[1].hits.length === 1 && g2[1].hits[0].doc.id === 'd1', '作业组命中 d1');

// 打分：标题前缀优先于副标题命中
const g3 = search(DOCS, '文萃', 0);
const roomHit = g3[1].hits[0];
ok(roomHit.score === 100, '教室「文萃楼I404」标题前缀命中得 100', String(roomHit.score));

// ── 6. limit ──────────────────────────────────────────────────────────────
const g4 = search(DOCS, '文萃', 1);
ok(g4.length === 2 && g4[0].hits.length === 1 && g4[1].hits.length === 1, 'limit 按组生效');
const g5 = search(DOCS, '文萃', -1);
ok(g5[0].hits.length === 2, 'limit<=0 视为不限');

// ── 7. 空查询不猜 ─────────────────────────────────────────────────────────
ok(search(DOCS, '', 0).length === 0, '空查询 → 无结果（不猜推荐）');
ok(search(DOCS, '   ', 0).length === 0, '纯空白查询 → 无结果');
ok(search([], '文萃', 0).length === 0, '空文档集 → 无结果');

// ── 8. 稳定性 ─────────────────────────────────────────────────────────────
const same = [
  doc('b', SearchKind.Room, '文萃楼A', '', ''),
  doc('a', SearchKind.Room, '文萃楼A', '', ''),
];
const r1 = search(same, '文萃楼a', 0)[0].hits.map((h) => h.doc.id);
const r2 = search(same.slice().reverse(), '文萃楼a', 0)[0].hits.map((h) => h.doc.id);
ok(JSON.stringify(r1) === JSON.stringify(['a', 'b']), '同分按 id 排序（可复现）', JSON.stringify(r1));
ok(JSON.stringify(r1) === JSON.stringify(r2), '输入顺序变化不影响结果顺序');

// 短标题优先
const titles = [
  doc('x1', SearchKind.Course, '高等数学（A）', '', ''),
  doc('x2', SearchKind.Course, '高等数学', '', ''),
];
const shortFirst = search(titles, '高等数学', 0)[0].hits.map((h) => h.doc.title);
ok(shortFirst[0] === '高等数学', '同分短标题优先（更精确）', JSON.stringify(shortFirst));

// ── 9. 类型标签 ───────────────────────────────────────────────────────────
ok(kindLabel(SearchKind.Course) === '课程' && kindLabel(SearchKind.Ddl) === '作业'
  && kindLabel(SearchKind.Room) === '教室' && kindLabel(SearchKind.Shuttle) === '班车', '四种类型的中文名');

// ── 10. 底栏单字的无障碍全名 ───────────────────────────────────────────────
ok(moduleFullName('schedule') === '课表', '卷 → 课表');
ok(moduleFullName('map') === '校园楼栋', '图 → 校园楼栋（不再是「地图」：本版是楼栋索引）');
ok(moduleFullName('seat') === '座位', '座 → 座位');
ok(moduleFullName('unknown_key') === 'unknown_key', '未知 key 回退到 key（不编名字）');

console.log('\n' + (fail === 0 ? 'ALL PASS' : 'FAILED') + '  pass=' + pass + ' fail=' + fail);
process.exit(fail === 0 ? 0 : 1);
