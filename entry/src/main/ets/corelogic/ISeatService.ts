/**
 * 座位服务接口（M9-8）。
 *
 * 定义座位服务的抽象接口，便于测试和 Mock。
 */

/** 座位数据。 */
export interface SeatData {
  id: string;
  no: string;
  status: number;
}

/** 预约结果。 */
export interface ReserveResult {
  ok: boolean;
  message: string;
  reservationId?: string;
}

/**
 * 座位服务接口。
 */
export interface ISeatService {
  /** 检查登录状态。 */
  checkLoginStatus(): Promise<boolean>;

  /** 获取可用座位列表。reserveDate 为日期(day)，startTime/endTime 为当日时段。 */
  getAvailableSeats(
    areaId: string, segment: string, reserveDate: string, startTime: string, endTime: string
  ): Promise<SeatData[]>;

  /** 确认预约。 */
  confirmReservation(seatId: string, segmentId: string, startTime: string, endTime: string): Promise<ReserveResult>;

  /** 取消预约。 */
  cancelReservation(reservationId: string): Promise<ReserveResult>;

  /** 获取我的预约列表。 */
  getMyReservations(): Promise<import('../model/SeatModel.ts').Seat[]>;
}
