/**
 * 读屏文案的**统一口径**（M11-6 扫尾，纯函数、零依赖）。
 *
 * ## 为什么要一层
 * 各页面手写 `accessibilityText` 的结果是三种毛病反复出现：
 *  1. **布尔念成英文**：`'开关 ' + enabled` ⇒ 读屏念「开关 true」；
 *  2. **空值留悬空分隔符**：`label + '，' + value + '，' + hint` 里 value 是空串时
 *     念出来是「绩点，，点击查看」，像卡了一下；
 *  3. **两种说法**：同一个「未读 3 条」在两页里一个写「3 条未读」一个写「未读消息 3」。
 *
 * 这里把「拼一句话」变成可测的函数：分隔符只出现在非空段之间，布尔一律中文，
 * 数量带单位，未读数超过 99 与徽标显示「99+」保持一致（别一个说 150 一个说 99+）。
 */

/** 去首尾空白；空串安全（不判 undefined —— 形参类型就是 string，判了反而编译不过）。 */
function tidy(s: string): string {
  if (!s) {
    return '';
  }
  return s.trim();
}

/** 用中文逗号连接非空段（空段直接跳过，不留「，，」）。 */
export function joinA11y(parts: string[]): string {
  const out: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const p: string = tidy(parts[i]);
    if (p.length > 0) {
      out.push(p);
    }
  }
  return out.join('，');
}

/** 开关行：`夜间模式，已开启` / `夜间模式，已关闭`。 */
export function switchA11y(label: string, on: boolean): string {
  return joinA11y([label, on ? '已开启' : '已关闭']);
}

/** 普通可点行：`GPA，3.72，点击查看详情`（值为空时不留逗号）。 */
export function rowA11y(label: string, value: string, hint: string): string {
  return joinA11y([label, value, hint]);
}

/**
 * 徽标/未读数：`3 条未读` / `99+ 条未读（实际 150）` / `没有未读`。
 *
 * `unit` 是**名词**（「未读」「项待办」），条目量词「条」由本函数补，
 * 这样 0 的情况能说成「没有未读」而不是「无条未读」。
 * `cap` 与 UI 上的「99+」阈值保持一致，传 0 表示不限。
 */
export function unreadA11y(n: number, unit: string, cap: number): string {
  const u: string = tidy(unit);
  const v: number = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  if (v === 0) {
    return u.length > 0 ? '没有' + u : '没有';
  }
  if (cap > 0 && v > cap) {
    return cap + '+ 条' + u + '（实际 ' + v + '）';
  }
  return v + ' 条' + u;
}

/** 进度/占比：`已选 3 / 12`（分母非法时只说分子，不编分母）。 */
export function progressA11y(label: string, cur: number, max: number): string {
  const c: number = Number.isFinite(cur) ? Math.floor(cur) : 0;
  if (!Number.isFinite(max) || max <= 0) {
    return joinA11y([label, String(c)]);
  }
  return joinA11y([label, c + ' / ' + Math.floor(max)]);
}

/** 选择类 chip：`配色方案，Warm，已选中`。 */
export function chipA11y(label: string, value: string, selected: boolean): string {
  return joinA11y([label, value, selected ? '已选中' : '未选中']);
}

/** 金额行：`余额，18.60 元`；空/NaN 如实说「未知」，不显示 0。 */
export function moneyA11y(label: string, yuan: number): string {
  if (!Number.isFinite(yuan)) {
    return joinA11y([label, '未知']);
  }
  return joinA11y([label, yuan.toFixed(2) + ' 元']);
}

/** 时间范围：`08:00 至 09:35`；任一端空则退化为单点。 */
export function spanA11y(label: string, start: string, end: string): string {
  const a: string = tidy(start);
  const b: string = tidy(end);
  if (a.length > 0 && b.length > 0) {
    return joinA11y([label, a + ' 至 ' + b]);
  }
  return joinA11y([label, a.length > 0 ? a : b]);
}
