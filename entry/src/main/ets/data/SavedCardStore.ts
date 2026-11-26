/**
 * 「我的校园卡」名片持久化（F05-01）。只做 Prefs 读写，不做判断。
 * 键名对齐 Android SavedCardLogic.KEY_*（冻结契约）。
 *
 * ⚠️ 本文件只存卡上认出的公开信息，不含任何登录凭据类字段（守卫静态检索）。
 */

import { Prefs } from './Prefs.ts';
import { SavedCard, emptyCard } from '../corelogic/SavedCardLogic.ts';

const KEY_NAME: string = 'card_name';
const KEY_STUDENT_ID: string = 'card_student_id';
const KEY_SID_CONFIRMED: string = 'card_sid_confirmed';
const KEY_CARD_NO: string = 'card_card_no';
const KEY_UID: string = 'card_uid';
const KEY_SAVED_AT: string = 'card_saved_at';
/** 学号输入框内容单独存（「忘掉这张卡」时保留，A:SavedCardLogic 同口径）。 */
const KEY_STUDENT_INPUT: string = 'card_student_input';

/** 可空的字符串读取（Prefs 里没存过 → null）。 */
async function str(key: string): Promise<string | null> {
  const v: string = await Prefs.getString(key, '');
  return v.length > 0 ? v : null;
}

/** 读名片；任一键缺失就留 null（记录本身照旧存在）。 */
export async function loadCard(): Promise<SavedCard> {
  const card: SavedCard = emptyCard();
  card.name = await str(KEY_NAME);
  card.studentId = await str(KEY_STUDENT_ID);
  card.sidConfirmed = await Prefs.getBool(KEY_SID_CONFIRMED, false);
  card.cardNo = await str(KEY_CARD_NO);
  card.uid = await str(KEY_UID);
  card.savedAt = await Prefs.getNumber(KEY_SAVED_AT, 0);
  return card;
}

/** 写名片（逐字段落盘；null 字段删除，避免空串占位）。 */
export async function saveCard(card: SavedCard): Promise<void> {
  await putOrRemove(KEY_NAME, card.name);
  await putOrRemove(KEY_STUDENT_ID, card.studentId);
  await Prefs.putBool(KEY_SID_CONFIRMED, card.sidConfirmed);
  await putOrRemove(KEY_CARD_NO, card.cardNo);
  await putOrRemove(KEY_UID, card.uid);
  await Prefs.putNumber(KEY_SAVED_AT, card.savedAt);
}

async function putOrRemove(key: string, value: string | null): Promise<void> {
  if (value === null || value.length === 0) {
    await Prefs.remove(key);
  } else {
    await Prefs.putString(key, value);
  }
}

/** 忘掉这张卡：只删名片六键，**不动学号输入框**。 */
export async function forgetCard(): Promise<void> {
  await Prefs.remove(KEY_NAME);
  await Prefs.remove(KEY_STUDENT_ID);
  await Prefs.remove(KEY_SID_CONFIRMED);
  await Prefs.remove(KEY_CARD_NO);
  await Prefs.remove(KEY_UID);
  await Prefs.remove(KEY_SAVED_AT);
}

/** 读学号输入框（下次贴卡可复用核对）。 */
export async function loadStudentInput(): Promise<string> {
  return await Prefs.getString(KEY_STUDENT_INPUT, '');
}

/** 写学号输入框。 */
export async function saveStudentInput(value: string): Promise<void> {
  await Prefs.putString(KEY_STUDENT_INPUT, value);
}
