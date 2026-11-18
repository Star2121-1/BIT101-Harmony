/**
 * 座位树解析守卫（真机数据驱动，防假通过）。
 *
 * 由来（2026-11-18 真机抓到的真 bug）：
 * - 真机 `/api/Seat/tree` 返回 type 是**字符串** "0"/"1"（35 节点全是字符串，fixture 固化在
 *   tools/fixtures/seat/tree-20261022.json）；
 * - 原 `SeatTreeRaw.type?: number` + `item.type ?? 0` 不做转换，`groupTree` 的 `k.type === 1`
 *   严格相等 ⇒ 所有区域被判成非区域 ⇒ UI 显示「该楼层暂无区域」（楼层却正常显示，因为楼层靠
 *   parentId 分组，不看 type）。
 * - 旧单测只测 groupTree 用数字 type 造的 fixture，parseSeatTree 根本没测 ⇒ 假通过。
 *
 * 判据（对着语义写，能证伪）：
 * - 真机原始 fixture（字符串 type）经 parseSeatTree 后，type 必须是 number；
 * - 再经 groupTree，楼层下必须有区域（数量 > 0），且区域 id/name 与 fixture 一致；
 * - intOrZero 对 number/string/脏值都归到 number，不产生字符串 "1"。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parseSeatTree, intOrZero
} from '../entry/src/main/ets/model/SeatTreeModel.ts';
import { groupTree } from '../entry/src/main/ets/corelogic/SeatViewLogic.ts';

let pass = 0;
function ok(cond, name) { assert.ok(cond, name); pass++; }
function eq(a, b, name) { assert.equal(a, b, name); pass++; }

const fixture = JSON.parse(
  readFileSync(new URL('./fixtures/seat/tree-20261022.json', import.meta.url), 'utf8')
);

console.log('\n=== 座位树解析守卫（真机 fixture）===');

// ── fixture 本身要保真：确实是字符串 type，别被谁改成数字让守卫失去意义 ──
{
  const types = new Set();
  const walk = (nodes) => {
    for (const n of nodes) {
      types.add(typeof n.type);
      walk(n.children || []);
    }
  };
  walk(fixture.data);
  eq(types.size, 1, 'fixture 只有一种 type 形态');
  eq([...types][0], 'string', 'fixture 的 type 确实是字符串（保真，防守卫被架空）');
}

// ── intOrZero 纯函数：各种输入都归 number ──
{
  eq(intOrZero(1), 1, 'number 1 保持');
  eq(intOrZero(0), 0, 'number 0 保持');
  eq(intOrZero('1'), 1, '字符串 "1" → 数字 1');
  eq(intOrZero('0'), 0, '字符串 "0" → 数字 0');
  eq(intOrZero(' 2 '), 2, '带空格的字符串也能转');
  eq(intOrZero(undefined), 0, '缺省 → 0');
  eq(intOrZero('abc'), 0, '脏字符串 → 0（不产生 NaN）');
  eq(intOrZero(NaN), 0, 'NaN → 0');
  eq(typeof intOrZero('1'), 'number', '返回值一定是 number 不是 string');
}

// ── 真机数据解析：type 全变 number ──
{
  const nodes = parseSeatTree(fixture.data);
  ok(nodes.length === 35, '真机 fixture 展平出 35 个节点（实际 ' + nodes.length + '）');
  const bad = nodes.filter((n) => typeof n.type !== 'number');
  eq(bad.length, 0, '解析后没有字符串 type 残留');
  const areas = nodes.filter((n) => n.type === 1);
  ok(areas.length >= 20, '解析出至少 20 个区域节点（实际 ' + areas.length + '）');
  const visual = areas.find((n) => n.name === '视听学习空间');
  ok(visual !== undefined, '真机区域「视听学习空间」被识别为 type=1');
}

// ── 端到端：真机数据 → parse → group → 楼层下有区域（这是 UI 显示的关键）──
{
  const nodes = parseSeatTree(fixture.data);
  const camps = groupTree(nodes);
  ok(camps.length > 0, '至少解析出一个校区');
  const lib = camps.find((c) => c.name.indexOf('徐特立馆') >= 0);
  ok(lib !== undefined, '校区「徐特立馆」在树里');
  const floorsWithAreas = lib.floors.filter((f) => f.areas.length > 0);
  ok(floorsWithAreas.length > 0, '至少有一个楼层解析出区域（修 bug 前这里是 0）：实际 ' + floorsWithAreas.length);
  const third = lib.floors.find((f) => f.name === '三层');
  ok(third !== undefined, '楼层「三层」在树里');
  ok(third.areas.length >= 5, '三层下至少 5 个区域（实际 ' + third.areas.length + '）');
  ok(third.areas.some((a) => a.name === '视听学习空间'), '三层区域含「视听学习空间」');
}

// ── 源码栅栏：不许把 intOrZero 从解析链路里拿掉 ──
{
  const src = readFileSync(new URL('../entry/src/main/ets/model/SeatTreeModel.ts', import.meta.url), 'utf8');
  ok(src.indexOf('intOrZero(item.type)') >= 0, 'parseSeatTree 走 intOrZero 转换');
  ok(src.indexOf('type?: number | string') >= 0, 'SeatTreeRaw.type 接受字符串（真机形态）');
}

// ── 座位页 JWT 静默续期栅栏（2026-11-18 真机：座位接口 500，silentRenewJwt 此前只在探针用过）──
{
  const page = readFileSync(new URL('../entry/src/main/ets/pages/SeatPage.ets', import.meta.url), 'utf8');
  ok(page.indexOf('allowRenew: boolean = true') >= 0, 'loadSeats 有防递归开关');
  ok(page.indexOf('CasLoginService.silentRenewJwt(ctx)') >= 0, '失败时走只读取证续期（不输密码/不撞风控）');
  ok(page.indexOf('this.loadSeats(false)') >= 0, '续期成功后重试一次且关闭 renew，杜绝无限递归');
  ok(page.indexOf('!res.ok') < page.indexOf('CasLoginService.silentRenewJwt(ctx)'), '只在取数失败后才尝试续期');
}

console.log('\nALL PASS pass=' + pass + ' fail=0');
