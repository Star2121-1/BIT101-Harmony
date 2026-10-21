/**
 * 提醒排期（M7-2）的数据适配 + 配额/日期映射。
 *
 * 重点钉住两个最易错处：
 * 1. **课程周次**：`SKZC`（01 串）必须走 `skzcToWeeks` 成 `[n]` 串再喂
 *    `NotifyCourse.weeks` —— 直接喂 01 串，`weeksContains`（按 `[n]` 匹配）一条都排不出。
 * 2. **考试时刻 fail-closed**：`KSSJMS` 解析不出合法「HH:MM-HH:MM 区间」就整场跳过，
 *    绝不猜时刻（错提醒比不发更糟）。
 *
 * ⚠️ 本文件是 .mjs（纯 JS，Node 直跑）—— 不许写 TS 类型注解（const x: T / () => T）。
 */
import {
  coursesToNotify,
  ddlsToNotify,
  examsToNotify,
  examTimeOfMinutes,
  examDateOf
} from "../entry/src/main/ets/corelogic/NotifyAdapter.ts";
import {
  specOf,
  selectForAgent,
  specsForPublish,
  AGENT_REMINDER_LIMIT
} from "../entry/src/main/ets/corelogic/NotifyScheduleLogic.ts";
import { ReminderKind } from "../entry/src/main/ets/corelogic/NotifyLogic.ts";
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

// ── 课程：周次串 01 → [n]（最易错）──
function course(over) {
  over = over || {};
  return {
    XNXQDM: "2026-2027-1",
    KCM: over.KCM ?? "高等数学",
    SKJS: "张三",
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

{
  const n = coursesToNotify([course()]);
  eq(n[0].weeks, "[1][2][3][4][5]", "SKZC 01 串转 [n] 串");
  eq(n[0].weekday, 1, "星期直搬");
  eq(n[0].start_section, 1, "开始节次");
  eq(n[0].end_section, 2, "结束节次");
  eq(n[0].number, "101", "课程号");
}
{
  const bad = coursesToNotify([course({ SKXQ: 0 }), course({ SKXQ: 8 }), course({ KSJC: 0 })]);
  eq(bad.length, 0, "非渲染行全跳过");
}
{
  const mixed = coursesToNotify([course({ KCM: "A" }), course({ SKXQ: 9, KCM: "B" })]);
  eq(mixed.length, 1, "好行保留、坏行剔除");
  eq(mixed[0].name, "A", "保留的是好行");
}

// ── DDL：字段同名直搬 ──
{
  const e = { uid: "eclass:1", group: "eclass", title: "第2章作业", text: "高等数学", day: 20500, minutes: 480, done: false };
  const n = ddlsToNotify([e]);
  eq(n[0], { uid: "eclass:1", title: "第2章作业", text: "高等数学", time: { day: 20500, minutes: 480 }, done: false }, "DDL 直搬");
}

// ── 考试时刻：fail-closed ──
{
  const t = examTimeOfMinutes("星期五 08:00-10:00（2小时）");
  eq(t, { begin: 480, end: 600 }, "正常区间 → 480/600");
  eq(examTimeOfMinutes("08:00-10:00"), { begin: 480, end: 600 }, "无星期前缀也能取");
  eq(examTimeOfMinutes("星期五 无时间"), null, "无区间 → null（fail-closed）");
  eq(examTimeOfMinutes(""), null, "空串 → null");
  eq(examTimeOfMinutes("25:00-26:00"), null, "越界（>24h）→ null");
  eq(examTimeOfMinutes("10:00-08:00"), null, "倒挂（end<=begin）→ null");
}

// ── 考试日期：KSRQ 优先 ──
{
  const day = parseISODate("2026-11-05");
  eq(examDateOf("星期五 08:00-10:00", "2026-11-05 00:00:00"), day, "KSRQ 带零点时间，取日期段");
  eq(examDateOf("2026-11-05 星期五", ""), day, "KSRQ 缺失退 KSSJMS 里的日期");
  eq(examDateOf("无日期", ""), null, "两处都没有 → null");
}

// ── 考试整行：时刻或日期解析不出就跳过整场 ──
function exam(over) {
  over = over || {};
  return {
    KCM: over.KCM ?? "高等数学", KSSJMS: over.KSSJMS ?? "2026-11-05 08:00-10:00",
    KSRQ: over.KSRQ ?? "2026-11-05 00:00:00", JASMC: "文萃楼I404",
    ZWH: over.ZWH ?? "012", KSMC: "集中", KCH: "101", ZJJSXM: "李四"
  };
}
{
  const n = examsToNotify([exam()]);
  eq(n.length, 1, "正常考试行进 1 场");
  eq(n[0].date, parseISODate("2026-11-05"), "考试日期");
  eq(n[0].beginTime, 480, "开始 08:00=480");
  eq(n[0].endTime, 600, "结束 10:00=600");
  eq(n[0].seatId, "012", "座位号");
}
{
  const n = examsToNotify([exam({ KSSJMS: "星期五 无时间", KSRQ: "2026-11-05 00:00:00" })]);
  eq(n.length, 0, "时刻解析不出 → 整场跳过（fail-closed）");
}
{
  const n = examsToNotify([exam({ KSRQ: "未知", KSSJMS: "无日期 08:00-10:00" })]);
  eq(n.length, 0, "日期解析不出 → 整场跳过");
}

// ── 日期映射：DateTime → 日历字段（时区陷阱）──
{
  const day = parseISODate("2026-11-05");
  const r = {
    key: "course:101:2026-11-05:1:10", kind: ReminderKind.CLASS,
    at: { day: day, minutes: 470 }, title: "10 分钟后上课",
    text: "高等数学 · 文萃楼I404", route: "pages/SchedulePage"
  };
  const s = specOf(r, day);
  eq(s, {
    key: r.key, kind: ReminderKind.CLASS, title: "10 分钟后上课", content: "高等数学 · 文萃楼I404",
    year: 2026, month: 11, day: 5, hour: 7, minute: 50
  }, "DateTime → 本地年月日时分（分钟 470 = 07:50）");

  eq(specOf(r, day + 1), null, "早于今天 ⇒ 不排");
}

// ── 配额裁剪 ──
{
  eq(AGENT_REMINDER_LIMIT, 30, "上限常量 = 30");
  const many = [];
  for (let i = 0; i < 40; i++) {
    many.push({ key: "k" + i, kind: ReminderKind.CLASS, at: { day: 20500 + i, minutes: 0 }, title: "", text: "", route: "" });
  }
  const picked = selectForAgent(many, 30);
  eq(picked.length, 30, "40 条裁到 30");
  eq(picked[0].key, "k0", "保留最早的（at 升序前 30）");
  eq(picked[29].key, "k29", "裁掉最远的 10 条");
  eq(selectForAgent(many.slice(0, 30), 30).length, 30, "恰好 30 不裁");
  eq(selectForAgent(many.slice(0, 20), 30).length, 20, "不足 30 全留");
}

// ── 组合：过去 + 超配额 同时发生 ──
{
  const nowDay = 20500;
  const rs = [];
  for (let i = 0; i < 10; i++) rs.push({ key: "p" + i, kind: ReminderKind.CLASS, at: { day: nowDay - 10 + i, minutes: 0 }, title: "", text: "", route: "" });
  for (let i = 0; i < 35; i++) rs.push({ key: "f" + i, kind: ReminderKind.CLASS, at: { day: nowDay + 1 + i, minutes: 0 }, title: "", text: "", route: "" });
  const out = specsForPublish(rs, nowDay, 30);
  eq(out.droppedPast, 10, "过去 10 条全剔");
  eq(out.droppedQuota, 5, "未来超配额 5 条被裁");
  eq(out.specs.length, 30, "最终 publish 30 条");
  eq(out.specs[0].key, "f0", "publish 的最早是 f0（过去已剔）");
}

console.log("pass=" + passed + " fail=" + failed);
if (failed > 0) process.exit(1);
console.log("ALL PASS  pass=" + passed + " fail=" + failed);
