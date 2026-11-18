/**
 * M16-2 NFC 诊断纯逻辑 + 只读栅栏。
 *
 * 断言重点：
 *  - 三态能力映射；
 *  - UID/technology 展示；
 *  - NDEF URI / 文本最小解析；
 *  - 源码里没有写卡/HCE/支付路径。
 */

import { readFileSync } from 'node:fs';
import {
  capabilityFrom,
  uidText,
  bytesHex,
  techName,
  techListText,
  hasTech,
  supportsApdu,
  isMifareClassic,
  decodeUriPayload,
  decodeTextPayload,
  ndefRecordText,
  summarizeTag
} from '../entry/src/main/ets/corelogic/NfcLogic.ts';

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
    console.log('FAIL ' + msg + '\n  expect=' + JSON.stringify(expected) + '\n  actual=' + JSON.stringify(actual));
  }
}
function text(rel) {
  return readFileSync(new URL(rel, import.meta.url), 'utf8').split(/\r?\n/);
}
function has(lines, needle) {
  return lines.some((l) => l.indexOf(needle) >= 0);
}

console.log('=== 1. 能力三态 ===');
eq(capabilityFrom(false, false), 'unsupported', '无核心能力 → unsupported');
eq(capabilityFrom(false, true), 'unsupported', '无核心能力时开关值不算');
eq(capabilityFrom(true, false), 'disabled', '有核心能力但关闭');
eq(capabilityFrom(true, true), 'enabled', '有核心能力且开启');

console.log('=== 2. UID / technology ===');
eq(bytesHex([0, 1, 0xab, 0xff]), '00 01 AB FF', 'hex 补齐两位');
eq(uidText([0x12, 0x34, 0x56, 0x78]), '12 34 56 78', '4 字节 UID');
eq(uidText([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07]), '01 02 03 04 05 06 07', '7 字节 UID');
eq(techName(3), 'IsoDep', 'tech 3 = IsoDep');
eq(techName(8), 'MifareClassic', 'tech 8 = MifareClassic');
eq(techName(99), 'Tech99', '未知 tech 不猜名字');
eq(techListText([1, 3, 6, 8]), 'NfcA / IsoDep / Ndef / MifareClassic', 'tech 列表');
ok(hasTech([1, 3], 3), 'hasTech 命中');
ok(!hasTech([1, 8], 3), 'hasTech 不命中');
ok(supportsApdu([1, 3]), '含 IsoDep 才支持 APDU');
ok(!supportsApdu([1, 8]), 'Classic 不等于 IsoDep');
ok(isMifareClassic([1, 8]), 'Classic 判别');

console.log('=== 3. NDEF 最小解析 ===');
eq(decodeUriPayload([0x04, 0x62, 0x69, 0x74, 0x31, 0x30, 0x31, 0x2e, 0x63, 0x6e]),
  'https://bit101.cn', 'URI 前缀 0x04 + ASCII');
eq(decodeUriPayload([0x00, 0x61, 0x2e, 0x63, 0x6e]), 'a.cn', '前缀 0x00');
{
  // status=0x02（语言码长度 2），lang='en'，text='Hello'
  const payload = [0x02, 0x65, 0x6e, 0x48, 0x65, 0x6c, 0x6c, 0x6f];
  eq(decodeTextPayload(payload), 'Hello', '文本记录跳过语言码');
}
eq(decodeTextPayload([]), '', '空文本 → 空');
eq(ndefRecordText(1, [0x55], [0x04, 0x62, 0x69, 0x74, 0x31, 0x30, 0x31, 0x2e, 0x63, 0x6e]),
  'URI：https://bit101.cn', 'URI 记录人话');
ok(ndefRecordText(1, [0x54], [0x02, 0x65, 0x6e, 0x48, 0x69]).indexOf('文本：Hi') >= 0, '文本记录人话');
ok(ndefRecordText(4, [0xaa], [1, 2, 3]).indexOf('TNF 4') >= 0, '未知记录给 TNF/hex');

console.log('=== 4. 摘要 ===');
{
  const s = summarizeTag({ uid: [0x12, 0x34, 0x56, 0x78], technology: [1, 3, 6] }, ['URI：x']);
  eq(s.uid, '12 34 56 78', '摘要 UID');
  eq(s.techs, 'NfcA / IsoDep / Ndef', '摘要 tech');
  eq(s.apdu, true, '摘要 APDU');
  eq(s.classic, false, '摘要 Classic');
  eq(s.ndef, ['URI：x'], '摘要 NDEF');
}

console.log('=== 5. 权限与只读栅栏 ===');
{
  const mod = text('../entry/src/main/module.json5');
  ok(has(mod, 'ohos.permission.NFC_TAG'), '声明 NFC_TAG 权限');
  const pages = text('../entry/src/main/resources/base/profile/main_pages.json');
  ok(has(pages, 'pages/NfcPage'), 'NfcPage 已注册');
  const settings = text('../entry/src/main/ets/pages/SettingsPage.ets');
  ok(has(settings, "url: 'pages/NfcPage'"), '设置页有 NFC 入口');
}
{
  const svc = text('../entry/src/main/ets/service/NfcService.ts');
  ok(has(svc, "tag.on('readerMode'"), '使用前台 readerMode');
  ok(has(svc, 'readNdef'), '读取 NDEF');
  ok(!has(svc, 'writeNdef'), '不写 NDEF');
  ok(!has(svc, 'writeSingleBlock') && !has(svc, 'writeBlock'), '不写块');
  ok(!has(svc, 'cardEmulation'), '不碰 HCE/卡模拟');
  // #152 已接 APDU：不再是「不发 transmit」，改成「只有 probeApdu 一处 transmit 且经闸门」
  ok(has(svc, 'probeApdu') && has(svc, 'runQuickProbe(quickScan()'), 'APDU 仅由快速读状态机发出');
}
{
  const page = text('../entry/src/main/ets/pages/NfcPage.ets');
  ok(has(page, '不写卡'), '页面明确写「不写卡」');
  ok(has(page, '不模拟刷卡'), '页面明确不做卡模拟');
  ok(has(page, '只读'), '页面标明只读');
  ok(has(page, 'gotCard') && has(page, "this.gotCard ? '已读到卡"), '扫到卡后状态文案绑定 gotCard（不再停在「正在等卡」）');
  const clearLine = page.findIndex((l) => l.indexOf('清掉上次结果，避免') >= 0);
  const uidLine = page.findIndex((l) => l.indexOf("this.uid = '';") >= 0);
  const startLine = page.findIndex((l) => l.indexOf('NfcService.start') >= 0);
  ok(clearLine >= 0 && uidLine > clearLine && uidLine < startLine,
    '重新读卡时先清掉旧 UID 再启动（避免正在等卡却显示旧值）');
}

console.log('\nALL PASS pass=' + passed + ' fail=' + failed);
if (failed > 0) {
  process.exit(1);
}
