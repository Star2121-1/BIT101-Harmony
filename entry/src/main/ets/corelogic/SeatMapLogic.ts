/**
 * 座位地图逻辑层（M9-3）
 *
 * 核心功能：
 * 1. 缩放/平移视口
 * 2. 点击座位判定
 * 3. 选中状态管理
 */

import {
  pctToScreen as modelPctToScreen,
  screenToPct as modelScreenToPct,
  isPointInSeat as modelIsPointInSeat,
  IMAGE_BASE_WIDTH,
  IMAGE_BASE_HEIGHT,
} from '../model/SeatMapModel.ts';

/** 视口状态（缩放 + 偏移）。 */
export interface ViewportState {
  scale: number;
  offsetX: number;
  offsetY: number;
}

/** 初始视口参数（折中缩放 1.8 倍，图与视口双向居中）。 */
export const INITIAL_VIEWPORT: ViewportState = {
  scale: 1.8,
  offsetX: 0,
  offsetY: 0,
};

/**
 * 计算初始视口偏移（使底图在视口中居中）。
 *
 * @param viewportW 视口宽度（像素）
 * @param viewportH 视口高度（像素）
 * @param imageW 底图原始宽度
 * @param imageH 底图原始高度
 * @param scale 缩放比例
 * @returns 偏移量 { offsetX, offsetY }
 */
export function calcInitialOffset(
  viewportW: number,
  viewportH: number,
  imageW: number = IMAGE_BASE_WIDTH,
  imageH: number = IMAGE_BASE_HEIGHT,
  scale: number = INITIAL_VIEWPORT.scale
): { offsetX: number; offsetY: number } {
  const scaledW = imageW * scale;
  const scaledH = imageH * scale;
  return {
    offsetX: (viewportW - scaledW) / 2,
    offsetY: (viewportH - scaledH) / 2,
  };
}

/**
 * 根据点击坐标（屏幕像素）和视口状态，反算底图上的百分比坐标。
 *
 * 对齐 Android SeatMapCanvas.kt 的触控处理逻辑。
 */
export function screenPointToSeatPct(
  touchX: number,
  touchY: number,
  viewportW: number,
  viewportH: number,
  viewport: ViewportState
): { pctX: number; pctY: number } {
  // 1. 减去偏移，得到在缩放后图像中的坐标
  const adjustedX = (touchX - viewport.offsetX) / viewport.scale;
  const adjustedY = (touchY - viewport.offsetY) / viewport.scale;
  // 2. 换算为底图原始坐标（0-1920, 0-1080）
  const rawX = adjustedX / viewportW * IMAGE_BASE_WIDTH;
  const rawY = adjustedY / viewportH * IMAGE_BASE_HEIGHT;
  // 3. 换算为百分比坐标
  return {
    pctX: rawX / IMAGE_BASE_WIDTH * 100,
    pctY: rawY / IMAGE_BASE_HEIGHT * 100,
  };
}

/**
 * 在座位列表中查找被点击的座位。
 *
 * @param seats 座位列表（含坐标信息）
 * @param pctX 点击的百分比横坐标
 * @param pctY 点击的百分比纵坐标
 * @returns 匹配的座位 ID，未找到返回 null
 */
export function findSeatAtPosition(
  seats: Array<{ seatId: string; pointX: number; pointY: number; width: number; height: number }>,
  pctX: number,
  pctY: number
): string | null {
  for (const seat of seats) {
    if (!seat.pointX || !seat.pointY || !seat.width || !seat.height) {
      continue;
    }
    if (modelIsPointInSeat(pctX, pctY, {
      pointX: seat.pointX,
      pointY: seat.pointY,
      width: seat.width,
      height: seat.height,
    })) {
      return seat.seatId;
    }
  }
  return null;
}

/**
 * 计算选中的座位列表（支持多选）。
 */
export function updateSelectedSeats(
  selectedIds: Set<string>,
  seatId: string,
  multiSelect: boolean
): Set<string> {
  const next = new Set(selectedIds);
  if (multiSelect) {
    if (next.has(seatId)) {
      next.delete(seatId);
    } else {
      next.add(seatId);
    }
  } else {
    // 单选模式：清空其他，只保留当前
    next.clear();
    next.add(seatId);
  }
  return next;
}

/**
 * 计算可视区域内的座位（用于优化渲染，只画可见座位）。
 */
export function getVisibleSeats(
  seats: Array<{ pointX: number; pointY: number; width: number; height: number }>,
  viewport: ViewportState,
  viewportW: number,
  viewportH: number
): Array<{ pointX: number; pointY: number; width: number; height: number }> {
  // 计算视口在底图坐标系中的范围（百分比）
  const topLeft = screenPointToSeatPct(0, 0, viewportW, viewportH, viewport);
  const bottomRight = screenPointToSeatPct(viewportW, viewportH, viewportW, viewportH, viewport);

  return seats.filter(seat => {
    if (!seat.pointX || !seat.pointY || !seat.width || !seat.height) return false;
    // 检查座位是否与视口有交集
    return !(
      seat.pointX + seat.width < topLeft.pctX ||
      seat.pointX > bottomRight.pctX ||
      seat.pointY + seat.height < topLeft.pctY ||
      seat.pointY > bottomRight.pctY
    );
  });
}

// Re-export for convenience
export { pctToScreen, screenToPct, isPointInSeat, IMAGE_BASE_WIDTH, IMAGE_BASE_HEIGHT } from '../model/SeatMapModel.ts';
