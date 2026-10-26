/**
 * 作息时间编辑（M6-2）
 *
 * 13 节，每节可改开始/结束时刻。点时间弹出系统 TimePicker。
 *
 * ## 为什么用「内存草稿 + 显式保存」
 * 改一节时间会牵连上下节（不能重叠），逐项落盘会让中间态写进存储。
 * 所以本页只在内存里改，点「保存」才一次写入；校验不过就**不写**并说明原因。
 */

import { router } from '@kit.ArkUI';
import { gridTokens } from '../core/theme/GridTokens.ts';
import type { GridTokens } from '../core/theme/GridTokens.ts';
import { STORAGE_DARK, STORAGE_PALETTE, getPalette } from '../data/ThemeStore.ts';
import { TimeTableStore, SECTION_COUNT, validate } from '../data/TimeTableStore.ts';
import type { TimeTable, TimeTableItem } from '../corelogic/timeutil.ts';
import { info } from '../core/log/BitLog.ts';

/** 一行草稿（渲染用，已格式化）。 */
interface RowDraft {
  section: number;
  startMin: number;
  endMin: number;
  startText: string;
  endText: string;
}

function fmt(minutes: number): string {
  const h: number = Math.floor(minutes / 60);
  const m: number = minutes % 60;
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

@Entry
@Component
struct TimeTablePage {
  @StorageLink(STORAGE_DARK) isDark: boolean = false;
  @StorageLink(STORAGE_PALETTE) paletteName: string = 'warm';

  @State rows: RowDraft[] = [];
  @State custom: boolean = false;
  @State toast: string = '';
  @State toastIsError: boolean = false;

  private tk(): GridTokens {
    return gridTokens(this.isDark, getPalette(this.paletteName));
  }

  aboutToAppear(): void {
    this.reload();
  }

  private async reload(): Promise<void> {
    const t: TimeTable = await TimeTableStore.load();
    const out: RowDraft[] = [];
    for (let i = 0; i < t.length; i++) {
      out.push({
        section: i + 1,
        startMin: t[i].startMinutes,
        endMin: t[i].endMinutes,
        startText: fmt(t[i].startMinutes),
        endText: fmt(t[i].endMinutes)
      });
    }
    this.rows = out;
    this.custom = await TimeTableStore.isCustom();
  }

  /** 点某一节的时间 → 系统 TimePicker。 */
  private pick(section: number, isStart: boolean): void {
    const row: RowDraft = this.rows[section - 1];
    const cur: number = isStart ? row.startMin : row.endMin;
    const h: number = Math.floor(cur / 60);
    const m: number = cur % 60;
    // 用「今天」构造：TimePickerDialog 的标题会显示这个日期。
    // 写死某个日期时标题会出现「2026年1月1日星期四」，用户会以为要改的是日期。
    const today: Date = new Date();
    const sel: Date = new Date(today.getFullYear(), today.getMonth(), today.getDate(), h, m);
    TimePickerDialog.show({
      selected: sel,
      useMilitaryTime: true,
      onAccept: (value: TimePickerResult) => {
        const mins: number = value.hour * 60 + value.minute;
        const next: RowDraft[] = [];
        for (let i = 0; i < this.rows.length; i++) {
          const r: RowDraft = this.rows[i];
          if (r.section === section) {
            next.push({
              section: r.section,
              startMin: isStart ? mins : r.startMin,
              endMin: isStart ? r.endMin : mins,
              startText: isStart ? fmt(mins) : r.startText,
              endText: isStart ? r.endText : fmt(mins)
            });
          } else {
            next.push(r);
          }
        }
        this.rows = next;
        this.toast = '';
      }
    });
  }

  private async save(): Promise<void> {
    const table: TimeTableItem[] = [];
    for (let i = 0; i < this.rows.length; i++) {
      table.push({ startMinutes: this.rows[i].startMin, endMinutes: this.rows[i].endMin });
    }
    const bad: string = validate(table);
    if (bad.length > 0) {
      this.toast = '没保存：' + bad;
      this.toastIsError = true;
      return;
    }
    const err: string = await TimeTableStore.save(table);
    if (err.length > 0) {
      this.toast = '没保存：' + err;
      this.toastIsError = true;
      return;
    }
    this.custom = true;
    this.toast = '已保存。课表时间列会立刻按新作息显示。';
    this.toastIsError = false;
    info('TimeTablePage saved');
  }

  private async resetToDefault(): Promise<void> {
    await TimeTableStore.reset();
    await this.reload();
    this.custom = false;
    this.toast = '已恢复学校官方作息。';
    this.toastIsError = false;
  }

  @Builder
  sectionRow(r: RowDraft) {
    Row() {
      Text('第 ' + r.section + ' 节')
        .fontSize(13).fontColor(this.tk().onSurface).width(64)
      Text(r.startText)
        .fontSize(14).fontColor(this.tk().primary)
        .padding({ left: 12, right: 12, top: 6, bottom: 6 })
        .backgroundColor(this.tk().surface2)
        .borderRadius(6)
        .onClick(() => {
          this.pick(r.section, true);
        })
      Text('—').fontSize(12).fontColor(this.tk().onSurfaceVariant).margin({ left: 8, right: 8 })
      Text(r.endText)
        .fontSize(14).fontColor(this.tk().primary)
        .padding({ left: 12, right: 12, top: 6, bottom: 6 })
        .backgroundColor(this.tk().surface2)
        .borderRadius(6)
        .onClick(() => {
          this.pick(r.section, false);
        })
    }
    .width('100%')
    .padding({ top: 7, bottom: 7 })
    .border({ width: { bottom: 0.5 }, color: this.tk().outlineVariant })
  }

  build() {
    Column() {
      Row() {
        Text('‹ 返回')
          .fontSize(14).fontColor(this.tk().primary)
          .onClick(() => {
            router.back();
          })
        Text('作息时间')
          .fontSize(16).fontWeight(FontWeight.Bold)
          .fontColor(this.tk().onSurface)
          .layoutWeight(1).textAlign(TextAlign.Center)
        Text('    ').fontSize(14)
      }
      .width('100%')
      .padding({ left: 12, right: 12, top: 10, bottom: 4 })

      Scroll() {
        Column() {
          Text(this.custom
            ? '当前使用自定义作息。点时间可修改，改完记得保存。'
            : '当前使用学校官方作息。点任意时间即可改成你自己的。')
            .fontSize(11).fontColor(this.tk().onSurfaceVariant)
            .width('100%').margin({ bottom: 8 })

          Column() {
            ForEach(this.rows, (r: RowDraft) => {
              this.sectionRow(r)
            }, (r: RowDraft) => 's_' + r.section + '_' + r.startText + '_' + r.endText)
          }
          .width('100%').padding({ left: 12, right: 12 })
          .backgroundColor(this.tk().surface)
          .borderRadius(10)

          if (this.toast.length > 0) {
            Text(this.toast)
              .fontSize(11)
              .fontColor(this.toastIsError ? this.tk().error : this.tk().success)
              .width('100%').margin({ top: 10 })
          }

          Row() {
            Button('恢复官方作息')
              .height(34).fontSize(13)
              .layoutWeight(1)
              .backgroundColor(this.tk().surface2)
              .fontColor(this.tk().onSurface)
              .onClick(() => {
                this.resetToDefault();
              })
            Button('保存')
              .height(34).fontSize(13)
              .layoutWeight(1)
              .backgroundColor(this.tk().primary)
              .fontColor(this.tk().onPrimary)
              .onClick(() => {
                this.save();
              })
          }
          .width('100%').margin({ top: 14 })

          Text('约束：每节结束必须晚于开始，且不能与上一节重叠。不符合时不会保存，并会说明原因。')
            .fontSize(10).fontColor(this.tk().textPlaceholder)
            .width('100%').margin({ top: 10, bottom: 20 })
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
    .backgroundColor(this.tk().background)
  }
}
