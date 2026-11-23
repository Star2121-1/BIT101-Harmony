/**
 * 座位授权门禁守卫单测（对齐 BIT101-S docs/seatlib-contract.md §1 + SeatAuthGate.kt）。
 *
 * 权威契约（实测）：带失效 token 打 /api/Seat/seat → HTTP 500 + 空 body；不带 token → 200。
 * 认证失败不是 401（200+code 10001）⇒ 按 401 判失效永远不触发。
 * 鸿蒙必须：①把 500 识别为会话失效；②给「授权座位系统」入口；
 * ③授权只在用户点击时走，自动路径绝不走（学校风控短信无人输入红线）。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

let pass = 0;
function ok(cond, name) { assert.ok(cond, name); pass++; }
function code(rel) { return readFileSync(new URL(rel, import.meta.url), 'utf8'); }

console.log('\n=== 座位授权门禁（对齐 seatlib-contract §1）===');

const page = code('../entry/src/main/ets/pages/SeatPage.ets');

// ① 500 识别为会话失效
ok(page.indexOf("indexOf('HTTP 500') >= 0") >= 0, 'HTTP 500 被识别为会话失效');
ok(page.indexOf('seatAuthExpired = true') >= 0 || page.indexOf('this.seatAuthExpired = (res.message') >= 0,
  '500 时置门禁状态');
ok(page.indexOf('座位系统授权已失效') >= 0, '500 文案明确为授权失效（不再是"响应解析失败"糊弄）');

// ② 门禁 UI + 授权按钮（对齐 SeatAuthGate 文案）
ok(page.indexOf('学校账号已登录，但座位系统尚未授权') >= 0,
  '门禁文案对齐 Android SeatAuthGate');
ok(page.indexOf("Button('授权座位系统')") >= 0, '有「授权座位系统」按钮');
ok(page.indexOf('正在恢复座位系统授权…') >= 0, '授权中有进行态反馈（防用户以为按钮失灵）');

// ③ 红线：授权只由用户点击触发；自动路径只做只读 cookie 续期
const authorizeBody = page.substring(page.indexOf('private async authorizeSeat'),
  page.indexOf('private async loadSeats'));
ok(authorizeBody.indexOf('onClick') < 0, '授权方法体内无 onClick（由按钮 onClick 调用，职责清晰）');
// 不锁死缩进（阶段2表单门禁与阶段3座位图门禁缩进不同），只校验授权入口由点击触发
ok(/onClick\(\(\) => \{\s*this\.authorizeSeat\(\);/.test(page),
  '授权按钮 onClick 调 authorizeSeat（用户点击触发）');
ok(page.indexOf('CasLoginService.silentRenewJwt(ctx)') >= 0, '授权先试只读 cookie 续期（不发短信）');
ok(page.indexOf("router.pushUrl({ url: 'pages/LoginPage'") >= 0,
  'cookie 续期失败跳登录页由本人重登（不自动走凭据；alpha.36 带 from=seat 来源参数兼容）');
ok(page.indexOf("params: { from: 'seat' }") >= 0,
  '跳登录页带来源标记，成功回座位页闭环（破循环）');
// 自动续期路径（loadSeats）只调 silentRenewJwt，绝不调 authorizeSeat
const loadBody = page.substring(page.indexOf('private async loadSeats'),
  page.indexOf('private async loadSeats') + 2500);
ok(loadBody.indexOf('authorizeSeat') < 0, '自动续期路径不调授权方法（避开短信红线）');
ok(loadBody.indexOf('CasLoginService.silentRenewJwt(ctx)') >= 0,
  '自动路径只做只读 cookie 续期');

console.log('ALL PASS  pass=' + pass);
