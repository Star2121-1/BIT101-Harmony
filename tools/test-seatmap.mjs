/**
 * 座位地图逻辑测试（M9-3 纯逻辑层）。
 *
 * 覆盖：
 * 1. 坐标转换（百分比 ↔ 屏幕像素）
 * 2. 点击命中检测
 * 3. 视口初始偏移计算
 * 4. 可见座位筛选
 * 5. 选中状态管理
 */

import {
  pctToScreen,
  screenToPct,
  isPointInSeat,
  calcInitialOffset,
  screenPointToSeatPct,
  getVisibleSeats,
  IMAGE_BASE_WIDTH,
  IMAGE_BASE_HEIGHT,
} from "../entry/src/main/ets/corelogic/SeatMapLogic.ts";

let passed = 0;
let failed = 0;

function eq(actual, expected, name) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}\n  actual   = ${a}\n  expected = ${e}`);
}

function ok(cond, name) {
  if (cond) passed++; else { failed++; console.error("FAIL: " + name); }
}

// ── 1. 百分比坐标 → 屏幕坐标 ────────────────────────────────────────────────
{
  const pos = { pointX: 50, pointY: 50, width: 10, height: 10 };
  const result = pctToScreen(pos, 420, 236); // 2:1 视口
  // x = 50/100 * 420 = 210, y = 50/100 * 236 = 118, w = 42, h = 23.6
  eq(result.x, 210, "x 坐标转换");
  eq(result.y, 118, "y 坐标转换");
  eq(result.w, 42, "width 转换");
  eq(result.h, 23.6, "height 转换");
}
{
  // 默认高度按 16:9 推算
  const pos = { pointX: 0, pointY: 0, width: 100, height: 100 };
  const result = pctToScreen(pos, 420);
  const expectedH = 420 * 9 / 16;
  eq(result.h, expectedH, "默认高度按 16:9 推算");
}

// ── 2. 屏幕坐标 → 百分比坐标 ────────────────────────────────────────────────
{
  const result = screenToPct(210, 118, 420, 236);
  eq(result.pctX, 50, "屏幕 210→百分比 50");
  // 注意：默认高度按 16:9 推算为 236.25，不是 236
  eq(result.pctY, 50, "屏幕 118→百分比 50（默认高度按 16:9 推算）");
}
{
  // 四个角点
  const tl = screenToPct(0, 0, 420, 236);
  const br = screenToPct(420, 236, 420, 236);
  eq(tl.pctX, 0, "左上角 x=0");
  eq(tl.pctY, 0, "左上角 y=0");
  eq(br.pctX, 100, "右下角 x=100");
  eq(br.pctY, 100, "右下角 y=100");
}

// ── 3. 点击命中检测 ──────────────────────────────────────────────────────────
{
  const pos = { pointX: 40, pointY: 40, width: 20, height: 20 };
  ok(isPointInSeat(50, 50, pos), "中心点在座位内");
  ok(!isPointInSeat(30, 50, pos), "左侧点在座位外");
  ok(!isPointInSeat(50, 30, pos), "上方点在座位外");
  ok(!isPointInSeat(60, 60, pos), "右下角点在座位外（右/下边缘为开区间）");
}
{
  // 边界测试：左/上边缘包含，右/下边缘不包含
  const pos = { pointX: 50, pointY: 50, width: 10, height: 10 };
  ok(isPointInSeat(50, 50, pos), "左上角点命中");
  ok(isPointInSeat(59.9, 59.9, pos), "内部点命中");
  ok(!isPointInSeat(60, 50, pos), "右边缘点不命中");
  ok(!isPointInSeat(50, 60, pos), "下边缘点不命中");
  ok(!isPointInSeat(60, 60, pos), "右下角点不命中");
}

// ── 4. 初始视口偏移计算 ──────────────────────────────────────────────────────
{
  const offset = calcInitialOffset(420, 236, 1920, 1080, 1.8);
  // scaledW = 1920 * 1.8 = 3456, scaledH = 1080 * 1.8 = 1944
  // offsetX = (420 - 3456) / 2 = -1518, offsetY = (236 - 1944) / 2 = -854
  eq(offset.offsetX, -1518, "水平偏移");
  eq(offset.offsetY, -854, "垂直偏移");
}
{
  // 视口与图像同大时，偏移为 0
  const offset = calcInitialOffset(1920, 1080, 1920, 1080, 1);
  eq(offset.offsetX, 0, "同大时无偏移");
  eq(offset.offsetY, 0, "同大时无偏移");
}

// ── 5. 屏幕点击 → 座位百分比坐标 ────────────────────────────────────────────
{
  const viewport = { scale: 1.8, offsetX: -1518, offsetY: -854 };
  // 点击视口中心 (210, 118)
  const result = screenPointToSeatPct(210, 118, 420, 236, viewport);
  // adjustedX = (210 - (-1518)) / 1.8 = 960, pctX = 960/420*100 = 228.57
  // adjustedY = (118 - (-854)) / 1.8 = 539.56, pctY = 539.56/236*100 = 228.81
  ok(Math.abs(result.pctX - 228.57) < 0.1, "屏幕点击转百分比 x");
  ok(Math.abs(result.pctY - 228.81) < 0.1, "屏幕点击转百分比 y");
}

// ── 6. 可见座位筛选 ──────────────────────────────────────────────────────────
{
  const seats = [
    { pointX: 10, pointY: 10, width: 10, height: 10 },
    { pointX: 50, pointY: 50, width: 10, height: 10 },
    { pointX: 90, pointY: 90, width: 10, height: 10 },
  ];
  // 视口覆盖全部区域，3 个座位都可见
  const viewport = { scale: 1, offsetX: 0, offsetY: 0 };
  const visible = getVisibleSeats(seats, viewport, 420, 236);
  eq(visible.length, 3, "三个座位都在全视口内");
}
{
  // 测试放大视口：scale=2 时，视口只显示底图的左上 50%
  // 左下 50% 区域应只包含 (5,5) 的座位
  const largeViewport = { scale: 2, offsetX: 0, offsetY: 0 };
  const seats2 = [
    { pointX: 5, pointY: 5, width: 10, height: 10 },   // 左下角，在视口内
    { pointX: 60, pointY: 60, width: 10, height: 10 }, // 右下角，在视口外
  ];
  const visible2 = getVisibleSeats(seats2, largeViewport, 420, 236);
  eq(visible2.length, 1, "放大后只有左下角座位可见");
}

// ── 结果 ─────────────────────────────────────────────────────────────────────
if (failed > 0) {
  console.error(`\nFAIL: ${failed} assertions failed`);
  process.exit(1);
}
console.log(`\nALL PASS  pass=${passed} fail=${failed}`);
