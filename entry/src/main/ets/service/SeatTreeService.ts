/**
 * seatlib 座位树只读探针（M1）：rcp 网络层。
 *
 * 设计纪律（鸿蒙侧铁律）：
 * - 所有 API 对照 CLT 自带 SDK 的官方 .d.ts 核实（@hms.collaboration.rcp.d.ts），
 *   不用训练数据/推测。
 * - TLS 兜底：seatlib.bit.edu.cn 服务端只发叶证书、不下发中间证书，信任链断。
 *   本地 openssl 对照已验（harmony/probe-rcp/）：仅系统根库 → error 20；
 *   加「中间 + 根」bundle → OK。这里把 bundle 从 rawfile 读进，作为 extra CA
 *   交给 rcp remoteValidation（CertificateAuthority.content，非 tlcp 模式无限制）。
 * - 关自动重定向（autoRedirect=false）：M1 探针 1，POST 可读 302 Location。
 * - 请求头 1:1 对齐 Android SeatHttp.kt（桌面 UA / Accept-Language / lang / X-Requested-With）。
 *
 * 只读、低频、免认证（Seat/tree 无需登录）。绝不碰登录/cookie/短信。
 */
import { rcp } from '@kit.RemoteCommunicationKit';
import util from '@ohos.util';
import { Context } from '@kit.AbilityKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { SeatTreeNode, SeatTreeRaw, SeatTreeEnvelope, parseSeatTree } from '../model/SeatTreeModel.ts';

const HLOG_DOMAIN: number = 0x00AA;
const HLOG_TAG: string = 'BIT101Seat';

/** 对齐 Android SeatHttp.kt 的常量。 */
const SEATLIB_BASE: string = 'https://seatlib.bit.edu.cn';
const DESKTOP_UA: string =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const CA_RAWFILE: string = 'seatlib_tls_intermediate.pem';
const CONNECT_MS: number = 15000; // 对齐 Android CONNECT_TIMEOUT_SECONDS=15
const READ_MS: number = 30000;    // 对齐 Android READ_TIMEOUT_SECONDS=30

export class SeatTreeService {
  private session: rcp.Session | null = null;
  private buildPromise: Promise<void> | null = null;

  private async ensureSession(context: Context): Promise<void> {
    if (this.session !== null) {
      return;
    }
    if (this.buildPromise === null) {
      this.buildPromise = this.buildSession(context);
    }
    await this.buildPromise;
  }

  private async buildSession(context: Context): Promise<void> {
    let caPem: string = '';
    try {
      const bytes: Uint8Array = await context.resourceManager.getRawFileContent(CA_RAWFILE);
      const decoder: util.TextDecoder = util.TextDecoder.create('utf-8');
      caPem = decoder.decodeToString(bytes);
    } catch (e) {
      caPem = '';
    }

    const transfer: rcp.TransferConfiguration = {
      autoRedirect: false,
      timeout: { connectMs: CONNECT_MS, transferMs: READ_MS }
    };
    let security: rcp.SecurityConfiguration;
    if (caPem.length > 0) {
      const ca: rcp.CertificateAuthority = { content: caPem };
      security = { remoteValidation: ca };
    } else {
      security = { remoteValidation: 'system' };
    }
    const reqConfig: rcp.Configuration = { transfer: transfer, security: security };
    const sessionConfig: rcp.SessionConfiguration = { requestConfiguration: reqConfig };
    this.session = rcp.createSession(sessionConfig);
  }

  /** 查某天座位树（免认证、只读）。返回递归展平后的节点列表。 */
  async fetchTree(context: Context, date: string): Promise<SeatTreeNode[]> {
    await this.ensureSession(context);
    const session: rcp.Session | null = this.session;
    if (session === null) {
      throw new Error('rcp session 未初始化');
    }
    const headers: rcp.RequestHeaders = {
      'content-type': 'application/json',
      'User-Agent': DESKTOP_UA,
      'Accept-Language': 'zh-CN,zh;q=0.9',
      'lang': 'zh',
      'X-Requested-With': 'XMLHttpRequest'
    };
    const body: string = JSON.stringify({ date: date });
    const request: rcp.Request = new rcp.Request(SEATLIB_BASE + '/api/Seat/tree', 'POST', headers, body);
    hilog.info(HLOG_DOMAIN, HLOG_TAG, 'fetchTree begin date=%{public}s', date);
    let resp: rcp.Response;
    try {
      resp = await session.fetch(request);
    } catch (err) {
      hilog.error(HLOG_DOMAIN, HLOG_TAG, 'fetchTree transport error: %{public}s', JSON.stringify(err));
      throw new Error('rcp 传输错误（TLS/网络/证书）: ' + JSON.stringify(err));
    }
    if (resp.statusCode !== 200) {
      hilog.error(HLOG_DOMAIN, HLOG_TAG, 'fetchTree HTTP %{public}d', resp.statusCode);
      throw new Error('HTTP ' + resp.statusCode + '（seatlib TLS/网络）');
    }
    const rawBody: ArrayBuffer | undefined = resp.body;
    if (rawBody === undefined) {
      throw new Error('响应体为空');
    }
    const text: string = util.TextDecoder.create('utf-8').decodeToString(new Uint8Array(rawBody));
    const envelope: SeatTreeEnvelope = JSON.parse(text) as SeatTreeEnvelope;
    const code: number = envelope ? (envelope.code as number) : -1;
    const data: SeatTreeRaw[] = envelope ? (envelope.data as SeatTreeRaw[]) : [];
    if (code !== 1) {
      hilog.error(HLOG_DOMAIN, HLOG_TAG, 'fetchTree biz code=%{public}d body=%{public}s', code, text.substring(0, 200));
      throw new Error('seatlib 业务码 ' + code);
    }
    const nodes: SeatTreeNode[] = parseSeatTree(data);
    hilog.info(HLOG_DOMAIN, HLOG_TAG, 'fetchTree OK date=%{public}s nodes=%{public}d first=%{public}s',
      date, nodes.length, nodes.length > 0 ? (nodes[0].name + '/' + nodes[0].id) : '(empty)');
    return nodes;
  }

  /** 本地时区当天 YYYY-MM-DD。 */
  static today(): string {
    const d: Date = new Date();
    const mm: string = (d.getMonth() + 1).toString().padStart(2, '0');
    const dd: string = d.getDate().toString().padStart(2, '0');
    return d.getFullYear() + '-' + mm + '-' + dd;
  }
}
