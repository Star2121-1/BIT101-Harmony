/**
 * 自动重登纯逻辑单测（不碰 @kit、不发网络）。
 *
 * 判据对着语义写：
 * - 没 opt-in 凭据 ⇒ 绝不自动重登；
 * - 短信/验证码 ⇒ 停手交回用户，不自动猜码；
 * - 密码错 ⇒ 清凭据（靠源码栅栏确认接线）；
 * - 连续失败 ⇒ 冻结，不反复撞 CAS 风控；
 * - 10 分钟闸门挡住多子系统同时失效的连发；
 * - 重登成功 ⇒ 清零失败计数，但**不碰业务数据**（返回 renewed 让调用方重试）。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  MIN_RETRY_MS, MAX_FAILS_BEFORE_FREEZE, FREEZE_MS, emptyThrottle,
  canAttempt, skipReason, nextThrottle, classifyCasStatus, decision, messageFor
} from '../entry/src/main/ets/corelogic/AutoReloginLogic.ts';

let pass = 0;
function ok(cond, name) { assert.ok(cond, name); pass++; }
function eq(a, b, name) { assert.equal(a, b, name); pass++; }
function code(rel) { return readFileSync(new URL(rel, import.meta.url), 'utf8'); }
function has(s, n) { return s.indexOf(n) >= 0; }

const T0 = 1_700_000_000_000;

console.log('\n=== 自动重登纯逻辑 ===');

// ── 凭据门槛 ──
{
  eq(canAttempt(emptyThrottle(), false, T0), false, '没存凭据 ⇒ 不自动重登');
  eq(canAttempt(emptyThrottle(), true, T0), true, '有凭据 + 空节流 ⇒ 允许');
  ok(has(skipReason(emptyThrottle(), false, T0), '手动登录'), '无凭据的跳过原因指向手动登录');
}

// ── 10 分钟闸门 ──
{
  const t = { lastAttemptMs: T0, consecutiveFails: 0, freezeUntilMs: 0 };
  eq(canAttempt(t, true, T0 + MIN_RETRY_MS - 1), false, '闸门内（9分59秒）不重试');
  eq(canAttempt(t, true, T0 + MIN_RETRY_MS), true, '闸门到期（10分钟）可重试');
  ok(has(skipReason(t, true, T0 + 1000), '稍后'), '冷却提示让用户稍后或手动');
}

// ── 冻结 ──
{
  const t = { lastAttemptMs: T0, consecutiveFails: 3, freezeUntilMs: T0 + FREEZE_MS };
  eq(canAttempt(t, true, T0 + FREEZE_MS - 1), false, '冻结期内不重试');
  eq(canAttempt(t, true, T0 + FREEZE_MS + 1), true, '冻结到期可重试');
  ok(has(skipReason(t, true, T0), '暂停'), '冻结提示说清楚已暂停');
}

// ── 结果分类 ──
{
  eq(classifyCasStatus('ok'), 'renewed', 'ok ⇒ renewed');
  eq(classifyCasStatus('sms_required'), 'need_user', '短信二验 ⇒ 交回用户');
  eq(classifyCasStatus('captcha_required'), 'need_user', '图形验证码 ⇒ 交回用户');
  eq(classifyCasStatus('bad_credentials'), 'bad_cred', '密码错 ⇒ bad_cred');
  eq(classifyCasStatus('error'), 'failed', '其它 ⇒ failed');
}

// ── 节流状态转移 ──
{
  const t0 = emptyThrottle();
  const t1 = nextThrottle(t0, 'failed', T0);
  eq(t1.consecutiveFails, 1, '失败一次 ⇒ 计数 1');
  eq(t1.lastAttemptMs, T0, '记录尝试时间');
  eq(t1.freezeUntilMs, 0, '第一次失败不冻结');
  const t2 = nextThrottle(t1, 'bad_cred', T0 + MIN_RETRY_MS);
  eq(t2.consecutiveFails, 2, '再失败 ⇒ 计数 2');
  const t3 = nextThrottle(t2, 'failed', T0 + 2 * MIN_RETRY_MS);
  eq(t3.consecutiveFails, MAX_FAILS_BEFORE_FREEZE, '第三次失败达到阈值');
  eq(t3.freezeUntilMs, T0 + 2 * MIN_RETRY_MS + FREEZE_MS, '第三次失败 ⇒ 冻结 8 小时');
  const t4 = nextThrottle(t3, 'renewed', T0 + 3 * MIN_RETRY_MS);
  eq(t4.consecutiveFails, 0, '成功后清零失败计数');
  eq(t4.freezeUntilMs, 0, '成功后解冻');
}

// ── 非失败结果不加计数（need_user / skipped 不算撞风控）──
{
  const t1 = { lastAttemptMs: T0, consecutiveFails: 1, freezeUntilMs: 0 };
  eq(nextThrottle(t1, 'need_user', T0 + MIN_RETRY_MS).consecutiveFails, 1, '需用户介入不加失败计数');
  eq(nextThrottle(t1, 'skipped', T0 + MIN_RETRY_MS).consecutiveFails, 1, '跳过不加失败计数');
  eq(nextThrottle(t1, 'no_credential', T0 + MIN_RETRY_MS).consecutiveFails, 1, '无凭据不加失败计数');
}

// ── 纯函数不改入参 ──
{
  const t = { lastAttemptMs: T0, consecutiveFails: 0, freezeUntilMs: 0 };
  nextThrottle(t, 'failed', T0);
  eq(t.consecutiveFails, 0, 'nextThrottle 不改入参');
}

// ── 文案不含敏感值、要点明确 ──
{
  ok(has(messageFor('need_user'), '手动登录'), '需用户介入的文案给出动作');
  ok(has(messageFor('bad_cred'), '重新登录'), '密码失效的文案给出动作');
  const d = decision('failed', 'x');
  eq(d.kind, 'failed', 'decision 保留分类');
}

// ── 编排层源码栅栏：红线接线 ──
{
  const svc = code('../entry/src/main/ets/service/AutoReloginService.ts');
  ok(has(svc, 'AutoLoginCredentialStore.load()'), '编排层读 opt-in 凭据');
  ok(has(svc, 'canAttempt('), '编排层走节流判定');
  ok(has(svc, 'classifyCasStatus('), '编排层用统一分类映射');
  ok(has(svc, 'AutoLoginCredentialStore.clear()'), '密码错清凭据');
  ok(has(svc, 'let inFlight: Promise<RenewDecision> | null = null'), '进程级去重存在');
  ok(!has(svc, 'hilog'), '编排层不打日志原文（只经 BitLog）');
  const store = code('../entry/src/main/ets/data/AutoLoginCredentialStore.ts');
  ok(has(store, 'asset.Tag.ACCESSIBILITY'), '密码落系统密钥库（带可访问性约束）');
  ok(has(store, 'DEVICE_FIRST_UNLOCKED'), '密钥库条目首次解锁后可读');
}

// ── 接线栅栏：只在确认失效后重登，且防递归 ──
{
  const login = code('../entry/src/main/ets/pages/LoginPage.ets');
  ok(has(login, "import { AutoLoginCredentialStore }"), '登录页引入凭据存储');
  ok(has(login, 'Toggle({ type: ToggleType.Checkbox, isOn: this.remember })'), '登录页有 opt-in 勾选');
  ok(has(login, 'reachedLogin && this.remember'), '只有真正登录成功/待短信才存凭据');
  ok(has(login, 'AutoLoginCredentialStore.clear()'), '取消勾选清掉旧凭据');

  const lib = code('../entry/src/main/ets/service/LibBorrowService.ts');
  ok(has(lib, 'allowRenew: boolean = true'), '图书馆取数有防递归开关');
  ok(has(lib, "loginState === false && allowRenew"), '图书馆确认未登录才尝试重登');
  ok(has(lib, "renewed.kind === 'renewed'"), '只有 renewed 才重试');
  ok(has(lib, 'fetch(context, appId, false)'), '重试时关闭 renew，杜绝无限递归');

  const card = code('../entry/src/main/ets/service/CampusCardService.ts');
  ok(has(card, '!snap.loggedIn && allowRenew'), '一卡通确认未登录才重登');
  ok(has(card, 'fetchSnapshot(context, false)'), '一卡通重试时关闭 renew');

  const session = code('../entry/src/main/ets/data/SessionStore.ts');
  const body = session.slice(session.indexOf('static async logoutAll()'));
  ok(has(body, 'AutoLoginCredentialStore.clear()'), '登出清自动续期凭据（不留旧账号密码）');
  ok(has(body, 'RenewThrottleStore.clear()'), '登出清节流状态（换账号不被旧冻结挡住）');
}

console.log('\nALL PASS pass=' + pass + ' fail=0');
