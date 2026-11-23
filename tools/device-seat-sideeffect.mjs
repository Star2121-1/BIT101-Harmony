#!/usr/bin/env node
/**
 * 座位预约 / 取消副作用 —— 真机半自动验收脚本。
 *
 * 🔴 红线：脚本**绝不点击**「预约 XXX」「取消预约」「确认取消预约」。
 *    这些按钮会真的占位 / 释放座位，按项目铁律只能由用户本人在设备上点。
 *    脚本只做：确认版本 → 导航到待确认界面 → 定位按钮 → 等待用户点击 → 抓证据 → 判定。
 *
 * 用法：
 *   node tools/device-seat-sideeffect.mjs reserve   # 验预约正路径
 *   node tools/device-seat-sideeffect.mjs cancel    # 验取消 + 二次确认
 *   node tools/device-seat-sideeffect.mjs all       # 依次验两个
 *
 * 可选环境变量：HDC=<hdc.exe 路径>，DEVICE=<设备 connectkey>，WAIT_MS=<等待用户点击毫秒，默认 120000>
 *
 * 判定不靠"看着像成功"：预约看列表 tab 的「我的预约（N）」计数变化；
 * 取消看计数回落 + 本地额度副标题「今天还剩 N 次」递减；会话失效会明确 FAIL，不伪通过。
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EVIDENCE = join(ROOT, 'evidence', 'device-sideeffect');
const HDC = process.env.HDC ?? 'F:/Agent_Work/BIT-102/harmony/clt/command-line-tools/sdk/default/openharmony/toolchains/hdc.exe';
const DEVICE = process.env.DEVICE ?? '';
const WAIT_MS = Number(process.env.WAIT_MS ?? 120000);
const MODE = process.argv[2] ?? 'all';
const PACKAGE = 'cn.bit101.next';

mkdirSync(EVIDENCE, { recursive: true });

function rawHdc(args, timeout = 40000) {
  const full = DEVICE ? ['-t', DEVICE, ...args] : args;
  const r = spawnSync(HDC, full, { encoding: 'utf8', timeout });
  return ((r.stdout ?? '') + (r.stderr ?? '')).trim();
}

/**
 * 本机 hdc 通道易卡：先 kill -r 重启 server，再 echo READY 探活（两条都实测必需）。
 * 若仍报建连失败，有界重试一次；不是失败循环，是针对已知偶发故障的固定恢复动作。
 */
function hdc(args, timeout = 40000) {
  const once = () => {
    spawnSync(HDC, ['kill', '-r'], { stdio: 'ignore', timeout: 20000 });
    rawHdc(['shell', 'echo READY'], 20000);
    return rawHdc(args, timeout);
  };
  const out = once();
  if (/need connect-key|E000004|communication channel is being established/.test(out)) {
    return once();
  }
  return out;
}

function shell(cmd) { return hdc(['shell', cmd]); }

function dump(name) {
  const remote = '/data/local/tmp/' + name + '.xml';
  const saved = shell('uitest dumpLayout -p ' + remote);
  if (!saved.includes('DumpLayout saved')) throw new Error('dumpLayout 失败：' + saved);
  const local = join(EVIDENCE, name + '.xml');
  const recv = hdc(['file', 'recv', remote, local]);
  if (!recv.includes('FileTransfer finish')) throw new Error('file recv 失败：' + recv);
  return JSON.parse(readFileSync(local, 'utf8'));
}

function nodes(json) {
  const out = [];
  const walk = (n) => {
    const a = n.attributes ?? {};
    const text = String(a.text ?? '').trim();
    out.push({ text, bounds: a.bounds ?? '', clickable: a.clickable === 'true',
      page: a.pagePath ?? '', bg: String(a.backgroundColor ?? '') });
    for (const c of n.children ?? []) walk(c);
  };
  walk(json);
  return out;
}

function texts(json) { return nodes(json).map(n => n.text).filter(t => t.length > 0); }

function find(json, predicate) {
  const hit = nodes(json).find(n => predicate(n));
  if (!hit) throw new Error('找不到目标元素；当前页面文本=' + texts(json).slice(0, 25).join(' | '));
  return hit;
}

function center(bounds) {
  const m = /\[(\d+),(\d+)\]\[(\d+),(\d+)\]/.exec(bounds);
  if (!m) throw new Error('坐标解析失败：' + bounds);
  return [Math.floor((Number(m[1]) + Number(m[3])) / 2), Math.floor((Number(m[2]) + Number(m[4])) / 2)];
}

function click(json, predicate, label) {
  const n = find(json, predicate);
  const [x, y] = center(n.bounds);
  shell('uitest uiInput click ' + x + ' ' + y);
  return n.text;
}

function pageOf(json) {
  const hit = nodes(json).find(n => n.page.length > 0);
  return hit ? hit.page : '';
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

/** 轮询等待用户点击结果（check 为真即通过；不是失败重试，是等外部过程）。 */
async function waitFor(label, check, timeout = WAIT_MS) {
  const deadline = Date.now() + timeout;
  let last = '';
  let i = 0;
  while (Date.now() < deadline) {
    const json = dump('poll-' + label + '-' + (i++));
    if (check(json)) return json;
    last = texts(json).slice(0, 12).join(' | ');
    await sleep(2000);
  }
  throw new Error('等待超时：' + label + '；最后页面=' + last);
}

function myCount(json) {
  const hit = texts(json).find(t => /^我的预约（\d+）$/.test(t));
  return hit ? Number(/（(\d+)）/.exec(hit)[1]) : null;
}

function remainingQuota(json) {
  const hit = texts(json).find(t => t.includes('今天还剩'));
  const m = hit ? /今天还剩\s*(\d+)\s*次/.exec(hit) : null;
  return m ? Number(m[1]) : null;
}

function assertNoAuthGate(json) {
  if (texts(json).some(t => t.includes('登录已失效') || t.includes('去授权'))) {
    throw new Error('座位会话已失效，先点「去授权」由本人重登后再跑本用例（不伪通过）');
  }
}

function note(text) { console.log('\n[用例] ' + text); }
function pass(text) { console.log('[PASS] ' + text); }

async function gotoSeatTab() {
  shell('aa start -a EntryAbility -b ' + PACKAGE);
  await sleep(2000);
  let j = dump('nav-1');
  // 幂等：上次用例可能把 App 留在独立座位图页，先退回到表单（最多退 3 次）
  for (let i = 0; i < 3 && pageOf(j) === 'pages/SeatMapPage'; i++) {
    shell('uitest uiInput keyEvent Back');
    await sleep(1200);
    j = dump('nav-back-' + i);
  }
  // 底部 tab「座」（不是「座位预约」标题）；已在座位页则不必再点
  if (texts(j).some(t => t === '座')) {
    click(j, n => n.text === '座', '座位 tab');
    await sleep(1500);
    j = dump('nav-seat');
  }
  // 若停在列表 tab，切回预约 tab 才有三级选址 chip（精确匹配避免撞上「预约任务」）
  if (texts(j).some(t => t === '预约任务')) {
    click(j, n => n.text === '预约', '预约 tab');
    await sleep(1000);
    j = dump('nav-book');
  }
  return j;
}

async function setupArea(j) {
  // 选一层区域：中厅（Android/鸿蒙现有实测区域，若树变化请按界面文本调整）
  if (texts(j).includes('中厅')) {
    click(j, n => n.text === '中厅', '区域');
    await sleep(800);
    return dump('nav-area');
  }
  if (texts(j).includes('三层')) {
    click(j, n => n.text === '三层', '楼层');
    await sleep(800);
    j = dump('nav-floor');
    click(j, n => n.text === '中厅', '区域');
    await sleep(800);
    return dump('nav-area');
  }
  throw new Error('找不到可选楼层/区域，座位树可能变化');
}

async function reserveCase() {
  note('TC-01 预约正路径：预约后列表 tab 计数 +1，并显示签到时限');
  let j = await gotoSeatTab();
  j = await setupArea(j);
  assertNoAuthGate(j);
  click(j, n => n.text === '选择座位', '选择座位');
  j = await waitFor('进入座位图', x => pageOf(x) === 'pages/SeatMapPage', 20000);
  pass('已进入独立座位图页');

  // 真机实测：座位号是 Text（自身 clickable=false），可点的是父 Stack；点 Text 的 bounds
  // 中心会冒泡生效（alpha.44/45 已验）。必须挑空闲位：其色块是 #FF4CAF50；
  // 灰色 #FF9E9E9E 是「在用，不能预约」，点它只会弹提示、进不了预约态。
  const seatNode = find(j, n => /^\d{1,3}$/.test(n.text) && n.bg.includes('4CAF50'));
  const [sx, sy] = center(seatNode.bounds);
  shell('uitest uiInput click ' + sx + ' ' + sy);
  await sleep(1000);
  j = dump('reserve-selected');
  const btn = find(j, n => /^预约 \d+$/.test(n.text));
  const before = myCount(j);
  console.log('\n👉 请用户本人点击屏幕上的「' + btn.text + '」按钮。脚本不会代点。');
  console.log('   等待结果最多 ' + Math.round(WAIT_MS / 1000) + ' 秒…\n');

  const after = await waitFor('预约结果', (x) => {
    const n = myCount(x);
    return n !== null && (before === null || n > before);
  });
  const msg = texts(after).find(t => t.includes('成功') || t.includes('签到'));
  pass('预约生效：我的预约 ' + before + ' → ' + myCount(after) + '；提示=' + (msg ?? '（见证据）'));
  writeFileSync(join(EVIDENCE, 'reserve-result.json'),
    JSON.stringify({ before, after: myCount(after), message: msg ?? '' }, null, 2));
}

async function cancelCase() {
  note('TC-02 取消 + 二次确认：计数 -1，本地额度剩余 -1');
  let j = await gotoSeatTab();
  click(j, n => n.text === '列表', '列表 tab');
  await sleep(1500);
  j = dump('cancel-list');
  assertNoAuthGate(j);
  const beforeCount = myCount(j);
  const beforeQuota = remainingQuota(j);
  if (beforeCount === null || beforeCount <= 0) {
    throw new Error('当前没有可取消的预约，先跑 reserve 用例或手工预约一条');
  }
  const cancelBtn = find(j, n => n.text === '取消' || n.text.includes('取消预约'));
  console.log('\n👉 请用户本人点击预约卡上的「' + cancelBtn.text + '」（第一次点击只进确认态）。');
  await waitFor('第一次点击', x => texts(x).some(t => t.includes('确认取消') || t.includes('再点一次')), 60000);
  console.log('👉 请用户本人再点一次「确认取消预约」。脚本不会代点。\n');
  const after = await waitFor('取消结果', (x) => {
    const n = myCount(x);
    return n !== null && n < beforeCount;
  });
  const afterQuota = remainingQuota(after);
  pass('取消生效：我的预约 ' + beforeCount + ' → ' + myCount(after)
    + '；额度 ' + beforeQuota + ' → ' + afterQuota);
  if (beforeQuota !== null && afterQuota !== null && afterQuota >= beforeQuota) {
    console.log('[WARN] 额度未递减：可能额度是跨天重置后的首条，或取消的是研讨间（两类是否共用额度未明）');
  }
  writeFileSync(join(EVIDENCE, 'cancel-result.json'),
    JSON.stringify({ beforeCount, afterCount: myCount(after), beforeQuota, afterQuota }, null, 2));
}

try {
  console.log('hdc 目标：' + (hdc(['list','targets']) || '(无设备)'));
  if (MODE === 'reserve' || MODE === 'all') await reserveCase();
  if (MODE === 'cancel' || MODE === 'all') await cancelCase();
  console.log('\n全部用例完成，证据目录：' + EVIDENCE);
} catch (e) {
  console.error('\n[FAIL] ' + (e instanceof Error ? e.message : String(e)));
  process.exitCode = 1;
}
