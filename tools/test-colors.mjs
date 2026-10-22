/**
 * 配色对比度回归测试（WCAG AA）
 *
 * 为什么要有：Android 侧栽过「深色下白卡浅字」，对比度 1.22~1.48:1，肉眼几乎看不见。
 * 那次是**肉眼**发现、事后返工。这次改成机器守：任何一处文本/背景对不达标就红。
 *
 * 判据（WCAG 2.1 AA）：
 *   - 正文文本 ≥ 4.5:1
 *   - 大文本（≥18pt 或 ≥14pt 粗体）≥ 3:1 —— 本项目只有 textFaint 走这一档，且只用于装饰
 *
 * 跑法：node --experimental-transform-types tools/test-colors.mjs
 */

import { palette, contrastRatio, relativeLuminance } from '../entry/src/main/ets/core/theme/AppColors.ts';

let failed = 0;
let passed = 0;

function ok(cond, msg) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.log('FAIL ' + msg);
  }
}

function rate(ratio, min, msg) {
  const c = ratio >= min;
  const line = (c ? 'PASS ' : 'FAIL ') + msg + ' = ' + ratio.toFixed(2) + ' (需 ≥' + min + ')';
  console.log(line);
  if (!c) failed++; else passed++;
}

console.log('=== 对比度基线自检（算法本身可信吗）===');
rate(contrastRatio('#000000', '#FFFFFF'), 20.9, '黑/白 应为 21 左右');
ok(Math.abs(contrastRatio('#FFFFFF', '#FFFFFF') - 1) < 0.01, '同色对比度 = 1');
ok(contrastRatio('#FFFFFF', '#FFFFFF') === 1, '同色对比度精确为 1');
ok(contrastRatio('bad', '#FFFFFF') === -1, '非法输入返回 -1（不猜）');
ok(relativeLuminance('#FFFFFF') > 0.99 && relativeLuminance('#FFFFFF') <= 1, '白色相对亮度 ≈ 1');

// 已知参考：WCAG 官方例子里 #777777 对 #FFFFFF 约 4.48（刚好不达 4.5）
rate(contrastRatio('#777777', '#FFFFFF'), 4.4, '#777 对白 ≈ 4.48（参考值校验）');
ok(contrastRatio('#777777', '#FFFFFF') < 4.5, '#777 对白**低于** 4.5（说明阈值判断不是摆设）');

for (const dark of [false, true]) {
  const name = dark ? 'dark' : 'light';
  const p = palette(dark);
  console.log('\n=== ' + name + ' ===');

  const bgs = [
    ['bgPage', p.bgPage],
    ['bgCard', p.bgCard],
    ['bgSubtle', p.bgSubtle]
  ];

  // 正文类：一律 ≥4.5
  for (const [bgName, bg] of bgs) {
    rate(contrastRatio(p.textPrimary, bg), 4.5, name + ' textPrimary on ' + bgName);
    rate(contrastRatio(p.textSecondary, bg), 4.5, name + ' textSecondary on ' + bgName);
    rate(contrastRatio(p.textMuted, bg), 4.5, name + ' textMuted on ' + bgName);
  }

  // 仅装饰：放宽到 3.0（WCAG 大文本档）
  for (const [bgName, bg] of [['bgPage', p.bgPage], ['bgCard', p.bgCard]]) {
    rate(contrastRatio(p.textFaint, bg), 3.0, name + ' textFaint(仅装饰) on ' + bgName);
  }

  // 强调色底上的文字
  rate(contrastRatio(p.textOnAccent, p.accent), 4.5, name + ' textOnAccent on accent');

  // 语义色也要能读
  rate(contrastRatio(p.warn, p.bgPage), 4.5, name + ' warn on bgPage');
  rate(contrastRatio(p.warn, p.bgCard), 4.5, name + ' warn on bgCard');
  rate(contrastRatio(p.error, p.bgPage), 4.5, name + ' error on bgPage');
  rate(contrastRatio(p.error, p.bgCard), 4.5, name + ' error on bgCard');

  // 强调色本身作为文字/图标也要可辨
  rate(contrastRatio(p.accent, p.bgPage), 4.0, name + ' accent on bgPage');

  // 新增：成功色与中性区块底
  rate(contrastRatio(p.success, p.bgPage), 4.5, name + ' success on bgPage');
  rate(contrastRatio(p.success, p.bgCard), 4.5, name + ' success on bgCard');
  for (const t of ['textPrimary', 'textSecondary', 'textMuted']) {
    rate(contrastRatio(p[t], p.bgAlt), 4.5, name + ' ' + t + ' on bgAlt');
  }
  // bgAlt 与 bgPage 必须能看出层次（不是同一个色）
  ok(p.bgAlt.toLowerCase() !== p.bgPage.toLowerCase(), name + ' bgAlt 与 bgPage 不同色');

  // 补课日淡暖底：正文与次要文字都要能读
  for (const t of ['textPrimary', 'textSecondary', 'textMuted']) {
    rate(contrastRatio(p[t], p.bgWarnSubtle), 4.5, name + ' ' + t + ' on bgWarnSubtle');
  }
}

// ── 课程 12 色板：fill 底上的 ink 必须能读 ──
// Android 规范 §8.2 给了 fill/ink/mark 三元组，这里验证它真的达标，而不是照抄。
import { COURSE_LIGHT, COURSE_DARK } from '../entry/src/main/ets/core/theme/CoursePalette.ts';

for (const [cname, cs] of [['course-light', COURSE_LIGHT], ['course-dark', COURSE_DARK]]) {
  console.log('\n=== ' + cname + ' ===');
  cs.forEach((c, i) => {
    rate(contrastRatio(c.ink, c.fill), 4.5, cname + '[' + i + '] ink on fill');
  });
}

console.log('\n' + (failed === 0 ? 'ALL PASS' : 'FAILED') + '  pass=' + passed + ' fail=' + failed);
process.exit(failed === 0 ? 0 : 1);
