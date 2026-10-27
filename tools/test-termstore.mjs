/**
 * 学期偏好的架构栅栏（2026-10-27）。
 *
 * 背景：原版在「设置 → 日历设置」切学期，课表页没有学期选择器。我们把学期搬到设置页时，
 * 建了 `data/TermStore.ts` 作为唯一来源；`SchoolService.getCurrentTerm` 是唯一出口
 * （课表/空教室/考试/自习点四个调用方都走它）。
 *
 * 这几条都是「写错了看起来也正常」的坑，所以固化成可重跑的检查：
 *
 * 1. **单一来源**：除了 TermStore.ts（写）与 SchoolService.ts（读），别处不许出现
 *    `ui_term_override` 字面量 —— 否则各页各读一份，就会出现「四页四个学期」。
 * 2. **单一出口**：getCurrentTerm 的覆盖判断必须排在联网请求**之前**（先问 TermStore，
 *    空才走服务端）。判断排到后面等于没生效，而且不会有任何报错。
 * 3. **UI 条件**：课表页那条学期 chips 行必须带 `isEmbedded` 判定 —— 原版课表页没有
 *    它，只有作为独立路由页时才允许出现；同时设置页必须有切学期入口（否则删了行就没地方切）。
 * 4. **变化即重载**：壳里是 Stack 保活，`aboutToAppear` 不会再跑，课表页必须用
 *    `@StorageLink + @Watch` 接住 AppStorage 里的学期变化。
 *
 * 语料是源码文本（不 import 任何带 @kit 的模块，保持可在 node 下跑）。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ETS = join(ROOT, 'entry/src/main/ets');

let pass = 0;
let fail = 0;
function ok(cond, msg, detail = '') {
  if (cond) {
    pass++;
    console.log('PASS ' + msg);
  } else {
    fail++;
    console.log('FAIL ' + msg + (detail ? '\n  ' + detail : ''));
  }
}

const KEY = 'ui_term_override';
const ALLOWED = ['data/TermStore.ts', 'service/SchoolService.ts'];

// ── 1. 单一来源 ───────────────────────────────────────────────────────────
const offenders = [];
const scanned = [];
function walk(dir, rel) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const r = rel ? rel + '/' + name : name;
    if (statSync(full).isDirectory()) {
      walk(full, r);
    } else if (name.endsWith('.ets') || name.endsWith('.ts')) {
      scanned.push(r);
      const text = readFileSync(full, 'utf8');
      if (text.includes(KEY) && !ALLOWED.includes(r)) {
        offenders.push(r);
      }
    }
  }
}
walk(ETS, '');

ok(scanned.length > 40, '扫到 ' + scanned.length + ' 个 .ets/.ts 文件');
ok(offenders.length === 0,
  '学期偏好只有 TermStore.ts 一个来源（别处不出现 ' + KEY + '）',
  offenders.length ? '违规文件：' + offenders.join(', ') : '');

// ── 2. 单一出口且判断在联网之前 ────────────────────────────────────────────
const school = readFileSync(join(ETS, 'service/SchoolService.ts'), 'utf8');
const fnIdx = school.indexOf('static async getCurrentTerm');
ok(fnIdx > 0, 'SchoolService.getCurrentTerm 存在');
if (fnIdx > 0) {
  const body = school.slice(fnIdx, fnIdx + 1400);
  const overrideIdx = body.indexOf('TermStore.load');
  const networkIdx = body.indexOf('openAppSession');
  ok(overrideIdx > 0 && networkIdx > 0 && overrideIdx < networkIdx,
    'getCurrentTerm 先问 TermStore、再联网（顺序反了等于没生效）',
    'overrideIdx=' + overrideIdx + ' networkIdx=' + networkIdx);
  ok(body.includes('isTermOverride'),
    '空字符串按「跟随教务」处理（走 isTermOverride，不靠 length 手写）');
}

// ── 3. 课表页 chips 行的 UI 条件 ───────────────────────────────────────────
const sched = readFileSync(join(ETS, 'pages/SchedulePage.ets'), 'utf8');
ok(sched.includes('if (!this.isEmbedded && this.terms.length > 1)'),
  '课表页学期 chips 只在独立页渲染（嵌外壳时原版没有这行）');

// ── 4. 设置页必须有切学期入口（删了课表行就得有地方切） ────────────────────
const settings = readFileSync(join(ETS, 'pages/SettingsPage.ets'), 'utf8');
ok(settings.includes("groupTitle('学期')"), '设置页有「学期」分组');
ok(settings.includes('TermStore.set'), '设置页切学期走 TermStore.set（落盘 + 广播）');
ok(settings.includes('@StorageLink(STORAGE_TERM)'), '设置页订阅学期覆盖值（选中态才跟手）');

// ── 5. 课表页必须在学期变化时重载 ─────────────────────────────────────────
ok(/@StorageLink\(STORAGE_TERM\)\s+@Watch\('onTermOverrideChanged'\)/.test(sched),
  '课表页用 @StorageLink + @Watch 接住学期变化（壳里保活，aboutToAppear 不会再跑）');

console.log('\n' + (fail === 0 ? 'ALL PASS' : 'FAILED') + '  pass=' + pass + ' fail=' + fail);
process.exit(fail === 0 ? 0 : 1);
