/**
 * 守卫：座位授权「点一下免输密码」（2026-11-24 用户诉求）
 *
 * 判据对着语义写：
 * - 纯逻辑：只有 renewed 才继续换 seatlib JWT；其余一律交回登录页；
 * - 接线：SeatPage.authorizeSeat 在 cookie 续期失败后调 AutoReloginService.renew，
 *   renewed 后再 silentRenewJwt 一次（不把半程当成功）；
 * - 红线：renew 只出现在 authorizeSeat 内（用户点击路径），
 *   自动路径（loadSeats / confirmReserve / onAuthRetry / aboutToAppear）绝不走凭据直登。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  seatRenewAction, seatJwtStillExpiredMessage, seatNoCredentialHint,
} from '../entry/src/main/ets/corelogic/SeatAutoReloginLogic.ts';

let pass = 0;
function ok(cond, name) { assert.ok(cond, name); pass++; }
function eq(a, b, name) { assert.equal(a, b, name); pass++; }
function code(rel) { return readFileSync(new URL(rel, import.meta.url), 'utf8'); }

console.log('=== 座位授权自动重登守卫 ===');

const seat = code('../entry/src/main/ets/pages/SeatPage.ets');
const logicSrc = code('../entry/src/main/ets/corelogic/SeatAutoReloginLogic.ts');

// ── ① 纯逻辑：决策映射 ──
eq(seatRenewAction('renewed'), 'renew-jwt-and-retry', '重登成功 → 再换 seatlib JWT 重试');
eq(seatRenewAction('no_credential'), 'goto-login', '无凭据 → 跳登录页本人输');
eq(seatRenewAction('need_user'), 'goto-login', '需短信/验证码 → 停手跳登录页（不自动猜码）');
eq(seatRenewAction('bad_cred'), 'goto-login', '密码错 → 跳登录页');
eq(seatRenewAction('skipped'), 'goto-login', '节流中 → 跳登录页');
eq(seatRenewAction('failed'), 'goto-login', '其它失败 → 跳登录页');
// 反向：新增的未知 kind 也不能误判为可继续（默认 goto-login 的安全方向）
eq(seatRenewAction('unknown_future_kind'), 'goto-login', '未知结果默认交回登录页（不误判成功）');

ok(seatJwtStillExpiredMessage().includes('座位会话仍未恢复'), '二次换 JWT 失败的文案不伪装成功');
ok(seatNoCredentialHint().includes('记住密码'), '无凭据提示引导 opt-in');

// ── ② 接线：authorizeSeat 两步链 ──
const aStart = seat.indexOf('private async authorizeSeat()');
// S-02：authorizeSeat 与 loadSeats 之间新增了 afterSmsSuccess（就地码框成功续输），
// 旧锚点若截到 loadSeats 会把第 3 处 silentRenewJwt 算进来 → 显式截到 afterSmsSuccess。
const aEnd = seat.indexOf('private async afterSmsSuccess()', aStart);
const afterStart = aEnd;
const loadStart = seat.indexOf('private async loadSeats(', aStart);
ok(aStart > 0 && aEnd > aStart && loadStart > aEnd, 'authorizeSeat / afterSmsSuccess / loadSeats 方法都存在且顺序正确');
const authBody = seat.slice(aStart, aEnd);

ok(authBody.includes('CasLoginService.silentRenewJwt(ctx)'), '第一步：cookie 静默续期（无副作用）');
// F01-02 无条件存 + F01-01 seat 口径：renew 传 'seat' 模式
ok(authBody.includes("AutoReloginService.renew(ctx, 'seat')"), '第二步：cookie 失败后用凭据重登（seat 限流口径）');
ok(authBody.includes("seatRenewAction(decision.kind) === 'renew-jwt-and-retry'"), '按纯逻辑结果分派');
ok((authBody.match(/silentRenewJwt\(ctx\)/g) || []).length === 2,
  'renewed 后再 silentRenewJwt 一次（换 seatlib JWT），共两处');
ok(authBody.includes('await this.loadSeats(false)'), '成功后重试取数');
ok(authBody.includes('this.seatsErr = decision.message'), '失败显示分类文案（不吞掉 need_user 等）');
ok(authBody.includes("params: { from: 'seat' }"), '仍带 from=seat 回跳（登录成功回座位页）');

// ── ②b S-02：就地码框成功后续输（不跳登录页、不重输学号密码）──
const afterBody = seat.slice(afterStart, loadStart);
ok(afterBody.includes('CasLoginService.silentRenewJwt(ctx)'), '短信成功后换 seatlib JWT');
ok(afterBody.includes('await this.loadSeats(false)'), '短信成功后重试取数');
ok(!afterBody.includes('router.pushUrl'), '短信成功路径不跳登录页');
ok(!afterBody.includes('username') && !afterBody.includes('password'), '短信成功路径不重输学号密码');

// ── ③ 红线：renew 只在用户点击授权路径，自动路径绝不走凭据直登 ──
const renewCalls = (seat.match(/AutoReloginService\.renew\(/g) || []).length;
eq(renewCalls, 1, '全页 AutoReloginService.renew 恰好 1 处（只在 authorizeSeat）');
ok(seat.indexOf('AutoReloginService.renew(') >= aStart && seat.indexOf('AutoReloginService.renew(') < aEnd,
  'renew 调用点落在 authorizeSeat 内');

// 自动路径方法体一律不含凭据重登 / 账密直登
const autoMethods = ['aboutToAppear(): void', 'private onAuthRetry(): void',
  'private async loadSeats(', 'private async confirmReserve', 'private async confirmCancel('];
for (const mth of autoMethods) {
  const i = seat.indexOf(mth);
  ok(i >= 0, '找到自动路径方法 ' + mth);
  const nxt = seat.indexOf('\n  }', i);
  const body = seat.slice(i, nxt > 0 ? nxt : i + 1200);
  ok(!body.includes('AutoReloginService.renew(') && !body.includes('loginWithCredentials'),
    mth + ' 内无凭据重登/账密直登（自动路径不发短信）');
}

// 导入与纯逻辑文件无 @kit（离线可跑）
ok(!logicSrc.includes('@kit.'), '纯逻辑不 import @kit');
ok(seat.includes("from '../service/AutoReloginService.ts'"), '页面导入了 AutoReloginService');

console.log('ALL PASS pass=' + pass + ' fail=0');
