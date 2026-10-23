/**
 * Grid 共享组件「状态矩阵」忠实度测试（Node 侧，可红）。
 * =========================================================
 * 原版 Android 把「状态 → 颜色/尺寸」写死在 Composable 内无法单测；
 * 这里断言抽出来的纯函数 `resolveCardStyle / resolveButtonStyle / resolveChipStyle /
 * resolveTabStyle / desaturate` 与原版 §5.1–§5.5 的状态矩阵逐条一致。
 *
 * 任意一处不一致 → 进程非零退出（CI/本地都能立刻报警），符合项目铁律「每条判断要能被证伪」。
 *
 * 跑法（与 test-gridtokens.mjs 同 harness）：
 *   node --experimental-transform-types --experimental-loader ./tools/node-loader.mjs tools/test-gridcomponents.mjs
 */

import { gridTokens } from '../entry/src/main/ets/core/theme/GridTokens.ts';
import {
  resolveCardStyle,
  resolveButtonStyle,
  resolveChipStyle,
  resolveTabStyle,
  desaturate,
} from '../entry/src/main/ets/core/theme/components/gridStyle.ts';

let pass = 0;
let fail = 0;
const fails = [];

function eq(actual, expected, msg) {
  if (actual === expected) {
    pass++;
  } else {
    fail++;
    fails.push(`✗ ${msg}\n    期望: ${expected}\n    实际: ${actual}`);
  }
}

// ── 两套 token 都验（明暗各自独立对照原版）──
for (const isDark of [false, true]) {
  const t = gridTokens(isDark);
  const tag = isDark ? '暗' : '亮';

  // ── GridCard §5.1 ──
  const cardDef = resolveCardStyle(t, { selected: false, disabled: false, courseColorIndex: -1, courseInk: null });
  eq(cardDef.container, t.surface, `[${tag}] Card 默认容器=surface`);
  eq(cardDef.content, t.onSurface, `[${tag}] Card 默认正文=onSurface`);
  eq(cardDef.border, null, `[${tag}] Card 默认无描边`);
  eq(cardDef.stripe, null, `[${tag}] Card 无竖条时 stripe=null`);
  eq(cardDef.showCheck, false, `[${tag}] Card 默认不显示勾选`);

  const cardSel = resolveCardStyle(t, { selected: true, disabled: false, courseColorIndex: -1, courseInk: null });
  eq(cardSel.container, t.primaryContainer, `[${tag}] Card 选中容器=primaryContainer`);
  eq(cardSel.content, t.onSurface, `[${tag}] Card 选中正文=onSurface`);
  eq(cardSel.border, t.primary, `[${tag}] Card 选中描边=primary`);
  eq(cardSel.showCheck, true, `[${tag}] Card 选中显示勾选`);

  const cardDis = resolveCardStyle(t, { selected: false, disabled: true, courseColorIndex: -1, courseInk: null });
  eq(cardDis.container, t.disabledBg, `[${tag}] Card 禁用容器=disabledBg`);
  eq(cardDis.content, t.textDisabled, `[${tag}] Card 禁用正文=textDisabled`);
  eq(cardDis.showCheck, false, `[${tag}] Card 禁用不显示勾选`);

  // 竖条：courseColorIndex≥0 取 ink；禁用时降饱和 50%
  const inkLight = '#112369'; // 0 号课程亮色 ink
  const cardStripe = resolveCardStyle(t, { selected: false, disabled: false, courseColorIndex: 0, courseInk: inkLight });
  eq(cardStripe.stripe, inkLight, `[${tag}] Card 竖条=课程 ink`);
  const cardStripeDis = resolveCardStyle(t, { selected: false, disabled: true, courseColorIndex: 0, courseInk: inkLight });
  eq(cardStripeDis.stripe, desaturate(inkLight, 0.5), `[${tag}] Card 禁用竖条=ink 降饱和50%`);

  // ── GridButton §5.2 ──
  const bFilled = resolveButtonStyle(t, 'filled', { enabled: true, selected: false });
  eq(bFilled.container, t.primary, `[${tag}] Button Filled 容器=primary`);
  eq(bFilled.content, t.onPrimary, `[${tag}] Button Filled 文字=onPrimary`);
  eq(bFilled.border, null, `[${tag}] Button Filled 无描边`);

  const bOutlined = resolveButtonStyle(t, 'outlined', { enabled: true, selected: false });
  eq(bOutlined.container, '#00000000', `[${tag}] Button Outlined 容器=透明`);
  eq(bOutlined.content, t.primary, `[${tag}] Button Outlined 文字=primary`);
  eq(bOutlined.border, t.primary, `[${tag}] Button Outlined 描边=primary`);

  const bText = resolveButtonStyle(t, 'text', { enabled: true, selected: false });
  eq(bText.container, '#00000000', `[${tag}] Button Text 容器=透明`);
  eq(bText.content, t.primary, `[${tag}] Button Text 文字=primary`);

  const bSel = resolveButtonStyle(t, 'outlined', { enabled: true, selected: true });
  eq(bSel.container, t.surface2, `[${tag}] Button 选中容器=surface2`);
  eq(bSel.content, t.onSurface, `[${tag}] Button 选中文字=onSurface`);
  eq(bSel.border, t.primary, `[${tag}] Button 选中描边=primary`);

  const bDisFilled = resolveButtonStyle(t, 'filled', { enabled: false, selected: false });
  eq(bDisFilled.container, t.disabledBg, `[${tag}] Button 禁用Filled 容器=disabledBg`);
  eq(bDisFilled.content, t.textDisabled, `[${tag}] Button 禁用文字=textDisabled`);

  const bDisOutlined = resolveButtonStyle(t, 'outlined', { enabled: false, selected: false });
  eq(bDisOutlined.container, '#00000000', `[${tag}] Button 禁用Outlined 容器=透明`);
  eq(bDisOutlined.content, t.textDisabled, `[${tag}] Button 禁用Outlined 文字=textDisabled`);
  eq(bDisOutlined.border, t.outlineVariant, `[${tag}] Button 禁用Outlined 描边=outlineVariant`);

  // ── GridChip §5.3 ──
  const cDef = resolveChipStyle(t, { enabled: true, selected: false });
  eq(cDef.container, t.surface2, `[${tag}] Chip 默认容器=surface2`);
  eq(cDef.content, t.onSurfaceVariant, `[${tag}] Chip 默认文字=onSurfaceVariant`);
  eq(cDef.border, null, `[${tag}] Chip 默认无描边`);
  eq(cDef.showCheck, false, `[${tag}] Chip 默认不显示勾选`);

  const cSel = resolveChipStyle(t, { enabled: true, selected: true });
  eq(cSel.container, t.primaryContainer, `[${tag}] Chip 选中容器=primaryContainer`);
  eq(cSel.content, t.onPrimaryContainer, `[${tag}] Chip 选中文字=onPrimaryContainer`);
  eq(cSel.border, t.primary, `[${tag}] Chip 选中描边=primary`);
  eq(cSel.showCheck, true, `[${tag}] Chip 选中显示勾选`);

  const cDis = resolveChipStyle(t, { enabled: false, selected: false });
  eq(cDis.container, t.disabledBg, `[${tag}] Chip 禁用容器=disabledBg`);
  eq(cDis.content, t.textDisabled, `[${tag}] Chip 禁用文字=textDisabled`);
  eq(cDis.showCheck, false, `[${tag}] Chip 禁用不显示勾选`);

  // ── GridBottomTab §5.5 ──
  const tabSel = resolveTabStyle(t, { enabled: true, selected: true });
  eq(tabSel.tint, t.primary, `[${tag}] Tab 选中 tint=primary`);
  eq(tabSel.indicator, t.primary, `[${tag}] Tab 选中指示条=primary`);

  const tabDef = resolveTabStyle(t, { enabled: true, selected: false });
  eq(tabDef.tint, t.onSurfaceVariant, `[${tag}] Tab 未选 tint=onSurfaceVariant`);
  eq(tabDef.indicator, t.surface, `[${tag}] Tab 未选指示条=surface（视觉隐藏）`);

  const tabDis = resolveTabStyle(t, { enabled: false, selected: false });
  eq(tabDis.tint, t.textDisabled, `[${tag}] Tab 禁用 tint=textDisabled`);
}

// ── desaturate 算法对照（原版 GridCard.desaturate 同式）──
// #FF0000, amount=0.5 → l=0.299, r=1+(0.299-1)*0.5≈0.6495→0xA6, g=b=0+(0.299)*0.5≈0.1495→0x26
eq(desaturate('#FF0000', 0.5), '#a62626', 'desaturate(#FF0000,0.5)=#a62626');
// amount=0 → 不变
eq(desaturate('#112369', 0), '#112369', 'desaturate(amount=0) 不变');
// 非法输入原样返回
eq(desaturate('nothex', 0.5), 'nothex', 'desaturate 非法输入原样返回');

if (fail > 0) {
  console.error(`\n❌ Grid 组件状态矩阵测试失败：pass=${pass} fail=${fail}`);
  for (const f of fails) {
    console.error(f);
  }
  process.exit(1);
} else {
  console.log(`\n✅ ALL PASS · Grid 组件状态矩阵 pass=${pass} fail=${fail}`);
}
