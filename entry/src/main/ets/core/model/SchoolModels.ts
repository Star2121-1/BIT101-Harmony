/**
 * 教务（jxzxehall）数据模型 + 解析。字段名**逐字照搬** Android
 * `api/.../model/common/CourseForSchedule.kt`（Gson @SerializedName 的那套名字），
 * 因为服务端返回的就是这些大写字段。
 *
 * ⚠️ 解析纪律（铁律 0.1）：判据要能证伪 —— 缺失字段一律给**显式默认值**并在
 * 解析结果里保留「哪些字段是空的」的事实，不许用「有没有值」冒充「对不对」。
 */

/** 课表行（教务 cxxszhxqkb.do 返回的一行）。 */
export interface CourseRow {
  XNXQDM: string;      // 学年学期
  KCM: string;         // 课程名
  SKJS: string;        // 授课教师（逗号分隔）
  JASMC: string;       // 教室
  YPSJDD: string;      // 上课时空描述
  SKZC: string;        // 上课周次（01 串，'1' = 上课）
  SKXQ: number;        // 星期几 1~7
  KSJC: number;        // 开始节次（1-based）
  JSJC: number;        // 结束节次（1-based）
  XXXQMC: string;      // 校区
  KCH: string;         // 课程号
  XF: number;          // 学分
  XS: number;          // 学时
  KCXZDM_DISPLAY: string; // 课程性质
  KCLBDM_DISPLAY: string; // 课程类别
  KKDWDM_DISPLAY: string; // 开课单位
}

/**
 * 考试安排（对照 Android `ExamInfo` + BIT-Login `Exam.getExamList`）。
 *
 * ⚠️ `KSRQ` 带「当天零点的时间」后缀（如 `2026-11-05 00:00:00`），排序要用它而非 `KSSJMS`
 * （后者是给人看的中文串）。
 */
export interface ExamRow {
  KCM: string;       // 考试科目
  KSSJMS: string;    // 考试时间描述（含日期、星期）
  KSRQ: string;      // 考试日期（可带零点时间）
  JASMC: string;     // 考试地点
  ZWH: string;       // 座位号（可能为空）
  KSMC: string;      // 集中考试 / 分散考试
  KCH: string;       // 课程号
  ZJJSXM: string;    // 授课教师
}

/**
 * 一间教室某天的占用情况（对照 BIT-Login `Classroom.getOccupancy`）。
 *
 * ⚠️ `JC[]` 是**逐节**的状态串解析结果，不是「哪几节有空」——
 * 判空闲必须看 `busySections`（已按 1-based 排好序）。
 */
export interface ClassroomRow {
  JASMC: string;             // 教室名（如「综教A-101」）
  JXLDM: string;             // 所属教学楼代码
  JASLXDM_DISPLAY: string;   // 教室类型（普通教室 / 机房 …）
  SKZWS: string;             // 座位数（原始串，可能为空）
  JC: string[];              // 13 节状态（0-based 索引 = 节次-1）
  busySections: number[];    // 被占用的节次（1-based，升序）
}

/** 校区。 */
export interface CampusInfo {
  displayName: string;
  code: string;
}

/** 教学楼。 */
export interface BuildingInfo {
  buildingName: string;
  buildingIndex: string;
  campusName: string;
  campusCode: string;
}

/** 考试安排。 */
export interface ExamInfo {
  location: string;
  time: string;
  date: string;
  seatId: string;
  ksmc: string;
  termCode: string;
  courseCode: string;
  teacherName: string;
  kch: string;
}

/** 当前学期的完整课表数据（一次取齐：学期 + 开学日 + 课程行）。 */
export interface TermSchedule {
  term: string;
  firstDay: string;    // yyyy-MM-dd（可能为空：校历接口没返回）
  courses: CourseRow[];
}

/** JSON 值的安全读取（ArkTS 里 any 受限，统一走 Record 逐层下钻）。 */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** 取字符串字段，缺失/非字符串返回 fallback。 */
export function str(obj: Record<string, JsonValue> | null, key: string, fallback: string): string {
  if (obj === null) {
    return fallback;
  }
  const v: JsonValue | undefined = obj[key];
  if (v === undefined || v === null) {
    return fallback;
  }
  if (typeof v === 'string') {
    return v as string;
  }
  if (typeof v === 'number') {
    return String(v as number);
  }
  return fallback;
}

/** 取数字字段，缺失/非数字返回 fallback。 */
export function num(obj: Record<string, JsonValue> | null, key: string, fallback: number): number {
  if (obj === null) {
    return fallback;
  }
  const v: JsonValue | undefined = obj[key];
  if (v === undefined || v === null) {
    return fallback;
  }
  if (typeof v === 'number') {
    return v as number;
  }
  if (typeof v === 'string') {
    const n: number = parseInt(v as string, 10);
    return isNaN(n) ? fallback : n;
  }
  return fallback;
}

/** 取对象字段，不是对象返回 null。 */
export function objOf(obj: Record<string, JsonValue> | null, key: string): Record<string, JsonValue> | null {
  if (obj === null) {
    return null;
  }
  const v: JsonValue | undefined = obj[key];
  if (v === undefined || v === null || typeof v !== 'object' || Array.isArray(v)) {
    return null;
  }
  return v as Record<string, JsonValue>;
}

/** 取数组字段，不是数组返回空数组。 */
export function arrOf(obj: Record<string, JsonValue> | null, key: string): JsonValue[] {
  if (obj === null) {
    return [];
  }
  const v: JsonValue | undefined = obj[key];
  if (v === undefined || v === null || !Array.isArray(v)) {
    return [];
  }
  return v as JsonValue[];
}

/** 把一行教务 JSON 转成 CourseRow（缺字段给显式默认，绝不猜）。 */
export function parseCourseRow(raw: JsonValue): CourseRow {
  const o: Record<string, JsonValue> | null =
    (typeof raw === 'object' && raw !== null && !Array.isArray(raw))
      ? raw as Record<string, JsonValue> : null;
  return {
    XNXQDM: str(o, 'XNXQDM', ''),
    KCM: str(o, 'KCM', ''),
    SKJS: str(o, 'SKJS', ''),
    JASMC: str(o, 'JASMC', ''),
    YPSJDD: str(o, 'YPSJDD', ''),
    SKZC: str(o, 'SKZC', ''),
    SKXQ: num(o, 'SKXQ', 0),
    KSJC: num(o, 'KSJC', 0),
    JSJC: num(o, 'JSJC', 0),
    XXXQMC: str(o, 'XXXQMC', ''),
    KCH: str(o, 'KCH', ''),
    XF: num(o, 'XF', 0),
    XS: num(o, 'XS', 0),
    KCXZDM_DISPLAY: str(o, 'KCXZDM_DISPLAY', ''),
    KCLBDM_DISPLAY: str(o, 'KCLBDM_DISPLAY', ''),
    KKDWDM_DISPLAY: str(o, 'KKDWDM_DISPLAY', '')
  };
}

/**
 * 课表行是否「可上屏」的最小判据：课程名 + 星期 + 节次。
 * 缺任一 ⇒ 这一行不上屏（但**计入**丢弃数，由调用方报给用户，不许静默吞）。
 */
export function isRenderableCourse(c: CourseRow): boolean {
  return c.KCM.length > 0 && c.SKXQ >= 1 && c.SKXQ <= 7 && c.KSJC >= 1 && c.JSJC >= c.KSJC;
}

/**
 * SKZC（"1"/"0" 周次串）→ weeks 标记串 "[1][2][11]"。
 * 1:1 照搬 Android `CourseScheduleEntity.kt:99-105`（toEntity 里的 forEachIndexed）。
 *
 * ⚠️ 为什么要转：全仓的周次判据（CourseWeekdayLogic.weeksContains / WidgetLogic / NotifyLogic）
 * 一律按**完整标记**匹配 —— `[1]` 不能匹配 `[11]`。直接用 01 串做 includes 会假命中。
 */
export function skzcToWeeks(skzc: string): string {
  let weeks: string = '';
  for (let i = 0; i < skzc.length; i++) {
    if (skzc.charAt(i) === '1') {
      weeks += '[' + (i + 1) + ']';
    }
  }
  return weeks;
}

/** SKZC 串长度 = 学期总周数（用于周次选择器上界）；空串返回 0。 */
export function maxWeekOf(skzc: string): number {
  return skzc.length;
}
