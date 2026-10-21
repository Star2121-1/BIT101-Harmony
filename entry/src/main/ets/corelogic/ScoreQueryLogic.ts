/**
 * 成绩查询（BIT101 异步挑战流程）的**纯逻辑**（M7-3 / M10-2 共用）：
 * 轮询终止条件 + 检查限频。
 *
 * 1:1 移植自 Android `data/score/ScoreQueryLogic.kt`。放在纯逻辑层而非取数管道，
 * 是为了能单测——这套「起挑战 → 轮询 → 取数」流程没法和真实服务端对敲地测。
 */

/** 教务服务标识：挑战的 `readyServices` 里出现它才可取数。 */
export const SERVICE_JWB: string = 'jwb';

/** 轮询间隔（网页版是 350ms，这里给宽一点）。 */
export const POLL_INTERVAL_MS: number = 400;

/** 轮询次数上限（25 × 400ms ≈ 10s，超时就算这次失败）。 */
export const POLL_MAX_ATTEMPTS: number = 25;

/**
 * 两次成绩检查的最小间隔（12 小时）。
 *
 * ⚠️ 这条**必须有**：新流程每次检查都要用学号密码走一遍学校统一身份认证，
 * 而检查的触发点是「App 启动 + 每日任务」——不限频就是每次开 App 都登录一次，
 * 直接撞学校风控（2026-09-26 实测：短时间内多次登录会被要求短信二次验证）。
 */
export const CHECK_INTERVAL_MS: number = 12 * 60 * 60 * 1000;

/** 教务服务是否就绪。 */
export function isReady(readyServices: string[] | null): boolean {
  if (readyServices === null) {
    return false;
  }
  for (let i = 0; i < readyServices.length; i++) {
    if (readyServices[i] === SERVICE_JWB) {
      return true;
    }
  }
  return false;
}

/**
 * 挑战**被学校拒绝**（`status = failed`）。
 *
 * ⚠️ 与「过期/超时」分开是**必须的**：这条的典型原因是学号或密码不对
 * （2026-09-27 实测：假凭据时 `start` 直接回 `failed` + `error=用户名或密码错误`），
 * **重试永远不会成功** —— 必须让用户去改密码，而不是「稍后重试」。
 */
export function isRejected(status: string | null): boolean {
  return status === 'failed';
}

/** 挑战已过期（`expired`）—— 这次没赶上，下次还有机会。 */
export function isExpired(status: string | null): boolean {
  return status === 'expired';
}

/** 挑战已终结（再轮询也没用）。 */
export function isTerminal(status: string | null): boolean {
  return isRejected(status) || isExpired(status);
}

/**
 * 学校要求短信二次验证 —— 后台任务没有交互通道，只能放弃这一次。
 *
 * 这也是本功能当前最大的不确定性：是否触发由学校风控决定，App 侧只能兜住不崩。
 */
export function needsSms(status: string | null): boolean {
  return status === 'waiting_sms';
}

/** 距上次检查是否已够久（首次检查 lastCheck=-1 视为该查）。 */
export function shouldCheck(lastCheckMillis: number, nowMillis: number): boolean {
  return lastCheckMillis < 0 || nowMillis - lastCheckMillis >= CHECK_INTERVAL_MS;
}
