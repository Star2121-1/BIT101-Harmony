/**
 * P1 低风险批次测试（5 条）：
 *   F01-05 登出清座位任务 / G-04 成绩筛选三维 / G07-09 关于页自动检查开关 /
 *   F08 卡片 colorMode 统一 / F10 GridCard/GridChip 读屏文案。
 * 纯逻辑用 Node 直接跑；页面/配置接线用源码静态守卫。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  emptyScoreFilter, filterTermsOf, filterCategoriesOf, keywordMatches,
  scoreRowMatches, hasAnyFilter, toggleChip, scoreEmptyHint,
} from '../entry/src/main/ets/corelogic/ScoreFilterLogic.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0;
function eq(a, b, msg) { assert.deepEqual(a, b, msg); pass++; }
function ok(v, msg) { assert.ok(v, msg); pass++; }
function src(p) { return readFileSync(join(root, p), 'utf8'); }

console.log('=== F01-05 登出清座位预约任务（静态守卫）===');
const taskStore = src('entry/src/main/ets/data/SeatTaskStore.ts');
ok(taskStore.includes('async clearAll(): Promise<void>'), '仓库有 clearAll 全清方法');
ok(taskStore.includes('this.tasks = []'), 'clearAll 清内存任务表');
ok(taskStore.includes('await Prefs.remove(STORAGE_KEY)'), 'clearAll 清落盘快照（防内存清了落盘残留）');
const session = src('entry/src/main/ets/data/SessionStore.ts');
ok(session.includes("import { getTaskRepository } from './SeatTaskStore.ts'"), 'SessionStore 导入仓库单例');
const logoutBody = session.slice(session.indexOf('static async logoutAll()'));
ok(logoutBody.includes('getTaskRepository().clearAll()'), 'logoutAll 调 clearAll（单一入口）');
ok(!logoutBody.includes('TimeTableStore.clear') && !logoutBody.includes('CourseCache.clear'), '仍不清课表缓存（产品决定）');
ok(!logoutBody.includes('TermStore.clear'), '不清学期等非账号设置');

console.log('=== G-04 成绩筛选三维（纯逻辑）===');
const rows = [
  { course: '高等数学', score: '90', term: '2025-2026-1', credit: 5, category: '必修', courseNumber: 'MATH101' },
  { course: '高等数学', score: '45', term: '2024-2025-2', credit: 5, category: '必修', courseNumber: 'MATH101' },
  { course: '计算机导论', score: '85', term: '2025-2026-1', credit: 3, category: '校公选课', courseNumber: 'CS100' },
];
eq(emptyScoreFilter(), { terms: [], categories: [], keyword: '' }, '空筛选三维');
eq(filterTermsOf(rows), ['2025-2026-1', '2024-2025-2'], '学期去重保序');
eq(filterCategoriesOf(rows), ['必修', '校公选课'], '性质去重保序');
eq(filterTermsOf([{ course: 'x', score: null, term: null }]), [], 'null 学期不进选项');
eq(filterCategoriesOf([{ course: 'x', score: null, term: null }]), [], '无 category 不进选项');
// 关键词：课名 or 课程编号，忽略大小写
eq(keywordMatches(rows[0], '数学'), true, '课名命中');
eq(keywordMatches(rows[0], 'math101'), true, '课程编号命中且忽略大小写');
eq(keywordMatches(rows[0], 'MATH'), true, '编号前缀大写命中（忽略大小写）');
eq(keywordMatches(rows[0], '  '), true, '空关键词全通过');
eq(keywordMatches(rows[2], '不存在'), false, '不命中');
// 三维 AND，组内 OR
const f1 = { terms: ['2025-2026-1'], categories: [], keyword: '' };
eq(rows.map(r => scoreRowMatches(r, f1)), [true, false, true], '学期维筛选');
const f2 = { terms: [], categories: ['必修'], keyword: '' };
eq(rows.map(r => scoreRowMatches(r, f2)), [true, true, false], '性质维筛选');
const f3 = { terms: ['2025-2026-1'], categories: ['校公选课'], keyword: '' };
eq(rows.map(r => scoreRowMatches(r, f3)), [false, false, true], '学期∩性质 AND');
const f4 = { terms: [], categories: [], keyword: '导论' };
eq(rows.map(r => scoreRowMatches(r, f4)), [false, false, true], '关键词维');
// 筛选态 + 清空入口（与统计门数解耦，防 Android 那个坑）
eq(hasAnyFilter(emptyScoreFilter()), false, '空筛选不算筛选态');
eq(hasAnyFilter({ terms: ['t'], categories: [], keyword: '' }), true, '仅学期也算筛选态');
eq(hasAnyFilter({ terms: [], categories: [], keyword: '  x  ' }), true, '仅关键词 trim 后算筛选态');
eq(scoreEmptyHint({ terms: ['t'], categories: [], keyword: '' }), '筛选条件太窄了，清一下试试。', '筛过给清空提示');
eq(scoreEmptyHint(emptyScoreFilter()).indexOf('网页版') >= 0, true, '没筛过给网页版核对提示');
// chip 切换不改原数组
const orig = ['a'];
eq(toggleChip(orig, 'b'), ['a', 'b'], '加入 chip');
eq(toggleChip(orig, 'a'), [], '移除 chip');
eq(orig, ['a'], 'toggleChip 不改入参');

console.log('=== G-04 成绩页接线（静态守卫）===');
const score = src('entry/src/main/ets/pages/ScorePage.ets');
ok(score.includes('scoreRowMatches(src[i].entries[j], f)'), 'visibleGroups 用三维谓词');
ok(score.includes('this.filterBar()'), '筛选条挂上');
ok(score.includes('if (this.hasFilter())'), '清空入口按筛选态判（不绑统计门数）');
ok(score.includes('scoreEmptyHint(this.currentFilter())'), '空态文案走纯逻辑');
ok(score.includes('this.entries.length > 0 && this.visibleGroups().length === 0'), '空态只在「有成绩但筛空」时显示，不重复整块空态');
ok(score.indexOf('this.filterBar()') < score.indexOf('ForEach(this.visibleGroups()'), '筛选条（含清空入口）在列表之前（筛空也能退）');
ok(score.includes('自动续期') && !score.includes('密码默认不保存'), '旧「密码默认不保存」文案已同步 F01-02');

console.log('=== G07-09 关于页自动检查更新（静态守卫）===');
const upd = src('entry/src/main/ets/data/UpdateSettings.ts');
ok(upd.includes('DEFAULT_AUTO_CHECK_UPDATE: boolean = true'), '默认开（对齐 Android initial=true）');
ok(upd.includes('Prefs.getBool') && upd.includes('Prefs.putBool'), '布尔偏好读写');
const about = src('entry/src/main/ets/pages/AboutPage.ets');
ok(about.includes("import { loadAutoCheckUpdate, saveAutoCheckUpdate } from '../data/UpdateSettings.ts'"), '关于页导入开关');
ok(about.includes('void loadAutoCheckUpdate().then'), '进页加载开关');
ok(about.includes('if (on) {\n        await this.doCheckUpdate();'), '仅开时自动检查');
ok(about.indexOf('await this.loadVersion()') < about.indexOf('await this.doCheckUpdate()'), '先取版本号再检查（无竞态）');
ok(about.includes('Toggle({ type: ToggleType.Checkbox, isOn: this.autoCheck })'), '开关用项目既有 Toggle（非不存在的 Switch）');
ok(about.includes('saveAutoCheckUpdate(v)'), 'Toggle 写回偏好');
ok(about.includes('Text(\'自动检查更新\')'), '开关 UI 存在');
ok(about.includes("Button(this.checking ? '检查中…' : '检查更新')"), '手动检查按钮保留');

console.log('=== F08 卡片 colorMode 统一（静态守卫）===');
const fc = src('entry/src/main/resources/base/profile/form_config.json');
const fm = src('entry/src/main/resources/base/profile/form_metadata.json');
ok(fc.includes('"colorMode": "auto"'), 'form_config 为 auto');
ok(fm.includes('"colorMode": "auto"'), 'form_metadata 为 auto（与 FormExtension 跟随系统口径一致）');
ok(!fm.includes('"colorMode": "default"'), '不再有 default 冲突值');

console.log('=== F10 读屏文案（静态守卫）===');
const chip = src('entry/src/main/ets/core/theme/components/GridChip.ets');
const card = src('entry/src/main/ets/core/theme/components/GridCard.ets');
ok(chip.includes('.accessibilityText(this.style().showCheck ? this.label + \'，已选中\' : this.label)'), 'GridChip 选中态读屏非空');
ok(chip.includes('showCheck'), '选中态语义来自既有 style 判定（不另起状态）');
ok(card.includes('private a11yText(): string'), 'GridCard 有读屏文案方法');
ok(card.includes('.accessibilityText(this.a11yText())'), 'GridCard 根挂读屏文案');
ok(/if \(this\.selected\)[\s\S]{0,60}已选中/.test(card), 'GridCard 选中语义');
ok(/if \(this\.isDisabled\)[\s\S]{0,60}不可用/.test(card), 'GridCard 禁用语义');

console.log(`\nALL PASS  pass=${pass} fail=0`);
