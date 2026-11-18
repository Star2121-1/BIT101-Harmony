/**
 * 话廊只读数据服务（列表 / 详情 / 评论），全部经 fake-cookie 鉴权。
 *
 * 契约来自 Android PostersApiService + GetPostersDataModel（snake_case）。
 * 401 由 CommunityAuthService.getWithAuth 静默刷新一次处理，这里不重复。
 */

import { Context } from '@kit.AbilityKit';
import { CommunityAuthService } from './CommunityAuthService.ts';
import { parsePosters, searchPosts, CommunityPost } from '../corelogic/CommunityLogic.ts';
import { info, warn } from '../core/log/BitLog.ts';

export type CommunityListKind = 'ok' | 'needLogin' | 'failed';
export interface CommunityListResult {
  kind: CommunityListKind;
  posts: CommunityPost[];
  message: string;
}

/** 四流模式：Android PostersMode 的取值（推荐/最新/最热/关注）。 */
export const COMMUNITY_MODES: string[] = ['recommend', 'latest', 'hot', 'follow'];

export class CommunityService {
  /**
   * 拉一页帖子。mode 为空用默认；page 从 0 开始；search 为空不传。
   */
  static async list(context: Context, mode: string, page: number, search: string): Promise<CommunityListResult> {
    const parts: string[] = [];
    if (mode.length > 0 && COMMUNITY_MODES.indexOf(mode) >= 0) {
      // Android 的 PostersMode 序列化值需真机核对；这里先按服务端可读的 mode 字符串传
      parts.push('mode=' + encodeURIComponent(mode));
    }
    parts.push('page=' + Math.max(0, Math.trunc(page)));
    const q: string = search.trim();
    if (q.length > 0) {
      parts.push('search=' + encodeURIComponent(q));
    }
    const path: string = '/posters' + (parts.length > 0 ? ('?' + parts.join('&')) : '');
    try {
      const res = await CommunityAuthService.getWithAuth(context, path);
      if (res.status === 401) {
        return { kind: 'needLogin', posts: [], message: '社区会话已失效，请登录' };
      }
      if (res.status < 200 || res.status >= 300) {
        warn('community list HTTP ' + res.status);
        return { kind: 'failed', posts: [], message: '社区取数失败（HTTP ' + res.status + '）' };
      }
      const posts: CommunityPost[] = parsePosters(res.body);
      const filtered: CommunityPost[] = q.length > 0 ? searchPosts(posts, q) : posts;
      info('community list ok raw=' + posts.length + ' shown=' + filtered.length + ' mode=' + mode);
      return { kind: 'ok', posts: filtered, message: '' };
    } catch (e) {
      warn('community list fail: ' + JSON.stringify(e));
      return { kind: 'failed', posts: [], message: '社区取数失败（网络或服务端）' };
    }
  }
}
