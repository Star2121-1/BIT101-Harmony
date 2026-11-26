/**
 * 「我的校园卡」本机名片（F05-01）—— 1:1 照搬 Android SavedCardLogic.kt。
 * 纯逻辑、零依赖、可离线单测；只存本机，不碰卡、不写卡。
 *
 * ## ⚠️⚠️ 合并时 UID 对不上 ⇒ 整张替换，不许逐字段拼
 * 学生之间会互相贴卡、也可能换新卡。把 A 卡姓名和 B 卡学号拼成一个人是
 * 张冠李戴——用户会拿着这张名片去相信上面的名字，比「什么都不显示」糟得多。
 * ⇒ 两边 UID 都有且不一致时整张换成新读到的；只有一侧缺 UID 才逐字段补缺。
 *
 * ## 学号有两种成色，确认过的赢
 * sidConfirmed=true = 用户填的学号在卡里真命中；false = 从卡上猜的（界面标「疑似」）。
 * 旧的确认值不能被新的猜测顶掉。
 *
 * ## 每个字段可空，但记录本身照旧存在
 * 认出来只剩卡号也要存——否则会被当成「没读过卡」。
 */

/** 一张存下来的名片（字段与 A:SavedCard 一一对应）。 */
export interface SavedCard {
  name: string | null;
  studentId: string | null;
  /** 学号是否核对过（false=疑似，界面必须标）。 */
  sidConfirmed: boolean;
  cardNo: string | null;
  /** 卡物理编号（十六进制）——「换没换卡」的唯一依据。 */
  uid: string | null;
  /** 上次更新时间（epoch millis）。 */
  savedAt: number;
}

/** 空名片（用于「忘掉这张卡」后的空态）。 */
export function emptyCard(): SavedCard {
  return { name: null, studentId: null, sidConfirmed: false, cardNo: null, uid: null, savedAt: 0 };
}

/** 名片上有没有任何能展示的东西（全空 ⇒ 等于没读过卡）。 */
export function isBlank(card: SavedCard | null): boolean {
  if (card === null) {
    return true;
  }
  return isEmpty(card.name) && isEmpty(card.studentId) && isEmpty(card.cardNo) && isEmpty(card.uid);
}

function isEmpty(s: string | null): boolean {
  return s === null || s.trim().length === 0;
}

/**
 * 把刚读到的 fresh 并进已存的 old（A:SavedCardLogic.merge 逐条对齐）。
 * @param now 当前时间由调用方传入（纯函数，结果可复现）。
 */
export function mergeCard(old: SavedCard | null, fresh: SavedCard, now: number): SavedCard {
  // 换卡：UID 两边都有且不一致 ⇒ 整张替换（不逐字段拼，防张冠李戴）
  const sameCard: boolean = old === null || isEmpty(old.uid) || isEmpty(fresh.uid) ||
    (old.uid as string) === (fresh.uid as string);
  if (!sameCard) {
    return {
      name: fresh.name, studentId: fresh.studentId, sidConfirmed: fresh.sidConfirmed,
      cardNo: fresh.cardNo, uid: fresh.uid, savedAt: now
    };
  }
  // 学号成色：确认过的赢（新确认 > 旧确认 > 新疑似 > 旧疑似）
  let studentId: string | null = null;
  let sidConfirmed: boolean = false;
  if (!isEmpty(fresh.studentId) && fresh.sidConfirmed) {
    studentId = fresh.studentId;
    sidConfirmed = true;
  } else if (old !== null && !isEmpty(old.studentId) && old.sidConfirmed) {
    studentId = old.studentId;
    sidConfirmed = true;
  } else if (!isEmpty(fresh.studentId)) {
    studentId = fresh.studentId;
    sidConfirmed = false;
  } else if (old !== null && !isEmpty(old.studentId)) {
    studentId = old.studentId;
    sidConfirmed = false;
  }
  // 新值有才覆盖：这次没认出姓名，不该清掉上次认出的
  return {
    name: isEmpty(fresh.name) ? (old === null ? null : old.name) : fresh.name,
    studentId: studentId,
    sidConfirmed: sidConfirmed,
    cardNo: isEmpty(fresh.cardNo) ? (old === null ? null : old.cardNo) : fresh.cardNo,
    uid: isEmpty(fresh.uid) ? (old === null ? null : old.uid) : fresh.uid,
    savedAt: now
  };
}

/**
 * 两张名片的内容是否相同（A:SavedCardLogic.sameContent）。
 * ⚠️ 刻意不比 savedAt：那是「什么时候写的」，不是内容。比了会导致每敲一个字符
 * 都写盘 + 「更新于」乱跳。
 */
export function sameContent(a: SavedCard | null, b: SavedCard | null): boolean {
  if (a === null || b === null) {
    return a === b;
  }
  return a.name === b.name && a.studentId === b.studentId && a.sidConfirmed === b.sidConfirmed &&
    a.cardNo === b.cardNo && a.uid === b.uid;
}

/** 名片一行摘要（展示用；学号疑似要带「疑似」字样，不冒充确认值）。 */
export function cardLine(card: SavedCard | null): string {
  if (isBlank(card)) {
    return '';
  }
  const c: SavedCard = card as SavedCard;
  const parts: string[] = [];
  if (!isEmpty(c.name)) {
    parts.push(c.name as string);
  }
  if (!isEmpty(c.studentId)) {
    parts.push('学号 ' + (c.studentId as string) + (c.sidConfirmed ? '' : '（疑似）'));
  }
  if (!isEmpty(c.cardNo)) {
    parts.push('卡号 ' + (c.cardNo as string));
  }
  if (!isEmpty(c.uid)) {
    parts.push('UID ' + (c.uid as string));
  }
  return parts.join(' · ');
}
