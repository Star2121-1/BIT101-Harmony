/**
 * 「手动修改课程表」的**合并逻辑**（1:1 对照 Android `CourseOverlayLogic`）。
 *
 * ## 为什么不能直接改课表
 *
 * 课表缓存是**整份覆盖**的（每次同步重写，见 `CourseCache.save`）——
 * 直接改缓存里的行，下次同步就被冲掉。所以教务数据保持原样，
 * 用户的修改记在**覆盖层**，**读取时合并**（`mergeOverlay`）。
 *
 * ## ⚠️ 锚点（anchor）与显示值必须分开
 *
 * 覆盖层要同时回答两个问题：
 *  - 我改的是**哪一节原课**？ → anchorNumber / anchorWeekday / anchorStartSection
 *  - 改完之后**长什么样**？   → number / name / classroom / weekday / startSection …
 *
 * Android 第一版把两者合成一套字段，结果**「改上课时间」根本表达不出来**：
 * 自然键里含 weekday/startSection，改完键就变了 → 合并匹配不上、修改被静默忽略。
 * ⇒ 改显示值只走 `withDisplay`（它不给锚点留入口，不可能手滑改掉）。
 *
 * 锚点也**不能用行 id**：缓存每次同步重写，id 不稳定。
 *
 * ## 三种意图与优先级
 *
 * | kind  | 语义                     | 合并行为 |
 * |-------|--------------------------|----------|
 * | EDIT  | 改这节课                 | 用显示值替换原课（**保留 localId**，列表 key 稳定） |
 * | HIDE  | 隐藏（课退了但教务还在） | 该节**不出现**；**优先级最高**（先改后藏也算藏） |
 * | ADD   | 新增（教务漏了/旁听）    | 追加末尾，`localId = -overlayId`（**负数 = 本地新增**） |
 *
 * 匹配不上的覆盖层（教务把课删了/改了时间）→ 当次**忽略但不删数据**：
 * 教务可能只是临时改一下，留着下次还能接上。
 */

import type { CourseRow } from '../core/model/SchoolModels.ts';

/** 修改意图（存库用字符串，别改名字 —— 等于改数据格式）。 */
export type OverlayKind = 'EDIT' | 'HIDE' | 'ADD';

/** 用户的手动修改（对应 Android `CourseOverlayEntity`）。 */
export interface CourseOverlay {
  id: number;
  kind: string;
  term: string;
  // ── 锚点：指向「改的是哪一节原课」（ADD 时指向它自己） ──
  anchorNumber: string;
  anchorWeekday: number;
  anchorStartSection: number;
  // ── 显示值：用户看到的课程内容 ──
  number: string;
  name: string;
  teacher: string;
  classroom: string;
  weeks: string;
  weekday: number;
  startSection: number;
  endSection: number;
  campus: string;
  credit: number;
  hour: number;
  type: string;
  category: string;
  department: string;
  updatedAt: number;
}

/**
 * 合并后的课程行（= 教务行 + 本地 id）。
 * `localId` 负数 = 本地新增的课（UI 据此区分「可删除」与「可恢复原样」）。
 */
export interface MergedCourse extends CourseRow {
  localId: number;
}

/** 只改显示值的补丁（锚点不在其中 —— 这是刻意的）。 */
export interface OverlayDisplayPatch {
  number?: string;
  name?: string;
  teacher?: string;
  classroom?: string;
  weeks?: string;
  weekday?: number;
  startSection?: number;
  endSection?: number;
  campus?: string;
  credit?: number;
  hour?: number;
  type?: string;
  category?: string;
  department?: string;
  updatedAt?: number;
}

/** 本地新增课程的 id 约定：负数（= -overlayId），与真实自增 id 不会撞。 */
export function addedCourseId(overlayId: number): number {
  return -overlayId;
}

/** 自然键（学期 + 课程号 + 星期 + 开始节次）。 */
export function key(term: string, number: string, weekday: number, startSection: number): string {
  return term + '|' + number + '|' + weekday + '|' + startSection;
}

/** 课程行的键。 */
export function keyOfCourse(c: CourseRow): string {
  return key(c.XNXQDM, c.KCH, c.SKXQ, c.KSJC);
}

/** 覆盖层的键 = 它的**锚点**（不是它改完之后的样子）。 */
export function keyOfOverlay(o: CourseOverlay): string {
  return key(o.term, o.anchorNumber, o.anchorWeekday, o.anchorStartSection);
}

/** 覆盖层 → 课程行。 */
export function toCourseFromOverlay(o: CourseOverlay, localId: number): MergedCourse {
  return {
    XNXQDM: o.term,
    KCM: o.name,
    SKJS: o.teacher,
    JASMC: o.classroom,
    YPSJDD: '',
    SKZC: o.weeks,
    SKXQ: o.weekday,
    KSJC: o.startSection,
    JSJC: o.endSection,
    XXXQMC: o.campus,
    KCH: o.number,
    XF: o.credit,
    XS: o.hour,
    KCXZDM_DISPLAY: o.type,
    KCLBDM_DISPLAY: o.category,
    KKDWDM_DISPLAY: o.department,
    localId: localId
  };
}

/** 课程行 → 合并后的行（教务行没有 localId，给个稳定负数：按自然键哈希会撞，直接用 -1 占位）。 */
export function toMerged(c: CourseRow, localId: number): MergedCourse {
  return {
    XNXQDM: c.XNXQDM,
    KCM: c.KCM,
    SKJS: c.SKJS,
    JASMC: c.JASMC,
    YPSJDD: c.YPSJDD,
    SKZC: c.SKZC,
    SKXQ: c.SKXQ,
    KSJC: c.KSJC,
    JSJC: c.JSJC,
    XXXQMC: c.XXXQMC,
    KCH: c.KCH,
    XF: c.XF,
    XS: c.XS,
    KCXZDM_DISPLAY: c.KCXZDM_DISPLAY,
    KCLBDM_DISPLAY: c.KCLBDM_DISPLAY,
    KKDWDM_DISPLAY: c.KKDWDM_DISPLAY,
    localId: localId
  };
}

/**
 * 把覆盖层套到原始课表上。
 *
 * 规则（按顺序）：
 * 1. HIDE 命中自然键 → 该行不出现（优先级最高：先改后藏也算藏）
 * 2. EDIT 命中 → 用覆盖层的值替换
 * 3. ADD → 追加末尾（localId 取负数）
 * 4. 匹配不上的覆盖层 → 当次忽略（数据保留）
 */
export function mergeOverlay(originals: CourseRow[], overlays: CourseOverlay[]): MergedCourse[] {
  if (overlays.length === 0) {
    const passthrough: MergedCourse[] = [];
    for (let i = 0; i < originals.length; i++) {
      passthrough.push(toMerged(originals[i], 0));
    }
    return passthrough;
  }

  const hiddenKeys: Set<string> = new Set<string>();
  const edits: Map<string, CourseOverlay> = new Map<string, CourseOverlay>();
  const adds: CourseOverlay[] = [];

  for (let i = 0; i < overlays.length; i++) {
    const o: CourseOverlay = overlays[i];
    if (o.kind === 'HIDE') {
      hiddenKeys.add(keyOfOverlay(o));
    } else if (o.kind === 'EDIT') {
      edits.set(keyOfOverlay(o), o);
    } else if (o.kind === 'ADD') {
      adds.push(o);
    }
    // 认不出的 kind：跳过（数据格式变更时不至于崩，也不会把课表搞乱）
  }

  const merged: MergedCourse[] = [];
  for (let i = 0; i < originals.length; i++) {
    const c: CourseRow = originals[i];
    const k: string = keyOfCourse(c);
    if (hiddenKeys.has(k)) {
      continue;
    }
    const edit: CourseOverlay | undefined = edits.get(k);
    merged.push(edit !== undefined ? toCourseFromOverlay(edit, 0) : toMerged(c, 0));
  }

  for (let i = 0; i < adds.length; i++) {
    const o: CourseOverlay = adds[i];
    // 新增的课也可能被 HIDE（正常不该出现，UI 用的是「删除」），
    // 真出现时按藏起来处理，别让它在课表上幽灵般浮现
    if (!hiddenKeys.has(keyOfOverlay(o))) {
      merged.push(toCourseFromOverlay(o, addedCourseId(o.id)));
    }
  }
  return merged;
}

/**
 * 课程行 → 覆盖层（编辑/隐藏某节课时用）。
 *
 * 锚点与显示值一开始都取自 source；编辑时只改**显示值**（用 withDisplay）。
 */
export function toOverlay(
  kind: string,
  source: CourseRow,
  id: number,
  nowMillis: number
): CourseOverlay {
  return {
    id: id,
    kind: kind,
    term: source.XNXQDM,
    anchorNumber: source.KCH,
    anchorWeekday: source.SKXQ,
    anchorStartSection: source.KSJC,
    number: source.KCH,
    name: source.KCM,
    teacher: source.SKJS,
    classroom: source.JASMC,
    weeks: source.SKZC,
    weekday: source.SKXQ,
    startSection: source.KSJC,
    endSection: source.JSJC,
    campus: source.XXXQMC,
    credit: source.XF,
    hour: source.XS,
    type: source.KCXZDM_DISPLAY,
    category: source.KCLBDM_DISPLAY,
    department: source.KKDWDM_DISPLAY,
    updatedAt: nowMillis
  };
}

/**
 * 写入前的**锚点规整**（对齐 Android normalizeAnchors）。
 *
 * 规则来自一个真实 bug：用户**第二次**编辑同一节课时，UI 手上只有「合并后的行」
 * （它的时间是上一次改过的），若直接拿它取锚点，锚点就漂移了 ——
 * 下次合并找不到原课，修改**静默失效**、课表退回教务原样。
 *
 * - ADD 没有原课，锚点**跟着显示值走**
 * - EDIT / HIDE 一旦建好，**锚点不可变**（更新时一律沿用 existing 的锚点）
 * - 新建（existing 为 null）用传入的锚点
 */
export function normalizeAnchors(
  incoming: CourseOverlay,
  existing: CourseOverlay | null
): CourseOverlay {
  const out: CourseOverlay = withDisplay(incoming, {});
  if (incoming.kind === 'ADD') {
    out.anchorNumber = incoming.number;
    out.anchorWeekday = incoming.weekday;
    out.anchorStartSection = incoming.startSection;
    return out;
  }
  if (existing !== null) {
    out.anchorNumber = existing.anchorNumber;
    out.anchorWeekday = existing.anchorWeekday;
    out.anchorStartSection = existing.anchorStartSection;
    return out;
  }
  return out;
}

/**
 * 只改**显示值**，锚点原样保留。
 *
 * 刻意做成这样一个入口：调用方不可能手滑把锚点一起改了 ——
 * 锚点一动就等于换了覆盖对象，用户的修改会莫名其妙失效。
 */
export function withDisplay(o: CourseOverlay, patch: OverlayDisplayPatch): CourseOverlay {
  return {
    id: o.id,
    kind: o.kind,
    term: o.term,
    anchorNumber: o.anchorNumber,
    anchorWeekday: o.anchorWeekday,
    anchorStartSection: o.anchorStartSection,
    number: patch.number !== undefined ? patch.number : o.number,
    name: patch.name !== undefined ? patch.name : o.name,
    teacher: patch.teacher !== undefined ? patch.teacher : o.teacher,
    classroom: patch.classroom !== undefined ? patch.classroom : o.classroom,
    weeks: patch.weeks !== undefined ? patch.weeks : o.weeks,
    weekday: patch.weekday !== undefined ? patch.weekday : o.weekday,
    startSection: patch.startSection !== undefined ? patch.startSection : o.startSection,
    endSection: patch.endSection !== undefined ? patch.endSection : o.endSection,
    campus: patch.campus !== undefined ? patch.campus : o.campus,
    credit: patch.credit !== undefined ? patch.credit : o.credit,
    hour: patch.hour !== undefined ? patch.hour : o.hour,
    type: patch.type !== undefined ? patch.type : o.type,
    category: patch.category !== undefined ? patch.category : o.category,
    department: patch.department !== undefined ? patch.department : o.department,
    updatedAt: patch.updatedAt !== undefined ? patch.updatedAt : o.updatedAt
  };
}

/** 下一个 overlay id（Android 靠 Room 自增；鸿蒙侧按现有最大值 +1）。 */
export function nextOverlayId(overlays: CourseOverlay[]): number {
  let maxId: number = 0;
  for (let i = 0; i < overlays.length; i++) {
    if (overlays[i].id > maxId) {
      maxId = overlays[i].id;
    }
  }
  return maxId + 1;
}

/** 周次按钮行 → SKZC 串（1 起的周号集合 → `01` 串，最长 maxWeek）。 */
export function weeksToSkzc(selected: number[], maxWeek: number): string {
  const set: Set<number> = new Set<number>();
  for (let i = 0; i < selected.length; i++) {
    set.add(selected[i]);
  }
  let out: string = '';
  for (let w = 1; w <= maxWeek; w++) {
    out += set.has(w) ? '1' : '0';
  }
  return out;
}

/** SKZC 串 → 选中周号（1 起）；非 '1' 字符一律不算。 */
export function skzcToSelected(skzc: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < skzc.length; i++) {
    if (skzc.charAt(i) === '1') {
      out.push(i + 1);
    }
  }
  return out;
}
