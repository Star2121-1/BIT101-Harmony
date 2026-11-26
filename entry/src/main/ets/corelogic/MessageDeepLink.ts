/**
 * 社区消息点击 → App 内落点（G06-P0-3）——1:1 照搬 Android
 * `features/message/MessageScreen.kt:101-114` 的 parseTarget / messageNavDest。
 * 纯逻辑、零依赖、可离线单测；只读不写。
 *
 * ## 解析顺序（与 Android 一致）
 * 1. `linkObj` 命中 → 用它
 * 2. `obj` 命中 → 用它
 * 3. 都不是且 type=FOLLOW → 用 `fromUser.id`
 * 4. 其余 → 空落点（只打开消息页，不乱跳）
 *
 * ⚠️ 白名单纪律（同 NotifyDeepLink）：消息字段来自服务端，形状不可信；
 * 只有 `poster<正整数>` / `user<正整数>` 两种前缀被识别，脏值一律丢弃，
 * 不把任意串当导航指令，也不 push 未注册页面。
 */

/** 消息落点（target 用白名单字符串，不用任意 URL）。 */
export interface MessageTarget {
  /** 'poster' | 'user' */
  kind: string;
  /** 正整数 id（字符串形式，避免 JS 大整数精度问题）。 */
  id: string;
}

/** 空落点。 */
export const NO_TARGET: MessageTarget = { kind: '', id: '' };

/** 合法 id：纯数字、无前导 0（除单独 0 外）、安全整数范围内。 */
function validId(s: string): boolean {
  if (!/^[0-9]+$/.test(s) || s.length === 0) {
    return false;
  }
  if (s.length > 1 && s.charAt(0) === '0') {
    return false;
  }
  const n: number = Number(s);
  return Number.isSafeInteger(n) && n > 0;
}

/**
 * 解析单个 obj 串：`poster123` → {kind:'poster', id:'123'}；
 * `junk` / `posterabc` / `poster0` / `poster-1` → 空落点。
 */
export function parseTarget(raw: string | null | undefined): MessageTarget {
  if (raw === null || raw === undefined) {
    return NO_TARGET;
  }
  const s: string = raw.trim();
  if (s.indexOf('poster') === 0) {
    const id: string = s.substring('poster'.length);
    return validId(id) ? { kind: 'poster', id: id } : NO_TARGET;
  }
  if (s.indexOf('user') === 0) {
    const id: string = s.substring('user'.length);
    return validId(id) ? { kind: 'user', id: id } : NO_TARGET;
  }
  return NO_TARGET;
}

/** FOLLOW 消息的发起人 id 也要过白名单（不能把任意串当用户页参数）。 */
function followTarget(fromUserId: string | null | undefined): MessageTarget {
  if (fromUserId === null || fromUserId === undefined) {
    return NO_TARGET;
  }
  const s: string = String(fromUserId).trim();
  return validId(s) ? { kind: 'user', id: s } : NO_TARGET;
}

/**
 * 消息 → 落点（A:messageNavDest 逐条对齐）。
 * @param type 消息 type（system/comment/like/follow）
 * @param linkObj 服务端 link_obj（优先）
 * @param obj 服务端 obj（次选）
 * @param fromUserId 发起人 id（仅 FOLLOW 兜底用）
 */
export function messageTarget(type: string, linkObj: string | null | undefined,
  obj: string | null | undefined, fromUserId: string | null | undefined): MessageTarget {
  const fromLink: MessageTarget = parseTarget(linkObj);
  if (fromLink.kind.length > 0) {
    return fromLink;
  }
  const fromObj: MessageTarget = parseTarget(obj);
  if (fromObj.kind.length > 0) {
    return fromObj;
  }
  if (type.trim().toLowerCase() === 'follow') {
    return followTarget(fromUserId);
  }
  return NO_TARGET;
}

/** 落点 → 鸿蒙页面路径（白名单，供路由层 pushUrl；不在表内一律空串）。 */
export function pageOfTarget(t: MessageTarget): string {
  if (t.kind === 'poster') {
    return 'pages/WebShellPage'; // 帖子详情走 Web 壳（与社区 H5 详情同源）
  }
  if (t.kind === 'user') {
    return 'pages/CommunityPage'; // 用户页（社区页带 fromUser 参数）
  }
  return '';
}
