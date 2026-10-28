// 存储清理与诊断守卫（P6/P7）。
//
// 最重要的一条：**清缓存绝不能删到设置/凭据**。本测试用真实键名列表验证
// 「未列入白名单的键永远不会被归到任何可清理项」。
//
//   node --experimental-transform-types tools/test-cacheindex.mjs

import {
  CACHE_SPECS, specs, defaultSpecs, matches, assignKeys, sizeText, totalBytes,
  clearConfirmText, emptySelectionText,
} from '../entry/src/main/ets/corelogic/CacheIndex.ts';
import { maskStudent, yesNo, diagLines, diagText } from '../entry/src/main/ets/corelogic/DiagnosticsLogic.ts';

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

// ── 1. 白名单构成 ─────────────────────────────────────────────────────────
ok(CACHE_SPECS.length === 6, '6 个可清理项', String(CACHE_SPECS.length));
ok(defaultSpecs().length === 5, '默认（不含用户数据）5 项', String(defaultSpecs().length));
ok(defaultSpecs().every((s) => s.userData === false), '默认项里没有 userData');
ok(specs(true).length === 6, '显式包含用户数据 → 6 项');
ok(specs(true).filter((s) => s.userData).length === 1, 'userData 项只有一个（作业数据）');
ok(specs(true).filter((s) => s.userData)[0].kind === 'ddl', 'userData 是 ddl');
ok(specs(true).filter((s) => s.userData)[0].note.indexOf('不可恢复') > 0, '作业项文案点明不可恢复');

// ── 2. 键匹配 ─────────────────────────────────────────────────────────────
const sched = CACHE_SPECS.filter((s) => s.kind === 'schedule')[0];
ok(matches(sched, 'schedule_cache_v2_2025-2026-1'), '前缀匹配课表缓存');
ok(matches(sched, 'schedule_last_term'), '精确匹配 last_term');
ok(!matches(sched, 'schedule_cache_v3_x'), '版本不同的前缀不匹配（不误删未来格式）');
ok(!matches(sched, 'notify_records_v1'), '别的键不匹配');

const score = CACHE_SPECS.filter((s) => s.kind === 'score')[0];
ok(matches(score, 'score_cache_v1'), '成绩缓存精确匹配');
ok(!matches(score, 'score_snapshot_v1'), '快照**不在**清理项里（清了会重复提醒历史成绩）',
  '若这里变成 true，说明有人把 snapshot 加进了白名单');
ok(!matches(score, 'score_last_check_v1'), '出分检查时间戳不清（清了会立刻重新检查）');

// ── 3. 最关键的：敏感键永不被归入 ─────────────────────────────────────────
const ALL_KEYS = [
  // 可清
  'schedule_cache_v2_2025-2026-1', 'schedule_cache_v2_2024-2025-2', 'schedule_last_term',
  'exam_cache_v1_2025-2026-1', 'exam_last_term',
  'score_cache_v1', 'teaching_adjustments_v1', 'ta_fetch',
  'notify_records_v1', 'notify_sent_v1',
  'ddl_schedule_v1',
  // 绝不可清（设置 / 凭据 / 快照 / 状态）
  'theme_palette', 'theme_mode', 'ui_term_override', 'school_cookie', 'seat_jwt',
  'eclass_cookie', 'lib_cookie', 'card_cookie', 'score_snapshot_v1', 'score_last_check_v1',
  'score_cred_student', 'notify_settings_v1', 'timetable_custom_v1', 'ddl_source_prefs',
  'seat_task_v1', 'campus_card_balance',
];
const assigned = assignKeys(ALL_KEYS, true);
const assignedKeys = [];
assigned.forEach((v) => v.forEach((k) => assignedKeys.push(k)));

const SENSITIVE = ['theme_palette', 'theme_mode', 'ui_term_override', 'school_cookie', 'seat_jwt',
  'eclass_cookie', 'lib_cookie', 'card_cookie', 'score_snapshot_v1', 'score_last_check_v1',
  'score_cred_student', 'notify_settings_v1', 'timetable_custom_v1', 'ddl_source_prefs',
  'seat_task_v1', 'campus_card_balance'];
const leaked = SENSITIVE.filter((k) => assignedKeys.indexOf(k) >= 0);
ok(leaked.length === 0, '设置/凭据/快照键一个都没被归入可清理项', leaked.join(','));

ok(assigned.get('schedule').length === 3, '课表缓存 3 个键（2 学期 + last_term）', String(assigned.get('schedule').length));
ok(assigned.get('ddl').length === 1, '作业数据 1 个键');
ok(assigned.get('score').length === 1, '成绩缓存 1 个键（不含快照）');
ok(assigned.get('notify').length === 2, '提醒记录 2 个键', String(assigned.get('notify').length));

// 默认（不含用户数据）时 ddl 不该出现
const noUser = assignKeys(ALL_KEYS, false);
ok(noUser.get('ddl') === undefined, '默认不归入作业数据', String(noUser.get('ddl')));
ok(noUser.get('schedule').length === 3, '默认仍归入课表缓存');

// 重复键不丢（一个键只归一项）
const dup = assignKeys(['schedule_last_term', 'schedule_last_term'], true).get('schedule');
ok(dup.length === 2, '同一键出现两次也会各自归入（调用方按键去重）');

// ── 4. 体积文本 ───────────────────────────────────────────────────────────
ok(sizeText(0) === '0 B', '0 → 0 B');
ok(sizeText(-5) === '0 B', '负数 → 0 B');
ok(sizeText(512) === '512 B', '512 → 512 B', sizeText(512));
ok(sizeText(1024) === '1 KB', '1024 → 1 KB', sizeText(1024));
ok(sizeText(1536) === '1.5 KB', '1536 → 1.5 KB', sizeText(1536));
ok(sizeText(1024 * 1024) === '1 MB', '1 MiB → 1 MB', sizeText(1024 * 1024));
ok(sizeText(1024 * 1024 * 1.25) === '1.3 MB', '1.25 MiB → 1.3 MB（一位小数四舍五入）', sizeText(1024 * 1024 * 1.25));
ok(totalBytes([1, 2, 3]) === 6, '合计');
ok(totalBytes([1, -2, 3]) === 4, '忽略负数');
ok(totalBytes([]) === 0, '空合计 0');

// ── 5. 确认文案 ───────────────────────────────────────────────────────────
const c1 = clearConfirmText(['课表缓存', '成绩缓存'], false);
ok(c1.indexOf('课表缓存、成绩缓存') > 0, '点名清理项');
ok(c1.indexOf('不可恢复') < 0, '不含用户数据时不说「不可恢复」');
const c2 = clearConfirmText(['作业数据'], true);
ok(c2.indexOf('含你自己新增的条目') > 0, '含用户数据时明确警示', c2);
ok(c2.indexOf('不可恢复') > 0, '含用户数据时说明不可恢复');
ok(emptySelectionText().indexOf('没有选择') === 0, '空选择文案');

// ── 6. 学号脱敏 ───────────────────────────────────────────────────────────
ok(maskStudent('1120201234') === '112*****34', '长学号前 3 后 2', maskStudent('1120201234'));
ok(maskStudent('12345') === '123*45', '5 位也至少遮 1 位（否则等于没脱敏）', maskStudent('12345'));
ok(maskStudent('1234') === '****', '4 位及以下全遮', maskStudent('1234'));
ok(maskStudent('') === '未登录', '空 → 未登录');
ok(maskStudent('   ') === '未登录', '空白 → 未登录');
ok(maskStudent('1120201234').indexOf('0201') < 0, '中间段不泄露');

ok(yesNo(true) === '是' && yesNo(false) === '否', '布尔中文');

// ── 7. 诊断文本 ───────────────────────────────────────────────────────────
const input = {
  appVersion: '1.0.0', buildLabel: '', deviceModel: 'Mate 60', osVersion: '5.0',
  loggedIn: true, studentId: '1120201234', term: '2025-2026-1', termSource: '跟随教务',
  palette: 'Warm', dark: true, cacheBytes: 2048, cacheItems: 7,
  notifyEnabled: true, lastScheduleFetch: '2 小时前', lastScoreCheck: '',
};
const lines = diagLines(input);
ok(lines.length === 10, '10 行诊断', String(lines.length));
ok(lines[0].label === '版本' && lines[0].value === '1.0.0', '第一行版本');
const idLine = lines.filter((l) => l.label === '学号')[0];
ok(idLine !== undefined && idLine.value === '112*****34', '学号已脱敏', idLine === undefined ? 'missing' : idLine.value);
ok(lines[7].value === '7 项 / 2 KB', '缓存行', lines[7].value);
ok(lines[9].value === '无记录', '空记录显示「无记录」');

const text = diagText(input);
ok(text.indexOf('BIT101 鸿蒙版 · 诊断信息') === 0, '首行标题');
ok(text.indexOf('1120201234') < 0, '整段文本不含完整学号');
ok(text.indexOf('112*****34') > 0, '含脱敏学号');
// 数据行（前 11 行含标题）不许出现敏感字样；末行是「不含密码/cookie」的说明句，允许出现这些词
const dataLines = text.split('\n').slice(0, 11).join('\n');
ok(dataLines.indexOf('cookie') < 0 && dataLines.indexOf('密码') < 0, '数据行不含 cookie/密码字样', dataLines);
ok(text.indexOf('脱敏') > 0, '末尾说明已脱敏');

// 未登录时也不崩
const anon = diagText(Object.assign({}, input, { loggedIn: false, studentId: '' }));
ok(anon.indexOf('学号：未登录') > 0, '未登录显示「未登录」', anon.split('\n').filter((l) => l.indexOf('学号') === 0)[0]);

console.log('\n' + (fail === 0 ? 'ALL PASS' : 'FAILED') + '  pass=' + pass + ' fail=' + fail);
process.exit(fail === 0 ? 0 : 1);
