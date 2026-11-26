# 域 02 差距文档：课表 / DDL / 教学调整 / 延河课堂

> 只读审计产出，供后续逐项修复。判断均附 `file:line`；「⚠️」绝不写成「✅」；未查到实现的写「未找到证据」。
> 进度数字**唯一引用** `docs/ROADMAP.md`；本文不做网络、真机、构建验证。

---

## 1. 域范围与实际读过的文件

**域范围**：课表网格与设置、DDL（作业截止）、教学调整（放假/补课）、延河课堂（eclass 动态）、空教室/楼栋索引、周次语义、缓存刷新、ICS 导出。

**路径简称**（表格证据列使用）：
- `[A]` = `F:/Agent_Work/BIT-102/BIT101-seat/features/schedule/src/main/java/cn/bit101/android/features/schedule/`
- `[AC]` = `F:/Agent_Work/BIT-102/BIT101-seat/config/src/main/java/cn/bit101/android/config/`
- `[AD]` = `F:/Agent_Work/BIT-102/BIT101-seat/data/src/main/java/cn/bit101/android/data/`
- `[H]` = `F:/Agent_Work/BIT-102/harmony/BIT101-harmony/entry/src/main/ets/`
- `[R]` = `F:/Agent_Work/BIT-102/harmony/BIT101-harmony/docs/ROADMAP.md`

**实际读过（关键区段）**：

| 端 | 文件 |
|---|---|
| Android | `[AC]setting/base/AppPalette.kt`、`[AC]setting/base/CourseScheduleSettings.kt`、`[AC]setting/DefaultCourseScheduleSettings.kt`（模块内）、`[AD]schedule/CourseColorLogic.kt`、`[AD]schedule/CourseColorResolver.kt`、`[A]course/CourseSchedule.kt`、`[A]course/CourseScheduleCalendar.kt`、`[A]course/CourseScheduleAdjustmentLogic.kt`、`[A]ddl/DDLSchedule.kt`、`[A]ddl/DDLScheduleViewModel.kt`、`[A]ddl/DdlListOrder.kt`、`[A]activity/EclassActivityScreen.kt`、`[A]course/ScheduleItemColor.kt`；全局定位 ICS：`api/.../JxzxehallApiService.kt`、`data/.../repo/DefaultCoursesRepo.kt`、`data/.../repo/base/CoursesRepo.kt`、`data/.../model/http/bit101/ScoreQueryModel.kt`、`features/setting/.../CalendarViewModel.kt`、`CalendarSettingPage.kt`、`app/src/main/res/xml/file_paths.xml` |
| 鸿蒙 | `[H]pages/SchedulePage.ets`、`[H]pages/DdlPage.ets`、`[H]pages/EclassActivityPage.ets`、`[H]pages/TeachingAdjustmentPage.ets`（存在性，未逐行）、`[H]pages/TimeTablePage.ets`（存在性，未逐行）、`[H]pages/EclassLoginPage.ets`（存在性，未逐行）、`[H]service/SchoolService.ts`（ICS 检索）、`[H]service/EclassService.ts`（引用）、`[H]service/EclassSyncService.ts`、`[H]service/TeachingAdjustmentService.ts`、`[H]corelogic/CourseColorLogic.ts`、`[H]corelogic/CourseWeekdayLogic.ts`、`[H]corelogic/DdlSourceLogic.ts`、`[H]corelogic/TeachingAdjustmentView.ts`、`[H]core/theme/CoursePalette.ts`、`[H]data/CourseCache.ts`、`[H]data/ScheduleDisplayStore.ts`；全局 Grep：ICS / `CourseColorFamily` / `Morandi` / `colorOverride` / 系统日历 / 滑动切周 |
| 参考 | `[R]ROADMAP.md`、`docs/FULL-PARITY-PLAN.md` |

---

## 2. 功能对照表

状态：✅对齐 ｜ ⚠️部分/有差异 ｜ ❌缺失 ｜ ⛔平台不可行/合规禁止 ｜ 🚫明确不做

| # | 功能点 | Android | 鸿蒙 | 状态 | 证据 (file:line) |
|---|---|---|---|---|---|
| 1 | 课表网格（周次/节次/今日高亮/跨节块） | 完整 | 完整，`buildColumn` 同源 | ✅ | `[A]course/CourseScheduleCalendar.kt:64-413`；`[H]pages/SchedulePage.ets:585-621`；`[R]:382` M2-2 |
| 2 | **课程配色族** Auto/Legacy/Classic/Morandi/Brand | 五档 + 单测 | **仅一套 12 色**，无族切换 | ❌ | `[AC]setting/base/CourseScheduleSettings.kt:72-119`；`[AD]schedule/CourseColorResolver.kt:33-39`；`[H]core/theme/CoursePalette.ts:18-47`；全仓 Grep `CourseColorFamily/Morandi` 无匹配 |
| 3 | 单课颜色覆盖（课名→色号，可改/重置） | 有，详情对话框可改 | **未找到证据** | ❌ | `[A]course/CourseSchedule.kt:287-295`；`[AC]setting/base/CourseScheduleSettings.kt:149-162,227`；鸿蒙 Grep `colorOverride/选色` 无匹配 |
| 4 | 课块深浅档 shadeOf / fillAlphaOf（9 档） | 有，层次编码 | 仅 `of()` 色号，无深浅 | ❌ | `[AD]schedule/CourseColorLogic.kt:44-68`；`[H]corelogic/CourseColorLogic.ts:41-44` |
| 5 | 调休列配色（放假灰/补课第三色） | `tinted()` 变体 | `tintedScheduleColors` 同源 | ✅ | `[A]course/CourseScheduleCalendar.kt:108-121`；`[H]pages/SchedulePage.ets:9-10` |
| 6 | 教学调整应用到网格（放假保留/补课换天/角标） | 三条规则 | 同源移植 | ✅ | `[A]course/CourseScheduleAdjustmentLogic.kt:40-84`；`[H]corelogic/CourseWeekdayLogic.ts:19-29`；`[R]:387` M2-7 |
| 7 | 教学调整提示条连续合并 summarize | 连续放假合并成一段 | 仅 `todayBadge`「只讲今天」，未找到 summarize 等价 | ⚠️ | `[A]course/CourseScheduleAdjustmentLogic.kt:130-151`；`[H]corelogic/TeachingAdjustmentView.ts:107-120` |
| 8 | 教学调整独立列表页（未来升序/过去降序） | 无独立页，仅当周 banner | 有 `TeachingAdjustmentPage` | ✅（鸿蒙超集） | `[A]course/CourseSchedule.kt:260-265,365-406`；`[H]corelogic/TeachingAdjustmentView.ts:51-105`；`[R]:388` M2-7b（真机未验） |
| 9 | 课表显示开关（周末×2/边框/今日/分割线/时间线/考试） | 7 项全接 | 7 键定义，页面仅消费**边框/分割线 2 项** | ⚠️ | `[AC]setting/base/CourseScheduleSettings.kt:182-212`；`[H]data/ScheduleDisplayStore.ts:12-15`；`[H]pages/SchedulePage.ets:1039,1215`；`[R]:70`,`:96` |
| 10 | 课程详情（学分/学时/性质/周次人话/教室定位） | 对话框 + `locateOnMap`（匹配不到明说） | 内联面板；教室定位走搜索，未找到等价「暂未收录」文案 | ⚠️ | `[A]course/CourseSchedule.kt:48-58,283-298`；`[R]:385` M2-5；鸿蒙定位等价未找到证据 |
| 11 | 手动改课表覆盖层（改/藏/增/恢复，重同步不覆盖） | 有 | 有 `CourseOverlayLogic/Store/OverlayPage` | ✅ | `[R]:389` M2-8（真机全验）；Android `docs/course-overlay.md` |
| 12 | 课表缓存与离线可读 | Room DB 持久化 | Preferences JSON，按学期分键，cache-first | ✅（架构差异） | `[H]data/CourseCache.ts:34-49,65-73`；`[R]:384` M2-4、`:340` |
| 13 | 学期切换 | 有 | 有 `switchTerm` | ✅ | `[R]:383` M2-3；`[H]pages/SchedulePage.ets` `switchTerm` |
| 14 | 时间表自定义（13 节可改/重叠校验） | 有 | `TimeTablePage` | ✅ | `[R]:430` M6-2（`test-timetable.mjs` 28 条） |
| 15 | **ICS 导出**（服务端生成 + 系统日历） | 完整：生成/下载/FileProvider 分享 | **未找到实现**（Grep ICS/VCALENDAR 无匹配） | ❌ | `features/setting/.../CalendarViewModel.kt:206-268`；`CalendarSettingPage.kt:106,443`；`data/.../repo/base/CoursesRepo.kt:77-79`；`file_paths.xml:6` |
| 16 | DDL 未完成/已完成两栏 | 分区标题 + 单列表 | 1:1 两栏 | ✅ | `[A]ddl/DDLSchedule.kt:170-204`；`[H]pages/DdlPage.ets:367-395`；`[R]:411` M4-3 |
| 17 | DDL 多源（本地/乐学/eclass） | 三源并存 | eclass + 本地可切；**乐学 `usable:false`** | ⚠️ | `[A]ddl/DDLScheduleViewModel.kt:35-53,223-263,275-279`；`[H]corelogic/DdlSourceLogic.ts:39-58,127-129` |
| 18 | eclass 作业同步（逐课程/保留 done/单课失败不拖垮） | `EclassDdlSyncer` | `EclassSyncService` 同源 | ✅ | `[H]service/EclassSyncService.ts:91-126`；`[R]:410` M4-2 |
| 19 | DDL 排序切换（按截止/按课程） | 仅按截止升/降 | 两档可切（M12 新增） | ✅（鸿蒙超集） | `[A]ddl/DdlListOrder.kt:19-24`；`[H]pages/DdlPage.ets:105-112`；`[R]:141` M12-5 |
| 20 | DDL 详情/编辑对话框（可改/删除同步条目） | 有 `DetailDialog`/`EditDialog` | 仅新增 + 长按删本地条目；**未找到详情/编辑** | ❌ | `[A]ddl/DDLSchedule.kt:64-84`；`[H]pages/DdlPage.ets:197-247` |
| 21 | 学士帽平台选择弹窗（延河/乐学二选一） | 有，App 内 WebView | 直接开 eclass 固定 URL，无选择 | ⚠️ | `[A]ddl/DDLSchedule.kt:86-101,267-319`；`[H]pages/DdlPage.ets:262-273` |
| 22 | DDL 变动后立刻重排提醒 | `notifyReschedule()` 全 CRUD 调用 | 未找到等价证据 | ⚠️ | `[A]ddl/DDLScheduleViewModel.kt:111-113,119,141,160,168,277` |
| 23 | DDL 组件深链定位滚动（flatIndexOf） | 有 | 未找到证据 | ⚠️ | `[A]ddl/DDLSchedule.kt:139-152`；`[A]ddl/DdlListOrder.kt:31-48` |
| 24 | 首次进入「获取乐学日程」门槛 | 无订阅链接时整页只有按钮 | 无门槛，直接列表 | ⚠️ | `[A]ddl/DDLSchedule.kt:103-128` |
| 25 | 延河课堂动态：卡片/类型标签/相对时间 | 1:1 | 1:1（含逐字空态） | ✅ | `[A]activity/EclassActivityScreen.kt:180-226`；`[H]pages/EclassActivityPage.ets:150-181,252-255`；`[R]:412` M4-4 |
| 26 | 动态页三态空态（可用/未登录/故障） | 三态 | 三态逐字对齐 | ✅ | `[A]activity/EclassActivityScreen.kt:255-309`；`[H]pages/EclassActivityPage.ets:192-255` |
| 27 | StaleDataBanner（有数据时刷新失败不清空） | 有 | 未找到证据（仅空态内故障态） | ⚠️ | `[A]activity/EclassActivityScreen.kt:119-123,234-253`；鸿蒙未找到证据 |
| 28 | 动态页组件深链定位滚动 | 有 | 未找到证据 | ⚠️ | `[A]activity/EclassActivityScreen.kt:83-96` |
| 29 | 教室→地图定位（匹配不到明说「暂未收录」） | `locateOnMap` | 走搜索定位，未找到等价文案 | ⚠️ | `[A]course/CourseSchedule.kt:48-58` |
| 30 | 空教室搜索 / 楼栋索引 | 瓦片地图 + 搜索 | 楼栋索引 + `geo:`，无瓦片 | ⚠️ | `docs/FULL-PARITY-PLAN.md:129-135`；`[R]:135` M3 5/5 |

---

## 3. 关键差异详述

### 3.1 课表配色族（差异最大，P0）
Android 有独立第三轴 `CourseColorFamily = Auto / Legacy / Classic / Morandi / Brand`（`[AC]setting/base/CourseScheduleSettings.kt:72-119`，默认 Legacy），`Auto` 按 `AppPalette` 解析为 Legacy 或 Classic（`[AD]schedule/CourseColorResolver.kt:33-39`），并有单课覆盖 `courseColorOverrides`（同文件 :149-162,227）与 9 档深浅 `[AD]schedule/CourseColorLogic.kt:44-68`。

鸿蒙**只有一套亮/暗 12 色表**（`[H]core/theme/CoursePalette.ts:18-47`）与一个 `of()` 哈希（`[H]corelogic/CourseColorLogic.ts:41-44`），全仓 Grep `CourseColorFamily / Morandi / colorOverride` 无匹配。两端默认都是统色，`[R]:193` 已真机对齐默认观感，**故差异不在首屏颜色而在「用户无法切换族与单课改色」**——与「UI/外观/配色肉眼无区别」的用户口径冲突。

### 3.2 滑动切周
方向**与直觉相反**：Android 切周仅两颗悬浮按钮（`[A]course/CourseScheduleCalendar.kt:386-395`，其 `draggable` 只用于 FAB 垂直拖动 :372-381）；鸿蒙有左右滑动（`SwipeGesture` + `WeekNav.ts`，`[H]pages/SchedulePage.ets:643-651,1066-1072`），`[R]:140` M12 记载为新增。鸿蒙为超集，无需补 Android。

### 3.3 DDL 多源（eclass / 本地）
Android 三源并存：`main` 本地 / `lexue` 乐学 ICS / `eclass` 延河课堂（`[A]ddl/DDLScheduleViewModel.kt:35-53,223-263,275-279`），设置页有刷新总线 `EclassRefreshBus`。鸿蒙实现 eclass + 本地两源的开关与过滤（`[H]corelogic/DdlSourceLogic.ts:39-58,117-135`），`EclassSyncService` 保留了「单课失败不拖垮 + 保留 done + 保留旧缓存」纪律（`[H]service/EclassSyncService.ts:91-126`）。乐学被明确标为 `usable:false / 接口未验证`，`[H]corelogic/DdlSourceLogic.ts:52-57,127-129`；`[R]:216` 记真实登录正路径未验。

### 3.4 教学调整页
Android 没有独立列表页，只有课表当周 banner（`[A]course/CourseSchedule.kt:365-406`）+ 连续合并 summarize（`[A]course/CourseScheduleAdjustmentLogic.kt:130-151`）。鸿蒙有 `TeachingAdjustmentPage` + 未来/过去分组逻辑（`[H]corelogic/TeachingAdjustmentView.ts:51-105`），属超集，但 `[R]:388` 明示「真机未验」；且鸿蒙 `todayBadge` 只讲今天（`[H]corelogic/TeachingAdjustmentView.ts:107-120`），未找到连续合并等价。

### 3.5 搜索 / 楼栋索引
`docs/FULL-PARITY-PLAN.md:129-135` 记载鸿蒙 `CampusMapPage` 是楼栋索引 + `geo:`，Android 有瓦片但无建筑多边形。课表内教室→地图定位 Android 明确「匹配不到说暂未收录」（`[A]course/CourseSchedule.kt:48-58`），鸿蒙走搜索定位，未找到等价诚实文案。

### 3.6 周次语义
`[H]corelogic/CourseWeekdayLogic.ts:32-42` 的 `weekOf = floor(days/7)+1` / `weeksContains = includes([week])` 已 1:1 移植。`[R]:221` 如实标注：**旧学期周次语义未实证**（无原版内部页可拍）；`[R]:385` 记周次已从标记串改为人话。

### 3.7 ICS 导出
Android 完整：服务端生成 + 下载 + FileProvider 分享（`features/setting/.../CalendarViewModel.kt:206-268`、`CalendarSettingPage.kt:106,443`、`app/src/main/res/xml/file_paths.xml:6`）。认证主机陷阱：`data/.../model/http/bit101/ScoreQueryModel.kt:47` 记「不声明 service=jxz 就 409」。鸿蒙 `SchoolService.ts` 与全仓 Grep 均**未找到 ICS/VCALENDAR 实现**；`[H]service/ScoreService.ts:208-210` 的 409 只属于成绩检查，与 ICS 无关。

---

## 4. 可执行修复清单

| 编号 | 改动点 | 鸿蒙文件 | 验收判据（可证伪） | 风险 | 优先级 |
|---|---|---|---|---|---|
| S01 | 补 `CourseColorFamily` 五档 + `Auto` 按 palette 解析 + 设置入口 | `[H]core/theme/CoursePalette.ts`、`[H]data/Prefs.ts`、`SettingsPage.ets` | 设置页选 Morandi 后课表 12 色取值与 Android 逐格一致；选 Legacy 时 12 支同值 | 中（改首帧色需全端回归） | **P0** |
| S02 | 补单课颜色覆盖（详情对话框选色/重置，落偏好） | `[H]pages/SchedulePage.ets`、新增 `corelogic/CourseColorOverrideLogic.ts` | 对「数据结构」改色号 7 后重进仍为 7；重同步课表不覆盖 | 中 | **P0** |
| S03 | 补 ICS 导出（服务端生成 + 拉 ICS + 导入系统日历） | `[H]service/SchoolService.ts`、新增 `[H]pages` 设置项 | 有教务会话时点导出生成 `.ics`；未声明 service=jxz 时返回 409 而非空 | 高（认证主机 409 + 平台分享通道） | P1 |
| S04 | 补 DDL 详情/编辑对话框（可改任意条目、删除） | `[H]pages/DdlPage.ets` | 点 eclass 同步条目能进详情并改时间，重同步保留改动 | 中 | P1 |
| S05 | 补齐课表显示开关消费（周末/今日/时间线/考试） | `[H]pages/SchedulePage.ets`、`[H]corelogic/ScheduleDisplayLogic.ts` | 关「显示周末」后周六日列消失；开当前时间线后出现时间分割线 | 中（涉网格结构） | P1 |
| S06 | 补深浅档 shadeOf/fillAlphaOf | `[H]corelogic/CourseColorLogic.ts`、`[H]core/theme/CoursePalette.ts` | 同一色号不同课深浅不同且重进不闪 | 低 | P2 |
| S07 | 定乐学源：要么验证契约后接回，要么明确文档化「永久不做」 | `[H]corelogic/DdlSourceLogic.ts`、`docs/FULL-PARITY-PLAN.md` | 设置页乐学行文案与结论一致；无契约时不出现假数据 | 低 | P2 |
| S08 | 补动态页 StaleDataBanner + DDL/动态组件深链定位 | `[H]pages/EclassActivityPage.ets`、`[H]pages/DdlPage.ets` | 有数据时刷新 5xx 不清空列表且顶部出横幅；组件点条目滚到对应项 | 低 | P2 |
| S09 | 教学调整 summarize 连续合并 + 真机补验列表页 | `[H]corelogic/TeachingAdjustmentView.ts`、`[H]pages/TeachingAdjustmentPage.ets` | 连续放假 4 天显示一段「10/5~10/8 放假」而非 4 行 | 低 | P2 |

**P0 编号列表：S01、S02**（均为用户「配色肉眼无区别」口径直接相关）。

---

## 5. 已知未验项 / 不做项（如实标注）

| 项 | 状态 | 依据 |
|---|---|---|
| 旧学期周次语义 | 未实证（无原版内部页可拍） | `[R]:221` |
| 课表第 4 颗「＋」原版语义 | 未实证（当前接手动改课表） | `[R]:221` |
| eclass 登录后「拉取成功 + DDL 自动刷新」正路径 | 未验（需本人在校页输密码，无法自动化） | `[R]:216` |
| 浅色态 Brand 配色 | 未验（设备深色模式 + 齿轮坐标漂移） | `[R]:87` |
| 教学调整列表页真机 | 代码完成，真机未验 | `[R]:388` |
| ICS auth 主机 409 | 鸿蒙未实现 ICS，无法验证；Android 侧陷阱已记录 | `ScoreQueryModel.kt:47`；鸿蒙未找到证据 |
| 乐学 DDL 源 | 接口未验证，本版明确不提供（非遗漏） | `[H]corelogic/DdlSourceLogic.ts:9,52-57`；🚫 |
| 瓦片地图 / 建筑多边形 | 需决策/基础设施，Map Kit 不能换瓦片源 | `docs/FULL-PARITY-PLAN.md:22,129-135`；⛔ |
| 部分鸿蒙文件（TimeTablePage / EclassLoginPage / TeachingAdjustmentPage / SchoolService 全文） | 仅确认存在性/检索关键字，未逐行核对 | 本文 §1 |

---

v1.0 / 2026-11-24

---

## 修复进度登记（2026-11-27，v1.0 审计内容不改动）

| 编号 | 状态 | 证据 |
|---|---|---|
| S01 | ⚠️ 代码完成 + 静态绿，**真机待验** | commit `b6aa010`（alpha.51/versionCode 51）；`CoursePalette.ts` 补 5 族色表（legacy/classic/morandi/brand + auto 按 palette 解析），逐格对照 A:CoursePalette.kt；`test-coursefamily` 101 断言（逐格色 + Auto 解析 + 静态接线守卫）+ 2 组拆红-恢复日志 `evidence/s01-coursefamily-20261127/`；全测 95/95、4217 断言 EXITCODE:0；hvigor BUILD SUCCESSFUL；装机 `bm dump`=51、MD5 `FCD5AA5AAEE18F9B2A2673BC2D21AA09`。⚠️ 默认族 Legacy 色值经用户拍板按 Android 权威固定色 `#E7ECF3`（非旧鸿蒙 `secondaryContainer`），`test-scheduletint` 锚点同步更新；真机：族切换未验（设备教务会话过期） |
| S02 | ⚠️ 代码完成 + 静态绿，**真机待验** | 同上；`CourseColorFamilyStore` 用 `\u0001` 分隔存课名→色号覆盖；`SchedulePage` 课程详情加 12 色改色 + 重置，色号=覆盖优先否则哈希（对齐 A:itemColorIndex）；静态守卫已钉；真机未验 |

> 两项不判 ✅（G5 未签字）。待设备登录恢复后，由用户在设置页切 5 族观察课表变化、点课程卡改色后重进确认保持，再回写 ✅。

*v1.1 进度登记 / 2026-11-27*
