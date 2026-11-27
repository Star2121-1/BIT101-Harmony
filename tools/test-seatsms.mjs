/**
 * P0 第10条 S-02 座位页就地短信码框测试。
 * 纯逻辑用 Node 直接跑；页面/组件接线用源码静态守卫。
 * 红线：只在显式授权路径、不跳登录页、不重输学号密码、不发第二条短信、不代收不猜码。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  SMS_WAIT_TIMEOUT_MS, seatSmsRoute, smsWaitExpired, smsTimeoutMessage, smsCodeSubmittable,
} from '../entry/src/main/ets/corelogic/SeatSmsChallengeLogic.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0;
function eq(a, b, msg) { assert.deepEqual(a, b, msg); pass++; }
function ok(v, msg) { assert.ok(v, msg); pass++; }
function src(p) { return readFileSync(join(root, p), 'utf8'); }

console.log('=== S-02 纯逻辑：路由决策 ===');
eq(seatSmsRoute('renewed', false), 'retry-jwt', 'renewed → 换 JWT 重试（原流程不变）');
eq(seatSmsRoute('renewed', true), 'retry-jwt', 'renewed 即使有残留 pending 也不弹框');
eq(seatSmsRoute('need_user', true), 'show-sms-dialog', 'need_user+短信pending → 就地码框');
eq(seatSmsRoute('need_user', false), 'goto-login', 'need_user 但无 pending（图形验证码等）→ 跳登录页');
eq(seatSmsRoute('no_credential', false), 'goto-login', '无凭据 → 跳登录页');
eq(seatSmsRoute('bad_cred', true), 'goto-login', '密码错即使有脏 pending 也不弹框');
eq(seatSmsRoute('failed', false), 'goto-login', '失败 → 跳登录页');
eq(seatSmsRoute('skipped', false), 'goto-login', '节流跳过 → 跳登录页');

console.log('=== S-02 纯逻辑：5min 超时（对齐 Android SeatSmsChallengeHub）===');
eq(SMS_WAIT_TIMEOUT_MS, 300000, '超时上限 5min=300000ms');
const T0 = 1_700_000_000_000;
eq(smsWaitExpired(T0, T0 + 299999), false, '299.999s 未超时');
eq(smsWaitExpired(T0, T0 + 300000), true, '300s 整到点即超时');
eq(smsWaitExpired(T0, T0 + 301000), true, '301s 已超时');
eq(smsWaitExpired(T0, T0), false, '起始时刻不超时');
eq(smsWaitExpired(T0 + 1000, T0), false, '起始时间在未来（now<start）不误判超时');
eq(smsWaitExpired(T0 - 1000, T0), false, '只等了 1s 不超时');
eq(smsWaitExpired(NaN, T0 + 400000), false, 'NaN 起始时间不误判超时');
eq(smsWaitExpired(T0, NaN), false, 'NaN 当前时间不误判超时');
eq(smsWaitExpired(T0, T0 + 400000, 0), false, 'timeoutMs=0 不启用超时（老页面默认）');
eq(smsTimeoutMessage(), '验证码输入超时，请重新授权', '超时文案对齐 Android');

console.log('=== S-02 纯逻辑：验证码可提交判据 ===');
eq(smsCodeSubmittable('123456'), true, '正常码可提交');
eq(smsCodeSubmittable('  123456  '), true, '带空白 trim 后可提交');
eq(smsCodeSubmittable('   '), false, '纯空白不提交');
eq(smsCodeSubmittable(''), false, '空串不提交');

console.log('=== 守卫：SeatPage 就地弹框接线（静态）===');
const seat = src('entry/src/main/ets/pages/SeatPage.ets');
ok(seat.includes("import { SmsChallengeDialog } from '../components/SmsChallengeDialog.ets'"), 'SeatPage 导入 SmsChallengeDialog');
ok(seat.includes("seatSmsRoute(decision.kind, hasPendingSms())"), '用纯逻辑判路由');
ok(seat.includes("smsRoute === 'show-sms-dialog'"), 'need_user+pending 走就地码框分支');
ok(seat.includes('this.smsShow = true'), '置 smsShow 弹框');
ok(seat.includes('timeoutMs: SMS_WAIT_TIMEOUT_MS'), '码框挂 5min 超时');
ok(seat.includes('onTimeout: () =>'), '超时回调接线');
ok(seat.includes('void this.afterSmsSuccess()'), '成功回调走 afterSmsSuccess 续输');
ok(seat.includes('private async afterSmsSuccess()'), 'afterSmsSuccess 换票方法存在');
ok(seat.includes('CasLoginService.silentRenewJwt(ctx)') && seat.includes('await this.loadSeats(false)'),
  '短信成功后换 seatlib JWT + 重试取数');
// 红线：码框分支 return 在前，不执行后面的 pushUrl(LoginPage)
const smsBranch = seat.indexOf("smsRoute === 'show-sms-dialog'");
const pushUrl = seat.indexOf("router.pushUrl({ url: 'pages/LoginPage', params: { from: 'seat' } })");
ok(smsBranch >= 0 && pushUrl > smsBranch, '弹框分支位于跳登录页之前');
const smsBlock = seat.substring(smsBranch, seat.indexOf('if (seatRenewAction(decision.kind)', smsBranch));
ok(smsBlock.includes('return;'), '弹框分支 return，不落到跳登录页');
ok(!smsBlock.includes('LoginPage'), '弹框分支内不含跳登录页');
ok(!smsBlock.includes('username') && !smsBlock.includes('password'), '弹框分支不重输学号密码');

console.log('=== 守卫：显式授权路径（红线）===');
// authorizeSeat 的全部调用点必须在 onClick 内（自动路径绝不发短信）
const calls = [...seat.matchAll(/this\.authorizeSeat\(\)/g)].map(m => m.index);
ok(calls.length >= 4, 'authorizeSeat 有多处入口');
for (const idx of calls) {
  const before = seat.substring(Math.max(0, idx - 220), idx);
  ok(before.includes('.onClick'), 'authorizeSeat@' + idx + ' 在用户点击回调内（非自动路径）');
}

console.log('=== 守卫：SmsChallengeDialog 超时可复用且向后兼容 ===');
const dlg = src('entry/src/main/ets/components/SmsChallengeDialog.ets');
ok(dlg.includes('@Prop timeoutMs: number = 0'), '超时 prop 默认 0（CardPage/LibBorrowPage 不受影响）');
ok(dlg.includes('onTimeout: () => void = () => {}'), '超时回调默认空实现');
ok(dlg.includes('this.timerId = setTimeout(() => {'), '一次性定时器启动');
ok(dlg.includes('clearTimeout(this.timerId)'), '定时器可清理');
ok(dlg.includes('aboutToDisappear(): void'), '组件销毁清定时器');
ok(dlg.includes('clearPending();\n        this.onTimeout();') || /clearPending\(\);[\s\S]{0,80}this\.onTimeout\(\)/.test(dlg),
  '超时先清 pending 再回调');

console.log(`\nALL PASS  pass=${pass} fail=0`);
