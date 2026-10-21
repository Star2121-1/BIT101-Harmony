/**
 * 成绩表解析 + 差分 + 隐私文案（M7-3 出分提醒 / M10-2 成绩查询共用）。
 *
 * 1:1 移植 Android `ScoreLogicTest`（220 行）。锁定三类行为：
 * - 认得出的形状 → 正确解析（含**真实教务表头**：课程编号在课程名称之前，
 *   必须按关键词优先级 + 排除词定位，别拿编号当课名）
 * - 认不出的形状 → 返回空，**绝不猜**
 * - **文案里绝不出现分数**（用户定的隐私边界，专测锁死）
 *
 * ⚠️ .mjs 纯 JS：不许 TS 类型注解 / `import type`（Node 直跑会炸）。
 */
import {
  parseTable,
  diff,
  snapshotOf,
  summaryText,
  scoreKey
} from "../entry/src/main/ets/corelogic/ScoreLogic.ts";
import {
  isReady, isRejected, isExpired, isTerminal, needsSms, shouldCheck,
  SERVICE_JWB, POLL_MAX_ATTEMPTS, POLL_INTERVAL_MS, CHECK_INTERVAL_MS
} from "../entry/src/main/ets/corelogic/ScoreQueryLogic.ts";
import {
  encode, parse as parseCheck, humanReason, statusText,
  ScoreCheckCode, fmtCheckTime
} from "../entry/src/main/ets/corelogic/ScoreCheckLogic.ts";

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

function entry(course, term, score) {
  return { course: course, score: score === undefined ? "88" : score, term: term === undefined ? "2025-2026-1" : term };
}

// ── 解析：标准形状 ──
{
  const data = [
    ["学期", "课程", "成绩", "学分"],
    ["2025-2026-1", "高等数学", "92", "5"],
    ["2025-2026-1", "操作系统", "88", "4"]
  ];
  const e = parseTable(data);
  eq(e.length, 2, "标准二维表 2 行");
  eq(e[0].course, "高等数学", "课名");
  eq(e[0].score, "92", "分数原文");
  eq(e[0].term, "2025-2026-1", "学期");
  eq(scoreKey(e[0]), "高等数学|2025-2026-1", "去重键 = 课程|学期（不含分数）");
}

// ── 列顺序不同也能解析（列位置由表头决定，不写死下标）──
{
  const data = [
    ["成绩", "课程名", "学年"],
    ["92", "高等数学", "2025-2026-1"]
  ];
  const e = parseTable(data);
  eq(e.length, 1, "乱序列 1 行");
  eq(e[0].course, "高等数学", "乱序取课名");
  eq(e[0].score, "92", "乱序取分数");
  eq(e[0].term, "2025-2026-1", "学年当学期");
}

// ── 每行是字符串时按空白切列 ──
{
  const data = [
    "学期 课程 成绩",
    "2025-2026-1  高等数学  92"
  ];
  const e = parseTable(data);
  eq(e.length, 1, "字符串行 1 条");
  eq(e[0].course, "高等数学", "字符串行切课名");
  eq(e[0].score, "92", "字符串行切分数");
}

// ── 没有表头就不猜 ──
{
  const e = parseTable([["a", "b", "c"], ["1", "2", "3"]]);
  eq(e.length, 0, "无关键词表头 → 空（不猜）");
}

// ── 空 / 非数组都返回空 ──
{
  eq(parseTable(null).length, 0, "null → 空");
  eq(parseTable([]).length, 0, "空数组 → 空");
  eq(parseTable("text").length, 0, "非数组 → 空");
}

// ── 课名为空的行跳过 ──
{
  const data = [
    ["课程", "成绩"],
    ["", "92"],
    ["操作系统", "88"]
  ];
  const e = parseTable(data);
  eq(e.length, 1, "空课名行被跳过");
  eq(e[0].course, "操作系统", "保留非空行");
}

// ── 真实教务表头（课程编号在课程名称之前）：别拿编号当课名 ──
{
  const data = [
    ["序号","开课学期","课程编号","课程名称","成绩","成绩标识","学分","总学时","考试性质","考核方式","课程属性","课程性质","课程归属","课程种类","是否第一次考试","操作栏"],
    ["1","2024-2025-1","09000410","高等数学","92","","5","64","正常考试","考试","必修","公共基础","","","是",""],
    ["2","2024-2025-2","09000411","操作系统","88","","4","48","正常考试","考查","必修","专业","","","是",""]
  ];
  const e = parseTable(data);
  eq(e.length, 2, "真实表头 2 行");
  eq(e[0].course, "高等数学", "课名取「课程名称」而非前面的「课程编号」");
  eq(e[1].course, "操作系统", "第二行课名");
  eq(e[0].score, "92", "成绩取「成绩」而非后面的「成绩标识」（标识列空）");
  eq(e[1].score, "88", "第二行成绩");
  eq(e[0].term, "2024-2025-1", "学期取「开课学期」");
}

// ── 只有「课程编号」+「课程」时，排除词让课名落在「课程」 ──
{
  const data = [
    ["课程编号","课程","成绩"],
    ["09000410","高等数学","92"]
  ];
  const e = parseTable(data);
  eq(e.length, 1, "编号+课程 1 条");
  eq(e[0].course, "高等数学", "排除编号后取课程列");
  eq(e[0].score, "92", "分数");
}

// ── 差分：首次建基线不提醒 ──
{
  eq(diff(null, [entry("高等数学")]), [], "首次（snapshot=null）→ 空，只建基线");
}

// ── 差分：新课程报出来 ──
{
  const snap = { "高等数学|2025-2026-1": "92" };
  const list = diff(snap, [entry("高等数学"), entry("操作系统")]);
  eq(list.map(x => x.course), ["操作系统"], "快照没有的键才报");
}

// ── 差分：改分（键已存在、分数变了）不重新提醒 ──
{
  const snap = { "高等数学|2025-2026-1": "85" };
  const list = diff(snap, [entry("高等数学", "2025-2026-1", "99")]); // 同键不同分
  eq(list, [], "改分（键存在）不报");
}

// ── 快照序列化回读一致 ──
{
  const snap = snapshotOf([entry("高等数学"), entry("操作系统", "2025-2026-2")]);
  eq(Object.keys(snap).sort(), ["操作系统|2025-2026-2", "高等数学|2025-2026-1"].sort(), "快照键集合");
  eq(snap["操作系统|2025-2026-2"], "88", "快照值 = 分数原文");
}

// ── 文案：单门 ──
{
  eq(summaryText([entry("操作系统")]), "「操作系统」成绩已发布", "单门文案");
}

// ── 文案：多门最多列三个 ──
{
  const names = ["操作系统", "数据结构", "大学物理", "概率论"];
  eq(summaryText(names.map(n => entry(n))), "操作系统、数据结构、大学物理 等 4 门课成绩已发布", "多门最多列 3 + 总数");
}

// ── 隐私边界：文案绝不包含分数原文（用户红线）──
{
  const text = summaryText([
    { course: "操作系统", score: "88", term: null },
    { course: "数据结构", score: "95", term: null }
  ]);
  ok(text.indexOf("88") < 0, "文案不含 88");
  ok(text.indexOf("95") < 0, "文案不含 95");
  eq(text, "操作系统、数据结构 等 2 门课成绩已发布", "文案正文");
}

// ── 文案：空列表 ──
{
  eq(summaryText([]), "", "空列表文案为空");
}

// ── 轮询终止条件（ScoreQueryLogic，1:1 Android）──
{
  eq(isReady(["jwb"]), true, "含 jwb → 就绪");
  eq(isReady(["other"]), false, "不含 jwb → 未就绪");
  eq(isReady([]), false, "空列表 → 未就绪");
  eq(isReady(null), false, "null → 未就绪");
  eq(SERVICE_JWB, "jwb", "服务标识 = jwb");
  eq(isRejected("failed"), true, "failed → 被拒");
  eq(isRejected("pending"), false, "非 failed 不算被拒");
  eq(isExpired("expired"), true, "expired → 过期");
  eq(isTerminal("failed"), true, "被拒 = 终结");
  eq(isTerminal("expired"), true, "过期 = 终结");
  eq(isTerminal("pending"), false, "pending 非终结（还得轮）");
  eq(needsSms("waiting_sms"), true, "waiting_sms → 要短信");
  eq(needsSms("pending"), false, "非 waiting_sms 不要");
}

// ── 12h 限频（撞学校风控的命门）──
{
  const h = 3600 * 1000;
  eq(shouldCheck(-1, 0), true, "首次（-1）该查");
  eq(shouldCheck(0, 11 * h), false, "11h 未到 12h 不查");
  eq(shouldCheck(0, 12 * h), true, "满 12h 该查");
  eq(shouldCheck(0, 13 * h), true, "超过该查");
  eq(CHECK_INTERVAL_MS, 12 * h, "限频 = 12h");
  eq(POLL_MAX_ATTEMPTS, 25, "轮询 25 次");
  eq(POLL_INTERVAL_MS, 400, "间隔 400ms");
}

// ── 检查状态编码/解析（ScoreCheckLogic，1:1 Android encode/parse）──
{
  // 四段（带 detail）
  const enc = encode({ atMillis: 100, code: ScoreCheckCode.AUTH_FAILED, count: 0, detail: "用户名或密码错误 [status=401]" });
  eq(enc, "100|AUTH_FAILED|0|用户名或密码错误 [status=401]", "四段编码");
  const p = parseCheck(enc);
  eq(p.code, "AUTH_FAILED", "解析码");
  eq(p.count, 0, "解析条数");
  eq(p.detail, "用户名或密码错误 [status=401]", "解析原因");
}
{
  // 三段（无 detail，老格式兼容）
  const enc = encode({ atMillis: 200, code: ScoreCheckCode.OK, count: 5, detail: null });
  eq(enc, "200|OK|5", "无 detail 三段");
  const p = parseCheck(enc);
  eq(p.code, "OK", "三段码");
  eq(p.count, 5, "三段条数");
  eq(p.detail, null, "无 detail → null");
}
{
  // detail 里混入分隔符：第 4 段之后重新拼（不丢内容）
  const p = parseCheck("300|FAILED|0|网络|断连");
  eq(p.detail, "网络|断连", "detail 内 | 重拼");
}
{
  // 形状不对 → null（不猜）
  eq(parseCheck(null), null, "null → null");
  eq(parseCheck("   "), null, "空串 → null");
  eq(parseCheck("abc|OK"), null, "时刻非数字 → null");
  eq(parseCheck("300|BOGUS|0"), null, "未知码 → null（不猜）");
  eq(parseCheck("300"), null, "缺码段 → null");
}

// ── 人话文案（humanReason + statusText，1:1 Android）──
{
  eq(humanReason("用户名或密码错误 [status=401]"), "用户名或密码错误", "取 [ 之前");
  eq(humanReason("网络失败"), "网络失败", "无 [ 原样");
  eq(humanReason(null), null, "null → null");
  eq(humanReason("   "), null, "空白 → null");
  // AUTH_FAILED 文案绝不含「稍后重试」（重试无效，必须先确认凭据）
  const t = statusText({ atMillis: 100, code: ScoreCheckCode.AUTH_FAILED, count: 0, detail: "用户名或密码错误" });
  ok(t.indexOf("稍后重试") < 0, "AUTH_FAILED 不写稍后重试");
  ok(t.indexOf("先确认学号与密码") >= 0, "AUTH_FAILED 提示确认凭据");
  ok(t.indexOf("用户名或密码错误") >= 0, "带出服务端原话");
}
{
  // 各码文案
  eq(statusText({ atMillis: 0, code: ScoreCheckCode.OK, count: 5, detail: null }), "最近检查：" + fmtCheckTime(0) + " · 已同步 5 门课", "OK 文案");
  eq(statusText({ atMillis: 0, code: ScoreCheckCode.NOT_LOGGED_IN, count: 0, detail: null }), "最近检查：" + fmtCheckTime(0) + " · 未登录，先登录才能检查", "未登录文案");
  eq(statusText(null), "还没检查过（下次打开 App 时检查）", "从没检查文案");
}

console.log("\n" + (failed === 0 ? "ALL PASS" : "FAILED") + "  pass=" + passed + " fail=" + failed);
process.exit(failed > 0 ? 1 : 0);
