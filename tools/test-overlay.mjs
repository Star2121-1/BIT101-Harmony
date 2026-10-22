/**
 * 「手动修改课程表」合并逻辑单测（M2-8）——
 * 1:1 移植 Android `CourseOverlayLogicTest`（15 条）+ 鸿蒙侧周次工具。
 *
 * 锁四件事：**改 / 藏 / 加** 各自的语义、叠加时的**优先级**、
 * 「匹配不上时不许乱动课表」，以及**锚点与显示值分离**（改时间还能匹配原课）。
 *
 * ⚠️ 周次表示法与 Android 不同：鸿蒙侧 SKZC 是 `01` 串（`'1'` = 上课），
 * Android 是 `[1][2][3]`；语义相同，测试按 01 串写。
 *
 * 跑法：node --experimental-transform-types tools/test-overlay.mjs
 */

import {
  mergeOverlay,
  toOverlay,
  withDisplay,
  normalizeAnchors,
  keyOfCourse,
  keyOfOverlay,
  key,
  addedCourseId,
  weeksToSkzc,
  skzcToSelected
} from '../entry/src/main/ets/corelogic/CourseOverlayLogic.ts';

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

const TERM = '2026-2027-1';

/** 教务课程行（对应 Android course()）。 */
function course(o) {
  const p = Object.assign({
    name: '计算机网络', number: 'C001', classroom: '文萃楼404',
    weekday: 3, start: 3, end: 5, weeks: '11111'
  }, o || {});
  return {
    XNXQDM: TERM, KCM: p.name, SKJS: '张三', JASMC: p.classroom, YPSJDD: '',
    SKZC: p.weeks, SKXQ: p.weekday, KSJC: p.start, JSJC: p.end, XXXQMC: '中关村',
    KCH: p.number, XF: 3, XS: 48, KCXZDM_DISPLAY: '必修',
    KCLBDM_DISPLAY: '文化课', KKDWDM_DISPLAY: '计算机学院'
  };
}

/** 覆盖层（锚点默认指向 course() 默认那节；显示值默认与锚点相同）。 */
function overlay(o) {
  const p = Object.assign({
    id: 1, kind: 'EDIT', anchorNumber: 'C001', anchorWeekday: 3, anchorStartSection: 3,
    number: 'C001', name: '计算机网络', classroom: '文萃楼404',
    weekday: 3, start: 3, end: 5, weeks: '11111'
  }, o || {});
  return {
    id: p.id, kind: p.kind, term: TERM,
    anchorNumber: p.anchorNumber, anchorWeekday: p.anchorWeekday, anchorStartSection: p.anchorStartSection,
    number: p.number, name: p.name, teacher: '张三', classroom: p.classroom,
    weeks: p.weeks, weekday: p.weekday, startSection: p.start, endSection: p.end,
    campus: '中关村', credit: 3, hour: 48, type: '必修', category: '文化课',
    department: '计算机学院', updatedAt: 1000
  };
}

console.log('=== 1. 没有覆盖层 ===');
const two = [course({}), course({ number: 'C002', weekday: 4 })];
const passthrough = mergeOverlay(two, []);
eq(passthrough.length, 2, '没有覆盖层时原样返回（条数）');
eq(passthrough[0].KCH, 'C001', '原样返回（课程号）');
eq(passthrough[0].localId, 0, '教务行的 localId = 0（非本地新增）');
eq(passthrough[0].JASMC, '文萃楼404', '原样返回（教室）');

console.log('\n=== 2. 改（EDIT） ===');
const editMerged = mergeOverlay([course({})], [overlay({ classroom: '文萃楼501' })]);
eq(editMerged.length, 1, 'EDIT 后仍是一条');
eq(editMerged[0].JASMC, '文萃楼501', 'EDIT 替换教室');
eq(editMerged[0].localId, 0, 'EDIT 后 localId 仍 0（保留「教务行」身份，列表 key 稳定）');
eq(editMerged[0].KCM, '计算机网络', '未改的字段保持原值');

const weeksMerged = mergeOverlay([course({ weeks: '11000' })], [overlay({ weeks: '111111' })]);
eq(weeksMerged[0].SKZC, '111111', 'EDIT 可以改周次');

// ⚠️ 锚点与显示值分离的核心用例：周三 3-5 节 → 周四 1-2 节
const timeCourse = course({ weekday: 3, start: 3, end: 5 });
const timeOverlay = overlay({ weekday: 4, start: 1, end: 2 });
eq(keyOfCourse(timeCourse) === keyOfOverlay(timeOverlay), true, '锚点键仍匹配原课（改时间不改锚点）');
const timeMerged = mergeOverlay([timeCourse], [timeOverlay]);
eq(timeMerged.length, 1, '改时间后仍是 1 条');
eq(timeMerged[0].SKXQ, 4, '地点/时间相关：星期已改');
eq(timeMerged[0].KSJC, 1, '开始节已改');
eq(timeMerged[0].JSJC, 2, '结束节已改');
eq(timeMerged[0].localId, 0, '改时间后仍是教务行身份');

console.log('\n=== 3. 藏（HIDE） ===');
const hideMerged = mergeOverlay(two, [overlay({ kind: 'HIDE' })]);
eq(hideMerged.length, 1, 'HIDE 让那节课消失');
eq(hideMerged[0].KCH, 'C002', '留下的是没被藏的那门');
eq(mergeOverlay([course({})], [
  overlay({ id: 1, kind: 'EDIT', classroom: '改过的教室' }),
  overlay({ id: 2, kind: 'HIDE' })
]).length, 0, 'EDIT 与 HIDE 同时命中时藏优先');

console.log('\n=== 4. 加（ADD） ===');
const addMerged = mergeOverlay([course({})], [
  overlay({ id: 9, kind: 'ADD', anchorNumber: 'X9', name: '旁听的课' })
]);
eq(addMerged.length, 2, 'ADD 追加到末尾');
eq(addMerged[1].KCM, '旁听的课', '新增行的课名');
eq(addMerged[1].localId, -9, '新增行 localId 为负（= -overlayId）');
eq(addedCourseId(9), -9, 'addedCourseId 口径');
eq(mergeOverlay([], [
  overlay({ id: 9, kind: 'ADD', anchorNumber: 'X9', name: '旁听的课' }),
  overlay({ id: 10, kind: 'HIDE', anchorNumber: 'X9', name: '旁听的课' })
]).length, 0, '新增的课被 HIDE 时不出现（不幽灵浮现）');

console.log('\n=== 5. 匹配不上 / 脏数据 ===');
const staleEdit = mergeOverlay([course({})], [overlay({ kind: 'EDIT', anchorNumber: 'C999' })]);
eq(staleEdit.length, 1, '匹配不上的 EDIT 不产生任何行');
eq(staleEdit[0].KCH, 'C001', '匹配不上时原课不动');
eq(mergeOverlay(two, [overlay({ kind: 'HIDE', anchorNumber: 'C999' })]).length, 2, '匹配不上的 HIDE 不影响其它课');
const dirty = mergeOverlay(two, [
  overlay({ id: 1, kind: 'SOMETHING_ELSE' }),
  overlay({ id: 2, kind: 'HIDE', anchorNumber: 'C002', anchorWeekday: 4 })
]);
eq(dirty.length, 1, '认不出的 kind 被跳过，其它覆盖照常生效');
eq(dirty[0].KCH, 'C001', '留下的是没被藏的那门（脏数据用例）');

console.log('\n=== 6. 自然键与锚点 ===');
eq(keyOfCourse(course({ name: '别的名字', classroom: '别的教室' })) === keyOfCourse(course({})), true,
  '自然键只看 学期+课程号+星期+开始节（不看名称/教室）');
eq(keyOfCourse(course({ weekday: 4 })) !== keyOfCourse(course({})), true, '自然键区分星期');
eq(keyOfCourse(course({ start: 4 })) !== keyOfCourse(course({})), true, '自然键区分开始节次');
eq(key(TERM, 'C001', 3, 3), '2026-2027-1|C001|3|3', '键格式');

const src = course({ number: 'C007', weekday: 2, start: 9 });
const built = toOverlay('EDIT', src, 3, 42);
eq(built.id, 3, 'toOverlay 保留传入 id');
eq(built.kind, 'EDIT', 'toOverlay kind');
eq([built.anchorNumber, built.anchorWeekday, built.anchorStartSection], ['C007', 2, 9], '锚点取自来源行');
eq([built.number, built.weekday, built.startSection], ['C007', 2, 9], '显示值初值与锚点一致');
eq(built.JASMC, undefined, '覆盖层没有 JASMC 字段（显示值是 classroom）');
eq(built.classroom, '文萃楼404', '显示值初值取来源教室');
eq(built.updatedAt, 42, 'toOverlay 记录写入时刻');

const wdBase = toOverlay('EDIT', course({ number: 'C007', weekday: 2, start: 9 }), 0, 1);
const wdEdited = withDisplay(wdBase, { name: '改过的课名', classroom: '新教室', weekday: 5, startSection: 1 });
eq(wdEdited.name, '改过的课名', 'withDisplay 改课名');
eq(wdEdited.classroom, '新教室', 'withDisplay 改教室');
eq([wdEdited.weekday, wdEdited.startSection], [5, 1], 'withDisplay 改时间');
eq([wdEdited.anchorNumber, wdEdited.anchorWeekday, wdEdited.anchorStartSection],
  [wdBase.anchorNumber, wdBase.anchorWeekday, wdBase.anchorStartSection], 'withDisplay 不动锚点');

const existing = toOverlay('EDIT', course({ number: 'C008', weekday: 3, start: 2 }), 7, 1);
// UI 二次编辑时传来的 incoming：显示值已是改过的新时间，锚点跟着漂了
const drifted = withDisplay(existing, { weekday: 5, startSection: 1 });
drifted.anchorWeekday = 5;
drifted.anchorStartSection = 1;
const normalized = normalizeAnchors(drifted, existing);
eq([normalized.anchorNumber, normalized.anchorWeekday, normalized.anchorStartSection],
  [existing.anchorNumber, existing.anchorWeekday, existing.anchorStartSection],
  '更新已有覆盖时锚点沿用 existing');
eq([normalized.weekday, normalized.startSection], [5, 1], '显示值保持 incoming（用户改的时间要生效）');

const addO = withDisplay(toOverlay('ADD', course({ number: 'C009' }), 0, 1), { weekday: 6, startSection: 3 });
const addNorm = normalizeAnchors(addO, null);
eq([addNorm.anchorNumber, addNorm.anchorWeekday, addNorm.anchorStartSection], ['C009', 6, 3],
  'ADD 的锚点跟随自己的显示值');

console.log('\n=== 7. 周次工具（鸿蒙侧 01 串） ===');
eq(weeksToSkzc([1, 3, 5], 6), '101010', '周次集合 → 01 串');
eq(weeksToSkzc([], 4), '0000', '空集合 → 全 0');
eq(skzcToSelected('101010'), [1, 3, 5], '01 串 → 周次集合');
eq(skzcToSelected(''), [], '空串 → 空集合');
eq(weeksToSkzc(skzcToSelected('111000'), 6), '111000', '往返一致');

console.log('\n' + (failed === 0 ? 'ALL PASS' : 'FAILED') + '  pass=' + passed + ' fail=' + failed);
process.exit(failed > 0 ? 1 : 0);
