// enum 运行时值锁定测试。
//
// 背景：as const 对象 / 字面量联合类型在 ArkTS 是错误级违禁（arkts-no-as-const /
// arkts-no-string-literal-type），已按官方建议改为 string/number enum。
// string enum 成员的运行时值就是底层字符串，所以旧单测「传字符串字面量」照跑绿——
// 那证明不了改造没跑偏。本套件显式锁死每个成员的运行时值，防止 _value drift。
//
// 跑法（Node 22.7+，靠 --experimental-transform-types 直接吃 .ts）：
//   node --experimental-transform-types tools/test-enums.mjs

import {
  Endpoint, WireSeatStatus,
} from "../entry/src/main/ets/corelogic/SeatApiLogic.ts";
import {
  SeatStatus, ReservationKind, SignInKind,
} from "../entry/src/main/ets/corelogic/SeatLogic.ts";
import { SeatStatus as ModelSeatStatus } from "../entry/src/main/ets/model/SeatModel.ts";
import { TaskMode, TaskStatus } from "../entry/src/main/ets/model/SeatTask.ts";
import {
  PageKind, ScheduleTabs, Routes, ClassState, BlockKind,
} from "../entry/src/main/ets/corelogic/WidgetLogic.ts";
import { Distance } from "../entry/src/main/ets/corelogic/CampusLocations.ts";
import { ActivityKind } from "../entry/src/main/ets/corelogic/EclassActivityLogic.ts";
import { ReminderKind } from "../entry/src/main/ets/corelogic/NotifyLogic.ts";
import { ScoreCheckCode } from "../entry/src/main/ets/corelogic/ScoreCheckLogic.ts";
import { Stop, DayType } from "../entry/src/main/ets/corelogic/ShuttleLogic.ts";
import { Kind } from "../entry/src/main/ets/corelogic/StudySpotLogic.ts";

// 注意：CasLoginService.LoginStatus 不在此锁——该文件 import @kit.RemoteCommunicationKit，
// Node 解析不了（纯逻辑/服务分层使然）。其值由机械替换保真，编译图内由 compile-probe 覆盖。

let pass = 0;
let fail = 0;

function eq(actual, expected, label) {
  if (actual === expected) {
    pass++;
  } else {
    fail++;
    console.log(`FAIL ${label}: 期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`);
  }
}

// ── SeatApiLogic ────────────────────────────────────────────────────────────
eq(Endpoint.TREE, "/api/Seat/tree", "Endpoint.TREE");
eq(Endpoint.DATE, "/api/Seat/date", "Endpoint.DATE");
eq(Endpoint.SEAT, "/api/Seat/seat", "Endpoint.SEAT");
eq(Endpoint.CONFIRM, "/api/Seat/confirm", "Endpoint.CONFIRM");
eq(Endpoint.SUBSCRIBE, "/api/index/subscribe", "Endpoint.SUBSCRIBE");
eq(Endpoint.CANCEL, "/api/Space/cancel", "Endpoint.CANCEL");
eq(Endpoint.MAP, "/api/seat/map", "Endpoint.MAP");
eq(Endpoint.RENEGES, "/api/Member/reneges", "Endpoint.RENEGES");
eq(Endpoint.SEMINAR, "/api/Member/seminar", "Endpoint.SEMINAR");

eq(WireSeatStatus.AVAILABLE, "AVAILABLE", "WireSeatStatus.AVAILABLE");
eq(WireSeatStatus.RESERVED, "RESERVED", "WireSeatStatus.RESERVED");
eq(WireSeatStatus.IN_USE, "IN_USE", "WireSeatStatus.IN_USE");
eq(WireSeatStatus.LEAVE, "LEAVE", "WireSeatStatus.LEAVE");
eq(WireSeatStatus.UNAVAILABLE, "UNAVAILABLE", "WireSeatStatus.UNAVAILABLE");

// ── SeatLogic ───────────────────────────────────────────────────────────────
eq(SeatStatus.FREE, "FREE", "SeatStatus.FREE");
eq(SeatStatus.RESERVED_YOURS, "RESERVED_YOURS", "SeatStatus.RESERVED_YOURS");
eq(SeatStatus.RESERVED_OTHERS, "RESERVED_OTHERS", "SeatStatus.RESERVED_OTHERS");
eq(SeatStatus.CHECKED_IN, "CHECKED_IN", "SeatStatus.CHECKED_IN");
eq(SeatStatus.EXPIRED, "EXPIRED", "SeatStatus.EXPIRED");
eq(SeatStatus.DEFAULTED, "DEFAULTED", "SeatStatus.DEFAULTED");
eq(SeatStatus.CANCELLED, "CANCELLED", "SeatStatus.CANCELLED");
eq(ReservationKind.SINGLE, "SINGLE", "ReservationKind.SINGLE");
eq(ReservationKind.CONTINUOUS, "CONTINUOUS", "ReservationKind.CONTINUOUS");
eq(ReservationKind.SEMINAR_ROOM, "SEMINAR_ROOM", "ReservationKind.SEMINAR_ROOM");
eq(SignInKind.NFC_QR, "NFC_QR", "SignInKind.NFC_QR");
eq(SignInKind.GPS, "GPS", "SignInKind.GPS");
eq(SignInKind.SIMULATED, "SIMULATED", "SignInKind.SIMULATED");

// ── SeatModel（数字 enum，锁服务端口径）──────────────────────────────────────
eq(ModelSeatStatus.AVAILABLE, 1, "ModelSeatStatus.AVAILABLE=1");
eq(ModelSeatStatus.RESERVED, 2, "ModelSeatStatus.RESERVED=2");
eq(ModelSeatStatus.RESERVED_YOURS, 10, "ModelSeatStatus.RESERVED_YOURS=10");
eq(ModelSeatStatus.RESERVED_OTHERS, 11, "ModelSeatStatus.RESERVED_OTHERS=11");
eq(ModelSeatStatus.IN_USE, 6, "ModelSeatStatus.IN_USE=6");
eq(ModelSeatStatus.LEAVE, 7, "ModelSeatStatus.LEAVE=7");
eq(ModelSeatStatus.UNAVAILABLE, 3, "ModelSeatStatus.UNAVAILABLE=3");
eq(ModelSeatStatus.BLOCKED, 4, "ModelSeatStatus.BLOCKED=4");
eq(ModelSeatStatus.MAINTENANCE, 5, "ModelSeatStatus.MAINTENANCE=5");

// ── SeatTask ────────────────────────────────────────────────────────────────
eq(TaskMode.SINGLE, "SINGLE", "TaskMode.SINGLE");
eq(TaskMode.MONITOR, "MONITOR", "TaskMode.MONITOR");
eq(TaskMode.PREFER, "PREFER", "TaskMode.PREFER");
eq(TaskStatus.IDLE, "IDLE", "TaskStatus.IDLE");
eq(TaskStatus.RUNNING, "RUNNING", "TaskStatus.RUNNING");
eq(TaskStatus.SUCCESS, "SUCCESS", "TaskStatus.SUCCESS");
eq(TaskStatus.FAILED, "FAILED", "TaskStatus.FAILED");
eq(TaskStatus.CANCELLED, "CANCELLED", "TaskStatus.CANCELLED");

// ── WidgetLogic ─────────────────────────────────────────────────────────────
eq(PageKind.COURSE, "COURSE", "PageKind.COURSE");
eq(PageKind.DDL, "DDL", "PageKind.DDL");
eq(PageKind.ACTIVITY, "ACTIVITY", "PageKind.ACTIVITY");
eq(PageKind.SEAT, "SEAT", "PageKind.SEAT");
eq(PageKind.STUDY, "STUDY", "PageKind.STUDY");
eq(ScheduleTabs.COURSE, 0, "ScheduleTabs.COURSE=0");
eq(ScheduleTabs.DDL, 1, "ScheduleTabs.DDL=1");
eq(ScheduleTabs.ACTIVITY, 2, "ScheduleTabs.ACTIVITY=2");
eq(ScheduleTabs.FREE_CLASSROOM, 3, "ScheduleTabs.FREE_CLASSROOM=3");
eq(ScheduleTabs.TRANSPORT, 4, "ScheduleTabs.TRANSPORT=4");
eq(ScheduleTabs.COUNT, 5, "ScheduleTabs.COUNT=5");
eq(Routes.SCHEDULE, "schedule", "Routes.SCHEDULE");
eq(Routes.SEAT, "seat", "Routes.SEAT");
eq(Routes.LOGIN, "login", "Routes.LOGIN");
eq(ClassState.ONGOING, "ONGOING", "ClassState.ONGOING");
eq(ClassState.UPCOMING, "UPCOMING", "ClassState.UPCOMING");
eq(BlockKind.COURSE, "COURSE", "BlockKind.COURSE");
eq(BlockKind.FREE, "FREE", "BlockKind.FREE");

// ── 其余模块 ────────────────────────────────────────────────────────────────
eq(Distance.SAME, "SAME", "Distance.SAME");
eq(Distance.NEXT_DOOR, "NEXT_DOOR", "Distance.NEXT_DOOR");
eq(Distance.NEAR, "NEAR", "Distance.NEAR");
eq(Distance.FAR, "FAR", "Distance.FAR");
eq(ActivityKind.HOMEWORK, "HOMEWORK", "ActivityKind.HOMEWORK");
eq(ActivityKind.MATERIAL, "MATERIAL", "ActivityKind.MATERIAL");
eq(ActivityKind.ANNOUNCEMENT, "ANNOUNCEMENT", "ActivityKind.ANNOUNCEMENT");
eq(ActivityKind.OTHER, "OTHER", "ActivityKind.OTHER");
eq(ReminderKind.CLASS, "CLASS", "ReminderKind.CLASS");
eq(ReminderKind.DDL, "DDL", "ReminderKind.DDL");
eq(ReminderKind.SEAT_SIGN_IN, "SEAT_SIGN_IN", "ReminderKind.SEAT_SIGN_IN");
eq(ReminderKind.EXAM, "EXAM", "ReminderKind.EXAM");
eq(ReminderKind.ADJUSTMENT, "ADJUSTMENT", "ReminderKind.ADJUSTMENT");
eq(ScoreCheckCode.OK, "OK", "ScoreCheckCode.OK");
eq(ScoreCheckCode.NEED_SMS, "NEED_SMS", "ScoreCheckCode.NEED_SMS");
eq(ScoreCheckCode.TIMEOUT, "TIMEOUT", "ScoreCheckCode.TIMEOUT");
eq(ScoreCheckCode.AUTH_FAILED, "AUTH_FAILED", "ScoreCheckCode.AUTH_FAILED");
eq(ScoreCheckCode.FAILED, "FAILED", "ScoreCheckCode.FAILED");
eq(ScoreCheckCode.NOT_LOGGED_IN, "NOT_LOGGED_IN", "ScoreCheckCode.NOT_LOGGED_IN");
eq(Stop.METRO, "METRO", "Stop.METRO");
eq(Stop.LIBRARY, "LIBRARY", "Stop.LIBRARY");
eq(DayType.WORKDAY, "WORKDAY", "DayType.WORKDAY");
eq(DayType.WEEKEND_HOLIDAY, "WEEKEND_HOLIDAY", "DayType.WEEKEND_HOLIDAY");
eq(Kind.IN_CLASS, "IN_CLASS", "Kind.IN_CLASS");
eq(Kind.HAS_BOOKING, "HAS_BOOKING", "Kind.HAS_BOOKING");
eq(Kind.FREE_ROOM, "FREE_ROOM", "Kind.FREE_ROOM");

console.log(`\nALL PASS  pass=${pass} fail=${fail}`);
if (fail > 0) process.exit(1);
