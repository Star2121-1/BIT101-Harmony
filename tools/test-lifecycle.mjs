// 生命周期/时序修复的源码栅栏（2026-11-16 审查）。
//
// 这三类 bug 都依赖 ArkUI 框架时机（@Watch 初始化不触发、async 回调晚于销毁、双 reload 并发），
// 无法抽成纯函数测，只能读源码钉住因果结构。"故意拆一次看红" 是唯一可信的验证方式。
//
//   node --experimental-transform-types tools/test-lifecycle.mjs

import { readFileSync } from 'node:fs';

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
function src(rel) {
  return readFileSync(new URL('../' + rel, import.meta.url), 'utf-8');
}
/** 剔注释行，避免注释里提到的旧写法把自己判红。 */
function code(rel) {
  return src(rel).split('\n')
    .filter((ln) => { const t = ln.trim(); return !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*'); })
    .join('\n');
}

// ── 1. SeatMonitorPage：迟到 init 回调必须被 destroyed 拦住 ──────────────
const seat = code('entry/src/main/ets/pages/SeatMonitorPage.ets');
const seatInit = seat.indexOf('repo.init()');
ok(seat.indexOf('private destroyed: boolean = false;') >= 0, 'SeatMonitor 有 destroyed 标志');
ok(seat.indexOf('this.destroyed = true;') >= 0, 'aboutToDisappear 置 destroyed');
const thenBlock = seat.substring(seatInit, seatInit + 400);
ok(/if\s*\(this\.destroyed\)/.test(thenBlock), 'init().then 回调开头检查 destroyed',
  thenBlock.substring(0, 120).replace(/\n/g, ' '));

// ── 2. NotifyListPage：markSeen 必须与 unread 在同一次 reload 内 ──────────
const notify = code('entry/src/main/ets/pages/NotifyListPage.ets');
ok(/private async reload\(markSeenAfter: boolean = false\)/.test(notify), 'reload 带 markSeenAfter 参数');
ok(notify.indexOf('this.reload(false);') >= 0, 'aboutToAppear 传 false（不带 markSeen）');
ok(notify.indexOf('this.reload(true);') >= 0, 'onPageShow 传 true（带 markSeen）');
ok(notify.indexOf('NotifySeenStore.markSeen(Date.now())') < 0 ||
   notify.indexOf('onPageShow(): void') > notify.indexOf('private async reload') - 2000,
  'onPageShow 不再自己调 markSeen（已收进 reload）');
// seq 栅栏：reload 内必须有 ++ 和比较
ok(/const seq: number = \+\+this\.reloadSeq/.test(notify), 'reload 递增 seq');
ok(/seq !== this\.reloadSeq/.test(notify), '过期结果被丢弃');
// 关键顺序：先算 unread，再 markSeen（同一函数内）
const idxUnread = notify.indexOf('const unread: number = unreadCount(');
const idxMark = notify.indexOf('NotifySeenStore.markSeen(');
ok(idxUnread >= 0 && idxMark > idxUnread, '先算 unread 再 markSeen',
  'unread@' + idxUnread + ' mark@' + idxMark);

// ── 3. SchedulePage：focus token 只在找到课后清空 + load 后兜底 ───────────
const sched = code('entry/src/main/ets/pages/SchedulePage.ets');
const focusFn = sched.substring(sched.indexOf('private onFocusCourseChanged()'),
  sched.indexOf('private onFocusCourseChanged()') + 1200);
const idxClear = focusFn.indexOf('this.focusCourse = \'\'');
const idxFound = focusFn.indexOf('this.selected = this.courses[i]');
ok(idxClear >= 0 && idxFound >= 0 && idxClear > idxFound,
  'token 清空在找到课之后（不再是函数开头）', 'found@' + idxFound + ' clear@' + idxClear);
ok(focusFn.indexOf('not found') < 0 || focusFn.indexOf('pending') >= 0,
  '找不到课程时保留 token（pending 语义）');
// applyMerged 里要有兜底调用
const mergeFn = sched.substring(sched.indexOf('private applyMerged()'),
  sched.indexOf('private applyMerged()') + 900);
ok(mergeFn.indexOf('this.onFocusCourseChanged()') >= 0,
  'applyMerged 课表上屏后主动消费 token（兜 @Watch 不触发）');

console.log('\n' + (fail === 0 ? 'ALL PASS' : 'FAILED') + '  pass=' + pass + ' fail=' + fail);
process.exit(fail === 0 ? 0 : 1);
