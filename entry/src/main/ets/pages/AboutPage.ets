/**
 * 版本与更新说明页（M10-4）。
 *
 * ## 三条边界（照 ROADMAP 判据）
 * 1. **显示版本**：`versionName (versionCode)` 从 `bundleManager` 读（不写死 ——
 *    写死的版本号在发版时必然忘记改）；
 * 2. **显示更新说明**：`rawfile/changelog.json`，解析失败就只显示版本块，
 *    不显示半截乱码（`VersionLogic.parseChangelog` 会把坏条目丢掉）；
 * 3. **更新引导去应用市场，绝不自下载**：本页没有任何下载/安装动作 ——
 *    自助更新要处理签名、渠道、降级、部分包校验，做不好就是安全问题。
 *
 * 关于许可：本工程是 AGPL-3.0（见仓库 LICENSE）。这里如实写，不粉饰成 MIT。
 */

import { bundleManager, Context } from '@kit.AbilityKit';
import { router } from '@kit.ArkUI';
import util from '@ohos.util';
import { gridTokens } from '../core/theme/GridTokens.ts';
import type { GridTokens } from '../core/theme/GridTokens.ts';
import { STORAGE_DARK, STORAGE_PALETTE, getPalette } from '../data/ThemeStore.ts';
import type { ChangelogEntry } from '../corelogic/VersionLogic.ts';
import { hasNewerNotes, parseChangelog, versionLine } from '../corelogic/VersionLogic.ts';
import type { UpdateDecision } from '../corelogic/UpdateCheckLogic.ts';
import { checkForUpdate } from '../service/VersionCheckService.ts';
import { warn, info } from '../core/log/BitLog.ts';

const CHANGELOG_RAWFILE: string = 'changelog.json';

@Entry
@Component
export struct AboutPage {
  @StorageLink(STORAGE_DARK) isDark: boolean = false;
  @StorageLink(STORAGE_PALETTE) paletteName: string = 'brand';

  @State versionName: string = '';
  @State versionCode: number = 0;
  @State notes: ChangelogEntry[] = [];
  @State note: string = '';
  // 联网检查更新（只读；不下载不安装）
  @State checking: boolean = false;
  @State updateDecision: UpdateDecision | null = null;

  private tk(): GridTokens {
    return gridTokens(this.isDark, getPalette(this.paletteName));
  }

  aboutToAppear(): void {
    this.loadVersion();
    this.loadNotes();
  }

  private async loadVersion(): Promise<void> {
    try {
      const info: bundleManager.BundleInfo =
        await bundleManager.getBundleInfoForSelf(bundleManager.BundleFlag.GET_BUNDLE_INFO_WITH_APPLICATION);
      this.versionName = info.versionName;
      this.versionCode = info.versionCode;
    } catch (e) {
      warn('AboutPage version fail: ' + JSON.stringify(e));
      this.note = '取不到版本号（bundleManager 不可用）';
    }
  }

  private async loadNotes(): Promise<void> {
    try {
      const bytes: Uint8Array = await getContext(this).resourceManager.getRawFileContent(CHANGELOG_RAWFILE);
      const raw: string = util.TextDecoder.create('utf-8').decodeToString(bytes);
      this.notes = parseChangelog(raw);
    } catch (e) {
      // 没有 changelog.json 也能正常显示版本块 —— 更新说明是附加信息
      warn('AboutPage changelog fail: ' + JSON.stringify(e));
      this.note = '没有内置更新说明（changelog.json 缺失或不可读）';
    }
  }

  /**
   * 联网检查更新（#158）：只读 GET /version，结果仅提示去应用市场。
   * 失败/坏数据一律"无需提示"，不弹错误吓人；本方法没有任何下载/安装动作。
   */
  private async doCheckUpdate(): Promise<void> {
    this.checking = true;
    this.updateDecision = null;
    try {
      const ctx: Context = getContext(this) as Context;
      const decision: UpdateDecision = await checkForUpdate(ctx, {
        versionName: this.versionName,
        versionCode: this.versionCode
      });
      this.updateDecision = decision;
      info('AboutPage checkUpdate level=' + decision.level);
    } catch (e) {
      warn('AboutPage checkUpdate fail: ' + JSON.stringify(e));
      this.updateDecision = null;
    } finally {
      this.checking = false;
    }
  }

  /** 提示「说明里有比当前更新的版本」——只是文案，不代表能下载。 */
  private newerHint(): string {
    if (this.notes.length === 0 || this.versionName.length === 0) {
      return '';
    }
    return hasNewerNotes(this.versionName, this.notes)
      ? '内置说明里有比当前更新的版本，请到应用市场更新（本应用不自行下载安装包）'
      : '';
  }

  build() {
    Column() {
      Row() {
        Text('‹ 返回')
          .fontSize(14).fontColor(this.tk().primary)
          .onClick(() => {
            router.back();
          })
        Text('关于')
          .fontSize(16).fontWeight(FontWeight.Bold).fontColor(this.tk().onSurface)
          .layoutWeight(1).textAlign(TextAlign.Center)
        Text('    ').fontSize(14)
      }
      .width('100%')
      .padding({ left: 12, right: 12, top: 10, bottom: 4 })

      Scroll() {
        Column() {
          // ── 版本块 ──
          Column() {
            Text('BIT101 鸿蒙版')
              .fontSize(17).fontWeight(FontWeight.Bold).fontColor(this.tk().onSurface)
              .width('100%')
            Text(versionLine(this.versionName, this.versionCode))
              .fontSize(13).fontColor(this.tk().onSurfaceVariant)
              .width('100%').margin({ top: 4 })
            Text('非官方客户端，与学校无关。')
              .fontSize(11).fontColor(this.tk().onSurfaceVariant)
              .width('100%').margin({ top: 6 })

            Row() {
              Button(this.checking ? '检查中…' : '检查更新')
                .fontSize(12).height(32).padding({ left: 12, right: 12 })
                .backgroundColor(this.tk().surface2)
                .fontColor(this.tk().onSurface)
                .enabled(!this.checking)
                .onClick(() => { this.doCheckUpdate(); })
            }.width('100%').margin({ top: 10 })

            if (this.updateDecision !== null && this.updateDecision.level !== 'none') {
              Column() {
                Text(this.updateDecision.message)
                  .fontSize(12).fontColor(this.tk().stateAttention).width('100%')
                if (this.updateDecision.latestName.length > 0) {
                  Text('最新版 ' + this.updateDecision.latestName)
                    .fontSize(11).fontColor(this.tk().onSurfaceVariant).width('100%').margin({ top: 3 })
                }
                if (this.updateDecision.note.length > 0) {
                  Text(this.updateDecision.note)
                    .fontSize(11).fontColor(this.tk().onSurfaceVariant).width('100%').margin({ top: 3 })
                }
                Text('本应用不自行下载安装包，请到应用市场更新。')
                  .fontSize(11).fontColor(this.tk().onSurfaceVariant).width('100%').margin({ top: 5 })
              }
              .width('100%').padding(10).margin({ top: 8 })
              .backgroundColor(this.tk().secondaryContainer).borderRadius(8)
              .alignItems(HorizontalAlign.Start)
            } else if (this.updateDecision !== null && !this.updateDecision.checked) {
              Text('检查失败（网络或服务不可用），请稍后重试')
                .fontSize(11).fontColor(this.tk().onSurfaceVariant)
                .width('100%').margin({ top: 6 })
            } else if (this.updateDecision !== null && this.updateDecision.checked) {
              Text('检查完成。服务端公告针对 Android 版，鸿蒙版更新请到应用市场。')
                .fontSize(11).fontColor(this.tk().onSurfaceVariant)
                .width('100%').margin({ top: 6 })
            }
          }
          .width('100%').padding(14).margin({ top: 6 })
          .backgroundColor(this.tk().surface).borderRadius(12)
          .alignItems(HorizontalAlign.Start)

          if (this.note.length > 0) {
            Text(this.note)
              .fontSize(11).fontColor(this.tk().onSurfaceVariant)
              .width('100%').margin({ top: 8 })
          }
          if (this.newerHint().length > 0) {
            Text(this.newerHint())
              .fontSize(11).fontColor(this.tk().stateAttention)
              .width('100%').margin({ top: 6 })
          }

          // ── 更新说明 ──
          if (this.notes.length > 0) {
            Text('更新说明')
              .fontSize(11).fontColor(this.tk().onSurfaceVariant)
              .width('100%').padding({ top: 18, bottom: 6 })

            ForEach(this.notes, (n: ChangelogEntry) => {
              this.noteBlock(n)
            }, (n: ChangelogEntry) => 'v_' + n.version)
          }

          // ── 开源与许可 ──
          Text('开源与许可')
            .fontSize(11).fontColor(this.tk().onSurfaceVariant)
            .width('100%').padding({ top: 18, bottom: 6 })

          Column() {
            Row() {
              Text('许可证').fontSize(14).fontColor(this.tk().onSurface).layoutWeight(1)
              Text('AGPL-3.0').fontSize(13).fontColor(this.tk().onSurfaceVariant)
            }
            .width('100%').padding({ bottom: 8 })

            Row() {
              Text('项目主页').fontSize(14).fontColor(this.tk().onSurface).layoutWeight(1)
              Text('github.com/Star2121-1/BIT101-Harmony')
                .fontSize(11).fontColor(this.tk().onSurfaceVariant)
            }
            .width('100%').padding({ bottom: 8 })

            Text('本应用不含任何统计 / 广告 SDK；成绩与课表只存在本机沙箱。')
              .fontSize(11).fontColor(this.tk().onSurfaceVariant)
              .width('100%')
          }
          .width('100%').padding(12)
          .backgroundColor(this.tk().secondaryContainer).borderRadius(12)
          .alignItems(HorizontalAlign.Start)

          Text('')
            .height(24)
        }
        .width('100%').padding({ left: 12, right: 12 })
        .alignItems(HorizontalAlign.Start)
      }
      .width('100%')
      .layoutWeight(1)
      .scrollBar(BarState.Off)
      // ⚠️ 顶对齐必须挂 Scroll 自身（写在子 Column 上不生效）
      .align(Alignment.Top)
    }
    .width('100%').height('100%')
    .backgroundColor(this.tk().background)
  }

  /** 一条版本说明。 */
  @Builder
  noteBlock(n: ChangelogEntry) {
    Column() {
      Row() {
        Text(n.version)
          .fontSize(14).fontWeight(FontWeight.Medium)
          .fontColor(this.tk().onSurface)
          .layoutWeight(1)
        Text(n.date)
          .fontSize(11).fontColor(this.tk().onSurfaceVariant)
      }
      .width('100%')

      ForEach(n.items, (it: string, idx: number) => {
        Text('· ' + it)
          .fontSize(12).fontColor(this.tk().onSurfaceVariant)
          .width('100%')
          .margin({ top: idx === 0 ? 6 : 4 })
      }, (it: string) => n.version + '|' + it)
    }
    .width('100%').padding(12).margin({ bottom: 8 })
    .backgroundColor(this.tk().surface).borderRadius(12)
    .alignItems(HorizontalAlign.Start)
  }
}
