// 守卫：阶段4列表 tab 纯逻辑（对齐 Android TaskListScreen / TaskListLogic / SeatRules）
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const code = (p) => readFileSync(join(root, p), 'utf8');
const seat = code('entry/src/main/ets/pages/SeatPage.ets');
const quotaStore = code('entry/src/main/ets/data/CancelQuotaStore.ts');

import {
  seatRules, RULES_DISCLAIMER, quotaSubtitle, encodeQuota, decodeQuota,
  remainingCancels, sortTasks, activeTasks, finishedTasks,
  taskStatusBadge, taskModeLabel, taskSeatLabel, taskTimeRange,
  waitedText, lastAttemptText, livenessText, updatedAgoText, signInCountdown,
} from "../entry/src/main/ets/corelogic/SeatListLogic.ts";
import { TaskStatus, TaskMode } from "../entry/src/main/ets/model/SeatTask.ts";

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; };
const eq = (a, b, m) => { assert.equal(a, b, m); pass++; };

console.log("=== 阶段4列表tab逻辑守卫 ===");

const mk = (id, status, createdAt, extra = {}) => ({
  id, mode: TaskMode.MONITOR, status, areaId: 'a1', segment: '1',
  seatNo: '001', preferredSeats: [], reserveDate: '2026-11-23',
  startTime: '08:00', endTime: '22:30', campusName: '', floorName: '', areaName: '',
  message: '', createdAt, attempts: 0, lastAttemptAt: 0, foundSeatId: '', foundSeatNo: '',
  ...extra,
});

// ── 规则弹窗内容 ──
const rules = seatRules();
eq(rules.length, 6, '规则要点 6 条（对齐 Android SeatRules.all）');
eq(rules[0].title, '可预约时间', '首条规则标题');
ok(rules.some(r => r.title === '签到' && r.body.includes('60 分钟')), '签到含 60 分钟');
ok(rules.some(r => r.title === '违约' && r.body.includes('5 次')), '违约含累计 5 次');
ok(RULES_DISCLAIMER.includes('以图书馆最新公告为准'), '规则免责声明');
ok(seatRules()[0] !== rules[0], 'seatRules 每次返回新数组（防 UI 缓存脏数据）');

// ── 取消额度 ──
eq(quotaSubtitle(2, 2), '每天最多可取消 2 次 · 今天还剩 2 次', '额度副标题');
eq(quotaSubtitle(0, 2), '每天最多可取消 2 次 · 今天还剩 0 次', '额度用完');
eq(encodeQuota('2026-11-23', 1), '2026-11-23|1', '配额存储串');
eq(decodeQuota('2026-11-23|1', '2026-11-23').used, 1, '解析配额');
eq(decodeQuota('bad', '2026-11-24').day, '2026-11-24', '坏串回落今天');
eq(decodeQuota('2026-11-23|x', '2026-11-24').used, 0, '非数字用量回落 0');
eq(decodeQuota('2026-11-23|-3', '2026-11-24').used, 0, '负数用量回落 0');
eq(remainingCancels('2026-11-23', 1, '2026-11-23', 2), 1, '当天用 1 次剩 1 次');
eq(remainingCancels('2026-11-22', 2, '2026-11-23', 2), 2, '跨天重置额度');
eq(remainingCancels('', 1, '2026-11-23', 2), 2, '空日期回落满额度');
eq(remainingCancels('2026-11-23', 9, '2026-11-23', 2), 0, '不出现负额度');

// ── 任务排序 / 分组 ──
const tasks = [
  mk('old-success', TaskStatus.SUCCESS, 1000),
  mk('running', TaskStatus.RUNNING, 2000),
  mk('new-failed', TaskStatus.FAILED, 3000),
  mk('idle', TaskStatus.IDLE, 500),
];
eq(sortTasks(tasks).map(t => t.id).join(','), 'running,idle,new-failed,old-success',
  '进行中浮前、组内按创建时间倒序');
eq(tasks[0].id, 'old-success', 'sortTasks 不改入参');
eq(activeTasks(tasks).map(t => t.id).join(','), 'running,idle', '活跃任务');
eq(activeTasks(tasks).some(t => t.status === TaskStatus.FOUND), false, '无 FOUND 样例时列表为空');
eq(finishedTasks(tasks).map(t => t.id).join(','), 'new-failed,old-success', '终态任务');
eq(activeTasks([mk('f', TaskStatus.FOUND, 1)]).length, 1, 'FOUND 仍在等用户确认，算活跃');

// ── 任务卡文案 ──
eq(taskStatusBadge(TaskStatus.IDLE), '等待中', 'IDLE 徽章');
eq(taskStatusBadge(TaskStatus.RUNNING), '运行中', 'RUNNING 徽章');
eq(taskStatusBadge(TaskStatus.FOUND), '发现空位', 'FOUND 徽章');
eq(taskStatusBadge(TaskStatus.CANCELLED), '已取消', '终态徽章');
eq(taskModeLabel(mk('x', TaskStatus.IDLE, 1)), '监控', '监控模式标签');
eq(taskModeLabel(mk('x', TaskStatus.IDLE, 1, { mode: TaskMode.PREFER })), '优先·不限', '优先未指定');
eq(taskModeLabel(mk('x', TaskStatus.IDLE, 1, { mode: TaskMode.PREFER, preferredSeats: ['001'] })),
  '优先·指定', '优先已指定');
eq(taskSeatLabel(mk('x', TaskStatus.IDLE, 1, { preferredSeats: ['003', '001'] })), '003,001',
  '偏好清单保序');
eq(taskSeatLabel(mk('x', TaskStatus.IDLE, 1)), '001', '回落目标座位');
eq(taskSeatLabel(mk('x', TaskStatus.IDLE, 1, { seatNo: '' })), '', '都空返回空串');
eq(taskTimeRange(mk('x', TaskStatus.IDLE, 1)), '08:00 - 22:30', '时段文案');
eq(taskTimeRange(mk('x', TaskStatus.IDLE, 1, { startTime: '', endTime: '' })), '-', '时段缺失显示横线');

// ── 相对时间文案 ──
const now = 1_000_000_000;
eq(waitedText(0, now), null, '老数据不算等待时长');
eq(waitedText(now - 30_000, now), '刚刚开始', '不到 1 分钟');
eq(waitedText(now - 5 * 60_000, now), '已等待 5 分钟', '分钟级');
eq(waitedText(now - 65 * 60_000, now), '已等待 1 小时 5 分钟', '小时级');
eq(lastAttemptText(0, now), null, '没尝试过返回 null');
eq(lastAttemptText(now - 30_000, now), '最近尝试：30 秒前', '秒级');
eq(lastAttemptText(now - 120_000, now), '最近尝试：2 分钟前', '分钟级');
eq(livenessText(0, 0, 0, now), '尝试 0 次 · 尚未尝试', '老数据仍显示尝试次数与未尝试异常');
eq(livenessText(now - 60_000, 3, now - 10_000, now),
  '已等待 1 分钟 · 尝试 3 次 · 最近尝试：10 秒前', '存活信息行完整');
eq(updatedAgoText(0, now), null, '未刷新过不显示更新时间');
eq(updatedAgoText(now - 5_000, now), '刚刚更新', '刚刷新');
eq(updatedAgoText(now - 90_000, now), '1 分钟前更新', '分钟前');
eq(signInCountdown(now + 5 * 60_000, now).text, '还剩 5 分钟', '倒计时');
eq(signInCountdown(now - 1, now).expired, true, '已超时明确标记');
eq(signInCountdown(now + 20_000, now).text, '还剩不到 1 分钟', '不足 1 分钟');

// ── 页面接线栅栏 ──
ok(seat.includes('Refresh({ refreshing: this.refreshing })') && seat.includes('.onRefreshing('),
  '列表 tab 有下拉刷新（对齐 Android PullToRefreshContainer）');
const rf = seat.indexOf('.onRefreshing(');
ok(rf > 0 && seat.slice(rf, rf + 220).includes('.layoutWeight(1)'),
  'onRefreshing 紧邻 layoutWeight 之前（test-uiconventions 规则 1）');
const rulesIdx = seat.indexOf("Text('查看座位预约规则')");
const rulesBlock = seat.slice(rulesIdx, rulesIdx + 500);
ok(seat.includes('this.rulesDialog()') && seat.includes('RULES_DISCLAIMER')
  && rulesBlock.includes('this.showRules = true') && !rulesBlock.includes('WebShellPage'),
  '规则改成本地要点弹窗，不再跳网页（研讨间的网页入口保留，不含在此守卫内）');
ok(seat.includes('quotaSubtitle(this.remainingCancelsLeft') && seat.includes('CancelQuotaStore.markUsed'),
  '额度明细上屏 + 取消成功后本地记账');
ok(seat.includes('activeTasks(this.tasks)') && seat.includes('finishedTasks(this.tasks)')
  && seat.includes('this.showFinished'), '任务区进行中常显/终态可展开');
ok(seat.includes('livenessText(t.createdAt'), '任务卡显示存活信息（唯一"后台还活着"证据）');
ok(seat.includes('getTaskRepository().init().then'),
  '列表 tab 冷启动先 init 仓库再同步（否则重启后持久化任务看不见）');
ok(quotaStore.includes('encodeQuota') && quotaStore.includes('decodeQuota'),
  '额度存储用可解析串（ArkTS 禁动态对象）');

console.log(`ALL PASS pass=${pass} fail=0`);
