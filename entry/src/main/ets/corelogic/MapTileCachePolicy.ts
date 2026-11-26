/**
 * 地图瓦片**磁盘缓存策略**（G07-03，对齐 Android `MapViewModel.kt:33-37`）。
 *
 * Android：OkHttp Cache，7 天 `maxAge`、上限 10MB。鸿蒙 WebView 内 JS 不能直接写盘，
 * 但 `domStorageAccess(true)` 后的 localStorage 是**磁盘持久化**的（不依赖 WebView 内存），
 * 所以按同一口径在 `map.html` 里落地：瓦片 PNG 转 base64 存 localStorage，
 * 读时判 7 天 TTL、写后按 LRU 淘汰到 10MB 以内。
 *
 * 本文件只放纯策略常量与判定函数，Node 可单测；`map.html` 内联同一口径的实现
 * （静态守卫逐条对照常量，防止两处漂移）。ODbL 署名在 `map.html:19` 常驻不动。
 */

/** 过期时间：7 天（对齐 Android `cacheTime = 7 * 24 * 60 * 60`）。 */
export const TILE_TTL_MS: number = 7 * 24 * 60 * 60 * 1000;
/** 容量上限：10MB（对齐 Android `cacheSize = 10 * 1024 * 1024L`）。 */
export const TILE_MAX_BYTES: number = 10 * 1024 * 1024;
/** localStorage 键前缀（单一来源，守卫核对 map.html 内联值）。 */
export const TILE_KEY_PREFIX: string = 'tile/';
/** 索引键：存所有已缓存瓦片的 key/大小/最近使用时间，供 LRU 淘汰。 */
export const TILE_INDEX_KEY: string = 'tile_index';

/** 一条缓存记录（对应 map.html 里 index 数组的一项）。 */
export interface TileEntry {
  key: string;
  bytes: number;
  usedAt: number;
}

/** 瓦片键：z/col/row（与服务端路径、map.html 内存 tileCache 同一口径）。 */
export function tileCacheKey(z: number, col: number, row: number): string {
  return z.toString() + '/' + col.toString() + '/' + row.toString();
}

/** 是否过期（savedAt 为写入时刻；now 为当前时刻）。 */
export function isExpired(savedAt: number, now: number): boolean {
  if (!Number.isFinite(savedAt) || !Number.isFinite(now)) {
    return true;
  }
  // 未来时间戳 = 设备时钟回拨过，按过期处理，避免瓦片被永久缓存
  if (savedAt > now + 60 * 1000) {
    return true;
  }
  return now - savedAt >= TILE_TTL_MS;
}

/** 索引里所有条目的字节数合计。 */
export function totalBytes(entries: TileEntry[]): number {
  let n: number = 0;
  for (let i = 0; i < entries.length; i++) {
    n += entries[i].bytes;
  }
  return n;
}

/**
 * 按 LRU 选出要淘汰的 key（最旧 usedAt 优先），直到总量 ≤ maxBytes。
 * 不改入参；返回空数组表示无需淘汰。单条超过上限时也照样淘汰它自己。
 */
export function evictKeys(entries: TileEntry[], maxBytes: number): string[] {
  let sum: number = totalBytes(entries);
  if (sum <= maxBytes) {
    return [];
  }
  const sorted: TileEntry[] = entries.slice().sort((a: TileEntry, b: TileEntry) => a.usedAt - b.usedAt);
  const out: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    if (sum <= maxBytes) {
      break;
    }
    out.push(sorted[i].key);
    sum -= sorted[i].bytes;
  }
  return out;
}
