/**
 * 教务（jxzxehall）只读服务。端点与参数**逐字照搬** BIT-Login SDK：
 * - `Term.kt:15-24`  当前学期  GET  /jwapp/sys/wdkbby/modules/jshkcb/dqxnxq.do
 * - `Term.kt:38-60`  校历/开学日 POST /jwapp/sys/wdkbby/wdkbByController/cxzkbrq.do
 * - `Course.kt:22-71` 课程表    POST /jwapp/sys/wdkbby/modules/xskcb/cxxszhxqkb.do?vpn-12-o2-…
 * - `Campus.kt:16-66` 校区/教学楼 GET /jwapp/sys/kxjasbyMobile/modules/jxllb/{ggzdpx,cxjxl}.do
 *
 * ⚠️ 所有调用前必须先访问 `*default/index.do` 初始化应用会话（SDK 原注释：
 * 「否则后端可能返回异常」）。这不是可选优化，是接口前提。
 *
 * 失败判据（可证伪）：cookie 过期时教务返回的不是数据，而是 CAS 登录页 HTML 或
 * `datas` 缺失 ⇒ 抛 `SchoolAuthError`，调用方据此引导重新登录（**不静默当成"没课"**）。
 */

import { rcp } from '@kit.RemoteCommunicationKit';
import { Context } from '@kit.AbilityKit';
import { RcpFactory } from '../core/net/RcpFactory.ts';
import { SchoolCookieStore } from '../data/SchoolCookieStore.ts';
import {
  BuildingInfo, CampusInfo, CourseRow, ExamRow, JsonValue, TermSchedule, arrOf, num, objOf, parseCourseRow, str
} from '../core/model/SchoolModels.ts';
import { info, warn } from '../core/log/BitLog.ts';
import { dumpText } from '../core/log/DebugDump.ts';

const APP: string = 'https://jxzxehallapp.bit.edu.cn';
/**
 * 教务侧 UA 必须与 `Config.Headers.base` 的 **Chrome/145** 一致，
 * 且要带齐 sec-ch-ua 客户端提示 —— 少一组就 403（2026-10-20 真机实测：
 * 只带 X-Requested-With 的请求被 WAF 拒了，学期接口直接 403）。
 */
const JXZX_UA: string =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36';

/** 教务侧会话失效（区别于网络错误：这个要引导重登）。 */
export class SchoolAuthError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'SchoolAuthError';
  }
}

/**
 * jxzxehall API 通用请求头 —— **逐字照搬** `Config.Headers.base`：
 * 包括 sec-ch-ua / sec-ch-ua-mobile / sec-ch-ua-platform 三组客户端提示。
 * 缺任何一组 → 403（真机取证见 evidence/m2-1-session/report.md）。
 */
function jsonHeaders(): rcp.RequestHeaders {
  return {
    'Accept': 'application/json, text/javascript, */*; q=0.01',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8,ja;q=0.7',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Pragma': 'no-cache',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-origin',
    'User-Agent': JXZX_UA,
    'X-Requested-With': 'XMLHttpRequest',
    'sec-ch-ua': '"Not:A-Brand";v="99", "Google Chrome";v="145", "Chromium";v="145"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"macOS"'
  };
}

/** 首页导航请求头（Config.Headers.jxzxehall）。 */
function navHeaders(): rcp.RequestHeaders {
  return {
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'User-Agent': JXZX_UA,
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Upgrade-Insecure-Requests': '1'
  };
}

const JAR_SCHOOL: string = 'bit_school';

export class SchoolService {
  /**
   * 应用上下文预热：调一次 `funauthapp/api/getAppConfig`。
   *
   * ⚠️⚠️ **这一步不是可选的**：金智 jwapp 的模块 API（`/modules/**`）在
   * 「应用配置未加载」时一律返回 **403**（不是 401——会话本身是好的）。
   * 2026-10-20 真机变体矩阵取证（`tools/run_probe.sh` 输出）：
   *   term base → 403 ；config → 200 ；term after-config → 200 ；schedule → 200 code=1
   * 只看 401/302 会把它误判成「会话过期」，方向就全错了。
   *
   * 该 URL 里的 `xsfacx-4766859113956613` 来自 `Config.Urls.jxzxehall_config`
   * （服务端下发的固定应用号，非用户数据）。
   */
  private static async warmUpAppConfig(session: rcp.Session): Promise<void> {
    const url: string = APP +
      '/jwapp/sys/funauthapp/api/getAppConfig/xsfacx-4766859113956613.do?v=08260885168155102';
    try {
      const res = await RcpFactory.getText(session, url, {
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'User-Agent': JXZX_UA,
        'X-Requested-With': 'XMLHttpRequest',
        'Referer': APP + '/jwapp/sys/wdkbby/*default/index.do'
      });
      info('SchoolService warmUp config status=' + res.status + ' len=' + res.body.length);
    } catch (e) {
      warn('SchoolService warmUp fail: ' + JSON.stringify(e));
    }
  }

  /**
   * 建一个带已存 cookie 的教务会话，并完成应用会话初始化。
   * 抛 SchoolAuthError（cookie 没了/被判回登录页）/ Error（网络）。
   *
   * ⚠️ **必须 autoRedirect=true**：`*default/index.do` 首次访问就是
   * 「302 → CAS 静默换票 → 302 回应用（Set-Cookie）→ 200」的正常链路。
   * 2026-10-20 栽过：用 autoRedirect=false 时把第一步的 302 判成「会话失效」，
   * 真机上表现成「登录成功但教务会话未建立」。
   * 判据不看中间状态码，只看**最终响应**：200 且正文不是 CAS 登录页。
   */
  static async openAppSession(context: Context, appPath: string): Promise<rcp.Session> {
    const cookies = await SchoolCookieStore.load();
    if (cookies.length === 0) {
      throw new SchoolAuthError('没有学校会话（未登录）');
    }
    const session: rcp.Session = await RcpFactory.createSession(context, JAR_SCHOOL, true);
    const repo: rcp.CookieRepository = RcpFactory.cookieRepo(JAR_SCHOOL);
    const restored: number = await RcpFactory.restoreCookies(repo, cookies);
    // 应用会话初始化（每个应用一个 index.do）
    const index = await RcpFactory.getText(session, APP + appPath + '/*default/index.do', navHeaders());
    const isLoginPage: boolean = index.body.indexOf('login-page-flowkey') >= 0;
    info('SchoolService open ' + appPath + ' final=' + index.status +
      ' len=' + index.body.length + ' loginPage=' + (isLoginPage ? 'yes' : 'no') +
      ' restored=' + restored);
    if (isLoginPage) {
      throw new SchoolAuthError('教务被判回登录页（cookie 已过期）');
    }
    if (index.status !== 200) {
      throw new SchoolAuthError('教务应用会话初始化失败（HTTP ' + index.status + '）');
    }
    // 关键：注册应用上下文，否则模块 API 一律 403
    await SchoolService.warmUpAppConfig(session);
    return session;
  }

  /**
   * 解析 JSON 响应；返回 null 表示不是 JSON（多为被踢回登录页的 HTML / WAF 拦截页）。
   * ⚠️ 失败时把**正文头部**打进日志（打码前提：教务正文无凭据），
   * 否则「403 但不知道为什么」会白查一轮（2026-10-20 栽过）。
   */
  /** JSON 解析（其它 service 复用它，保证「非 JSON = 会话问题」这一判断只有一份）。 */
  static parseJson(body: string, tag: string, status: number): Record<string, JsonValue> | null {
    const t: string = body.trim();
    if (t.length === 0 || (t.charAt(0) !== '{' && t.charAt(0) !== '[')) {
      const head: string = t.substring(0, 300).replace(/\s+/g, ' ');
      warn(tag + ' non-json status=' + status + ' len=' + t.length + ' head=' + head);
      // 完整正文写到沙箱文件（hilog 单行会被截断，看不到 403 的真正原因）
      dumpText('last_api_error.txt', tag + ' status=' + status + ' len=' + t.length + '\n\n' + t);
      return null;
    }
    try {
      return JSON.parse(t) as Record<string, JsonValue>;
    } catch (e) {
      warn(tag + ' json parse error status=' + status + ' head=' + t.substring(0, 120));
      return null;
    }
  }

  /** 当前学期，如 `2026-2027-1`。 */
  static async getCurrentTerm(context: Context): Promise<string> {
    const session: rcp.Session = await SchoolService.openAppSession(context, '/jwapp/sys/wdkbby');
    const url: string = APP + '/jwapp/sys/wdkbby/modules/jshkcb/dqxnxq.do';
    const res = await RcpFactory.getText(session, url, jsonHeaders());
    const json: Record<string, JsonValue> | null = SchoolService.parseJson(res.body, 'getCurrentTerm', res.status);
    if (json === null) {
      throw new SchoolAuthError('当前学期接口返回非 JSON（HTTP ' + res.status + '，多为会话过期）');
    }
    const rows: JsonValue[] = arrOf(objOf(objOf(json, 'datas'), 'dqxnxq'), 'rows');
    if (rows.length === 0) {
      throw new Error('教学中心未返回当前学期（该账号可能不使用本科教学中心）');
    }
    const first: Record<string, JsonValue> | null = objOf({ 'r': rows[0] }, 'r');
    const term: string = str(first, 'DM', '');
    if (term.length === 0) {
      throw new Error('当前学期字段 DM 为空');
    }
    info('SchoolService term=' + term);
    return term;
  }

  /** 学期列表。 */
  static async getTermList(context: Context): Promise<string[]> {
    const session: rcp.Session = await SchoolService.openAppSession(context, '/jwapp/sys/wdkbby');
    const url: string = APP + '/jwapp/sys/wdkbby/modules/jshkcb/xnxqcx.do';
    const res = await RcpFactory.getText(session, url, jsonHeaders());
    const json: Record<string, JsonValue> | null = SchoolService.parseJson(res.body, 'getTermList', res.status);
    if (json === null) {
      throw new SchoolAuthError('学期列表接口返回非 JSON（HTTP ' + res.status + '）');
    }
    const rows: JsonValue[] = arrOf(objOf(objOf(json, 'datas'), 'xnxqcx'), 'rows');
    const out: string[] = [];
    for (let i = 0; i < rows.length; i++) {
      const o: Record<string, JsonValue> | null = objOf({ 'r': rows[i] }, 'r');
      const dm: string = str(o, 'DM', '');
      if (dm.length > 0) {
        out.push(dm);
      }
    }
    return out;
  }

  /** 开学日（第一周星期一，`yyyy-MM-dd`）；取不到返回空串（调用方按"未知"处理，不猜）。 */
  static async getFirstDay(context: Context, term: string): Promise<string> {
    const session: rcp.Session = await SchoolService.openAppSession(context, '/jwapp/sys/wdkbby');
    return await SchoolService.firstDayOn(session, term);
  }

  /** 复用已建好的会话取开学日（避免重复开 session + 重复预热配置）。 */
  private static async firstDayOn(session: rcp.Session, term: string): Promise<string> {
    const url: string = APP + '/jwapp/sys/wdkbby/wdkbByController/cxzkbrq.do';
    const payload: string = JSON.stringify({ 'XNXQDM': term, 'ZC': '1' });
    const res = await RcpFactory.postForm(session, url, jsonHeaders(), { 'requestParamStr': payload });
    const json: Record<string, JsonValue> | null = SchoolService.parseJson(res.body, 'getFirstDay', res.status);
    if (json === null) {
      throw new SchoolAuthError('校历接口返回非 JSON（HTTP ' + res.status + '）');
    }
    const rows: JsonValue[] = arrOf(json, 'data');
    for (let i = 0; i < rows.length; i++) {
      const o: Record<string, JsonValue> | null = objOf({ 'r': rows[i] }, 'r');
      if (str(o, 'XQ', '') === '1') {
        const rq: string = str(o, 'RQ', '');
        info('SchoolService firstDay=' + rq);
        return rq;
      }
    }
    warn('SchoolService firstDay not found in rows=' + rows.length);
    return '';
  }

  /** 整学期课表（学期 + 开学日 + 课程行）。 */
  static async getSchedule(context: Context, term: string): Promise<TermSchedule> {
    const session: rcp.Session = await SchoolService.openAppSession(context, '/jwapp/sys/wdkbby');
    // 课表
    const url: string = APP +
      '/jwapp/sys/wdkbby/modules/xskcb/cxxszhxqkb.do?vpn-12-o2-jxzxehallapp.bit.edu.cn';
    const res = await RcpFactory.postForm(session, url, jsonHeaders(), { 'XNXQDM': term });
    const json: Record<string, JsonValue> | null = SchoolService.parseJson(res.body, 'getSchedule', res.status);
    if (json === null) {
      throw new SchoolAuthError('课表接口返回非 JSON（HTTP ' + res.status + '，多为会话过期）');
    }
    const rows: JsonValue[] = arrOf(objOf(objOf(json, 'datas'), 'cxxszhxqkb'), 'rows');
    if (rows.length === 0) {
      // 行数为 0 有两种可能：真没课 / 会话过期。用「有没有 datas 键」区分（铁律：先问真没有还是路径错）
      const hasDatas: boolean = objOf(json, 'datas') !== null;
      if (!hasDatas) {
        throw new SchoolAuthError('课表响应缺 datas（会话可能已过期）');
      }
      warn('SchoolService schedule rows=0（接口正常但无课程）');
    }
    const courses: CourseRow[] = [];
    for (let i = 0; i < rows.length; i++) {
      courses.push(parseCourseRow(rows[i]));
    }
    // 开学日单独取（失败不影响课表本身，只是周次换算会退化为"未知"）
    let firstDay: string = '';
    try {
      firstDay = await SchoolService.firstDayOn(session, term);
    } catch (e) {
      warn('SchoolService firstDay fail: ' + JSON.stringify(e));
    }
    info('SchoolService schedule term=' + term + ' rows=' + courses.length + ' firstDay=' + firstDay);
    return { term: term, firstDay: firstDay, courses: courses };
  }

  /**
   * 考试安排（对照 BIT-Login `Exam.getExamList`）。
   *
   * ⚠️ 必须先访问该应用的 `index.do`（openSession 已做）—— 金智 jwapp 的模块 API
   * 在应用会话未建立时返回 403，与教务课表同一个坑。
   * `KSRQ` 是「日期 + 零点时间」，排序用它（`KSSJMS` 是给人看的中文串，不可比大小）。
   */
  static async getExams(context: Context, term: string): Promise<ExamRow[]> {
    const session: rcp.Session = await SchoolService.openAppSession(context, '/jwapp/sys/wdksapMobile');
    const url: string = APP + '/jwapp/sys/wdksapMobile/modules/ksap/cxxsksap.do';
    // `*order` 是金智的分页/排序参数（星号是它自己的命名），照抄 SDK
    const res = await RcpFactory.postForm(session, url, jsonHeaders(), {
      'XNXQDM': term,
      '*order': '-KSRQ'
    });
    const json: Record<string, JsonValue> | null =
      SchoolService.parseJson(res.body, 'getExams', res.status);
    if (json === null) {
      throw new SchoolAuthError('考试接口返回非 JSON（HTTP ' + res.status + '）');
    }
    const rows: JsonValue[] = arrOf(objOf(objOf(json, 'datas'), 'cxxsksap'), 'rows');
    if (rows.length === 0) {
      // 行数 0 有两种可能：真没考试 / 响应结构不对。用「有没有 datas 键」区分
      if (objOf(json, 'datas') === null) {
        throw new SchoolAuthError('考试响应缺 datas（会话可能已过期）');
      }
      info('SchoolService exams term=' + term + ' rows=0（接口正常但无考试）');
    }
    const out: ExamRow[] = [];
    for (let i = 0; i < rows.length; i++) {
      const o: Record<string, JsonValue> | null = objOf({ 'r': rows[i] }, 'r');
      out.push({
        KCM: str(o, 'KCM', ''),
        KSSJMS: str(o, 'KSSJMS', ''),
        KSRQ: str(o, 'KSRQ', ''),
        JASMC: str(o, 'JASMC', ''),
        ZWH: str(o, 'ZWH', ''),
        KSMC: str(o, 'KSMC', ''),
        KCH: str(o, 'KCH', ''),
        ZJJSXM: str(o, 'ZJJSXM', '')
      });
    }
    out.sort((a: ExamRow, b: ExamRow) => a.KSRQ < b.KSRQ ? -1 : (a.KSRQ > b.KSRQ ? 1 : 0));
    info('SchoolService exams term=' + term + ' rows=' + out.length);
    return out;
  }

  /** 教务 API 通用请求头（**全仓唯一一份**，其它 service 复用这里，别各抄一份）。 */
  static jsonHeadersFor(): rcp.RequestHeaders {
    return jsonHeaders();
  }

  /** 校区列表（空教室查询的第一层）。 */
  static async getCampuses(context: Context): Promise<CampusInfo[]> {
    const session: rcp.Session = await SchoolService.openAppSession(context, '/jwapp/sys/kxjasbyMobile');
    const url: string = APP + '/jwapp/sys/kxjasbyMobile/modules/jxllb/ggzdpx.do?dicCode=48682&SFSY=1&order=%2BDM';
    const res = await RcpFactory.getText(session, url, jsonHeaders());
    const json: Record<string, JsonValue> | null = SchoolService.parseJson(res.body, 'getCampuses', res.status);
    if (json === null) {
      throw new SchoolAuthError('校区接口返回非 JSON（HTTP ' + res.status + '）');
    }
    const rows: JsonValue[] = arrOf(objOf(objOf(json, 'datas'), 'ggzdpx'), 'rows');
    if (rows.length === 0) {
      throw new SchoolAuthError('校区列表为空（Cookie 可能已过期）');
    }
    const out: CampusInfo[] = [];
    for (let i = 0; i < rows.length; i++) {
      const o: Record<string, JsonValue> | null = objOf({ 'r': rows[i] }, 'r');
      out.push({ displayName: str(o, 'MC', ''), code: str(o, 'DM', '') });
    }
    return out;
  }

  /** 教学楼列表（campusCode 为空 ⇒ 全部）。 */
  static async getBuildings(context: Context, campusCode: string): Promise<BuildingInfo[]> {
    const session: rcp.Session = await SchoolService.openAppSession(context, '/jwapp/sys/kxjasbyMobile');
    let url: string = APP + '/jwapp/sys/kxjasbyMobile/modules/jxllb/cxjxl.do';
    if (campusCode.length > 0) {
      url += '?XXXQDM=' + encodeURIComponent(campusCode);
    }
    const res = await RcpFactory.getText(session, url, jsonHeaders());
    const json: Record<string, JsonValue> | null = SchoolService.parseJson(res.body, 'getBuildings', res.status);
    if (json === null) {
      throw new SchoolAuthError('教学楼接口返回非 JSON（HTTP ' + res.status + '）');
    }
    const rows: JsonValue[] = arrOf(objOf(objOf(json, 'datas'), 'cxjxl'), 'rows');
    if (rows.length === 0) {
      throw new SchoolAuthError('教学楼列表为空（Cookie 可能已过期）');
    }
    const out: BuildingInfo[] = [];
    for (let i = 0; i < rows.length; i++) {
      const o: Record<string, JsonValue> | null = objOf({ 'r': rows[i] }, 'r');
      out.push({
        buildingName: str(o, 'JXLMC', ''),
        buildingIndex: str(o, 'JXLDM', ''),
        campusName: str(o, 'XXXQDM_DISPLAY', ''),
        campusCode: str(o, 'XXXQDM', '')
      });
    }
    return out;
  }
}
