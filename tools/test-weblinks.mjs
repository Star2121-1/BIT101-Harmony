// 网页服务入口守卫（M10-3）。
//
// 判据：学校域名判定不能误判（`notbit.edu.cn` / `bit.edu.cn.evil.com` 都不是学校）、
// 清单里的地址**必须都能留在 App 内**（踢系统浏览器 = 未登录）、key 唯一。
//
//   node --experimental-transform-types tools/test-weblinks.mjs

import {
  hostOf, isSchoolHost, shouldStayInApp, entryByKey, WEB_ENTRIES,
} from '../entry/src/main/ets/corelogic/WebEntryLogic.ts';

let pass = 0;
let fail = 0;
function ok(cond, msg, extra) {
  if (cond) {
    pass++;
    console.log('PASS ' + msg);
  } else {
    fail++;
    console.log('FAIL ' + msg + (extra === undefined ? '' : '  → ' + extra));
  }
}

// ── 1. 主机解析 ───────────────────────────────────────────────────────────
ok(hostOf('https://sso.bit.edu.cn/cas/login?service=x') === 'sso.bit.edu.cn', '带路径与查询串');
ok(hostOf('http://a.b.c:8080/x') === 'a.b.c', '去掉端口');
ok(hostOf('https://User:pw@Host.Example.COM/p') === 'host.example.com', '去 userinfo + 小写');
ok(hostOf('no-scheme/path') === '', '没有 scheme → 空串');
ok(hostOf('') === '', '空串 → 空串');

// ── 2. 学校域名判定（防「后缀伪装」）──────────────────────────────────────
ok(isSchoolHost('sso.bit.edu.cn') === true, 'sso.bit.edu.cn 是学校');
ok(isSchoolHost('bit.edu.cn') === true, '裸域名是学校');
ok(isSchoolHost('BIT.EDU.CN') === true, '大小写不影响');
ok(isSchoolHost('notbit.edu.cn') === false, 'notbit.edu.cn **不是**学校');
ok(isSchoolHost('bit.edu.cn.evil.com') === false, 'bit.edu.cn.evil.com 不是学校');
ok(isSchoolHost('bit.edu.com') === false, 'bit.edu.com 不是学校');
ok(isSchoolHost('') === false, '空串不是学校');

// ── 3. 留在 App 内 ────────────────────────────────────────────────────────
ok(shouldStayInApp('https://zxzx.bit.edu.cn/a') === true, '学校域名留 App 内');
ok(shouldStayInApp('https://example.com/') === false, '外站不跳（本版不丢外部浏览器）');
ok(shouldStayInApp('ftp://sso.bit.edu.cn/') === false, '非 http(s) 一律不处理');
ok(shouldStayInApp('') === false, '空串不处理');

// ── 4. 清单本身 ───────────────────────────────────────────────────────────
ok(WEB_ENTRIES.length >= 5, '入口至少 5 个', WEB_ENTRIES.length);
const keys = new Set(WEB_ENTRIES.map((e) => e.key));
ok(keys.size === WEB_ENTRIES.length, 'key 唯一');
const allSchool = WEB_ENTRIES.every((e) => shouldStayInApp(e.url));
ok(allSchool, '清单里每个地址都能留在 App 内（踢出去会变未登录）');
const allLabeled = WEB_ENTRIES.every((e) => e.label.length > 0 && e.note.length > 0);
ok(allLabeled, '每项都有标题与说明');
ok(entryByKey('eclass') !== null, 'entryByKey 命中');
ok(entryByKey('nope') === null, 'entryByKey 未命中 → null');
ok(entryByKey('seat').url.indexOf('seatlib.bit.edu.cn') >= 0, '座位入口指向 seatlib');

console.log('\n' + (fail === 0 ? 'ALL PASS' : 'FAILED') + '  pass=' + pass + ' fail=' + fail);
process.exit(fail === 0 ? 0 : 1);
