/**
 * 社区「我的资料」解析纯逻辑单测。
 * 判据对着 Android GetUserInfoDataModel.Response 契约：
 * - user 字段正确提取；数字 number/string 都归一；
 * - snake_case 兜底；
 * - 坏 JSON / user 缺失 → empty（UI 据此隐藏，不编造数据）；
 * - 认证勾三态、加入时间文案。
 */
import assert from 'node:assert/strict';
import {
  parseUserProfile, emptyUserProfile, showVerifiedBadge, identityIsMuted, joinedText
} from '../entry/src/main/ets/corelogic/CommunityUserLogic.ts';

let pass = 0;
function ok(cond, name) { assert.ok(cond, name); pass++; }
function eq(a, b, name) { assert.equal(a, b, name); pass++; }

console.log('\n=== 社区我的资料解析 ===');

// 正常：Android 真契约形状（data 包裹 + camelCase）
const normal = JSON.stringify({
  data: {
    user: {
      id: 1120241355, nickname: '高天翔', motto: '让模型跑得更快更省',
      createTime: '2024-09-01 10:00:00',
      avatar: { url: 'https://x/big.jpg', lowUrl: 'https://x/low.jpg' },
      identity: { id: 1, color: '#FF9800', text: '学生' }
    },
    followerNum: 42, followingNum: 7, following: false, follower: true, own: true
  }
});
const p = parseUserProfile(normal);
eq(p.id, 1120241355, 'id 提取');
eq(p.nickname, '高天翔', '昵称提取');
eq(p.motto, '让模型跑得更快更省', '签名提取');
eq(p.followerNum, 42, '粉丝数');
eq(p.followingNum, 7, '关注数');
eq(p.identity.id, 1, 'identity.id');
eq(p.identity.text, '学生', 'identity.text');
eq(p.identity.color, '#FF9800', 'identity.color');
eq(p.createTime, '2024-09-01 10:00:00', '注册时间原串');
eq(p.avatarUrl, 'https://x/low.jpg', '头像 lowUrl 优先');
ok(showVerifiedBadge(p), '认证勾：id!=0 且有颜色 → 显示');
ok(!identityIsMuted(p), '认证身份称号不转灰');
eq(joinedText(p), '2024-09-01加入', '加入时间文案');

// 数字字符串归一（Android 契约数字字段可能字符串）
const numStr = JSON.stringify({
  user: { id: '123', nickname: 'x', identity: { id: '0', text: '访客', color: '' } },
  followerNum: '15', followingNum: '3'
});
const p2 = parseUserProfile(numStr);
eq(p2.id, 123, 'id 字符串归一');
eq(p2.followerNum, 15, '粉丝数字符串归一');
eq(p2.followingNum, 3, '关注数字符串归一');
ok(!showVerifiedBadge(p2), '认证勾：无颜色 → 不显示');
ok(identityIsMuted(p2), 'id==0 称号转灰');

// snake_case 兜底
const snake = JSON.stringify({
  user: { id: 9, nickname: 'snake', create_time: '2025-01-02', avatar: { low_url: 'L', url: 'U' } },
  follower_num: '8', following_num: 2
});
const p3 = parseUserProfile(snake);
eq(p3.nickname, 'snake', 'snake 昵称');
eq(p3.followerNum, 8, 'snake follower_num');
eq(p3.avatarUrl, 'L', 'snake low_url 兜底');
eq(p3.createTime, '2025-01-02', 'snake create_time');

// 头像 url 兜底（无 lowUrl）
const noLow = JSON.stringify({ user: { id: 1, nickname: 'n', avatar: { url: 'BIG' } } });
eq(parseUserProfile(noLow).avatarUrl, 'BIG', '无 lowUrl 用 url');

// 无 data 包裹（直接对象）
const direct = JSON.stringify({ user: { id: 5, nickname: 'direct' }, followerNum: 1 });
eq(parseUserProfile(direct).nickname, 'direct', '无 data 包裹也能解析');

// 降级：坏 JSON / 空 / user 缺失 / null
const cases = ['', '{bad json', 'null', '{}', JSON.stringify({ data: {} }), JSON.stringify({ user: null })];
for (const c of cases) {
  const r = parseUserProfile(c);
  eq(r.id, 0, '降级 id=0: ' + c.substring(0, 12));
  eq(r.nickname, '', '降级昵称空: ' + c.substring(0, 12));
  eq(r.followerNum, 0, '降级粉丝=0: ' + c.substring(0, 12));
}

// 脏数字 → 0，不编造
const dirty = JSON.stringify({ user: { id: 'abc', nickname: 123 }, followerNum: 'NaN', followingNum: -5 });
const pd = parseUserProfile(dirty);
eq(pd.id, 0, '脏 id → 0');
eq(pd.nickname, '', '非字符串昵称 → 空');
eq(pd.followerNum, 0, 'NaN → 0');
eq(pd.followingNum, -5, '负数保留原值（服务端语义，不臆改）');

// 加入时间边界
eq(joinedText(emptyUserProfile()), '', '空资料无加入时间');
const pShort = parseUserProfile(JSON.stringify({ user: { createTime: '2024/09/01' } }));
eq(joinedText(pShort), '', '非 YYYY-MM-DD 格式不显示');

// empty 工厂每次新对象（不共享可变引用）
const e1 = emptyUserProfile();
const e2 = emptyUserProfile();
ok(e1 !== e2 && e1.identity !== e2.identity, 'empty 工厂返回独立对象');

console.log('ALL PASS  pass=' + pass);
