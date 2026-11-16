/**
 * 通知阅读状态（M15-B3）：显式「已读键快照」。
 *
 * 旧实现只存一个 `notify_last_seen_v1` 时间戳，未读靠 `firedMillis > lastSeen`：
 * 晚到但时间戳更早的消息会被误判已读，重排/时钟回拨也会让旧消息复活。
 * 现在以 `NotifyReadSnapshot` 为准，只有真正打开通知页时标记过的 key 才算已读。
 *
 * 兼容：`notify_last_seen_v1` **只读不写**，仅用于首次迁移（把旧语义覆盖到的
 * 已发键种进快照）；迁移完成后新代码不再依赖它。
 *
 * 原子性：快照是一个 JSON 字符串键，`Prefs.putString` 内部 `put + flush`；
 * 不做「先删旧键再写新键」这种中间态可见的两步操作。
 */

import { Prefs } from './Prefs.ts';
import {
  NotifyReadSnapshot,
  emptyReadSnapshot,
  mergeReadKeys,
  normalizeReadSnapshot
} from '../corelogic/NotifyReadLogic.ts';
import { info, warn } from '../core/log/BitLog.ts';

/** 新快照键。 */
const KEY_SNAPSHOT: string = 'notify_read_snapshot_v1';
/** 旧时间戳键：只读，用于一次性迁移。 */
const KEY_LEGACY_SEEN: string = 'notify_last_seen_v1';

export class NotifySeenStore {
  /**
   * 旧「上次打开时刻」；只用于迁移。
   * 从没打开过返回 0。
   */
  static async loadLegacySeen(): Promise<number> {
    return await Prefs.getNumber(KEY_LEGACY_SEEN, 0);
  }

  /**
   * 读快照；没有/损坏/版本不匹配 → null。
   * 返回 null 时调用方用 `seedSnapshotFromLegacy` 迁移，不把未知结构硬读成空。
   */
  static async loadSnapshot(): Promise<NotifyReadSnapshot | null> {
    const raw: string = await Prefs.getString(KEY_SNAPSHOT, '');
    if (raw.length === 0) {
      return null;
    }
    try {
      return normalizeReadSnapshot(JSON.parse(raw) as Object);
    } catch (e) {
      warn('NotifySeenStore loadSnapshot corrupt: ' + JSON.stringify(e));
      return null;
    }
  }

  /**
   * 把当前通知页看到的一批键标记为已读。
   *
   * 读最新快照再合并再写，避免用调用方手里的旧快照覆盖刚写入的键；
   * 单键原子写，不做多步删除。
   */
  static async markKeys(keys: string[]): Promise<void> {
    if (keys.length === 0) {
      return;
    }
    const current: NotifyReadSnapshot | null = await NotifySeenStore.loadSnapshot();
    const base: NotifyReadSnapshot = current === null ? emptyReadSnapshot() : current;
    const next: NotifyReadSnapshot = mergeReadKeys(base, keys);
    try {
      await Prefs.putString(KEY_SNAPSHOT, JSON.stringify(next as Object));
      info('NotifySeenStore marked=' + keys.length + ' total=' + next.keys.length);
    } catch (e) {
      warn('NotifySeenStore markKeys fail: ' + JSON.stringify(e));
    }
  }
}
