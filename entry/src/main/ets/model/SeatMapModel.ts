/**
 * 座位地图模型（M9-3）
 *
 * 对照 Android Seat.kt 和 SeatMapCanvas.kt：
 * - 坐标为百分比（服务端实测 55/55 全部有值，x 10.2~82.8、y 15.9~90.2）
 * - 底图固定 1920×1080（16:9），按视口宽度等比缩放
 * - 五张状态图各自完整，每座位只选一张显示（不叠加）
 */

/** 座位在地图上的坐标（百分比）。 */
export interface SeatMapPosition {
  pointX: number; // 0-100，左边缘百分比
  pointY: number; // 0-100，上边缘百分比
  width: number;  // 0-100，宽度百分比
  height: number; // 0-100，高度百分比
}

/** 座位地图状态（对应服务端返回的五张图）。 */
export type SeatMapImageKey = 'free' | 'book' | 'close' | 'leave' | 'use';

/** 五张状态底图的 URL 映射。 */
export interface SeatMapImages {
  free: string | null;
  book: string | null;
  close: string | null;
  leave: string | null;
  use: string | null;
}

/** 服务端 /api/seat/map 响应中的单张图数据。 */
export interface SeatMapImageEntry {
  areaId: string;
  free?: string | null;
  book?: string | null;
  close?: string | null;
  leave?: string | null;
  use?: string | null;
}

/** 从服务端响应解析出 SeatMapImages。 */
export function parseSeatMapImages(data: SeatMapImageEntry): SeatMapImages {
  return {
    free: data.free ?? null,
    book: data.book ?? null,
    close: data.close ?? null,
    leave: data.leave ?? null,
    use: data.use ?? null,
  };
}

/**
 * 根据百分比坐标和视口尺寸，计算屏幕坐标（像素）。
 *
 * 对齐 Android SeatMapCanvas.kt:
 *   val x = seat.pointX!! / 100f * cw
 *   val y = seat.pointY!! / 100f * ch
 *   val w = seat.width!! / 100f * cw
 *   val h = seat.height!! / 100f * ch
 *
 * @param pos 百分比坐标
 * @param viewportW 视口宽度（像素）
 * @param viewportH 视口高度（像素），可选；不提供时按 16:9 推算
 * @returns 屏幕坐标 { x, y, w, h }
 */
export function pctToScreen(
  pos: SeatMapPosition,
  viewportW: number,
  viewportH?: number
): { x: number; y: number; w: number; h: number } {
  const ch = viewportH ?? (viewportW * 9 / 16); // 默认 16:9 比例
  return {
    x: pos.pointX / 100 * viewportW,
    y: pos.pointY / 100 * ch,
    w: pos.width / 100 * viewportW,
    h: pos.height / 100 * ch,
  };
}

/**
 * 反向：屏幕坐标 → 百分比坐标。
 * 用于点击判定（判断点击是否落在某个座位区域内）。
 *
 * 对齐 Android SeatMapCanvas.kt:
 *   pctX >= s.pointX && pctX <= s.pointX + s.width && ...
 */
export function screenToPct(
  screenX: number,
  screenY: number,
  viewportW: number,
  viewportH?: number
): { pctX: number; pctY: number } {
  const ch = viewportH ?? (viewportW * 9 / 16);
  return {
    pctX: screenX / viewportW * 100,
    pctY: screenY / ch * 100,
  };
}

/**
 * 判断屏幕坐标是否落在座位区域内。
 *
 * 注意：右边缘和下边缘为开区间（避免相邻座位重复计算）。
 */
export function isPointInSeat(
  pctX: number,
  pctY: number,
  pos: SeatMapPosition
): boolean {
  return pctX >= pos.pointX && pctX < pos.pointX + pos.width &&
         pctY >= pos.pointY && pctY < pos.pointY + pos.height;
}

/**
 * 判断两个时间段是否有重叠（用于预约冲突检测）。
 */
export function timeRangesOverlap(
  start1: number, end1: number,
  start2: number, end2: number
): boolean {
  return start1 < end2 && start2 < end1;
}

/**
 * 获取座位对应状态图的 key。
 */
export function mapImageKeyForStatus(status: string): SeatMapImageKey | null {
  switch (status) {
    case '1': return 'free';       // 空闲
    case '2':
    case '10':
    case '11': return 'book';      // 已预约
    case '6':
    case '8':
    case '9': return 'use';        // 使用中
    case '7': return 'leave';      // 临时离开
    case '3':
    case '4':
    case '5': return 'close';      // 暂停使用
    default: return null;
  }
}

/** 底图固定宽高比（服务端返回的底图为 1920×1080 = 16:9）。 */
export const IMAGE_BASE_WIDTH = 1920;
export const IMAGE_BASE_HEIGHT = 1080;
