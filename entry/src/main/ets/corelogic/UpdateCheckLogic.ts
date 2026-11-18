/**
 * 版本检查的纯逻辑（#158）。
 *
 * 服务端契约（Android `GET /version`，host `android.bit101.cn`）：
 * ```json
 * {"min_version_code":3,"min_version_name":"1.1.0","version_code":5,
 *  "version_name":"1.2.0","url":"...apk","msg":"更新说明"}
 * ```
 * snake_case；无统一 envelope。
 *
 * ## 只读 + 不下载（铁律）
 * - 只判断"要不要提示更新"，**不做任何下载/安装**：鸿蒙不能装 APK，
 *   Android 的 `url` 字段对鸿蒙用户无意义（不展示、不点开）。
 * - 更新一律引导去应用市场。
 * - 坏数据（缺字段/类型不对/版本号解析失败）一律返回"无需提示"，**不谎报有新版本**。
 *
 * ## 版本量纲
 * 强制更新按 `versionCode`（整数）比较——与服务端同量纲，避免 versionName
 * 的 alpha/beta 预发布字符串比较歧义。versionName 只用于展示。
 *
 * 无 @kit，可在 Node 单测跑。
 */

/** 服务端 /version 响应（转成 camelCase 后在内部用）。 */
export interface RemoteVersion {
  minVersionCode: number;
  minVersionName: string;
  versionCode: number;
  versionName: string;
  url: string;
  msg: string;
}

/** 本机版本（bundleManager 读到的）。 */
export interface LocalVersion {
  versionName: string;
  versionCode: number;
}

/** 更新提示档位。 */
export enum UpdateLevel {
  /** 无需提示（含坏数据/已是最新）。 */
  NONE = 'none',
  /** 有新版本，但不强制。 */
  OPTIONAL = 'optional',
  /** 低于最低版本，强制更新。 */
  REQUIRED = 'required',
}

/** 判定结果。 */
export interface UpdateDecision {
  level: UpdateLevel;
  /** 是否真的拿到并解析了服务端数据。false = 检查失败/坏数据，UI 不能显示"已是最新"（假通过）。 */
  checked: boolean;
  /** 给 UI 的一句话说明（NONE 时为空串）。 */
  message: string;
  /** 服务端最新 versionName（展示用；坏数据为空串）。 */
  latestName: string;
  /** 更新说明 msg（展示用；坏数据为空串）。 */
  note: string;
}

/** 把 /version 的 JSON（可能是 snake_case 原始对象）安全转成 RemoteVersion；坏数据返回 null（不猜）。 */
export function parseRemoteVersion(raw: Object | null): RemoteVersion | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  const r: Record<string, Object> = raw as Record<string, Object>;
  const minCode: number = numField(r, 'min_version_code', 'minVersionCode');
  const minName: string = strField(r, 'min_version_name', 'minVersionName');
  const code: number = numField(r, 'version_code', 'versionCode');
  const name: string = strField(r, 'version_name', 'versionName');
  const msg: string = strField(r, 'msg', 'msg');
  // 关键字段缺失/非法 ⇒ 不猜，直接 null
  if (minCode < 0 || code < 0 || name.length === 0) {
    return null;
  }
  return {
    minVersionCode: minCode,
    minVersionName: minName,
    versionCode: code,
    versionName: name,
    url: strField(r, 'url', 'url'),
    msg: msg
  };
}

/**
 * 判定更新档位。
 * - 本机 versionCode < minVersionCode ⇒ REQUIRED（强制）
 * - 本机 versionCode < versionCode ⇒ OPTIONAL（可选）
 * - 否则 NONE
 * 坏数据（remote/local 非法）⇒ NONE，不谎报。
 */
export function decideUpdate(remote: RemoteVersion | null, local: LocalVersion | null): UpdateDecision {
  const failed: UpdateDecision = {
    level: UpdateLevel.NONE, checked: false, message: '', latestName: '', note: ''
  };
  const upToDate: UpdateDecision = {
    level: UpdateLevel.NONE, checked: true, message: '', latestName: remote !== null ? remote.versionName : '', note: ''
  };
  if (remote === null || local === null) {
    return failed;
  }
  if (local.versionCode < 0 || !Number.isFinite(local.versionCode)) {
    return failed;
  }
  const latestName: string = remote.versionName;
  const note: string = remote.msg;
  if (local.versionCode < remote.minVersionCode) {
    return {
      level: UpdateLevel.REQUIRED, checked: true,
      message: '当前版本过低，请到应用市场更新',
      latestName: latestName,
      note: note
    };
  }
  if (local.versionCode < remote.versionCode) {
    return {
      level: UpdateLevel.OPTIONAL, checked: true,
      message: '有新版本，可到应用市场更新',
      latestName: latestName,
      note: note
    };
  }
  return upToDate;
}

/** 展示用的更新说明（只取 msg，绝不返回 android APK 的 url）。 */
export function updateNote(remote: RemoteVersion | null): string {
  return remote === null ? '' : remote.msg;
}

function strField(r: Record<string, Object>, snake: string, camel: string): string {
  let v: Object | undefined = r[snake];
  if (v === undefined) {
    v = r[camel];
  }
  return typeof v === 'string' ? v : '';
}

function numField(r: Record<string, Object>, snake: string, camel: string): number {
  let v: Object | undefined = r[snake];
  if (v === undefined) {
    v = r[camel];
  }
  if (typeof v === 'number' && Number.isFinite(v)) {
    return v;
  }
  if (typeof v === 'string' && v.trim().length > 0) {
    const n: number = Number(v);
    return Number.isFinite(n) ? n : -1;
  }
  return -1;
}
