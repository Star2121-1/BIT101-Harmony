/**
 * 话廊只读页（#154）：四流列表 + 搜索 + 登录入口。
 *
 * ## 边界（对齐 ROADMAP 判据）
 * - 只做**只读**：列表/搜索/详情入口。发帖/点赞/评论/举报等写操作不做（#155 不在本轮）。
 * - 登录：用户本人在本页输学号+密码，密码 md5 后进 `/user/login`，明文不落盘、不打印。
 *   opt-in 存凭据（给 401 静默刷新用）复用登录页的 AutoLoginCredentialStore 开关，
 *   本页只提示「静默续期需在登录页开启记住密码」，不擅自存。
 * - 未登录/取数失败/空列表三态分离，不把失败伪装成「没有帖子」。
 * - 颜色一律 gridTokens（页面禁 import AppColors），档位进 @State 不进颜色。
 */

import { router } from '@kit.ArkUI';
import { Context } from '@kit.AbilityKit';
import { gridTokens } from '../core/theme/GridTokens.ts';
import type { GridTokens } from '../core/theme/GridTokens.ts';
import { STORAGE_DARK, STORAGE_PALETTE, getPalette } from '../data/ThemeStore.ts';
import { CommunityService, COMMUNITY_MODES, CommunityListResult } from '../service/CommunityService.ts';
import { CommunityAuthService } from '../service/CommunityAuthService.ts';
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

  build() {
    Column() {
      Row() {
        Text('话廊').fontSize(17).fontWeight(FontWeight.Bold).layoutWeight(1)
        Text(this.loggedIn ? '已登录' : '未登录')
          .fontSize(12).fontColor(this.loggedIn ? this.tk().success : this.tk().stateAttention)
        Button(this.loggedIn ? '换号' : '登录').fontSize(12).margin({ left: 8 })
          .onClick(() => {
            this.showLogin = !this.showLogin;
          })
      }.width('100%').padding({ left: 16, right: 16, top: 12, bottom: 8 })

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
                Text(p.title.length > 0 ? p.title : '(无标题)').fontSize(14).fontWeight(FontWeight.Medium)
                Text(p.text.length > 80 ? p.text.substring(0, 80) + '…' : p.text)
                  .fontSize(12).fontColor(this.tk().onSurfaceVariant)
                Row() {
                  Text(posterSubtitle(p)).fontSize(11).fontColor(this.tk().onSurfaceVariant).layoutWeight(1)
                  Text('评论 ' + p.commentCount + ' · 赞 ' + p.likeCount)
                    .fontSize(11).fontColor(this.tk().onSurfaceVariant)
                }.width('100%')
              }
              .width('100%').padding({ left: 16, right: 16, top: 10, bottom: 10 })
              .onClick(() => {
                // 详情走 Web 壳（社区是 H5），不在原生页解析 plugins
                router.pushUrl({ url: 'pages/WebShellPage', params: { url: 'https://bit101.flwfdd.xyz/posters/' + p.id } })
                  .catch((e: Error) => {
                    warn('community open detail fail: ' + JSON.stringify(e));
                  });
              })
            }
          }, (p: CommunityPost) => p.id.toString())
        }.layoutWeight(1)
      }
    }
    .width('100%').height('100%')
    .backgroundColor(this.tk().background)
  }
}
