// 守卫：新建预约表单纯逻辑（对齐 Android NewTaskScreen）
import assert from 'node:assert/strict';

import {
  FormMode, modeLabel, dateLabel, tomorrowOf, primaryButtonLabel, pickedSeatTitle,
  pickedSeatHint, pickButtonLabel, dateOptions, validateForm, validateMapEntry,
} from "../entry/src/main/ets/corelogic/SeatFormLogic.ts";

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; };
const eq = (a, b, m) => { assert.equal(a, b, m); pass++; };

console.log("=== 新建预约表单逻辑守卫 ===");

// ── 模式文案（对齐 Android ModeSelector）──
eq(modeLabel(FormMode.SINGLE), "单次预约", "单次模式文案");
eq(modeLabel(FormMode.MONITOR), "监控预约", "监控模式文案");
eq(modeLabel(FormMode.PREFER), "优先预约", "优先模式文案");

// ── 日期文案（对齐 Android dateLabel）──
const today = "2026-11-23";
const tomorrow = "2026-11-24";
eq(dateLabel(today, today, tomorrow), "今天", "当天显示今天");
eq(dateLabel(tomorrow, today, tomorrow), "明天", "次日显示明天");
eq(dateLabel("2026-11-25", today, tomorrow), "2026-11-25", "其它日期显示原串");
eq(dateLabel("", today, tomorrow), "", "空日期显示空串");

// ── 次日计算（跨月/跨年）──
eq(tomorrowOf("2026-11-23"), "2026-11-24", "普通次日");
eq(tomorrowOf("2026-11-30"), "2026-12-01", "跨月次日");
eq(tomorrowOf("2026-12-31"), "2027-01-01", "跨年次日");
eq(tomorrowOf("bad-date"), "bad-date", "非法日期原样返回");

// ── 主按钮文案（对齐 Android）──
eq(primaryButtonLabel(FormMode.SINGLE), "选择座位", "单次=选择座位");
eq(primaryButtonLabel(FormMode.MONITOR), "创建任务", "监控=创建任务");
eq(primaryButtonLabel(FormMode.PREFER), "创建任务", "优先=创建任务");

// ── 选座区文案 ──
eq(pickedSeatTitle(FormMode.MONITOR), "目标座位（必选）", "监控目标座位标题");
eq(pickedSeatTitle(FormMode.PREFER), "偏好座位（可选，按顺序抢）", "优先偏好座位标题");
eq(pickedSeatTitle(FormMode.SINGLE), "", "单次无选座区标题");
ok(pickedSeatHint(FormMode.MONITOR).indexOf("已被占的座位也能选") >= 0, "监控提示含关键语义");
ok(pickedSeatHint(FormMode.PREFER).indexOf("不限座位") >= 0, "优先提示含关键语义");
eq(pickButtonLabel(FormMode.MONITOR), "选择目标座位", "监控选座按钮");
eq(pickButtonLabel(FormMode.PREFER), "选择偏好座位", "优先选座按钮");

// ── 日期选项回落 ──
eq(dateOptions([], today, tomorrow).join(","), `${today},${tomorrow}`, "空可用日期回落今天明天");
eq(dateOptions([tomorrow], today, tomorrow).join(","), tomorrow, "有可用日期则用服务端的");
eq(dateOptions([today, today, tomorrow], today, tomorrow).join(","), `${today},${tomorrow}`, "去重保序");
eq(dateOptions(["", today], today, tomorrow).join(","), today, "过滤空串");

// ── 表单校验（对齐 Android 底部按钮校验）──
eq(validateForm(FormMode.SINGLE, false, 0), "请完整选择校区、楼层和区域", "未选区域报错");
eq(validateForm(FormMode.SINGLE, true, 0), null, "单次选了区域即可");
eq(validateForm(FormMode.MONITOR, true, 0), "监控预约需要先在座位图上点选目标座位", "监控未选座报错");
eq(validateForm(FormMode.MONITOR, true, 1), null, "监控选了座通过");
eq(validateForm(FormMode.PREFER, true, 0), null, "优先不选座也通过（不限座位）");
eq(validateForm(FormMode.PREFER, true, 3), null, "优先选多座通过");

// ── 进图页校验（不能拿 validateForm(MONITOR) 当前置条件，否则"进选座页要先选座"死结）──
eq(validateMapEntry(false), "请完整选择校区、楼层和区域", "进图页未选区域报错");
eq(validateMapEntry(true), null, "选了区域就能进图页（监控/优先在图页里选座）");

console.log(`ALL PASS ${pass} assertions`);
