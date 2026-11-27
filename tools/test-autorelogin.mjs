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
  MIN_RETRY_MS, MAX_FAILS_BEFORE_FREEZE, FREEZE_MS, IDENTITY_INTERVAL_MS, emptyThrottle,
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
  // F01-01：skipReason 文案改为「约 N 分钟后可再试（或手动登录）」
  ok(has(skipReason(t, true, T0 + 1000), '分钟') && has(skipReason(t, true, T0 + 1000), '手动'),
    '冷却提示告知分钟数与手动登录');
}

// ── 冻结 ──
{
  const t = { lastAttemptMs: T0, consecutiveFails: 3, freezeUntilMs: T0 + FREEZE_MS };
  eq(canAttempt(t, true, T0 + FREEZE_MS - 1), false, '冻结期内不重试');
  eq(canAttempt(t, true, T0 + FREEZE_MS + 1), true, '冻结到期可重试');
  // F01-01：skipReason 统一为「登录冷却中，约 N 分钟后可再试（或手动登录）」
  ok(has(skipReason(t, true, T0), '冷却') && has(skipReason(t, true, T0), '分钟'),
    '冻结提示说清楚冷却时长');
}

// ── 结果分类 ──
{
  eq(classifyCasStatus('ok'), 'renewed', 'ok ⇒ renewed');
  eq(classifyCasStatus('sms_required'), 'need_user', '短信二验 ⇒ 交回用户');
  eq(classifyCasStatus('captcha_required'), 'need_user', '图形验证码 ⇒ 交回用户');
  eq(classifyCasStatus('bad_credentials'), 'bad_cred', '密码错 ⇒ bad_cred');
  eq(classifyCasStatus('error'), 'failed', '其它 ⇒ failed');
}

// ── 节流状态转移（F01-01 新口径：identity 24h×2^(n-1)，详见 test-sessionparity）──
{
  const t0 = emptyThrottle();
  const t1 = nextThrottle(t0, 'failed', T0);
  eq(t1.consecutiveFails, 1, '失败一次 ⇒ 计数 1');
  eq(t1.lastAttemptMs, T0, '记录尝试时间');
  eq(t1.retryAtMs, T0 + IDENTITY_INTERVAL_MS, '第一次失败即 24h 冷却（判据①）');
  const t2 = nextThrottle(t1, 'bad_cred', T0 + IDENTITY_INTERVAL_MS);
  eq(t2.consecutiveFails, 2, '再失败 ⇒ 计数 2');
  eq(t2.retryAtMs, T0 + IDENTITY_INTERVAL_MS + 2 * IDENTITY_INTERVAL_MS, '第二次失败 ⇒ 48h');
  const t3 = nextThrottle(t2, 'failed', T0 + 3 * IDENTITY_INTERVAL_MS);
  eq(t3.consecutiveFails, 3, '第三次失败计数 3');
  eq(t3.retryAtMs, T0 + 3 * IDENTITY_INTERVAL_MS + 4 * IDENTITY_INTERVAL_MS, '第三次失败 ⇒ 96h');
  const t4 = nextThrottle(t3, 'renewed', T0 + 7 * IDENTITY_INTERVAL_MS);
  eq(t4.consecutiveFails, 0, '成功后清零失败计数');
  eq(t4.retryAtMs, 0, 'identity 成功后清冷却');
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
  // F01-02 用户拍板 B（无条件存）：勾选框退化为只读展示，登录成功即存
  ok(has(login, 'Toggle({ type: ToggleType.Checkbox, isOn: true })'), '凭据勾选框为只读展示（无条件存）');
  ok(has(login, 'if (reachedLogin) {'), '登录成功即存凭据（不判断 remember）');
  const sessionStore = code('../entry/src/main/ets/data/SessionStore.ts');
  ok(has(sessionStore, 'AutoLoginCredentialStore.clear()'), '登出仍清除自动续期凭据');

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
