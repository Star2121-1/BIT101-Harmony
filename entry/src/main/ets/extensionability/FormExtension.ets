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
import { formBindingData, formProvider } from '@kit.FormKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { Context } from '@kit.AbilityKit';
import type { Want } from '@kit.AbilityKit';
import { resourceManager } from '@kit.LocalizationKit';
import { Prefs } from '../data/Prefs.ts';
import { CourseCache, CachedSchedule } from '../data/CourseCache.ts';
import { DdlStore } from '../data/DdlStore.ts';
import { TermStore, isTermOverride } from '../data/TermStore.ts';
import { assembleWidgetPages, isSerializablePayload } from '../corelogic/WidgetData.ts';
import { coursesToSchedule, ddlsToSchedule } from '../corelogic/WidgetData.ts';
import { FALLBACK_TIME_TABLE } from '../corelogic/TimeTableLogic.ts';
import { parseISODate } from '../corelogic/timeutil.ts';
import { getPaletteName } from '../core/theme/GridTokens.ts';
import type { PaletteName } from '../core/theme/GridTokens.ts';
import type { AdjustmentEntry } from '../corelogic/TeachingAdjustment.ts';
import type { EclassActivity } from '../corelogic/EclassActivityLogic.ts';
import type { TimeTable, DateTime } from '../corelogic/timeutil.ts';
import type { CourseSchedule, DDLSchedule } from '../corelogic/WidgetLogic.ts';

const DOMAIN = 0x0003; // Form 专属域

/** 卡片主题快照（与主进程同一份偏好：palette 三选一 + 深浅色）。 */
interface WidgetTheme {
  palette: PaletteName;
  dark: boolean;
}

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
   * 卡片创建时调用。
   * ⚠️ 签名必须**同步**返回 FormBindingData（d.ts：`onAddForm(want: Want): FormBindingData`；
   * 返回 Promise 不兼容，编译门实录 2026-10-22）。
   * 装配是异步的 ⇒ 先返回空数据，装配完经 `formProvider.updateForm` 推送。
   */
  onAddForm(want: Want): formBindingData.FormBindingData {
    const formId: string = String(want.parameters?.['ohos.extra.param.key.form_id'] ?? '');
    hilog.info(DOMAIN, this.TAG, 'onAddForm: %{public}s', formId);
    // ⚠️⚠️ 卡片跑在**独立进程**，主进程 EntryAbility 里的 `Prefs.init` 根本不会执行到
    //   这里。不补这一句，下面所有 Prefs/CourseCache/DdlStore 读取都会抛
    //   「Prefs 未初始化」→ payload 恒空 → 卡片永远停在占位态（2026-10-27 真机实证：
    //   「卡片」菜单进得去、预览也有，但加进桌面只显示「请打开 App 查看完整功能」）。
    //   不 await：init 幂等，后续每个读写都会 await 同一个 promise。
    Prefs.init(this.context);
    // 异步装配 + 推送（不阻塞 onAddForm 返回）
    this.assembleAndPush(formId);
    return formBindingData.createFormBindingData({
      widgetPayload: '', widgetPalette: 'warm', widgetDark: false
    });
  }

  /** 装配 payload 并推送（onAddForm / onUpdateForm 共用）。 */
  private async assembleAndPush(formId: string): Promise<void> {
    try {
      const theme: WidgetTheme = await this.readTheme();
      const payload = await this.assemblePayload();
      if (payload.length === 0) {
        hilog.warn(DOMAIN, this.TAG, 'assembleAndPush: payload empty, formId=%{public}s', formId);
        return;
      }
      await this.setFormBindingData(formId, payload, theme);
      hilog.info(DOMAIN, this.TAG, 'assembleAndPush success: %{public}s, len=%{public}d',
        formId, payload.length);
    } catch (e) {
      hilog.error(DOMAIN, this.TAG, 'assembleAndPush failed: %{public}s', JSON.stringify(e));
    }
  }

  /**
   * 读主题快照（与主进程同一份偏好）。
   *
   * 为什么要传：卡片页 `WidgetPage` 之前写死深绿 #1A7F37 / 白底，和 App 的三套
   * palette 完全不搭（2026-10-27 真机上看就是「另一个 App 的卡片」）。卡片进程读不到
   * `AppStorage`，所以由这里算好，随 binding data 一起下发。
   */
  private async readTheme(): Promise<WidgetTheme> {
    let mode: string = 'auto';
    let paletteRaw: string = 'warm';
    try {
      mode = await Prefs.getString('ui_theme_mode', 'auto');
      paletteRaw = await Prefs.getString('ui_theme_palette', 'warm');
    } catch (e) {
      hilog.warn(DOMAIN, this.TAG, 'readTheme prefs fail: %{public}s', JSON.stringify(e));
    }
    let dark: boolean = false;
    if (mode === 'dark') {
      dark = true;
    } else if (mode === 'auto') {
      // 跟随系统：卡片进程拿不到 `configuration`（FormExtensionContext 没这个字段，
      // 编译门 2026-10-27 实录），改问 resourceManager 的系统配置。
      try {
        const cfg = await this.context.resourceManager.getConfiguration();
        dark = cfg.colorMode === resourceManager.ColorMode.DARK;
      } catch (e) {
        hilog.warn(DOMAIN, this.TAG, 'readTheme colorMode fail: %{public}s', JSON.stringify(e));
        dark = false;
      }
    }
    return { palette: getPaletteName(paletteRaw), dark };
  }

  /**
   * 卡片更新时调用（系统定时触发或手动刷新）
   * 签名对齐 d.ts：`onUpdateForm(formId: string, wantParams?: Record<string, Object>): void`
   */
  async onUpdateForm(formId: string, wantParams?: Record<string, Object>): Promise<void> {
    hilog.info(DOMAIN, this.TAG, 'onUpdateForm: %{public}s', formId);
    // 冷启动后系统直接触发更新时同样要补 init（进程可能刚起来）
    Prefs.init(this.context);
    await this.assembleAndPush(formId);
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
   * 把装配好的 payload 推给卡片页面。
   *
   * 官方模式（API 9+）：`formBindingData.createFormBindingData({ key: obj })` 建数据对象，
   * `formProvider.updateForm(formId, formData)` 推送；卡片页面（WidgetPage）用
   * `@LocalStorageProp('widgetPayload')` 收同一个 key。
   * ⚠️ API 12 起 formBindingData 没有 getFormBindingData（编译门实录 2026-10-22）。
   */
  private async setFormBindingData(formId: string, payload: string, theme: WidgetTheme): Promise<void> {
    const formData = formBindingData.createFormBindingData({
      widgetPayload: payload,
      widgetPalette: theme.palette,
      widgetDark: theme.dark
    });
    await formProvider.updateForm(formId, formData);
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
    let courses: CourseSchedule[] = [];
    let firstDay: string = '';
    let timeTable: TimeTable = FALLBACK_TIME_TABLE;

    try {
      let lastTerm: string = await Prefs.getString('schedule_last_term', '');
      // ⚠️ 「当前学期」只有 TermStore 一个来源（设置页切过学期就用那个），
      //    否则卡片会和课表页显示两个学期 —— 与 test-termstore 钉的是同一条规矩。
      const override: string = await TermStore.load(this.context);
      if (isTermOverride(override)) {
        lastTerm = override;
      }
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
    let ddls: DDLSchedule[] = [];
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
