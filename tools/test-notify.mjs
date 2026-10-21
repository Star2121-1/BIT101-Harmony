/**
 * 通知历史（M7-1）：合并 / 清理 / 筛选 / 已发判定的口径。
 *
 * 重点钉住三条纪律（都栽过或会栽）：
 * 1. **已发不回滚**：旧记录 firedMillis>0 时，重排不得把它改回未发
 *    （sentKeys 只增不减的列表侧对偶）；
 * 2. **旧表里有、新表没有 ⇒ 保留**：删课表条目不能造成「记录蒸发」；
 * 3. **14 天清理双锚点**：已发看 firedMillis、未发看 atMillis（烂尾没发的也要剪）。
 */
import {
  mergeNotifyRecords,
  pruneNotifyRecords,
  filterByKind,
  kindLabel,
  isFired,
  allKinds,
  NOTIFY_KEEP_DAYS
} from "../entry/src/main/ets/corelogic/NotifyRecordLogic.ts";
import { ReminderKind } from "../entry/src/main/ets/corelogic/NotifyLogic.ts";

let passed = 0;
let failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) {
    passed++;
    return;
  }
  failed++;
  console.error(`FAIL: ${name}\n  actual   = ${a}\n  expected = ${b}`);
}
function ok(cond, name) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error("FAIL: " + name);
  }
}

const t0 = Date.parse("2026-12-01T08:00:00Z");
const day = 24 * 3600 * 1000;

const rec = (over = {}) => ({
  key: over.key ?? "k1",
  kind: over.kind ?? ReminderKind.CLASS,
  title: over.title ?? "10 分钟后上课",
  text: over.text ?? "数据结构 文萃楼 201",
  atMillis: over.atMillis ?? t0,
  firedMillis: over.firedMillis ?? 0,
});

// ── 合并 ──
{
  // 空 × 新 = 全部进来
  eq(mergeNotifyRecords([], [rec({ key: "a" }), rec({ key: "b" })]),
    [rec({ key: "a" }), rec({ key: "b" })], "空旧表 + 新记录");
}
{
  // 旧表独有的 key 保留
  const old = [rec({ key: "x" })];
  const out = mergeNotifyRecords(old, [rec({ key: "y" })]);
  eq(out.map((r) => r.key).sort(), ["x", "y"], "旧表独有 key 保留（不蒸发）");
}
{
  // 同 key：显示字段被新记录覆盖
  const old = [rec({ key: "k", title: "旧标题", atMillis: t0 })];
  const out = mergeNotifyRecords(old, [rec({ key: "k", title: "新标题", atMillis: t0 + 60000 })]);
  eq(out[0].title, "新标题", "同 key 覆盖标题");
  eq(out[0].atMillis, t0 + 60000, "同 key 覆盖排期时刻");
  eq(out.length, 1, "同 key 不产生重复");
}
{
  // 已发不回滚：旧 fired>0，新记录 fired=0（重排）
  const old = [rec({ key: "k", firedMillis: t0 + 5000 })];
  const out = mergeNotifyRecords(old, [rec({ key: "k", atMillis: t0 + 100000, title: "重排" })]);
  eq(out[0].firedMillis, t0 + 5000, "已发的 firedMillis 不回滚");
  eq(out[0].title, "重排", "已发条目的显示字段仍随重排更新");
}
{
  // 入参不被改（返回新数组）
  const old = [rec({ key: "k" })];
  const snapshot = JSON.stringify(old);
  mergeNotifyRecords(old, [rec({ key: "z" })]);
  eq(JSON.stringify(old), snapshot, "merge 不改入参");
}
{
  // 已发（fired>at）的条目在 merge 里也保留 fired
  const old = [rec({ key: "k", atMillis: t0, firedMillis: t0 })];
  const out = mergeNotifyRecords(old, [rec({ key: "k" })]);
  eq(out[0].firedMillis, t0, "fired==at 的边界也保留已发");
}

// ── 清理 ──
{
  // 已发 15 天前 ⇒ 剪
  const now = t0 + 15 * day;
  const { kept, removed } = pruneNotifyRecords(
    [rec({ key: "old", firedMillis: t0 })], now);
  eq(removed, 1, "已发 15 天前的剪掉");
  eq(kept.length, 0, "剪后 kept 为空");
}
{
  // 已发 13 天前 ⇒ 留
  const now = t0 + 13 * day;
  const { kept, removed } = pruneNotifyRecords([rec({ key: "ok", firedMillis: t0 })], now);
  eq(removed, 0, "13 天内的已发保留");
  eq(kept.length, 1, "保留一条");
}
{
  // 未发且 at 在 15 天前（烂尾没发）⇒ 剪
  const now = t0 + 15 * day;
  const { kept, removed } = pruneNotifyRecords([rec({ key: "stale", atMillis: t0 })], now);
  eq(removed, 1, "烂尾未发（at 过期）也剪");
  eq(kept.length, 0, "剪后 kept 为空");
}
{
  // 未发且 at 在未来 ⇒ 留（锚点 = atMillis，未来值 > deadline）
  const now = t0 + 15 * day;
  const { kept, removed } = pruneNotifyRecords(
    [rec({ key: "future", atMillis: now + day })], now);
  eq(removed, 0, "未来的未发保留");
  eq(kept.length, 1, "保留一条");
}
{
  // KEEP_DAYS 常量与 Android 14 天一致
  eq(NOTIFY_KEEP_DAYS, 14, "保留天数 = 14（与 NotifySentStore 同口径）");
}
{
  // 混合：一条剪一条留
  const now = t0 + 15 * day;
  const { kept, removed } = pruneNotifyRecords(
    [
      rec({ key: "old", firedMillis: t0 }),
      rec({ key: "new", firedMillis: t0 + 13 * day }),
    ], now);
  eq(removed, 1, "混合表只剪过期那条");
  eq(kept.map((r) => r.key), ["new"], "保留未过期的");
}

// ── 筛选 ──
{
  const a = rec({ key: "a", kind: ReminderKind.CLASS, atMillis: t0 + 3000 });
  const b = rec({ key: "b", kind: ReminderKind.DDL, atMillis: t0 });
  const c = rec({ key: "c", kind: ReminderKind.CLASS, atMillis: t0 + 1000 });
  // null = 全部，且按 atMillis 升序
  const all = filterByKind([a, b, c], null);
  eq(all.map((r) => r.key), ["b", "c", "a"], "全部 + 升序");
  const classOnly = filterByKind([a, b, c], ReminderKind.CLASS);
  eq(classOnly.map((r) => r.key), ["c", "a"], "按类型筛");
  eq(filterByKind([a, b], ReminderKind.EXAM), [], "没有该类型 = 空表");
}

// ── 标签 / 已发判定 ──
{
  eq(kindLabel(ReminderKind.CLASS), "上课", "CLASS 标签");
  eq(kindLabel(ReminderKind.DDL), "作业", "DDL 标签");
  eq(kindLabel(ReminderKind.SEAT_SIGN_IN), "座位签到", "SEAT 标签");
  eq(kindLabel(ReminderKind.EXAM), "考试", "EXAM 标签");
  eq(kindLabel(ReminderKind.ADJUSTMENT), "教学调整", "ADJUSTMENT 标签");
  eq(allKinds().length, 5, "五类齐全");
}
{
  eq(isFired(rec({ atMillis: t0, firedMillis: 0 })), false, "fired=0 未发");
  eq(isFired(rec({ atMillis: t0, firedMillis: t0 })), true, "fired==at 算已发");
  eq(isFired(rec({ atMillis: t0, firedMillis: t0 + 90000 })), true, "迟到发也算已发");
}

console.log("pass=" + passed + " fail=" + failed);
if (failed > 0) process.exit(1);
console.log("ALL PASS  pass=" + passed + " fail=" + failed);
