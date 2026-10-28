/**
 * 诊断页（P7）：把「用户反馈问题时要问的那几项」一次列全，并支持一键复制。
 *
 * ## 隐私边界（照 `DiagnosticsLogic` 的纪律）
 * 学号**脱敏**（前 3 后 2）；**不含**密码、cookie/JWT、手机号、姓名、成绩分数与课名。
 * 页面底部再写一次，让用户粘贴前自己看一眼。
 *
 * ## 为什么不做「上传诊断」
 * 上传要么带账号体系、要么带匿名 ID，两条都会引入新的隐私面；复制粘贴给开发者已经够用。
 */

import { router, promptAction } from '@kit.ArkUI';
import { bundleManager } from '@kit.AbilityKit';
import { deviceInfo } from '@kit.BasicServicesKit';
import { pasteboard } from '@kit.BasicServicesKit';
import { notificationManager } from '@kit.NotificationKit';
import { gridTokens } from '../core/theme/GridTokens.ts';
import type { GridTokens } from '../core/theme/GridTokens.ts';
import { STORAGE_DARK, STORAGE_PALETTE, getPalette } from '../data/ThemeStore.ts';
import { SessionStore } from '../data/SessionStore.ts';
import type { SessionSnapshot } from '../data/SessionStore.ts';
import { CourseCache } from '../data/CourseCache.ts';
import { measure } from '../data/CacheCleaner.ts';
import type { CacheUsage } from '../data/CacheCleaner.ts';
import { ScoreCheckRunner } from '../service/ScoreCheckRunner.ts';
import { statusText } from '../corelogic/ScoreCheckLogic.ts';
import { diagLines, diagText, maskStudent } from '../corelogic/DiagnosticsLogic.ts';
import type { DiagInput, DiagLine } from '../corelogic/DiagnosticsLogic.ts';
import { info, warn } from '../core/log/BitLog.ts';

@Entry
@Component
export struct DiagnosticsPage {
  @StorageLink(STORAGE_DARK) isDark: boolean = false;
  @StorageLink(STORAGE_PALETTE) paletteName: string = 'warm';

  @State lines: DiagLine[] = [];
  @State busy: boolean = true;
  @State copied: boolean = false;

  private input: DiagInput = {
    appVersion: '', buildLabel: '', deviceModel: '', osVersion: '',
    loggedIn: false, studentId: '', term: '', termSource: '',
    palette: '', dark: false, cacheBytes: 0, cacheItems: 0,
    notifyEnabled: false, lastScheduleFetch: '', lastScoreCheck: '',
  };

  private tk(): GridTokens {
    return gridTokens(this.isDark, getPalette(this.paletteName));
  }

  aboutToAppear(): void {
    this.collect();
  }

  /** 逐项采集；任何一项失败都只是缺一行，不阻塞整页。 */
  private async collect(): Promise<void> {
    this.busy = true;
    // 版本
    let version: string = '';
    try {
      const info2: bundleManager.BundleInfo =
        await bundleManager.getBundleInfoForSelf(bundleManager.BundleFlag.GET_BUNDLE_INFO_WITH_APPLICATION);
      version = info2.versionName + ' (' + String(info2.versionCode) + ')';
    } catch (e) {
      warn('DiagnosticsPage version fail: ' + JSON.stringify(e));
      version = '取不到';
    }
    // 设备
    let model: string = '';
    let os: string = '';
    try {
      model = deviceInfo.marketName.length > 0 ? deviceInfo.marketName : deviceInfo.productModel;
      os = deviceInfo.osFullName;
    } catch (e) {
      warn('DiagnosticsPage device fail: ' + JSON.stringify(e));
    }
    // 会话
    let loggedIn: boolean = false;
    let studentId: string = '';
    try {
      const snap: SessionSnapshot = await SessionStore.snapshot();
      loggedIn = snap.hasToken || snap.hasSchoolCookies;
      studentId = snap.studentId;
    } catch (e) {
      warn('DiagnosticsPage session fail: ' + JSON.stringify(e));
    }
    // 缓存
    let bytes: number = 0;
    let items: number = 0;
    try {
      const list: CacheUsage[] = await measure(false);
      for (let i = 0; i < list.length; i++) {
        bytes += list[i].bytes;
        items += list[i].keys.length;
      }
    } catch (e) {
      warn('DiagnosticsPage cache fail: ' + JSON.stringify(e));
    }
    // 最近课表
    let scheduleAge: string = '';
    try {
      const cached = await CourseCache.loadLast();
      if (cached !== null) {
        scheduleAge = CourseCache.ageText(cached.fetchedAt) + '（' + cached.term + '）';
      }
    } catch (e) {
      warn('DiagnosticsPage course cache fail: ' + JSON.stringify(e));
    }
    // 通知权限
    let notifyEnabled: boolean = false;
    try {
      notifyEnabled = await notificationManager.isNotificationEnabled();
    } catch (e) {
      warn('DiagnosticsPage notify fail: ' + JSON.stringify(e));
    }
    // 出分检查状态
    let scoreLine: string = '';
    try {
      scoreLine = statusText(await ScoreCheckRunner.lastStatus());
    } catch (e) {
      warn('DiagnosticsPage score fail: ' + JSON.stringify(e));
    }

    this.input = {
      appVersion: version,
      buildLabel: '',
      deviceModel: model.length > 0 ? model : '未知设备',
      osVersion: os.length > 0 ? os : '未知',
      loggedIn: loggedIn,
      studentId: studentId,
      term: '',
      termSource: '',
      palette: this.paletteName,
      dark: this.isDark,
      cacheBytes: bytes,
      cacheItems: items,
      notifyEnabled: notifyEnabled,
      lastScheduleFetch: scheduleAge,
      lastScoreCheck: scoreLine,
    };
    this.lines = diagLines(this.input);
    this.busy = false;
    info('DiagnosticsPage collected items=' + items);
  }

  private async copyAll(): Promise<void> {
    try {
      const data = pasteboard.createData(pasteboard.MIMETYPE_TEXT_PLAIN, diagText(this.input));
      await pasteboard.getSystemPasteboard().setData(data);
      this.copied = true;
      promptAction.showToast({ message: '诊断信息已复制' });
    } catch (e) {
      warn('DiagnosticsPage copy fail: ' + JSON.stringify(e));
      promptAction.showToast({ message: '复制失败（剪贴板不可用）' });
    }
  }

  build() {
    Column() {
      Row() {
        Text('‹')
          .fontSize(28).fontColor(this.tk().onSurface).width(40)
          .textAlign(TextAlign.Center)
          .accessibilityText('返回')
          .onClick(() => router.back())
        Text('诊断信息')
          .fontSize(17).fontWeight(FontWeight.Bold).fontColor(this.tk().onSurface)
          .layoutWeight(1)
        Text('刷新')
          .fontSize(13).fontColor(this.tk().primary)
          .padding({ left: 10, right: 14 })
          .onClick(() => {
            if (!this.busy) {
              this.collect();
            }
          })
      }
      .width('100%').height(52)

      Scroll() {
        Column() {
          if (this.busy) {
            Text('正在采集…')
              .fontSize(13).fontColor(this.tk().onSurfaceVariant)
              .width('100%').padding(24)
          } else {
            ForEach(this.lines, (l: DiagLine) => {
              Row() {
                Text(l.label)
                  .fontSize(13).fontColor(this.tk().onSurfaceVariant)
                  .width(96)
                Text(l.value)
                  .fontSize(13).fontColor(this.tk().onSurface)
                  .layoutWeight(1)
              }
              .width('100%')
              .padding({ top: 9, bottom: 9 })
              .accessibilityText(l.label + '：' + l.value)
            }, (l: DiagLine) => l.label)

            Button(this.copied ? '已复制' : '复制诊断信息')
              .width('100%').height(40).margin({ top: 18 })
              .backgroundColor(this.tk().primary)
              .fontColor(this.tk().onPrimary)
              .fontSize(14)
              .onClick(() => this.copyAll())

            Text('学号已脱敏（' + maskStudent(this.input.studentId) + '）。'
              + '这段文本不含密码、cookie/JWT、手机号与成绩内容，可以放心发给开发者。')
              .fontSize(11).fontColor(this.tk().textPlaceholder)
              .width('100%').margin({ top: 12, bottom: 24 })
          }
        }
        .width('100%')
        .padding({ left: 16, right: 16 })
      }
      .layoutWeight(1)
      .align(Alignment.Top)
      .width('100%')
      .scrollBar(BarState.Auto)
    }
    .width('100%').height('100%')
    .backgroundColor(this.tk().background)
  }
}
