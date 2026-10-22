/**
 * 座位预约服务（M9）—— 薄 @kit 网络壳。
 *
 * ## 铁律 0.9 修复（2026-10-22）
 * 早期本文件用了**臆造端点**（`/api/Seat/schedule`、`/api/Seat/reserve`、
 * `/api/Seat/cancel`）+ 自造 body，与 Android 实测契约不符，对真实服务端全挂。
 * 现在：**端点 / body / 解析 / 状态映射全部委托 `SeatApiLogic`（纯逻辑、可单测），**
 * 本类只保留 @kit 网络 + TLS CA + cookie 罐 + JWT 认证头，不含任何业务判断。
 *
 * ## 认证模型（M1 探针已验，与 Android 有差异，如实标注）
 * - Android 侧 seatlib 走 **cookie**（CAS WebView 登录后的 cookie jar）；
 * - 鸿蒙侧 M1 探针验证了 **Bearer JWT**（`/api/cas/cas` 换 token，存 SessionStore）可过 seatlib。
 *   这里沿用 JWT 模型（`Authorization: Bearer <jwt>`）。
 * - ⚠️ **真机未复核**：设备离线中，JWT 头对「我的预约/取消/违约」这些 authed 端点是否
 *   全通需设备恢复后回归；若服务端只认 cookie，则需把 `JAR_SEAT` 罐接入 CAS 登录链路。
 *
 * ## 设计纪律（铁律 0.6）
 * 有对外副作用的动作（confirm/cancel）只由 UI 显式点击触发，绝不上自动路径。
 */

import { rcp } from '@kit.RemoteCommunicationKit';
import util from '@ohos.util';
import { Context } from '@kit.AbilityKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { JAR_SEAT } from '../core/net/CookieJars.ts';
import { RcpFactory } from '../core/net/RcpFactory.ts';
import { SessionStore } from '../data/SessionStore.ts';
import {
  ENDPOINTS,
  type WireSeat, type WireSeatDate, type MyReservation, type RenegeRecord,
  parseSeats, parseSeatDates, parseMyReservations, parseRenege,
  buildSeatBody, buildConfirmBody, buildSubscribeBody, buildCancelBody,
  buildMapBody, buildRenegeBody, buildSeminarBody,
  bizResult, usableSegment,
} from '../corelogic/SeatApiLogic.ts';
import { info, warn, error as bitError } from '../core/log/BitLog.ts';

const HLOG_DOMAIN: number = 0x00AB;
const HLOG_TAG: string = 'BIT101Seat';

const SEATLIB_BASE: string = 'https://seatlib.bit.edu.cn';
const DESKTOP_UA: string =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const CONNECT_MS: number = 15000;
const READ_MS: number = 30000;

/** 业务响应结果（成功 / 失败带文案）。 */
export interface SeatOpResult {
  ok: boolean;
  /** 成功时为 null；失败为可读文案（bizResult 已保证不拼「预约失败」前缀）。 */
  message: string | null;
}

/** 取座位的结果。 */
export interface SeatsResult {
  ok: boolean;
  message: string | null;
  seats: WireSeat[];
}

/** 时段列表结果。 */
export interface DatesResult {
  ok: boolean;
  message: string | null;
  dates: WireSeatDate[];
}

export class SeatService {
  private session: rcp.Session | null = null;
  private sessionPromise: Promise<void> | null = null;

  private async ensureSession(context: Context): Promise<void> {
    if (this.session !== null) return;
    if (this.sessionPromise === null) {
      this.sessionPromise = this.buildSession(context);
    }
    await this.sessionPromise;
  }

  private async buildSession(context: Context): Promise<void> {
    // seatlib 走独立 cookie 罐 JAR_SEAT（JWT 模型下罐基本为空，但保留隔离，便于切回 cookie 模型）。
    // autoRedirect=false：seatlib 未登录时会 302 踢去 CAS，跟跳会丢 effectiveUrl（M1 验过）。
    this.session = await RcpFactory.createSession(context, JAR_SEAT, false, CONNECT_MS, READ_MS);
    this.sessionPromise = null;
    info(HLOG_DOMAIN, HLOG_TAG, 'SeatService session built (JAR_SEAT, TLS CA)');
  }

  /** 取已存的 seatlib 会话信息（JWT 模型）。 */
  static async getSession(context: Context): Promise<{ jwt: string; studentId: string; displayName: string } | null> {
    try {
      const [jwt, studentId, displayName] = await Promise.all([
        SessionStore.getToken(),
        SessionStore.getStudentId(),
        SessionStore.getDisplayName(),
      ]);
      if (jwt.length === 0) return null;
      return { jwt, studentId, displayName };
    } catch (e) {
      warn(HLOG_DOMAIN, HLOG_TAG, 'getSession fail: ' + JSON.stringify(e));
      return null;
    }
  }

  /** 业务端点的公共请求头（JWT 认证 + 桌面 UA + 语言）。 */
  private headers(jwt: string): rcp.RequestHeaders {
    return {
      'Authorization': `Bearer ${jwt}`,
      'User-Agent': DESKTOP_UA,
      'Accept-Language': 'zh-CN,zh;q=0.9',
      'Content-Type': 'application/json',
      'lang': 'zh',
    };
  }

  /** 发一个 authed POST，返回解析后的业务信封（含 code）。 */
  private async postJson(context: Context, path: string, body: Record<string, Object>, jwt: string): Promise<Record<string, Object>> {
    await this.ensureSession(context);
    const session = this.session;
    if (session === null) throw new Error('rcp session 未初始化');
    const res = await RcpFactory.postText(session, SEATLIB_BASE + path, this.headers(jwt), JSON.stringify(body));
    let envelope: Record<string, Object>;
    try {
      envelope = JSON.parse(res.body) as Record<string, Object>;
    } catch {
      throw new Error('响应解析失败（HTTP ' + res.status + '）');
    }
    return envelope;
  }

  /**
   * 取某区域某时段的座位（POST /api/Seat/seat）。
   * ⚠️ authed：需要 seatlib 会话。免认证的只有 /api/Seat/tree。
   */
  async fetchSeats(
    context: Context,
    jwt: string,
    area: string, segment: string, day: string, startTime: string, endTime: string
  ): Promise<SeatsResult> {
    try {
      const envelope = await this.postJson(context, ENDPOINTS.seat,
        buildSeatBody(area, usableSegment(segment), day, startTime, endTime), jwt);
      const biz = bizResult(envelope);
      if (!biz.ok) return { ok: false, message: biz.message, seats: [] };
      const data: Array<Record<string, Object>> = Array.isArray(biz.data)
        ? (biz.data as Array<Record<string, Object>>) : [];
      return { ok: true, message: null, seats: parseSeats(data, area) };
    } catch (e) {
      bitError(HLOG_DOMAIN, HLOG_TAG, 'fetchSeats fail: ' + JSON.stringify(e));
      return { ok: false, message: (e as Error).message, seats: [] };
    }
  }

  /** 取时段（POST /api/Seat/date，可带 build_id；times[].id 实测恒 null，回落默认段是正常路径）。 */
  async fetchSeatDates(context: Context, jwt: string, buildId: string = ''): Promise<DatesResult> {
    try {
      const body: Record<string, Object> = {};
      if (buildId.length > 0) {
        body['build_id'] = buildId;
      }
      const envelope = await this.postJson(context, ENDPOINTS.date, body, jwt);
      const biz = bizResult(envelope);
      if (!biz.ok) return { ok: false, message: biz.message, dates: [] };
      const data: Array<Record<string, Object>> = Array.isArray(biz.data)
        ? (biz.data as Array<Record<string, Object>>) : [];
      return { ok: true, message: null, dates: parseSeatDates(data) };
    } catch (e) {
      bitError(HLOG_DOMAIN, HLOG_TAG, 'fetchSeatDates fail: ' + JSON.stringify(e));
      return { ok: false, message: (e as Error).message, dates: [] };
    }
  }

  /**
   * 预约确认（POST /api/Seat/confirm，body {seat_id(int), segment}）。
   * ⚠️ 有对外副作用，仅由 UI 用户显式点击触发（铁律 0.6）。
   */
  async confirmSeat(context: Context, jwt: string, seatId: string, segment: string): Promise<SeatOpResult> {
    try {
      const envelope = await this.postJson(context, ENDPOINTS.confirm,
        buildConfirmBody(seatId, segment), jwt);
      const biz = bizResult(envelope);
      return biz.ok
        ? { ok: true, message: null }
        : { ok: false, message: biz.message };
    } catch (e) {
      bitError(HLOG_DOMAIN, HLOG_TAG, 'confirmSeat fail: ' + JSON.stringify(e));
      return { ok: false, message: (e as Error).message };
    }
  }

  /** 我的座位预约（POST /api/index/subscribe，body {type:'1'}）。 */
  async myReservations(context: Context, jwt: string): Promise<{ ok: boolean; message: string | null; records: MyReservation[] }> {
    try {
      const envelope = await this.postJson(context, ENDPOINTS.subscribe, buildSubscribeBody(), jwt);
      const biz = bizResult(envelope);
      if (!biz.ok) return { ok: false, message: biz.message, records: [] };
      const data: Array<Record<string, Object>> = Array.isArray(biz.data)
        ? (biz.data as Array<Record<string, Object>>) : [];
      return { ok: true, message: null, records: parseMyReservations(data) };
    } catch (e) {
      bitError(HLOG_DOMAIN, HLOG_TAG, 'myReservations fail: ' + JSON.stringify(e));
      return { ok: false, message: (e as Error).message, records: [] };
    }
  }

  /**
   * 取消预约（POST /api/Space/cancel，body {id=预约记录id}）。
   * ⚠️ 传座位 id 恒失败（2026-09-18 实测），必须先有「我的预约」拿到记录 id。
   * 有对外副作用，仅由 UI 显式触发（铁律 0.6）。
   */
  async cancelReservation(context: Context, jwt: string, recordId: string): Promise<SeatOpResult> {
    try {
      const envelope = await this.postJson(context, ENDPOINTS.cancel,
        buildCancelBody(recordId), jwt);
      const biz = bizResult(envelope);
      return biz.ok
        ? { ok: true, message: null }
        : { ok: false, message: biz.message };
    } catch (e) {
      bitError(HLOG_DOMAIN, HLOG_TAG, 'cancelReservation fail: ' + JSON.stringify(e));
      return { ok: false, message: (e as Error).message };
    }
  }

  /** 我的违约记录（POST /api/Member/reneges，type 1=座位 2=研讨室）。 */
  async reneges(context: Context, jwt: string, type: number): Promise<{ ok: boolean; message: string | null; records: RenegeRecord[] }> {
    try {
      const envelope = await this.postJson(context, ENDPOINTS.reneges, buildRenegeBody(type), jwt);
      const biz = bizResult(envelope);
      if (!biz.ok) return { ok: false, message: biz.message, records: [] };
      const data: Array<Record<string, Object>> = Array.isArray(biz.data)
        ? (biz.data as Array<Record<string, Object>>) : [];
      return { ok: true, message: null, records: parseRenege(data) };
    } catch (e) {
      bitError(HLOG_DOMAIN, HLOG_TAG, 'reneges fail: ' + JSON.stringify(e));
      return { ok: false, message: (e as Error).message, records: [] };
    }
  }

  /** 取区域底图（POST /api/seat/map，body {id}；区域没配底图时服务端直接 500，按失败回落方格）。 */
  async seatMap(context: Context, jwt: string, areaId: string): Promise<{ ok: boolean; message: string | null; raw: string }> {
    try {
      const envelope = await this.postJson(context, ENDPOINTS.map, buildMapBody(areaId), jwt);
      const biz = bizResult(envelope);
      if (!biz.ok) return { ok: false, message: biz.message, raw: '' };
      // 底图 data 是 {free,book,close,leave,use} 的 URL 对象，这里原样交给 UI 层映射
      return { ok: true, message: null, raw: JSON.stringify(biz.data ?? {}) };
    } catch (e) {
      bitError(HLOG_DOMAIN, HLOG_TAG, 'seatMap fail: ' + JSON.stringify(e));
      return { ok: false, message: (e as Error).message, raw: '' };
    }
  }

  /** 我的研讨间预约（POST /api/Member/seminar，body {}）。 */
  async seminarReservations(context: Context, jwt: string): Promise<{ ok: boolean; message: string | null; raw: string }> {
    try {
      const envelope = await this.postJson(context, ENDPOINTS.seminar, buildSeminarBody(), jwt);
      const biz = bizResult(envelope);
      if (!biz.ok) return { ok: false, message: biz.message, raw: '' };
      return { ok: true, message: null, raw: JSON.stringify(biz.data ?? []) };
    } catch (e) {
      bitError(HLOG_DOMAIN, HLOG_TAG, 'seminarReservations fail: ' + JSON.stringify(e));
      return { ok: false, message: (e as Error).message, raw: '' };
    }
  }

  /** 清 JAR_SEAT 罐（登出时调用；JWT 模型下基本无内容，保留以对齐 cookie 模型）。 */
  static async clearSession(): Promise<number> {
    return RcpFactory.clearRepoCookies(JAR_SEAT);
  }
}
