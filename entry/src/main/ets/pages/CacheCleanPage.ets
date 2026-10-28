/**
 * 清理本地缓存页（P6）。
 *
 * ## 安全边界（比功能重要）
 * - 可清理项来自 `CacheIndex.CACHE_SPECS` **白名单**，未命中的键永远不会被删
 *   （主题、登录凭据、学期覆盖、成绩快照都不在白名单里）；
 * - 「作业数据」单独标 `userData`：**默认不勾**，勾了确认文案会说「含你自己新增的条目，不可恢复」；
 * - 清理完**不自动重载其他页面**（它们各自 onPageShow 会刷新），只在本页重新统计。
 */

import { router } from '@kit.ArkUI';
import { promptAction } from '@kit.ArkUI';
import { gridTokens } from '../core/theme/GridTokens.ts';
import type { GridTokens } from '../core/theme/GridTokens.ts';
import { STORAGE_DARK, STORAGE_PALETTE, getPalette } from '../data/ThemeStore.ts';
import { measure, clearKinds } from '../data/CacheCleaner.ts';
import type { CacheUsage, ClearResult } from '../data/CacheCleaner.ts';
import { sizeText, totalBytes, clearConfirmText, emptySelectionText } from '../corelogic/CacheIndex.ts';
import { info, warn } from '../core/log/BitLog.ts';

@Entry
@Component
export struct CacheCleanPage {
  @StorageLink(STORAGE_DARK) isDark: boolean = false;
  @StorageLink(STORAGE_PALETTE) paletteName: string = 'warm';

  @State usages: CacheUsage[] = [];
  @State checked: string[] = [];
  @State busy: boolean = true;
  @State spendNote: string = '';

  private tk(): GridTokens {
    return gridTokens(this.isDark, getPalette(this.paletteName));
  }

  aboutToAppear(): void {
    this.reload();
  }

  private async reload(): Promise<void> {
    this.busy = true;
    try {
      // 包含 userData 才看得到「作业数据」那一项（但默认不勾）
      this.usages = await measure(true);
      // 清掉已经不存在的勾选
      const kept: string[] = [];
      for (let i = 0; i < this.checked.length; i++) {
        for (let j = 0; j < this.usages.length; j++) {
          if (this.usages[j].spec.kind === this.checked[i]) {
            kept.push(this.checked[i]);
          }
        }
      }
      this.checked = kept;
    } catch (e) {
      warn('CacheCleanPage measure fail: ' + JSON.stringify(e));
      this.usages = [];
    }
    this.busy = false;
  }

  private isChecked(kind: string): boolean {
    return this.checked.indexOf(kind) >= 0;
  }

  private toggle(kind: string, userData: boolean): void {
    if (this.isChecked(kind)) {
      this.checked = this.checked.filter((k: string) => k !== kind);
      return;
    }
    // 含用户数据的项：点击时先问一句，避免顺手勾上就清
    if (userData) {
      AlertDialog.show({
        title: '这一项含你的数据',
        message: '「作业数据」里有你自己新增的作业条目，清掉不可恢复。确定要清吗？',
        primaryButton: {
          value: '取消',
          action: () => {
          },
        },
        secondaryButton: {
          value: '我要清',
          fontColor: this.tk().error,
          action: () => {
            this.checked = this.checked.concat([kind]);
          },
        },
      });
      return;
    }
    this.checked = this.checked.concat([kind]);
  }

  /** 选中项的合计字节。 */
  private selectedBytes(): number {
    const values: number[] = [];
    for (let i = 0; i < this.usages.length; i++) {
      if (this.isChecked(this.usages[i].spec.kind)) {
        values.push(this.usages[i].bytes);
      }
    }
    return totalBytes(values);
  }

  private selectedTitles(): string[] {
    const out: string[] = [];
    for (let i = 0; i < this.usages.length; i++) {
      if (this.isChecked(this.usages[i].spec.kind)) {
        out.push(this.usages[i].spec.title);
      }
    }
    return out;
  }

  private hasUserDataSelected(): boolean {
    for (let i = 0; i < this.usages.length; i++) {
      if (this.isChecked(this.usages[i].spec.kind) && this.usages[i].spec.userData) {
        return true;
      }
    }
    return false;
  }

  private confirmClear(): void {
    if (this.checked.length === 0) {
      promptAction.showToast({ message: emptySelectionText() });
      return;
    }
    const titles: string[] = this.selectedTitles();
    const userData: boolean = this.hasUserDataSelected();
    AlertDialog.show({
      title: '清理本地缓存',
      message: clearConfirmText(titles, userData),
      primaryButton: {
        value: '取消',
        action: () => {
        },
      },
      secondaryButton: {
        value: '清理',
        fontColor: userData ? this.tk().error : this.tk().primary,
        action: () => {
          this.runClear();
        },
      },
    });
  }

  private async runClear(): Promise<void> {
    this.busy = true;
    try {
      const r: ClearResult = await clearKinds(this.checked, true);
      this.checked = [];
      this.spendNote = '已清理 ' + String(r.removed) + ' 项' +
        (r.failed > 0 ? '，' + String(r.failed) + ' 项删除失败' : '');
      promptAction.showToast({ message: this.spendNote });
      info('CacheCleanPage cleared removed=' + r.removed + ' failed=' + r.failed);
      await this.reload();
    } catch (e) {
      warn('CacheCleanPage clear fail: ' + JSON.stringify(e));
      this.busy = false;
      promptAction.showToast({ message: '清理失败（存储不可用）' });
    }
  }

  @Builder
  row(u: CacheUsage) {
    Row() {
      // 勾选圈（不用 Checkbox：宽度与配色在深色皮肤下不一致）
      // ⚠️ 选中/未选必须**分成两个分支**而不是三元：三元会让配色扫描器把
      //    onPrimary 与 surface2 当成一对（实测对比度 1.05），而未选态其实没有文字。
      if (this.isChecked(u.spec.kind)) {
        Text('✓')
          .fontSize(13)
          .fontColor(this.tk().onPrimary)
          .width(20).height(20)
          .textAlign(TextAlign.Center)
          .backgroundColor(this.tk().primary)
          .borderRadius(10)
          .margin({ right: 10 })
      } else {
        Text('')
          .fontSize(13)
          .fontColor(this.tk().onSurfaceVariant)
          .width(20).height(20)
          .textAlign(TextAlign.Center)
          .backgroundColor(this.tk().surface2)
          .borderRadius(10)
          .border({ width: 1, color: this.tk().outlineVariant })
          .margin({ right: 10 })
      }
      Column() {
        Row() {
          Text(u.spec.title)
            .fontSize(14).fontColor(this.tk().onSurface)
          if (u.spec.userData) {
            Text('含我的数据')
              .fontSize(9).fontColor(this.tk().onError)
              .backgroundColor(this.tk().error)
              .borderRadius(3).padding({ left: 4, right: 4, top: 1, bottom: 1 })
              .margin({ left: 6 })
          }
          Text('')
            .layoutWeight(1)
          Text(sizeText(u.bytes))
            .fontSize(12).fontColor(this.tk().onSurfaceVariant)
        }
        .width('100%')
        Text(u.spec.note)
          .fontSize(11).fontColor(this.tk().textPlaceholder)
          .width('100%').margin({ top: 2 })
      }
      .layoutWeight(1).alignItems(HorizontalAlign.Start)
    }
    .width('100%')
    .padding({ top: 12, bottom: 12 })
    .alignItems(VerticalAlign.Top)
    .accessibilityText(u.spec.title + '，' + sizeText(u.bytes) + '，' + u.spec.note +
      (this.isChecked(u.spec.kind) ? '，已选中' : ''))
    .onClick(() => this.toggle(u.spec.kind, u.spec.userData))
  }

  build() {
    Column() {
      Row() {
        Text('‹')
          .fontSize(28).fontColor(this.tk().onSurface).width(40)
          .textAlign(TextAlign.Center)
          .accessibilityText('返回')
          .onClick(() => router.back())
        Text('存储与清理')
          .fontSize(17).fontWeight(FontWeight.Bold).fontColor(this.tk().onSurface)
          .layoutWeight(1)
      }
      .width('100%').height(52)

      Scroll() {
        Column() {
          if (this.busy) {
            Text('正在统计…')
              .fontSize(13).fontColor(this.tk().onSurfaceVariant)
              .width('100%').padding(24)
          } else if (this.usages.length === 0) {
            Text('没有可清理的缓存。')
              .fontSize(13).fontColor(this.tk().onSurfaceVariant)
              .width('100%').padding(24)
          } else {
            Column() {
              ForEach(this.usages, (u: CacheUsage) => {
                this.row(u)
              }, (u: CacheUsage) => u.spec.kind)
            }
            .width('100%').padding({ left: 14, right: 14 })
            .backgroundColor(this.tk().surface)
            .borderRadius(12)

            Text('已选 ' + String(this.checked.length) + ' 项 · ' + sizeText(this.selectedBytes()))
              .fontSize(12).fontColor(this.tk().onSurfaceVariant)
              .width('100%').margin({ top: 12 })

            Button('清理选中项')
              .width('100%').height(40).margin({ top: 10 })
              .backgroundColor(this.tk().primary)
              .fontColor(this.tk().onPrimary)
              .fontSize(14)
              .enabled(this.checked.length > 0)
              .onClick(() => this.confirmClear())

            if (this.spendNote.length > 0) {
              Text(this.spendNote)
                .fontSize(11).fontColor(this.tk().primary)
                .width('100%').margin({ top: 8 })
            }

            Text('这里只会删「缓存」：登录状态、主题、皮肤、学期选择、成绩提醒基线都不在清理范围内。'
              + '清理后各页面下次打开会重新从学校拉取。')
              .fontSize(10).fontColor(this.tk().textPlaceholder)
              .width('100%').margin({ top: 14, bottom: 24 })
          }
        }
        .width('100%')
        .padding({ left: 14, right: 14 })
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
