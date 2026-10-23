/**
 * 座位监控面板（M9-8）。
 *
 * 设计纪律（对照 Android TaskListScreen，但刻意不同）：
 * - 顶部状态条明确提示「前台监控中 / 已暂停（App 后台不监控）」——这是 M9-8 验收点。
 * - 任务卡列表复用 Android TaskCard 信息架构（区域名+状态徽章、校区·楼层、日期+时段、座位、模式、存活信息、消息）。
 * - FOUND → 去预约（confirmMonitoredSeat，铁律 0.6 唯一预约入口）。
 * - 活跃 → 取消监控（stopSeatMonitor）。
 * - 后台暂停(RUNNING+后台) → 继续监控（resumeMonitor，回到前台后恢复轮询）。
 * - 终态 → 删除记录（repo.remove）。
 * ⚠️ 所有动作均为用户显式点击，无自动路径；不退后台抢座（鸿蒙限制 + 铁律 0.6）。
 */

import { router } from '@kit.ArkUI';
import { Context } from '@kit.AbilityKit';
import { SeatServiceMonitorAdapter } from '../service/SeatServiceMonitorAdapter.ts';
import type { ISeatService } from '../corelogic/ISeatService.ts';
import { getTaskRepository } from '../data/SeatTaskStore.ts';
import { TaskMode, TaskStatus, isActiveStatus, needsUserConfirm } from '../model/SeatTask.ts';
import type { ReservationTask } from '../model/SeatTask.ts';
import { confirmMonitoredSeat, stopSeatMonitor, resumeMonitor } from '../corelogic/SeatMonitorLogic.ts';
import { AppForegroundState, isForegroundNow } from '../core/AppForegroundState.ts';
import { STORAGE_DARK } from '../data/ThemeStore.ts';

// ── 配色（随暗色主题切换；状态色为语义色不随主题变）──
function bgMain(dark: boolean): string { return dark ? '#0E0E0E' : '#F2F2F7'; }
function cardBg(dark: boolean): string { return dark ? '#1C1C1E' : '#FFFFFF'; }
function textMain(dark: boolean): string { return dark ? '#EDEDED' : '#1C1C1E'; }
function textSub(dark: boolean): string { return dark ? '#9A9A9A' : '#6B6B6B'; }

function statusText(s: TaskStatus): string {
  switch (s) {
    case TaskStatus.IDLE: return '等待中';
    case TaskStatus.RUNNING: return '监控中';
    case TaskStatus.FOUND: return '发现空位';
    case TaskStatus.SUCCESS: return '预约成功';
    case TaskStatus.FAILED: return '失败';
    case TaskStatus.CANCELLED: return '已取消';
    default: return '未知';
  }
}
function statusColor(s: TaskStatus): string {
  switch (s) {
    case TaskStatus.IDLE: return '#9E9E9E';
    case TaskStatus.RUNNING: return '#4A8CFF';
    case TaskStatus.FOUND: return '#34C759';
    case TaskStatus.SUCCESS: return '#34C759';
    case TaskStatus.FAILED: return '#FF453A';
    case TaskStatus.CANCELLED: return '#8A8A8E';
    default: return '#9E9E9E';
  }
}
function modeText(m: TaskMode): string {
  switch (m) {
    case TaskMode.MONITOR: return '监控';
    case TaskMode.PREFER: return '优先';
    case TaskMode.SINGLE: return '单次';
    default: return '-';
  }
}
function seatText(t: ReservationTask): string {
  if (t.mode === TaskMode.PREFER) {
    return t.preferredSeats.length > 0 ? '偏好 ' + t.preferredSeats.join('/') : '偏好 -';
  }
  return '座位 ' + (t.seatNo || '-');
}
function fmtDuration(ms: number): string {
  if (ms <= 0) return '0秒';
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}时${m % 60}分`;
  if (m > 0) return `${m}分${s % 60}秒`;
  return `${s}秒`;
}
function fmtAgo(ms: number, now: number): string {
  if (ms <= 0) return '尚未';
  const d = now - ms;
  if (d < 0) return '刚刚';
  return fmtDuration(d) + '前';
}

/** 单个监控任务卡片（信息架构对齐 Android TaskCard）。 */
@Component
struct TaskMonitorCard {
  @StorageLink(STORAGE_DARK) isDark: boolean = false;
  @Prop task: ReservationTask = {} as ReservationTask;
  @Prop foreground: boolean = true;
  @Prop now: number = 0;
  @Prop busy: boolean = false;
  onConfirm?: (id: string) => void;
  onCancel?: (id: string) => void;
  onResume?: (id: string) => void;
  onDelete?: (id: string) => void;

  @Builder
  badge() {
    Text(statusText(this.task.status))
      .fontSize(11)
      .fontColor(statusColor(this.task.status))
      .backgroundColor(this.isDark ? '#2A2A2E' : '#EFEFF4')
      .padding({ left: 8, right: 8, top: 3, bottom: 3 })
      .borderRadius(6);
  }

  private subText(): string {
    const parts: string[] = [];
    if (this.task.campusName.length > 0) parts.push(this.task.campusName);
    if (this.task.floorName.length > 0) parts.push(this.task.floorName);
    return parts.join(' · ');
  }

  private livenessText(): string {
    const waited = this.now - this.task.createdAt;
    return `已等待 ${fmtDuration(waited)} · 尝试 ${this.task.attempts} 次 · 最近 ${fmtAgo(this.task.lastAttemptAt, this.now)}`;
  }

  build() {
    Column() {
      Row() {
        Column() {
          Text(this.task.areaName.length > 0 ? this.task.areaName : (this.task.areaId.length > 0 ? this.task.areaId : '座位任务'))
            .fontSize(15)
            .fontWeight(FontWeight.Medium)
            .fontColor(textMain(this.isDark));
          if (this.subText().length > 0) {
            Text(this.subText())
              .fontSize(11)
              .fontColor(textSub(this.isDark))
              .margin({ top: 2 });
          }
        }
        .layoutWeight(1)
        .align(Alignment.Start)

        this.badge();
      }
      .width('100%')

      // 日期 + 时段
      Text(`${this.task.reserveDate.length > 0 ? this.task.reserveDate : '-'} ${this.task.startTime}~${this.task.endTime}`)
        .fontSize(11)
        .fontColor(textSub(this.isDark))
        .margin({ top: 8 });

      // 座位 + 模式
      Text(`${seatText(this.task)} · 模式 ${modeText(this.task.mode)}`)
        .fontSize(11)
        .fontColor(textSub(this.isDark))
        .margin({ top: 4 });

      // 存活信息：仅前台 + 监控中
      if (this.task.status === TaskStatus.RUNNING && this.foreground) {
        Text(this.livenessText())
          .fontSize(11)
          .fontColor(textSub(this.isDark))
          .margin({ top: 6 });
      }

      // 状态消息
      if (this.task.message.length > 0) {
        Text(this.task.message)
          .fontSize(11)
          .fontColor(textSub(this.isDark))
          .margin({ top: 6 });
      }

      // 操作区
      if (needsUserConfirm(this.task.status)) {
        Row() {
          Button('去预约')
            .backgroundColor('#34C759')
            .fontColor('#FFFFFF')
            .enabled(!this.busy)
            .onClick(() => this.onConfirm?.(this.task.id));
          Button('取消')
            .fontColor('#FF453A')
            .backgroundColor('#00000000')
            .onClick(() => this.onCancel?.(this.task.id));
        }
        .width('100%')
        .justifyContent(FlexAlign.Start)
        .margin({ top: 10 });
      } else if (this.task.status === TaskStatus.RUNNING && !this.foreground) {
        Button('继续监控')
          .backgroundColor('#4A8CFF')
          .fontColor('#FFFFFF')
          .enabled(!this.busy)
          .onClick(() => this.onResume?.(this.task.id))
          .margin({ top: 10 });
      } else if (isActiveStatus(this.task.status)) {
        Button('取消监控')
          .fontColor('#FF453A')
          .backgroundColor('#00000000')
          .onClick(() => this.onCancel?.(this.task.id))
          .margin({ top: 10 });
      } else {
        Button('删除记录')
          .fontColor(textSub(this.isDark))
          .backgroundColor('#00000000')
          .onClick(() => this.onDelete?.(this.task.id))
          .margin({ top: 10 });
      }
    }
    .width('100%')
    .padding(14)
    .backgroundColor(cardBg(this.isDark))
    .borderRadius(12)
    .margin({ bottom: 10 });
  }
}

@Entry
@Component
struct SeatMonitorPage {
  @StorageLink(STORAGE_DARK) isDark: boolean = false;
  @State tasks: ReservationTask[] = [];
  @State foreground: boolean = true;
  @State now: number = Date.now();
  @State busyId: string = '';

  private svc: ISeatService | null = null;
  private unsubRepo: (() => void) | null = null;
  private unsubFg: (() => void) | null = null;
  private timer: number = 0;

  aboutToAppear(): void {
    this.svc = new SeatServiceMonitorAdapter(getContext(this) as Context);
    const repo = getTaskRepository();
    repo.init().then(() => {
      this.refresh();
      this.unsubRepo = repo.onChange(() => this.refresh());
    });
    this.foreground = isForegroundNow();
    this.unsubFg = AppForegroundState.get().onChange(() => {
      this.foreground = isForegroundNow();
    });
    this.timer = setInterval(() => {
      this.now = Date.now();
    }, 1000);
  }

  aboutToDisappear(): void {
    if (this.unsubRepo !== null) this.unsubRepo();
    if (this.unsubFg !== null) this.unsubFg();
    if (this.timer !== 0) clearInterval(this.timer);
  }

  private refresh(): void {
    this.tasks = getTaskRepository().getTasks();
  }

  private activeCount(): number {
    let n = 0;
    for (let i = 0; i < this.tasks.length; i++) {
      if (isActiveStatus(this.tasks[i].status)) n++;
    }
    return n;
  }

  private handleConfirm(t: ReservationTask): void {
    if (this.busyId.length > 0 || this.svc === null) return;
    this.busyId = t.id;
    confirmMonitoredSeat(t.id, this.svc).then(() => {
      this.busyId = '';
    });
  }
  private handleCancel(t: ReservationTask): void {
    if (this.busyId.length > 0) return;
    this.busyId = t.id;
    stopSeatMonitor(t.id);
    this.busyId = '';
  }
  private handleResume(t: ReservationTask): void {
    if (this.busyId.length > 0 || this.svc === null) return;
    this.busyId = t.id;
    resumeMonitor(t.id, this.svc);
    this.busyId = '';
  }
  private handleDelete(t: ReservationTask): void {
    if (this.busyId.length > 0) return;
    this.busyId = t.id;
    getTaskRepository().remove(t.id);
    this.busyId = '';
  }

  build() {
    Column() {
      // 顶栏
      Row() {
        Button('‹ 返回')
          .onClick(() => router.back());
        Text('座位监控')
          .fontSize(16)
          .fontWeight(FontWeight.Bold)
          .layoutWeight(1)
          .textAlign(TextAlign.Center);
        Text('').width(48);
      }
      .width('100%')
      .padding(12);

      // 状态条（M9-8 验收点：明确提示前台监控 / 后台暂停）
      if (!this.foreground) {
        Row() {
          Text('已暂停：App 在后台时不轮询监控（不会后台抢座）')
            .fontSize(12)
            .fontColor('#EDEDED');
        }
        .width('100%')
        .padding(10)
        .backgroundColor('#3A2E12')
        .margin({ left: 12, right: 12, top: 4, bottom: 4 });
      } else if (this.activeCount() > 0) {
        Row() {
          Text(`监控中：正在为 ${this.activeCount()} 个任务轮询空位（仅前台）`)
            .fontSize(12)
            .fontColor('#EDEDED');
        }
        .width('100%')
        .padding(10)
        .backgroundColor('#13351F')
        .margin({ left: 12, right: 12, top: 4, bottom: 4 });
      } else {
        Row() {
          Text('监控就绪（当前没有进行中的任务）')
            .fontSize(12)
            .fontColor('#EDEDED');
        }
        .width('100%')
        .padding(10)
        .backgroundColor('#232325')
        .margin({ left: 12, right: 12, top: 4, bottom: 4 });
      }

      Scroll() {
        Column() {
          if (this.tasks.length === 0) {
            Text('还没有监控任务')
              .fontSize(13)
              .fontColor(textSub(this.isDark))
              .width('100%')
              .margin({ top: 40 });
            Text('在座位页选好区域后，可在此监控空位（仅前台，不退后台抢座）')
              .fontSize(11)
              .fontColor(textSub(this.isDark))
              .width('100%')
              .margin({ top: 6 });
          } else {
            ForEach(this.tasks, (t: ReservationTask) => {
              TaskMonitorCard({
                task: t,
                foreground: this.foreground,
                now: this.now,
                busy: this.busyId === t.id,
                onConfirm: (id: string) => this.handleConfirm(t),
                onCancel: (id: string) => this.handleCancel(t),
                onResume: (id: string) => this.handleResume(t),
                onDelete: (id: string) => this.handleDelete(t),
              });
            }, (t: ReservationTask) => t.id);
          }
        }
        .width('100%')
        .padding(12);
      }
      .layoutWeight(1)
      .width('100%');
    }
    .width('100%')
    .height('100%')
    .backgroundColor(bgMain(this.isDark));
  }
}
