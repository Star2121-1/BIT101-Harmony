/**
 * 空教室查询（对照 BIT-Login `Classroom.getOccupancy` + Android `DefaultFreeClassroomRepo`）
 *
 * ## 协议要点（全部来自 SDK 源码，不是猜的）
 * 1. 先 GET `/jwapp/sys/kxjas/*default/index.do` 建应用会话（否则 401）
 * 2. POST `/jwapp/sys/kxjas/modules/kxjas/cxjsqk.do`
 *    参数：`XNXQDM`(学期) `ZC`(周) `XQ`(1..7) `RQ`(yyyy-MM-dd)
 *          `querySetting`(JSON 数组，用 JXLDM 过滤教学楼) `*order=+JASMC` `pageSize` `pageNumber`
 * 3. 返回 `datas.cxjsqk.rows[]`，每行有 `JASMC` / `JXLDM` / `SKZWS` / `JC1..JC13`
 * 4. `JCn` 形如 `1_01`（占用）或空串（空闲）；`1_` 后的两位码查 STATUS_MAP
 *
 * ## ⚠️ 两条容易错的
 * - **必须分页**：`pageSize=50`，循环到 `pageNumber*pageSize >= totalSize`；只取第一页会漏掉半栋楼
 * - **`JCn` 为空 ≠ 没数据**：空串就是「空闲」，这是正常的
 */

import { rcp } from '@kit.RemoteCommunicationKit';
import { Context } from '@kit.AbilityKit';
import { RcpFactory } from '../core/net/RcpFactory.ts';
import { ClassroomRow, JsonValue, arrOf, objOf, str } from '../core/model/SchoolModels.ts';
import { SchoolService } from './SchoolService.ts';
import { info, warn } from '../core/log/BitLog.ts';

const APP: string = 'https://jxzxehallapp.bit.edu.cn';
const PAGE_SIZE: number = 50;
/** 防御：一栋楼不可能超过 1000 间，超过就是接口异常，别死循环。 */
const MAX_PAGES: number = 20;

/** 占用码 → 中文（`10101` 等码来自 SDK `Constants.kt`，逐条照抄）。 */
const STATUS_MAP: Record<string, string> = {
  '01': '排课占用',
  '10': '排课占用(特定)',
  '02': '考务占用',
  '03': '其他占用',
  '04': '借用占用',
  '05': '调课占用',
  '11': '特殊排课'
};

const SECTIONS_PER_DAY: number = 13;

export class ClassroomService {
  /**
   * 查某教学楼在某天的教室占用。
   *
   * @param term 学期（如 2026-2027-1）
   * @param week 教学周（1-based）
   * @param dayOfWeek 星期几（1=周一 … 7=周日）
   * @param dateStr `yyyy-MM-dd`
   * @param buildingCode 教学楼代码（`JXLDM`）
   */
  static async getClassrooms(
    context: Context, term: string, week: number, dayOfWeek: number,
    dateStr: string, buildingCode: string
  ): Promise<ClassroomRow[]> {
    const session: rcp.Session = await SchoolService.openAppSession(context, '/jwapp/sys/kxjas');

    const querySetting: string = JSON.stringify([
      {
        'name': 'JXLDM', 'caption': '教学楼代码', 'builder': 'equal',
        'linkOpt': 'AND', 'value': buildingCode
      }
    ]);

    const url: string = APP + '/jwapp/sys/kxjas/modules/kxjas/cxjsqk.do?vpn-12-o2-jxzxehallapp.bit.edu.cn';
    const out: ClassroomRow[] = [];

    for (let page: number = 1; page <= MAX_PAGES; page++) {
      const res = await RcpFactory.postForm(session, url, SchoolService.jsonHeadersFor(), {
        'XNXQDM': term,
        'ZC': String(week),
        'XQ': String(dayOfWeek),
        'RQ': dateStr,
        'querySetting': querySetting,
        '*order': '+JASMC',
        'pageSize': String(PAGE_SIZE),
        'pageNumber': String(page)
      });
      const json: Record<string, JsonValue> | null =
        SchoolService.parseJson(res.body, 'getClassrooms', res.status);
      if (json === null) {
        throw new Error('空教室接口返回非 JSON（HTTP ' + res.status + '）');
      }
      const pageObj: Record<string, JsonValue> | null = objOf(objOf(json, 'datas'), 'cxjsqk');
      if (pageObj === null) {
        throw new Error('空教室响应缺 datas.cxjsqk（HTTP ' + res.status + '）');
      }
      const rows: JsonValue[] = arrOf(pageObj, 'rows');
      for (let i = 0; i < rows.length; i++) {
        out.push(ClassroomService.parseRow(rows[i]));
      }
      const total: number = ClassroomService.numOf(pageObj, 'totalSize');
      info('ClassroomService page=' + page + ' rows=' + rows.length + ' total=' + total +
        ' building=' + buildingCode);
      if (total <= 0 || page * PAGE_SIZE >= total) {
        break;
      }
    }
    return out;
  }

  private static numOf(o: Record<string, JsonValue> | null, key: string): number {
    if (o === null) {
      return 0;
    }
    const v: JsonValue | undefined = o[key];
    if (typeof v === 'number') {
      return v as number;
    }
    if (typeof v === 'string') {
      const n: number = Number(v as string);
      return Number.isFinite(n) ? n : 0;
    }
    return 0;
  }

  private static parseRow(v: JsonValue): ClassroomRow {
    const o: Record<string, JsonValue> | null = objOf({ 'r': v }, 'r');
    const jc: string[] = [];
    const busy: number[] = [];
    for (let i = 1; i <= SECTIONS_PER_DAY; i++) {
      const raw: string = str(o, 'JC' + i, '');
      const state: string = ClassroomService.parseJcStatus(raw);
      jc.push(state);
      if (state !== '空闲') {
        busy.push(i);
      }
    }
    return {
      JASMC: str(o, 'JASMC', ''),
      JXLDM: str(o, 'JXLDM', ''),
      JASLXDM_DISPLAY: str(o, 'JASLXDM_DISPLAY', ''),
      SKZWS: str(o, 'SKZWS', ''),
      JC: jc,
      busySections: busy
    };
  }

  /** `1_01` → 「排课占用」；空串 / 全非占用 → 「空闲」。 */
  private static parseJcStatus(raw: string): string {
    if (raw.length === 0) {
      return '空闲';
    }
    const parts: string[] = [];
    const pieces: string[] = raw.split(',');
    for (let i = 0; i < pieces.length; i++) {
      const p: string = pieces[i].trim();
      if (p.indexOf('1_') === 0) {
        const code: string = p.substring(2);
        const name: string | undefined = STATUS_MAP[code];
        parts.push(name !== undefined ? name : ('未知占用(' + code + ')'));
      }
    }
    if (parts.length === 0) {
      return '空闲';
    }
    return parts.join(' + ');
  }

  /** 某间教室从第几节起连续空闲几节（给自习卡用）。 */
  static freeRunFrom(row: ClassroomRow, fromSection: number): number {
    let n: number = 0;
    for (let s: number = fromSection; s <= SECTIONS_PER_DAY; s++) {
      if (row.busySections.indexOf(s) >= 0) {
        break;
      }
      n++;
    }
    return n;
  }

  /** 当前节次起就空闲的教室（按连续空闲节数降序）。 */
  static freeNow(rows: ClassroomRow[], fromSection: number, minFree: number): ClassroomRow[] {
    const out: ClassroomRow[] = [];
    for (let i = 0; i < rows.length; i++) {
      const n: number = ClassroomService.freeRunFrom(rows[i], fromSection);
      if (n >= minFree) {
        out.push(rows[i]);
      }
    }
    out.sort((a: ClassroomRow, b: ClassroomRow) =>
      ClassroomService.freeRunFrom(b, fromSection) - ClassroomService.freeRunFrom(a, fromSection));
    return out;
  }
}
