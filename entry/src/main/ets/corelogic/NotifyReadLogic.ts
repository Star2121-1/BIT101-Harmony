/**
 * 通知「已读」的纯逻辑（M15-B3）。
 *
 * ## 为什么不再用「上次打开时刻」
 * 时间戳只能表达「这个时刻之前的都算读过」。一旦出现：
 *  - 通知晚到，但 `firedMillis` 落在上次打开之前；
 *  - 重排/合并把旧记录重新带回来；
 *  - 本机时钟回拨；
 * 就会把**没看过的消息当成已读**，或反过来让旧消息复活。
 *
 * 这里改成**显式键快照**：只有真正在打开通知页时被标记过的 `NotifyRecord.key`
 * 才算已读。键不变（重排只改显示字段）⇒ 已读不会因重排丢失；新键（新一次提醒）
 * ⇒ 必须是未读。
 *
 * ## 边界
 * - 只记已发出的（`firedMillis > 0`）；排期中/永远不会发的不是「未读」；
 * - 快照最多 1024 个键（全局，不按分类拆）。记录本身 14 天清理，1024 足够覆盖；
 *   超出时丢最旧的键，宁可多显示一条未读，也不把整个列表锁死；
 * - JSON 由 data 层原子写（单键 `putString` + flush），本模块不碰 Prefs。
 */

/** 快照结构版本；版本不匹配按损坏处理，回落旧时间戳迁移，不硬读未知结构。 */
export const NOTIFY_READ_VERSION: number = 1;

/** 快照最多保留的已读键数。 */
export const MAX_READ_KEYS: number = 1024;

/** 单键长度上限（脏数据/注入的防线；正常 key = 标题 + ISBN + 应还日）。 */
const MAX_KEY_LEN: number = 2048;

/** 已读快照（只存原始事实：键列表 + 版本）。 */
export interface NotifyReadSnapshot {
  version: number;
  keys: string[];
}

/** 未读判定只需要这两个字段（`NotifyRecord` 结构兼容）。 */
export interface NotifyReadItem {
  key: string;
  firedMillis: number;
}

/** 空快照。 */
export function emptyReadSnapshot(): NotifyReadSnapshot {
  return { version: NOTIFY_READ_VERSION, keys: [] };
}

/**
 * 校正/净化快照：版本不对 → null（让调用方回落旧时间戳）。
 * 合法时去重、丢掉空键/超长键，并只保留最后 1024 个（新标记的优先）。
 */
export function normalizeReadSnapshot(raw: Object | null): NotifyReadSnapshot | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  const rec: Record<string, Object> = raw as Record<string, Object>;
  const version: Object | undefined = rec['version'];
  if (typeof version !== 'number' || (version as number) !== NOTIFY_READ_VERSION) {
    return null;
  }
  const rawKeys: Object | undefined = rec['keys'];
  if (!Array.isArray(rawKeys)) {
    return null;
  }
  const arr: Object[] = rawKeys as Object[];
  const seen: Set<string> = new Set<string>();
  const out: string[] = [];
  for (let i = 0; i < arr.length; i++) {
    if (typeof arr[i] !== 'string') {
      continue;
    }
    const k: string = (arr[i] as string).trim();
    if (k.length === 0 || k.length > MAX_KEY_LEN || seen.has(k)) {
      continue;
    }
    seen.add(k);
    out.push(k);
  }
  return { version: NOTIFY_READ_VERSION, keys: capKeys(out) };
}

/** 只保留最后 MAX_READ_KEYS 个（数组顺序 = 标记先后）。 */
function capKeys(keys: string[]): string[] {
  if (keys.length <= MAX_READ_KEYS) {
    return keys;
  }
  return keys.slice(keys.length - MAX_READ_KEYS);
}

/** 已发出的记录键（打开通知页时把这一批标记为已读）。 */
export function firedKeys(records: NotifyReadItem[]): string[] {
  const out: string[] = [];
  const seen: Set<string> = new Set<string>();
  for (let i = 0; i < records.length; i++) {
    if (records[i].firedMillis <= 0) {
      continue;
    }
    const k: string = records[i].key;
    if (k.length === 0 || seen.has(k)) {
      continue;
    }
    seen.add(k);
    out.push(k);
  }
  return out;
}

/**
 * 未读数 = 已发出且不在快照里的记录数。
 * 同一 key 出现多次只算一条（记录表理论上已按 key 去重，这里再兜一次）。
 */
export function unreadFromSnapshot(records: NotifyReadItem[], snapshot: NotifyReadSnapshot): number {
  const read: Set<string> = new Set<string>();
  for (let i = 0; i < snapshot.keys.length; i++) {
    read.add(snapshot.keys[i]);
  }
  const counted: Set<string> = new Set<string>();
  let n: number = 0;
  for (let i = 0; i < records.length; i++) {
    const rec: NotifyReadItem = records[i];
    if (rec.firedMillis <= 0 || read.has(rec.key) || counted.has(rec.key)) {
      continue;
    }
    counted.add(rec.key);
    n += 1;
  }
  return n;
}

/**
 * 旧时间戳 → 初始快照（只做一次迁移）。
 *
 * 旧语义是「`firedMillis <= lastSeen` 算已读」，这里把当时确实已发且早于/等于
 * 该时刻的键种进快照；之后不再依赖时间戳。`lastSeen <= 0`（从没打开过）→ 空。
 */
export function seedSnapshotFromLegacy(records: NotifyReadItem[], lastSeenMillis: number): NotifyReadSnapshot {
  if (!Number.isFinite(lastSeenMillis) || lastSeenMillis <= 0) {
    return emptyReadSnapshot();
  }
  const keys: string[] = [];
  const seen: Set<string> = new Set<string>();
  for (let i = 0; i < records.length; i++) {
    const rec: NotifyReadItem = records[i];
    if (rec.firedMillis <= 0 || rec.firedMillis > lastSeenMillis || seen.has(rec.key)) {
      continue;
    }
    seen.add(rec.key);
    keys.push(rec.key);
  }
  return { version: NOTIFY_READ_VERSION, keys: capKeys(keys) };
}

/**
 * 把一批键并入快照（幂等；已存在的不重复追加）。
 * 超过上限时丢最旧的键。
 */
export function mergeReadKeys(snapshot: NotifyReadSnapshot, keys: string[]): NotifyReadSnapshot {
  const seen: Set<string> = new Set<string>();
  const out: string[] = [];
  for (let i = 0; i < snapshot.keys.length; i++) {
    const k: string = snapshot.keys[i];
    if (!seen.has(k)) {
      seen.add(k);
      out.push(k);
    }
  }
  for (let i = 0; i < keys.length; i++) {
    const k: string = keys[i].trim();
    if (k.length === 0 || k.length > MAX_KEY_LEN || seen.has(k)) {
      continue;
    }
    seen.add(k);
    out.push(k);
  }
  return { version: NOTIFY_READ_VERSION, keys: capKeys(out) };
}
