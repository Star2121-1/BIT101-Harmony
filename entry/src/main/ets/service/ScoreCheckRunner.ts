/**
 * 出分提醒的**编排**（M7-3）：限频 → 取数 → 差分 → 发通知。
 *
 * 1:1 移植 Android `DefaultScoreRepo.syncAndDiff` + `ScoreNotifyChecker` 的纪律：
 *
 * | 纪律 | 为什么 |
 * |---|---|
 * | 12h 闸门在**取数前**判 | 每次取数都是真登录；开 App 就来一发会撞学校风控 |
 * | **时间戳取数前就写** | 查询失败也要计时。否则「密码错」会每次开 App 都登录一次 |
 * | 失败**不清基线** | 清了下次会把全部历史成绩当「新出分」轰炸 |
 * | 空表**不写基线** | 同上：空表可能只是解析失败/接口降级 |
 * | 通知文案只用 `summaryText` | 那里锁死了「绝不含分数」，此处不拼任何文案 |
 * | 首次运行（快照为 null）**只建基线** | `ScoreLogic.diff(null, …)` 恒返回空，语义在此 |
 *
 * ⚠️ 与座位/短信这类对外副作用不同，通知本身**没有副作用**（不改变远端状态），
 * 所以允许挂在「App 启动 / 进成绩页」这类自动路径上；`force` 只给用户显式点击用。
 */

import { Context } from '@kit.AbilityKit';
import { info, warn } from '../core/log/BitLog.ts';
import type { ScoreEntry } from '../corelogic/ScoreLogic.ts';
import { diff, summaryText } from '../corelogic/ScoreLogic.ts';
import { shouldCheck } from '../corelogic/ScoreQueryLogic.ts';
import { ScoreCheckCode } from '../corelogic/ScoreCheckLogic.ts';
import type { ScoreCheckStatus } from '../corelogic/ScoreCheckLogic.ts';
import { ScoreStore } from '../data/ScoreStore.ts';
import { ScoreCredentialStore } from '../data/ScoreCredentialStore.ts';
import { ScoreService } from './ScoreService.ts';
import type { ScoreFetchResult } from './ScoreService.ts';
import { publishText, NOTIFY_ID_SCORES } from './InstantNotify.ts';
import { NotifySettingsStore } from '../data/NotifySettingsStore.ts';
import type { NotifySettings } from '../corelogic/NotifySettingsLogic.ts';

/** 一次检查的结果（页面/设置页都要能讲清「跑没跑、成没成」）。 */
export interface ScoreCheckOutcome {
  /** 是否真的发起了网络检查（false = 被闸门/缺凭据拦下）。 */
  ran: boolean;
  code: ScoreCheckCode;
  /** 本次解析到的课程数。 */
  count: number;
  /** 本次新出分的门数。 */
  newCount: number;
  /** 服务端原因原文（失败时）。 */
  detail: string | null;
  /** 没跑的人话原因（ran=true 时为空串）。 */
  reason: string;
}

function skipped(code: ScoreCheckCode, reason: string): ScoreCheckOutcome {
  return { ran: false, code: code, count: 0, newCount: 0, detail: null, reason: reason };
}

export class ScoreCheckRunner {
  /**
   * 检查一次并按需通知。
   *
   * @param force 跳过 12h 闸门（**只在用户显式点击时**给 true）
   * @param allowNotify 是否允许弹通知。用户在成绩页里主动查询时给 false
   *   （他正看着这一页，再弹一条「成绩更新」是噪音）；自动路径看用户开关。
   */
  static async check(context: Context, force: boolean, allowNotify: boolean): Promise<ScoreCheckOutcome> {
    const cred = await ScoreCredentialStore.load();
    if (cred === null) {
      // 没保存凭据 ⇒ 静默跳过（不写状态：否则「最近检查」会显示成一条假结果）
      return skipped(ScoreCheckCode.NOT_LOGGED_IN, '未保存学号密码');
    }

    const now: number = Date.now();
    let last: ScoreCheckStatus | null = null;
    try {
      last = await ScoreStore.loadLastCheck();
    } catch (e) {
      warn('ScoreCheckRunner loadLastCheck fail: ' + JSON.stringify(e));
    }
    const lastAt: number = last === null ? -1 : last.atMillis;
    if (!force && !shouldCheck(lastAt, now)) {
      return skipped(ScoreCheckCode.OK, '距上次检查不足 12 小时');
    }

    // ⚠️ 刻意在**取数前**写时间戳（失败也要计时），见文件头表格
    await ScoreStore.saveLastCheck(ScoreCheckCode.FAILED, 0, '检查进行中');

    let result: ScoreFetchResult;
    try {
      result = await ScoreService.fetch(context, cred.username, cred.password);
    } catch (e) {
      warn('ScoreCheckRunner fetch throw: ' + JSON.stringify(e));
      result = {
        ok: false, code: ScoreCheckCode.FAILED, entries: [], detail: (e as Error).message, atMillis: Date.now()
      };
    }

    if (!result.ok) {
      await ScoreStore.saveLastCheck(result.code, 0, result.detail);
      return {
        ran: true, code: result.code, count: 0, newCount: 0,
        detail: result.detail, reason: ''
      };
    }

    const entries: ScoreEntry[] = result.entries;
    if (entries.length === 0) {
      // 空表：记 OK(0) 但**不写基线**（可能只是接口降级，写空会把基线清掉）
      await ScoreStore.saveLastCheck(ScoreCheckCode.OK, 0, null);
      return { ran: true, code: ScoreCheckCode.OK, count: 0, newCount: 0, detail: null, reason: '' };
    }

    let snapshot: Record<string, string> | null = null;
    try {
      snapshot = await ScoreStore.loadSnapshot();
    } catch (e) {
      warn('ScoreCheckRunner loadSnapshot fail: ' + JSON.stringify(e));
    }
    const newOnes: ScoreEntry[] = diff(snapshot, entries);

    try {
      await ScoreStore.saveCache(entries, result.atMillis);
      await ScoreStore.saveSnapshot(entries);
    } catch (e) {
      warn('ScoreCheckRunner persist fail: ' + JSON.stringify(e));
    }
    await ScoreStore.saveLastCheck(ScoreCheckCode.OK, entries.length, null);

    if (newOnes.length > 0) {
      const text: string = summaryText(newOnes);
      if (allowNotify && text.length > 0) {
        await publishText(NOTIFY_ID_SCORES, '成绩更新', text);
      }
      info('ScoreCheckRunner new scores=' + newOnes.length + ' notify=' + allowNotify);
    }
    return {
      ran: true, code: ScoreCheckCode.OK, count: entries.length,
      newCount: newOnes.length, detail: null, reason: ''
    };
  }

  /**
   * 只读「最近一次检查」状态（设置页/成绩页展示）。
   * 读失败返回 null，不抛 —— 展示层不该因为存储异常白屏。
   */
  static async lastStatus(): Promise<ScoreCheckStatus | null> {
    try {
      return await ScoreStore.loadLastCheck();
    } catch (e) {
      return null;
    }
  }

  /**
   * App 启动时的自动检查（冷启动挂一次）。
   *
   * 三道闸门**全过**才会真的发网络请求：
   *  1. 用户通知总开关 + 「出分提醒」开关都开；
   *  2. 保存过凭据（否则没法走学校登录）；
   *  3. 距上次检查 ≥ 12h（`check()` 内部判）。
   *
   * 全程不抛：启动路径上的异常不该拖慢或打断 App。
   */
  static async autoOnStart(context: Context): Promise<void> {
    try {
      const settings: NotifySettings = await NotifySettingsStore.load();
      if (!settings.enabled || !settings.scoreEnabled) {
        return;
      }
      if (!(await ScoreCredentialStore.has())) {
        return;
      }
      const out: ScoreCheckOutcome = await ScoreCheckRunner.check(context, false, true);
      info('ScoreCheckRunner auto: ran=' + out.ran + ' code=' + out.code +
        ' new=' + out.newCount + ' reason=' + out.reason);
    } catch (e) {
      warn('ScoreCheckRunner autoOnStart fail: ' + JSON.stringify(e));
    }
  }
}
