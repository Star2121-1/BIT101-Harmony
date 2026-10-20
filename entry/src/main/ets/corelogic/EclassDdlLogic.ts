/**
 * 1:1 移植自 Android：data/src/main/java/cn/bit101/android/data/eclass/EclassDdlLogic.kt（173 行）
 *
 * 移植日期：2026-10-19（夜间任务 2）
 *
 * 必须一起搬的规则：
 * - 作业判定**不枚举 type**（2026-09-23 实测开学第 4 周只有资料，拿不到作业的 type 真值；
 *  猜错就是「一个作业都收不到」且难排查）⇒ 判据 = 作业特有字段存在性：
 *  submitTimes / isReviewHomework / lateSubmissionCount 任一非 null
 * - 已知资料 type = "material"，直接排除（哪怕带提交字段）
 * - 截止时间 deadlineOf = endTime ?? visibleEndAt（**必须用 deadlineOf 而不是只看 endTime**；
 *  Android 侧曾两处口径不一致被单测逮到）
 * - "null" 字符串化空值要当空（接口把没有返回成字符串 "null"）
 * - 时间按北京时间原样解析，不做时区换算；多格式依次尝试
 * - uid = "eclass:{id}"（防与乐学源撞键）；标题空 → "未命名作业"
 * - 排序放在逻辑层（组件与 App 共用，口径必须一致）
 */

import { parseDateTime, type DateTime } from "./timeutil.ts";

export const GROUP = "eclass";
export const BASE_URL = "https://zy-eclass.bit.edu.cn";
export const LOGIN_URL = `${BASE_URL}/user/index`;

const TYPE_MATERIAL = "material";

/** 课程动态（对齐 GetEclassActivitiesDataModel.Activity 用到的字段）。 */
export interface Activity {
  id: number;
  title: string;
  type: string | null;
  courseId: number;
  /** 开始时间（字符串；Android Activity.startTime）。资料/公告用，作业一般无。 */
  startTime: string | null;
  /** 截止时间 —— DDL 直接来源。 */
  endTime: string | null;
  /** 对学生可见的截止时刻（通常与 endTime 相同或更晚）。 */
  visibleEndAt: string | null;
  isClosed: boolean;
  // ── 以下「只出现在作业上」，是判定作业的依据 ──
  submitTimes: number | null;
  lateSubmissionCount: number | null;
  isReviewHomework: boolean | null;
}

/** 待写入 ddl_schedule 的一条作业（对齐 EclassDdlItem）。 */
export interface EclassDdlItem {
  uid: string;
  title: string;
  text: string;
  time: DateTime;
}

/**
 * 这条课程动态是不是「要交的作业」。
 * 规则（保守，宁可漏也不要误报）：
 * 1. 已知资料类型 → 否
 * 2. 没有可解析的截止时间 → 否
 * 3. 出现作业特有字段 → 是
 */
export function isHomework(activity: Activity): boolean {
  if ((activity.type ?? "").toLowerCase() === TYPE_MATERIAL) return false;
  if (deadlineOf(activity) === null) return false;
  return (
    activity.submitTimes !== null ||
    activity.isReviewHomework !== null ||
    activity.lateSubmissionCount !== null
  );
}

/** 解析接口返回的时间字符串（多格式依次尝试；"null" 串当空）。 */
export function parseTime(raw: string | null | undefined): DateTime | null {
  return parseDateTime(raw);
}

/** 活动截止时间（可解析时）：endTime 优先，缺失回落 visibleEndAt。 */
export function deadlineOf(activity: Activity): DateTime | null {
  return parseTime(activity.endTime) ?? parseTime(activity.visibleEndAt);
}

/** 稳定的去重键。 */
export function uid(activityId: number): string {
  return `${GROUP}:${activityId}`;
}

/**
 * 一条作业 → DDL 条目；不是作业返回 null。
 * @param includeOverdue 是否保留已过期的作业（同步时决定是否清理旧数据）
 */
export function toDdlItem(
  activity: Activity,
  courseName: string,
  now: DateTime,
  includeOverdue: boolean = true,
): EclassDdlItem | null {
  if (!isHomework(activity)) return null;
  const deadline = deadlineOf(activity);
  if (deadline === null) return null;
  if (!includeOverdue && isBefore(deadline, now)) return null;
  return {
    uid: uid(activity.id),
    title: activity.title.trim().length > 0 ? activity.title.trim() : "未命名作业",
    text: courseName,
    time: deadline,
  };
}

/** 批量转换 + 按截止时间升序（同一门课可能有多条作业）。 */
export function toDdlItems(
  activities: Activity[],
  courseName: string,
  now: DateTime,
  includeOverdue: boolean = true,
): EclassDdlItem[] {
  const out: EclassDdlItem[] = [];
  for (const a of activities) {
    const item = toDdlItem(a, courseName, now, includeOverdue);
    if (item !== null) out.push(item);
  }
  return out.sort((x, y) => x.time.day - y.time.day || x.time.minutes - y.time.minutes);
}

/** a 是否早于 b（对齐 LocalDateTime.isBefore）。 */
function isBefore(a: DateTime, b: DateTime): boolean {
  return a.day < b.day || (a.day === b.day && a.minutes < b.minutes);
}
