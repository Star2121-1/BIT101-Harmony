/**
 * SeatService → ISeatService 适配器（M9-8）。
 *
 * ## 背景（铁律 0.9 / 契约未落地的缺口）
 * `SeatService` 是老式网络壳，方法签名是 `(context, jwt, ...)`（JWT 模型下每次自取 jwt）；
 * M9-8 定义的 `ISeatService` 是新契约（无 context/jwt，内部自取），但此前 `SeatService`
 * **从未实现**它——这就是监控 UI / 轮询编译卡住的根因。
 * 本适配器桥接二者，不改动 `SeatService` 既有行为。
 *
 * ## 设计纪律
 * - 所有 jwt 现取（可能过期；过期由调用方/UI 处理，铁律 0.6：登录必须用户发起）。
 * - `confirmReservation` 只把 seatId + segment 喂给 `confirmSeat`（服务端按座位现态确认时段），
 *   忽略 startTime/endTime（与 `SeatService.confirmSeat` 签名对齐）。
 * - `getMyReservations` 监控流程用不到，返回空数组（契约占位，不假造数据）。
 */

import { Context } from '@kit.AbilityKit';
import type { ISeatService, SeatData, ReserveResult } from '../corelogic/ISeatService.ts';
import { SeatService } from './SeatService.ts';
import { SessionStore } from '../data/SessionStore.ts';
import { WireSeatStatus } from '../corelogic/SeatApiLogic.ts';

export class SeatServiceMonitorAdapter implements ISeatService {
  constructor(private context: Context, private inner: SeatService = new SeatService()) {}

  /** 现取 jwt（失败时退空串，由上层按「未登录」处理）。 */
  private async jwt(): Promise<string> {
    try {
      return await SessionStore.getToken();
    } catch {
      return '';
    }
  }

  async checkLoginStatus(): Promise<boolean> {
    try {
      const s = await SeatService.getSession(this.context);
      return s !== null;
    } catch {
      return false;
    }
  }

  async getAvailableSeats(
    areaId: string, segment: string, reserveDate: string, startTime: string, endTime: string
  ): Promise<SeatData[]> {
    const jwt = await this.jwt();
    const r = await this.inner.fetchSeats(this.context, jwt, areaId, segment, reserveDate, startTime, endTime);
    if (!r.ok) return [];
    return r.seats
      .filter((s) => s.id.length > 0)
      .map((s) => ({
        id: s.id,
        no: s.no,
        // status 仅为契约占位：1=空闲，0=其余。decideNext 只用 id/no，不参与决策。
        status: s.status === WireSeatStatus.AVAILABLE ? 1 : 0,
      }));
  }

  async confirmReservation(seatId: string, segmentId: string): Promise<ReserveResult> {
    const jwt = await this.jwt();
    const r = await this.inner.confirmSeat(this.context, jwt, seatId, segmentId);
    return { ok: r.ok, message: r.message ?? '' };
  }

  async cancelReservation(reservationId: string): Promise<ReserveResult> {
    const jwt = await this.jwt();
    const r = await this.inner.cancelReservation(this.context, jwt, reservationId);
    return { ok: r.ok, message: r.message ?? '' };
  }

  async getMyReservations(): Promise<import('../model/SeatModel.ts').Seat[]> {
    return [];
  }
}
