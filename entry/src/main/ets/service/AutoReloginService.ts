/**
 * 会话失效时的自动重登编排（对齐 Android `DefaultLoginRepo.checkLogin` + `doOperationRequiresLogin`）。
 *
 * ## 触发条件（铁律 0.6：对外副作用的自动路径必须收窄）
 * 只有**取数已经确认失效**（被判回 CAS / 302 / uid 空 / 教务登录页）时才由调用方触发。
 * 不做「定时探测」「启动就重登」——那会凭空消耗 CAS 额度、撞学校风控。
 *
 * ## 红线
 * - **必须用户 opt-in**：`AutoLoginCredentialStore` 没凭据 ⇒ 直接 `no_credential`，不猜密码；
 * - 短信/图形验证码 ⇒ `need_user`，停手交回登录页，绝不自动猜码；
 * - 密码错误 ⇒ `bad_cred`，清掉存的凭据（下次该走手动），避免反复撞风控；
 * - 节流见 `AutoReloginLogic`（10 分钟闸门 + 连续失败冻结 8 小时）；
 * - 进程级单例去重：多个子系统同时失效只发一次 CAS 登录（去重是「同一时刻」，不跨重启）；
 * - 重登成功只返回 `renewed`，**不碰业务数据**，调用方必须重试原请求再判一次结果。
 *
 * ⚠️ 凭据只在 `cred.password` 里活到 `CasLoginService.login` 返回；不打日志、不进 steps。
 */

import { Context } from '@kit.AbilityKit';
import { CasLoginService, LoginOutcome } from './CasLoginService.ts';
import { AutoLoginCredentialStore } from '../data/AutoLoginCredentialStore.ts';
import { RenewThrottleStore } from '../data/RenewThrottleStore.ts';
import {
  RenewDecision, RenewThrottle, RenewMode, canAttempt, skipReason, nextThrottle,
  classifyCasStatus, decision, messageFor
} from '../corelogic/AutoReloginLogic.ts';
import { info, warn } from '../core/log/BitLog.ts';

/** 进程内去重：同一时刻多个调用方只发一次登录。Promise 结束即清空。 */
let inFlight: Promise<RenewDecision> | null = null;

export class AutoReloginService {
  /**
   * 尝试静默续期一次。调用方在「确认会话失效」后调用；返回分类结果。
   * 无论哪种结果都不抛异常（失效路径不该把取数页搞崩）。
   */
  static async renew(context: Context, mode: RenewMode = 'identity'): Promise<RenewDecision> {
    if (inFlight !== null) {
      info('autorenew dedup: join in-flight');
      return await inFlight;
    }
    const p: Promise<RenewDecision> = AutoReloginService.doRenew(context, mode);
    inFlight = p;
    try {
      return await p;
    } finally {
      inFlight = null;
    }
  }

  private static async doRenew(context: Context, mode: RenewMode): Promise<RenewDecision> {
    try {
      const cred = await AutoLoginCredentialStore.load();
      const throttle: RenewThrottle = await RenewThrottleStore.load();
      const nowMs: number = Date.now();

      if (!canAttempt(throttle, cred !== null, nowMs)) {
        const reason: string = skipReason(throttle, cred !== null, nowMs);
        info('autorenew skip: ' + reason);
        return decision('skipped', reason);
      }

      // cred 非 null 已由 canAttempt 保证
      const username: string = cred!.username;
      const password: string = cred!.password;
      info('autorenew attempt (opt-in creds present)');

      const out: LoginOutcome = await CasLoginService.login(context, username, password);
      const kind = classifyCasStatus(out.status);
      // F01-01：两套限流口径（identity 24h×2^(n-1) / seat 30s-5min），
      // 服务端 Retry-After 与本地估算取较大值（解析在纯逻辑层，可单测）。
      await RenewThrottleStore.save(
        nextThrottle(throttle, kind, Date.now(), mode, out.retryAfter));

      if (kind === 'renewed') {
        info('autorenew ok');
        return decision('renewed', messageFor('renewed'));
      }
      if (kind === 'bad_cred') {
        // 密码错了：清凭据，下次必须手动登录；否则每 10 分钟再撞一次风控
        await AutoLoginCredentialStore.clear();
        warn('autorenew bad credentials, opt-in cred cleared');
        return decision('bad_cred', messageFor('bad_cred'));
      }
      warn('autorenew ' + kind + ': ' + out.message);
      return decision(kind, kind === 'need_user' ? messageFor('need_user') : messageFor(kind));
    } catch (e) {
      warn('autorenew exception: ' + JSON.stringify(e));
      return decision('failed', messageFor('failed'));
    }
  }

  /** 供测试/登出清节流状态（不清凭据，凭据由各自 store.clear 管）。 */
  static async resetThrottle(): Promise<void> {
    await RenewThrottleStore.clear();
  }
}
