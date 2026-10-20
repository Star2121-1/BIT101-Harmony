/**
 * 1:1 移植自 Android：
 * - data/.../data/school/TeachingAdjustment.kt 的 DayPlan 模型 + planOf + weekdayCn/dateLabelCn
 *   （⚠️ HTML/正文解析部分未移植 —— 那是取数层的事，见文件末说明）
 * - data/.../data/ddl/DdlSource.kt
 *
 * 移植日期：2026-10-19（夜间任务 2）
 *
 * DayPlan 语义：NoClass = 放假（那天的课不作数）；MakeUp(targetWeekday) = 按被指定那天的课表上课。
 * planOf：**只产出明确写出的安排**；查不到返回 null（正常）。
 */

// ── DayPlan ─────────────────────────────────────────────────────────────

export interface DayPlanNoClass {
  readonly kind: "NoClass";
}

export interface DayPlanMakeUp {
  readonly kind: "MakeUp";
  /** 被指定那天的星期几（1=周一 … 7=周日） */
  readonly targetWeekday: number;
}

export type DayPlan = DayPlanNoClass | DayPlanMakeUp;

export const NO_CLASS: DayPlanNoClass = { kind: "NoClass" };

export function makeUp(targetWeekday: number): DayPlanMakeUp {
  return { kind: "MakeUp", targetWeekday };
}

/** 一条教学安排（date 用 epoch day）。 */
export interface AdjustmentEntry {
  day: number;
  plan: DayPlan;
}

/** 取某一天的安排；没有返回 null（正常，不是失败）。 */
export function dayPlanOf(entries: AdjustmentEntry[], dateEpochDay: number): DayPlan | null {
  for (const e of entries) {
    if (e.day === dateEpochDay) return e.plan;
  }
  return null;
}

// ── 中文星期/日期（全 App 唯一一份，notify/schedule/widget 共用）─────────

const WEEKDAY_CN = ["一", "二", "三", "四", "五", "六", "日"];

/** 星期几的中文单字（1=一 … 7=日）。越界返回 ?（不崩、也不猜）。 */
export function weekdayCn(weekday: number): string {
  return WEEKDAY_CN[weekday - 1] ?? "?";
}

/** 「10/10（周六）」这类给人看的日期标签。课表列头角标、提示条、补课提醒正文共用同一格式。 */
export function dateLabelCn(dateEpochDay: number): string {
  const iso = isoOfDay(dateEpochDay);
  const month = Number(iso.slice(5, 7));
  const day = Number(iso.slice(8, 10));
  const dow = dayOfWeekMon1(dateEpochDay);
  return `${month}/${day}（周${weekdayCn(dow)}）`;
}

function isoOfDay(epochDay: number): string {
  const dt = new Date(epochDay * 86400000);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

function dayOfWeekMon1(epochDay: number): number {
  return ((((epochDay + 3) % 7) + 7) % 7) + 1;
}

// ── DdlSource ───────────────────────────────────────────────────────────

/** 乐学（Moodle）—— 学校已停用，但已同步的历史数据保留。 */
export const DDL_SOURCE_LEXUE = "lexue";
/** 用户手动添加的日程。 */
export const DDL_SOURCE_CUSTOM = "main";
/** 延河课堂（eclass）—— 学校 2026 年起的作业来源。 */
export const DDL_SOURCE_ECLASS = "eclass";

/** 展示用的中文名。未知来源原样显示（将来新增源时不会变空白，也便于排查）。 */
export function ddlDisplayName(group: string): string {
  switch (group) {
    case DDL_SOURCE_LEXUE:
      return "乐学";
    case DDL_SOURCE_ECLASS:
      return "延河课堂";
    case DDL_SOURCE_CUSTOM:
    case "":
      return "自定义";
    default:
      return group;
  }
}

/**
 * 是否允许编辑/删除。⚠️ 只有用户手动的条目可改：来自乐学或延河课堂的条目由同步生成，
 * 改了下次同步就被覆盖回去 —— 让用户改一个必然被冲掉的字段是误导。
 */
export function ddlIsEditable(group: string): boolean {
  return group !== DDL_SOURCE_LEXUE && group !== DDL_SOURCE_ECLASS;
}

// ⚠️ 未移植部分（取数层，不属纯逻辑）：TeachingAdjustmentRepo 的页面抓取与
// 「教学安排调整」正文解析（日历表格优先、四种句式兜底、只产出明确写出的）。
// 移植时对着 Android TeachingAdjustment.kt:92-165 + TeachingAdjustmentLogicTest 写。
