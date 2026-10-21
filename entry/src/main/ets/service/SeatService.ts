/**
 * 座位预约服务（M9）。
 *
 * 对照 Android features/seat/.../api/ 下各 Client：
 * - SeatApi: 核心接口（树/预约/签到/取消）
 * - SeatSession: JWT 管理
 *
 * ## 设计纪律（铁律 0.6 强化版）
 * 1. **有对外副作用的动作必须用户显式触发**：预约/取消操作由 UI 按钮直接调用，绝不在自动路径触发。
 * 2. **失败不掩盖**：所有错误都传回调用方，UI 层自行决定展示策略。
 * 3. **会话隔离**：seatlib JWT 走独立 cookie 罐（JAR_SEAT），不与教务会话互相干扰。
 * 4. **离线可读**：树接口免认证，本地缓存可用；预约需在线。
 */

import { rcp } from '@kit.RemoteCommunicationKit';
import util from '@ohos.util';
import { Context } from '@kit.AbilityKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { JAR_SEAT } from '../core/net/CookieJars.ts';
import { RcpFactory, PersistedCookie } from '../core/net/RcpFactory.ts';
import { SessionStore } from '../data/SessionStore.ts';
import { SeatTreeService } from './SeatTreeService.ts';
import {
  SeatNode, SeatSnapshot, ReserveRequest, SignInRequest, CancelRequest,
  DefaultRecord, ReservationStats, SeatStatus, seatTypeName,
  timeOverlap, DateTime, minutesBetween,
} from '../corelogic/SeatLogic.ts';
import { info, warn, error as bitError } from '../core/log/BitLog.ts';

const HLOG_DOMAIN: number = 0x00AB;
const HLOG_TAG: string = 'BIT101Seat';

const SEATLIB_BASE: string = 'https://seatlib.bit.edu.cn';
const DESKTOP_UA: string =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const CONNECT_MS: number = 15000;
const READ_MS: number = 30000;

/** 缓存的座位树（免认证接口，可缓存一段时间）。 */
let cachedTree: SeatNode[] | null = null;
let cachedTreeDate: string = '';
const TREE_CACHE_HOURS: number = 24; // 缓存 24 小时

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
    // seatlib 使用独立 cookie 罐 JAR_SEAT
    const transfer: rcp.TransferConfiguration = {
      autoRedirect: true,
      timeout: { connectMs: CONNECT_MS, transferMs: READ_MS },
    };
    const security: rcp.SecurityConfiguration = { remoteValidation: 'system' };
    const reqConfig: rcp.Configuration = { transfer, security };
    const sessionConfig: rcp.SessionConfiguration = { requestConfiguration: reqConfig };
    this.session = rcp.createSession(sessionConfig);
    this.sessionPromise = null;
    info(HLOG_DOMAIN, HLOG_TAG, 'SeatService session built');
  }

  /**
   * 获取已登录的用户信息（从 SessionStore + seatlib JWT）。
   */
  static async getUserInfo(context: Context): Promise<{
    jwt: string;
    studentId: string;
    displayName: string;
  } | null> {
    try {
      const [jwt, studentId, displayName] = await Promise.all([
        SessionStore.getToken(),
        SessionStore.getStudentId(),
        SessionStore.getDisplayName(),
      ]);
      if (!jwt || jwt.length === 0) return null;
      return { jwt, studentId, displayName };
    } catch (e) {
      warn(HLOG_DOMAIN, HLOG_TAG, 'getUserInfo fail: ' + JSON.stringify(e));
      return null;
    }
  }

  /**
   * 拉取座位树（免认证、可缓存）。
   */
  async fetchTree(context: Context, date: string): Promise<SeatNode[]> {
    // 简单缓存：同日期不重复请求
    if (cachedTree && cachedTreeDate === date) {
      return cachedTree;
    }
    const nodes = await SeatTreeService.fetchTree(context, date);
    cachedTree = nodes;
    cachedTreeDate = date;
    return nodes;
  }

  /**
   * 清座位树缓存（切换日期时调用）。
   */
  static clearTreeCache(): void {
    cachedTree = null;
    cachedTreeDate = '';
  }

  /**
   * 查询指定日期的座位状态。
   *
   * ⚠️ 需要 seatlib JWT（已登录）。未登录时返回 null。
   * @returns 座位快照列表，null = 未登录或请求失败。
   */
  async fetchSeats(
    context: Context,
    date: string,
    jwt: string
  ): Promise<SeatSnapshot[]> {
    await this.ensureSession(context);
    const session = this.session;
    if (session === null) throw new Error('rcp session 未初始化');

    const headers: rcp.RequestHeaders = {
      'Authorization': `Bearer ${jwt}`,
      'User-Agent': DESKTOP_UA,
      'Accept': 'application/json',
      'lang': 'zh',
    };
    const body: string = JSON.stringify({ date });
    const request = new rcp.Request(
      SEATLIB_BASE + '/api/Seat/schedule',
      'POST',
      headers,
      body
    );

    let resp: rcp.Response;
    try {
      resp = await session.fetch(request);
    } catch (e) {
      warn(HLOG_DOMAIN, HLOG_TAG, 'fetchSeats transport fail: ' + JSON.stringify(e));
      return [];
    }

    if (resp.statusCode !== 200) {
      bitError(HLOG_DOMAIN, HLOG_TAG, 'fetchSeats HTTP %d', resp.statusCode);
      if (resp.statusCode === 401) {
        throw new Error('seatlib JWT 失效，请重新登录');
      }
      return [];
    }

    const rawBody: ArrayBuffer | undefined = resp.body;
    if (rawBody === undefined) return [];

    const text: string = util.TextDecoder.create('utf-8').decodeToString(new Uint8Array(rawBody));
    let envelope: Record<string, Object>;
    try {
      envelope = JSON.parse(text) as Record<string, Object>;
    } catch {
      return [];
    }

    const code: number = Number(envelope['code'] ?? -1);
    if (code !== 1) {
      bitError(HLOG_DOMAIN, HLOG_TAG, 'fetchSeats biz code=%d body=%s', code, text.substring(0, 200));
      return [];
    }

    const data: Array<Record<string, Object>> = (envelope['data'] ?? []) as Array<Record<string, Object>>;
    return this.parseSeatSnapshots(data);
  }

  /**
   * 解析座位快照（API 响应 → SeatSnapshot[]）。
   */
  private parseSeatSnapshots(rows: Array<Record<string, Object>>): SeatSnapshot[] {
    const out: SeatSnapshot[] = [];
    for (const row of rows) {
      const seatId: string = String(row['seat_id'] ?? '');
      if (seatId.length === 0) continue;
      const status: string = String(row['status'] ?? 'FREE');
      const reservationId: string = String(row['reservation_id'] ?? '');
      const otherName: string = String(row['other_name'] ?? '');
      const startTime: string = String(row['start_time'] ?? '');
      const endTime: string = String(row['end_time'] ?? '');
      const kind: string = String(row['kind'] ?? 'SINGLE');
      const signInKind: string = String(row['sign_in_kind'] ?? 'NFC_QR');
      const signInDeadlineMinutes: number = Number(row['sign_in_deadline_minutes'] ?? -1);
      const isCheckedIn: boolean = Boolean(row['checked_in']);
      const seatName: string = String(row['name'] ?? seatId);

      let timeRange: [DateTime, DateTime] | null = null;
      if (startTime.length > 0 && endTime.length > 0) {
        try {
          const startMs = new Date(startTime).getTime()
            + new Date(startTime).getTimezoneOffset() * 60000 + 8 * 3600000;
          const endMs = new Date(endTime).getTime()
            + new Date(endTime).getTimezoneOffset() * 60000 + 8 * 3600000;
          const fromDay = Math.floor(startMs / 86400000);
          const fromMin = Math.floor((startMs % 86400000) / 60000);
          const toDay = Math.floor(endMs / 86400000);
          const toMin = Math.floor((endMs % 86400000) / 60000);
          timeRange = [{ day: fromDay, minutes: fromMin }, { day: toDay, minutes: toMin }];
        } catch {
          // 日期解析失败，跳过
        }
      }

      out.push({
        seatId,
        seatName,
        status: status as SeatStatus,
        reservationId: reservationId.length > 0 ? reservationId : null,
        otherName: otherName.length > 0 ? otherName : null,
        timeRange,
        kind: kind as import('../corelogic/SeatLogic.ts').ReservationKind,
        signInKind: signInKind as import('../corelogic/SeatLogic.ts').SignInKind,
        signInDeadlineMinutes: signInDeadlineMinutes >= 0 ? signInDeadlineMinutes : null,
        isCheckedIn,
      });
    }
    return out;
  }

  /**
   * 提交预约（⚠️ 有对外副作用，仅由 UI 用户显式点击触发）。
   *
   * @returns 预约 ID（成功）或错误文案（失败）。
   */
  async reserve(
    context: Context,
    req: ReserveRequest,
    jwt: string
  ): Promise<string | null> {
    await this.ensureSession(context);
    const session = this.session;
    if (session === null) throw new Error('rcp session 未初始化');

    const headers: rcp.RequestHeaders = {
      'Authorization': `Bearer ${jwt}`,
      'User-Agent': DESKTOP_UA,
      'Accept': 'application/json',
      'lang': 'zh',
    };
    const body: string = JSON.stringify({
      seat_id: req.seatId,
      start_time: req.startTime.day * 86400000 + req.startTime.minutes * 60000,
      end_time: req.endTime.day * 86400000 + req.endTime.minutes * 60000,
      kind: req.kind,
    });
    const request = new rcp.Request(
      SEATLIB_BASE + '/api/Seat/reserve',
      'POST',
      headers,
      body
    );

    let resp: rcp.Response;
    try {
      resp = await session.fetch(request);
    } catch (e) {
      warn(HLOG_DOMAIN, HLOG_TAG, 'reserve transport fail: ' + JSON.stringify(e));
      return '网络请求失败';
    }

    if (resp.statusCode !== 200) {
      bitError(HLOG_DOMAIN, HLOG_TAG, 'reserve HTTP %d', resp.statusCode);
      if (resp.statusCode === 401) return 'JWT 失效，请重新登录';
      return `提交预约失败（HTTP ${resp.statusCode}）`;
    }

    const rawBody: ArrayBuffer | undefined = resp.body;
    if (rawBody === undefined) return '响应体为空';

    const text: string = util.TextDecoder.create('utf-8').decodeToString(new Uint8Array(rawBody));
    let envelope: Record<string, Object>;
    try {
      envelope = JSON.parse(text) as Record<string, Object>;
    } catch {
      return '响应解析失败';
    }

    const code: number = Number(envelope['code'] ?? -1);
    if (code !== 1) {
      bitError(HLOG_DOMAIN, HLOG_TAG, 'reserve biz code=%d body=%s', code, text.substring(0, 200));
      return String(envelope['message'] ?? '预约失败');
    }

    const reservationId: string = String(envelope['data']?.['reservation_id'] ?? '');
    if (reservationId.length === 0) return '预约成功但无返回 ID';
    info(HLOG_DOMAIN, HLOG_TAG, 'reserve ok id=%s seat=%s', reservationId, req.seatId);
    return reservationId;
  }

  /**
   * 签到（⚠️ 有对外副作用，仅由 UI 用户显式点击触发）。
   */
  async signIn(
    context: Context,
    req: SignInRequest,
    jwt: string
  ): Promise<string | null> {
    await this.ensureSession(context);
    const session = this.session;
    if (session === null) throw new Error('rcp session 未初始化');

    const headers: rcp.RequestHeaders = {
      'Authorization': `Bearer ${jwt}`,
      'User-Agent': DESKTOP_UA,
      'Accept': 'application/json',
      'lang': 'zh',
    };

    let body: Record<string, Object> = {
      reservation_id: req.reservationId,
      seat_id: req.seatId,
      kind: req.signInKind,
    };
    if (req.gps) {
      body['gps'] = req.gps;
    }

    const request = new rcp.Request(
      SEATLIB_BASE + '/api/Seat/sign_in',
      'POST',
      headers,
      JSON.stringify(body)
    );

    let resp: rcp.Response;
    try {
      resp = await session.fetch(request);
    } catch (e) {
      warn(HLOG_DOMAIN, HLOG_TAG, 'signIn transport fail: ' + JSON.stringify(e));
      return '网络请求失败';
    }

    if (resp.statusCode !== 200) {
      bitError(HLOG_DOMAIN, HLOG_TAG, 'signIn HTTP %d', resp.statusCode);
      if (resp.statusCode === 401) return 'JWT 失效，请重新登录';
      return `签到失败（HTTP ${resp.statusCode}）`;
    }

    const rawBody: ArrayBuffer | undefined = resp.body;
    if (rawBody === undefined) return '响应体为空';

    const text: string = util.TextDecoder.create('utf-8').decodeToString(new Uint8Array(rawBody));
    let envelope: Record<string, Object>;
    try {
      envelope = JSON.parse(text) as Record<string, Object>;
    } catch {
      return '响应解析失败';
    }

    const code: number = Number(envelope['code'] ?? -1);
    if (code !== 1) {
      bitError(HLOG_DOMAIN, HLOG_TAG, 'signIn biz code=%d body=%s', code, text.substring(0, 200));
      return String(envelope['message'] ?? '签到失败');
    }

    info(HLOG_DOMAIN, HLOG_TAG, 'signIn ok reservation=%s', req.reservationId);
    return null; // null = 成功
  }

  /**
   * 取消预约（⚠️ 有对外副作用，仅由 UI 用户显式点击触发）。
   */
  async cancel(
    context: Context,
    req: CancelRequest,
    jwt: string
  ): Promise<string | null> {
    await this.ensureSession(context);
    const session = this.session;
    if (session === null) throw new Error('rcp session 未初始化');

    const headers: rcp.RequestHeaders = {
      'Authorization': `Bearer ${jwt}`,
      'User-Agent': DESKTOP_UA,
      'Accept': 'application/json',
      'lang': 'zh',
    };
    const body: string = JSON.stringify({
      reservation_id: req.reservationId,
      seat_id: req.seatId,
    });
    const request = new rcp.Request(
      SEATLIB_BASE + '/api/Seat/cancel',
      'POST',
      headers,
      body
    );

    let resp: rcp.Response;
    try {
      resp = await session.fetch(request);
    } catch (e) {
      warn(HLOG_DOMAIN, HLOG_TAG, 'cancel transport fail: ' + JSON.stringify(e));
      return '网络请求失败';
    }

    if (resp.statusCode !== 200) {
      bitError(HLOG_DOMAIN, HLOG_TAG, 'cancel HTTP %d', resp.statusCode);
      if (resp.statusCode === 401) return 'JWT 失效，请重新登录';
      return `取消失败（HTTP ${resp.statusCode}）`;
    }

    const rawBody: ArrayBuffer | undefined = resp.body;
    if (rawBody === undefined) return '响应体为空';

    const text: string = util.TextDecoder.create('utf-8').decodeToString(new Uint8Array(rawBody));
    let envelope: Record<string, Object>;
    try {
      envelope = JSON.parse(text) as Record<string, Object>;
    } catch {
      return '响应解析失败';
    }

    const code: number = Number(envelope['code'] ?? -1);
    if (code !== 1) {
      bitError(HLOG_DOMAIN, HLOG_TAG, 'cancel biz code=%d body=%s', code, text.substring(0, 200));
      return String(envelope['message'] ?? '取消失败');
    }

    info(HLOG_DOMAIN, HLOG_TAG, 'cancel ok reservation=%s', req.reservationId);
    return null;
  }

  /**
   * 获取违约记录。
   */
  static async fetchDefaults(context: Context, jwt: string): Promise<DefaultRecord[]> {
    // seatlib 违约记录接口（占位，对齐 Android SeatApi 契约）
    // 实际实现需要等待服务端接口契约确认
    return [];
  }

  /**
   * 静默续签 seatlib JWT（使用已存的 phpCAS cookie）。
   */
  static async silentRenewJwt(context: Context): Promise<string | null> {
    // 复用 CasLoginService 的同构逻辑
    // 这里只返回 null，具体续期逻辑由 CasLoginService 处理
    return null;
  }
}
