/**
 * 社区鉴权纯逻辑单测 + 源码栅栏。
 *
 * 判据：
 * - 401 只静默刷新一次（canRefresh 的 attempts 闸门）；
 * - 没存凭据不自动刷新；
 * - 假凭据（500 +「用户名或密码错误」）归 bad_cred，不当网络故障；
 * - 票据存取源码栅栏：票据不进日志、密码走 md5、明文本身不落盘。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  canRefresh, classifyLogin, decision, messageFor
} from '../entry/src/main/ets/corelogic/CommunityAuthLogic.ts';

let pass = 0;
function ok(cond, name) { assert.ok(cond, name); pass++; }
function eq(a, b, name) { assert.equal(a, b, name); pass++; }
function code(rel) { return readFileSync(new URL(rel, import.meta.url), 'utf8'); }
function has(s, n) { return s.indexOf(n) >= 0; }

console.log('\n=== 社区鉴权（fake-cookie）===');

// ── 401 只刷一次 ──
{
  eq(canRefresh(true, 0), true, '首次 401 允许刷新');
  eq(canRefresh(true, 1), false, '第二次 401 不再刷新（防循环）');
  eq(canRefresh(false, 0), false, '没存凭据不自动刷新');
  eq(canRefresh(false, 1), false, '没凭据+已试过当然不刷');
}

// ── 分类映射（真机探测过的行为）──
{
  eq(classifyLogin('', 200), 'ok', '2xx 视为成功');
  eq(classifyLogin('用户名或密码错误Orz', 500), 'bad_cred', '假凭据 500 → bad_cred（真机探测）');
  eq(classifyLogin('密码错误', 400), 'bad_cred', '密码错文案 → bad_cred');
  eq(classifyLogin('需要验证码', 400), 'need_user', '验证码 → 需用户介入');
  eq(classifyLogin('服务暂时不可用', 503), 'failed', '5xx 非凭据 → failed');
  eq(classifyLogin('请先登录awa', 401), 'failed', '401 本身不当登录失败（由刷新流程处理）');
}

// ── 文案 ──
{
  ok(has(messageFor('no_cred'), '登录'), '无凭据文案给动作');
  ok(has(messageFor('bad_cred'), '重新登录'), '凭据失效文案给动作');
  eq(decision('ok', 'x').kind, 'ok', 'decision 保留分类');
}

// ── 服务层源码栅栏：红线 ──
{
  const svc = code('../entry/src/main/ets/service/CommunityAuthService.ts');
  ok(has(svc, 'CasCrypto.md5Hex(password)'), '密码 md5 后才 POST（不发明文）');
  ok(has(svc, "h['fake-cookie'] = fakeCookie"), '票据走 fake-cookie 头');
  ok(has(svc, 'AutoLoginCredentialStore.load()'), '静默刷新读已 opt-in 凭据');
  ok(has(svc, 'res.status === 401'), '401 才触发刷新');
  ok(has(svc, 'attempts + 1'), '刷新计数递增（只一次）');
  ok(!has(svc, 'hilog'), '不打裸日志（只经 BitLog）');
  const store = code('../entry/src/main/ets/data/FakeCookieStore.ts');
  ok(has(store, "info('FakeCookieStore saved len='"), '票据只记长度不记内容');
}

console.log('\nALL PASS pass=' + pass + ' fail=0');
