/**
 * 话廊写操作纯逻辑（无 @kit / 无网络，离线单测可跑）。
 *
 * 契约来自 Android：
 * - DefaultReactionRepo: likePoster(id)=>like("poster"+id), likeComment(id)=>like("comment"+id)
 * - PostLikeDataModel.Body { obj }  → Response { like, likeNum }（服务端返回操作后的状态，非幂等 set）
 * - PostCommentDataModel.Body { obj, text, replyObj?, replyUid?, anonymous?, rate?, imageMids }
 * - PostReportDataModel.Body { obj, text, typeId }
 *
 * ⚠️ 红线：这里只构造请求与解析结果，不发起任何网络调用、不自动触发。
 * 真正的写请求必须由用户在 UI 主动点击后，经 CommunityWriteService 发出。
 */

/** 对象类型——poster / comment 两种可点赞、可评论、可举报的对象。 */
export type CommunityObjectKind = 'poster' | 'comment';

/**
 * 构造 reaction / report 接口用的 obj 字符串。
 * 对齐 Android DefaultReactionRepo 的 "poster$id" / "comment$id"。
 */
export function communityObj(kind: CommunityObjectKind, id: number): string {
  const safeId: number = Number.isFinite(id) && id > 0 ? Math.trunc(id) : 0;
  return kind + safeId;
}

/** 写操作结果分类——与只读层一致的三态，外加服务端业务失败。 */
export type CommunityWriteKind = 'ok' | 'needLogin' | 'failed';
export interface CommunityWriteResult {
  kind: CommunityWriteKind;
  message: string;
}

/** 点赞后的状态（服务端返回的是操作后的如实参，不是"请求设为 true"）。 */
export interface LikeState {
  like: boolean;
  likeNum: number;
}

/** 评论输入校验：返回 null 表示合法，否则返回给用户看的中文原因。 */
export function validateComment(text: string): string | null {
  const t: string = text.trim();
  if (t.length === 0) {
    return '评论内容不能为空';
  }
  if (t.length > 500) {
    return '评论最多 500 字';
  }
  return null;
}

/** 举报输入校验：文字可空（举报类型已表达意图），但不能超长。 */
export function validateReport(text: string, typeId: number): string | null {
  if (!Number.isFinite(typeId) || typeId <= 0) {
    return '请选择举报类型';
  }
  if (text.trim().length > 500) {
    return '举报说明最多 500 字';
  }
  return null;
}

/** 发帖输入校验：标题与正文至少一个非空；长度上限对齐社区常规。 */
export function validatePost(title: string, text: string): string | null {
  const t: string = title.trim();
  const x: string = text.trim();
  if (t.length === 0 && x.length === 0) {
    return '标题和正文不能都为空';
  }
  if (t.length > 100) {
    return '标题最多 100 字';
  }
  if (x.length > 5000) {
    return '正文最多 5000 字';
  }
  return null;
}

/**
 * 构造 POST /reaction/like 请求体 JSON。
 * 对齐 PostLikeDataModel.Body { obj: String }——字段序列化由服务端 snake/camel 兼容，
 * 这里按 Android data class 的字段名 obj 直出。
 */
export function likeBody(kind: CommunityObjectKind, id: number): string {
  return JSON.stringify({ obj: communityObj(kind, id) });
}

/**
 * 构造 POST /reaction/comments 请求体 JSON。
 * 对齐 PostCommentDataModel.Body，imageMids 本轮恒空（鸿蒙侧尚无图片上传）。
 * replyUid 为 0 时省略（Android 默认 null）。
 */
export function commentBody(kind: CommunityObjectKind, id: number, text: string,
  anonymous: boolean, replyUid: number): string {
  const body: Record<string, Object> = {
    obj: communityObj(kind, id),
    text: text.trim(),
    anonymous: anonymous,
    imageMids: [],
  };
  if (replyUid > 0) {
    body.replyUid = Math.trunc(replyUid);
  }
  return JSON.stringify(body);
}

/** 构造 POST /manage/reports 请求体 JSON（对齐 PostReportDataModel.Body）。 */
export function reportBody(kind: CommunityObjectKind, id: number, text: string, typeId: number): string {
  return JSON.stringify({
    obj: communityObj(kind, id),
    text: text.trim(),
    typeId: Math.trunc(typeId),
  });
}

/**
 * 构造 POST /posters 发帖请求体（对齐 PostPostersDataModel.Body + Android
 * PostEditViewModel.post 的默认值：claimId=0 / plugins="[]" / 无图 / tags 可空）。
 * 鸿蒙只发纯文字帖——图片上传（imageMids）与 H5 富文本（plugins 内容）不做，
 * plugins 按 repo 默认传 "[]"，与 Android 纯文字帖一致。
 */
export function postBody(title: string, text: string, anonymous: boolean,
  isPublic: boolean, tags: string[]): string {
  return JSON.stringify({
    title: title.trim(),
    text: text.trim(),
    anonymous: anonymous,
    public: isPublic,
    tags: tags,
    claimId: 0,
    imageMids: [],
    plugins: '[]',
  });
}

/** 解析 POST /posters 响应 → 新帖 id（PostPostersDataModel.Response { id }）。 */
export function parsePostResponse(body: string): number | null {
  try {
    const obj: Object = JSON.parse(body);
    if (obj === null || typeof obj !== 'object') {
      return null;
    }
    const v: Object | undefined = (obj as Record<string, Object>).id;
    const n: number = typeof v === 'number' ? v
      : (typeof v === 'string' ? Number(v.trim()) : NaN);
    return isFinite(n) && n > 0 ? Math.trunc(n) : null;
  } catch (e) {
    return null;
  }
}

/**
 * 解析 POST /reaction/like 响应 → 操作后的点赞状态。
 * 服务端返回 { like, likeNum }；字段缺失/类型不对时返回 null（不猜、不伪装）。
 */
export function parseLikeResponse(body: string): LikeState | null {
  try {
    const obj: Object = JSON.parse(body);
    if (obj === null || typeof obj !== 'object') {
      return null;
    }
    const rec: Record<string, Object> = obj as Record<string, Object>;
    const likeVal: Object | undefined = rec.like;
    const numVal: Object | undefined = rec.likeNum;
    if (typeof likeVal !== 'boolean') {
      return null;
    }
    const n: number = typeof numVal === 'number' ? numVal
      : (typeof numVal === 'string' ? Number(numVal.trim()) : NaN);
    if (!isFinite(n)) {
      return null;
    }
    return { like: likeVal, likeNum: Math.max(0, Math.trunc(n)) };
  } catch (e) {
    return null;
  }
}

/**
 * 写操作的 HTTP 状态 → 三态结果。
 * 401/403 = 需登录；2xx = ok；其余 = failed（含 500，不把服务端故障当未登录）。
 */
export function classifyWriteStatus(status: number, context: string): CommunityWriteResult {
  if (status === 401 || status === 403) {
    return { kind: 'needLogin', message: '社区会话已失效，请重新登录' };
  }
  if (status >= 200 && status < 300) {
    return { kind: 'ok', message: context + '成功' };
  }
  return { kind: 'failed', message: context + '失败（HTTP ' + status + '）' };
}
