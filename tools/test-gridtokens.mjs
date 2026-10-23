/**
 * 《一格 GRID》token 层忠实度回归测试
 * =========================================================
 * 目的：证明 harmony 端的 `core/theme/GridTokens.ts` 是 Android
 * `features/theme/GridTokens.kt`（SharedGridTokens）的 1:1 照搬，
 * 而不是「看着像」——任意一处色值不一致就红。
 *
 * 判据来源：直接读 `F:/Agent_Work/BIT-102/BIT101-seat/features/theme/src/.../GridTokens.kt`
 * 的 `sharedGridTokensLight` / `sharedGridTokensDark` 常量，下方 EXPECTED 即其逐值转录。
 *
 * 跑法（与 tools/test-colors.mjs 同源）：
 *   node --experimental-transform-types --experimental-loader ./tools/node-loader.mjs tools/test-gridtokens.mjs
 */

import { gridTokens, allGridTokens } from '../entry/src/main/ets/core/theme/GridTokens.ts';
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
  // 面色族 + 文字档 + 按压档（warm 暗色）
  surface2: '#272219', surface3: '#332C24', disabledBg: '#2A251F', skeleton: '#231F1A',
  textPlaceholder: '#A79A8C', textDisabled: '#857B72', pressed: '#D6A98A', pressedHeld: '#E6C3A8',
};

const EXPECTED_NUM = {
  numLg: { fontSize: 44, lineHeight: 52, fontWeight: 700 },
  numMd: { fontSize: 22, lineHeight: 30, fontWeight: 700 },
  numSm: { fontSize: 15, lineHeight: 22, fontWeight: 600 },
};

console.log('=== 与原版逐值比对（light）===');
const light = gridTokens(false);
for (const k of Object.keys(EXPECTED_LIGHT)) {
  eq(light[k], EXPECTED_LIGHT[k], 'light.' + k);
}
console.log('\n=== 与原版逐值比对（dark）===');
const dark = gridTokens(true);
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

console.log('\n=== 访问器契约 ===');
eq(allGridTokens().length, 2, 'allGridTokens 返回明暗两档');

console.log('\n' + (failed === 0 ? 'ALL PASS' : 'FAILED') + '  pass=' + passed + ' fail=' + failed);
process.exit(failed === 0 ? 0 : 1);
