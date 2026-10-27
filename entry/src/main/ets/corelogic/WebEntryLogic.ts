/**
 * 网页服务的**入口清单**与**「要不要留在 App 内」判定**（M10-3）。
 *
 * ## 为什么需要判定
 * 学校域名（`*.bit.edu.cn`）在系统浏览器里打开通常是**未登录**状态 —— 会话 cookie
 * 在本 App 的 Web 组件里。所以学校域名一律留在 App 内（`WebShellPage`），
 * 外部站点才交给系统浏览器（这里暂时也不跳，只在页面上提示）。
 *
 * ## 只放**已验证主机**
 * 清单里的地址都在本工程别处被真实请求过（`SeatService` / `SchoolService` /
 * `EclassService` / `LibBorrowService` / `CampusCardService`）。没有契约依据的
 * 猜测地址（如「成绩单系统」）不放进来 —— 点开必然是一页报错，比没有入口更糟。
 */

/** 一个网页入口。 */
export interface WebEntry {
  /** 稳定键（ForEach 用）。 */
  key: string;
  /** 显示名。 */
  label: string;
  /** 一行说明（登录态/用途）。 */
  note: string;
  /** 完整地址（必须 http(s)）。 */
  url: string;
}

/**
 * 入口清单（顺序即展示顺序：先高频、后低频）。
 * ⚠️ 只加**被本工程真实请求过**的主机，见文件头。
 */
export const WEB_ENTRIES: WebEntry[] = [
  {
    key: 'eclass',
    label: '延河课堂',
    note: '作业 / 课程资料（需在 App 内登录一次）',
    url: 'https://zy-eclass.bit.edu.cn/'
  },
  {
    key: 'jxzx',
    label: '教学中心（教务）',
    note: '课表 / 考试 / 成绩的原始站点',
    url: 'https://jxzxehall.bit.edu.cn/'
  },
  {
    key: 'library',
    label: '图书馆',
    note: '借阅 / 续借（需在 App 内登录一次）',
    url: 'https://mylib.bit.edu.cn/'
  },
  {
    key: 'card',
    label: '一卡通',
    note: '余额 / 流水（需在 App 内登录一次）',
    url: 'https://dkykt.info.bit.edu.cn/'
  },
  {
    key: 'seat',
    label: '座位预约系统',
    note: '网页版选座（与 App 内座位页同源）',
    url: 'https://seatlib.bit.edu.cn/'
  },
  {
    key: 'sso',
    label: '统一身份认证',
    note: '改密码 / 二次验证在这里办',
    url: 'https://sso.bit.edu.cn/cas/login'
  }
];

/** 取主机名（解析失败返回空串；不引 URL 全局类，手写更稳）。 */
export function hostOf(url: string): string {
  const s: string = url.trim();
  const scheme: number = s.indexOf('://');
  if (scheme < 0) {
    return '';
  }
  const rest: string = s.substring(scheme + 3);
  let end: number = rest.length;
  const slash: number = rest.indexOf('/');
  if (slash >= 0) {
    end = slash;
  }
  const q: number = rest.indexOf('?');
  if (q >= 0 && q < end) {
    end = q;
  }
  const host: string = rest.substring(0, end);
  // 去掉可能的 userinfo 与端口
  const at: number = host.lastIndexOf('@');
  const noUser: string = at >= 0 ? host.substring(at + 1) : host;
  const colon: number = noUser.indexOf(':');
  return (colon >= 0 ? noUser.substring(0, colon) : noUser).toLowerCase();
}

/** 是否学校域名（`bit.edu.cn` 及其子域）。 */
export function isSchoolHost(host: string): boolean {
  const h: string = host.toLowerCase();
  return h === 'bit.edu.cn' || h.endsWith('.bit.edu.cn');
}

/**
 * 该地址是否应留在 App 内打开。
 * - 学校域名 → true（会话在 App 的 Web 组件里，踢出去会变未登录）；
 * - 其它 → false；
 * - 非 http(s) → false（交出去也没意义，调用方应直接拒绝）。
 */
export function shouldStayInApp(url: string): boolean {
  const s: string = url.trim();
  if (!s.startsWith('http://') && !s.startsWith('https://')) {
    return false;
  }
  return isSchoolHost(hostOf(s));
}

/** 清单按 key 取一项（找不到返回 null）。 */
export function entryByKey(key: string): WebEntry | null {
  for (let i = 0; i < WEB_ENTRIES.length; i++) {
    if (WEB_ENTRIES[i].key === key) {
      return WEB_ENTRIES[i];
    }
  }
  return null;
}
