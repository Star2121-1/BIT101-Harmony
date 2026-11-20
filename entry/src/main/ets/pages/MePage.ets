/**
 * 「我」页（M5-5，#91 对照原版 ref-03 重排）：
 * 顶栏三图标（刷新/通知/设置）+ 居中账号区（无白卡，直接铺背景）
 * + 自习卡 + 一卡通/校园网双卡 + 图书馆卡。
 *
 * 验收判据（可证伪）：
 *  1. 三张卡**常显摘要**（不是空白）：取不到/未登录/确实没有各有各的话；
 *  2. 未登录时给登录入口，而不是让人自己去找；
 *  3. 点卡片进对应详情页；进详情页回来后数字会刷新（壳内靠 active/epoch，独立页靠 onPageShow）。
 *  4. 功能入口组已按原版删除（2026-10-27）：作业/座位走底部 tab、
 *     通知/设置走顶栏图标、提醒设置迁到设置页「提醒」组（唯一入口先安置再拆）。
 *
 * ## 为什么三卡各自独立兜底
 *
 * 三个数据源完全不同（一卡通 Web cookie / 内网明文 http / 图书馆 cookie），
 * 一个挂了不能让另外两张卡跟着消失 —— 每张卡自己 try/catch，各自显示自己的状态。
 *
 * ## 卡片上的趋势只显示「真的变了」
 *
 * 一卡通余额没动时 trendText 会说「今日 无变化 · 近 7 天 无变化」——
 * 占着天天看的一行却什么都没说 ⇒ 卡片用 hasChange 挡一层（Android 同款取舍）。
 * 详情页不受此限（那里「记录中…」是有用的解释）。
 */

import { Context } from '@kit.AbilityKit';
import { router } from '@kit.ArkUI';
import { withAlpha } from '../core/theme/colorUtil.ts';
import { gridTokens } from '../core/theme/GridTokens.ts';
import type { GridTokens } from '../core/theme/GridTokens.ts';
import { STORAGE_DARK, STORAGE_PALETTE, getPalette } from '../data/ThemeStore.ts';
import { SessionSnapshot, SessionStore } from '../data/SessionStore.ts';
import { CampusCardService } from '../service/CampusCardService.ts';
import { CampusCardStore } from '../data/CampusCardStore.ts';
import { CampusNetService } from '../service/CampusNetService.ts';
import { CampusNetTrafficStore } from '../data/CampusNetTrafficStore.ts';
import { LibBorrowService, LibBorrowResult } from '../service/LibBorrowService.ts';
import { CardSnapshot } from '../corelogic/CampusCardLogic.ts';
import { BalanceTrend, emptyTrend, hasChange, trendText } from '../corelogic/CampusCardBalanceLogic.ts';
import { CampusNetResult, LIMIT_BYTES, formatTraffic } from '../corelogic/CampusNetLogic.ts';
import { TrafficTrend, emptyTrafficTrend, todayText } from '../corelogic/CampusNetTrafficLogic.ts';
import { cardSummary } from '../corelogic/LibBorrowLogic.ts';
import type { DateTime } from '../corelogic/timeutil.ts';
import { rowA11y, joinA11y } from '../corelogic/A11yText.ts';
import { info, warn } from '../core/log/BitLog.ts';
import { StudySpotCard } from '../components/me/StudySpotCard.ets';
import { FakeCookieStore } from '../data/FakeCookieStore.ts';
import { CommunityUserService, UserProfileResult } from '../service/CommunityUserService.ts';
import { CommunityService, CommunityListResult } from '../service/CommunityService.ts';
import { CommunityPost, posterSubtitle } from '../corelogic/CommunityLogic.ts';
import {
  CommunityUserProfile, emptyUserProfile, showVerifiedBadge, identityIsMuted, joinedText
} from '../corelogic/CommunityUserLogic.ts';

@Entry
@Component
export struct MePage {
  /** true = 被外壳（底部 tab）嵌入：不渲染返回键（原版这些是 pager 页签，没有页面级返回）。 */
  isEmbedded: boolean = false;

  /**
   * 是否处于可见状态（外壳 Stack 保活时由 Index 传；独立路由页默认 true）。
   * ⚠️ 壳里的子组件**不会触发 onPageShow**（那是 @Entry 页面的钩子）——
   *    之前只挂 onPageShow，导致「我」页 refresh 一次都没跑，永远停在默认值
   *    「未登录 / 一卡通 —」（2026-10-31 真机实锤：登录成功后两分钟仍显示未登录）。
   */
  @Prop @Watch('onWake') active: boolean = true;

  /**
   * 外壳每次重新可见的序号（Index.onPageShow 自增）。
   * 从登录页/详情页回来时 active 没变，只有这个序号会变。
   */
  @Prop @Watch('onWake') epoch: number = 0;

  @StorageLink(STORAGE_DARK) isDark: boolean = false;
  @StorageLink(STORAGE_PALETTE) paletteName: string = 'brand';

  @State studentId: string = '';
  @State loggedIn: boolean = false;
  /** BIT101 社区资料（昵称/签名/身份/粉丝关注/UID）。取不到 = empty，UI 隐藏这些行。 */
  @State userProfile: CommunityUserProfile = emptyUserProfile();
  /** 社区是否已登录（fake-cookie 存在），与学校登录态 loggedIn 是两套，独立判断。 */
  @State communityLoggedIn: boolean = false;
  /** 我的帖子（对齐 Android UserScreen 帖子列表）；null=未加载，空数组=真没有。 */
  @State myPosts: CommunityPost[] = [];
  @State myPostsKind: string = '';  // '' | 'ok' | 'needLogin' | 'failed'

  @State cardSnap: CardSnapshot | null = null;
  @State cardTrend: BalanceTrend = emptyTrend();
  @State netResult: CampusNetResult | null = null;
  @State netTrend: TrafficTrend = emptyTrafficTrend();
  @State libResult: LibBorrowResult | null = null;

  @State busy: boolean = false;

  private p(): GridTokens {
    return gridTokens(this.isDark, getPalette(this.paletteName));
  }

  /** 本地「现在」（展示层 impure 边界：到期文案现算）。 */
  private now(): DateTime {
    const d: Date = new Date();
    const offsetMs: number = d.getTimezoneOffset() * 60000;
    return {
      day: Math.floor((d.getTime() - offsetMs) / 86400000),
      minutes: d.getHours() * 60 + d.getMinutes()
    };
  }

  // ── 一卡通卡 ──

  private cardLine(): string {
    const s: CardSnapshot | null = this.cardSnap;
    // 文案逐字对齐 BIT101-S CampusCardLogic.balanceText
    if (s === null) return '获取中…';
    if (s.failed) return '获取失败，下拉/点刷新重试';
    if (!s.loggedIn) return '未登录，进详情页登录';
    return s.entries.length > 0 ? '¥' + s.entries[0].value : '未识别到余额';
  }

  /** 卡片上的趋势行：**只有真的变了才显示**（见文件头注释）。 */
  private cardTrendLine(): string {
    if (!hasChange(this.cardTrend)) return '';
    const t: string | null = trendText(this.cardTrend);
    return t !== null ? t : '';
  }

  // ── 校园网卡 ──

  private netLine(): string {
    const r: CampusNetResult | null = this.netResult;
    // 文案逐字对齐 BIT101-S UserScreen.kt:679-686（显示余额，不是总量）
    if (r === null) return '获取中…';
    if (r.kind === 'online') {
      return '本月 ' + formatTraffic(r.info.bytesTotal) + ' · 余额 ¥' + r.info.balanceYuan.toFixed(2);
    }
    if (r.kind === 'notOnline') return '本机未认证';
    return '不在校园网';
  }

  private netSubLine(): string {
    const t: string | null = todayText(this.netTrend);
    return t !== null ? '今日 ' + t : '';
  }

  // ── 图书馆卡 ──

  private libLine(): string {
    const r: LibBorrowResult | null = this.libResult;
    if (r === null) return '—';
    if (r.kind === 'loggedOut') return '未登录，点开登录';
    if (r.kind === 'failed') return '取不到（点开重试）';
    return '在借 ' + r.records.length + ' 本';
  }

  private libSubLine(): string {
    const r: LibBorrowResult | null = this.libResult;
    if (r === null || r.kind !== 'ok' || r.records.length === 0) return '';
    return cardSummary(r.records, this.now());
  }

  // ── 加载 ──

  private async loadCard(ctx: Context): Promise<void> {
    try {
      const snap: CardSnapshot = await CampusCardService.fetchSnapshot(ctx);
      this.cardSnap = snap;
      // 只有「已登录 + 解析出金额」才记采样（未登录页上的数字会污染趋势）
      let amount: number | null = null;
      if (snap.loggedIn && !snap.failed && snap.entries.length > 0) {
        const raw: string = snap.entries[0].value.replace(/,/g, '');
        const v: number = Number(raw);
        amount = raw.length > 0 && Number.isFinite(v) ? v : null;
      }
      this.cardTrend = await CampusCardStore.record(amount);
    } catch (e) {
      warn('me card fail: ' + (e as Error).message);
      this.cardSnap = { entries: [], htmlSnippet: '', loggedIn: false, failed: true };
    }
  }

  private async loadNet(ctx: Context): Promise<void> {
    try {
      const r: CampusNetResult = await CampusNetService.fetchOnlineInfo(ctx);
      this.netResult = r;
      const bytes: number | null = r.kind === 'online' ? r.info.bytesTotal : null;
      this.netTrend = await CampusNetTrafficStore.record(bytes);
    } catch (e) {
      warn('me net fail: ' + (e as Error).message);
      this.netResult = { kind: 'failed', reason: (e as Error).message };
    }
  }

  private async loadLib(ctx: Context): Promise<void> {
    try {
      const r: LibBorrowResult = await LibBorrowService.fetchCurrent(ctx);
      this.libResult = r;
    } catch (e) {
      warn('me lib fail: ' + (e as Error).message);
      this.libResult = { kind: 'failed', reason: (e as Error).message };
    }
  }

  /**
   * BIT101 社区资料（对齐 Android UserViewModel id=0）。
   * 只在有 fake-cookie 时发请求——没登录不发无谓 401；取不到一律 empty，UI 隐藏字段不编造。
   */
  private async loadProfile(ctx: Context): Promise<void> {
    try {
      const has: boolean = await FakeCookieStore.has();
      this.communityLoggedIn = has;
      if (!has) {
        this.userProfile = emptyUserProfile();
        this.myPosts = [];
        this.myPostsKind = 'needLogin';
        return;
      }
      // 我的帖子与资料并行取（同一会话，互不阻塞）
      const postsTask: Promise<CommunityListResult> = CommunityService.listMyPosts(ctx, 0);
      const r: UserProfileResult = await CommunityUserService.fetchMe(ctx);
      if (r.kind === 'ok') {
        this.userProfile = r.profile;
      } else if (r.kind === 'needLogin') {
        this.communityLoggedIn = false;
        this.userProfile = emptyUserProfile();
      } else {
        // 失败保留空资料，不覆盖成假数据；下次刷新重试
        this.userProfile = emptyUserProfile();
      }
      const pr: CommunityListResult = await postsTask;
      this.myPostsKind = pr.kind;
      this.myPosts = pr.posts;
      if (pr.kind === 'needLogin') this.communityLoggedIn = false;
    } catch (e) {
      warn('me community profile fail: ' + JSON.stringify(e));
      this.userProfile = emptyUserProfile();
      this.myPostsKind = 'failed';
    }
  }

  private async refresh(): Promise<void> {
    if (this.busy) {
      return;
    }
    this.busy = true;
    try {
      const snap: SessionSnapshot = await SessionStore.snapshot();
      this.studentId = snap.studentId;
      this.loggedIn = snap.hasSchoolCookies;
    } catch (e) {
      warn('me session fail: ' + JSON.stringify(e));
    }
    // 三卡**并行**且各自兜底：一个挂了不影响另外两张
    const ctx: Context = getContext(this) as Context;
    const tasks: Promise<void>[] = [
      this.loadCard(ctx), this.loadNet(ctx), this.loadLib(ctx), this.loadProfile(ctx)
    ];
    await Promise.all(tasks);
    this.busy = false;
    info('me refresh done loggedIn=' + this.loggedIn);
  }

  aboutToAppear(): void {
    // 壳里首次可见时建出来 → 这一次必须拉；不可见时不拉，免得替没打开过的页发请求
    if (this.active) {
      this.refresh();
    }
  }

  /** active / epoch 变化都走这里（切到「我」、从子页回来）。 */
  private onWake(): void {
    if (this.active) {
      this.refresh();
    }
  }

  onPageShow(): void {
    // 独立路由页（isEmbedded=false）走这里；壳里不会触发
    this.refresh();
  }

  build() {
    // ⚠️ build() 根部不声明局部变量（编译器只认根节点起手）
    Column() {
      // ── 顶栏：‹ 返回 + 右侧三图标（刷新/通知/设置）──
      // 原版「我」是底部 tab 页无返回键（ref-03）；鸿蒙是 push 子页，
      // 保留返回；三图标 1:1 原版顶栏。
      Row() {
        if (!this.isEmbedded) {
          Text('‹ 返回')
            .fontSize(14).fontColor(this.p().primary)
            .onClick(() => {
              router.back();
            })
        }
        Blank().layoutWeight(1)
        // 右上三图标 = 原版 ref-03 的 ↻ / 🔔 / ⚙（Material Rounded 矢量，不再用 emoji：emoji
        // 在不同字重下形状不一致，且无法跟随 token 上色）
        Image($rawfile('icons/ic_refresh.svg'))
          .width(19).height(19)
          .fillColor(this.p().onSurfaceVariant)
          .margin({ right: 16 })
          // 纯 Image 无文字：不给可访问名，读屏只会念「图片」
          .accessibilityText('刷新')
          .onClick(() => {
            this.refresh();
          })
        // 成绩入口：对齐 BIT101-S UserScreen 顶栏第 2 颗（Grade 图标 → ScorePage）
        Image($rawfile('icons/ic_school.svg'))
          .width(19).height(19)
          .fillColor(this.p().onSurfaceVariant)
          .margin({ right: 16 })
          .accessibilityText('成绩')
          .onClick(() => {
            router.pushUrl({ url: 'pages/ScorePage' }).catch((e: Error) => {
              warn('me -> score fail: ' + JSON.stringify(e));
            });
          })
        Image($rawfile('icons/ic_bell.svg'))
          .width(19).height(19)
          .fillColor(this.p().onSurfaceVariant)
          .margin({ right: 16 })
          .accessibilityText('消息')
          .onClick(() => {
            router.pushUrl({ url: 'pages/NotifyListPage' }).catch((e: Error) => {
              warn('me -> notify fail: ' + JSON.stringify(e));
            });
          })
        Image($rawfile('icons/ic_settings.svg'))
          .width(19).height(19)
          .fillColor(this.p().onSurfaceVariant)
          .accessibilityText('设置')
          .onClick(() => {
            router.pushUrl({ url: 'pages/SettingsPage' }).catch((e: Error) => {
              warn('me -> settings fail: ' + JSON.stringify(e));
            });
          })
      }
      .width('100%').padding({ left: 12, right: 12, top: 10, bottom: 4 })

      Scroll() {
        Column() {
          // ── 账号区（对齐原版 UserInfoContentForMe：居中、无白卡）──
          // 字段全部来自社区 GET /user/info/0（fake-cookie）；取不到/未登录一律隐藏对应行，
          // 不编造昵称/粉丝数。未登录时保留学号占位 + 登录入口。
          Column() {
            // 头像：原版 78dp 圆形；鸿蒙无网络头像加载器，用品牌鸽占位（与桌面图标同源）
            Stack() {
              Column() {
                Image($r('app.media.foreground'))
                  .width(48).height(48)
                  .objectFit(ImageFit.Contain)
              }
              .width(78).height(78)
              .justifyContent(FlexAlign.Center)
              .backgroundColor(this.p().primaryContainer)
              .borderRadius(39)
              // 认证勾：id!=0 且服务端给了颜色才显示（Android Avatar.kt:79-92）
              if (showVerifiedBadge(this.userProfile)) {
                Text('✓')
                  .fontSize(20).fontWeight(FontWeight.Bold)
                  .fontColor(this.p().onPrimary)
                  .backgroundColor(this.p().primary)
                  .width(28).height(28).borderRadius(14)
                  .textAlign(TextAlign.Center)
                  .position({ x: 56, y: 56 })
              }
            }

            // 昵称：社区昵称优先；取不到回落学号/「已登录」/「未登录」
            Text(this.communityLoggedIn && this.userProfile.nickname.length > 0
              ? this.userProfile.nickname
              : (this.loggedIn ? (this.studentId.length > 0 ? this.studentId : '已登录') : '未登录'))
              .fontSize(18).fontWeight(FontWeight.Bold).fontColor(this.p().onSurface)
              .margin({ top: 10 })

            // 身份称号：紧跟昵称下（id==0 转灰，否则服务端色）
            if (this.communityLoggedIn && this.userProfile.identity.text.length > 0) {
              Text(this.userProfile.identity.text)
                .fontSize(13).fontWeight(FontWeight.Bold)
                .fontColor(identityIsMuted(this.userProfile)
                  ? this.p().textPlaceholder : this.p().primary)
                .margin({ top: 2 })
            }

            // 签名 motto（原版可点击打开链接/帖子，鸿蒙纯文本展示）
            if (this.communityLoggedIn && this.userProfile.motto.length > 0) {
              Text(this.userProfile.motto)
                .fontSize(14).fontColor(this.p().onSurface)
                .textAlign(TextAlign.Center)
                .margin({ top: 6 }).padding({ left: 24, right: 24 })
            }

            // 粉丝 / 关注（原版点击进关注列表；鸿蒙无二级页，纯展示数字）
            if (this.communityLoggedIn &&
                (this.userProfile.followingNum > 0 || this.userProfile.followerNum > 0)) {
              Row() {
                Text(this.userProfile.followingNum.toString())
                  .fontSize(15).fontWeight(FontWeight.Bold).fontColor(this.p().onSurface)
                Text(' 关注').fontSize(12).fontColor(this.p().onSurfaceVariant)
                Text('   ' + this.userProfile.followerNum.toString())
                  .fontSize(15).fontWeight(FontWeight.Bold).fontColor(this.p().onSurface)
                Text(' 粉丝').fontSize(12).fontColor(this.p().onSurfaceVariant)
              }
              .justifyContent(FlexAlign.Center).margin({ top: 6 })
            }

            // UID（全角冒号，对齐原版「UID：xxx」）
            if (this.communityLoggedIn && this.userProfile.id > 0) {
              Text('UID：' + this.userProfile.id.toString())
                .fontSize(13).fontColor(this.p().onSurfaceVariant).margin({ top: 4 })
            }
            // 加入时间
            if (this.communityLoggedIn && joinedText(this.userProfile).length > 0) {
              Text(joinedText(this.userProfile))
                .fontSize(12).fontColor(this.p().textPlaceholder).margin({ top: 2 })
            }

            // 未登录学校账号时给入口（社区登录另在话廊页）
            if (!this.loggedIn) {
              Text('登录后可同步课表与作业')
                .fontSize(12).fontColor(this.p().textPlaceholder).margin({ top: 4 })
              Button('去登录')
                .height(32).fontSize(13).margin({ top: 12 })
                .backgroundColor(this.p().primary).fontColor(this.p().onPrimary)
                .onClick(() => {
                  router.pushUrl({ url: 'pages/LoginPage' }).catch((e: Error) => {
                    warn('me -> login fail: ' + JSON.stringify(e));
                  });
                })
            }
          }
          .width('100%').padding({ top: 12 })
          .alignItems(HorizontalAlign.Center)

          // ── 现在去哪儿自习（ref-03：这张卡在「我」页，不在首页）──
          StudySpotCard()
            .margin({ top: 10 })

          // ── 双卡横排：一卡通 + 校园网（ref-03：secondaryContainer 底双卡）──
          Row() {
            Column() {
              // ⚠️ 不许加 layoutWeight：卡片 Column 的高度由内容决定，layoutWeight 会让它
              // 去抢「剩余高度」，真机上被撑成整屏高的大色块（2026-10-26 实机）。
              Text('一卡通')
                .fontSize(12).fontColor(this.p().onSecondaryContainer)
              Text(this.cardLine())
                .fontSize(20).fontWeight(FontWeight.Medium)
                .fontColor(this.p().onSecondaryContainer).margin({ top: 6 })
              Text(this.cardTrendLine().length > 0 ? this.cardTrendLine() : '点开详情')
                .fontSize(10).fontColor(this.p().onSecondaryContainer)
                .opacity(this.cardTrendLine().length > 0 ? 1 : 0.6)
                .width('100%').margin({ top: 4 })
            }
            .width('48%').padding(12)
            .backgroundColor(this.p().secondaryContainer).borderRadius(12)
            .alignItems(HorizontalAlign.Start)
            .accessibilityText(rowA11y('一卡通', this.cardLine(), '点按查看明细'))
            .onClick(() => {
              router.pushUrl({ url: 'pages/CardPage' }).catch((e: Error) => {
                warn('me -> card fail: ' + JSON.stringify(e));
              });
            })

            Column() {
              Text('校园网')
                .fontSize(12).fontColor(this.p().onSecondaryContainer)
              Text(this.netLine())
                .fontSize(20).fontWeight(FontWeight.Medium)
                .fontColor(this.p().onSecondaryContainer).margin({ top: 6 })
              Text(this.netSubLine().length > 0 ? this.netSubLine() : '点开详情')
                .fontSize(10).fontColor(this.p().onSecondaryContainer)
                .opacity(this.netSubLine().length > 0 ? 1 : 0.6)
                .width('100%').margin({ top: 4 })
            }
            .width('48%').padding(12)
            .backgroundColor(this.p().secondaryContainer).borderRadius(12)
            .alignItems(HorizontalAlign.Start)
            .accessibilityText(rowA11y('校园网',
              joinA11y([this.netLine(), this.netSubLine()]), '点按查看流量'))
            .onClick(() => {
              router.pushUrl({ url: 'pages/NetPage' }).catch((e: Error) => {
                warn('me -> net fail: ' + JSON.stringify(e));
              });
            })
          }
          .width('100%').margin({ top: 10 })
          .alignItems(VerticalAlign.Top)

          // ── 图书馆单卡 ──
          Column() {
            Row() {
              Text('图书馆')
                .fontSize(14).fontColor(this.p().onSurface).layoutWeight(1)
              Text(this.libLine()).fontSize(14).fontColor(this.p().onSurface)
              Text(' ›').fontSize(13).fontColor(this.p().textPlaceholder)
            }
            .width('100%')
            if (this.libSubLine().length > 0) {
              Text(this.libSubLine())
                .fontSize(11).fontColor(this.p().onSurfaceVariant)
                .width('100%').margin({ top: 4 })
            }
          }
          .width('100%').padding(12).margin({ top: 10 })
          .backgroundColor(this.p().surface).borderRadius(12)
          .alignItems(HorizontalAlign.Start)
          .accessibilityText(rowA11y('图书馆借阅',
            joinA11y([this.libLine(), this.libSubLine()]), '点按查看借阅'))
          .onClick(() => {
            router.pushUrl({ url: 'pages/LibBorrowPage' }).catch((e: Error) => {
              warn('me -> lib fail: ' + JSON.stringify(e));
            });
          })

          // ── 我的帖子（对齐 Android UserScreen 帖子列表：PosterCard + 0.5dp 分隔线）──
          Column() {
            Row() {
              Text('我的帖子')
                .fontSize(15).fontWeight(FontWeight.Bold).fontColor(this.p().onSurface)
                .layoutWeight(1)
              if (this.myPostsKind === 'ok' && this.myPosts.length > 0) {
                Text(this.myPosts.length.toString() + ' 条')
                  .fontSize(12).fontColor(this.p().onSurfaceVariant)
              }
            }
            .width('100%')

            if (this.myPostsKind === 'ok' && this.myPosts.length > 0) {
              // 最多展示 5 条（原版无限列表；这里首屏摘要，避免我页过长）
              ForEach(this.myPosts.slice(0, 5), (post: CommunityPost, idx: number) => {
                Column() {
                  if (post.title.length > 0) {
                    Text(post.title)
                      .fontSize(14).fontWeight(FontWeight.Medium).fontColor(this.p().onSurface)
                      .maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis })
                      .width('100%')
                  }
                  Text(post.text.length > 0 ? post.text : posterSubtitle(post))
                    .fontSize(12).fontColor(this.p().onSurfaceVariant)
                    .maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis })
                    .width('100%').margin({ top: 2 })
                  Text(posterSubtitle(post) + ' · ' + post.likeCount.toString() + '赞 · ' +
                    post.commentCount.toString() + '评')
                    .fontSize(11).fontColor(this.p().textPlaceholder)
                    .width('100%').margin({ top: 4 })
                }
                .width('100%').padding({ top: 10, bottom: 10 })
                .alignItems(HorizontalAlign.Start)
                .onClick(() => {
                  router.pushUrl({
                    url: 'pages/WebShellPage',
                    params: { url: 'https://bit101.flwfdd.xyz/posters/' + post.id.toString() }
                  }).catch((e: Error) => {
                    warn('me -> post fail: ' + JSON.stringify(e));
                  });
                })
                if (idx < Math.min(this.myPosts.length, 5) - 1) {
                  Divider().color(withAlpha(this.p().onSurface, 0.08)).strokeWidth(0.5)
                }
              }, (post: CommunityPost) => post.id.toString())
            } else if (this.myPostsKind === 'ok') {
              Text('还没有发帖')
                .fontSize(12).fontColor(this.p().textPlaceholder)
                .width('100%').margin({ top: 10 }).textAlign(TextAlign.Center)
            } else if (this.myPostsKind === 'needLogin') {
              Text('未登录，登录后查看我的帖子')
                .fontSize(12).fontColor(this.p().textPlaceholder)
                .width('100%').margin({ top: 10 }).textAlign(TextAlign.Center)
            } else if (this.myPostsKind === 'failed') {
              Text('我的帖子暂不可用（点顶栏刷新重试）')
                .fontSize(12).fontColor(this.p().textPlaceholder)
                .width('100%').margin({ top: 10 }).textAlign(TextAlign.Center)
            }
          }
          .width('100%').padding(12).margin({ top: 10 })
          .backgroundColor(this.p().surface).borderRadius(12)
          .alignItems(HorizontalAlign.Start)

          // ── 功能入口组已删（对照原版 ref-03：原版没有这组）──
          // 作业/座位 → 底部 tab 已覆盖；通知/设置 → 顶栏 🔔/⚙ 已覆盖；
          // 提醒设置 → 唯一入口先迁到设置页「提醒」组（先安置再拆）。
        }
        .width('100%').padding({ left: 12, right: 12, bottom: 24 })
      }
      .layoutWeight(1)
      // ⚠️ 顶对齐必须挂 Scroll 自身：加在内层 Column 上不生效（内容不足一屏会被垂直居中）
      .align(Alignment.Top)
    }
    .width('100%').height('100%')
    .backgroundColor(this.p().background)
  }
}
