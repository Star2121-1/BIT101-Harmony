/**
 * R1 风险闸探针：验证「学校 CAS 登录页能否在鸿蒙 Web 组件里渲染出可用的账号密码登录表单」。
 *
 * 背景（照搬 Android 契约，不靠猜）：
 *  - features/seat/.../SeatSession.kt:153 —— sso.bit.edu.cn/cas/login 在 Android WebView
 *    里「Angular 应用在跑、页脚渲染，但登录区空白、表单不渲染」，故 Android 转了纯 HTTP。
 *  - docs/seatlib-contract.md §6 —— 判定锚点：#login-croypto（AES salt）+
 *    #login-page-flowkey（execution）+ username/password 输入框。
 *
 * 6 帧实测结论（2026-10-19 17:26+，多帧排除时序假阴性）：
 *  title 对、bodyHTML=26572（应用在跑、DOM 完整）、crypto/flowkey=true（隐藏字段在），
 *  但 iframes=0、inputs=0、bodyLen=0 ⇒ 可见密码输入区需交互切换才出现。
 *
 * 本阶段（队长指令）——先小样证伪「tab 假设」（铁律 0.9/0.2）：
 *  1) 枚举候选 tab 元素（li / a / [ng-reflect-click] / [ng-click] / .ng-binding，
 *     按含"账号/密码/扫码/短信"文本筛选），dump 到 hilog；
 *  2) 逐个点击含关键词的候选（click()，失败降级 dispatchEvent），点完等 2s 重探 inputs；
 *  3) 判据（可证伪）：
 *     任一次切换后 inputs>0 且锚点在 ⇒ 分支 A（R1 通过，Web 组件路线可行）
 *     4 个候选全点完仍 inputs=0     ⇒ 分支 B（R1 复现，与 Android 同款空白，转纯 HTTP 待拍板）
 *
 * 本探针**只验渲染、不填任何凭据**（零账号风险）。
 * URL 1:1 对齐 Android：service = seatlib 的 cas 回调地址。
 */
import { webview } from '@kit.ArkWeb';
import { hilog } from '@kit.PerformanceAnalysisKit';

const DOMAIN: number = 0x00BB;
const TAG: string = 'BIT101Cas';

/** CAS service 参数（对齐 Android SeatSession.kt:90 CAS_SERVICE）。 */
const CAS_SERVICE: string = 'https://seatlib.bit.edu.cn/api/cas/cas';
const CAS_LOGIN_URL: string =
  'https://sso.bit.edu.cn/cas/login?service=' + encodeURIComponent(CAS_SERVICE);

/** 最多试几个候选点击后才定分支 B（避免单点误判）。 */
const CLICK_MAX: number = 4;
/** 帧探测次数上限（onPageEnd 后每 1.5s 一次，点击后 2s 一次）。 */
const PROBE_MAX: number = 6;
const PROBE_INTERVAL_MS: number = 1500;
/** 点击后等 Angular 重渲染再重探的间隔。 */
const REPROBE_AFTER_CLICK_MS: number = 2000;

/** 候选 tab 的关键词（与 buildClickJS 内部完全一致，两处枚举必须同序同集）。 */
const KW: string = '账号,密码,扫码,短信';

@Entry
@Component
struct CasLoginProbe {
  @State status: string = '尚未加载';
  @State detail: string = '';
  private controller: webview.WebviewController = new webview.WebviewController();
  private probeCount: number = 0;
  /** 已试过的候选点击次数（对应 buildClickJS 的 idx 参数）。 */
  private clickTrials: number = 0;

  aboutToAppear(): void {
    hilog.info(DOMAIN, TAG, 'probe begin url=%{public}s', CAS_LOGIN_URL);
  }

  // ── 探针 JS：顶层 + 同域 iframe，避免「主文档 inputs=0」误判（原样保留）──

  private buildProbeJS(): string {
    return '(function(){' +
      'var r={};' +
      'r.title=(document.title||"");' +
      'r.iframes=document.querySelectorAll(\'iframe\').length;' +
      'r.forms=document.querySelectorAll(\'form\').length;' +
      'r.inputs=document.querySelectorAll(\'input\').length;' +
      'r.inputNames=Array.prototype.map.call(document.querySelectorAll(\'input\'),function(i){return (i.name||i.id||i.type);}).join(\',\');' +
      'r.crypto=!!document.querySelector(\'#login-croypto\');' +
      'r.flowkey=!!document.querySelector(\'#login-page-flowkey\');' +
      'r.bodyHTML=document.body?document.body.innerHTML.length:-1;' +
      'r.bodyLen=document.body?document.body.innerText.length:-1;' +
      'var ifr=document.querySelectorAll(\'iframe\');' +
      'for(var i=0;i<ifr.length&&i<5;i++){' +
      'try{var d=(ifr[i].contentDocument||(ifr[i].contentWindow?ifr[i].contentWindow.document:null));' +
      'if(d){r[\'if\'+i]=d.querySelectorAll(\'input\').length+\'|html=\'+(d.body?d.body.innerHTML.length:-1);}' +
      'else{r[\'if\'+i]=\'empty\';}' +
      '}catch(e){r[\'if\'+i]=\'xfr:\'+String(e).substring(0,40);}' +
      '} ' +
      'return JSON.stringify(r);' +
      '})();';
  }

  /** 枚举 JS 公共段（tabLike 筛选逻辑）：buildTabEnumJS 与 buildClickJS 共用，保证同序同集。 */
  private enumCoreJS(): string {
    return 'var sels=[\'li\',\'a\',\'[ng-reflect-click]\',\'[ng-click]\',\'.ng-binding\'];' +
      'var seen={};var cands=[];' +
      'for(var s=0;s<sels.length;s++){' +
      'var els=document.querySelectorAll(sels[s]);' +
      'for(var i=0;i<els.length;i++){' +
      'var e=els[i];' +
      'var t=(e.textContent||\'\').trim();' +
      'if(t.length>24){t=t.substring(0,24);}' +
      'if(t.length===0){continue;}' +
      'var key=e.tagName.toLowerCase()+\'|\'+(String(e.className)||\'\')+\'|\'+t;' +
      'if(seen[key]){continue;}' +
      'seen[key]=1;' +
      'cands.push({el:e,tag:e.tagName.toLowerCase(),cls:String(e.className)||\'\',t:t});' +
      '}' +
      '}' +
      'var kw=["\u8d26\u53f7","\u5bc6\u7801","\u626b\u7801","\u77ed\u4fe1"];' +
      'var tabLike=cands.filter(function(c){return kw.some(function(k){return c.t.indexOf(k)>=0;});});' +
      'var targets=(tabLike.length>0)?tabLike:cands;' +
      'var inputs=document.querySelectorAll(\'input\').length;' +
      '';
  }

  /** 枚举候选 tab（dump 用）：返回 {inputs, all(前30), tabLike, bodyLen}。 */
  private buildTabEnumJS(): string {
    return '(function(){' +
      this.enumCoreJS() +
      'return JSON.stringify({' +
      'inputs:inputs,' +
      'all:cands.slice(0,30),' +
      'tabLike:tabLike.map(function(x){return x.tag+\'.\'+x.cls+\' > \'+x.t;}),' +
      'bodyLen:document.body?document.body.innerText.length:0' +
      '});' +
      '})();';
  }

  /**
   * 深挖 DOM（铁律 0.2：inputs=0 前先查"找法太窄"）：
   * 全量 dump input（含 hidden/不可见）+ form 壳内容 + 锚点标签 + 页面关键词上下文。
   * 用于判"输入框真不存在"还是"存在但不可见/在别的结构里"。
   */
  private buildDeepDumpJS(): string {
    return '(function(){' +
      'var out={};' +
      'var ins=document.querySelectorAll(\'input,select,textarea\');' +
      'out.controls=[];' +
      'for(var i=0;i<ins.length;i++){' +
      'var e=ins[i];var cs=getComputedStyle(e);' +
      'out.controls.push({' +
      'tag:e.tagName.toLowerCase(),' +
      'id:e.id||"",name:e.name||"",type:e.type||"",' +
      'disp:cs.display,vis:cs.visibility,' +
      'ow:(e.offsetWidth||0)+"x"+(e.offsetHeight||0),' +
      'parent:(e.parentElement?e.parentElement.tagName.toLowerCase():"-")});' +
      '}' +
      'var f=document.querySelector(\'form\');' +
      'out.form=f?{action:((f.getAttribute("action")||"").substring(0,120)),' +
      'html:(f.innerHTML||"").substring(0,900),' +
      'ctrlCount:f.querySelectorAll("input,select,textarea,button").length}:null;' +
      'var c=document.querySelector(\'#login-croypto\');' +
      'out.cryptoAnchor=c?{tag:c.tagName.toLowerCase(),' +
      'val:String(c.value||c.textContent||"").substring(0,20),' +
      'parent:(c.parentElement?c.parentElement.tagName.toLowerCase()+c.parentElement.id+" "+c.parentElement.className:"-")}:null;' +
      'var fk=document.querySelector(\'#login-page-flowkey\');' +
      'out.flowAnchor=fk?{tag:fk.tagName.toLowerCase(),' +
      'val:String(fk.value||fk.textContent||"").substring(0,20),' +
      'parent:(fk.parentElement?fk.parentElement.tagName.toLowerCase()+fk.parentElement.id:"-")}:null;' +
      'var bt=document.body?(document.body.innerText||"").trim():"";' +
      'out.bodyKw=bt.length>0?bt.substring(0,400):"(body empty)";' +
      'out.bodyHTMLLen=document.body?document.body.innerHTML.length:0;' +
      'return JSON.stringify(out).substring(0,3000);' +
      '})();';
  }

  private buildClickJS(idx: number): string {
    const idxStr: string = String(idx);
    return '(function(){' +
      this.enumCoreJS() +
      'var targets=(tabLike.length>0)?tabLike:cands;' +
      'var idx=' + idxStr + ';' +
      'if(idx>=targets.length){' +
      'return JSON.stringify({ok:false,reason:\'idx=\'+idx+\' out of targets=\'+targets.length+' +
      ',tabLike=\'+tabLike.length});}' +
      'var c=targets[idx];' +
      'var how=\'\';' +
      'try{' +
      // 用 dispatchEvent 而非 el.click()：.click() 会触发真实 OAuth 导航（<a href>），
      // 页面跳走后 runJavaScript 结果丢失（返回 null）；dispatchEvent 走 JS 处理器、
      // 不触发导航，保证本次调用有 JSON 结果可判读。
      'c.el.dispatchEvent(new MouseEvent(\'click\',{bubbles:true,cancelable:true,view:window}));' +
      'how=\'dispatchEvent\';' +
      '}catch(ex2){' +
      'try{c.el.click();how=\'click()\';}' +
      'catch(ex3){how=\'fail\';}' +
      '}' +
      'return JSON.stringify({ok:true,idx:idx,of:targets.length,' +
      'sel:c.tag+\'.\'+c.cls+\' > \'+c.t,how:how,' +
      'tabLike:tabLike.length,all:cands.length});' +
      '})();';
  }

  // ── 主循环：多帧探测 + tab 点击 ─────────────────────────────────────────

  /**
   * 帧 n 的探针：
   *  inputs>0 且锚点在  ⇒ R1 通过（立即 dump cookie）
   *  inputs=0 且 clickTrials < CLICK_MAX ⇒ 点下一个候选，等 2s 重探
   *  候选穷尽且到末帧仍 inputs=0 ⇒ R1 复现
   */
  private probeDom(): void {
    if (this.probeCount >= PROBE_MAX) {
      return;
    }
    const n: number = this.probeCount;
    this.probeCount += 1;

    this.controller.runJavaScript(this.buildProbeJS()).then((result: string) => {
      hilog.info(DOMAIN, TAG, 'probe dom #%{public}d %{public}s', n, result);
      let o: Record<string, string> = {};
      try {
        o = JSON.parse(result) as Record<string, string>;
      } catch (e) {
        hilog.warn(DOMAIN, TAG, 'probe parse err: %{public}s', JSON.stringify(e));
        setTimeout(() => this.probeDom(), PROBE_INTERVAL_MS);
        return;
      }

      const topInputs: number = parseInt(o['inputs'] || '0', 10);
      const hasAnchor: boolean = (o['crypto'] === 'true') || (o['flowkey'] === 'true');

      this.detail =
        '[#' + n + '] title=' + (o['title'] || '') +
        '\niframes=' + (o['iframes'] || '0') +
        '  forms=' + (o['forms'] || '0') +
        '  topInputs=' + topInputs +
        '\ninputNames=' + (o['inputNames'] || '(none)') +
        '\ncrypto=' + (o['crypto'] || 'false') +
        '  flowkey=' + (o['flowkey'] || 'false') +
        '\nbodyHTML=' + (o['bodyHTML'] || '-1') +
        '  bodyLen=' + (o['bodyLen'] || '-1');

      // 通过判断：inputs>0 且锚点在
      if (topInputs > 0 && hasAnchor) {
        this.status = '✅ R1 通过：表单已渲染（inputs=' + topInputs +
          '，crypto=' + (o['crypto'] || 'false') +
          '，flowkey=' + (o['flowkey'] || 'false') + '）';
        hilog.info(DOMAIN, TAG, 'R1 PASS inputs=%{public}d', topInputs);
        this.dumpCookie();
        return;
      }

      // 仍未渲染：试下一个候选
      if (this.clickTrials < CLICK_MAX) {
        this.clickCandidate(this.clickTrials);
        return;
      }

      // 候选已穷尽，末帧定论
      if (n >= PROBE_MAX - 1) {
        this.status =
          '❌ R1 复现：已尝试全部可点候选（' + this.clickTrials + ' 次生效）仍 inputs=0，' +
          '与 Android WebView 同款空白 ⇒ 需转纯 HTTP（待用户拍板）';
        hilog.warn(DOMAIN, TAG, 'R1 REPRODUCED: %{public}d effective clicks, inputs still 0', this.clickTrials);
        return;
      }

      this.status = '候选已穷尽（生效 ' + this.clickTrials + ' 次），继续排帧确认…';
      setTimeout(() => this.probeDom(), PROBE_INTERVAL_MS);
    }).catch((e: Error) => {
      hilog.warn(DOMAIN, TAG, 'probe runJS err #%{public}d: %{public}s', n, JSON.stringify(e));
      setTimeout(() => this.probeDom(), PROBE_INTERVAL_MS);
    });
  }

  /** 点第 idx 个候选（tabLike 优先、空则第三方按钮），等 2s（Angular 重渲染）后自动重探。 */
  private clickCandidate(idx: number): void {
    this.status = '点击候选 #' + idx + '（第 ' + (this.clickTrials + 1) + '/' + CLICK_MAX + ' 次）…';

    // 第一次点前 dump 枚举 + 深挖结果（供 hilog 人工判读）
    if (idx === 0) {
      this.controller.runJavaScript(this.buildTabEnumJS()).then((result: string) => {
        hilog.info(DOMAIN, TAG, 'tab enum: %{public}s', result);
        this.detail += '\n[tab enum] ' + result.substring(0, 260);
      }).catch((e: Error) => {
        hilog.warn(DOMAIN, TAG, 'tab enum err: %{public}s', JSON.stringify(e));
      });
      this.controller.runJavaScript(this.buildDeepDumpJS()).then((result: string) => {
        hilog.info(DOMAIN, TAG, 'deep dump: %{public}s', result);
        this.detail += '\n[deep dump] ' + result.substring(0, 300);
      }).catch((e: Error) => {
        hilog.warn(DOMAIN, TAG, 'deep dump err: %{public}s', JSON.stringify(e));
      });
    }

    this.controller.runJavaScript(this.buildClickJS(idx)).then((result: string) => {
      hilog.info(DOMAIN, TAG, 'click #%{public}d → %{public}s', idx, result);
      this.detail += '\n[click ' + idx + '] ' + result.substring(0, 200);
      // 判定本次点击是否真的生效（ok:true 且 how=click()/dispatchEvent）
      let clicked: boolean = false;
      try {
        const o2: Record<string, string> = JSON.parse(result) as Record<string, string>;
        clicked = (o2['ok'] === 'true') && (o2['how'] !== 'fail');
      } catch (_e) {
        clicked = false;
      }
      if (clicked) {
        this.clickTrials += 1;
        this.status = '已点 #' + idx + '（' + this.clickTrials + '/' + CLICK_MAX + '），等 2s 后重探 inputs…';
        setTimeout(() => this.probeDom(), REPROBE_AFTER_CLICK_MS);
      } else {
        // 候选已穷尽（out-of-range / 解析失败）⇒ 停止点击，转入排帧定论
        this.clickTrials = CLICK_MAX;
        this.status = '候选已穷尽（点了 ' + idx + ' 个），排帧定论…';
        hilog.info(DOMAIN, TAG, 'click exhausted at idx=%{public}d, reason=%{public}s',
          idx, result.substring(0, 120));
        setTimeout(() => this.probeDom(), PROBE_INTERVAL_MS);
      }
    }).catch((e: Error) => {
      hilog.warn(DOMAIN, TAG, 'click #%{public}d err: %{public}s', idx, JSON.stringify(e));
      this.clickTrials = CLICK_MAX;
      setTimeout(() => this.probeDom(), PROBE_INTERVAL_MS);
    });
  }

  /** 登录页 cookie（R1 通过后，M1 下一步用 WebCookieManager 抽 cookie 注入 rcp）。 */
  private dumpCookie(): void {
    try {
      const c: string = webview.WebCookieManager.fetchCookieSync(CAS_LOGIN_URL);
      hilog.info(DOMAIN, TAG, 'cookie len=%{public}d head=%{public}s', c.length, c.substring(0, 60));
      this.detail += '\ncookie(len=' + c.length + '): ' + c.substring(0, 80);
      this.status += '\n✅ cookie 已抽取（len=' + c.length + '）';
    } catch (e) {
      hilog.warn(DOMAIN, TAG, 'fetchCookie none: %{public}s', JSON.stringify(e));
    }
  }

  build() {
    Column() {
      Row() {
        Text('CAS 登录页探针（R1 风险闸 · tab 证伪版）')
          .fontSize(16).fontWeight(FontWeight.Bold).layoutWeight(1)
        Button('重探')
          .onClick(() => {
            this.probeCount = 0;
            this.clickTrials = 0;
            this.status = '重新加载…';
            this.detail = '';
            this.controller.refresh();
          })
          .margin({ left: 8 })
      }.width('100%').padding(12)

      Row() {
        Text(this.status).fontSize(13).layoutWeight(1)
      }.width('100%').padding({ left: 12, right: 12 })

      Text(this.detail)
        .fontSize(12).fontColor('#888888')
        .padding({ left: 12, right: 12 }).layoutWeight(1)

      Web({
        src: CAS_LOGIN_URL,
        controller: this.controller
      })
        .javaScriptAccess(true)
        .onPageEnd((e: OnPageEndEvent): void => {
          hilog.info(DOMAIN, TAG, 'onPageEnd url=%{public}s', e.url);
          this.status = '加载完成，探测表单…';
          this.probeDom();
        })
        .onPageBegin((e: OnPageBeginEvent): void => {
          hilog.info(DOMAIN, TAG, 'onPageBegin url=%{public}s', e.url);
        })
        .onErrorReceive((e: OnErrorReceiveEvent): void => {
          const u: string = e.request ? e.request.getRequestUrl() : '';
          hilog.error(DOMAIN, TAG, 'onErrorReceive uri=%{public}s', u);
          if (this.status !== '加载完成，探测表单…') {
            this.status = '⚠️ 资源加载出错：' + u;
          }
        })
        .onHttpErrorReceive((_e: OnHttpErrorReceiveEvent): void => {
          hilog.warn(DOMAIN, TAG, 'onHttpError');
        })
        .layoutWeight(1)
    }
    .width('100%').height('100%')
  }
}
