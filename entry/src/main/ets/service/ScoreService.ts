/**
 * 成绩取数管道（M10-2 / M7-3 共用）—— BIT101 **认证主机**的异步挑战三步。
 *
 * ## 契约（来源：`bit-login/docs/rest-api.md` + Android `ScoreQueryApiService`）
 * 1. `POST /api/jwb/bit101/score` body `{username, password}` →
 *    `200` 直接给 `{data:[[…]]}`，或 `202 {detail:{challenge_id, access_token, status, ready_services, error}}`；
 * 2. `GET /api/auth/{challenge_id}` 头 `X-Challenge-Token: <access_token>` →
 *    `{status, ready_services, error}`，轮询到 `ready_services` 含 `jwb`；
 * 3. `POST /api/jwb/bit101/score` 头 `Authorization: Bearer <access_token>`
 *    body `{challenge_id, username, password}` → `{data:[[…]]}`（第 0 行表头）。
 *
 * ⚠️ 三个主机不能混：成绩在**认证主机**（`login.bit101.flwfdd.xyz`），
 * 业务主机（`seatlib`）上的同路径实测 404（Android 注释亦如此）。
 *
 * ## 本类只做 I/O，不做判断
 * 「下一步干什么」全交给 `corelogic/ScoreFlowLogic.decide()`（纯函数、有单测）。
 * 这里只负责：发请求、把 HTTP 状态翻成失败码、按 decide 的结果往下走。
 *
 * ## 隐私
 * 密码只在请求体里出现，**绝不写日志**；失败原因里若含敏感串也只在 `detail` 里透传
 * （服务端已脱敏，见契约「error：安全脱敏后的失败原因」）。
 */

import { Context } from '@kit.AbilityKit';
import { rcp } from '@kit.RemoteCommunicationKit';
import { JAR_LOGIN } from '../core/net/CookieJars.ts';
import { RcpFactory, HttpTextResult } from '../core/net/RcpFactory.ts';
import { info, warn } from '../core/log/BitLog.ts';
import type { ScoreEntry } from '../corelogic/ScoreLogic.ts';
import { parseTable, snapshotOf } from '../corelogic/ScoreLogic.ts';
import type { ChallengeSnapshot, ScoreStep } from '../corelogic/ScoreFlowLogic.ts';
import { decide, extractScoreTable, parseEnvelope, parseStatus } from '../corelogic/ScoreFlowLogic.ts';
import { POLL_INTERVAL_MS, POLL_MAX_ATTEMPTS } from '../corelogic/ScoreQueryLogic.ts';
import { ScoreCheckCode } from '../corelogic/ScoreCheckLogic.ts';
import type { JsonValue } from '../core/model/SchoolModels.ts';

/** 认证主机（成绩/教务转发）。 */
const LOGIN_BASE: string = 'https://login.bit101.flwfdd.xyz';
const SCORE_PATH: string = '/api/jwb/bit101/score';
const AUTH_PATH: string = '/api/auth/';

/** 一次取数的结果（不抛裸异常：页面与提醒都靠 code 分支）。 */
export interface ScoreFetchResult {
  ok: boolean;
  /** 失败时的分类；成功恒为 OK。 */
  code: ScoreCheckCode;
  entries: ScoreEntry[];
  /** 服务端给的失败原因原文（已脱敏）。 */
  detail: string | null;
  /** 完成时刻（毫秒）。成功时缓存用。 */
  atMillis: number;
}

function okResult(entries: ScoreEntry[], at: number): ScoreFetchResult {
  return { ok: true, code: ScoreCheckCode.OK, entries: entries, detail: null, atMillis: at };
}

function errResult(code: ScoreCheckCode, detail: string): ScoreFetchResult {
  return { ok: false, code: code, entries: [], detail: detail.length > 0 ? detail : null, atMillis: Date.now() };
}

function jsonHeaders(bearer: string): rcp.RequestHeaders {
  if (bearer.length > 0) {
    return {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': 'Bearer ' + bearer
    };
  }
  return {
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve: () => void) => {
    setTimeout(() => {
      resolve();
    }, ms);
  });
}

export class ScoreService {
  /**
   * 走完三步拿成绩表。
   *
   * @param username 学号
   * @param password 学校统一身份认证密码（**不落日志**）
   */
  static async fetch(context: Context, username: string, password: string): Promise<ScoreFetchResult> {
    const u: string = username.trim();
    if (u.length === 0 || password.length === 0) {
      return errResult(ScoreCheckCode.NOT_LOGGED_IN, '');
    }
    let session: rcp.Session;
    try {
      // 认证主机是标准 HTTPS 服务：正常跟跳（不跟跳会停在 301/302 上）
      session = await RcpFactory.createSession(context, JAR_LOGIN, true);
    } catch (e) {
      warn('ScoreService session fail: ' + JSON.stringify(e));
      return errResult(ScoreCheckCode.FAILED, '网络初始化失败');
    }

    // ── 第 1 步：起挑战（顺带兜住「1 秒内直接认证完成 → 200 直接给数据」）──
    const startBody: string = JSON.stringify({ username: u, password: password } as StartBody);
    let start: HttpTextResult;
    try {
      start = await RcpFactory.postText(session, LOGIN_BASE + SCORE_PATH, jsonHeaders(''), startBody);
    } catch (e) {
      return errResult(ScoreCheckCode.FAILED, '网络错误：' + (e as Error).message);
    }
    if (start.status === 200) {
      // 服务端在 wait_seconds 内就认证完了 —— 直接解析，不必再走挑战
      const direct: ScoreEntry[] | null = ScoreService.parseData(start.body);
      if (direct !== null) {
        info('ScoreService direct 200: entries=' + direct.length);
        return okResult(direct, Date.now());
      }
      warn('ScoreService 200 but no table');
      return errResult(ScoreCheckCode.FAILED, '成绩表为空');
    }
    if (start.status !== 202) {
      warn('ScoreService start http=' + start.status + ' len=' + start.body.length);
      // 401/403 是接口层拒绝（不是「学校拒绝登录」），归 FAILED；
      // 「学校拒绝」由挑战快照的 status=failed 表达，两者不能混。
      return errResult(ScoreCheckCode.FAILED, '起挑战失败（HTTP ' + start.status + '）');
    }
    const snap: ChallengeSnapshot | null = parseEnvelope(start.body);
    if (snap === null) {
      warn('ScoreService start 202 but unparsable, len=' + start.body.length);
      return errResult(ScoreCheckCode.FAILED, '挑战响应格式异常');
    }
    const first: ScoreStep = decide(snap);
    if (first === 'fetch') {
      const fetched: ScoreFetchResult = await ScoreService.fetchTable(session, u, password, snap);
      return fetched;
    }
    if (first !== 'wait') {
      return ScoreService.stepToError(first, snap.error);
    }
    // 后续轮询要用这两个值；缺任何一个都无法继续
    if (snap.challengeId.length === 0 || snap.accessToken.length === 0) {
      return errResult(ScoreCheckCode.FAILED, '挑战缺少 id/token');
    }

    // ── 第 2 步：轮询到 jwb 就绪 ──
    let attempts: number = 0;
    let ready: ChallengeSnapshot = snap;
    while (attempts < POLL_MAX_ATTEMPTS) {
      await sleep(POLL_INTERVAL_MS);
      attempts++;
      let poll: HttpTextResult;
      try {
        poll = await RcpFactory.getText(session, LOGIN_BASE + AUTH_PATH + snap.challengeId,
          { 'X-Challenge-Token': snap.accessToken, 'Accept': 'application/json' });
      } catch (e) {
        // 单次轮询失败不立刻判死：挑战还有效，下一次再试
        warn('ScoreService poll transport fail #' + attempts + ': ' + (e as Error).message);
        continue;
      }
      if (poll.status !== 200) {
        warn('ScoreService poll http=' + poll.status + ' #' + attempts);
        continue;
      }
      const st: ChallengeSnapshot | null = parseStatus(poll.body);
      if (st === null) {
        continue;
      }
      ready = st;
      const step: ScoreStep = decide(st);
      if (step === 'fetch') {
        break;
      }
      if (step !== 'wait') {
        return ScoreService.stepToError(step, st.error);
      }
    }
    if (!ready.readyServices.includes('jwb')) {
      warn('ScoreService poll exhausted attempts=' + attempts);
      return errResult(ScoreCheckCode.TIMEOUT, '认证超时（轮询 ' + attempts + ' 次仍未就绪）');
    }

    // ── 第 3 步：带 Bearer 取数 ──
    return await ScoreService.fetchTable(session, u, password, snap);
  }

  /** 取数（200 时解析 data；非 200 按分类返回）。 */
  private static async fetchTable(session: rcp.Session, username: string, password: string,
    snap: ChallengeSnapshot): Promise<ScoreFetchResult> {
    const token: string = snap.accessToken;
    if (token.length === 0) {
      return errResult(ScoreCheckCode.FAILED, '缺少 access_token');
    }
    const body: string = JSON.stringify({
      username: username,
      password: password,
      challenge_id: snap.challengeId
    } as FetchBody);
    let res: HttpTextResult;
    try {
      res = await RcpFactory.postText(session, LOGIN_BASE + SCORE_PATH, jsonHeaders(token), body);
    } catch (e) {
      return errResult(ScoreCheckCode.FAILED, '取数网络错误：' + (e as Error).message);
    }
    if (res.status !== 200) {
      warn('ScoreService fetch http=' + res.status + ' len=' + res.body.length);
      if (res.status === 409) {
        // 契约：challenge 未认证或服务未就绪 → 409。这次没赶上，下次还有机会
        return errResult(ScoreCheckCode.TIMEOUT, '会话未就绪（HTTP 409）');
      }
      return errResult(ScoreCheckCode.FAILED, '取数失败（HTTP ' + res.status + '）');
    }
    const entries: ScoreEntry[] | null = ScoreService.parseData(res.body);
    if (entries === null) {
      return errResult(ScoreCheckCode.FAILED, '成绩表格式异常');
    }
    info('ScoreService fetch ok: entries=' + entries.length);
    return okResult(entries, Date.now());
  }

  /** `{data:[[…]]}` → 成绩条目；形状不对返回 null（与 `parseTable` 的「猜不出就返回空」区分开）。 */
  private static parseData(body: string): ScoreEntry[] | null {
    const table: JsonValue | null = extractScoreTable(body);
    if (table === null) {
      return null;
    }
    const entries: ScoreEntry[] = parseTable(table);
    if (entries.length === 0) {
      // 表能解析但一门课都没有 ⇒ 视为「空表」而不是失败（学期没课是正常情况）
      return [];
    }
    return entries;
  }

  /** 决策结果 → 失败码（失败文案一律带服务端原因，便于用户自己判断）。 */
  private static stepToError(step: ScoreStep, detail: string): ScoreFetchResult {
    if (step === 'need_sms') {
      return errResult(ScoreCheckCode.NEED_SMS, detail);
    }
    if (step === 'auth_failed') {
      return errResult(ScoreCheckCode.AUTH_FAILED, detail);
    }
    if (step === 'expired') {
      return errResult(ScoreCheckCode.TIMEOUT, detail);
    }
    return errResult(ScoreCheckCode.FAILED, detail);
  }

  /** 仅供诊断：把一次成功结果转成快照形状（不写盘）。 */
  static snapshotOfOk(entries: ScoreEntry[]): Record<string, string> {
    return snapshotOf(entries);
  }
}

/** 起挑战的请求体（显式 interface：ArkTS 不接受对象字面量当类型）。 */
interface StartBody {
  username: string;
  password: string;
}

/** 取数的请求体。 */
interface FetchBody {
  username: string;
  password: string;
  challenge_id: string;
}
