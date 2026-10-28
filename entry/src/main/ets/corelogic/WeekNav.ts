/**
 * 周次导航的**纯逻辑**（左右滑动切周 · M12-1，零依赖、可直接被裸 Node import）。
 *
 * 为什么单独抽出来：切周有三处入口（‹ › 按钮、右下角 FAB、左右滑动），
 * 三份 `clamp` 手抄必然漂移——曾经就出现过「按钮能停在 1 周、滑动能滑到 0 周」。
 * 这里只做一件事：**给定当前周与方向，算出该去哪一周，越界就不动**。
 *
 * 规则（全部可证伪）：
 *  - `max` 非法（< 1）⇒ 视作 1，绝不让「16 周」的学期滑到第 17 周；
 *  - `cur` 脏值（< 1 / NaN / 非整数）⇒ 钳回合法区间，**不抛错**（UI 层不崩）；
 *  - 已在边界 ⇒ 返回原值（`moved` 为 false），调用方据此决定是否播动画/震动；
 *  - `delta` 为 0 ⇒ 原值。
 */

/** 一次滑动/点击的落点。`moved=false` 表示撞边界了（调用方可据此不给反馈）。 */
export interface WeekMove {
  week: number;
  moved: boolean;
}

/** 学期总周数兜底：取不到（0/负数/NaN）时按 1 处理，宁可只显示一周也不越界。 */
function safeMax(max: number): number {
  if (!Number.isFinite(max) || max < 1) {
    return 1;
  }
  return Math.floor(max);
}

/** 只做「下界 + 整数」防御，**不**按 max 截断（显示层专用）。 */
function floorWeek(cur: number): number {
  if (!Number.isFinite(cur)) {
    return 1;
  }
  const w: number = Math.floor(cur);
  return w < 1 ? 1 : w;
}

/** 当前周归一到 `[1, max]`。脏值不抛错，落到边界。 */
export function clampWeek(cur: number, max: number): number {
  const top: number = safeMax(max);
  if (!Number.isFinite(cur)) {
    return 1;
  }
  const w: number = Math.floor(cur);
  if (w < 1) {
    return 1;
  }
  if (w > top) {
    return top;
  }
  return w;
}

/** 相对移动（‹ › 按钮、FAB 共用同一份实现）。 */
export function shiftWeek(cur: number, delta: number, max: number): WeekMove {
  const from: number = clampWeek(cur, max);
  if (!Number.isFinite(delta) || delta === 0) {
    return { week: from, moved: false };
  }
  const want: number = from + Math.trunc(delta);
  const to: number = clampWeek(want, max);
  return { week: to, moved: to !== from };
}

/**
 * 左右滑动：`dir = -1` 往左（下一周），`dir = 1` 往右（上一周）。
 *
 * ⚠️ 方向语义单独抽出来，是因为「手往左划到底是看下一周还是上一周」
 * 每个 App 都吵架。这里定死：**内容往左走 = 时间往后走**，与课表横轴
 * （周一到周日）一致，与 iOS/Android 日历同向。
 */
export function swipeWeek(cur: number, dir: number, max: number): WeekMove {
  if (dir === 0 || !Number.isFinite(dir)) {
    return { week: clampWeek(cur, max), moved: false };
  }
  return shiftWeek(cur, dir < 0 ? 1 : -1, max);
}

/**
 * 手势角度 → 切周方向（ArkUI `GestureEvent.angle`：0° 向右，90° 向下，180° 向左）。
 *
 * 只认**接近水平**的那部分：±45° 以内算水平，其余（斜着划、竖着划）返回 0 不动。
 * 不这么卡的话，用户想上下滚课表、手指稍微斜一点就会误切周。
 * 返回：`-1` 下一周（手往左）· `1` 上一周（手往右）· `0` 不处理。
 */
export function swipeDirFromAngle(angle: number): number {
  if (!Number.isFinite(angle)) {
    return 0;
  }
  // 归一到 [0, 360)
  let a: number = angle % 360;
  if (a < 0) {
    a += 360;
  }
  if (a <= 45 || a >= 315) {
    return 1;
  }
  if (a >= 135 && a <= 225) {
    return -1;
  }
  return 0;
}

/**
 * 顶部/无障碍文案：`第 3 / 16 周`。
 *
 * ⚠️ 总周数未知（0/NaN/负数）时**只显示当前周**（`第 3 周`），
 * 既不能显示「/ 0」，也不能把当前周钳成 1 —— 那是在告诉用户「你在第 1 周」。
 */
export function weekLabel(cur: number, max: number): string {
  if (!Number.isFinite(max) || max < 1) {
    return '第 ' + floorWeek(cur) + ' 周';
  }
  return '第 ' + clampWeek(cur, max) + ' / ' + Math.floor(max) + ' 周';
}

/** 无障碍朗读：`第 3 周，共 16 周，左滑看下一周`（边界时改成如实说明）。 */
export function weekA11y(cur: number, max: number): string {
  if (!Number.isFinite(max) || max < 1) {
    // 总周数未知 ⇒ 不谈边界、不谈滑动，只说「现在是第几周」
    return '第 ' + floorWeek(cur) + ' 周';
  }
  const w: number = clampWeek(cur, max);
  const top: number = safeMax(max);
  const head: string = '第 ' + w + ' 周，共 ' + top + ' 周';
  if (top <= 1) {
    return head;
  }
  if (w <= 1) {
    return head + '，已是最前一周，左滑看下一周';
  }
  if (w >= top) {
    return head + '，已是最后一周，右滑看上一周';
  }
  return head + '，左滑看下一周，右滑看上一周';
}
