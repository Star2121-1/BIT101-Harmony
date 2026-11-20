/**
 * 社区「我的资料」取数服务（只读取数，对齐 Android UserViewModel.loadUser id=0）。
 *
 * 数据源：GET /user/info/0（本人），经 CommunityAuthService.getWithAuth 带 fake-cookie，
 * 401 静默刷新一次（社区鉴权唯一出口，这里不重复实现）。
 * 解析走纯逻辑 parseUserProfile，坏数据回落 empty（UI 据此隐藏，不编造）。
 */

import { Context } from '@kit.AbilityKit';
import { CommunityAuthService } from './CommunityAuthService.ts';
import {
  CommunityUserProfile, parseUserProfile, emptyUserProfile
} from '../corelogic/CommunityUserLogic.ts';
import { info, warn } from '../core/log/BitLog.ts';

export type UserProfileKind = 'ok' | 'needLogin' | 'failed';
export interface UserProfileResult {
  kind: UserProfileKind;
  profile: CommunityUserProfile;
  message: string;
}

export class CommunityUserService {
  /**
   * 取本人资料。失败一律带 empty profile（字段全空），UI 据此隐藏行，
   * 不显示假昵称/假粉丝数。
   */
  static async fetchMe(context: Context): Promise<UserProfileResult> {
    try {
      const res = await CommunityAuthService.getWithAuth(context, '/user/info/0');
      if (res.status === 401) {
        return { kind: 'needLogin', profile: emptyUserProfile(), message: '社区会话已失效，请登录' };
      }
      if (res.status < 200 || res.status >= 300) {
        warn('community user HTTP ' + res.status);
        return {
          kind: 'failed', profile: emptyUserProfile(),
          message: '社区资料取数失败（HTTP ' + res.status + '）'
        };
      }
      const profile: CommunityUserProfile = parseUserProfile(res.body);
      info('community user ok nickname=' + (profile.nickname.length > 0 ? 'yes' : 'no'));
      return { kind: 'ok', profile: profile, message: '' };
    } catch (e) {
      warn('community user fail: ' + JSON.stringify(e));
      return {
        kind: 'failed', profile: emptyUserProfile(), message: '社区资料取数失败（网络或服务端）'
      };
    }
  }
}
