/**
 * 诊断信息的**文本汇总**（纯逻辑，零依赖）。
 *
 * 用途：用户反馈问题时要能「一键复制一段环境信息」，否则只能来回问「你什么版本/什么皮肤/登录了没」。
 *
 * ## 隐私边界（严格）
 *  - **学号脱敏**（保留前 3 后 2，中间 `*`），够定位账号又不泄露完整学号；
 *  - **绝不包含**：密码、cookie/JWT、手机号、姓名、成绩分数、成绩课名；
 *  - 只含「是什么版本 / 什么状态 / 有多少条数据」这类**结构性事实**。
 *
 * ## 为什么是纯函数
 * 页面要「复制」这段文本，而文本必须可被单测钉住（尤其脱敏与「不含敏感字段」两条）。
 */

/** 诊断输入（页面从各 store 读好后传进来）。 */
export interface DiagInput {
  appVersion: string;       // 1.0.0
  buildLabel: string;       // 构建标识（可空）
  deviceModel: string;      // 设备型号
  osVersion: string;        // 系统版本
  loggedIn: boolean;
  studentId: string;        // **原文**，本模块负责脱敏
  term: string;
  termSource: string;       // 跟随教务 / 手动选择
  palette: string;          // 皮肤名
  dark: boolean;
  cacheBytes: number;
  cacheItems: number;
  notifyEnabled: boolean;
  lastScheduleFetch: string;  // 人话，如「2 小时前」；空串表示没有
  lastScoreCheck: string;
}

/** 一行诊断。 */
export interface DiagLine {
  label: string;
  value: string;
}

/**
 * 学号脱敏：`1120201234` → `112*****34`。
 * - 长度 ≤ 4：全星号（太短没有可用信息，全遮最安全）；
 * - 长度 ≥ 5：前 3 + 星号 + 后 2。
 */
export function maskStudent(id: string): string {
  const s: string = id.trim();
  if (s.length === 0) {
    return '未登录';
  }
  if (s.length <= 4) {
    return '****';
  }
  // 星号至少 1 位：长度 5 时若按 `len-5` 算会得到 0 个星号 ⇒ 等于没脱敏（真 bug，被单测抓到）
  const n: number = Math.max(1, s.length - 5);
  let stars: string = '';
  for (let i = 0; i < n; i++) {
    stars += '*';
  }
  return s.substring(0, 3) + stars + s.substring(s.length - 2);
}

/** 布尔 → 中文（不用 ✓/✗：复制到微信里会变成方框）。 */
export function yesNo(v: boolean): string {
  return v ? '是' : '否';
}

/** 结构化行序列（页面 ForEach 渲染，顺序即阅读顺序）。 */
export function diagLines(input: DiagInput): DiagLine[] {
  const out: DiagLine[] = [];
  out.push({ label: '版本', value: input.appVersion + (input.buildLabel.length > 0 ? '（' + input.buildLabel + '）' : '') });
  out.push({ label: '设备', value: input.deviceModel + ' / 系统 ' + input.osVersion });
  out.push({ label: '外观', value: input.palette + (input.dark ? ' · 深色' : ' · 浅色') });
  out.push({ label: '登录状态', value: input.loggedIn ? '已登录' : '未登录' });
  out.push({ label: '学号', value: maskStudent(input.studentId) });
  out.push({ label: '当前学期', value: (input.term.length > 0 ? input.term : '未取到') +
    (input.termSource.length > 0 ? '（' + input.termSource + '）' : '') });
  out.push({ label: '通知权限', value: yesNo(input.notifyEnabled) });
  out.push({ label: '本地缓存', value: String(input.cacheItems) + ' 项 / ' + sizeTextLocal(input.cacheBytes) });
  out.push({ label: '最近课表更新', value: input.lastScheduleFetch.length > 0 ? input.lastScheduleFetch : '无记录' });
  out.push({ label: '最近出分检查', value: input.lastScoreCheck.length > 0 ? input.lastScoreCheck : '无记录' });
  return out;
}

/** 本地体积文本（与 `CacheIndex.sizeText` 同口径；此处内联一份避免模块互相依赖）。 */
function sizeTextLocal(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }
  if (bytes < 1024) {
    return Math.round(bytes) + ' B';
  }
  const kb: number = bytes / 1024;
  if (kb < 1024) {
    return (Math.round(kb * 10) / 10) + ' KB';
  }
  return (Math.round((kb / 1024) * 10) / 10) + ' MB';
}

/**
 * 可复制的整段文本。首行是「离线诊断信息」，末行是免责说明
 * （提醒用户看一眼再发出去 —— 虽然已脱敏，但让粘贴者自己确认是尊重）。
 */
export function diagText(input: DiagInput): string {
  const lines: DiagLine[] = diagLines(input);
  const out: string[] = ['BIT101 鸿蒙版 · 诊断信息'];
  for (let i = 0; i < lines.length; i++) {
    out.push(lines[i].label + '：' + lines[i].value);
  }
  out.push('');
  out.push('（学号已脱敏；不含密码、cookie、成绩内容）');
  return out.join('\n');
}
