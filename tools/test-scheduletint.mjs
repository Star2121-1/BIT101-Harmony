/**
 * 调休 tint + 混色忠实度测试
 * =========================================================
 * 判据三条（缺一不可）：
 * 1. **真机锚点**：今日列底色 mixHex(primaryContainer, background, 0.5) 必须等于
 *    平板实测采样值 #FAEBE0（源码 CourseScheduleCalendar.kt:263 primaryContainer@0.5α
 *    复合渲染）；空教室页背景 mixHex(surface, primaryContainer, 0.25) 必须等于实测 #FBE6D9。
 * 2. **独立参照实现**：测试内另写一份直白 float 混色（第二条路），与 mixHex 逐格对照。
 * 3. **tint 档位语义**：normal=恒等；holiday 朝 surfaceVariant/onSurfaceVariant 靠 0.85；
 *    makeup 朝 tertiaryContainer/onTertiaryContainer 靠 0.6（常数照搬源码）。
 *
 * 跑法：node --experimental-transform-types --experimental-loader ./tools/node-loader.mjs tools/test-scheduletint.mjs
 */

import { mixHex, withAlpha } from '../entry/src/main/ets/core/theme/colorUtil.ts';
import { tintedScheduleColors, HOLIDAY_TINT, MAKEUP_TINT } from '../entry/src/main/ets/corelogic/ScheduleTint.ts';
import { gridTokens } from '../entry/src/main/ets/core/theme/GridTokens.ts';

let failed = 0;
let passed = 0;

function eq(actual, expected, msg) {
  const a = String(actual).toUpperCase();
  const e = String(expected).toUpperCase();
  if (a === e) {
    passed++;
  } else {
    failed++;
    console.log('FAIL ' + msg + '：实际 ' + actual + ' ≠ 期望 ' + expected);
  }
}

function ok(cond, msg) {
  if (cond) { passed++; } else { failed++; console.log('FAIL ' + msg); }
}

// ── 独立参照实现（第二条路：直白 float 运算，不复用被测代码）──
function refMix(c1, c2, ratio) {
  const p = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const a = p(c1), b = p(c2);
  const r = (i) => Math.round(Math.max(0, Math.min(255, a[i] * ratio + b[i] * (1 - ratio))));
  const h = (n) => n.toString(16).toUpperCase().padStart(2, '0');
  return '#' + h(r(0)) + h(r(1)) + h(r(2));
}

console.log('=== 真机锚点（平板实测采样值）===');
// warm 真机锚点：palette 默认已切 brand（BIT101-S 1.12.0），但这些配方值来自
// 平板 ref-01/07（Warm 实拍），是「配方正确性」守卫，必须显式 warm，不随默认变。
const light = gridTokens(false, 'warm');
// 今日列：primaryContainer@0.5α 复合背景 —— 实测 #FAEBE0（1504×2400 采样中位色）
eq(mixHex(light.primaryContainer, light.background, 0.5), '#FAEBE0', '今日列 mix(primaryContainer,bg,0.5)=#FAEBE0');
// 空教室页背景/教学楼卡：mix(surface, primaryContainer, 0.25) —— 实测 #FBE6D9
eq(mixHex(light.surface, light.primaryContainer, 0.25), '#FBE6D9', '教学楼卡 mix(surface,primaryContainer,0.25)=#FBE6D9');

console.log('\n=== mixHex 与独立参照实现交叉验证（明暗 × 多档 ratio）===');
const tks = [gridTokens(false), gridTokens(true)];
const ratios = [0, 0.15, 0.25, 0.5, 0.6, 0.75, 0.85, 1];
let cross = 0;
for (const t of tks) {
  const pairs = [
    [t.primaryContainer, t.background],
    [t.surface, t.primaryContainer],
    [t.secondaryContainer, t.surfaceVariant],
    [t.tertiaryContainer, t.surface],
  ];
  for (const [c1, c2] of pairs) {
    for (const r of ratios) {
      eq(mixHex(c1, c2, r), refMix(c1, c2, r), `mix(${c1},${c2},${r})`);
      cross++;
    }
  }
}
ok(cross === 2 * 4 * ratios.length, '交叉验证格数=' + cross);

console.log('\n=== withAlpha（8 位 hex，ArkUI 口径）===');
eq(withAlpha('#112369', 0.25), '#40112369', 'withAlpha(#112369,0.25)=#40112369（#AARRGGBB）');
eq(withAlpha('#112369', 0), '#00112369', 'withAlpha alpha=0');
eq(withAlpha('#112369', 1), '#FF112369', 'withAlpha alpha=1');
eq(withAlpha('#112369', 2).slice(1, 3), 'FF', 'withAlpha 越界(>1)收拢到 FF（首字节）');
eq(withAlpha('#112369', -1).slice(1, 3), '00', 'withAlpha 越界(<0)收拢到 00（首字节）');

console.log('\n=== 空教室页卡片色（#85，源码 FreeClassroomSearch.kt）===');
const dark = gridTokens(true, 'warm');
// 校区卡 = surfaceVariant（原版 surfaceContainerHigh，warm 下同值）；实测 ref-07 采样 #F4EFE8
eq(light.surfaceVariant, '#F4EFE8', '校区卡 = surfaceVariant #F4EFE8（真机实测）');
// 教学楼卡 = mixColor(surface, primaryContainer, 0.25f)，源码 FreeClassroomSearch.kt:183
// 实测 #FBE6D9（1504×2400 采样中位色；基准文档旧值 #FEF6F2 是采到了卡间隙，已纠正）
eq(mixHex(light.surface, light.primaryContainer, 0.25), '#FBE6D9', '教学楼卡 = #FBE6D9（真机实测）');
eq(mixHex(light.onSurface, light.onPrimaryContainer, 0.25), '#4D2C16', '教学楼卡内容色 = #4D2C16');
// 教室项双色（ClassroomList.kt:79-95）：空闲 secondaryContainer；占用 mix(errorContainer, secondaryContainer, 0.5)
eq(light.secondaryContainer, '#D5E9DF', '教室项空闲 = secondaryContainer #D5E9DF');
eq(mixHex(light.errorContainer, light.secondaryContainer, 0.5), '#E8E5DE', '教室项占用底 = #E8E5DE');
eq(mixHex(light.onErrorContainer, light.onSecondaryContainer, 0.5), '#4E3428', '教室项占用内容色 = #4E3428');
// 暗色档同公式（值由 mixHex 现算，不硬编码）
eq(mixHex(dark.surface, dark.primaryContainer, 0.25), '#3F2613', 'dark 教学楼卡');
eq(mixHex(dark.onSurface, dark.onPrimaryContainer, 0.25), '#F0C2A7', 'dark 教学楼卡内容色');
eq(mixHex(dark.errorContainer, dark.secondaryContainer, 0.5), '#3B2F27', 'dark 教室项占用底');
// 双色必须**看得出来**：空闲/占用两张卡不能糊成一块（「看不出区别就等于没做」）
const clsDiff = (a, b) => Math.abs(parseInt(a.slice(1, 3), 16) - parseInt(b.slice(1, 3), 16)) +
  Math.abs(parseInt(a.slice(3, 5), 16) - parseInt(b.slice(3, 5), 16)) +
  Math.abs(parseInt(a.slice(5, 7), 16) - parseInt(b.slice(5, 7), 16));
ok(clsDiff(light.secondaryContainer, mixHex(light.errorContainer, light.secondaryContainer, 0.5)) > 20,
  'light 教室项空闲/占用底色差 > 20');
ok(clsDiff(dark.secondaryContainer, mixHex(dark.errorContainer, dark.secondaryContainer, 0.5)) > 20,
  'dark 教室项空闲/占用底色差 > 20');

console.log('\n=== tint 档位语义（S01 全量移植：默认族 legacy 逐格对齐 Android）===');
eq(HOLIDAY_TINT, 0.85, 'HOLIDAY_TINT=0.85（照搬源码）');
eq(MAKEUP_TINT, 0.6, 'MAKEUP_TINT=0.6（照搬源码）');
for (const dark of [false, true]) {
  const t = gridTokens(dark);
  // ⚠️ 2026-11-27 口径变更（用户拍板「按 Android 权威逐格对齐」）：
  // 旧锚点是 secondaryContainer（2026-10-31 当时原版口径）；Android 1.12.0 起
  // 默认族 legacy 的课块色是 CoursePalette.legacyLight/Dark 固定色（不随 palette）。
  // 见 A:features/theme/CoursePalette.kt:61-66。不再按课名换色（12 支同值）。
  const base = dark
    ? { fill: '#2C3542', ink: '#C6D3E3', mark: '#C6D3E3' }
    : { fill: '#E7ECF3', ink: '#3D5573', mark: '#5B7BA6' };
  eq(tintedScheduleColors(dark, 'normal').fill, base.fill, (dark ? 'dark' : 'light') + ' normal.fill = legacy 权威色');
  eq(tintedScheduleColors(dark, 'normal').ink, base.ink, (dark ? 'dark' : 'light') + ' normal.ink = legacy 权威 ink');
  // holiday：fill 朝 surfaceVariant 靠 0.85；ink 朝 onSurfaceVariant 靠 0.85
  eq(tintedScheduleColors(dark, 'holiday').fill, refMix(t.surfaceVariant, base.fill, HOLIDAY_TINT),
    (dark ? 'dark' : 'light') + ' holiday.fill');
  eq(tintedScheduleColors(dark, 'holiday').ink, refMix(t.onSurfaceVariant, base.ink, HOLIDAY_TINT),
    (dark ? 'dark' : 'light') + ' holiday.ink');
  // makeup：fill 朝 tertiaryContainer 靠 0.6；ink 朝 onTertiaryContainer 靠 0.6
  eq(tintedScheduleColors(dark, 'makeup').fill, refMix(t.tertiaryContainer, base.fill, MAKEUP_TINT),
    (dark ? 'dark' : 'light') + ' makeup.fill');
  eq(tintedScheduleColors(dark, 'makeup').ink, refMix(t.onTertiaryContainer, base.ink, MAKEUP_TINT),
    (dark ? 'dark' : 'light') + ' makeup.ink');
  // 放假灰调必须**看得出来**（与常态差异够大）——「看不出来就等于这个功能不存在」
  const diff = (a, b) => Math.abs(parseInt(a.slice(1, 3), 16) - parseInt(b.slice(1, 3), 16)) +
    Math.abs(parseInt(a.slice(3, 5), 16) - parseInt(b.slice(3, 5), 16)) +
    Math.abs(parseInt(a.slice(5, 7), 16) - parseInt(b.slice(5, 7), 16));
  // ⚠️ 2026-11-27：对齐 Android 同款测试（ScheduleItemColorTest:60 assertNotEquals）。
  // 旧鸿蒙口径是「色差 > 8」硬阈值；legacy 权威色 #E7ECF3 与 brand surfaceVariant
  // #E4E9F1 几乎同色（A:BrandColor.kt:60 同值），混 0.85 后色差=8，硬阈值不成立。
  // Android 自己只断言「不相等」（放假编码主要靠列头角标 + 灰化，不靠块底大色差）。
  // 这里按 Android 权威口径降为「不相等」，不擅自放宽到假绿。
  ok(tintedScheduleColors(dark, 'holiday').fill !== base.fill,
    (dark ? 'dark' : 'light') + ' holiday 与常态不相等（A:ScheduleItemColorTest:60）');
  ok(diff(tintedScheduleColors(dark, 'makeup').fill, base.fill) > 8,
    (dark ? 'dark' : 'light') + ' makeup 与常态看得出不同');
  ok(diff(tintedScheduleColors(dark, 'makeup').fill, tintedScheduleColors(dark, 'holiday').fill) > 8,
    (dark ? 'dark' : 'light') + ' 放假/补课两档互不相同');
}

console.log('\n=== palette 轴（#89：tint 容器色随 palette 变）===');
// 同一 holiday tint，三套 palette 的容器色不同 ⇒ 混色结果必须不同
// （证明第三参真的接到 palette 表上，不是摆设）
for (const dark of [false, true]) {
  const tc = tintedScheduleColors(dark, 'holiday', 'classic');
  const tb = tintedScheduleColors(dark, 'holiday', 'brand');
  const tw = tintedScheduleColors(dark, 'holiday', 'warm');
  const cDiff = (a, b) => Math.abs(parseInt(a.slice(1, 3), 16) - parseInt(b.slice(1, 3), 16)) +
    Math.abs(parseInt(a.slice(3, 5), 16) - parseInt(b.slice(3, 5), 16)) +
    Math.abs(parseInt(a.slice(5, 7), 16) - parseInt(b.slice(5, 7), 16));
  ok(cDiff(tw.fill, tc.fill) > 5,
    (dark ? 'dark' : 'light') + ' holiday warm!=classic（palette 轴生效）');
  ok(cDiff(tw.fill, tb.fill) > 5,
    (dark ? 'dark ' : 'light ') + ' holiday warm!=brand（palette 轴生效）');
  // 不传第三参 = brand（默认，对齐 BIT101-S 1.12.0），与显式 brand 一致
  eq(tintedScheduleColors(dark, 'holiday').fill, tb.fill,
    (dark ? 'dark' : 'light') + ' holiday 不传 palette = brand');
  // 脏 palette 名收敛到 brand（与显式 brand 一致，不许崩）
  eq(tintedScheduleColors(dark, 'holiday', 'grid').fill, tb.fill,
    (dark ? 'dark' : 'light') + ' holiday 脏 palette 收敛 = brand');
}

console.log('\n=== 非法输入必须抛错（不猜）===');
try { mixHex('F9DECC', '#FBF8F4', 0.5); failed++; console.log('FAIL 缺少 # 前缀应抛错'); passed--; }
catch (e) { passed++; }
try { mixHex('#F9DEC', '#FBF8F4', 0.5); failed++; console.log('FAIL 5 位 hex 应抛错'); passed--; }
catch (e) { passed++; }

console.log('\n' + (failed === 0 ? 'ALL PASS' : 'FAILED') + '  pass=' + passed + ' fail=' + failed);
process.exit(failed === 0 ? 0 : 1);
