/**
 * seatlib `/api/Seat/tree` 响应模型与解析 —— 1:1 移植自 Android。
 *
 * Android 来源：
 *   features/seat/.../model/Area.kt:3            SeatTreeNode
 *   features/seat/.../api/SeatResponseParser.kt:106  parseSeatTree
 *
 * 实测层级：校区(type=0) → 楼层(type=0) → 区域(type=1)。
 * ⚠️ 移植纪律：期望值对着 Android 实测写（SeatResponseParserTest 有 realTreePayload）。
 */

/** 展平后的树节点（对齐 Android data class SeatTreeNode）。 */
export class SeatTreeNode {
  id: string;
  name: string;
  type: number;
  parentId: string | null;
  /** 楼层节点带平面图（1365×768，认路用）；区域节点地址实测 500，UI 侧需容错。 */
  imageUrl: string | null;

  constructor(id: string, name: string, type: number, parentId: string | null, imageUrl: string | null) {
    this.id = id;
    this.name = name;
    this.type = type;
    this.parentId = parentId;
    this.imageUrl = imageUrl;
  }
}

/** Seat/tree 的 data 元素原始 JSON 形态（递归 children）。 */
export interface SeatTreeRaw {
  id?: string;
  name?: string;
  /** ⚠️ 服务端实测返回**字符串** "0"/"1"（真机 fixture tools/fixtures/seat/tree-20261022.json，35 节点全是字符串）。
   *  这里放宽成 Both，解析时统一转 number —— 否则 groupTree 的 `k.type === 1` 严格相等
   *  会把所有区域（字符串 "1"）判成非区域，UI 显示全部楼层「该楼层暂无区域」（2026-11-18 真机抓到）。 */
  type?: number | string;
  image_url?: string;
  children?: SeatTreeRaw[];
}

/**
 * 服务端 type 字段 → number（对齐 Android `intOrZero`）。
 * 真机返回字符串 "0"/"1"，绝不能原样塞进 number 字段 —— groupTree 严格相等会全落空。
 */
export function intOrZero(v: number | string | undefined): number {
  if (typeof v === 'number') {
    return isFinite(v) ? Math.trunc(v) : 0;
  }
  if (typeof v === 'string') {
    const s: string = v.trim();
    if (s.length === 0) {
      return 0;
    }
    const n: number = Number(s);
    return isFinite(n) ? Math.trunc(n) : 0;
  }
  return 0;
}

/** 响应外壳 `{code, data}`（JSON duck typing，用 interface 而非 class）。 */
export interface SeatTreeEnvelope {
  code: number;
  data: SeatTreeRaw[];
}

/**
 * 递归展平（与 Android parseSeatTree 同构）：
 * - Android `intOrZero("type")`：缺省 0
 * - Android `optString("image_url").takeIf { isNotBlank && != "null" }`：空白或字面 "null" 视为无
 */
export function parseSeatTree(data: SeatTreeRaw[]): SeatTreeNode[] {
  const nodes: SeatTreeNode[] = [];
  const walk = (arr: SeatTreeRaw[], parentId: string | null): void => {
    for (const item of arr) {
      const id: string = item.id ?? '';
      const rawImage: string | undefined = item.image_url;
      let image: string | null = null;
      if (rawImage !== undefined && rawImage.trim().length > 0 && rawImage !== 'null') {
        image = rawImage;
      }
      nodes.push(new SeatTreeNode(id, item.name ?? '', intOrZero(item.type), parentId, image));
      const children: SeatTreeRaw[] | undefined = item.children;
      if (children !== undefined) {
        walk(children, id);
      }
    }
  };
  walk(data, null);
  return nodes;
}
