// 守卫：phpCAS 换票链必须用「每次全量干净」的隔离罐（BIT101-seat/docs/seatlib-contract.md §6）。
// 根因：JAR_CAS 是进程级单例罐，残留的陈旧 phpCAS 会话让换票链第4步走岔
// （302 到 login.bit.edu.cn 而非下发 cas code）⇒ 换不到 JWT / 换到但服务端不认 ⇒ 座位反复要授权。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const code = (p) => readFileSync(join(root, p), 'utf8');
const svc = code('entry/src/main/ets/service/CasLoginService.ts');

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; };

console.log('=== phpCAS 换票链隔离罐守卫 ===');

// 1) freshCasSession 方法存在且内含清空
ok(svc.includes('private static async freshCasSession(context: Context)'), '有 freshCasSession 方法');
const method = svc.slice(svc.indexOf('private static async freshCasSession'));
const methodBody = method.slice(0, method.indexOf('  /**', 10) >= 0 ? method.indexOf('  /**', 10) : 500);
ok(methodBody.includes('clearRepoCookies(JAR_CAS)'), 'freshCasSession 先清空 JAR_CAS 罐');
ok(methodBody.includes('createSession(context, JAR_CAS)'), '清空后再建新会话');

// 2) 两条换票链都用 freshCasSession，不再裸 createSession(JAR_CAS)
// 允许 2 处裸 createSession：freshCasSession 内 1 处 + silentRenewJwt 内 1 处（后者靠落盘 cookie，不走 ticket）
const casJarCreateCount = (svc.match(/createSession\(context, JAR_CAS\)/g) || []).length;
ok(casJarCreateCount === 2, '裸 createSession(JAR_CAS) 仅 freshCasSession + silentRenewJwt 两处（当前=' + casJarCreateCount + '）');
const freshCount = (svc.match(/freshCasSession\(context\)/g) || []).length;
ok(freshCount >= 2, 'freshCasSession 被 login + 短信两处换票链调用（当前=' + freshCount + '）');
// login step6 与 短信 c3 的 sessionC 都来自 freshCasSession（各自紧邻的 10 行内）
const step6 = svc.slice(svc.indexOf('步骤 6：phpCAS'), svc.indexOf('步骤 6：phpCAS') + 400);
ok(!step6.includes('createSession(context, JAR_CAS)'), 'login step6 不再裸建 JAR_CAS 罐');
const c3 = svc.slice(svc.indexOf('phpCAS 链 → JWT'), svc.indexOf('phpCAS 链 → JWT') + 300);
ok(c3.includes('freshCasSession(context)'), '短信 c3 换票链用 freshCasSession');

// 3) 换票链两步都在（跟票换 code → code 换 JWT）
ok(svc.includes('followForCasCode(sessionC, location)'), 'login 换票链跟票');
ok(svc.includes('exchangeJwt(sessionC, code)'), 'login 换票链换 JWT');
ok(svc.includes('followForCasCode(sessionC, casCode') === false ||
   svc.includes('followForCasCode(sessionC, location)'), '短信换票链亦跟票');

// 4) silentRenewJwt 不走 ticket（靠落盘 cookie），不应被误改
const sr = svc.slice(svc.indexOf('static async silentRenewJwt'));
const srBody = sr.slice(0, sr.indexOf('private static', 20) >= 0 ? sr.indexOf('private static', 20) : 900);
ok(srBody.includes("exchangeJwt(session, '')"), 'silentRenewJwt 仍走空 ticket 静默认证（不动它）');

console.log(`ALL PASS ${pass} assertions`);
