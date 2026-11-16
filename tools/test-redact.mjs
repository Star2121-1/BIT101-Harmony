// 脱敏纯函数守卫（2026-11-16 安全审查）。
//
// 背景：CAS 探针把活 SSO cookie 前 60/80 字符打进 hilog + 屏幕；302 跳转 URL 带
// ticket=ST-... 原样进日志；教务 403 登录页 HTML（含学号）整段落沙箱。三者都是凭据/PII 外泄。
//
// 判据（对着语义写，不是只断非空）：
//  - cookieNames 只返回名字，**任何值都不许出现**；属性名(path/HttpOnly)不算 cookie
//  - stripQuery 必须把 ticket/token 连根去掉，且不许误伤无 query 的 URL
//  - redactPii 抹学号/手机号/敏感 query 值，但保留结构（排查 403 需要原文骨架）
//
//   node --experimental-transform-types tools/test-redact.mjs

import { cookieNames, stripQuery, redactPii } from '../entry/src/main/ets/corelogic/Redact.ts';

let pass = 0;
let fail = 0;
function ok(cond, msg, extra) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.log('FAIL: ' + msg + (extra !== undefined ? '  → ' + extra : ''));
  }
}

// ── 1. cookieNames：只给名字，绝不给值 ────────────────────────────────────
const cookie = 'SESSION=abc123secret; path=/; HttpOnly; JSESSIONID=xyz999; SameSite=Lax';
const names = cookieNames(cookie);
ok(names === 'SESSION,JSESSIONID', '只抽 cookie 名，按序去重', names);
ok(names.indexOf('abc123secret') < 0, 'cookie 值绝不出现', names);
ok(names.indexOf('xyz999') < 0, '第二个 cookie 值也不出现', names);
ok(names.indexOf('path') < 0 && names.indexOf('HttpOnly') < 0 && names.indexOf('SameSite') < 0,
  'cookie 属性名不算 cookie', names);
ok(cookieNames('') === '(none)', '空串给 none', cookieNames(''));
ok(cookieNames('path=/; HttpOnly') === '(none)', '全是属性也给 none', cookieNames('path=/; HttpOnly'));
// 值里带 = 的（base64 token）只取第一段 key
ok(cookieNames('TOKEN=ab==; SESSION=x') === 'TOKEN,SESSION', '值含等号不影响抽名', cookieNames('TOKEN=ab==; SESSION=x'));
// key 含非法字符（空格/引号）不当 cookie 名
ok(cookieNames('bad key=val; GOOD=1') === 'GOOD', '非法 key 被跳过', cookieNames('bad key=val; GOOD=1'));

// ── 2. stripQuery：去 query / fragment ────────────────────────────────────
ok(stripQuery('https://sso.bit.edu.cn/cas/login?ticket=ST-1-abc&x=2') === 'https://sso.bit.edu.cn/cas/login',
  '去掉 ticket 及整个 query', stripQuery('https://sso.bit.edu.cn/cas/login?ticket=ST-1-abc&x=2'));
ok(stripQuery('https://a.com/p#frag') === 'https://a.com/p', '去掉 fragment', stripQuery('https://a.com/p#frag'));
ok(stripQuery('https://a.com/p?q=1#f') === 'https://a.com/p', 'query+fragment 都去', stripQuery('https://a.com/p?q=1#f'));
ok(stripQuery('https://a.com/p') === 'https://a.com/p', '无 query 不误伤', stripQuery('https://a.com/p'));
ok(stripQuery('') === '', '空串安全', stripQuery(''));
ok(stripQuery('?only=query') === '', '纯 query 返回空', stripQuery('?only=query'));

// ── 3. redactPii：抹值保结构 ──────────────────────────────────────────────
const sid = '1120241355';
const red = redactPii('学号 ' + sid + ' 登录失败');
ok(red.indexOf(sid) < 0, '10 位学号被抹', red);
ok(red.indexOf('112****55') >= 0, '学号保前3后2（排查可用）', red);
ok(red.indexOf('登录失败') >= 0, '正文骨架保留', red);
const phone = '13812345678';
const red2 = redactPii('手机 ' + phone);
ok(red2.indexOf(phone) < 0, '11 位手机号被抹', red2);
ok(red2.indexOf('138****5678') >= 0, '手机号保前3后4', red2);
const red3 = redactPii('GET /api/auth/ST-abc?ticket=ST-999&code=XYZ&normal=keep');
ok(red3.indexOf('ST-999') < 0 && red3.indexOf('XYZ') < 0, 'URL 敏感 query 值被抹', red3);
ok(red3.indexOf('normal=keep') >= 0, '非敏感 query 保留', red3);
ok(redactPii('') === '', '空串安全', redactPii(''));
ok(redactPii('无数字 nothing').indexOf('nothing') >= 0, '无 PII 原文不变', redactPii('无数字 nothing'));

console.log('\n' + (fail === 0 ? 'ALL PASS' : 'FAILED') + '  pass=' + pass + ' fail=' + fail);
process.exit(fail === 0 ? 0 : 1);
