/**
 * 新建预约表单纯逻辑（对齐 Android NewTaskScreen）。
 * 只做字符串/日期判断，无 I/O、无 @kit 依赖，可离线单测。
 */

/** 表单模式（对齐 Android TaskMode.SINGLE/MONITOR/PREFER）。 */
export enum FormMode {
  SINGLE = 'SINGLE',
  MONITOR = 'MONITOR',
  PREFER = 'PREFER',
}

/** 模式 chip 文案（对齐 Android ModeSelector）。 */
export function modeLabel(mode: FormMode): string {
  if (mode === FormMode.MONITOR) return '监控预约';
  if (mode === FormMode.PREFER) return '优先预约';
  return '单次预约';
}

/** 给定 yyyy-MM-dd 的次日（对齐 Android LocalDate.plusDays(1)）。纯字符串+Date，无 @kit。 */
export function tomorrowOf(day: string): string {
  const parts: string[] = day.split('-');
  if (parts.length !== 3) return day;
  const y: number = Number(parts[0]);
  const m: number = Number(parts[1]);
  const d: number = Number(parts[2]);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return day;
  const dt: Date = new Date(y, m - 1, d + 1);
  const mm: string = (dt.getMonth() + 1).toString().padStart(2, '0');
  const dd: string = dt.getDate().toString().padStart(2, '0');
  return dt.getFullYear() + '-' + mm + '-' + dd;
}

/** 日期 chip 文案（对齐 Android NewTaskScreen.dateLabel）。 */
export function dateLabel(day: string, today: string, tomorrow: string): string {
  if (day.length === 0) return '';
  if (day === today) return '今天';
  if (day === tomorrow) return '明天';
  return day;
}

/** 底部主按钮文案（对齐 Android：SINGLE=选择座位，其余=创建任务）。 */
export function primaryButtonLabel(mode: FormMode): string {
  return mode === FormMode.SINGLE ? '选择座位' : '创建任务';
}

/** 目标/偏好座位区标题（对齐 Android PickedSeatRow title）。 */
export function pickedSeatTitle(mode: FormMode): string {
  if (mode === FormMode.MONITOR) return '目标座位（必选）';
  if (mode === FormMode.PREFER) return '偏好座位（可选，按顺序抢）';
  return '';
}

/** 目标/偏好座位区提示文案（对齐 Android PickedSeatRow hint）。 */
export function pickedSeatHint(mode: FormMode): string {
  if (mode === FormMode.MONITOR) {
    return '在座位图上点选一个座位 —— 已被占的座位也能选，那正是要等它空出来的目标';
  }
  if (mode === FormMode.PREFER) {
    return '不选 = 不限座位（区域内谁先空就抢谁）；也可点选多个座位按优先级依次抢';
  }
  return '';
}

/** 选座按钮文案（对齐 Android PickedSeatRow buttonText）。 */
export function pickButtonLabel(mode: FormMode): string {
  if (mode === FormMode.MONITOR) return '选择目标座位';
  if (mode === FormMode.PREFER) return '选择偏好座位';
  return '选择座位';
}

/**
 * 日期选项回落（对齐 Android：availableDays 为空则回落 今天/明天）。
 * 去重保序。
 */
export function dateOptions(days: string[], today: string, tomorrow: string): string[] {
  const base: string[] = days.length > 0 ? days.slice() : [today, tomorrow];
  const out: string[] = [];
  for (let i = 0; i < base.length; i++) {
    if (base[i].length > 0 && out.indexOf(base[i]) < 0) out.push(base[i]);
  }
  return out;
}

/**
 * 进入座位图页的校验：只要求选好区域。
 * ⚠️ 不能用 validateForm(MONITOR, …)：那条要求「先选目标座位」，而目标座位正是在图页里选的，
 * 用它当入口校验会形成"要进选座页必须先选座"的死结（真机 2026-11-23 抓到）。
 */
export function validateMapEntry(hasArea: boolean): string | null {
  return hasArea ? null : '请完整选择校区、楼层和区域';
}

/** 表单校验（对齐 Android 底部按钮的校验）：返回错误文案，null = 通过。 */
export function validateForm(
  mode: FormMode,
  hasArea: boolean,
  pickedCount: number,
): string | null {
  if (!hasArea) return '请完整选择校区、楼层和区域';
  if (mode === FormMode.MONITOR && pickedCount === 0) return '监控预约需要先在座位图上点选目标座位';
  return null;
}
