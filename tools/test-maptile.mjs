/**
 * test-maptile：瓦片坐标换算守卫。
 * 真值来自 Android `MapCampus.kt` 注释里已查证的校区 WGS-84 坐标 + 归一化值。
 */
import {
  TILE_HOST, TILE_SIZE, MIN_ZOOM, MAX_ZOOM,
  lonLatToNorm, normToLonLat, normToTile, tileUrl, visibleTileRange, clampZoom,
} from '../entry/src/main/ets/corelogic/MapTileMath.ts';

let pass = 0;
let fail = 0;
function eq(actual, expected, msg) {
  if (actual === expected) { pass++; }
  else { fail++; console.log('FAIL ' + msg + '：实际 ' + actual + ' ≠ 期望 ' + expected); }
}
function near(actual, expected, tol, msg) {
  if (Math.abs(actual - expected) <= tol) { pass++; }
  else { fail++; console.log('FAIL ' + msg + '：实际 ' + actual + ' ≠ 期望 ' + expected + '(±' + tol + ')'); }
}

console.log('=== 常量（对齐 Android 契约）===');
eq(TILE_HOST, 'https://map.bit101.flwfdd.xyz', '瓦片主机 = Android 同源');
eq(TILE_SIZE, 256, '瓦片边长 256');
eq(MIN_ZOOM, 15, '最小层级 z15（更低 403）');
eq(MAX_ZOOM, 18, '最大层级 z18');

console.log('\n=== Android 校区归一化坐标 ↔ 经纬度往返 ===');
// MapCampus.kt 注释标注的真实 WGS-84 与已算好的归一化值
const campuses = [
  { name: '良乡', lon: 116.1666, lat: 39.7290, x: 0.822685, y: 0.379560 },
  { name: '中关村', lon: 116.3099, lat: 39.9584, x: 0.823083, y: 0.378730 },
  { name: '珠海', lon: 113.5370, lat: 22.3708, x: 0.815381, y: 0.436217 },
  { name: '嘉兴', lon: 120.7399, lat: 30.8326, x: 0.835389, y: 0.409893 },
];
for (const c of campuses) {
  const n = lonLatToNorm(c.lon, c.lat);
  near(n.x, c.x, 0.00002, c.name + ' 经纬度→归一化 x');
  near(n.y, c.y, 0.00002, c.name + ' 经纬度→归一化 y');
  const back = normToLonLat(c.x, c.y);
  near(back.lon, c.lon, 0.01, c.name + ' 归一化→经纬度 lon');
  near(back.lat, c.lat, 0.01, c.name + ' 归一化→经纬度 lat');
}

console.log('\n=== 瓦片坐标换算 ===');
// x=0.5 → 全球中心经线 lon=0；z=16 → col = 0.5 * 65536 = 32768
eq(normToTile(0.5, 0.5, 16).col, 32768, '全球中心 z16 col=32768');
eq(normToTile(0.5, 0.5, 16).row, 32768, '全球中心 z16 row=32768');
near(normToTile(0.822685, 0.379560, 16).col, 0.822685 * 65536, 0.001, '良乡 z16 col 连续值');
near(normToTile(0.822685, 0.379560, 16).row, 0.379560 * 65536, 0.001, '良乡 z16 row 连续值');

console.log('\n=== URL 构造 ===');
eq(tileUrl(16, 53861, 24871), 'https://map.bit101.flwfdd.xyz/tile/16/53861/24871.png', '瓦片 URL 格式');
eq(tileUrl(0, 0, 0), 'https://map.bit101.flwfdd.xyz/tile/0/0/0.png', 'z0 原点 URL');

console.log('\n=== 可见瓦片范围 ===');
// 中心落在瓦片正中 → 视口 512×512（2×2 瓦片）应恰好覆盖一行一列
const r = visibleTileRange(0.5, 0.5, 16, 512, 512);
eq(r.colMin, 32767, '视口 colMin');
eq(r.colMax, 32769, '视口 colMax');
eq(r.rowMin, 32767, '视口 rowMin');
eq(r.rowMax, 32769, '视口 rowMax');

console.log('\n=== 层级夹取 ===');
eq(clampZoom(12), 15, '低于 z15 夹到 z15');
eq(clampZoom(19), 18, '高于 z18 夹到 z18');
eq(clampZoom(16.6), 17, '小数四舍五入');
eq(clampZoom(16), 16, '合法值不变');

console.log('\n' + (fail === 0 ? 'ALL PASS' : 'FAILED') + '  pass=' + pass + ' fail=' + fail);
process.exitCode = fail === 0 ? 0 : 1;
