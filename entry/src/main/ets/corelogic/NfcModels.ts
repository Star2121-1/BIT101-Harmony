/**
 * NFC 纯逻辑用的窄模型（M16-2）。
 *
 * 不直接 import `@kit.ConnectivityKit`：核心逻辑要能在 Node 单测里跑。
 * 服务层把 `tag.TagInfo` 映射成这里的结构，页面只认这里的结构。
 */

/** `tag.TagInfo` 的最小字段。 */
export interface NfcTagInfoLike {
  /** 4/7 字节 UID。 */
  uid: number[];
  /** `tag.NFC_A` 等常量数组。 */
  technology: number[];
}

/** 一条 NDEF 记录的窄模型。 */
export interface NdefRecordLike {
  tnf: number;
  rtdType: number[];
  id: number[];
  payload: number[];
}
