/**
 * 话廊只读页（#154）：四流列表 + 搜索 + 登录入口。
 *
 * ## 写操作红线（#155）
 * - 发帖/点赞/评论/举报都是**真实对外副作用**：只在用户主动点击按钮时调用
 *   CommunityWriteService，绝不在 aboutToAppear/load/任何自动路径触发。
 * - 本页做：发帖（纯文字）、点赞（列表即时反馈）、评论弹层、举报弹层。
 * - 详情正文走 Web 壳（社区是 H5），原生不解析 plugins。
 * - 登录：用户本人在本页输学号+密码，密码 md5 后进 `/user/login`，明文不落盘、不打印。
 * - 未登录/取数失败/空列表三态分离，不把失败伪装成「没有帖子」。
 * - 颜色一律 gridTokens（页面禁 import AppColors），档位进 @State 不进颜色。
 */

import { router } from '@kit.ArkUI';
import { Context } from '@kit.AbilityKit';
import { gridTokens } from '../core/theme/GridTokens.ts';
import type { GridTokens } from '../core/theme/GridTokens.ts';
import { STORAGE_DARK, STORAGE_PALETTE, getPalette } from '../data/ThemeStore.ts';
import { CommunityService, COMMUNITY_MODES, CommunityListResult, ReportType } from '../service/CommunityService.ts';
import { CommunityAuthService } from '../service/CommunityAuthService.ts';
import { CommunityWriteService } from '../service/CommunityWriteService.ts';
import { FakeCookieStore } from '../data/FakeCookieStore.ts';
import { posterSubtitle, type CommunityPost } from '../corelogic/CommunityLogic.ts';
import { info, warn } from '../core/log/BitLog.ts';

@Entry
@Component
export struct CommunityPage {
  @StorageLink(STORAGE_DARK) isDark: boolean = false;
  @StorageLink(STORAGE_PALETTE) paletteName: string = 'warm';

  @State modeIndex: number = 0;
  @State query: string = '';
  @State posts: CommunityPost[] = [];
  @State loading: boolean = false;
  @State stateKind: string = 'idle'; // idle | ok | needLogin | failed
  @State msg: string = '';
  @State loggedIn: boolean = false;
  @State showLogin: boolean = false;
  @State inputSid: string = '';
  @State inputPwd: string = '';
  @State loginBusy: boolean = false;
  @State loginMsg: string = '';

  // 写操作 UI 状态（全部由用户点击驱动）
  @State showCompose: boolean = false;
  @State composeTitle: string = '';
  @State composeText: string = '';
  @State composeAnonymous: boolean = false;
  @State composePublic: boolean = true;
  @State composeBusy: boolean = false;
  @State actionMsg: string = '';
  @State showCommentFor: number = 0;      // 0 = 无；>0 = 对应该帖子 id
  @State commentText: string = '';
  @State showReportFor: number = 0;
  @State reportText: string = '';
  @State reportTypeId: number = 0;
  @State reportTypes: ReportType[] = [];
  // 点赞后的即时反馈：字符串 "id|like(0/1)|num"，整体替换数组触发 ArkUI 刷新（ArkTS 禁 Object.assign）
  @State likeRecords: string[] = [];

  /** 从点赞记录里取某帖子的状态；没有则返回 null（用列表原值）。 */
  private likeOf(id: number): string | null {
    const prefix: string = id + '|';
    for (const rec of this.likeRecords) {
      if (rec.indexOf(prefix) === 0) {
        return rec;
      }
    }
    return null;
  }

  /** 点赞按钮显示文案（build() 里禁 const，逻辑放方法里）。 */
  private likeLabel(p: CommunityPost): string {
    const rec: string | null = this.likeOf(p.id);
    const on: boolean = rec !== null ? rec.split('|')[1] === '1' : false;
    const num: string = rec !== null ? rec.split('|')[2] : String(p.likeCount);
    return (on ? '♥ ' : '♡ ') + num;
  }

  /** 当前是否已赞（决定颜色）。 */
  private likeIsOn(p: CommunityPost): boolean {
    const rec: string | null = this.likeOf(p.id);
    return rec !== null && rec.split('|')[1] === '1';
  }

  private tk(): GridTokens {
    return gridTokens(this.isDark, getPalette(this.paletteName));
  }

  aboutToAppear(): void {
    FakeCookieStore.has().then((on: boolean) => {
      this.loggedIn = on;
    });
    this.load();
  }

  private async load(): Promise<void> {
    if (this.loading) {
      return;
    }
    this.loading = true;
    this.stateKind = 'idle';
    this.msg = '';
    try {
      const ctx: Context = getContext(this) as Context;
      const mode: string = COMMUNITY_MODES[this.modeIndex];
      const res: CommunityListResult = await CommunityService.list(ctx, mode, 0, this.query);
      this.stateKind = res.kind;
      this.posts = res.posts;
      this.msg = res.message;
      this.loggedIn = await FakeCookieStore.has();
      info('community page state=' + res.kind + ' n=' + res.posts.length);
    } catch (e) {
      warn('community page load fail: ' + JSON.stringify(e));
      this.stateKind = 'failed';
      this.msg = '社区取数异常';
    }
    this.loading = false;
  }

  /** 用户本人输密码登录；密码只在这个调用栈里，成功后立刻清 UI 状态。 */
  private async doCommunityLogin(): Promise<void> {
    if (this.loginBusy) {
      return;
    }
    const sid: string = this.inputSid.trim();
    const pwd: string = this.inputPwd;
    if (sid.length === 0 || pwd.length === 0) {
      this.loginMsg = '请填学号和密码';
      return;
    }
    this.loginBusy = true;
    this.loginMsg = '正在登录社区…';
    try {
      const ctx: Context = getContext(this) as Context;
      const out = await CommunityAuthService.login(ctx, sid, pwd);
      this.inputPwd = '';
      if (out.kind === 'ok') {
        this.loginMsg = '';
        this.showLogin = false;
        this.loggedIn = true;
        await this.load();
      } else {
        this.loginMsg = out.message;
      }
    } catch (e) {
      this.inputPwd = '';
      this.loginMsg = '社区登录异常';
    }
    this.loginBusy = false;
  }

  /**
   * 用户点「赞」——唯一的点赞触发入口。服务端返回操作后状态，据此更新列表。
   */
  private async doLike(p: CommunityPost): Promise<void> {
    if (!this.loggedIn) {
      this.actionMsg = '请先登录再点赞';
      return;
    }
    this.actionMsg = '';
    const ctx: Context = getContext(this) as Context;
    const out = await CommunityWriteService.like(ctx, 'poster', p.id);
    if (out.result.kind === 'needLogin') {
      this.loggedIn = false;
      this.actionMsg = out.result.message;
      return;
    }
    if (out.state === null) {
      this.actionMsg = out.result.message;
      return;
    }
    // 整体替换数组触发 ArkUI 刷新（ArkTS 禁 Object.assign / 动态 key 对象）
    const prefix: string = p.id + '|';
    const next: string[] = [];
    for (const rec of this.likeRecords) {
      if (rec.indexOf(prefix) !== 0) {
        next.push(rec);
      }
    }
    next.push(prefix + (out.state.like ? '1' : '0') + '|' + out.state.likeNum);
    this.likeRecords = next;
    if (out.result.kind !== 'ok') {
      this.actionMsg = out.result.message;
    }
  }

  /** 用户点「发帖」面板里的提交按钮。 */
  private async doCompose(): Promise<void> {
    if (this.composeBusy) {
      return;
    }
    if (this.composeTitle.trim().length === 0 && this.composeText.trim().length === 0) {
      this.actionMsg = '标题和正文不能都为空';
      return;
    }
    this.composeBusy = true;
    this.actionMsg = '';
    const ctx: Context = getContext(this) as Context;
    const out = await CommunityWriteService.createPost(ctx, this.composeTitle, this.composeText,
      this.composeAnonymous, this.composePublic, []);
    this.composeBusy = false;
    this.actionMsg = out.result.message;
    if (out.result.kind === 'needLogin') {
      this.loggedIn = false;
      return;
    }
    if (out.result.kind === 'ok') {
      this.composeTitle = '';
      this.composeText = '';
      this.showCompose = false;
      await this.load();
    }
  }

  /** 用户点评论弹层的发送按钮。 */
  private async doComment(): Promise<void> {
    if (this.showCommentFor <= 0) {
      return;
    }
    const ctx: Context = getContext(this) as Context;
    const out = await CommunityWriteService.comment(ctx, 'poster', this.showCommentFor,
      this.commentText, false, 0);
    this.actionMsg = out.message;
    if (out.kind === 'needLogin') {
      this.loggedIn = false;
    }
    if (out.kind === 'ok') {
      this.commentText = '';
      this.showCommentFor = 0;
      await this.load();
    }
  }

  /** 用户点举报弹层的提交按钮。 */
  private async doReport(): Promise<void> {
    if (this.showReportFor <= 0) {
      return;
    }
    const ctx: Context = getContext(this) as Context;
    const out = await CommunityWriteService.report(ctx, 'poster', this.showReportFor,
      this.reportText, this.reportTypeId);
    this.actionMsg = out.message;
    if (out.kind === 'needLogin') {
      this.loggedIn = false;
    }
    if (out.kind === 'ok') {
      this.reportText = '';
      this.showReportFor = 0;
    }
  }

  build() {
    Column() {
      Row() {
        Text('话廊').fontSize(17).fontWeight(FontWeight.Bold).layoutWeight(1)
        Text(this.loggedIn ? '已登录' : '未登录')
          .fontSize(12).fontColor(this.loggedIn ? this.tk().success : this.tk().stateAttention)
        if (this.loggedIn) {
          Button('发帖').fontSize(12).margin({ left: 8 })
            .onClick(() => {
              this.showCompose = !this.showCompose;
              this.actionMsg = '';
            })
        }
        Button(this.loggedIn ? '换号' : '登录').fontSize(12).margin({ left: 8 })
          .onClick(() => {
            this.showLogin = !this.showLogin;
          })
      }.width('100%').padding({ left: 16, right: 16, top: 12, bottom: 8 })

      // 写操作反馈条（点赞/发帖/评论/举报的如实结果）
      if (this.actionMsg.length > 0) {
        Text(this.actionMsg).fontSize(11).fontColor(this.tk().stateAttention)
          .width('100%').padding({ left: 16, right: 16, bottom: 4 })
      }

      if (this.showLogin) {
        Column({ space: 8 }) {
          Text('学号与密码只用于本次社区登录，明文不保存')
            .fontSize(11).fontColor(this.tk().onSurfaceVariant)
          TextInput({ placeholder: '学号', text: this.inputSid })
            .height(40).accessibilityText('社区学号输入框')
            .onChange((v: string) => {
              this.inputSid = v;
            })
          TextInput({ placeholder: '密码', text: this.inputPwd })
            .type(InputType.Password).height(40).accessibilityText('社区密码输入框')
            .onChange((v: string) => {
              this.inputPwd = v;
            })
          Button(this.loginBusy ? '登录中…' : '登录社区')
            .width('100%').height(40).enabled(!this.loginBusy)
            .onClick(() => {
              this.doCommunityLogin();
            })
          if (this.loginMsg.length > 0) {
            Text(this.loginMsg).fontSize(11).fontColor(this.tk().error)
          }
        }
        .width('100%').padding({ left: 16, right: 16, bottom: 8 })
      }

      // 发帖面板（纯文字帖；用户点「发帖」展开，提交按钮才触发写请求）
      if (this.showCompose) {
        Column({ space: 8 }) {
          Text('发纯文字帖（图片/H5 富文本暂不支持）')
            .fontSize(11).fontColor(this.tk().onSurfaceVariant)
          TextInput({ placeholder: '标题（可留空）', text: this.composeTitle })
            .height(40).accessibilityText('发帖标题输入框')
            .onChange((v: string) => {
              this.composeTitle = v;
            })
          TextInput({ placeholder: '正文', text: this.composeText })
            .height(60).accessibilityText('发帖正文输入框')
            .onChange((v: string) => {
              this.composeText = v;
            })
          Row() {
            Text('匿名').fontSize(12).onClick(() => {
              this.composeAnonymous = !this.composeAnonymous;
            })
            Toggle({ type: ToggleType.Checkbox, isOn: this.composeAnonymous })
              .onChange((on: boolean) => {
                this.composeAnonymous = on;
              })
            Text('仅自己可见').fontSize(12).margin({ left: 16 }).onClick(() => {
              this.composePublic = !this.composePublic;
            })
            Toggle({ type: ToggleType.Checkbox, isOn: this.composePublic })
              .onChange((on: boolean) => {
                this.composePublic = on;
              })
          }.width('100%')
          Button(this.composeBusy ? '发布中…' : '发布')
            .width('100%').height(40).enabled(!this.composeBusy)
            .onClick(() => {
              this.doCompose();
            })
        }
        .width('100%').padding({ left: 16, right: 16, bottom: 8 })
      }

      Row({ space: 6 }) {
        ForEach(COMMUNITY_MODES, (m: string, i: number) => {
          Text(m === 'recommend' ? '推荐' : (m === 'latest' ? '最新' : (m === 'hot' ? '最热' : '关注')))
            .fontSize(12)
            .fontColor(this.modeIndex === i ? this.tk().primary : this.tk().onSurfaceVariant)
            .backgroundColor(this.modeIndex === i ? this.tk().surfaceElevated : this.tk().surface)
            .padding({ left: 10, right: 10, top: 6, bottom: 6 })
            .borderRadius(12)
            .onClick(() => {
              this.modeIndex = i;
              this.load();
            })
        }, (m: string, i: number) => m + '_' + i)
      }.width('100%').padding({ left: 16, right: 16, bottom: 6 })

      Row() {
        TextInput({ placeholder: '搜索话廊', text: this.query })
          .height(36).layoutWeight(1).accessibilityText('话廊搜索框')
          .onChange((v: string) => {
            this.query = v;
          })
        Button('搜索').fontSize(12).margin({ left: 8 }).onClick(() => {
          this.load();
        })
      }.width('100%').padding({ left: 16, right: 16, bottom: 8 })

      if (this.loading) {
        Text('正在加载…').fontSize(13).fontColor(this.tk().onSurfaceVariant).padding(16)
      } else if (this.stateKind === 'needLogin') {
        Column() {
          Text('社区会话已失效或尚未登录').fontSize(14)
          Text('点右上角「登录」，用学号密码换社区票据').fontSize(12)
            .fontColor(this.tk().onSurfaceVariant).margin({ top: 6 })
        }.padding(16)
      } else if (this.stateKind === 'failed') {
        Text(this.msg.length > 0 ? this.msg : '社区取数失败').fontSize(13)
          .fontColor(this.tk().error).padding(16)
      } else if (this.posts.length === 0) {
        Text('暂无帖子').fontSize(13).fontColor(this.tk().onSurfaceVariant).padding(16)
      } else {
        List() {
          ForEach(this.posts, (p: CommunityPost) => {
            ListItem() {
              Column({ space: 4 }) {
                // 详情入口只挂文字区（打开 Web 壳），与下面的写操作按钮隔离，避免误触
                Column({ space: 4 }) {
                  Text(p.title.length > 0 ? p.title : '(无标题)').fontSize(14).fontWeight(FontWeight.Medium)
                  Text(p.text.length > 80 ? p.text.substring(0, 80) + '…' : p.text)
                    .fontSize(12).fontColor(this.tk().onSurfaceVariant)
                }
                .width('100%')
                .onClick(() => {
                  // 详情走 Web 壳（社区是 H5），不在原生页解析 plugins
                  router.pushUrl({ url: 'pages/WebShellPage', params: { url: 'https://bit101.flwfdd.xyz/posters/' + p.id } })
                    .catch((e: Error) => {
                      warn('community open detail fail: ' + JSON.stringify(e));
                    });
                })

                Row() {
                  Text(posterSubtitle(p)).fontSize(11).fontColor(this.tk().onSurfaceVariant).layoutWeight(1)
                  // 点赞：用户点按钮才触发；显示用服务端返回的操作后状态覆盖列表原值
                  Text(this.likeLabel(p))
                    .fontSize(11)
                    .fontColor(this.likeIsOn(p) ? this.tk().error : this.tk().onSurfaceVariant)
                    .padding({ left: 8, right: 8 })
                    .onClick(() => {
                      this.doLike(p);
                    })
                  Text('评 ' + p.commentCount).fontSize(11).fontColor(this.tk().onSurfaceVariant)
                    .padding({ left: 4, right: 4 })
                    .onClick(() => {
                      if (!this.loggedIn) {
                        this.actionMsg = '请先登录再评论';
                        return;
                      }
                      this.showCommentFor = p.id;
                      this.commentText = '';
                      this.actionMsg = '';
                    })
                  Text('举报').fontSize(11).fontColor(this.tk().onSurfaceVariant)
                    .padding({ left: 4 })
                    .onClick(async () => {
                      if (!this.loggedIn) {
                        this.actionMsg = '请先登录再举报';
                        return;
                      }
                      // 真实类型列表才开弹层——拿不到就不猜 typeId
                      const ctx: Context = getContext(this) as Context;
                      const types: ReportType[] = await CommunityService.reportTypes(ctx);
                      if (types.length === 0) {
                        this.actionMsg = '举报类型暂不可用，请稍后再试';
                        return;
                      }
                      this.reportTypes = types;
                      this.reportTypeId = types[0].id;
                      this.showReportFor = p.id;
                      this.reportText = '';
                      this.actionMsg = '';
                    })
                }.width('100%')
              }
              .width('100%').padding({ left: 16, right: 16, top: 10, bottom: 10 })
            }
          }, (p: CommunityPost) => p.id.toString())
        }.layoutWeight(1)
      }

      // 评论弹层（仅 loggedIn + 用户点「评」后出现；发送按钮才触发写请求）
      if (this.showCommentFor > 0) {
        Column({ space: 8 }) {
          Text('评论帖子 #' + this.showCommentFor).fontSize(13).fontWeight(FontWeight.Medium)
          TextInput({ placeholder: '说点什么…', text: this.commentText })
            .height(48).accessibilityText('评论内容输入框')
            .onChange((v: string) => {
              this.commentText = v;
            })
          Row({ space: 8 }) {
            Button('取消').fontSize(12).backgroundColor(this.tk().surfaceElevated)
              .fontColor(this.tk().onSurfaceVariant)
              .onClick(() => {
                this.showCommentFor = 0;
                this.commentText = '';
              })
            Button('发送评论').fontSize(12).layoutWeight(1)
              .onClick(() => {
                this.doComment();
              })
          }.width('100%')
        }
        .width('100%').padding(16)
        .backgroundColor(this.tk().surfaceElevated)
      }

      // 举报弹层（类型来自服务端 /manage/report_types，不猜 typeId）
      if (this.showReportFor > 0) {
        Column({ space: 8 }) {
          Text('举报帖子 #' + this.showReportFor).fontSize(13).fontWeight(FontWeight.Medium)
          Row({ space: 6 }) {
            ForEach(this.reportTypes, (t: ReportType) => {
              Text(t.text).fontSize(11)
                .fontColor(this.reportTypeId === t.id ? this.tk().primary : this.tk().onSurfaceVariant)
                .backgroundColor(this.reportTypeId === t.id ? this.tk().surfaceElevated : this.tk().surface)
                .padding({ left: 8, right: 8, top: 5, bottom: 5 }).borderRadius(10)
                .onClick(() => {
                  this.reportTypeId = t.id;
                })
            }, (t: ReportType) => t.id.toString())
          }.width('100%')
          TextInput({ placeholder: '补充说明（可留空）', text: this.reportText })
            .height(44).accessibilityText('举报说明输入框')
            .onChange((v: string) => {
              this.reportText = v;
            })
          Row({ space: 8 }) {
            Button('取消').fontSize(12).backgroundColor(this.tk().surfaceElevated)
              .fontColor(this.tk().onSurfaceVariant)
              .onClick(() => {
                this.showReportFor = 0;
                this.reportText = '';
              })
            Button('提交举报').fontSize(12).layoutWeight(1)
              .onClick(() => {
                this.doReport();
              })
          }.width('100%')
        }
        .width('100%').padding(16)
        .backgroundColor(this.tk().surfaceElevated)
      }
    }
    .width('100%').height('100%')
    .backgroundColor(this.tk().background)
  }
}
