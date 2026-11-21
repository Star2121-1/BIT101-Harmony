// 守卫：座位授权死循环修复（对齐 BIT101-S 授权闭环）——
// ① 授权跳登录带 from=seat，登录成功回座位页而非课表 + 写重试计数
// ② SeatPage 订阅重试计数，回跳后自动 loadSeats(false) 重试
// ③ 预约遇 token 失效先静默续期再重放同一意图（红线：自动路径不发短信/不自动预约）
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const code = (p) => readFileSync(join(root, p), 'utf8');
const seat = code('entry/src/main/ets/pages/SeatPage.ets');
const login = code('entry/src/main/ets/pages/LoginPage.ets');
const theme = code('entry/src/main/ets/data/ThemeStore.ts');

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; };

console.log('=== 座位授权死循环修复守卫 ===');

// ── ① 来源契约 ──
ok(seat.includes("url: 'pages/LoginPage', params: { from: 'seat' }"), '授权跳登录带 from=seat 来源参数');
ok(login.includes("params['from'] === 'seat'"), 'LoginPage 读来源参数');
ok(login.includes('this.fromSeat'), 'LoginPage 维护 fromSeat 状态');

// 登录成功回跳：from=seat → back + 写计数；否则 replaceUrl Index
const finish = login.slice(login.indexOf('private finishLogin'), login.indexOf('private finishLogin') + 700);
ok(finish.includes('router.back()'), '座位来源登录成功 router.back() 回座位页');
ok(finish.includes('STORAGE_SEAT_RETRY'), '回跳前写 seat_auth_retry 计数');
ok(finish.includes("router.replaceUrl({ url: 'pages/Index' })"), '非座位来源仍回 Index 课表');
// 两个成功分支都走 finishLogin，不再有裸 replaceUrl Index
const loginReplaceCount = (login.match(/router\.replaceUrl\(\{ url: 'pages\/Index' \}\)/g) || []).length;
ok(loginReplaceCount === 1, 'LoginPage 仅 finishLogin 内一处回 Index（当前=' + loginReplaceCount + '）');
ok((login.match(/this\.finishLogin\(/g) || []).length >= 2, '密码 + 短信两分支都调 finishLogin');

// ── ② SeatPage 自动重试 ──
ok(theme.includes("STORAGE_SEAT_RETRY"), 'ThemeStore 定义 seat_auth_retry 键');
ok(seat.includes("@StorageLink(STORAGE_SEAT_RETRY) @Watch('onAuthRetry')"), 'SeatPage 订阅重试计数');
ok(seat.includes('private onAuthRetry(): void'), '有 onAuthRetry 回调');
const retry = seat.slice(seat.indexOf('private onAuthRetry'), seat.indexOf('private onAuthRetry') + 500);
ok(retry.includes('this.selArea.length === 0'), '无选中区域时不重试（避免误触发）');
ok(retry.includes('this.loadSeats(false)'), '重试走 loadSeats(false)（不再二次续期换票）');

// ── ③ 预约续期重放（红线） ──
const confirm = seat.slice(seat.indexOf('private async confirmReserve'), seat.indexOf('private async confirmReserve') + 1200);
ok(confirm.includes('silentRenewJwt(ctx)'), '预约失效时先静默续期');
ok(confirm.includes("indexOf('登录已失效')"), '仅在业务判失效时才重放');
ok(confirm.includes('res = await this.svc.confirmSeat'), '重放同一次 confirm（同一 sid/segment 意图）');
// 红线：静默续期不许发短信/不许用凭据密码直登（这些只能走用户点击的授权页）
ok(!confirm.includes('loginWithCredentials'), '预约续期不碰账密直登（不发短信/不撞风控）');
ok(!confirm.includes('sendSms'), '预约续期不发短信');

// ── ④ 时段参数根因修复（2026-11-21 evidence/seat-unauth-rootcause-20261121.md）──
// 空 segment → HTTP 500 被误判"未授权"；必须按区域 id 拉真实时段再查/约。
const load = seat.slice(seat.indexOf('private async loadSeats'), seat.indexOf('private async loadSeats') + 1600);
ok(load.includes('fetchSeatDates(ctx, user.jwt, this.selArea)'), 'loadSeats 先按区域 id 拉真实时段(build_id)');
ok(load.includes('resolveSeatSegment(datesRes.dates, day)'), 'loadSeats 用 resolveSeatSegment 解析时段');
ok(load.includes('this.segParams.segment, day, this.segParams.startTime'), 'fetchSeats 用真实时段/起讫参数（不再写死空串）');
ok(!load.includes("fetchSeats(ctx, user.jwt, this.selArea, '', day"), 'loadSeats 不再传空 segment（500 根因）');
ok(confirm.includes("confirmSeat(ctx, user.jwt, sid, this.segParams.segment)"), 'confirm 用与查询一致的真实 segment');

// ── ⑤ 签到提示文案（契约 §4：当日 60 分钟 / 次日 9:00）──
ok(seat.includes("this.reserveResult = '预约成功！' + signInHintFor(this.queryDay, SeatTreeService.today())"),
  '预约成功提示带准确签到文案（60分钟/次日9点）');
ok(seat.includes("Text('确认预约该座位？' + signInHintFor(this.queryDay, SeatTreeService.today()))"),
  '确认弹窗带准确签到文案');
ok(!seat.includes("Text('确认预约该座位？预约后请在签到截止前刷卡"), '确认弹窗不再用笼统的"签到截止前"文案');

console.log(`ALL PASS ${pass} assertions`);
