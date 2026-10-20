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
  type?: number;
  image_url?: string;
  children?: SeatTreeRaw[];
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
      nodes.push(new SeatTreeNode(id, item.name ?? '', item.type ?? 0, parentId, image));
      const children: SeatTreeRaw[] | undefined = item.children;
      if (children !== undefined) {
        walk(children, id);
      }
    }
  };
  walk(data, null);
  return nodes;
}
