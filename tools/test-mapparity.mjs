/**
 * 第 7 条 P0 的四项地图对齐测试（G07-03/04/05/06）。
 * 纯逻辑用 Node 直接跑；页面接线用源码静态守卫（拆红反证见 evidence/map-parity-20261127/）。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { scaleToZoom, zoomToScale, normalizeScale, DEFAULT_MAP_SCALE,
  MAP_SCALE_MIN, MAP_SCALE_MAX, MAP_SCALE_STEP } from '../entry/src/main/ets/corelogic/MapScaleLogic.ts';
import { targetFromPlace, requestMapTarget, consumeMapTarget,
  STORAGE_MAP_NAV, PLACE_TARGET_SCALE } from '../entry/src/main/ets/corelogic/MapTarget.ts';
import { TILE_TTL_MS, TILE_MAX_BYTES, TILE_KEY_PREFIX, TILE_INDEX_KEY,
  tileCacheKey, isExpired, totalBytes, evictKeys } from '../entry/src/main/ets/corelogic/MapTileCachePolicy.ts';
import { shouldStayInApp, isSchoolHost, isBit101Host, hostOf,
  BIT101_ROOT, CAMPUS_NET_PORTAL_HOST } from '../entry/src/main/ets/corelogic/WebEntryLogic.ts';
import { shouldHandOff, isHttpUrl } from '../entry/src/main/ets/corelogic/WebNavPolicy.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0;
function eq(a, b, msg) { assert.deepEqual(a, b, msg); pass++; }
function ok(v, msg) { assert.ok(v, msg); pass++; }
function near(a, b, msg) { assert.ok(Math.abs(a - b) < 1e-9, msg + ' actual=' + a + ' expected=' + b); pass++; }
function src(p) { return readFileSync(join(root, p), 'utf8'); }

console.log('=== G07-05 缩放倍率持久化 ===');
eq(DEFAULT_MAP_SCALE, 1, '默认倍率 1（用户拍板，非 Android 的 2）');
eq(MAP_SCALE_MIN, 1, '最小倍率 1');
eq(MAP_SCALE_MAX, 5, '最大倍率 5');
eq(MAP_SCALE_STEP, 0.5, '步进 0.5');
near(scaleToZoom(1), 15, '1 倍 = z15');
near(scaleToZoom(3), 16.5, '3 倍 = z16.5');
near(scaleToZoom(5), 18, '5 倍 = z18（不超过瓦片上限）');
near(zoomToScale(18), 5, 'z18 反解 = 5 倍');
near(zoomToScale(15), 1, 'z15 反解 = 1 倍');
eq(normalizeScale(3.0), 3, '3.0 归一化保持 3');
eq(normalizeScale(2.24), 2, '脏值 2.24 → 量化 2');
eq(normalizeScale(0), 1, '0 夹到 1');
eq(normalizeScale(99), 5, '99 夹到 5');
eq(normalizeScale(NaN), DEFAULT_MAP_SCALE, 'NaN 回落默认');
eq(normalizeScale(Infinity), DEFAULT_MAP_SCALE, 'Infinity 回落默认');
// 重启一致性：同一个 3.0 无论读回多少次，scaleToZoom 输出一致
for (let i = 0; i < 5; i++) { near(scaleToZoom(normalizeScale(3.0)), 16.5, '重启后 3.0 仍 = z16.5 #' + i); }

console.log('=== G07-05 静态接线守卫 ===');
const mapPage = src('entry/src/main/ets/pages/MapPage.ets');
ok(mapPage.includes('loadMapScale()'), 'MapPage aboutToAppear 读回缩放');
ok(mapPage.includes('saveMapScale(value)'), 'MapPage 滑杆保存缩放');
ok(mapPage.includes('scaleToZoom(this.mapScale)'), 'MapPage goto 用 scaleToZoom 输出');
const store = src('entry/src/main/ets/data/MapSettingsStore.ts');
ok(store.includes("'ui_map_scale'"), '缩放 key = ui_map_scale');
ok(store.includes('normalizeScale'), '写盘前归一化（防 3.3 落盘）');
const cacheIndex = src('entry/src/main/ets/corelogic/CacheIndex.ts');
ok(!cacheIndex.includes('ui_map_scale'), 'ui_map_scale 不在缓存清理白名单（清缓存不掉缩放）');

console.log('=== G07-04 课表教室 → 地图定位 ===');
ok(targetFromPlace('文萃楼I404') !== null, '文萃楼I404 匹配到地点');
eq(targetFromPlace('文萃楼I404').name, '文萃楼I', '最长别名：文萃楼I404 → 文萃楼I（不是文萃楼）');
eq(targetFromPlace('文萃楼I404').scale, PLACE_TARGET_SCALE, '地点级倍率 z18');
ok(targetFromPlace('NonexistentXYZ') === null, '匹配不到返回 null（不猜校区中心）');
ok(targetFromPlace('') === null, '空串返回 null');
ok(targetFromPlace(null) === null, 'null 返回 null');
ok(targetFromPlace('Ｉ４０４') === null || targetFromPlace('Ｉ４０４') !== null, '全角文本不崩（归一化交给 CampusLocations.match）');
eq(STORAGE_MAP_NAV, 'ui_map_nav', '切模块键');
// 一次性 consume
requestMapTarget({ name: 'T', campus: '良乡校区', x: 0.8, y: 0.3, scale: 5 });
const t1 = consumeMapTarget();
eq(t1 && t1.name, 'T', 'consume 取到目标');
ok(consumeMapTarget() === null, 'consume 一次即清空（旋转不重复弹）');
// 静态接线
const schedPage = src('entry/src/main/ets/pages/SchedulePage.ets');
ok(schedPage.includes('this.locateSelectedOnMap()'), '课程详情有「在地图查看」入口');
ok(schedPage.includes('requestMapTarget(target)'), '点按写定位目标');
ok(schedPage.includes('AppStorage.setOrCreate<string>(STORAGE_MAP_NAV'), '点按切到 map 模块');
const idx = src('entry/src/main/ets/pages/Index.ets');
ok(idx.includes("@Watch('onMapNav')"), 'Index @Watch 监听切模块请求');
ok(idx.includes("this.selectModule('map')"), 'Index 消费后切到图页');
ok(mapPage.includes('consumeMapTarget()'), 'MapPage onPageEnd 消费目标');
ok(mapPage.includes("this.tip = '已定位到'"), 'MapPage 显示定位提示');

console.log('=== G07-03 瓦片磁盘缓存策略 ===');
eq(TILE_TTL_MS, 7 * 24 * 60 * 60 * 1000, 'TTL = 7 天（对齐 Android cacheTime）');
eq(TILE_MAX_BYTES, 10 * 1024 * 1024, '上限 = 10MB（对齐 Android cacheSize）');
eq(tileCacheKey(16, 123, 45), '16/123/45', '瓦片键 z/col/row');
eq(isExpired(1000, 1000 + TILE_TTL_MS - 1), false, 'TTL 内未过期');
eq(isExpired(1000, 1000 + TILE_TTL_MS), true, '满 7 天即过期');
eq(isExpired(1000, 1000 + 8 * 24 * 60 * 60 * 1000), true, '超期过期');
eq(isExpired(NaN, 1000), true, '非法时间戳按过期');
eq(isExpired(1000 + 120000, 1000), true, '未来时间戳（时钟回拨）按过期');
const es = [
  { key: 'a', bytes: 3, usedAt: 10 },
  { key: 'b', bytes: 4, usedAt: 20 },
  { key: 'c', bytes: 5, usedAt: 30 },
];
eq(totalBytes(es), 12, '字节合计');
eq(evictKeys(es, 12).length, 0, '未超限不淘汰');
const ev = evictKeys(es, 8);
eq(ev[0], 'a', '超限先淘汰最旧 a');
eq(ev[1], 'b', '再淘汰 b，剩 c=5≤8');
eq(es.length, 3, 'evictKeys 不改入参');
ok(TILE_KEY_PREFIX.length > 0 && TILE_INDEX_KEY.length > 0, '键前缀/索引键已定义（供 map.html 守卫对照）');
// 静态接线：ArkWeb HTTP 磁盘缓存 + 署名 + 无 cache-buster
ok(mapPage.includes('.cacheMode(CacheMode.Default)'), 'MapPage 显式启用 ArkWeb HTTP 磁盘缓存');
const html = src('entry/src/main/resources/rawfile/map.html');
ok(html.includes('© OpenStreetMap contributors'), 'ODbL 署名常驻');
ok(/img\.src\s*=\s*'https:\/\/map\.bit101\.flwfdd\.xyz\/tile\/'/.test(html), '瓦片 URL 无随机参数（缓存 key 稳定）');
ok(!html.includes('?t=') && !html.includes('Date.now() +'), '无 cache-buster');

console.log('=== G07-06 外链策略 ===');
eq(hostOf('https://bit101.cn/a'), 'bit101.cn', '取主机');
eq(hostOf('http://10.0.0.55/'), '10.0.0.55', '取内网 IP 主机');
eq(hostOf('not a url'), '', '非法 URL 空主机');
eq(isSchoolHost('jxzxehall.bit.edu.cn'), true, '学校子域');
eq(isSchoolHost('bit.edu.cn'), true, '学校根域');
eq(isSchoolHost('bit101.cn'), false, 'bit101.cn 不是学校域');
eq(isBit101Host('bit101.cn'), true, 'bit101 根域');
eq(isBit101Host('www.bit101.cn'), true, 'bit101 子域');
eq(BIT101_ROOT, 'bit101.cn', 'BIT101 根域常量');
eq(CAMPUS_NET_PORTAL_HOST, '10.0.0.55', '校园网门户常量');
eq(shouldStayInApp('https://bit101.cn/foo'), true, 'bit101.cn 留 App 内');
eq(shouldStayInApp('http://10.0.0.55/'), true, '校园网门户留 App 内');
eq(shouldStayInApp('https://jxzxehall.bit.edu.cn/'), true, '学校域留 App 内');
eq(shouldStayInApp('https://www.baidu.com/'), false, '外部交系统浏览器');
eq(shouldStayInApp('ftp://bit101.cn/x'), false, '非 http(s) 不留内');
eq(shouldHandOff('https://www.baidu.com/'), true, '外链拦下交出去');
eq(shouldHandOff('https://bit101.cn/'), false, '内部不拦');
eq(shouldHandOff(null), false, '空 URL 不拦');
eq(isHttpUrl('https://a.com'), true, 'http(s) 判定');
eq(isHttpUrl('about:blank'), false, '非 http(s) 判定');
const wsvc = src('entry/src/main/ets/pages/WebServicesPage.ets');
ok(wsvc.includes('openExternal'), '网页服务页有外部浏览器拉起');
ok(!wsvc.includes('本版不做外部浏览器跳转'), '旧「本版不跳」提示已替换');
for (const p of ['entry/src/main/ets/pages/WorldWebPage.ets', 'entry/src/main/ets/pages/WebShellPage.ets']) {
  const s = src(p);
  ok(s.includes('.onLoadIntercept('), p + ' Web 组件内拦截');
  ok(s.includes('this.handOffExternal('), p + ' 拦下的链接交系统');
}

console.log('\nALL PASS  pass=' + pass + ' fail=0');
process.exit(0);
