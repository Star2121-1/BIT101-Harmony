/**
 * CAS 解析层回归测试（可重跑 fixture）。
 *
 * 为什么这几条要单独成文件：解析判据一旦漂移，表现全是「这条路走不通」
 * （真机 302 变成了 parse_empty），先在这里红掉比在真机上白查一轮便宜得多。
 *
 * 跑法（Node 22+，靠 --experimental-strip-types 直接吃 .ts，不需要 tsc）：
 *   node --experimental-strip-types tools/test-parser.mjs
 *
 * fixture：`tools/fixtures/cas/login-page.html`（**随仓库走**）
 * —— 2026-10-20 从 sso.bit.edu.cn 抓下的**服务端原始页面**（不跑 JS）。
 * 期望值来自同一轮真机 hilog（execution=12465 / croypto 16 字节 / USTC / sso / sourceId）。
 *
 * ⚠️ 2026-10-20 栽过：fixture 原先指向仓库外的 `../../evidence/...`，
 * 在原工作区能跑、`git clone` 出来就必然红（仓库外没有那个文件）。
 * 那不是「可重跑」，是「在这台机器上碰巧能跑」。fixture 必须入库。
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const parserPath = join(here, '..', 'entry', 'src', 'main', 'ets', 'core', 'crypto', 'CasParser.ts');
const fixturePath = join(here, 'fixtures', 'cas', 'login-page.html');

// fixture 缺失要**明确红**，不能静默跳过 —— 否则「测试通过」会变成一句空话
if (!existsSync(fixturePath)) {
  console.error('FIXTURE MISSING: ' + fixturePath);
  console.error('fixture 必须随仓库提交（tools/fixtures/cas/login-page.html），否则本测试不可重跑。');
  process.exit(1);
}

const P = await import('file://' + parserPath.replace(/\\/g, '/'));

let failed = 0;
function eq(actual, expected, msg) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log((ok ? 'PASS ' : 'FAIL ') + msg + ' => ' + JSON.stringify(actual) +
    (ok ? '' : '  (expected ' + JSON.stringify(expected) + ')'));
  if (!ok) failed++;
}
function ok(cond, msg) {
  console.log((cond ? 'PASS ' : 'FAIL ') + msg);
  if (!cond) failed++;
}

// ── 1. 真机原始登录页：六锚点 ──
const html = readFileSync(fixturePath, 'utf8');
const page = P.parseCasPage(200, html);
console.log('--- fixture: tools/fixtures/cas/login-page.html, len=' + html.length + ' ---');
eq(page.status, 200, 'status');
eq(page.execution.length, 12465, 'execution 长度（对齐 M1 真机 hilog）');
ok(page.execution.length > 1000, 'execution 不是空/半截');
const croyptoBytes = Buffer.from(page.croypto, 'base64');
eq(croyptoBytes.length, 16, 'croypto 实际解码字节数');
eq(page.riskSystem, 'USTC', 'riskSystemSwitch');
eq(page.targetSystem, 'sso', 'targetSystem');
eq(page.siteId, 'sourceId', 'siteId');
// ⚠️ 真机抓包事实：服务端原始页面的 form 是 `<form method="post">` —— **没有 action**。
// 所以 formAction 为空是**正常态**，调用方必须回退到 CAS_LOGIN_URL（CasLoginService 里那条
// `page.formAction.length > 0 ? page.formAction : CAS_LOGIN_URL` 不是防御性代码，是必需品）。
eq(page.formAction, '', '真机页面 form 无 action（空串是正常态）');
ok(html.indexOf('<form method="post">') >= 0, '原始 HTML 里确实是 <form method="post">');
eq(P.extractFormAction('<form action="/cas/login" method="post">'), '/cas/login', '有 action 时能取到');
eq(P.extractFormAction('<form method="post">'), '', '无 action 时返回空串');

// ── 2. 普通登录页不能被判成短信二次验证页（判据特异性）──
eq(P.isSmsSecondFactor(html), false, '普通登录页 isSmsSecondFactor=false');
eq(html.indexOf('smsLoginForm'), -1, '原始 HTML 里 smsLoginForm 出现 0 次');

// ── 3. ticket / cas code 提取 ──
eq(P.extractTicket('https://seatlib.bit.edu.cn/api/cas/cas?ticket=ST-123456-abc'), 'ST-123456-abc', 'ticket 从 query');
eq(P.extractTicket('x?service=y&ticket=ST-1-2#/h5'), 'ST-1-2', 'ticket 带 hash');
eq(P.extractTicket('no ticket here'), '', 'ticket 缺失返回空串');
eq(P.extractCasCode('https://seatlib.bit.edu.cn/h5/#/login?cas=abc123.def'), 'abc123.def', 'cas code 从 hash 路由');
eq(P.extractCasCode('https://seatlib.bit.edu.cn/api/cas/cas?cas=Zz9'), 'Zz9', 'cas code 从 query');
eq(P.extractCasCode('https://x/y'), '', 'cas code 缺失返回空串');

// ── 4. 相对 URL 解析（ArkTS 无全局 URL，手工实现必须逐条验）──
eq(P.resolveUrl('https://a.bit.edu.cn/x/y', '/z'), 'https://a.bit.edu.cn/z', '绝对路径');
eq(P.resolveUrl('https://a.bit.edu.cn/x/y', 'z'), 'https://a.bit.edu.cn/x/z', '相对路径');
eq(P.resolveUrl('https://a.bit.edu.cn/x/y?q=1', '//b.bit.edu.cn/c'), 'https://b.bit.edu.cn/c', '协议相对');
eq(P.resolveUrl('https://a.bit.edu.cn/x/y', 'https://c.bit.edu.cn/d'), 'https://c.bit.edu.cn/d', '已是绝对 URL');

// ── 5. 二验页解析：正例 + 反例（反例先证伪，防"任何页都判成二验"）──
eq(P.parseSecondFactorPage(html, 'https://sso.bit.edu.cn/cas/login'), null, '普通页不算二验页');
const sfHtml = '<p id="login-page-flowkey">EXEC-1</p><p id="user-object-id">U-9</p>' +
  '<p id="phone-number">13800001111</p><form action="login"><div class="secondSmsLoginForm"></div></form>';
const sf = P.parseSecondFactorPage(sfHtml, 'https://sso.bit.edu.cn/cas/login');
ok(sf !== null, '二验页解析非空');
if (sf !== null) {
  eq(sf.execution, 'EXEC-1', 'sf.execution');
  eq(sf.userObjectId, 'U-9', 'sf.userObjectId');
  eq(sf.phone, '13800001111', 'sf.phone');
  eq(sf.formAction, 'https://sso.bit.edu.cn/cas/login', 'sf.formAction（相对 action 解析）');
}

// ── 6. 错误文案提取 ──
eq(P.extractLoginError('<div id="login-error">用户名或密码错误</div>'), '用户名或密码错误', 'login-error 提取');
eq(P.extractLoginError('<html>nothing</html>'), '', '无错误时返回空串');

console.log(failed === 0 ? '\nALL PASS' : '\nFAILED: ' + failed);
process.exit(failed === 0 ? 0 : 1);
