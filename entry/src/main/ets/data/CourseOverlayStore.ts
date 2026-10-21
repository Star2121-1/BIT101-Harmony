/**
 * 手动改课表的**覆盖层存储**（1:1 对照 Android `DefaultCourseOverlayRepo`）。
 *
 * ⚠️ 这里**绝不碰课表缓存** —— 那是教务的地盘，同步时会被整份覆盖。
 * 用户看到的效果由读路径合并出来（见 `CourseOverlayLogic.mergeOverlay`）。
 *
 * 存储形态：Prefs 里一个 JSON 数组（覆盖层只有几十条，不值得单独建库）。
 */

import { Prefs } from './Prefs.ts';
import {
  CourseOverlay,
  keyOfOverlay,
  nextOverlayId,
  normalizeAnchors
} from '../corelogic/CourseOverlayLogic.ts';
import { info, warn } from '../core/log/BitLog.ts';

const KEY_OVERLAYS: string = 'course_overlays_v1';

export class CourseOverlayStore {
  /** 全部覆盖层（损坏条目跳过，不整份作废）。 */
  static async load(): Promise<CourseOverlay[]> {
    const json: string = await Prefs.getString(KEY_OVERLAYS, '');
    if (json.length === 0) {
      return [];
    }
    try {
      const parsed = JSON.parse(json) as CourseOverlay[];
      if (!Array.isArray(parsed)) {
        return [];
      }
      const out: CourseOverlay[] = [];
      for (let i = 0; i < parsed.length; i++) {
        const o = parsed[i];
        if (o === null || typeof o !== 'object') continue;
        if (typeof o.id !== 'number' || typeof o.kind !== 'string' || typeof o.term !== 'string') continue;
        out.push(o);
      }
      return out;
    } catch (e) {
      warn('CourseOverlayStore load corrupt: ' + JSON.stringify(e));
      return [];
    }
  }

  private static async saveAll(list: CourseOverlay[]): Promise<void> {
    await Prefs.putString(KEY_OVERLAYS, JSON.stringify(list));
  }

  /**
   * 写入（新增或更新）。语义与 Android 逐条对齐：
   *
   * - 带了 id ⇒ 按 id 找；没带 ⇒ 按「类型 + 锚点」找（同一节课只留一条修改）
   * - 原本是 ADD 的课被再编辑 ⇒ **保持 ADD**（变 EDIT 会找不到基准而从课表消失）
   * - 更新已有条目 ⇒ **锚点一律沿用现有的**（UI 手上只有合并后的行，拿它取锚点会漂移）
   *
   * @returns 落库后的覆盖层（含最终 id）
   */
  static async upsert(overlay: CourseOverlay): Promise<CourseOverlay> {
    const list: CourseOverlay[] = await CourseOverlayStore.load();

    let existingIndex: number = -1;
    if (overlay.id !== 0) {
      for (let i = 0; i < list.length; i++) {
        if (list[i].id === overlay.id) {
          existingIndex = i;
          break;
        }
      }
    } else {
      const k: string = keyOfOverlay(overlay);
      for (let i = 0; i < list.length; i++) {
        if (list[i].kind === overlay.kind && keyOfOverlay(list[i]) === k) {
          existingIndex = i;
          break;
        }
      }
    }

    if (existingIndex < 0) {
      // 新建：ADD 的锚点跟显示值同步
      const normalized: CourseOverlay = normalizeAnchors(overlay, null);
      normalized.id = nextOverlayId(list);
      list.push(normalized);
      await CourseOverlayStore.saveAll(list);
      info('overlay insert id=' + normalized.id + ' kind=' + normalized.kind);
      return normalized;
    }

    const existing: CourseOverlay = list[existingIndex];
    let incoming: CourseOverlay = normalizeAnchors(overlay, existing);
    // ⚠️ 原本是本地新增的课被再编辑 ⇒ 保持 ADD（否则合并时没有基准，课会消失）
    if (existing.kind === 'ADD') {
      incoming.kind = 'ADD';
    }
    incoming.id = existing.id;
    list[existingIndex] = incoming;
    await CourseOverlayStore.saveAll(list);
    info('overlay update id=' + incoming.id + ' kind=' + incoming.kind);
    return incoming;
  }

  /** 删除（恢复原样 / 撤销新增）。 */
  static async remove(id: number): Promise<void> {
    const list: CourseOverlay[] = await CourseOverlayStore.load();
    const kept: CourseOverlay[] = list.filter((o: CourseOverlay) => o.id !== id);
    if (kept.length !== list.length) {
      await CourseOverlayStore.saveAll(kept);
      info('overlay removed id=' + id);
    }
  }

  /** 清空（登出/重置用；换账号不串修改）。 */
  static async clear(): Promise<void> {
    await Prefs.remove(KEY_OVERLAYS);
  }
}
