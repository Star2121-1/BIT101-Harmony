/**
 * 全局搜索的**纯逻辑**（零 @kit 依赖 ⇒ 可用裸 Node 直接跑断言）。
 *
 * 设计取舍（都是可证伪的）：
 *  1. **归一化后才匹配**：去空白、全角转半角、字母小写。教务数据混全角（`Ｉ４０４`），
 *     不归一化就搜不到 —— 与 `CampusLocations.normalize` 同一套口径。
 *  2. **多词是与关系**：每个词都必须命中某字段，否则不出现在结果里。
 *     「文萃 高数」= 文萃楼里上高数的课，而不是「文萃」或「高数」的全集。
 *  3. **打分只看命中位置**：标题前缀 > 标题包含 > 副标题 > 附加信息。
 *     不引入「热度」之类没有数据源的权重（编不出来就是编）。
 *  4. **分组顺序固定**：课程 → 作业 → 教室 → 班车。搜索页的组标题靠它排序，
 *     不靠调用方传顺序（否则两个入口会给出不同顺序）。
 *  5. **空查询返回空**：不猜「推荐」。调用方要显示历史/热门由它自己决定。
 */

/** 结果类型（决定图标与点击后去哪）。 */
export enum SearchKind {
  Course = 'course',
  Ddl = 'ddl',
  Room = 'room',
  Shuttle = 'shuttle',
}

/** 一条可被搜索的文档。调用方把各数据源压成这个形状。 */
export interface SearchDoc {
  /** 全局唯一（同一条数据在不同来源下不许撞键）。 */
  id: string;
  kind: SearchKind;
  /** 主标题（课程名 / 作业标题 / 教室名 / 线路名）。 */
  title: string;
  /** 副标题（教师+教室 / 截止时间 / 容量 / 发车时间）。 */
  subtitle: string;
  /** 附加可搜字段（课程号、备注、别名），只参与匹配不展示。 */
  extra: string;
}

/** 一条结果（带分数，供排序与调试）。 */
export interface SearchHit {
  doc: SearchDoc;
  score: number;
}

/** 一个分组（kind + 该组结果）。 */
export interface SearchGroup {
  kind: SearchKind;
  hits: SearchHit[];
}

/** 各类型的中文名（搜索页组标题 / 无障碍文案共用，避免两处各写一份）。 */
export function kindLabel(kind: SearchKind): string {
  if (kind === SearchKind.Course) {
    return '课程';
  }
  if (kind === SearchKind.Ddl) {
    return '作业';
  }
  if (kind === SearchKind.Room) {
    return '教室';
  }
  return '班车';
}

/** 分组顺序（固定，见文件头第 4 条）。 */
const KIND_ORDER: SearchKind[] = [SearchKind.Course, SearchKind.Ddl, SearchKind.Room, SearchKind.Shuttle];

/**
 * 归一化：去所有空白、全角（FF01-FF5E）转半角、字母转小写。
 * 全角空格 U+3000 也当空白处理（教务导出里真实存在）。
 */
export function norm(raw: string): string {
  let out: string = '';
  for (let i = 0; i < raw.length; i++) {
    const code: number = raw.charCodeAt(i);
    if (code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d || code === 0x3000) {
      continue; // 空白直接丢（归一化后不留分隔符）
    }
    if (code >= 0xff01 && code <= 0xff5e) {
      out += String.fromCharCode(code - 0xfee0); // 全角 → 半角
    } else {
      out += raw.charAt(i);
    }
  }
  return out.toLowerCase();
}

/**
 * 把查询串切成词（按空白切，切完归一化，去掉空串）。
 * 例：`" 文萃  Ｉ４０４ "` → `['文萃', 'i404']`
 */
export function termsOf(query: string): string[] {
  const out: string[] = [];
  const parts: string[] = query.split(/[\s\u3000]+/);
  for (let i = 0; i < parts.length; i++) {
    const t: string = norm(parts[i]);
    if (t.length > 0) {
      out.push(t);
    }
  }
  return out;
}

/**
 * 单个词对单条文档的分数（0 = 不命中）。
 * 标题前缀 100 / 标题包含 60 / 副标题 30 / 附加 15；同字段多次命中不叠加（只看第一次）。
 */
export function scoreTerm(doc: SearchDoc, term: string): number {
  const title: string = norm(doc.title);
  if (title.length > 0 && title.indexOf(term) === 0) {
    return 100;
  }
  if (title.indexOf(term) >= 0) {
    return 60;
  }
  if (norm(doc.subtitle).indexOf(term) >= 0) {
    return 30;
  }
  if (norm(doc.extra).indexOf(term) >= 0) {
    return 15;
  }
  return 0;
}

/**
 * 单条文档的总分：**每个词都必须命中**（与关系），命中后分数相加。
 * 任一词不命中 ⇒ 0（调用方据此丢弃）。
 */
export function scoreDoc(doc: SearchDoc, terms: string[]): number {
  if (terms.length === 0) {
    return 0;
  }
  let sum: number = 0;
  for (let i = 0; i < terms.length; i++) {
    const s: number = scoreTerm(doc, terms[i]);
    if (s === 0) {
      return 0;
    }
    sum += s;
  }
  return sum;
}

/** 同分时的稳定次序：标题短的先（更精确），再按 id（保证同一份数据两次搜结果一致）。 */
function compareHit(a: SearchHit, b: SearchHit): number {
  if (a.score !== b.score) {
    return b.score - a.score;
  }
  if (a.doc.title.length !== b.doc.title.length) {
    return a.doc.title.length - b.doc.title.length;
  }
  return a.doc.id < b.doc.id ? -1 : (a.doc.id > b.doc.id ? 1 : 0);
}

/**
 * 搜索主入口。
 *
 * @param docs   全部可搜索文档（调用方合并各数据源）
 * @param query  用户输入
 * @param limit  每组最多返回多少条（<=0 视为不限）
 */
export function search(docs: SearchDoc[], query: string, limit: number): SearchGroup[] {
  const terms: string[] = termsOf(query);
  const out: SearchGroup[] = [];
  if (terms.length === 0) {
    return out; // 空查询不出结果（见文件头第 5 条）
  }
  const byKind: Map<SearchKind, SearchHit[]> = new Map<SearchKind, SearchHit[]>();
  for (let i = 0; i < docs.length; i++) {
    const doc: SearchDoc = docs[i];
    const s: number = scoreDoc(doc, terms);
    if (s === 0) {
      continue;
    }
    const list: SearchHit[] | undefined = byKind.get(doc.kind);
    const hit: SearchHit = { doc: doc, score: s };
    if (list === undefined) {
      byKind.set(doc.kind, [hit]);
    } else {
      list.push(hit);
    }
  }
  for (let k = 0; k < KIND_ORDER.length; k++) {
    const kind: SearchKind = KIND_ORDER[k];
    const list: SearchHit[] | undefined = byKind.get(kind);
    if (list === undefined || list.length === 0) {
      continue;
    }
    list.sort(compareHit);
    const cut: SearchHit[] = limit > 0 && list.length > limit ? list.slice(0, limit) : list;
    out.push({ kind: kind, hits: cut });
  }
  return out;
}

/** 结果总数（标题上显示「N 个结果」）。 */
export function totalHits(groups: SearchGroup[]): number {
  let n: number = 0;
  for (let i = 0; i < groups.length; i++) {
    n += groups[i].hits.length;
  }
  return n;
}
