/**
 * 代理提醒排期器（M7-2：7 类提醒 → reminderAgent 日历提醒）。
 *
 * 对照 Android `NotifyScheduler`（每个提醒 = 一次性 WorkManager 任务、唯一名 = 去重键、
 * 周期任务兜底）。鸿蒙没有 WorkManager，用 **reminderAgentManager 日历提醒**
 *（系统代理，App 冻结/退出后照样弹，正是「锁屏也弹」的验收判据）：
 *
 *   本地数据（离线可读）→ NotifyLogic.plan()（纯逻辑，已单测）
 *     → specsForPublish（配额裁剪 + 剔过去，已单测）
 *     → reminderAgentManager.publishReminder（日历型）
 *     → NotifyRecordStore.merge（M7-1 历史列表落地）
 *
 * ## 三个「宁可漏不发错」的边界（设计约束：错提醒比不发更糟）
 *  - **通知开关没开**：publish 会报 1700001。前置 isNotificationEnabled，
 *    没开就**整批不排**并回报原因，由 UI 引导开启 —— 而不是发一半。
 *  - **考试时刻解析不出**：NotifyAdapter 已 fail-closed 跳过（见其注释）。
 *  - **教学调整拿不到**：按「无调整」排（readCacheOnly 返回空），
 *    宁可漏补课提醒也不联网拖慢启动。
 *
 * ## 全量重建而非增量
 * reminderAgent 没有 unique-key（Android 的 REPLACE 语义），只有 reminderId。
 * 排期在每次开 App / 数据变更时整批重跑 ⇒ **cancelAll 再逐条 publish** 最简单可靠
 *（配额 30 以内，几十毫秒）。已发的由 NotifyRecordStore 的「已发不回滚」保历史。
 */

import { reminderAgentManager } from '@kit.BackgroundTasksKit';
import { notificationManager } from '@kit.NotificationKit';
import { wantAgent } from '@kit.AbilityKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { Context } from '@kit.AbilityKit';
import {
  plan,
  type NotifyPolicy,
  type Reminder,
  type NotifyCourse,
  type NotifyDDL,
  type NotifyExam
} from '../corelogic/NotifyLogic.ts';
import { coursesToNotify, ddlsToNotify, examsToNotify } from '../corelogic/NotifyAdapter.ts';
import { specsForPublish, AGENT_REMINDER_LIMIT, type AgentReminderSpec } from '../corelogic/NotifyScheduleLogic.ts';
import { applyQuiet, type QuietHours, type QuietBudget, DEFAULT_QUIET_HOURS } from '../corelogic/QuietHoursLogic.ts';
import { QuietHoursStore } from '../data/QuietHoursStore.ts';
import {
  routeOfKind,
  type NotifyRoute,
  KEY_NOTIFY_CONTENT,
  KEY_NOTIFY_PAGE,
  BUNDLE_NAME,
  ENTRY_ABILITY
} from '../corelogic/NotifyDeepLink.ts';
import { localEpochDay } from '../corelogic/CampusCardBalanceLogic.ts';
import { parseISODate, type DateTime, type TimeTable } from '../corelogic/timeutil.ts';
import { type AdjustmentEntry } from '../corelogic/TeachingAdjustment.ts';
import { CourseCache } from '../data/CourseCache.ts';
import { DdlStore } from '../data/DdlStore.ts';
import { ExamCache } from '../data/ExamCache.ts';
import { TimeTableStore } from '../data/TimeTableStore.ts';
import { NotifySentStore } from '../data/NotifySentStore.ts';
import { NotifyRecordStore } from '../data/NotifyRecordStore.ts';
import {
  NotifySettingsStore,
  type NotifySettings,
  DEFAULT_NOTIFY_SETTINGS,
  toPolicy
} from '../data/NotifySettingsStore.ts';
import { type NotifyRecord } from '../corelogic/NotifyRecordLogic.ts';
import { TeachingAdjustmentService } from './TeachingAdjustmentService.ts';
import { info, warn } from '../core/log/BitLog.ts';

/** 排期结果（日志 / UI 用；不静默吞掉跳过与原因，铁律 0.7）。 */
export interface ScheduleResult {
  /** 真正 publish 成功的条数。 */
  published: number;
  /** 被配额裁掉的条数（超 AGENT_REMINDER_LIMIT 部分）。 */
  quotaDropped: number;
  /** 因「过去的时刻」被剔的条数。 */
  pastDropped: number;
  /** 因免打扰时段被推迟到窗口结束的条数（M12-2）。 */
  quietDelayed: number;
  /** 因免打扰被**丢弃**的条数（推迟后事件已过期 ⇒ 不再发假信息）。 */
  quietDropped: number;
  /**
   * 被系统以 1700002 拒掉（「数量超限」）的条数。
   *
   * ⚠️ 真机实测（2026-10-28）：某些设备上这个错误**不等于**「已有 30 条占满」，
   * 而是 Ans 侧把「不允许提醒」笼统报成 1700002，日志里能看到
   * `VerifyCloudCapability failed ... capability = reminder_capability` 与
   * `ReminderControl <bundle>, notification not allowed`，上限被判成 `limit[0]`。
   * 单独计数是为了让 UI 能说「系统拒绝了全部提醒」而不是含糊的「N 条发布失败」。
   */
  quotaRejected: number;
  /** publish 失败条数（网络/系统侧）。 */
  failed: number;
  /**
   * 整批未排的原因（排了就为空串）：
   * 'notification_disabled' = 通知开关没开（前置失败，一条都没发）；
   * 'empty_plan' = 本地没数据（没课/没 DDL，属正常空态，不算错误）。
   */
  reason: string;
}

/** 此刻的本地时间（DateTime = 本地 epoch day + 当天分钟；排期/plan 的 now 输入）。 */
function nowLocalDateTime(): DateTime {
  const d: Date = new Date();
  return { day: localEpochDay(d.getTime()), minutes: d.getHours() * 60 + d.getMinutes() };
}

/** spec（本地年月日时分）→ 本地毫秒时间戳（给 M7-1 历史列表的 atMillis）。 */
function localMillisOf(s: AgentReminderSpec): number {
  return new Date(s.year, s.month - 1, s.day, s.hour, s.minute).getTime();
}

export class ReminderScheduler {
  /**
   * 重排全部代理提醒（每次开 App / 课表或提醒设置变更时调）。
   *
   * 全程「宁可漏不发错」：任何取数失败都按空处理（提醒少发可接受，崩 App 不行），
   * 系统通知开关没开 / 用户总开关关则整批不排并回报（关闭要 cancelAll 清旧）。
   *
   * 策略从 `NotifySettingsStore` 读（M7-5：总开关 + 各类开关 + 提前量；
   * 设置页每次改动后调本方法即「改了立即重排」）。
   */
  static async reschedule(context: Context): Promise<ScheduleResult> {
    const result: ScheduleResult = {
      published: 0, quotaDropped: 0, pastDropped: 0, failed: 0,
      quietDelayed: 0, quietDropped: 0, quotaRejected: 0, reason: ''
    };

    // 用户总开关（M7-5）：关了就把已排的清掉、一条都不排
    let settings: NotifySettings = DEFAULT_NOTIFY_SETTINGS;
    try {
      settings = await NotifySettingsStore.load();
    } catch (e) {
      warn('reminder settings load fail, use defaults: ' + JSON.stringify(e));
    }
    if (!settings.enabled) {
      await ReminderScheduler.cancelAll();
      result.reason = 'user_disabled';
      return result;
    }
    const policy: NotifyPolicy = toPolicy(settings);

    // 前置：系统通知开关（reminderAgent publish 的硬前提，否则报 1700001）
    let enabled: boolean = false;
    try {
      enabled = await notificationManager.isNotificationEnabled();
    } catch (e) {
      warn('reminder isNotificationEnabled fail: ' + JSON.stringify(e));
      enabled = false;
    }
    if (!enabled) {
      result.reason = 'notification_disabled';
      return result;
    }

    // ── 取本地数据（全部离线；任一失败按空，不崩）──
    const nowDt: DateTime = nowLocalDateTime();
    let courses: NotifyCourse[] = [];
    let ddls: NotifyDDL[] = [];
    let exams: NotifyExam[] = [];
    let adjustments: AdjustmentEntry[] = [];
    let table: TimeTable = TimeTableStore.defaultTable();
    let firstDayEpochDay: number | null = null;

    const cached = await CourseCache.loadLast();
    if (cached !== null) {
      courses = coursesToNotify(cached.courses);
      firstDayEpochDay = parseISODate(cached.firstDay);
    }
    try {
      ddls = ddlsToNotify(await DdlStore.load());
    } catch (e) {
      warn('reminder ddl load fail: ' + JSON.stringify(e));
    }
    const exCache = await ExamCache.loadLast();
    if (exCache !== null) {
      exams = examsToNotify(exCache.exams);
    }
    try {
      adjustments = await TeachingAdjustmentService.readCacheOnly();
    } catch (e) {
      warn('reminder adjustments fail: ' + JSON.stringify(e));
    }
    try {
      table = await TimeTableStore.load();
    } catch (e) {
      warn('reminder timetable fail: ' + JSON.stringify(e));
    }

    // ── 已发去重（M7-4 的 sentKeys 纪律：发过的键不再排）──
    let sentKeys: Set<string> = new Set<string>();
    try {
      sentKeys = new Set<string>(await NotifySentStore.read());
    } catch (e) {
      warn('reminder sentKeys read fail: ' + JSON.stringify(e));
    }

    // ── 纯逻辑排期 + 配额裁剪（已单测）──
    const reminders: Reminder[] = plan(
      courses, ddls, nowDt, firstDayEpochDay, table, policy, sentKeys, [], exams, adjustments
    );
    const nowDay: number = nowDt.day;
    // ArkTS 禁解构赋值（arkts-no-destruct-assignment）⇒ 临时变量
    const publish = specsForPublish(reminders, nowDay, AGENT_REMINDER_LIMIT);
    result.pastDropped = publish.droppedPast;
    result.quotaDropped = publish.droppedQuota;

    // ── 免打扰时段（M12-2）：排期最后一道闸 ──────────────────────────
    // 必须放在配额裁剪**之后**：先裁出真正要发的几十条，再按静默窗口调整，
    // 否则被推迟的条目会把配额吃掉，等于静默期挤掉白天的提醒。
    let quiet: QuietHours = DEFAULT_QUIET_HOURS;
    try {
      quiet = await QuietHoursStore.load();
    } catch (e) {
      warn('reminder quiet load fail, use default(off): ' + JSON.stringify(e));
    }
    // 推迟预算 = 「这件事还成立吗」的容忍度：
    // 上课/考试/签到是时刻性事件 ⇒ 只能推到事件开始前（提前量 + 一点余量）；
    // DDL/调整是截止性事件 ⇒ 给半小时余量吸收窗口边界的抖动，超了就丢。
    const budget: QuietBudget = {
      classMax: policy.classLeadMinutes + 5,
      examMax: policy.examLeadMinutes + 10,
      seatMax: policy.seatSignInLeadMinutes + 5,
      ddlMax: 30,
      otherMax: 30
    };
    const quieted = applyQuiet(publish.specs, quiet, budget);
    result.quietDelayed = quieted.delayed;
    result.quietDropped = quieted.dropped;
    const specs: AgentReminderSpec[] = quieted.specs;

    if (specs.length === 0) {
      // 静默期把最后几条也吃掉了 ⇒ 仍要 cancelAll，别留着上一轮排的旧提醒
      if (quieted.dropped > 0 || publish.specs.length > 0) {
        try {
          await reminderAgentManager.cancelAllReminders();
        } catch (e) {
          warn('reminder cancelAll fail: ' + JSON.stringify(e));
        }
      }
      result.reason = quieted.dropped > 0 ? 'all_in_quiet_hours' : 'empty_plan';
      info('reminder reschedule: quiet ate all, dropped=' + quieted.dropped);
      return result;
    }

    // ── 全量重建：cancelAll → 逐条 publish（reminderAgent 无 unique-key）──
    try {
      await reminderAgentManager.cancelAllReminders();
    } catch (e) {
      warn('reminder cancelAll fail: ' + JSON.stringify(e));
    }

    const records: NotifyRecord[] = [];
    for (let i = 0; i < specs.length; i++) {
      const spec: AgentReminderSpec = specs[i];
      try {
        // toRequest 里顺带挂点击落点（挂不上退化成「只开 App」，不影响发送）
        await reminderAgentManager.publishReminder(await ReminderScheduler.toRequest(spec, i + 1));
        result.published++;
      } catch (e) {
        result.failed++;
        // 1700002 = 「数量超限」。真机上它也可能表示「系统不允许发提醒」，见字段注释
        const code: number = (e as BusinessError).code;
        if (code === 1700002) {
          result.quotaRejected++;
        }
        warn('reminder publish fail ' + spec.key + ': ' + JSON.stringify(e));
      }
      // 无论 publish 成败都落一条 M7-1 历史（排期意图 = 事实；失败的是「没发出去」不是「没排」）
      records.push({
        key: spec.key,
        kind: spec.kind,
        title: spec.title,
        text: spec.content,
        atMillis: localMillisOf(spec),
        firedMillis: 0
      });
    }

    try {
      await NotifyRecordStore.merge(records);
    } catch (e) {
      warn('reminder records merge fail: ' + JSON.stringify(e));
    }

    info('reminder reschedule done: published=' + result.published +
      ' failed=' + result.failed + ' past=' + result.pastDropped + ' quota=' + result.quotaDropped +
      ' quietDelayed=' + result.quietDelayed + ' quietDropped=' + result.quietDropped +
      ' rejected=' + result.quotaRejected);
    return result;
  }

  /**
   * AgentReminderSpec → reminderAgent 的日历提醒请求，**顺手挂点击落点**（M11-3 遗留补齐）。
   *
   * 为什么合在一个方法里：`wantAgent.getWantAgent()` 的返回类型不在
   * `wantAgent` 命名空间里导出（`wantAgent.WantAgent` 编译不过），
   * 只能靠「赋值给 request.wantAgent」让编译器自己推导。硬造类型只会绕远。
   *
   * `requestCode` 必须每条不同：同 code 的 wantAgent 会被系统当成同一个，
   * 点哪条都跳同一个落点。这里用序号（≤30 条，够用）。
   *
   * 挂不上就退化成「只打开 App」——**绝不因此不发提醒**。
   */
  private static async toRequest(
    spec: AgentReminderSpec,
    requestCode: number
  ): Promise<reminderAgentManager.ReminderRequestCalendar> {
    const req: reminderAgentManager.ReminderRequestCalendar = {
      reminderType: reminderAgentManager.ReminderType.REMINDER_TYPE_CALENDAR,
      dateTime: {
        year: spec.year,
        month: spec.month,
        day: spec.day,
        hour: spec.hour,
        minute: spec.minute
      },
      title: spec.title,
      content: spec.content
    };
    const route: NotifyRoute = routeOfKind(String(spec.kind));
    const parameters: Record<string, Object> = {};
    if (route.content.length > 0) {
      parameters[KEY_NOTIFY_CONTENT] = route.content;
    }
    if (route.page.length > 0) {
      parameters[KEY_NOTIFY_PAGE] = route.page;
    }
    if (Object.keys(parameters).length === 0) {
      return req;
    }
    try {
      const info2: wantAgent.WantAgentInfo = {
        wants: [{
          bundleName: BUNDLE_NAME,
          abilityName: ENTRY_ABILITY,
          parameters: parameters
        }],
        actionType: wantAgent.OperationType.START_ABILITY,
        requestCode: requestCode
      };
      const agent = await wantAgent.getWantAgent(info2);
      // ⚠️ 这里**不能**直接 `req.wantAgent = agent`：SDK 的 d.ts 把
      // `ReminderRequest.wantAgent` 标成了遗留全局接口 `WantAgent { pkgName, abilityName }`
      //（@ohos.reminderAgentManager.d.ts 里没 import 新定义），而
      // `getWantAgent` 返回的是新 API 的不透明句柄 ⇒ 静态类型对不上，编译直接报
      // 「Type '{}' is missing properties pkgName, abilityName」。
      // 这是**声明文件的锅**不是运行时的：官方文档给的用法就是把 getWantAgent 的返回塞进去。
      // 用 Object.assign 跳过这层错误类型，并在注释里留下证据。
      Object.assign(req, { wantAgent: agent });
    } catch (e) {
      warn('reminder wantAgent fail (提醒仍会发): ' + JSON.stringify(e));
    }
    return req;
  }

  /**
   * 引导用户开启通知（reminderAgent 的硬前提）。
   * 在「我」页 / 通知列表空态里给用户入口；点了才会弹系统授权框。
   * 返回是否已（已开启或刚开启）可用。
   */
  static async ensureNotificationEnabled(): Promise<boolean> {
    try {
      if (await notificationManager.isNotificationEnabled()) {
        return true;
      }
      await notificationManager.requestEnableNotification();
      return await notificationManager.isNotificationEnabled();
    } catch (e) {
      warn('reminder ensureNotification fail: ' + JSON.stringify(e));
      return false;
    }
  }

  /** 取消全部代理提醒（总开关关闭 / 登出时调；对应 Android cancelAll）。 */
  static async cancelAll(): Promise<void> {
    try {
      await reminderAgentManager.cancelAllReminders();
      info('reminder cancelAll done');
    } catch (e) {
      warn('reminder cancelAll fail: ' + JSON.stringify(e));
    }
  }
}
