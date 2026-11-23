// 用例：座位预约 / 取消的副作用边界（自动跑，绝不发真实请求、不点副作用按钮）
//
// 覆盖三层：
//  A. 请求契约 —— confirm 只带 {seat_id, segment}，cancel 只带 {id=预约记录id}；
//  B. 副作用闸门 —— 调用点只在显式点击路径，自动路径/初始化路径没有写操作；
//  C. 结果语义 —— 签到时限、会话失效同意图重放、取消额度扣减。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  Endpoint, buildConfirmBody, buildCancelBody, usableSegment, seatIdToNumber,
} from "../entry/src/main/ets/corelogic/SeatApiLogic.ts";
import { signInHintFor } from "../entry/src/main/ets/corelogic/SeatReserveLogic.ts";
import { remainingCancels, encodeQuota, decodeQuota } from "../entry/src/main/ets/corelogic/SeatListLogic.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const code = (p) => readFileSync(join(root, p), 'utf8');
const map = code('entry/src/main/ets/pages/SeatMapPage.ets');
const seat = code('entry/src/main/ets/pages/SeatPage.ets');
const svc = code('entry/src/main/ets/service/SeatService.ts');

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; };
const eq = (a, b, m) => { assert.equal(a, b, m); pass++; };
const deep = (a, b, m) => { assert.deepEqual(a, b, m); pass++; };

console.log("=== 座位预约/取消副作用边界用例 ===");

// ── A. 请求契约 ──
eq(Endpoint.CONFIRM, '/api/Seat/confirm', '预约端点');
eq(Endpoint.CANCEL, '/api/Space/cancel', '取消端点（跨 /api/Space）');
deep(buildConfirmBody('001', '1'), { seat_id: 1, segment: '1' }, '预约体：补零座位号转 int + 真实时段');
deep(buildConfirmBody('007', ''), { seat_id: 7, segment: '1' }, '预约体：空段回落默认段，不发非法 segment');
eq(seatIdToNumber('abc'), 'abc', '非数字座位号原样保留，不伪造 id');
eq(usableSegment(''), '1', '空时段回落默认段（契约 §2：空段 → 500）');
eq(usableSegment('2'), '2', '非空时段原样透传（真实合法性由 resolveSeatSegment 保证）');
const cancelBody = buildCancelBody('3427299');
deep(cancelBody, { id: '3427299' }, '取消体只带 id');
eq(Object.keys(cancelBody).join(','), 'id', '取消体不含第二个键');
ok(!('seat_id' in cancelBody), '取消绝不能传座位 id（2026-09-18 实测恒失败）');

// ── B. 副作用闸门（源码静态守卫）──
// 服务层两个写方法各自只构造一个 postJson，没有自带重试/自动调用。
const confirmSvcStart = svc.indexOf('async confirmSeat(');
const confirmSvcBody = svc.slice(confirmSvcStart, svc.indexOf('async myReservations('));
eq((confirmSvcBody.match(/postJson\(/g) || []).length, 1, 'confirmSeat 只发一次请求（不自动重试）');
const cancelSvcStart = svc.indexOf('async cancelReservation(');
const cancelSvcBody = svc.slice(cancelSvcStart, svc.indexOf('async reneges('));
eq((cancelSvcBody.match(/postJson\(/g) || []).length, 1, 'cancelReservation 只发一次请求（不自动重试）');

// 座位图页：预约调用只在 doReserve 内（首调 + 会话失效同意图重放各一次）。
const doReserveStart = map.indexOf('private async doReserve()');
const doCancelStart = map.indexOf('private async doCancel()');
ok(doReserveStart > 0 && doCancelStart > doReserveStart, 'doReserve / doCancel 方法存在');
const doReserveBody = map.slice(doReserveStart, doCancelStart);
eq((map.match(/svc\.confirmSeat\(/g) || []).length, 2, '全页 confirmSeat 恰好 2 处（首调 + 同意图重放）');
eq((doReserveBody.match(/svc\.confirmSeat\(/g) || []).length, 2, '2 处都在 doReserve 内，没有旁路');
ok(doReserveBody.includes('silentRenewJwt(ctx)') && doReserveBody.includes('s.id, this.segId'),
  '续期后重放的是同一座位和同一时段（同意图，不是新预约）');
ok(map.slice(0, doReserveStart).indexOf('svc.confirmSeat(') < 0,
  'doReserve 之前没有预约调用（aboutToAppear/reload 不自动预约）');
ok(map.includes('.onClick(() => {') && map.includes('void this.doReserve();'),
  '预约由底栏按钮 onClick 触发');

// 座位图页取消：必须先点「我的」座位进 cancelTarget，再点「确认取消预约」。
eq((map.match(/svc\.cancelReservation\(/g) || []).length, 1, '座位图页取消调用恰好 1 处');
const doCancelBody = map.slice(doCancelStart);
ok(doCancelBody.includes('if (sid === null) return;'), 'doCancel 没有确认目标就直接返回');
ok(map.includes('this.cancelTarget = s.id') && map.includes('isCancelInstead(s.status)'),
  '只有「我已预约」座位才进取消确认态');
ok(doCancelBody.includes('this.mineRecords[i].seatId === sid') && doCancelBody.includes('.id;'),
  '取消从我的预约反查 record.id（不是拿座位 id 去取消）');

// 表单页取消：同样二次确认，且有独立的取消确认条。
const cancelStart = seat.indexOf('private async confirmCancel()');
const cancelBodySeat = seat.slice(cancelStart, cancelStart + 1600);
ok(cancelBodySeat.includes('if (rid === null) {'), '表单页 confirmCancel 无目标直接返回');
ok(cancelBodySeat.includes('svc.cancelReservation(ctx, user.jwt, rid)'), '表单页取消传记录 id');
ok(seat.includes('this.requestCancel(m.id)') && seat.includes('this.confirmCancel()'),
  '列表卡片先 requestCancel 再 confirmCancel（两次点击）');

// 自动路径不得出现写操作：抽查初始化/刷新/回跳方法。
const autoMethods = ['aboutToAppear(): void', 'private onAuthRetry(): void', 'private async reload(): Promise<void>', 'private async loadSeats('];
for (const mth of autoMethods) {
  const i = map.indexOf(mth) >= 0 ? map.indexOf(mth) : seat.indexOf(mth);
  const src = map.indexOf(mth) >= 0 ? map : seat;
  ok(i >= 0, '找到自动路径方法 ' + mth);
  const nxt = src.indexOf('\n  }', i);
  const body = src.slice(i, nxt > 0 ? nxt : i + 900);
  ok(!body.includes('confirmSeat(') && !body.includes('cancelReservation('),
    mth + ' 内没有预约/取消写操作');
}

// ── C. 结果语义 ──
const today = '2026-11-23';
ok(signInHintFor(today, today).includes('60 分钟'), '当日预约提示 60 分钟内签到');
ok(signInHintFor('2026-11-24', today).includes('9:00'), '次日预约提示 9:00 前签到');
eq(encodeQuota(today, 1), '2026-11-23|1', '额度扣减落盘格式');
eq(remainingCancels(today, 1, today, 2), 1, '当天取消 1 次后剩 1 次');
eq(remainingCancels('2026-11-22', 2, today, 2), 2, '跨天额度重置为 2');
eq(remainingCancels(today, 9, today, 2), 0, '额度下限为 0，不出现负数');
eq(decodeQuota(encodeQuota(today, 1), today).used, 1, '扣减后能正确读回');

console.log(`ALL PASS pass=${pass} fail=0`);
