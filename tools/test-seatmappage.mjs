// 守卫：阶段3独立座位图页纯逻辑（对齐 Android SeatMapScreen / SeatViewModel）
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const code = (p) => readFileSync(join(root, p), 'utf8');
const page = code('entry/src/main/ets/pages/SeatMapPage.ets');
const seat = code('entry/src/main/ets/pages/SeatPage.ets');
const routes = code('entry/src/main/resources/base/profile/main_pages.json');

import {
  FormMode,
} from "../entry/src/main/ets/corelogic/SeatFormLogic.ts";
import {
  WireSeatStatus, wireStatusColor, wireStatusText, mapImageForStatus,
  emptySeatMapImages,
} from "../entry/src/main/ets/corelogic/SeatApiLogic.ts";
import {
  isPickingMode, mapTitle, pickable, togglePicked, mineSeatIds, markMineSeats,
  sortedSeatsForGrid, pickedSummary, pickerConfirmLabel, pickerGuard,
  reserveButtonLabel, reserveHint, isCancelInstead, statusShortLabel, canUseMapCanvas,
  mapPointsForMode,
} from "../entry/src/main/ets/corelogic/SeatMapPageLogic.ts";

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; };
const eq = (a, b, m) => { assert.equal(a, b, m); pass++; };

console.log("=== 阶段3座位图页逻辑守卫 ===");

const mk = (id, no, status, x = 1, y = 1, w = 2, h = 2) => ({
  id, no, statusRaw: '', status, statusName: '', areaId: 'a1',
  pointX: x, pointY: y, width: w, height: h,
});

// ── 用途三态 ──
eq(isPickingMode(FormMode.SINGLE), false, "单次=直接预约，不算选座");
eq(isPickingMode(FormMode.MONITOR), true, "监控是选座模式");
eq(isPickingMode(FormMode.PREFER), true, "优先是选座模式");
eq(mapTitle(FormMode.SINGLE), "选择座位", "预约标题");
eq(mapTitle(FormMode.MONITOR), "选目标座位", "监控标题");
eq(mapTitle(FormMode.PREFER), "选偏好座位（按优先级）", "优先标题");

// ── 可点语义（对齐 Android pickable）──
eq(pickable(FormMode.SINGLE, WireSeatStatus.AVAILABLE), true, "预约可点空闲");
eq(pickable(FormMode.SINGLE, WireSeatStatus.MINE), true, "预约可点我的（为了取消）");
eq(pickable(FormMode.SINGLE, WireSeatStatus.RESERVED), false, "预约不可点别人的预约");
eq(pickable(FormMode.SINGLE, WireSeatStatus.IN_USE), false, "预约不可点在用");
eq(pickable(FormMode.MONITOR, WireSeatStatus.IN_USE), true, "监控可点已被占的座位");
eq(pickable(FormMode.PREFER, WireSeatStatus.UNAVAILABLE), true, "优先任意座位可点");

// ── 点选状态机（对齐 SeatViewModel.togglePick）──
eq(togglePicked(FormMode.MONITOR, [], "s1").join(","), "s1", "监控点选落入单选");
eq(togglePicked(FormMode.MONITOR, ["s1"], "s2").join(","), "s2", "监控改点替换目标");
eq(togglePicked(FormMode.MONITOR, ["s1"], "s1").join(","), "", "监控反选清空");
eq(togglePicked(FormMode.PREFER, [], "s1").join(","), "s1", "优先首个偏好");
eq(togglePicked(FormMode.PREFER, ["s1"], "s2").join(","), "s1,s2", "优先追加保序");
eq(togglePicked(FormMode.PREFER, ["s1", "s2"], "s1").join(","), "s2", "优先移除已选");
eq(togglePicked(FormMode.SINGLE, ["s1"], "s2").join(","), "s1", "预约态不改 picked");
const srcPicked = ["s1"];
togglePicked(FormMode.PREFER, srcPicked, "s2");
eq(srcPicked.join(","), "s1", "togglePicked 不改入参");

// ── 我的座位交叉标记 ──
eq(mineSeatIds(["", "s1", "s1", "s2", ""]).join(","), "s1,s2", "我的座位 id 去空去重");
const mineSrc = [mk("1", "001", WireSeatStatus.RESERVED), mk("2", "002", WireSeatStatus.AVAILABLE)];
const marked = markMineSeats(mineSrc, ["1", "2"]);
eq(marked[0].status, WireSeatStatus.MINE, "我的预约覆盖 RESERVED");
eq(marked[0].statusName, "我已预约", "MINE 展示文案");
eq(marked[1].status, WireSeatStatus.AVAILABLE, "空闲座位即使 id 命中也不改写");
eq(mineSrc[0].status, WireSeatStatus.RESERVED, "markMineSeats 不改入参");
eq(markMineSeats([mk("9", "009", WireSeatStatus.RESERVED)], ["1"])[0].status,
  WireSeatStatus.RESERVED, "非我的预约保持 RESERVED");

// ── MINE 语义色/图（对齐 SeatColors + Seat.kt）──
eq(wireStatusColor(WireSeatStatus.MINE), "#2E7D32", "MINE 专用绿");
eq(wireStatusText(WireSeatStatus.MINE), "我已预约", "MINE 中文文案");
const imgs = emptySeatMapImages();
imgs.book = "book.jpg";
imgs.free = "free.jpg";
eq(mapImageForStatus(WireSeatStatus.MINE, imgs), "book.jpg", "MINE 复用 book 底图");

// ── 方格兜底排序（服务端顺序乱）──
const grid = [mk("10", "010", WireSeatStatus.AVAILABLE), mk("2", "002", WireSeatStatus.AVAILABLE),
  mk("1", "1", WireSeatStatus.AVAILABLE)];
eq(sortedSeatsForGrid(grid).map(s => s.no).join(","), "1,002,010", "按座位号数值排序");
eq(grid[0].no, "010", "排序不改入参");

// ── Picker 底栏 ──
eq(pickedSummary(FormMode.PREFER, []), "未指定座位（不限：谁先空抢谁）", "优先空选文案");
eq(pickedSummary(FormMode.MONITOR, []), "未选择座位", "监控空选文案");
eq(pickedSummary(FormMode.MONITOR, [{ no: "012", statusShort: "在用" }]), "012（在用）", "监控已选文案");
eq(pickedSummary(FormMode.PREFER, [
  { no: "001", statusShort: "空闲" }, { no: "055", statusShort: "已预约" },
]), "1.001 → 空闲  2.055 → 已预约", "优先按优先级编号");
eq(pickerConfirmLabel(FormMode.MONITOR, 1), "确定监控这个座位", "监控确认按钮");
eq(pickerConfirmLabel(FormMode.PREFER, 0), "不限座位，返回", "优先空选按钮");
eq(pickerConfirmLabel(FormMode.PREFER, 3), "确定（3 个）", "优先多选按钮");
eq(pickerGuard(FormMode.MONITOR, 0), "请点选一个要监控的座位", "监控空选守卫");
eq(pickerGuard(FormMode.MONITOR, 1), null, "监控已选放行");
eq(pickerGuard(FormMode.PREFER, 0), null, "优先空选放行（不限座位）");

// ── Reserve 底栏 ──
eq(reserveButtonLabel("007"), "预约 007", "已选显示座位号");
eq(reserveButtonLabel(""), "立即预约", "未选显示通用文案");
eq(reserveHint(""), "请先在图上点选一个座位", "未选提示");
eq(reserveHint("007"), "", "已选无提示");
eq(isCancelInstead(WireSeatStatus.MINE), true, "我的座位显示取消预约");
eq(isCancelInstead(WireSeatStatus.AVAILABLE), false, "空闲座位显示预约");
eq(statusShortLabel(WireSeatStatus.MINE), "我已预约", "状态短文案");
eq(statusShortLabel(WireSeatStatus.UNAVAILABLE), "停用", "停用短文案");

// ── 底图模式判定 ──
eq(canUseMapCanvas(false, [mk("1", "001", WireSeatStatus.AVAILABLE)]), false, "无底图走方格");
eq(canUseMapCanvas(true, [mk("1", "001", WireSeatStatus.AVAILABLE)]), true, "有底图+全坐标走叠图");
const noPoint = mk("1", "001", WireSeatStatus.AVAILABLE);
noPoint.pointX = null;
eq(canUseMapCanvas(true, [noPoint]), false, "缺坐标走方格兜底");
eq(canUseMapCanvas(true, []), true, "空座位列表不阻止底图分支（由 empty 分支先接管）");

// ── 点位按用途重算可点性 ──
const basePoint = {
  seatId: "1", no: "001", status: WireSeatStatus.MINE, color: "#2E7D32",
  leftPct: "10.00%", topPct: "20.00%", widthPct: "2.00%", heightPct: "3.00%",
  reservable: false, tileUrl: "book.jpg",
  imgScaleX: "100%", imgScaleY: "100%", imgOffsetX: "0%", imgOffsetY: "0%",
};
const reservePts = mapPointsForMode([basePoint], FormMode.SINGLE);
eq(reservePts[0].reservable, true, "MINE 在预约模式可点（取消预约）");
const pickPts = mapPointsForMode([basePoint], FormMode.MONITOR);
eq(pickPts[0].reservable, true, "MINE 在监控模式可点");
eq(reservePts[0].leftPct, "10.00%", "点位坐标原样透传");
eq(basePoint.reservable, false, "mapPointsForMode 不改入参");

// ── 页面接线栅栏（静态源码守卫）──
ok(routes.includes('"pages/SeatMapPage"'), '座位图页已注册路由');
ok(page.includes('resolveSeatSegment(') && page.includes('fetchSeats('), '查询用真实时段参数（不是猜 segment）');
ok(page.includes('markMineSeats(') && page.includes('myReservations('), '交叉标记我的预约（对齐 Seat.asMine）');
ok(page.includes('buildMapPoints(') && page.includes('sortedSeatsForGrid('), '底图叠图 + 方格兜底两条分支都在');
ok(page.includes('confirmPick()') && page.includes('STORAGE_SEAT_PICK_RESULT'), '选座结果经 AppStorage 回传表单');
ok(!page.includes('createTask('), '座位图页只回传选座，不在页面里建任务');
const confirmCalls = (page.match(/confirmSeat\(/g) || []).length;
ok(confirmCalls === 2, '预约接口只在显式 doReserve 内调用（首调 + 同意图重放各一次）');
ok(page.includes('cancelTarget = s.id') && page.includes('doCancel()'), '取消预约有二次确认态');
ok(page.includes('router.pushUrl({ url: \'pages/LoginPage\', params: { from: \'seat\' } })'), '授权失败回登录保留来源');
ok(page.includes("parts.join(';')") && seat.includes("raw.split(';')"),
  '回传串用 split 还原（ArkTS 禁动态对象进 AppStorage）');

console.log(`ALL PASS pass=${pass} fail=0`);
