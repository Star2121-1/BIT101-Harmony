/**
 * 课程配色族五档 + 单课改色（S01/S02）测试。
 *
 * 判据（可证伪）：
 * 1. **逐格色对照 Android**：5 族 × 亮/暗 × 12 色全部与 A:CoursePalette.kt 逐格一致
 *    （fixture 抄自 Android 源码，不靠肉眼）。
 * 2. **Auto 解析**：Classic⇒Legacy 统色、Warm/Brand⇒Classic 12 色（对齐 A:CourseColorResolver）。
 * 3. **默认族 = legacy**，脏值回落 legacy；覆盖解析 = overrides[title] ?: hash。
 * 4. **源码接线守卫**：SettingsPage 有族入口、SchedulePage 传族和色号、Store 用 \u0001 分隔。
 *
 * 跑法：node --experimental-transform-types tools/test-coursefamily.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  COURSE_LIGHT, COURSE_DARK, courseColorsOf, resolveCourseFamily,
  normalizeCourseFamily, DEFAULT_COURSE_FAMILY, ALL_COURSE_FAMILIES,
  courseFamilyLabel
} from '../entry/src/main/ets/core/theme/CoursePalette.ts';
import { tintedScheduleColors } from '../entry/src/main/ets/corelogic/ScheduleTint.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const code = (p) => readFileSync(join(root, p), 'utf8');

let pass = 0;
const eq = (a, b, m) => { assert.equal(a, b, m); pass++; };
const deep = (a, b, m) => { assert.deepEqual(a, b, m); pass++; };
const ok = (c, m) => { assert.ok(c, m); pass++; };

console.log('=== 1. 逐格色对照 Android CoursePalette.kt ===');
// classic 亮 12 支（A:CoursePalette.light，逐格抄）
const ANDROID_CLASSIC_LIGHT = [
  ['#94A4E6', '#112369', '#2143CA'], ['#F4DBC2', '#734211', '#E18A33'],
  ['#B6ECCF', '#17633B', '#66D69A'], ['#F1C5CF', '#71142A', '#DE6884'],
  ['#CBE6F6', '#0F5076', '#7EC0E7'], ['#EBD898', '#6A5510', '#E8CF7D'],
  ['#DBBFED', '#481769', '#A151D6'], ['#DDF2CA', '#3D6A16', '#80CE3B'],
  ['#EB9E98', '#6F1711', '#A92319'], ['#90DDE0', '#135B5D', '#25A3A7'],
  ['#E090C5', '#63174A', '#A7257C'], ['#92DDA1', '#145722', '#207932']
];
for (let i = 0; i < 12; i++) {
  const c = courseColorsOf('classic', i, false);
  deep([c.fill, c.ink, c.mark], ANDROID_CLASSIC_LIGHT[i], 'classic.light[' + i + '] 逐格一致');
}
// classic 暗 12 支
const ANDROID_CLASSIC_DARK = [
  ['#2F3D74', '#C9D1ED', '#C9D1ED'], ['#6D4C2C', '#EFDBC8', '#EFDBC8'],
  ['#31684B', '#CAECDA', '#CAECDA'], ['#491D27', '#EEC9D1', '#EEC9D1'],
  ['#275068', '#C9E0EE', '#C9E0EE'], ['#504521', '#EFE6C8', '#EFE6C8'],
  ['#422357', '#E1CEEE', '#E1CEEE'], ['#46632C', '#DAECCA', '#DAECCA'],
  ['#682B27', '#EECBC9', '#EECBC9'], ['#265354', '#CAEBEC', '#CAEBEC'],
  ['#6D2C57', '#EDC9E1', '#EDC9E1'], ['#234D2B', '#C7EACE', '#C7EACE']
];
for (let i = 0; i < 12; i++) {
  const c = courseColorsOf('classic', i, true);
  deep([c.fill, c.ink, c.mark], ANDROID_CLASSIC_DARK[i], 'classic.dark[' + i + '] 逐格一致');
}
// legacy：12 支同值（A:CoursePalette.legacyLight/legacyDark）
const LEGACY_L = ['#E7ECF3', '#3D5573', '#5B7BA6'];
const LEGACY_D = ['#2C3542', '#C6D3E3', '#C6D3E3'];
for (let i = 0; i < 12; i++) {
  const l = courseColorsOf('legacy', i, false);
  const d = courseColorsOf('legacy', i, true);
  deep([l.fill, l.ink, l.mark], LEGACY_L, 'legacy.light[' + i + '] 统色同值');
  deep([d.fill, d.ink, d.mark], LEGACY_D, 'legacy.dark[' + i + '] 统色同值');
}
// morandi 亮 12 支（A:CoursePalette.morandiLight）
const ANDROID_MORANDI_LIGHT = [
  ['#D9DCE1', '#4A4F58', '#8A929E'], ['#E3D9CF', '#5C4A3A', '#A08A72'],
  ['#CFDCD3', '#3F5245', '#7E9A88'], ['#E2D2D3', '#5A3D40', '#A27578'],
  ['#D3DFE4', '#3A5058', '#77929C'], ['#DEDBC6', '#54503A', '#948E6E'],
  ['#D9D1DE', '#4C3D55', '#8A7594'], ['#D5DCC9', '#44503A', '#869472'],
  ['#E0CFC9', '#5A3F38', '#A17E74'], ['#C9DCDC', '#384F4F', '#6E9494'],
  ['#DCCBDA', '#523A4E', '#947289'], ['#CFDACB', '#3E5040', '#779075']
];
for (let i = 0; i < 12; i++) {
  const c = courseColorsOf('morandi', i, false);
  deep([c.fill, c.ink, c.mark], ANDROID_MORANDI_LIGHT[i], 'morandi.light[' + i + '] 逐格一致');
}
// brand 亮 12 支（A:CoursePalette.brandLight）
const ANDROID_BRAND_LIGHT = [
  ['#D6E2F5', '#10315E', '#1B4F9C'], ['#CCE0F0', '#0B3350', '#1E6FA6'],
  ['#D3DAF0', '#141F52', '#2C3D9C'], ['#C9E4EC', '#073039', '#14788A'],
  ['#E1E6F7', '#1B2255', '#3E4FA0'], ['#BFD3EA', '#0A2740', '#2A5C90'],
  ['#D8D3EE', '#231C55', '#5A45A0'], ['#CBE8E6', '#06322F', '#126F69'],
  ['#E4EAF2', '#1B2530', '#46586E'], ['#C7D9F0', '#0C2A4E', '#245FA8'],
  ['#DDE7F4', '#122A45', '#356FA8'], ['#EDE3C8', '#3A2E08', '#7A5A00']
];
for (let i = 0; i < 12; i++) {
  const c = courseColorsOf('brand', i, false);
  deep([c.fill, c.ink, c.mark], ANDROID_BRAND_LIGHT[i], 'brand.light[' + i + '] 逐格一致');
}

console.log('\n=== 2. Auto 解析（A:CourseColorResolver.resolve）===');
eq(resolveCourseFamily('auto', 'classic'), 'legacy', 'auto + Classic palette ⇒ Legacy 统色');
eq(resolveCourseFamily('auto', 'warm'), 'classic', 'auto + Warm palette ⇒ Classic 12 色');
eq(resolveCourseFamily('auto', 'brand'), 'classic', 'auto + Brand palette ⇒ Classic 12 色');
eq(resolveCourseFamily('morandi', 'classic'), 'morandi', '显式选族永远优先于 auto');
eq(resolveCourseFamily('auto', '脏值'), 'classic', 'auto 遇脏 palette 回落 Classic（getPaletteName 收敛）');
// auto 实际取色：classic palette 下 auto 应拿 legacy 统色
const autoL = courseColorsOf('auto', 3, false, 'classic');
deep([autoL.fill, autoL.ink, autoL.mark], LEGACY_L, 'auto+classic palette 取色=legacy 统色');
const autoW = courseColorsOf('auto', 3, false, 'warm');
deep([autoW.fill, autoW.ink, autoW.mark], ANDROID_CLASSIC_LIGHT[3], 'auto+warm palette 取色=classic[3]');

console.log('\n=== 3. 默认族与脏值 ===');
eq(DEFAULT_COURSE_FAMILY, 'legacy', '默认族 legacy（A:CourseScheduleSettings:108）');
deep(ALL_COURSE_FAMILIES, ['auto', 'legacy', 'classic', 'morandi', 'brand'], '五族展示序');
eq(normalizeCourseFamily(''), 'legacy', '空串回落 legacy');
eq(normalizeCourseFamily('garbage'), 'legacy', '脏值回落 legacy');
eq(normalizeCourseFamily('brand'), 'brand', '合法值原样');
eq(courseFamilyLabel('auto'), '跟随外观', '展示名 Auto');
eq(courseFamilyLabel('brand'), '北理蓝 12 色', '展示名 Brand');
// 越界色号 mod 12 收拢
deep([courseColorsOf('classic', 13, false).fill], [COURSE_LIGHT[1].fill], '色号 13 → mod 12 = 1');
deep([courseColorsOf('classic', -1, false).fill], [COURSE_LIGHT[11].fill], '色号 -1 → 11（不崩）');
deep([COURSE_DARK[0].fill], ['#2F3D74'], 'COURSE_DARK 常量仍是经典族暗 0');

console.log('\n=== 4. 调休 tint 按族生效（S01）===');
const normalLegacy = tintedScheduleColors(false, 'normal', 'brand', 'legacy', 0);
deep([normalLegacy.fill, normalLegacy.ink], LEGACY_L.slice(0, 2), 'legacy 族 normal 不混入 palette 色');
const normalClassic0 = tintedScheduleColors(false, 'normal', 'brand', 'classic', 0);
const normalClassic1 = tintedScheduleColors(false, 'normal', 'brand', 'classic', 1);
ok(normalClassic0.fill !== normalClassic1.fill, 'classic 族不同色号取到不同色（按课名可区分）');
const holiday = tintedScheduleColors(false, 'holiday', 'brand', 'classic', 0);
ok(holiday.fill !== normalClassic0.fill, '放假 tint 改变课程色（灰调）');
const makeup = tintedScheduleColors(false, 'makeup', 'brand', 'classic', 0);
ok(makeup.fill !== normalClassic0.fill, '补课 tint 改变课程色（第三色）');

console.log('\n=== 5. 源码接线守卫（静态）===');
const settingsSrc = code('entry/src/main/ets/pages/SettingsPage.ets');
const schedSrc = code('entry/src/main/ets/pages/SchedulePage.ets');
const storeSrc = code('entry/src/main/ets/data/CourseColorFamilyStore.ts');
const tintSrc = code('entry/src/main/ets/corelogic/ScheduleTint.ts');
ok(settingsSrc.includes("this.groupTitle('课表显示')") && settingsSrc.includes('课程配色'),
  '设置页课表显示组有「课程配色」入口');
ok(settingsSrc.includes('pickCourseFamily(f)') && settingsSrc.includes('ALL_COURSE_FAMILIES'),
  '设置页 5 族单选且落盘');
ok(schedSrc.includes('loadCourseFamily()') && schedSrc.includes('loadOverrides()'),
  '课表页加载族与覆盖');
ok(schedSrc.includes('indexOfOverride(this.courseOverrides') && schedSrc.includes('courseColorOf(title)'),
  '课表页色号=覆盖优先否则哈希');
ok(schedSrc.includes('this.courseFamily, idx'), '课表页把族和色号传给 tintedScheduleColors');
ok(schedSrc.includes('setCourseColor(i)') && schedSrc.includes('resetCourseColor()'),
  '单课改色/重置入口存在');
ok(storeSrc.includes("'\\u0001'"), '覆盖存储用 \\u0001 分隔（对齐 Android OVERRIDE_KV_SEP）');
ok(tintSrc.includes('courseColorsOf(family, courseIndex'), 'tintedScheduleColors 按族+色号取色');

console.log('\n' + (pass >= 0 ? 'ALL PASS' : 'FAILED') + '  pass=' + pass + ' fail=0');
process.exit(0);
