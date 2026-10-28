/**
 * 周次串 → **人能读的中文**（纯函数，零依赖）。
 *
 * 输入是教务的 `SKZC`：一串 `'0'/'1'`，第 i 个字符为 `'1'` 表示第 i+1 周上课。
 * 现有 UI 直接显示 `[1][2][3][4]` 这种标记串（`skzcToWeeks` 的产物，那是**内部匹配用的**，
 * 不是给人看的）。这里给详情面板与无障碍文案一套可读写法。
 *
 * 规则（都能被证伪）：
 *  - 全部是奇数周 / 全部是偶数周 ⇒ 段内按 2 递增合并，后缀「(单)」/「(双)」；
 *  - 否则按 1 递增合并；
 *  - 单周单列（`3`），两周边界写作 `1-3`；
 *  - 多段用逗号连接：`1-4,6-8周`；
 *  - 空串 / 全 `0` ⇒ `未标注`（不猜「全学期」）。
 */

/** 解析出实际上课的周号（1 起）。非法字符当 `0` 处理。 */
export function activeWeeks(skzc: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < skzc.length; i++) {
    if (skzc.charAt(i) === '1') {
      out.push(i + 1);
    }
  }
  return out;
}

/** 是否全为同奇偶（用于判断单/双周）。空数组返回 false。 */
function sameParity(weeks: number[]): boolean {
  if (weeks.length === 0) {
    return false;
  }
  const odd: boolean = weeks[0] % 2 === 1;
  for (let i = 1; i < weeks.length; i++) {
    if ((weeks[i] % 2 === 1) !== odd) {
      return false;
    }
  }
  return true;
}

/** 连续段（按 step）→ `['1-4', '6-8']` 形式。 */
function ranges(weeks: number[], step: number): string[] {
  const out: string[] = [];
  if (weeks.length === 0) {
    return out;
  }
  let start: number = weeks[0];
  let prev: number = weeks[0];
  for (let i = 1; i < weeks.length; i++) {
    const w: number = weeks[i];
    if (w === prev + step) {
      prev = w;
      continue;
    }
    out.push(start === prev ? String(start) : (start + '-' + prev));
    start = w;
    prev = w;
  }
  out.push(start === prev ? String(start) : (start + '-' + prev));
  return out;
}

/**
 * 主函数：`'11111111'` → `1-8周`；`'10101010'` → `1-7周(单)`；`'1111'` → `1-4周`。
 */
export function weekSpanText(skzc: string): string {
  const weeks: number[] = activeWeeks(skzc);
  if (weeks.length === 0) {
    return '未标注';
  }
  const parity: boolean = sameParity(weeks);
  const step: number = parity ? 2 : 1;
  const body: string = ranges(weeks, step).join(',');
  // 单个周不给「(单)」——「3周(单)」是废话
  const suffix: string = parity && weeks.length >= 2
    ? (weeks[0] % 2 === 1 ? '(单)' : '(双)')
    : '';
  return body + '周' + suffix;
}

/** 总周数（有多少周要上课），用于摘要「共 16 周」。 */
export function weekCount(skzc: string): number {
  return activeWeeks(skzc).length;
}

/** 学期总周数（串长），用于「第 3/16 周」这类显示。 */
export function totalWeeks(skzc: string): number {
  return skzc.length;
}
