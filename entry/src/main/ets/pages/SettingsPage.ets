/**
 * 设置页（M6-1 框架 / M6-3 深浅色 / M6-4 账号与登出 / M6-5 默认校区）
 *
 * 一个页面承载四件事，因为它们都是「低频、分组明确、进来改完就走」的设置项。
 * 分成四个页面反而要多点两下。
 *
 * ## 深色怎么生效
 * 本页改的是 `ThemeStore`，它往 `AppStorage` 广播 `ui_dark`；
 * 其它页面用 `@StorageLink('ui_dark')` 订阅 + 从 `palette()` 取色。
 * 颜色值本身在 `core/theme/AppColors.ts`，对比度由 `tools/test-colors.mjs` 钉住。
 *
 * ## 登出的边界（重要）
 * 只清 **cookie + JWT**，**不清课表缓存**。
 * 理由是用户登出后仍应能离线看课表（那是他已经看到的公开数据），
 * 而「无 cookie 但有缓存」正好是自习卡 nologin 降级态的真实场景。
 */

import { router } from '@kit.ArkUI';
import { Context } from '@kit.AbilityKit';
import { bundleManager } from '@kit.AbilityKit';
import { palette, Palette } from '../core/theme/AppColors.ts';
import { ThemeStore, STORAGE_DARK, MODE_AUTO, MODE_LIGHT, MODE_DARK } from '../data/ThemeStore.ts';
import { SessionStore } from '../data/SessionStore.ts';
import { SchoolCookieStore } from '../data/SchoolCookieStore.ts';
import { EclassCookieStore } from '../data/EclassCookieStore.ts';
import { LibCookieStore } from '../data/LibCookieStore.ts';
import { CardCookieStore } from '../data/CardCookieStore.ts';
import { CampusCardStore } from '../data/CampusCardStore.ts';
import { CampusNetTrafficStore } from '../data/CampusNetTrafficStore.ts';
import { Prefs } from '../data/Prefs.ts';
import { SchoolService } from '../service/SchoolService.ts';
import { CampusInfo } from '../core/model/SchoolModels.ts';
import { info, warn } from '../core/log/BitLog.ts';
import { JxzxProbe } from '../service/JxzxProbe.ts';
import { TimeTableStore } from '../data/TimeTableStore.ts';

/** 默认校区偏好的持久化键（ClassroomPage 也读这个）。 */
export const KEY_DEFAULT_CAMPUS: string = 'default_campus_code';
export const KEY_DEFAULT_CAMPUS_NAME: string = 'default_campus_name';

@Entry
@Component
struct SettingsPage {
  /** 订阅全局深浅色：设置页自己也要立刻跟着变（用户就在这页点）。 */
  @StorageLink(STORAGE_DARK) isDark: boolean = false;

  @State mode: string = MODE_AUTO;
  @State studentId: string = '';
  @State loggedIn: boolean = false;
  @State campusName: string = '';
  @State campusCode: string = '';
  @State campusList: CampusInfo[] = [];
  @State pickerOpen: boolean = false;
  @State busy: boolean = false;
  @State toast: string = '';
  @State versionText: string = '';
  /** 开发者选项：默认收起。M1/M2 的验证件收在这里，不占正式界面。 */
  @State devOpen: boolean = false;
  @State diagText: string = '';
  /** 作息是否为自定义（从 TimeTableStore 读）。 */
  @State ttCustom: boolean = false;

  private p(): Palette {
    return palette(this.isDark);
  }

  aboutToAppear(): void {
    this.refresh();
    this.loadVersion();
  }

  private async refresh(): Promise<void> {
    this.mode = ThemeStore.mode();
    try {
      const snap = await SessionStore.snapshot();
      this.studentId = snap.studentId;
      this.loggedIn = snap.hasSchoolCookies;
    } catch (e) {
      warn('Settings refresh fail: ' + JSON.stringify(e));
    }
    try {
      this.ttCustom = await TimeTableStore.isCustom();
    } catch (e) {
      this.ttCustom = false;
    }
    try {
      this.campusCode = await Prefs.getString(KEY_DEFAULT_CAMPUS, '');
      this.campusName = await Prefs.getString(KEY_DEFAULT_CAMPUS_NAME, '');
    } catch (e) {
      warn('Settings read campus fail: ' + JSON.stringify(e));
    }
  }

  private loadVersion(): void {
    try {
      const bi = bundleManager.getBundleInfoForSelfSync(
        bundleManager.BundleFlag.GET_BUNDLE_INFO_DEFAULT);
      this.versionText = bi.versionName + ' (' + bi.versionCode + ')';
    } catch (e) {
      this.versionText = '取不到版本号';
    }
  }

  /** 学号打码：只露头 4 位尾巴 2 位。设置页是会被别人瞄一眼的页面。 */
  private maskedId(): string {
    const s: string = this.studentId;
    if (s.length <= 6) {
      return s.length > 0 ? s : '未登录';
    }
    return s.substring(0, 4) + '****' + s.substring(s.length - 2);
  }

  private async changeMode(m: string): Promise<void> {
    const ctx: Context = getContext(this) as Context;
    await ThemeStore.setMode(ctx, m);
    this.mode = m;
    info('Settings mode -> ' + m);
  }

  private async loadCampuses(): Promise<void> {
    if (!this.loggedIn) {
      this.toast = '登录后才能设置默认校区';
      return;
    }
    if (this.campusList.length > 0) {
      this.pickerOpen = true;
      return;
    }
    this.busy = true;
    try {
      const ctx: Context = getContext(this) as Context;
      const list: CampusInfo[] = await SchoolService.getCampuses(ctx);
      this.campusList = list;
      this.pickerOpen = true;
      if (list.length === 0) {
        this.toast = '教务没有返回校区列表';
        this.pickerOpen = false;
      }
    } catch (e) {
      this.toast = '取校区失败：' + (e as Error).message;
      warn('Settings loadCampuses fail: ' + JSON.stringify(e));
    }
    this.busy = false;
  }

  private async pickCampus(c: CampusInfo): Promise<void> {
    this.campusCode = c.code;
    this.campusName = c.displayName;
    this.pickerOpen = false;
    try {
      await Prefs.putString(KEY_DEFAULT_CAMPUS, c.code);
      await Prefs.putString(KEY_DEFAULT_CAMPUS_NAME, c.displayName);
      this.toast = '默认校区已设为 ' + c.displayName;
    } catch (e) {
      this.toast = '保存失败：' + (e as Error).message;
    }
  }

  /**
   * 恢复默认（清掉偏好，回到「未设置 = 良乡」）。
   * ⚠️ 没有这个入口时，设过默认校区的用户永远改不回来——M6-5 真机点验时
   * 发现该缺口后补上（2026-10-21，证据 harmony/evidence/m6-5-default-campus/）。
   */
  private async resetCampus(): Promise<void> {
    this.campusCode = '';
    this.campusName = '';
    this.pickerOpen = false;
    try {
      await Prefs.remove(KEY_DEFAULT_CAMPUS);
      await Prefs.remove(KEY_DEFAULT_CAMPUS_NAME);
      this.toast = '已恢复默认（良乡）';
      info('Settings campus reset to default');
    } catch (e) {
      this.toast = '恢复失败：' + (e as Error).message;
      warn('Settings resetCampus fail: ' + JSON.stringify(e));
    }
  }

  /** 教务接口诊断（403 变体矩阵），结果写沙箱文件 jxzx_probe.txt。 */
  private async runDiag(): Promise<void> {
    this.busy = true;
    this.diagText = '诊断中…';
    try {
      const ctx: Context = getContext(this) as Context;
      const report: string = await JxzxProbe.run(ctx);
      this.diagText = report.length > 400
        ? '完成，完整结果见沙箱 jxzx_probe.txt；下方为前 400 字。'
          + report.substring(0, 400) + '…'
        : report;
    } catch (e) {
      this.diagText = '失败：' + JSON.stringify(e);
    }
    this.busy = false;
  }

  private async doLogout(): Promise<void> {
    this.busy = true;
    try {
      // 只清会话，保留课表缓存（登出后仍可离线看课表）
      await SessionStore.clear();
      await SchoolCookieStore.clear();
      // eclass 会话三处都清（Prefs + rcp 罐 + Web 组件存储）——
      // 不清 Web 存储的话下次 syncFromWeb 会把旧会话同步回来
      await EclassCookieStore.clear();
      // 图书馆会话同款三处（Prefs + rcp 罐 + Web 组件存储）
      await LibCookieStore.clear();
      // 一卡通会话同款三处 + 余额趋势历史（换账号不串趋势）
      await CardCookieStore.clear();
      await CampusCardStore.clear();
      // 校园网流量历史（同样换账号不串趋势）
      await CampusNetTrafficStore.clear();
      this.loggedIn = false;
      this.studentId = '';
      this.campusList = [];
      this.toast = '已退出登录（课表缓存保留，仍可离线查看）';
      info('Settings logout done (course cache kept)');
    } catch (e) {
      this.toast = '退出失败：' + (e as Error).message;
      warn('Settings logout fail: ' + JSON.stringify(e));
    }
    this.busy = false;
  }

  // ── UI 片段 ──

  @Builder
  groupTitle(text: string) {
    Text(text)
      .fontSize(11)
      .fontColor(this.p().textMuted)
      .width('100%')
      .padding({ left: 4, top: 18, bottom: 6 })
  }

  @Builder
  modeChip(label: string, value: string) {
    Text(label)
      .fontSize(13)
      .fontColor(this.mode === value ? this.p().textOnAccent : this.p().textSecondary)
      .backgroundColor(this.mode === value ? this.p().accent : this.p().bgPage)
      .borderRadius(14)
      .padding({ left: 14, right: 14, top: 6, bottom: 6 })
      .margin({ right: 8 })
      .onClick(() => {
        this.changeMode(value);
      })
  }

  build() {
    Column() {
      // 顶部
      Row() {
        Text('‹ 返回')
          .fontSize(14).fontColor(this.p().accent)
          .onClick(() => {
            router.back();
          })
        Text('设置')
          .fontSize(16).fontWeight(FontWeight.Bold)
          .fontColor(this.p().textPrimary)
          .layoutWeight(1).textAlign(TextAlign.Center)
        Text('    ').fontSize(14)
      }
      .width('100%')
      .padding({ left: 12, right: 12, top: 10, bottom: 4 })

      Scroll() {
        Column() {
          // ── 外观 ──
          this.groupTitle('外观')
          Column() {
            Row() {
              Text('深浅色')
                .fontSize(14).fontColor(this.p().textPrimary).layoutWeight(1)
              Text(this.mode === MODE_AUTO ? '跟随系统' : (this.mode === MODE_DARK ? '深色' : '浅色'))
                .fontSize(12).fontColor(this.p().textMuted)
            }
            .width('100%').padding({ bottom: 10 })

            Row() {
              this.modeChip('跟随系统', MODE_AUTO)
              this.modeChip('浅色', MODE_LIGHT)
              this.modeChip('深色', MODE_DARK)
            }
            .width('100%')
          }
          .width('100%').padding(12)
          .backgroundColor(this.p().bgCard)
          .borderRadius(10)

          // ── 账号 ──
          this.groupTitle('账号')
          Column() {
            Row() {
              Text('学号')
                .fontSize(14).fontColor(this.p().textPrimary).layoutWeight(1)
              Text(this.maskedId())
                .fontSize(13).fontColor(this.p().textSecondary)
            }
            .width('100%').padding({ bottom: 8 })

            Row() {
              Text('状态')
                .fontSize(14).fontColor(this.p().textPrimary).layoutWeight(1)
              Text(this.loggedIn ? '已登录' : '未登录')
                .fontSize(13)
                .fontColor(this.loggedIn ? this.p().textSecondary : this.p().warn)
            }
            .width('100%').padding({ bottom: 10 })

            if (this.loggedIn) {
              Button('退出登录')
                .fontSize(13).height(34)
                .width('100%')
                .backgroundColor(this.p().bgSubtle)
                .fontColor(this.p().error)
                .enabled(!this.busy)
                .onClick(() => {
                  this.doLogout();
                })
            } else {
              Button('去登录')
                .fontSize(13).height(34)
                .width('100%')
                .enabled(!this.busy)
                .onClick(() => {
                  router.pushUrl({ url: 'pages/LoginPage' }).catch((e: Error) => {
                    this.toast = '跳转失败：' + JSON.stringify(e);
                  });
                })
            }
          }
          .width('100%').padding(12)
          .backgroundColor(this.p().bgCard)
          .borderRadius(10)

          // ── 查找 ──
          this.groupTitle('查找')
          Column() {
            Row() {
              Text('作息时间')
                .fontSize(14).fontColor(this.p().textPrimary).layoutWeight(1)
              Text(this.ttCustom ? '自定义' : '学校官方')
                .fontSize(13).fontColor(this.p().textMuted)
              Text(' ›').fontSize(13).fontColor(this.p().textMuted)
            }
            .width('100%').padding({ bottom: 10 })
            .onClick(() => {
              router.pushUrl({ url: 'pages/TimeTablePage' }).catch((e: Error) => {
                this.toast = '跳转失败：' + JSON.stringify(e);
              });
            })

            Row() {
              Text('手动改课表')
                .fontSize(14).fontColor(this.p().textPrimary).layoutWeight(1)
              Text('改 / 藏 / 新增').fontSize(13).fontColor(this.p().textMuted)
              Text(' ›').fontSize(13).fontColor(this.p().textMuted)
            }
            .width('100%').padding({ bottom: 10 })
            .onClick(() => {
              router.pushUrl({ url: 'pages/OverlayPage' }).catch((e: Error) => {
                this.toast = '跳转失败：' + JSON.stringify(e);
              });
            })

            Row() {
              Text('作业（DDL）')
                .fontSize(14).fontColor(this.p().textPrimary).layoutWeight(1)
              Text('延河课堂').fontSize(13).fontColor(this.p().textMuted)
              Text(' ›').fontSize(13).fontColor(this.p().textMuted)
            }
            .width('100%').padding({ bottom: 10 })
            .onClick(() => {
              router.pushUrl({ url: 'pages/DdlPage' }).catch((e: Error) => {
                this.toast = '跳转失败：' + JSON.stringify(e);
              });
            })

            Row() {
              Text('课程动态')
                .fontSize(14).fontColor(this.p().textPrimary).layoutWeight(1)
              Text('延河课堂').fontSize(13).fontColor(this.p().textMuted)
              Text(' ›').fontSize(13).fontColor(this.p().textMuted)
            }
            .width('100%')
            .onClick(() => {
              router.pushUrl({ url: 'pages/EclassActivityPage' }).catch((e: Error) => {
                this.toast = '跳转失败：' + JSON.stringify(e);
              });
            })

            Row() {
              Text('图书馆借阅')
                .fontSize(14).fontColor(this.p().textPrimary).layoutWeight(1)
              Text('我的借阅').fontSize(13).fontColor(this.p().textMuted)
              Text(' ›').fontSize(13).fontColor(this.p().textMuted)
            }
            .width('100%').padding({ top: 10 })
            .onClick(() => {
              router.pushUrl({ url: 'pages/LibBorrowPage' }).catch((e: Error) => {
                this.toast = '跳转失败：' + JSON.stringify(e);
              });
            })

            Row() {
              Text('一卡通')
                .fontSize(14).fontColor(this.p().textPrimary).layoutWeight(1)
              Text('余额与趋势').fontSize(13).fontColor(this.p().textMuted)
              Text(' ›').fontSize(13).fontColor(this.p().textMuted)
            }
            .width('100%').padding({ top: 10 })
            .onClick(() => {
              router.pushUrl({ url: 'pages/CardPage' }).catch((e: Error) => {
                this.toast = '跳转失败：' + JSON.stringify(e);
              });
            })

            Row() {
              Text('校园网')
                .fontSize(14).fontColor(this.p().textPrimary).layoutWeight(1)
              Text('流量与余额').fontSize(13).fontColor(this.p().textMuted)
              Text(' ›').fontSize(13).fontColor(this.p().textMuted)
            }
            .width('100%').padding({ top: 10 })
            .onClick(() => {
              router.pushUrl({ url: 'pages/NetPage' }).catch((e: Error) => {
                this.toast = '跳转失败：' + JSON.stringify(e);
              });
            })
          }
          .width('100%').padding(12)
          .backgroundColor(this.p().bgCard)
          .borderRadius(10)

          this.groupTitle('空教室')
          Column() {
            Row() {
              Text('空教室默认校区')
                .fontSize(14).fontColor(this.p().textPrimary).layoutWeight(1)
              Text(this.campusName.length > 0 ? this.campusName : '未设置（默认良乡）')
                .fontSize(13).fontColor(this.p().textMuted)
              Text(' ›')
                .fontSize(13).fontColor(this.p().textMuted)
            }
            .width('100%')
            .onClick(() => {
              this.loadCampuses();
            })

            // 校区选择面板（内联，避免多引一个弹层组件）
            if (this.pickerOpen) {
              Column() {
                // 恢复默认（设过才显示；没设过时「未设置」即默认，无需恢复）
                if (this.campusCode.length > 0) {
                  Row() {
                    Text('恢复默认（良乡）')
                      .fontSize(13)
                      .fontColor(this.p().textMuted)
                      .layoutWeight(1)
                  }
                  .width('100%')
                  .padding({ top: 8, bottom: 8 })
                  .border({ width: { bottom: 0.5 }, color: this.p().divider })
                  .onClick(() => {
                    this.resetCampus();
                  })
                }
                ForEach(this.campusList, (c: CampusInfo) => {
                  Row() {
                    Text(c.displayName)
                      .fontSize(13)
                      .fontColor(c.code === this.campusCode ? this.p().accent : this.p().textPrimary)
                      .layoutWeight(1)
                    if (c.code === this.campusCode) {
                      Text('✓').fontSize(13).fontColor(this.p().accent)
                    }
                  }
                  .width('100%')
                  .padding({ top: 8, bottom: 8 })
                  .border({ width: { bottom: 0.5 }, color: this.p().divider })
                  .onClick(() => {
                    this.pickCampus(c);
                  })
                }, (c: CampusInfo) => 'c_' + c.code)
              }
              .width('100%')
              .margin({ top: 8 })
            }
          }
          .width('100%').padding(12)
          .backgroundColor(this.p().bgCard)
          .borderRadius(10)

          // ── 关于 ──
          this.groupTitle('关于')
          Column() {
            Row() {
              Text('版本').fontSize(14).fontColor(this.p().textPrimary).layoutWeight(1)
              Text(this.versionText).fontSize(13).fontColor(this.p().textSecondary)
            }
            .width('100%').padding({ bottom: 8 })

            Row() {
              Text('项目主页').fontSize(14).fontColor(this.p().textPrimary).layoutWeight(1)
              Text('github.com/Star2121-1/BIT101-Harmony')
                .fontSize(11).fontColor(this.p().textMuted)
            }
            .width('100%').padding({ bottom: 8 })

            Text('非官方客户端，与学校无关。学号密码只在登录请求里用一次，不保存。')
              .fontSize(11).fontColor(this.p().textMuted)
              .width('100%')
          }
          .width('100%').padding(12)
          .backgroundColor(this.p().bgCard)
          .borderRadius(10)

          // ── 开发者选项（默认收起）──
          Row() {
            Text('开发者选项')
              .fontSize(11).fontColor(this.p().textMuted).layoutWeight(1)
            Text(this.devOpen ? '收起' : '展开')
              .fontSize(11).fontColor(this.p().accent)
          }
          .width('100%')
          .padding({ left: 4, top: 18, bottom: 6 })
          .onClick(() => {
            this.devOpen = !this.devOpen;
          })

          if (this.devOpen) {
            Column() {
              Text('M1/M2 的验证件。日常用不到，排查接口问题时才打开。')
                .fontSize(11).fontColor(this.p().textMuted).width('100%')

              Row() {
                Text('教务接口诊断（403 变体矩阵）')
                  .fontSize(13).fontColor(this.p().textPrimary).layoutWeight(1)
                Button('跑一遍')
                  .height(28).fontSize(11)
                  .enabled(!this.busy)
                  .onClick(() => {
                    this.runDiag();
                  })
              }
              .width('100%').margin({ top: 10 })

              Row() {
                Text('R1 风险闸（CAS 页 Web 组件探测）')
                  .fontSize(13).fontColor(this.p().textPrimary).layoutWeight(1)
                Button('打开')
                  .height(28).fontSize(11)
                  .onClick(() => {
                    router.pushUrl({ url: 'pages/CasLoginProbe' }).catch((e: Error) => {
                      this.toast = '跳转失败：' + JSON.stringify(e);
                    });
                  })
              }
              .width('100%').margin({ top: 8 })

              Row() {
                Text('延河课堂登录（M4-1：Web 登录 → 抽 cookie → 验接口）')
                  .fontSize(13).fontColor(this.p().textPrimary).layoutWeight(1)
                Button('打开')
                  .height(28).fontSize(11)
                  .onClick(() => {
                    router.pushUrl({ url: 'pages/EclassLoginPage' }).catch((e: Error) => {
                      this.toast = '跳转失败：' + JSON.stringify(e);
                    });
                  })
              }
              .width('100%').margin({ top: 8 })

              Row() {
                Text('裸协议探针（阶段A：rcp + AES 自证）')
                  .fontSize(13).fontColor(this.p().textPrimary).layoutWeight(1)
                Button('打开')
                  .height(28).fontSize(11)
                  .onClick(() => {
                    router.pushUrl({ url: 'pages/CasProbePage' }).catch((e: Error) => {
                      this.toast = '跳转失败：' + JSON.stringify(e);
                    });
                  })
              }
              .width('100%').margin({ top: 8 })

              Row() {
                Text('座位 wire 探针（map/seminar 字段实测）')
                  .fontSize(13).fontColor(this.p().textPrimary).layoutWeight(1)
                Button('打开')
                  .height(28).fontSize(11)
                  .onClick(() => {
                    router.pushUrl({ url: 'pages/SeatProbePage' }).catch((e: Error) => {
                      this.toast = '跳转失败：' + JSON.stringify(e);
                    });
                  })
              }
              .width('100%').margin({ top: 8 })

              if (this.diagText.length > 0) {
                Text(this.diagText)
                  .fontSize(10).fontColor(this.p().textMuted)
                  .width('100%').margin({ top: 8 })
              }
            }
            .width('100%').padding(12)
            .backgroundColor(this.p().bgCard)
            .borderRadius(10)
          }

          if (this.toast.length > 0) {
            Text(this.toast)
              .fontSize(11).fontColor(this.p().textMuted)
              .width('100%').margin({ top: 10 })
          }

          Text('')
            .height(24)
        }
        .width('100%')
        .padding({ left: 12, right: 12 })
        .alignItems(HorizontalAlign.Start)
      }
      .layoutWeight(1)
      .scrollBar(BarState.Off)
      .align(Alignment.Top)
    }
    .width('100%').height('100%')
    .backgroundColor(this.p().bgPage)
  }
}
