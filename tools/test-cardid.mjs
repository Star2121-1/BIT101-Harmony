/**
 * 学号/身份/BCD 日期纯逻辑单测（#152），真卡向量来自 BIT101-seat。
 */
import assert from 'node:assert/strict';
import { encodingsOf, find, guess } from '../entry/src/main/ets/corelogic/StudentIdScan.ts';
import { scan as bcdScan } from '../entry/src/main/ets/corelogic/BcdScan.ts';
import { summarize, hasPerson, cardNoCandidates } from '../entry/src/main/ets/corelogic/CardIdentityLogic.ts';

let pass = 0;
function ok(cond, name) {
  assert.ok(cond, name);
  pass++;
}
function hx(s) {
  const out = [];
  for (let i = 0; i < s.length; i += 2) out.push(parseInt(s.substring(i, i + 2), 16));
  return out;
}

// ── 1. 编码形式 ──────────────────────────────────────────────────────────
const forms = encodingsOf('1120241355');
ok(forms.length === 3 && forms[0].name === 'BCD', 'BCD 形式存在');
ok(forms[0].bytes.map(b => b.toString(16).padStart(2, '0')).join(' ') === '11 20 24 13 55', '学号 BCD = 11 20 24 13 55');
ok(forms[1].name === 'BCD 反序' && forms[1].bytes[0] === 0x55, '反序 BCD');
ok(forms[2].name === 'ASCII' && forms[2].bytes.length === 10, 'ASCII 10 字节');
ok(encodingsOf('abc').length === 0, '非数字不编码');
ok(encodingsOf('').length === 0, '空串不编码');

// ── 2. 连续匹配 ──────────────────────────────────────────────────────────
ok(find(hx('0000112024135500'), '1120241355').indexOf('BCD 形式，偏移 2') >= 0, 'BCD 连续命中');
ok(find(hx('00003131323032343133353500'), '1120241355').indexOf('ASCII') >= 0, 'ASCII 连续命中');
ok(find([], '1120241355') === null, '空数据返回 null');
ok(find(hx('00000000'), '1120241355') === null, '找不到返回 null 不猜');

// ── 3. 真卡分段匹配（核心：整个 NFC 功能成立的关键）─────────────────────
// 0016 第 2 段偏移 10 起：'1''1' 06 '2''0''2''4''1''3' 04 '5''5'
const segData = hx('000000000000000000003131063230323431330435350000');
const segHit = find(segData, '1120241355');
ok(segHit !== null, '真卡分段学号命中');
ok(segHit.indexOf('分段形式（3 段，2 个分隔符），偏移 10') >= 0, '分段说明正确（3 段 2 分隔符 偏移10）');
// 0x00 补零不能当分隔符（否则到处都能拼出学号）。8 位学号 + 0x00 分隔，
// 真实现必须拒绝；若把 isSeparator 放宽到 0x00 就会误命中（拆红验证过）。
ok(find(hx('313100323032343133'), '11202413') === null,
  '0x00 分隔不认（补零误报被挡住）');
// 拼起来不等于完整学号时不认
ok(find(hx('313106323033'), '1120241355') === null, '分段拼不全不认');

// ── 4. guess：不填学号也能认（标疑似）──────────────────────────────────
const g1 = guess(segData);
ok(g1 !== null && g1.value === '1120241355', 'guess 分段认出 1120241355');
ok(g1.note.indexOf('疑似') < 0 && g1.note.indexOf('分段形式') >= 0, 'guess note 说明来源');
// 连续 ASCII 学号，年份在第 3 位起
const g2 = guess(hx('0000313132303234313335350000'));
ok(g2 !== null && g2.value === '1120241355', 'guess 连续 ASCII 命中');
// 首位 0 或是随机 BCD 不猜
ok(guess(hx('3031313230323431333535')) === null, '首位 0 不猜');
ok(guess(hx('112024135511')) === null, '无年份特征不猜');

// ── 5. BCD 日期 ──────────────────────────────────────────────────────────
// 真卡 0018：`20 26 03 22 11 08 43`
const dates = bcdScan(hx('AABB20260322110843CC'));
ok(dates.length === 1, '找到一个 BCD 日期');
ok(dates[0].text === '2026-03-22 11:08:43', '日期+时间正确');
ok(dates[0].at === 2, '偏移正确');
ok(dates[0].display.indexOf('偏移 2：') === 0, 'display 带偏移');
ok(bcdScan(hx('20260322000000')).length === 1, '00:00:00 不附（不是时间）');
ok(bcdScan(hx('20260322000000'))[0].text === '2026-03-22', '全零时间不附后只剩日期');
ok(bcdScan(hx('19990101')).length === 0, '年份窗口外（1999）不报');
ok(bcdScan(hx('20281301')).length === 0, '非法月日不报');
ok(bcdScan(hx('20280229')).length === 1, '闰年 2028-02-29 合法');
ok(bcdScan(hx('20270229')).length === 0, '非闰年 2027-02-29 不报');
ok(bcdScan(hx('010305')).length === 0, '01 03 05 不单独当日期');
ok(bcdScan([]).length === 0, '空数据返回空列表不是 null');

// ── 6. 名片汇总：字段语义 ────────────────────────────────────────────────
const candidates = cardNoCandidates(hx('7775F07B'));
ok(candidates.length >= 6, '卡号候选列多种（不冒充结论）');
ok(candidates[0].value === '2004217979', 'UID 77 75 F0 7B 正序整数 = 2004217979');

const nameLine = {
  text: '高天翔', studentIdHit: null, guessedStudentId: null,
  guessedStudentIdNote: null, dates: []
};
const hitLine = {
  text: null, studentIdHit: '分段形式（3 段，2 个分隔符），偏移 10',
  guessedStudentId: null, guessedStudentIdNote: null, dates: []
};
const id = summarize([nameLine, hitLine], candidates, '1120241355');
ok(id.name === '高天翔', '姓名带出');
ok(id.studentId === '1120241355', 'studentId 是数字本身（不是说明文字）');
ok(id.studentIdNote.indexOf('分段形式') >= 0, '说明文字在 studentIdNote');
ok(id.guessedStudentId === null, '有核对结果就不列疑似');
ok(id.cardNo === '2004217979' && id.cardNoNote.indexOf('共') >= 0, '卡号候选说明');
ok(hasPerson(id), '有姓名/学号算认出人');

// 未填学号时：studentId 必须是 null，guess 值进 guessedStudentId
const id2 = summarize([nameLine, {
  text: null, studentIdHit: null,
  guessedStudentId: '1120241355', guessedStudentIdNote: '分段形式，偏移 10', dates: []
}], candidates, null);
ok(id2.studentId === null, '未填学号 studentId=null（不会把说明文字当学号）');
ok(id2.guessedStudentId === '1120241355', '疑似值进 guessedStudentId');
ok(hasPerson(id2), '疑似学号也算认出人（触发深度扫描的安全网不误触）');

// 只有卡号不算认出人
const id3 = summarize([], candidates, null);
ok(!hasPerson(id3), '只有卡号不算认出人');
ok(id3.cardNo !== null, '但名片仍渲染（不整个消失）');

console.log('\nALL PASS pass=' + pass + ' fail=0');
