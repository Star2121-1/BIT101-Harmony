/**
 * 编译探针：逐个 import 13 个算法模块的关键导出并调用纯函数。
 * 目的：逼 hvigor 的 ArkTS 严格编译器真正 type-check 每个 .ts 文件
 * （否则入口不引用 = dead code，BUILD SUCCESSFUL 可能是假通过）。
 * 仅用于 M0 地基验证，非业务代码；M1 接 UI 后可删。
 * 行为正确性不在这里断言——那由 core-logic/test/ 的 243 条单测负责（已全绿）。
 * 这里只做「类型 + import 图」验证：每个模块都能被 ArkTS 编译器吃掉。
 */
import { normalize, ALL } from "./CampusLocations.ts";
import { fnv1a32, PALETTE_SIZE } from "./CourseColorLogic.ts";
import { weekOf, effectiveWeekday } from "./CourseWeekdayLogic.ts";
import { MAX_FETCH_LIMIT, fetchLimit, toActivities } from "./EclassActivityLogic.ts";
import { uid as ddlUid } from "./EclassDdlLogic.ts";
import { parseTime as libParseTime, daysLeft } from "./LibBorrowLogic.ts";
import { DEFAULT_NOTIFY_POLICY, plan as notifyPlan } from "./NotifyLogic.ts";
import { Stop, DayType, timetable } from "./ShuttleLogic.ts";
import { MIN_FREE_SECTIONS, sectionFor } from "./StudySpotLogic.ts";
import { dayPlanOf } from "./TeachingAdjustment.ts";
import { parseTable, summaryText } from "./ScoreLogic.ts";
import { isReady, shouldCheck } from "./ScoreQueryLogic.ts";
import { statusText, ScoreCheckCode } from "./ScoreCheckLogic.ts";
import { coursesToSchedule, assembleWidgetPages, isSerializablePayload } from "./WidgetData.ts";
import {
  groupTree, toSeatVM, summarizeSeats, fmtMinutes,
  buildSlotOptions, validateSlot, myReservations,
  buildViolationVM, seminarVMs,
} from "./SeatViewLogic.ts";
import { SeatTreeNode } from "../model/SeatTreeModel.ts";
import {
  ENDPOINTS, seatStatusOf, isFree, parseSeats, buildConfirmBody, bizResult,
  signInDeadline, seatNumberEquals, wireStatusText, wireStatusColor,
} from "./SeatApiLogic.ts";
import { courseTimeText, FALLBACK_TIME_TABLE } from "./TimeTableLogic.ts";
import { pickDay, buildDayBlocks } from "./WidgetLogic.ts";

/** 各模块各取一个可离线调用的纯函数/常量，拼成一段可观测文本。 */
export function runProbe(): string {
  const parts: string[] = [];
  // CampusLocations：全角「Ｉ４０４」归一化（Android 测试同款）
  parts.push("norm=" + normalize("Ｉ４０４"));
  // CourseColorLogic：FNV-1a % 12
  parts.push("fnv=" + fnv1a32("文萃楼") + "/palette=" + PALETTE_SIZE);
  // EclassActivityLogic：动态抓取条数上限
  parts.push("fetchcap=" + MAX_FETCH_LIMIT + "/" + fetchLimit(60, false));
  // EclassDdlLogic：去重键
  parts.push("ddluid=" + ddlUid(42));
  // LibBorrowLogic：到期天数
  parts.push("libday=" + (libParseTime("2026-10-19 08:00:00") ? "parsed" : "null"));
  // NotifyLogic：默认策略存在性
  parts.push("notify=" + (DEFAULT_NOTIFY_POLICY ? "on" : "off"));
  // StudySpotLogic：常量 + 节次（1-based）
  parts.push("minfree=" + MIN_FREE_SECTIONS);
  // TimeTableLogic：13 节作息
  parts.push("timetable=" + courseTimeText(FALLBACK_TIME_TABLE, 8, 9));
  // ShuttleLogic：地铁方向时刻表（周末口径，条目数）
  parts.push("bus=" + timetable(Stop.METRO, DayType.WEEKEND_HOLIDAY).length + "stops");
  // ScoreLogic：解析 + 隐私文案（不含分数）
  parts.push("score=" + parseTable(null).length + "/" + (summaryText([]).length === 0 ? "empty" : "nonempty"));
  // ScoreQueryLogic：轮询就绪 + 12h 限频
  parts.push("poll=" + (isReady(["jwb"]) ? "ready" : "no") + "/check=" + (shouldCheck(-1, 0) ? "due" : "hold"));
  // ScoreCheckLogic：检查状态文案（AUTH_FAILED 绝不含「稍后重试」）
  parts.push("chk=" + (statusText({ atMillis: 0, code: ScoreCheckCode.AUTH_FAILED, count: 0, detail: "用户名或密码错误" }).indexOf("稍后重试") < 0 ? "ok" : "bad"));
  // WidgetData：卡片数据装配（空源 ⇒ 5 页 + 可序列化，卡片独立进程前提）
  const widgetPages: WidgetPage[] = assembleWidgetPages({
    courses: coursesToSchedule([]),
    ddls: [],
    activities: [],
    adjustments: [],
    firstDay: "",
    timeTable: FALLBACK_TIME_TABLE,
    now: { day: 0, minutes: 0 }
  });
  parts.push("widget=" + widgetPages.length + "pages/" + (isSerializablePayload(widgetPages) ? "serializable" : "dirty"));
  // SeatViewLogic：座位树分组 + 座位 VM + 时段校验 + 违约/研讨间视图（M9 UI 支撑）
  const probeTreeNodes: SeatTreeNode[] = [
    new SeatTreeNode('c1', '良乡', 0, null, null),
    new SeatTreeNode('f1', '1F', 0, 'c1', null),
    new SeatTreeNode('a1', '自习区A', 1, 'f1', null),
  ];
  const probeCampus = groupTree(probeTreeNodes);
  parts.push("seatview=" + probeCampus.length + "campus/" + fmtMinutes(480) + "/" +
    (validateSlot(480, 540, 480).length === 0 ? "slotok" : "slotbad") + "/" +
    (summarizeSeats([]).freeRatio === "暂无座位" ? "sumok" : "sumbad") + "/" +
    (buildViolationVM([], 0).countText === "0/5" ? "viook" : "viobad") + "/" +
    (seminarVMs([]).length === 0 ? "semok" : "sembad") + "/" +
    (buildSlotOptions(480, 30, 480).maxDuration === 480 ? "slotmax" : "slotbadmax") +
    "/" + (toSeatVM({ seatId: "x", seatName: "x", status: "FREE", reservationId: null,
      otherName: null, timeRange: null, kind: "SINGLE", signInKind: "NFC_QR",
      signInDeadlineMinutes: null, isCheckedIn: false }).reservable ? "resv" : "resbad") +
    "/" + (myReservations([], { day: 0, minutes: 0 }).length === 0 ? "mineok" : "minebad"));

  // SeatApiLogic：座位接口契约（端点/body/解析/状态映射，铁律0.9 对齐 Android 实测）
  parts.push("seatapi=" +
    (ENDPOINTS.confirm === "/api/Seat/confirm" ? "ep-ok" : "ep-bad") + "/" +
    (seatStatusOf("2") === "RESERVED" ? "st-ok" : "st-bad") + "/" +
    (isFree("AVAILABLE") ? "free-ok" : "free-bad") + "/" +
    (JSON.stringify(buildConfirmBody("007", "")) === '{"seat_id":7,"segment":"1"}' ? "body-ok" : "body-bad") + "/" +
    (bizResult({ code: 1 }).ok ? "biz-ok" : "biz-bad") + "/" +
    (JSON.stringify(signInDeadline(100, 480, 100)) === '{"day":100,"minutes":540}' ? "dl-ok" : "dl-bad") + "/" +
    (seatNumberEquals("001", "1") ? "eq-ok" : "eq-bad") + "/" +
    (parseSeats([{ id: "1", no: "001", status: "1" }], "a").length === 1 ? "ps-ok" : "ps-bad") + "/" +
    (wireStatusText("AVAILABLE") === "空闲" ? "wst-ok" : "wst-bad") + "/" +
    (wireStatusColor("LEAVE", false) === "#B45309" ? "wsc-ok" : "wsc-bad"));

  // 以下参数较复杂，不在此构造合法入参，仅 import 强制编译器吃文件（类型校验）
  void weekOf;
  void effectiveWeekday;
  void toActivities;
  void libParseTime;
  void daysLeft;
  void notifyPlan;
  void sectionFor;
  void dayPlanOf;
  void pickDay;
  void buildDayBlocks;
  void ALL;

  return "probe[" + parts.join(" ") + "]";
}
