/**
 * 第 9 条 P0 的登录会话对齐测试（F01-01 限流 / F01-02 无条件存 / F01-03 短信就地续输）。
 * 纯逻辑用 Node 直接跑；页面/服务接线用源码静态守卫。
 * 红线：need_user 不冷却、不自动猜码、不发第二条短信、显式授权路径不变。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  IDENTITY_INTERVAL_MS, SEAT_SUCCESS_COOLDOWN_MS, SEAT_FAIL_BACKOFF_MS,
  localDelay, parseRetryAfter, retryAt, shouldAttempt,
  emptyThrottle, canAttempt, skipReason, nextThrottle, classifyCasStatus, messageFor,
} from '../entry/src/main/ets/corelogic/AutoReloginLogic.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0;
function eq(a, b, msg) { assert.deepEqual(a, b, msg); pass++; }
function ok(v, msg) { assert.ok(v, msg); pass++; }
function src(p) { return readFileSync(join(root, p), 'utf8'); }

console.log('=== F01-01 两套限流口径 ===');
const NOW = 1_700_000_000_000;
const H = 3600_000;
eq(IDENTITY_INTERVAL_MS, 24 * H, 'identity 基准 24h');
eq(SEAT_SUCCESS_COOLDOWN_MS, 30_000, 'seat 成功冷却 30s');
eq(SEAT_FAIL_BACKOFF_MS, 5 * 60_000, 'seat 失败退避 5min');
// 判据①：attempt 1/2/3/4 → 24/48/96/192h
eq(localDelay(1, 'identity'), 24 * H, 'identity attempt1 = 24h');
eq(localDelay(2, 'identity'), 48 * H, 'identity attempt2 = 48h');
eq(localDelay(3, 'identity'), 96 * H, 'identity attempt3 = 96h');
eq(localDelay(4, 'identity'), 192 * H, 'identity attempt4 = 192h');
eq(localDelay(5, 'identity'), 192 * H, 'identity attempt5 封顶 192h');
eq(localDelay(0, 'identity'), 24 * H, 'attempt0 按 1 处理');
eq(localDelay(-3, 'identity'), 24 * H, '负 attempt 按 1 处理');
eq(localDelay(1, 'seat'), 5 * 60_000, 'seat attempt1 失败 = 5min');
eq(retryAt(NOW, 1, null, 'identity'), NOW + 24 * H, 'retryAt identity attempt1');
eq(retryAt(NOW, 4, null, 'identity'), NOW + 192 * H, 'retryAt identity attempt4');
// 判据③：Retry-After 秒数 + RFC1123，取较大值
eq(parseRetryAfter(NOW, '3600'), NOW + 3600_000, 'Retry-After 秒数解析');
eq(parseRetryAfter(NOW, 'Wed, 21 Oct 2026 07:28:00 GMT'), Date.parse('Wed, 21 Oct 2026 07:28:00 GMT'), 'RFC1123 解析');
eq(parseRetryAfter(NOW, '  '), null, '空白头 → null');
eq(parseRetryAfter(NOW, 'garbage'), null, '脏头 → null 不抛');
eq(parseRetryAfter(NOW, '-5'), null, '负数秒 → null');
eq(retryAt(NOW, 1, '3600', 'seat'), NOW + 3600_000, 'seat 服务端 1h > 本地 5min → 取大=1h');
eq(retryAt(NOW, 1, '999999', 'identity'), NOW + 999999_000, '服务端要求更晚 → 听服务端');
eq(retryAt(NOW, 3, '60', 'identity'), NOW + 96 * H, '服务端更早 → 守本地 96h 下限');
eq(shouldAttempt(NOW, NOW), true, '冷却到期可试');
eq(shouldAttempt(NOW, NOW + 1), false, '冷却未到不可试');

console.log('=== 判据②⑤：need_user / no_credential 不计数不冷却 ===');
for (const kind of ['need_user', 'no_credential', 'skipped']) {
  const t = { lastAttemptMs: NOW, consecutiveFails: 2, freezeUntilMs: 0, retryAtMs: 0 };
  const n = nextThrottle(t, kind, NOW + 1000);
  eq(n.consecutiveFails, 2, kind + ' 不加失败计数');
  eq(n.retryAtMs, 0, kind + ' 不加冷却（判据⑤）');
  eq(n.freezeUntilMs, 0, kind + ' 不设冻结');
}
// 失败才退避，且走 retryAtMs
const f1 = nextThrottle(emptyThrottle(), 'failed', NOW, 'identity');
eq(f1.consecutiveFails, 1, '失败一次计数 1');
eq(f1.retryAtMs, NOW + 24 * H, '失败一次 → 24h 冷却');
const f2 = nextThrottle(f1, 'bad_cred', NOW + 24 * H, 'identity');
eq(f2.consecutiveFails, 2, '第二次失败计数 2');
eq(f2.retryAtMs, NOW + 24 * H + 48 * H, '第二次失败 → 48h');
const ok1 = nextThrottle(f2, 'renewed', NOW + 72 * H, 'identity');
eq(ok1.consecutiveFails, 0, '成功清零失败计数');
eq(ok1.retryAtMs, 0, 'identity 成功清冷却');
const seatOk = nextThrottle(f2, 'renewed', NOW, 'seat');
eq(seatOk.retryAtMs, NOW + 30_000, 'seat 成功留 30s 冷却');
const seatFail = nextThrottle(emptyThrottle(), 'failed', NOW, 'seat');
eq(seatFail.retryAtMs, NOW + 5 * 60_000, 'seat 失败 5min');
// canAttempt 用 retryAtMs；need_user 后立即可试
eq(canAttempt({ ...f1, retryAtMs: NOW + 24 * H }, true, NOW + 1), false, '冷却中不可试');
eq(canAttempt({ ...f1, retryAtMs: NOW + 24 * H }, true, NOW + 24 * H), true, '冷却到期可试');
eq(canAttempt({ ...f1, retryAtMs: 0, consecutiveFails: 2 }, true, NOW + 1), true, 'need_user 后不冷却可立即试');
eq(canAttempt(emptyThrottle(), false, NOW), false, '无条件存后仍有「无凭据」兜底（存储失败时）');
// 兼容旧持久化数据（无 retryAtMs）
eq(canAttempt({ lastAttemptMs: NOW, consecutiveFails: 0, freezeUntilMs: 0 }, true, NOW + 9 * 60_000), false, '旧数据仍走 10min 闸门');
eq(canAttempt({ lastAttemptMs: NOW, consecutiveFails: 0, freezeUntilMs: NOW + 8 * H }, true, NOW + 1), false, '旧数据仍认冻结');
// 不改入参
const before = JSON.stringify(f1);
nextThrottle(f1, 'failed', NOW + 99 * H, 'identity', '999999');
eq(JSON.stringify(f1), before, 'nextThrottle 不改入参');
// 分类映射
eq(classifyCasStatus('ok'), 'renewed', 'ok → renewed');
eq(classifyCasStatus('sms_required'), 'need_user', 'sms_required → need_user');
eq(classifyCasStatus('bad_credentials'), 'bad_cred', 'bad_credentials → bad_cred');
ok(messageFor('need_user').length > 0, 'need_user 有文案');

console.log('=== F01-02 无条件存（用户拍板 B）===');
const login = src('entry/src/main/ets/pages/LoginPage.ets');
ok(login.includes('if (reachedLogin) {'), '登录成功即存凭据（不判断 remember）');
ok(!login.includes('if (reachedLogin && this.remember)'), '旧 opt-in 条件已移除');
ok(login.includes('登录成功后密码加密存入本机系统密钥库'), '文案如实告知无条件存');
const cred = src('entry/src/main/ets/data/AutoLoginCredentialStore.ts');
ok(cred.includes('用户拍板 B，对齐 Android 无条件存'), '凭据存储头注释记决策');
ok(cred.includes('AssetStoreKit'), '仍落系统密钥库（非明文偏好）');

console.log('=== F01-03 短信就地续输（红线）===');
const dlg = src('entry/src/main/ets/components/SmsChallengeDialog.ets');
ok(dlg.includes('submitSmsCode(ctx, this.code.trim())'), '就地提交验证码');
ok(dlg.includes('clearPending()'), '取消复位 pending');
ok(!dlg.includes('sendSms'), '本组件不发短信（红线）');
ok(dlg.includes('不重试不发第二条'), '注释钉死不重试');
const cardSvc = src('entry/src/main/ets/service/CampusCardService.ts');
ok(cardSvc.includes("renewed.kind === 'need_user' && hasPendingSms()"), '一卡通服务带出短信待决标志');
const libSvc = src('entry/src/main/ets/service/LibBorrowService.ts');
ok(libSvc.includes("kind: 'smsPending'"), '图书馆服务返回 smsPending 分支');
const cardPage = src('entry/src/main/ets/pages/CardPage.ets');
ok(cardPage.includes('SmsChallengeDialog({'), '一卡通页就地弹框');
const libPage = src('entry/src/main/ets/pages/LibBorrowPage.ets');
ok(libPage.includes('SmsChallengeDialog({'), '图书馆页就地弹框');
const seatPage = src('entry/src/main/ets/pages/SeatPage.ets');
ok(seatPage.includes("AutoReloginService.renew(ctx, 'seat')"), '座位显式授权走 seat 口径');
ok(seatPage.includes('authorizeSeat'), '座位显式授权路径保留');
const casSvc = src('entry/src/main/ets/service/CasLoginService.ts');
ok(casSvc.includes('export function clearPending()'), 'pending 可复位');
ok(casSvc.includes('验证码不正确或已过期（已停手，不重试）'), '验证码错误停手不重试');
ok(casSvc.includes('retryAfter'), '读取服务端 Retry-After');

console.log('\nALL PASS  pass=' + pass + ' fail=0');
process.exit(0);
