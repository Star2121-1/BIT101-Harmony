/**
 * 调试落盘：把**诊断用**的长文本写到应用沙箱 files 目录，供 hdc 拉取。
 *
 * 为什么要有这个：hilog 单行会被截断（实测 ~1KB 就截），
 * 而「接口 403 到底返回了什么」这类问题只有看完整正文才能定位（2026-10-20 栽过）。
 *
 * ⚠️ 只放**无凭据**的诊断文本（HTTP 状态、错误页正文、cookie 名）。
 * 绝不写密码 / token / cookie 值 / ticket。
 */

import fs from '@ohos.file.fs';
import { warn } from './BitLog.ts';

let dumpDir: string = '';

export function setDumpDir(dir: string): void {
  dumpDir = dir;
}

/** 覆盖写一个诊断文件；失败只记日志，不影响主流程。 */
export function dumpText(name: string, text: string): void {
  if (dumpDir.length === 0) {
    return;
  }
  const path: string = dumpDir + '/' + name;
  try {
    const f = fs.openSync(path, fs.OpenMode.CREATE | fs.OpenMode.READ_WRITE | fs.OpenMode.TRUNC);
    fs.writeSync(f.fd, text);
    fs.closeSync(f);
  } catch (e) {
    warn('dumpText fail ' + name + ': ' + JSON.stringify(e));
  }
}

export function getDumpDir(): string {
  return dumpDir;
}
