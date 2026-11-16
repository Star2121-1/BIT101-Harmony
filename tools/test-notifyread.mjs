/**
 * M15-B3 通知已读快照单测。
 *
 * 锁三件事：
 *  1. 已读只认显式键，不再靠时钟；
 *  2. 旧时间戳只迁移一次，且只把当时已发/已到的键种进去；
 *  3. 快照有版本、有上限、原子单键写入，页面先算未读再标记。
 */

import { readFileSync } from 'node:fs';
import {
  NOTIFY_READ_VERSION,
  MAX_READ_KEYS,
  emptyReadSnapshot,
  normalizeReadSnapshot,
  firedKeys,
  unreadFromSnapshot,
  seedSnapshotFromLegacy,
  mergeReadKeys
} from '../entry/src/main/ets/corelogic/NotifyReadLogic.ts';

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
function text(rel) {
  return readFileSync(new URL(rel, import.meta.url), 'utf8').split(/\r?\n/);
}
function has(lines, needle) {
  return lines.some((l) => l.indexOf(needle) >= 0);
}
function idx(lines, needle) {
  return lines.findIndex((l) => l.indexOf(needle) >= 0);
}
function item(key, firedMillis) {
  return { key, firedMillis };
}

console.log('=== 1. 快照净化 ===');
eq(normalizeReadSnapshot(null), null, 'null → null');
eq(normalizeReadSnapshot([]), null, '数组 → null');
eq(normalizeReadSnapshot({ version: 2, keys: [] }), null, '版本不匹配 → null（回落迁移）');
eq(normalizeReadSnapshot({ version: NOTIFY_READ_VERSION }), null, '没有 keys → null');
eq(normalizeReadSnapshot({ version: NOTIFY_READ_VERSION, keys: 'x' }), null, 'keys 不是数组 → null');
{
  const s = normalizeReadSnapshot({
    version: NOTIFY_READ_VERSION,
    keys: ['a', 'a', '', '  ', 3, 'b']
  });
  eq(s, { version: NOTIFY_READ_VERSION, keys: ['a', 'b'] }, '去重 + 丢空键/非字符串');
}
{
  const many = [];
  for (let i = 0; i < MAX_READ_KEYS + 5; i++) {
    many.push('k' + i);
  }
  const s = normalizeReadSnapshot({ version: NOTIFY_READ_VERSION, keys: many });
  ok(s !== null && s.keys.length === MAX_READ_KEYS, '超过上限截到 1024');
  eq(s.keys[0], 'k5', '丢最旧的 5 个，保留最后 1024 个');
  eq(s.keys[s.keys.length - 1], 'k' + (MAX_READ_KEYS + 4), '最后一个保留');
}

console.log('\n=== 2. 已发键与未读 ===');
eq(firedKeys([item('a', 10), item('b', 0), item('a', 20), item('', 30)]), ['a'], '只取已发、去重、丢空键');
{
  const recs = [item('a', 10), item('b', 20), item('c', 0), item('b', 30)];
  eq(unreadFromSnapshot(recs, emptyReadSnapshot()), 2, '空快照：a/b 未读，c 未发不算，b 重复只一次');
  eq(unreadFromSnapshot(recs, { version: 1, keys: ['a'] }), 1, 'a 已读 → 只剩 b');
  eq(unreadFromSnapshot(recs, { version: 1, keys: ['a', 'b'] }), 0, 'a/b 都读过 → 0');
  eq(unreadFromSnapshot([], emptyReadSnapshot()), 0, '空列表 → 0');
  eq(unreadFromSnapshot([item('c', 0)], emptyReadSnapshot()), 0, '只有排期中 → 0');
}

console.log('\n=== 3. 旧时间戳迁移 ===');
{
  const recs = [item('old', 100), item('edge', 200), item('late', 300), item('pending', 0)];
  eq(seedSnapshotFromLegacy(recs, 0), emptyReadSnapshot(), '从没打开过 → 空快照');
  eq(seedSnapshotFromLegacy(recs, 200), { version: 1, keys: ['old', 'edge'] }, '只种 <= lastSeen 的已发键');
  eq(seedSnapshotFromLegacy(recs, 99), emptyReadSnapshot(), 'lastSeen 早于全部 → 空');
  eq(seedSnapshotFromLegacy(recs, 999), { version: 1, keys: ['old', 'edge', 'late'] }, '晚到但 <= lastSeen 也算旧已读');
  eq(seedSnapshotFromLegacy(recs, Number.NaN), emptyReadSnapshot(), 'NaN → 空（不猜）');
}

console.log('\n=== 4. 合并已读键 ===');
{
  const base = { version: 1, keys: ['a', 'b'] };
  eq(mergeReadKeys(base, ['b', 'c', 'a']), { version: 1, keys: ['a', 'b', 'c'] }, '幂等追加，不重复');
  eq(mergeReadKeys(base, []), base, '空 keys 不改');
  eq(mergeReadKeys(base, ['', '  ']), base, '空键不写入');
  const many = [];
  for (let i = 0; i < MAX_READ_KEYS; i++) {
    many.push('k' + i);
  }
  const capped = mergeReadKeys({ version: 1, keys: many }, ['new']);
  ok(capped.keys.length === MAX_READ_KEYS, '合并后仍不超过上限');
  eq(capped.keys[capped.keys.length - 1], 'new', '新键保留');
  eq(capped.keys[0], 'k1', '最旧的一个被挤掉');
}

console.log('\n=== 5. 源码栅栏：页面与存储接线 ===');
{
  const page = text('../entry/src/main/ets/pages/NotifyListPage.ets');
  ok(has(page, 'NotifySeenStore.loadSnapshot()'), '页面读快照');
  ok(has(page, 'unreadFromSnapshot(all, effective)'), '未读按快照算');
  ok(has(page, 'NotifySeenStore.markKeys(firedKeys(all))'), '打开页面只标记已发键');
  ok(!has(page, 'NotifySeenStore.markSeen('), '不再写旧时间戳');
  ok(!has(page, 'unreadCount(all, seen)'), '不再用时间戳算未读');
  const unreadAt = idx(page, 'const unread: number');
  const markAt = idx(page, 'NotifySeenStore.markKeys(firedKeys(all))');
  ok(unreadAt >= 0 && markAt > unreadAt, '先算未读再标记（防徽标自清 0）');
  ok(has(page, 'filtered.sort(compareNewestFirst)'), '记录先按新→旧排序（分组前置条件）');
  ok(has(page, 'dedupeByKey(filtered)'), '记录按 key 去重，防 ForEach 撞键');
  ok(has(page, "span.label + '#' + span.start"), '分组 key 带起始下标，标题重复也不撞键');
}
{
  const store = text('../entry/src/main/ets/data/NotifySeenStore.ts');
  ok(has(store, 'notify_read_snapshot_v1'), '快照使用独立键');
  ok(has(store, 'normalizeReadSnapshot'), '读取时校验版本/结构');
  ok(has(store, 'await Prefs.putString(KEY_SNAPSHOT'), '单键原子写（putString + flush）');
  ok(!has(store, 'Prefs.remove(KEY_SNAPSHOT)'), '不先删旧键再写（避免中间态）');
  ok(has(store, 'loadLegacySeen'), '旧时间戳只用于迁移');
  ok(!has(store, 'markSeen(') && !has(store, 'putNumber(KEY_LEGACY_SEEN'), '新路径不再写旧时间戳');
}
{
  const logic = text('../entry/src/main/ets/corelogic/NotifyReadLogic.ts');
  ok(has(logic, 'MAX_READ_KEYS: number = 1024'), '上限写死 1024');
  ok(has(logic, 'NOTIFY_READ_VERSION: number = 1'), '快照版本写死 1');
}

console.log('\nALL PASS pass=' + passed + ' fail=' + failed);
if (failed > 0) {
  process.exit(1);
}
