/**
 * 延河课堂（eclass）数据模型 + 解析。
 *
 * 字段名**逐字照搬** Android `api/.../model/http/eclass/Eclass.kt`，
 * 依据是 2026-09-22/23 实测契约（`BIT101-seat/docs/ddl-source-contract.md`）：
 *  - 课程列表唯一可用源：`GET /api/user/recently-visited-courses` → `visited_courses[]`
 *    （`/api/courses` 403、`/api/user/courses` 与 `/api/course-list` 404，逐个试过）
 *  - 课程动态：`GET /api/courses/{id}/activities` → `activities[]`
 *
 * ⚠️ 解析纪律（铁律 0.1）：缺失字段给显式默认值，不猜。
 *    接口会把没有的值返回成字符串 "null"（契约原话），按空处理。
 */

import { str, num, arrOf, objOf } from './SchoolModels.ts';
import type { JsonValue } from './SchoolModels.ts';

/** 最近访问的课程（visited_courses[] 一项）。 */
export interface EclassCourse {
  id: number;
  name: string;
  /** 教务课号。 */
  courseCode: string;
  /** 开课学院名（department.name，可能为空）。 */
  department: string;
  /** 课程页地址（契约：url 值未实测，只接受 http(s) 开头，否则回退首页）。 */
  url: string;
}

/** 课程动态原始行（与 corelogic/EclassDdlLogic.ts 的 Activity 对齐）。 */
export interface RawActivity {
  id: number;
  title: string;
  type: string | null;
  courseId: number;
  startTime: string | null;
  endTime: string | null;
  visibleEndAt: string | null;
  isClosed: boolean;
  submitTimes: number | null;
  lateSubmissionCount: number | null;
  isReviewHomework: boolean | null;
}

/** 接口把没有的值返回成字符串 "null"（契约实测）——统一当空。 */
function cleanNull(raw: string): string | null {
  if (raw.length === 0 || raw === 'null') {
    return null;
  }
  return raw;
}

/** 取布尔字段；缺失/非布尔（含字符串 "true"/"false"）→ null。 */
function boolOrNull(obj: Record<string, JsonValue> | null, key: string): boolean | null {
  if (obj === null) {
    return null;
  }
  const v: JsonValue | undefined = obj[key];
  if (typeof v === 'boolean') {
    return v as boolean;
  }
  if (v === 'true') {
    return true;
  }
  if (v === 'false') {
    return false;
  }
  return null;
}

/** 取数字字段；缺失/负数 → null（0 是合法值：「提交 0 次」也是作业判据）。 */
function numOrNull(obj: Record<string, JsonValue> | null, key: string): number | null {
  if (obj === null) {
    return null;
  }
  const v: JsonValue | undefined = obj[key];
  if (v === undefined || v === null) {
    return null;
  }
  if (typeof v === 'number') {
    const n: number = v as number;
    return n >= 0 ? n : null;
  }
  if (typeof v === 'string') {
    const n: number = parseInt(v as string, 10);
    return isNaN(n) || n < 0 ? null : n;
  }
  return null;
}

/**
 * 解析 `visited_courses[]` 一项。
 * 判据可证伪：id/name 缺失的项会被跳过（调用方记 skip 数），
 * 不拿"半条数据"冒充课程。
 */
export function parseCourse(raw: JsonValue): EclassCourse | null {
  const o: Record<string, JsonValue> | null = objOf({ v: raw } as Record<string, JsonValue>, 'v');
  if (o === null) {
    return null;
  }
  const id: number = num(o, 'id', 0);
  const name: string = str(o, 'name', '');
  if (id <= 0 || name.length === 0) {
    return null;
  }
  const dept: Record<string, JsonValue> | null = objOf(o, 'department');
  const rawUrl: string = str(o, 'url', '');
  // 契约：只接受 http(s) 开头的完整地址，否则给空串（调用方回退首页）
  const url: string = (rawUrl.startsWith('http://') || rawUrl.startsWith('https://')) ? rawUrl : '';
  return {
    id: id,
    name: name,
    courseCode: str(o, 'course_code', ''),
    department: dept !== null ? str(dept, 'name', '') : '',
    url: url
  };
}

/** 解析课程列表响应体。返回 { courses, skipped }——skipped 是解析失败的条数。 */
export function parseCourses(body: string): { courses: EclassCourse[]; skipped: number } {
  const courses: EclassCourse[] = [];
  let skipped: number = 0;
  try {
    const root: Record<string, JsonValue> = JSON.parse(body) as Record<string, JsonValue>;
    const list: JsonValue[] = arrOf(root, 'visited_courses');
    for (let i = 0; i < list.length; i++) {
      const c: EclassCourse | null = parseCourse(list[i]);
      if (c === null) {
        skipped++;
      } else {
        courses.push(c);
      }
    }
  } catch (e) {
    // 解析失败整体当空（调用方按「取数失败」处理，不当「没有课」）
    return { courses: [], skipped: 0 };
  }
  return { courses: courses, skipped: skipped };
}

/** 解析 `activities[]` 一项（与 EclassDdlLogic.Activity 字段一一对应）。 */
export function parseActivity(raw: JsonValue): RawActivity | null {
  const o: Record<string, JsonValue> | null = objOf({ v: raw } as Record<string, JsonValue>, 'v');
  if (o === null) {
    return null;
  }
  const id: number = num(o, 'id', 0);
  if (id <= 0) {
    return null;
  }
  const typeRaw: string = str(o, 'type', '');
  return {
    id: id,
    title: str(o, 'title', '未命名动态'),
    type: cleanNull(typeRaw),
    courseId: num(o, 'course_id', 0),
    startTime: cleanNull(str(o, 'start_time', '')),
    endTime: cleanNull(str(o, 'end_time', '')),
    visibleEndAt: cleanNull(str(o, 'visible_end_at', '')),
    isClosed: boolOrNull(o, 'is_closed') ?? false,
    submitTimes: numOrNull(o, 'submit_times'),
    lateSubmissionCount: numOrNull(o, 'late_submission_count'),
    isReviewHomework: boolOrNull(o, 'is_review_homework')
  };
}

/** 解析课程动态响应体。 */
export function parseActivities(body: string): { activities: RawActivity[]; skipped: number } {
  const activities: RawActivity[] = [];
  let skipped: number = 0;
  try {
    const root: Record<string, JsonValue> = JSON.parse(body) as Record<string, JsonValue>;
    const list: JsonValue[] = arrOf(root, 'activities');
    for (let i = 0; i < list.length; i++) {
      const a: RawActivity | null = parseActivity(list[i]);
      if (a === null) {
        skipped++;
      } else {
        activities.push(a);
      }
    }
  } catch (e) {
    return { activities: [], skipped: 0 };
  }
  return { activities: activities, skipped: skipped };
}
