/**
 * 桌面卡片数据装配（M8）：本地源 → WidgetPage[] → 可 JSON 序列化 payload。
 *
 * 卡片是独立进程，只能经 formBindingData 收 JSON（读不了 Prefs），
 * 所以「映射对不对 + 结果能不能序列化」全在这一层证伪：
 * 1. 课程周次 01 串 → [n] 串（错则卡片里一周的课全错位）；
 * 2. 非渲染行（星期越界/节次倒挂）不进卡片；
 * 3. 整条 payload 必须可 JSON.stringify（不能出现 undefined/null 键洞）；
 * 4. 无课表时课程页走「登录引导 / 空态」兜底，不崩。
 */
import {
  coursesToSchedule,
  ddlsToSchedule,
  emptySeatSnapshot,
  assembleWidgetPages,
  isSerializablePayload
} from "../entry/src/main/ets/corelogic/WidgetData.ts";
import { FALLBACK_TIME_TABLE } from "../entry/src/main/ets/corelogic/TimeTableLogic.ts";
import { parseISODate } from "../entry/src/main/ets/corelogic/timeutil.ts";

let passed = 0;
let failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}\n  actual   = ${a}\n  expected = ${b}`);
}
function ok(cond, name) {
  if (cond) passed++; else { failed++; console.error("FAIL: " + name); }
}

function courseRow(over) {
  over = over || {};
  return {
    XNXQDM: over.XNXQDM ?? "2026-2027-1",
    KCM: over.KCM ?? "高等数学",
    SKJS: over.SKJS ?? "张三",
    JASMC: over.JASMC ?? "文萃楼I404",
    YPSJDD: "",
    SKZC: over.SKZC ?? "1111100000",
    SKXQ: over.SKXQ ?? 1,
    KSJC: over.KSJC ?? 1,
    JSJC: over.JSJC ?? 2,
    XXXQMC: over.XXXQMC ?? "良乡",
    KCH: over.KCH ?? "101",
    XF: 4, XS: 48,
    KCXZDM_DISPLAY: "", KCLBDM_DISPLAY: "", KKDWDM_DISPLAY: ""
  };
}

// ── 课程映射：周次 01→[n]，非渲染行剔除 ──
{
  const s = coursesToSchedule([courseRow()]);
  eq(s.length, 1, "一行进 1 条");
  eq(s[0].weeks, "[1][2][3][4][5]", "SKZC 01 串转 [n]");
  eq(s[0].weekday, 1, "星期直搬");
  eq(s[0].start_section, 1, "开始节次");
  eq(s[0].end_section, 2, "结束节次");
  eq(s[0].classroom, "文萃楼I404", "教室");
  eq(s[0].teacher, "张三", "教师");
}
{
  const s = coursesToSchedule([
    courseRow({ SKXQ: 0 }), courseRow({ SKXQ: 8 }),
    courseRow({ KSJC: 0 }), courseRow({ KCM: "好课" })
  ]);
  eq(s.length, 1, "越界/倒挂全剔，只留好行");
  eq(s[0].name, "好课", "保留的是好行");
}

// ── DDL 映射：字段同名直搬 ──
{
  const e = { uid: "eclass:1", group: "eclass", title: "第2章作业", text: "高等数学", day: 20500, minutes: 480, done: false };
  const s = ddlsToSchedule([e]);
  eq(s[0], { group: "eclass", uid: "eclass:1", title: "第2章作业", text: "高等数学", time: { day: 20500, minutes: 480 }, done: false }, "DDL 直搬");
}

// ── 空座位快照（M9 未做）──
{
  const snap = emptySeatSnapshot();
  eq(snap.lines, [], "空行");
  eq(snap.quickReserveTaskId, null, "无快捷预约");
}

// ── 装配：有课表 ⇒ 5 页 + 可序列化 ──
{
  const now = { day: parseISODate("2026-12-01"), minutes: 480 };
  const pages = assembleWidgetPages({
    courses: coursesToSchedule([courseRow()]),
    ddls: ddlsToSchedule([{ uid: "e", group: "eclass", title: "作业", text: "t", day: now.day, minutes: 1200, done: false }]),
    activities: [],
    adjustments: [],
    firstDay: "2026-09-01",
    timeTable: FALLBACK_TIME_TABLE,
    now: now
  });
  eq(pages.length, 5, "5 页（课程/DDL/动态/座位/自习）");
  ok(isSerializablePayload(pages), "整条 payload 可 JSON 序列化（卡片独立进程前提）");
  // 课程页标题存在
  eq(pages[0].title.length > 0, true, "课程页有标题");
}

// ── 装配：无课表（firstDay 空）⇒ 不崩，走兜底 ──
{
  const now = { day: parseISODate("2026-12-01"), minutes: 480 };
  const pages = assembleWidgetPages({
    courses: [],
    ddls: [],
    activities: [],
    adjustments: [],
    firstDay: "",
    timeTable: FALLBACK_TIME_TABLE,
    now: now
  });
  eq(pages.length, 5, "无数据仍 5 页（各页走空态/登录引导，不崩）");
  ok(isSerializablePayload(pages), "空数据 payload 也可序列化");
}

// ── 序列化红线：payload 里绝不出现 undefined（否则 formBindingData 拿到脏 JSON）──
{
  const now = { day: parseISODate("2026-12-01"), minutes: 480 };
  const pages = assembleWidgetPages({
    courses: coursesToSchedule([courseRow()]),
    ddls: [], activities: [], adjustments: [],
    firstDay: "2026-09-01", timeTable: FALLBACK_TIME_TABLE, now: now
  });
  const s = JSON.stringify(pages);
  ok(s.indexOf("undefined") < 0, "序列化结果不含 undefined");
  ok(s.indexOf('"null"') < 0 || s.indexOf(":null") >= 0, "null 值走合法 JSON 而非字符串 'null'");
}

console.log("\n" + (failed === 0 ? "ALL PASS" : "FAILED") + "  pass=" + passed + " fail=" + failed);
process.exit(failed > 0 ? 1 : 0);
