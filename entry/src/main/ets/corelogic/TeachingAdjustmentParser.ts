/**
 * 教学安排调整解析（纯函数，零框架依赖，可被 node --experimental-strip-types 直接跑）
 *
 * 1:1 移植自 Android：data/src/main/java/cn/bit101/android/data/school/TeachingAdjustment.kt
 * （295 行，2026-09-29 事故后写成）。移植日期 2026-10-20（M2-7）。
 *
 * ## 数据来源
 * `https://jxzx.bit.edu.cn/jxyx/kctz/`（教学运行与考务中心 → 教学运行 → 课程调整），**免登录**。
 * 标题形如《关于XXXX年中秋节、国庆节教学安排调整的通知》。
 *
 * ## ⚠️⚠️ 铁律：只产出**明确写出来**的安排，认不出就不产出
 * 宁可少一条，也不要猜。一个静默错误的课表（把上课日标成放假）比没有这个功能糟得多。
 * 所以只认「日历表格标注 + 四种固定句式」，**没有宽松兜底**。
 *
 * ## ⚠️ 命名冲突提醒（别踩）
 * 本文件用 `weekdayOfCn()`，**不用** `weekdayCn` —— corelogic 里已经有两个同名 `weekdayCn`：
 * `TeachingAdjustment.ts` 收的是「1..7 星期几」，`timeutil.ts` 收的是「epochDay」。
 * 传错参数不会报错，只会静默错一天。这里刻意换名，避免第三个歧义。
 */

import { NO_CLASS, makeUp } from './TeachingAdjustment.ts';
// interface 是「仅类型」，必须用 import type —— 否则 node --experimental-strip-types
// 会试图在运行期取不存在的导出（ArkTS 侧同样合法）。
import type { DayPlan, AdjustmentEntry } from './TeachingAdjustment.ts';

/** 一条能落到课表上的安排（比 AdjustmentEntry 多出来源信息，供 UI 让用户核对原文）。 */
export interface TeachingEntry extends AdjustmentEntry {
  /** 学校原文措辞（如「补休·无教学安排」「按 10月8日（周四）课表上课」）。 */
  note: string;
  sourceTitle: string;
  sourceUrl: string;
}

/** 一条「教学安排调整」通知（供 UI 列出与打开原文）。 */
export interface TeachingNotice {
  title: string;
  url: string;
}

// ── 文本抽取 ───────────────────────────────────────────────────────────

const SCRIPT_STYLE: RegExp = /<(script|style)[^>]*>[\s\S]*?<\/\1>/gi;
const TAG: RegExp = /<[^>]*>/g;

/**
 * 把 HTML 变成可正则的纯文本。
 *
 * ⚠️ 门户会把一个词拆进不同标签，抽完文本会留下**词内空格**
 * （实测「中秋假 期」「无 教学安排」「（星期日） 放假」）⇒ 必须去掉「汉字↔汉字」之间的空格，
 * 否则关键词匹配会**静默失败**（原型就是这么漏掉 9/26、9/27 的）。
 * 数字与汉字之间的空格**要保留**（「共 3 天」）—— 所以不能无脑删所有空格。
 */
export function visibleText(html: string): string {
  let s: string = html.replace(SCRIPT_STYLE, ' ');
  s = s.replace(TAG, ' ');
  s = s.replace(/&nbsp;/g, ' ');
  s = s.replace(/&amp;/g, '&');
  s = s.replace(/\s+/g, ' ');
  s = stripCjkSpaces(s);
  s = s.replace(/\s*年\s*/g, '年');
  s = s.replace(/\s*月\s*/g, '月');
  s = s.replace(/\s*日\s*/g, '日');
  return s.trim();
}

/** 去掉**汉字与汉字之间**的空白；保留数字/字母与汉字之间的（「共 3 天」要保住）。 */
function stripCjkSpaces(s: string): string {
  let out: string = '';
  let i: number = 0;
  while (i < s.length) {
    const ch: string = s.charAt(i);
    if (ch !== ' ') {
      out += ch;
      i++;
      continue;
    }
    // 找到这段空白的下一个非空字符
    let j: number = i;
    while (j < s.length && s.charAt(j) === ' ') {
      j++;
    }
    const prev: string = out.length > 0 ? out.charAt(out.length - 1) : '';
    const next: string = j < s.length ? s.charAt(j) : '';
    if (isCjk(prev) && isCjk(next)) {
      i = j; // 整个空白段吞掉
    } else {
      out += ' ';
      i = j;
    }
  }
  return out;
}

function isCjk(ch: string): boolean {
  if (ch.length === 0) {
    return false;
  }
  const c: number = ch.charCodeAt(0);
  return c >= 0x4e00 && c <= 0x9fff;
}

// ── 正则（带 g 的必须在每次使用前重置 lastIndex，见 findAll）────────────

/** `星期X` / `周X`（取最后一个字，兼容「星期四」与「周四」）。 */
const WD: string = '(?:星期|周)[一二三四五六日天]';
/** 句子内部：止于句号 / 分号 / 引号。 */
const IN: string = '[^。；"”]';

const TABLE: RegExp = /<table[\s\S]*?<\/table>/gi;
const ROW: RegExp = /<tr[\s\S]*?<\/tr>/gi;
const CELL: RegExp = /<t[hd][^>]*>[\s\S]*?<\/t[hd]>/gi;
const LIST_LINK: RegExp = /href="([^"]+\.htm)"[^>]*>\s*([^<]{6,80}?)\s*</gi;
const CELL_DAY: RegExp = /^(\d{1,2})\s*([\s\S]*)$/;
const MONTH_CTX: RegExp = /(\d{4})年(\d{1,2})月/g;
const PUBLISH: RegExp = /发布日期[:：]\s*(\d{4})-(\d{1,2})-(\d{1,2})/;

/** 区间放假：`M月D日（周X）至 [M月]D日（周X）放假…` */
const RE_RANGE: RegExp = new RegExp(
  '(\\d{1,2})月(\\d{1,2})日（' + WD + '）至\\s*(?:(\\d{1,2})月)?(\\d{1,2})日（' + WD + '）(放假' + IN + '{0,20})',
  'g');
/** 单日放假（**必须紧跟「放假」**，否则会抓到一整句、误标别的日子）。 */
const RE_DAY_HOLIDAY: RegExp = new RegExp(
  '(\\d{1,2})月(\\d{1,2})日（' + WD + '）(放假' + IN + '{0,20})', 'g');
/** 单日补休 / 无教学安排。 */
const RE_DAY_XIUXI: RegExp = new RegExp(
  '(\\d{1,2})月(\\d{1,2})日（' + WD + '）(补休' + IN + '{0,30})', 'g');
/** 补课：`M月D日（周X）…按照…（周X）…教学计划安排上课`。括号可选（正文有、表格没有）。 */
const RE_MAKEUP_PROSE: RegExp = new RegExp(
  '(\\d{1,2})月(\\d{1,2})日（' + WD + '）(' + IN + '{0,60}?)按照' + IN + '{0,30}?（?(' + WD + ')）?' +
    IN + '{0,20}?教学计划安排上课', 'g');
/** 表格单元格里的补课：`上课 按 10月8日（周四）课表上课`。 */
const RE_MAKEUP_CELL: RegExp = new RegExp(
  '按' + IN + '{0,30}?（?(' + WD + ')）?' + IN + '{0,30}?(?:课表|教学计划)', 'g');

const NOCLASS_WORDS: string[] = ['放假', '假期', '补休', '无教学安排'];

/** 带 g 的正则是有状态的：每次 findAll 前后都重置，防止第二次调用拿到空结果。 */
function findAll(re: RegExp, s: string): RegExpExecArray[] {
  re.lastIndex = 0;
  const out: RegExpExecArray[] = [];
  let m: RegExpExecArray | null = re.exec(s);
  while (m !== null) {
    out.push(m);
    if (m[0].length === 0) {
      re.lastIndex++;
    }
    m = re.exec(s);
  }
  re.lastIndex = 0;
  return out;
}

function findFirst(re: RegExp, s: string): RegExpExecArray | null {
  re.lastIndex = 0;
  const m: RegExpExecArray | null = re.exec(s);
  re.lastIndex = 0;
  return m;
}

// ── 日期（epoch day；非法日期一律 -1，不溢出）──────────────────────────

/** `y-m-d` → epoch day。**非法日期（2月30日）返回 -1**，不让 Date 溢出到 3 月。 */
export function epochDayOf(y: number, m: number, d: number): number {
  if (m < 1 || m > 12 || d < 1 || d > 31) {
    return -1;
  }
  const dt: Date = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    return -1;
  }
  return Math.floor(dt.getTime() / 86400000);
}

/** 星期几（1=周一 … 7=周日），由 epoch day 推。 */
function weekdayOfEpoch(epochDay: number): number {
  return ((((epochDay + 3) % 7) + 7) % 7) + 1;
}

/**
 * 从 `星期四` / `周四` 里取出 1..7。取不到返回 null（不猜）。
 */
function weekdayOfCn(s: string): number | null {
  const m: RegExpExecArray | null = findFirst(new RegExp(WD), s);
  if (m === null || m[0].length === 0) {
    return null;
  }
  const ch: string = m[0].charAt(m[0].length - 1);
  switch (ch) {
    case '一': return 1;
    case '二': return 2;
    case '三': return 3;
    case '四': return 4;
    case '五': return 5;
    case '六': return 6;
    case '日':
    case '天': return 7;
    default: return null;
  }
}

function toInt(s: string | undefined): number | null {
  if (s === undefined || s.length === 0) {
    return null;
  }
  const t: string = s.trim();
  if (!/^\d+$/.test(t)) {
    return null;
  }
  return Number(t);
}

/**
 * 年份：**靠发布日期推**，月份回绕（12 月发的通知里写 1 月 → 次年）。
 * 没有发布日期 ⇒ 返回 null ⇒ 整条通知放弃（宁可少一条，也不要算到错年份）。
 */
function yearFor(month: number, pubYear: number | null, pubMonth: number | null): number | null {
  if (pubYear === null || pubMonth === null) {
    return null;
  }
  return month < pubMonth ? pubYear + 1 : pubYear;
}

function daysBetween(start: number, end: number): number[] {
  const out: number[] = [];
  if (start < 0 || end < 0 || end < start) {
    return out;
  }
  for (let d: number = start; d <= end; d++) {
    out.push(d);
  }
  return out;
}

// ── 列表页 ─────────────────────────────────────────────────────────────

function joinUrl(base: string, path: string): string {
  if (path.indexOf('http') === 0) {
    return path;
  }
  let b: string = base;
  while (b.length > 0 && b.charAt(b.length - 1) === '/') {
    b = b.substring(0, b.length - 1);
  }
  let p: string = path;
  while (p.length > 0 && (p.charAt(0) === '.' || p.charAt(0) === '/')) {
    p = p.substring(1);
  }
  return b + '/' + p;
}

/** 从列表页抽出所有通知标题与链接（baseUrl 用于补全相对链接）。 */
export function parseNoticeList(listHtml: string, baseUrl: string): TeachingNotice[] {
  const cut: number = baseUrl.lastIndexOf('/');
  const base: string = cut >= 0 ? baseUrl.substring(0, cut) : '';
  const out: TeachingNotice[] = [];
  const seen: string[] = [];
  const links: RegExpExecArray[] = findAll(LIST_LINK, listHtml);
  for (let i = 0; i < links.length; i++) {
    const rawTitle: string = links[i][2];
    const title: string = visibleText(rawTitle);
    if (title.length < 6) {
      continue;
    }
    const url: string = joinUrl(base, links[i][1]);
    if (seen.indexOf(url) >= 0) {
      continue;
    }
    seen.push(url);
    out.push({ title: title, url: url });
  }
  return out;
}

/** 标题是不是「教学安排调整」类通知。 */
export function isAdjustmentNotice(title: string): boolean {
  return title.indexOf('教学安排调整') >= 0;
}

// ── 正文解析 ───────────────────────────────────────────────────────────

interface Item {
  plan: DayPlan;
  note: string;
  fromTable: boolean;
}

/**
 * 解析一条通知正文，得到「日期 → 安排」。
 *
 * 表格优先（更可靠）；表格没覆盖的日期再用文字兜底；同一天冲突时**以表格为准**。
 */
export function parseNotice(html: string, title: string, url: string): TeachingEntry[] {
  const text: string = visibleText(html);
  const pub: RegExpExecArray | null = findFirst(PUBLISH, text);
  const pubYear: number | null = pub === null ? null : toInt(pub[1]);
  const pubMonth: number | null = pub === null ? null : toInt(pub[2]);

  const found: Map<number, Item> = new Map<number, Item>();

  const put = (day: number, plan: DayPlan, note: string, fromTable: boolean): void => {
    if (day < 0) {
      return;
    }
    const old: Item | undefined = found.get(day);
    if (old !== undefined && old.fromTable) {
      return; // 表格更可靠：已有表格项时不覆盖
    }
    let n: string = note.trim();
    if (n.length > 56) {
      n = n.substring(0, 56);
    }
    found.set(day, { plan: plan, note: n, fromTable: fromTable });
  };

  // ── ① 日历表格 ────────────────────────────────────────────────
  const tables: RegExpExecArray[] = findAll(TABLE, html);
  for (let t = 0; t < tables.length; t++) {
    const table: RegExpExecArray = tables[t];
    // 表格上方的月份标题（如「2026年10月」）—— 日历表格不带年份，只能靠它
    const before: string = visibleText(html.substring(0, table.index));
    const ctxs: RegExpExecArray[] = findAll(MONTH_CTX, before);
    if (ctxs.length === 0) {
      continue;
    }
    const ctx: RegExpExecArray = ctxs[ctxs.length - 1];
    const month: number | null = toInt(ctx[2]);
    if (month === null) {
      continue;
    }
    const year: number | null = yearFor(month, pubYear, pubMonth);
    if (year === null) {
      continue;
    }

    const rows: RegExpExecArray[] = findAll(ROW, table[0]);
    for (let r = 0; r < rows.length; r++) {
      const cells: RegExpExecArray[] = findAll(CELL, rows[r][0]);
      for (let c = 0; c < cells.length; c++) {
        const cellText: string = visibleText(cells[c][0]);
        const m: RegExpExecArray | null = findFirst(CELL_DAY, cellText);
        if (m === null) {
          continue;
        }
        const day: number | null = toInt(m[1]);
        if (day === null) {
          continue;
        }
        const rest: string = m[2].trim();
        if (day < 1 || day > 31 || rest.length === 0) {
          continue;
        }
        const date: number = epochDayOf(year, month, day);

        const makeupM: RegExpExecArray | null = findFirst(RE_MAKEUP_CELL, rest);
        const makeup: number | null = makeupM === null ? null : weekdayOfCn(makeupM[1]);
        if (makeup !== null) {
          put(date, makeUp(makeup), rest, true);
          continue;
        }
        let noClass: boolean = false;
        for (let w = 0; w < NOCLASS_WORDS.length; w++) {
          if (rest.indexOf(NOCLASS_WORDS[w]) >= 0) {
            noClass = true;
            break;
          }
        }
        if (noClass) {
          put(date, NO_CLASS, rest, true);
        }
      }
    }
  }

  // ── ② 文字兜底 ────────────────────────────────────────────────
  // 区间放假
  const ranges: RegExpExecArray[] = findAll(RE_RANGE, text);
  for (let i = 0; i < ranges.length; i++) {
    const m: RegExpExecArray = ranges[i];
    const m1: number | null = toInt(m[1]);
    const d1: number | null = toInt(m[2]);
    if (m1 === null || d1 === null) {
      continue;
    }
    const m2: number | null = toInt(m[3]);
    const d2: number | null = toInt(m[4]);
    if (d2 === null) {
      continue;
    }
    const year: number | null = yearFor(m1, pubYear, pubMonth);
    if (year === null) {
      continue;
    }
    const mm2: number = m2 === null ? m1 : m2;
    const start: number = epochDayOf(year, m1, d1);
    const end: number = epochDayOf(year, mm2, d2);
    const days: number[] = daysBetween(start, end);
    for (let k = 0; k < days.length; k++) {
      put(days[k], NO_CLASS, m[5], false);
    }
  }

  // 单日放假 / 补休（正则已把关键词写进捕获组，不会抓到别的日子）
  const singles: RegExp[] = [RE_DAY_HOLIDAY, RE_DAY_XIUXI];
  for (let s = 0; s < singles.length; s++) {
    const hits: RegExpExecArray[] = findAll(singles[s], text);
    for (let i = 0; i < hits.length; i++) {
      const m: RegExpExecArray = hits[i];
      const mm: number | null = toInt(m[1]);
      const dd: number | null = toInt(m[2]);
      if (mm === null || dd === null) {
        continue;
      }
      const year: number | null = yearFor(mm, pubYear, pubMonth);
      if (year === null) {
        continue;
      }
      put(epochDayOf(year, mm, dd), NO_CLASS, m[3], false);
    }
  }

  // 补课：…（周X）…按照…（周X）…教学计划安排上课
  const makeups: RegExpExecArray[] = findAll(RE_MAKEUP_PROSE, text);
  for (let i = 0; i < makeups.length; i++) {
    const m: RegExpExecArray = makeups[i];
    const mm: number | null = toInt(m[1]);
    const dd: number | null = toInt(m[2]);
    if (mm === null || dd === null) {
      continue;
    }
    const target: number | null = weekdayOfCn(m[4]);
    if (target === null) {
      continue;
    }
    const year: number | null = yearFor(mm, pubYear, pubMonth);
    if (year === null) {
      continue;
    }
    put(epochDayOf(year, mm, dd), makeUp(target), m[3], false);
  }

  // ── 收尾：按日期升序 ─────────────────────────────────────────
  const days: number[] = Array.from(found.keys());
  days.sort((a: number, b: number) => a - b);
  const out: TeachingEntry[] = [];
  for (let i = 0; i < days.length; i++) {
    const item: Item | undefined = found.get(days[i]);
    if (item === undefined) {
      continue;
    }
    out.push({
      day: days[i],
      plan: item.plan,
      note: item.note,
      sourceTitle: title,
      sourceUrl: url
    });
  }
  return out;
}

/** 展示用：某天的日期标签由 corelogic/timeutil 的 isoDate 负责，这里只提供星期推导。 */
export function weekdayOfDay(epochDay: number): number {
  return weekdayOfEpoch(epochDay);
}
