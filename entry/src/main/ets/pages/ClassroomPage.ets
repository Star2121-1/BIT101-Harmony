/**
 * 空教室页（M3-1/M3-2）
 *
 * 三层：校区 → 教学楼 → 教室（逐节忙闲）。
 * 数据源：`SchoolService.getCampuses/getBuildings` + `ClassroomService.getClassrooms`。
 *
 * 铁律落实：
 * - 0.4 「今天第几周 / 哪一天」必须写在屏幕上 —— 空教室结果是**特定某天**的，不写日期等于骗人
 * - 「查不到」与「这栋楼全满」分开：前者是失败（红字 + 重试），后者是事实（灰字）
 * - 逐栋加载：点哪栋拉哪栋，不一开始就把全校几百间都拉下来
 */

import { router } from '@kit.ArkUI';
import { palette, Palette } from '../core/theme/AppColors.ts';
import { STORAGE_DARK } from '../data/ThemeStore.ts';
import { Context } from '@kit.AbilityKit';
import { SchoolService, SchoolAuthError } from '../service/SchoolService.ts';
import { ClassroomService } from '../service/ClassroomService.ts';
import { BuildingInfo, CampusInfo, ClassroomRow } from '../core/model/SchoolModels.ts';
import { CourseCache, CachedSchedule } from '../data/CourseCache.ts';
import { Prefs } from '../data/Prefs.ts';
import { SessionStore, SessionSnapshot } from '../data/SessionStore.ts';
import { weeksContains, weekOf } from '../corelogic/CourseWeekdayLogic.ts';
import { parseISODate } from '../corelogic/timeutil.ts';
import { info, warn } from '../core/log/BitLog.ts';

const DAY_LABELS: string[] = ['一', '二', '三', '四', '五', '六', '日'];
const SECTIONS: number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];

@Entry
@Component
struct ClassroomPage {
  /** 订阅全局深浅色（由设置页切换、AppStorage 广播）。 */
  @StorageLink(STORAGE_DARK) isDark: boolean = false;
  @State loading: boolean = true;
  @State errorText: string = '';
  @State needLogin: boolean = false;
  @State term: string = '';
  @State week: number = 1;
  @State dayOfWeek: number = 1;
  @State dateStr: string = '';
  /** 校区/楼的教学周是否确定（开学日未知时为空教室查询的前提不成立）。 */
  @State weekKnown: boolean = false;

  @State campuses: CampusInfo[] = [];
  @State campusCode: string = '';
  @State buildings: BuildingInfo[] = [];
  @State buildingsLoading: boolean = false;

  @State openBuilding: string = '';
  @State rooms: ClassroomRow[] = [];
  @State roomsLoading: boolean = false;
  @State roomsError: string = '';

  aboutToAppear(): void {
    this.load();
  }

  private async load(): Promise<void> {
    this.loading = true;
    this.errorText = '';
    this.needLogin = false;
    try {
      const ctx: Context = getContext(this) as Context;
      const snap: SessionSnapshot = await SessionStore.snapshot();
      if (!snap.hasSchoolCookies) {
        this.needLogin = true;
        this.errorText = '空教室查询需要学校教务会话。请先登录。';
        this.loading = false;
        return;
      }

      // ⚠️ 必须用**当前学期**，不能用「上次查看的学期」——
      // 栽过（2026-10-20）：用户切到 2025-2026-2 看历史课表后再进空教室，
      // 页面按那个学期的开学日算出「第 34 周」，空教室结果是错的。
      this.term = await SchoolService.getCurrentTerm(ctx);
      // 开学日优先用该学期自己的课表缓存（省一次教务请求）
      const cached: CachedSchedule | null = await CourseCache.load(this.term);
      if (cached !== null) {
        this.applyDate(cached.firstDay);
      }
      if (!this.weekKnown) {
        const firstDay: string = await SchoolService.getFirstDay(ctx, this.term);
        this.applyDate(firstDay);
      }

      const list: CampusInfo[] = await SchoolService.getCampuses(ctx);
      this.campuses = list;
      if (list.length > 0) {
        // 优先用设置页里选的默认校区（M6-5）；
        // 没设过才回退「良乡」（课程都在这边），再找不到就用第一个。
        let pick: string = '';
        try {
          pick = await Prefs.getString('default_campus_code', '');
        } catch (e) {
          pick = '';
        }
        let found: boolean = false;
        for (let i = 0; i < list.length; i++) {
          if (pick.length > 0 && list[i].code === pick) {
            found = true;
            break;
          }
        }
        if (!found) {
          pick = list[0].code;
          for (let i = 0; i < list.length; i++) {
            if (list[i].displayName.indexOf('良乡') >= 0) {
              pick = list[i].code;
              break;
            }
          }
        }
        await this.selectCampus(pick);
      }
      info('ClassroomPage loaded term=' + this.term + ' week=' + this.week +
        ' dow=' + this.dayOfWeek + ' campuses=' + list.length);
    } catch (e) {
      if (e instanceof SchoolAuthError) {
        this.needLogin = true;
        this.errorText = '教务会话已过期或无效：' + (e as Error).message;
      } else {
        this.errorText = '取不到空教室数据（' + (e as Error).message + '）';
      }
      warn('ClassroomPage load fail: ' + JSON.stringify(e));
    }
    this.loading = false;
  }

  /** 由开学日推「今天是第几周 / 星期几 / 日期」。 */
  private applyDate(firstDay: string): void {
    const firstEpoch: number | null = parseISODate(firstDay);
    const d: Date = new Date();
    const todayEpoch: number = Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
    const mm: string = String(d.getMonth() + 1).padStart(2, '0');
    const dd: string = String(d.getDate()).padStart(2, '0');
    this.dateStr = d.getFullYear() + '-' + mm + '-' + dd;
    this.dayOfWeek = ((todayEpoch + 3) % 7 + 7) % 7 + 1;
    if (firstEpoch !== null) {
      const w: number = weekOf(firstEpoch, todayEpoch);
      this.week = w >= 1 ? w : 1;
      this.weekKnown = true;
    }
  }

  private async selectCampus(code: string): Promise<void> {
    if (code === this.campusCode && this.buildings.length > 0) {
      return;
    }
    this.campusCode = code;
    this.openBuilding = '';
    this.rooms = [];
    this.roomsError = '';
    this.buildingsLoading = true;
    try {
      const ctx: Context = getContext(this) as Context;
      this.buildings = await SchoolService.getBuildings(ctx, code);
      info('ClassroomPage buildings campus=' + code + ' n=' + this.buildings.length);
    } catch (e) {
      this.buildings = [];
      warn('ClassroomPage buildings fail: ' + JSON.stringify(e));
    }
    this.buildingsLoading = false;
  }

  private async toggleBuilding(code: string): Promise<void> {
    if (this.openBuilding === code) {
      this.openBuilding = '';
      this.rooms = [];
      return;
    }
    this.openBuilding = code;
    this.rooms = [];
    this.roomsError = '';
    if (!this.weekKnown) {
      this.roomsError = '开学日未知，无法确定「第几周」，空教室查询不可用。请先在课表页刷新一次。';
      return;
    }
    this.roomsLoading = true;
    try {
      const ctx: Context = getContext(this) as Context;
      const rows: ClassroomRow[] = await ClassroomService.getClassrooms(
        ctx, this.term, this.week, this.dayOfWeek, this.dateStr, code);
      this.rooms = rows;
      info('ClassroomPage rooms building=' + code + ' n=' + rows.length);
      if (rows.length === 0) {
        this.roomsError = '这栋楼没有返回教室（可能该楼当天无数据）';
      }
    } catch (e) {
      this.roomsError = '取不到这栋楼的教室（' + (e as Error).message + '）';
      warn('ClassroomPage rooms fail: ' + JSON.stringify(e));
    }
    this.roomsLoading = false;
  }

  /** 一栋楼里当前时空闲的教室数（只在已加载时给，加载前不显示假数字）。 */
  private freeCount(): number {
    if (this.rooms.length === 0) {
      return 0;
    }
    let n: number = 0;
    for (let i = 0; i < this.rooms.length; i++) {
      if (this.rooms[i].busySections.length < SECTIONS.length) {
        n++;
      }
    }
    return n;
  }

  /** 忙闲摘要：'全天空闲' / '3-5 节占用' —— 比一排小方块更省地方，也好读。 */
  private busySummary(r: ClassroomRow): string {
    const busy: number[] = r.busySections;
    if (busy.length === 0) {
      return '全天空闲';
    }
    if (busy.length >= SECTIONS.length) {
      return '全天占用';
    }
    // 连续区间合并：[3,4,5,9] → '3-5, 9'
    const parts: string[] = [];
    let start: number = busy[0];
    let prev: number = busy[0];
    for (let i = 1; i < busy.length; i++) {
      if (busy[i] === prev + 1) {
        prev = busy[i];
        continue;
      }
      parts.push(start === prev ? String(start) : (start + '-' + prev));
      start = busy[i];
      prev = busy[i];
    }
    parts.push(start === prev ? String(start) : (start + '-' + prev));
    return parts.join(', ') + ' 节占用';
  }

  /** 当前配色（语义色见 core/theme/AppColors.ts）。 */
  private p(): Palette {
    return palette(this.isDark);
  }

  build() {
    Column() {
      Row() {
        Button('返回').height(32).fontSize(12).onClick(() => {
          router.back();
        })
        Column() {
          Text('空教室').fontSize(16).fontWeight(FontWeight.Bold)
          Text('第 ' + this.week + ' 周 · 周' + DAY_LABELS[this.dayOfWeek - 1] +
            (this.dateStr.length > 0 ? ' · ' + this.dateStr : '') +
            (this.term.length > 0 ? ' · ' + this.term : ''))
            .fontSize(11).fontColor(this.p().textMuted)
        }
        .alignItems(HorizontalAlign.Start)
        .layoutWeight(1)
        .margin({ left: 10 })
        Button('刷新').height(32).fontSize(12).enabled(!this.loading).onClick(() => {
          this.load();
        })
      }
      .width('100%').padding({ left: 12, right: 12, top: 10, bottom: 6 })

      if (this.errorText.length > 0) {
        Column() {
          Text(this.errorText).fontSize(13).fontColor(this.p().error).width('100%')
          if (this.needLogin) {
            Button('去登录').height(40).margin({ top: 12 }).onClick(() => {
              router.pushUrl({ url: 'pages/LoginPage' });
            })
          }
        }
        .width('100%').padding({ left: 16, right: 16, top: 8 })
      }

      // 校区 chips
      if (this.campuses.length > 0) {
        Scroll() {
          Row() {
            ForEach(this.campuses, (c: CampusInfo) => {
              Text(c.displayName.length > 0 ? c.displayName : c.code)
                .fontSize(12)
                .fontColor(c.code === this.campusCode ? this.p().textOnAccent : this.p().textMuted)
                .backgroundColor(c.code === this.campusCode ? this.p().accent : this.p().bgAlt)
                .padding({ left: 12, right: 12, top: 5, bottom: 5 })
                .borderRadius(13)
                .margin({ right: 6 })
                .onClick(() => {
                  this.selectCampus(c.code);
                })
            }, (c: CampusInfo) => 'c_' + c.code)
          }
          .padding({ left: 12, right: 12 })
        }
        .scrollable(ScrollDirection.Horizontal)
        .scrollBar(BarState.Off)
        .width('100%')
        .padding({ bottom: 8 })
      }

      if (this.loading) {
        Text('正在读校区与教学楼…').fontSize(13).fontColor(this.p().textMuted).width('100%').padding(16)
      } else if (this.buildingsLoading) {
        Text('正在读教学楼…').fontSize(13).fontColor(this.p().textMuted).width('100%').padding(16)
      } else {
        List() {
          ForEach(this.buildings, (b: BuildingInfo) => {
            ListItem() {
              Column() {
                Row() {
                  Text(b.buildingName.length > 0 ? b.buildingName : b.buildingIndex)
                    .fontSize(14).fontWeight(FontWeight.Medium).layoutWeight(1)
                  Text(this.openBuilding === b.buildingIndex ? '收起' : '展开')
                    .fontSize(11).fontColor(this.p().accent)
                }
                .width('100%')
                .onClick(() => {
                  this.toggleBuilding(b.buildingIndex);
                })

                if (this.openBuilding === b.buildingIndex) {
                  if (this.roomsLoading) {
                    Text('正在查这栋楼的教室（约 2~5 秒）…')
                      .fontSize(12).fontColor(this.p().textMuted).width('100%').margin({ top: 6 })
                  } else if (this.roomsError.length > 0) {
                    Text(this.roomsError)
                      .fontSize(12).fontColor(this.p().error).width('100%').margin({ top: 6 })
                  } else {
                    Text('共 ' + this.rooms.length + ' 间教室 · 现在空闲 ' + this.freeCount() + ' 间')
                      .fontSize(11).fontColor(this.p().textMuted).width('100%').margin({ top: 6, bottom: 4 })
                    ForEach(this.rooms, (r: ClassroomRow) => {
                      Row() {
                        Column() {
                          Text(r.JASMC.length > 0 ? r.JASMC : '（未命名）')
                            .fontSize(12).width('100%')
                          Text((r.JASLXDM_DISPLAY.length > 0 ? r.JASLXDM_DISPLAY : '教室') +
                            (r.SKZWS.length > 0 ? ' · ' + r.SKZWS + ' 座' : ''))
                            .fontSize(10).fontColor(this.p().textMuted).width('100%')
                        }
                        .alignItems(HorizontalAlign.Start)
                        .layoutWeight(1)
                        Text(this.busySummary(r))
                          .fontSize(10)
                          .fontColor(r.busySections.length === 0 ? this.p().success
                            : (r.busySections.length >= SECTIONS.length ? this.p().error : this.p().warn))
                          .maxLines(1)
                          .textOverflow({ overflow: TextOverflow.Ellipsis })
                          .width('46%')
                          .textAlign(TextAlign.End)
                      }
                      .width('100%')
                      .padding({ top: 5, bottom: 5 })
                      .border({ width: { bottom: 0.5 }, color: this.p().bgAlt })
                    }, (r: ClassroomRow) => 'r_' + b.buildingIndex + '_' + r.JASMC)
                  }
                }
              }
              .width('100%')
              .padding(12)
              .backgroundColor(this.p().bgCard)
              .borderRadius(8)
              .border({ width: 0.5, color: this.p().bgAlt })
            }
            .margin({ bottom: 8 })
          }, (b: BuildingInfo) => 'b_' + b.campusCode + '_' + b.buildingIndex)
        }
        .layoutWeight(1)
        .width('100%')
        .padding({ left: 12, right: 12 })
        .scrollBar(BarState.Auto)
      }

      Text(this.weekKnown ? '空教室结果对应上面这一天' : '开学日未知，结果可能不准')
        .fontSize(11).fontColor(this.p().textMuted)
        .width('100%')
        .padding({ left: 12, right: 12, top: 4, bottom: 8 })
    }
    .width('100%').height('100%')
    .backgroundColor(this.p().bgAlt)
  }
}
