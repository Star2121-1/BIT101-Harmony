// 守卫：登录页 step1 遇到「已有有效 CAS 会话 → 302 + ticket」时，
// 不再报「登录页结构异常」，而是复用 302 Location 的 ticket 直接走步骤6换 JWT。
// 根因实证：带设备现存 sso cookie GET cas/login → 302 Location:
//   https://seatlib.bit.edu.cn/api/cas/cas?ticket=ST-76431-...-app-sso-...
//   body=0、无 execution/croypto（用户已登录学校账号，只是座位 JWT 失效）。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const code = (p) => readFileSync(join(root, p), 'utf8');
const service = code('entry/src/main/ets/service/CasLoginService.ts');
const parser = code('entry/src/main/ets/core/crypto/CasParser.ts');

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); pass++; };

console.log('=== 登录页已登录态 302 复用守卫 ===');

// ── 1) extractTicket 纯函数：真实 302 Location 形态 ──
// 直接内联 CasParser 的 extractTicket 实现做断言（Node 不加载 @kit 模块）
function extractTicket(s) {
  const re = /[?&]ticket=([A-Za-z0-9.\-]+)/;
  const m = re.exec(s);
  return m !== null && m.length > 1 ? m[1] : '';
}
eq(extractTicket('https://seatlib.bit.edu.cn/api/cas/cas?ticket=ST-76431-JSM3jMJxNYjGaYjacZwYYXtknMwrg-app-sso-696d845588-p78h4'),
  'ST-76431-JSM3jMJxNYjGaYjacZwYYXtknMwrg-app-sso-696d845588-p78h4',
  '真实 302 Location 的 ticket 能提取');
eq(extractTicket('https://seatlib.bit.edu.cn/api/cas/cas?foo=1&ticket=ABC.123-def'), 'ABC.123-def',
  'ticket 非首位 + 含点/连字符');
eq(extractTicket('https://seatlib.bit.edu.cn/api/cas/cas'), '', '无 ticket 返回空串');
ok(parser.includes('[?&]ticket='), 'CasParser 仍用宽松 ticket 正则（源码栅栏）');

// ── 2) 源码栅栏：step1 已登录态分支存在且语义正确 ──
ok(service.includes("res.headers['location']"), 'step1 读取 302 的 Location');
ok(service.includes('res.status === 302'), 'step1 判 302');
ok(service.includes('extractTicket(loc)'), 'step1 从 Location 提取 ticket');
ok(service.includes('casLocation = loc'), '命中已登录态时记下 casLocation');
ok(service.includes("steps.push('step1 sso_reuse ticket='"), '记录 sso_reuse 诊断步骤');
ok(service.includes('if (casLocation.length === 0) {'), '有 ticket 时跳过步骤2~5 表单登录');
ok(service.includes('followForCasCode(sessionC, location)'), '步骤6 复用 ticket 链换 JWT');

// 关键：解析失败不能再无条件 return（否则有 ticket 也被误杀）
const oldFatal = "if (page.execution.length === 0 || page.croypto.length === 0) {\n      outcome.message = '登录页结构异常";
ok(!service.includes(oldFatal), '解析失败不再无条件报「登录页结构异常」（须先判 casLocation）');
ok(service.includes('casLocation.length === 0 && (page.execution.length === 0'),
  'parse_empty 判定加上 casLocation 前置条件');

// ── 3) 不破坏正常首次登录路径 ──
ok(service.includes("page = parseCasPage(res.status, res.body)"), '正常路径仍解析登录表单');
ok(service.includes("post = await RcpFactory.postForm(session, postUrl"), '正常路径仍 POST 表单');

console.log(`ALL PASS ${pass} assertions`);
