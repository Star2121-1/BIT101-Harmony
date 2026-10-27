/**
 * 课表页（M2 第一个只读面）：本周网格 + 课程块 + 今日高亮。
 *
 * #84 UI 迁移（对齐原版 BIT101，基准见 harmony/ui-ref/MIGRATION-BASELINE.md）：
 * - 配色从 AppColors.palette() 切到 GridTokens（Warm 默认皮肤，真机实证）；
 * - 今日列 = primaryContainer@0.5α 复合底（原版 CourseScheduleCalendar.kt:263，实测 #FAEBE0）；
 * - 列头 = secondaryContainer→透明渐变；放假列 = surfaceVariant@0.35α + 文字转灰；
 * - 课程块 = 12 色板（fnv1a32(课名)%12）+ 左缘 4px ink 竖条 + 圆角 6；
 * - 调休 tint（corelogic/ScheduleTint.ts）：放假→整套块灰调（照常显示不藏）、
 *   补课→第三色 tint（ScheduleItemColor.kt 的 HOLIDAY_TINT 0.85 / MAKEUP_TINT 0.6）。
 *
 * 数据流（严格单一来源，不许在 UI 里另算）：
 *   SchoolService.getSchedule → CourseRow[]（原始字段）
 *   → skzcToWeeks（对照 Android CourseScheduleEntity.toEntity）
 *   → weeksContains（corelogic/CourseWeekdayLogic，全仓唯一周次判据）
 *
 * 铁律落实：
 * - 0.4 报给人的数字，范围要说清：状态栏给「本学期 N 门课 / 本周 M 节」，不混算。
 * - 0.6 有副作用的动作（重登）必须用户显式点。
 * - 「取不到」绝不显示成「没课」：错误态单独一屏，空课表另说。
 */
import { router } from '@kit.ArkUI';
import { FabColumn, FabAction } from '../components/shell/FabColumn.ets';
import { gridTokens } from '../core/theme/GridTokens.ts';
import { mixHex, withAlpha } from '../core/theme/colorUtil.ts';
import { tintedCourseColors } from '../corelogic/ScheduleTint.ts';
import type { ScheduleTint } from '../corelogic/ScheduleTint.ts';
import { STORAGE_DARK, STORAGE_PALETTE, getPalette } from '../data/ThemeStore.ts';
import { Context } from '@kit.AbilityKit';
import { SchoolService, SchoolAuthError } from '../service/SchoolService.ts';
import { SessionStore, SessionSnapshot } from '../data/SessionStore.ts';
import { CourseCache, CachedSchedule } from '../data/CourseCache.ts';
import {
  CourseRow, TermSchedule, isRenderableCourse, maxWeekOf, skzcToWeeks
} from '../core/model/SchoolModels.ts';
import { CourseOverlayStore } from '../data/CourseOverlayStore.ts';
import { CourseOverlay, mergeOverlay } from '../corelogic/CourseOverlayLogic.ts';
import { weeksContains, weekOf } from '../corelogic/CourseWeekdayLogic.ts';
import { FALLBACK_TIME_TABLE, courseTimeText, sectionStart } from '../corelogic/TimeTableLogic.ts';
import { TimeTableStore } from '../data/TimeTableStore.ts';
import type { TimeTable } from '../corelogic/timeutil.ts';
import { of as colorOfCourse } from '../corelogic/CourseColorLogic.ts';
import { parseISODate } from '../corelogic/timeutil.ts';
import { TeachingAdjustmentService } from '../service/TeachingAdjustmentService.ts';
import { DayPlan, DayPlanMakeUp, dayPlanOf } from '../corelogic/TeachingAdjustment.ts';
import { TeachingEntry } from '../corelogic/TeachingAdjustmentParser.ts';
import { info, warn } from '../core/log/BitLog.ts';

const CELL_H: number = 46;
const TOTAL_SECTIONS: number = 13;
const DAY_LABELS: string[] = ['一', '二', '三', '四', '五', '六', '日'];
/** 1..13（节次，1-based）。ArkTS 里 Array.from({length}) 不可靠，直接列常量。 */
const SECTIONS: number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];

/** 一个渲染块（一列内的一段）。 */
interface Block {
  course: CourseRow | null;  // null = 空格子
  span: number;              // 占几节
  colorIndex: number;
}

/**
 * 一列的构建结果（块序列 + 冲突数 + 教学调整）。
 *
 * ⚠️ `planKind` 用**字符串**而不是 DayPlan 联合类型：@Builder 里对联合类型做
 * 类型收窄容易踩 ArkTS 的坑，这里直接派生 UI 要用的三个值，渲染侧零判断成本。
 */
interface ColumnResult {
  blocks: Block[];
  conflicts: number;
  /** '' | 'NoClass' | 'MakeUp' */
  planKind: string;
  /** 列头角标：'放假' / '按周四'（空串 = 正常） */
  planLabel: string;
}

@Entry
@Component
export struct SchedulePage {
  /** true = 被外壳（底部 tab）嵌入：不渲染返回键（原版这些是 pager 页签，没有页面级返回）。 */
  isEmbedded: boolean = false;

  /** 订阅全局深浅色（由设置页切换、AppStorage 广播）。 */
  @StorageLink(STORAGE_DARK) isDark: boolean = false;
  @StorageLink(STORAGE_PALETTE) paletteName: string = 'warm';
  @State loading: boolean = true;
  @State statusText: string = '正在读取课表…';
  @State errorText: string = '';
  @State needLogin: boolean = false;
  @State term: string = '';
  /** 可选学期（接口返回，新→旧）。空 = 没取到（选择器不显示）。 */
  @State terms: string[] = [];
  @State firstDay: string = '';
  @State courses: CourseRow[] = [];
  /** 教务原始行（合并前）—— 覆盖层变化时以它为基准重算，避免「合并再合并」。 */
  @State rawCourses: CourseRow[] = [];
  /** 手动改课表的覆盖层（M2-8，读路径合并，见 CourseOverlayLogic）。 */
  @State overlays: CourseOverlay[] = [];
  @State week: number = 1;
  @State maxWeek: number = 20;
  @State todayDow: number = 0;      // 1..7；0 = 未知
  /** 今天所在的周次（-1 = 未知）。**今日高亮必须同时满足「这一周是本周」**。 */
  @State currentWeekNum: number = -1;
  @State totalCourseCount: number = 0;
  @State weekCourseCount: number = 0;
  @State conflictCount: number = 0;
  @State selected: CourseRow | null = null;
  /** 选中课程所在列的调休标记（如「按周周四」）；空 = 正常日。 */
  @State selectedPlanNote: string = '';
  /** 教学安排调整（放假/补课）。取不到就是空数组，课表照常显示。 */
  @State adjustments: TeachingEntry[] = [];
  /** 本周（显示周）里的调整计数，仅用于状态条说清范围。 */
  @State noClassDays: number = 0;
  @State makeUpDays: number = 0;
  /** 开学日（第一周周一）的 epoch day；-1 = 未知（此时不做教学调整匹配）。 */
  @State firstEpochDay: number = -1;
  /** 当前作息（M6-2 可由用户自定义；默认学校官方表）。 */
  @State table: TimeTable = FALLBACK_TIME_TABLE;
  /** 缓存时效标签（'离线缓存 · 12 分钟前'）；空串 = 本次是联网数据。 */
  @State cacheNote: string = '';
  /** 刷新失败但仍有缓存时的提示（不可把缓存当最新）。 */
  @State refreshNote: string = '';

  aboutToAppear(): void {
    this.computeToday();
    this.load();
  }

  /** 本地日历日 → epoch day（与 timeutil 的 UTC 口径对齐；不用 toISOString 免得跨时区差一天）。 */
  private computeToday(): void {
    const d: Date = new Date();
    const epochDay: number = Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
    this.todayDow = ((epochDay + 3) % 7 + 7) % 7 + 1;
  }

  /**
   * 加载：**cache-first**。
   *
   * 顺序（这个顺序是刻意的）：
   * ① 先读本地缓存 → 立刻上屏（离线可读；冷启动不用干等 20 秒逐栋请求）
   * ② 有会话再联网刷新 → 成功覆盖并落盘；失败**保留缓存**并如实标注
   * ③ 无缓存且失败 → 才进错误态
   *
   * ⚠️ 「有缓存但刷新失败」绝不能显示成「已是最新」——用户会拿过期课表去上课。
   */
  private async load(): Promise<void> {
    this.loading = true;
    this.errorText = '';
    this.needLogin = false;
    this.cacheNote = '';
    this.refreshNote = '';
    const ctx: Context = getContext(this) as Context;

    // ⓪ 先取作息（M6-2）：时间列必须在首帧就用用户设定的时刻
    try {
      this.table = await TimeTableStore.load();
    } catch (e) {
      warn('SchedulePage timetable load fail: ' + JSON.stringify(e));
    }

    // ⓪b 覆盖层（M2-8）：必须在第一次 applySchedule 之前读好，
    //     否则缓存的课表会先按「教务原样」上屏再闪一下才变
    try {
      this.overlays = await CourseOverlayStore.load();
      info('SchedulePage initial overlays=' + this.overlays.length);
    } catch (e) {
      warn('SchedulePage overlay load fail: ' + JSON.stringify(e));
      this.overlays = [];
    }

    // ① 缓存先上屏
    const cached: CachedSchedule | null = await CourseCache.loadLast();
    if (cached !== null) {
      this.applySchedule({ term: cached.term, firstDay: cached.firstDay, courses: cached.courses });
      this.cacheNote = '离线缓存 · ' + CourseCache.ageText(cached.fetchedAt);
      this.statusText = '已加载（缓存）';
      this.loading = false;
      info('SchedulePage cache hit term=' + cached.term + ' age=' + CourseCache.ageText(cached.fetchedAt) +
        ' rows=' + cached.courses.length);
    }

    // 教学安排调整（免登录、有独立 12h 缓存）。放在这里：缓存模式下也要能显示放假/补课
    try {
      const ta = await TeachingAdjustmentService.load(ctx, false);
      this.adjustments = ta.entries;
      this.recountWeek();
      info('SchedulePage adjustments=' + ta.entries.length +
        ' notices=' + ta.notices.length + ' fromCache=' + ta.fromCache);
    } catch (e) {
      warn('SchedulePage adjustments fail (ignored): ' + JSON.stringify(e));
    }

    // ② 联网刷新
    try {
      const snap: SessionSnapshot = await SessionStore.snapshot();
      if (!snap.hasSchoolCookies) {
        if (cached === null) {
          this.needLogin = true;
          this.statusText = '还没有登录';
          this.errorText = '课表需要学校教务会话。请先登录（学号 + 密码，密码不保存）。';
        } else {
          this.refreshNote = '未登录，显示的是上次缓存';
        }
        this.loading = false;
        return;
      }
      const term: string = await SchoolService.getCurrentTerm(ctx);
      const schedule: TermSchedule = await SchoolService.getSchedule(ctx, term);
      this.applySchedule(schedule);
      await CourseCache.save(schedule.term, schedule.firstDay, schedule.courses);
      this.cacheNote = '';
      this.statusText = '已加载';
      info('SchedulePage loaded term=' + term + ' rows=' + schedule.courses.length);
      // 学期列表（失败静默：没有它就只显示当前学期，不影响看课表）
      try {
        const list: string[] = await SchoolService.getTermList(ctx);
        if (list.length > 0) {
          this.terms = list;
        }
        info('SchedulePage terms=' + list.length);
      } catch (e) {
        warn('SchedulePage termList fail (ignored): ' + JSON.stringify(e));
      }
    } catch (e) {
      const msg: string = (e as Error).message;
      if (cached === null) {
        // ③ 无缓存才进错误态
        if (e instanceof SchoolAuthError) {
          this.needLogin = true;
          this.errorText = '教务会话已过期或无效：' + msg;
          this.statusText = '需要重新登录';
        } else {
          this.errorText = '取不到课表（' + msg + '）';
          this.statusText = '加载失败';
        }
      } else {
        // 有缓存：不清屏，只如实标注这次没刷上
        this.refreshNote = '刷新失败（' + msg + '），显示的是缓存';
        this.statusText = '显示缓存';
      }
      warn('SchedulePage load fail: ' + JSON.stringify(e));
    }
    this.loading = false;
  }

  private applySchedule(schedule: TermSchedule): void {
    this.term = schedule.term;
    this.firstDay = schedule.firstDay;
    // 只保留可上屏的行（丢掉的行数如实记，不静默吞）
    const renderable: CourseRow[] = [];
    let dropped: number = 0;
    for (let i = 0; i < schedule.courses.length; i++) {
      if (isRenderableCourse(schedule.courses[i])) {
        renderable.push(schedule.courses[i]);
      } else {
        dropped++;
      }
    }
    this.rawCourses = renderable;
    if (dropped > 0) {
      warn('SchedulePage dropped non-renderable rows=' + dropped);
    }
    // 合并覆盖层（M2-8）：上屏的 = 教务原始行 + 用户的修改
    this.applyMerged();
    // 当前周：开学日可知才算，否则停在 1 并提示
    const firstEpoch: number | null = parseISODate(schedule.firstDay);
    this.firstEpochDay = firstEpoch === null ? -1 : firstEpoch;
    if (firstEpoch !== null) {
      const d: Date = new Date();
      const todayEpoch: number = Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
      const w: number = weekOf(firstEpoch, todayEpoch);
      this.currentWeekNum = w;
      this.week = (w >= 1 && w <= this.maxWeek) ? w : 1;
    } else {
      this.week = 1;
    }
    this.recountWeek();
  }

  /**
   * 教务原始行 + 覆盖层 → 上屏数据（**唯一合并入口**）。
   *
   * ⚠️ 以 `rawCourses` 为基准重算，不要在 `courses` 上再合并 ——
   * 那会把「已隐藏的行」当成不存在、把「已改的行」再改一遍。
   */
  private applyMerged(): void {
    this.courses = mergeOverlay(this.rawCourses, this.overlays);
    this.totalCourseCount = this.courses.length;
    // 上界：SKZC 最长长度（合并后的行才算数：新增的课可能周次更长）
    let maxW: number = 0;
    for (let i = 0; i < this.courses.length; i++) {
      const w: number = maxWeekOf(this.courses[i].SKZC);
      if (w > maxW) {
        maxW = w;
      }
    }
    this.maxWeek = maxW > 0 ? maxW : 20;
  }

  /** 从「手动改课表」页回来时重读覆盖层并重算（M2-8）。 */
  onPageShow(): void {
    this.reloadOverlaysAndRemerge();
  }

  private async reloadOverlaysAndRemerge(): Promise<void> {
    try {
      const list: CourseOverlay[] = await CourseOverlayStore.load();
      const changed: boolean = list.length !== this.overlays.length;
      this.overlays = list;
      if (this.rawCourses.length > 0) {
        this.applyMerged();
        this.recountWeek();
      }
      if (changed) {
        info('SchedulePage overlays=' + list.length);
      }
    } catch (e) {
      warn('SchedulePage overlay reload fail: ' + JSON.stringify(e));
    }
  }

  /** 本周节数 + 冲突数 + 教学调整天数（范围各自说清，不混算）。 */
  private recountWeek(): void {
    let count: number = 0;
    let conflict: number = 0;
    let noClass: number = 0;
    let makeUp: number = 0;
    for (let day = 1; day <= 7; day++) {
      const r: ColumnResult = this.buildColumn(day);
      for (let i = 0; i < r.blocks.length; i++) {
        if (r.blocks[i].course !== null) {
          count += 1;
        }
      }
      conflict += r.conflicts;
      if (r.planKind === 'NoClass') {
        noClass++;
      } else if (r.planKind === 'MakeUp') {
        makeUp++;
      }
    }
    this.weekCourseCount = count;
    this.conflictCount = conflict;
    this.noClassDays = noClass;
    this.makeUpDays = makeUp;
  }

  /** 显示周第 dayIndex 天（1..7）的真实日期（epoch day）；-1 = 开学日未知。 */
  private dayEpochOf(dayIndex: number): number {
    if (this.firstEpochDay < 0) {
      return -1;
    }
    return this.firstEpochDay + (this.week - 1) * 7 + (dayIndex - 1);
  }

  /** 该天的教学安排覆盖；没有返回 null（**正常**，不是失败）。 */
  private planOn(dayIndex: number): DayPlan | null {
    const e: number = this.dayEpochOf(dayIndex);
    if (e < 0) {
      return null;
    }
    return dayPlanOf(this.adjustments, e);
  }

  /**
   * 一列（某一天）的块序列：从第 1 节走到第 13 节，
   * 遇到本周要上的课就吐一个块并跳过它占的节次；否则吐空格子。
   *
   * ⚠️ **教学调整在这里生效**（这是 M2-7 的核心，#84 起对齐原版行为）：
   * - `NoClass`（放假）⇒ **照常显示那天的课，只是整套块转灰调**（原版
   *   ScheduleItemColor.kt：「直接把课藏掉会让人以为本来就没课，连这一周的
   *   进度都看不出来」），列头标「放假」。**不能显示成「今天没课」**——
   *   两者对用户的含义完全不同（一个是不用去，一个是没安排）。
   * - `MakeUp(n)`（补课）⇒ 该列装**第 n 天**的课（第三色 tint），列头标「按周四」。
   *   这是 Android 2026-09-29 那起事故的同一场景：10/10 周六按周四上课，
   *   只看「星期几+周次」会显示「没课」，学生真的会缺课。
   *
   * ⚠️ 纯函数式：不改任何字段（渲染期调用也安全）。
   */
  private buildColumn(dayIndex: number): ColumnResult {
    const plan: DayPlan | null = this.planOn(dayIndex);

    // ① 放假：课照常显示（灰调由 courseBlock 的 tint 决定），不藏
    // ② 补课：换一天来筛课
    let sourceDay: number = dayIndex;
    let planKind: string = '';
    let planLabel: string = '';
    if (plan !== null) {
      if (plan.kind === 'NoClass') {
        planKind = 'NoClass';
        planLabel = '放假';
      } else {
        sourceDay = (plan as DayPlanMakeUp).targetWeekday;
        planKind = 'MakeUp';
        planLabel = '按周' + DAY_LABELS[sourceDay - 1];
      }
    }

    const blocks: Block[] = [];
    let conflicts: number = 0;
    // 先按开始节次排序，保证多节课的自然顺序
    const todays: CourseRow[] = [];
    for (let i = 0; i < this.courses.length; i++) {
      const c: CourseRow = this.courses[i];
      if (c.SKXQ !== sourceDay) {
        continue;
      }
      if (!weeksContains(skzcToWeeks(c.SKZC), this.week)) {
        continue;
      }
      todays.push(c);
    }
    todays.sort((a: CourseRow, b: CourseRow) => a.KSJC - b.KSJC);
    let cursor: number = 1;
    for (let i = 0; i < todays.length; i++) {
      const c: CourseRow = todays[i];
      const start: number = c.KSJC;
      const end: number = Math.min(c.JSJC, TOTAL_SECTIONS);
      if (start < cursor) {
        // 与已排的块重叠：计数并跳过（不静默：冲突数上屏）
        conflicts++;
        continue;
      }
      while (cursor < start) {
        blocks.push({ course: null, span: 1, colorIndex: 0 });
        cursor++;
      }
      const span: number = Math.max(1, end - start + 1);
      blocks.push({ course: c, span: span, colorIndex: colorOfCourse(c.KCM) });
      cursor = end + 1;
    }
    while (cursor <= TOTAL_SECTIONS) {
      blocks.push({ course: null, span: 1, colorIndex: 0 });
      cursor++;
    }
    return { blocks: blocks, conflicts: conflicts, planKind: planKind, planLabel: planLabel };
  }

  /**
   * 这一格是不是「今天」：**星期相同 且 显示的这一周就是本周**。
   *
   * ⚠️ 2026-10-20 真机栽过：只比星期几，翻到第 6 周时周二那列也被高亮成「今天」，
   * 用户会以为在提示今天的课。看历史周/未来周时**不许**有今日高亮。
   */
  private isToday(dayIndex: number): boolean {
    return dayIndex === this.todayDow && this.week === this.currentWeekNum;
  }

  /** 列头小字：日期（M/D）。开学日未知时返回空串，不猜。 */
  private headerDate(dayIndex: number): string {
    const e: number = this.dayEpochOf(dayIndex);
    if (e < 0) {
      return '';
    }
    const d: Date = new Date(e * 86400000);
    return (d.getUTCMonth() + 1) + '/' + d.getUTCDate();
  }

  /** 列头角标：'放假' / '按周四' / ''（正常）。 */
  private headerBadge(dayIndex: number): string {
    const plan: DayPlan | null = this.planOn(dayIndex);
    if (plan === null) {
      return '';
    }
    if (plan.kind === 'NoClass') {
      return '放假';
    }
    return '按周' + DAY_LABELS[(plan as DayPlanMakeUp).targetWeekday - 1];
  }

  /**
   * 列背景（照搬原版 CourseScheduleCalendar.kt 的列底色规则）：
   * - 今日列：整列 `primaryContainer @ 0.5α` 复合背景（实测 #FAEBE0）；
   * - 放假列：整列 `surfaceVariant @ 0.35α` 复合背景（原版只给头部渐变，这里整列淡灰，
   *   配合灰调课程块，「这天不上」一眼可辨）；
   * - 补课列：**不换列底色**（原版如此）——区别靠课程块的第三色 tint + 列头角标；
   * - 普通列：透明（头部另有 secondaryContainer→透明渐变，见 headerCell）。
   */
  private columnBg(dayIndex: number): string {
    if (this.isToday(dayIndex)) {
      return this.todayColumnBg();
    }
    const plan: DayPlan | null = this.planOn(dayIndex);
    if (plan !== null && plan.kind === 'NoClass') {
      return this.holidayColumnBg();
    }
    return '#00000000';
  }

  private goWeek(delta: number): void {
    const next: number = this.week + delta;
    if (next < 1 || next > this.maxWeek) {
      return;
    }
    this.week = next;
    this.recountWeek();
  }

  /**
   * 切学期：**同样 cache-first**（先读该学期缓存上屏，再联网刷新）。
   * 历史学期在没有网络时必须仍可看——那是「查去年这门课什么时候上」的真实需求。
   */
  private async switchTerm(t: string): Promise<void> {
    if (t === this.term || this.loading) {
      return;
    }
    const ctx: Context = getContext(this) as Context;
    this.loading = true;
    this.errorText = '';
    this.refreshNote = '';
    this.selected = null;

    const cached: CachedSchedule | null = await CourseCache.load(t);
    if (cached !== null) {
      this.applySchedule({ term: cached.term, firstDay: cached.firstDay, courses: cached.courses });
      this.cacheNote = '离线缓存 · ' + CourseCache.ageText(cached.fetchedAt);
      this.loading = false;
    } else {
      this.cacheNote = '';
      this.statusText = '正在读取 ' + t + ' …';
    }

    try {
      const schedule: TermSchedule = await SchoolService.getSchedule(ctx, t);
      this.applySchedule(schedule);
      await CourseCache.save(schedule.term, schedule.firstDay, schedule.courses);
      this.cacheNote = '';
      this.statusText = '已加载';
      info('SchedulePage switchTerm=' + t + ' rows=' + schedule.courses.length);
    } catch (e) {
      const msg: string = (e as Error).message;
      if (cached === null) {
        this.errorText = '取不到 ' + t + ' 的课表（' + msg + '）';
        this.statusText = '加载失败';
      } else {
        this.refreshNote = '刷新失败（' + msg + '），显示的是缓存';
        this.statusText = '显示缓存';
      }
      warn('SchedulePage switchTerm fail: ' + JSON.stringify(e));
    }
    this.loading = false;
    this.recountWeek();
  }

  private jumpToday(): void {
    const firstEpoch: number | null = parseISODate(this.firstDay);
    if (firstEpoch === null) {
      return;
    }
    const d: Date = new Date();
    const todayEpoch: number = Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
    const w: number = weekOf(firstEpoch, todayEpoch);
    if (w >= 1 && w <= this.maxWeek) {
      this.week = w;
      this.recountWeek();
    }
  }

  /**
   * 列头（照搬原版 CourseScheduleCalendar.kt 的头部处理）：
   * - 普通列：`secondaryContainer → 透明` 的竖向渐变（angle 180 = 从上往下）；
   * - 放假列：`surfaceVariant@0.35α 复合底 → 透明`，文字整体转灰（「这天不作数」）；
   * - 今日列：整列统一 todayColumnBg 底色（列身已铺，这里实底对齐），文字照常深色。
   *
   * ⚠️ @Builder 内禁局部变量（ArkTS 铁律）：派生值全部走私有方法行内取。
   */
  @Builder
  headerCell(label: string, day: number) {
    Column() {
      Text('周' + day)
        .fontSize(12)
        .fontWeight(this.isToday(day) ? FontWeight.Bold : FontWeight.Normal)
        .fontColor(this.headerLabelColor(day))
        .textAlign(TextAlign.Center)
        .width('100%')
      Text(this.headerDate(day))
        .fontSize(8)
        .fontColor(this.headerDateColor(day))
        .textAlign(TextAlign.Center)
        .width('100%')
      // 教学调整角标：放假 / 按周四。空白时不留占位（不渲染）
      if (this.headerBadge(day).length > 0) {
        Text(this.headerBadge(day))
          .fontSize(8)
          .fontColor(this.headerBadgeColor(day))
          .textAlign(TextAlign.Center)
          .maxLines(1)
          .width('100%')
      }
    }
    .width('100%')
    .height(44)
    .justifyContent(FlexAlign.Center)
    .backgroundColor(this.isToday(day) ? this.todayColumnBg()
      : (this.headerBadge(day) === '放假' ? this.holidayColumnBg() : Color.Transparent))
    // 表头那层绿：原版实测最顶部只到 #F4F5F0（≈ secondaryContainer 15% 叠在 background 上，
    // 见 ui-ref/MIGRATION-BASELINE.md §12.4），不是整条实色带。
    .linearGradient({
      // ⚠️ 终止色必须用**同一个颜色 + alpha 0**，不能用 '#00000000'（透明黑）：
      //    插值会往黑色走，绿色会被压成橄榄色（2026-10-26 真机踩到）。
      colors: [[withAlpha(this.headerBadge(day) === '放假' ? this.p().surfaceVariant : this.p().secondaryContainer, 0.15), 0.0],
        [withAlpha(this.headerBadge(day) === '放假' ? this.p().surfaceVariant : this.p().secondaryContainer, 0), 1.0]],
      angle: 180
    })
  }

  /** 列头星期文字色：放假列整体转灰（原版：整列像是「同一种状态」）。 */
  private headerLabelColor(day: number): string {
    return this.headerBadge(day) === '放假' ? this.p().onSurfaceVariant : this.p().onSurface;
  }

  /** 列头日期文字色。 */
  private headerDateColor(day: number): string {
    return this.headerBadge(day) === '放假' ? this.p().textDisabled : this.p().onSurfaceVariant;
  }

  /** 列头角标文字色：正常日用 error 色（调休是要紧事）。 */
  private headerBadgeColor(day: number): string {
    return this.headerBadge(day) === '放假' ? this.p().textDisabled : this.p().error;
  }

  /** 当前配色（语义色见 core/theme/GridTokens.ts，#84 起从 palette() 切到 gridTokens()）。 */
  private p() {
    return gridTokens(this.isDark, getPalette(this.paletteName));
  }

  /**
   * 今日列底色：`primaryContainer @ 0.5α` 复合页面背景。
   * 照搬原版 CourseScheduleCalendar.kt:263（`primaryContainer.copy(alpha = 0.5f)`）；
   * 真机实测复合结果 #FAEBE0（见 ui-ref/MIGRATION-BASELINE.md §1）。
   */
  private todayColumnBg(): string {
    const t = this.p();
    return mixHex(t.primaryContainer, t.background, 0.5);
  }

  /** 放假列头底色：`surfaceVariant @ 0.35α` 复合背景（原版同款，仅头部渐变用）。 */
  private holidayColumnBg(): string {
    const t = this.p();
    return mixHex(t.surfaceVariant, t.background, 0.35);
  }

  /** 某一列的调休档（决定课程块用哪套 tint 色）。放假照常显示课（灰调），不藏。 */
  private columnTint(dayIndex: number): ScheduleTint {
    const plan = this.planOn(dayIndex);
    if (plan === null) {
      return 'normal';
    }
    return plan.kind === 'NoClass' ? 'holiday' : 'makeup';
  }

  /**
   * 右下角悬浮按钮组（原版 CourseScheduleCalendar.kt:382-410，5 颗）。
   * 第 4 颗 1:1 原版是「＋ 添加自定义日程」——鸿蒙侧对应 `OverlayPage`（改/隐藏/新增
   * 三意图，M2-8 已落地），所以直接接到那儿。早先这里临时放「刷新」，和原版对不上，
   * 而且刷新已经由下拉刷新/自动加载覆盖。
   */
  private fabActions(): FabAction[] {
    const list: FabAction[] = [
      {
        icon: 'ic_chevron_right.svg',
        label: '下一周',
        onTap: () => {
          this.goWeek(1);
        },
      },
      {
        icon: 'ic_chevron_left.svg',
        label: '上一周',
        onTap: () => {
          this.goWeek(-1);
        },
      },
      {
        icon: 'ic_calendar.svg',
        label: '考试安排',
        onTap: () => {
          router.pushUrl({ url: 'pages/ExamPage', params: { term: this.term } });
        },
      },
      {
        icon: 'ic_add.svg',
        label: '改课表',
        onTap: () => {
          router.pushUrl({ url: 'pages/OverlayPage' }).catch((e: Error) => {
            warn('open overlay fail: ' + JSON.stringify(e));
          });
        },
      },
      {
        icon: 'ic_settings.svg',
        label: '设置',
        onTap: () => {
          router.pushUrl({ url: 'pages/SettingsPage' }).catch((e: Error) => {
            warn('open settings fail: ' + JSON.stringify(e));
          });
        },
      },
    ];
    return list;
  }

  build() {
    Stack({ alignContent: Alignment.BottomEnd }) {
    Column() {
      // 顶部：返回 + 学期 + 考试/刷新/重登
      // ⚠️ 嵌入外壳时**整行都不渲染**：原版 ref-01 顶部只有「周N + 日期」列头，
      //    考试/刷新都收进右下角 FAB，学期切换在设置页。留着这两行就是最像「另一个 App」的地方。
      if (!this.isEmbedded) {
      Row() {
        // ⚠️ 原本没有返回入口（只能靠系统手势），真机上一个页面进得去出不来。
        // 嵌入外壳时不显示（外壳有页签栏，返回键属于 push 子页的语义）。
        if (!this.isEmbedded) {
          Text('‹')
            .fontSize(24).fontColor(this.p().primary)
            .padding({ left: 2, right: 8 })
            .onClick(() => {
              router.back();
            })
        }
        Column() {
          Text(this.term.length > 0 ? this.term : '课表')
            .fontSize(16).fontWeight(FontWeight.Bold)
            .fontColor(this.p().onSurface)
          Text('第 ' + this.week + ' 周' +
            (this.firstDay.length > 0 ? ' · 开学 ' + this.firstDay : ' · 开学日未知'))
            .fontSize(11).fontColor(this.p().onSurfaceVariant)
        }.alignItems(HorizontalAlign.Start).layoutWeight(1)
        // 动作按钮：文字钮样式（primary 文字 + 透明底），与原版 FAB/文字链同色系
        Button('考试')
          .height(32).fontSize(12)
          .backgroundColor(Color.Transparent)
          .fontColor(this.p().primary)
          .onClick(() => {
            router.pushUrl({ url: 'pages/ExamPage', params: { term: this.term } });
          })
        Button('刷新')
          .height(32).fontSize(12)
          .margin({ left: 6 })
          .backgroundColor(Color.Transparent)
          .fontColor(this.p().primary)
          .enabled(!this.loading)
          .onClick(() => {
            this.load();
          })
        Button('重登')
          .height(32).fontSize(12)
          .margin({ left: 6 })
          .backgroundColor(Color.Transparent)
          .fontColor(this.p().primary)
          .onClick(() => {
            router.pushUrl({ url: 'pages/LoginPage' });
          })
      }
      .width('100%').padding({ left: 12, right: 12, top: 10, bottom: 6 })
      }

      // 学期选择（只在一个以上学期时才显示；取不到列表就只显示当前学期）
      // chip 样式对齐原版（TabPage.kt:137）：选中 = primaryContainer 底 + onPrimaryContainer 字
      if (this.terms.length > 1) {
        Scroll() {
          Row() {
            ForEach(this.terms, (t: string) => {
              Text(t)
                .fontSize(12)
                .fontColor(t === this.term ? this.p().onPrimaryContainer : this.p().onSurfaceVariant)
                .backgroundColor(t === this.term ? this.p().primaryContainer : this.p().surfaceVariant)
                .padding({ left: 10, right: 10, top: 5, bottom: 5 })
                .borderRadius(13)
                .margin({ right: 6 })
                .onClick(() => {
                  this.switchTerm(t);
                })
            }, (t: string) => 'term_' + t)
          }
          .padding({ left: 12, right: 12 })
        }
        .scrollable(ScrollDirection.Horizontal)
        .scrollBar(BarState.Off)
        .width('100%')
        .padding({ bottom: 6 })
      }

      // 周次切换（文字钮样式，与顶栏动作钮一致）
      // ⚠️ 嵌入外壳时不渲染：原版周切换就是右下角那两颗 › ‹ FAB。
      if (!this.isEmbedded) {
      Row() {
        Button('‹')
          .height(30).width(38).fontSize(16)
          .backgroundColor(Color.Transparent)
          .fontColor(this.p().primary)
          .enabled(this.week > 1)
          .onClick(() => {
            this.goWeek(-1);
          })
        Text('第 ' + this.week + ' / ' + this.maxWeek + ' 周')
          .fontSize(13).layoutWeight(1).textAlign(TextAlign.Center)
          .fontColor(this.p().onSurface)
        Button('本周')
          .height(30).fontSize(12)
          .backgroundColor(Color.Transparent)
          .fontColor(this.p().primary)
          .onClick(() => {
            this.jumpToday();
          })
        Button('›')
          .height(30).width(38).fontSize(16)
          .margin({ left: 6 })
          .backgroundColor(Color.Transparent)
          .fontColor(this.p().primary)
          .enabled(this.week < this.maxWeek)
          .onClick(() => {
            this.goWeek(1);
          })
      }
      .width('100%').padding({ left: 12, right: 12, bottom: 4 })
      }

      // 未登录 / 错误态
      if (this.needLogin || this.errorText.length > 0) {
        Column() {
          Text(this.errorText)
            .fontSize(13).fontColor(this.p().error)
            .width('100%')
          if (this.needLogin) {
            Button('去登录')
              .height(40).margin({ top: 12 })
              .backgroundColor(this.p().primary)
              .fontColor(this.p().onPrimary)
              .onClick(() => {
                router.pushUrl({ url: 'pages/LoginPage' });
              })
          }
        }
        .width('100%').padding({ left: 16, right: 16, top: 8 })
      }

      // 表头：时间列 + 7 天
      Row() {
        Text('周' + this.week)
          .fontSize(10)
          .fontColor(this.p().onSurfaceVariant)
          .width(40)
          .textAlign(TextAlign.Center)
        ForEach(DAY_LABELS, (label: string, i: number) => {
          Column() {
            this.headerCell(label, i + 1)
          }.layoutWeight(1)
        }, (label: string, i: number) => 'h_' + label)
      }
      .width('100%').padding({ left: 6, right: 6 })

      // 网格
      Scroll() {
        Row() {
          // 时间列（13 节，1-based 显示）
          Column() {
            ForEach(SECTIONS,
              (sec: number) => {
                Column() {
                  Text(String(sec)).fontSize(12).fontColor(this.p().onSurface)
                  Text(this.timeText(sec)).fontSize(8).fontColor(this.p().onSurfaceVariant)
                }
                .width('100%').height(CELL_H)
                .justifyContent(FlexAlign.Center)
                .border({ width: { bottom: 0.5 }, color: this.p().outlineVariant })
              }, (sec: number) => 'sec_' + sec)
          }
          .width(40)

          // 7 天
          ForEach(DAY_LABELS, (label: string, i: number) => {
            // 放假列不再铺「放假/无教学安排」覆盖层（#84 对齐原版）：
            // 那天的课**照常显示、整套转灰调**，列头角标「放假」——
            // 藏课会让人以为「本来就没课」，连这一周的进度都看不出来。
            Stack({ alignContent: Alignment.Center }) {
              Column() {
                ForEach(this.buildColumn(i + 1).blocks, (b: Block, idx: number) => {
                  if (b.course === null) {
                    Row()
                      .width('100%').height(CELL_H * b.span)
                      .border({ width: { bottom: 0.5, right: 0.5 }, color: this.p().outlineVariant })
                  } else {
                    this.courseBlock(b, i + 1)
                  }
                }, (b: Block, idx: number) => SchedulePage.blockKey(i, idx, b))
              }
              .width('100%')
            }
            .layoutWeight(1)
            .backgroundColor(this.columnBg(i + 1))
          }, (label: string, i: number) => 'col_' + label)
        }
        .width('100%')
      }
      .layoutWeight(1)
      // ⚠️ 顶对齐必须挂 Scroll 自身：加在内层 Column 上不生效（内容不足一屏会被垂直居中）
      .align(Alignment.Top)
      .scrollBar(BarState.Auto)

      // 状态条：范围各自说清（0.4）；缓存/刷新失败必须如实标注（不许把缓存当最新）
      Row() {
        Text(this.loading && this.courses.length === 0 ? '加载中…'
          : ('本学期 ' + this.totalCourseCount + ' 门课记录 · 本周 ' + this.weekCourseCount + ' 节' +
            (this.noClassDays > 0 ? ' · 放假 ' + this.noClassDays + ' 天' : '') +
            (this.makeUpDays > 0 ? ' · 补课 ' + this.makeUpDays + ' 天' : '') +
            (this.conflictCount > 0 ? ' · 同格冲突 ' + this.conflictCount : '') +
            (this.refreshNote.length > 0 ? ' · ' + this.refreshNote
              : (this.cacheNote.length > 0 ? ' · ' + this.cacheNote : ''))))
          .fontSize(11).fontColor(this.p().onSurfaceVariant).layoutWeight(1)
      }
      .width('100%').padding({ left: 12, right: 12, top: 4, bottom: 8 })

      // 课程详情（点块弹出）
      if (this.selected !== null) {
        Column() {
          Row() {
            Text(this.selected!.KCM).fontSize(15).fontWeight(FontWeight.Bold).layoutWeight(1)
            Button('关闭')
              .height(28).fontSize(12)
              .backgroundColor(Color.Transparent)
              .fontColor(this.p().primary)
              .onClick(() => {
                this.selected = null;
                this.selectedPlanNote = '';
            })
          }.width('100%')
          Text('时间：周' + DAY_LABELS[this.selected!.SKXQ - 1] + ' 第 ' + this.selected!.KSJC +
            '-' + this.selected!.JSJC + ' 节（' +
            courseTimeText(this.table, this.selected!.KSJC, this.selected!.JSJC) + '）')
            .fontSize(12).fontColor(this.p().onSurfaceVariant).width('100%').margin({ top: 4 })
          Text('地点：' + (this.selected!.JASMC.length > 0 ? this.selected!.JASMC : '未标注') +
            (this.selected!.XXXQMC.length > 0 ? '（' + this.selected!.XXXQMC + '）' : ''))
            .fontSize(12).fontColor(this.p().onSurfaceVariant).width('100%').margin({ top: 2 })
          Text('教师：' + (this.selected!.SKJS.length > 0 ? this.selected!.SKJS : '未标注'))
            .fontSize(12).fontColor(this.p().onSurfaceVariant).width('100%').margin({ top: 2 })
          Text('周次：' + (skzcToWeeks(this.selected!.SKZC).length > 0
            ? skzcToWeeks(this.selected!.SKZC) : '未标注') +
            (this.selected!.KCH.length > 0 ? ' · 课号 ' + this.selected!.KCH : ''))
            .fontSize(12).fontColor(this.p().onSurfaceVariant).width('100%').margin({ top: 2 })
          // 教学调整标记：补课日必须点明，否则用户会以为是这天的课
          if (this.selectedPlanNote.length > 0) {
            Text('本日' + this.selectedPlanNote + '课表上课（教学安排调整）')
              .fontSize(12).fontColor(this.p().error).width('100%').margin({ top: 2 })
          }
          // 学分 / 学时（取不到就整行不显示，不留空行）
          if (this.detailCredits().length > 0) {
            Text(this.detailCredits())
              .fontSize(12).fontColor(this.p().onSurfaceVariant).width('100%').margin({ top: 2 })
          }
          // 性质 / 类别 / 开课单位
          if (this.detailCategory().length > 0) {
            Text(this.detailCategory())
              .fontSize(12).fontColor(this.p().onSurfaceVariant).width('100%').margin({ top: 2 })
          }
          // 原始安排串（教务给的，偶尔含额外信息）
          if (this.selected!.YPSJDD.length > 0) {
            Text('安排：' + this.selected!.YPSJDD)
              .fontSize(12).fontColor(this.p().onSurfaceVariant).width('100%').margin({ top: 2 })
          }
        }
        .width('100%')
        .padding(12)
        .backgroundColor(this.p().surfaceVariant)
        .border({ width: { top: 0.5 }, color: this.p().outlineVariant })
      }
    }
    .width('100%').height('100%')
    .backgroundColor(this.p().background)

      if (this.isEmbedded) {
        FabColumn({ actions: this.fabActions() })
      }
    }
    .width('100%').height('100%')
  }

  /**
   * 课程块（照搬原版：fill 底 + 左缘 4px ink 竖条 + 课名/教室）。
   * 调休列的块用 tint 变体：放假→灰调（照常显示，不藏）、补课→第三色。
   *
   * ⚠️ @Builder 内禁局部变量（ArkTS 铁律）：配色行内取（tintedColors）。
   */
  @Builder
  courseBlock(b: Block, dayIndex: number) {
    // 排版 1:1 原版 ref-01：课名**上下左右居中**，教室名单行**贴底居中**。
    // （早先是左上对齐 + 教室紧跟其下，块内文字挤在上半截，和原版一眼就能看出不是一套。）
    Stack({ alignContent: Alignment.Center }) {
      Text(b.course === null ? '' : b.course.KCM)
        .fontSize(12)
        .fontWeight(FontWeight.Medium)
        .fontColor(this.tintedColors(b.colorIndex, dayIndex).ink)
        .maxLines(3)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
        .textAlign(TextAlign.Center)
        .width('100%')
        .padding({ left: 3, right: 3 })
      Column() {
        Text(b.course === null ? '' : (b.course.JASMC.length > 0 ? b.course.JASMC : ''))
          .fontSize(9)
          .fontColor(this.tintedColors(b.colorIndex, dayIndex).ink)
          .opacity(0.75)
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .textAlign(TextAlign.Center)
          .width('100%')
      }
      .width('100%').height('100%')
      .justifyContent(FlexAlign.End)
      .padding({ left: 3, right: 3, bottom: 3 })
    }
    .width('100%')
    .height(CELL_H * b.span - 2)
    .padding(3)
    .backgroundColor(this.tintedColors(b.colorIndex, dayIndex).fill)
    .borderRadius(6)
    .border({ width: { left: 4 }, color: this.tintedColors(b.colorIndex, dayIndex).ink })
    .onClick(() => {
      if (b.course !== null) {
        this.selected = b.course;
        // 补课日的课在详情里要点明「本日按周X课表」——否则用户会以为是这天的课
        const badge: string = this.headerBadge(dayIndex);
        this.selectedPlanNote = badge === '放假' ? '' : badge;
      }
    })
  }

  /** 课程块配色：按列的调休档取 tint 变体（normal 时即 12 色板原色）。 */
  private tintedColors(colorIndex: number, dayIndex: number) {
    return tintedCourseColors(colorIndex, this.isDark, this.columnTint(dayIndex));
  }

  /** 学分/学时行：空则返回空串（调用方据此不渲染，**不留空行**）。 */
  private detailCredits(): string {
    if (this.selected === null) {
      return '';
    }
    const parts: string[] = [];
    if (this.selected.XF > 0) {
      parts.push('学分 ' + this.selected.XF);
    }
    if (this.selected.XS > 0) {
      parts.push('学时 ' + this.selected.XS);
    }
    return parts.join(' · ');
  }

  /** 课程性质 / 类别 / 开课单位：空则空串。 */
  private detailCategory(): string {
    if (this.selected === null) {
      return '';
    }
    const parts: string[] = [];
    if (this.selected.KCXZDM_DISPLAY.length > 0) {
      parts.push(this.selected.KCXZDM_DISPLAY);
    }
    if (this.selected.KCLBDM_DISPLAY.length > 0) {
      parts.push(this.selected.KCLBDM_DISPLAY);
    }
    if (this.selected.KKDWDM_DISPLAY.length > 0) {
      parts.push(this.selected.KKDWDM_DISPLAY);
    }
    return parts.join(' · ');
  }

  /**
   * ForEach 键：**必须由内容派生**，不能用纯索引。
   * 栽过（2026-10-20）：首帧 courses 为空 ⇒ 每列 13 个空单元格（键 b_d_i）；
   * 数据到位后同一列变成 8 个课程块，前 8 个键仍相同 ⇒ ArkUI 复用旧空单元格，
   * 课程块不渲染，而状态栏（走另一条计算）却正确显示「本周 8 节」。
   */
  private static blockKey(day: number, idx: number, b: Block): string {
    if (b.course === null) {
      return 'e_' + day + '_' + idx;
    }
    return 'c_' + day + '_' + idx + '_' + b.course.KCM + '_' + b.course.KSJC + '_' + b.course.JSJC;
  }

  private timeText(section: number): string {
    const start: number | null = sectionStart(this.table, section);
    if (start === null) {
      return '';
    }
    const text: string = courseTimeText(this.table, section, section);
    if (text.length === 0) {
      return '';
    }
    return text.substring(0, 5);
  }
}
