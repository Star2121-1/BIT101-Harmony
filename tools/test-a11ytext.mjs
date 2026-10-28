// 读屏文案口径守卫（M11-6 扫尾）。
//
// 判据：布尔一律中文（不许出现 true/false）；空段不留「，，」或悬空逗号；
// 未读 0 说「没有未读」而不是「无条未读」；99+ 与徽标同口径且带上实际值；
// 分母非法时不编分母；金额 NaN 说「未知」而不是 0.00。
//
//   node --experimental-transform-types tools/test-a11ytext.mjs

import {
  joinA11y, switchA11y, rowA11y, unreadA11y, progressA11y, chipA11y,
  moneyA11y, spanA11y,
} from '../entry/src/main/ets/corelogic/A11yText.ts';

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

// ── 1. joinA11y：空段不留悬空分隔符 ─────────────────────────────────────
ok(joinA11y(['a', 'b']) === 'a，b', '两段用中文逗号');
ok(joinA11y(['a', '', 'b']) === 'a，b', '中间空段被跳过', joinA11y(['a', '', 'b']));
ok(joinA11y(['', '', '']) === '', '全空 → 空串');
ok(joinA11y(['  a  ', ' b ']) === 'a，b', '各段去首尾空白', joinA11y(['  a  ', ' b ']));
ok(joinA11y([]) === '', '空数组 → 空串');

// ── 2. switchA11y：布尔必须中文 ─────────────────────────────────────────
ok(switchA11y('夜间模式', true) === '夜间模式，已开启', '开关开启', switchA11y('夜间模式', true));
ok(switchA11y('夜间模式', false) === '夜间模式，已关闭', '开关关闭', switchA11y('夜间模式', false));
ok(switchA11y('夜间模式', true).indexOf('true') < 0, '不出现 true');
ok(switchA11y('夜间模式', false).indexOf('false') < 0, '不出现 false');

// ── 3. rowA11y：值可为空 ────────────────────────────────────────────────
ok(rowA11y('GPA', '3.72', '点击查看详情') === 'GPA，3.72，点击查看详情', '三段齐全');
ok(rowA11y('GPA', '', '点击查看详情') === 'GPA，点击查看详情', '空值不留悬空逗号',
  rowA11y('GPA', '', '点击查看详情'));
ok(rowA11y('GPA', '3.72', '') === 'GPA，3.72', '空提示不留悬空逗号', rowA11y('GPA', '3.72', ''));
ok(rowA11y('', '', '') === '', '全空 → 空串（不产生只读逗号的行）');

// ── 4. unreadA11y：0 / 正常 / 超上限 ────────────────────────────────────
ok(unreadA11y(0, '未读', 99) === '没有未读', '0 → 没有未读', unreadA11y(0, '未读', 99));
ok(unreadA11y(3, '未读', 99) === '3 条未读', '正常计数', unreadA11y(3, '未读', 99));
ok(unreadA11y(-2, '未读', 99) === '没有未读', '负数按 0 处理', unreadA11y(-2, '未读', 99));
ok(unreadA11y(NaN, '未读', 99) === '没有未读', 'NaN 按 0 处理', unreadA11y(NaN, '未读', 99));
ok(unreadA11y(150, '未读', 99) === '99+ 条未读（实际 150）', '超上限带实际值',
  unreadA11y(150, '未读', 99));
ok(unreadA11y(150, '未读', 0) === '150 条未读', 'cap=0 表示不限', unreadA11y(150, '未读', 0));
ok(unreadA11y(3.9, '未读', 99) === '3 条未读', '小数向下取整', unreadA11y(3.9, '未读', 99));

// ── 5. progressA11y：分母非法不编 ───────────────────────────────────────
ok(progressA11y('已选', 3, 12) === '已选，3 / 12', '正常进度', progressA11y('已选', 3, 12));
ok(progressA11y('已选', 3, 0) === '已选，3', '分母 0 → 只说分子', progressA11y('已选', 3, 0));
ok(progressA11y('已选', 3, NaN) === '已选，3', '分母 NaN → 只说分子', progressA11y('已选', 3, NaN));

// ── 6. chipA11y ─────────────────────────────────────────────────────────
ok(chipA11y('配色方案', 'Warm', true) === '配色方案，Warm，已选中', 'chip 选中',
  chipA11y('配色方案', 'Warm', true));
ok(chipA11y('配色方案', 'Warm', false) === '配色方案，Warm，未选中', 'chip 未选中',
  chipA11y('配色方案', 'Warm', false));

// ── 7. moneyA11y：NaN 不能显示 0.00 ─────────────────────────────────────
ok(moneyA11y('余额', 18.6) === '余额，18.60 元', '金额两位小数', moneyA11y('余额', 18.6));
ok(moneyA11y('余额', NaN) === '余额，未知', 'NaN → 未知（不显示 0.00）', moneyA11y('余额', NaN));
ok(moneyA11y('余额', 0) === '余额，0.00 元', '真 0 元照实说', moneyA11y('余额', 0));

// ── 8. spanA11y ─────────────────────────────────────────────────────────
ok(spanA11y('时间', '08:00', '09:35') === '时间，08:00 至 09:35', '成对时间',
  spanA11y('时间', '08:00', '09:35'));
ok(spanA11y('时间', '08:00', '') === '时间，08:00', '缺结束 → 只说开始', spanA11y('时间', '08:00', ''));
ok(spanA11y('时间', '', '09:35') === '时间，09:35', '缺开始 → 只说结束', spanA11y('时间', '', '09:35'));
ok(spanA11y('时间', '', '') === '时间', '都缺 → 只有标签', spanA11y('时间', '', ''));

// ── 9. 全量扫一遍：任何输出都不该出现英文布尔或连续逗号 ──────────────────
const samples = [
  switchA11y('a', true), switchA11y('a', false),
  rowA11y('a', '', ''), unreadA11y(0, '未读', 99), unreadA11y(200, '未读', 99),
  progressA11y('p', 0, 0), chipA11y('c', '', true), moneyA11y('m', NaN),
  spanA11y('s', '', ''),
];
let bad = '';
for (const s of samples) {
  if (/true|false|undefined|null|NaN/.test(s) || s.indexOf('，，') >= 0 ||
      s.startsWith('，') || s.endsWith('，')) {
    bad += '[' + s + ']';
  }
}
ok(bad === '', '无英文布尔/空值/连续逗号', bad);

console.log('\n' + (fail === 0 ? 'ALL PASS' : 'FAILED') + '  pass=' + pass + ' fail=' + fail);
process.exit(fail === 0 ? 0 : 1);
