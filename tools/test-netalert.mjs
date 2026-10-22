/**
 * 校园网提醒判定单测（M7-4）—— 1:1 移植 Android NetFlowChecker / NetFeeChecker 的判定与文案。
 *
 * 锁的是：**阈值边界**（270 与 300 都算「达到」）、**已提醒过不再发**、
 * **越过 300 时不再补发 270 那条**（两条一起弹是打扰）。
 *
 * 跑法：node --experimental-transform-types tools/test-netalert.mjs
 */

import {
  decideFlowAlert,
  decideFeeAlert,
  feeDedupeKey,
  flowAlertTitle,
  flowAlertBody,
  feeAlertTitle,
  feeAlertBody,
  NET_FEE_THRESHOLD_YUAN
} from '../entry/src/main/ets/corelogic/NetAlertLogic.ts';
import { LIMIT_BYTES, WARN_BYTES, formatTraffic } from '../entry/src/main/ets/corelogic/CampusNetLogic.ts';

let passed = 0;
let failed = 0;

function eq(actual, expected, msg) {
  const same = JSON.stringify(actual) === JSON.stringify(expected);
  if (same) {
    passed++;
  } else {
    failed++;
    console.log('FAIL ' + msg + '\n  expect=' + JSON.stringify(expected) + '\n  actual=' + JSON.stringify(actual));
  }
}

const GB = 1024 * 1024 * 1024;

console.log('=== 1. 阈值常量 ===');
eq(WARN_BYTES, 270 * GB, '提前提醒线 270 GB');
eq(LIMIT_BYTES, 300 * GB, '限速阈值 300 GB');
eq(NET_FEE_THRESHOLD_YUAN, 10, '网费阈值 10 元');

console.log('\n=== 2. 流量提醒判定 ===');
eq(decideFlowAlert(269 * GB, false, false), 'none', '269 GB 不提醒');
eq(decideFlowAlert(270 * GB, false, false), 'near', '270 GB 整 → 接近阈值');
eq(decideFlowAlert(285 * GB, false, false), 'near', '285 GB → 接近阈值');
eq(decideFlowAlert(300 * GB, false, false), 'exceeded', '300 GB 整 → 超限（不是 near）');
eq(decideFlowAlert(400 * GB, false, false), 'exceeded', '400 GB → 超限');
// ⚠️ 这个组合（warnedLimit=true 但 warnedNear=false）**实际不可达**：
//    发 Exceeded 时 Android 同时置 warnedNear=true（见 NetFlowChecker.check）。
//    纯函数在这里仍返回 near —— 与 Android 逐字一致，故按实际行为断言。
eq(decideFlowAlert(400 * GB, false, true), 'near', '异常组合按 Android 原逻辑返回 near（实际不可达）');
eq(decideFlowAlert(400 * GB, true, true), 'none', '两个都提醒过 → 不再发');
eq(decideFlowAlert(285 * GB, true, false), 'none', '已提醒接近 → 不再发');
eq(decideFlowAlert(300 * GB, true, false), 'exceeded', '提醒过 270 未提醒 300 → 仍要发超限');
eq(decideFlowAlert(270 * GB, true, true), 'none', '两个都提醒过 → 静默');
eq(decideFlowAlert(0, false, false), 'none', '0 字节不提醒');

console.log('\n=== 3. 网费判定 ===');
eq(decideFeeAlert(9.99), true, '9.99 元 → 提醒');
eq(decideFeeAlert(10.0), false, '10 元整 → 不提醒（阈值是「低于」）');
eq(decideFeeAlert(30.01), false, '30.01 元 → 不提醒');
eq(decideFeeAlert(0), true, '0 元 → 提醒');
eq(decideFeeAlert(-1), true, '负数余额 → 提醒');

console.log('\n=== 4. 去重键 ===');
eq(feeDedupeKey('2026-10-21'), 'netfee_low_2026-10-21', '网费键带自然日');

console.log('\n=== 5. 文案（与 Android 逐字一致） ===');
eq(flowAlertTitle('near'), '校园网流量接近限速阈值', '接近阈值标题');
eq(flowAlertTitle('exceeded'), '校园网流量已超限速阈值', '超限标题');
eq(flowAlertTitle('none'), '', 'none 无标题');
eq(flowAlertBody('near', 280 * GB), '本月已用 ' + formatTraffic(280 * GB) + '（限速阈值 300.0 GB），超出后将限速',
  '接近阈值正文');
eq(flowAlertBody('exceeded', 366.4 * GB), '本月已用 ' + formatTraffic(366.4 * GB) + '，已超过 300.0 GB，网速可能被限制',
  '超限正文');
eq(flowAlertBody('none', 100 * GB), '', 'none 无正文');
eq(feeAlertTitle(), '网费不足', '网费标题');
eq(feeAlertBody(9.5), '校园网余额仅剩 ¥9.50（低于 10 元），记得充值', '网费正文（两位小数）');
eq(feeAlertBody(30.01), '校园网余额仅剩 ¥30.01（低于 10 元），记得充值', '网费正文（真实余额样例）');

console.log('\n' + (failed === 0 ? 'ALL PASS' : 'FAILED') + '  pass=' + passed + ' fail=' + failed);
process.exit(failed > 0 ? 1 : 0);
