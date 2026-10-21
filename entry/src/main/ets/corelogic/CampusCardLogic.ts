/**
 * 一卡通首页快照的**纯解析逻辑**（1:1 对照 Android `CampusCardLogic`）。
 *
 * 网络在 `service/CampusCardService.ts`；趋势在 `CampusCardBalanceLogic.ts`。
 * 本文件不碰系统时间、不碰网络 —— 全部由参数喂进来，可单测。
 */

/** 一卡通入口（标签 → 数值）对。 */
export interface CardEntry {
  label: string;
  /** 原始数值串（可能带千分位逗号，如 "1,234.56"）。 */
  value: string;
}

/** 首页快照。 */
export interface CardSnapshot {
  entries: CardEntry[];
  /** 首页 HTML 前 1200 字符（调试期对照真实响应用）。 */
  htmlSnippet: string;
  /** 是否像「已登录」状态。 */
  loggedIn: boolean;
  /** **请求本身失败**（网络/超时/异常）——与「未登录」是两回事，混一起会说错话。 */
  failed: boolean;
}

/**
 * 一卡通首页（CAS 的 service 指回这里）。
 *
 * ⚠️「登录一卡通」按钮的目标与取数地址必须是同一条（2026-09-30 SSO 审计：
 * 两边各写一遍字符串，改一处漏一处 = 登录白做）。鸿蒙侧同样只有这一处定义。
 */
export const HOME_URL: string = 'https://dkykt.info.bit.edu.cn/home/openHomePageByCas';

const SSO_HOST: string = 'sso.bit.edu.cn';

/**
 * 余额类字段启发式：`余额` / `过渡余额` 等 + 紧跟的金额。
 * 金额前的分隔符（HTML 标签、空白、冒号等）**不含数字**、长度限 16 ——
 * 太长会把「更新时间」之类的下一个数字误当成金额（金额要求带小数点，
 * 日期型如 `09-24` 不满足，所以实践中较稳）。
 */
const ENTRY_REGEX: RegExp = /(过渡余额|账户余额|余额|芯片余额)[^0-9]{0,16}([\d,]+\.\d{1,2})/g;

/** HTML 片段保留长度（调试用，与 Android 一致）。 */
const SNIPPET_LEN: number = 1200;

/**
 * 从 URL 串取主机名（对齐 `java.net.URI(url).host`：不含端口/用户信息，
 * 取不到返回空串）。**不用全局 URL**：ArkTS 侧没有，正则在两个运行时同行为。
 */
export function hostOf(urlText: string): string {
  const m = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/([^/?#]+)/.exec(urlText.trim());
  if (!m) return '';
  // 去掉 userinfo@ 与 :port
  const afterAt: string = m[1].split('@').pop() ?? '';
  return afterAt.split(':')[0];
}

/**
 * 解析首页响应。
 *
 * ⚠️ **「未登录」只看最终 URL**：未登录时服务端 302 到 CAS（`finalUrl` 主机是
 * `sso.bit.edu.cn`）。**不能按 HTML 关键词判** —— 首页正文本身含「统一身份认证」
 * 文案，v1.8.0 因此把已登录页误判成未登录（卡片永远显示「点开登录」）。
 *
 * @param html 首页响应体（可能为空 = 网络失败）
 * @param finalUrl 跟随重定向之后的最终地址
 */
export function parse(html: string, finalUrl: string): CardSnapshot {
  const redirectedToSso: boolean = hostOf(finalUrl).endsWith(SSO_HOST);
  const loggedIn: boolean = !redirectedToSso && html.length > 0;

  // 同一金额可能被模板渲染两遍（桌面端 + 移动端两段），按标签去重（保留首现顺序）
  const entries: CardEntry[] = [];
  const seen: Set<string> = new Set<string>();
  ENTRY_REGEX.lastIndex = 0;
  let m: RegExpExecArray | null = ENTRY_REGEX.exec(html);
  while (m !== null) {
    const label: string = m[1];
    if (!seen.has(label)) {
      seen.add(label);
      entries.push({ label: label, value: m[2] });
    }
    m = ENTRY_REGEX.exec(html);
  }

  return {
    entries: entries,
    htmlSnippet: html.substring(0, SNIPPET_LEN),
    loggedIn: loggedIn,
    failed: false
  };
}

/**
 * 余额摘要文案（「我」页卡片与详情页共用；纯函数）。
 *
 * `notLoggedIn` 要按场景给：「我」页卡片说「进详情页登录」，详情页自己说「点下方按钮」——
 * 同一句话在详情页里会变成「进详情页登录」（人已经在了）。
 */
export function balanceText(
  snapshot: CardSnapshot | null,
  loading: boolean,
  fetched: boolean,
  notLoggedIn: string = '未登录，进详情页登录'
): string {
  if (loading && !fetched) return '获取中…';
  if (snapshot === null || snapshot.failed) return '获取失败，下拉/点刷新重试';
  if (!snapshot.loggedIn) return notLoggedIn;
  const first: CardEntry | undefined = snapshot.entries[0];
  return first !== undefined ? '¥' + first.value : '未识别到余额';
}
