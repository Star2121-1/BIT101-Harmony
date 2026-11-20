/**
 * BIT101 社区「我的资料」解析纯逻辑（对齐 Android `GetUserInfoDataModel.Response`）。
 *
 * 数据源：GET /user/info/0（id=0 表示本人），需社区 fake-cookie。
 * 字段契约（Android api/.../http/bit101/User.kt:87-106 + common/User.kt:6-23 + Identity.kt:7-25）：
 *   { user: { id, createTime, nickname, avatar:{url,lowUrl}, motto,
 *             identity:{id,color,text} },
 *     followerNum, followingNum, following, follower, own }
 *
 * 纪律：
 * - 数字字段 number/string 都归一；snake_case 兜底；
 * - 任何字段缺失/脏值都回落空串/0，**绝不编造昵称/数字**——取不到就由 UI 隐藏该行；
 * - 纯函数，不 import @kit，可离线单测；写法与 CommunityLogic.ts 一致（字面量索引，无动态 key）。
 */

export interface CommunityIdentity {
  /** 称号 id：0 = 无认证（UI 不显示认证勾、称号文字转灰）。 */
  id: number;
  /** 称号文字（如「学生」）。 */
  text: string;
  /** 认证勾颜色（服务端下发，可能为空）。 */
  color: string;
}

export interface CommunityUserProfile {
  /** 用户数字 id（0 = 未取到）。 */
  id: number;
  nickname: string;
  motto: string;
  identity: CommunityIdentity;
  followerNum: number;
  followingNum: number;
  /** 注册时间原串（UI 格式化成「X加入」，解析不出则空串）。 */
  createTime: string;
  /** 头像 url（低清优先，对齐 Android user.avatar.lowUrl）。 */
  avatarUrl: string;
}

/** 空资料：所有字段为空/0，UI 据此隐藏，不显示假数据。 */
export function emptyUserProfile(): CommunityUserProfile {
  return {
    id: 0, nickname: '', motto: '',
    identity: { id: 0, text: '', color: '' },
    followerNum: 0, followingNum: 0, createTime: '', avatarUrl: ''
  };
}

function intOrZero(v: Object | undefined): number {
  if (typeof v === 'number') return isFinite(v as number) ? Math.trunc(v as number) : 0;
  if (typeof v === 'string') {
    const n: number = Number((v as string).trim());
    return isFinite(n) ? Math.trunc(n) : 0;
  }
  return 0;
}

function str(v: Object | undefined): string {
  return typeof v === 'string' ? (v as string).trim() : '';
}

/** 优先 camel 键，缺则 snake 键（两者都不存在返回 undefined）。 */
function pick(o: Record<string, Object>, camel: string, snake: string): Object | undefined {
  const a: Object | undefined = o[camel];
  if (a !== undefined && a !== null) return a;
  return o[snake];
}

/** 安全转 Record（primitive/null 返回空对象）。 */
function asRecord(v: Object | undefined): Record<string, Object> {
  if (v !== null && v !== undefined && typeof v === 'object') {
    return v as Record<string, Object>;
  }
  return {};
}

/**
 * 解析 /user/info/0 响应体。
 * - 顶层可能是 `data` 包裹，也可能直接是对象；
 * - user 缺失 → 返回 empty（不是抛错），让调用方走降级；
 * - 坏 JSON → empty。
 */
export function parseUserProfile(body: string): CommunityUserProfile {
  const empty: CommunityUserProfile = emptyUserProfile();
  if (body.length === 0) return empty;
  let root: Object;
  try {
    root = JSON.parse(body) as Object;
  } catch (e) {
    return empty;
  }
  let top: Record<string, Object> = asRecord(root);
  if (Object.keys(top).length === 0) return empty;
  const dataRaw: Object | undefined = top['data'];
  if (dataRaw !== undefined && dataRaw !== null && typeof dataRaw === 'object') {
    top = asRecord(dataRaw);
  }
  const u: Record<string, Object> = asRecord(top['user']);
  if (Object.keys(u).length === 0) return empty;

  const idObj: Record<string, Object> = asRecord(u['identity']);
  const identity: CommunityIdentity = {
    id: intOrZero(idObj['id']),
    text: str(idObj['text']),
    color: str(idObj['color'])
  };
  const avatar: Record<string, Object> = asRecord(u['avatar']);
  let avatarUrl: string = str(pick(avatar, 'lowUrl', 'low_url'));
  if (avatarUrl.length === 0) avatarUrl = str(avatar['url']);

  return {
    id: intOrZero(u['id']),
    nickname: str(u['nickname']),
    motto: str(u['motto']),
    identity: identity,
    followerNum: intOrZero(pick(top, 'followerNum', 'follower_num')),
    followingNum: intOrZero(pick(top, 'followingNum', 'following_num')),
    createTime: str(pick(u, 'createTime', 'create_time')),
    avatarUrl: avatarUrl
  };
}

/** 认证勾是否显示：id != 0 且服务端给了颜色（Android Avatar.kt:79-92）。 */
export function showVerifiedBadge(p: CommunityUserProfile): boolean {
  return p.id > 0 && p.identity.id !== 0 && p.identity.color.length > 0;
}

/** 身份称号文字色：id==0 转灰（由 UI 套 textPlaceholder），否则服务端色。 */
export function identityIsMuted(p: CommunityUserProfile): boolean {
  return p.identity.id === 0;
}

/** 注册时间 →「YYYY-MM-DD加入」；解析不出返回空串（UI 隐藏该行）。 */
export function joinedText(p: CommunityUserProfile): string {
  const s: string = p.createTime;
  if (s.length < 10) return '';
  const date: string = s.substring(0, 10);
  if (date.charAt(4) !== '-' || date.charAt(7) !== '-') return '';
  return date + '加入';
}
