/**
 * 桌面卡片扩展 Ability（M8 Form 平台壳）
 *
 * 对照 Android AppWidgetProvider：
 * - onAddForm → 首次创建卡片时装配数据
 * - onUpdateForm → 系统自动刷新时重新装配
 * - onRemoveForm → 用户删除卡片时清理
 *
 * 数据流：本地数据源 → WidgetData.assembleWidgetPages() → formBindingData（JSON）
 * 卡片进程独立，读不了主进程 Prefs/RDB，必须经 formBindingData 传数据。
 *
 * ⚠️ ArkTS 限制：
 * - 此文件运行在独立进程，不能使用@Entry/@Component（页面组件）
 * - 只能通过 formBindingData 传递 JSON 序列化数据
 */

import { FormExtensionAbility } from '@kit.FormKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { Context } from '@kit.AbilityKit';
import { Prefs } from '../data/Prefs.ts';
import { CourseCache, CachedSchedule } from '../data/CourseCache.ts';
import { DdlStore } from '../data/DdlStore.ts';
import { assembleWidgetPages, isSerializablePayload } from '../corelogic/WidgetData.ts';
import { coursesToSchedule, ddlsToSchedule } from '../corelogic/WidgetData.ts';
import { FALLBACK_TIME_TABLE } from '../corelogic/TimeTableLogic.ts';
import { parseISODate } from '../corelogic/timeutil.ts';
import type { AdjustmentEntry } from '../corelogic/TeachingAdjustment.ts';
import type { EclassActivity } from '../corelogic/EclassActivityLogic.ts';
import type { TimeTable, DateTime } from '../corelogic/timeutil.ts';

const DOMAIN = 0x0003; // Form 专属域

export default class FormExtension extends FormExtensionAbility {
  private readonly TAG: string = 'FormExtension';

  /**
   * 获取当前时刻（epoch day + 当天分钟数）
   * 使用北京时间（UTC+8）与 Android 侧口径一致
   */
  private getNowDateTime(): DateTime {
    const now = new Date();
    const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
    const bjMs = utcMs + 8 * 3600000;
    const bjDate = new Date(bjMs);
    const epochDay = Math.floor(bjMs / 86400000);
    const minutes = bjDate.getUTCHours() * 60 + bjDate.getUTCMinutes();
    return { day: epochDay, minutes };
  }

  /**
   * 卡片创建时调用，装配当前数据
   */
  async onAddForm(formId: string): Promise<void> {
    try {
      hilog.info(DOMAIN, this.TAG, 'onAddForm: %{public}s', formId);
      const payload = await this.assemblePayload();
      if (!payload || payload.length === 0) {
        hilog.warn(DOMAIN, this.TAG, 'onAddForm: payload empty, formId=%{public}s', formId);
        return;
      }
      await this.setFormBindingData(formId, payload);
      hilog.info(DOMAIN, this.TAG, 'onAddForm success: %{public}s, len=%{public}d', formId, payload.length);
    } catch (e) {
      hilog.error(DOMAIN, this.TAG, 'onAddForm failed: %{public}s', JSON.stringify(e));
    }
  }

  /**
   * 卡片更新时调用（系统定时触发或手动刷新）
   */
  async onUpdateForm(formId: string): Promise<void> {
    try {
      hilog.info(DOMAIN, this.TAG, 'onUpdateForm: %{public}s', formId);
      const payload = await this.assemblePayload();
      if (!payload || payload.length === 0) {
        hilog.warn(DOMAIN, this.TAG, 'onUpdateForm: payload empty, formId=%{public}s', formId);
        return;
      }
      await this.setFormBindingData(formId, payload);
      hilog.info(DOMAIN, this.TAG, 'onUpdateForm success: %{public}s', formId);
    } catch (e) {
      hilog.error(DOMAIN, this.TAG, 'onUpdateForm failed: %{public}s', JSON.stringify(e));
    }
  }

  /**
   * 卡片删除时调用
   */
  async onRemoveForm(formId: string): Promise<void> {
    hilog.info(DOMAIN, this.TAG, 'onRemoveForm: %{public}s', formId);
    // 无需特殊清理
  }

  /**
   * 卡片被点击时调用（可选）
   */
  async onLaunchForm(formId: string): Promise<void> {
    hilog.info(DOMAIN, this.TAG, 'onLaunchForm: %{public}s', formId);
    // 点击卡片后启动主 App（由系统处理跳转）
  }

  /**
   * 装配卡片数据（主进程数据 → 可 JSON 序列化的 payload）
   *
   * 数据源优先级：
   * 1. CourseCache（本地缓存课表）
   * 2. DdlStore（本地存储 DDL）
   * 3. TeachingAdjustmentService（教学调整）
   *
   * 动态源（eclass 活动）、座位源（M9 未做）当前为空
   */
  private async assemblePayload(): Promise<string> {
    const now: DateTime = this.getNowDateTime();

    // 1. 获取课程数据（本地缓存）
    let courses: import('../corelogic/WidgetData.ts').CourseSchedule[] = [];
    let firstDay: string = '';
    let timeTable: TimeTable = FALLBACK_TIME_TABLE;

    try {
      const lastTerm: string = await Prefs.getString('schedule_last_term', '');
      if (lastTerm.length > 0) {
        const cached: CachedSchedule | null = await CourseCache.load(lastTerm);
        if (cached && cached.courses && cached.courses.length > 0) {
          courses = coursesToSchedule(cached.courses);
          firstDay = cached.firstDay;
          hilog.info(DOMAIN, this.TAG, '课程缓存命中, term=%{public}s, count=%{public}d',
            lastTerm, cached.courses.length);
        }
      }
    } catch (e) {
      hilog.warn(DOMAIN, this.TAG, '课程加载失败: %{public}s', JSON.stringify(e));
    }

    // 2. 获取 DDL 数据（本地存储）
    let ddls: import('../corelogic/WidgetData.ts').DDLSchedule[] = [];
    try {
      const ddlEntries = await DdlStore.load();
      ddls = ddlsToSchedule(ddlEntries);
      hilog.info(DOMAIN, this.TAG, 'DDL 加载完成, count=%{public}d', ddls.length);
    } catch (e) {
      hilog.warn(DOMAIN, this.TAG, 'DDL 加载失败: %{public}s', JSON.stringify(e));
    }

    // 3. 动态源和座位源为空（当前阶段未落地）
    const activities: EclassActivity[] = [];
    const adjustments: AdjustmentEntry[] = [];

    // 4. 装配卡片数据
    const pages = assembleWidgetPages({
      courses: courses,
      ddls: ddls,
      activities: activities,
      adjustments: adjustments,
      firstDay: firstDay,
      timeTable: timeTable,
      now: now
    });

    // 5. 验证序列化（卡片独立进程前提）
    if (!isSerializablePayload(pages)) {
      hilog.error(DOMAIN, this.TAG, 'payload 不可序列化！');
      return '';
    }

    const payload: string = JSON.stringify(pages);
    hilog.info(DOMAIN, this.TAG, '卡片数据装配完成, pages=%{public}d, payloadLen=%{public}d',
      pages.length, payload.length);
    return payload;
  }
}
