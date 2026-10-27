/**
 * 学期列表的纯函数工具（不含任何 @kit 依赖，便于离线单测走第二条路对照）。
 *
 * 为什么独立成文件：设置页切学期的「近期 / 旧学期」拆分逻辑属于「写错了看起来也正常」
 * 的坑（默认全展开会让一长串历史学期占满屏，而折叠错又会让人选不回旧学期），
 * 必须能离线证伪。把它放在一个没有 @kit 依赖的模块里，node 下的测试就能直接 import
 * 真实函数，而不是在测试里重写一遍（重写等于没测）。
 */

/** 学期列表拆分结果：近期一截 + 更早一截。 */
export interface TermSplit {
  recent: string[];
  old: string[];
}

/**
 * 把「新→旧」的学期列表拆成近期与旧学期两截。
 * 近期 = 学年起始年 ≥ (最新年 − recentYears + 1)；更早的归旧学期。
 * 解析不了年份的（脏值/异常串）一律归旧学期，避免污染近期视图。
 *
 * term 形如 `2025-2026-2`，学年起始年在前 4 位；按字符串前 4 位取数字年份。
 */
export function splitTermsByRecentYears(termList: string[], recentYears: number): TermSplit {
  const out: TermSplit = { recent: [], old: [] };
  if (termList.length === 0) {
    return out;
  }
  let maxYear: number = 0;
  for (const t of termList) {
    const y: number = parseInt(t.substring(0, 4), 10);
    if (!isNaN(y) && y > maxYear) {
      maxYear = y;
    }
  }
  const cutoff: number = maxYear - recentYears + 1;
  for (const t of termList) {
    const y: number = parseInt(t.substring(0, 4), 10);
    if (!isNaN(y) && y >= cutoff) {
      out.recent.push(t);
    } else {
      out.old.push(t);
    }
  }
  return out;
}
