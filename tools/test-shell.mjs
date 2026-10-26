/**
 * 外壳导航模型单测（#90 框架 chrome）
 *
 * 为什么值得单测：外壳是**所有页面的入口**，这里错一个下标 = 用户点「座」进到「图」，
 * 而界面上两个格子都亮着同样的样式 —— 真机上很难一眼看出是哪一层错了。
 * 所以把「顺序 / 兜底 / 往返」三件事钉死。
 *
 * 跑法：node --experimental-transform-types tools/test-shell.mjs
 */

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  NAV_MODULES,
  SCHEDULE_TABS,
  DEFAULT_MODULE,
  DEFAULT_TAB,
  indexOfKey,
  isKnownModule,
  isKnownTab,
  normalizeModule,
  normalizeTab,
  contentIdOf,
  shellStateOf,
  showsTopTabs,
  isModuleSelected,
  isTabSelected,
} from '../entry/src/main/ets/corelogic/shellNav.ts';

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

// ── 一、底部 6 模块：顺序与标签 = 原版 PageShowOnNav.allPages / toPageData().name ──
eq(NAV_MODULES.length, 6, '底部模块必须 6 个（原版固定 6 格）');
eq(NAV_MODULES.map((m) => m.key), ['schedule', 'map', 'web', 'gallery', 'mine', 'seat'], '模块顺序 = 原版 allPages');
eq(NAV_MODULES.map((m) => m.label), ['卷', '图', '网', '话', '我', '座'], '模块标签 = 原版单字');

// key 是稳定身份，必须唯一（重复会让 indexOfKey / 选中态出现二义）
eq(new Set(NAV_MODULES.map((m) => m.key)).size, 6, '模块 key 不许重复');

// ── 二、「卷」内 5 页签 ──
eq(SCHEDULE_TABS.length, 5, '卷内页签必须 5 个');
eq(SCHEDULE_TABS.map((t) => t.key), ['timetable', 'ddl', 'feed', 'classroom', 'transport'], '页签顺序 = 原版 TAB_IDS');
eq(SCHEDULE_TABS.map((t) => t.label), ['课表', 'DDL', '动态', '空教室', '交通'], '页签标签 = 原版文案');
eq(new Set(SCHEDULE_TABS.map((t) => t.key)).size, 5, '页签 key 不许重复');
// 页签只有文字没有图标（原版这行就是纯文字）：不许有人偷偷加回 icon 字段
ok(SCHEDULE_TABS.every((t) => t.icon === undefined), '页签不得带 icon 字段（原版只有文字）');

// ── 三、默认值 ──
eq(DEFAULT_MODULE, NAV_MODULES[0].key, '默认模块 = 列表首个（原版 homePage = allPages[0]）');
eq(DEFAULT_TAB, SCHEDULE_TABS[0].key, '默认页签 = 课表');

// ── 四、indexOfKey / isKnown* ──
eq(indexOfKey(NAV_MODULES, 'seat'), 5, 'indexOfKey 找得到最后一个');
eq(indexOfKey(NAV_MODULES, 'nope'), -1, '找不到返回 -1（不回落到 0）');
ok(isKnownModule('gallery'), 'gallery 是合法模块');
ok(!isKnownModule('timetable'), 'timetable 是页签不是模块');
ok(isKnownTab('transport'), 'transport 是合法页签');
ok(!isKnownTab('mine'), 'mine 是模块不是页签');

// ── 五、脏值兜底：必须显式回落，不能 list[0]（加模块时会静默错页）──
eq(normalizeModule('nope'), 'schedule', '未知模块回落 schedule');
eq(normalizeModule(''), 'schedule', '空串模块回落 schedule');
eq(normalizeModule('seat'), 'seat', '合法模块原样返回');
eq(normalizeTab('nope'), 'timetable', '未知页签回落 timetable');
eq(normalizeTab('ddl'), 'ddl', '合法页签原样返回');

// ── 六、contentIdOf：卷内取页签、其余取模块 ──
eq(contentIdOf('schedule', 'ddl'), 'ddl', '卷 + DDL ⇒ 内容 ddl');
eq(contentIdOf('schedule', 'bogus'), 'timetable', '卷 + 脏页签 ⇒ 课表');
eq(contentIdOf('mine', 'ddl'), 'mine', '我 + 页签 ⇒ 我（模块优先，页签无关）');
eq(contentIdOf('bogus', 'bogus'), 'timetable', '全脏 ⇒ 课表');

// ── 七、往返：10 个内容标识都要能还原成正确的 (模块, 页签) ──
const allContents = [
  'timetable', 'ddl', 'feed', 'classroom', 'transport',
  'map', 'web', 'gallery', 'mine', 'seat',
];
for (const id of allContents) {
  const st = shellStateOf(id);
  eq(contentIdOf(st.module, st.tab), id, '往返一致：' + id);
}
eq(shellStateOf('ddl'), { module: 'schedule', tab: 'ddl' }, 'ddl ⇒ 卷/DDL');
eq(shellStateOf('seat'), { module: 'seat', tab: 'timetable' }, '座 ⇒ 座模块 + 默认页签位');
eq(shellStateOf('garbage'), { module: 'schedule', tab: 'timetable' }, '脏内容 ⇒ 课表');

// ── 八、顶部页签只属于「卷」 ──
ok(showsTopTabs('schedule'), '卷显示顶部页签');
for (const k of ['map', 'web', 'gallery', 'mine', 'seat']) {
  ok(!showsTopTabs(k), '模块 ' + k + ' 不显示顶部页签');
}

// ── 九、选中态判定 ──
ok(isModuleSelected('seat', 'seat'), '座模块选中');
ok(!isModuleSelected('seat', 'mine'), '我模块时座未选中');
ok(isTabSelected('ddl', 'schedule', 'ddl'), '卷+ddl ⇒ 页签 ddl 选中');
ok(!isTabSelected('ddl', 'mine', 'ddl'), '不在卷模块时页签一律不选中（否则底栏和顶栏会同时亮两个）');
ok(!isTabSelected('feed', 'schedule', 'ddl'), '页签不同不选中');

// ── 十、图标资源必须真实存在（改名/漏拷 ⇒ 底栏会是空白方块）──
const here = dirname(fileURLToPath(import.meta.url));
const iconDir = join(here, '..', 'entry', 'src', 'main', 'resources', 'rawfile', 'icons');
for (const m of NAV_MODULES) {
  ok(existsSync(join(iconDir, m.icon)), '图标文件在位：' + m.icon);
}

// 外壳与页面里用到的图标（FAB / 顶栏 / 列表箭头），一起钉住
for (const name of [
  'ic_add.svg', 'ic_bell.svg', 'ic_calendar.svg', 'ic_chevron_left.svg', 'ic_chevron_right.svg',
  'ic_delete.svg', 'ic_refresh.svg', 'ic_school.svg', 'ic_settings.svg', 'ic_up.svg',
]) {
  ok(existsSync(join(iconDir, name)), '图标文件在位：' + name);
}

console.log('\nshell: ' + passed + ' passed, ' + failed + ' failed');
console.log('pass=' + passed);
if (failed > 0) {
  process.exit(1);
}
