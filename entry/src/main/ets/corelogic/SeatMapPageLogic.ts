/**
 * 独立座位图页纯逻辑（对齐 Android SeatMapScreen / SeatViewModel 选座状态机）。
 * 只做枚举/字符串/数组判断，无 I/O、无 @kit 依赖，可离线单测。
 *
 * 三种用途复用已有 FormMode：SINGLE=SeatPickMode.RESERVE（直接预约），
 * MONITOR=选目标座位，PREFER=选偏好座位（按点选顺序=优先级）。
 */

import { FormMode } from './SeatFormLogic.ts';
import type { WireSeat, MapPointVM } from './SeatApiLogic.ts';
import { WireSeatStatus, compareSeatNumber } from './SeatApiLogic.ts';

/** 是否处于「选座」用途（监控/优先）。 */
export function isPickingMode(mode: FormMode): boolean {
  return mode !== FormMode.SINGLE;
}

/** 座位图顶栏标题（对齐 Android when(pickMode)）。 */
export function mapTitle(mode: FormMode): string {
  if (mode === FormMode.MONITOR) return '选目标座位';
  if (mode === FormMode.PREFER) return '选偏好座位（按优先级）';
  return '选择座位';
}

/**
 * 图上某座位是否可点（对齐 Android SeatMapScreen.pickable）：
 * - 选座模式（监控/优先）：任意座位可点 —— 监控正是要等已被占的座位空出来；
 * - 直接预约：只有空闲或「我已预约」（可取消）可点。
 */
export function pickable(mode: FormMode, status: WireSeatStatus): boolean {
  if (isPickingMode(mode)) return true;
  return status === WireSeatStatus.AVAILABLE || status === WireSeatStatus.MINE;
}

/**
 * 点选/取消点选（对齐 Android SeatViewModel.togglePick）。
 * - MONITOR：点已选→清空；点未选→替换成单个（单选，可反选取消）。
 * - PREFER：点已选→移除；点未选→追加（顺序即优先级）。
 * - SINGLE：不动 picked（预约态用单独 selectedSeat 管理）。
 * 返回新数组，不改入参。
 */
export function togglePicked(mode: FormMode, picked: string[], seatId: string): string[] {
  if (mode === FormMode.SINGLE) return picked.slice();
  const idx: number = picked.indexOf(seatId);
  if (mode === FormMode.MONITOR) {
    return idx >= 0 ? [] : [seatId];
  }
  const out: string[] = picked.slice();
  if (idx >= 0) {
    out.splice(idx, 1);
  } else {
    out.push(seatId);
  }
  return out;
}

/** 从「我的预约」记录里取座位 id（去空去重）。 */
export function mineSeatIds(seatIds: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < seatIds.length; i++) {
    const s: string = seatIds[i];
    if (s.length > 0 && out.indexOf(s) < 0) out.push(s);
  }
  return out;
}

/**
 * 把服务端 RESERVED 且属于本人的座位标成 MINE（对齐 Android Seat.asMine()）。
 * 只有 RESERVED 会被改写；其它状态即使 id 命中也保持原状（不猜服务端语义）。
 * 纯函数，返回新数组，不改入参。
 */
export function markMineSeats(seats: WireSeat[], mineIds: string[]): WireSeat[] {
  const out: WireSeat[] = [];
  for (let i = 0; i < seats.length; i++) {
    const s: WireSeat = seats[i];
    if (s.status === WireSeatStatus.RESERVED && mineIds.indexOf(s.id) >= 0) {
      out.push({
        id: s.id,
        no: s.no,
        statusRaw: s.statusRaw,
        status: WireSeatStatus.MINE,
        statusName: '我已预约',
        areaId: s.areaId,
        pointX: s.pointX,
        pointY: s.pointY,
        width: s.width,
        height: s.height,
      });
    } else {
      out.push(s);
    }
  }
  return out;
}

/**
 * 底图点位按当前用途重算可点性：buildMapPoints 的 reservable 固定是「仅空闲」，
 * 而座位图页选座模式任意可点、预约模式「我已预约」也可点（用于取消）。
 * 其余渲染规格（坐标/裁图/颜色）原样透传，纯函数不改入参。
 */
export function mapPointsForMode(points: MapPointVM[], mode: FormMode): MapPointVM[] {
  const out: MapPointVM[] = [];
  for (let i = 0; i < points.length; i++) {
    const p: MapPointVM = points[i];
    out.push({
      seatId: p.seatId,
      no: p.no,
      status: p.status,
      color: p.color,
      leftPct: p.leftPct,
      topPct: p.topPct,
      widthPct: p.widthPct,
      heightPct: p.heightPct,
      reservable: pickable(mode, p.status),
      tileUrl: p.tileUrl,
      imgScaleX: p.imgScaleX,
      imgScaleY: p.imgScaleY,
      imgOffsetX: p.imgOffsetX,
      imgOffsetY: p.imgOffsetY,
    });
  }
  return out;
}

/** 方格兜底排序（对齐 Android compareBy(SeatNumberComparator) { it.no }）：服务端顺序是乱的。 */
export function sortedSeatsForGrid(seats: WireSeat[]): WireSeat[] {
  const out: WireSeat[] = seats.slice();
  out.sort((a: WireSeat, b: WireSeat): number => {
    const an: string = a.no.length > 0 ? a.no : a.id;
    const bn: string = b.no.length > 0 ? b.no : b.id;
    return compareSeatNumber(an, bn);
  });
  return out;
}

/** Picker 底栏一行的展示数据（避免页面里拼动态对象字面量）。 */
export interface PickedLabel {
  no: string;
  statusShort: string;
}

/** Picker 底栏已选文案（对齐 Android PickerBottomBar）。 */
export function pickedSummary(mode: FormMode, picked: PickedLabel[]): string {
  if (picked.length === 0) {
    return mode === FormMode.PREFER ? '未指定座位（不限：谁先空抢谁）' : '未选择座位';
  }
  const parts: string[] = [];
  for (let i = 0; i < picked.length; i++) {
    if (mode === FormMode.PREFER) {
      parts.push((i + 1) + '.' + picked[i].no + ' → ' + picked[i].statusShort);
    } else {
      parts.push(picked[i].no + '（' + picked[i].statusShort + '）');
    }
  }
  return parts.join('  ');
}

/** Picker 确认按钮文案（对齐 Android PickerBottomBar）。 */
export function pickerConfirmLabel(mode: FormMode, count: number): string {
  if (mode === FormMode.MONITOR) return '确定监控这个座位';
  if (count === 0) return '不限座位，返回';
  return '确定（' + count + ' 个）';
}

/** Picker 确认守卫：MONITOR 没选座不放行；其余放行。null=放行。 */
export function pickerGuard(mode: FormMode, count: number): string | null {
  if (mode === FormMode.MONITOR && count === 0) return '请点选一个要监控的座位';
  return null;
}

/** Reserve 底栏主按钮文案（对齐 Android ReserveBottomBar）。 */
export function reserveButtonLabel(no: string): string {
  return no.length > 0 ? '预约 ' + no : '立即预约';
}

/** Reserve 底栏无选中时的轻提示（Android 用 snackbar，鸿蒙用底栏内文案）。 */
export function reserveHint(no: string): string {
  return no.length > 0 ? '' : '请先在图上点选一个座位';
}

/** 是否显示「取消预约」而不是「预约」（对齐 Android selectedSeat.status == MINE）。 */
export function isCancelInstead(status: WireSeatStatus): boolean {
  return status === WireSeatStatus.MINE;
}

/** 状态短文案（对齐 Android SeatColors.shortLabel）。 */
export function statusShortLabel(status: WireSeatStatus): string {
  switch (status) {
    case WireSeatStatus.AVAILABLE: return '空闲';
    case WireSeatStatus.RESERVED: return '已预约';
    case WireSeatStatus.MINE: return '我已预约';
    case WireSeatStatus.IN_USE: return '在用';
    case WireSeatStatus.LEAVE: return '暂离';
    default: return '停用';
  }
}

/** 地图模式判定：有一张可用底图 且 所有座位都有坐标（对齐 Android SeatMapCanvas 条件）。 */
export function canUseMapCanvas(hasImage: boolean, seats: WireSeat[]): boolean {
  if (!hasImage) return false;
  for (let i = 0; i < seats.length; i++) {
    const s: WireSeat = seats[i];
    if (s.pointX === null || s.pointY === null || s.width === null || s.height === null) return false;
  }
  return true;
}
