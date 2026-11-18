// 版本检查纯逻辑单测（#158）
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parseRemoteVersion, decideUpdate, updateNote, UpdateLevel
} from '../entry/src/main/ets/corelogic/UpdateCheckLogic.ts';

let n = 0;
function ok(cond, name) {
  assert.ok(cond, name);
  n++;
  console.log('  ok ' + n + ' - ' + name);
}

console.log('\n=== 版本检查纯逻辑 (#158) ===');

// 解析 snake_case
{
  const raw = {
    min_version_code: 3, min_version_name: '1.1.0', version_code: 5,
    version_name: '1.2.0', url: 'http://x/BIT101.apk', msg: '更新说明'
  };
  const v = parseRemoteVersion(raw);
  ok(v !== null, '合法响应解析成功');
  ok(v.minVersionCode === 3 && v.versionCode === 5, '数字字段正确');
  ok(v.versionName === '1.2.0' && v.minVersionName === '1.1.0', '字符串字段正确');
  ok(v.msg === '更新说明', 'msg 正确');
}
// camelCase 也兼容
{
  const v = parseRemoteVersion({ minVersionCode: 1, versionCode: 2, versionName: '1.0.1', msg: '' });
  ok(v !== null && v.versionCode === 2, 'camelCase 字段兼容');
}
// 数字字符串兼容
{
  const v = parseRemoteVersion({ min_version_code: '3', version_code: '5', version_name: '1.2.0', msg: '' });
  ok(v !== null && v.versionCode === 5, '数字字符串字段解析');
}
// 坏数据不猜
{
  ok(parseRemoteVersion(null) === null, 'null → null');
  ok(parseRemoteVersion([]) === null, '数组 → null');
  ok(parseRemoteVersion({}) === null, '空对象 → null（缺关键字段）');
  ok(parseRemoteVersion({ version_code: 5, version_name: '' }) === null, '空 versionName → null');
  ok(parseRemoteVersion({ version_code: -1, version_name: '1.2.0' }) === null, '负 versionCode → null');
  ok(parseRemoteVersion({ version_code: 'abc', version_name: '1.2.0' }) === null, '非法数字 → null');
}
// 三档判定
{
  const remote = parseRemoteVersion({
    min_version_code: 10, version_code: 15, version_name: '2.0.0', msg: '大更新', url: 'x'
  });
  ok(decideUpdate(remote, { versionName: '1.0.0', versionCode: 5 }).level === UpdateLevel.REQUIRED,
    '低于最低版本 → REQUIRED');
  ok(decideUpdate(remote, { versionName: '1.5.0', versionCode: 10 }).level === UpdateLevel.OPTIONAL,
    '介于最低与最新 → OPTIONAL');
  ok(decideUpdate(remote, { versionName: '2.0.0', versionCode: 15 }).level === UpdateLevel.NONE,
    '等于最新 → NONE');
  ok(decideUpdate(remote, { versionName: '3.0.0', versionCode: 20 }).level === UpdateLevel.NONE,
    '高于最新 → NONE');
}
// 坏数据 + 空档位
{
  const remote = parseRemoteVersion({ min_version_code: 10, version_code: 15, version_name: '2.0.0', msg: 'M' });
  const d0 = decideUpdate(null, { versionName: '1.0.0', versionCode: 5 });
  ok(d0.level === UpdateLevel.NONE && d0.message === '' && d0.checked === false,
    '坏 remote → NONE 且 checked=false（UI 不显示"已是最新"）');
  const d1 = decideUpdate(remote, null);
  ok(d1.level === UpdateLevel.NONE && d1.checked === false, '坏 local → checked=false');
  const d2 = decideUpdate(remote, { versionName: '1.0.0', versionCode: -1 });
  ok(d2.level === UpdateLevel.NONE && d2.checked === false, '非法 local code → checked=false');
  const d3 = decideUpdate(remote, { versionName: '2.0.0', versionCode: 15 });
  ok(d3.level === UpdateLevel.NONE && d3.checked === true, '确实最新 → checked=true（可显示"已是最新"）');
}
// 展示：只给 msg 和 versionName，绝不给 APK url
{
  const remote = parseRemoteVersion({
    min_version_code: 10, version_code: 15, version_name: '2.0.0',
    msg: '修了很多 bug', url: 'http://x/BIT101-2.0.0.apk'
  });
  const d = decideUpdate(remote, { versionName: '1.0.0', versionCode: 5 });
  ok(d.note === '修了很多 bug' && d.latestName === '2.0.0', '展示取 msg + versionName');
  ok(JSON.stringify(d).indexOf('.apk') < 0, '判定结果不含 APK url（鸿蒙不装 APK）');
  ok(JSON.stringify(d).indexOf('http') < 0, '判定结果不含任何下载链接');
  ok(updateNote(remote) === '修了很多 bug' && updateNote(null) === '', 'updateNote 只取 msg');
}
// 源码栅栏：不含下载/安装
{
  const src = readFileSync('entry/src/main/ets/corelogic/UpdateCheckLogic.ts', 'utf8');
  const codeOnly = src.split('\n').filter(l => !/^\s*\*|^\s*\/\//.test(l)).join('\n');
  ok(!/startAbility|openLink|\.apk|install|download|requestPermissions/.test(codeOnly),
    '版本检查逻辑无下载/安装/拉起动作');
}
// 接线栅栏：服务接纯逻辑、页面有按钮、全链路无下载
{
  const svc = readFileSync('entry/src/main/ets/service/VersionCheckService.ts', 'utf8');
  const page = readFileSync('entry/src/main/ets/pages/AboutPage.ets', 'utf8');
  ok(svc.indexOf('checkForUpdate') >= 0 && svc.indexOf('parseRemoteVersion') >= 0
    && svc.indexOf('decideUpdate') >= 0, 'VersionCheckService 走纯逻辑解析与判定');
  ok(svc.indexOf("android.bit101.cn/version/") >= 0, '版本接口带尾斜杠（绕过 308 重定向）');
  ok(page.indexOf('检查失败') >= 0 && page.indexOf('检查完成') >= 0,
    'AboutPage 区分检查失败与检查完成（服务端是 Android 版公告，不谎报鸿蒙最新）');
  ok(page.indexOf('checkForUpdate') >= 0 && page.indexOf('检查更新') >= 0,
    'AboutPage 有检查更新按钮并调服务');
  for (const [name, s] of [['version-svc', svc], ['about-page', page]]) {
    const c = s.split('\n').filter(l => !/^\s*\*|^\s*\/\//.test(l)).join('\n');
    ok(!/startAbility|openLink|install|download|\.apk/.test(c), name + ' 无下载/安装/拉起动作');
  }
}

console.log('\nALL PASS pass=' + n + ' fail=0');
