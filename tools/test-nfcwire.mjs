/**
 * NFC APDU 接线栅栏（#152）：源码结构断言（Node 无 kit 环境跑不了真 transmit）。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

let pass = 0;
function ok(cond, name) {
  assert.ok(cond, name);
  pass++;
}
function code(rel) {
  return readFileSync(new URL(rel, import.meta.url), 'utf8');
}
function has(s, needle) {
  return s.indexOf(needle) >= 0;
}

const svc = code('../entry/src/main/ets/service/NfcService.ts');
{
  ok(has(svc, "import { util } from '@kit.ArkTS'"), 'GBK decoder 依赖 ArkTS util');
  ok(has(svc, "util.TextDecoder.create('gbk')"), '用官方 gbk 解码器（非手写码表）');
  ok(has(svc, 'tag.getIsoDep(tagInfo)') && has(svc, 'iso.connect()'), '连接 IsoDep');
  ok(has(svc, 'iso.resetConnection()'), '读完关闭 IsoDep');
  ok(has(svc, 'tag.ISO_DEP'), '只在 CPU 卡（ISO_DEP）上跑 APDU');
  ok(has(svc, 'runQuickProbe(quickScan()'), '接线调用快速读状态机');
  ok(has(svc, 'onCard !== undefined') && has(svc, 'onCard(info, r)'), 'readerMode 回调整条卡给页面');
  // 每处 transmit 都必须有闸门：快速读走 runner、深度扫描走 DeepScanLogic（都在纯逻辑里过 isReadOnly），
  // 认证门走 isReadOnlyLocal。三处只是注入通道，没有绕过闸门。
  const transmitCount = svc.split('iso.transmit(').length - 1;
  ok(transmitCount === 3, '三个 transmit 入口（快速读 + 深度扫描 + 认证门研究）');
  ok(has(svc, 'isReadOnlyLocal(apdu)') && has(svc, '被只读闸门拦下，未发出'),
    '认证门的 transmit 前有本地只读闸门');
}
{
  const runner = code('../entry/src/main/ets/corelogic/CardProbeRunner.ts');
  const gateAt = runner.indexOf('if (!isReadOnly(apdu))');
  const txAt = runner.indexOf('await tx(apdu)');
  ok(gateAt >= 0 && txAt > gateAt, 'transmit 前有 isReadOnly 闸门（顺序正确）');
  ok(has(runner, 'GET RESPONSE') && has(runner, 'result.correctLe'), '跟进 61xx/6Cxx');
  ok(has(runner, 'shouldTryRecords'), '6981 改读记录');
}
{
  const page = code('../entry/src/main/ets/pages/NfcPage.ets');
  ok(has(page, 'studentIdInput') && has(page, 'TextInput'), '学号输入框（选填）');
  ok(has(page, 'runProbe(tagInfo)'), '页面调 APDU 读卡');
  ok(has(page, 'lastProbedUid') && has(page, 'r.uid === this.lastProbedUid'), '按 UID 去重防重复读');
  ok(has(page, '疑似学号') && has(page, '已核对'), '疑似/核对分开标注');
  ok(has(page, 'hasPerson(this.identity)'), '无人时提示开深度扫描');
  ok(has(page, 'gridTokens') && has(page, 'this.tk()'), 'UI 走统一 token（深色/三皮肤）');
}

{
  const svc2 = code('../entry/src/main/ets/service/NfcService.ts');
  const page2 = code('../entry/src/main/ets/pages/NfcPage.ets');
  ok(has(svc2, 'probeAuthGate') && has(page2, 'runAuthGate'), '认证门研究已接线');
  ok(has(svc2, 'gateProbeSteps') && has(svc2, 'analyzeGate'), '研究走纯逻辑探测与判定');
  // 红线：全链路不出现 EXTERNAL AUTHENTICATE / 破密钥 / MFOC
  for (const [name, src] of [['service', svc2], ['page', page2]]) {
    ok(!has(src, '0x82') && !has(src, '0082'), name + ' 无 EXTERNAL AUTHENTICATE(82)');
    ok(!/MFOC|nested authentication|暴力|破密钥/.test(src.replace(/不破密钥|破密钥的|不去破密钥/g, '')),
      name + ' 无破密钥实现（仅红线注释允许提）');
  }
}

{
  const svc3 = code('../entry/src/main/ets/service/NfcService.ts');
  const page3 = code('../entry/src/main/ets/pages/NfcPage.ets');
  ok(has(svc3, 'probeDeep') && has(page3, 'runDeep'), '深度只读扫描已接线到服务与页面');
  ok(has(svc3, 'runDeepScan'), '深度扫描走纯逻辑模块');
  for (const [name, src] of [['deep-svc', svc3], ['deep-page', page3]]) {
    ok(!has(src, '0x82') && !has(src, '0082'), name + ' 无 EXTERNAL AUTHENTICATE(82)');
  }
}

{
  const svc4 = code('../entry/src/main/ets/service/NfcService.ts');
  const page4 = code('../entry/src/main/ets/pages/NfcPage.ets');
  const logic4 = code('../entry/src/main/ets/corelogic/ClassicScanLogic.ts');
  ok(has(svc4, 'probeClassic') && has(page4, 'runClassic'), 'Classic 只读 dump 已接线到服务与页面');
  ok(has(svc4, 'runClassicScan') && has(svc4, 'getMifareClassic'), 'Classic 扫描走纯逻辑 + MifareClassicTag');
  ok(has(page4, 'classicMode') && has(page4, 'r.classic'), 'Classic 模式按 Classic 能力触发（不依赖 APDU）');
  // 红线：全链路不写块、不写 NDEF、不试第二密钥（logic 的红线注释里有这些词，只扫代码行）
  for (const [name, src] of [['classic-svc', svc4], ['classic-page', page4], ['classic-logic', logic4]]) {
    const codeOnly = src.split('\n').filter(l => !/^\s*\*|^\s*\/\//.test(l)).join('\n');
    ok(!/writeSingleBlock|incrementBlock|decrementBlock|transferToBlock|restoreFromBlock|writeNdef|\.format\(/.test(codeOnly),
      name + ' 无写块/增值/NDEF 写入');
  }
  const logicCode = logic4.split('\n').filter(l => !/^\s*\*|^\s*\/\//.test(l)).join('\n');
  ok(has(logicCode, 'DEFAULT_KEY_A') && !/0xFF[\s,]*0xFF[\s,]*0xFF[\s,]*0xFF[\s,]*0x00/.test(logicCode),
    'Classic 逻辑只有唯一默认密钥，无第二候选');
}
console.log('\nALL PASS pass=' + pass + ' fail=0');
