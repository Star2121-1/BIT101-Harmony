/**
 * G-04 成绩筛选三维度（学期 / 课程性质 / 课名关键词）纯逻辑。
 *
 * 对照 Android `ScorePage.kt:96-110,445-508` 的 filterOf：
 *   学期、性质两组 chip（都空=全选）+ 关键词（课名或课程编号，忽略大小写）。
 * ⚠️ 关键坑（Android `:195-246` 踩过）：筛选条与统计卡**分开判**——筛选后
 *   只剩缓考/校公选不及格（可计 0 门）时，筛选条也必须还在，否则用户没有
 *   「清空筛选」入口，退不出筛选态。本逻辑用 hasAnyFilter() 单独判，不与 counts 绑定。
 *
 * 无 @kit / 无 IO / 无 UI，离线单测可跑。
 */

import type { ScoreEntry } from './ScoreLogic.ts';

/** 当前筛选条件（学期/性质空数组=不限）。 */
export interface ScoreFilter {
  terms: string[];
  categories: string[];
  keyword: string;
}

/** 空筛选（不限学期/性质/关键词）。 */
export function emptyScoreFilter(): ScoreFilter {
  return { terms: [], categories: [], keyword: '' };
}

/** 从成绩全量行抽出可筛选的学期（非空、去重、保持出现顺序）。 */
export function filterTermsOf(entries: ScoreEntry[]): string[] {
  const out: string[] = [];
  const seen: Set<string> = new Set<string>();
  for (let i = 0; i < entries.length; i++) {
    const t: string = (entries[i].term === undefined || entries[i].term === null ? '' : entries[i].term!).trim();
    if (t.length === 0 || seen.has(t)) {
      continue;
    }
    seen.add(t);
    out.push(t);
  }
  return out;
}

/** 从全量行抽出可筛选的课程性质（category，非空去重保序）。 */
export function filterCategoriesOf(entries: ScoreEntry[]): string[] {
  const out: string[] = [];
  const seen: Set<string> = new Set<string>();
  for (let i = 0; i < entries.length; i++) {
    const c: string = (entries[i].category === undefined ? '' : entries[i].category!).trim();
    if (c.length === 0 || seen.has(c)) {
      continue;
    }
    seen.add(c);
    out.push(c);
  }
  return out;
}

/** 关键词是否命中一行：课名或课程编号，忽略大小写（对齐 Android ignoreCase=true）。 */
export function keywordMatches(e: ScoreEntry, keyword: string): boolean {
  const kw: string = keyword.trim().toLowerCase();
  if (kw.length === 0) {
    return true;
  }
  const course: string = e.course.toLowerCase();
  if (course.indexOf(kw) >= 0) {
    return true;
  }
  const no: string = (e.courseNumber === undefined ? '' : e.courseNumber).toLowerCase();
  return no.indexOf(kw) >= 0;
}

/** 一行是否通过全部三维筛选（AND 语义，组内 OR）。 */
export function scoreRowMatches(e: ScoreEntry, f: ScoreFilter): boolean {
  const term: string = (e.term === undefined || e.term === null ? '' : e.term!).trim();
  if (f.terms.length > 0 && f.terms.indexOf(term) < 0) {
    return false;
  }
  const cat: string = (e.category === undefined ? '' : e.category!).trim();
  if (f.categories.length > 0 && f.categories.indexOf(cat) < 0) {
    return false;
  }
  return keywordMatches(e, f.keyword);
}

/** 是否处于筛选态（用于「清空筛选」入口：与统计门数完全解耦，防 Android 那个坑）。 */
export function hasAnyFilter(f: ScoreFilter): boolean {
  return f.terms.length > 0 || f.categories.length > 0 || f.keyword.trim().length > 0;
}

/** 切换 chip 选中：已选则移除，未选则加入（保持输入数组不变，返回新数组）。 */
export function toggleChip(current: string[], value: string): string[] {
  const i: number = current.indexOf(value);
  if (i >= 0) {
    return current.filter((x: string) => x !== value);
  }
  const out: string[] = current.slice();
  out.push(value);
  return out;
}

/** 空态文案：筛过给「清空筛选」提示，没筛过给网页版核对提示（对齐 Android :224-246）。 */
export function scoreEmptyHint(f: ScoreFilter): string {
  return hasAnyFilter(f) ? '筛选条件太窄了，清一下试试。' : '没有成绩数据，可到网页版核对。';
}
