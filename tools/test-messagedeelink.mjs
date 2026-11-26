/**
 * 社区消息深链（G06-P0-3）——逐条对齐 Android MessageScreen.kt:101-114。
 * 判据：parseTarget('poster123') → id=123；'junk' → 空；FOLLOW → fromUser；脏值丢弃。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  parseTarget, messageTarget, pageOfTarget, NO_TARGET
} from '../entry/src/main/ets/corelogic/MessageDeepLink.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0;
const eq = (a, b, m) => { assert.equal(a, b, m); pass++; };
const deep = (a, b, m) => { assert.deepEqual(a, b, m); pass++; };

console.log('=== 1. parseTarget：合法 ===');
deep(parseTarget('poster123'), { kind: 'poster', id: '123' }, 'poster123 → 帖子 123');
deep(parseTarget('user456'), { kind: 'user', id: '456' }, 'user456 → 用户 456');
deep(parseTarget(' poster789 '), { kind: 'poster', id: '789' }, '带空白可解析');
deep(parseTarget('poster9007199254740991'), { kind: 'poster', id: '9007199254740991' },
  '安全整数上限仍按字符串保留');

console.log('\n=== 2. parseTarget：脏值丢弃（白名单纪律）===');
deep(parseTarget('junk'), NO_TARGET, 'junk → 空');
deep(parseTarget('posterabc'), NO_TARGET, 'poster+非数字 → 空');
deep(parseTarget('poster0'), NO_TARGET, 'poster0（0 不是合法 id）→ 空');
deep(parseTarget('poster-1'), NO_TARGET, '负数 → 空');
deep(parseTarget('poster01'), NO_TARGET, '前导 0 → 空');
deep(parseTarget('user1.5'), NO_TARGET, '小数 → 空');
deep(parseTarget(''), NO_TARGET, '空串 → 空');
deep(parseTarget(null), NO_TARGET, 'null → 空');
deep(parseTarget(undefined), NO_TARGET, 'undefined → 空');
deep(parseTarget('POSTER123'), NO_TARGET, '大小写敏感（与 Android startsWith 一致）→ 空');

console.log('\n=== 3. messageTarget：解析顺序（linkObj > obj > FOLLOW）===');
deep(messageTarget('like', 'poster11', 'user22', '33'),
  { kind: 'poster', id: '11' }, 'linkObj 优先于 obj');
deep(messageTarget('comment', null, 'user22', '33'),
  { kind: 'user', id: '22' }, 'linkObj 空 → 用 obj');
deep(messageTarget('system', 'junk', 'junk', '44'), NO_TARGET,
  '两者都脏 → 空（即便有 fromUser 也不是 FOLLOW）');
deep(messageTarget('follow', null, null, '55'),
  { kind: 'user', id: '55' }, 'FOLLOW → fromUser');
deep(messageTarget('FOLLOW', '', '', '66'),
  { kind: 'user', id: '66' }, 'FOLLOW 大写也识别');
deep(messageTarget('follow', 'junk', 'junk', 'abc'), NO_TARGET,
  'FOLLOW 但 fromUser 脏 → 空（不跳）');
deep(messageTarget('like', null, null, '77'), NO_TARGET,
  'LIKE 无 obj → 空（不能用 fromUser 兜底）');

console.log('\n=== 4. pageOfTarget：页面白名单 ===');
eq(pageOfTarget({ kind: 'poster', id: '123' }), 'pages/WebShellPage', '帖子 → Web 壳');
eq(pageOfTarget({ kind: 'user', id: '456' }), 'pages/CommunityPage', '用户 → 社区页');
eq(pageOfTarget(NO_TARGET), '', '空落点 → 不跳页面');
const pages = JSON.parse(readFileSync(join(root, 'entry/src/main/resources/base/profile/main_pages.json'), 'utf8'));
const pageList = pages.src || [];
assert.ok(pageList.includes('pages/WebShellPage'), 'WebShellPage 在 main_pages 白名单');
assert.ok(pageList.includes('pages/CommunityPage'), 'CommunityPage 在 main_pages 白名单');
pass += 2;

console.log('\n' + 'ALL PASS  pass=' + pass + ' fail=0');
process.exit(0);
