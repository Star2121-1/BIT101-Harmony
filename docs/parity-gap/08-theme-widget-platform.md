# BIT-101 Android ↔ 鸿蒙 差距文档 08：主题 / 桌面卡片 / 通用组件 / 平台能力

> 审计范围：Android `features/{theme,widget,common}` ↔ 鸿蒙 `entry/src/main/ets`。
> 只读审计，未改源码、未做网络 / 真机 / 构建验证。
> 状态语义：**✅ 对齐**（代码双端可证）｜**⚠️ 差异**（实现或口径不一致）｜**❌ 缺失**（鸿蒙未实现）｜**➖ 平台受限 / 鸿蒙独有**（不做或无法对照）。
> 下文 file:line 中，鸿蒙路径前缀省略为 `harmony/...` 表示 `harmony/BIT101-harmony/entry/src/main/ets/`；Android 省略前缀为 `BIT101-seat/`。

---

## ① 域范围与实际读过的文件

**Android（已读）**
- `features/theme/.../Theme.kt`（四轴 + dynamicColor + 首帧初值）
- `features/theme/.../palette/Palettes.kt`（三 palette 唯一分派点、fail-fast、courseColorFamily 第三轴）
- `features/theme/.../LocalAppSkin.kt`、`PreviewSurface.kt`、`CoursePalette.kt`
- `features/theme/.../component/GridButton.kt`（semantics / Role 对照）
- `features/widget/.../BIT101WidgetProvider.kt`、`WidgetViews.kt`、`WidgetLogic.kt`
- `features/common/.../GotoRequest.kt`（route + tab + focusKey 三段消费）

**鸿蒙（已读）**
- `core/theme/GridTokens.ts`、`AppColors.ts`、`CoursePalette.ts`、`components/gridStyle.ts`、`components/GridButton.ets`
- `data/ThemeStore.ts`、`data/Prefs.ts`
- `pages/WidgetPage.ets`、`pages/OverlayPage.ets`、`pages/SettingsPage.ets`
- `extensionability/FormExtension.ets`；资源 `resources/base/profile/form_config.json`、`form_metadata.json`、`entry/src/main/module.json5`
- `corelogic/WidgetLogic.ts`、`WidgetData.ts`、`WidgetDeepLink.ts`、`A11yText.ts`、`CacheIndex.ts`、`DiagnosticsLogic.ts`
- `entryability/EntryAbility.ets`
- 文档：`docs/ROADMAP.md`（进度数字唯一来源）、`docs/README.md`、`README.md`、`ui-ref/MIGRATION-BASELINE.md`

**未读 / 定点查后无证据**：Android `features/common` 其余 80kt 未逐文件读（仅在需要时定点查 `GotoRequest.kt`）；`core/theme/colorUtil.ts` 未逐行读（只确认存在与 `GridTokens.ts:47` 调用）；Android 悬浮窗（`SYSTEM_ALERT_WINDOW` / `TYPE_APPLICATION_OVERLAY`）**未找到证据**。

---

## ② 功能对照表

| # | 能力 | Android | 鸿蒙 | 状态 | 证据（file:line） |
|---|---|---|---|---|---|
| 1 | 取色唯一入口 | `Palettes.tokens(palette,isDark,family)` / `LocalGridTokens` | `gridTokens(isDark,paletteName)` 唯一入口，页面 `@StorageLink` | ✅ | `theme/.../Palettes.kt:54-99`；`GridTokens.ts:34-37,568` |
| 2 | 三 palette 色表逐格一致 | Classic/Warm/Brand 三表 | 三表 1:1 照搬，fail-fast 同款 | ✅ | `Palettes.kt:33-37`；`GridTokens.ts:324-520,549-559` |
| 3 | 默认 palette | 代码 `getOrDefault(AppPalette.Brand)`，注释仍写「默认 Warm」 | 代码 `DEFAULT_PALETTE='brand'`，文件头注释仍写「默认 Warm」 | ⚠️ | `Theme.kt:142,131,154`；`GridTokens.ts:22-23,213`；`ROADMAP.md:91` |
| 4 | 缺档 fail-fast | `error()` 带 palette 名 | `throw new Error(...)` 同款 | ✅ | `Palettes.kt:108-115`；`GridTokens.ts:549-559` |
| 5 | 深浅三档 | `DarkThemeMode.System/Light/Dark` | `MODE_AUTO/LIGHT/DARK` | ✅ | `Theme.kt:56-61`；`ThemeStore.ts:72-74,162-175` |
| 6 | 全局订阅 | `CompositionLocalProvider` | `@StorageLink('ui_dark'/'ui_palette')` | ✅ | `Theme.kt:82-90`；`ThemeStore.ts:31-35,171-172` |
| 7 | 动态取色（Material You） | `dynamicLight/DarkColorScheme`，SDK≥S 且开关开 | 无对应 API | ➖ | `Theme.kt:51-54,69-80`（鸿蒙侧未找到证据） |
| 8 | 形态轴 appSkin | `LocalAppSkin`，默认 Classic，仅声明未消费 | 无对应概念 | ⚠️ | `LocalAppSkin.kt:7-20`；`Theme.kt:63-64,172-173` |
| 9 | 课程色族 courseColorFamily | `Legacy/Classic/Morandi/Brand/Auto` 五族表 | 仅经典 12 色两套，无 family 轴 | ❌ | `CoursePalette.kt:57-133`；`Palettes.kt:57-68`；`CoursePalette.ts:18-56` |
| 10 | 课程 12 色板色值 | fill/ink/mark 权威表 | 经典表逐格一致 | ✅ | `CoursePalette.kt:24-55`；`CoursePalette.ts:18-47` |
| 11 | WCAG 对比度判据 | 未找到证据 | `contrastRatio`/`relativeLuminance` + 栅栏 | ➖ | `AppColors.ts:119-162`（鸿蒙独有） |
| 12 | 设置页切换 | P5-C 三 palette 接线 | 三档深浅 + 三 palette，Brand 标「实验性」 | ✅ | `Theme.kt:65-66`；`SettingsPage.ets:641-667` |
| 13 | 卡片进程独立初始化 | AppWidgetProvider 同进程 | `Prefs.init` 在 onAdd/onUpdate/onRemove 自补 | ✅ | `BIT101WidgetProvider.kt:199-210`；`FormExtension.ets:93,177,290` |
| 14 | 卡片主题下发 | 宿主进程按系统配置解析资源色 | FormExtension 读偏好随 binding data 下发 palette/dark | ✅ | `WidgetViews.kt:384-410`；`FormExtension.ets:140-164,311-317`；`WidgetPage.ets:51-60` |
| 15 | 卡片首帧 palette 值 | — | `onAddForm` 首帧写死 `widgetPalette:'warm'`，预览写死 `'brand'` | ⚠️ | `FormExtension.ets:97-99,108-110`（应为 brand） |
| 16 | 刷新配额 | 系统 `updatePeriodMillis` | 30min + 50 次/天 + 跨天重置 + 时钟回拨 | ✅ | `FormExtension.ets:244-268`；`ROADMAP.md:457` |
| 17 | 预览不占配额 | 未找到证据 | 空 formId 跳过计数，新 formId force 装配 | ✅ | `FormExtension.ets:94-107,178-183`；`ROADMAP.md:457` |
| 18 | 卡片页数 | 6 页（COURSE/DDL/ACTIVITY/SEAT/STUDY/**EXAM**） | 5 页，无 EXAM | ⚠️ | `WidgetLogic.kt:103-141`；`WidgetViews.kt:51-75`；`WidgetLogic.ts:38-44`；`WidgetPage.ets:56` |
| 19 | 卡片纯逻辑移植 | buildDayBlocks/pickDay/ddlPage 等 | 5 页部分 1:1 移植 | ✅ | `WidgetLogic.kt:34-997`；`WidgetLogic.ts:1-20,200-777` |
| 20 | 卡片动态源 | `EclassActivityCache` 真实数据 | `activities` 恒空 + `eclassLoggedIn=false` | ❌ | `BIT101WidgetProvider.kt:124`；`FormExtension.ets:382-383`；`WidgetData.ts:112-113` |
| 21 | 卡片座位源 | `SeatWidgetSnapshot` + bridge 拉预约 | `emptySeatSnapshot()`，`seatLoggedIn=false` | ❌ | `BIT101WidgetProvider.kt:119-121`；`WidgetData.ts:68-71,111` |
| 22 | 卡片考试页数据 | `ExamScheduleEntity` → EXAM 页 | 未找到证据 | ❌ | `WidgetLogic.kt:16,103-141`（鸿蒙侧未找到证据） |
| 23 | 卡片一键预约 | `ACTION_QUICK_RESERVE` 后台下单 | `actionOf()` 已返回「一键预约」，UI 未消费 | ❌ | `BIT101WidgetProvider.kt:113,138-155`；`WidgetLogic.ts:489-501`；`WidgetPage.ets:324-328` |
| 24 | 卡片刷新键 | `tab_refresh` + `ACTION_REFRESH` | 未找到证据 | ⚠️ | `WidgetViews.kt:92-95,459-465`（鸿蒙侧未找到证据） |
| 25 | 卡片尺寸变化回调 | `onAppWidgetOptionsChanged` 重排版 | 未找到证据（form_config 声明 2*2/4*4） | ⚠️ | `BIT101WidgetProvider.kt:63-70`；`form_config.json:15-19` |
| 26 | 条目点击落到具体项 | `openRoute`+`openTab`+`focusKey` fillInIntent | 只落页签，`focusKey`/`openTab` 未传给 App | ⚠️ | `WidgetViews.kt:301-317`；`GotoRequest.kt:24-40`；`WidgetPage.ets:337-352` |
| 27 | 卡片深链闭环 | MainActivity EXTRA_GOTO 三段消费 | `postCardAction` → EntryAbility → `ui_open_content` → Index | ✅ | `WidgetPage.ets:337-352`；`EntryAbility.ets:90-101`；`Index.ets:118-122` |
| 28 | 卡片倒计时 | `countdownText` + 占位符现算 | WidgetLine 无倒计时字段 | ❌ | `WidgetLogic.kt:213-221,238-250,360-369`；`WidgetLogic.ts:108-123` |
| 29 | 卡片 UI 消费逻辑层字段 | header 行 / 12 色 ink / scrollTo 全消费 | `widgetLine` 只消费 time/main/lead/trail/highlight | ⚠️ | `WidgetViews.kt:263-399`；`WidgetPage.ets:273-328` |
| 30 | 卡片深浅口径 | 跟**系统** uiMode，App 三档设置不作用于组件 | 跟**App 偏好** `ui_theme_mode` | ⚠️ | `WidgetViews.kt:401-410`；`FormExtension.ets:141-163` |
| 31 | 卡片 colorMode 配置 | 资源 values-night 单一来源 | `form_config.json:auto` vs `form_metadata.json:default` | ⚠️ | `form_config.json:9`；`form_metadata.json:11` |
| 32 | 卡片滚动列表 | ListView + `notifyAppWidgetViewDataChanged` | 静态列表，ROADMAP 记「降级为静态列表」 | ⚠️ | `BIT101WidgetProvider.kt:207-209`；`ROADMAP.md:648` |
| 33 | 桌面图标鸽子 62% | 未找到证据 | 62% 规范已修，可复现 | ✅ | `README.md:32,165`；`MIGRATION-BASELINE.md:516,584` |
| 34 | 共享组件覆盖 | 13 个 Grid* 组件 + PreviewSurface | 4 个（Button/Card/Chip/BottomTab）+ gridStyle | ⚠️ | `theme/component/` 文件清单；`core/theme/components/` 文件清单 |
| 35 | 组件无障碍标注 | `Role` + `contentDescription` | Grid* 组件内未找到 `accessibilityText` | ⚠️ | `GridCard.kt:37,185`；`GridChip.kt:31,107`；鸿蒙组件目录 grep 无匹配 |
| 36 | 读屏文案统一层 | 未找到证据 | `A11yText` 9 函数，7 页消费 | ➖ | `A11yText.ts:24-94`；`MePage.ets:43,457` 等 |
| 37 | @Preview 预览 | `PreviewSurface` + `@Preview` | 无等价组件 | ⚠️ | `PreviewSurface.kt:14-35`（鸿蒙侧未找到证据） |
| 38 | ArkUI 编译约束 | Compose 无此限制 | 禁 Object.assign / 动态 Record；build 禁 const；颜色不进 @State | ➖ | `docs/README.md:52`；`ROADMAP.md:738`；`GridButton.ets:16,32-44` |
| 39 | 存储白名单 / 诊断 | 未找到证据 | `CacheIndex`（6 项白名单）+ `DiagnosticsLogic`（脱敏） | ➖ | `CacheIndex.ts:32-81`；`DiagnosticsLogic.ts:45-60` |

**统计**：✅ 对齐 **14** 条；⚠️ 差异 **14** 条；❌ 缺失 **6** 条；➖ 平台受限/鸿蒙独有 **5** 条。**差异合计 20 条（⚠️14 + ❌6）**。

---

## ③ 关键差异详述

### 3.1 主题 / 皮肤 / 动态取色

- **轴数不对等**：Android `BIT101Theme` 同时消费明暗、palette、skin、courseColorFamily 四轴，并叠加 SDK≥31 的 Material You 动态色（`Theme.kt:51-80`）。鸿蒙 `ThemeStore` 只有明暗 + palette 两轴（`ThemeStore.ts:89-175`）。动态色、skin 属平台/未上线能力（见 §5）。
- **默认 palette 的「注释 vs 代码」双端残留**：`ROADMAP.md:91` 明确记载「默认配色 warm → brand」已改 40 个文件；代码侧 `GridTokens.ts:213`、`ThemeStore.ts:93`、`SettingsPage.ets:672` 均已为 brand，但 `GridTokens.ts:22-23` 文件头仍写「默认 Warm，脏值回落也必须显式 Warm」，Android `Theme.kt:131,154` 与 `PreviewSurface.kt:23` 也残留「默认 Warm」而代码为 `AppPalette.Brand`（`Theme.kt:142`、`PreviewSurface.kt:33`）。这是**可证伪**的文档缺陷。
- **课程色族缺失**：Android `CoursePalette` 有 Classic/Legacy/Morandi/Brand 四套 12 色 + Auto 解析（`CoursePalette.kt:57-133`、`Palettes.kt:57-68`）；鸿蒙 `CoursePalette.ts:18-56` 只有经典 light/dark 两套，`gridCourse()` 无 family 参数（`GridTokens.ts:644-646`）。
- **取色纪律一致**：双端都坚持「唯一入口 + 缺档 fail-fast + 不静默回退」，且鸿蒙 `AppColors.ts:4-10` 明确旧表仅作历史基线、`pages/` 禁 import。✅

### 3.2 桌面卡片与 FormExtension

- **✅ 已对齐的平台壳**：`FormExtension.ets:93,177,290` 三个入口自补 `Prefs.init`（缺一步则永久占位态）；`readTheme():140-164` 读 `ui_theme_mode`/`ui_theme_palette`，由 `setFormBindingData():311-317` 下发 `widgetPalette`/`widgetDark`，`WidgetPage.ets:51-60` 用 `gridTokens()` 现取；刷新配额 30min/50 次 + 预览不占配额均已落地（`FormExtension.ets:244-268,94-107`）。
- **⚠️ 首帧 palette 漏改**：`FormExtension.ets:109` 新卡片首帧返回 `widgetPalette:'warm'`，而预览分支 `:98` 返回 `'brand'`，与主进程默认（brand）不一致。首次加到桌面的卡片在 `assembleAndPush` 推送前会短暂显示 warm 配色。
- **❌ 数据源缺口**：`WidgetData.ts:110-115` 固定 `bit101LoggedIn=true`、`seatLoggedIn=false`、`eclassLoggedIn=false`、`studySpotLine=null`；`FormExtension.ets:382-383` 的 activities 恒空。结果是座位页/动态页永远显示登录引导，自习页第二行永远「暂时看不了」。
- **⚠️ 页数与页签**：Android 实际 6 页含 EXAM（`WidgetLogic.kt:103-141`、`WidgetViews.kt:51-75`），鸿蒙 5 页（`WidgetLogic.ts:38-44`、`WidgetPage.ets:56`）。`BIT101WidgetProvider.kt:17` 的「四页」注释本身也是过期注释，以 `PageKind` 枚举为准。
- **⚠️ 逻辑层已移植但 UI 未消费**：`WidgetLogic.ts` 的 `WidgetLine` 有 `colorIndex`/`header`/`scrollTo`/`focusKey` 等字段（`WidgetLogic.ts:108-123`），但 `WidgetPage.ets:273-328` 只渲染时间/正文/副标题/高亮底色；Android `WidgetViews.kt:263-399` 则消费了 header 行、12 色 ink、滚动定位。
- **⚠️ 刷新节奏口径**：Android 卡片深浅跟**系统**配置（`WidgetViews.kt:401-410` 明确「App 内三档设置不作用于组件」），鸿蒙跟**App 偏好**（`FormExtension.ets:141-163`）。两者对「用户在 App 内选深色、系统为浅色」的场景表现相反。

### 3.3 浮窗 / DeepLink

- **浮窗**：Android `features/` 全局 grep `SYSTEM_ALERT_WINDOW|TYPE_APPLICATION_OVERLAY|悬浮窗` **未找到证据**；鸿蒙 `OverlayPage.ets:1-17` 名为 Overlay 实为「手动改课表」的**数据覆盖层编辑页**，不是系统浮窗。两端均无系统级浮窗能力，不构成差距。
- **✅ 卡片 DeepLink 闭环**：`WidgetPage.ets:337-352` 用 `postCardAction(router)` 带 `bit101Content`，`EntryAbility.ets:90-101` 经 `sanitizeContentId` 白名单校验写入 `ui_open_content`，`Index.ets:118-122` 消费并清空；通知深链复用同一校验（`NotifyDeepLink.ts:69-74`）。
- **⚠️ 定位粒度**：Android `GotoRequest.kt:24-40` 分三段消费（route → tab → focusKey），点 DDL 行能滚到具体条目；鸿蒙只传内容 id（`WidgetPage.ets:340`），落页签后无 tab/key 定位（`ROADMAP.md:458` 亦记「有数据行时点行未验」）。

### 3.4 通用组件与无障碍（A11yText）

- **组件覆盖**：Android 13 个 Grid* 组件 + `PreviewSurface`（`theme/component/`），鸿蒙仅 4 个 + `gridStyle.ts` 纯逻辑层。四者状态矩阵（`resolveCardStyle`/`resolveButtonStyle`/`resolveChipStyle`/`resolveTabStyle`）已逐条对齐（`gridStyle.ts:53-174`）。
- **⚠️ 组件内无障碍标注**：Android 组件用 `Role` + `contentDescription`（`GridCard.kt:37,185`、`GridChip.kt:31,107`）；鸿蒙 `core/theme/components/` 目录 grep `accessibilityText` **无匹配**，选中态等状态无读屏标注。
- **➖ 鸿蒙独有的读屏统一层**：`A11yText.ts:24-94` 提供 9 个纯函数，`ClassroomPage/ExamPage/MePage/ScorePage/SeatMapPage/SeatPage/ShuttlePage` 已接入（`A11yText.ts` 调用点）。但 `switchA11y`/`unreadA11y`/`progressA11y`/`moneyA11y`/`spanA11y` 仅定义未见页面调用（未找到证据）；`ROADMAP.md:859,869` 记「读屏朗读仍属未验」。
- **➖ 鸿蒙独有平台工具**：`CacheIndex.ts:32-81`（6 项白名单，凭据/主题不在内）、`DiagnosticsLogic.ts:45-60`（学号脱敏）无 Android 对照证据。

### 3.5 ArkUI vs Compose 平台差异

| 约束 | 表现 | 证据 |
|---|---|---|
| 禁 `Object.assign` + 动态 `Record` | 用显式 `interface` + 逐字段组装，缺字段是编译错误 | `GridTokens.ts:42-43,571-627`；`ROADMAP.md:738`（字面量联合也禁，enum 是唯一正路） |
| `build()` 禁局部变量 | 派生值走私有方法，UI 内 `this.xxx()` 现取 | `GridButton.ets:16,43-64`；`WidgetPage.ets:11-15`；`OverlayPage.ets:317` |
| 颜色不进 `@State` | `@StorageLink` 订阅 + `tokens()` 行内取 | `GridButton.ets:32-44`；`docs/README.md:52` |
| 卡片独立进程 | 读不到主进程 Prefs/AppStorage，须自补 init + binding data | `FormExtension.ets:9-14,88-93`；`WidgetPage.ets:46-52` |
| 组件类型限制 | `Column`/`Row` 是 struct，不能作方法返回类型 ⇒ `@Builder` | `WidgetPage.ets:13-15,225-227` |
| 表单 API 差异 | `onAddForm` 必须同步返回；API12 无 `getFormBindingData` | `FormExtension.ets:81-84,306-310` |

---

## ④ 可执行修复清单

| 编号 | 改动点 | 鸿蒙文件 | 验收判据（可证伪） | 风险 | 优先级 |
|---|---|---|---|---|---|
| F01 | 卡片首帧 palette 由 `'warm'` 改为默认 `'brand'`；同步 `GridTokens.ts` 文件头注释「默认 Warm」 | `FormExtension.ets:98,109`；`GridTokens.ts:22-23` | `FormExtension.ets` 不再出现 `widgetPalette:'warm'`；文件头注释与 `:213` 的 `DEFAULT_PALETTE` 一致；`test-gridtokens` 默认断言仍绿 | 低 | **P0** |
| F02 | 补 EXAM 页：PageKind/WidgetLogic.build/tabLabels/数据装配四处同步 | `WidgetLogic.ts:38-44,388-415`；`WidgetData.ts:88-116`；`WidgetPage.ets:56` | `PageKind` 6 值且 `tabLabels` 6 项；payload 含 EXAM 页；考试缓存有数据时卡片可见 | 中 | **P0** |
| F03 | 卡片条目点击带 `openTab`/`focusKey`，App 侧消费并定位到具体条目 | `WidgetPage.ets:337-352`；`WidgetDeepLink.ts:19-37`；`Index.ets:118-122` | 点 DDL 行落到 DDL 页签并滚动到该 uid；`EXTRA_FOCUS` 等价键在 want 中存在 | 中 | **P0** |
| F04 | 接入座位 / 动态本地源，移除 `seatLoggedIn=false`/`eclassLoggedIn=false` 恒定值 | `WidgetData.ts:110-115`；`FormExtension.ets:382-383` | 有本地预约 / 活动缓存时卡片显示真实行而非登录引导 | 高 | **P0** |
| F05 | 课程色族 5 档落地：补 Legacy/Morandi/Brand 表 + family 参数 + 设置项 | `CoursePalette.ts:18-56`；`GridTokens.ts:644-646`；`SettingsPage.ets:449-453` | `CoursePalette.ts` 导出 4 套 12 色；`gridCourse(index,isDark,family)` 按族取色；设置页切换可见 | 高 | **P0** |
| F06 | 消费 `actionOf()`：渲染底部动作键（登录/一键预约）并接通点击 | `WidgetPage.ets:225-328`；`WidgetLogic.ts:489-501` | 座位页有 `quickReserveTaskId` 时卡片出现「一键预约」且点击有反馈 | 高 | P1 |
| F07 | UI 消费 `header`/`colorIndex`/`scrollTo`：分区标题、课程行 ink、初始滚动 | `WidgetPage.ets:273-328` | DDL 两栏出现「未完成 · N」；课程行文字取 `courseColors()[i].ink`；列表首屏定位到当前时段 | 中 | P1 |
| F08 | 统一卡片 colorMode：`form_config.json:auto` 与 `form_metadata.json:default` 取一 | `form_config.json:9`；`form_metadata.json:11` | 两文件值相同；切换系统深浅时卡片配色与 App 口径一致 | 低 | P1 |
| F09 | 补齐缺失 Grid* 组件（ProgressRing/Sheet/Skeleton/Snackbar/TextField/TopBanner 等）及状态矩阵 | `core/theme/components/` | 组件目录出现对应 `.ets` + `gridStyle.ts` 状态函数；`test-gridcomponents` 断言覆盖 | 中 | P1 |
| F10 | 为 GridCard/GridChip 选中态补 `accessibilityText` | `core/theme/components/GridCard.ets`、`GridChip.ets` | 组件目录 grep `accessibilityText` 有匹配；选中态读屏文案非空 | 低 | P1 |
| F11 | 明确卡片深浅口径（跟系统 vs 跟 App 偏好）并双端统一 | `FormExtension.ets:141-163`；`WidgetViews.kt:401-410`（Android 侧仅记录） | 产品口径文档化；同「系统浅 + App 深」场景下两端卡片表现一致 | 中 | P1 |
| F12 | 补卡片刷新键与尺寸变化回调 | `WidgetPage.ets:140-223`；`FormExtension.ets` | 卡片有刷新入口；2*2/4*4 切换后页签不溢出 | 中 | P2 |
| F13 | 推广 `A11yText` 未消费函数到设置页开关、徽标、金额行 | `A11yText.ts:36-94`；`SettingsPage.ets` | `switchA11y`/`unreadA11y` 等有页面调用点；读屏行不再是 `true/false` | 低 | P2 |

**P0 编号：F01、F02、F03、F04、F05。**

---

## ⑤ 明确不做 / 平台受限项

| 项 | 原因 | 证据 |
|---|---|---|
| Material You 动态取色 | 鸿蒙无 `dynamicColorScheme` 等价 API；Android 也仅 SDK≥31 且开关默认 false | `Theme.kt:51-54,69-80,120` |
| appSkin 形态轴 | Android 自身仅在 `LocalAppSkin` 落声明、P5-F 未消费；鸿蒙无对应设置项 | `LocalAppSkin.kt:7-20`；`Theme.kt:63-64` |
| RemoteViews / ARGB Int 色值 | 平台渲染模型不同，鸿蒙卡片是 ArkTS 声明式 UI，不需要 `fillArgb`/`inkArgb` | `CoursePalette.kt:139-143`；`WidgetPage.ets:40-52` |
| 系统浮窗 | 两端均未找到 `SYSTEM_ALERT_WINDOW` / `SubWindow` 浮窗能力证据；`OverlayPage` 是数据覆盖层编辑页 | `OverlayPage.ets:1-17`；Android features grep 无匹配 |
| 卡片主动联网 | FormExtension 独立进程不替用户发请求，产品约束 | `FormExtension.ets:372-383`；`WidgetData.ts:1-14` |
| 卡片可滚动列表 | Form Kit 能力边界，ROADMAP 记「降级为静态列表」 | `ROADMAP.md:648` |
| 真机 / 网络 / 构建验证 | 本次审计红线，仅静态源码 + 文档证据 | 本文件开头审计声明；`ROADMAP.md:864-870` 口径警告 |
| 上架资质 | ROADMAP 记为 ⛔ 等用户，不属本域 | `ROADMAP.md:858`（M10 1 项 ⛔） |

**进度数字仅引用 ROADMAP（统计时点 2026-10-30）**：M8 卡片 **50%**（6 项：3 ✅ / 3 🔄，`ROADMAP.md:856`）；M11 搜索/工具 **83%**（`ROADMAP.md:859`）；M6 设置/外观 **100%**（`ROADMAP.md:854`）；合计 **≈73%**（80 项：58 ✅ / 20 🔄 / 1 ⚠️ / 1 ⛔，`ROADMAP.md:862`）。⚠️ ROADMAP 明示这些 ✅ 只代表「代码 + 单测 + 编译完成」，**不代表真机已验**（`ROADMAP.md:868-870`）。

---

v1.0 / 2026-11-24

---

## 修复进度登记（2026-11-26，v1.0 审计内容不改动）

| 编号 | 状态 | 证据 |
|---|---|---|
| F01 | ⚠️ 代码完成 + 静态绿，**卡片首帧真机待用户配合** | commit `d068fc6`（alpha.50/versionCode 50）；`test-widget.mjs` 24 断言含 F01 静态守卫（不再写死 warm、两处首帧都引用 DEFAULT_PALETTE、注释已订正）；拆红-恢复日志 `evidence/f01-widget-20261126/`；全测 94/94、4116 断言 EXITCODE:0；hvigor BUILD SUCCESSFUL；装机 `bm dump`=50、MD5 `302003345CC7A54B207479F1A0CAAE47`。真机：把卡片加到桌面观察首帧颜色需用户物理长按操作，未代做 |

> F01 不判 ✅，待用户本人把卡片加到桌面确认首帧为 brand（BIT101经典配色深蓝）后回写。

*v1.1 进度登记 / 2026-11-26*

### 7.2 卡片三件套（2026-11-27，v1.0 审计内容不改动）

| 编号 | 状态 | 证据 |
|---|---|---|
| F02 | ⚠️ 代码完成 + 静态绿，**真机待集中验** | `WidgetLogic` 加 `PageKind.EXAM`（第 6 值，追加末尾不改老页号）+ `examPage()`（ExamListLogic 同口径：过去场次剔除、今天/明天/后天/MM/DD、HH:mm-HH:mm、JASMC 地点）；`build()` 加 exams 入参；`FormExtension` 用 `ExamCache.loadLast()` 读本地考试源；`test-widgetparity` 48 断言 + `test-widget` 锚点 5→6 页更新；拆红反证 `evidence/widget-parity-20261127/red-exam-past-20261127.log`（剔除逻辑删掉即红） |
| F03 | ⚠️ 代码完成 + 静态绿，**真机待集中验** | `WidgetLine.focusKey` 原本已赋值（DDL/动态/考试行）；`WidgetPage` 行点击先记 focusKey 再 openApp，want 带 `bit101Focus`；`WidgetDeepLink.sanitizeFocusKey` 只认 ddl/course/exam/activity 四前缀 + 200 字上限；`EntryAbility` 写 `AppStorage[ui_open_focus]`；`DdlPage` 用 @Watch 消费 `ddl:<uid>` 并高亮命中行。静态守卫锁定全链路 |
| F04 | ⚠️ 部分完成 + 静态绿，**真机待集中验** | 移除 `seatLoggedIn=false`/`eclassLoggedIn=false` 恒定值：改为 `input.seatLoggedIn` 入参控制、activities 有数据即视为已登录（比恒定 false 诚实）；`FormExtension` 仍不读座位/eclass 缓存，因为鸿蒙侧**没有可跨进程读的座位登录态快照 / eclass 活动缓存**（`SeatTaskStore` 只有预约任务、不含登录态），座位真实行与动态真实行的**数据源本身缺失**，非代码能凭空补。判据的「有本地预约/活动缓存时显示真实行」在这两端无源前不满足，如实标 ⚠️ 而非冒称 ✅ |
| F05 | ⚠️ 代码完成 + 静态绿（**已在第 3 条 S01/S02 全量落地**） | 审计判据写于第 3 条之前已过时：`CoursePalette.ts` 现有 legacy/classic/morandi/brand 4 套 12 色 + auto 解析（共 5 族），`courseColorsOf`/`ScheduleTint` 按族取色，`SettingsPage` 有族选择入口。证据见 02 文档 §7 与 commit `b6aa010`（alpha.51）。本条不重做 |

> 本批不判 ✅（G5 集中验收未做）。真机需验：卡片考试页可见且过期场次不显示、点 DDL 行落到 DDL 页并高亮该条、EXAM 页 tab 切换正常。F04 座位/动态真实行需先有本地源（另立任务），当前不视为完成。

*v1.2 进度登记 / 2026-11-27*
