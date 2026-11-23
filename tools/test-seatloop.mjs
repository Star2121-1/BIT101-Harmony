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
ok(!seat.includes("Text('确认预约该座位？预约后请在签到截止前刷卡"), '不再用笼统的"签到截止前"文案');

// ── ⑥ 底部固定预约栏（对齐 Android ReserveBottomBar）──
// 阶段2 预约 tab 改纯表单，底栏暂不调用；Builder 完整保留供阶段3独立座位图页复用
ok(seat.includes('  reserveBottomBar() {'), 'reserveBottomBar Builder 保留（阶段3复用）');
ok(seat.includes("Text(signInHintFor(this.queryDay, SeatTreeService.today()))"),
  '底部固定栏带准确签到文案（60分钟/次日9点）');
ok(seat.includes("'确认预约 ' + (this.reserveSeatNo.length > 0 ? this.reserveSeatNo : this.reserveTarget)"),
  '确认按钮带选中座位号（对齐 Android「预约 XXX」）');
// 阶段2：预约 tab 为纯表单，不再调用底栏（Builder 保留给阶段3座位图页）
// 源码里 reserveBottomBar 只出现在定义、注释、守卫说明中，不能有 this.reserveBottomBar() 调用
ok(!seat.includes('this.reserveBottomBar()'), '阶段2 预约tab不调用座位底栏（Builder 留给阶段3）');
// 铁律 0.6：点座位只选中，真预约仍只在底栏确认按钮触发
ok(seat.includes('this.requestReserve(s.id);'), '点座位行走 requestReserve（只选中，不直接预约）');
ok(!seat.includes('confirmReserve()') || seat.includes('this.confirmReserve();'), '真预约仍走用户点确认按钮');
ok(!seat.includes('reserveBlock()'), '旧的列表内确认条已移除');

// ── ⑦ 会话失效(10001)给重新授权入口（避免用户卡在死提示上）──
ok(seat.includes("this.reserveResult.indexOf('登录已失效') >= 0"), '底部栏识别会话失效态');
ok(seat.includes("this.seatAuthorizing ? '恢复中…' : '去授权'"), '底部栏失效态有去授权按钮');
ok(seat.includes("this.semErr.indexOf('登录已失效') >= 0"), '研讨间卡识别会话失效态');
ok(seat.includes("this.seatAuthorizing ? '恢复中…' : '去授权座位系统'"), '研讨间卡失效态有去授权按钮');
// 两个入口都必须复用 authorizeSeat()（跳登录带 from=seat + 回跳重试），不能新造绕过风控的路径
const authCalls = (seat.match(/this\.authorizeSeat\(\)/g) || []).length;
ok(authCalls >= 4, '失效态去授权入口复用 authorizeSeat()（门禁/底栏/研讨间/我的预约共4处）');

// ── ⑧ 我的预约置顶列表tab（对齐 Android TaskListScreen，解决"预约成功看不到结果"）──
ok(seat.includes('myReservationSection()'), '有我的预约 SectionHeader Builder');
// 我的预约 SectionHeader 必须在列表 tab 分支内、且在 renCard 之前
const listStart = seat.indexOf('            this.myReservationSection()');
const listTab = seat.slice(listStart, listStart + 300);
ok(listTab.indexOf('myReservationSection()') >= 0 && listTab.indexOf('myReservationSection()') < listTab.indexOf('this.renCard()'),
  '列表 tab 顶部先我的预约、再违约卡');
ok(!seat.includes("Text('我的预约（' + this.myCount + '）')\n              .fontSize(12).fontColor(this.tk().onSurfaceVariant).width('100%').margin({ top: 16 })"),
  '预约 tab 不再把我的预约埋在座位列表底部');
ok(seat.includes("// 对齐 Android SeatMapScreen.onNavigateToTasks()"),
  '预约成功后自动切到列表 tab（含对齐注释）');
ok(seat.includes("this.seatTab = 'list';"), '预约成功 seatTab 置 list');
// 切列表 tab 时刷新账号级数据
const listChip = seat.slice(seat.indexOf("label: '列表'"), seat.indexOf("label: '列表'") + 350);
ok(listChip.includes('this.refreshAll()'),
  '切列表 tab 调 refreshAll（含我的预约/违约/研讨间/额度，对齐 Android）');

// ── ⑨ 阶段2 预约tab = Android新建预约表单 ──
ok(seat.includes('  newTaskForm() {'), '有 newTaskForm Builder');
// book tab 分支只调用 newTaskForm（不再内嵌 184 条座位列表）
const bookStart = seat.indexOf("if (this.seatTab === 'book') {");
const bookTab = seat.slice(bookStart, bookStart + 400);
ok(bookTab.includes('this.newTaskForm()'), 'book tab 调用新建预约表单');
ok(!bookTab.includes('ForEach(this.seats'), 'book tab 不再直接渲染 184 条座位列表（阶段3独立页）');
ok(seat.includes("Text('新建预约')"), '表单有"新建预约"标题（对齐 Android）');
ok(seat.includes("Text('选择日期')"), '表单有"选择日期"区块');
ok(seat.includes('modeLabel(m)'), '表单有模式选择（单次/监控/优先）');
ok(seat.includes('primaryButtonLabel(this.formMode)'), '表单底部主按钮按模式文案');
ok(seat.includes("this.formErr = validateForm(this.formMode"), '表单提交走校验（铁律0.6）');
// 阶段3已接入独立座位图页：旧「下一阶段」占位提示必须消失，入口要真跳页。
ok(seat.includes('this.openSeatMap(this.formMode)') && seat.includes("url: 'pages/SeatMapPage'"),
  '选座入口跳独立座位图页（阶段3）');
ok(!seat.includes('选座页将在下一阶段接入'), '阶段2占位提示已移除（不再假装不能用）');
ok(seat.includes('STORAGE_SEAT_PICK_DONE') && seat.includes('onSeatPickBack'),
  '选座结果经 AppStorage 回传表单并回填');

console.log(`ALL PASS ${pass} assertions`);
