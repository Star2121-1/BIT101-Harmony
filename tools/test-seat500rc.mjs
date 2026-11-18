/**
 * 座位 500 根因守卫（2026-11-19 只读取证）。
 *
 * 锁两件事（防未来误判）：
 *  1. 真机持久化的 school cookies 域清单里**没有 seatlib.bit.edu.cn**——
 *     所以 silentRenewJwt 靠这些 cookie 打 seatlib /api/cas/user 必然跨域失败。
 *  2. silentRenewJwt 确实从 SchoolCookieStore 读 cookie 后打到 CAS_USER_URL；
 *     若哪天有人改成本地另有 seatlib 会话，这个栅栏会提示复核本报告。
 *
 * fixture 来自真机 bit101_prefs/school_cookies_v1（2026-11-19 00:23 拉取），只记域与名字，不含值。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

let pass = 0;
function ok(cond, label) {
  assert.ok(cond, label);
  pass++;
}

// 真机持久化 cookie 域清单（只有域名 + 名字，无值）
const persisted = [
  ['sso.bit.edu.cn', 'SESSION'],
  ['sso.bit.edu.cn', 'device'],
  ['sso.bit.edu.cn', 'SOURCEID_TGC'],
  ['sso.bit.edu.cn', 'rg_objectid'],
  ['jxzxehall.bit.edu.cn', 'JSESSIONID'],
  ['jxzxehall.bit.edu.cn', 'CASTGC'],
  ['jxzxehallapp.bit.edu.cn', 'route'],
  ['jxzxehallapp.bit.edu.cn', 'GS_SESSIONID'],
  ['jxzxehallapp.bit.edu.cn', '_WEU'],
  ['jxzxehallapp.bit.edu.cn', 'JSESSIONID'],
];
const domains = persisted.map((p) => p[0]);

ok(persisted.length === 10, '真机持久化 10 条 cookie');
ok(domains.indexOf('seatlib.bit.edu.cn') < 0, '关键事实：持久化 cookie 无 seatlib 域');
ok(domains.every((d) => d.indexOf('bit.edu.cn') >= 0), '全部是 bit.edu.cn 域');
ok(domains.filter((d) => d.indexOf('sso.') === 0).length === 4, 'sso 域 4 条');
ok(domains.filter((d) => d.indexOf('jxzxehall') === 0).length === 6, '教务域 6 条');

// 源码栅栏：静默续期仍走 SchoolCookieStore → CAS_USER_URL（域不匹配的调用链）
const svc = readFileSync(
  new URL('../entry/src/main/ets/service/CasLoginService.ts', import.meta.url), 'utf8');
const renewAt = svc.indexOf('static async silentRenewJwt');
ok(renewAt >= 0, 'silentRenewJwt 存在');
const renewBody = svc.slice(renewAt, renewAt + 1400);
ok(renewBody.indexOf('SchoolCookieStore.load()') >= 0, '静默续期从 SchoolCookieStore 读 cookie');
ok(renewBody.indexOf('exchangeJwt(session, \'\')') >= 0, '静默续期打无 ticket 的 cas/user');
ok(renewBody.indexOf('JAR_CAS') >= 0, '静默续期恢复到 JAR_CAS 罐');

// 落盘栅栏：步骤8只 snapshot JAR_LOGIN 的 repo（seatlib cookie 在 JAR_CAS，未被持久化）
const loginBody = svc.slice(0, renewAt);
ok(loginBody.indexOf('cookieRepo(JAR_LOGIN)') >= 0, '登录用 JAR_LOGIN repo');
ok(loginBody.indexOf('SchoolCookieStore.snapshotAndSave(repo)') >= 0, '落盘只抓 JAR_LOGIN repo');

console.log(`ALL PASS pass=${pass} fail=0`);
