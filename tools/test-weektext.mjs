// 周次文本 + 课程详情装配守卫（P2）。
//
// 判据：单/双周能认出来、断续周次不被合并成连续、空字段整行不出现（不产生「学分 」残句）、
// 详情行顺序固定、教师分隔符统一成顿号。
//
//   node --experimental-transform-types tools/test-weektext.mjs

import { weekSpanText, activeWeeks, weekCount, totalWeeks } from '../entry/src/main/ets/corelogic/WeekSpan.ts';
import {
  creditText, categoryText, placeText, weekText, courseNoText, joinNames,
  detailLines, summaryText,
} from '../entry/src/main/ets/corelogic/CourseDetailLogic.ts';

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

/** 用周号集合造 SKZC 串（1 起）。 */
function skzc(weeks, total) {
  let s = '';
  for (let i = 1; i <= total; i++) {
    s += weeks.indexOf(i) >= 0 ? '1' : '0';
  }
  return s;
}

// ── 1. activeWeeks ────────────────────────────────────────────────────────
const w = activeWeeks('1010');
ok(w.length === 2 && w[0] === 1 && w[1] === 3, 'activeWeeks 取到 1/3 周', JSON.stringify(w));
ok(activeWeeks('').length === 0, '空串 → 无周次');
ok(activeWeeks('0000').length === 0, '全 0 → 无周次');
ok(activeWeeks('1x1').length === 2, '非法字符当 0 处理（不崩）');

// ── 2. 连续 / 单双周 ──────────────────────────────────────────────────────
const all1to16 = skzc([1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16], 16);
ok(weekSpanText(all1to16) === '1-16周', '连续 1-16 周', weekSpanText(all1to16));
const odd = skzc([1,3,5,7,9,11,13,15], 16);
ok(weekSpanText(odd) === '1-15周(单)', '奇数周 → 1-15周(单)', weekSpanText(odd));
const even = skzc([2,4,6,8,10,12,14,16], 16);
ok(weekSpanText(even) === '2-16周(双)', '偶数周 → 2-16周(双)', weekSpanText(even));

// 断续：1-4 与 6-8 不能合并成 1-8
const broken = skzc([1,2,3,4,6,7,8], 10);
ok(weekSpanText(broken) === '1-4,6-8周', '断续周次不合并', weekSpanText(broken));

// 单个周：不给「(单)」这种废话
const single = skzc([3], 16);
ok(weekSpanText(single) === '3周', '单周 → 3周（不加(单)）', weekSpanText(single));

// 两周一单：1 与 3（同奇偶）→ 1-3周(单)
ok(weekSpanText(skzc([1,3], 4)) === '1-3周(单)', '两周一单 → 1-3周(单)', weekSpanText(skzc([1,3], 4)));

// 空 → 未标注（不猜「全学期」）
ok(weekSpanText('') === '未标注', '空串 → 未标注');
ok(weekSpanText('0000') === '未标注', '全 0 → 未标注');

// ── 3. 计数 ───────────────────────────────────────────────────────────────
ok(weekCount(odd) === 8, 'weekCount 单周 8 次', String(weekCount(odd)));
ok(totalWeeks(odd) === 16, 'totalWeeks = 串长 16', String(totalWeeks(odd)));

// ── 4. 课程详情字段 ───────────────────────────────────────────────────────
function meta(over) {
  const base = {
    KCM: '高等数学（A）', KCH: 'MATH101', SKJS: '张伟,李娜', JASMC: '文萃楼I404',
    XXXQMC: '良乡校区', YPSJDD: '', SKZC: skzc([1,3,5], 8), XF: 4, XS: 64,
    KCXZDM_DISPLAY: '必修', KCLBDM_DISPLAY: '学科基础课', KKDWDM_DISPLAY: '数学学院',
  };
  return Object.assign(base, over === undefined ? {} : over);
}

ok(creditText(meta()) === '学分 4 · 学时 64', '学分学时', creditText(meta()));
ok(creditText(meta({ XF: 0, XS: 0 })) === '', '都取不到 → 空串（整行不显示）', creditText(meta({ XF: 0, XS: 0 })));
ok(creditText(meta({ XS: 0 })) === '学分 4', '只有学分 → 不出现残缺分隔符', creditText(meta({ XS: 0 })));

ok(categoryText(meta()) === '必修 · 学科基础课 · 数学学院', '性质/类别/单位用 · 连接', categoryText(meta()));
ok(categoryText(meta({ KCXZDM_DISPLAY: '', KKDWDM_DISPLAY: '' })) === '学科基础课', '空字段跳过', categoryText(meta({ KCXZDM_DISPLAY: '', KKDWDM_DISPLAY: '' })));

ok(placeText(meta()) === '文萃楼I404（良乡校区）', '教室 + 校区', placeText(meta()));
ok(placeText(meta({ JASMC: '', XXXQMC: '' })) === '未标注', '都空 → 未标注');
ok(placeText(meta({ JASMC: '' })) === '良乡校区', '只有校区');

ok(weekText(meta()) === '1-5周(单)', '详情周次用人话', weekText(meta()));
ok(courseNoText(meta()) === '课号 MATH101', '课号');
ok(courseNoText(meta({ KCH: '' })) === '', '无课号 → 空串');

ok(joinNames('张伟,李娜') === '张伟、李娜', '半角逗号 → 顿号', joinNames('张伟,李娜'));
ok(joinNames('张伟，李娜') === '张伟、李娜', '全角逗号 → 顿号', joinNames('张伟，李娜'));
ok(joinNames('') === '', '空教师 → 空串');
ok(joinNames(' 张伟 ,, 李娜 ') === '张伟、李娜', '多余分隔符/空白被清掉', joinNames(' 张伟 ,, 李娜 '));

// ── 5. detailLines 顺序与省略 ─────────────────────────────────────────────
const full = detailLines(meta());
ok(full.map((l) => l.label).join('|') === '周次|学分|课程属性|课程号|教师|地点',
  '详情行顺序固定', full.map((l) => l.label).join('|'));
ok(full[0].value === '1-5周(单)' && full[5].value === '文萃楼I404（良乡校区）', '行值正确');

const sparse = detailLines(meta({ XF: 0, XS: 0, KCH: '', KCXZDM_DISPLAY: '', KCLBDM_DISPLAY: '', KKDWDM_DISPLAY: '', SKJS: '' }));
ok(sparse.map((l) => l.label).join('|') === '周次|地点', '空字段整行不出现', sparse.map((l) => l.label).join('|'));

const withArrange = detailLines(meta({ YPSJDD: '1-16周 文萃楼I404' }));
ok(withArrange[withArrange.length - 1].label === '安排', '原始安排串排最后');

// ── 6. 摘要（搜索副标题/无障碍） ──────────────────────────────────────────
ok(summaryText(meta()) === '文萃楼I404 · 张伟、李娜 · 1-5周(单)', '摘要三段', summaryText(meta()));
ok(summaryText(meta({ JASMC: '', SKJS: '' })) === '1-5周(单)', '空字段跳过不留悬空分隔符', summaryText(meta({ JASMC: '', SKJS: '' })));
ok(summaryText(meta({ JASMC: '', SKJS: '', SKZC: '' })) === '', '全空 → 空串');

console.log('\n' + (fail === 0 ? 'ALL PASS' : 'FAILED') + '  pass=' + pass + ' fail=' + fail);
process.exit(fail === 0 ? 0 : 1);
