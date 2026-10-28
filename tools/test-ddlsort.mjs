// DDL 排序模式守卫（M12-5）。
//
// 判据：分区不变（未完成在前）；due = 截止升序；course = 课程名升序 + 组内按截止；
// 空课程名排最后；已完成永远截止倒序；排序稳定（同截止按 uid，不掉位）；不改入参。
//
//   node --experimental-transform-types tools/test-ddlsort.mjs

import {
  DdlSortMode, DEFAULT_DDL_SORT, parseSortMode, sortPending, sortDone,
  sortLabel, nextSortMode,
} from '../entry/src/main/ets/corelogic/DdlSortLogic.ts';

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

/** 造条目：uid 默认按 title 生成。 */
function e(uid, text, day, minutes, done = false) {
  return { uid, group: 'eclass', title: uid + ' 的作业', text, day, minutes, done };
}

const raw = [
  e('a', '操作系统', 5, 600),          // 周四 10:00
  e('b', '计算机网络', 3, 1200),        // 周二 20:00
  e('c', '操作系统', 3, 600),           // 周二 10:00
  e('d', '', 4, 60),                   // 无课程名
  e('e', '计算机网络', 3, 1200),        // 与 b 截止完全相同（稳定性）
  e('f', '数学', 1, 0, true),          // 已完成
  e('g', '英语', 9, 0, true),          // 已完成
];

// ── 1. 模式解析 ─────────────────────────────────────────────────────────
ok(parseSortMode('course') === DdlSortMode.COURSE, 'course 被认出');
ok(parseSortMode('') === DdlSortMode.DUE, '空串 → 默认 due');
ok(parseSortMode('随便什么') === DdlSortMode.DUE, '脏值 → 默认 due');
ok(DEFAULT_DDL_SORT === DdlSortMode.DUE, '默认是按截止');

// ── 2. due：截止升序，已完成被剔除 ──────────────────────────────────────
const due = sortPending(raw, DdlSortMode.DUE);
ok(due.length === 5, '未完成 5 条（已完成不进 pending）', String(due.length));
ok(due.map((x) => x.uid).join(',') === 'c,b,e,d,a', 'due 按天→分钟升序',
  due.map((x) => x.uid).join(','));
ok(due.every((x) => !x.done), 'pending 里没有已完成');

// ── 3. course：课程名聚拢，组内按截止 ───────────────────────────────────
const byCourse = sortPending(raw, DdlSortMode.COURSE);
// 不钉跨课程的具体次序（中文排序跟随语言环境），钉三条与环境无关的性质：
//  ① 同一课程名必须相邻（聚拢）
//  ② 每个课程组内部按截止升序
//  ③ 无课程名的排最后
function groupsOf(list) {
  const out = [];
  for (const x of list) {
    const g = x.text.trim();
    if (out.length === 0 || out[out.length - 1].name !== g) {
      out.push({ name: g, items: [x] });
    } else {
      out[out.length - 1].items.push(x);
    }
  }
  return out;
}
const gs = groupsOf(byCourse);
ok(gs.length === 3, '三门课聚成 3 组（操作系统 / 计算机网络 / 空名）', String(gs.length));
ok(gs.every((g) => g.name === '' || g.items.every((x) => x.text.trim() === g.name)),
  '组内课程名一致（没有串组）');
const anyDuplicatedName = new Set(gs.map((g) => g.name)).size !== gs.length;
ok(!anyDuplicatedName, '同名课程没有被拆成两组', JSON.stringify(gs.map((g) => g.name)));
let groupOrdered = true;
for (const g of gs) {
  for (let i = 1; i < g.items.length; i++) {
    const p = g.items[i - 1];
    const q = g.items[i];
    if (p.day > q.day || (p.day === q.day && p.minutes > q.minutes)) {
      groupOrdered = false;
    }
  }
}
ok(groupOrdered, '每个课程组内部按截止升序');
ok(byCourse[byCourse.length - 1].uid === 'd', '无课程名的排最后',
  byCourse[byCourse.length - 1].uid);
// 课程组的相对次序应与「课程名 sorted」一致（用 localeCompare 独立算一遍对照）
const uniqueNames = [...new Set(raw.filter((x) => !x.done && x.text.trim() !== '')
  .map((x) => x.text.trim()))];
const namesInResult = gs.filter((g) => g.name !== '').map((g) => g.name);
ok(namesInResult.join('|') === uniqueNames.slice().sort((a, b) => a.localeCompare(b, 'zh-Hans-CN')).join('|'),
  '课程组次序 = 课程名排序结果', namesInResult.join('|'));

// ── 4. 稳定性：截止完全相同的那两条，顺序不该随输入顺序翻转 ────────────
const shuffled = [e('b', '计算机网络', 3, 1200), e('e', '计算机网络', 3, 1200)];
const s1 = sortPending(shuffled, DdlSortMode.DUE).map((x) => x.uid).join(',');
const s2 = sortPending([...shuffled].reverse(), DdlSortMode.DUE).map((x) => x.uid).join(',');
ok(s1 === s2, '同截止同课程 → 顺序与输入无关（稳定）', s1 + ' vs ' + s2);
ok(s1 === 'b,e', '按 uid 兜底升序', s1);

// ── 5. 已完成：截止倒序，与模式无关 ─────────────────────────────────────
const done = sortDone(raw);
ok(done.map((x) => x.uid).join(',') === 'g,f', 'done 截止倒序（最近在上）',
  done.map((x) => x.uid).join(','));

// ── 6. 不修改入参 ───────────────────────────────────────────────────────
const before = raw.map((x) => x.uid).join(',');
sortPending(raw, DdlSortMode.COURSE);
sortDone(raw);
ok(raw.map((x) => x.uid).join(',') === before, '排序不改入参顺序', raw.map((x) => x.uid).join(','));

// ── 7. 空输入 / 全已完成 ────────────────────────────────────────────────
ok(sortPending([], DdlSortMode.DUE).length === 0, '空输入 → 空');
ok(sortPending([e('x', 'X', 1, 0, true)], DdlSortMode.COURSE).length === 0, '只有已完成 → pending 空');
ok(sortDone([e('x', 'X', 1, 0, false)]).length === 0, '只有未完成 → done 空');

// ── 8. 标签与轮换 ───────────────────────────────────────────────────────
ok(sortLabel(DdlSortMode.DUE) === '按截止', 'due 标签');
ok(sortLabel(DdlSortMode.COURSE) === '按课程', 'course 标签');
ok(nextSortMode(DdlSortMode.DUE) === DdlSortMode.COURSE, 'due → course');
ok(nextSortMode(DdlSortMode.COURSE) === DdlSortMode.DUE, 'course → due');
ok(nextSortMode(nextSortMode(DdlSortMode.DUE)) === DdlSortMode.DUE, '切两下回原档');

console.log('\n' + (fail === 0 ? 'ALL PASS' : 'FAILED') + '  pass=' + pass + ' fail=' + fail);
process.exit(fail === 0 ? 0 : 1);
