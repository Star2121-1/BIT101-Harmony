/**
 * 手动改课表（M2-8）：编辑 / 隐藏 / 新增课程。
 *
 * ## 为什么是「覆盖层」而不是直接改课表
 *
 * 课表缓存每次同步整份重写 ⇒ 直接改缓存里的行，下次同步就被冲掉。
 * 所以修改记在覆盖层（`CourseOverlayStore`），**读路径合并**（`CourseOverlayLogic`），
 * 课表页、桌面卡片、提醒排期看到的都是合并后的结果。
 *
 * ## ⚠️ 锚点与显示值
 *
 * 编辑时锚点取自**教务原课**（不是合并后的行）—— 合并后的行时间是改过的，
 * 拿它取锚点会漂移，导致二次编辑静默失效（Android 真踩过）。
 * 本页的「改」按钮因此总是从 `rawCourses` 里按自然键找原课。
 *
 * 数据来源：CourseCache（当前学期课表）+ CourseOverlayStore（用户的修改）。
 */

import { router } from '@kit.ArkUI';
import { gridTokens } from '../core/theme/GridTokens.ts';
import type { GridTokens } from '../core/theme/GridTokens.ts';
import { STORAGE_DARK, STORAGE_PALETTE, getPalette } from '../data/ThemeStore.ts';
import { CourseCache, CachedSchedule } from '../data/CourseCache.ts';
import { CourseOverlayStore } from '../data/CourseOverlayStore.ts';
import { CourseRow } from '../core/model/SchoolModels.ts';
import {
  CourseOverlay,
  MergedCourse,
  key,
  keyOfCourse,
  keyOfOverlay,
  mergeOverlay,
  skzcToSelected,
  toOverlay,
  weeksToSkzc,
  withDisplay
} from '../corelogic/CourseOverlayLogic.ts';
import { info, warn } from '../core/log/BitLog.ts';

/** 星期 chip（1..7）。 */
const WEEKDAYS: number[] = [1, 2, 3, 4, 5, 6, 7];

/** 周次 chip（1..20）。 */
const WEEKS: number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];

/** 星期中文（1..7）。 */
function weekdayCn(d: number): string {
  return '周' + '一二三四五六日'.charAt(d - 1);
}

/** 空课程行（新增时的种子；KCH 用本地编号，不与教务撞）。 */
function emptyRow(term: string): CourseRow {
  return {
    XNXQDM: term,
    KCM: '',
    SKJS: '',
    JASMC: '',
    YPSJDD: '',
    SKZC: '',
    SKXQ: 1,
    KSJC: 1,
    JSJC: 2,
    XXXQMC: '',
    KCH: 'LOCAL',
    XF: 0,
    XS: 0,
    KCXZDM_DISPLAY: '',
    KCLBDM_DISPLAY: '',
    KKDWDM_DISPLAY: ''
  };
}

/** 按 id 找覆盖层（本地新增行「删」用）；找不到返回 null，调用方不动作。 */
function findOverlayById(list: CourseOverlay[], id: number): CourseOverlay | null {
  for (let i = 0; i < list.length; i++) {
    if (list[i].id === id) {
      return list[i];
    }
  }
  return null;
}

@Entry
@Component
struct OverlayPage {
  @StorageLink(STORAGE_DARK) isDark: boolean = false;
  @StorageLink(STORAGE_PALETTE) paletteName: string = 'warm';

  @State rawCourses: CourseRow[] = [];
  @State overlays: CourseOverlay[] = [];
  @State rows: MergedCourse[] = [];
  @State term: string = '';
  @State maxWeek: number = 20;
  @State loading: boolean = true;
  @State toast: string = '';

  // ── 编辑器 ──
  @State editorOpen: boolean = false;
  /** 'EDIT'（改教务的课）/ 'ADD'（本地新增）。 */
  @State edKind: string = 'EDIT';
  /** 0 = 新建；>0 = 更新已有覆盖层。 */
  @State edExistingId: number = 0;
  @State edName: string = '';
  @State edTeacher: string = '';
  @State edClassroom: string = '';
  @State edWeekday: number = 1;
  @State edStart: number = 1;
  @State edEnd: number = 2;
  @State edWeeks: number[] = [];
  @State edNumber: string = '';
  /** 编辑教务课时记住原课的自然键（锚点来源）。 */
  @State edAnchorKey: string = '';

  private tk(): GridTokens {
    return gridTokens(this.isDark, getPalette(this.paletteName));
  }

  private rebuild(): void {
    this.rows = mergeOverlay(this.rawCourses, this.overlays);
  }

  private async reload(): Promise<void> {
    try {
      this.overlays = await CourseOverlayStore.load();
      const cached: CachedSchedule | null = await CourseCache.loadLast();
      if (cached !== null) {
        this.term = cached.term;
        this.rawCourses = cached.courses;
      }
      this.rebuild();
    } catch (e) {
      warn('overlay page reload fail: ' + JSON.stringify(e));
    }
    this.loading = false;
  }

  aboutToAppear(): void {
    this.reload();
    info('overlay page open');
  }

  /** 覆盖层数量（标题右上角）。 */
  private overlayCountText(): string {
    return this.overlays.length > 0 ? this.overlays.length + ' 处修改' : '无修改';
  }

  /** 某行是否被改过 / 是本地新增（用于列表标记）。 */
  private rowMark(row: MergedCourse): string {
    if (row.localId < 0) return '本地新增';
    // ⚠️ 用覆盖层的**显示键**（不是锚点键）：改了时间的课，合并行的键是改后的
    const k: string = keyOfCourse(row);
    for (let i = 0; i < this.overlays.length; i++) {
      const o: CourseOverlay = this.overlays[i];
      if (o.kind === 'EDIT' && key(o.term, o.number, o.weekday, o.startSection) === k) {
        return '已修改';
      }
    }
    return '';
  }

  // ── 编辑器入口 ──

  /** 从合并后的行打开编辑：新增的课按 ADD 处理，教务课按 EDIT 处理。 */
  private openEdit(row: MergedCourse): void {
    this.editorOpen = true;
    this.edKind = row.localId < 0 ? 'ADD' : 'EDIT';
    this.edExistingId = row.localId < 0 ? -row.localId : 0;
    this.edName = row.KCM;
    this.edTeacher = row.SKJS;
    this.edClassroom = row.JASMC;
    this.edWeekday = row.SKXQ;
    this.edStart = row.KSJC;
    this.edEnd = row.JSJC;
    this.edWeeks = skzcToSelected(row.SKZC);
    this.edNumber = row.KCH;
    // 锚点键：教务行按它自己的自然键；本地新增没有原课
    this.edAnchorKey = row.localId < 0 ? '' : keyOfCourse(row);
    if (this.edWeeks.length === 0) {
      this.edWeeks = skzcToSelected(weeksToSkzc([1], 16));
    }
  }

  private openAdd(): void {
    this.editorOpen = true;
    this.edKind = 'ADD';
    this.edExistingId = 0;
    this.edName = '';
    this.edTeacher = '';
    this.edClassroom = '';
    this.edWeekday = 1;
    this.edStart = 1;
    this.edEnd = 2;
    this.edWeeks = skzcToSelected(weeksToSkzc([1], 16));
    this.edNumber = '';
    this.edAnchorKey = '';
  }

  private closeEditor(): void {
    this.editorOpen = false;
    this.toast = '';
  }

  /** 编辑中的周次串（chips 选中态据此渲染）。 */
  private weekSelected(w: number): boolean {
    for (let i = 0; i < this.edWeeks.length; i++) {
      if (this.edWeeks[i] === w) return true;
    }
    return false;
  }

  private toggleWeek(w: number): void {
    const next: number[] = [];
    let removed: boolean = false;
    for (let i = 0; i < this.edWeeks.length; i++) {
      if (this.edWeeks[i] === w) {
        removed = true;
      } else {
        next.push(this.edWeeks[i]);
      }
    }
    if (!removed) {
      next.push(w);
    }
    next.sort((a: number, b: number) => a - b);
    this.edWeeks = next;
  }

  /** 保存：编辑 / 新增都走同一条 upsert（锚点在逻辑层规整）。 */
  private async save(): Promise<void> {
    if (this.edName.trim().length === 0) {
      this.toast = '课名不能为空';
      return;
    }
    if (this.edWeeks.length === 0) {
      this.toast = '至少选一个周次';
      return;
    }
    if (this.edEnd < this.edStart) {
      this.toast = '结束节次不能小于开始节次';
      return;
    }
    // 找锚点来源：教务原课（编辑）或空白行（新增）
    let source: CourseRow = emptyRow(this.term);
    if (this.edKind === 'EDIT') {
      const found: CourseRow | null = this.findRawByKey(this.edAnchorKey);
      if (found === null) {
        this.toast = '找不到原课（可能教务已改），先刷新课表';
        return;
      }
      source = found;
    }
    const overlay: CourseOverlay = toOverlay(this.edKind, source, this.edExistingId, Date.now());
    const edited: CourseOverlay = withDisplay(overlay, {
      name: this.edName.trim(),
      teacher: this.edTeacher.trim(),
      classroom: this.edClassroom.trim(),
      weekday: this.edWeekday,
      startSection: this.edStart,
      endSection: this.edEnd,
      weeks: weeksToSkzc(this.edWeeks, this.maxWeek > 16 ? this.maxWeek : 16),
      number: this.edNumber.trim().length > 0 ? this.edNumber.trim() : source.KCH
    });
    try {
      await CourseOverlayStore.upsert(edited);
      await this.reload();
      this.toast = this.edKind === 'ADD' ? '已新增' : '已保存修改';
      this.editorOpen = false;
    } catch (e) {
      this.toast = '保存失败：' + (e as Error).message;
    }
  }

  private findRawByKey(k: string): CourseRow | null {
    for (let i = 0; i < this.rawCourses.length; i++) {
      if (keyOfCourse(this.rawCourses[i]) === k) {
        return this.rawCourses[i];
      }
    }
    return null;
  }

  /** 隐藏一节课（HIDE 覆盖层）。 */
  private async hide(row: MergedCourse): Promise<void> {
    const source: CourseRow | null = this.findRawByKey(keyOfCourse(row));
    if (source === null) {
      this.toast = '找不到原课，无法隐藏';
      return;
    }
    try {
      await CourseOverlayStore.upsert(toOverlay('HIDE', source, 0, Date.now()));
      await this.reload();
      this.toast = '已隐藏：' + row.KCM + '（可在下方恢复）';
    } catch (e) {
      this.toast = '隐藏失败：' + (e as Error).message;
    }
  }

  /** 恢复/撤销一条覆盖层。 */
  private async restore(o: CourseOverlay): Promise<void> {
    try {
      await CourseOverlayStore.remove(o.id);
      await this.reload();
      this.toast = '已恢复原样';
    } catch (e) {
      this.toast = '恢复失败：' + (e as Error).message;
    }
  }

  /** 覆盖层的一句话说明。 */
  private overlayText(o: CourseOverlay): string {
    const kindText: string = o.kind === 'HIDE' ? '隐藏' : (o.kind === 'ADD' ? '新增' : '修改');
    return kindText + ' · ' + (o.name.length > 0 ? o.name : o.number) +
      ' · 周' + o.weekday + ' 第' + o.startSection + '-' + o.endSection + ' 节';
  }

  build() {
    // ⚠️ build() 根部不声明局部变量（编译器只认根节点起手）
    Column() {
      Row() {
        Button('‹ 返回')
          .onClick(() => {
            router.back();
          })
        Text('手动改课表').fontSize(16).fontWeight(FontWeight.Bold).layoutWeight(1)
          .textAlign(TextAlign.Center)
        Button(this.editorOpen ? '取消' : '新增')
          .fontSize(13)
          .onClick(() => {
            if (this.editorOpen) {
              this.closeEditor();
            } else {
              this.openAdd();
            }
          })
      }.width('100%').padding(12)

      if (this.toast.length > 0) {
        Text(this.toast)
          .fontSize(12).fontColor(this.tk().onSurfaceVariant)
          .width('100%').padding({ left: 12, right: 12, bottom: 6 })
      }

      if (this.editorOpen) {
        // ── 编辑器 ──
        Scroll() {
          Column() {
            Text(this.edKind === 'ADD' ? '新增一节课' : '修改这节课')
              .fontSize(13).fontWeight(FontWeight.Bold).fontColor(this.tk().onSurface)
              .width('100%').padding({ top: 4, bottom: 8 })

            Text('课名').fontSize(11).fontColor(this.tk().onSurfaceVariant).width('100%')
            TextInput({ text: this.edName, placeholder: '如：高等数学' })
              .fontSize(13).width('100%')
              .onChange((v: string) => {
                this.edName = v;
              })

            Text('教师 / 教室').fontSize(11).fontColor(this.tk().onSurfaceVariant).width('100%').margin({ top: 8 })
            Row() {
              TextInput({ text: this.edTeacher, placeholder: '教师' })
                .fontSize(13).layoutWeight(1)
                .onChange((v: string) => {
                  this.edTeacher = v;
                })
              TextInput({ text: this.edClassroom, placeholder: '教室' })
                .fontSize(13).layoutWeight(1).margin({ left: 8 })
                .onChange((v: string) => {
                  this.edClassroom = v;
                })
            }.width('100%')

            Text('星期').fontSize(11).fontColor(this.tk().onSurfaceVariant).width('100%').margin({ top: 8 })
            Row() {
              ForEach(WEEKDAYS, (d: number) => {
                Text(weekdayCn(d))
                  .fontSize(12).textAlign(TextAlign.Center).layoutWeight(1)
                  .padding({ top: 6, bottom: 6 })
                  .fontColor(this.edWeekday === d ? this.tk().onPrimary : this.tk().onSurfaceVariant)
                  .backgroundColor(this.edWeekday === d ? this.tk().primary : this.tk().surface2)
                  .borderRadius(6)
                  .margin({ left: 2, right: 2 })
                  .onClick(() => {
                    this.edWeekday = d;
                  })
              }, (d: number) => 'wd' + d)
            }.width('100%')

            Text('节次（开始 / 结束）').fontSize(11).fontColor(this.tk().onSurfaceVariant).width('100%').margin({ top: 8 })
            Row() {
              TextInput({ text: String(this.edStart) })
                .type(InputType.Number).fontSize(13).layoutWeight(1)
                .onChange((v: string) => {
                  const n: number = Number(v);
                  if (Number.isFinite(n) && n >= 1 && n <= 13) {
                    this.edStart = Math.floor(n);
                  }
                })
              Text(' 至 ').fontSize(12).fontColor(this.tk().onSurfaceVariant)
              TextInput({ text: String(this.edEnd) })
                .type(InputType.Number).fontSize(13).layoutWeight(1)
                .onChange((v: string) => {
                  const n: number = Number(v);
                  if (Number.isFinite(n) && n >= 1 && n <= 13) {
                    this.edEnd = Math.floor(n);
                  }
                })
            }.width('100%')

            Text('上课周次（点选）').fontSize(11).fontColor(this.tk().onSurfaceVariant).width('100%').margin({ top: 8 })
            Flex({ wrap: FlexWrap.Wrap }) {
              ForEach(WEEKS,
                (w: number) => {
                  Text(String(w))
                    .fontSize(11).textAlign(TextAlign.Center)
                    .width(30).height(26)
                    .fontColor(this.weekSelected(w) ? this.tk().onPrimary : this.tk().onSurfaceVariant)
                    .backgroundColor(this.weekSelected(w) ? this.tk().primary : this.tk().surface2)
                    .borderRadius(5).margin(2)
                    .onClick(() => {
                      this.toggleWeek(w);
                    })
                }, (w: number) => 'wk' + w)
            }.width('100%')

            Row() {
              Button('保存')
                .height(32).fontSize(13)
                .backgroundColor(this.tk().primary).fontColor(this.tk().onPrimary)
                .onClick(() => {
                  this.save();
                })
              Button('取消')
                .height(32).fontSize(13).margin({ left: 8 })
                .onClick(() => {
                  this.closeEditor();
                })
            }.margin({ top: 12 })
          }
          .width('100%').padding({ left: 12, right: 12 })
        }
        .layoutWeight(1)
        // ⚠️ 顶对齐必须挂 Scroll 自身：加在内层 Column 上不生效（内容不足一屏会被垂直居中）
        .align(Alignment.Top)
      } else {
        // ── 列表 + 覆盖层管理 ──
        Scroll() {
          Column() {
            if (this.overlays.length > 0) {
              Text('我的修改（' + this.overlayCountText() + '）')
                .fontSize(11).fontColor(this.tk().onSurfaceVariant).width('100%').padding({ top: 4, bottom: 6 })
              ForEach(this.overlays, (o: CourseOverlay) => {
                Row() {
                  Text(this.overlayText(o))
                    .fontSize(12).fontColor(this.tk().onSurfaceVariant).layoutWeight(1)
                  Button('恢复')
                    .height(26).fontSize(11)
                    .onClick(() => {
                      this.restore(o);
                    })
                }
                .width('100%').padding(10).margin({ bottom: 6 })
                .backgroundColor(this.tk().surface).borderRadius(8)
              }, (o: CourseOverlay) => 'ov' + o.id)
            }

            Text(this.loading ? '读取课表…' : ('本学期课程（' + this.rows.length + ' 节，点「改」编辑）'))
              .fontSize(11).fontColor(this.tk().onSurfaceVariant).width('100%').padding({ top: 8, bottom: 6 })

            ForEach(this.rows, (row: MergedCourse) => {
              Column() {
                Row() {
                  Text(row.KCM.length > 0 ? row.KCM : '（无课名）')
                    .fontSize(14).fontWeight(FontWeight.Medium).fontColor(this.tk().onSurface)
                    .layoutWeight(1)
                  if (this.rowMark(row).length > 0) {
                    Text(this.rowMark(row))
                      .fontSize(10).fontColor(this.tk().primary)
                  }
                }.width('100%')
                Text(weekdayCn(row.SKXQ) + ' 第' + row.KSJC + '-' + row.JSJC + ' 节' +
                  (row.JASMC.length > 0 ? ' · ' + row.JASMC : '') +
                  (row.SKJS.length > 0 ? ' · ' + row.SKJS : ''))
                  .fontSize(11).fontColor(this.tk().onSurfaceVariant)
                  .width('100%').margin({ top: 2 })
                Row() {
                  Button('改')
                    .height(26).fontSize(11)
                    .onClick(() => {
                      this.openEdit(row);
                    })
                  if (row.localId < 0) {
                    Button('删')
                      .height(26).fontSize(11).margin({ left: 8 })
                      .onClick(() => {
                        const o: CourseOverlay | null = findOverlayById(this.overlays, -row.localId);
                        if (o !== null) {
                          this.restore(o);
                        }
                      })
                  } else {
                    Button('藏')
                      .height(26).fontSize(11).margin({ left: 8 })
                      .onClick(() => {
                        this.hide(row);
                      })
                  }
                }.margin({ top: 6 })
              }
              .width('100%').padding(10).margin({ bottom: 6 })
              .backgroundColor(this.tk().surface).borderRadius(8)
              .alignItems(HorizontalAlign.Start)
            }, (row: MergedCourse) => row.XNXQDM + '|' + row.KCH + '|' + row.SKXQ + '|' + row.KSJC)
          }
          .width('100%').padding({ left: 12, right: 12, bottom: 24 })
        }
        .layoutWeight(1)
        // ⚠️ 顶对齐必须挂 Scroll 自身：加在内层 Column 上不生效（内容不足一屏会被垂直居中）
        .align(Alignment.Top)
      }
    }
    .width('100%').height('100%')
    .backgroundColor(this.tk().background)
  }

}
