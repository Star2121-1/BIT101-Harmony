/**
 * 页面「文字 / 底色」角色配对对比度栅栏（源码级）
 *
 * 为什么要有：2026-10-27 把 10 个页面从旧 `AppColors` 批量迁到 gridTokens。
 * 这种改动**编译必过、逻辑单测也必过**，唯一会炸的地方是「文字压在同色/太近的底上」，
 * 而当时手机不在手上，没有真机可验 —— 只能把判据机器化。
 *
 * 做法：扫每个组件的**修饰链**（连续以 `.` 开头的行），取出 `fontColor(...)` 与
 * `backgroundColor(...)` 的角色名（支持三元 `x ? A : B`，按分支配对），
 * 再用 gridTokens 在 3 套 palette × 明暗 6 种配置下量实际对比度。
 *
 * 判据（与 test-gridcontrast.mjs 同口径）：
 *   - 正文/标签 ≥ 4.5；textPlaceholder（仅装饰）≥ 3.0
 *
 * 跑法：node --experimental-transform-types tools/test-pairstyle.mjs
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gridTokens, ALL_PALETTES } from '../entry/src/main/ets/core/theme/GridTokens.ts';
import { contrastRatio } from '../entry/src/main/ets/core/theme/AppColors.ts';

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

/** 6 种配置下的实际色值表，按角色名取。 */
const CONFIGS = [];
for (const name of ALL_PALETTES) {
  for (const dark of [false, true]) {
    CONFIGS.push({ tag: name + '/' + (dark ? 'dark' : 'light'), t: gridTokens(dark, name) });
  }
}

/** 某角色在 6 种配置下的最小对比度（与该链的另一角色配对）。 */
function minContrast(fgRole, bgRole) {
  let worst = Infinity;
  let worstTag = '';
  for (const c of CONFIGS) {
    const fg = c.t[fgRole];
    const bg = c.t[bgRole];
    if (fg === undefined || bg === undefined) return { ratio: -1, tag: 'role 不存在' };
    const r = contrastRatio(fg, bg);
    if (r < worst) { worst = r; worstTag = c.tag; }
  }
  return { ratio: worst, tag: worstTag };
}

/** 解析一个颜色参数表达式为分支角色名数组（三元按分支拆）。 */
function rolesOf(expr) {
  const single = /^this\.tk\(\)\.(\w+)$/.exec(expr.trim());
  if (single !== null) return { kind: 'single', roles: [single[1]] };
  const tri = /^(.+?)\?\s*this\.tk\(\)\.(\w+)\s*:\s*(?:this\.tk\(\)\.)?(\w+)\s*$/.exec(expr.trim());
  if (tri !== null) return { kind: 'ternary', roles: [tri[2], tri[3]] };
  return { kind: 'other', roles: [] };
}

/** 从一行里抠出 fontColor(...) / backgroundColor(...) 的完整参数（支持一层括号）。 */
function extractArg(line, name) {
  const key = name + '(';
  const at = line.indexOf(key);
  if (at < 0) return null;
  let depth = 0;
  for (let i = at + key.length - 1; i < line.length; i++) {
    if (line[i] === '(') depth++;
    else if (line[i] === ')') {
      depth--;
      if (depth === 0) return line.slice(at + key.length, i);
    }
  }
  return null;
}

const files = walkEts(ETS_DIR, []);
const problems = [];
let pairCount = 0;

for (const f of files) {
  const rel = f.slice(ROOT.length + 1).replace(/\\/g, '/');
  const lines = readFileSync(f, 'utf8').split('\n');

  // 切「修饰链」：连续非空、且 trim 后以 `.` 开头的行
  let chain = [];
  let chainStart = 0;
  const flush = () => {
    if (chain.length === 0) return;
    let fgExpr = null;
    let bgExpr = null;
    for (const ln of chain) {
      const a = extractArg(ln, 'fontColor');
      if (a !== null) fgExpr = a;
      const b = extractArg(ln, 'backgroundColor');
      if (b !== null) bgExpr = b;
    }
    if (fgExpr !== null && bgExpr !== null) {
      const fg = rolesOf(fgExpr);
      const bg = rolesOf(bgExpr);
      if (fg.roles.length > 0 && bg.roles.length > 0) {
        // 三元对三元：按分支位置配对（true↔true、false↔false），不做交叉积
        const n = Math.max(fg.roles.length, bg.roles.length);
        for (let i = 0; i < n; i++) {
          const fr = fg.roles[Math.min(i, fg.roles.length - 1)];
          const br = bg.roles[Math.min(i, bg.roles.length - 1)];
          pairCount++;
          const need = fr === 'textPlaceholder' ? 3.0 : 4.5;
          const m = minContrast(fr, br);
          if (m.ratio >= 0 && m.ratio < need) {
            problems.push(
              `${rel}:${chainStart}  ${fr} on ${br} = ${m.ratio.toFixed(2)} < ${need}（最差 ${m.tag}）`);
          }
        }
      }
    }
    chain = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t.startsWith('.')) {
      if (chain.length === 0) chainStart = i + 1;
      chain.push(t);
    } else if (t.length === 0) {
      // 空行不打断链（本仓库常在两段修饰之间留空行）
    } else {
      flush();
    }
  }
  flush();
}

ok(pairCount > 0, `扫到 ${pairCount} 对「文字色 / 底色」`);
ok(problems.length === 0, `所有文字/底色配对对比度达标（违规 ${problems.length} 处）`);
if (problems.length > 0) {
  console.log('  违规明细：\n    ' + problems.join('\n    '));
}

console.log('\n' + (failed === 0 ? 'ALL PASS' : 'FAILED') + '  pass=' + passed + ' fail=' + failed);
process.exit(failed === 0 ? 0 : 1);
