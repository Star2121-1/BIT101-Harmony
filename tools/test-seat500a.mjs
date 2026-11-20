/**
 * 座位 500 方案 A′ 守卫单测。判据（可证伪）：
 * - isSeatlibDomain 只认 seatlib 主域/真子域，不认 sso/伪前缀（不串罐第一关）；
 * - filterSeatlibCookies 只留 seatlib 域，原记录逐字段不变，幂等，path 空回落 '/'；
 * - 源码栅栏：不动 school_cookies_v1 的 snapshotAndSave 原行（test-sso/test-seat500rc 继续成立）；
 * - 独立 key 落盘 + 登出清空 + silentRenewJwt 恢复 seatlib cookie 都有接线（非假实现）。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  isSeatlibDomain, filterSeatlibCookies
} from '../entry/src/main/ets/corelogic/SeatCookieLogic.ts';

let pass = 0;
function ok(cond, name) { assert.ok(cond, name); pass++; }
function eq(a, b, name) { assert.equal(a, b, name); pass++; }
function code(rel) { return readFileSync(new URL(rel, import.meta.url), 'utf8'); }

console.log('\n=== 座位 500 方案 A′ ===');

// 域判定：只认 seatlib
eq(isSeatlibDomain('seatlib.bit.edu.cn'), true, '主域命中');
eq(isSeatlibDomain('.seatlib.bit.edu.cn'), true, '前导点命中');
eq(isSeatlibDomain('sub.seatlib.bit.edu.cn'), true, '真子域命中');
eq(isSeatlibDomain('SEATLIB.BIT.EDU.CN'), true, '大小写归一');
eq(isSeatlibDomain('  seatlib.bit.edu.cn  '), true, '空白归一');
eq(isSeatlibDomain('sso.bit.edu.cn'), false, 'sso 域不算（不串罐）');
eq(isSeatlibDomain('jxzxehall.bit.edu.cn'), false, '教务域不算');
eq(isSeatlibDomain('evil-seatlib.bit.edu.cn'), false, '伪前缀不算');
eq(isSeatlibDomain('seatlib.bit.edu.cn.evil.com'), false, '尾部伪域不算');
eq(isSeatlibDomain('bit.edu.cn'), false, '根域不算');
eq(isSeatlibDomain(''), false, '空串不算');
eq(isSeatlibDomain(null), false, 'null 不算');
eq(isSeatlibDomain(undefined), false, 'undefined 不算');

// 筛 cookie：真机根因 10 条 fixture + 2 条 seatlib
const all = [
  { name: 'sso1', value: 'v1', domain: 'sso.bit.edu.cn', path: '/' },
  { name: 'jx1', value: 'v2', domain: 'jxzxehall.bit.edu.cn', path: '/a' },
  { name: 'CAS-1', value: 'seatA', domain: 'seatlib.bit.edu.cn', path: '' },
  { name: 'CAS-2', value: 'seatB', domain: '.seatlib.bit.edu.cn', path: '/api' },
  { name: 'evil', value: 'x', domain: 'evil-seatlib.bit.edu.cn', path: '/' }
];
const seat = filterSeatlibCookies(all);
eq(seat.length, 2, '只留 2 条 seatlib');
eq(seat[0].name, 'CAS-1', '第一条 name');
eq(seat[0].value, 'seatA', 'value 原样');
eq(seat[0].domain, 'seatlib.bit.edu.cn', 'domain 原样不改');
eq(seat[0].path, '/', 'path 空回落 /');
eq(seat[1].domain, '.seatlib.bit.edu.cn', '带点 domain 原样保留');
eq(seat[1].path, '/api', '非空 path 原样');

// 幂等 + 脏条目
const again = filterSeatlibCookies(all.concat(seat));
eq(again.length, 2, '重复输入幂等（按 name@domain 去重）');
const none = filterSeatlibCookies([{ name: 'x', value: '', domain: 'sso.bit.edu.cn', path: '/' }]);
eq(none.length, 0, '无 seatlib 域返回空');
const dirty = filterSeatlibCookies([
  { name: '', value: 'v', domain: 'seatlib.bit.edu.cn', path: '/' },
  { name: 'ok', value: 'v', domain: '', path: '/' }
]);
eq(dirty.length, 0, 'name/domain 空跳过');

// 源码栅栏
const login = code('../entry/src/main/ets/service/CasLoginService.ts');
ok(login.indexOf('SchoolCookieStore.snapshotAndSave(repo)') >= 0,
  '密码路径原落盘行保留（test-seat500rc 栅栏）');
ok(login.indexOf('SchoolCookieStore.snapshotAndSave(p.repoLogin)') >= 0,
  '短信路径原落盘行保留（test-sso 栅栏）');
ok(login.indexOf('SeatCookieStore.appendFromCas') >= 0, '登录成功后追加 seatlib 落盘');
ok(login.indexOf('RcpFactory.restoreCookies(repo, seatCookies)') >= 0,
  '静默续期恢复 seatlib cookie');

const store = code('../entry/src/main/ets/data/SeatCookieStore.ts');
ok(store.indexOf("'seatlib_cookies_v1'") >= 0, '独立 key（不并入 school_cookies_v1）');
ok(store.indexOf('filterSeatlibCookies') >= 0, '落盘走纯逻辑筛选');

const session = code('../entry/src/main/ets/data/SessionStore.ts');
ok(session.indexOf('SeatCookieStore.clear()') >= 0, '登出清空 seatlib cookie（换账号不残留）');

const rootcause = code('../entry/src/main/ets/data/SchoolCookieStore.ts');
ok(rootcause.indexOf("'school_cookies_v1'") >= 0, 'school cookie key 未改（守卫事实继续成立）');

console.log('ALL PASS  pass=' + pass);
