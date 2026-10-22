/**
 * 座位预约服务（M9）—— 薄 @kit 网络壳。
 *
 * ## 铁律 0.9 修复（2026-10-22）
 * 早期本文件用了**臆造端点**（`/api/Seat/schedule`、`/api/Seat/reserve`、
 * `/api/Seat/cancel`）+ 自造 body，与 Android 实测契约不符，对真实服务端全挂。
 * 现在：**端点 / body / 解析 / 状态映射全部委托 `SeatApiLogic`（纯逻辑、可单测），**
 * 本类只保留 @kit 网络 + TLS CA + cookie 罐 + JWT 认证头，不含任何业务判断。
 *
 * ## 认证模型（2026-10-22 真机探针 + Android 契约核对，铁律 0.9）
 * - Android 侧 authed 端点（SeatApi.kt:105-133）**两头都发**：
 *   ① 请求头 `Authorization: bearer<jwt>` —— **小写 bearer、无空格**（不是 RFC 的 `Bearer <jwt>`）；
 *   ② **请求体 JSON 里带 `authorization: bearer<jwt>` 字段**（`SeatApi.jsonBody`，每个业务请求都带）。
 * - 免认证端点（`/api/Seat/tree`）：**完全不带 Authorization 键** ——
 *   带空 `Bearer ` 反而 10001（2026-10-22 真机实测：服务端对「有头但无效」与「无头」是两种处理）。
 * - ⚠️ JWT 会过期（服务端死 token，静默续期靠 phpCAS cookie；cookie 也死就要用户显式登录，
 *   铁律 0.6：凭据登录必须用户发起，自动路径只走 cookie 续期）。
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
  Endpoint,
  type WireSeat, type WireSeatDate, type MyReservation, type RenegeRecord,
  type SeatMapImages,
  parseSeats, parseSeatDates, parseMyReservations, parseRenege, parseSeatMap,
  emptySeatMapImages,
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
    info('SeatService session built (JAR_SEAT, TLS CA)');
  }

  /** 取已存的 seatlib 会话信息（JWT 模型）。 */
  static async getSession(context: Context): Promise<{ jwt: string; studentId: string; displayName: string } | null> {
    try {
      // ArkTS 禁解构赋值（arkts-no-destruct-assignment）⇒ Promise.all 元组走索引
      const sess = await Promise.all([
        SessionStore.getToken(),
        SessionStore.getStudentId(),
        SessionStore.getDisplayName(),
      ]);
      const jwt: string = sess[0];
      const studentId: string = sess[1];
      const displayName: string = sess[2];
      if (jwt.length === 0) return null;
      return { jwt, studentId, displayName };
    } catch (e) {
      warn('getSession fail: ' + JSON.stringify(e));
      return null;
    }
  }

  /**
   * 业务端点的公共请求头（JWT 认证 + 桌面 UA + 语言）。
   * ⚠️ 格式对齐 Android SeatApi.kt:108 —— `bearer<jwt>` **小写无空格**；
   * jwt 为空时不放 Authorization 键（免认证端点专用，见类注释）。
   */
  private headers(jwt: string): rcp.RequestHeaders {
    const h: rcp.RequestHeaders = {
      'User-Agent': DESKTOP_UA,
      'Accept-Language': 'zh-CN,zh;q=0.9',
      'Content-Type': 'application/json',
      'lang': 'zh',
    };
    if (jwt.length > 0) {
      h['Authorization'] = 'bearer' + jwt;
    }
    return h;
  }

  /** 发一个 authed POST，返回解析后的业务信封（含 code）。
   *  ⚠️ body 统一注入 `authorization: bearer<jwt>` 字段（对齐 Android SeatApi.jsonBody）——
   *  服务端两头都认，Android 两头都发；只发头不带体字段会 10001（2026-10-22 真机实测）。 */
  private async postJson(context: Context, path: string, body: Record<string, Object>, jwt: string): Promise<Record<string, Object>> {
    await this.ensureSession(context);
    const session = this.session;
    if (session === null) throw new Error('rcp session 未初始化');
    const finalBody: Record<string, Object> = {};
    if (jwt.length > 0) {
      finalBody['authorization'] = 'bearer' + jwt;
    }
    const keys: string[] = Object.keys(body);
    for (let i = 0; i < keys.length; i++) {
      finalBody[keys[i]] = body[keys[i]];
    }
    const res = await RcpFactory.postText(session, SEATLIB_BASE + path, this.headers(jwt), JSON.stringify(finalBody));
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
      const envelope = await this.postJson(context, Endpoint.SEAT,
        buildSeatBody(area, usableSegment(segment), day, startTime, endTime), jwt);
      const biz = bizResult(envelope);
      if (!biz.ok) return { ok: false, message: biz.message, seats: [] };
      const data: Array<Record<string, Object>> = Array.isArray(biz.data)
        ? (biz.data as Array<Record<string, Object>>) : [];
      return { ok: true, message: null, seats: parseSeats(data, area) };
    } catch (e) {
      bitError('fetchSeats fail: ' + JSON.stringify(e));
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
      const envelope = await this.postJson(context, Endpoint.DATE, body, jwt);
      const biz = bizResult(envelope);
      if (!biz.ok) return { ok: false, message: biz.message, dates: [] };
      const data: Array<Record<string, Object>> = Array.isArray(biz.data)
        ? (biz.data as Array<Record<string, Object>>) : [];
      return { ok: true, message: null, dates: parseSeatDates(data) };
    } catch (e) {
      bitError('fetchSeatDates fail: ' + JSON.stringify(e));
      return { ok: false, message: (e as Error).message, dates: [] };
    }
  }

  /**
   * 预约确认（POST /api/Seat/confirm，body {seat_id(int), segment}）。
   * ⚠️ 有对外副作用，仅由 UI 用户显式点击触发（铁律 0.6）。
   */
  async confirmSeat(context: Context, jwt: string, seatId: string, segment: string): Promise<SeatOpResult> {
    try {
      const envelope = await this.postJson(context, Endpoint.CONFIRM,
        buildConfirmBody(seatId, segment), jwt);
      const biz = bizResult(envelope);
      return biz.ok
        ? { ok: true, message: null }
        : { ok: false, message: biz.message };
    } catch (e) {
      bitError('confirmSeat fail: ' + JSON.stringify(e));
      return { ok: false, message: (e as Error).message };
    }
  }

  /** 我的座位预约（POST /api/index/subscribe，body {type:'1'}）。 */
  async myReservations(context: Context, jwt: string): Promise<{ ok: boolean; message: string | null; records: MyReservation[] }> {
    try {
      const envelope = await this.postJson(context, Endpoint.SUBSCRIBE, buildSubscribeBody(), jwt);
      const biz = bizResult(envelope);
      if (!biz.ok) return { ok: false, message: biz.message, records: [] };
      const data: Array<Record<string, Object>> = Array.isArray(biz.data)
        ? (biz.data as Array<Record<string, Object>>) : [];
      return { ok: true, message: null, records: parseMyReservations(data) };
    } catch (e) {
      bitError('myReservations fail: ' + JSON.stringify(e));
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
      const envelope = await this.postJson(context, Endpoint.CANCEL,
        buildCancelBody(recordId), jwt);
      const biz = bizResult(envelope);
      return biz.ok
        ? { ok: true, message: null }
        : { ok: false, message: biz.message };
    } catch (e) {
      bitError('cancelReservation fail: ' + JSON.stringify(e));
      return { ok: false, message: (e as Error).message };
    }
  }

  /** 我的违约记录（POST /api/Member/reneges，type 1=座位 2=研讨室）。 */
  async reneges(context: Context, jwt: string, type: number): Promise<{ ok: boolean; message: string | null; records: RenegeRecord[] }> {
    try {
      const envelope = await this.postJson(context, Endpoint.RENEGES, buildRenegeBody(type), jwt);
      const biz = bizResult(envelope);
      if (!biz.ok) return { ok: false, message: biz.message, records: [] };
      const data: Array<Record<string, Object>> = Array.isArray(biz.data)
        ? (biz.data as Array<Record<string, Object>>) : [];
      return { ok: true, message: null, records: parseRenege(data) };
    } catch (e) {
      bitError('reneges fail: ' + JSON.stringify(e));
      return { ok: false, message: (e as Error).message, records: [] };
    }
  }

  /** 取区域底图（POST /api/seat/map，body {id}；区域没配底图时服务端直接 500，按失败回落方格）。
   *  2026-10-22 真机实测：data = {free,book,close,leave,use} 五个 1920×1080 URL。 */
  async seatMap(context: Context, jwt: string, areaId: string): Promise<{ ok: boolean; message: string | null; images: SeatMapImages }> {
    try {
      const envelope = await this.postJson(context, Endpoint.MAP, buildMapBody(areaId), jwt);
      const biz = bizResult(envelope);
      if (!biz.ok) return { ok: false, message: biz.message, images: emptySeatMapImages() };
      const data: Record<string, Object> | null =
        (biz.data !== null && biz.data !== undefined && typeof biz.data === 'object' && !Array.isArray(biz.data))
          ? biz.data as Record<string, Object> : null;
      return { ok: true, message: null, images: parseSeatMap(data) };
    } catch (e) {
      bitError('seatMap fail: ' + JSON.stringify(e));
      return { ok: false, message: (e as Error).message, images: emptySeatMapImages() };
    }
  }

  /** 我的研讨间预约（POST /api/Member/seminar，body {}）。 */
  async seminarReservations(context: Context, jwt: string): Promise<{ ok: boolean; message: string | null; raw: string }> {
    try {
      const envelope = await this.postJson(context, Endpoint.SEMINAR, buildSeminarBody(), jwt);
      const biz = bizResult(envelope);
      if (!biz.ok) return { ok: false, message: biz.message, raw: '' };
      return { ok: true, message: null, raw: JSON.stringify(biz.data ?? []) };
    } catch (e) {
      bitError('seminarReservations fail: ' + JSON.stringify(e));
      return { ok: false, message: (e as Error).message, raw: '' };
    }
  }

  /** 清 JAR_SEAT 罐（登出时调用；JWT 模型下基本无内容，保留以对齐 cookie 模型）。 */
  static async clearSession(): Promise<number> {
    return RcpFactory.clearRepoCookies(JAR_SEAT);
  }
}
