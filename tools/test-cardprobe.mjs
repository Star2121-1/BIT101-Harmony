/**
 * CardProbeLogic 纯逻辑单测（#152）：APDU 构造 / 解析 / 只读闸门 / TLV / GBK。
 * 测试向量来自 BIT101-seat 真卡实测（北理工校园卡）。
 */
import assert from 'node:assert/strict';
import {
  READ_ONLY_INS, PPSE_AID, PSE_AID,
  isReadOnly, toHex, toHexCompact, parseHex, hexByte,
  selectByName, selectMasterFile, selectPse, selectPpse,
  readBinary, readBinaryPlain, readRecordCurrentEf, selectByFileId, getResponse, withLe,
  quickScan, parseResponse, remainingOf, statusText, shouldTryRecords, looksLikeDirectory,
  decodeGbkText, parseTlvs, aidsOf
} from '../entry/src/main/ets/corelogic/CardProbeLogic.ts';

let pass = 0;
function ok(cond, name) {
  assert.ok(cond, name);
  pass++;
}

// 测试用 GBK 解码器：真卡姓名「高天翔」的字节 B8 DF CC EC CF E8。
// Node 环境用 iconv 不可靠，这里直接给一个最小映射，验证注入路径与判据。
function gbkDecoder(bytes) {
  const table = {
    'B8DF': '高', 'CCEC': '天', 'CFE8': '翔', 'D6D0': '中', 'CEC4': '文'
  };
  let out = '';
  for (let i = 0; i < bytes.length;) {
    const b = bytes[i] & 0xff;
    if (b < 0x80) {
      out += String.fromCharCode(b);
      i++;
    } else {
      const key = hexByte(bytes[i]) + hexByte(bytes[i + 1]);
      out += table[key] !== undefined ? table[key] : '\uFFFD';
      i += 2;
    }
  }
  return out;
}

// ── 1. 只读闸门 ──────────────────────────────────────────────────────────
ok(isReadOnly(parseHex('00A40200023F00')), 'SELECT 是只读');
ok(isReadOnly(parseHex('00B080011020')), 'READ BINARY 是只读');
ok(isReadOnly(parseHex('00B2010400')), 'READ RECORD 是只读');
ok(isReadOnly(parseHex('00C0000010')), 'GET RESPONSE 是只读');
ok(!isReadOnly(parseHex('00D6000000')), 'UPDATE BINARY 被拒');
ok(!isReadOnly(parseHex('00DC000000')), 'UPDATE RECORD 被拒');
ok(!isReadOnly(parseHex('04A4400000')), 'CLA=4（安全报文）被拒');
ok(!isReadOnly(parseHex('00A4')), '过短 APDU 被拒');
ok(READ_ONLY_INS.length === 6, '白名单恰好 6 条读指令');

// ── 2. APDU 构造（真卡实测编码）──────────────────────────────────────────
ok(toHex(selectMasterFile()) === '00 A4 00 00 02 3F 00', 'SELECT MF');
ok(toHex(selectByFileId(0x0001)) === '00 A4 02 00 02 00 01', 'SELECT FID 0001');
ok(toHex(selectByFileId(0x0016)) === '00 A4 02 00 02 00 16', 'SELECT FID 0016（姓名学号）');
ok(toHex(readBinary(1)) === '00 B0 81 00 20', 'READ BINARY SFI=1 → P1=0x81');
ok(toHex(readBinary(30)) === '00 B0 9E 00 20', 'READ BINARY SFI=30 → P1=0x9E');
ok(toHex(readBinaryPlain()) === '00 B0 00 00 20', 'READ BINARY plain offset=0');
ok(toHex(readBinaryPlain(0x20)) === '00 B0 00 20 20', 'READ BINARY plain 第 2 段 offset=0x20');
ok(toHex(readBinaryPlain(0x1234, 16)) === '00 B0 12 34 10', 'READ BINARY plain 偏移拆两字节');
ok(toHex(readRecordCurrentEf(1)) === '00 B2 01 04 00', 'READ RECORD 当前 EF');
ok(toHex(getResponse(30)) === '00 C0 00 00 1E', 'GET RESPONSE 30');
ok(toHex(getResponse(256)) === '00 C0 00 00 00', 'GET RESPONSE 256 → Le=00');
ok(readBinary(0).length === 0, 'SFI=0 越界返空');
ok(readBinaryPlain(0x8000).length === 0, 'offset 0x8000 越界返空');
ok(selectByName('XYZ').length === 0, '非法 hex 返空');

// PSE / PPSE（真卡认 1PAY，不认 2PAY）
const pse = selectByName(PSE_AID);
const ppse = selectByName(PPSE_AID);
ok(toHexCompact(pse) === '00A404000E' + PSE_AID + '00', 'SELECT PSE 命令格式');
ok(toHexCompact(ppse) === '00A404000E' + PPSE_AID + '00', 'SELECT PPSE 命令格式');
ok(toHex(selectPse()) === toHex(pse) && toHex(selectPpse()) === toHex(ppse), 'selectPse/Ppse 委托正确');
ok(PPSE_AID !== PSE_AID && PSE_AID.startsWith('3150'), 'PSE 是 1PAY');

// withLe：只对读指令生效
ok(toHex(withLe(parseHex('00B080011020'), 30)) === '00 B0 80 01 10 1E', '6Cxx 改 Le 后重发');
ok(withLe(parseHex('00A40200020016'), 30).length === 0, 'SELECT 命令不许改 Le（末尾是 FID）');
ok(withLe(parseHex('00B08001'), 30).length === 0, '过短命令不许改 Le');

// ── 3. quickScan：范围与段数 ─────────────────────────────────────────────
const steps = quickScan();
ok(steps.length === 32, 'quickScan = 1 条 SELECT MF + 31 个 FID');
ok(steps[0].label.indexOf('主文件') >= 0, '第 0 步是回 MF');
ok(steps[1].fid === 0x0001 && steps[steps.length - 1].fid === 0x001F, '范围 0001~001F');
ok(steps.some(s => s.fid === 0x0016), '含真卡姓名学号文件 0016');
ok(steps.every(s => s.fid === undefined || (s.followUp !== undefined && s.followUpMore !== undefined)),
  '每个 FID 步骤都有 followUp + followUpMore');
ok(toHex(steps[0 + 0x16].followUpMore) === '00 B0 00 20 20', '0016 第 2 段读 offset 0x20');
ok(quickScan(0x0016, 0x0016).length === 2, '范围可收窄');

// ── 4. parseResponse / 状态字 ────────────────────────────────────────────
const okRes = parseResponse(parseHex('9000'));
ok(okRes.success && okRes.sw === '9000' && okRes.data.length === 0, '9000 成功无数据');
const withData = parseResponse(parseHex('0000B8DFCCECCFE89000'));
ok(withData.success && toHexCompact(withData.data) === '0000B8DFCCECCFE8', '9000 带数据');
const le = parseResponse(parseHex('6C1E'));
ok(le.correctLe === 30 && !le.success, '6C1E → Le=30（真卡 0015）');
ok(parseResponse(parseHex('6C00')).correctLe === 256, '6C00 → Le=256 而非 0');
ok(parseResponse(parseHex('610A')).hasMore && remainingOf('610A') === 10, '610A → GET RESPONSE 10');
ok(remainingOf('6100') === 256, '6100 → 256');
ok(remainingOf('9000') === null && remainingOf('61xx') === null, '非 61xx 无 remaining');
const short = parseResponse([0x90]);
ok(!short.success && short.sw === '' && short.data.length === 1, '短于 2 字节标失败并保留原文');
ok(statusText('6A82').indexOf('找不到') >= 0, '6A82 = 找不到文件');
ok(statusText('6981').indexOf('READ RECORD') >= 0, '6981 提示改 READ RECORD');
ok(statusText('6B00').indexOf('末尾') >= 0, '6B00 是偏移超界而非故障');
ok(statusText('FFFF') === null, '未知状态字如实返回 null');
ok(shouldTryRecords('6981') && !shouldTryRecords('6986'), '只有 6981 触发改读记录');
ok(looksLikeDirectory('6986') && !looksLikeDirectory('6981'), '只有 6986 是目录');
ok(!shouldTryRecords('6A82') && !shouldTryRecords('9000'), '其它状态不触发回退');

// ── 5. parseTlvs / aidsOf（真卡 FCI）─────────────────────────────────────
// 610A 4F05 A000000001 4F01FF —— 4F 长度 5（合法 AID）与长度 1（非法）各一条
const tlvs = parseTlvs(parseHex('610A4F05A0000000014F01FF'));
ok(tlvs.length >= 3, 'TLV 解出多条');
const aids = aidsOf(tlvs);
ok(aids.length === 1 && toHexCompact(aids[0]) === 'A000000001', 'aidsOf 只收 5~16 字节的 4F');
// 真卡 MF 的 FCI：6F 15 ... A5 03 88 01 01 —— 88(SFI) 埋在 A5 里，必须递归
const fci = parseTlvs(parseHex('6F108409315041592E5359532E4444463031A503880101'));
ok(fci.some(t => t.tag === '88' && toHexCompact(t.value) === '01'), '构造型 TLV 递归出 SFI=1');
ok(fci.some(t => t.tag === '84'), '构造型 TLV 递归出 DF 名');

// ── 6. GBK 解码（真卡姓名）───────────────────────────────────────────────
ok(decodeGbkText(parseHex('0000B8DFCCECCFE80000'), gbkDecoder) === '高天翔', 'GBK 解出姓名，首尾 0x00 去掉');
ok(decodeGbkText(parseHex('48690A'), gbkDecoder) === null, '含控制字符（0A）返回 null，不端乱码');
ok(decodeGbkText(parseHex('00000000'), gbkDecoder) === null, '全零返回 null');
ok(decodeGbkText(parseHex('B8DFFFFF'), gbkDecoder) === null, '替换字符 U+FFFD 返回 null');
ok(decodeGbkText(parseHex('416263'), gbkDecoder) === 'Abc', 'ASCII 直通');

console.log('\nALL PASS pass=' + pass + ' fail=0');
