/**
 * M16-1 统一登录：CAS 会话下沉纯逻辑 + 接线栅栏。
 *
 * 锁三件事：
 *  1. 只复制 `sso/login` 域 cookie，绝不把业务子系统 cookie 串罐；
 *  2. 图书馆/一卡通在打业务请求前必须 seed CAS cookie；
 *  3. 短信登录必须先建立教务会话、再快照落盘（否则重启丢 jxzx cookie）。
 */

import { readFileSync } from 'node:fs';
import { isSsoDomain } from '../entry/src/main/ets/core/net/SchoolDomains.ts';
import { ssoSeedCookies, hasSsoSeed } from '../entry/src/main/ets/corelogic/SsoCookieLogic.ts';

let passed = 0;
let failed = 0;
function ok(cond, msg) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.log('FAIL ' + msg);
  }
}
function eq(actual, expected, msg) {
  const same = JSON.stringify(actual) === JSON.stringify(expected);
  if (same) {
    passed++;
  } else {
    failed++;
    console.log('FAIL ' + msg + '\n  expect=' + JSON.stringify(expected) + '\n  actual=' + JSON.stringify(actual));
  }
}
function text(rel) {
  return readFileSync(new URL(rel, import.meta.url), 'utf8').split(/\r?\n/);
}
function has(lines, needle) {
  return lines.some((l) => l.indexOf(needle) >= 0);
}
function idx(lines, needle) {
  return lines.findIndex((l) => l.indexOf(needle) >= 0);
}
function cookie(name, value, domain, path = '/') {
  return { name, value, domain, path };
}

console.log('=== 1. SSO 域判据 ===');
eq(isSsoDomain('sso.bit.edu.cn'), true, 'sso 根');
eq(isSsoDomain('login.bit.edu.cn'), true, 'login 根');
eq(isSsoDomain('.sso.bit.edu.cn'), true, '前导点归一');
eq(isSsoDomain('SSO.BIT.EDU.CN'), true, '大小写不敏感');
eq(isSsoDomain('lib.bit.edu.cn'), false, 'lib 子域不是 CAS');
eq(isSsoDomain('bit.edu.cn'), false, '根域不是 CAS');
eq(isSsoDomain('evil-sso.bit.edu.cn'), false, '伪前缀不匹配');
eq(isSsoDomain(''), false, '空串');

console.log('=== 2. 只下沉 CAS 域 cookie ===');
{
  const all = [
    cookie('SESSION', 'cas', 'sso.bit.edu.cn'),
    cookie('CASTGC', 'tgt', 'login.bit.edu.cn'),
    cookie('JSESSIONID', 'lib', 'lib.bit.edu.cn'),
    cookie('SESSION', 'card', 'dkykt.info.bit.edu.cn'),
    cookie('', 'empty-name', 'sso.bit.edu.cn'),
    cookie('NODOMAIN', 'x', ''),
    cookie('SESSION', 'cas-dup', 'sso.bit.edu.cn'),
  ];
  const seed = ssoSeedCookies(all);
  eq(seed.length, 2, '只留 sso/login 两条，且同名去重');
  eq(seed[0], cookie('SESSION', 'cas', 'sso.bit.edu.cn'), '保留第一条 CAS SESSION');
  eq(seed[1], cookie('CASTGC', 'tgt', 'login.bit.edu.cn'), '保留 login CASTGC');
  ok(!seed.some((c) => c.domain === 'lib.bit.edu.cn'), '图书馆 cookie 不进 CAS 种子');
  ok(!seed.some((c) => c.domain === 'dkykt.info.bit.edu.cn'), '一卡通 cookie 不进 CAS 种子');
}
eq(hasSsoSeed([cookie('SESSION', 'cas', 'sso.bit.edu.cn')]), true, '有 CAS 会话');
eq(hasSsoSeed([cookie('JSESSIONID', 'lib', 'lib.bit.edu.cn')]), false, '只有业务 cookie → 无 CAS');
eq(ssoSeedCookies([]), [], '空列表 → 空种子');

console.log('=== 3. 接线栅栏 ===');
{
  const lib = text('../entry/src/main/ets/service/LibBorrowService.ts');
  ok(has(lib, "import { SsoCookieBroker }"), '图书馆引入 CAS 下沉');
  const seedAt = idx(lib, 'SsoCookieBroker.seed(JAR_LIB)');
  const restoreAt = idx(lib, 'LibCookieStore.restoreInto(repo)');
  ok(seedAt >= 0 && restoreAt > seedAt, '先 seed CAS 再恢复图书馆 cookie');
  ok(has(lib, 'bootstrapFromSso'), '有 CAS 静默引导入口');
  const bootAt = idx(lib, 'bootstrapFromSso(context)');
  const retryAt = lib.findIndex((l, i) => i > bootAt && l.indexOf('who = await RcpFactory.getText') >= 0);
  ok(bootAt >= 0 && retryAt > bootAt, '引导后重判 user-info，不直接当 loggedOut');
}
{
  const card = text('../entry/src/main/ets/service/CampusCardService.ts');
  ok(has(card, "import { SsoCookieBroker }"), '一卡通引入 CAS 下沉');
  const seedAt = idx(card, 'SsoCookieBroker.seed(JAR_CARD)');
  const restoreAt = idx(card, 'CardCookieStore.restoreInto(repo)');
  ok(seedAt >= 0 && restoreAt > seedAt, '先 seed CAS 再恢复一卡通 cookie');
}
{
  const broker = text('../entry/src/main/ets/service/SsoCookieBroker.ts');
  ok(has(broker, 'ssoSeedCookies(all)'), 'broker 必须走纯函数筛选 CAS 域');
  ok(!has(broker, 'jxzxehall') && !has(broker, 'dkykt'), 'broker 不硬编码业务域');
}
{
  const cas = text('../entry/src/main/ets/service/CasLoginService.ts');
  const smsStart = idx(cas, 'static async submitSmsCode');
  const jxAt = cas.findIndex((l, i) => i > smsStart && l.indexOf('ensureJxzxSession(context, p.repoLogin)') >= 0);
  const saveAt = cas.findIndex((l, i) => i > smsStart && l.indexOf('SchoolCookieStore.snapshotAndSave(p.repoLogin)') >= 0);
  ok(smsStart >= 0 && jxAt > smsStart && saveAt > jxAt, '短信登录先建教务会话再落盘');
}

console.log('\nALL PASS pass=' + passed + ' fail=' + failed);
if (failed > 0) {
  process.exit(1);
}
