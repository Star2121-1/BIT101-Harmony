/**
 * 座位 wire 真机探针（M9-3 底图 / M9-7 研讨间 / authed 端点回归）—— **只读，可整删**。
 *
 * ## 为什么需要它（铁律 0.9：未实测的字段不硬造）
 * ROADMAP M9-3 / M9-7 两个「UI 暂缓」都卡在同一件事上：
 * `/api/seat/map` 的 data 形态、`/api/Member/seminar` 的 wire 字段**没有真机核对过**。
 * 本探针用**已登录态**（SessionStore 里的 seatlib JWT）把只读端点全跑一遍，
 * 原始响应落沙箱（DebugDump），hdc file recv 拉回 evidence/ 人工核对。
 *
 * ## 红线（铁律 0.6：绝不上自动路径）
 * - 只跑**只读**端点：tree / date / subscribe / reneges / seminar / map。
 * - **绝不碰** `/api/Seat/confirm` 与 `/api/Space/cancel`（有对外副作用，只能用户显式点）。
 * - JWT 绝不落盘、绝不打印；raw dump 的是**服务端响应体**，不含凭据。
 *
 * ## 输出
 * 每个端点一条 SeatProbeItem（HTTP 状态 / 业务 code / 摘要），
 * 完整 raw 写 `<filesDir>/seatprobe-<name>.txt`。
 */

import { rcp } from '@kit.RemoteCommunicationKit';
import { Context } from '@kit.AbilityKit';
import { JAR_SEAT } from '../core/net/CookieJars.ts';
import { RcpFactory } from '../core/net/RcpFactory.ts';
import { SessionStore } from '../data/SessionStore.ts';
import { CasLoginService } from '../service/CasLoginService.ts';
import { Endpoint } from '../corelogic/SeatApiLogic.ts';
import { dumpText } from '../core/log/DebugDump.ts';
import { warn } from '../core/log/BitLog.ts';
import type { JsonValue } from '../core/model/SchoolModels.ts';
import { str, num, arrOf } from '../core/model/SchoolModels.ts';

const HLOG_TAG: string = 'BIT101SeatProbe';

const SEATLIB_BASE: string = 'https://seatlib.bit.edu.cn';
/** 对齐 SeatService / SeatHttp.kt 的桌面 UA（风控按 UA 给不同页面）。 */
const DESKTOP_UA: string =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/** 探针单项结果（屏上展示 + 证据清单用）。 */
export interface SeatProbeItem {
  /** 端点短名（tree/date/subscribe/reneges/seminar/map）。 */
  name: string;
  method: string;
  /** HTTP 状态码；0 = 传输层错误（TLS/网络）。 */
  httpStatus: number;
  /** 业务 code；-1 = 响应不是合法信封或没解析出。 */
  bizCode: number;
  ok: boolean;
  /** raw 长度（字符）。 */
  rawLen: number;
  /** 脱敏摘要（data 前 140 字符或 raw 前 160 字符；绝不含 JWT）。 */
  note: string;
}

export class SeatProbe {

  /** 跑全套只读探针。单次调用按序执行（authed 端点共用同一个 session）。 */
  async run(ctx: Context): Promise<SeatProbeItem[]> {
    const items: SeatProbeItem[] = [];

    // 0) 先试静默续期（铁律 0.6 安全：只靠已存 cookie 打 cas/user，不碰凭据、不打 SSO、不发短信）。
    //    2026-10-22 第三轮实测：格式修成 Android 的 `bearer<jwt>` + 体带 authorization 字段后
    //    authed 端点仍 10001 ⇒ 假设是「SessionStore 里的 JWT 是死 token」。续期成功即证伪/证实。
    let renewed: boolean = false;
    try {
      renewed = await CasLoginService.silentRenewJwt(ctx);
    } catch (e) {
      warn('seatprobe silentRenew threw: ' + JSON.stringify(e));
    }
    items.push({
      name: 'renew', method: 'POST', httpStatus: 0, bizCode: renewed ? 1 : 0,
      ok: renewed, rawLen: 0,
      note: renewed ? '静默续期成功（拿到新 JWT）' : '静默续期失败（phpCAS 会话已死或无 cookie；不碰凭据）'
    });

    const jwt: string = await SessionStore.getToken();
    warn('seatprobe begin, hasJwt=' + (jwt.length > 0) + ' (len=' + jwt.length + ')');

    const session: rcp.Session = await RcpFactory.createSession(ctx, JAR_SEAT, false);
    const headers: rcp.RequestHeaders = this.headers(jwt);
    // ⚠️ 2026-10-22 真机实测：tree 是**免认证**端点（SeatTreeService 无 Authorization 头可列校区），
    // 带空 Bearer 反而 10001 ⇒ tree 单独用无认证头
    const anonHeaders: rcp.RequestHeaders = this.headers('');

    // 0) 会话状态（屏上直读，JWT 只报有无与长度，绝不明文）
    items.push({
      name: 'session', method: '-', httpStatus: 0, bizCode: jwt.length > 0 ? 1 : 0,
      ok: jwt.length > 0, rawLen: 0,
      note: jwt.length > 0 ? 'SessionStore 有 JWT（长度 ' + jwt.length + '）' : 'SessionStore 无 JWT（seatlib 登录态未建立）'
    });

    // ⚠️ 2026-10-22 真机实测 + Android 契约核对：authed 端点的认证是
    // ① 头 `Authorization: bearer<jwt>`（**小写 bearer、无空格**，SeatApi.kt:108）
    // ② **请求体 JSON 里还带 `authorization: bearer<jwt>` 字段**（SeatApi.jsonBody）
    // 之前用 `Bearer <jwt>`（大写+空格）且体里不带字段 ⇒ 全部 10001。
    // 另：token 可能已过期（服务端 10001），过期就要走 cookie 静默续期。

    // 1) tree（免认证只读）：先拿 raw，提区域 id 给 map 用，再落盘
    const treeRes = await this.postRaw(session, anonHeaders, Endpoint.TREE, { date: this.today() });
    const areaId: string = SeatProbe.extractAreaId(treeRes.body);
    items.push(this.collect('tree', treeRes));

    // 2) date（时段结构；Android 也走 jsonBody，但 date 免认证可通）
    items.push(this.collect('date',
      await this.postRaw(session, headers, Endpoint.DATE, this.authBody(jwt, {}))));

    // 3) subscribe（我的预约；验证 JWT 头对 authed 端点是否过）
    items.push(this.collect('subscribe',
      await this.postRaw(session, headers, Endpoint.SUBSCRIBE,
        this.authBody(jwt, { type: '1' }))));

    // 4) reneges（违约，type 1=座位）
    items.push(this.collect('reneges',
      await this.postRaw(session, headers, Endpoint.RENEGES,
        this.authBody(jwt, { type: 1 }))));

    // 5) seminar（研讨间 wire 字段 ★M9-7）
    items.push(this.collect('seminar',
      await this.postRaw(session, headers, Endpoint.SEMINAR, this.authBody(jwt, {}))));

    // 6) map（底图 data 形态 ★M9-3；区域 id 来自 tree，没有就跳过并注明）
    if (areaId.length > 0) {
      items.push(this.collect('map',
        await this.postRaw(session, headers, Endpoint.MAP,
          this.authBody(jwt, { id: areaId }))));
    } else {
      items.push({
        name: 'map', method: 'POST', httpStatus: 0, bizCode: -1, ok: false,
        rawLen: 0, note: '跳过：tree 里没解析出区域 id（底图区域未知）'
      });
    }

    // 7) seat-anon（可证伪验证）：契约文档记载「失效 token 打 tree → 500，不带 token → 200」。
    //    seat 端点是否同样免认证？Android 注释说「免认证的只有 tree」，但那是**推论**不是实测
    //    （Android 流里 seat 请求总带 token）。这里用无 Authorization 头打一次，让服务端回答。
    if (areaId.length > 0) {
      items.push(this.collect('seat-anon',
        await this.postRaw(session, anonHeaders, Endpoint.SEAT,
          { area: areaId, segment: '1', day: this.today(), startTime: '00:00', endTime: '24:00' })));
    } else {
      items.push({
        name: 'seat-anon', method: 'POST', httpStatus: 0, bizCode: -1, ok: false,
        rawLen: 0, note: '跳过：tree 里没解析出区域 id'
      });
    }

    warn('seatprobe done, items=' + items.length + ' areaId=' + areaId);
    return items;
  }

  /**
   * 端点公共头。jwt 为空时**不放 Authorization 键**（放 `Bearer ` 空值会被服务端判未登录，
   * 2026-10-22 真机实测：tree 免认证但带空 Bearer ⇒ 10001）。
   * ⚠️ 格式对齐 Android SeatApi.kt:108 —— **`bearer<jwt>` 小写无空格**，不是 RFC 的 `Bearer <jwt>`。
   */
  private headers(jwt: string): rcp.RequestHeaders {
    const h: rcp.RequestHeaders = {
      'User-Agent': DESKTOP_UA,
      'Accept-Language': 'zh-CN,zh;q=0.9',
      'Content-Type': 'application/json',
      'lang': 'zh',
      'X-Requested-With': 'XMLHttpRequest'
    };
    if (jwt.length > 0) {
      h['Authorization'] = 'bearer' + jwt;
    }
    return h;
  }

  /**
   * authed 端点的请求体：对齐 Android SeatApi.jsonBody —— **JSON 里带
   * `authorization: bearer<jwt>` 字段**（服务端两头都认，Android 两头都发）。
   */
  private authBody(jwt: string, extra: Record<string, Object>): Record<string, Object> {
    const body: Record<string, Object> = {};
    if (jwt.length > 0) {
      body['authorization'] = 'bearer' + jwt;
    }
    const keys: string[] = Object.keys(extra);
    for (let i = 0; i < keys.length; i++) {
      body[keys[i]] = extra[keys[i]];
    }
    return body;
  }

  /** 今天（设备本地时区，seatlib 按北京时间的自然日）。 */
  private today(): string {
    const d: Date = new Date();
    const mm: string = String(d.getMonth() + 1).padStart(2, '0');
    const dd: string = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + mm + '-' + dd;
  }

  /** 发一个 POST 拿 raw；传输错误返回 status=0 + 空 body（调用方按失败项记录，绝不上抛）。
   *  path 用 string 接 enum 成员（对齐 SeatService.postJson 的已验证签名）。 */
  private async postRaw(
    session: rcp.Session, headers: rcp.RequestHeaders,
    path: string, body: Record<string, Object>
  ): Promise<{ status: number; body: string }> {
    try {
      const res = await RcpFactory.postText(session, SEATLIB_BASE + path, headers, JSON.stringify(body));
      return { status: res.status, body: res.body };
    } catch (e) {
      warn('seatprobe postRaw transport error: ' + JSON.stringify(e));
      return { status: 0, body: '' };
    }
  }

  /** raw → 摘要项（落盘 + 解析 code/data 摘要）。 */
  private collect(name: string, res: { status: number; body: string }): SeatProbeItem {
    const raw: string = res.body;
    if (res.status === 0 || raw.length === 0) {
      return {
        name, method: 'POST', httpStatus: res.status, bizCode: -1, ok: false, rawLen: 0,
        note: '传输错误（TLS/网络/证书，详见日志）'
      };
    }
    dumpText('seatprobe-' + name + '.txt', raw);
    let bizCode: number = -1;
    let note: string = raw.length > 160 ? raw.substring(0, 160) + '…' : raw;
    try {
      const env = JSON.parse(raw) as Record<string, JsonValue>;
      bizCode = num(env, 'code', -1);
      const data: JsonValue = env['data'];
      if (Array.isArray(data)) {
        const arr: JsonValue[] = data as JsonValue[];
        note = 'data 长度=' + arr.length + ' data[0]=' +
          JSON.stringify(arr.length > 0 ? arr[0] : null).substring(0, 140);
      } else if (data !== null && data !== undefined && typeof data === 'object') {
        note = 'data=' + JSON.stringify(data).substring(0, 140);
      }
    } catch (e) {
      note = '非 JSON 响应（前 160 字符）：' + note;
    }
    warn('seatprobe ' + name + ' HTTP ' + res.status + ' bizCode=' + bizCode + ' len=' + raw.length);
    return {
      name, method: 'POST', httpStatus: res.status, bizCode,
      ok: res.status === 200 && bizCode === 1, rawLen: raw.length, note
    };
  }

  /**
   * 从 tree 的 raw 里取**第一个叶子节点 id**（底图区域）。
   * 树形 campus→building→floor→area：叶子 = 没有 children 的节点。
   * 探针不猜结构，用通用递归找第一个「无 children 且有 id」的节点。
   */
  static extractAreaId(raw: string): string {
    if (raw.length === 0) return '';
    try {
      const env = JSON.parse(raw) as Record<string, JsonValue>;
      return SeatProbe.walkLeaf(arrOf(env, 'data'), 0);
    } catch (e) {
      warn('seatprobe extractAreaId fail: ' + JSON.stringify(e));
      return '';
    }
  }

  /** 递归找第一个「无 children 且有 id」的节点（深度上限 6，防畸形数据打爆栈）。 */
  private static walkLeaf(nodes: JsonValue[], depth: number): string {
    if (depth > 6) return '';
    for (let i = 0; i < nodes.length; i++) {
      const n: JsonValue = nodes[i];
      if (n === null || typeof n !== 'object' || Array.isArray(n)) continue;
      const obj = n as Record<string, JsonValue>;
      const children: JsonValue[] = arrOf(obj, 'children');
      const id: string = str(obj, 'id', '');
      if (children.length === 0 && id.length > 0) {
        return id;
      }
      if (children.length > 0) {
        const deeper: string = SeatProbe.walkLeaf(children, depth + 1);
        if (deeper.length > 0) return deeper;
      }
    }
    return '';
  }
}
