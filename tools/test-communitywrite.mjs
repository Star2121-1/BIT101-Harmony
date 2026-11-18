// 话廊写操作纯逻辑测试（无网络/无凭据，全部离线）
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

let pass = 0;
function ok(cond, label) {
  assert.ok(cond, label);
  pass++;
}

const SRC = new URL('../entry/src/main/ets/corelogic/CommunityWriteLogic.ts', import.meta.url);
const { communityObj, validateComment, validateReport, validatePost, likeBody, commentBody,
  reportBody, postBody, parseLikeResponse, parsePostResponse, classifyWriteStatus } = await import(SRC.href);

// ── obj 字符串构造（对齐 Android "poster$id"/"comment$id"）──
ok(communityObj('poster', 123) === 'poster123', '帖子 obj = poster+id');
ok(communityObj('comment', 456) === 'comment456', '评论 obj = comment+id');
ok(communityObj('poster', 0) === 'poster0', 'id=0 不崩，回落 poster0');
ok(communityObj('poster', -5) === 'poster0', '负 id 归零（防注入）');
ok(communityObj('comment', 3.9) === 'comment3', '小数 id 截断');

// ── 评论文本校验 ──
ok(validateComment('') !== null, '空评论被拒');
ok(validateComment('   ') !== null, '纯空格评论被拒');
ok(validateComment('你好') === null, '正常评论通过');
ok(validateComment('x'.repeat(501)) !== null, '超 500 字被拒');
ok(validateComment('x'.repeat(500)) === null, '正好 500 字通过');

// ── 举报校验 ──
ok(validateReport('', 0) !== null, '举报类型 0 被拒');
ok(validateReport('', -1) !== null, '负举报类型被拒');
ok(validateReport('', 2) === null, '文字可空但类型合法 → 通过');
ok(validateReport('理由', 3) === null, '有文字有类型通过');
ok(validateReport('x'.repeat(501), 1) !== null, '举报说明超长被拒');

// ── 请求体 JSON ──
const lb = JSON.parse(likeBody('poster', 42));
ok(lb.obj === 'poster42', '点赞 body.obj 正确');
ok(Object.keys(lb).length === 1, '点赞 body 只有 obj 一个字段');

const cb = JSON.parse(commentBody('poster', 42, '  测试评论  ', false, 0));
ok(cb.obj === 'poster42', '评论 body.obj 正确');
ok(cb.text === '测试评论', '评论 body.text 已 trim');
ok(cb.anonymous === false, '评论 body.anonymous 传值');
ok(Array.isArray(cb.imageMids) && cb.imageMids.length === 0, '评论 imageMids 为空数组');
ok(!('replyUid' in cb), 'replyUid=0 时不带该字段');

const cb2 = JSON.parse(commentBody('comment', 9, '回复', true, 77));
ok(cb2.replyUid === 77, 'replyUid>0 时带上该字段');
ok(cb2.anonymous === true, '匿名评论传值');

const rb = JSON.parse(reportBody('comment', 88, '  广告  ', 5));
ok(rb.obj === 'comment88', '举报 body.obj 正确');
ok(rb.text === '广告', '举报 body.text 已 trim');
ok(rb.typeId === 5, '举报 body.typeId 正确');

// ── 发帖校验与请求体 ──
ok(validatePost('', '') !== null, '标题正文全空被拒');
ok(validatePost('标题', '') === null, '只有标题可发');
ok(validatePost('', '正文') === null, '只有正文可发');
ok(validatePost('x'.repeat(101), '正文') !== null, '标题超 100 被拒');
ok(validatePost('标题', 'x'.repeat(5001)) !== null, '正文超 5000 被拒');
const pb = JSON.parse(postBody('  标题  ', '  正文  ', true, false, ['tag1']));
ok(pb.title === '标题' && pb.text === '正文', '发帖标题正文已 trim');
ok(pb.anonymous === true && pb.public === false, '发帖匿名/公开传值');
ok(pb.claimId === 0, '发帖 claimId 默认 0（无声明）');
ok(pb.plugins === '[]', '发帖 plugins 默认空数组字符串');
ok(Array.isArray(pb.imageMids) && pb.imageMids.length === 0, '发帖无图 imageMids 空');
ok(JSON.stringify(pb.tags) === '["tag1"]', '发帖 tags 传值');
ok(parsePostResponse('{"id":123}') === 123, '发帖响应解析 id');
ok(parsePostResponse('{"id":"45"}') === 45, '发帖响应 id 字符串可接受');
ok(parsePostResponse('{"id":0}') === null, '发帖响应 id=0 → null');
ok(parsePostResponse('not json') === null, '发帖响应非 JSON → null');

// ── 点赞响应解析（服务端返回操作后状态，字段不认识要返回 null 不猜）──
const s1 = parseLikeResponse('{"like":true,"likeNum":10}');
ok(s1 !== null && s1.like === true && s1.likeNum === 10, '点赞响应解析 true/10');
const s2 = parseLikeResponse('{"like":false,"likeNum":"7"}');
ok(s2 !== null && s2.like === false && s2.likeNum === 7, '点赞响应 likeNum 字符串可接受');
ok(parseLikeResponse('{"like":"true","likeNum":3}') === null, 'like 非布尔 → null');
ok(parseLikeResponse('{"like":true}') === null, '缺 likeNum → null');
ok(parseLikeResponse('not json') === null, '非 JSON → null');
const s3 = parseLikeResponse('{"like":true,"likeNum":-2}');
ok(s3 !== null && s3.likeNum === 0, '负点赞数归零');

// ── HTTP 状态三态分类 ──
ok(classifyWriteStatus(200, '点赞').kind === 'ok', '200 → ok');
ok(classifyWriteStatus(204, '评论').kind === 'ok', '204 → ok');
ok(classifyWriteStatus(401, '点赞').kind === 'needLogin', '401 → needLogin');
ok(classifyWriteStatus(403, '举报').kind === 'needLogin', '403 → needLogin');
ok(classifyWriteStatus(500, '点赞').kind === 'failed', '500 → failed（不当未登录）');
ok(classifyWriteStatus(0, '评论').kind === 'failed', '0（网络错）→ failed');
ok(classifyWriteStatus(401, '点赞').message.indexOf('重新登录') >= 0, 'needLogin 文案提示重新登录');

// ── 源码栅栏：写服务不得出现在自动生命周期钩子 ──
{
  const page = readFileSync(new URL('../entry/src/main/ets/pages/CommunityPage.ets', import.meta.url), 'utf8');
  const svc = readFileSync(new URL('../entry/src/main/ets/service/CommunityWriteService.ts', import.meta.url), 'utf8');
  ok(svc.indexOf('postWithAuth') >= 0, '写服务经带鉴权的 POST 通道');
  ok(svc.indexOf('CommunityWriteService') >= 0, '写服务类存在');
  // 找 aboutToAppear / onPageShow 的函数体里有没有 .like(/.comment(/.report( 自动调用
  const autoHooks = ['aboutToAppear', 'onPageShow'];
  for (const hook of autoHooks) {
    const idx = page.indexOf(hook);
    if (idx >= 0) {
      const chunk = page.slice(idx, idx + 600);
      ok(chunk.indexOf('CommunityWriteService.like') < 0 &&
         chunk.indexOf('CommunityWriteService.comment') < 0 &&
         chunk.indexOf('CommunityWriteService.report') < 0 &&
         chunk.indexOf('CommunityWriteService.createPost') < 0,
        hook + ' 里不自动触发写操作');
    }
  }
}

console.log(`ALL PASS pass=${pass} fail=0`);
