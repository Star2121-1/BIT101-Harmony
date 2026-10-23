/**
 * 全局前台/后台状态（M9-8 前台监控生命周期）。
 *
 * 鸿蒙后台任务受限（最长 2 分钟），M9-8 的监控只能在前台进行：
 * - 由 EntryAbility.onForeground / onBackground 驱动本标志；
 * - SeatMonitorLogic 的轮询循环每轮检查它，App 退后台即暂停轮询；
 * - UI 监控面板顶部的「状态条」订阅它，明确提示「已暂停：App 在后台不监控」。
 *
 * 纯逻辑、零 @kit 依赖，可 Node 单测。
 */

export class AppForegroundState {
  private foreground: boolean = true;
  private listeners: Array<() => void> = [];

  private static instance: AppForegroundState | null = null;

  static get(): AppForegroundState {
    if (AppForegroundState.instance === null) {
      AppForegroundState.instance = new AppForegroundState();
    }
    return AppForegroundState.instance;
  }

  /** App 是否在前台（默认 true）。 */
  isForeground(): boolean {
    return this.foreground;
  }

  /** 设置前台标志；值不变则跳过（避免重复通知）。 */
  setForeground(value: boolean): void {
    if (this.foreground === value) {
      return;
    }
    this.foreground = value;
    this.listeners.forEach((cb) => cb());
  }

  /** 订阅前台标志变化，返回取消订阅函数。 */
  onChange(callback: () => void): () => void {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter((cb) => cb !== callback);
    };
  }
}

/** 便捷读：当前是否前台。 */
export function isForegroundNow(): boolean {
  return AppForegroundState.get().isForeground();
}

/** 便捷写：设置前台标志。 */
export function setForeground(value: boolean): void {
  AppForegroundState.get().setForeground(value);
}
