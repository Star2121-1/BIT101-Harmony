/**
 * cookie 罐 id 的唯一来源。
 *
 * 为什么单独一个文件：这些 id 原本写在三个 service 里（`CasLoginService` 两个、`SchoolService` 一个），
 * 登出时要**三个都清**，但登出代码在 data 层，看不到 service 里那些 private 常量
 * ⇒ 很容易漏清一个，表现是「显示已登出、实际会话还能用」（2026-10-20 真机验出过一次）。
 *
 * ⚠️ `CookieRepository.create(id)` 的 id 只允许**字母 + 下划线**（带连字符报 1007900401）。
 */

/** 登录页 / 风控 / POST / 教务授权链（CAS SESSION 在这里） */
export const JAR_LOGIN: string = 'bit_login';

/** phpCAS 票据链（与登录罐隔离，对照 Android IsolatedCookieJar） */
export const JAR_CAS: string = 'bit_cas';

/** 教务应用会话（jxzxehall / jwapp） */
export const JAR_SCHOOL: string = 'bit_school';

/** 登出时要清的全部罐。 */
export const ALL_JARS: string[] = [JAR_LOGIN, JAR_CAS, JAR_SCHOOL];
