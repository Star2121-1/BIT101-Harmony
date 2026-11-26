/**
 * 校园卡本机名片（F05-01）——逐条对齐 Android SavedCardLogic.kt 判据。
 *
 * 判据：
 * ① 贴卡读出身份后杀进程重进仍在（Store 读写往返）；
 * ② 换 UID 不同的卡整张替换，不拼成不存在的人；
 * ③ 确认过的学号不被后一次疑似顶替；
 * ④ 忘掉名片后空态但学号输入框内容仍在；
 * ⑤ 源码检索无 password/token/cookie 字段；
 * ⑥ sameContent 不比 savedAt（否则每敲一个字符都写盘）。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  emptyCard, mergeCard, sameContent, isBlank, cardLine
} from '../entry/src/main/ets/corelogic/SavedCardLogic.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const code = (p) => readFileSync(join(root, p), 'utf8');

let pass = 0;
const eq = (a, b, m) => { assert.equal(a, b, m); pass++; };
const deep = (a, b, m) => { assert.deepEqual(a, b, m); pass++; };
const ok = (c, m) => { assert.ok(c, m); pass++; };

console.log('=== 1. merge：换卡整张替换（防张冠李戴）===');
const oldCard = {
  name: '高天翔', studentId: '1120241355', sidConfirmed: true,
  cardNo: '2004217979', uid: '77 75 F0 7B', savedAt: 1000
};
const otherCard = {
  name: '张三', studentId: null, sidConfirmed: false,
  cardNo: '12345678', uid: 'AA BB CC DD', savedAt: 2000
};
const swapped = mergeCard(oldCard, otherCard, 2000);
eq(swapped.name, '张三', '换卡后姓名是新卡的（不拼成「高天翔+张三」）');
eq(swapped.cardNo, '12345678', '换卡后卡号是新卡的');
eq(swapped.studentId, null, '换卡后学号不继承旧卡（整张替换）');
eq(swapped.uid, 'AA BB CC DD', 'UID 更新');
eq(swapped.savedAt, 2000, '时间更新');
// 关键反例：新卡没认出姓名时，逐字段合并会错误继承旧卡姓名（张冠李戴）
const swappedNoName = mergeCard(oldCard, {
  name: null, studentId: null, sidConfirmed: false,
  cardNo: '9999', uid: '11 22 33 44', savedAt: 2000
}, 2000);
eq(swappedNoName.name, null, '换卡且新卡无姓名 ⇒ 不继承旧卡姓名（整张替换）');

console.log('\n=== 2. merge：确认学号优先 ===');
const guessed = mergeCard(oldCard, {
  name: null, studentId: '999999', sidConfirmed: false,
  cardNo: null, uid: '77 75 F0 7B', savedAt: 3000
}, 3000);
eq(guessed.studentId, '1120241355', '旧确认值不被新疑似顶替');
eq(guessed.sidConfirmed, true, '仍是确认值');
const freshConfirmed = mergeCard(oldCard, {
  name: null, studentId: '888888', sidConfirmed: true,
  cardNo: null, uid: '77 75 F0 7B', savedAt: 4000
}, 4000);
eq(freshConfirmed.studentId, '888888', '新确认值覆盖旧确认值（以最新比对为准）');
eq(freshConfirmed.name, '高天翔', '这次没认出姓名，不清掉上次认出的');
// 两侧都疑似 → 用新的
const bothGuess = mergeCard(
  { ...oldCard, studentId: '111', sidConfirmed: false },
  { name: null, studentId: '222', sidConfirmed: false, cardNo: null, uid: '77 75 F0 7B', savedAt: 0 },
  5000
);
eq(bothGuess.studentId, '222', '两侧都疑似用新的');
eq(bothGuess.sidConfirmed, false, '仍标疑似');

console.log('\n=== 3. merge：某侧缺 UID 才逐字段补缺 ===');
const noOldUid = mergeCard({ ...oldCard, uid: null }, otherCard, 6000);
eq(noOldUid.name, '张三', '旧卡无 UID ⇒ 退化为逐字段合并（新值有才覆盖）');
const noFreshUid = mergeCard(oldCard, { ...otherCard, uid: null }, 7000);
eq(noFreshUid.name, '张三', '新卡无 UID ⇒ 同样逐字段合并');
eq(noFreshUid.uid, '77 75 F0 7B', '新卡无 UID 时保留旧 UID');

console.log('\n=== 4. sameContent 不比 savedAt ===');
const a = { ...oldCard, savedAt: 1000 };
const b = { ...oldCard, savedAt: 9999 };
ok(sameContent(a, b), '同内容不同时间 ⇒ 相同（否则每敲一个字符都写盘）');
ok(!sameContent(a, { ...a, name: '别人' }), '姓名不同 ⇒ 不同');
ok(!sameContent(null, a), 'null 与名片不同');
ok(sameContent(null, null), '两个 null 相同');

console.log('\n=== 5. 空态 / 展示 ===');
ok(isBlank(null), 'null 名片是空态');
ok(isBlank(emptyCard()), '全空名片是空态');
ok(!isBlank(oldCard), '有内容的名片非空');
eq(cardLine(null), '', '空名片无展示文本');
ok(cardLine(oldCard).includes('高天翔'), '展示含姓名');
ok(cardLine(oldCard).includes('1120241355'), '展示含学号');
ok(!cardLine(guessed).includes('（疑似）'), '确认学号不带「疑似」字样');
const suspectLine = cardLine({ ...oldCard, sidConfirmed: false });
ok(suspectLine.includes('（疑似）'), '疑似学号必须标「疑似」（不冒充确认值）');

console.log('\n=== 6. 源码守卫（静态）===');
const storeSrc = code('entry/src/main/ets/data/SavedCardStore.ts');
const pageSrc = code('entry/src/main/ets/pages/NfcPage.ets');
const logicSrc = code('entry/src/main/ets/corelogic/SavedCardLogic.ts');
for (const kw of ['password', 'token', 'cookie']) {
  ok(storeSrc.indexOf(kw) < 0, 'SavedCardStore 无 ' + kw + ' 字段');
}
ok(storeSrc.includes('forgetCard()') && storeSrc.indexOf('KEY_STUDENT_INPUT') >= 0,
  '忘掉名片与学号输入框分开存储（判据④）');
ok(!storeSrc.slice(storeSrc.indexOf('forgetCard'), storeSrc.indexOf('loadStudentInput'))
  .includes('KEY_STUDENT_INPUT'), 'forgetCard 不删学号输入框键');
ok(logicSrc.includes('if (!sameCard)'), '换卡整张替换分支存在（判据②）');
ok(logicSrc.includes('fresh.sidConfirmed') && logicSrc.includes('old.sidConfirmed'),
  '确认学号优先（判据③）');
ok(pageSrc.includes('this.persistCard(fresh)'), '读卡成功后合并落盘');
ok(pageSrc.includes('this.forgetSaved()'), '页面有忘掉入口');
ok(pageSrc.includes('saveStudentInput(v)'), '输入框内容持久化');

console.log('\n' + 'ALL PASS  pass=' + pass + ' fail=0');
process.exit(0);
