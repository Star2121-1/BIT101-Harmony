/**
 * 登录态持久化（对照 Android SeatApi.token 的持久化职责）。
 *
 * 铁律 0.5（一个状态多个写入者 ⇒ 改派生）：
 * **不存 isLoggedIn 布尔**。登录态一律由 `hasToken()` / `hasSchoolSession()` 现算，
 * 否则「写 JWT 的人」和「写 flag 的人」一多就会出现「明明登录了却显示未登录」。
 *
 * ⚠️ 这里存的是 seatlib JWT（等价 Android 的 bearer token）。
 * 明文落应用沙箱 preferences —— 与 Android 现状一致；详见 Prefs.ts 头注释的取舍说明。
 */

import { Prefs } from './Prefs.ts';
import { SchoolCookieStore } from './SchoolCookieStore.ts';
import { EclassCookieStore } from './EclassCookieStore.ts';
import { LibCookieStore } from './LibCookieStore.ts';
import { CardCookieStore } from './CardCookieStore.ts';
import { CampusCardStore } from './CampusCardStore.ts';
import { CampusNetTrafficStore } from './CampusNetTrafficStore.ts';
import { info, mask, warn } from '../core/log/BitLog.ts';

const KEY_JWT: string = 'seatlib_jwt_v1';
const KEY_SAVED_AT: string = 'seatlib_jwt_saved_at';
const KEY_STUDENT_ID: string = 'login_student_id';
const KEY_DISPLAY_NAME: string = 'login_display_name';

/** 一个登录态快照（界面用）。 */
export interface SessionSnapshot {
  hasToken: boolean;
  hasSchoolCookies: boolean;
  studentId: string;
  displayName: string;
  savedAtMs: number;
}

export class SessionStore {
  /** 保存 JWT（登录成功调一次）。 */
  static async saveToken(jwt: string, studentId: string, displayName: string): Promise<void> {
    await Prefs.putString(KEY_JWT, jwt);
    await Prefs.putString(KEY_SAVED_AT, String(Date.now()));
    await Prefs.putString(KEY_STUDENT_ID, studentId);
    await Prefs.putString(KEY_DISPLAY_NAME, displayName);
    info('SessionStore saved token=' + mask(jwt) + ' studentId=' + mask(studentId));
  }

  static async getToken(): Promise<string> {
    return await Prefs.getString(KEY_JWT, '');
  }

  static async hasToken(): Promise<boolean> {
    const t: string = await SessionStore.getToken();
    return t.length > 0;
  }

  static async getStudentId(): Promise<string> {
    return await Prefs.getString(KEY_STUDENT_ID, '');
  }

  static async getDisplayName(): Promise<string> {
    return await Prefs.getString(KEY_DISPLAY_NAME, '');
  }

  /** 快照（界面初次渲染用；不触发网络）。 */
  static async snapshot(): Promise<SessionSnapshot> {
    const token: string = await SessionStore.getToken();
    const savedAt: string = await Prefs.getString(KEY_SAVED_AT, '0');
    const savedAtNum: number = parseInt(savedAt, 10);
    return {
      hasToken: token.length > 0,
      hasSchoolCookies: await SchoolCookieStore.hasSession(),
      studentId: await SessionStore.getStudentId(),
      displayName: await SessionStore.getDisplayName(),
      savedAtMs: isNaN(savedAtNum) ? 0 : savedAtNum
    };
  }

  /** 全清（退出登录 / 会话判定失效时调）。 */
  static async clear(): Promise<void> {
    await Prefs.remove(KEY_JWT);
    await Prefs.remove(KEY_SAVED_AT);
    await Prefs.remove(KEY_STUDENT_ID);
    await Prefs.remove(KEY_DISPLAY_NAME);
    await SchoolCookieStore.clear();
    info('SessionStore cleared (token + cookies)');
  }

  /** 只清 token（教务 cookie 还活着时，不需要连教务会话一起踢）。 */
  static async clearToken(): Promise<void> {
    await Prefs.remove(KEY_JWT);
    warn('SessionStore token cleared (cookies kept)');
  }

  /**
   * 退出登录的唯一入口（#150）：清掉所有会话与跨账号残留数据。
   *
   * 为什么收拢到这里：以前这些 clear 逐条散在 SettingsPage.doLogout 里，
   * 将来新增一个按账号存储的 store 很容易忘记加进去 —— 表现为"登出了但换账号还看到旧数据"。
   * 现在新增 store 只需在这里加一行，页面不用改。
   *
   * ⚠️ 边界：
   * - **不清课表缓存**（TimeTableStore/CourseCache）——登出后仍可离线看课表，这是产品决定。
   * - 不碰 TermStore/主题/通知设置等非账号数据。
   * - CardLoginPage/EclassLoginPage 里"重新登录前清旧会话"是另一个语义（只清单个子系统），
   *   不走这里，别混淆。
   */
  static async logoutAll(): Promise<void> {
    // ① JWT + 教务会话（clear() 内部已含 SchoolCookieStore.clear()）
    await SessionStore.clear();
    // ② 三个 Web 子系统会话（各清 Prefs + rcp 罐 + Web cookie 存储）
    await EclassCookieStore.clear();
    await LibCookieStore.clear();
    await CardCookieStore.clear();
    // ③ 跨账号残留的展示数据（余额趋势 / 流量历史）
    await CampusCardStore.clear();
    await CampusNetTrafficStore.clear();
    info('SessionStore.logoutAll done (all sessions + per-account data cleared, course cache kept)');
  }
}
