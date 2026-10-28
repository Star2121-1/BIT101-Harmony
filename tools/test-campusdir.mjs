// 楼栋索引纯逻辑守卫（P4）。
//
// 判据：校区顺序固定、楼栋数不丢、别名归一化能搜到、搜索命中不到就给空（不猜）、
// 课程按楼归集时**匹配不到的地点被跳过**（不建「未知楼栋」）、经纬度/geo URI 形状正确。
//
//   node --experimental-transform-types tools/test-campusdir.mjs

import {
  groupByCampus, campusNames, searchBuildings, coursesByBuilding, coursesAt, lonLatText, geoUri,
} from '../entry/src/main/ets/corelogic/CampusDirectory.ts';

let pass = 0;
let fail = 0;
function ok(cond, msg, extra) {
  if (cond) {
    pass++;
    console.log('PASS ' + msg);
  } else {
    fail++;
    console.log('FAIL ' + msg + (extra === undefined ? '' : '  → ' + extra));
  }
}

// ── 1. 校区分组 ───────────────────────────────────────────────────────────
const groups = groupByCampus();
ok(groups.length === 2, '两个校区', 'groups=' + groups.length);
ok(groups[0].campus === '良乡校区' && groups[1].campus === '中关村校区', '良乡在前、中关村在后',
  groups.map((g) => g.campus).join(','));
const total = groups[0].buildings.length + groups[1].buildings.length;
ok(total === 48, '楼栋总数 48（34 良乡 + 14 中关村）', String(total));
ok(groups[0].buildings.length === 34 && groups[1].buildings.length === 14, '分校区数量正确',
  groups[0].buildings.length + '/' + groups[1].buildings.length);

// 组内按名称排序
const names = groups[0].buildings.map((b) => b.name);
const sorted = names.slice().sort();
ok(JSON.stringify(names) === JSON.stringify(sorted), '组内按名称排序');
ok(campusNames().length === 2, 'campusNames 与分组一致');

// ── 2. 搜索 ───────────────────────────────────────────────────────────────
const wencui = searchBuildings('文萃', '良乡校区');
// 构成：文萃楼（整体）+ A~M（13）+ 文萃楼圆形报告厅 = 15（不是 13，实测）
ok(wencui.length === 15, '「文萃」在良乡命中 15 栋（整体 + A~M + 圆形报告厅）', String(wencui.length));
const wencuiNames = wencui.map((b) => b.name);
const allWings = ['A','B','C','D','E','F','G','H','I','J','K','L','M'].every((x) => wencuiNames.indexOf('文萃楼' + x) >= 0);
ok(allWings, 'A~M 十三翼全在结果里', wencuiNames.join(','));
ok(wencui[0].name.startsWith('文萃楼'), '前缀命中排前', wencui[0].name);

const allOfZgc = searchBuildings('', '中关村校区');
ok(allOfZgc.length === 14, '空查询 + 校区 = 该校区全部', String(allOfZgc.length));

const emptyQ = searchBuildings('', '');
ok(emptyQ.length === 48, '空查询 + 无校区 = 全部', String(emptyQ.length));

ok(searchBuildings('前沿楼', '').length === 0, '表里没有的楼 → 空（不猜）');
ok(searchBuildings('图书馆', '中关村校区').length >= 1, '别名/名称能搜到图书馆');
// 全角输入也能搜到
ok(searchBuildings('文萃楼Ｉ', '').length >= 1, '全角 Ｉ 归一化后能搜到文萃楼I',
  String(searchBuildings('文萃楼Ｉ', '').length));

// ── 3. 课程按楼归集 ───────────────────────────────────────────────────────
const courses = [
  { name: '高等数学', place: '文萃楼I404' },
  { name: '高等数学', place: '文萃楼I405' },   // 同楼同课 → 去重
  { name: '数据结构', place: '文萃楼Ｊ201' },   // 全角 J
  { name: '大学物理', place: '前沿楼101' },     // 表里没有 → 跳过
  { name: '体育', place: '' },                  // 空地点 → 跳过
];
const byBuilding = coursesByBuilding(courses);
const namesHit = byBuilding.map((b) => b.building.name);
ok(namesHit.indexOf('文萃楼I') >= 0, '文萃楼I 归集到', namesHit.join(','));
ok(namesHit.indexOf('文萃楼J') >= 0, '全角 Ｊ 也能归集到文萃楼J', namesHit.join(','));
ok(namesHit.indexOf('前沿楼') < 0, '匹配不到的地点不产生「未知楼栋」', namesHit.join(','));

const iBuilding = byBuilding.filter((b) => b.building.name === '文萃楼I')[0];
ok(iBuilding.courses.length === 1 && iBuilding.courses[0] === '高等数学', '同楼同课去重', JSON.stringify(iBuilding.courses));

// 只返回真有课的楼
ok(byBuilding.length === 2, '只返回有课的 2 栋楼', 'len=' + byBuilding.length);

// coursesAt
const atI = coursesAt('文萃楼I404', courses);
ok(atI.length === 1 && atI[0] === '高等数学', 'coursesAt 按教室名查', JSON.stringify(atI));
ok(coursesAt('文萃楼M', courses).length === 0, '没课的楼 → 空数组');
ok(coursesAt('不存在的楼', courses).length === 0, '未知楼 → 空数组（不抛）');

// ── 4. 经纬度与 geo URI ───────────────────────────────────────────────────
const loc = groups[0].buildings[0];
const txt = lonLatText(loc);
ok(/^-?\d+\.\d{5}, -?\d+\.\d{5}$/.test(txt), '经纬度 5 位小数', txt);
const uri = geoUri(loc);
ok(uri.indexOf('geo:') === 0, 'geo URI 前缀', uri.substring(0, 20));
ok(uri.indexOf('?q=') > 0, 'geo URI 带 ?q= 定位');

console.log('\n' + (fail === 0 ? 'ALL PASS' : 'FAILED') + '  pass=' + pass + ' fail=' + fail);
process.exit(fail === 0 ? 0 : 1);
