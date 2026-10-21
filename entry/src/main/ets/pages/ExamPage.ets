/**
 * 考试安排页（M2-6）
 *
 * 数据来源：`/jwapp/sys/wdksapMobile/modules/ksap/cxxsksap.do`（对照 BIT-Login `Exam.kt`）。
 * 由课表页带 `term` 参数跳进来；没带就现查当前学期。
 *
 * 铁律落实：
 * - 0.4 「没有考试」与「取不到」必须分开显示 —— 前者是事实，后者是失败。
 * - 0.7 会话过期给明确出口（回登录页），不显示成空列表。
 */

import { router } from '@kit.ArkUI';
import { palette, Palette } from '../core/theme/AppColors.ts';
import { STORAGE_DARK } from '../data/ThemeStore.ts';
import { Context } from '@kit.AbilityKit';
import { SchoolService, SchoolAuthError } from '../service/SchoolService.ts';
import { ExamRow } from '../core/model/SchoolModels.ts';
import { ExamCache } from '../data/ExamCache.ts';
import { SessionStore, SessionSnapshot } from '../data/SessionStore.ts';
import { info, warn } from '../core/log/BitLog.ts';

@Entry
@Component
struct ExamPage {
  /** 订阅全局深浅色（由设置页切换、AppStorage 广播）。 */
  @StorageLink(STORAGE_DARK) isDark: boolean = false;
  @State loading: boolean = true;
  @State errorText: string = '';
  @State needLogin: boolean = false;
  @State term: string = '';
  @State exams: ExamRow[] = [];

  aboutToAppear(): void {
    this.load();
  }

  private paramTerm(): string {
    try {
      const p: Object | undefined = router.getParams() as Object | undefined;
      if (p === undefined || p === null) {
        return '';
      }
      const rec: Record<string, Object> = p as Record<string, Object>;
      const t: Object | undefined = rec['term'];
      return typeof t === 'string' ? t as string : '';
    } catch (e) {
      return '';
    }
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
        this.errorText = '考试安排需要学校教务会话。请先登录。';
        this.loading = false;
        return;
      }
      let term: string = this.paramTerm();
      if (term.length === 0) {
        term = await SchoolService.getCurrentTerm(ctx);
      }
      this.term = term;
      const list: ExamRow[] = await SchoolService.getExams(ctx, term);
      this.exams = list;
      await ExamCache.save(term, list); // M7-2：落地供离线排期
      info('ExamPage loaded term=' + term + ' rows=' + list.length);
    } catch (e) {
      if (e instanceof SchoolAuthError) {
        this.needLogin = true;
        this.errorText = '教务会话已过期或无效：' + (e as Error).message;
      } else {
        this.errorText = '取不到考试安排（' + (e as Error).message + '）';
      }
      warn('ExamPage load fail: ' + JSON.stringify(e));
    }
    this.loading = false;
  }

  /** 日期部分（KSRQ 可能带零点时间：`2026-11-05 00:00:00`）。 */
  private dateOnly(ksrq: string): string {
    if (ksrq.length >= 10) {
      return ksrq.substring(0, 10);
    }
    return ksrq;
  }

  /** 当前配色（语义色见 core/theme/AppColors.ts）。 */
  private p(): Palette {
    return palette(this.isDark);
  }

  build() {
    Column() {
      Row() {
        Button('返回')
          .height(32).fontSize(12)
          .onClick(() => {
            router.back();
          })
        Column() {
          Text('考试安排')
            .fontSize(16).fontWeight(FontWeight.Bold)
          Text(this.term.length > 0 ? this.term : '加载中…')
            .fontSize(11).fontColor(this.p().textMuted)
        }
        .alignItems(HorizontalAlign.Start)
        .layoutWeight(1)
        .margin({ left: 10 })
        Button('刷新')
          .height(32).fontSize(12)
          .enabled(!this.loading)
          .onClick(() => {
            this.load();
          })
      }
      .width('100%').padding({ left: 12, right: 12, top: 10, bottom: 6 })

      if (this.errorText.length > 0) {
        Column() {
          Text(this.errorText).fontSize(13).fontColor(this.p().error).width('100%')
          if (this.needLogin) {
            Button('去登录')
              .height(40).margin({ top: 12 })
              .onClick(() => {
                router.pushUrl({ url: 'pages/LoginPage' });
              })
          }
        }
        .width('100%').padding({ left: 16, right: 16, top: 8 })
      }

      if (this.loading) {
        Text('正在取考试安排（约 5~15 秒）…')
          .fontSize(13).fontColor(this.p().textMuted)
          .width('100%').padding(16)
      } else if (this.exams.length === 0 && this.errorText.length === 0) {
        // 取到了但确实没有考试 —— 这是事实，不能和「取不到」混为一谈
        Text('本学期没有考试安排')
          .fontSize(13).fontColor(this.p().textMuted)
          .width('100%').padding(16)
      } else {
        List() {
          ForEach(this.exams, (e: ExamRow) => {
            ListItem() {
              Column() {
                Row() {
                  Text(e.KCM.length > 0 ? e.KCM : '（未命名考试）')
                    .fontSize(14).fontWeight(FontWeight.Medium).layoutWeight(1)
                  if (e.KSMC.length > 0) {
                    Text(e.KSMC)
                      .fontSize(10).fontColor(this.p().accent)
                      .padding({ left: 6, right: 6, top: 2, bottom: 2 })
                      .backgroundColor(this.p().bgSubtle).borderRadius(4)
                  }
                }
                .width('100%')
                Text((e.KSSJMS.length > 0 ? e.KSSJMS : this.dateOnly(e.KSRQ)) +
                  (e.JASMC.length > 0 ? ' · ' + e.JASMC : '') +
                  (e.ZWH.length > 0 ? ' · 座位 ' + e.ZWH : ''))
                  .fontSize(12).fontColor(this.p().textSecondary)
                  .width('100%').margin({ top: 4 })
                if (e.ZJJSXM.length > 0 || e.KCH.length > 0) {
                  Text((e.ZJJSXM.length > 0 ? e.ZJJSXM : '') +
                    (e.KCH.length > 0 ? ' · ' + e.KCH : ''))
                    .fontSize(11).fontColor(this.p().textMuted)
                    .width('100%').margin({ top: 2 })
                }
              }
              .width('100%')
              .padding(12)
              .backgroundColor(this.p().bgCard)
              .borderRadius(8)
              .border({ width: 0.5, color: this.p().bgAlt })
            }
            .margin({ bottom: 8 })
          }, (e: ExamRow) => 'ex_' + e.KCH + '_' + e.KSRQ)
        }
        .layoutWeight(1)
        .width('100%')
        .padding({ left: 12, right: 12 })
        .scrollBar(BarState.Auto)
      }

      Text('共 ' + this.exams.length + ' 场考试')
        .fontSize(11).fontColor(this.p().textMuted)
        .width('100%')
        .padding({ left: 12, right: 12, top: 4, bottom: 8 })
    }
    .width('100%').height('100%')
    .backgroundColor(this.p().bgAlt)
  }
}
