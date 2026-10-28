// 周次导航守卫（M12-1）。
//
// 判据：滑动/按钮三处入口共用一份落点算法；越界不动且 moved=false；
// 脏值（NaN / 0 / 负数 / 小数）不抛错、钳回合法区间；文案不出现「/ 0」。
//
//   node --experimental-transform-types tools/test-weeknav.mjs

import {
  clampWeek, shiftWeek, swipeWeek, weekLabel, weekA11y, swipeDirFromAngle,
} from '../entry/src/main/ets/corelogic/WeekNav.ts';

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

// ── 1. clampWeek：合法值原样返回 ─────────────────────────────────────────
ok(clampWeek(3, 16) === 3, '中间周原样');
ok(clampWeek(1, 16) === 1, '第一周原样');
ok(clampWeek(16, 16) === 16, '最后一周原样');

// ── 2. clampWeek：脏值不抛错、钳回区间 ───────────────────────────────────
ok(clampWeek(0, 16) === 1, '第 0 周 → 1');
ok(clampWeek(-5, 16) === 1, '负数 → 1');
ok(clampWeek(99, 16) === 16, '超出 → max');
ok(clampWeek(NaN, 16) === 1, 'NaN → 1');
ok(clampWeek(3.7, 16) === 3, '小数向下取整');
ok(clampWeek(3, NaN) === 1, 'max 为 NaN → 视为只有 1 周');
ok(clampWeek(3, 0) === 1, 'max 为 0 → 视为只有 1 周');
ok(clampWeek(3, -2) === 1, 'max 为负 → 视为只有 1 周');

// ── 3. shiftWeek：正常步进 ──────────────────────────────────────────────
let m = shiftWeek(3, 1, 16);
ok(m.week === 4 && m.moved === true, '下一周', JSON.stringify(m));
m = shiftWeek(3, -1, 16);
ok(m.week === 2 && m.moved === true, '上一周', JSON.stringify(m));
m = shiftWeek(3, 5, 16);
ok(m.week === 8 && m.moved === true, '一次跳 5 周', JSON.stringify(m));

// ── 4. shiftWeek：撞边界不动，且 moved=false（调用方不该给反馈） ──────────
m = shiftWeek(1, -1, 16);
ok(m.week === 1 && m.moved === false, '第 1 周往前不越界', JSON.stringify(m));
m = shiftWeek(16, 1, 16);
ok(m.week === 16 && m.moved === false, '最后一周往后不越界', JSON.stringify(m));
m = shiftWeek(16, 99, 16);
ok(m.week === 16 && m.moved === false, '大步长也钳在 max', JSON.stringify(m));

// ── 5. shiftWeek：delta 为 0 / NaN 不动 ─────────────────────────────────
m = shiftWeek(7, 0, 16);
ok(m.week === 7 && m.moved === false, 'delta 0 不动', JSON.stringify(m));
m = shiftWeek(7, NaN, 16);
ok(m.week === 7 && m.moved === false, 'delta NaN 不动', JSON.stringify(m));

// ── 6. swipeWeek：手往左（dir=-1）= 时间往后 ─────────────────────────────
m = swipeWeek(3, -1, 16);
ok(m.week === 4 && m.moved === true, '左滑 → 下一周', JSON.stringify(m));
m = swipeWeek(3, 1, 16);
ok(m.week === 2 && m.moved === true, '右滑 → 上一周', JSON.stringify(m));
m = swipeWeek(1, 1, 16);
ok(m.week === 1 && m.moved === false, '第 1 周右滑不动', JSON.stringify(m));
m = swipeWeek(16, -1, 16);
ok(m.week === 16 && m.moved === false, '最后一周左滑不动', JSON.stringify(m));
m = swipeWeek(5, 0, 16);
ok(m.week === 5 && m.moved === false, 'dir 0 不动', JSON.stringify(m));

// ── 7. 只有一周的学期：任何方向都不动 ────────────────────────────────────
ok(swipeWeek(1, -1, 1).moved === false, '单周学期左滑不动');
ok(swipeWeek(1, 1, 1).moved === false, '单周学期右滑不动');
ok(shiftWeek(1, 1, 1).moved === false, '单周学期步进不动');

// ── 8. 文案 ─────────────────────────────────────────────────────────────
ok(weekLabel(3, 16) === '第 3 / 16 周', '周次标签', weekLabel(3, 16));
// 总周数未知时既不能写「/ 0」，也不能把第 3 周说成第 1 周（那是假信息）
ok(weekLabel(3, 0) === '第 3 周', 'max 非法：只报当前周，不钳成 1', weekLabel(3, 0));
ok(weekLabel(3, NaN) === '第 3 周', 'max 为 NaN 同上', weekLabel(3, NaN));
ok(weekLabel(99, 16) === '第 16 / 16 周', '越界值先钳再显示', weekLabel(99, 16));

ok(weekA11y(3, 16).indexOf('左滑看下一周') >= 0, '无障碍讲到左滑');
ok(weekA11y(3, 16).indexOf('右滑看上一周') >= 0, '无障碍讲到右滑');
ok(weekA11y(1, 16).indexOf('已是最前一周') >= 0, '第一周如实说边界');
ok(weekA11y(16, 16).indexOf('已是最后一周') >= 0, '最后一周如实说边界');
ok(weekA11y(1, 1) === '第 1 周，共 1 周', '单周学期不瞎讲滑动', weekA11y(1, 1));

// ── 9. 总周数未知时不能自相矛盾（不能写「共 0 周」，也不能瞎谈边界） ────
ok(weekA11y(1, 0) === '第 1 周', 'max 非法：只说当前周', weekA11y(1, 0));
ok(weekA11y(5, 0) === '第 5 周', 'max 非法：不把第 5 周钳成第 1 周', weekA11y(5, 0));
ok(weekA11y(3, 0).indexOf('共') < 0, 'max 非法：不讲总周数', weekA11y(3, 0));
ok(weekA11y(3, 0).indexOf('滑') < 0, 'max 非法：不讲滑动（说了也没有下一周）', weekA11y(3, 0));

// ── 10. 手势角度 → 方向（竖着划/斜着划绝不能误切周） ────────────────────
ok(swipeDirFromAngle(0) === 1, '0°(向右) → 上一周', String(swipeDirFromAngle(0)));
ok(swipeDirFromAngle(180) === -1, '180°(向左) → 下一周', String(swipeDirFromAngle(180)));
ok(swipeDirFromAngle(360) === 1, '360° 等价 0°', String(swipeDirFromAngle(360)));
ok(swipeDirFromAngle(-180) === -1, '负角度归一', String(swipeDirFromAngle(-180)));
ok(swipeDirFromAngle(90) === 0, '90°(向下) → 不切周（留给上下滚动）', String(swipeDirFromAngle(90)));
ok(swipeDirFromAngle(270) === 0, '270°(向上) → 不切周', String(swipeDirFromAngle(270)));
ok(swipeDirFromAngle(60) === 0, '60° 斜划不切周', String(swipeDirFromAngle(60)));
ok(swipeDirFromAngle(120) === 0, '120° 斜划不切周', String(swipeDirFromAngle(120)));
ok(swipeDirFromAngle(30) === 1, '30° 仍算水平', String(swipeDirFromAngle(30)));
ok(swipeDirFromAngle(150) === -1, '150° 仍算水平', String(swipeDirFromAngle(150)));
ok(swipeDirFromAngle(45) === 1, '45° 边界算水平', String(swipeDirFromAngle(45)));
ok(swipeDirFromAngle(46) === 0, '46° 已不算水平', String(swipeDirFromAngle(46)));
ok(swipeDirFromAngle(NaN) === 0, 'NaN 不处理', String(swipeDirFromAngle(NaN)));

console.log('\n' + (fail === 0 ? 'ALL PASS' : 'FAILED') + '  pass=' + pass + ' fail=' + fail);
process.exit(fail === 0 ? 0 : 1);
