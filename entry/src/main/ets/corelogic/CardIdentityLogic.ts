/**
 * 把散落在探测流水里的身份信息汇总成「这张卡是谁」的名片（#152，移植自 CardIdentityLogic.kt）。
 *
 * ⚠️ 日期只叫「卡上日期（疑似）」，不叫「有效期」——真卡有有效期、交易时间、
 * 未知日期三类，没有可靠办法区分，挑「最晚的」当有效期是猜测。把推论写进用户文案
 * 是最难发现的错误，所以原样列出、一律带「疑似」。
 *
 * ⚠️ 每个字段都可空但卡片照常渲染：换学校/文件被清了也要显示「只认出了卡号」，
 * 而不是「什么都没有」。
 *
 * ⚠️ hasPerson 不把卡号算作「认出人」：卡号从 UID 推，只说明「还是这张卡」，
 * 不说明「这是谁」。算进来会让「要不要深度扫描」的安全网永远不触发。
 */

export interface ProbeLineLike {
  text: string | null;
  /** 与用户填的学号核对上了（说明文字，不是学号本身）。 */
  studentIdHit: string | null;
  /** 没填学号时猜出来的学号（纯数字），与 studentIdHit 互斥。 */
  guessedStudentId: string | null;
  guessedStudentIdNote: string | null;
  dates: string[];
}

export interface CardNoCandidate {
  label: string;
  value: string;
}

export interface CardIdentity {
  name: string | null;
  studentId: string | null;
  studentIdNote: string | null;
  guessedStudentId: string | null;
  guessedStudentIdNote: string | null;
  dates: string[];
  cardNo: string | null;
  cardNoNote: string | null;
}

/**
 * 汇总名片。
 * @param expectedStudentId 用户填的学号，**只用来展示**；其字段 studentId 必须是这个数字，
 *   绝不能拿 studentIdHit 说明文字顶替（那是「怎么认出来的」）。
 */
export function summarize(lines: ProbeLineLike[], candidates: CardNoCandidate[],
  expectedStudentId: string | null): CardIdentity {
  const src: ProbeLineLike[] = lines || [];

  const names: string[] = [];
  for (let i = 0; i < src.length; i++) {
    const t: string = (src[i].text || '').trim();
    if (t.length > 0 && names.indexOf(t) < 0) {
      names.push(t);
    }
  }

  let hit: ProbeLineLike | null = null;
  for (let i = 0; i < src.length; i++) {
    if (src[i].studentIdHit !== null && src[i].studentIdHit!.length > 0) {
      hit = src[i];
      break;
    }
  }
  const studentId: string | null = hit !== null ? expectedStudentId : null;

  // 有核对结果就绝不列疑似（两个学号并排用户没法判断信哪个）
  let guessedLine: ProbeLineLike | null = null;
  if (studentId === null) {
    for (let i = 0; i < src.length; i++) {
      if (src[i].guessedStudentId !== null && src[i].guessedStudentId!.length > 0) {
        guessedLine = src[i];
        break;
      }
    }
  }

  const dates: string[] = [];
  for (let i = 0; i < src.length; i++) {
    const ds: string[] = src[i].dates || [];
    for (let k = 0; k < ds.length; k++) {
      if (dates.indexOf(ds[k]) < 0) {
        dates.push(ds[k]);
      }
    }
  }

  const cardNo: string | null = candidates.length > 0 ? candidates[0].value : null;
  let cardNoNote: string | null = null;
  if (candidates.length > 1) {
    cardNoNote = '共 ' + candidates.length + ' 种解读，如「' + candidates[1].label +
      '」= ' + candidates[1].value + '；主候选是「' + (cardNo || '') + '」';
  } else if (candidates.length === 1) {
    cardNoNote = candidates[0].label;
  }

  return {
    name: names.length > 0 ? names[0] : null,
    studentId: studentId,
    studentIdNote: hit !== null ? hit!.studentIdHit : null,
    guessedStudentId: guessedLine !== null ? guessedLine!.guessedStudentId : null,
    guessedStudentIdNote: guessedLine !== null ? guessedLine!.guessedStudentIdNote : null,
    dates: dates,
    cardNo: cardNo,
    cardNoNote: cardNoNote
  };
}

/** 有没有认出「人」（姓名/学号/疑似学号）；卡号不算。 */
export function hasPerson(id: CardIdentity): boolean {
  return id.name !== null || id.studentId !== null || id.guessedStudentId !== null;
}

/** 把 UID 换算成几种可能的卡面号候选（各校规则不同，不猜是哪一种，全列给用户对照）。 */
export function cardNoCandidates(uid: number[]): CardNoCandidate[] {
  const rev: number[] = uid.slice().reverse();
  const out: CardNoCandidate[] = [];
  out.push({ label: 'UID 正序当整数（十进制）', value: decimalWhole(uid) });
  out.push({ label: 'UID 反序当整数（十进制）', value: decimalWhole(rev) });
  out.push({ label: 'UID 正序（十六进制）', value: hexOf(uid) });
  out.push({ label: 'UID 反序（十六进制）', value: hexOf(rev) });
  out.push({ label: 'UID 正序（十进制拼接）', value: decimalConcat(uid) });
  out.push({ label: 'UID 反序（十进制拼接）', value: decimalConcat(rev) });
  if (rev.length > 4) {
    out.push({ label: '反序取前 4 字节（十进制）', value: decimalConcat(rev.slice(0, 4)) });
  }
  if (rev.length > 3) {
    out.push({ label: '反序取前 3 字节（十进制）', value: decimalConcat(rev.slice(0, 3)) });
  }
  return out;
}

/** 整串字节当一个大端无符号整数转十进制（7 字节 UID 会溢出 Long，用字符串逐位乘加）。 */
function decimalWhole(bytes: number[]): string {
  let out: string = '0';
  for (let i = 0; i < bytes.length; i++) {
    out = mulAddDecimal(out, bytes[i] & 0xff);
  }
  return out;
}

/** decimal = decimal * 256 + add，全程字符串大整数。 */
function mulAddDecimal(decimal: string, add: number): string {
  let carry: number = add;
  const digits: string[] = [];
  for (let i = decimal.length - 1; i >= 0; i--) {
    const v: number = (decimal.charCodeAt(i) - 48) * 256 + carry;
    digits.push(String(v % 10));
    carry = Math.floor(v / 10);
  }
  while (carry > 0) {
    digits.push(String(carry % 10));
    carry = Math.floor(carry / 10);
  }
  return digits.reverse().join('');
}

/** 每字节当 0~255、三位补零拼起来（印刷号常见拼法）。 */
function decimalConcat(bytes: number[]): string {
  let out: string = '';
  for (let i = 0; i < bytes.length; i++) {
    const v: number = bytes[i] & 0xff;
    out += (v < 10 ? '00' : v < 100 ? '0' : '') + v.toString();
  }
  return out;
}

function hexOf(bytes: number[]): string {
  let out: string = '';
  for (let i = 0; i < bytes.length; i++) {
    const n: number = bytes[i] & 0xff;
    out += (n < 16 ? '0' : '') + n.toString(16).toUpperCase();
  }
  return out;
}
