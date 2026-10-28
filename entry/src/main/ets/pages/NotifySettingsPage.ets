/**
 * 提醒设置页（M7-5：总开关 + 五类开关 + 三组提前量）。
 *
 * 对照 Android NotifySettingViewModel 的 `write` 块：**每次改动都重排**——
 * 已排的 reminderAgent 是按旧设置定的时刻，不重排就「改了提前量却不生效」。
 * 所以每个开关 / 提前量的 onClick 都走 commit()（save + reschedule），
 * 结果回显在底部状态行（排了几条 / 被裁几条 / 为什么没排）。
 *
 * 提前量不给自由输入（与 Android 一致：固定选项，免得填出「提前 3 天」）。
 * 教学调整只有开关、无提前量（时机固定「补课前一天 20:00」，改了反而误导）。
 *
 * ⚠️ 本编译器 UI 描述层只认「build() 根节点起手 + 纯值」：可交互行**内联**写
 * （照 SettingsPage 逐行、DdlPage 的 ForEach 单参 key），不用带 lambda 的 @Builder
 *（带闭包参数捕获 this 在 ArkTS 下是风险点，M5/M7 已踩过 build() 局部变量同类坑）。
 */

import { router } from '@kit.ArkUI';
import { gridTokens } from '../core/theme/GridTokens.ts';
import type { GridTokens } from '../core/theme/GridTokens.ts';
import { STORAGE_DARK, STORAGE_PALETTE, getPalette } from '../data/ThemeStore.ts';
import { Context } from '@kit.AbilityKit';
import {
  NotifySettingsStore,
  type NotifySettings,
  DEFAULT_NOTIFY_SETTINGS,
  CLASS_LEAD_OPTIONS,
  SEAT_LEAD_OPTIONS,
  EXAM_LEAD_OPTIONS
} from '../data/NotifySettingsStore.ts';
import { ReminderScheduler } from '../service/ReminderScheduler.ts';
import { QuietHoursStore } from '../data/QuietHoursStore.ts';
import { scheduleStatusText, needsNotificationPermission } from '../corelogic/NotifyStatusText.ts';
import {
  type QuietHours,
  type QuietPreset,
  QUIET_PRESETS,
  DEFAULT_QUIET_HOURS,
  quietSummary,
  quietHint
} from '../corelogic/QuietHoursLogic.ts';
import { info, warn } from '../core/log/BitLog.ts';

@Entry
@Component
struct NotifySettingsPage {
  @StorageLink(STORAGE_DARK) isDark: boolean = false;
  @StorageLink(STORAGE_PALETTE) paletteName: string = 'warm';
  @State notifyEnabled: boolean = DEFAULT_NOTIFY_SETTINGS.enabled;
  @State classEnabled: boolean = DEFAULT_NOTIFY_SETTINGS.classEnabled;
  @State classLead: number = DEFAULT_NOTIFY_SETTINGS.classLeadMinutes;
  @State ddlEnabled: boolean = DEFAULT_NOTIFY_SETTINGS.ddlEnabled;
  @State ddlDayEnabled: boolean = DEFAULT_NOTIFY_SETTINGS.ddlDayEnabled;
  @State ddlHourEnabled: boolean = DEFAULT_NOTIFY_SETTINGS.ddlHourEnabled;
  @State seatEnabled: boolean = DEFAULT_NOTIFY_SETTINGS.seatEnabled;
  @State seatLead: number = DEFAULT_NOTIFY_SETTINGS.seatSignInLeadMinutes;
  @State scoreEnabled: boolean = DEFAULT_NOTIFY_SETTINGS.scoreEnabled;
  @State examEnabled: boolean = DEFAULT_NOTIFY_SETTINGS.examEnabled;
  @State examDayEnabled: boolean = DEFAULT_NOTIFY_SETTINGS.examDayEnabled;
  @State examLead: number = DEFAULT_NOTIFY_SETTINGS.examLeadMinutes;
  @State adjustmentEnabled: boolean = DEFAULT_NOTIFY_SETTINGS.adjustmentEnabled;
  /** 免打扰（M12-2）：与提醒设置分开存，关掉提醒总开关也留着。 */
  @State quietOn: boolean = DEFAULT_QUIET_HOURS.enabled;
  @State quietStart: number = DEFAULT_QUIET_HOURS.startMinute;
  @State quietEnd: number = DEFAULT_QUIET_HOURS.endMinute;
  @State status: string = '';
  /** 系统通知未授权（页面据此显示「开启通知」按钮）。 */
  @State needPerm: boolean = false;
  @State busy: boolean = false;

  private tk(): GridTokens {
    return gridTokens(this.isDark, getPalette(this.paletteName));
  }

  onPageShow(): void {
    this.reload();
  }

  private async reload(): Promise<void> {
    const s: NotifySettings = await NotifySettingsStore.load();
    this.notifyEnabled = s.enabled;
    this.classEnabled = s.classEnabled;
    this.classLead = s.classLeadMinutes;
    this.ddlEnabled = s.ddlEnabled;
    this.ddlDayEnabled = s.ddlDayEnabled;
    this.ddlHourEnabled = s.ddlHourEnabled;
    this.seatEnabled = s.seatEnabled;
    this.seatLead = s.seatSignInLeadMinutes;
    this.scoreEnabled = s.scoreEnabled;
    this.examEnabled = s.examEnabled;
    this.examDayEnabled = s.examDayEnabled;
    this.examLead = s.examLeadMinutes;
    this.adjustmentEnabled = s.adjustmentEnabled;
    // 免打扰单独读（它不在 notify_settings_v1 里）
    try {
      const q: QuietHours = await QuietHoursStore.load();
      this.quietOn = q.enabled;
      this.quietStart = q.startMinute;
      this.quietEnd = q.endMinute;
    } catch (e) {
      warn('NotifySettings reload quiet fail: ' + JSON.stringify(e));
    }
  }

  /** 提交当前 13 项：落库 → 重排 → 回显结果（改动即生效，对照 Android write 块）。 */
  private async commit(): Promise<void> {
    if (this.busy) {
      return;
    }
    this.busy = true;
    try {
      const ctx: Context = getContext(this) as Context;
      const s: NotifySettings = {
        enabled: this.notifyEnabled,
        classEnabled: this.classEnabled,
        classLeadMinutes: this.classLead,
        ddlEnabled: this.ddlEnabled,
        ddlDayEnabled: this.ddlDayEnabled,
        ddlHourEnabled: this.ddlHourEnabled,
        seatEnabled: this.seatEnabled,
        seatSignInLeadMinutes: this.seatLead,
        scoreEnabled: this.scoreEnabled,
        examEnabled: this.examEnabled,
        examDayEnabled: this.examDayEnabled,
        examLeadMinutes: this.examLead,
        adjustmentEnabled: this.adjustmentEnabled
      };
      await NotifySettingsStore.save(s);
      const r = await ReminderScheduler.reschedule(ctx);
      // 文案走纯函数（两个入口共用一份；单测钉住「每个 reason 都有自己的话」）
      this.status = scheduleStatusText(r);
      // 系统没授权时给一颗真的能点的按钮（此前只有一行小字，用户无从下手）
      this.needPerm = needsNotificationPermission(r.reason);
      info('notify settings commit status=' + this.status);
    } catch (e) {
      warn('notify settings commit fail: ' + JSON.stringify(e));
      this.status = '保存失败：' + JSON.stringify(e);
    }
    this.busy = false;
  }

  /**
   * 请求系统通知权限并重排（M12-8）。
   *
   * ⚠️ 这条链原本是断的：`ReminderScheduler.ensureNotificationEnabled()` 写好了
   * 但**全仓零引用**，于是用户在真机上只能看到「系统通知开关未开」一行小字，
   * 没有任何入口去开。reminderAgent 的前置硬条件就是这个开关，
   * 不开 ⇒ 一条提醒都排不出去（fail-closed，行为本身是对的）。
   */
  private async grantPermission(): Promise<void> {
    if (this.busy) {
      return;
    }
    this.busy = true;
    try {
      const okPerm: boolean = await ReminderScheduler.ensureNotificationEnabled();
      if (!okPerm) {
        this.status = '仍未获得通知权限。请到系统「设置 → 通知」里手动允许本应用。';
        this.needPerm = true;
        info('notify permission still denied');
      } else {
        const ctx: Context = getContext(this) as Context;
        const r = await ReminderScheduler.reschedule(ctx);
        this.status = scheduleStatusText(r);
        this.needPerm = needsNotificationPermission(r.reason);
        info('notify permission granted, reschedule published=' + r.published);
      }
    } catch (e) {
      warn('grantPermission fail: ' + JSON.stringify(e));
      this.status = '请求通知权限失败：' + JSON.stringify(e);
    }
    this.busy = false;
  }

  /** 提交免打扰（M12-2）：单独落库 + 重排（换了窗口，已排的时刻就变了）。 */
  private async commitQuiet(): Promise<void> {
    if (this.busy) {
      return;
    }
    this.busy = true;
    try {
      const ctx: Context = getContext(this) as Context;
      const q: QuietHours = {
        enabled: this.quietOn,
        startMinute: this.quietStart,
        endMinute: this.quietEnd
      };
      await QuietHoursStore.save(q);
      const r = await ReminderScheduler.reschedule(ctx);
      // ⚠️ 这里原来只处理了 all_in_quiet_hours，其余全落进 else ——
      // 于是「系统通知没授权」被显示成「已重排 0 条」（真机实踩）。
      this.status = '免打扰已保存。' + scheduleStatusText(r);
      this.needPerm = needsNotificationPermission(r.reason);
      info('quiet commit status=' + this.status);
    } catch (e) {
      warn('quiet commit fail: ' + JSON.stringify(e));
      this.status = '保存失败：' + JSON.stringify(e);
    }
    this.busy = false;
  }

  /** 提前量文案（60→1小时、90→1.5小时、120→2小时；其余用分钟）。 */
  private leadText(minutes: number): string {
    if (minutes < 60) {
      return minutes + ' 分钟';
    }
    if (minutes % 60 === 0) {
      return (minutes / 60) + ' 小时';
    }
    return String(minutes / 60) + ' 小时';
  }

  build() {
    Column() {
      // 返回 + 标题
      Row() {
        Text('‹')
          .fontSize(28).fontColor(this.tk().onSurface).width(44)
          .textAlign(TextAlign.Center).margin({ left: 8 })
          .onClick(() => router.back())
        Text('提醒设置')
          .fontSize(18).fontWeight(FontWeight.Bold).fontColor(this.tk().onSurface).layoutWeight(1)
      }
      .width('100%').height(56).backgroundColor(this.tk().background)

      Scroll() {
        Column() {
          // ── 总开关 ──
          Row() {
            Text('总开关').fontSize(14).fontColor(this.tk().onSurface).layoutWeight(1)
            Text(this.notifyEnabled ? '开' : '关')
              .fontSize(13)
              .fontColor(this.notifyEnabled ? this.tk().onPrimary : this.tk().onSurfaceVariant)
              .backgroundColor(this.notifyEnabled ? this.tk().primary : this.tk().surface2)
              .borderRadius(10).padding({ left: 12, right: 12, top: 4, bottom: 4 })
          }
          .width('100%').padding({ top: 10, bottom: 10 })
          .onClick(() => {
            this.notifyEnabled = !this.notifyEnabled;
            this.commit();
          })

          // ── 上课 ──
          Text('上课提醒').fontSize(13).fontColor(this.tk().onSurfaceVariant).width('100%').margin({ top: 14, bottom: 4 })
          Row() {
            Text('上课提醒').fontSize(14).fontColor(this.tk().onSurface).layoutWeight(1)
            Text(this.classEnabled ? '开' : '关')
              .fontSize(13).fontColor(this.classEnabled ? this.tk().onPrimary : this.tk().onSurfaceVariant)
              .backgroundColor(this.classEnabled ? this.tk().primary : this.tk().surface2)
              .borderRadius(10).padding({ left: 12, right: 12, top: 4, bottom: 4 })
          }
          .width('100%').padding({ top: 8, bottom: 4 })
          .onClick(() => {
            this.classEnabled = !this.classEnabled;
            this.commit();
          })
          Row() {
            Text('提前').fontSize(13).fontColor(this.tk().onSurfaceVariant)
            ForEach(CLASS_LEAD_OPTIONS, (v: number) => {
              Text(this.leadText(v))
                .fontSize(12)
                .fontColor(this.classLead === v ? this.tk().onPrimary : this.tk().onSurfaceVariant)
                .backgroundColor(this.classLead === v ? this.tk().primary : this.tk().surface2)
                .borderRadius(12).padding({ left: 10, right: 10, top: 4, bottom: 4 }).margin({ left: 8 })
                .onClick(() => {
                  this.classLead = v;
                  this.commit();
                })
            }, (v: number) => 'cl' + v)
          }
          .width('100%').padding({ top: 2, bottom: 4 })

          // ── 作业（DDL）──
          Text('作业（DDL）').fontSize(13).fontColor(this.tk().onSurfaceVariant).width('100%').margin({ top: 14, bottom: 4 })
          Row() {
            Text('作业提醒').fontSize(14).fontColor(this.tk().onSurface).layoutWeight(1)
            Text(this.ddlEnabled ? '开' : '关')
              .fontSize(13).fontColor(this.ddlEnabled ? this.tk().onPrimary : this.tk().onSurfaceVariant)
              .backgroundColor(this.ddlEnabled ? this.tk().primary : this.tk().surface2)
              .borderRadius(10).padding({ left: 12, right: 12, top: 4, bottom: 4 })
          }
          .width('100%').padding({ top: 8, bottom: 4 })
          .onClick(() => {
            this.ddlEnabled = !this.ddlEnabled;
            this.commit();
          })
          Row() {
            Text('截止前一天提醒').fontSize(14).fontColor(this.tk().onSurface).layoutWeight(1)
            Text(this.ddlDayEnabled ? '开' : '关')
              .fontSize(13).fontColor(this.ddlDayEnabled ? this.tk().onPrimary : this.tk().onSurfaceVariant)
              .backgroundColor(this.ddlDayEnabled ? this.tk().primary : this.tk().surface2)
              .borderRadius(10).padding({ left: 12, right: 12, top: 4, bottom: 4 })
          }
          .width('100%').padding({ top: 8, bottom: 4 })
          .onClick(() => {
            this.ddlDayEnabled = !this.ddlDayEnabled;
            this.commit();
          })
          Row() {
            Text('截止前一小时提醒').fontSize(14).fontColor(this.tk().onSurface).layoutWeight(1)
            Text(this.ddlHourEnabled ? '开' : '关')
              .fontSize(13).fontColor(this.ddlHourEnabled ? this.tk().onPrimary : this.tk().onSurfaceVariant)
              .backgroundColor(this.ddlHourEnabled ? this.tk().primary : this.tk().surface2)
              .borderRadius(10).padding({ left: 12, right: 12, top: 4, bottom: 4 })
          }
          .width('100%').padding({ top: 8, bottom: 4 })
          .onClick(() => {
            this.ddlHourEnabled = !this.ddlHourEnabled;
            this.commit();
          })

          // ── 座位签到 ──
          Text('座位签到').fontSize(13).fontColor(this.tk().onSurfaceVariant).width('100%').margin({ top: 14, bottom: 4 })
          Row() {
            Text('签到提醒').fontSize(14).fontColor(this.tk().onSurface).layoutWeight(1)
            Text(this.seatEnabled ? '开' : '关')
              .fontSize(13).fontColor(this.seatEnabled ? this.tk().onPrimary : this.tk().onSurfaceVariant)
              .backgroundColor(this.seatEnabled ? this.tk().primary : this.tk().surface2)
              .borderRadius(10).padding({ left: 12, right: 12, top: 4, bottom: 4 })
          }
          .width('100%').padding({ top: 8, bottom: 4 })
          .onClick(() => {
            this.seatEnabled = !this.seatEnabled;
            this.commit();
          })
          Row() {
            Text('提前').fontSize(13).fontColor(this.tk().onSurfaceVariant)
            ForEach(SEAT_LEAD_OPTIONS, (v: number) => {
              Text(this.leadText(v))
                .fontSize(12)
                .fontColor(this.seatLead === v ? this.tk().onPrimary : this.tk().onSurfaceVariant)
                .backgroundColor(this.seatLead === v ? this.tk().primary : this.tk().surface2)
                .borderRadius(12).padding({ left: 10, right: 10, top: 4, bottom: 4 }).margin({ left: 8 })
                .onClick(() => {
                  this.seatLead = v;
                  this.commit();
                })
            }, (v: number) => 'sl' + v)
          }
          .width('100%').padding({ top: 2, bottom: 4 })

          // ── 出分（M7-3：取数管道已接，需要先在「成绩」页保存学号密码）──
          Text('出分提醒').fontSize(13).fontColor(this.tk().onSurfaceVariant).width('100%').margin({ top: 14, bottom: 4 })
          Row() {
            Text('出分提醒').fontSize(14).fontColor(this.tk().onSurface).layoutWeight(1)
            Text(this.scoreEnabled ? '开' : '关')
              .fontSize(13).fontColor(this.scoreEnabled ? this.tk().onPrimary : this.tk().onSurfaceVariant)
              .backgroundColor(this.scoreEnabled ? this.tk().primary : this.tk().surface2)
              .borderRadius(10).padding({ left: 12, right: 12, top: 4, bottom: 4 })
          }
          .width('100%').padding({ top: 8, bottom: 4 })
          .onClick(() => {
            this.scoreEnabled = !this.scoreEnabled;
            this.commit();
          })
          Text('需要先在「设置 → 成绩查询」里保存学号密码（存系统密钥库），否则无法自动检查。')
            .fontSize(11).fontColor(this.tk().onSurfaceVariant)
            .width('100%').padding({ bottom: 4 })

          // ── 考试 ──
          Text('考试').fontSize(13).fontColor(this.tk().onSurfaceVariant).width('100%').margin({ top: 14, bottom: 4 })
          Row() {
            Text('考试提醒').fontSize(14).fontColor(this.tk().onSurface).layoutWeight(1)
            Text(this.examEnabled ? '开' : '关')
              .fontSize(13).fontColor(this.examEnabled ? this.tk().onPrimary : this.tk().onSurfaceVariant)
              .backgroundColor(this.examEnabled ? this.tk().primary : this.tk().surface2)
              .borderRadius(10).padding({ left: 12, right: 12, top: 4, bottom: 4 })
          }
          .width('100%').padding({ top: 8, bottom: 4 })
          .onClick(() => {
            this.examEnabled = !this.examEnabled;
            this.commit();
          })
          Row() {
            Text('考前一天提醒').fontSize(14).fontColor(this.tk().onSurface).layoutWeight(1)
            Text(this.examDayEnabled ? '开' : '关')
              .fontSize(13).fontColor(this.examDayEnabled ? this.tk().onPrimary : this.tk().onSurfaceVariant)
              .backgroundColor(this.examDayEnabled ? this.tk().primary : this.tk().surface2)
              .borderRadius(10).padding({ left: 12, right: 12, top: 4, bottom: 4 })
          }
          .width('100%').padding({ top: 8, bottom: 4 })
          .onClick(() => {
            this.examDayEnabled = !this.examDayEnabled;
            this.commit();
          })
          Row() {
            Text('提前').fontSize(13).fontColor(this.tk().onSurfaceVariant)
            ForEach(EXAM_LEAD_OPTIONS, (v: number) => {
              Text(this.leadText(v))
                .fontSize(12)
                .fontColor(this.examLead === v ? this.tk().onPrimary : this.tk().onSurfaceVariant)
                .backgroundColor(this.examLead === v ? this.tk().primary : this.tk().surface2)
                .borderRadius(12).padding({ left: 10, right: 10, top: 4, bottom: 4 }).margin({ left: 8 })
                .onClick(() => {
                  this.examLead = v;
                  this.commit();
                })
            }, (v: number) => 'el' + v)
          }
          .width('100%').padding({ top: 2, bottom: 4 })

          // ── 教学调整（只有开关）──
          Text('教学调整（补课）').fontSize(13).fontColor(this.tk().onSurfaceVariant).width('100%').margin({ top: 14, bottom: 4 })
          Row() {
            Text('补课提醒').fontSize(14).fontColor(this.tk().onSurface).layoutWeight(1)
            Text(this.adjustmentEnabled ? '开' : '关')
              .fontSize(13).fontColor(this.adjustmentEnabled ? this.tk().onPrimary : this.tk().onSurfaceVariant)
              .backgroundColor(this.adjustmentEnabled ? this.tk().primary : this.tk().surface2)
              .borderRadius(10).padding({ left: 12, right: 12, top: 4, bottom: 4 })
          }
          .width('100%').padding({ top: 8, bottom: 4 })
          .onClick(() => {
            this.adjustmentEnabled = !this.adjustmentEnabled;
            this.commit();
          })

          // ── 免打扰时段（M12-2）──
          Text('免打扰').fontSize(13).fontColor(this.tk().onSurfaceVariant).width('100%').margin({ top: 18, bottom: 4 })
          Row() {
            Text('免打扰时段').fontSize(14).fontColor(this.tk().onSurface).layoutWeight(1)
            Text(quietSummary({ enabled: this.quietOn, startMinute: this.quietStart, endMinute: this.quietEnd }))
              .fontSize(12).fontColor(this.tk().onSurfaceVariant).margin({ right: 10 })
            Text(this.quietOn ? '开' : '关')
              .fontSize(13).fontColor(this.quietOn ? this.tk().onPrimary : this.tk().onSurfaceVariant)
              .backgroundColor(this.quietOn ? this.tk().primary : this.tk().surface2)
              .borderRadius(10).padding({ left: 12, right: 12, top: 4, bottom: 4 })
          }
          .width('100%').padding({ top: 8, bottom: 4 })
          .accessibilityText('免打扰时段，当前' +
            quietSummary({ enabled: this.quietOn, startMinute: this.quietStart, endMinute: this.quietEnd }) +
            '，' + (this.quietOn ? '已开启' : '已关闭'))
          .onClick(() => {
            this.quietOn = !this.quietOn;
            this.commitQuiet();
          })

          // 预设三选一（与 Android 一样不给自由输入；跨零点的窗口最常见）
          if (this.quietOn) {
            Row() {
              ForEach(QUIET_PRESETS, (p: QuietPreset) => {
                Text(p.label)
                  .fontSize(12)
                  .fontColor((this.quietStart === p.startMinute && this.quietEnd === p.endMinute)
                    ? this.tk().onPrimary : this.tk().onSurfaceVariant)
                  .backgroundColor((this.quietStart === p.startMinute && this.quietEnd === p.endMinute)
                    ? this.tk().primary : this.tk().surface2)
                  .borderRadius(12).padding({ left: 10, right: 10, top: 5, bottom: 5 })
                  .margin({ right: 8 })
                  .onClick(() => {
                    this.quietStart = p.startMinute;
                    this.quietEnd = p.endMinute;
                    this.commitQuiet();
                  })
              }, (p: QuietPreset) => 'qp_' + p.label)
            }
            .width('100%').padding({ top: 2, bottom: 2 })

            Text(quietHint({ enabled: this.quietOn, startMinute: this.quietStart, endMinute: this.quietEnd }))
              .fontSize(11).fontColor(this.tk().onSurfaceVariant).width('100%').padding({ top: 2, bottom: 4 })
          }

          // ── 重排结果 ──
          if (this.status.length > 0) {
            Text(this.status).fontSize(12).fontColor(this.tk().onSurfaceVariant).width('100%').padding({ top: 12, bottom: 8 })
          }
          // 未授权时给一个**能点**的入口（否则用户只看到一句「通知未开」无从下手）
          if (this.needPerm) {
            Button('开启通知')
              .height(38).fontSize(13).width('100%')
              .backgroundColor(this.tk().primary).fontColor(this.tk().onPrimary)
              .enabled(!this.busy)
              .accessibilityText('开启通知权限，点按后系统会询问是否允许本应用发送通知')
              .onClick(() => {
                this.grantPermission();
              })
          }
        }
        .width('100%').padding({ left: 12, right: 12, top: 8, bottom: 24 })
      }
      .width('100%').layoutWeight(1)
      // ⚠️ 顶对齐必须挂 Scroll 自身：加在内层 Column 上不生效（内容不足一屏会被垂直居中）
      .align(Alignment.Top)
    }
    .width('100%').height('100%')
    .backgroundColor(this.tk().background)
  }
}
