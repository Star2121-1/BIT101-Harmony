/**
 * 退出清空单点栅栏（#150）：源码结构断言。
 *
 * 核心不变量：退出登录只有 SessionStore.logoutAll() 一个入口，
 * 它必须覆盖全部会话与跨账号残留；SettingsPage.doLogout 只调这一个方法，
 * 不再逐条调 clear —— 否则将来新增 store 时页面层容易漏加。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

let pass = 0;
function ok(cond, name) {
  assert.ok(cond, name);
  pass++;
}
function code(rel) {
  return readFileSync(new URL(rel, import.meta.url), 'utf8');
}
function has(s, needle) {
  return s.indexOf(needle) >= 0;
}

const session = code('../entry/src/main/ets/data/SessionStore.ts');
const settings = code('../entry/src/main/ets/pages/SettingsPage.ets');

console.log('\n=== 退出清空单点 (#150) ===');

{
  // 单点方法存在
  ok(has(session, 'static async logoutAll()'), 'SessionStore 有唯一退出入口 logoutAll()');
  ok(has(settings, 'await SessionStore.logoutAll()'), '设置页退出调唯一入口');
}

{
  // logoutAll 必须覆盖全部会话 + 跨账号数据（clear() 内部含 SchoolCookieStore）
  const needed = [
    'SessionStore.clear()',     // JWT + 教务（内部含 SchoolCookieStore.clear）
    'EclassCookieStore.clear()',
    'LibCookieStore.clear()',
    'CardCookieStore.clear()',
    'CampusCardStore.clear()',
    'CampusNetTrafficStore.clear()'
  ];
  // 只扫 logoutAll 方法体，避免别处的 clear 干扰
  const body = session.slice(session.indexOf('static async logoutAll()'));
  for (const call of needed) {
    ok(has(body, call), 'logoutAll 覆盖 ' + call);
  }
  ok(has(session, 'SchoolCookieStore.clear()'), 'clear() 内部清教务会话（ School 不重复调）');
  // 课表缓存不在清理清单（产品决定：登出仍可离线看课表）
  ok(!has(body, 'TimeTableStore.clear') && !has(body, 'CourseCache.clear'), 'logoutAll 不清课表缓存');
}

{
  // 页面层不再逐条调各 store 的 clear（收拢前是 7 条散在 doLogout）
  const doLogout = settings.slice(settings.indexOf('private async doLogout()'),
    settings.indexOf('// ── UI 片段'));
  for (const s of ['SchoolCookieStore', 'EclassCookieStore', 'LibCookieStore',
    'CardCookieStore', 'CampusCardStore', 'CampusNetTrafficStore']) {
    ok(!has(doLogout, s + '.clear()'), 'doLogout 不再逐条清 ' + s);
  }
  // 不允许页面直接调 SessionStore.clear()（必须走 logoutAll）
  ok(!has(doLogout, 'SessionStore.clear()'), 'doLogout 不直接调 SessionStore.clear()（走 logoutAll）');
}

{
  // 重新登录前的单子系统清理是另一语义，保留、不被误删（源码栅栏确认仍在）
  const cardLogin = code('../entry/src/main/ets/pages/CardLoginPage.ets');
  const eclassLogin = code('../entry/src/main/ets/pages/EclassLoginPage.ets');
  ok(has(cardLogin, 'CardCookieStore.clear()'), 'CardLoginPage 重新登录前清一卡通会话（独立语义保留）');
  ok(has(eclassLogin, 'EclassCookieStore.clear()'), 'EclassLoginPage 重新登录前清 eclass 会话（独立语义保留）');
}

console.log('\nALL PASS pass=' + pass + ' fail=0');
