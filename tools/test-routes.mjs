// 路由注册守卫：扫全部 .ets 里的 router.pushUrl / router.replaceUrl 目标，
// 对照 main_pages.json。漏注册的页面在真机上点了没反应（pushUrl 抛错），
// 而这种「入口在、点了不动」的 bug 单测不抓就只能靠真机点出来。
//
//   node --experimental-strip-types tools/test-routes.mjs
//
// 判据是「每个被导航的页面都注册了」，不是「注册表非空」——
// 后者抓不到漏注册（正是 M5-3 栽的那个坑）。

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ETS_DIR = join(ROOT, 'entry/src/main/ets');
const PAGES_JSON = join(ROOT, 'entry/src/main/resources/base/profile/main_pages.json');

let passed = 0;
let failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log('PASS ' + msg); }
  else { failed++; console.log('FAIL ' + msg); }
}

function walkEts(dir, out) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walkEts(p, out);
    else if (p.endsWith('.ets')) out.push(p);
  }
  return out;
}

// 1. 注册表本身要读得出来
let registered;
try {
  registered = JSON.parse(readFileSync(PAGES_JSON, 'utf8')).src;
  ok(Array.isArray(registered) && registered.length > 0,
    `main_pages.json 能解析且非空（${Array.isArray(registered) ? registered.length : '?'} 条）`);
} catch (e) {
  ok(false, 'main_pages.json 能解析且非空：' + String(e));
  console.log('\nFAILED  pass=' + passed + ' fail=' + failed);
  process.exit(1);
}

// 2. 收集所有导航目标
const files = walkEts(ETS_DIR, []);
ok(files.length > 10, `扫到 ${files.length} 个 .ets 文件`);

const targets = new Map(); // pageUrl -> 首个引用文件
const NAV = /router\.(?:pushUrl|replaceUrl|back)\(\s*\{[^}]*?url:\s*['"]([^'"]+)['"]/gs;
let navSites = 0;
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  NAV.lastIndex = 0;
  let m;
  while ((m = NAV.exec(src)) !== null) {
    navSites++;
    if (!targets.has(m[1])) targets.set(m[1], f.slice(ROOT.length + 1));
  }
}
ok(navSites > 0, `扫到 ${navSites} 处带 url 的导航调用`);

// 3. 逐个对照：被导航的页面必须注册
//    （back/clearStack 之类不带 url 的调用不在此列——它们没有目标页名）
const registeredSet = new Set(registered);
const missing = [];
for (const [url, where] of targets) {
  const page = url.replace(/^pages\//, '').replace(/\.ets$/, '');
  const isRegistered = registeredSet.has('pages/' + page);
  ok(isRegistered, `导航目标已注册：${url}（${where}）`);
  if (!isRegistered) missing.push(`${url}  ← ${where}`);
}

// 4. 反向：注册表里指向的 .ets 文件必须真的存在
//    （注册了但文件没了 = 运行时才炸）
for (const page of registered) {
  const p = join(ROOT, 'entry/src/main/ets', page + '.ets');
  let exists = false;
  try { statSync(p); exists = true; } catch { /* ignore */ }
  ok(exists, `注册项有对应文件：${page}.ets`);
}

// 5. 首页必须是 Index（ability 的 mainPage 指向它）
ok(registered.includes('pages/Index'), '注册表含 pages/Index');

if (missing.length > 0) {
  console.log('\n漏注册的页面：\n  ' + missing.join('\n  '));
}

console.log('\n' + (failed === 0 ? 'ALL PASS' : 'FAILED') + '  pass=' + passed + ' fail=' + failed);
process.exit(failed === 0 ? 0 : 1);
