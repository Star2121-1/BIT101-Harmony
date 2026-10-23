/**
 * 空教室页「校区分组」纯函数（#85 UI 迁移）
 * =========================================================
 * 1:1 照搬 Android `features/schedule/.../classroom/CampusGrouping.kt`
 * （含其单测钉死的行为），供 ClassroomPage 三级折叠的最外层使用：
 * 校区 → 教学楼 → 教室。
 *
 * ## 为什么在客户端分组
 * 教学楼接口一次就能拿到**所有校区**的楼，每栋楼自带所属校区
 * （`XXXQDM` / `XXXQDM_DISPLAY`）——不必为每个校区单独发一次请求。
 *
 * ## 排序
 * **当前校区排最前**（设置里选的默认校区，它会被自动展开），
 * 其余保持服务端返回顺序（良乡在前之类的顺序是学校定的，不重排）。
 *
 * ## 两个实机踩过的坑（照搬源码注释，单测钉死）
 * 1. 校区代码为空 ⇒ 退化成用校区名当键，名字也空才丢兜底桶
 *    —— 不能让两栋楼因为「代码都为空」被合成同一个校区；
 * 2. 学校接口会把「没有校区」原样返回成**字符串 `"null"`**（不是空串、
 *    也不是 JSON null）——`ifBlank` 兜不住，页面上出现过名字叫 `null` 的校区。
 */

import type { BuildingInfo } from '../core/model/SchoolModels.ts';

/** 楼里连校区信息都没有时的兜底桶键（正常不该出现）。 */
export const UNKNOWN_CODE: string = '__unknown__';

/**
 * [UNKNOWN_CODE] 那一桶的**展示名**。
 *
 * ⚠️ 分组键那串下划线是为了「不会和真实校区代码撞上」才这么写的，
 * **不能直接显示给用户** —— 那就是一团乱码。
 */
export const UNKNOWN_NAME: string = '未归类';

/** 空教室页的一个校区分组（三级折叠的最外层）。 */
export interface CampusGroup {
  /** 校区代码（分组键）；楼里没带校区时代退化成校区名或 [UNKNOWN_CODE]。 */
  campusCode: string;
  /** 展示用的校区名（保证非空、不会是字面量 null）。 */
  campusName: string;
  /** 该校区下的教学楼，保持服务端返回顺序。 */
  buildings: BuildingInfo[];
  /** 是不是设置里选的那个校区（它排在列表最前并自动展开）。 */
  isCurrent: boolean;
}

/**
 * 清洗校区字段：null / 空 / **字面量字符串 "null"** 都算没有。
 *
 * ⚠️ 大小写不敏感（"NULL" / "Null" 一样治）——实测只见过小写，
 * 但服务端哪天改大小写不该让页面重新长出个 `null` 校区来。
 */
function cleanCampus(raw: string): string {
  const t: string = raw.trim();
  if (t.length === 0 || t.toLowerCase() === 'null') {
    return '';
  }
  return t;
}

/** 判定某个分组是不是「当前校区」：代码优先；老版本只存了名字时退化成名字比对。 */
function isCurrentGroup(code: string, name: string, currentCampusCode: string, currentCampusName: string): boolean {
  if (currentCampusCode.trim().length > 0) {
    return code === currentCampusCode;
  }
  if (currentCampusName.trim().length > 0) {
    return name === currentCampusName;
  }
  return false;
}

/**
 * 把「全部教学楼」按校区分组（纯函数，可单测）。
 *
 * @param buildings 教学楼列表（任意顺序，接口一次返回所有校区）
 * @param currentCampusCode 设置里选的默认校区代码（空 = 没设过）
 * @param currentCampusName 设置里选的默认校区名（代码为空时的退化判据）
 */
export function groupCampuses(
  buildings: BuildingInfo[],
  currentCampusCode: string,
  currentCampusName: string
): CampusGroup[] {
  // Map 保持插入顺序 = 服务端顺序（对应 Kotlin 的 LinkedHashMap）
  const buckets: Map<string, BuildingInfo[]> = new Map();
  const names: Map<string, string> = new Map();

  for (let i = 0; i < buildings.length; i++) {
    const b: BuildingInfo = buildings[i];
    const campusCode: string = cleanCampus(b.campusCode);
    const campusName: string = cleanCampus(b.campusName);

    // 校区代码为空时退化成校区名，再不行丢进兜底桶 ——
    // 总之不能让两栋楼因为「代码都为空」被合成同一个校区
    let code: string = campusCode;
    if (code.length === 0) {
      code = campusName;
    }
    if (code.length === 0) {
      code = UNKNOWN_CODE;
    }

    const bucket: BuildingInfo[] | undefined = buckets.get(code);
    if (bucket === undefined) {
      buckets.set(code, [b]);
    } else {
      bucket.push(b);
    }

    if (!names.has(code) || names.get(code)!.length === 0) {
      // 显示名优先用真名；拿不到就用代码；连代码都没有才落进「未归类」
      let display: string = campusName;
      if (display.length === 0 && code !== UNKNOWN_CODE) {
        display = code;
      }
      if (display.length === 0) {
        display = UNKNOWN_NAME;
      }
      names.set(code, display);
    }
  }

  const groups: CampusGroup[] = [];
  buckets.forEach((list: BuildingInfo[], code: string) => {
    let name: string = names.get(code) ?? '';
    if (name.length === 0) {
      name = code === UNKNOWN_CODE ? UNKNOWN_NAME : code;
    }
    groups.push({
      campusCode: code,
      campusName: name,
      buildings: list,
      isCurrent: isCurrentGroup(code, name, currentCampusCode, currentCampusName)
    });
  });

  // 当前校区排最前，其余保持服务端顺序
  const head: CampusGroup[] = groups.filter((g: CampusGroup) => g.isCurrent);
  const tail: CampusGroup[] = groups.filter((g: CampusGroup) => !g.isCurrent);
  return head.concat(tail);
}
