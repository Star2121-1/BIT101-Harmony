/**
 * 1:1 移植自 Android：data/src/main/java/cn/bit101/android/data/schedule/CourseColorLogic.kt（55 行）
 *
 * 移植日期：2026-10-19（夜间任务 2）
 *
 * 必须一起搬的规则：
 * - 色号 = fnv1a32(课名) % 12；FNV-1a 32 位：offset 0x811C9DC5、prime 0x01000193
 * - 输入按 **UTF-16 码元**逐个喂入（与规范演示数据的 JS 实现 charCodeAt 同口径）
 * - 32 位回绕乘（Long 乘完截 32 位 = JS Math.imul 语义）——鸿蒙侧用 Math.imul 严格对齐
 * - 空串/纯空白也返回确定值（不是 -1）；同名永远同号，不随设备/时间/语言变
 * - ⚠️ 全仓只许这一份哈希实现（Android 侧有源码扫描守卫 S3；鸿蒙侧同款纪律：
 *   card/notify 等拿不到 CompositionLocal 的面也必须调这里，不许就地再写一份）
 *
 * 期望值来源：Android 侧 CourseColorLogicTest（规范 §9.1 对照表 fixture，14 门课）
 * + FNV-1a 公开已知值（空串 0x811C9DC5、"a" 0xE40C292C）。
 */

/** 色板档数（规范 §8.2 权威 12 支）。 */
export const PALETTE_SIZE = 12;

/** FNV-1a 32 位初始偏移（0x811C9DC5）。 */
const FNV_OFFSET = 0x811c9dc5;

/** FNV-1a 32 位质数（0x01000193）。 */
const FNV_PRIME = 0x01000193;

/**
 * FNV-1a 32 位，返回**无符号** 32 位值（0..4294967295）。
 * ⚠️ Math.imul 是 32 位回绕乘，与 JS 规范演示实现逐位一致；
 *    不能用普通 `*`（会溢出成浮点，与 Kotlin `and 0xFFFFFFFF` 语义不同）。
 */
export function fnv1a32(input: string): number {
  let h = FNV_OFFSET | 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i); // UTF-16 码元，零扩展（对齐 Kotlin ch.code.toLong()）
    h = Math.imul(h, FNV_PRIME); // 32 位回绕乘
  }
  return h >>> 0; // 无符号 32 位
}

/** 课名 → 色号（0..11）。 */
export function of(name: string): number {
  return fnv1a32(name) % PALETTE_SIZE;
}
