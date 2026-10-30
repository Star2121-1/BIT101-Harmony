// UI 约定守卫（源码级，不跑 ArkUI）
//
// 起因：2026-10-27 真机发现「Scroll 内容不足一屏时垂直居中」这个坑在 8 个页面里
// 都**没修好**——包括 DDL、我、空教室、座位这些主页面。原因不是没写 `.align()`，
// 而是写在了 **Scroll 的子 Column 上**。`.align()` 的语义是「组件内容在组件区域内的
// 对齐方式」，Scroll 的内容才是它的子节点，所以必须挂在 Scroll 自身。
//
// 这类 bug 编译不报、单测抓不到，只能靠人眼看真机——所以固化成守卫。
//
//   node --experimental-transform-types tools/test-uiconventions.mjs
//
// 判据（两条都要能被证伪）：
//   1. 不许出现「.align(Alignment.Top) 紧跟 } 再 .layoutWeight(1)」这种写法
//      —— 这正是「挂在内层子节点上」的形状；
//   2. 每个带 .layoutWeight(...) 的 Scroll，其修饰链里必须有 .align(Alignment.Top)
//      —— 有弹性高度的 Scroll 才会出现「内容不足一屏被居中」，静态高度的不会。

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ETS_DIR = join(ROOT, 'entry/src/main/ets');

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

const files = walkEts(ETS_DIR, []);
ok(files.length > 10, `扫到 ${files.length} 个 .ets 文件`);

// ── 规则 1：align 挂在内层子节点上（形状） ───────────────────────────────
// `.align(Alignment.Top)` 下一非空行是 `}`、再下一非空行是 `.layoutWeight(1)`
// ⇒ 说明这条 align 属于「Scroll 的子节点」，而不是 Scroll 自己。
const MISPLACED = /\.align\(Alignment\.Top\)[ \t]*\r?\n[ \t]*\}[ \t]*\r?\n[ \t]*\.layoutWeight\(1/;

// ── 规则 2：带 layoutWeight 的 Scroll 必须有 align(Top) ──────────────────
// 用「缩进相同 + 行首是 `}`」（允许 `}.align(...)` 这种紧凑写法）定位 Scroll 的收尾行，
// 再读它后面的修饰链；链里允许夹注释行（本项目大量在修饰链中间写 ⚠️ 说明）。
function scanScrolls(src) {
  // ⚠️ 必须按 /\r?\n/ 切：本机有 14 个 .ets 是 CRLF 工作副本（提交进库是 LF），
  // 只按 '\n' 切会留下行尾 '\r'，第 56 行的 `\{$` 匹配不上 ⇒ 悄悄漏扫这些文件里的
  // Scroll()（Windows 漏扫、Linux CI 全扫，同一个提交两边结论不一致）。
  const lines = src.split(/\r?\n/);
  const issues = [];
  for (let i = 0; i < lines.length; i++) {
    // `Scroll(this.scroller)` 这种带参形态同样要查（ClassroomPage 就是），
    // 只认 `Scroll()` 会把带滚动控制器的页面整页漏掉。
    const m = /^(\s*)Scroll\([^)]*\)\s*\{$/.exec(lines[i]);
    if (m === null) continue;
    const indent = m[1];
    let close = -1;
    for (let j = i + 1; j < lines.length; j++) {
      const t = lines[j].trimStart();
      if (!t.startsWith('}')) continue;
      // ⚠️ 必须比「前导空白长度」而不是 slice 前缀——深层缩进的行 slice(0,6) 同样是 6 个空格。
      const lead = lines[j].length - t.length;
      if (lead !== indent.length) continue;
      close = j;
      break;
    }
    if (close < 0) {
      issues.push({ line: i + 1, why: '找不到与 Scroll() 同缩进的收尾 `}`' });
      continue;
    }
    const chain = [];
    // 收尾行自身可能就带修饰（`}.align(...).layoutWeight(1)`）
    const tail = lines[close].trim();
    const inlineTail = tail.indexOf('}') >= 0 ? tail.slice(tail.indexOf('}') + 1) : '';
    if (inlineTail.length > 0) chain.push(inlineTail);
    for (let j = close + 1; j < lines.length; j++) {
      const t = lines[j].trim();
      if (t.length === 0) continue;
      if (t.startsWith('//')) continue;
      if (!t.startsWith('.')) break;
      chain.push(t);
    }
    const chainText = chain.join(' ');
    const flexible = chainText.includes('.layoutWeight(');
    if (flexible && !chainText.includes('.align(Alignment.Top)')) {
      issues.push({ line: i + 1, why: '有 layoutWeight 但修饰链里没有 .align(Alignment.Top)' });
    }
  }
  return issues;
}

let scrollTotal = 0;
const violations = [];
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  const rel = f.slice(ROOT.length + 1);

  // 计数也按前缀算，含 `Scroll(this.scroller)` —— 断言里的数字必须和扫描器查到的是同一批。
  const body = src.split(/\r?\n/).filter((l) => l.trim().startsWith('Scroll(')).length;
  scrollTotal += body;

  if (MISPLACED.test(src)) {
    violations.push(`${rel}: .align(Alignment.Top) 挂在内层子节点上（应挂 Scroll 自身）`);
  }
  for (const it of scanScrolls(src)) {
    violations.push(`${rel}:${it.line}: ${it.why}`);
  }
}

ok(scrollTotal > 0, `扫到 ${scrollTotal} 处 Scroll() 声明`);
ok(violations.length === 0,
  `所有 Scroll 的顶对齐都挂在 Scroll 自身（违规 ${violations.length} 处）`);
if (violations.length > 0) {
  console.log('  违规明细：\n    ' + violations.join('\n    '));
}

// ── 规则 3：页面不许再引用旧配色 AppColors ────────────────────────────────
// 2026-10-27 已把全部页面迁到 gridTokens（三套 palette × 明暗可切）。
// 旧 `AppColors` 只剩 `contrastRatio` / `relativeLuminance` 度量函数给测试用；
// 新页面若再 import 它的 palettes，就等于绕过 palette 轴、切皮肤不生效。
const LEGACY = /from\s+['"][^'"]*core\/theme\/AppColors\.ts['"]/;
const legacyUsers = [];
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  const rel = f.slice(ROOT.length + 1);
  // 只允许拿度量函数，且只允许测试/工具性质的调用方（页面目录一律不许）
  if (LEGACY.test(src) && rel.includes('pages/')) {
    legacyUsers.push(rel);
  }
}
ok(legacyUsers.length === 0,
  `页面不再引用旧 AppColors（违规 ${legacyUsers.length} 个）`);
if (legacyUsers.length > 0) {
  console.log('  违规明细：\n    ' + legacyUsers.join('\n    '));
}

console.log('\n' + (failed === 0 ? 'ALL PASS' : 'FAILED') + '  pass=' + passed + ' fail=' + failed);
process.exit(failed === 0 ? 0 : 1);
