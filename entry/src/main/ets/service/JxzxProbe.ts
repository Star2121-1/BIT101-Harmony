/**
 * 教务接口诊断探针（一次性，可整删）。
 *
 * 为什么需要它：真机上一轮验证要 4 分钟（USB 不稳），而「403 到底缺什么」需要用
 * 请求变体矩阵一次问清。结论写进沙箱文件（`jxzx_probe.txt`），由 hdc 拉取。
 *
 * 已知对照（PC 侧 curl 实测，2026-10-20）：
 * - `index.do` 无 cookie → **302**（回授权）；带 cookie → 200
 * - `dqxnxq.do` 无 cookie → **401**（未认证）
 * - 我们在真机上拿到的是 **403** ⇒ 已认证但被**权限/风控**拒 ⇒ 差的是请求上下文，不是会话
 */

import { Context } from '@kit.AbilityKit';
import { rcp } from '@kit.RemoteCommunicationKit';
import { RcpFactory } from '../core/net/RcpFactory.ts';
import { SchoolCookieStore } from '../data/SchoolCookieStore.ts';
import { getDumpDir, dumpText } from '../core/log/DebugDump.ts';

const APP: string = 'https://jxzxehallapp.bit.edu.cn';
const JXZX_UA: string =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36';
const INDEX_URL: string = APP + '/jwapp/sys/wdkbby/*default/index.do';
const TERM_URL: string = APP + '/jwapp/sys/wdkbby/modules/jshkcb/dqxnxq.do';
const CONFIG_URL: string = APP +
  '/jwapp/sys/funauthapp/api/getAppConfig/xsfacx-4766859113956613.do?v=08260885168155102';

function base(): rcp.RequestHeaders {
  return {
    'Accept': 'application/json, text/javascript, */*; q=0.01',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8,ja;q=0.7',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    'User-Agent': JXZX_UA,
    'X-Requested-With': 'XMLHttpRequest',
    'sec-ch-ua': '"Not:A-Brand";v="99", "Google Chrome";v="145", "Chromium";v="145"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"macOS"'
  };
}

export class JxzxProbe {
  /** 自动跑标记：`aa start --ps probe_jxzx 1` 时由 EntryAbility 置位（免点按钮，脚本化验证用）。 */
  private static autoRun: boolean = false;

  static requestAutoRun(): void {
    JxzxProbe.autoRun = true;
  }

  static shouldAutoRun(): boolean {
    return JxzxProbe.autoRun;
  }

  static async run(context: Context): Promise<string> {
    const lines: string[] = [];
    const cookies = await SchoolCookieStore.load();
    lines.push('cookies=' + cookies.length);
    const names: string[] = [];
    for (let i = 0; i < cookies.length; i++) {
      names.push(cookies[i].name + '@' + cookies[i].domain);
    }
    lines.push('cookie_names=' + names.join(','));
    lines.push('dumpDir=' + getDumpDir());

    const session: rcp.Session = await RcpFactory.createSession(context, 'bit_probe', true);
    const repo: rcp.CookieRepository = RcpFactory.cookieRepo('bit_probe');
    await RcpFactory.restoreCookies(repo, cookies);

    // 0) 首页（建立应用上下文）
    const idx = await RcpFactory.getText(session, INDEX_URL, {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'User-Agent': JXZX_UA
    });
    lines.push('0 index.do status=' + idx.status + ' len=' + idx.body.length +
      ' isLoginPage=' + (idx.body.indexOf('login-page-flowkey') >= 0 ? 'yes' : 'no') +
      ' has401=' + (idx.body.indexOf('<title>401') >= 0 ? 'yes' : 'no') +
      ' has403=' + (idx.body.indexOf('<title>403') >= 0 ? 'yes' : 'no'));

    // 1) 裸请求（当前实现）
    const r1 = await RcpFactory.getText(session, TERM_URL, base());
    lines.push('1 term base status=' + r1.status + ' len=' + r1.body.length +
      ' head=' + r1.body.substring(0, 80).replace(/\s+/g, ' '));

    // 2) 加 Referer
    const h2: rcp.RequestHeaders = {
      'Accept': 'application/json, text/javascript, */*; q=0.01',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8,ja;q=0.7',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
      'User-Agent': JXZX_UA,
      'X-Requested-With': 'XMLHttpRequest',
      'sec-ch-ua': '"Not:A-Brand";v="99", "Google Chrome";v="145", "Chromium";v="145"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"macOS"',
      'Referer': INDEX_URL,
      'Origin': APP
    };
    const r2 = await RcpFactory.getText(session, TERM_URL, h2);
    lines.push('2 term +referer+origin status=' + r2.status + ' len=' + r2.body.length);

    // 3) 先 getAppConfig 再问（有些 jwapp 要求先取应用配置）
    const cfg = await RcpFactory.getText(session, CONFIG_URL, {
      'Accept': 'application/json, text/javascript, */*; q=0.01',
      'User-Agent': JXZX_UA,
      'X-Requested-With': 'XMLHttpRequest',
      'Referer': INDEX_URL
    });
    lines.push('3 config status=' + cfg.status + ' len=' + cfg.body.length +
      ' head=' + cfg.body.substring(0, 200).replace(/\s+/g, ' '));
    const r3 = await RcpFactory.getText(session, TERM_URL, base());
    lines.push('4 term after-config status=' + r3.status + ' len=' + r3.body.length);

    // 5) 尝试学期列表（另一个模块，看是否同样 403）
    const listUrl: string = APP + '/jwapp/sys/wdkbby/modules/jshkcb/xnxqcx.do';
    const r5 = await RcpFactory.getText(session, listUrl, base());
    lines.push('5 termlist status=' + r5.status + ' len=' + r5.body.length);

    // 6) 课表接口（真正的目标）
    const schedUrl: string = APP +
      '/jwapp/sys/wdkbby/modules/xskcb/cxxszhxqkb.do?vpn-12-o2-jxzxehallapp.bit.edu.cn';
    const r6 = await RcpFactory.postForm(session, schedUrl, base(), { 'XNXQDM': '2026-2027-1' });
    lines.push('6 schedule status=' + r6.status + ' len=' + r6.body.length +
      ' head=' + r6.body.substring(0, 120).replace(/\s+/g, ' '));

    // 7) 403 时把正文前 600 字留下（判断是不是权限页）
    if (r1.status === 403) {
      lines.push('7 403_body=' + r1.body.substring(0, 600).replace(/\s+/g, ' '));
    }

    const report: string = lines.join('\n');
    dumpText('jxzx_probe.txt', report);
    return report;
  }
}
