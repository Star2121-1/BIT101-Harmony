/**
 * 「存储与清理」的**分类白名单**（纯逻辑，零 @kit 依赖）。
 *
 * ## 为什么是白名单而不是「按前缀扫一遍全删」
 * 偏好库里混着**登录凭据的索引、主题、学期覆盖、提醒开关**。一次「清缓存」若按键名模糊匹配，
 * 可能把用户设置一起清掉 —— 这不是「小瑕疵」，是数据丢失。
 * 所以：**只有本文件列出的键允许被清理**，且 `ddl_schedule_v1` 单独标 `userData`：
 * 它里面是用户手写的作业条目，清理前必须二次确认（文案里写明）。
 *
 * ## 体积口径
 * 字节数由 `Prefs.rawSize` 给出（字符串长度按 UTF-8 双字节偏保守），
 * 这里只负责**格式化成可读文本**，不假装精确到字节。
 */

/** 一个可清理项。 */
export interface CacheSpec {
  /** 稳定标识（清理时按它分项）。 */
  kind: string;
  /** 展示名。 */
  title: string;
  /** 一句话说明（清掉会怎样）。 */
  note: string;
  /** 键名前缀（`schedule_cache_v2_` 这类按学期分片的）。 */
  prefixes: string[];
  /** 精确键名。 */
  exact: string[];
  /** 是否含用户自己录入的数据（true ⇒ 需二次确认，且默认不勾）。 */
  userData: boolean;
}

/** 全部可清理项（顺序即 UI 顺序：纯缓存在前，用户数据在最后）。 */
export const CACHE_SPECS: CacheSpec[] = [
  {
    kind: 'schedule',
    title: '课表缓存',
    note: '清掉后下次打开课表会重新联网（离线时就没课表了）',
    prefixes: ['schedule_cache_v2_'],
    exact: ['schedule_last_term'],
    userData: false,
  },
  {
    kind: 'exam',
    title: '考试安排缓存',
    note: '清掉后重新联网拉取',
    prefixes: ['exam_cache_v1_'],
    exact: ['exam_last_term'],
    userData: false,
  },
  {
    kind: 'score',
    title: '成绩缓存',
    note: '清掉后重进成绩页要重新走一次学校登录（会慢一些）',
    prefixes: [],
    exact: ['score_cache_v1'],
    userData: false,
  },
  {
    kind: 'teaching',
    title: '教学调整缓存',
    note: '放假/补课信息，清掉后重新拉取',
    prefixes: [],
    exact: ['teaching_adjustments_v1', 'ta_fetch'],
    userData: false,
  },
  {
    kind: 'notify',
    title: '提醒记录',
    note: '通知页的历史记录（不影响提醒设置）',
    prefixes: [],
    exact: ['notify_records_v1', 'notify_sent_v1'],
    userData: false,
  },
  {
    kind: 'ddl',
    title: '作业数据',
    note: '含你自己新增的作业条目，清掉不可恢复',
    prefixes: [],
    exact: ['ddl_schedule_v1'],
    userData: true,
  },
];

/** 默认勾选项（只含纯缓存，不含用户数据）。 */
export function defaultSpecs(): CacheSpec[] {
  return specs(false);
}

/**
 * 取可清理项。
 * @param includeUserData 是否包含 `userData` 项（默认 false —— 默认清理不应删用户数据）
 */
export function specs(includeUserData: boolean): CacheSpec[] {
  const out: CacheSpec[] = [];
  for (let i = 0; i < CACHE_SPECS.length; i++) {
    const s: CacheSpec = CACHE_SPECS[i];
    if (s.userData && !includeUserData) {
      continue;
    }
    out.push(s);
  }
  return out;
}

/** 某个键是否属于某个可清理项。 */
export function matches(spec: CacheSpec, key: string): boolean {
  for (let i = 0; i < spec.exact.length; i++) {
    if (spec.exact[i] === key) {
      return true;
    }
  }
  for (let i = 0; i < spec.prefixes.length; i++) {
    const p: string = spec.prefixes[i];
    if (p.length > 0 && key.indexOf(p) === 0) {
      return true;
    }
  }
  return false;
}

/**
 * 把实际存在的键归到可清理项上。
 * 返回 `kind → 键列表`（未命中的键不出现在结果里 —— 也就永远不会被删）。
 */
export function assignKeys(allKeys: string[], includeUserData: boolean): Map<string, string[]> {
  const out: Map<string, string[]> = new Map<string, string[]>();
  const list: CacheSpec[] = specs(includeUserData);
  for (let i = 0; i < allKeys.length; i++) {
    const key: string = allKeys[i];
    for (let s = 0; s < list.length; s++) {
      if (!matches(list[s], key)) {
        continue;
      }
      const prev: string[] | undefined = out.get(list[s].kind);
      if (prev === undefined) {
        out.set(list[s].kind, [key]);
      } else {
        prev.push(key);
      }
      break; // 一个键只归一项（先匹配先得，顺序即 CACHE_SPECS 顺序）
    }
  }
  return out;
}

/** 字节数 → 可读文本（`0 B` / `512 B` / `12.3 KB` / `1.4 MB`）。 */
export function sizeText(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }
  if (bytes < 1024) {
    return Math.round(bytes) + ' B';
  }
  const kb: number = bytes / 1024;
  if (kb < 1024) {
    return (Math.round(kb * 10) / 10) + ' KB';
  }
  const mb: number = kb / 1024;
  return (Math.round(mb * 10) / 10) + ' MB';
}

/** 合计体积。 */
export function totalBytes(values: number[]): number {
  let n: number = 0;
  for (let i = 0; i < values.length; i++) {
    if (Number.isFinite(values[i]) && values[i] > 0) {
      n += values[i];
    }
  }
  return n;
}

/**
 * 清理确认文案。**必须点名「含用户录入」**，否则用户以为只是清缓存。
 */
export function clearConfirmText(titles: string[], hasUserData: boolean): string {
  const list: string = titles.join('、');
  if (hasUserData) {
    return '将清空：' + list + '。\n其中「作业数据」含你自己新增的条目，清掉不可恢复。确定继续？';
  }
  return '将清空：' + list + '。\n这些只是缓存，下次打开会重新从学校拉取。确定继续？';
}

/** 空选择文案（禁止「确定」按钮在没选任何项时点了没反应）。 */
export function emptySelectionText(): string {
  return '没有选择任何项目';
}
