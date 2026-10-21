/**
 * 一卡通余额的**本地历史与趋势**（1:1 对照 Android `CampusCardBalanceLogic`）。
 *
 * 文件读写在 `data/CampusCardStore.ts`；本文件纯逻辑、可单测。
 *
 * ## 为什么要有它
 *
 * 一卡通流水是**钉钉客户端专属**、App 端拿不到，但「这些天花了多少钱」是用户
 * 真正想知道的。既然每次刷新都能看到一个余额，就把采样点攒起来，
 * **用余额的下降幅度反推消费** —— 不精确，但比什么都没有强。
 *
 * ## 口径（与 Android 逐条对齐）
 *
 * - 每次成功取到余额记一条 `(时刻, 金额)`
 * - 「今日」基准 = 今天**最早**那次采样；「近 N 天」基准 = 7 天窗口内最早那条。
 *   样本没攒够 7 天时**如实退化成「近 N 天」**（N 是真实跨度），不硬说「近 7 天」
 * - 连续的**同金额采样在同一自然日内合并**（保留最早那条）
 *
 * ## 时区
 *
 * Android 用 `LocalDate` + `ZoneId`。鸿蒙侧日期统一用 **epoch day**
 * （见 `timeutil.ts`），但「某时刻属于哪个自然日」依赖时区 ⇒ 日期解析器
 * **显式注入**（`DayOf`），设备侧传 `localEpochDay`、测试传固定的 +8 解析器
 * —— 否则 GitHub CI 跑在 UTC 上，`hour<8` 的用例会整体差一天。
 */

/** 一次余额采样。 */
export interface BalanceSample {
  /** 采样时刻（epoch 毫秒） */
  atMillis: number;
  /** 余额金额（元） */
  amount: number;
}

/** 余额趋势。 */
export interface BalanceTrend {
  /** 今天的变化 = 今天最新余额 − 今天**最早**那次余额。今天只采到一次为 null。 */
  todayDelta: number | null;
  /** 相对基准采样的变化（减少=花钱，增加=充值）。 */
  spanDelta: number | null;
  /** spanDelta 实际跨了几个自然日；0 表示 spanDelta 不可用。 */
  spanDays: number;
}

/** 日期解析器：时刻 → epoch day（自然日归属，依赖时区，故注入）。 */
export type DayOf = (atMillis: number) => number;

/** 空趋势（Android `BalanceTrend()` 的默认值）。 */
export function emptyTrend(): BalanceTrend {
  return { todayDelta: null, spanDelta: null, spanDays: 0 };
}

/** 趋势窗口：优先看最近 7 天。 */
export const WINDOW_DAYS: number = 7;

/** 最多保留多少条采样（防止存储无限增长）。 */
export const MAX_COUNT: number = 400;

/** 最多保留多少天。 */
export const MAX_DAYS: number = 120;

/** 判定「没有变化」的阈值：两位小数显示下低于半分钱都算不变。 */
export const EPSILON: number = 0.005;

/**
 * 设备侧默认解析器：按**本机时区**取自然日。
 * （与 Android `ZoneId.systemDefault()` 对齐；学校与用户都在东八区。）
 */
export function localEpochDay(atMillis: number): number {
  const d: Date = new Date(atMillis);
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
}

/** 固定东八区解析器（测试用：与 Android 测试的 `Asia/Shanghai` 等价）。 */
export function shanghaiEpochDay(atMillis: number): number {
  return Math.floor((atMillis + 8 * 3600000) / 86400000);
}

// ------------------------------------------------------------------ 存储编码

/**
 * 编码成一行一条：`时刻|金额`。
 *
 * 用纯文本而不是 JSON：这个存储只有几十条、只给我们自己读，
 * 出问题时一眼就能看懂（与 Android TextFileCache 同格式）。
 */
export function encode(samples: BalanceSample[]): string {
  const lines: string[] = [];
  for (let i = 0; i < samples.length; i++) {
    lines.push(samples[i].atMillis + '|' + samples[i].amount);
  }
  return lines.join('\n');
}

/** 解析；形状不对的行**直接丢掉**（不猜）。按时间升序返回。 */
export function decode(raw: string | null): BalanceSample[] {
  if (raw === null || raw.length === 0) return [];
  const out: BalanceSample[] = [];
  const lines: string[] = raw.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const parts: string[] = lines[i].trim().split('|');
    if (parts.length !== 2) continue;
    const at: number = Number(parts[0]);
    const amount: number = Number(parts[1]);
    if (!Number.isFinite(at) || !Number.isFinite(amount)) continue;
    if (parts[0].length === 0 || parts[1].length === 0) continue;
    out.push({ atMillis: at, amount: amount });
  }
  out.sort((a: BalanceSample, b: BalanceSample) => a.atMillis - b.atMillis);
  return out;
}

// ------------------------------------------------------------------ 记录

/**
 * 追加一条采样并裁剪，返回新的采样列表。
 *
 * 合并规则：上一条与本次**金额相同、且在同一天**时**不追加**
 * （保留上一条更早的时刻，这样「今天最早那次余额」仍是今天第一次观察到的值）。
 */
export function append(
  samples: BalanceSample[],
  amount: number,
  atMillis: number,
  dayOf: DayOf = localEpochDay
): BalanceSample[] {
  const last: BalanceSample | undefined = samples[samples.length - 1];
  let merged: BalanceSample[];
  if (last !== undefined
    && Math.abs(last.amount - amount) < EPSILON
    && dayOf(last.atMillis) === dayOf(atMillis)) {
    merged = samples;
  } else {
    merged = samples.concat([{ atMillis: atMillis, amount: amount }]);
  }
  return prune(merged, atMillis, dayOf);
}

/** 丢太老的、再砍到 MAX_COUNT（**从最新往回留**）。 */
function prune(samples: BalanceSample[], nowMillis: number, dayOf: DayOf): BalanceSample[] {
  const oldestKept: number = dayOf(nowMillis) - MAX_DAYS;
  const kept: BalanceSample[] = samples.filter((s: BalanceSample) => dayOf(s.atMillis) >= oldestKept);
  if (kept.length <= MAX_COUNT) return kept;
  return kept.slice(kept.length - MAX_COUNT);
}

// ------------------------------------------------------------------ 趋势

/**
 * 算趋势。
 *
 * @param samples 历史采样（需按时间升序；append 与 decode 都保证）
 * @param todayEpochDay 今天（显式传入便于单测）
 */
export function trend(
  samples: BalanceSample[],
  todayEpochDay: number,
  dayOf: DayOf = localEpochDay
): BalanceTrend {
  if (samples.length === 0) return emptyTrend();

  const latest: BalanceSample = samples[samples.length - 1];
  const todaySamples: BalanceSample[] = samples.filter((s: BalanceSample) => dayOf(s.atMillis) === todayEpochDay);

  const todayDelta: number | null = todaySamples.length >= 2
    ? latest.amount - todaySamples[0].amount
    : null;

  // 7 天窗口内**最早**那条采样。样本不足 7 天时它就是整体最早那条 ——
  // 于是 spanDays 会如实变成 1~6，文案跟着写「近 N 天」
  const windowStart: number = todayEpochDay - WINDOW_DAYS;
  const inWindow: BalanceSample[] = samples.filter((s: BalanceSample) => dayOf(s.atMillis) >= windowStart);

  // 窗口内一条都没有（超过 7 天没打开过 App）→ 只报今日，不硬凑「近 N 天」
  if (inWindow.length === 0) {
    return { todayDelta: todayDelta, spanDelta: null, spanDays: 0 };
  }

  const spanDays: number = todayEpochDay - dayOf(inWindow[0].atMillis);
  const spanDelta: number | null = spanDays >= 1 ? latest.amount - inWindow[0].amount : null;

  return { todayDelta: todayDelta, spanDelta: spanDelta, spanDays: spanDays };
}

// ------------------------------------------------------------------ 文案

/**
 * 趋势文案，如 `今日 -¥4.20 · 近 7 天 -¥23.50`；算不出来时返回 null。
 *
 * 正数是**充值**（余额变多），负数是**消费**。
 */
export function trendText(t: BalanceTrend): string | null {
  const parts: string[] = [];
  if (t.todayDelta !== null) parts.push('今日 ' + signedText(t.todayDelta));
  if (t.spanDelta !== null && t.spanDays >= 1) {
    parts.push('近 ' + t.spanDays + ' 天 ' + signedText(t.spanDelta));
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}

/** `-¥4.20` / `+¥50.00` / `无变化`。 */
export function signedText(delta: number): string {
  if (delta > EPSILON) return '+¥' + delta.toFixed(2);
  if (delta < -EPSILON) return '-¥' + (-delta).toFixed(2);
  return '无变化';
}

/**
 * 有没有**实质**变化（两个窗口里至少有一个不是 0）。
 *
 * ⚠️ 卡片上要用它挡一层：余额一直没动时 trendText 会给出
 * 「今日 无变化 · 近 7 天 无变化」—— 占着天天看的一行却什么都没说。
 * ⇒ 卡片改成「没有变化就不显示」，把那一行让回给「点开详情」。
 */
export function hasChange(t: BalanceTrend): boolean {
  return isNonZero(t.todayDelta) || isNonZero(t.spanDelta);
}

function isNonZero(v: number | null): boolean {
  return v !== null && Math.abs(v) > EPSILON;
}

/**
 * 详情页那一行的文案 —— **算不出来时也要给一句话**。
 *
 * 刚装上/刚登录的用户一条历史都没有，trendText 返回 null。此时整行消失的话，
 * 用户看到的是「这里什么都没有」，只会得出「功能没做」的结论；
 * 明说「还在记录」才是诚实的（历史攒够 1 天就有了）。
 */
export function trendRowText(t: BalanceTrend): string {
  const text: string | null = trendText(t);
  return text !== null ? text : '记录中（攒够历史后显示变化）';
}
