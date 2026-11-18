/**
 * 话廊写操作服务（点赞 / 评论 / 举报）。
 *
 * ⚠️ 对外副作用红线：本服务的每个方法都必须由用户在 UI 主动点击后调用。
 * 禁止在 aboutToAppear / onPageShow / 定时器 / 任何自动路径里调用本服务。
 * 这里不缓存"我要不要写"的决定，不做重试之外的自动行为。
 *
 * 请求体构造与结果分类走 CommunityWriteLogic（离线单测覆盖）；
 * 传输与 401 刷新走 CommunityAuthService.postWithAuth。
 */

import { Context } from '@kit.AbilityKit';
import { CommunityAuthService } from './CommunityAuthService.ts';
import {
  CommunityObjectKind, CommunityWriteResult, LikeState,
  likeBody, commentBody, reportBody, postBody, parseLikeResponse, parsePostResponse,
  classifyWriteStatus, validateComment, validateReport, validatePost,
} from '../corelogic/CommunityWriteLogic.ts';
import { info, warn } from '../core/log/BitLog.ts';

export class CommunityWriteService {
  /**
   * 点赞/取消点赞（POST /reaction/like）。服务端返回操作后的状态。
   * 用户点一次 = 切一次；不在这里维护"应该赞还是取消"的意图，服务端决定。
   */
  static async like(context: Context, kind: CommunityObjectKind, id: number): Promise<{
    result: CommunityWriteResult;
    state: LikeState | null;
  }> {
    try {
      const body: string = likeBody(kind, id);
      const res = await CommunityAuthService.postWithAuth(context, '/reaction/like', body);
      const result: CommunityWriteResult = classifyWriteStatus(res.status, '点赞');
      if (result.kind !== 'ok') {
        warn('community like not ok: ' + result.message);
        return { result: result, state: null };
      }
      const state: LikeState | null = parseLikeResponse(res.body);
      if (state === null) {
        // 2xx 但响应格式不认识——如实说失败，不伪装成功
        return {
          result: { kind: 'failed', message: '点赞状态解析失败（服务端格式变化）' },
          state: null,
        };
      }
      info('community like ok obj=' + kind + id + ' like=' + state.like + ' num=' + state.likeNum);
      return { result: result, state: state };
    } catch (e) {
      warn('community like fail: ' + JSON.stringify(e));
      return { result: { kind: 'failed', message: '点赞失败（网络或服务端）' }, state: null };
    }
  }

  /** 发评论（POST /reaction/comments）。文本先本地校验，空/超长不发起请求。 */
  static async comment(context: Context, kind: CommunityObjectKind, id: number,
    text: string, anonymous: boolean, replyUid: number): Promise<CommunityWriteResult> {
    const invalid: string | null = validateComment(text);
    if (invalid !== null) {
      return { kind: 'failed', message: invalid };
    }
    try {
      const body: string = commentBody(kind, id, text, anonymous, replyUid);
      const res = await CommunityAuthService.postWithAuth(context, '/reaction/comments', body);
      const result: CommunityWriteResult = classifyWriteStatus(res.status, '评论');
      info('community comment ' + result.kind + ' obj=' + kind + id);
      return result;
    } catch (e) {
      warn('community comment fail: ' + JSON.stringify(e));
      return { kind: 'failed', message: '评论失败（网络或服务端）' };
    }
  }

  /** 发纯文字帖（POST /posters）。无图、无 H5 富文本；用户点击「发帖」后调用。 */
  static async createPost(context: Context, title: string, text: string,
    anonymous: boolean, isPublic: boolean, tags: string[]): Promise<{
    result: CommunityWriteResult;
    newId: number | null;
  }> {
    const invalid: string | null = validatePost(title, text);
    if (invalid !== null) {
      return { result: { kind: 'failed', message: invalid }, newId: null };
    }
    try {
      const body: string = postBody(title, text, anonymous, isPublic, tags);
      const res = await CommunityAuthService.postWithAuth(context, '/posters', body);
      const result: CommunityWriteResult = classifyWriteStatus(res.status, '发帖');
      if (result.kind !== 'ok') {
        warn('community post not ok: ' + result.message);
        return { result: result, newId: null };
      }
      const newId: number | null = parsePostResponse(res.body);
      if (newId === null) {
        // 2xx 但拿不到 id：发帖可能已成功，如实说明，不伪装失败也不编 id
        return {
          result: { kind: 'ok', message: '发帖已提交（未返回帖子编号）' },
          newId: null,
        };
      }
      info('community post ok id=' + newId);
      return { result: result, newId: newId };
    } catch (e) {
      warn('community post fail: ' + JSON.stringify(e));
      return { result: { kind: 'failed', message: '发帖失败（网络或服务端）' }, newId: null };
    }
  }

  /** 举报（POST /manage/reports）。类型与文字都先本地校验。 */
  static async report(context: Context, kind: CommunityObjectKind, id: number,
    text: string, typeId: number): Promise<CommunityWriteResult> {
    const invalid: string | null = validateReport(text, typeId);
    if (invalid !== null) {
      return { kind: 'failed', message: invalid };
    }
    try {
      const body: string = reportBody(kind, id, text, typeId);
      const res = await CommunityAuthService.postWithAuth(context, '/manage/reports', body);
      const result: CommunityWriteResult = classifyWriteStatus(res.status, '举报');
      info('community report ' + result.kind + ' obj=' + kind + id + ' type=' + typeId);
      return result;
    } catch (e) {
      warn('community report fail: ' + JSON.stringify(e));
      return { kind: 'failed', message: '举报失败（网络或服务端）' };
    }
  }
}
