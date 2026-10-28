// 排期结果文案守卫（M12-8）。
//
// 判据：**每个 reason 都有自己的文案，不许落到兜底分支被当成「排成功」**；
// 真机上真实踩过这条：「系统通知没授权」被显示成「已重排 0 条」。
// 另外：只有真排上了才走成功文案；后缀只在 >0 时出现；授权分支要被页面认出来。
//
//   node --experimental-transform-types tools/test-notifystatus.mjs

import {
  scheduleStatusText, needsNotificationPermission, isEffective,
  REASON_USER_DISABLED, REASON_NOTIFICATION_DISABLED, REASON_EMPTY_PLAN, REASON_ALL_IN_QUIET,
} from '../entry/src/main/ets/corelogic/NotifyStatusText.ts';

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

/** 造结果。 */
function r(over) {
  return {
    published: 0, quotaDropped: 0, pastDropped: 0,
    quietDelayed: 0, quietDropped: 0, failed: 0, reason: '',
    ...over,
  };
}

// ── 1. 四种 reason 各有专属文案（核心判据） ─────────────────────────────
const tUser = scheduleStatusText(r({ reason: REASON_USER_DISABLED }));
const tNoPerm = scheduleStatusText(r({ reason: REASON_NOTIFICATION_DISABLED }));
const tEmpty = scheduleStatusText(r({ reason: REASON_EMPTY_PLAN }));
const tQuiet = scheduleStatusText(r({ reason: REASON_ALL_IN_QUIET, quietDropped: 7 }));

ok(tUser.indexOf('总开关') >= 0, '用户关闭 → 提总开关', tUser);
ok(tNoPerm.indexOf('通知权限') >= 0, '未授权 → 说通知权限', tNoPerm);
ok(tEmpty.indexOf('暂无可排') >= 0, '空计划 → 说本地没数据', tEmpty);
ok(tQuiet.indexOf('免打扰') >= 0 && tQuiet.indexOf('7') >= 0, '静默全吃掉 → 说免打扰 + 条数', tQuiet);

const all = [tUser, tNoPerm, tEmpty, tQuiet];
ok(new Set(all).size === 4, '四条文案互不相同（没有两条撞到一起）', String(new Set(all).size));

// ── 2. 关键回归：没授权 ≠ 「已重排 0 条」 ───────────────────────────────
ok(tNoPerm.indexOf('已重排') < 0, '未授权时**不许**说「已重排」', tNoPerm);
ok(tUser.indexOf('已重排') < 0, '用户关闭时不许说「已重排」', tUser);
ok(tEmpty.indexOf('已重排') < 0, '空计划时不许说「已重排」', tEmpty);
ok(tQuiet.indexOf('已重排') < 0, '静默全吃掉时不许说「已重排」', tQuiet);

// ── 3. 成功文案 ─────────────────────────────────────────────────────────
ok(scheduleStatusText(r({ published: 12 })) === '已重排 12 条', '纯成功',
  scheduleStatusText(r({ published: 12 })));

// ── 4. 后缀只在 >0 时出现（不许「· 0 条」） ─────────────────────────────
const s0 = scheduleStatusText(r({ published: 5 }));
ok(s0.indexOf('0 条') < 0, '全零后缀不出现', s0);

const s1 = scheduleStatusText(r({ published: 5, quotaDropped: 3 }));
ok(s1.indexOf('3 条超配额被裁') >= 0, '配额后缀', s1);

const s2 = scheduleStatusText(r({ published: 5, quietDelayed: 2 }));
ok(s2.indexOf('2 条推迟出免打扰') >= 0, '推迟后缀', s2);

const s3 = scheduleStatusText(r({ published: 5, quietDropped: 4 }));
ok(s3.indexOf('4 条在免打扰内已过期跳过') >= 0, '丢弃后缀', s3);

const s4 = scheduleStatusText(r({ published: 5, failed: 1 }));
ok(s4.indexOf('1 条发布失败') >= 0, '失败后缀', s4);

// 多个后缀同时出现，都要在
const sAll = scheduleStatusText(r({ published: 5, quotaDropped: 1, quietDelayed: 2, quietDropped: 3, failed: 4 }));
ok(sAll.indexOf('1 条超配额被裁') >= 0 && sAll.indexOf('2 条推迟出免打扰') >= 0 &&
   sAll.indexOf('3 条在免打扰内已过期跳过') >= 0 && sAll.indexOf('4 条发布失败') >= 0,
  '四个后缀同时出现', sAll);

// ── 5. 发布为 0 但 reason 为空（理论边界）：不许说「已重排 0 条」以外的话 ──
const zeroOk = scheduleStatusText(r({ published: 0 }));
ok(zeroOk === '已重排 0 条', '真空结果如实说 0 条', zeroOk);

// ── 6. needsNotificationPermission：只有未授权才算 ──────────────────────
ok(needsNotificationPermission(REASON_NOTIFICATION_DISABLED) === true, '未授权 → 要按钮');
ok(needsNotificationPermission(REASON_USER_DISABLED) === false, '用户关闭 → 不要按钮（点了也没用）');
ok(needsNotificationPermission(REASON_EMPTY_PLAN) === false, '空计划 → 不要按钮');
ok(needsNotificationPermission(REASON_ALL_IN_QUIET) === false, '静默 → 不要按钮');
ok(needsNotificationPermission('') === false, '成功 → 不要按钮');

// ── 7. isEffective：有 reason 就不算生效（哪怕 published 被误填） ────────
ok(isEffective(r({ published: 3 })) === true, '3 条无 reason → 生效');
ok(isEffective(r({ published: 0 })) === false, '0 条 → 不生效');
ok(isEffective(r({ published: 3, reason: REASON_NOTIFICATION_DISABLED })) === false,
  'reason 非空时 published 不该存在，按不生效处理');


// ── 8. 系统拒绝（1700002）：真机实测过，必须说「本机不可用」而不是「发布失败」 ──
const allRejected = scheduleStatusText(r({ published: 0, failed: 8, quotaRejected: 8 }));
ok(allRejected.indexOf('全部被系统拒绝') >= 0, '全部被拒 → 说明是系统拒绝', allRejected);
ok(allRejected.indexOf('1700002') >= 0, '带上错误码方便排查', allRejected);
ok(allRejected.indexOf('已重排') < 0, '全拒时不许说「已重排」', allRejected);

// 部分被拒 + 部分成功 → 走成功文案 + 拒绝后缀
const partial = scheduleStatusText(r({ published: 5, failed: 3, quotaRejected: 3 }));
ok(partial.indexOf('已重排 5 条') >= 0, '部分成功仍说排了几条', partial);
ok(partial.indexOf('3 条被系统拒绝（1700002）') >= 0, '带拒绝后缀', partial);

// 混合失败：2 条被拒 + 1 条其他原因 → 两个后缀分开
const mixed = scheduleStatusText(r({ published: 5, failed: 3, quotaRejected: 2 }));
ok(mixed.indexOf('2 条被系统拒绝（1700002）') >= 0, '拒绝后缀取 quotaRejected', mixed);
ok(mixed.indexOf('1 条发布失败') >= 0, '剩余失败数 = failed - rejected', mixed);
ok(mixed.indexOf('3 条发布失败') < 0, '不许把全部失败都算成普通失败', mixed);

// 没填 quotaRejected（老调用/纯成功）不影响
ok(scheduleStatusText(r({ published: 4 })) === '已重排 4 条', '缺省 quotaRejected 不影响成功文案');

// 只有普通失败（非 1700002）时不许说「系统拒绝」
const plainFail = scheduleStatusText(r({ published: 0, failed: 2 }));
ok(plainFail.indexOf('系统拒绝') < 0, '普通失败不说系统拒绝', plainFail);
ok(plainFail.indexOf('2 条发布失败') >= 0, '普通失败如实计数', plainFail);

console.log('\n' + (fail === 0 ? 'ALL PASS' : 'FAILED') + '  pass=' + pass + ' fail=' + fail);
process.exit(fail === 0 ? 0 : 1);
