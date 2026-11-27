# 域 07 · 地图 / 空教室 / 班车 / 设置 / 诊断 —— Parity 差距文档

> 目的：给出可用于**后续逐项修复**的可证伪差距清单。本文为**只读静态审计**：未做网络请求、未做真机验证、未做构建。所有判断均附 `file:line`；未在给定材料中读到的写「未找到证据」；状态列中 `⚠️`/`❌`/`➕`/`⊘` 一律不写成 `✅`。文中出现的所有进度数字**只引用** `ROADMAP.md`（别名 `RD`），不另行推算。

---

## 1. 域范围 + 实际读过的文件路径

### 1.1 域范围

| 子域 | Android 侧 | 鸿蒙侧 |
| --- | --- | --- |
| 地图 | `features/map`（瓦片地图、校区、地点定位） | `MapPage`（「图」Tab 在线瓦片）、`CampusMapPage`（楼栋索引）、`SpotDetailPage`（自习候选） |
| 空教室 | `features/setting` 的「空教室查询设置」二级页 | `ClassroomPage`、`ClassroomService`、`ClassroomFree`、`CampusGrouping`、`StudySpotService` |
| 班车 | `features/web` 无关；原版 `TransportScreen` 不在给定三模块内 | `ShuttlePage`、`ShuttleLogic` |
| 设置 | `features/setting`（索引 + 12 个入口卡 + 二级子页） | `SettingsPage`（单页分组）、`NotifySettingsPage` |
| 诊断 / 缓存 / 关于 / Web | `features/setting`（About/日志导出）、`features/web`（「网」Tab） | `CacheCleanPage`、`DiagnosticsPage`、`AboutPage`、`WebServicesPage`、`WorldWebPage`、`WebShellPage` |

### 1.2 路径别名（表格内证据用别名，均可由下表还原为绝对路径）

| 别名 | 绝对路径前缀 |
| --- | --- |
| `A:map/` | `F:/Agent_Work/BIT-102/BIT101-seat/features/map/src/main/java/cn/bit101/android/features/map/` |
| `A:setting/` | `F:/Agent_Work/BIT-102/BIT101-seat/features/setting/src/main/java/cn/bit101/android/features/setting/` |
| `A:web/` | `F:/Agent_Work/BIT-102/BIT101-seat/features/web/src/main/java/cn/bit101/android/features/web/` |
| `A:common/` | `F:/Agent_Work/BIT-102/BIT101-seat/features/common/src/main/java/cn/bit101/android/features/common/` |
| `H:pages/` | `F:/Agent_Work/BIT-102/harmony/BIT101-harmony/entry/src/main/ets/pages/` |
| `H:service/` | `F:/Agent_Work/BIT-102/harmony/BIT101-harmony/entry/src/main/ets/service/` |
| `H:core/` | `F:/Agent_Work/BIT-102/harmony/BIT101-harmony/entry/src/main/ets/corelogic/` |
| `H:raw/` | `F:/Agent_Work/BIT-102/harmony/BIT101-harmony/entry/src/main/resources/rawfile/` |
| `H:data/` | `F:/Agent_Work/BIT-102/harmony/BIT101-harmony/entry/src/main/ets/data/`（修复清单中引用的持久化层，本次未逐一精读） |
| `RD` | `F:/Agent_Work/BIT-102/harmony/BIT101-harmony/docs/ROADMAP.md` |

### 1.3 实际读过的文件（Android）

| 文件 | 关键内容 |
| --- | --- |
| `A:map/MapScreen.kt` | 瓦片 UI、校区按钮、缩放栏、ODbL 署名、定位提示条（全文 225 行） |
| `A:map/MapViewModel.kt` | 瓦片 URL、OkHttp 缓存、MapState、缩放持久化、跳转定位（全文 118 行） |
| `A:map/MapCampus.kt` | 4 校区归一化坐标、z15~z18、OSM 反代与 ODbL 说明（全文 105 行） |
| `A:map/CampusPlaces.kt` | 地点别名最长匹配、`MapTargetHolder`、地点级缩放 0.5（全文 131 行） |
| `A:web/WebScreen.kt` | WebView 注入、score 自动填充、文件选择器、外链策略、进度条（全文 235 行） |
| `A:web/WebViewModel.kt` | `BASE_URL=https://bit101.cn`、fakeCookie/sid/password（全文 20 行） |
| `A:common/utils/InAppWebUrls.kt` | `isInternal` 统一判据（学校域 + bit101.cn + 10.0.0.55）（全文 59 行） |
| `A:setting/SettingScreen.kt` | NavHost 12 条路由 + 索引页（全文 182 行） |
| `A:setting/SettingIndexPage.kt` | **12 张入口卡**全量（全文 125 行） |
| `A:setting/component/Settings.kt` | `SettingsGroup` / `SettingsColumn` 组件（全文 85 行） |
| `A:setting/page/FreeClassroomSettingPage.kt` | 空教室 3 个设置项（全文 201 行） |
| `A:setting/viewmodel/FreeClassroomViewModel.kt` | `hideBusyClassroom=true` / `freeMinutesThreshold=5L` 默认（全文 76 行） |
| `A:setting/page/CalendarSettingPage.kt` | 课表数据 7 项 + 显示 7 开关（全文 643 行） |
| `A:setting/page/AboutPage.kt` | 版本/自动检查更新/联系方式/导出日志/升级弹窗（读 82-137、380-468 行 + 全文 Grep） |
| `A:setting/viewmodel/AboutViewModel.kt` | `autoDetectUpgrade`、`checkUpdate()`、`setIgnoreVersion()`（全文 31 行） |
| `A:setting/page/{ThemeSettingPage,AccountPage,PagesSettingPage,DDLSettingPage,ActivitySettingPage,NotifySettingPage,GallerySettingPage,EclassSessionText}.kt` | 设置项标题全量（Grep `title =`/`subTitle =` 提取，逐行附号） |
| `A:setting/SettingIndexPage.kt` / `A:setting/SettingScreen.kt` | 入口与路由（见上） |

### 1.4 实际读过的文件（鸿蒙）

| 文件 | 关键内容 |
| --- | --- |
| `H:pages/MapPage.ets` | 「图」Tab：WebView 壳、4 校区、缩放栏、提示条（全文 181 行） |
| `H:raw/map.html` | 内联瓦片引擎：Canvas、拖拽/双指/滚轮、内存瓦片缓存、ODbL 署名（全文 189 行） |
| `H:pages/CampusMapPage.ets` | 楼栋索引 48 栋、搜索、课程、系统地图 geo:（全文 405 行） |
| `H:pages/ClassroomPage.ets` | 三级空教室、13 节、下拉刷新、FAB、日期上屏（全文 672 行） |
| `H:pages/ShuttlePage.ets` | 班车 chip、下一班、按小时分组、免责（全文 379 行） |
| `H:pages/SettingsPage.ets` | 单页 15 组设置全量（全文 1410 行） |
| `H:pages/CacheCleanPage.ets` | 清理页白名单、二次确认（全文 293 行） |
| `H:pages/DiagnosticsPage.ets` | 诊断采集、一键复制、隐私边界（全文 227 行） |
| `H:pages/AboutPage.ets` | 版本、changelog、检查更新、许可（全文 271 行） |
| `H:pages/WebServicesPage.ets` | 网页服务入口页（全文 122 行） |
| `H:pages/WorldWebPage.ets` | 「网」Tab WebView（全文 96 行） |
| `H:pages/WebShellPage.ets` | 通用 Web 壳（全文 68 行） |
| `H:pages/SpotDetailPage.ets` | 自习候选详情（全文 212 行） |
| `H:pages/Index.ets` | 「图」挂 `MapPage`、「卷」内嵌 `ClassroomPage`/`ShuttlePage`（Grep） |
| `H:pages/NotifySettingsPage.ets` | 提醒开关全量（Grep） |
| `H:service/ClassroomService.ts` | 空教室协议、分页、13 节解析（全文 186 行） |
| `H:service/StudySpotService.ts` | 自习取数（读 1-30 行） |
| `H:service/CampusNetService.ts` | 校园网服务（读 1-30 行，与本域弱相关，登记备查） |
| `H:service/VersionCheckService.ts` | `GET android.bit101.cn/version/` 只读（全文 63 行） |
| `H:core/ClassroomFree.ts` | `isFreeNow` 节次粒度等价移植、阈值按 0（全文 58 行） |
| `H:core/ShuttleLogic.ts` | 时刻表 4 组、dayTypeOf、nextDeparture、groupByHour（全文 187 行） |
| `H:core/WebEntryLogic.ts` | 6 个入口清单、`shouldStayInApp` 仅判 `*.bit.edu.cn`（全文 124 行） |
| `H:core/UpdateCheckLogic.ts` | 版本判定、不展示 APK url（全文 156 行） |
| `H:core/VersionLogic.ts` | 版本比较、changelog 解析（全文 227 行） |
| `H:core/DiagnosticsLogic.ts` | 学号脱敏、诊断行（全文 113 行） |
| `H:core/CacheIndex.ts` | 6 类清理白名单（全文 187 行） |
| `H:core/MapTileMath.ts` | 归一化坐标换算、z15~z18（全文 89 行） |
| `H:core/CampusCenters.ts` | 4 校区中心点 + `hasBuildingIndex`（全文 72 行） |
| `H:core/CampusLocations.ts` / `CampusDirectory.ts` / `CampusGrouping.ts` | 楼栋坐标/别名/分组清洗（Grep） |
| `H:raw/`（目录枚举） | 仅 `map.html`、`changelog.json`、icons、pem；**无 PDF 底图/自绘矢量资源** |
| `RD` | 进度唯一权威（读 1-130 行 + 全文 Grep 关键段） |

### 1.5 材料边界（以下在给定目录内「未找到证据」）

- Android **空教室查询主页面**（`FreeClassroomSearch.kt` / `ClassroomList.kt` / `CampusGrouping.kt` / `FreeClassroomSearchViewModel.isFreeNow`）：仅由鸿蒙源码注释间接引用（`H:pages/ClassroomPage.ets:13-21,37-38`、`H:core/ClassroomFree.ts:4-7`），本次**未读到原文件**，凡涉及其内部实现均标注「未找到证据」。
- Android **班车页** `TransportScreen.kt`：仅由 `H:pages/ShuttlePage.ets:2-5` 注释引用，未读到原文件。
- Android `features/versions/UpdateDialog`（`A:setting/page/AboutPage.kt:47` import）、`LogExporter` / `LogRedact`（`AboutPage.kt:433-444` 调用、`utils/LogExporter.kt` 仅在 Glob 中出现）、`SchoolDomains`（`InAppWebUrls.kt:36` 调用）、`NfcSettingPage`（`SettingScreen.kt:12` import）均在 `features/{map,setting,web}/src` 之外：**未读到实现**，不作实现层断言。
- 鸿蒙 `CampusNetService` 与本域功能无直接对应，仅按 team-lead 指定登记为「已读」。

---

## 2. 功能对照表

状态：`✅` 对齐 ｜ `⚠️` 有差异（口径/形态/默认值） ｜ `❌` Android 有、鸿蒙未找到 ｜ `➕` 鸿蒙多出（Android「未找到证据」） ｜ `⊘` 明确不做。

| 编号 | 功能点 | Android | 鸿蒙 | 状态 | 证据 (file:line) |
| --- | --- | --- | --- | --- | --- |
| F01 | 瓦片源 `map.bit101.flwfdd.xyz/tile/{z}/{col}/{row}.png` | `TileStreamProvider` + OkHttp | Canvas `Image.src` 同源 | ✅ | `A:map/MapViewModel.kt:43-51`；`H:raw/map.html:99-106`；`H:core/MapTileMath.ts:27,60-62` |
| F02 | 底图 = OSM 反代 + ODbL 署名义务 | 注释实证 `x-tilerender` / Fastly | 注释 + 页内署名 | ✅ | `A:map/MapScreen.kt:197-199`；`A:map/MapCampus.kt:57-64`；`H:pages/MapPage.ets:15-17` |
| F03 | 渲染引擎形态 | `MapCompose` `MapUI` + `MapState(19,…)` | WebView + 内联 Canvas 瓦片引擎 | ⚠️ | `A:map/MapScreen.kt:78-83`；`A:map/MapViewModel.kt:60-64`；`H:pages/MapPage.ets:93-102`；`H:raw/map.html:27-97` |
| F04 | 归一化 Web-Mercator 坐标换算 | `x=(lon+180)/360` 等 | `lonLatToNorm` / `normToLonLat` | ✅ | `A:map/MapCampus.kt:8-18`；`H:core/MapTileMath.ts:37-51` |
| F05 | 缩放层级 z15~z18（更低级 403） | 注释 + `SCALE=0.25/0.5` | `MINZ=15/MAXZ=18` / `MIN_ZOOM` | ✅ | `A:map/MapCampus.kt:22`；`A:map/CampusPlaces.kt:36-40`；`H:raw/map.html:30`；`H:core/MapTileMath.ts:32-34` |
| F06 | 地图旋转手势 `enableRotation()` | 有 | 未找到（`map.html` 仅平移/缩放） | ❌ | `A:map/MapViewModel.kt:63`；`H:raw/map.html:114-168`（无 rotate） |
| F07 | 拖拽 / 双指缩放 / 滚轮 | MapCompose 自带 | Pointer + wheel 自实现 | ✅ | `A:map/MapViewModel.kt:60-64`；`H:raw/map.html:119-168` |
| F08 | 缩放滑杆 1..5 / steps 7 / step 0.5 | Slider `1f..5f` steps 7 | Slider `1..5` step 0.5，映射 z15..18 | ✅ | `A:map/MapScreen.kt:186-191`；`H:pages/MapPage.ets:29-36,159-166` |
| F09 | 缩放倍率持久化 | `MapSettings.scale` 落库并由 flow 读回 | `@State mapScale` 组件局部，无落盘 | ❌ | `A:map/MapViewModel.kt:90-95`；`A:map/MapScreen.kt:61`；`H:pages/MapPage.ets:46,83-88` |
| F10 | 缩放倍率默认值 | `2f`（`collectAsState(initial=2f)`） | `1`（用户拍板：z15 视野最大） | ⚠️ | `A:map/MapScreen.kt:61`；`H:pages/MapPage.ets:45-46`；`RD:75` |
| F11 | 瓦片磁盘缓存（7 天 / 10MB） | `Cache(map_cache, 10MB)` + `maxAge` | 仅内存 `tileCache={}`，无磁盘缓存 | ❌ | `A:map/MapViewModel.kt:34-42,47`；`H:raw/map.html:38-39,99-106` |
| F12 | ODbL 署名常驻右下 | `© OpenStreetMap contributors` | HTML `#attrib` 右下 CSS 固定 | ✅ | `A:map/MapScreen.kt:204-223`；`H:raw/map.html:10-14,19` |
| F13 | 署名可点击跳版权页 | `openUri(openstreetmap.org/copyright)` | `pointer-events: none`，不可点 | ❌ | `A:map/MapScreen.kt:208-213`；`H:raw/map.html:13` |
| F14 | 课表/考试教室 → 地图定位 + 「已定位到XX」提示 | `MapTargetHolder` + `CampusPlaces.match` + `pendingLabel` | 全仓未找到（仅校区级 `gotoCampus`） | ❌ | `A:map/CampusPlaces.kt:96-130`；`A:map/MapViewModel.kt:106-116`；`A:map/MapScreen.kt:66-73`；`H:pages/MapPage.ets:59-80`（Grep `已定位到\|MapTarget\|pendingLabel` 无命中） |
| F15 | 4 校区（乡/村/珠/嘉）坐标与顺序 | `MapCampus.ALL` 4 项 | `CAMPUSES` 4 项，x/y 逐值相同 | ✅ | `A:map/MapCampus.kt:97-102`；`H:core/CampusCenters.ts:39-48` |
| F16 | 校区切换按钮 + 当前高亮 + 切换提示 | FAB 列 + snackbar | FAB 列 + `tip` 提示条 | ✅ | `A:map/MapScreen.kt:110-132`；`H:pages/MapPage.ets:68-80,115-122,131-141` |
| F17 | 校区真实 WGS-84 经纬度标注 | 注释逐校区列出 | 注释 + `lon/lat` 字段 | ✅ | `A:map/MapCampus.kt:91-95`；`H:core/CampusCenters.ts:7-10,39-48` |
| F18 | 楼栋坐标 + 别名最长匹配数据层 | `CampusLocations.ALL`（data 层） | `CampusLocations.ALL` 48 栋 + `match/normalize` | ✅ | `A:map/CampusPlaces.kt:55-93`；`H:core/CampusLocations.ts:36-107`；`H:core/CampusDirectory.ts:11,128,154` |
| F19 | 楼栋索引页（按校区 / 搜索 / 本机课程 / 系统地图打开） | 未找到证据 | `CampusMapPage` 独立页 | ➕ | `H:pages/CampusMapPage.ets:1-16,252-390`；`H:pages/SettingsPage.ets:1197-1210` |
| F20 | 珠海/嘉兴无建筑索引的诚实处理 | 「公开地图不渲染的地方别加」 | `hasBuildingIndex=false` + `noIndexHint` | ⚠️ | `A:map/MapCampus.kt:25-26`；`H:core/CampusCenters.ts:15-18,44-47,68-71`；`H:pages/CampusMapPage.ets:305-319` |
| F21 | 空教室三级结构 校区→教学楼→教室 | 设置页注释印证原版列全部校区 | 三级折叠 + 逐栋懒加载 | ✅ | `A:setting/page/FreeClassroomSettingPage.kt:110-111`；`H:pages/ClassroomPage.ets:4-6,166-169,482-623` |
| F22 | 一次取全楼 + 客户端分组（含字面量 `"null"` 清洗） | 原版 `CampusGrouping.kt` 未找到证据 | `groupCampuses` + `cleanCampus` | ⚠️ | `H:pages/ClassroomPage.ets:20-21`；`H:core/CampusGrouping.ts:19-20,49-56,80-140` |
| F23 | 13 节忙闲 + 分页 `pageSize=50` | 原版协议未找到证据 | `JC1..JC13` 解析 + 分页循环 | ✅ | `H:service/ClassroomService.ts:40,58-99,117-137`；`H:pages/ClassroomPage.ets:66,568-602` |
| F24 | 「现在空闲」判定 | `nextBusyTime` 精确到分（原版，未找到证据） | 节次粒度 `currentSection` 等价移植 | ⚠️ | `H:core/ClassroomFree.ts:4-16,28-57`；`H:pages/ClassroomPage.ets:37-38` |
| F25 | 「隐藏当前不空闲的教室」开关（默认 true） | `FreeClassroomSettingPage` Switch | 未找到 | ❌ | `A:setting/page/FreeClassroomSettingPage.kt:117-121`；`A:setting/viewmodel/FreeClassroomViewModel.kt:22,67-69` |
| F26 | 「空闲时段阈值」设置（默认 5 分钟） | `freeMinutesThreshold` + 数字输入弹窗 | 无设置；`ClassroomFree` 按 0 处理 | ❌ | `A:setting/page/FreeClassroomSettingPage.kt:122-127,184-193`；`A:setting/viewmodel/FreeClassroomViewModel.kt:23,54-56`；`H:core/ClassroomFree.ts:14-15` |
| F27 | 空教室「默认校区」设置 + 恢复默认 | 选择弹窗 `CampusSelectDialog` | 内联面板 + 「恢复默认（良乡）」 | ✅ | `A:setting/page/FreeClassroomSettingPage.kt:30-97,112-116`；`H:pages/SettingsPage.ets:1120-1177,497-515` |
| F28 | 默认校区落库 + 空教室页读取 | `setCampus` 写两个 key | `Prefs default_campus_code` | ✅ | `A:setting/viewmodel/FreeClassroomViewModel.kt:50-53`；`H:pages/SettingsPage.ets:58-59,484-495`；`H:pages/ClassroomPage.ets:160-169` |
| F29 | 空教室下拉刷新 | 原版 `PullToRefreshContainer`（注释引用） | `Refresh.onRefreshing` | ✅ | `H:pages/ClassroomPage.ets:478-480,643-648` |
| F30 | 「回到顶部 + 设置」两颗 FAB | 原版 `PageFab`（注释引用） | 文件头注释称「未搬」，但代码已实现 | ⚠️ | `H:pages/ClassroomPage.ets:36`（注释）vs `:376-405`（实现）；`RD:144` |
| F31 | 「今天第几周/哪一天」上屏 + 开学日未知不冒充第 1 周 | 原版未找到证据；`RD` 记为「建议修」 | 铁律 0.4 + `weekKnown` | ⚠️ | `RD:181,185`；`H:pages/ClassroomPage.ets:119-130,358-365,652-659` |
| F32 | 自习候选卡 + 全部候选详情页 | 未找到证据 | `SpotDetailPage` + `StudySpotService` | ➕ | `H:pages/SpotDetailPage.ets:1-14,193-195`；`H:service/StudySpotService.ts:1-13`；`RD:400-403` |
| F33 | 两站（徐特立图书馆 / 良乡大学城北地铁站） | 原版 `ShuttleLogic.kt` 注释引用 | `Stop` 枚举 + 两套时刻表 | ✅ | `H:core/ShuttleLogic.ts:2,19-27,53-77` |
| F34 | 工作日 39 班 / 周末及节假日 50 班 | 原版注释引用 + `RD` | 4 组 RAW 字符串逐条抄录 | ✅ | `H:core/ShuttleLogic.ts:9,53-77`；`H:pages/ShuttlePage.ets:356-359`；`RD:422` |
| F35 | 日类型只按星期 + 手动覆盖 | 原版 `dayTypeOf` 注释引用 | `autoDayType` + `manualDayType` chip | ✅ | `H:core/ShuttleLogic.ts:11,125-132`；`H:pages/ShuttlePage.ets:93-97,126-131,261-288` |
| F36 | 下一班倒计时 /「今天已发完」/ 按小时分组 | 原版 `TransportScreen` 注释引用 | `nextDeparture` + `groupByHour` | ✅ | `H:core/ShuttleLogic.ts:107-118,149-180`；`H:pages/ShuttlePage.ets:292-353` |
| F37 | 页面在场每 20s 刷新「现在」 | 原版 `LaunchedEffect(active)` 注释引用 | `setInterval(20000)` | ✅ | `H:pages/ShuttlePage.ets:110-116,119-124` |
| F38 | 班车页头形态 | 课表区内顶部 tab、无页头 | push 子页带「‹ 返回」 | ⚠️ | `H:pages/ShuttlePage.ets:7-9,215-233`（原版文件未找到证据） |
| F39 | 设置首页形态：12 入口卡 + 二级子页 NavHost | `SettingIndexPage` 12 卡 / `SettingScreen` 12 路由 | 单页 15 个分组 | ⚠️ | `A:setting/SettingIndexPage.kt:35-113`；`A:setting/SettingScreen.kt:46-181`；`H:pages/SettingsPage.ets:615-1408`；`RD:96` |
| F40 | 账号设置（头像/随机头像/昵称/签名/学号/UID/校园账号/社区/登录态检查/登出） | `AccountPage` 全量 | 「账号」组仅学号/状态/登录登出 | ❌ | `A:setting/page/AccountPage.kt:58-135`；`H:pages/SettingsPage.ets:680-724` |
| F41 | 页面设置（拖动排序 / 设主页 / 隐藏 / 重置） | `PagesSettingPage` | 未找到 | ❌ | `A:setting/page/PagesSettingPage.kt:84-86,155-204`；`A:setting/SettingScreen.kt:69-80` |
| F42 | 暗黑模式三档（跟随系统/浅/深） | `ThemeSettingPage` | `modeChip` 三档 | ✅ | `A:setting/page/ThemeSettingPage.kt:64-65`；`H:pages/SettingsPage.ets:638-650` |
| F43 | 配色方案三档 | 「BIT101经典/暖棕/清新青绿」 | 同三档 chip | ✅ | `A:setting/page/ThemeSettingPage.kt:70-71`；`H:pages/SettingsPage.ets:653-668` |
| F44 | 动态适配系统主题 / 自动旋转 | `ThemeSettingPage` 两项 | 明确不迁（无对应系统能力） | ⊘ | `A:setting/page/ThemeSettingPage.kt:58-59,76-77`；`H:pages/SettingsPage.ets:440-445` |
| F45 | 课程表数据设置 7 项（学期/起始日/课表数据/考试数据/时间表/自定义日程/导出 ICS） | `CalendarSettingPage` dataSettings | 「学期」组 +「作息时间」入口 | ❌ | `A:setting/page/CalendarSettingPage.kt:62-110`；`H:pages/SettingsPage.ets:726-787,1010-1022` |
| F46 | 课表显示开关 7 项 | `displaySettings`（周六/周日/边框/高亮今日/分隔线/当前时间线/考试安排） | 仅边框 + 分隔线 2 项，其余 `RD` 明确未接 | ⚠️ | `A:setting/page/CalendarSettingPage.kt:112-155`；`H:pages/SettingsPage.ets:962-990`；`RD:70` |
| F47 | 手动修改课程表 | `course-edit` 二级页 | 「查找」组入口 → `OverlayPage` | ✅ | `A:setting/SettingScreen.kt:142-150`；`H:pages/SettingsPage.ets:1024-1035` |
| F48 | DDL 设置（订阅链接/乐学拉取/延河拉取/会话/变色天数/滞留天数） | `DDLSettingPage` | 「作业来源」2 开关 +「延河课堂」拉取/会话 | ❌ | `A:setting/page/DDLSettingPage.kt:43-99`；`H:pages/SettingsPage.ets:835-938` |
| F49 | 动态设置（重新拉取/只看作业/条数上限/显示已过期/乐学入口） | `ActivitySettingPage` | 未找到对应设置（仅「课程动态」入口页） | ❌ | `A:setting/page/ActivitySettingPage.kt:62-119`；`H:pages/SettingsPage.ets:1050-1061` |
| F50 | 话廊设置（隐藏机器人 Poster） | `GallerySettingPage` | 未找到（`RD` 明确未做） | ❌ | `A:setting/page/GallerySettingPage.kt:50-56`；`RD:96` |
| F51 | 提醒设置（总开关 / 五类 / 提前量 / 系统权限 / 立即检查） | `NotifySettingPage` | `NotifySettingsPage` 独立子页 | ✅ | `A:setting/page/NotifySettingPage.kt:81-231`；`H:pages/NotifySettingsPage.ets:2,242-457`；`H:pages/SettingsPage.ets:943-960` |
| F52 | NFC 设置入口 | 索引卡 + `nfc` 路由 | 「查找」组「NFC 校园卡（只读诊断）」 | ✅ | `A:setting/SettingIndexPage.kt:93-100`；`A:setting/SettingScreen.kt:172-180`；`H:pages/SettingsPage.ets:1102-1114` |
| F53 | 空教室查询设置 3 项（默认校区 / 隐藏非空闲 / 空闲阈值） | `FreeClassroomSettingPage` 3 项 | 仅「默认校区」1 项 | ⚠️ | `A:setting/page/FreeClassroomSettingPage.kt:108-128`；`H:pages/SettingsPage.ets:1120-1177`；`H:core/ClassroomFree.ts:14-15` |
| F54 | 清理本地缓存页 + 6 类白名单 | 未找到证据 | `CacheCleanPage` + `CACHE_SPECS` | ➕ | `H:pages/CacheCleanPage.ets:1-9`；`H:core/CacheIndex.ts:32-81`；`RD:139` |
| F55 | 用户数据默认不勾 + 二次确认 + 设置页占用显示 | 未找到证据 | `userData` / `AlertDialog` / `cacheLine` | ➕ | `H:pages/CacheCleanPage.ets:66-92,124-147`；`H:core/CacheIndex.ts:175-180`；`H:pages/SettingsPage.ets:155-170,1219-1232` |
| F56 | 诊断信息页 vs Android「导出日志」 | 「导出 logcat 日志用于问题排查」 | 结构化环境信息 + 一键复制 | ⚠️ | `A:setting/page/AboutPage.kt:136-137,433-444`；`H:pages/DiagnosticsPage.ets:1-9,52-144` |
| F57 | 学号脱敏 / 一键复制 / 不上传 / 敏感字段排除 | `LogExporter`/`LogRedact`（实现未找到证据） | `maskStudent` 前 3 后 2 + `diagText` | ⚠️ | `H:core/DiagnosticsLogic.ts:6-9,45-60,103-111`；`H:pages/DiagnosticsPage.ets:8-9,147-157,209-210` |
| F58 | 本地版本号从包管理读（不写死） | `getAppVersion(context)` | `bundleManager.getBundleInfoForSelf` | ✅ | `A:setting/page/AboutPage.kt:406`；`H:pages/AboutPage.ets:52-62`；`H:pages/SettingsPage.ets:414-422` |
| F59 | 联网检查更新 `GET /version` | `versionRepo.getVersionInfo()` | `checkForUpdate` → `android.bit101.cn/version/` | ✅ | `A:setting/viewmodel/AboutViewModel.kt:24-26`；`H:service/VersionCheckService.ts:24-53`；`H:core/UpdateCheckLogic.ts:4-8` |
| F60 | 「自动检查更新」开关（启动自动检查，默认 true） | `autoDetectUpgrade` + `LaunchedEffect(Unit){checkUpdate()}` | 未找到（仅手动「检查更新」按钮） | ❌ | `A:setting/page/AboutPage.kt:89-90,380,392-394`；`A:setting/viewmodel/AboutViewModel.kt:21`；`H:pages/AboutPage.ets:139-146` |
| F61 | 强制更新 / 忽略版本 / 升级弹窗（含 APK url） | `UpdateDialog` + `setIgnoreVersion` | 只读提示去应用市场，不展示 url、不下载 | ⚠️ | `A:setting/page/AboutPage.kt:412-417,460-467`；`A:setting/viewmodel/AboutViewModel.kt:28-30`；`H:core/UpdateCheckLogic.ts:11-14,95-127,129-131`；`H:pages/AboutPage.ets:148-174` |
| F62 | 「网」Tab = `https://bit101.cn` WebView | `WebViewModel.BASE_URL` / `WebScreen` | `WorldWebPage` + `Index` 挂载 | ✅ | `A:web/WebViewModel.kt:13`；`A:web/WebScreen.kt:214-231`；`H:pages/WorldWebPage.ets:24,81-90`；`H:pages/Index.ets:238` |
| F63 | 顶部 `#FF9A57` 状态栏色块 | `Color(0xFFFF9A57)` | `STATUS_BAR_COLOR` + `Row` | ✅ | `A:web/WebScreen.kt:222-227`；`H:pages/WorldWebPage.ets:26,68-71` |
| F64 | 注入 `localStorage.store`：`theme_mode` + `fake_cookie` | `onPageStarted` 两段 `evaluateJavascript` | `onPageBegin` → `injectStore` | ✅ | `A:web/WebScreen.kt:101-129`；`H:pages/WorldWebPage.ets:40-64,89` |
| F65 | 线性进度条 | `LinearProgressIndicator` | `Progress` Linear | ✅ | `A:web/WebScreen.kt:202-210`；`H:pages/WorldWebPage.ets:73-79` |
| F66 | score 页自动填充学号/密码 | `doUpdateVisitedHistory` + `evaluateJavascript` | 未找到 | ❌ | `A:web/WebScreen.kt:155-175`；`H:pages/WorldWebPage.ets:40-90`（无此逻辑） |
| F67 | 文件选择器 / 外部链接交系统浏览器 | `onShowFileChooser` + `shouldOverrideUrlLoading` | 未找到文件选择器；`WebServicesPage` 明确「本版不做外部浏览器跳转」 | ❌ | `A:web/WebScreen.kt:133-153,184-197`；`H:pages/WebServicesPage.ets:33-37`；`H:pages/WorldWebPage.ets:8`（注释声称外链交浏览器但无实现） |
| F68 | 「留在 App 内」判定集 | 学校域 + `bit101.cn` + `10.0.0.55` | 仅 `*.bit.edu.cn` | ⚠️ | `A:common/utils/InAppWebUrls.kt:47-52`；`H:core/WebEntryLogic.ts:95-113` |
| F69 | 网页服务入口清单（6 个）+ 通用 Web 壳 | 未找到证据 | `WEB_ENTRIES` 6 项 + `WebShellPage` | ➕ | `H:core/WebEntryLogic.ts:31-68`；`H:pages/WebServicesPage.ets:69-92`；`H:pages/WebShellPage.ets:1-9,57-64`；`RD:364` |

**统计**：共 **69** 条；`✅` 对齐 **32** 条；差异（非 `✅`）**37** 条（其中 `⚠️` 15、`❌` 16、`➕` 5、`⊘` 1）。

---

## 3. 关键差异详述

### 3.1 地图底图与瓦片 / 校区与地点

- **底图方案已收敛**：当前鸿蒙「图」Tab 只用**在线 OSM 瓦片**。`H:pages/MapPage.ets:5-17` 明确「WebView + `rawfile/map.html` 内联瓦片引擎」；`H:raw/map.html:23,105` 的瓦片 URL 与 `A:map/MapViewModel.kt:44` 完全同源。`H:raw/` 目录枚举只有 `map.html`/`changelog.json`/icons/pem，**无官方 PDF 底图、无自绘矢量资源**。`RD:362` 曾记「改为楼栋索引、不做在线瓦片」，`RD:92`（alpha.28）又记「接自有瓦片地图」——两者并存于当前代码：`MapPage` 是在线瓦片，`CampusMapPage` 是楼栋索引（`H:pages/CampusMapPage.ets:4-11` 明确「这不是地理地图」「不提供在线瓦片」），后者由设置页「校园楼栋」入口进入（`H:pages/SettingsPage.ets:1197-1210`）。
- **署名**：两端都有 `© OpenStreetMap contributors`（`A:map/MapScreen.kt:218-222` / `H:raw/map.html:19`），但 Android 可点击跳版权页（`MapScreen.kt:208-213`），鸿蒙 `pointer-events: none`（`map.html:13`）不可点。
- **缓存与持久化缺口**：Android 有 7 天 / 10MB OkHttp 磁盘缓存（`A:map/MapViewModel.kt:34-42,47`）与 `MapSettings.scale` 持久化（`MapViewModel.kt:90-95`）；鸿蒙只有内存 `tileCache`（`map.html:38`）和组件内 `@State mapScale`（`MapPage.ets:46`）。切页/重启后倍率丢失、瓦片重复下载。
- **旋转**：Android `enableRotation()`（`MapViewModel.kt:63`），鸿蒙 `map.html:114-168` 只处理平移/双指缩放/滚轮，无旋转。
- **地点定位链路断裂（最大功能缺口）**：Android 用 `MapTargetHolder.request/consume`（`A:map/CampusPlaces.kt:110-130`）+ `CampusPlaces.match` 最长别名匹配（`:73-82`）+ `pendingLabel` 提示条（`A:map/MapScreen.kt:66-73`）实现「课表/考试点教室 → 地图落到那栋楼」。鸿蒙全仓 Grep `已定位到|MapTarget|pendingLabel` **无命中**；`MapPage.ets:68-80` 只有校区级 `gotoCampus`。而鸿蒙其实**已有** `CampusLocations.match/normalize`（`H:core/CampusLocations.ts:13-17`、`CampusDirectory.ts:11,128,154`），只是被楼栋索引用于「课表课程归楼」，没接到地图定位。
- **缩放默认值**：Android `2f`（`MapScreen.kt:61`），鸿蒙 `1`（`MapPage.ets:45-46`，`RD:75` 记「默认 mapScale 2→1，真机默认显示完整良乡校区」）——**用户拍板的有意差异**，登记不改代码。

### 3.2 空教室筛选与时段

- 鸿蒙查询协议完整：`H:service/ClassroomService.ts:5-15,58-99` 分页 `pageSize=50`、13 节 `JC1..JC13`、占用码 `STATUS_MAP`；`H:pages/ClassroomPage.ets:166-169` 一次取全楼后 `groupCampuses` 分组（含字面量 `"null"` 清洗，`H:core/CampusGrouping.ts:19-20,49-56`）。
- **两个设置项缺失，直接影响结果口径**：
  1. 「隐藏当前不空闲的教室」——Android `A:setting/page/FreeClassroomSettingPage.kt:117-121`，默认 `hideBusyClassroom=true`（`FreeClassroomViewModel.kt:22,67-69`）。鸿蒙 `ClassroomPage` 无该开关。
  2. 「空闲时段阈值」——Android `FreeClassroomSettingPage.kt:122-127,184-193`，默认 `freeMinutesThreshold=5L`（`FreeClassroomViewModel.kt:23`）。鸿蒙 `H:core/ClassroomFree.ts:14-15` 明确写「原版的 freeMinutesThreshold 鸿蒙没有对应设置，这里按 0 处理」。⚠️ 注意：鸿蒙注释称原版「默认 0」，与 Android 源码 **`5L`** 不一致，属可证伪的数值口径分歧，修复时以 Android 源码为准。
- **「现在空闲」粒度差异（已如实记录）**：Android 原版是 `nextBusyTime >= now + threshold` 精确到分；鸿蒙是节次粒度 `currentSection`（`H:core/ClassroomFree.ts:4-16,28-57`），「每节开头一瞬」取诚实侧差异，`H:pages/ClassroomPage.ets:37-38` 已注明。
- **注释与代码不一致**：`H:pages/ClassroomPage.ets:36` 称「原版 FAB 组（回到顶部 + 设置）…未搬」，但 `:376-405` 的 `fabActions()` 已实现两颗 FAB（`RD:144` 也记「空教室回到顶部 + 下拉刷新」已补）。注释需订正，避免误导后续修复。
- **日期上屏**：鸿蒙铁律 0.4 把「第 N 周 · 周X · 日期」写在屏上（`ClassroomPage.ets:358-365,441-444`），`weekKnown=false` 时写「周次未知」不拿默认值冒充（`:119-130,360-361`）；`RD:181,185` 把「开学日未知时标题仍显示第 1 周」记为 Android 侧「建议修」项。

### 3.3 班车

- 鸿蒙 `H:core/ShuttleLogic.ts` 1:1 移植 Kotlin `ShuttleLogic.kt`（文件头 `:1-14`），两站、工作日 39 / 周末节假日 50 班、只按星期判日类型 + 手动覆盖、下一班/末班/按小时分组、20s 刷新均已具备（`RD:422` 记「两站 39/50 班；末班判定今天已发完；30 条断言钉住时刻表」）。
- **结构差异**：Android 原版是「课表」区内的顶部 tab、无页头；鸿蒙是 `Index` push 的子页、带「‹ 返回」顶栏（`H:pages/ShuttlePage.ets:7-9,215-233`）。原版 `TransportScreen.kt` 在给定材料外 → **未找到证据**，此差异依据鸿蒙注释。
- 鸿蒙额外写了站牌数据来源与免责（节假日/寒暑假判断不了、东校区南门中途上车、刷校园卡免费）（`ShuttlePage.ets:355-359`），Android 侧未找到对应文本证据。

### 3.4 设置项全量

- **架构级差异（已登记有意取舍）**：Android = `SettingIndexPage` **12 张入口卡**（`A:setting/SettingIndexPage.kt:35-113`）+ `SettingScreen` **12 条二级路由**（`SettingScreen.kt:46-181`）；鸿蒙 = `SettingsPage` **单页 15 个分组**（`H:pages/SettingsPage.ets:615-1408`）。`RD:96` 明确「设置页 12 入口卡 + 8 个二级子页（现为分组列表，MIGRATION-BASELINE §9.3 记录为有意取舍）…需单独排期」。
- Android 二级页设置项全量（附行号）：账号 10 项（`AccountPage.kt:58-135`）、页面编辑（`PagesSettingPage.kt:84-86,155-204`）、外观 4 项（`ThemeSettingPage.kt:58-77`）、课表数据 7 项 + 显示 7 开关（`CalendarSettingPage.kt:62-155`）、DDL 6 项（`DDLSettingPage.kt:43-99`）、动态 5 项（`ActivitySettingPage.kt:62-119`）、话廊 2 项（`GallerySettingPage.kt:50-56`）、提醒全量（`NotifySettingPage.kt:81-231`）、空教室 3 项（`FreeClassroomSettingPage.kt:108-128`）、关于（`AboutPage.kt:82-137`）。
- 鸿蒙已对齐的：暗黑模式 3 档、配色 3 档、手动改课表入口、提醒设置（独立子页）、NFC 入口、默认校区。
- 鸿蒙缺失的：账号设置细化、页面设置、课表数据设置 7 项中的多数、DDL 设置（订阅链接/乐学/变色/滞留）、动态设置、话廊设置、关于页联系方式/开源声明/导出日志。课表显示开关只有 2 项（边框/分隔线），`RD:70` 明确「周末列隐藏/当前时间线/考试信息未接（涉网格结构，不做假开关）」。
- 鸿蒙多出的分组：成绩（成绩查询/出分提醒/立即检查一次）、校园（教学安排调整/校园楼栋）、存储与诊断、开发者选项（`SettingsPage.ets:789-830,1179-1387`）。

### 3.5 缓存清理

- Android 设置索引 12 张卡中**没有**「清理缓存」入口 → **未找到证据**；`AboutPage.kt:136-137` 只有「导出日志」。
- 鸿蒙 `H:pages/CacheCleanPage.ets` + `H:core/CacheIndex.ts:32-81` 白名单 6 类（课表/考试/成绩/教学调整/提醒记录/作业数据），`ddl_schedule_v1` 标 `userData`（`:74-80`），默认不勾 + 二次确认（`CacheCleanPage.ets:66-92,124-147`），设置页显示占用（`SettingsPage.ets:155-170`）。`RD:105,139` 记「存储与清理」为真机走查项、M11 新增能力。
- 结论：这是鸿蒙**多出**的能力，不是待补差距；但「Android 是否有等价清缓存」需扩大材料范围才能定论。

### 3.6 诊断

- Android：`AboutPage.kt:136-137`「导出日志」→ `LogExporter.export/share`（`:433-444`），实现文件未读到。
- 鸿蒙：`DiagnosticsPage` 采集版本/设备/OS/登录态/学号脱敏/缓存/通知权限/最近课表/出分检查（`H:pages/DiagnosticsPage.ets:52-144`），`diagLines` 10 行（`H:core/DiagnosticsLogic.ts:68-82`），一键复制（`:147-157`），**不上传**（`DiagnosticsPage.ets:8-9`），学号前 3 后 2 脱敏（`DiagnosticsLogic.ts:45-60`），不含密码/cookie/JWT/手机号/成绩（`:6-9,103-111`）。`RD:104` 记真机补验。
- 两者形态不同（导出 logcat 文件 vs 复制结构化环境信息），目标一致；`LogRedact` 脱敏口径未读到 → **未找到证据**，不做等价断言。

### 3.7 版本检查

- 两端都从包管理读版本号、都联网 `GET /version`（`A:setting/viewmodel/AboutViewModel.kt:24-26` / `H:service/VersionCheckService.ts:24-53`）。鸿蒙复用 Android 服务端 `android.bit101.cn/version/`（`VersionCheckService.ts:24`），并踩过 308 重定向坑（`:21-23`）。
- **自动检查缺失**：Android `autoDetectUpgrade` 默认 true + 进页 `LaunchedEffect(Unit){vm.checkUpdate()}`（`AboutPage.kt:380,392-394`；`AboutViewModel.kt:21`），且有「自动检查更新」开关（`AboutPage.kt:89-90`）；鸿蒙只有手动「检查更新」按钮（`AboutPage.ets:139-146`）。
- **更新交付形态有意不同**：Android `UpdateDialog` + `setIgnoreVersion`（`AboutPage.kt:460-467`；`AboutViewModel.kt:28-30`）；鸿蒙 `UpdateCheckLogic.ts:11-14,129-131` 明确「不展示 APK url、不下载、去应用市场」，`AboutPage.ets:160,171` 明示文案。这是平台安全边界，**不列为待修差距**。
- **失败口径不同**：Android 明确 `onSnackBar("检查更新失败")`（`AboutPage.kt:408-410`）；鸿蒙 `VersionCheckService.ts:39-57` 对非 200 / 坏 JSON / 异常一律返回 `NONE` 静默不提示（`RD` 也强调「不弹错误吓人、不谎报有更新」）。
- 鸿蒙多出 `changelog.json` 本地更新说明（`AboutPage.ets:191-200`；`VersionLogic.ts:133-167`），Android 侧未找到证据。

### 3.8 Web 服务入口

- 「网」Tab 对齐度高：`bit101.cn`、`#FF9A57` 状态栏、`localStorage.store` 注入 `theme_mode` + `fake_cookie`、线性进度条四项均 1:1（`A:web/WebScreen.kt` vs `H:pages/WorldWebPage.ets`）。
- **Android 三个 WebView 能力鸿蒙缺失**：score 页自动填充学号密码（`WebScreen.kt:155-175`）、文件选择器（`WebScreen.kt:184-197`）、非内部链接交系统浏览器（`WebScreen.kt:133-153`）。`WorldWebPage.ets:8` 注释写「非 bit101.cn 的链接交系统浏览器」，但全文 `:66-94` **无拦截实现**；`WebServicesPage.ets:33-37` 明确「本版不做外部浏览器跳转，只提示」。
- **判定集不同**：Android `InAppWebUrls.isInternal` = 学校域 + `bit101.cn` + `10.0.0.55`（校园网门户）（`InAppWebUrls.kt:47-52`，注释 `:9-16` 说明这是 CAS 登录 cookie 不丢的关键）；鸿蒙 `shouldStayInApp` 仅 `*.bit.edu.cn`（`WebEntryLogic.ts:95-113`），**不含** `bit101.cn` 与 `10.0.0.55`。
- 鸿蒙多出：6 个网页服务入口清单（`WebEntryLogic.ts:31-68`）+ 通用 Web 壳（`WebShellPage.ets`）；`RD:364` 记「Web 壳 ✅ 六个已验证入口（门户/教务/图书馆/一卡通/座位/SSO）」、`RD:107` 记「Web 壳入口组未逐项验」。

---

## 4. 可执行修复清单

> 验收判据均写成**可证伪**的形式（能被人重跑/能被源码断言推翻）。优先级：`P0` = 正确性/合规/明显功能缺口且风险可控；`P1` = 功能补齐；`P2` = 文案/结构/低优先。

| 编号 | 改动点 | 鸿蒙文件 | 验收判据（可证伪） | 风险 | 优先级 |
| --- | --- | --- | --- | --- | --- |
| G07-01 | 补「隐藏当前不空闲的教室」开关，默认与 Android 一致为 `true` | `H:pages/SettingsPage.ets`、`H:pages/ClassroomPage.ets`、`H:data/Prefs.ts` | 设置页出现该开关且初值 `true`；关闭后 `ClassroomPage` 展开任意楼时仍列出占用中教室，开启后占用中教室被过滤；杀进程重启后开关值保留。对照 `A:setting/page/FreeClassroomSettingPage.kt:117-121` 与 `FreeClassroomViewModel.kt:22` | 低（纯展示层过滤，不触碰查询协议） | **P0** |
| G07-02 | 补「空闲时段阈值」设置并按 Android 默认 `5` 分钟接入 `isFreeNow`；订正 `ClassroomFree.ts:14` 中「默认 0」的注释错误 | `H:pages/SettingsPage.ets`、`H:core/ClassroomFree.ts`、`H:pages/ClassroomPage.ets` | 设置项初值 `5`（对齐 `A:setting/viewmodel/FreeClassroomViewModel.kt:23`）；把阈值改为 `0` 与 `5` 时，同一 `busySections + table + nowMinutes` 输入的 `isFreeNow` 结果在临界样本上不同；源码断言锁死默认值不再写 0 | 中（涉及「现在空闲」语义，需补纯函数单测，避免改坏 F24 已记录的诚实侧差异） | **P0** |
| G07-03 | 瓦片磁盘缓存（对齐 7 天 / 10MB），避免每次进「图」重复下载 | `H:raw/map.html`、`H:pages/MapPage.ets`、`H:service/`（若走原生 rcp 下载则新增） | 断网后重进「图」Tab，此前已加载的校区瓦片仍可见（不依赖 WebView 内存）；存在明确的缓存上限与过期策略常量，且 ODbL 署名仍在（`map.html:19`） | 中（WebView 内 JS 无法直接写盘，需 ArkTS 侧代理瓦片请求或 WebView 缓存配置；避免引入跨域/合规问题） | **P0** |
| G07-04 | 接「课表/考试教室 → 地图定位」：新增一次性 `MapTargetHolder` 等价件 + `CampusLocations.match` 最长别名 + 定位提示条 | `H:pages/MapPage.ets`、`H:core/CampusLocations.ts`（复用 `match`）、新增 `H:core/MapTarget.ts` | 从课表地点「文萃楼I404」触发进「图」，`MapEngine.goto` 收到的是 `文萃楼I` 的归一化坐标且层级为地点级（0.5 对应 z18，对齐 `A:map/CampusPlaces.kt:31-40`），屏上出现「已定位到…」提示；`consume()` 取一次即清空，旋转不重复弹 | 中（跨页面传参，须保证底栏 Tab 切换不丢目标；不得影响校区按钮默认定位） | **P0** |
| G07-05 | 地图缩放倍率持久化（对齐 `MapSettings.scale`） | `H:pages/MapPage.ets`、`H:data/Prefs.ts` | 滑杆调到 3.0 → 切到别的 Tab 再切回 / 杀进程重启，仍为 3.0 且 `scaleToZoom` 输出一致（`MapPage.ets:34-36`）；新增 key 不与 `CacheIndex.CACHE_SPECS` 白名单冲突 | 低 | **P0** |
| G07-06 | 外链策略对齐：Web 组件内拦截，学校域 + `bit101.cn` + `10.0.0.55` 留内，其余交系统浏览器 | `H:pages/WorldWebPage.ets`、`H:pages/WebShellPage.ets`、`H:core/WebEntryLogic.ts`、`H:pages/WebServicesPage.ets` | 点非内部链接时系统浏览器被拉起（且设备无浏览器不崩）；`shouldStayInApp('https://bit101.cn/…')` 与 `shouldStayInApp('http://10.0.0.55/')` 均返回 `true`（对齐 `A:common/utils/InAppWebUrls.kt:47-52`）；`WebServicesPage.ets:35-37` 的「本版不跳」提示被替换 | 中（涉及 CAS 会话 cookie 留存，误踢浏览器 = 白登；须按 `InAppWebUrls.kt:9-16` 的纪律做） | **P0** |
| G07-07 | score 页自动填充学号/密码 | `H:pages/WorldWebPage.ets` | 导航到 `${BASE_URL}/score/` 时注入脚本写 `#sid`/`#password` 并 dispatch `input`；URL 短路，非 score 页不读凭据（对齐 `A:web/WebScreen.kt:155-175`）；读不到凭据不注入 | 中（涉及凭据读取，须沿用「只在 URL 命中时、协程内读、不落日志」口径） | P1 |
| G07-08 | WebView 文件选择器 | `H:pages/WorldWebPage.ets`、`H:pages/WebShellPage.ets` | H5 `<input type=file>` 点击能拉起系统文件选择并把结果回传 WebView；无可用应用时给出提示不崩（对齐 `A:web/WebScreen.kt:184-197`） | 中（ArkWeb 文件选择 API 需真机验，本次不验） | P1 |
| G07-09 | 关于页「自动检查更新」开关 + 启动自动检查（默认开） | `H:pages/AboutPage.ets`、`H:service/VersionCheckService.ts`、`H:data/Prefs.ts` | 开关默认值 `true`；关闭后进关于页不自动发 `/version/` 请求，打开则自动发；手动「检查更新」按钮始终可用（对齐 `A:setting/page/AboutPage.kt:89-90,392-394`） | 低（只读 GET，无副作用；注意 `VersionCheckService` 的 308 尾斜杠纪律） | P1 |
| G07-10 | 课表显示开关补齐 7 项（周六/周日/高亮今日/当前时间线/考试安排） | `H:pages/SettingsPage.ets`、`H:data/ScheduleDisplayStore.ts`、`H:pages/SchedulePage.ets` | 每组开关切换后课表网格可见变化；`RD:70` 明确「不做假开关」，故必须真接线，不能只加 UI | 中（涉网格结构，`RD:70` 已标注需真机对照） | P1 |
| G07-11 | 设置页 12 入口卡 + 二级子页结构（`RD:96` 已登记「有意取舍，需单独排期」，须先拍板） | `H:pages/SettingsPage.ets` + 新增二级页 | 若拍板执行：设置首页出现 12 张入口卡且各自能进对应子页，现有 15 组内容不丢；若不拍板，则本条保持为「已登记取舍」不改代码 | 高（大规模结构搬迁 + 数据层，`RD:96` 明确需真机对照后再定） | P1 |
| G07-12 | 补齐缺失设置子页（账号细化 / 页面设置 / 课表数据 7 项 / DDL / 动态 / 话廊 / 关于联系方式与导出日志） | `H:pages/SettingsPage.ets` 及新增页 | 逐项对照 `A:setting/page/*` 的 `title` 清单（见 §3.4）勾选；每项要么实现、要么显式标注「不做」并给原因，不允许静默缺失 | 高（多个依赖社区/账号/日历数据层） | P2 |
| G07-13 | 地图旋转手势 | `H:raw/map.html`、`H:pages/MapPage.ets` | 双指旋转时瓦片随之旋转（对齐 `A:map/MapViewModel.kt:63` 的 `enableRotation()`）；旋转后 `goto`/`setZoom` 仍正确 | 中（Canvas 旋转会影响命中与瓦片范围计算，需重跑 `MapTileMath` 单测） | P2 |
| G07-14 | ODbL 署名可点击跳版权页 | `H:raw/map.html`、`H:pages/MapPage.ets` | 点击署名能打开 `https://www.openstreetmap.org/copyright`（对齐 `A:map/MapScreen.kt:208-213`），打不开不崩且署名文字仍可见 | 低 | P2 |
| G07-15 | 订正 `ClassroomPage` 文件头注释（FAB 已实现） | `H:pages/ClassroomPage.ets:36` | 注释不再写「FAB 组…未搬」，与 `:376-405` 代码及 `RD:144` 一致 | 低（纯注释） | P2 |
| G07-16 | 登记缩放默认值 2→1 为有意差异（不改代码） | 本篇 §3.1 已登记；如需落库则 `H:pages/MapPage.ets:45-46` 加注释 | 代码注释明确写出「Android 默认 2f，鸿蒙按用户拍板取 1」并引用 `RD:75` | 低 | P2 |
| G07-17 | 版本检查失败提示口径对齐 | `H:pages/AboutPage.ets`、`H:service/VersionCheckService.ts` | Android 是「检查更新失败」snackbar（`AboutPage.kt:408-410`），鸿蒙当前静默；需拍板选「如实报错」或「保持静默」，二选一写进代码注释，不允许两种口径混用 | 低 | P2 |
| G07-18 | 「现在空闲」节次边界与原版对齐（可选） | `H:core/ClassroomFree.ts` | 若拍板对齐分钟级 `nextBusyTime`，需补纯函数单测覆盖「每节开头一瞬」；`H:pages/ClassroomPage.ets:37-38` 已记录该差异为诚实侧，改前须确认不破坏自习候选口径 | 中（可能改变自习卡结果） | P2 |

**修复清单合计 18 条；P0 编号：G07-01、G07-02、G07-03、G07-04、G07-05、G07-06（6 条）。**

---

## 5. 明确不做项及原因

| 编号 | 不做项 | 原因 | 证据 |
| --- | --- | --- | --- |
| N01 | 官方 PDF 底图 / 自绘矢量校园图 | team-lead 任务给定已知起点：「官方 PDF 底图 / 自绘矢量已 revert 并明确不做」。当前「图」Tab 只用在线 OSM 瓦片；`H:raw/` 目录枚举**无**任何 PDF/矢量底图资源。⚠️ `RD` 全文 Grep `PDF\|自绘矢量\|revert` **未找到文字记录**，此项以 team-lead 已知起点 + 当前代码/资源现状为准 | `H:pages/MapPage.ets:5-17`；`H:raw/map.html:23,105`；`H:raw/` 目录枚举；`RD:90,92,362` |
| N02 | 离线瓦片包 / 自建瓦片服务器 | 瓦片服务有配额与 ODbL 署名条款，自建要服务器；把「打开真实地图」交给系统地图（`geo:`）是楼栋索引页的既定取舍 | `H:pages/CampusMapPage.ets:9-11`；`H:core/CampusCenters.ts:60-65` |
| N03 | App 内自下载 / 安装 APK 更新 | 鸿蒙不能装 APK；自助更新涉及签名/渠道/降级/分包校验，做不好即安全问题。更新一律引导应用市场，服务端 `url` 字段不展示不点开 | `H:pages/AboutPage.ets:9-10,160,171`；`H:core/UpdateCheckLogic.ts:11-14,129-131`；`H:service/VersionCheckService.ts:2-10` |
| N04 | 诊断信息上传 | 上传要引入账号体系或匿名 ID，新增隐私面；复制粘贴给开发者已够用 | `H:pages/DiagnosticsPage.ets:8-9`；`H:core/DiagnosticsLogic.ts:103-111` |
| N05 | 「动态适配系统主题」/「自动旋转」两项外观设置 | 鸿蒙无对应系统能力，明确不迁（Android 12+ 专属） | `A:setting/page/ThemeSettingPage.kt:58-59,76-77`；`H:pages/SettingsPage.ets:440-445` |
| N06 | 珠海 / 嘉兴校区建筑级坐标 | 公开 OSM 数据太稀、无可信建筑坐标；只给校区中心点，不编造建筑、不伪造可点卡片 | `H:core/CampusCenters.ts:15-18,44-47,68-71`；`A:map/MapCampus.kt:25-26` |

**不做项合计 6 条。** 另需说明：F67 中的「外部浏览器跳转」在鸿蒙当前被 `WebServicesPage.ets:35-37` 标注为「本版不做」，但**Android 有该能力**，故本文把它列为待修差距（G07-06）而非不做项；是否保留需产品拍板。

---

## 6. 红线与统计声明

- 本文**只读**：未改任何源码、未做 git 提交、未做网络请求、未做真机验证、未做构建。
- 所有判断附 `file:line`；未在给定材料内读到的实现一律写「未找到证据」（见 §1.5）；`⚠️`/`❌`/`➕`/`⊘` 未写成 `✅`。
- 进度数字**只引用** `RD`（`RD:75,92,96,104,105,107,139,144,181,185,362,364,400-403,422` 等），未自行推算完成率。
- 功能对照表 69 条：`✅` 32 / 差异 37（`⚠️` 15、`❌` 16、`➕` 5、`⊘` 1）；修复清单 18 条（P0 6 条）；不做项 6 条。

---

v1.0 / 2026-11-24

---

## 7. 修复进度登记（2026-11-26，v1.0 审计内容不改动）

| 编号 | 状态 | 证据 |
|---|---|---|
| G07-01 | ⚠️ 代码完成 + 静态绿，**真机待验** | commit `84e4184`（alpha.49/versionCode 49）；`test-classroomfree.mjs` 44 断言（含开关接线守卫）；红/绿日志对 `evidence/g07-classroom-20261126/`；全测 94/94 + CI success。真机：装机版本 `bm dump`=49 ✅，但设备教务会话过期 + 本设备滚动注入无效 ⇒ 开关可见性/过滤效果未验 |
| G07-02 | ⚠️ 代码完成 + 静态绿，**真机待验** | 同上；阈值临界样本 0 vs 5 结果不同已在纯函数测中钉死；`DEFAULT_FREE_MINUTES=5` 单一来源；阈值 UI 真机未验（同 G07-01 设备限制） |

> 两项目前不判 ✅（G5 未签字）。待设备登录恢复 + 可滚动后，由用户本人在设置页确认开关初值 true、阈值初值 5、改动后空教室列表按预期过滤，再回写为 ✅。

*v1.1 进度登记 / 2026-11-26*

### 7.2 地图四件套（2026-11-27，v1.0 审计内容不改动）

| 编号 | 状态 | 证据 |
|---|---|---|
| G07-03 | ⚠️ 代码完成 + 静态绿，**真机待验** | `corelogic/MapTileCachePolicy.ts`（7 天 TTL / 10MB / LRU 纯策略，单测钉死）；`MapPage` 显式 `.cacheMode(CacheMode.Default)`（ArkWeb HTTP 磁盘缓存，与 Android OkHttp Cache 同构）；`map.html` 瓦片 URL 无 cache-buster、ODbL 署名保留。`test-mapparity.mjs` 静态守卫锁定。**边界如实**：ArkWeb 缓存的实际容量/过期由 WebView 内核与服务端 Cache-Control 决定，应用层的 7 天/10MB 是策略声明与纪律常量，不是强制配额；断网重进可见性需真机验 |
| G07-04 | ⚠️ 代码完成 + 静态绿，**真机待验** | `corelogic/MapTarget.ts` 一次性 holder（consume 取完即清，拆红反证 `evidence/map-parity-20261127/red-consume-20261127.log`）；`targetFromPlace` 复用 `CampusLocations.match` 最长别名（文萃楼I404→文萃楼I，地点级 z18）；`SchedulePage` 课程详情「在地图查看」入口 + 匹配失败明说「暂未收录」；`Index` 的 `@Watch('onMapNav')` 切模块；`MapPage.onPageEnd` 消费并弹提示 |
| G07-05 | ⚠️ 代码完成 + 静态绿，**真机待验** | `corelogic/MapScaleLogic.ts` 单一来源（默认 1，用户拍板；scaleToZoom 1→z15 / 5→z18）；`data/MapSettingsStore.ts` key `ui_map_scale`（不在 CacheIndex 白名单，清缓存不掉倍率）；`MapPage` aboutToAppear 读回、滑杆 onChange 写盘 |
| G07-06 | ⚠️ 代码完成 + 静态绿，**真机待验** | `shouldStayInApp` 扩为学校域 + `bit101.cn`(含子域) + `10.0.0.55`（对齐 `A:InAppWebUrls.kt:39-46`，拆红反证 `red-weblink-20261127.log`）；`WebNavPolicy.ts` 纯判定；`WebServicesPage` 外部链接 `startAbility(viewData)` 交系统浏览器、无浏览器 toast 不崩；`WorldWebPage`/`WebShellPage` 的 `.onLoadIntercept` 拦下外部导航（内部域放行保 CAS 会话 cookie）。旧「本版不跳」提示已移除 |

> 本批不判 ✅（G5 集中验收未做）。真机需验：断网重进地图瓦片可见、课表教室点「在地图查看」定位到楼且提示只弹一次、缩放滑杆杀进程后保持、非内部链接拉起系统浏览器且无浏览器不崩。

*v1.2 进度登记 / 2026-11-27*

### 7.3 G07-09 关于页自动检查更新开关（2026-11-27，v1.0 审计内容不改动）

| 编号 | 状态 | 证据 |
|---|---|---|
| G07-09 | ⚠️ 代码完成 + 静态绿，**真机待集中验** | alpha.59；新增 `data/UpdateSettings.ts` 布尔偏好（默认 true，对齐 Android `AboutPage.kt:380 initial=true`）；`AboutPage.aboutToAppear` 串行——先 `loadVersion()` 拿版本号再 `doCheckUpdate()`（防竞态拿空版本号打 /version），仅开时发只读 GET；关闭后进页不请求，手动「检查更新」按钮始终可用。`test-p1batch` 静态守卫。真机需验：关闭开关后进关于页不请求、打开则请求、切换落盘。 |

*v1.3 G07-09 进度 / 2026-11-27*
