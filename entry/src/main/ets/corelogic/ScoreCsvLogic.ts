/**
 * 成绩 CSV 导出（G-02）——纯函数，RFC 4180 转义。
 *
 * 对齐 Android 侧 CSV 导出的口径：
 * - 表头中文，列序固定；
 * - 含逗号 / 引号 / 换行的字段用双引号包裹，内部引号 doubled（`""`）；
 * - 不转义的「官方那版」在课名含逗号时会错列，这里必须转义。
 *
 * 不含学员号 / 学号 / 排名等敏感列（成绩页已展示的字段才导出，不扩大范围）。
 */

import type { ScoreEntry } from './ScoreLogic.ts';

/** RFC 4180：含逗号 / 引号 / 换行则加双引号，内部引号 doubled。 */
export function csvCell(raw: string): string {
  if (raw.indexOf(',') >= 0 || raw.indexOf('"') >= 0 ||
    raw.indexOf('\n') >= 0 || raw.indexOf('\r') >= 0) {
    return '"' + raw.replace(/"/g, '""') + '"';
  }
  return raw;
}

/** 表头（固定列序）。 */
export const CSV_HEADER: string = '学期,课程名称,成绩,学分';

/** 一组成绩 → CSV 文本（含表头，每行 CRLF 结尾；空表只给表头）。 */
export function scoreCsv(entries: ScoreEntry[]): string {
  const lines: string[] = [CSV_HEADER];
  for (let i = 0; i < entries.length; i++) {
    const e: ScoreEntry = entries[i];
    lines.push([
      csvCell(e.term === null ? '' : e.term),
      csvCell(e.course),
      csvCell(e.score === null ? '' : e.score),
      csvCell(e.credit === undefined ? '' : String(e.credit))
    ].join(','));
  }
  return lines.join('\r\n') + '\r\n';
}
