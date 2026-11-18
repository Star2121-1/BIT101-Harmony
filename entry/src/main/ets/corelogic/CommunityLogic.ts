/**
 * 话廊列表数据解析（纯逻辑，无 @kit/网络，离线单测可跑）。
 *
 * 契约（Android GetPostersDataModel.Response，实测 snake_case JSON）：
 * GET /posters?mode=&order=&page=&search= 返回数组，每项：
 *   id / title / text / commentNum / likeNum / createTime / updateTime /
 *   anonymous / public / tags / images / user{id,nickname,avatar} / claim
 * 不做 EditorJS plugins 渲染（Android 也不解析），纯文本等价。
 */

export interface CommunityAuthor {
  id: number;
  name: string;
}

export interface CommunityPost {
  id: number;
  title: string;
  text: string;
  author: CommunityAuthor;
  commentCount: number;
  likeCount: number;
  createdAt: string;
  anonymous: boolean;
  tags: string[];
  imageCount: number;
}

function num(v: Object | undefined): number {
  if (typeof v === 'number') {
    return isFinite(v) ? Math.trunc(v) : 0;
  }
  if (typeof v === 'string') {
    const n: number = Number(v.trim());
    return isFinite(n) ? Math.trunc(n) : 0;
  }
  return 0;
}

function str(v: Object | undefined): string {
  return typeof v === 'string' ? v as string : '';
}

function bool(v: Object | undefined): boolean {
  return v === true;
}

/** 列表数组 → UI 模型；坏条目逐条丢，不让一条脏数据毁整页。 */
export function parsePosters(body: string): CommunityPost[] {
  let arr: Object;
  try {
    arr = JSON.parse(body) as Object;
  } catch (e) {
    return [];
  }
  if (!Array.isArray(arr)) {
    return [];
  }
  const out: CommunityPost[] = [];
  for (const raw of arr as Array<Object>) {
    if (raw === null || typeof raw !== 'object') {
      continue;
    }
    const o: Record<string, Object> = raw as Record<string, Object>;
    const id: number = num(o['id']);
    if (id <= 0) {
      continue;
    }
    const uRaw: Object | undefined = o['user'];
    const u: Record<string, Object> = (uRaw !== null && typeof uRaw === 'object')
      ? uRaw as Record<string, Object> : {};
    const tagsRaw: Object | undefined = o['tags'];
    const tags: string[] = Array.isArray(tagsRaw)
      ? (tagsRaw as Array<Object>).filter((x) => typeof x === 'string').map((x) => x as string) : [];
    const imagesRaw: Object | undefined = o['images'];
    const imageCount: number = Array.isArray(imagesRaw) ? (imagesRaw as Array<Object>).length : 0;
    out.push({
      id: id,
      title: str(o['title']),
      text: str(o['text']),
      author: {
        id: num(u['id']),
        name: str(u['nickname']).length > 0 ? str(u['nickname']) : str(u['username'])
      },
      commentCount: num(o['commentNum']),
      likeCount: num(o['likeNum']),
      createdAt: str(o['createTime']),
      anonymous: bool(o['anonymous']),
      tags: tags,
      imageCount: imageCount
    });
  }
  return out;
}

/** 列表项摘要（卡片副标题）：作者 + 时间，匿名不暴露用户名。 */
export function posterSubtitle(p: CommunityPost): string {
  const who: string = p.anonymous ? '匿名用户' : (p.author.name.length > 0 ? p.author.name : '用户' + p.author.id);
  const when: string = p.createdAt.length > 10 ? p.createdAt.substring(0, 10) : p.createdAt;
  return when.length > 0 ? (who + ' · ' + when) : who;
}

/** 搜索：标题/正文/作者/标签，多词与关系（对齐全局搜索纪律）。空查询返回全部。 */
export function searchPosts(posts: CommunityPost[], query: string): CommunityPost[] {
  const q: string = query.trim().toLowerCase();
  if (q.length === 0) {
    return posts;
  }
  const words: string[] = q.split(/\s+/);
  return posts.filter((p) => {
    const hay: string = (p.title + ' ' + p.text + ' ' + p.author.name + ' ' + p.tags.join(' ')).toLowerCase();
    return words.every((w) => hay.indexOf(w) >= 0);
  });
}
