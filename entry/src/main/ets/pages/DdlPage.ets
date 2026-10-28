/**
 * 作业页（#88 UI 迁移：1:1 对齐原版 BIT101 `DDLSchedule` / ref-02-ddl.png）。
 *
 * 结构口径（原版 DDLSchedule.kt + DDLScheduleItem.kt）：
 *  - **分区标题**「未完成 · N」「已完成 · N」（labelLarge + onSurfaceVariant），
 *    单列表滚动（原版不是 tab 切换）；
 *  - 卡片：底/字色按紧急度现算（cardColors：done ⇒ secondaryContainer@0.5；
 *    否则 surfaceVariant→errorContainer 混色），M3 medium 12dp 圆角；
 *    左：标题（titleMedium）+ 课程副文本（bodySmall）+ 倒计时（bodyMedium，remainTime 现算）；
 *    右：勾选框（M3 Checkbox，选中 primary / 未选 outline）。
 *
 * 功能件保留（鸿蒙自有，验收判据 ROADMAP §4 M4-3）：
 *  1. 点卡片 = 勾选/取消切换（done 落库，杀进程回来还在）；
 *  2. 重新同步保留手动完成状态（合并规则在 corelogic/DdlRules.ts，有单测）；
 *  3. 空库且无 eclass 会话 ⇒ 给登录入口，不给空白。
 *
 * 数据来源：DdlStore（同步落库）。本页不发同步以外的请求。
 * ⚠️ 倒计时/卡片色现算不缓存（铁律 0.8）；派生列表走 DdlSortLogic 的 sortPending/sortDone
 * （1:1 Android DdlListOrder，corelogic/DdlListLogic.ts 有单测）。
 */

import { Context } from '@kit.AbilityKit';
import { router } from '@kit.ArkUI';
import { FabColumn, FabAction } from '../components/shell/FabColumn.ets';
import { gridTokens } from '../core/theme/GridTokens.ts';
import type { GridTokens } from '../core/theme/GridTokens.ts';
import { STORAGE_DARK, STORAGE_PALETTE, getPalette } from '../data/ThemeStore.ts';
import { DdlStore } from '../data/DdlStore.ts';
import { DdlSourceStore } from '../data/DdlSourceStore.ts';
import type { DdlSourcePrefs } from '../corelogic/DdlSourceLogic.ts';
import { DEFAULT_DDL_SOURCE, noneEnabled, visibleEntries } from '../corelogic/DdlSourceLogic.ts';
import { EclassSyncService } from '../service/EclassSyncService.ts';
import { EclassService } from '../service/EclassService.ts';
import { DdlEntry } from '../corelogic/DdlRules.ts';
import { remainTime } from '../corelogic/DdlFormat.ts';
import { cardColors } from '../corelogic/DdlListLogic.ts';
import {
  DdlSortMode, DEFAULT_DDL_SORT, parseSortMode, sortPending, sortDone,
  sortLabel, nextSortMode
} from '../corelogic/DdlSortLogic.ts';
import type { DateTime } from '../corelogic/timeutil.ts';
import { isoDate, parseISODate, parseHM } from '../corelogic/timeutil.ts';
import { Prefs } from '../data/Prefs.ts';
import { info, warn } from '../core/log/BitLog.ts';

/** 排序档位的存储键（值就是 DdlSortMode 的字符串）。 */
const KEY_DDL_SORT: string = 'ddl_sort_mode';

@Entry
@Component
export struct DdlPage {
  /** true = 被外壳（底部 tab）嵌入：不渲染返回键（原版这些是 pager 页签，没有页面级返回）。 */
  isEmbedded: boolean = false;

  @StorageLink(STORAGE_DARK) isDark: boolean = false;
  @StorageLink(STORAGE_PALETTE) paletteName: string = 'warm';

  @State entries: DdlEntry[] = [];
  @State status: string = '';
  @State busy: boolean = false;
  /** 有没有 eclass 会话（决定空态给「去登录」还是「去同步」）。 */
  @State hasSession: boolean = false;
  /** 下拉刷新指示器（原版 `PullToRefreshContainer` 的 ArkUI 对应物）。 */
  @State refreshing: boolean = false;
  /** 「＋ 新增」弹层是否打开。 */
  @State addOpen: boolean = false;
  @State dTitle: string = '';
  @State dText: string = '';
  @State dDate: string = '';
  @State dTime: string = '23:59';
  @State addErr: string = '';
  /** M4-5：来源开关（延河课堂 / 本地新增）。 */
  @State srcPrefs: DdlSourcePrefs = DEFAULT_DDL_SOURCE;
  /** 两个开关都关（空列表的原因是「没启用来源」而不是「没作业」，必须分开说）。 */
  @State noSource: boolean = false;
  /** 排序模式（M12-5）：按截止 / 按课程；落 Prefs，下次进来还是上次那档。 */
  @State sortMode: DdlSortMode = DEFAULT_DDL_SORT;

  private tk(): GridTokens {
    return gridTokens(this.isDark, getPalette(this.paletteName));
  }

  /** 本地「现在」（展示层 impure 边界：文案现算）。 */
  private now(): DateTime {
    const d: Date = new Date();
    const offsetMs: number = d.getTimezoneOffset() * 60000;
    return {
      day: Math.floor((d.getTime() - offsetMs) / 86400000),
      minutes: d.getHours() * 60 + d.getMinutes()
    };
  }

  /** 未完成区（M12-5 起按用户选的模式排；默认仍是截止升序）。 */
  private pending(): DdlEntry[] {
    return sortPending(this.entries, this.sortMode);
  }

  /** 已完成区（截止倒序，与排序模式无关：刚划掉那条要留在最上面）。 */
  private done(): DdlEntry[] {
    return sortDone(this.entries);
  }

  /** 切换排序并按新档位重排（不联网、不重读库）。 */
  private toggleSort(): void {
    this.sortMode = nextSortMode(this.sortMode);
    Prefs.putString(KEY_DDL_SORT, String(this.sortMode)).catch((e: Error) => {
      warn('ddl sort save fail: ' + JSON.stringify(e));
    });
    info('ddl sort mode=' + this.sortMode);
  }

  private async reload(): Promise<void> {
    this.hasSession = await EclassService.hasSession();
    // M4-5 来源开关：过滤在展示层做，库里始终保存两源数据（切回来不用重新同步）
    this.srcPrefs = await DdlSourceStore.load();
    this.noSource = noneEnabled(this.srcPrefs);
    // 排序档位（读失败就用默认，不值得为此挡住列表）
    try {
      this.sortMode = parseSortMode(await Prefs.getString(KEY_DDL_SORT, ''));
    } catch (e) {
      this.sortMode = DEFAULT_DDL_SORT;
    }
    const all: DdlEntry[] = await DdlStore.load();
    this.entries = visibleEntries(all, this.srcPrefs);
  }

  /** 勾选/取消（卡片与勾选框共用；同一帧内双触发也幂等——目标值同取自重前的快照）。 */
  private async toggle(entry: DdlEntry): Promise<void> {
    const okDone: boolean = await DdlStore.setDone(entry.uid, !entry.done);
    if (!okDone) {
      this.status = '条目已不存在（可能刚被同步清理）';
      return;
    }
    await this.reload();
    info('ddl toggle ' + entry.uid + ' -> ' + (!entry.done));
  }

  /** 同步（M4-2 的 sync）。会话失效时错误原样上屏。 */
  private async sync(): Promise<void> {
    if (this.busy) {
      return;
    }
    this.busy = true;
    this.status = '正在同步作业…';
    try {
      const ctx: Context = getContext(this) as Context;
      const s = await EclassSyncService.sync(ctx);
      this.status = '同步完成：' + s.courses + ' 门课 / ' + s.items + ' 条作业' +
        '（新 ' + s.added + ' · 更 ' + s.updated + '）';
      await this.reload();
    } catch (e) {
      warn('ddl sync fail: ' + (e as Error).message);
      this.status = '⚠️ ' + (e as Error).message;
    }
    this.busy = false;
    // 下拉刷新的转圈必须收，否则指示器一直停在那儿（原版 PullToRefreshContainer 同理）
    this.refreshing = false;
  }

  /** 卡片底色（现算：done ⇒ secondaryContainer@0.5；否则按紧急度混色）。 */
  private cardBg(e: DdlEntry): string {
    return cardColors(e, this.now(), this.tk()).bg;
  }

  /** 卡片字色（与底色同源的 contentColor 口径）。 */
  private cardFg(e: DdlEntry): string {
    return cardColors(e, this.now(), this.tk()).fg;
  }

  aboutToAppear(): void {
    this.reload();
  }

  /** 今天（epoch day）——新增作业的默认截止日。 */
  private todayEpochDay(): number {
    const d: Date = new Date();
    return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
  }

  /** 打开「＋ 新增」：默认截止 = 今天 23:59（原版新增弹窗的默认口径）。 */
  private openAdd(): void {
    this.dTitle = '';
    this.dText = '';
    this.dDate = isoDate(this.todayEpochDay());
    this.dTime = '23:59';
    this.addErr = '';
    this.addOpen = true;
  }

  /** 保存本地作业：校验 → 落库 → 重载列表。校验失败如实上屏，不静默。 */
  private async saveAdd(): Promise<void> {
    const title: string = this.dTitle.trim();
    if (title.length === 0) {
      this.addErr = '标题不能为空';
      return;
    }
    const day: number | null = parseISODate(this.dDate.trim());
    if (day === null) {
      this.addErr = '日期格式应为 YYYY-MM-DD';
      return;
    }
    const minutes: number | null = parseHM(this.dTime.trim());
    if (minutes === null) {
      this.addErr = '时间格式应为 HH:MM';
      return;
    }
    try {
      await DdlStore.add(title, this.dText.trim(), day, minutes);
      this.addOpen = false;
      await this.reload();
    } catch (e) {
      this.addErr = '保存失败：' + (e as Error).message;
      warn('DdlPage add fail: ' + JSON.stringify(e));
    }
  }

  /** 长按本地条目 → 二次确认后删除（同步来的条目不给删，归教务管）。 */
  private confirmDeleteLocal(e: DdlEntry): void {
    if (!e.uid.startsWith('local_')) {
      return;
    }
    AlertDialog.show({
      title: '删除本地作业',
      message: e.title,
      primaryButton: {
        value: '取消',
        action: () => {
        },
      },
      secondaryButton: {
        value: '删除',
        fontColor: this.tk().error,
        action: () => {
          DdlStore.removeLocal(e.uid).then(() => {
            this.reload();
          });
        },
      },
    });
  }

  /**
   * 右下角悬浮按钮（原版 PageFab 规格）：**＋ 新增 / 学士帽 / ⚙** 三颗，与 ref-02 一致。
   * 学士帽 = 作业平台（延河课堂），用 App 内 Web 壳打开，带登录会话。
   */
  private fabActions(): FabAction[] {
    const list: FabAction[] = [
      {
        icon: 'ic_add.svg',
        label: '新增作业',
        onTap: () => {
          this.openAdd();
        },
      },
      {
        icon: 'ic_school.svg',
        label: '作业平台',
        onTap: () => {
          router.pushUrl({
            url: 'pages/WebShellPage',
            params: { url: 'https://zy-eclass.bit.edu.cn/' },
          }).catch((e: Error) => {
            warn('open eclass web fail: ' + JSON.stringify(e));
          });
        },
      },
      {
        icon: 'ic_settings.svg',
        label: '设置',
        onTap: () => {
          router.pushUrl({ url: 'pages/SettingsPage' }).catch((e: Error) => {
            warn('open settings fail: ' + JSON.stringify(e));
          });
        },
      },
    ];
    return list;
  }

  build() {
    Stack({ alignContent: Alignment.BottomEnd }) {
    // ⚠️ 不在 build() 根部声明任何局部变量：本编译器的 UI 描述只认「根节点起手」
    // （2026-10-21 编译失败两次，错误位置钉在声明行上）。派生列表走取值方法。
    Column() {
      // ── 顶栏 ──
      // ⚠️ 原版 ref-02 **没有页头**（页签即页头）：既没有「作业」标题，也没有「同步」按钮
      //    （同步靠下拉刷新）。只有作为独立路由页打开时（`isEmbedded === false`）才需要
      //    返回按钮，那时才渲染整行 —— 外壳里多这一行就是「最像另一个 App」的地方。
      if (!this.isEmbedded) {
        Row() {
          Button('‹ 返回')
            .height(32).fontSize(12)
            .backgroundColor(Color.Transparent)
            .fontColor(this.tk().primary)
            .onClick(() => {
              router.back();
            })
          Text('作业')
            .fontSize(16).fontWeight(FontWeight.Bold).fontColor(this.tk().onSurface)
            .layoutWeight(1).margin({ left: 10 })
            .textAlign(TextAlign.Start)
          Button('同步')
            .height(32).fontSize(12)
            .backgroundColor(Color.Transparent)
            .fontColor(this.tk().primary)
            .enabled(!this.busy)
            .onClick(() => {
              this.sync();
            })
        }
        .width('100%').padding({ left: 12, right: 12, top: 10, bottom: 6 })
      }

      if (this.status.length > 0) {
        Text(this.status)
          .fontSize(11).fontColor(this.tk().onSurfaceVariant)
          .width('100%').padding({ left: 12, right: 12, top: 2 })
      }

      // ── 列表（分区结构，1:1 ref-02） ──
      // 下拉刷新 = 原版 `PullToRefreshContainer`（去掉页头后「同步」的唯一入口，不能再丢）
      Refresh({ refreshing: this.refreshing }) {
      Scroll() {
        Column() {
          if (this.entries.length === 0) {
            // 空态分两种：没会话（引导登录）vs 有会话没数据（引导同步）。
            // 视觉对齐原版空态（secondaryContainer 卡），功能保持鸿蒙两分支。
            Column() {
              Text(this.noSource
                ? '没有启用任何作业来源。去「设置 → 作业来源」打开延河课堂或本地新增。'
                : (this.hasSession
                  ? '没有作业数据。点右上角「同步」从延河课堂拉取。'
                  : '还没有作业数据。先在延河课堂登录，再同步。'))
                .fontSize(12).fontColor(this.tk().onSecondaryContainer)
                .width('100%').textAlign(TextAlign.Center)
              if (this.noSource) {
                Button('去设置')
                  .fontSize(13).margin({ top: 8 })
                  .backgroundColor(this.tk().primary).fontColor(this.tk().onPrimary)
                  .onClick(() => {
                    router.pushUrl({ url: 'pages/SettingsPage' }).catch((e: Error) => {
                      warn('ddl -> settings fail: ' + JSON.stringify(e));
                    });
                  })
              } else if (!this.hasSession) {
                Button('去延河课堂登录')
                  .fontSize(13).margin({ top: 8 })
                  .backgroundColor(this.tk().primary).fontColor(this.tk().onPrimary)
                  .onClick(() => {
                    router.pushUrl({ url: 'pages/EclassLoginPage' }).catch((e: Error) => {
                      warn('ddl -> eclass login fail: ' + JSON.stringify(e));
                    });
                  })
              }
            }
            .width('100%').padding(16).margin({ top: 8 })
            .backgroundColor(this.tk().secondaryContainer).borderRadius(12)
          } else {
            // 未完成区（原版：分区标题 + 条目；排序按用户选的档位）
            if (this.pending().length > 0) {
              Row() {
                Text('未完成 · ' + this.pending().length)
                  .fontSize(14).fontWeight(FontWeight.Medium)
                  .fontColor(this.tk().onSurfaceVariant)
                  .layoutWeight(1).textAlign(TextAlign.Start)
                Text(sortLabel(this.sortMode))
                  .fontSize(11).fontColor(this.tk().onSurfaceVariant)
                  .backgroundColor(this.tk().surface2).borderRadius(10)
                  .padding({ left: 9, right: 9, top: 3, bottom: 3 })
                  .accessibilityText('排序方式，' + sortLabel(this.sortMode) +
                    '，点按改为' + sortLabel(nextSortMode(this.sortMode)))
                  .onClick(() => {
                    this.toggleSort();
                  })
              }
              .width('100%').padding({ top: 0, bottom: 2 })
              ForEach(this.pending(), (e: DdlEntry) => {
                this.ddlCard(e)
              }, (e: DdlEntry) => e.uid)
            }
            // 已完成区（原版：分区标题 + 截止倒序条目）
            if (this.done().length > 0) {
              this.sectionTitle('已完成 · ' + this.done().length, this.pending().length > 0 ? 8 : 0)
              ForEach(this.done(), (e: DdlEntry) => {
                this.ddlCard(e)
              }, (e: DdlEntry) => e.uid)
            }
          }
        }
        .width('100%').padding({ left: 12, right: 12 })
      }
      .width('100%').height('100%')
      // ⚠️ 顶对齐必须挂 Scroll 自身：加在内层 Column 上不生效（内容不足一屏会被垂直居中）
      .align(Alignment.Top)
      }
      // ⚠️ onRefreshing 必须排在 layoutWeight 前面：`test-uiconventions` 规则 1 用
      //    「.align(Top) → } → .layoutWeight(1)」这个形状判「align 挂错层」，反过来写会被误判。
      .onRefreshing(() => {
        this.refreshing = true;
        this.sync();
      })
      .layoutWeight(1)
    }
    .width('100%').height('100%')
    .backgroundColor(this.tk().background)

      // 原版 DDL 是 3 颗（+ / 学士帽 / ⚙），现在齐了
      FabColumn({ actions: this.fabActions() })

      // 「＋ 新增」弹层（内联遮罩 + 卡片）
      if (this.addOpen) {
        this.addDialog()
      }
    }
    .width('100%').height('100%')
  }

  /** 分区标题（1:1 DdlSectionTitle：labelLarge + onSurfaceVariant）。 */
  /**
   * 「＋ 新增」弹层（内联，不引 CustomDialog：本页只有一个弹层，Stack 里铺一层足够）。
   * 字段：标题（必填）/ 说明（可选）/ 截止日期 / 截止时间；校验失败在弹层内红字提示。
   */
  @Builder
  addDialog() {
    Column() {
      Column() {
        Text('新增作业')
          .fontSize(16).fontWeight(FontWeight.Bold).fontColor(this.tk().onSurface)
          .width('100%')

        TextInput({ placeholder: '标题（必填）', text: this.dTitle })
          .fontSize(14).fontColor(this.tk().onSurface)
          .backgroundColor(this.tk().background)
          .margin({ top: 12 })
          .onChange((v: string) => {
            this.dTitle = v;
          })

        TextInput({ placeholder: '课程 / 说明（可选）', text: this.dText })
          .fontSize(14).fontColor(this.tk().onSurface)
          .backgroundColor(this.tk().background)
          .margin({ top: 8 })
          .onChange((v: string) => {
            this.dText = v;
          })

        Row() {
          TextInput({ placeholder: 'YYYY-MM-DD', text: this.dDate })
            .fontSize(14).fontColor(this.tk().onSurface)
            .backgroundColor(this.tk().background)
            .layoutWeight(1)
            .onChange((v: string) => {
              this.dDate = v;
            })
          TextInput({ placeholder: 'HH:MM', text: this.dTime })
            .fontSize(14).fontColor(this.tk().onSurface)
            .backgroundColor(this.tk().background)
            .width(96).margin({ left: 8 })
            .onChange((v: string) => {
              this.dTime = v;
            })
        }
        .width('100%').margin({ top: 8 })

        if (this.addErr.length > 0) {
          Text(this.addErr)
            .fontSize(11).fontColor(this.tk().error)
            .width('100%').margin({ top: 8 })
        }

        Row() {
          Button('取消')
            .height(34).fontSize(13)
            .backgroundColor(this.tk().surface2)
            .fontColor(this.tk().onSurfaceVariant)
            .layoutWeight(1)
            .onClick(() => {
              this.addOpen = false;
            })
          Button('保存')
            .height(34).fontSize(13)
            .backgroundColor(this.tk().primary)
            .fontColor(this.tk().onPrimary)
            .layoutWeight(1).margin({ left: 10 })
            .onClick(() => {
              this.saveAdd();
            })
        }
        .width('100%').margin({ top: 14 })
      }
      .width('88%')
      .padding(16)
      .backgroundColor(this.tk().surface)
      .borderRadius(16)
      .alignItems(HorizontalAlign.Start)
    }
    .width('100%').height('100%')
    .backgroundColor('#66000000')
    .justifyContent(FlexAlign.Center)
  }

  @Builder
  sectionTitle(text: string, topMargin: number) {
    Text(text)
      .fontSize(14).fontWeight(FontWeight.Medium)
      .fontColor(this.tk().onSurfaceVariant)
      .width('100%').textAlign(TextAlign.Start)
      .padding({ top: topMargin, bottom: 2 })
  }

  /**
   * DDL 条目卡（1:1 DDLScheduleItem）：
   *  Row 内边距 15/15/5/15；左列 = 标题 + 副文本 + 倒计时（均 1 行截断）；
   *  右端 M3 勾选框。点卡片 = 勾选/取消（鸿蒙 M4-3 判据 1）。
   */
  @Builder
  ddlCard(e: DdlEntry) {
    Row() {
      Column() {
        Text(e.title)
          .fontSize(16).fontWeight(FontWeight.Medium)
          .fontColor(this.cardFg(e))
          .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
          .width('100%')
        Text(e.text)
          .fontSize(12)
          .fontColor(this.cardFg(e))
          .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
          .width('100%')
        Text(remainTime({ day: e.day, minutes: e.minutes }, this.now()))
          .fontSize(14)
          .fontColor(this.cardFg(e))
          .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
          .width('100%').margin({ top: 5 })
      }
      .layoutWeight(1)

      // 本地新增的条目给一个删除入口（教务同步来的不给删，归教务管）
      if (e.uid.startsWith('local_')) {
        Text('删')
          .fontSize(11).fontColor(this.tk().textPlaceholder)
          .padding({ left: 8, right: 6 })
          .onClick(() => {
            this.confirmDeleteLocal(e);
          })
      }

      Checkbox()
        .select(e.done)
        .selectedColor(this.tk().primary)
        .unselectedColor(this.tk().outline)
        .onChange(() => {
          this.toggle(e);
        })
    }
    .width('100%')
    .padding({ left: 15, right: 5, top: 15, bottom: 15 })
    .margin({ top: 5, bottom: 5 })
    .backgroundColor(this.cardBg(e))
    .borderRadius(12)
    .alignItems(VerticalAlign.Center)
    // 无障碍：说清「哪门作业、什么时候交、完成没」，读屏只念标题等于没状态
    .accessibilityText(e.title + '，' + remainTime({ day: e.day, minutes: e.minutes }, this.now()) +
      (e.done ? '，已完成' : '，未完成') + '，双击切换完成状态')
    .onClick(() => {
      this.toggle(e);
    })
  }
}
