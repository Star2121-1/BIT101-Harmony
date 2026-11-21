/**
 * 时段解析纯逻辑守卫（座位"未授权"根因修复）。
 *
 * 覆盖 resolveSeatSegment：
 * 1. 当天真实时段 → 用真实 segmentId/start/end
 * 2. 无当天时段 → 回落 '1'/'08:00'/'22:30'
 * 3. 空 dates → 全回落
 * 4. segmentId/start/end 为 null/'null'/空串 → 回落对应字段
 * 5. 多条日期时只取目标当天第一条（不串天）
 * 6. 字段带空白 → trim 后使用
 * 7. 契约不变量：segment 永不为空字符串（空 segment 是 HTTP 500 根因）
 */
import assert from 'node:assert/strict';

// 用正则从 TS 源码抽取函数体做隔离求值，避免引入 @kit 依赖
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'entry/src/main/ets/corelogic/SeatApiLogic.ts'), 'utf8');

const DEFAULT_SEGMENT_ID = src.match(/DEFAULT_SEGMENT_ID:\s*string\s*=\s*'([^']+)'/)[1];
const usableFieldSrc = src.match(/function usableField\(v: string\): string \{[\s\S]*?\n\}/)[0];
const resolveSrc = src.match(/export function resolveSeatSegment\(dates: WireSeatDate\[\], targetDay: string\): SeatSegmentParams \{[\s\S]*?\n\}/)[0];

// 去掉 TS 类型标注/非空断言后转为 JS 可执行
const stripTypes = (s) => s
  .replace(/!/g, '')  // TS 非空断言
  .replace(/export /g, '')
  .replace(/: WireSeatDate\[\]/g, '')
  .replace(/: SeatSegmentParams/g, '')
  .replace(/: WireSeatDate \| null/g, '')
  .replace(/: string/g, '');

const factory = new Function(
  'DEFAULT_SEGMENT_ID',
  `${stripTypes(usableFieldSrc)}\n${stripTypes(resolveSrc)}\nreturn resolveSeatSegment;`
);
const resolve = factory(DEFAULT_SEGMENT_ID);

let passed = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); passed++; };
const eq = (a, e, msg) => { assert.deepStrictEqual(a, e, msg); passed++; };

console.log('=== 时段解析守卫 resolveSeatSegment ===');

const D = '2026-11-22';
const date = (day, segmentId, start, end) => ({ day, segmentId, start, end });

// 1. 真实时段
eq(resolve([date(D, '354438', '08:00', '22:30')], D),
  { segment: '354438', startTime: '08:00', endTime: '22:30' },
  '当天真实时段 → 用真实 id/起讫');

// 2/3. 回落
eq(resolve([], D), { segment: '1', startTime: '08:00', endTime: '22:30' }, '空 dates → 全回落');
eq(resolve([date('2026-11-21', '111', '09:00', '21:00')], D),
  { segment: '1', startTime: '08:00', endTime: '22:30' }, '无当天时段 → 不串天、全回落');

// 4. 字段无效回落
eq(resolve([date(D, '', '', '')], D),
  { segment: '1', startTime: '08:00', endTime: '22:30' }, '空串字段 → 回落');
eq(resolve([date(D, 'null', 'null', 'null')], D),
  { segment: '1', startTime: '08:00', endTime: '22:30' }, "'null' 字符串 → 回落");
eq(resolve([date(D, '   ', '  ', ' ')], D),
  { segment: '1', startTime: '08:00', endTime: '22:30' }, '纯空白 → 回落');

// 5. 多条日期取目标当天第一条
const multi = [date('2026-11-21', 'aaa', '01:00', '02:00'), date(D, 'bbb', '10:00', '20:00'), date(D, 'ccc', '11:00', '21:00')];
eq(resolve(multi, D), { segment: 'bbb', startTime: '10:00', endTime: '20:00' }, '多条时取目标当天第一条');

// 6. trim
eq(resolve([date(D, '  X1 ', ' 07:30 ', ' 23:00 ')], D),
  { segment: 'X1', startTime: '07:30', endTime: '23:00' }, '字段 trim 后使用');

// 7. 不变量：segment 永不空
ok(resolve([date(D, '', 'x', 'y')], D).segment.length > 0, 'segment 永不为空（空 segment = 500 根因）');
eq(DEFAULT_SEGMENT_ID, '1', '默认段常量 = 1（对齐 Android）');

// 8. 部分字段回落：id 有值但时间缺
eq(resolve([date(D, 'S9', '', '')], D),
  { segment: 'S9', startTime: '08:00', endTime: '22:30' }, 'id 有效但时间缺 → 仅时间回落');

console.log(`ALL PASS ${passed} assertions`);
