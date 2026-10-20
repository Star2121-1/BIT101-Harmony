/**
 * CAS 协议加解密 + 风控指纹。1:1 照搬 Android BIT-Login SDK：
 * - `Crypto.kt`（AES128/ECB/PKCS7、protectedCsrfHeaders）
 * - `Fingerprint.kt`（13 字段 USTC 风控指纹）
 *
 * 已证伪锚点（2026-10-20 真机，见 evidence/m1-5-http-probe/report-final-jwt-verified.md）：
 * AES 测试向量 key=`MDEyMzQ1Njc4OWFiY2RlZg==` plain=`password`
 *   ⇒ `R4lDIBO/32oRLZSjtsPrGQ==`（与 Python/Kotlin 期望逐字节一致）。
 *
 * 鸿蒙坑（都踩过）：
 * - transformation 用**竖线**：`AES128|ECB|PKCS7`（Android 是斜杠）。
 * - ECB 的 init params 传 null。
 * - 固定 key 用 `createSymKeyGenerator(algName).convertKey({data})`。
 * - base64 走 `util.Base64Helper`（Buffer 在 ArkTS 里不是 Uint8Array）。
 */

import { cryptoFramework } from '@kit.CryptoArchitectureKit';
import util from '@ohos.util';
import { debug } from '../log/BitLog.ts';

/** AES 测试向量自证基准（BitSsoClient CryptoTest.kt：AES matches Python protocol vector）。 */
export const TEST_KEY_B64: string = 'MDEyMzQ1Njc4OWFiY2RlZg==';
export const TEST_PLAIN: string = 'password';
export const TEST_EXPECT: string = 'R4lDIBO/32oRLZSjtsPrGQ==';

export function bytesToHex(bytes: Uint8Array): string {
  let s: string = '';
  for (let i = 0; i < bytes.length; i++) {
    const b: number = bytes[i] & 0xff;
    s += (b < 16 ? '0' : '') + b.toString(16);
  }
  return s;
}

/** n 位随机字母数字（CSRF key 用）。 */
export function randomAlnum(n: number): string {
  const chars: string = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let s: string = '';
  for (let i = 0; i < n; i++) {
    s += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return s;
}

export class CasCrypto {
  /** AES128/192/256 ECB PKCS7 加密，base64 key → base64 密文。 */
  static async aesEcbEncrypt(keyB64: string, plaintext: string): Promise<string> {
    const b64: util.Base64Helper = new util.Base64Helper();
    const keyBytes: Uint8Array = b64.decodeSync(keyB64);
    let algName: string = 'AES128';
    if (keyBytes.length === 24) {
      algName = 'AES192';
    } else if (keyBytes.length === 32) {
      algName = 'AES256';
    }
    const transformation: string = algName + '|ECB|PKCS7'; // 竖线分隔；ECB params=null（官方文档）
    const gen: cryptoFramework.SymKeyGenerator = cryptoFramework.createSymKeyGenerator(algName);
    const symKey: cryptoFramework.SymKey = await gen.convertKey({ data: keyBytes });
    const cipher: cryptoFramework.Cipher = cryptoFramework.createCipher(transformation);
    await cipher.init(cryptoFramework.CryptoMode.ENCRYPT_MODE, symKey, null);
    const enc: util.TextEncoder = new util.TextEncoder();
    const plainBytes: Uint8Array = enc.encodeInto(plaintext);
    const ct: cryptoFramework.DataBlob = await cipher.doFinal({ data: plainBytes });
    return b64.encodeToStringSync(ct.data);
  }

  static b64ToBytes(b64: string): Uint8Array {
    const helper: util.Base64Helper = new util.Base64Helper();
    return helper.decodeSync(b64);
  }

  static async sha256Hex(input: string): Promise<string> {
    const md: cryptoFramework.Md = cryptoFramework.createMd('SHA256');
    const enc: util.TextEncoder = new util.TextEncoder();
    await md.update({ data: enc.encodeInto(input) });
    const out: cryptoFramework.DataBlob = await md.digest();
    return bytesToHex(out.data);
  }

  static async md5Hex(input: string): Promise<string> {
    const md: cryptoFramework.Md = cryptoFramework.createMd('MD5');
    const enc: util.TextEncoder = new util.TextEncoder();
    await md.update({ data: enc.encodeInto(input) });
    const out: cryptoFramework.DataBlob = await md.digest();
    return bytesToHex(out.data);
  }

  /**
   * protected 接口的 CSRF 头（1:1 照搬 Crypto.protectedCsrfHeaders）：
   * key = 32 位随机字母数字；encoded = base64(key)；
   * mixed = encoded[:mid] + encoded + encoded[mid:]；Csrf-Value = MD5(mixed)。
   */
  static async protectedCsrfHeaders(): Promise<Record<string, string>> {
    const key: string = randomAlnum(32);
    const b64: util.Base64Helper = new util.Base64Helper();
    const enc: util.TextEncoder = new util.TextEncoder();
    const encoded: string = b64.encodeToStringSync(enc.encodeInto(key));
    const mid: number = Math.floor(encoded.length / 2);
    const mixed: string = encoded.substring(0, mid) + encoded + encoded.substring(mid);
    const value: string = await CasCrypto.md5Hex(mixed);
    return { 'Csrf-Key': key, 'Csrf-Value': value };
  }

  /**
   * 13 字段风控指纹（1:1 照搬 Fingerprint.kt build()）：
   * fonts/deviceMemory/hardwareConcurrency/cpuClass 取 sha256；
   * timezone/platform/language/screenResolution 取原始 JS 字面量；
   * fingerprint = sha256(前 8 项原始值拼接)；localgroupId/cookieValue/userAgent 原样。
   */
  static async buildFingerprintJsonAsync(deviceCookie: string, ua: string, groupId: string): Promise<string> {
    const fontsJs: string = '["Arial","Helvetica Neue","PingFang SC","Times New Roman"]';
    const devMemJs: string = '16';
    const hwConcJs: string = '10';
    const tzJs: string = '"Asia/Shanghai"';
    const cpuJs: string = '"not available"';
    const platJs: string = '"MacIntel"';
    const langJs: string = '"zh-CN"';
    const scrJs: string = '[956,1470]';
    const combined: string = fontsJs + devMemJs + hwConcJs + tzJs + cpuJs + platJs + langJs + scrJs;
    const fp: Record<string, string> = {
      'fonts': await CasCrypto.sha256Hex(fontsJs),
      'deviceMemory': await CasCrypto.sha256Hex(devMemJs),
      'hardwareConcurrency': await CasCrypto.sha256Hex(hwConcJs),
      'localgroupId': groupId,
      'timezone': tzJs,
      'cpuClass': await CasCrypto.sha256Hex(cpuJs),
      'platform': platJs,
      'language': langJs,
      'screenResolution': scrJs,
      'fingerprint': await CasCrypto.sha256Hex(combined),
      'cookieValue': deviceCookie,
      'userAgent': ua,
      'platformAuthenticator': 'support'
    };
    return JSON.stringify(fp);
  }

  /** 自证：跑测试向量，返回是否与期望一致（编译期+运行期双重防「以为对的编码」）。 */
  static async selfTest(): Promise<boolean> {
    const actual: string = await CasCrypto.aesEcbEncrypt(TEST_KEY_B64, TEST_PLAIN);
    const ok: boolean = actual === TEST_EXPECT;
    debug('CasCrypto selfTest match=' + (ok ? 'true' : 'false'));
    return ok;
  }
}
