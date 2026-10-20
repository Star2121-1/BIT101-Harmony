/**
 * 教学安排调整取数（列表页 → 逐条正文 → 解析 → 缓存）
 *
 * 1:1 对照 Android：data/.../repo/DefaultTeachingAdjustmentRepo.kt（93 行）。
 *
 * ⚠️ **一切失败都静默降级**：它挂在课表页上，抛出去会把整页拖垮，
 * 而「拿不到调休」只是少了个增强，不该影响看课表。
 *
 * ⚠️ 缓存策略与 Android 一致（这条是刻意抄的，不是随手写）：
 * 联网失败 ⇒ **退回旧缓存，哪怕已过期**。宁可略旧，也不要让课表**突然**「没有调休」——
 * 那比一直旧着更误导用户。
 */

import { rcp } from '@kit.RemoteCommunicationKit';
import { Context } from '@kit.AbilityKit';
import { RcpFactory } from '../core/net/RcpFactory.ts';
import { Prefs } from '../data/Prefs.ts';
import { info, warn } from '../core/log/BitLog.ts';
import {
  TeachingEntry, TeachingNotice, isAdjustmentNotice, parseNotice, parseNoticeList
} from '../corelogic/TeachingAdjustmentParser.ts';
import { DayPlan } from '../corelogic/TeachingAdjustment.ts';

/** 教学运行 → 课程调整 栏目（**免登录**公开页面）。 */
const LIST_URL: string = 'https://jxzx.bit.edu.cn/jxyx/kctz/';

/** 只取最近 3 条 —— 一学年就 2~4 条（中秋国庆 / 元旦 / 上半年节假日）。 */
const MAX_NOTICES: number = 3;

/** 缓存有效期 12 小时：学校发通知是低频事件，一天两次足够。 */
const TTL_MS: number = 12 * 60 * 60 * 1000;

/** 与 Android 逐字一致（站点对桌面 Chrome UA 也放行，此处沿用已验证值）。 */
const UA: string = 'Mozilla/5.0 (Linux; Android 13)';

const CACHE_KEY: string = 'teaching_adjustments_v1';
const JAR_ID: string = 'ta_fetch';

/** 一次取数的完整结果。 */
export interface TeachingAdjustments {
  entries: TeachingEntry[];
  /** ⚠️ 含**没能解析出日期**的通知 —— 那几条也要让用户看到（附原文链接），
   *  否则「学校发了通知但 App 没反应」无法解释。 */
  notices: TeachingNotice[];
  fetchedAt: number;
  /** 本次数据是否来自缓存（UI 可据此说「上次结果」）。 */
  fromCache: boolean;
}

interface CachedTa {
  fetchedAt: number;
  entries: TeachingEntry[];
  notices: TeachingNotice[];
}

export class TeachingAdjustmentService {
  /**
   * 取教学安排调整。**永不抛错**（失败回空/旧缓存）——课表页不该被它拖垮。
   * @param forceRefresh 跳过 TTL（设置页「立即刷新」用）
   */
  static async load(context: Context, forceRefresh: boolean): Promise<TeachingAdjustments> {
    const cached: CachedTa | null = await TeachingAdjustmentService.readCache();
    const now: number = Date.now();
    if (!forceRefresh && cached !== null && now - cached.fetchedAt < TTL_MS) {
      return {
        entries: cached.entries, notices: cached.notices,
        fetchedAt: cached.fetchedAt, fromCache: true
      };
    }

    let fetched: CachedTa | null = null;
    try {
      fetched = await TeachingAdjustmentService.fetchAll(context);
    } catch (e) {
      warn('TeachingAdjustment fetch fail: ' + JSON.stringify(e));
      fetched = null;
    }

    if (fetched === null) {
      // 联网失败（校外 / 站点维护）⇒ 退回旧缓存，哪怕已过期
      if (cached !== null) {
        info('TeachingAdjustment fallback to stale cache age=' + (now - cached.fetchedAt) + 'ms');
        return {
          entries: cached.entries, notices: cached.notices,
          fetchedAt: cached.fetchedAt, fromCache: true
        };
      }
      return { entries: [], notices: [], fetchedAt: 0, fromCache: false };
    }

    await TeachingAdjustmentService.writeCache(fetched);
    return {
      entries: fetched.entries, notices: fetched.notices,
      fetchedAt: fetched.fetchedAt, fromCache: false
    };
  }

  /** 抓列表页 → 取最近几条「教学安排调整」→ 逐条抓正文解析。 */
  private static async fetchAll(context: Context): Promise<CachedTa | null> {
    const session: rcp.Session = await RcpFactory.createSession(context, JAR_ID, true);
    const headers: rcp.RequestHeaders = {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9',
      'User-Agent': UA
    };

    const list = await RcpFactory.getText(session, LIST_URL, headers);
    if (list.status !== 200 || list.body.length === 0) {
      warn('TeachingAdjustment list status=' + list.status + ' len=' + list.body.length);
      return null;
    }

    const all: TeachingNotice[] = parseNoticeList(list.body, LIST_URL);
    const picked: TeachingNotice[] = [];
    for (let i = 0; i < all.length && picked.length < MAX_NOTICES; i++) {
      if (isAdjustmentNotice(all[i].title)) {
        picked.push(all[i]);
      }
    }
    if (picked.length === 0) {
      warn('TeachingAdjustment no adjustment notice among ' + all.length + ' links');
      return null;
    }

    const merged: TeachingEntry[] = [];
    for (let i = 0; i < picked.length; i++) {
      try {
        const res = await RcpFactory.getText(session, picked[i].url, headers);
        if (res.status !== 200) {
          warn('TeachingAdjustment notice status=' + res.status + ' url=' + picked[i].url);
          continue;
        }
        const entries: TeachingEntry[] = parseNotice(res.body, picked[i].title, picked[i].url);
        for (let k = 0; k < entries.length; k++) {
          merged.push(entries[k]);
        }
      } catch (e) {
        // 单条失败不拖累其它几条
        warn('TeachingAdjustment single notice fail: ' + JSON.stringify(e));
      }
    }

    // 列表页**由新到旧** ⇒ 同一天被多条覆盖时保留**较新**那条（先出现的）
    const dedup: TeachingEntry[] = [];
    const seenDays: number[] = [];
    for (let i = 0; i < merged.length; i++) {
      if (seenDays.indexOf(merged[i].day) >= 0) {
        continue;
      }
      seenDays.push(merged[i].day);
      dedup.push(merged[i]);
    }
    dedup.sort((a: TeachingEntry, b: TeachingEntry) => a.day - b.day);

    info('TeachingAdjustment fetched notices=' + picked.length + ' entries=' + dedup.length +
      ' (raw=' + merged.length + ')');
    return { fetchedAt: Date.now(), entries: dedup, notices: picked };
  }

  // ── 缓存（Preferences，JSON）────────────────────────────────────────

  private static async readCache(): Promise<CachedTa | null> {
    try {
      const raw: string = await Prefs.getString(CACHE_KEY, '');
      if (raw.length === 0) {
        return null;
      }
      const obj: Object = JSON.parse(raw) as Object;
      const rec: Record<string, Object> = obj as Record<string, Object>;
      const fetchedAt: number = typeof rec['fetchedAt'] === 'number' ? rec['fetchedAt'] as number : 0;
      const entries: TeachingEntry[] = TeachingAdjustmentService.parseEntries(rec['entries']);
      const notices: TeachingNotice[] = TeachingAdjustmentService.parseNotices(rec['notices']);
      if (fetchedAt <= 0) {
        return null;
      }
      return { fetchedAt: fetchedAt, entries: entries, notices: notices };
    } catch (e) {
      warn('TeachingAdjustment readCache fail: ' + JSON.stringify(e));
      return null;
    }
  }

  private static async writeCache(data: CachedTa): Promise<void> {
    try {
      await Prefs.putString(CACHE_KEY, JSON.stringify(data as Object));
    } catch (e) {
      warn('TeachingAdjustment writeCache fail: ' + JSON.stringify(e));
    }
  }

  /** JSON → 模型。**逐字段重建**（不做整体断言，脏数据只丢那一条）。 */
  private static parseEntries(v: Object | undefined): TeachingEntry[] {
    const out: TeachingEntry[] = [];
    if (!Array.isArray(v)) {
      return out;
    }
    const arr: Object[] = v as Object[];
    for (let i = 0; i < arr.length; i++) {
      const rec: Record<string, Object> = arr[i] as Record<string, Object>;
      const day: number = typeof rec['day'] === 'number' ? rec['day'] as number : -1;
      if (day < 0) {
        continue;
      }
      const plan: DayPlan | null = TeachingAdjustmentService.parsePlan(rec['plan']);
      if (plan === null) {
        continue;
      }
      out.push({
        day: day,
        plan: plan,
        note: typeof rec['note'] === 'string' ? rec['note'] as string : '',
        sourceTitle: typeof rec['sourceTitle'] === 'string' ? rec['sourceTitle'] as string : '',
        sourceUrl: typeof rec['sourceUrl'] === 'string' ? rec['sourceUrl'] as string : ''
      });
    }
    return out;
  }

  private static parsePlan(v: Object | undefined): DayPlan | null {
    if (v === undefined || v === null) {
      return null;
    }
    const rec: Record<string, Object> = v as Record<string, Object>;
    const kind: string = typeof rec['kind'] === 'string' ? rec['kind'] as string : '';
    if (kind === 'NoClass') {
      return { kind: 'NoClass' };
    }
    if (kind === 'MakeUp') {
      const w: number = typeof rec['targetWeekday'] === 'number' ? rec['targetWeekday'] as number : 0;
      if (w < 1 || w > 7) {
        return null;
      }
      return { kind: 'MakeUp', targetWeekday: w };
    }
    return null;
  }

  private static parseNotices(v: Object | undefined): TeachingNotice[] {
    const out: TeachingNotice[] = [];
    if (!Array.isArray(v)) {
      return out;
    }
    const arr: Object[] = v as Object[];
    for (let i = 0; i < arr.length; i++) {
      const rec: Record<string, Object> = arr[i] as Record<string, Object>;
      const title: string = typeof rec['title'] === 'string' ? rec['title'] as string : '';
      const url: string = typeof rec['url'] === 'string' ? rec['url'] as string : '';
      if (title.length === 0 || url.length === 0) {
        continue;
      }
      out.push({ title: title, url: url });
    }
    return out;
  }
}
