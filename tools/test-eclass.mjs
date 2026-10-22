/**
 * eclass 解析单测（M4-1）
 *
 * 为什么值得单测：解析错一条字段 = 「一个作业都收不到」或「把资料当成作业」，
 * 而界面上两者看起来都「正常」（有列表）。判据必须能证伪。
 *
 * 数据形状全部来自实测契约（BIT101-seat/docs/ddl-source-contract.md §二，
 * 2026-09-22/23）：visited_courses[] 与 activities[] 的真实字段。
 *
 * 跑法：node --experimental-transform-types tools/test-eclass.mjs
 */

import {
  parseCourse, parseCourses, parseActivity, parseActivities
} from '../entry/src/main/ets/core/model/EclassModels.ts';
import { isHomework, deadlineOf, uid } from '../entry/src/main/ets/corelogic/EclassDdlLogic.ts';

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

console.log('=== 1. 课程解析（visited_courses[] 一项）===');

// 契约实测的完整一条
const full = {
  id: 42, name: '操作系统', course_code: 'BIT101-OS', course_type: 1,
  current_user_is_member: true,
  department: { name: '计算机学院' },
  url: 'https://zy-eclass.bit.edu.cn/course/42',
  cover: '', grade: '', klass: ''
};
const c1 = parseCourse(full);
ok(c1 !== null, '完整课程能解析');
eq(c1.id, 42, 'id');
eq(c1.name, '操作系统', 'name');
eq(c1.courseCode, 'BIT101-OS', 'course_code');
eq(c1.department, '计算机学院', 'department.name');
eq(c1.url, 'https://zy-eclass.bit.edu.cn/course/42', 'http(s) url 保留');

console.log('\n=== 2. 课程解析的证伪点 ===');

eq(parseCourse({ id: 0, name: 'x' }), null, 'id=0 跳过');
eq(parseCourse({ id: 5, name: '' }), null, 'name 空跳过');
eq(parseCourse({ name: 'no id' }), null, '缺 id 跳过');
eq(parseCourse(null), null, 'null 跳过');
eq(parseCourse('str'), null, '非对象跳过');

// 契约：url 值未实测，只接受 http(s) 开头，否则回退首页
const rel = parseCourse({ id: 7, name: '课', url: 'course/7' });
eq(rel.url, '', '相对路径 url 清空');
const bad = parseCourse({ id: 7, name: '课', url: 'javascript:alert(1)' });
eq(bad.url, '', '非 http url 清空');

console.log('\n=== 3. 课程列表整体解析 ===');
const body = JSON.stringify({
  visited_courses: [
    { id: 1, name: '操作系统', department: { name: '计算机学院' } },
    { id: 2, name: '数据结构', department: { name: '计算机学院' } },
    { name: '没 id 的坏项' },
    { id: 4 } // 没名字
  ]
});
const r1 = parseCourses(body);
eq(r1.courses.length, 2, '两条好课程');
eq(r1.skipped, 2, '两条坏项被跳过并计数');
eq(parseCourses('not json').courses.length, 0, '非 JSON 整体当空（不当"没有课"）');
eq(parseCourses('{}').courses.length, 0, '无 visited_courses 字段当空');

console.log('\n=== 4. 动态解析 + 作业判定（字段存在性，不枚举 type）===');

// 契约实测的资料：type=material，无作业字段
const material = {
  id: 100, title: '第 1 章 课件', type: 'material', course_id: 42,
  start_time: null, end_time: null, visible_start_at: null, visible_end_at: null,
  is_closed: false
};
const m = parseActivity(material);
ok(m !== null, '资料能解析');
eq(isHomework(m), false, '纯资料不是作业');
eq(deadlineOf(m), null, '资料无截止时间');

// 契约：接口把没有的值返回成字符串 "null"
const strNull = parseActivity({
  id: 101, title: 'x', type: 'material', course_id: 42,
  start_time: 'null', end_time: 'null', visible_end_at: 'null', is_closed: 'false'
});
eq(strNull.endTime, null, '"null" 串当空');
eq(deadlineOf(strNull), null, '"null" 截止不当时间');

// submit_times=0 是合法值（「提交 0 次」）——0 不是缺失
const hw0 = parseActivity({
  id: 102, title: '实验一', type: 'homework', course_id: 42,
  end_time: '2026-11-01 23:59:00', submit_times: 0, is_closed: false
});
ok(hw0 !== null, '作业（submit_times=0）能解析');
eq(hw0.submitTimes, 0, 'submit_times=0 保留为 0（不当缺失）');
eq(isHomework(hw0), true, 'submit_times=0 仍是作业判据');
ok(deadlineOf(hw0) !== null, '截止时间可解析');

// is_review_homework=true（布尔真值）
const hwRev = parseActivity({
  id: 103, title: '互评作业', type: 'homework', course_id: 42,
  end_time: '2026-11-05 23:59:00', is_review_homework: true, is_closed: false
});
eq(isHomework(hwRev), true, 'is_review_homework=true 是作业');

// late_submission_count=2
const hwLate = parseActivity({
  id: 104, title: '迟交作业', type: 'homework', course_id: 42,
  end_time: '2026-11-05 23:59:00', late_submission_count: 2, is_closed: false
});
eq(isHomework(hwLate), true, 'late_submission_count=2 是作业');

// 资料即使带提交字段也不算（material 排除优先）
const matWithSubmit = parseActivity({
  id: 105, title: '带提交字段的资料', type: 'material', course_id: 42,
  end_time: '2026-11-05 23:59:00', submit_times: 3, is_closed: false
});
eq(isHomework(matWithSubmit), false, 'material 排除优先于字段存在性');

// 有作业字段但没有截止时间 ⇒ 不是作业（宁可漏不可误报）
const noDdl = parseActivity({
  id: 106, title: '无截止作业', type: 'homework', course_id: 42,
  end_time: null, visible_end_at: null, submit_times: 1, is_closed: false
});
eq(isHomework(noDdl), false, '无截止时间的作业不算（保守）');

// end_time 缺失时回退 visible_end_at
const visOnly = parseActivity({
  id: 107, title: '仅可见截止', type: 'homework', course_id: 42,
  end_time: null, visible_end_at: '2026-11-10 23:59:00', submit_times: 1, is_closed: false
});
ok(deadlineOf(visOnly) !== null, 'end_time 空时回退 visible_end_at');
eq(isHomework(visOnly), true, '回退后是作业');

// is_closed 布尔/字符串两态都要认
eq(parseActivity({ id: 108, title: 't', is_closed: true }).isClosed, true, 'is_closed 布尔 true');
eq(parseActivity({ id: 108, title: 't', is_closed: 'true' }).isClosed, true, 'is_closed 字符串 true');
eq(parseActivity({ id: 108, title: 't', is_closed: false }).isClosed, false, 'is_closed false');

console.log('\n=== 5. 动态列表整体解析 + uid 稳定性 ===');
const actBody = JSON.stringify({
  activities: [
    { id: 100, title: '课件', type: 'material', course_id: 42 },
    { id: 102, title: '实验一', type: 'homework', course_id: 42, end_time: '2026-11-01 23:59:00', submit_times: 0 },
    { title: '没 id' }
  ]
});
const r2 = parseActivities(actBody);
eq(r2.activities.length, 2, '两条好动态');
eq(r2.skipped, 1, '一条坏动态被计数');
eq(r2.activities.filter((a) => isHomework(a)).length, 1, '其中一条是作业');
eq(uid(102), 'eclass:102', 'uid 带 eclass: 前缀（防与乐学源撞键）');
eq(parseActivities('bad').activities.length, 0, '非 JSON 当空');

console.log('\n' + (failed === 0 ? 'ALL PASS' : 'FAILED') + '  pass=' + passed + ' fail=' + failed);
process.exit(failed > 0 ? 1 : 0);
