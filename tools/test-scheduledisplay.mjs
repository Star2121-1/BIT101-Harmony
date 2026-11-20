/**
 * 课表显示开关存储单测。判据：
 * - 7 个默认值严格对齐 Android SettingDataStore.kt:85-109；
 * - 读全部走注入的 BoolReader（离线，不碰 @kit）；
 * - 键名与 Android SharedPreferences key 逐字一致（真机老用户升级后值不丢）；
 * - 源码栅栏：默认 false 的只有 showBorder（对齐原版）。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  defaultScheduleDisplay, readScheduleDisplay,
  KEY_SHOW_SATURDAY, KEY_SHOW_SUNDAY, KEY_SHOW_BORDER, KEY_SHOW_HIGHLIGHT_TODAY,
  KEY_SHOW_DIVIDER, KEY_SHOW_CURRENT_TIME, KEY_SHOW_EXAM_INFO
} from '../entry/src/main/ets/corelogic/ScheduleDisplayLogic.ts';

let pass = 0;
function ok(cond, name) { assert.ok(cond, name); pass++; }
function eq(a, b, name) { assert.equal(a, b, name); pass++; }
function code(rel) { return readFileSync(new URL(rel, import.meta.url), 'utf8'); }

console.log('\n=== 课表显示开关 ===');

const d = defaultScheduleDisplay();
eq(d.showSaturday, true, '周六默认开（Android L85=true）');
eq(d.showSunday, true, '周日默认开（Android L89=true）');
eq(d.showBorder, false, '边框默认关（Android L93=false）');
eq(d.showHighlightToday, true, '高亮今日默认开（Android L97=true）');
eq(d.showDivider, true, '分隔线默认开（Android L101=true）');
eq(d.showCurrentTime, true, '当前时间线默认开（Android L105=true）');
eq(d.showExamInfo, true, '考试信息默认开（Android L109=true）');

// 键名逐字对齐 Android SharedPreferences key
eq(KEY_SHOW_SATURDAY, 'course_schedule_show_saturday', '周六键名');
eq(KEY_SHOW_SUNDAY, 'course_schedule_show_sunday', '周日键名');
eq(KEY_SHOW_BORDER, 'course_schedule_show_border', '边框键名');
eq(KEY_SHOW_HIGHLIGHT_TODAY, 'course_schedule_show_highlight_today', '高亮今日键名');
eq(KEY_SHOW_DIVIDER, 'course_schedule_show_divider', '分隔线键名');
eq(KEY_SHOW_CURRENT_TIME, 'course_schedule_show_current_time', '当前时间键名');
eq(KEY_SHOW_EXAM_INFO, 'course_schedule_show_exam_info', '考试信息键名');

// 注入 reader：全部缺省 → 等于默认
const emptyReader = {
  getBool: async (key, fallback) => fallback
};
const viaEmpty = await readScheduleDisplay(emptyReader);
eq(viaEmpty.showBorder, false, '缺省 reader 边框=false');
eq(viaEmpty.showDivider, true, '缺省 reader 分隔线=true');
eq(Object.keys(viaEmpty).length, 7, '读全 7 个开关');

// 注入 reader：用户存的边框=true、分隔线=false 应生效，且其它键走默认
const customReader = {
  getBool: async (key, fallback) => {
    if (key === KEY_SHOW_BORDER) return true;
    if (key === KEY_SHOW_DIVIDER) return false;
    return fallback;
  }
};
const custom = await readScheduleDisplay(customReader);
eq(custom.showBorder, true, '用户开边框生效');
eq(custom.showDivider, false, '用户关分隔线生效');
eq(custom.showSaturday, true, '未存的周六仍默认 true');

// 源码栅栏：只有边框默认 false，其余 true；且课表页确实 import 了 store（防假开关）
const storeSrc = code('../entry/src/main/ets/corelogic/ScheduleDisplayLogic.ts');
ok(storeSrc.indexOf("showBorder: false") >= 0, '源码默认边框 false');
const scheduleSrc = code('../entry/src/main/ets/pages/SchedulePage.ets');
ok(scheduleSrc.indexOf('ScheduleDisplayStore') >= 0 || scheduleSrc.indexOf('loadScheduleDisplay') >= 0,
  '课表页读取显示开关（非假开关）');

console.log('ALL PASS  pass=' + pass);
