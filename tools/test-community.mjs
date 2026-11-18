/**
 * 话廊列表解析纯逻辑单测。
 * 判据对着真机契约（Android GetPostersDataModel，snake_case）：
 * - 数字字段（id/commentNum/likeNum）可能是 number 或字符串，都要归一成 number；
 * - 坏条目逐条丢，不让一条脏数据毁整页；
 * - 匿名帖不暴露用户名（由 posterSubtitle 保证）；
 * - 搜索多词与关系、空查询返回全部。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parsePosters, posterSubtitle, searchPosts, parseReportTypes
} from '../entry/src/main/ets/corelogic/CommunityLogic.ts';

let pass = 0;
function ok(cond, name) { assert.ok(cond, name); pass++; }
function eq(a, b, name) { assert.equal(a, b, name); pass++; }
function code(rel) { return readFileSync(new URL(rel, import.meta.url), 'utf8'); }
function has(s, n) { return s.indexOf(n) >= 0; }

console.log('\n=== 话廊列表解析 ===');

const sample = JSON.stringify([
  {
    id: 101, title: '算法题讨论', text: '动态规划的状态转移', commentNum: 5, likeNum: 12,
    createTime: '2026-11-18 10:30:00', anonymous: false, tags: ['算法', 'ACM'],
    images: ['x', 'y'], user: { id: 1, nickname: '张三' }
  },
  {
    id: 102, title: '', text: '求助', commentNum: '3', likeNum: '0',
    createTime: '2026-11-17', anonymous: true, tags: [], images: [], user: { id: 2, username: 'lisi' }
  }
]);

// ── 正常解析 ──
{
  const posts = parsePosters(sample);
  eq(posts.length, 2, '两条都解析出来');
  eq(posts[0].id, 101, 'id 数字保持');
  eq(posts[0].author.name, '张三', '作者昵称');
  eq(posts[0].commentCount, 5, '评论数');
  eq(posts[0].tags.length, 2, '标签两个');
  eq(posts[0].imageCount, 2, '图片数');
  eq(posts[1].commentCount, 3, '字符串评论数转数字');
  eq(posts[1].author.name, 'lisi', '无 nickname 回落 username');
}

// ── 匿名不暴露用户名 ──
{
  const posts = parsePosters(sample);
  ok(has(posterSubtitle(posts[0]), '张三'), '非匿名显示作者名');
  ok(!has(posterSubtitle(posts[1]), 'lisi'), '匿名副标题不泄露用户名');
  ok(has(posterSubtitle(posts[1]), '匿名'), '匿名显示匿名用户');
}

// ── 坏数据逐条丢 ──
{
  const dirty = JSON.stringify([
    { id: 0, title: 'bad' },   // 无有效 id，丢
    null,                       // 丢
    { id: 9, title: 'ok', text: 'x' }
  ]);
  const posts = parsePosters(dirty);
  eq(posts.length, 1, '坏条目被丢，好条目保留');
  eq(posts[0].id, 9, '保留的是好条目');
}

// ── 非数组/坏 JSON 不崩 ──
{
  eq(parsePosters('{}').length, 0, '非数组返回空');
  eq(parsePosters('not json').length, 0, '坏 JSON 返回空');
  eq(parsePosters('{"msg":"请先登录awa"}').length, 0, '401 响应体不误判成帖子');
}

// ── 搜索：多词与，空查询全返 ──
{
  const posts = parsePosters(sample);
  eq(searchPosts(posts, '').length, 2, '空查询返回全部');
  eq(searchPosts(posts, '动态规划').length, 1, '正文命中');
  eq(searchPosts(posts, '算法 ACM').length, 1, '多词与关系命中同一条');
  eq(searchPosts(posts, '算法 不存在').length, 0, '一词不命中则整条排除');
}

// ── 源码栅栏 ──
{
  const svc = code('../entry/src/main/ets/service/CommunityService.ts');
  ok(has(svc, 'fake-cookie') || has(svc, 'getWithAuth'), '列表经鉴权封装（带 fake-cookie）');
  ok(has(svc, "'page=' + Math.max(0"), 'page 从 0 开始且有下限守卫');
  const idx = code('../entry/src/main/ets/pages/Index.ets');
  ok(has(idx, 'CommunityPage()'), '话廊 Tab 挂真实页面（不再是占位）');
}

console.log('\n=== 举报类型解析 ===');
{
  const t = parseReportTypes('[{"id":1,"text":"垃圾广告"},{"id":2,"text":"色情低俗"}]');
  eq(t.length, 2, '两个举报类型解析成功');
  eq(t[0].id, 1, '举报类型 id 正确');
  eq(t[1].text, '色情低俗', '举报类型文案正确');
  const t2 = parseReportTypes('[{"id":"3","text":"诈骗"},{"id":0,"text":"无效"},{"id":4}]');
  eq(t2.length, 1, '脏条目（id=0/缺 text）逐条丢弃');
  eq(t2[0].id, 3, '字符串 id 归一成数字');
  eq(parseReportTypes('[]').length, 0, '空数组 → 空');
  eq(parseReportTypes('not json').length, 0, '非 JSON → 空（不猜 typeId）');
  eq(parseReportTypes('{}').length, 0, '非数组 → 空');
}

console.log('\nALL PASS pass=' + pass + ' fail=0');
