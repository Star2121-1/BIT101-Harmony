/**
 * 座位数据模型（M9）
 *
 * 对照 Android Seat.kt：
 * - point_x/point_y/width/height 是**底图百分比**（服务端实测全量有值）
 * - status 为服务端数字码（1=空闲, 2/10/11=已预约, 6/8/9=在用, 7=临时离开, 3/4/5=暂停）
 * - hasMapPosition 判断四项坐标是否齐全
 */

/** 服务端返回的座位状态码。 */
export enum SeatStatus {
  AVAILABLE = 1,          // 空闲
  RESERVED = 2,           // 已预约（含他人）
  RESERVED_YOURS = 10,    // 我已预约（与 RESERVED 同码，需交叉比对）
  RESERVED_OTHERS = 11,   // 他人已预约
  IN_USE = 6,             // 使用中
  LEAVE = 7,              // 临时离开
  UNAVAILABLE = 3,        // 暂停使用
  BLOCKED = 4,            // 锁定
  MAINTENANCE = 5,        // 维护中
}

/** 座位数据（来自 /api/seat/map 接口）。 */
export interface Seat {
  id: string;
  no: string;              // 座位号（如 "001"）
  status: number;          // 服务端状态码
  areaId: string | null;   // 所属区域 ID
  /** 底图坐标：百分比（0-100）。全量有值。 */
  pointX: number | null;
  pointY: number | null;
  width: number | null;
  height: number | null;
}

/** 座位是否具备底图定位能力（四项坐标齐全）。 */
export function hasMapPosition(seat: Seat): boolean {
  return seat.pointX != null && seat.pointY != null &&
         seat.width != null && seat.height != null;
}

/** 将服务端状态码映射为可读文案。 */
export function statusText(status: number): string {
  switch (status) {
    case SeatStatus.AVAILABLE: return '空闲';
    case SeatStatus.RESERVED:
    case SeatStatus.RESERVED_YOURS:
    case SeatStatus.RESERVED_OTHERS: return '已预约';
    case SeatStatus.IN_USE: return '使用中';
    case SeatStatus.LEAVE: return '临时离开';
    case SeatStatus.UNAVAILABLE:
    case SeatStatus.BLOCKED:
    case SeatStatus.MAINTENANCE: return '暂停使用';
    default: return '未知';
  }
}

/** 将服务端状态码映射为颜色（浅色模式）。 */
export function statusColor(status: number, isDark: boolean): string {
  const dark = isDark ? '#' : '#';
  switch (status) {
    case SeatStatus.AVAILABLE:
      return isDark ? '#2E7D32' : '#4CAF50';
    case SeatStatus.RESERVED:
    case SeatStatus.RESERVED_YOURS:
      return isDark ? '#1565C0' : '#1976D2';
    case SeatStatus.RESERVED_OTHERS:
      return isDark ? '#C62828' : '#E53935';
    case SeatStatus.IN_USE:
      return isDark ? '#2E7D32' : '#43A047';
    case SeatStatus.LEAVE:
      return isDark ? '#F57C00' : '#FF9800';
    case SeatStatus.UNAVAILABLE:
    case SeatStatus.BLOCKED:
    case SeatStatus.MAINTENANCE:
      return isDark ? '#455A64' : '#B0BEC5';
    default:
      return isDark ? '#37474F' : '#90A4AE';
  }
}
