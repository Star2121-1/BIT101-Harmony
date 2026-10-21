/**
 * 座位地图数据层（M9-3）
 *
 * 负责将 /api/seat/map 返回的原始数据转换为可用于渲染和交互的数据结构。
 */

/**
 * 来自 /api/seat/map 的单个座位数据（含坐标）。
 */
export interface SeatMapEntry {
  /** 座位 ID（与服务端 /api/seat/status 返回的 seatId 一致）。 */
  seatId: string;
  /** 座位号（如 "001"）。 */
  seatNo: string;
  /** 所属区域 ID。 */
  areaId: string;
  /** 底图坐标：百分比（0-100）。 */
  pointX: number;
  pointY: number;
  width: number;
  height: number;
  /** 当前状态码（与 /api/seat/status 的 status 字段一致）。 */
  status: number;
}

/**
 * 座位在地图上的坐标（百分比）。
 */
export interface SeatMapPosition {
  pointX: number;
  pointY: number;
  width: number;
  height: number;
}

/**
 * 将 SeatMapEntry 列表转换为 SeatMapPosition 数组，便于碰撞检测。
 */
export function toMapPositions(entries: SeatMapEntry[]): SeatMapPosition[] {
  return entries.map(e => ({
    pointX: e.pointX,
    pointY: e.pointY,
    width: e.width,
    height: e.height,
  }));
}

/**
 * 根据 seatId 查找对应的坐标信息。
 */
export function findPosition(entries: SeatMapEntry[], seatId: string): SeatMapPosition | null {
  for (const e of entries) {
    if (e.seatId === seatId) {
      return {
        pointX: e.pointX,
        pointY: e.pointY,
        width: e.width,
        height: e.height,
      };
    }
  }
  return null;
}
