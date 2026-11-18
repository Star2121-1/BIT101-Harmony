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
  // 唯一 transmit 入口：service 里只有一处 iso.transmit，且 runner 内有闸门
  const transmitCount = svc.split('iso.transmit(').length - 1;
  ok(transmitCount === 1, 'NfcService 里只有一个 transmit 入口（不能绕过闸门）');
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
console.log('\nALL PASS pass=' + pass + ' fail=0');
