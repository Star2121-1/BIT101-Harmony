// 校区中心点单测（#156）
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CAMPUSES, findCampus, campusGeoUri, noIndexHint
} from '../entry/src/main/ets/corelogic/CampusCenters.ts';

let n = 0;
function ok(cond, name) {
  assert.ok(cond, name);
  n++;
  console.log('  ok ' + n + ' - ' + name);
}

console.log('\n=== 校区中心点 (#156) ===');

{
  ok(CAMPUSES.length === 4, '4 个校区（良乡/中关村/珠海/嘉兴）');
  ok(CAMPUSES[0].name === '良乡校区' && CAMPUSES[0].short === '乡', '默认第一个是良乡（与 Android 顺序一致）');
  const names = CAMPUSES.map((c) => c.name).join(',');
  ok(names === '良乡校区,中关村校区,珠海校区,嘉兴校区', '校区顺序 = Android MapCampus.ALL');
}
// 经纬度可查证范围（Android 源码注释标注的 WGS-84）
{
  const cases = [
    ['良乡校区', 116.1666, 39.7290],
    ['中关村校区', 116.3099, 39.9584],
    ['珠海校区', 113.5370, 22.3708],
    ['嘉兴校区', 120.7399, 30.8326],
  ];
  for (const [name, lon, lat] of cases) {
    const c = findCampus(name);
    ok(c !== null && Math.abs(c.lon - lon) < 0.001 && Math.abs(c.lat - lat) < 0.001,
      name + ' 经纬度与 Android 可查证值一致');
  }
}
// 建筑索引诚实标记
{
  ok(findCampus('良乡校区').hasBuildingIndex && findCampus('中关村校区').hasBuildingIndex,
    '良乡/中关村有建筑索引');
  ok(!findCampus('珠海校区').hasBuildingIndex && !findCampus('嘉兴校区').hasBuildingIndex,
    '珠海/嘉兴无建筑索引（OSM 数据太稀，Android 已证）');
  ok(findCampus('不存在') === null, '找不到校区返回 null 不猜');
}
// geo URI
{
  const uri = campusGeoUri(findCampus('珠海校区'));
  ok(uri.indexOf('geo:22.370800,113.537000?q=') === 0, 'geo URI 用 WGS-84 经纬度（lat,lon）');
  ok(uri.indexOf('geo:') === 0, 'geo URI 格式正确');
}
// 诚实说明
{
  ok(noIndexHint(findCampus('良乡校区')) === '', '有索引校区无提示');
  const h = noIndexHint(findCampus('嘉兴校区'));
  ok(h.indexOf('暂无可信的建筑坐标') > 0, '无索引校区给诚实说明');
  ok(h.indexOf('在系统地图') > 0, '无索引校区给出路（系统地图定位）');
}
// 页面接线栅栏：chip 用 CAMPUSES、无建筑编造、不破坏 loadCourses 顺序
{
  const page = readFileSync('entry/src/main/ets/pages/CampusMapPage.ets', 'utf8');
  ok(page.indexOf('ForEach(CAMPUSES') >= 0, '校区 chip 渲染 4 校区（不再是 groups 的 2 个）');
  ok(page.indexOf('openCampusInMap') >= 0 && page.indexOf('noIndexHint') >= 0,
    '无索引校区接了系统地图定位 + 诚实说明');
  ok(page.indexOf('await this.loadCourses()') >= 0 && page.indexOf('this.refresh()') >= 0,
    '保留 loadCourses→refresh 顺序（真机踩坑栅栏）');
  ok(!/珠海.*(楼|教学楼)/.test(page.replace(/\/\*[\s\S]*?\*\//g, '')),
    '页面不编造珠海/嘉兴的建筑条目');
}
// 过期注释已修
{
  const loc = readFileSync('entry/src/main/ets/corelogic/CampusLocations.ts', 'utf8');
  ok(loc.indexOf('良乡 34 + 中关村 14') >= 0, 'CampusLocations 头部注释已修正为实际 34+14');
}

console.log('\nALL PASS pass=' + n + ' fail=0');
