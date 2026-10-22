/**
 * 一卡通逻辑单测（M5-1）—— 1:1 移植 Android：
 *  - data/src/test/.../CampusCardLogicTest.kt（解析 + 文案分支）
 *  - data/src/test/.../CampusCardBalanceLogicTest.kt（编码/合并/趋势/文案）
 *
 * 为什么值得单测：「未登录」若按 HTML 关键词判，v1.8.0 曾把已登录页误判成未登录
 * （首页正文本身含「统一身份认证」文案），卡片永远显示「点开登录」；
 * 趋势口径错一次 = 给用户一个假的「近 7 天花了多少钱」。
 *
 * 时间统一用东八区（学校所在地），且**显式注入 `shanghaiEpochDay`** ——
 * 否则 GitHub CI 跑在 UTC 上，hour<8 的用例会整体差一天。
 *
 * 跑法：node --experimental-transform-types tools/test-card.mjs
 */

import {
  parse,
  balanceText,
  hostOf
} from '../entry/src/main/ets/corelogic/CampusCardLogic.ts';
import {
  encode,
  decode,
  append,
  trend,
  trendText,
  signedText,
  hasChange,
  trendRowText,
  shanghaiEpochDay,
  emptyTrend,
  MAX_DAYS
} from '../entry/src/main/ets/corelogic/CampusCardBalanceLogic.ts';

let passed = 0;
let failed = 0;

function ok(cond, msg) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.log('FAIL ' + msg);
  }
}

function eq(actual, expected, msg) {
  const same = JSON.stringify(actual) === JSON.stringify(expected);
  if (same) {
    passed++;
  } else {
    failed++;
    console.log('FAIL ' + msg + '\n  expect=' + JSON.stringify(expected) + '\n  actual=' + JSON.stringify(actual));
  }
}

const HOME = 'https://dkykt.info.bit.edu.cn/home/openHomePageByCas';

/** 东八区某日某时的 epoch 毫秒（与 Kotlin 测试的 at() 等价）。 */
function at(date, hour, minute) {
  const p = date.split('-');
  const y = Number(p[0]);
  const mo = Number(p[1]);
  const d = Number(p[2]);
  // 东八区 hh:mm = UTC (hh-8):mm（同一天，hour 允许 0 —— 0 点即前一日 16:00 UTC）
  return Date.UTC(y, mo - 1, d, hour - 8, minute || 0);
}

// 未登录：被 302 到 CAS gate 后的页面（真实页面特征片段）
const gateHtml = [
  '<html><head><title>用户登录</title></head><body>',
  '<div class="UsernamePassword">用户名密码</div>',
  '<div>smsLogin 短信验证码</div>',
  '<a href="clientredirect?client_name=adapter&service=https%3A%2F%2Fdkykt.info.bit.edu.cn%2Fhome%2FopenHomePageByCas">i北理扫码</a>',
  '</body></html>'
].join('\n');

// 已登录：首页正文（含余额文案与「统一身份认证」菜单项）
const homeHtml = [
  '<html><body>',
  '<ul class="menu"><li>统一身份认证</li><li>退出</li></ul>',
  '<div class="card-info">',
  '    <span>账户余额</span><em>128.50</em>',
  '    <span>过渡余额</span><em>0.00</em>',
  '    <span>余额</span><em>128.50</em>',
  '</div>',
  '</body></html>'
].join('\n');

console.log('=== 1. hostOf / 登录判定（最终 URL 口径） ===');
eq(hostOf('https://sso.bit.edu.cn/gate?service=x'), 'sso.bit.edu.cn', 'hostOf 去 query');
eq(hostOf('https://dkykt.info.bit.edu.cn:8080/home'), 'dkykt.info.bit.edu.cn', 'hostOf 去端口');
eq(hostOf('https://user@dkykt.info.bit.edu.cn/home'), 'dkykt.info.bit.edu.cn', 'hostOf 去 userinfo');
eq(hostOf('not a url'), '', 'hostOf 非法串返回空');
eq(parse(gateHtml, 'https://sso.bit.edu.cn/gate?service=https%3A%2F%2Fdkykt.info.bit.edu.cn%2F').loggedIn,
  false, '重定向到 sso 即未登录');
eq(parse(homeHtml, HOME).loggedIn, true, '首页含统一身份认证文案也判已登录（v1.8.0 回归）');
eq(parse('', HOME).loggedIn, false, '空响应不算已登录');
eq(parse('', HOME).entries.length, 0, '空响应条目为空');

console.log('\n=== 2. 余额字段解析 ===');
eq(parse(homeHtml, HOME).entries, [
  { label: '账户余额', value: '128.50' },
  { label: '过渡余额', value: '0.00' },
  { label: '余额', value: '128.50' }
], '提取余额并按标签去重（保留首现顺序）');
eq(parse('<div>余额 1,234.56</div>', HOME).entries,
  [{ label: '余额', value: '1,234.56' }], '金额支持千分位');
eq(parse('<html><body><div id=app></div></body></html>', HOME).loggedIn,
  true, 'JS 壳页：无余额文案也判已登录');
eq(parse('<html><body><div id=app></div></body></html>', HOME).entries.length,
  0, '已在登录态但解析不到余额 → 条目为空（UI 走「未识别」）');
eq(parse(homeHtml, HOME).htmlSnippet.length > 0, true, 'htmlSnippet 有内容（调试用）');
eq(parse('', HOME).failed, false, 'parse 本身不产 failed（failed 只来自请求层）');

console.log('\n=== 3. 余额文案分支 ===');
const logged = parse(homeHtml, HOME);
const gate = parse(gateHtml, 'https://sso.bit.edu.cn/gate');
eq(balanceText(logged, false, true), '¥128.50', '已登录取第一个条目');
eq(balanceText(logged, true, false), '获取中…', '首次加载显示获取中');
eq(balanceText(logged, true, true), '¥128.50', '已加载后再刷新不退回「获取中」');
eq(balanceText(null, false, true), '获取失败，下拉/点刷新重试', 'null 快照=失败文案');
eq(balanceText(gate, false, true), '未登录，进详情页登录', '未登录默认文案');
eq(balanceText(gate, false, true, '点下方按钮登录'), '点下方按钮登录', '未登录文案可按场景替换');
eq(balanceText({ entries: [], htmlSnippet: '', loggedIn: false, failed: true }, false, true),
  '获取失败，下拉/点刷新重试', '请求失败不等于未登录（2026-09-25 踩过）');
eq(balanceText({ entries: [], htmlSnippet: '', loggedIn: true, failed: false }, false, true),
  '未识别到余额', '已登录但无条目 → 未识别到余额');

console.log('\n=== 4. 编码往返 / 脏数据 ===');
const sampleA = [
  { atMillis: at('2026-09-20', 9), amount: 51.33 },
  { atMillis: at('2026-09-26', 8), amount: 34.05 }
];
eq(decode(encode(sampleA)), sampleA, '编码解码往返');
eq(decode(null), [], 'null 解码为空表');
eq(decode(''), [], '空串解码为空表');
const dirty = '1758888000000|34.05\n不是一条记录\n1758801600000|51.33\nxyz|1.00\n1758974400000|abc';
const decoded = decode(dirty);
eq(decoded.length, 2, '脏行直接丢，不猜、不作废整份历史');
eq(decoded[0].atMillis, 1758801600000, '解码按时序排序（前）');
eq(decoded[1].atMillis, 1758888000000, '解码按时序排序（后）');

console.log('\n=== 5. 采样合并 / 裁剪 ===');
const d1 = shanghaiEpochDay(at('2026-09-26', 8));
const firstRes = append([], 34.05, at('2026-09-26', 8), shanghaiEpochDay);
const secondRes = append(firstRes, 34.05, at('2026-09-26', 12), shanghaiEpochDay);
eq(secondRes.length, 1, '同日同金额只留一条');
eq(secondRes[0].atMillis, at('2026-09-26', 8), '保留最早那条时刻（今天最早余额的口径）');
eq(append([], 40.0, at('2026-09-26', 8), shanghaiEpochDay).length, 1, '首条采样');
eq(append(append([], 40.0, at('2026-09-26', 8), shanghaiEpochDay), 34.05, at('2026-09-26', 12), shanghaiEpochDay).length,
  2, '金额变化会新增采样');
eq(append(append([], 34.05, at('2026-09-25', 20), shanghaiEpochDay), 34.05, at('2026-09-26', 8), shanghaiEpochDay).length,
  2, '跨天同金额仍记一条（否则近 N 天缺基准）');
const pruned = append([
  { atMillis: at('2026-01-01', 9), amount: 100.0 },
  { atMillis: at('2026-09-26', 9), amount: 34.05 }
], 33.0, at('2026-09-26', 10), shanghaiEpochDay);
eq(pruned.length, 2, '裁剪后条数');
eq(pruned[pruned.length - 1].amount, 33.0, '新采样在末尾');
eq(pruned[0].atMillis, at('2026-09-26', 9), '超过 MAX_DAYS 的老采样被丢掉');
eq(MAX_DAYS, 120, 'MAX_DAYS 常量与 Android 一致');
eq(d1, shanghaiEpochDay(at('2026-09-26', 20)), '同一自然日 → 同一 epoch day');

console.log('\n=== 6. 趋势口径 ===');
const today = shanghaiEpochDay(at('2026-09-26', 12));
const emptyT = trend([], today, shanghaiEpochDay);
eq(emptyT, emptyTrend(), '没有采样时趋势全空');
eq(trendText(emptyT), null, '空趋势无文案');
eq(trendRowText(emptyT), '记录中（攒够历史后显示变化）', '算不出来时给记录中占位');
eq(trendRowText(trend([
  { atMillis: at('2026-09-23', 9), amount: 50.0 },
  { atMillis: at('2026-09-26', 18), amount: 34.05 }
], today, shanghaiEpochDay)), '近 3 天 -¥15.95', '近 3 天口径（trendRowText）');

const onceToday = trend([{ atMillis: at('2026-09-26', 9), amount: 40.0 }], today, shanghaiEpochDay);
eq(onceToday.todayDelta, null, '今天只采一次 → 不给今日变化');
eq(onceToday.spanDelta, null, '单条采样 → 无跨度变化');
eq(onceToday.spanDays, 0, '单条采样 → spanDays=0');

const threeToday = trend([
  { atMillis: at('2026-09-26', 8), amount: 40.0 },
  { atMillis: at('2026-09-26', 12), amount: 36.5 },
  { atMillis: at('2026-09-26', 18), amount: 34.05 }
], today, shanghaiEpochDay);
eq(threeToday.todayDelta !== null && Math.abs(threeToday.todayDelta - (-5.95)) < 0.001,
  true, '今日变化 = 今天最早到最新');

const sevenDay = trend([
  { atMillis: at('2026-09-18', 9), amount: 80.0 },
  { atMillis: at('2026-09-19', 9), amount: 60.0 },
  { atMillis: at('2026-09-26', 18), amount: 34.05 }
], today, shanghaiEpochDay);
eq(sevenDay.spanDays, 7, '近 7 天跨度（窗口外不作为基准）');
eq(sevenDay.spanDelta !== null && Math.abs(sevenDay.spanDelta - (-25.95)) < 0.001, true, '近 7 天金额');
eq(trendText(sevenDay), '近 7 天 -¥25.95', '近 7 天文案');

const threeDay = trend([
  { atMillis: at('2026-09-23', 9), amount: 50.0 },
  { atMillis: at('2026-09-26', 18), amount: 34.05 }
], today, shanghaiEpochDay);
eq(threeDay.spanDays, 3, '样本不足 7 天如实写实际跨度');
eq(trendText(threeDay), '近 3 天 -¥15.95', '近 3 天文案');

const recharge = trend([
  { atMillis: at('2026-09-23', 9), amount: 10.0 },
  { atMillis: at('2026-09-26', 8), amount: 60.0 }
], today, shanghaiEpochDay);
eq(trendText(recharge), '近 3 天 +¥50.00', '充值显示为正号');

const both = trend([
  { atMillis: at('2026-09-19', 9), amount: 60.0 },
  { atMillis: at('2026-09-26', 8), amount: 40.0 },
  { atMillis: at('2026-09-26', 18), amount: 34.05 }
], today, shanghaiEpochDay);
eq(trendText(both), '今日 -¥5.95 · 近 7 天 -¥25.95', '今日与近 N 天拼成一行');

const noChange = trend([
  { atMillis: at('2026-09-19', 9), amount: 34.05 },
  { atMillis: at('2026-09-26', 8), amount: 34.05 },
  { atMillis: at('2026-09-26', 18), amount: 34.05 }
], today, shanghaiEpochDay);
eq(trendText(noChange), '今日 无变化 · 近 7 天 无变化', '没花钱写无变化');

const stale = trend([
  { atMillis: at('2026-09-01', 9), amount: 80.0 },
  { atMillis: at('2026-09-02', 9), amount: 60.0 }
], today, shanghaiEpochDay);
eq(stale.spanDelta, null, '窗口内无采样 → 不给跨度结论');
eq(stale.spanDays, 0, '窗口内无采样 → spanDays=0');
eq(trendText(stale), null, '窗口内无采样 → 无文案');

console.log('\n=== 7. 文案精度 / hasChange ===');
eq(signedText(1e-15), '无变化', '浮点残差按无变化');
eq(signedText(0.001), '无变化', '低于半分钱按无变化');
eq(signedText(-0.01), '-¥0.01', '负号在 ¥ 前');
eq(signedText(0.01), '+¥0.01', '正号在 ¥ 前');
eq(signedText(-5.95), '-¥5.95', '两位小数');
eq(hasChange(emptyTrend()), false, '空趋势无变化');
eq(hasChange({ todayDelta: 0, spanDelta: 0, spanDays: 7 }), false, '全 0 = 无变化');
eq(hasChange({ todayDelta: 1e-15, spanDelta: null, spanDays: 0 }), false, '残差不算变化');
eq(hasChange({ todayDelta: -5.95, spanDelta: null, spanDays: 0 }), true, '今日有变化');
eq(hasChange({ todayDelta: null, spanDelta: -25.95, spanDays: 7 }), true, '跨度有变化');
eq(hasChange({ todayDelta: null, spanDelta: 50.0, spanDays: 3 }), true, '充值也算变化');
eq(hasChange({ todayDelta: 0, spanDelta: -3.0, spanDays: 2 }), true, '今天 0、近几天有变化仍要显示');

// 与 trendText 对得上：说「无变化」的趋势，hasChange 必须是 false
const noChangeT = trend([
  { atMillis: at('2026-09-26', 8), amount: 34.05 },
  { atMillis: at('2026-09-26', 18), amount: 34.05 }
], today, shanghaiEpochDay);
const noChangeText = trendText(noChangeT);
if (noChangeText !== null && noChangeText.indexOf('无变化') >= 0) {
  eq(hasChange(noChangeT), false, '文案说无变化，hasChange 就不该为真：' + noChangeText);
} else {
  ok(false, '用例前提失效：应得到含「无变化」的文案，实际 ' + JSON.stringify(noChangeText));
}

console.log('\n' + (failed === 0 ? 'ALL PASS' : 'FAILED') + '  pass=' + passed + ' fail=' + failed);
process.exit(failed > 0 ? 1 : 0);
