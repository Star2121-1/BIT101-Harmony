/**
 * gridTokens 对比度栅栏（WCAG AA）
 *
 * 为什么要有：2026-10-27 把 10 个页面从旧 `AppColors` 迁到 gridTokens，全是对**色值**做映射，
 * 而这种改动编译必过、单测（逻辑层）也必过 —— 唯一会炸的地方是「文字压在同色底上」，
 * 只有肉眼能看出来。当时手机不在手上，没有真机可验，所以先把判据机器化：
 * 三套 palette × 明暗两档，逐条量「文字 / 底色」对比度。
 *
 * 判据（WCAG 2.1 AA，对齐 test-colors.mjs 的口径）：
 *   - 正文/标签文本 ≥ 4.5:1
 *   - 只用于禁用控件与装饰的档位不在此列（textDisabled 明确排除）
 *
 * 跑法：node --experimental-transform-types tools/test-gridcontrast.mjs
 */

import { gridTokens, ALL_PALETTES } from '../entry/src/main/ets/core/theme/GridTokens.ts';
import { contrastRatio } from '../entry/src/main/ets/core/theme/AppColors.ts';

let passed = 0;
let failed = 0;

function rate(ratio, min, msg) {
  if (ratio >= min) {
    passed++;
    console.log('PASS ' + msg + ' = ' + ratio.toFixed(2) + ' (需 ≥' + min + ')');
  } else {
    failed++;
    console.log('FAIL ' + msg + ' = ' + ratio.toFixed(2) + ' (需 ≥' + min + ')');
  }
}

// 算法自检：换了配色表不影响算法，但先钉住「量出来的数可信」
console.log('=== 算法自检 ===');
rate(contrastRatio('#000000', '#FFFFFF'), 20.9, '黑/白 ≈ 21');
if (Math.abs(contrastRatio('#FFFFFF', '#FFFFFF') - 1) >= 0.01) {
  failed++;
  console.log('FAIL 同色对比度应为 1');
} else {
  passed++;
  console.log('PASS 同色对比度 = 1');
}

// 文本 / 底色 配对（字段名即 gridTokens 的语义角色）
const PAIRS = [
  // [前景字段, 背景字段, 说明, 最低要求]
  ['onBackground', 'background', '页面正文 / 页面底', 4.5],
  ['onSurface', 'surface', '卡片正文 / 卡片底', 4.5],
  ['onSurface', 'background', '卡片正文 / 页面底（未铺卡的区块）', 4.5],
  // ⚠️ 旧 AppColors 的 textMuted 承载「口径说明、单位、组标题」这类**信息性**文本，
  //    映射到 onSurfaceVariant（M3 的中等强调文字），按正文标准 4.5 卡。
  ['onSurfaceVariant', 'surface', '副标题·次要信息·未选 chip / 卡片底', 4.5],
  ['onSurfaceVariant', 'background', '副标题 / 页面底', 4.5],
  ['onSurfaceVariant', 'surface2', '未选中的 chip/tab 文字 / 次级面', 4.5],
  // textPlaceholder 在本项目只承载「原 textFaint = 仅装饰」，走大文本档 3.0
  // （与 test-colors.mjs 对 textFaint 的口径一致）。若哪天要让它承载信息，
  // 必须升到 onSurfaceVariant —— 4.35 的 classic/dark 这一档就是不够的。
  ['textPlaceholder', 'surface', '装饰性三级文字 / 卡片底', 4.5],
  ['textPlaceholder', 'background', '装饰性三级文字 / 页面底', 4.5],
  ['textPlaceholder', 'surface2', '装饰性三级文字 / 次级面（装饰档）', 3.0],
  ['primary', 'surface', '主色文字（链接/可点）/ 卡片底', 4.5],
  ['primary', 'background', '主色文字 / 页面底', 4.5],
  ['onPrimary', 'primary', '实底按钮字 / 按钮底', 4.5],
  ['accentText', 'surface', '警示文字（旧 warn 的去处）/ 卡片底', 4.5],
  ['accentText', 'background', '警示文字 / 页面底', 4.5],
  ['error', 'surface', '错误文字 / 卡片底', 4.5],
  ['error', 'background', '错误文字 / 页面底', 4.5],
  ['onSecondaryContainer', 'secondaryContainer', '薄荷卡上的字 / 薄荷卡底', 4.5],
  ['onPrimaryContainer', 'primaryContainer', '桃色卡上的字 / 桃色卡底', 4.5],
  ['success', 'surface', '成功文字 / 卡片底', 4.5],
];

let pairCount = 0;
for (const name of ALL_PALETTES) {
  for (const dark of [false, true]) {
    const t = gridTokens(dark, name);
    const tag = name + '/' + (dark ? 'dark' : 'light');
    console.log('\n=== ' + tag + ' ===');
    for (const [fg, bg, why, min] of PAIRS) {
      pairCount++;
      rate(contrastRatio(t[fg], t[bg]), min, tag + ' ' + fg + ' on ' + bg + ' —— ' + why);
    }
  }
}

console.log('\n共量 ' + pairCount + ' 对（' + ALL_PALETTES.length + ' palette × 2 档 × ' + PAIRS.length + ' 组）');
console.log((failed === 0 ? 'ALL PASS' : 'FAILED') + '  pass=' + passed + ' fail=' + failed);
process.exit(failed === 0 ? 0 : 1);
