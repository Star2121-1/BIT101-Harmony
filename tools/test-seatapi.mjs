/**
 * 座位接口纯逻辑层测试（M9 · 铁律 0.9 契约修复）。
 * 期望值全部对着 Android `SeatApi.kt` / `SeatResponseParser.kt` / `Seat.kt` 实测写。
 */

import {
  Endpoint, DEFAULT_SEGMENT_ID,
  seatStatusOf, isFree, parseSeats, parseSeatDates, usableSegment,
  parseMyReservations, parseRenege, renegeKey, renegeText,
  seatIdToNumber, buildSeatBody, buildConfirmBody, buildSubscribeBody,
  buildCancelBody, buildMapBody, buildRenegeBody, buildSeminarBody,
  bizResult, signInDeadline, signInHintText,
  seatNumberEquals, compareSeatNumber,
  filterMappableSeats, buildMapPoints,
  emptySeatMapImages, isSeatMapImagesEmpty, mapImageForStatus, parseSeatMap,
  wireStatusColor,
} from "../entry/src/main/ets/corelogic/SeatApiLogic.ts";

let passed = 0;
let failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed++; return; }
  failed++;
  console.log("  FAIL " + name + "\n    expect " + e + "\n    got    " + a);
}
function ok(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.log("  FAIL " + name);
}

// ── 1. 端点表（唯一事实源）────────────────────────────────────────────────
{
  eq(Endpoint.SEAT, '/api/Seat/seat', "取座位端点");
  eq(Endpoint.CONFIRM, '/api/Seat/confirm', "预约端点");
  eq(Endpoint.CANCEL, '/api/Space/cancel', "取消端点（跨 /api/Space）");
  eq(Endpoint.SUBSCRIBE, '/api/index/subscribe', "我的预约端点");
  eq(Endpoint.MAP, '/api/seat/map', "底图端点");
  eq(Endpoint.RENEGES, '/api/Member/reneges', "违约端点");
  eq(Endpoint.SEMINAR, '/api/Member/seminar', "研讨间端点");
  eq(DEFAULT_SEGMENT_ID, '1', "默认时段 id");
}

// ── 2. 状态码映射（官方前端 seat-map.js 分组）────────────────────────────
{
  eq(seatStatusOf('1'), 'AVAILABLE', "1 → 空闲");
  eq(seatStatusOf('2'), 'RESERVED', "2 → 已预约");
  eq(seatStatusOf('10'), 'RESERVED', "10 → 已预约");
  eq(seatStatusOf('11'), 'RESERVED', "11 → 已预约");
  eq(seatStatusOf('6'), 'IN_USE', "6 → 在用");
  eq(seatStatusOf('8'), 'IN_USE', "8 → 在用");
  eq(seatStatusOf('9'), 'IN_USE', "9 → 在用");
  eq(seatStatusOf('7'), 'LEAVE', "7 → 暂离");
  eq(seatStatusOf('3'), 'UNAVAILABLE', "3 → 停用");
  eq(seatStatusOf('4'), 'UNAVAILABLE', "4 → 停用");
  eq(seatStatusOf('5'), 'UNAVAILABLE', "5 → 停用");
  eq(seatStatusOf('99'), 'UNAVAILABLE', "未知码 → 不可用（宁可不让点）");
  eq(seatStatusOf(''), 'UNAVAILABLE', "空 → 不可用");
  eq(seatStatusOf(' 1 '), 'AVAILABLE', "带空格 1 → 空闲（trim）");
  ok(isFree('AVAILABLE') === true, "AVAILABLE 可约");
  ok(isFree('RESERVED') === false, "RESERVED 不可约");
  ok(isFree('IN_USE') === false, "IN_USE 不可约");
}

// ── 2b. 状态色（1:1 原版 SeatColors.kt，#87 纠正自造值）──────────────────
{
  // 原版常量逐值锚定（SeatColors.kt:21-26）
  eq(wireStatusColor('AVAILABLE'), "#4CAF50", "空闲 = #4CAF50（原版：与服务端底图「可用」绿一致，实测值）");
  eq(wireStatusColor('RESERVED'), "#FF9800", "已预约 = #FF9800（原版 reserved）");
  eq(wireStatusColor('IN_USE'), "#9E9E9E", "在用 = #9E9E9E（原版 inUse）");
  eq(wireStatusColor('LEAVE'), "#9E9E9E", "暂离 = #9E9E9E（原版 leave）");
  eq(wireStatusColor('UNAVAILABLE'), "#FDD835", "停用 = #FDD835（原版 unavailable）");

  // 语义断言（不是抄值）：可约态唯一且为绿——「能点的座位是绿的」这条用户可感知的规则
  ok(wireStatusColor('AVAILABLE') === "#4CAF50" && isFree('AVAILABLE'),
    "可约态 = AVAILABLE，其色为绿（用户可感知：绿点才可约）");
  // 原版 inUse/leave 就是同色（都是「人不在但占着」的灰）⇒ 不断言互异，如实钉死
  ok(wireStatusColor('IN_USE') === wireStatusColor('LEAVE'),
    "在用与暂离同色（原版如此：同为占座灰，不靠颜色区分）");
  // 其余三态必须互异，否则状态点失去分辨力
  const set = new Set([wireStatusColor('AVAILABLE'), wireStatusColor('RESERVED'),
    wireStatusColor('UNAVAILABLE')]);
  ok(set.size === 3, "空闲/已预约/停用三色互异（状态点要有分辨力）");
  // 曾经的错误值（#1976D2 蓝预约 / #8D6E63 棕在用 / #78909C 灰蓝停用）不许回归
  ok(wireStatusColor('RESERVED') !== "#1976D2" &&
    wireStatusColor('IN_USE') !== "#8D6E63" &&
    wireStatusColor('UNAVAILABLE') !== "#78909C",
    "自造三色（蓝/棕/灰蓝）不许回归");
}

// ── 3. 座位解析（status 字符串、坐标为字符串浮点）────────────────────────
{
  const rows = [
    { id: '1001', no: '001', status: '1', status_name: '空闲',
      point_x: '12.3', point_y: '45.6', width: '8', height: '6' },
    { id: '1002', no: '002', status: '2', status_name: '已预约',
      point_x: 20, point_y: '50', width: 7, height: 5 },
    { id: '1003', no: '003', status: '6', status_name: '',
      point_x: 'bad', point_y: '50', width: 7, height: 5 },
    { no: 'no-id', status: '1' }, // 缺 id → 跳过
  ];
  const seats = parseSeats(rows, 'area_9');
  eq(seats.length, 3, "缺 id 的条目被跳过");
  eq(seats[0].no, '001', "座位号保留补零");
  eq(seats[0].status, 'AVAILABLE', "1→空闲");
  eq(seats[0].statusName, '空闲', "状态名透传");
  eq(seats[0].pointX, 12.3, "字符串浮点坐标解析");
  eq(seats[0].areaId, 'area_9', "区域 id 透传");
  eq(seats[1].pointY, 50, "数字坐标亦支持");
  eq(seats[1].status, 'RESERVED', "2→已预约");
  eq(seats[2].pointX, null, "非法坐标串 → null");
  eq(seats[2].status, 'IN_USE', "6→在用");
}

// ── 4. 时段解析（times[].id 恒 null 是正常路径）────────────────────────
{
  const data = [
    { day: '2026-10-22', times: [{ id: null, start: null, end: null }, { id: null, start: null, end: null }] },
    { day: '2026-10-23', times: [{ id: 'seg5', start: '08:00', end: '12:00' }] },
  ];
  const ds = parseSeatDates(data);
  eq(ds.length, 3, "两个 day × times 展开");
  eq(ds[0].segmentId, '', "null id → 空串");
  eq(usableSegment(ds[0].segmentId), '1', "空 segment 回落默认 1");
  eq(ds[2].segmentId, 'seg5', "有 id 时透传");
  eq(usableSegment('seg5'), 'seg5', "非空 segment 不回落");
  eq(ds[1].start, '', "null start → 空串");
}

// ── 5. 我的预约解析（space=座位id、no=座位号）──────────────────────────
{
  const rows = [
    { id: '3427299', space: '1001', no: '001', areaName: '徐特立馆-三层',
      beginTime: '2026-09-18 11:03:27', endTime: '2026-09-18 15:03:27',
      status: '2', statusName: '未签到' },
    { id: '3427300', space: '1002', no: '002', areaName: '徐特立馆-三层',
      beginTime: '', endTime: '', status: '4' },
  ];
  const rs = parseMyReservations(rows);
  eq(rs.length, 2, "两条记录");
  eq(rs[0].id, '3427299', "预约记录 id");
  eq(rs[0].seatId, '1001', "space → 座位 id");
  eq(rs[0].seatNo, '001', "no → 座位号");
  eq(rs[0].isActive, true, "status=2 未签到 → 有效");
  eq(rs[1].isActive, false, "status=4 → 非有效");
  eq(rs[1].statusName, null, "缺 statusName → null");
  ok(rs.every(r => r.beginTime.length >= 0), "字段不丢");
}

// ── 6. 违约解析 + 身份键（无 id）────────────────────────────────────────
{
  const rows = [
    { nameMerge: '徐特立馆-三层-阅览室', name: '018', time: '2026-09-18 09:00', status: '1', statusName: '已违约' },
  ];
  const rs = parseRenege(rows);
  eq(rs[0].nameMerge, '徐特立馆-三层-阅览室', "合并名");
  eq(renegeKey(rs[0]), '徐特立馆-三层-阅览室|018|2026-09-18 09:00', "身份键合成");
  eq(renegeText(rs[0]), '徐特立馆-三层-阅览室 · 2026-09-18 09:00 · 已违约', "展示文案（合并名优先）");
  // 缺合并名 → 回落具体名；缺 statusName → 不硬塞
  const bare = parseRenege([{ nameMerge: '', name: '007', time: '2026-09-18 09:00', status: '1', statusName: '' }]);
  eq(renegeText(bare[0]), '007 · 2026-09-18 09:00', "缺合并名回落 name / 缺状态不塞");
  const empty = parseRenege([{ nameMerge: '', name: '', time: '', status: '', statusName: '' }]);
  eq(renegeText(empty[0]), '', "全空 → 空串（UI 自行隐藏）");
}

// ── 7. body 构建（1:1 Android jsonBody）────────────────────────────────
{
  eq(buildSeatBody('area1', '1', '2026-10-22', '08:00', '10:00'),
    { area: 'area1', segment: '1', day: '2026-10-22', startTime: '08:00', endTime: '10:00' },
    "取座位 body");
  eq(buildConfirmBody('1001', '1'), { seat_id: 1001, segment: '1' }, "confirm body：seat_id 转 int");
  eq(buildConfirmBody('007', ''), { seat_id: 7, segment: '1' }, "confirm body：补零+空segment回落");
  eq(buildSubscribeBody(), { type: '1' }, "subscribe body");
  eq(buildCancelBody('3427299'), { id: '3427299' }, "cancel body：传记录 id 不是座位 id");
  eq(buildMapBody('area9'), { id: 'area9' }, "map body：参数名必须是 id");
  eq(buildRenegeBody(2), { type: 2 }, "reneges body：type 2=研讨室");
  eq(buildSeminarBody(), {}, "seminar body 空");
  eq(seatIdToNumber('1001'), 1001, "座位号转数字");
  eq(seatIdToNumber('abc'), 'abc', "非法座位号原样返回");
}

// ── 8. 业务响应判定（code===1 成功；10001 登录失效）──────────────────
{
  const r1 = bizResult({ code: 1, message: 'ok' });
  eq(r1.ok, true, "code=1 成功");
  const r2 = bizResult({ code: 0, message: '余额不足' });
  eq(r2.ok, false, "code=0 失败");
  eq(r2.message, '余额不足', "错误文案透传（不拼前缀）");
  const r3 = bizResult({ code: 10001 });
  eq(r3.ok, false, "code=10001 失败");
  eq(r3.message, '登录已失效，请重新登录', "10001 → 登录失效文案");
  const r4 = bizResult({ code: 0, msg: '时段冲突' });
  eq(r4.message, '时段冲突', "msg 字段亦识别");
}

// ── 9. 签到截止规则（当日 +60min / 次日 09:00）─────────────────────────
{
  // nowDay=100, 预约当日 100，开始 08:00（480）→ 截止 09:00（540）
  eq(signInDeadline(100, 480, 100), { day: 100, minutes: 540 }, "当日：开始+60min");
  // 预约次日 101 → 次日 09:00（540 分钟即 9:00）
  eq(signInDeadline(101, 480, 100), { day: 101, minutes: 540 }, "次日：09:00");
  // 预约非今非明 → null
  eq(signInDeadline(105, 480, 100), null, "隔多日：无法判断");
  eq(signInHintText(100, 480, 100), '今日预约 · 请在 09:00 前刷卡签到', "当日提示文案");
  eq(signInHintText(101, 480, 100), '次日预约 · 请在 09:00 前刷卡签到', "次日提示文案");
  eq(signInHintText(105, 480, 100), '', "无法判断 → 空串");
}

// ── 10. 座位号比较 / 排序（补零口径）───────────────────────────────────
{
  ok(seatNumberEquals('001', '1'), "补零 001 == 裸 1");
  ok(seatNumberEquals('01', '1'), "补零 01 == 裸 1");
  ok(!seatNumberEquals('001', '2'), "001 != 2");
  ok(seatNumberEquals('1', '001'), "对称");
  // 排序：9 < 10（数值，不是字符串 "10"<"9"）
  const arr = ['10', '9', '002', '7'].sort(compareSeatNumber);
  eq(arr, ['002', '7', '9', '10'], "数值排序 2,7,9,10");
}

// ── 11. 点位视图 buildMapPoints / filterMappableSeats（M9-3 纯逻辑）────────
{
  // 实测坐标形态：字符串浮点（point_x "69.10688"），缺坐标的座位被过滤
  const full = {
    id: "30001", no: "A01", statusRaw: "1", status: "AVAILABLE", statusName: "空闲",
    areaId: "areaX", pointX: 69.10688, pointY: 25.5, width: 4.2, height: 3.8,
  };
  const missing = {
    id: "30002", no: "A02", statusRaw: "2", status: "RESERVED", statusName: "已预约",
    areaId: "areaX", pointX: null, pointY: null, width: null, height: null,
  };
  const onlyX = {
    id: "30003", no: "A03", statusRaw: "1", status: "AVAILABLE", statusName: "空闲",
    areaId: "areaX", pointX: 10, pointY: null, width: null, height: null,
  };
  const list = [full, missing, onlyX];

  // 只保留四边坐标齐全的（full）；缺任一坐标的（missing/onlyX）被滤掉
  const mapped = filterMappableSeats(list);
  eq(mapped.length, 1, "只保留四边坐标齐全");
  eq(mapped[0].id, "30001", "保留的是 full");

  // 渲染规格：百分比字符串落值（toFixed(2)）+ 状态色 + 可预约
  const pts = buildMapPoints(list);
  eq(pts.length, 1, "buildMapPoints 也只画有坐标的");
  eq(pts[0].leftPct, "69.11%", "leftPct = pointX.toFixed(2)");
  eq(pts[0].topPct, "25.50%", "topPct = pointY.toFixed(2)");
  eq(pts[0].widthPct, "4.20%", "widthPct");
  eq(pts[0].heightPct, "3.80%", "heightPct");
  eq(pts[0].color, "#4CAF50", "空闲状态色（原版 SeatColors 常量，不随主题变）");
  ok(pts[0].reservable, "空闲座位 reservable=true");
  eq(pts[0].no, "A01", "no 直出");

  // 全空坐标列表 → 空点位（UI 给「该区域无带坐标的座位」空态）
  eq(buildMapPoints([missing]).length, 0, "全无坐标 → 空");
  eq(buildMapPoints([]).length, 0, "空输入 → 空");

  // ── 11b. 区域底图 parseSeatMap / mapImageForStatus / 裁图规格（M9-3 实测）──
  // 2026-10-22 真机实测 raw（area id=3）：
  const REAL_MAP = {
    code: 1,
    data: {
      book: "https://seatlib.bit.edu.cn/home/images/web/area/3/seat-book.jpg",
      close: "https://seatlib.bit.edu.cn/home/images/web/area/3/seat-close.jpg",
      free: "https://seatlib.bit.edu.cn/home/images/web/area/3/seat-free.jpg",
      leave: "https://seatlib.bit.edu.cn/home/images/web/area/3/seat-leave.jpg",
      use: "https://seatlib.bit.edu.cn/home/images/web/area/3/seat-use.jpg",
    },
  };
  const imgs = parseSeatMap(REAL_MAP.data);
  eq(imgs.free, REAL_MAP.data.free, "free URL 直出");
  eq(imgs.use, REAL_MAP.data.use, "use URL 直出");
  ok(!isSeatMapImagesEmpty(imgs), "五图齐全 → 非空");
  eq(isSeatMapImagesEmpty(emptySeatMapImages()), true, "空构造 → 空");
  eq(parseSeatMap(null).free, "", "null → 全空串（不猜 URL）");
  eq(parseSeatMap({}).book, "", "缺字段 → 空串");

  // 按状态取图（对齐 Android SeatMapImages.forStatus）
  eq(mapImageForStatus("AVAILABLE", imgs), imgs.free, "空闲→free");
  eq(mapImageForStatus("RESERVED", imgs), imgs.book, "已预约→book");
  eq(mapImageForStatus("IN_USE", imgs), imgs.use, "在用→use");
  eq(mapImageForStatus("LEAVE", imgs), imgs.leave, "暂离→leave");
  eq(mapImageForStatus("UNAVAILABLE", imgs), imgs.close, "停用→close");
  eq(mapImageForStatus("AVAILABLE", emptySeatMapImages()), "", "无图 → 空串（回落色块）");

  // 裁图规格数学：座位在容器 left=10% top=5% 宽 2.5% 高 2%
  //   内层 Image 宽（相对座位框）= 100/2.5*100 = 4000.00%
  //   高 = 100/2*100 = 5000.00%；偏移 = -10/2.5*100 = -400.00% / -5/2*100 = -250.00%
  const tileSeat = [{
    id: "9", no: "B07", statusRaw: "6", status: "IN_USE", statusName: "在用",
    areaId: "3", pointX: 10, pointY: 5, width: 2.5, height: 2,
  }];
  const tpts = buildMapPoints(tileSeat, imgs);
  eq(tpts.length, 1, "一个座位一个点位");
  eq(tpts[0].tileUrl, imgs.use, "在用座位带 use 图");
  eq(tpts[0].imgScaleX, "4000.00%", "内层宽 = 100/宽*100");
  eq(tpts[0].imgScaleY, "5000.00%", "内层高 = 100/高*100");
  eq(tpts[0].imgOffsetX, "-400.00%", "左偏移 = -left/宽*100");
  eq(tpts[0].imgOffsetY, "-250.00%", "上偏移 = -top/高*100");
  ok(!tpts[0].reservable, "在用不可预约");

  // 不传 images（旧行为）：无裁图，UI 回落到色块
  const npts = buildMapPoints(tileSeat);
  eq(npts[0].tileUrl, "", "无 images → 无裁图");
  eq(npts[0].imgScaleX, "100%", "兜底缩放 100%");
  eq(npts[0].imgOffsetX, "0%", "兜底偏移 0");

  // 零宽高（畸形数据）不算裁图规格，避免除零
  const zero = [{
    id: "10", no: "B08", statusRaw: "1", status: "AVAILABLE", statusName: "空闲",
    areaId: "3", pointX: 0, pointY: 0, width: 0, height: 0,
  }];
  const zpts = buildMapPoints(zero, imgs);
  eq(zpts[0].imgScaleX, "100%", "零宽高 → 兜底（防除零）");
  eq(zpts[0].tileUrl, imgs.free, "但 tileUrl 仍按状态给（UI 层不裁即可）");
}

console.log("");
if (failed === 0) {
  console.log("ALL PASS  pass=" + passed + " fail=0");
} else {
  console.log("FAIL  pass=" + passed + " fail=" + failed);
  process.exit(1);
}
