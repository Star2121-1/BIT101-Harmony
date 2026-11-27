/**
 * 剩余项批次 A（纯逻辑/文档低风险）：
 *   F05-11 tech 去重 / F05-07 CardKind 枚举 / G-06 空表文案 / F13 A11yText 推广 / G07-15 注释订正。
 * 纯逻辑用 Node 跑；接线用源码静态守卫。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  techListText, techName, hasTech, supportsApdu, cardKindOf, cardKindLabel,
} from '../entry/src/main/ets/corelogic/NfcLogic.ts';
import { switchA11y } from '../entry/src/main/ets/corelogic/A11yText.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0;
function eq(a, b, msg) { assert.deepEqual(a, b, msg); pass++; }
function ok(v, msg) { assert.ok(v, msg); pass++; }
function src(p) { return readFileSync(join(root, p), 'utf8'); }

console.log('=== F05-11 technology 展示去重（对齐 Android distinct）===');
eq(techListText([3, 1, 1, 8, 7]), 'IsoDep / NfcA / MifareClassic / NdefFormatable', '重复 NfcA 消失且保序');
eq(techListText([1, 1, 1]), 'NfcA', '全重复只留一个');
eq(techListText([1, 3, 6, 8]), 'NfcA / IsoDep / Ndef / MifareClassic', '无重复时原样');
eq(techListText([]), '', '空数组');
// 能力判定不受去重影响
ok(hasTech([1, 1, 3], 3), 'hasTech 仍按原数组');
ok(supportsApdu([3, 3]), 'supportsApdu 不受影响');

console.log('=== F05-07 CardKind 枚举（IsoDep 优先于 Classic）===');
eq(cardKindOf([3, 1, 1, 8, 7]), 'cpu_card', '真卡 techList → CPU 卡（IsoDep 优先）');
eq(cardKindOf([8, 1]), 'mifare_classic', '只有 Classic → MIFARE Classic');
eq(cardKindOf([5]), 'nfc_v', 'NfcV → ISO 15693');
eq(cardKindOf([6]), 'nfc_forum_tag', 'Ndef → NFC 贴纸');
eq(cardKindOf([7]), 'nfc_forum_tag', 'NdefFormatable → NFC 贴纸');
eq(cardKindOf([]), 'unknown', '空 → 认不出来');
eq(cardKindOf([99]), 'unknown', '未知 tech → 认不出来');
eq(cardKindLabel('cpu_card'), 'CPU 卡（能发 APDU）', 'CPU 卡文案');
eq(cardKindLabel('mifare_classic'), 'MIFARE Classic（读扇区要密钥）', 'Classic 文案');
eq(cardKindLabel('nfc_forum_tag'), 'NFC 贴纸 / Type 4 标签', '贴纸文案');
eq(cardKindLabel('nfc_v'), 'ISO 15693 标签', 'NFC-V 文案');
eq(cardKindLabel('unknown'), '认不出来', '未知文案');
// 真卡双界面：CardKind=CPU 但 classic 标志仍真（两者不互斥）
ok(cardKindOf([3, 8]) === 'cpu_card' && hasTech([3, 8], 8), 'CPU 卡仍保留 Classic 兼容层标志');

console.log('=== G-06 空表文案（对齐 Android EMPTY_TABLE_NOTE）===');
const runner = src('entry/src/main/ets/service/ScoreCheckRunner.ts');
ok(runner.includes("export const EMPTY_TABLE_NOTE: string = '教务这次一门成绩都没返回（多半是还没评教），没覆盖掉上次取到的'"),
  '空表文案常量与 Android 逐字一致');
ok(runner.includes('detail: EMPTY_TABLE_NOTE'), '空表分支返回带文案 detail');
ok(runner.includes('await ScoreStore.saveLastCheck(ScoreCheckCode.OK, 0, null)'), '空表仍不写基线（防覆盖上次）');
const score = src('entry/src/main/ets/pages/ScorePage.ets');
ok(score.includes('if (out.count === 0 && out.detail !== null'), '页面按 count=0+detail 判空表');
ok(score.includes('t = out.detail;'), '空表显示专门文案而非「0 门课」');

console.log('=== F13 A11yText 推广到设置页开关 ===');
eq(switchA11y('课程卡边框', true), '课程卡边框，已开启', 'switchA11y 开');
eq(switchA11y('课程卡边框', false), '课程卡边框，已关闭', 'switchA11y 关');
const settings = src('entry/src/main/ets/pages/SettingsPage.ets');
ok(settings.includes("import { switchA11y } from '../corelogic/A11yText.ts'"), 'SettingsPage 导入 switchA11y');
const swCount = (settings.match(/\.accessibilityText\(switchA11y\(/g) || []).length;
ok(swCount === 3, '三处 Toggle 都带读屏文案（边框/分隔线/隐藏非空闲），实际 ' + swCount);

console.log('=== G07-15 注释订正（不作假陈述）===');
const cls = src('entry/src/main/ets/pages/ClassroomPage.ets');
ok(cls.includes('G07-15 订正'), '注释订正已标注');
ok(cls.includes('fabActions()'), '引用真实函数名 fabActions（非臆造的 fabGroup）');
ok(!cls.includes('未搬（见 ROADMAP 待办）'), '过时的「未搬」陈述已删除');

console.log(`\nALL PASS  pass=${pass} fail=0`);
