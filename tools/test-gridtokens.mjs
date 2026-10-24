/**
 * 《一格 GRID》token 层忠实度回归测试
 * =========================================================
 * 目的：证明 harmony 端的 `core/theme/GridTokens.ts` 是 Android
 * `features/theme/GridTokens.kt`（SharedGridTokens）的 1:1 照搬，
 * 而不是「看着像」——任意一处色值不一致就红。
 *
 * 判据来源：直接读 `F:/Agent_Work/BIT-102/BIT101-seat/features/theme/src/...`：
 * - 共享段 → `GridTokens.kt` 的 `sharedGridTokensLight` / `sharedGridTokensDark`；
 * - 随 palette 三套 → `palette/ClassicColor.kt` / `palette/WarmColor.kt` /
 *   `palette/BrandColor.kt`（明暗各一，只转录鸿蒙 GridTokens interface 有的字段）。
 * 下方 EXPECTED 即其逐值转录。
 *
 * 跑法（与 tools/test-colors.mjs 同源）：
 *   node --experimental-transform-types --experimental-loader ./tools/node-loader.mjs tools/test-gridtokens.mjs
 */

import { gridTokens, allGridTokens, getPaletteName } from '../entry/src/main/ets/core/theme/GridTokens.ts';
import { contrastRatio } from '../entry/src/main/ets/core/theme/AppColors.ts';

let failed = 0;
let passed = 0;

function eq(actual, expected, msg) {
  const a = String(actual).toUpperCase();
  const e = String(expected).toUpperCase();
  if (a === e) {
    passed++;
  } else {
    failed++;
    console.log('FAIL ' + msg + '：实际 ' + actual + ' ≠ 原版 ' + expected);
  }
}

function rate(ratio, min, msg) {
  const c = ratio >= min;
  console.log((c ? 'PASS ' : 'FAIL ') + msg + ' = ' + ratio.toFixed(2) + ' (需 ≥' + min + ')');
  if (c) passed++; else failed++;
}

// ── 原版 Android 常量逐值转录（来自 GridTokens.kt SharedGridTokens）──
const EXPECTED_LIGHT = {
  success: '#2F7D5A', successContainer: '#D8EFE3', onSuccessContainer: '#1B5B3F',
  accent: '#E8A317', accentText: '#8A5A00', accentContainer: '#FBEBCC', onAccentContainer: '#3D2A00',
  infoContainer: '#CFE7F6', onInfoContainer: '#0F5076',
  stateCalm: '#1E1A16', stateAttention: '#8A5A00', stateUrgent: '#B3261E',
  error: '#B3261E', onError: '#FFFFFF', errorContainer: '#FBE0DC', onErrorContainer: '#8C1D18',
  // M3 角色（warm 默认 palette 亮色）
  primary: '#8A4E26', onPrimary: '#FFFFFF', primaryContainer: '#F9DECC', onPrimaryContainer: '#5C3216',
  surface: '#FFFFFF', onSurface: '#1E1A16', onSurfaceVariant: '#5F564E', outlineVariant: '#EAE3DA',
  // 补全的 M3 角色（WarmColor.kt lightScheme 逐值）
  surfaceVariant: '#F4EFE8', background: '#FBF8F4', onBackground: '#1E1A16', outline: '#9C8F82',
  secondary: '#1E6B55', onSecondary: '#FFFFFF', secondaryContainer: '#D5E9DF', onSecondaryContainer: '#0F4A38',
  tertiary: '#8A5A00', onTertiary: '#FFFFFF', tertiaryContainer: '#FBEBCC', onTertiaryContainer: '#8A5A00',
  // 面色族 + 文字档 + 按压档（warm 亮色）
  surface2: '#F4EFE8', surface3: '#EAE3DA', disabledBg: '#E3DBD1', skeleton: '#E7E0D7',
  textPlaceholder: '#726759', textDisabled: '#8A7F72', pressed: '#73401E', pressedHeld: '#6A3A1B',
};

const EXPECTED_DARK = {
  success: '#7FDCB4', successContainer: '#0E3A2A', onSuccessContainer: '#7FDCB4',
  accent: '#F2BE55', accentText: '#F2BE55', accentContainer: '#3A2E12', onAccentContainer: '#F2BE55',
  infoContainer: '#123244', onInfoContainer: '#9FD3F0',
  stateCalm: '#F3EDE6', stateAttention: '#F2BE55', stateUrgent: '#FFB3A7',
  error: '#FFB3A7', onError: '#5C0E0A', errorContainer: '#571310', onErrorContainer: '#FFB3A7',
  // M3 角色（warm 默认 palette 暗色）
  primary: '#EFB392', onPrimary: '#3D1F08', primaryContainer: '#4A2A12', onPrimaryContainer: '#EFB392',
  surface: '#1E1A16', onSurface: '#F3EDE6', onSurfaceVariant: '#C4B8AA', outlineVariant: '#322C26',
  // 补全的 M3 角色（WarmColor.kt darkScheme 逐值）
  surfaceVariant: '#272219', background: '#16130F', onBackground: '#F3EDE6', outline: '#7A7069',
  secondary: '#86D9C0', onSecondary: '#06352A', secondaryContainer: '#1F4A3D', onSecondaryContainer: '#B5E8D8',
  tertiary: '#F2BE55', onTertiary: '#3D2A00', tertiaryContainer: '#3A2E12', onTertiaryContainer: '#F2BE55',
  // 面色族 + 文字档 + 按压档（warm 暗色）
  surface2: '#272219', surface3: '#332C24', disabledBg: '#2A251F', skeleton: '#231F1A',
  textPlaceholder: '#A79A8C', textDisabled: '#857B72', pressed: '#D6A98A', pressedHeld: '#E6C3A8',
};

// ── Classic 档逐值转录（Android palette/ClassicColor.kt，展示名「暖棕配色」）──
const EXPECTED_CLASSIC_LIGHT = {
  primary: '#8B4F26', onPrimary: '#FFFFFF', primaryContainer: '#FFDBC8', onPrimaryContainer: '#6F3810',
  secondary: '#755847', onSecondary: '#FFFFFF', secondaryContainer: '#FFDBC8', onSecondaryContainer: '#5C4131',
  tertiary: '#616033', onTertiary: '#FFFFFF', tertiaryContainer: '#E8E5AC', onTertiaryContainer: '#49491E',
  surface: '#FFF8F5', onSurface: '#221A15', onSurfaceVariant: '#52443C', surfaceVariant: '#F4DED3',
  background: '#FFF8F5', onBackground: '#221A15', outline: '#85746B', outlineVariant: '#D7C2B8',
  surface2: '#F4DED3', surface3: '#D7C2B8', disabledBg: '#CDB7A7', skeleton: '#E5D0C5',
  textPlaceholder: '#61524A', textDisabled: '#74645C', pressed: '#74411E', pressedHeld: '#6B3B1B',
};

const EXPECTED_CLASSIC_DARK = {
  primary: '#FFB68A', onPrimary: '#522300', primaryContainer: '#6F3810', onPrimaryContainer: '#FFDBC8',
  secondary: '#E5BFA9', onSecondary: '#432B1C', secondaryContainer: '#5C4131', onSecondaryContainer: '#FFDBC8',
  tertiary: '#CBC992', onTertiary: '#323209', tertiaryContainer: '#49491E', onTertiaryContainer: '#E8E5AC',
  surface: '#1A120D', onSurface: '#F0DFD7', onSurfaceVariant: '#D7C2B8', surfaceVariant: '#52443C',
  background: '#1A120D', onBackground: '#F0DFD7', outline: '#9F8D84', outlineVariant: '#52443C',
  surface2: '#52443C', surface3: '#5F5049', disabledBg: '#3D332D', skeleton: '#2A211B',
  textPlaceholder: '#C1ADA4', textDisabled: '#A7958C', pressed: '#E6AC82', pressedHeld: '#F6C6A0',
};

// ── Brand 档逐值转录（Android palette/BrandColor.kt，展示名「BIT101经典配色」）──
// ⚠️ 深蓝占位表，全部未验证（无官方 VI 手册；Android 侧 experimental=true）。
const EXPECTED_BRAND_LIGHT = {
  primary: '#1B4F9C', onPrimary: '#FFFFFF', primaryContainer: '#D6E2F5', onPrimaryContainer: '#10315E',
  secondary: '#4A5B75', onSecondary: '#FFFFFF', secondaryContainer: '#DEE4EE', onSecondaryContainer: '#2E3A4E',
  tertiary: '#7A5A00', onTertiary: '#FFFFFF', tertiaryContainer: '#F5E7C6', onTertiaryContainer: '#4A3800',
  surface: '#FFFFFF', onSurface: '#191C21', onSurfaceVariant: '#454C58', surfaceVariant: '#E4E9F1',
  background: '#F7F9FC', onBackground: '#191C21', outline: '#757D8B', outlineVariant: '#C6CEDA',
  surface2: '#E4E9F1', surface3: '#C6CEDA', disabledBg: '#D3DAE6', skeleton: '#DCE3EE',
  textPlaceholder: '#5A626E', textDisabled: '#737B88', pressed: '#173F7E', pressedHeld: '#123466',
};

const EXPECTED_BRAND_DARK = {
  primary: '#A8C6F5', onPrimary: '#10315E', primaryContainer: '#2C4E7C', onPrimaryContainer: '#D6E2F5',
  secondary: '#A9B7CC', onSecondary: '#25303F', secondaryContainer: '#3A4657', onSecondaryContainer: '#C7D3E5',
  tertiary: '#E3BC63', onTertiary: '#3D2E00', tertiaryContainer: '#4F3D14', onTertiaryContainer: '#E3BC63',
  surface: '#161B21', onSurface: '#E2E6EC', onSurfaceVariant: '#BEC5D0', surfaceVariant: '#262D37',
  background: '#101418', onBackground: '#E2E6EC', outline: '#8B93A0', outlineVariant: '#39414C',
  surface2: '#262D37', surface3: '#39414C', disabledBg: '#1F252D', skeleton: '#1A2027',
  textPlaceholder: '#A6AEBA', textDisabled: '#818995', pressed: '#C2D8F9', pressedHeld: '#D6E5FC',
};

const EXPECTED_NUM = {
  numLg: { fontSize: 44, lineHeight: 52, fontWeight: 700 },
  numMd: { fontSize: 22, lineHeight: 30, fontWeight: 700 },
  numSm: { fontSize: 15, lineHeight: 22, fontWeight: 600 },
};

console.log('=== 与原版逐值比对（light）===');
const light = gridTokens(false, 'warm');
for (const k of Object.keys(EXPECTED_LIGHT)) {
  eq(light[k], EXPECTED_LIGHT[k], 'light.' + k);
}
console.log('\n=== 与原版逐值比对（dark）===');
const dark = gridTokens(true, 'warm');
for (const k of Object.keys(EXPECTED_DARK)) {
  eq(dark[k], EXPECTED_DARK[k], 'dark.' + k);
}

console.log('\n=== 数字排版档（num*）===');
for (const k of Object.keys(EXPECTED_NUM)) {
  eq(light[k].fontSize, EXPECTED_NUM[k].fontSize, k + '.fontSize');
  eq(light[k].lineHeight, EXPECTED_NUM[k].lineHeight, k + '.lineHeight');
  eq(light[k].fontWeight, EXPECTED_NUM[k].fontWeight, k + '.fontWeight');
  eq(light[k].fontFeature, 'tnum', k + '.fontFeature');
}

console.log('\n=== 容器对比度自检（容器底 vs 容器上文字，应 ≥4.5）===');
rate(contrastRatio(light.onSuccessContainer, light.successContainer), 4.5, 'light onSuccessContainer on successContainer');
rate(contrastRatio(light.onErrorContainer, light.errorContainer), 4.5, 'light onErrorContainer on errorContainer');
rate(contrastRatio(light.onAccentContainer, light.accentContainer), 4.5, 'light onAccentContainer on accentContainer');
rate(contrastRatio(light.onInfoContainer, light.infoContainer), 4.5, 'light onInfoContainer on infoContainer');
rate(contrastRatio(dark.onSuccessContainer, dark.successContainer), 4.5, 'dark onSuccessContainer on successContainer');
rate(contrastRatio(dark.onErrorContainer, dark.errorContainer), 4.5, 'dark onErrorContainer on errorContainer');
rate(contrastRatio(dark.onAccentContainer, dark.accentContainer), 4.5, 'dark onAccentContainer on accentContainer');
rate(contrastRatio(dark.onInfoContainer, dark.infoContainer), 4.5, 'dark onInfoContainer on infoContainer');

console.log('\n=== 状态三档彼此区分（同一档明暗不同，跨档也不同）===');
eq(light.stateCalm !== light.stateAttention, true, 'light stateCalm ≠ stateAttention');
eq(light.stateAttention !== light.stateUrgent, true, 'light stateAttention ≠ stateUrgent');
eq(dark.stateCalm !== dark.stateUrgent, true, 'dark stateCalm ≠ stateUrgent');

console.log('\n=== Classic 档逐值比对（Android ClassicColor.kt）===');
const classicL = gridTokens(false, 'classic');
const classicD = gridTokens(true, 'classic');
for (const k of Object.keys(EXPECTED_CLASSIC_LIGHT)) {
  eq(classicL[k], EXPECTED_CLASSIC_LIGHT[k], 'classic.light.' + k);
}
for (const k of Object.keys(EXPECTED_CLASSIC_DARK)) {
  eq(classicD[k], EXPECTED_CLASSIC_DARK[k], 'classic.dark.' + k);
}

console.log('\n=== Brand 档逐值比对（Android BrandColor.kt，占位表）===');
const brandL = gridTokens(false, 'brand');
const brandD = gridTokens(true, 'brand');
for (const k of Object.keys(EXPECTED_BRAND_LIGHT)) {
  eq(brandL[k], EXPECTED_BRAND_LIGHT[k], 'brand.light.' + k);
}
for (const k of Object.keys(EXPECTED_BRAND_DARK)) {
  eq(brandD[k], EXPECTED_BRAND_DARK[k], 'brand.dark.' + k);
}

console.log('\n=== 分层正确性：共享字段跨 palette 恒定（§5.2 语义色不随品牌变）===');
for (const k of ['success', 'successContainer', 'onSuccessContainer',
  'accent', 'accentText', 'accentContainer', 'onAccentContainer',
  'infoContainer', 'onInfoContainer',
  'stateCalm', 'stateAttention', 'stateUrgent',
  'error', 'onError', 'errorContainer', 'onErrorContainer',
  'numLg', 'numMd', 'numSm']) {
  eq(light[k], classicL[k], 'light vs classic.light 共享.' + k);
  eq(light[k], brandL[k], 'light vs brand.light 共享.' + k);
  eq(dark[k], classicD[k], 'dark vs classic.dark 共享.' + k);
  eq(dark[k], brandD[k], 'dark vs brand.dark 共享.' + k);
}

console.log('\n=== 分层正确性：随 palette 字段跨 palette 必不同（否则等于没分层）===');
for (const k of ['primary', 'primaryContainer', 'secondary', 'secondaryContainer',
  'surface', 'background', 'outline', 'surface2', 'pressed']) {
  // 相邻对互异即证明「值来自对应表」——⚠️ 不要求三套全互异：
  // 原版 warm.light.surface 与 brand.light.surface 同为 #FFFFFF（巧合同值，
  // 逐值转录事实），断言全异会假红。
  eq(light[k] !== classicL[k] && classicL[k] !== brandL[k],
    true, 'light warm≠classic 且 classic≠brand.' + k);
  eq(dark[k] !== classicD[k] && classicD[k] !== brandD[k],
    true, 'dark warm≠classic 且 classic≠brand.' + k);
}

console.log('\n=== 容器对比度自检（classic/brand，Android 侧同款 WCAG 项）===');
rate(contrastRatio(classicL.onSecondaryContainer, classicL.secondaryContainer), 4.5, 'classic.light onSecondaryContainer');
rate(contrastRatio(brandL.onSecondaryContainer, brandL.secondaryContainer), 4.5, 'brand.light onSecondaryContainer');
rate(contrastRatio(classicD.onSecondaryContainer, classicD.secondaryContainer), 4.5, 'classic.dark onSecondaryContainer');
rate(contrastRatio(brandD.onSecondaryContainer, brandD.secondaryContainer), 4.5, 'brand.dark onSecondaryContainer');

console.log('\n=== palette 名收敛（getPaletteName：脏值回落显式默认 warm）===');
eq(getPaletteName('brand'), 'brand', '合法值 brand 恒等');
eq(getPaletteName('classic'), 'classic', '合法值 classic 恒等');
eq(getPaletteName('warm'), 'warm', '合法值 warm 恒等');
eq(getPaletteName('grid'), 'warm', '脏值 grid 回落 warm（不是 brand！）');
eq(getPaletteName(''), 'warm', '空串回落 warm');
eq(getPaletteName('WARM'), 'warm', '大小写不宽容（WARM ≠ warm，回落默认）');

console.log('\n=== 缺档 fail-fast（对齐 Android Palettes.error()，不许静默回退）===');
let threwRight = false;
try {
  gridTokens(false, 'dirty-palette');
} catch (e) {
  // ⚠️ 断言对着语义写：光「抛错」不够——把 throw 拆掉后
  // `undefined.dark` 也会抛 TypeError，照样能骗过「抛了就算过」。
  // 必须抛的是**缺档语义错误**（消息含「缺档」与 palette 名）。
  threwRight = typeof e.message === 'string'
    && e.message.indexOf('缺档') >= 0
    && e.message.indexOf('dirty-palette') >= 0;
}
eq(threwRight, true, '脏 palette 抛「缺档」语义错（含 palette 名，不是随便什么 TypeError）');
eq(gridTokens(false).primary, light.primary, '不传 palette 默认 = warm 档');

console.log('\n=== 访问器契约 ===');
eq(allGridTokens().length, 6, 'allGridTokens 返回 3 palette × 明暗两档');

console.log('\n' + (failed === 0 ? 'ALL PASS' : 'FAILED') + '  pass=' + passed + ' fail=' + failed);
process.exit(failed === 0 ? 0 : 1);
