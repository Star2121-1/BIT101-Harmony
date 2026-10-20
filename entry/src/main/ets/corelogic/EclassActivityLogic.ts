/**
 * 1:1 移植自 Android：data/src/main/java/cn/bit101/android/data/eclass/EclassActivityLogic.kt（284 行）
 *
 * 移植日期：2026-10-19（夜间任务 2）
 *
 * 规则：
 * - 分类**保守**：认不出的 type 归 OTHER 原样展示，不编造类型标签
 * - 作业判定复用 EclassDdlLogic.isHomework（按字段存在性，不枚举 type）
 * - openUrlOf：只接受 http(s):// 完整地址，否则退回延河课堂首页（相对路径交给 WebView 只会白屏）
 * - recent：时间缺失的排在最后（不丢）；动态按时间**倒序**（与 DDL 方向相反）
 * - applySettings：showExpired 关时只丢**过期作业**（资料/公告的 time 是发布时刻，一起判会误杀）
 * - visible：**先过滤后截断**（反了会让「只看作业」可见条数远小于上限）
 * - fetchLimit：只看作业时 ×4 冗余取（MAX 240），多取成本为零
 */

import { isHomework, parseTime, type Activity } from "./EclassDdlLogic.ts";
import { LOGIN_URL } from "./EclassDdlLogic.ts";
import { fmtHM, type DateTime } from "./timeutil.ts";

export const ActivityKind = {
  HOMEWORK: "HOMEWORK",
  MATERIAL: "MATERIAL",
  ANNOUNCEMENT: "ANNOUNCEMENT",
  OTHER: "OTHER",
} as const;
export type ActivityKind = (typeof ActivityKind)[keyof typeof ActivityKind];

export function activityKindLabel(kind: ActivityKind): string {
  switch (kind) {
    case ActivityKind.HOMEWORK:
      return "作业";
    case ActivityKind.MATERIAL:
      return "资料";
    case ActivityKind.ANNOUNCEMENT:
      return "公告";
    default:
      return "动态";
  }
}

/** 一条动态（UI 直接可用）。 */
export interface EclassActivity {
  /** 活动 id（与 DDL 的 uid 同源：eclass:{id}） */
  id: string;
  courseId: number;
  courseName: string;
  title: string;
  kind: ActivityKind;
  /** 作业=截止时间；资料/其它=开始（发布）时刻 */
  time: DateTime | null;
  /** 点击跳转目标（已保证可用，见 openUrlOf） */
  targetUrl: string;
}

const TYPE_MATERIAL = "material";
const ANNOUNCEMENT_HINTS = ["announce", "bulletin", "notice", "notification"];

/** 判断动态类型（作业判定复用 EclassDdlLogic.isHomework）。 */
export function kindOf(activity: Activity): ActivityKind {
  if (isHomework(activity)) return ActivityKind.HOMEWORK;
  if ((activity.type ?? "").toLowerCase() === TYPE_MATERIAL) return ActivityKind.MATERIAL;
  const type = activity.type ?? "";
  for (const hint of ANNOUNCEMENT_HINTS) {
    if (type.toLowerCase().includes(hint)) return ActivityKind.ANNOUNCEMENT;
  }
  return ActivityKind.OTHER;
}

/** 把接口返回的 activities 映射成动态列表。标题为空的活动直接丢弃。 */
export function toActivities(
  activities: Activity[],
  courseId: number,
  courseName: string,
  courseUrl: string | null = null,
): EclassActivity[] {
  const targetUrl = openUrlOf(courseUrl);
  const out: EclassActivity[] = [];
  for (const activity of activities) {
    const title = activity.title.trim();
    if (title.length === 0) continue;
    const kind = kindOf(activity);
    // 作业看截止时间；其余看开始时间。两个都没有 → null（界面显示占位）
    const time =
      kind === ActivityKind.HOMEWORK
        ? parseTime(activity.endTime) ?? parseTime(activity.visibleEndAt) ?? parseTime(activity.startTime)
        : parseTime(activity.startTime) ?? parseTime(activity.endTime);
    out.push({
      id: String(activity.id),
      courseId,
      courseName,
      title,
      kind,
      time,
      targetUrl,
    });
  }
  return out;
}

/** 点击跳转目标：课程页地址优先，拿不到时退回延河课堂首页。只接受完整地址。 */
export function openUrlOf(courseUrl: string | null): string {
  const url = (courseUrl ?? "").trim();
  return url.startsWith("http://") || url.startsWith("https://") ? url : LOGIN_URL;
}

const OVER_FETCH_FACTOR = 4;
export const MAX_FETCH_LIMIT = 240;

/** 取数时要向 repo 请求的条数上限（只看作业时放大冗余，成本为零）。 */
export function fetchLimit(limit: number, onlyHomework: boolean): number {
  const userLimit = Math.max(0, limit);
  if (!onlyHomework) return userLimit;
  return Math.min(userLimit * OVER_FETCH_FACTOR, MAX_FETCH_LIMIT);
}

/** 排序 + 截断：最新的在前。时间缺失的排在最后（通常是服务端没给时间），而不是丢掉。 */
export function recent(activities: EclassActivity[], limit: number): EclassActivity[] {
  const sorted = [...activities].sort((a, b) => {
    const an = a.time === null ? 0 : 1;
    const bn = b.time === null ? 0 : 1;
    if (an !== bn) return bn - an;
    if (a.time === null || b.time === null) return 0;
    return b.time.day - a.time.day || b.time.minutes - a.time.minutes;
  });
  return sorted.slice(0, Math.max(0, limit));
}

/** 按「动态设置」三项过滤（纯函数）。now 由调用方传入。 */
export function applySettings(
  activities: EclassActivity[],
  onlyHomework: boolean,
  showExpired: boolean,
  now: DateTime,
): EclassActivity[] {
  return activities.filter((activity) => {
    if (onlyHomework && activity.kind !== ActivityKind.HOMEWORK) return false;
    return !isExpiredHomework(activity, showExpired, now);
  });
}

function isExpiredHomework(activity: EclassActivity, showExpired: boolean, now: DateTime): boolean {
  if (showExpired) return false;
  if (activity.kind !== ActivityKind.HOMEWORK) return false;
  const deadline = activity.time;
  if (deadline === null) return false;
  return deadline.day < now.day || (deadline.day === now.day && deadline.minutes < now.minutes);
}

/** 过滤**并按上限截断** —— 界面最终显示的就是它。⚠️ 先过滤、后截断，顺序不能反。 */
export function visible(
  activities: EclassActivity[],
  onlyHomework: boolean,
  showExpired: boolean,
  limit: number,
  now: DateTime,
): EclassActivity[] {
  return applySettings(activities, onlyHomework, showExpired, now).slice(0, Math.max(0, limit));
}

/** 相对时间文案：今天 / 昨天 / 3 天前 / 8月25日 / 去年12月3日。 */
export function agoText(time: DateTime | null, now: DateTime): string {
  if (time === null) return "";
  const days = time.day - now.day;
  if (days === 0) return `今天 ${fmtHM(time.minutes)}`;
  if (days === -1) return `昨天 ${fmtHM(time.minutes)}`;
  if (days >= -6 && days <= -2) return `${-days} 天前`;
  const iso = isoOf(time.day);
  const month = Number(iso.slice(5, 7));
  const day = Number(iso.slice(8, 10));
  const nowIso = isoOf(now.day);
  const year = Number(nowIso.slice(0, 4));
  const tYear = Number(iso.slice(0, 4));
  return tYear === year ? `${month}月${day}日` : `${tYear}年${month}月${day}日`;
}

/** 列表行右侧的短文案（组件用）。 */
export function shortAgoText(time: DateTime | null, now: DateTime): string {
  if (time === null) return "";
  const days = time.day - now.day;
  if (days === 0) return fmtHM(time.minutes);
  if (days === -1) return "昨天";
  if (days >= -6 && days <= -2) return `${-days} 天前`;
  const iso = isoOf(time.day);
  return `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;
}

function isoOf(epochDay: number): string {
  const dt = new Date(epochDay * 86400000);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}
