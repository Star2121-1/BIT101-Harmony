/**
 * 座位 500 方案 A′ 纯逻辑：从 JAR_CAS 罐快照里筛 seatlib 域 cookie，独立持久化。
 *
 * 为什么不并入 school_cookies_v1：
 * - SchoolCookieStore.save 是**整体覆盖**，再调一次 snapshotAndSave 会毁掉教务会话；
 * - test-seat500rc 锁死"school_cookies_v1 只有 sso/jxzx 10 条、无 seatlib"的事实；
 * - 独立 key 让 test-sso「只下沉 sso 域、不串罐」语义完全不受影响。
 *
 * 不串罐保证：isSeatlibDomain 只认 seatlib 主域及真子域，与 isSsoDomain 完全隔离，
 * 互不调用；筛出的记录 domain 原样保留，绝不改写。
 * 纯函数，不 import @kit，可离线单测。
 */

/** 只认 seatlib.bit.edu.cn 及其真子域；前导点/大小写归一（对齐 SchoolDomains.normalize）。 */
export function isSeatlibDomain(host: string | null | undefined): boolean {
  const h: string = (host === null || host === undefined ? '' : host)
    .trim().replace(/^\.+/, '').toLowerCase();
  return h === 'seatlib.bit.edu.cn' || h.endsWith('.seatlib.bit.edu.cn');
}

export interface SeatCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
}

/**
 * 从全量快照里筛 seatlib 域记录。
 * - 只要 isSeatlibDomain 命中，name/domain 非空；
 * - domain/path 原样保留（path 空回落 '/'），绝不改写 domain；
 * - 按 name@domain 去重（幂等）。
 */
export function filterSeatlibCookies(all: SeatCookie[]): SeatCookie[] {
  const out: SeatCookie[] = [];
  const seen: Set<string> = new Set<string>();
  for (const c of all) {
    if (c.name.length === 0 || c.domain.length === 0) continue;
    if (!isSeatlibDomain(c.domain)) continue;
    const key: string = c.name + '@' + c.domain.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path.length > 0 ? c.path : '/'
    });
  }
  return out;
}
