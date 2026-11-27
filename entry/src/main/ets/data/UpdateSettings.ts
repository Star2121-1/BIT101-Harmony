/**
 * G07-09：关于页「自动检查更新」开关持久化（对齐 Android AboutSettings.autoDetectUpgrade）。
 *
 * 默认值 true（Android AboutPage.kt:380 `collectAsState(initial = true)`；
 * 审计清单 G07-09 也要求默认开）。只读 GET /version，无下载/安装副作用。
 *
 * ⚠️ 与 SessionStore 的账号数据无关：这是非账号偏好，登出不清理（对齐主题/学期设置）。
 */

import { Prefs } from './Prefs.ts';

const KEY_AUTO_CHECK_UPDATE: string = 'about_auto_check_update_v1';
const DEFAULT_AUTO_CHECK_UPDATE: boolean = true;

/** 是否进关于页时自动检查更新。 */
export async function loadAutoCheckUpdate(): Promise<boolean> {
  return await Prefs.getBool(KEY_AUTO_CHECK_UPDATE, DEFAULT_AUTO_CHECK_UPDATE);
}

/** 保存开关（用户点 Toggle 才调）。 */
export async function saveAutoCheckUpdate(value: boolean): Promise<void> {
  await Prefs.putBool(KEY_AUTO_CHECK_UPDATE, value);
}
