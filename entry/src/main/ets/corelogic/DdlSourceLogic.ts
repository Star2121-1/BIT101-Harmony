/**
 * 作业（DDL）**来源开关**的纯逻辑（M4-5）。
 *
 * ## 现在有哪些源
 * | 源 | 现状 | 能不能切 |
 * |---|---|---|
 * | 延河课堂（eclass） | 已接（`EclassSyncService` 落库，`group='eclass'`） | ✅ |
 * | 本地新增 | 本机条目（`uid` 前缀 `local_`，`group='本地'`） | ✅ |
 * | 乐学（lexue） | **没有契约依据**（未抓包、未验证接口） | ❌ 只列出来说明为什么没有 |
 *
 * ## 为什么「乐学」要显示成不可用而不是藏起来
 * 原版 Android 有两个源。这里只藏起来会让用户以为「鸿蒙版没有这个功能」，
 * 而真实原因是**我们还没验证过接口**——把它列出来并写明原因，比假装不存在诚实。
 *
 * ## 过滤纪律
 * - 过滤是**展示层**的事：库里始终保存两源的数据（切回去不用重新同步）；
 * - 两个开关都关时返回空列表，**但页面要给明确提示**（否则看起来像同步坏了）；
 * - 认不出的 `group`（将来加了新源）默认**显示**：宁可多显示一条，也不要让数据静默消失。
 */

import type { DdlEntry } from './DdlRules.ts';

/** 来源键（与 `DdlEntry.group` 的落库值一致）。 */
export const SRC_ECLASS: string = 'eclass';
export const SRC_LOCAL: string = 'local';
export const SRC_LEXUE: string = 'lexue';
/** 本地条目的落库分组名（`DdlStore.add` 写的就是这个）。 */
export const GROUP_LOCAL: string = '本地';

/** 设置页展示的一行源。 */
export interface DdlSourceOption {
  key: string;
  label: string;
  /** 能否切换（false = 只展示说明）。 */
  usable: boolean;
  note: string;
}

export const DDL_SOURCES: DdlSourceOption[] = [
  {
    key: SRC_ECLASS,
    label: '延河课堂',
    usable: true,
    note: '课程作业与截止时间'
  },
  {
    key: SRC_LOCAL,
    label: '本地新增',
    usable: true,
    note: '自己加的作业（只存本机）'
  },
  {
    key: SRC_LEXUE,
    label: '乐学',
    usable: false,
    note: '接口未验证，本版不提供（避免显示错数据）'
  }
];

/** 开关状态。 */
export interface DdlSourcePrefs {
  eclass: boolean;
  local: boolean;
}

export const DEFAULT_DDL_SOURCE: DdlSourcePrefs = { eclass: true, local: true };

/** 编码成偏好串：`eclass=1;local=1`（人可读，坏值好排查）。 */
export function encodePrefs(p: DdlSourcePrefs): string {
  return 'eclass=' + (p.eclass ? '1' : '0') + ';local=' + (p.local ? '1' : '0');
}

/** 解码；形状不对回落默认（两源都开）。 */
export function decodePrefs(raw: string): DdlSourcePrefs {
  if (raw.trim().length === 0) {
    return DEFAULT_DDL_SOURCE;
  }
  let eclass: boolean = DEFAULT_DDL_SOURCE.eclass;
  let local: boolean = DEFAULT_DDL_SOURCE.local;
  const parts: string[] = raw.split(';');
  for (let i = 0; i < parts.length; i++) {
    const kv: string[] = parts[i].split('=');
    if (kv.length !== 2) {
      continue;
    }
    const k: string = kv[0].trim();
    const on: boolean = kv[1].trim() === '1';
    if (k === 'eclass') {
      eclass = on;
    } else if (k === 'local') {
      local = on;
    }
  }
  return { eclass: eclass, local: local };
}

/** 一条作业属于哪个源。 */
export function sourceOf(e: DdlEntry): string {
  if (e.uid.startsWith('local_') || e.group === GROUP_LOCAL) {
    return SRC_LOCAL;
  }
  if (e.group === SRC_LEXUE) {
    return SRC_LEXUE;
  }
  if (e.group === SRC_ECLASS) {
    return SRC_ECLASS;
  }
  // 认不出的源：当作 eclass 处理（默认显示，不让数据静默消失）
  return SRC_ECLASS;
}

/**
 * 按开关过滤。
 * 乐学条目**永远不显示**（本版不支持该源，库里也就不该有；万一有也不显示 ——
 * 那些条目没有经过验证的截止时间，显示出来是误导）。
 */
export function visibleEntries(entries: DdlEntry[], prefs: DdlSourcePrefs): DdlEntry[] {
  const out: DdlEntry[] = [];
  for (let i = 0; i < entries.length; i++) {
    const src: string = sourceOf(entries[i]);
    if (src === SRC_LOCAL) {
      if (prefs.local) {
        out.push(entries[i]);
      }
      continue;
    }
    if (src === SRC_LEXUE) {
      continue;
    }
    if (prefs.eclass) {
      out.push(entries[i]);
    }
  }
  return out;
}

/** 两个开关都关（页面要提示「没有启用任何来源」而不是显示空列表）。 */
export function noneEnabled(p: DdlSourcePrefs): boolean {
  return !p.eclass && !p.local;
}

/** 一行摘要（设置页标题右侧）。 */
export function prefsSummary(p: DdlSourcePrefs): string {
  if (noneEnabled(p)) {
    return '未启用任何来源';
  }
  const on: string[] = [];
  if (p.eclass) {
    on.push('延河课堂');
  }
  if (p.local) {
    on.push('本地');
  }
  return on.join(' + ');
}
