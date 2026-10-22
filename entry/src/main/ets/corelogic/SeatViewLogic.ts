/**
 * 座位视图纯逻辑层（M9 UI 支撑，可单测）。
 *
 * 职责：把服务端原始数据（座位树 / 座位快照 / 研讨间）组装成 UI 直接可用的
 * 视图模型（VM）。UI 页（.ets）只做渲染，不含判断，保证「能被证伪」。
 *
 * 设计纪律：
 * - 纯函数，不 import 任何 @kit（@kit.ArkData / rcp / hilog），Node 可直接跑单测。
 * - 只 import 同目录其它纯逻辑（SeatLogic / SeatMapModel / SeminarLogic）。
 * - 状态判定复用 SeatLogic 的既有实现，不重复发明（铁律 0 ④：同一套动作只留一份）。
 */

import {
  type SeatTreeNode,
} from '../model/SeatTreeModel.ts';
import {
  type SeatSnapshot, SeatStatus,
  statusText, statusColor,
  type DateTime, minutesBetween,
} from './SeatLogic.ts';
import {
  type SeminarRecord, formatSeminarTime, getSeminarStatusText, isSeminarCancellable,
} from './SeminarLogic.ts';
import {
  type ViolationRecord, getViolationCountText, getActiveViolations, MAX_VIOLATIONS,
} from './SeatViolationLogic.ts';

// ── M9-2 座位树 → 三级分组 ─────────────────────────────────────────────────

/** 分组后的一级（校区）。 */
export interface CampusGroup {
  id: string;
  name: string;
  floors: FloorGroup[];
}

/** 分组后的二级（楼层）。 */
export interface FloorGroup {
  id: string;
  name: string;
  /** 楼层底图（认路用），可能为 null。 */
  imageUrl: string | null;
  areas: AreaGroup[];
}

/** 分组后的三级（区域）。 */
export interface AreaGroup {
  id: string;
  name: string;
}

/**
 * 把展平的 SeatTreeNode[] 按 parentId 重组成 校区→楼层→区域 三级。
 *
 * 层级约定（实测）：type=0 是校区/楼层（靠 parentId 区分），type=1 是区域。
 * - 根节点（parentId=null）= 校区。
 * - 校区的直接子节点 = 楼层。
 * - 楼层的直接子节点 = 区域（叶子）。
 *
 * 容错：未知 type / 缺失 parent 的孤儿节点不进任何组（UI 侧不渲染孤儿）。
 */
export function groupTree(nodes: SeatTreeNode[]): CampusGroup[] {
  // 按 parent 建索引
  const byParent: Map<string, SeatTreeNode[]> = new Map();
  const roots: SeatTreeNode[] = [];
  for (const n of nodes) {
    if (n.parentId === null) {
      roots.push(n);
    } else {
      const arr = byParent.get(n.parentId);
      if (arr === undefined) {
        byParent.set(n.parentId, [n]);
      } else {
        arr.push(n);
      }
    }
  }
  const sortFn = (a: SeatTreeNode, b: SeatTreeNode): number => {
    const an = a.name.localeCompare(b.name, 'zh', { numeric: true });
    if (an !== 0) return an;
    return a.id.localeCompare(b.id);
  };
  roots.sort(sortFn);

  const out: CampusGroup[] = [];
  for (const campus of roots) {
    const campusKids = byParent.get(campus.id) ?? [];
    const floors: FloorGroup[] = [];
    for (const floor of campusKids) {
      // 楼层的区域 = 楼层直接子节点（type=1）+ 更深层中间节点（type=0）下钻收的叶子
      const areas: AreaGroup[] = collectDeeperAreas(byParent, floor.id);
      areas.sort((a, b) => a.name.localeCompare(b.name, 'zh', { numeric: true }) || a.id.localeCompare(b.id));
      floors.push({ id: floor.id, name: floor.name, imageUrl: floor.imageUrl, areas });
    }
    floors.sort((a, b) => a.name.localeCompare(b.name, 'zh', { numeric: true }) || a.id.localeCompare(b.id));
    out.push({ id: campus.id, name: campus.name, floors });
  }
  return out;
}

/** 递归收集某节点下所有 type=1（区域）叶子。 */
function collectDeeperAreas(byParent: Map<string, SeatTreeNode[]>, nodeId: string): AreaGroup[] {
  // 楼层直接子节点若是楼层（type=0）则继续下钻；若是区域（type=1）则是叶子
  const kids = byParent.get(nodeId) ?? [];
  const out: AreaGroup[] = [];
  for (const k of kids) {
    if (k.type === 1) {
      out.push({ id: k.id, name: k.name });
    } else {
      // 中间层（如楼层下还有子楼层）：把它的区域子节点收进来
      const subKids = byParent.get(k.id) ?? [];
      if (subKids.length === 0) {
        // 无子节点的中间节点当作叶子区（容错）
        out.push({ id: k.id, name: k.name });
      } else {
        for (const sk of subKids) {
          out.push({ id: sk.id, name: sk.name });
        }
      }
    }
  }
  return out;
}

// ── M9-3 座位快照 → 视图 ───────────────────────────────────────────────────

/** 单个座位的视图模型（底图渲染 / 列表展示共用）。 */
export interface SeatVM {
  seatId: string;
  seatName: string;
  status: SeatStatus;
  statusText: string;
  statusColorLight: string;
  statusColorDark: string;
  /** 是否可点选预约（仅空闲可约）。 */
  reservable: boolean;
  /** 是否自己的预约。 */
  isYours: boolean;
  /** 预约时段文案（"08:00-10:00"），无则空串。 */
  timeText: string;
  /** 占位者姓名（被他人占时），无则空串。 */
  otherName: string;
}

/** 一组座位的汇总。 */
export interface SeatSummaryVM {
  total: number;
  free: number;
  yours: number;
  others: number;
  /** 空闲率文案（如「空闲 12/48」），total=0 时给「暂无座位」。 */
  freeRatio: string;
}

/** 把座位快照转视图模型（颜色取浅/深两档，UI 按主题取用）。 */
export function toSeatVM(s: SeatSnapshot): SeatVM {
  let timeText = '';
  if (s.timeRange !== null) {
    timeText = fmtMinutes(s.timeRange[0].minutes) + '-' + fmtMinutes(s.timeRange[1].minutes);
  }
  return {
    seatId: s.seatId,
    seatName: s.seatName,
    status: s.status,
    statusText: statusText(s.status),
    statusColorLight: statusColor(s.status, false),
    statusColorDark: statusColor(s.status, true),
    reservable: s.status === SeatStatus.FREE,
    isYours: s.status === SeatStatus.RESERVED_YOURS || s.status === SeatStatus.CHECKED_IN,
    timeText,
    otherName: s.otherName ?? '',
  };
}

/** 统计一组座位。 */
export function summarizeSeats(seats: SeatSnapshot[]): SeatSummaryVM {
  let free = 0;
  let yours = 0;
  let others = 0;
  for (const s of seats) {
    if (s.status === SeatStatus.FREE) free++;
    else if (s.status === SeatStatus.RESERVED_YOURS || s.status === SeatStatus.CHECKED_IN) yours++;
    else if (s.status === SeatStatus.RESERVED_OTHERS) others++;
  }
  const total = seats.length;
  const freeRatio = total === 0 ? '暂无座位' : '空闲 ' + free + '/' + total;
  return { total, free, yours, others, freeRatio };
}

/** 把分钟（0-1439）格式化为 HH:mm。 */
export function fmtMinutes(mins: number): string {
  const m = ((mins % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return String(h).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
}

// ── M9-4 预约时段选项 ─────────────────────────────────────────────────────

/** 预约表单的时段选项（开始/结束时刻）。 */
export interface SlotOptionsVM {
  /** 可选的开始时刻（HH:mm 文案 + 分钟值）。 */
  startSlots: { label: string; minutes: number }[];
  /** 可选的结束时刻。 */
  endSlots: { label: string; minutes: number }[];
  /** 时长上限（分钟，与 SeatLogic.MAX_RESERVATION_MINUTES 一致）。 */
  maxDuration: number;
}

/**
 * 生成预约时段选项。
 * - 开始时刻：从 todayStart（今天 00:00 的分钟）起，按 stepMin 递增，覆盖全天。
 * - 结束时刻：固定 30 分钟粒度，最多不超过开始 + maxDuration。
 * 纯函数，UI 直接 ForEach 渲染。
 */
export function buildSlotOptions(todayStartMinutes: number, stepMin: number, maxDuration: number): SlotOptionsVM {
  const startSlots: { label: string; minutes: number }[] = [];
  const endSlots: { label: string; minutes: number }[] = [];
  const dayMin = 1440;
  for (let m = todayStartMinutes; m < dayMin; m += stepMin) {
    startSlots.push({ label: fmtMinutes(m), minutes: m });
  }
  for (let m = 0; m <= dayMin; m += stepMin) {
    endSlots.push({ label: fmtMinutes(m), minutes: m });
  }
  return { startSlots, endSlots, maxDuration };
}

/**
 * 校验一次预约的时段选择（纯逻辑，UI 提交前调）。
 * @returns 错误文案（空串 = 通过）。
 */
export function validateSlot(startMin: number, endMin: number, maxDuration: number): string {
  if (startMin < 0 || startMin >= 1440) return '开始时刻无效';
  if (endMin <= 0 || endMin > 1440) return '结束时刻无效';
  if (endMin <= startMin) return '结束时刻必须晚于开始时刻';
  const dur = endMin - startMin;
  if (dur > maxDuration) {
    return '单次最长 ' + Math.floor(maxDuration / 60) + ' 小时（超出 ' + dur + ' 分钟）';
  }
  if (dur < 30) return '单次至少 30 分钟';
  return '';
}

// ── M9-5 我的预约 → 视图 ──────────────────────────────────────────────────

/** 我的一条预约（视图）。 */
export interface MyReservationVM {
  reservationId: string;
  seatName: string;
  timeText: string;
  /** 'active' 生效中 / 'expired' 已过期。 */
  phase: string;
  /** 剩余分钟（>0）。 */
  remainingMin: number;
  /** 是否可取消。 */
  cancellable: boolean;
}

/** 把快照里属于「我」的预约抽出来做视图。 */
export function myReservations(seats: SeatSnapshot[], now: DateTime): MyReservationVM[] {
  const out: MyReservationVM[] = [];
  for (const s of seats) {
    if (!(s.status === SeatStatus.RESERVED_YOURS || s.status === SeatStatus.CHECKED_IN)) continue;
    let timeText = '';
    let remaining = 0;
    let phase = 'active';
    if (s.timeRange !== null) {
      timeText = fmtMinutes(s.timeRange[0].minutes) + '-' + fmtMinutes(s.timeRange[1].minutes);
      const delta = minutesBetween(now, s.timeRange[1]);
      if (delta <= 0) {
        phase = 'expired';
      } else {
        remaining = delta;
      }
    }
    out.push({
      reservationId: s.reservationId ?? '',
      seatName: s.seatName,
      timeText,
      phase,
      remainingMin: remaining,
      // 已签到的不可取消；过期不可取消
      cancellable: !s.isCheckedIn && phase === 'active',
    });
  }
  out.sort((a, b) => b.remainingMin - a.remainingMin);
  return out;
}

// ── M9-6 违约 → 视图 ─────────────────────────────────────────────────────

/** 违约展示。 */
export interface ViolationVM {
  countText: string;
  /** 是否已达上限（N/5）。 */
  limitReached: boolean;
  /** 近 30 天活跃违约的逐条文案。 */
  items: string[];
}

/** 组装违约展示。 */
export function buildViolationVM(records: ViolationRecord[], nowEpochDay: number): ViolationVM {
  const active = getActiveViolations(records, nowEpochDay);
  const items: string[] = [];
  for (const r of active) {
    items.push(formatViolationItem(r, nowEpochDay));
  }
  return {
    countText: getViolationCountText(records, nowEpochDay),
    limitReached: active.length >= MAX_VIOLATIONS,
    items,
  };
}

function formatViolationItem(r: ViolationRecord, nowEpochDay: number): string {
  const daysAgo = nowEpochDay - r.date;
  const when = daysAgo <= 0 ? '今天' : (daysAgo === 1 ? '昨天' : daysAgo + ' 天前');
  return (r.seatNo.length > 0 ? '「' + r.seatNo + '」' : '') + when + ' 未签到';
}

// ── M9-7 研讨间 → 视图 ────────────────────────────────────────────────────

/** 一条研讨间预约的视图。 */
export interface SeminarVM {
  name: string;
  timeText: string;
  statusText: string;
  cancellable: boolean;
}

/** 组装研讨间列表视图。 */
export function seminarVMs(records: SeminarRecord[]): SeminarVM[] {
  const out: SeminarVM[] = [];
  for (const r of records) {
    out.push({
      name: r.nameMerge.length > 0 ? r.nameMerge : r.id,
      timeText: formatSeminarTime(r),
      statusText: getSeminarStatusText(r),
      cancellable: isSeminarCancellable(r),
    });
  }
  out.sort((a, b) => a.timeText.localeCompare(b.timeText));
  return out;
}
