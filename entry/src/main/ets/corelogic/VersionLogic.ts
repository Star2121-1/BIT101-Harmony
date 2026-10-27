/**
 * 版本号与更新说明的**纯逻辑**（M10-4）。
 *
 * 两件事：
 *  1. 版本号解析/比较 —— 形如 `1.0.0-alpha.9`（`versionName`）。比较只用于
 *     「本地版本 vs 更新说明里最新一条」，不做联网检查（本应用**不自动下载更新**，
 *     更新一律引导去应用市场）。
 *  2. 更新说明（`rawfile/changelog.json`）的解析 —— 形状不对就返回空，
 *     **不猜**（宁可少显示一段历史，也不要显示错版本号）。
 *
 * ⚠️ 语义细节：`1.0.0` > `1.0.0-alpha.9`（正式版高于预发布版）；
 * 预发布之间按字符串比（`alpha.9` < `alpha.10` 是**按段比数字**，这里按段处理）。
 */

/** 解析后的版本号。 */
export interface VersionParts {
  major: number;
  minor: number;
  patch: number;
  /** 预发布标记（`alpha.9` / `beta` / `rc.1`）；正式版为空串。 */
  pre: string;
}

/** 解析 `X.Y.Z[-pre]`；认不出返回 null（不猜）。 */
export function parseVersion(v: string): VersionParts | null {
  const s: string = v.trim();
  if (s.length === 0) {
    return null;
  }
  let core: string = s;
  let pre: string = '';
  const dash: number = s.indexOf('-');
  if (dash >= 0) {
    core = s.substring(0, dash);
    pre = s.substring(dash + 1);
  }
  const parts: string[] = core.split('.');
  if (parts.length < 2 || parts.length > 3) {
    return null;
  }
  const major: number = toInt(parts[0]);
  const minor: number = toInt(parts[1]);
  const patch: number = parts.length === 3 ? toInt(parts[2]) : 0;
  if (major < 0 || minor < 0 || patch < 0) {
    return null;
  }
  return { major: major, minor: minor, patch: patch, pre: pre };
}

function toInt(s: string): number {
  const t: string = s.trim();
  if (t.length === 0) {
    return -1;
  }
  for (let i = 0; i < t.length; i++) {
    const c: string = t.charAt(i);
    if (c < '0' || c > '9') {
      return -1;
    }
  }
  return Number(t);
}

/** 预发布串比较：按 `.` 切段，数字段按数值比，其它按字符串比。 */
function comparePre(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  // 正式版（空）高于任何预发布
  if (a.length === 0) {
    return 1;
  }
  if (b.length === 0) {
    return -1;
  }
  const as: string[] = a.split('.');
  const bs: string[] = b.split('.');
  const n: number = Math.min(as.length, bs.length);
  for (let i = 0; i < n; i++) {
    const an: number = toInt(as[i]);
    const bn: number = toInt(bs[i]);
    if (an >= 0 && bn >= 0) {
      if (an !== bn) {
        return an < bn ? -1 : 1;
      }
      continue;
    }
    if (as[i] !== bs[i]) {
      return as[i] < bs[i] ? -1 : 1;
    }
  }
  if (as.length === bs.length) {
    return 0;
  }
  return as.length < bs.length ? -1 : 1;
}

/**
 * 比较两个版本串。
 * @returns -1（a<b）/ 0（相等或无法比较）/ 1（a>b）
 * ⚠️ 任一侧解析失败返回 0（无法比较就当相等，调用方据此**不**提示更新）。
 */
export function compareVersion(a: string, b: string): number {
  const pa: VersionParts | null = parseVersion(a);
  const pb: VersionParts | null = parseVersion(b);
  if (pa === null || pb === null) {
    return 0;
  }
  if (pa.major !== pb.major) {
    return pa.major < pb.major ? -1 : 1;
  }
  if (pa.minor !== pb.minor) {
    return pa.minor < pb.minor ? -1 : 1;
  }
  if (pa.patch !== pb.patch) {
    return pa.patch < pb.patch ? -1 : 1;
  }
  return comparePre(pa.pre, pb.pre);
}

/** 更新说明里的一条。 */
export interface ChangelogEntry {
  version: string;
  /** `YYYY-MM-DD`（不校验日期合法性，只当展示文本）。 */
  date: string;
  items: string[];
}

/**
 * 解析 `changelog.json`（`[{"version","date","items":[…]}]`）。
 * 坏条目跳过而不是整体失败（一个版本写错不该让整页空白）。
 */
export function parseChangelog(raw: string): ChangelogEntry[] {
  if (raw.trim().length === 0) {
    return [];
  }
  let parsed: Object | null = null;
  try {
    parsed = JSON.parse(raw) as Object;
  } catch (e) {
    return [];
  }
  if (parsed === null || !Array.isArray(parsed)) {
    return [];
  }
  const rows: Object[] = parsed as Object[];
  const out: ChangelogEntry[] = [];
  for (let i = 0; i < rows.length; i++) {
    const rec: Record<string, Object> | null = asRec(rows[i]);
    if (rec === null) {
      continue;
    }
    const version: string = strOr(rec['version'], '');
    if (parseVersion(version) === null) {
      continue; // 版本号认不出 → 这一条不要（展示层要靠它排序）
    }
    const date: string = strOr(rec['date'], '');
    const items: string[] = strArrayOr(rec['items']);
    if (items.length === 0) {
      continue;
    }
    out.push({ version: version, date: date, items: items });
  }
  // 新→旧排序（同版本保持原序）
  out.sort((x: ChangelogEntry, y: ChangelogEntry) => -compareVersion(x.version, y.version));
  return out;
}

/** 清单里最新的版本号（空清单返回空串）。 */
export function latestVersion(list: ChangelogEntry[]): string {
  if (list.length === 0) {
    return '';
  }
  let best: string = list[0].version;
  for (let i = 1; i < list.length; i++) {
    if (compareVersion(list[i].version, best) > 0) {
      best = list[i].version;
    }
  }
  return best;
}

/** 页头一行：`1.0.0-alpha.9 (9)`。 */
export function versionLine(name: string, code: number): string {
  const n: string = name.trim();
  if (n.length === 0) {
    return '取不到版本号';
  }
  return n + ' (' + code + ')';
}

/**
 * 「是否有更新说明比当前版本更新」——**只用于提示文案**，不代表有可下载的包。
 */
export function hasNewerNotes(current: string, list: ChangelogEntry[]): boolean {
  const latest: string = latestVersion(list);
  if (latest.length === 0) {
    return false;
  }
  return compareVersion(latest, current) > 0;
}

function asRec(v: Object | null | undefined): Record<string, Object> | null {
  if (v === null || v === undefined || typeof v !== 'object' || Array.isArray(v)) {
    return null;
  }
  return v as Record<string, Object>;
}

function strOr(v: Object | undefined, fallback: string): string {
  return typeof v === 'string' ? v as string : fallback;
}

function strArrayOr(v: Object | undefined): string[] {
  if (v === undefined || v === null || !Array.isArray(v)) {
    return [];
  }
  const arr: Object[] = v as Object[];
  const out: string[] = [];
  for (let i = 0; i < arr.length; i++) {
    if (typeof arr[i] === 'string') {
      out.push(arr[i] as string);
    }
  }
  return out;
}
