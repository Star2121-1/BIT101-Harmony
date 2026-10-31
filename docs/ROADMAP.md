# BIT101-S 鸿蒙版迁移路线图（唯一进度权威）

> 建立：2026-10-20 ｜ 更新：**2026-10-30**
> 文档索引 → [`README.md`](README.md)（本目录）｜项目说明与截图 → [`../README.md`](../README.md)
>
> **当前状态（2026-10-30）**：M0/M1 ✅ ｜ M2 课表除「覆盖层待真机」外全完 ｜ M3 空教室/自习 5/5 ✅ ｜
> M4 DDL/动态 5/5 ✅（作业来源设置已做）｜ M5 班车 ✅、一卡通/校园网/图书馆代码完待真机 ｜ M6 设置 5/5 ✅ ｜
> M7 提醒（逻辑 + 设置页 + 通知列表）+ **出分取数管道**已建 ｜ M8 卡片 4×4 **真机已验**（点击深链 / 定时刷新已接，待真机验）｜
> M9 座位逻辑层全完 + UI 已建（提交需有效会话，未验）｜ M10 **成绩页 / 版本说明 / 网页服务**代码完成；**校园地图改设计为「楼栋索引」已实现** ｜
> **M11 新增（2026-10-28）**：全局搜索 / 通知分组与未读 / 通知点击深链 / 存储与清理 / 诊断页 / 无障碍（部分）。
> **M12 新增（2026-10-28 第二轮「只改代码」）**：课表左右滑动切周 / 通知免打扰时段 / 排期提醒点击深链（补齐 M11-3 遗留）/
> 无障碍文案统一层 + 成绩·考试·我页接入 / DDL 排序切换（按截止 · 按课程）/ 台账两处过期状态纠偏（课表离线缓存、卡片时间列）。
> 本轮新增 4 个纯逻辑模块（`WeekNav` / `QuietHoursLogic` / `A11yText` / `DdlSortLogic`）+ 2 个数据层（`QuietHoursStore` 等），
> **全部真机零验证**（用户明确要求先只改代码，后面统一 debug）。
> **UI 迁移 #81~#91 ✅**；2026-10-28 补齐 **DDL 三颗 FAB**（＋ 新增 / 学士帽 / ⚙）与**空教室回到顶部 + 下拉刷新**，
> 学期列表改为**近 3 学年 + 折叠旧学期**。全量单测 **58 套件 3017 断言绿**；版本 `1.0.0-alpha.10`。
> **2026-10-30 复核**：main `ae2ee06` 与 tag `h-v1.0.0-alpha.10` 均已推远端，工作区干净。本机 Node 24 下
> `test-timetable` 曾因末尾 `process.exit()` 在退出瞬间触发 libuv 断言（`src\win\async.c:76`，28 条断言全过但退出码 127）
> 被记成假红；已改 `process.exitCode`，复跑 58/58、3017 断言、exit 0。§9 统计表按 §4 行首标记重算。
> **CI 自 2026-10-26 起连续红 20+ 次的根因（2026-10-30 定位）**：`test-uiconventions` 在 Ubuntu 报「违规 1 处」、
> 本机却绿 —— 本机 14 个 `.ets` 是 CRLF 工作副本（入库是 LF），扫描器按 `'\n'` 切后行尾残留 `\r`，`\{$` 匹配不上，
> **悄悄漏扫这些文件里的 `Scroll()`**。改成 `/\r?\n/` 后本机立刻复现出真 bug：`SeatMonitorPage.ets:345` 的 `Scroll`
> 有 `layoutWeight(1)` 缺 `.align(Alignment.Top)`（内容不足一屏会垂直居中）。已补 align；扫描器同时覆盖
> `Scroll(this.scroller)` 带参形态（覆盖 28→29 处），并做了「拆掉 align 看红」的负向对照。CI 注解 grep 补上明细行前缀。
> 修复提交 `050843e` 已推，CI `unit` 恢复绿（2026-10-30 08:14Z，之前最后一次绿是 2026-10-26 `82d2525`）；
> 本地 58/58、3017 断言、exit 0，debug HAP 编译成功。**教训**：栅栏读源码别按 `'\n'` 切，Windows 工作副本
> 可能是 CRLF（入库 LF）⇒ 本地绿、CI 红；本机绿不能替代跨平台复核。
> 证据：`harmony/evidence/ci-2026-10-30/`（单测日志 58/3017、构建日志、check-run JSON）。
> **2026-10-30 真机验证**（nova 14 Pro，USB `4CY9K25614019980`，装 16:12 debug 包）：`SeatMonitorPage` 顶对齐修复已验 ——
> `还没有监控任务` bounds 修复前 `[40,1604][1184,1655]` → 修复后 `[40,680][1184,731]`（状态条 bottom=459，贴顶）。
> 同机对照官方 `cn.bit101.android` 1.4.6 记录差异（待决策）：① 课表卡片文字截断（我方 `计算机系…`，官方同宽度列完整显示
> `计算机系统导论`）— 建议修；② 空教室开学日未知时标题仍显示「第 1 周 · 周一」（实际第 9 周 周5）— 建议修；
> ③ 座位预约「区域 / 座位状态」空标题 — 建议修；④ 「我」页顶部图标无可访问名 — 建议补。**未验**：成绩全链路 / 出分提醒 /
> 座位真实预约（教务 cookie 过期，显示缓存）。证据：`harmony/evidence/device-2026-10-30/`。
> **修复轮（2026-10-30 17:2x~21:0x）**：① 课表课名 12fp→10fp、span≥2 给 3 行（1 节块 1 行）——`计算机系统导论`
> 2 节块与官方同为 3 行，真机视觉 + dump（文本节点 120px vs 官方 125px）双验；② 空教室 `weekKnown=false` 标题改
> 「周次未知 · 周五 · 2026-10-30」✅ 已验；③ 座位预约未选楼层不渲染「区域」、未选区域不渲染「座位状态」✅ 已验；
> ④ 「我」页三图标补 `accessibilityText`（dumpLayout 不暴露该属性，读屏待实测）。单测 58/58 套件 3017 断言 exit 0，
> debug HAP 构建成功。⚠️ dump 的 `text` 永远是全文，判省略号要看节点高度/行数。
> **2026-10-31 第二轮（用户报「我页总是未登录」+ 同意收口课表观感）**：①「我」页恒未登录的根因是
> 壳内子组件收不到 `onPageShow`（那是 @Entry 页级钩子）⇒ `MePage.refresh()` 从未执行，
> 界面停在默认值；22:44 已登录、22:46 仍显示未登录即为此。改为 `aboutToAppear` + `@Prop @Watch active/epoch`
> （`Index.onPageShow` 自增 epoch 传下来），22:50 真机显示学号 `1120241355` + 校园网 `336.6 GB / 300.0 GB`，
> hilog `me refresh done loggedIn=true`。② 课表对齐官方 1.4.6：课块改**统一容器色**（原版只有
> 课程/考试/自定义三档，normal 恒 `secondaryContainer`，不按课名换色）、细边 `secondary@0.25` + 12 圆角；
> `CELL_H` 46→43 让 13 节一屏（修复前第 13 节被 Scroll 截断）；并修掉随之暴露的「2 节块 3 行课名压 2 行教室」
> （Stack 居中 → Column+Blank）。单测 58/58、3007 断言、exit 0。证据 `harmony/evidence/device-2026-10-31/`。
> **未验**：暗色/其它两套 palette 下的 13 节与块色、调休周 tint 视觉强度、我页 a11y 读屏。
> **UI 迁移线（2026-10-23 起，用户确认顺序逐页对齐原版 BIT101）**：#81 GridTokens / #82 共享组件 / #83 首页 / #84 课表 / #85 空教室 / #86 班车 / #87 座位（含 M9-8 监控面板改 Material3 风 + 应用名/图标补齐）/ #88 作业·DDL（分区结构 + 紧急度混色卡）已完成（全量 34/34 套件 2029 断言绿）；剩 #90 框架 chrome。#89 落 **palette 轴**：GridTokens 三层化（共享段 + Classic/Warm/Brand 三表 1:1 Android palette/ 目录，缺档 fail-fast），ThemeStore 持久化 ui_palette，11 个页面/组件订阅，SettingsPage 外观组加「配色方案」三选一（Brand 标实验性），MePage 贴 ref-03（头像区 + 一卡通/校园网双卡 + 入口组）。另 `4585296` 修 AppScope 层图标占位（桌面灰块根因）、`055a66f` 升级 CI 图标守卫。**#90 外壳已落地**（`corelogic/shellNav.ts` + TopTabBar/BottomNavBar/FabColumn/ModulePlaceholder，Index.ets 改为底部 6 模块 + 卷内 5 页签容器，Stack 保活 + 访问白名单懒建；图标换 Material Rounded 矢量 rawfile/icons/ 16 张；自习卡从首页搬进「我」页；`tools/test-shell.mjs` 66 断言）。**FAB 组未接**（需页面内状态）。基准 `harmony/ui-ref/MIGRATION-BASELINE.md`（仓库外）；tag 仍 alpha.8（纯 UI 提交不 bump 版本）。⚠️ 各页真机渲染未验（鸿蒙手机 reboot 后 USB 未重连）。
> **2026-10-27 UI 对齐增量**（用户「对照原版改改里面的东西」）：桌面图标鸽子定档画布 **62%**（`tools/make-icon.py` + fixture 入库，可复现：`--percent 66` 重跑与旧包逐像素一致）；DDL 去页头、同步改下拉刷新；课表第 4 颗 FAB 改「＋ 改课表」（接 OverlayPage）；教学楼行双层 padding 叠加修掉（pitch 85→70vp，原版 64dp）。**学期切换已迁到设置页**（`TermStore` 单一来源 + `getCurrentTerm` 收口 + 课表 `@Watch` 重载；课表页 chips 行删除，栅栏 `test-termstore`），真机验过切学期/冷启动/恢复跟随三条路径。**学期列表折叠**（用户「保留近几年的，剩下的收缩可展开」）：默认只显示近 3 学年 + 「跟随教务」，更早的收进「展开旧学期（更早的 N 个）」；拆分抽成无 @kit 依赖的 `data/termUtil.ts` 纯函数（`splitTermsByRecentYears`），`test-termstore` 直接 import 真实函数跑算法断言（近期/脏值归旧/空列表/不足阈值 4 例）；选中的学期若落在旧区间则单列出来，防「选了旧学期却看不见、切不回」。
> **欠**：旧学期的周次语义未实证（无原版内部页可拍）；课表第 4 颗「＋」在原版里的语义未实证（当前接手动改课表）。
>
> **分工**：本文是**进度台账**（做什么、做到哪、怎么算做完）；范围与架构依据仍看 `harmony-plan-2026-10-19.md`（A 范围 / B 架构 / C 契约 / E 风险）。
> 两份冲突时：**范围看计划，进度看本文**。发现冲突请按「能被证伪」的方式提出，不要口头调和。
> ⚠️ **证据路径说明**：文中 `evidence/...` 一律指**工作区顶层** `harmony/evidence/`（与 Android 仓库物理隔离，**不在本仓库内**）；本仓库只放代码、测试与文档。要看证据的读者需本地有工作区。

---

## 0. 这份文档怎么用

**状态图例**（只有五种，别自创）

| 标记 | 含义 | 判定门槛 |
|---|---|---|
| ✅ 完成 | 真机验过，有可复核证据 | 证据路径已填，且判据能被人重跑 |
| 🔄 进行中 | 代码在写或部分验过 | 必须写明「差哪一步」 |
| ⬜ 待做 | 未开始 | 判据已写好，开工即知终点 |
| ⛔ 阻塞 | 等外部（设备/用户决策/账号） | 写明卡在谁身上 |
| 🚫 不做 | 已决策排除 | 理由已记录，防止反复讨论 |

**三条硬规矩**

1. **报 ✅ 必须带证据路径**。只写「已验证」不算——这是 Android 线栽过 11 次的坑（MEMORY 铁律 0.7b）。
2. **判据必须可证伪**。「能显示课表」不合格；「未登录时课表接口返回 302 而非数据」合格。
3. **降级路径必须真机核**。单测绿 ≠ 降级没坏（铁律 0.7）。

**更新方式**：每次干完一批活 → 改状态行 → 在「证据」列填路径 → 更新 §7 进度计数。不要新开文档。

---

## 1. 目标定义

### 1.1 「完整迁移」= 什么

**Android 版 1.12.0-alpha.12 的全部用户可见能力，减去 §1.2 的不做清单。**

不是「功能差不多」，是**逐屏对得上**：Android 有的页面，鸿蒙有对应页面；Android 有的提醒类型，鸿蒙有对应提醒；Android 组件有的 4 页，鸿蒙卡片有 4 页。差异必须有记录（平台限制导致），不能是遗漏。

### 1.2 不做清单（已决策，别反复讨论）

| 不做 | 理由 | 记录位置 |
|---|---|---|
| NFC 校园卡 | 鸿蒙无三方 NFC reader API | 调研 §2.9 |
| 话廊 / 发帖 / 举报 / 消息 | 社区功能，与校园能力无关，用户未要求 | 计划 A.2 |
| 后台抢座轮询 | 鸿蒙长时任务类型不含此场景 ⇒ 降级为「App 前台可监控」（M9-8 保留） | 调研 §3.3 |
| 应用内自更新 | AppGallery 是唯一正道；改为「公告 + 商店引导」 | 计划 A.2 |
| 一卡通流水 | 学校限定钉钉客户端，拿不到 | 计划 A.2 |

### 1.3 平台差异（不是遗漏，是适配）

| Android | 鸿蒙 | 影响 |
|---|---|---|
| WebView 登 CAS | **纯 HTTP 协议登录**（比 Android 更强，M1 已证） | 无 |
| Room | `@ohos.data.relationalStore` | 无迁移负担 |
| WorkManager 周期任务 | 延迟任务 backgroundTaskManager（≤2min/次） | 提醒排期需重新设计 |
| AppWidgetProvider + RemoteViews | ArkTS 服务卡片（Form Kit） | 卡片渲染方式全变 |
| Hilt | 手工单例 | 无 |
| Coil | `@ohos.multimedia.image` | 头像等图片待验 |

---

## 2. 现状盘点（2026-10-20 22:00）

### 2.1 已完成的能力（真机验过）

| 能力 | 证据 | 备注 |
|---|---|---|
| 纯 HTTP CAS 登录全链路 | `evidence/m1-5-http-probe/report-final-jwt-verified.md` | 302 ticket → phpCAS → seatlib JWT → 业务 code=1，且有反证（无 token → 10001） |
| 登录态持久化 + 静默恢复 | `evidence/m2-1-session/report.md` | 冷启动不注入凭据，靠 10 条 cookie 恢复 |
| 教务会话建立 | 同上 | `getAppConfig` 预热是关键（见 §7 教训） |
| 课表网格渲染 | `evidence/m2-1-session/sched2.jpeg` | 12 色、跨节块、今日高亮、第 8/21 周 |
| 会话失效错误态 | 同上 | 无会话时给「需要登录」，不是空课表 |
| 座位 JWT 换取 | M1 报告 | seatlib `code=1`（M9 的地基已通） |

### 2.2 已移植的纯逻辑（代码在，未接 UI/未接真实数据）

13 个文件约 3600 行，全部 1:1 移植并带同款规则注释：

`StudySpotLogic`(922) · `WidgetLogic`(780) · `NotifyLogic`(629) · `LibBorrowLogic`(322) · `CampusLocations`(254) · `EclassActivityLogic`(190) · `ShuttleLogic`(146) · `EclassDdlLogic`(126) · `TeachingAdjustment`(108) · `TimeTableLogic`(63) · `CourseWeekdayLogic`(50) · `CourseColorLogic`(44) · `timeutil`(169)

⚠️ **「逻辑已移植」≠「功能可用」**。这 13 个文件只解决「算得对」，不解决「取到数」和「显示出来」。下面的 TODO 表按后者计状态。

### 2.3 工程现状

**2026-10-30 实测**（`git ls-files entry/src/main/ets` + `wc -l`）：

- **186 个源文件 / 38,858 行**（`.ets` + `.ts`）
- **35 个页面**（`main_pages.json` 注册数；`pages/` 下 36 个 `.ets`，余 1 个不是页面）、**72 个纯逻辑模块**（`corelogic/*.ts`，全部可离线单测）
- 分层：`core/{crypto,net,model,theme,log}` + `data` + `service` + `corelogic` + `pages` + `components` + `extensionability`
- 存储：`Preferences`（会话 / 缓存 / 偏好），**缓存键按学期分键**；无 RDB（数据量不需要）
- 测试：`bash tools/run-tests.sh` → **58 套件 / 3017 断言**（2026-10-30 实测，exit 0）；CI 在所有分支 push 上跑

> 下面是 2026-10-28 记录的快照，保留作对照：
- 145 个源文件 / 31,025 行、28 个页面、48 个纯逻辑模块、46 套件 / 2509 断言

> 下面是 2026-10-20 建台账时的快照，保留作对照（当时只有 3 个页面）：
- 37 个源文件 9114 行（含 M1 探针 `probe/CasProbe.ts` 1178 行、`pages/CasProbePage.ets` 183 行，属诊断代码，M2 收尾后可删）
- 分层：`core/{crypto,net,model,theme,log}` + `data` + `service` + `corelogic` + `pages`
- 已有页面：`Index`（入口）· `LoginPage` · `SchedulePage` · `CasProbePage`（诊断）
- 缺口：**无 RDB**（课表在内存，冷启动每次重拉 20 秒）· 无 `features/` 分层 · 无单测框架（当前用 Node `--experimental-transform-types` 跑真源码）

---

## 3. 功能矩阵（Android 能力 × 鸿蒙状态）

> 这张表回答「还差什么」。Android 侧共 18 个 features 子模块 / 640 个 kt / 14 个顶层路由。

| # | Android 能力 | 鸿蒙状态 | 对应阶段 |
|---|---|---|---|
| 1 | 学校 CAS 登录 | ✅ 完成（纯 HTTP，强于 Android） | — |
| 2 | 短信二次验证 | 🔄 续跑代码在，**未触发验过** | M1-5 |
| 3 | 登出 | ✅ 已上线（含内存 cookie 罐清理） | M6-4 |
| 4 | 课表网格 | ✅ 完成 | — |
| 5 | 周次切换 | 🔄 代码在（`goWeek`），真机未点验 | M2-3 |
| 6 | 学期切换（多学期） | ✅ 设置页学期组（近 3 学年 + 折叠旧学期） | M2-3 |
| 7 | 课程详情 | ✅ 字段齐全 + 周次人话（`1-15周(单)`） | M2-5 |
| 8 | 考试列表 | ✅ 已上线（6 场，按日期升序） | M2-6 |
| 9 | 教学调整（放假/补课） | ✅ 课表角标 + 列表页（未来/过去分组） | **M2-7** |
| 10 | 手动改课表（覆盖层） | 🔄 代码完成，待真机 | M2-8 |
| 11 | 课表落库/离线 | ✅ 已有（`CourseCache` 按学期分键 + 冷启动 cache-first，先上屏再后台刷新） | M2-4 |
| 12 | DDL（作业截止） | ✅ 已上线（两栏 + 杀进程保留 done，真机验收） | M4 |
| 13 | 动态（延河课堂） | ✅ 已上线（列表 + 点条目进 Web 壳，真机验收） | M4 |
| 14 | 空教室 | ✅ 已上线 | M3 |
| 15 | 交通（班车） | ✅ 已上线 | M5-4 |
| 16 | 自习卡（现在去哪儿自习） | ✅ 已上线 | M3-3 |
| 17 | 自习详情页 | ✅ 已上线 | M3-4 |
| 18 | 一卡通余额 | 🔄 代码完成，待真机 | M5-1 |
| 19 | 校园网流量 | 🔄 代码完成，待真机 | M5-2 |
| 20 | 图书馆借阅 | 🔄 代码完成，待真机 | M5-3 |
| 21 | 「我」页 | 🔄 代码完成，待真机 | M5-5 |
| 22 | 设置 | ✅ 已上线（含默认校区 / 作息 / 外观） | M6 |
| 23 | 深色模式 | ✅ 已上线（语义色 + WCAG 单测） | M6-3 |
| 24 | 通知中心（展示） | 🔄 代码完成，待数据 | M7-1 |
| 25 | 代理提醒（7 类） | 🔴 排期链路全部走通（取数→plan→裁剪→免打扰→publish→历史），但**本机 publish 全被系统拒（1700002，见 R10）**；考试时刻解析未验 | M7-2 |
| 26 | 出分提醒（异步挑战） | ✅ 取数管道已接（start→poll→fetch），12h 闸门 + 差分 + 通知不含分数；真实会话未验 | M7-3 |
| 27 | 网费/流量提醒 | 🔄 判定逻辑完成，待发送 | M7-4 |
| 28 | 桌面卡片（4 页） | ⬜ 逻辑已移植，Form Kit 未验 | M8 |
| 29 | 座位登录 | ✅ JWT 已通（M1） | — |
| 30 | 座位树/底图选座 | 🔄 树+契约+主页 UI+点位视图已建（欠底图 image 渲染） | M9-2/3 |
| 31 | 预约/取消/违约/研讨间 | 🔄 逻辑层+契约层全完；预约/取消交互已建（SeatPage 二次确认），欠违约/研讨间 UI | M9-4~7 |
| 32 | 前台监控 | ✅ 已做 | M9-8 |
| 33 | 校园地图 | 🔄 改为楼栋索引（48 栋 / 可搜索 / 系统地图打开），不做在线瓦片 | M10-1 |
| 34 | 成绩 | ✅ 成绩页 + 分组列表 + 凭据（可选存系统密钥库）；真机未验 | M10-2 |
| 35 | Web 壳 | ✅ 六个已验证入口（门户/教务/图书馆/一卡通/座位/SSO），学校域名不踢浏览器 | M10-3 |
| 36 | 版本说明 | ✅ AboutPage：版本 + 更新说明 + 许可；不自下载 | M10-4 |
| 37 | NFC 校园卡 | 🚫 不做 | — |
| 38 | 话廊/发帖/举报/消息 | 🚫 不做 | — |

**结论**：37 项能力里 ✅ 11 项、🔄 4 项、⬜ 20 项、🚫 2 项（2026-10-28 把成绩/Web 壳/版本说明/出分提醒管道从 ⬜🔄 推到 ✅）。排除不做项后，**还剩约 22 个未开始的功能块**。M9 的 8 项逻辑层 + 契约层已全部完成，座位主页 UI 已建（含预约/取消二次确认交互），M9-3 底图（裁图）与 M9-8 监控面板 UI（前台生命周期 + 状态条 + 任务卡 + 显式确认）也已落地；剩余缺口：M9-4 预约表单（依赖活 JWT 真机选座位）/ M9-6/7 违约研讨间 UI（wire 字段待真机核对，铁律 0.9）。

---

## 4. TODO 表（按阶段）

> 任务粒度：0.5~3 人日。超过 3 人日就拆。**验收判据全是「真机上能看到什么」**。

### M2 课表完整化（进行中）

| ID | 任务 | 依赖 | 验收判据（可证伪） | 状态 |
|---|---|---|---|---|
| M2-1 | 登录态正式化（cookie/JWT 落盘 + 静默恢复 + 错误态） | — | 冷启动不输密码出课表；无会话时给「需要登录」 | ✅ 完成 |
| M2-2 | 课表网格（周次/节次/今日/12 色/跨节块） | M2-1 | 截图里能看到课程名+教室+跨节块+今日列高亮 | ✅ 完成 |
| M2-3 | 周次切换 + 学期切换 | M2-2 | 点「‹」课程块随之变化；切学期后课表/开学日/门数全变（14 门 → 19 门） | ✅ 完成（`m2-3-terms/`） |
| M2-4 | **课表缓存 + 离线可读** | M2-2 | 冷启动先上缓存（日志 `cache hit age=N`）；刷新失败时不清屏、如实标「显示的是缓存」 | ✅ 完成（`evidence/m2-2-teaching/`） |
| M2-5 | 课程详情面板完善 | M2-2 | 学分/学时/性质/类别/单位/安排齐全，空字段不留空行；补课日标「本日按周X课表」 | ✅ 完成 + 2026-10-28：周次从 `[1][2][3]` 标记串改成**人话**（`1-16周` / `1-15周(单)` / `1-4,6-8周`）；装配收口到 `CourseDetailLogic`（与搜索副标题、无障碍共用，`test-weektext` 36 条） |
| M2-6 | 考试列表 | M2-2 | 列出 6 场真实考试的日期/时间/地点/座位/教师，按日期升序 | ✅ 完成（`m2-3-terms/exam-list.*`） |
| M2-7 | **教学调整（放假/补课）** ★正确性门 | M2-2 + M2-4 | 第 6 周真机：一~四列头「放假」、六列头「按周四」且装周四的课（与第 8 周周四列逐字一致）；状态条「放假 4 天 · 补课 1 天」 | ✅ 完成（`evidence/m2-2-teaching/`） |
| M2-7b | 教学调整**列表页** + 今日角标 | M2-7 | 未来按日升序、过去降序；补课点明「补周几」；脏周次丢弃 | ✅ 2026-10-28 代码完成：`TeachingAdjustmentPage` + 课表今日角标（只讲今天，点进看全量）；`TeachingAdjustmentView` 纯逻辑 33 条断言。**真机未验** |
| M2-8 | 手动改课表（覆盖层） | M2-4 | 改教室后网格显示新教室；重新同步课表**不覆盖**修改 | 🔄 代码完成（`CourseOverlayLogic`/`CourseOverlayStore`/`OverlayPage` + 51 条单测，assembleHap 过）：EDIT/HIDE/ADD 三意图 + HIDE 优先 + 锚点与显示值分离（改时间仍匹配原课）+ 匹配不上不删数据；合并挂在 SchedulePage 读路径（`applyMerged` 以 rawCourses 为基准）+ onPageShow 从改课表页回来重算；本地新增 localId 为负。真机待设备恢复 |
| M2-9 | 节次/周次边界自查 | M2-2 | 40 条断言全绿（1/13 节、越界、空 SKZC、[11] 不假命中 [1]、非法日期） | ✅ 完成（`tools/test-edges.mjs`） |

**M2 出口判据**：飞行模式能看课表；补课日显示正确课表；改课表不被同步覆盖。
**为什么 M2-7 排在这里**：补课日显示错课表**比不显示更糟**——这是正确性问题，不是功能问题（Android v1.9.46 的同款教训）。

### M3 空教室与自习

| ID | 任务 | 依赖 | 验收判据 | 状态 |
|---|---|---|---|---|
| M3-1 | 空教室数据层（分页 + 13 节状态） | M2-4 | 单栋 11 间、分页正常；20 栋 231 间总耗时 14.1 秒（串行需 40+） | ✅ 完成 |
| M3-2 | 空教室页（校区→楼→教室+忙闲节次） | M3-1 | 文萃楼B：11 间 / 空闲 10 间，逐间「3-4, 6-13 节占用」 | ✅ 完成（`m3-classroom/building-expanded.*`） |
| M3-3 | **自习卡**（接 StudySpotLogic） | M3-1 | 8 个候选、可「换一个」；`20 栋楼 / 231 间 / 14.1 秒` | ✅ 完成（`m3-classroom/study-spot.*`） |
| M3-4 | 自习详情页（全部候选） | M3-3 | 点「全部 8 个」进详情，8 个候选带排名/楼内剩余/口径说明 | ✅ 完成（`m3-spot-detail/normal-detail.jpeg`） |
| M3-5 | 自习卡降级态 | M3-3 | 断网时卡片仍在：课表照给 + 说明「查不了空教室」+ 标注学期未确认 | ✅ 完成（`m3-spot-detail/degraded-*`）；nologin 分支待用户配合 |

### M4 DDL 与动态

| ID | 任务 | 依赖 | 验收判据 | 状态 |
|---|---|---|---|---|
| M4-1 | eclass 登录链路（Keycloak broker） | M2-1 | 能拿到 eclass 会话 cookie；失败时打出 hop 轨迹 | ✅ 完成（`cd6aae8`；真机全链路 `evidence/m4-verify/report.md`）：负路径（未登录点验证 ⇒「Web 里还没有 eclass 会话」）；正路径用户在 Web 内登录 ⇒「✅ 会话就绪（6 门课）」；hop #1/#2 与契约一字不差；Keycloak 表单正常渲染（R1 空白未复现）；**R8 SameSite 已消除**（cookie 抽得到、rcp 罐服务端认账）；Web 会话二次进入直接落 `/user/index` |
| M4-2 | 作业同步 → DDL 落库 | M4-1 | 有作业的账号能同步出至少 1 条截止时间 | ✅ 完成（`852d4ab` + 真机）：6 门课 / 2 条作业；「剩余 18天 2小时 24分钟」口径 1:1 Android 且**倒计时在走**（现算生效）；逐课程拉取单课失败不拖垮整次 |
| M4-3 | DDL 页（未完成/已完成两栏） | M4-2 | 点条目在两侧切换；重新同步**保留**手动完成状态 | ✅ 完成（`1207a6d` + 真机）：点条目切换；**杀进程重启后 1/1 保留**；重新同步后仍 1/1（done 不被冲掉）；首页作业卡片 + 两种空态 |
| M4-4 | 动态页（延河课堂活动流） | M4-1 | 能列出活动标题/类型/时间 | ✅ 完成（`e56b729` + 真机）：9 条动态（1 门课取数失败仍列出，失败数如实上屏）；类型保守分类；点条目 ⇒ Web 壳带会话打开课程页（参考资料/章节/课件） |
| M4-5 | DDL 源设置（eclass/乐学） | M4-2 | 切源后列表内容随之变化 | ✅ 2026-10-28：设置页「作业来源」两个开关（延河课堂 / 本地新增），过滤在展示层做（库里两源都存，切回不需重同步），卡片同步遵守；**乐学显式标「本版不提供（接口未验证）」**，不假装支持。`DdlSourceLogic` 25 条断言 |

### M5 校园服务

| ID | 任务 | 依赖 | 验收判据 | 状态 |
|---|---|---|---|---|
| M5-1 | 一卡通（余额 + 近 N 天趋势） | M2-1 | 登录后显示余额；判定看**最终 URL** 不看状态码 | 🔄 代码完成（`CampusCardLogic`/`CampusCardBalanceLogic`/`CampusCardService`/`CardPage`/`CardLoginPage` + 70 条单测，assembleHap 过）：`autoRedirect=true` 跟完 CAS 链后用 `resp.effectiveUrl` 判最终 URL 主机（与 OkHttp `resp.request.url` 同构）；趋势按 7 天窗口+样本不足如实降级；「请求失败 ≠ 未登录」单独一路；余额采样只记「已登录+解析出金额」。真机待设备恢复 |
| M5-2 | 校园网（流量/时长/余额） | M2-1 | 校内网显示本月流量；校外显示「不在校园网」而非报错 | 🔄 代码完成（`CampusNetLogic`/`CampusNetTrafficLogic`/`CampusNetService`/`NetPage` + 77 条单测，assembleHap 过）：CSV 字段映射 1:1；三态分离（online / not_online 给认证页入口 / 连不上说「不在校园网」）；流量趋势含**计费周期重置检测**（累计值变小 ⇒ 旧采样全废）+ 月末预测（自然月假设）。✅ 2026-10-21 本机实测接口在校园网内可达、字段位置未变；真机待验明文 http（风险 R4） |
| M5-3 | 图书馆借阅（在借 + 应还倒数） | M2-1 | 有借阅时列出书名与剩余天数；无借阅时也正常 | 🔄 代码完成（`LibBorrowService`/`LibLoginPage`/`LibBorrowPage` + 68 条单测，assembleHap 过）：四步顺序 1:1 Android（user-info 判登录 → sversion → data 接口 → 解析），「取不到/没有/未登录」三态分离；真机待用户在 App 内 Web 完成图书馆登录 |
| M5-4 | 交通班车时刻 | — | 两站 39/50 班；末班判定「今天已发完」；30 条断言钉住时刻表 | ✅ 完成（`m5-shuttle/`） |
| M5-5 | 「我」页装配（三卡摘要 + 登录态） | M5-1~3 | 三张卡常显摘要；未登录时给登录入口而非空白 | 🔄 代码完成（`MePage` + 首页「设置」按钮改为「我」，设置入口移入页内）：三卡**各自独立兜底**（一个挂了另外两张照常显示）；一卡通趋势仅在 hasChange 时显示（「无变化」不占一行）；作业/设置入口同页。真机待设备恢复 |

### M6 设置与外观

| ID | 任务 | 依赖 | 验收判据 | 状态 |
|---|---|---|---|---|
| M6-1 | 设置框架（分组入口） | — | 外观/账号/查找/关于/开发者五组，进出正常 | ✅ 完成（`m6-settings/settings-dark.jpeg`） |
| M6-2 | 时间表自定义 | M2-2 | 13 节可改，校验重叠/越界；课表时间列即时反映（注入 08:30 实测时间列变 08:30、08:00 消失）；`test-timetable.mjs` 28 条 | ✅ 完成（`m6-timetable/`） |
| M6-3 | **深色模式**（一次做对） | M2-2 | 课表/卡片/设置**四屏**深色实测；`tools/test-colors.mjs` **83 条**（含 24 个课程色组合）全绿，最低 4.83 | ✅ 完成 |
| M6-4 | 账号页 + 登出 | M2-1 | 登出后设置页「未登录」；课表页底部「未登录，显示的是上次缓存」+ 顶部「重登」；自习卡走 nologin 降级并给「去登录」；**三个 cookie 罐真被清** | ✅ 完成（`m6-settings/nologin-*`） |
| M6-5 | 空教室默认校区 | M3-2 | 设置页可选校区并落库，ClassroomPage 读 `default_campus_code` | ✅ 真机全链路验过（`evidence/m6-5-default-campus/`）：负路径（未登录→toast）；正路径选「中关村校区」→ 落库 → 杀进程重启仍保留 → 空教室页选中中关村且楼列表为中关村楼；**补「恢复默认（良乡）」入口**（点验时发现设过就改不回来的缺口）→ 还原后空教室页回落良乡楼 |

**⚠️ M6-3 为什么强调「一次做对」**：Android 侧 WIDGET-001 就栽在深色模式下白卡浅字（对比度 1.22~1.48:1），返工代价大。

### M7 通知中心

| ID | 任务 | 依赖 | 验收判据 | 状态 |
|---|---|---|---|---|
| M7-1 | 通知落库 + 列表（含已发记录） | — | 列表能显示历史通知，分类型筛选 | 🔄 代码完成（`NotifyRecordLogic`/`NotifyRecordStore`/`NotifyListPage` + 32 条单测，assembleHap 过）：排期时写记录（title/text/at 快照 + firedMillis 回填）；**已发不回滚**（重排只改显示字段）；旧表独有 key 保留（删课不蒸发记录）；14 天双锚点清理（已发看 fired、未发看 at）。入口在「我」页。写入挂在 M7-2 排期器 |
| M7-2 | **代理提醒排期（7 类）** | M2-7 · M5-2 · M7-1 | 设一个 2 分钟后的上课提醒，锁屏也弹；提前量改动生效 | 🔄 代码完成（`ReminderScheduler` + `NotifyAdapter` + `NotifyScheduleLogic` + 37 条单测，assembleHap 过）：本地离线取数（课表/DdlStore/ExamCache/教学调整缓存）→ `plan()` → 配额裁剪（≤30，R10）→ `reminderAgentManager` 日历提醒全量重建 → 落 M7-1 历史库。冷启动自动重排（对照 Android「每次开 App 重排」）。`PUBLISH_AGENT_REMINDER`（NORMAL+system_grant，三方可声明）+ 通知开关前置。⚠️ 三处 fail-closed 未验真机：通知开关没开整批不排 / 考试时刻解析不出跳过 / 教学调整拿不到按无调整排 |
| M7-3 | 出分提醒（异步挑战三步） | M7-2 | 有出分时通知弹出，**且不含分数**（隐私边界） | 🔄 **纯逻辑层完成**（`ScoreLogic` 解析+差分+隐私文案 / `ScoreQueryLogic` 轮询终止+12h限频 / `ScoreCheckLogic` 状态码+人话文案，82 条单测，经 compile-probe 过 assembleHap）：二维表按表头定位列（课程编号≠课程名）、首次只建基线不轰炸、**改分不重报**、文案**绝不含分数**（单测锁死）、AUTH_FAILED 不写「稍后重试」。**取数管道已于 2026-10-28 接上**（`ScoreService` 三步 + `ScoreCheckRunner` 12h 闸门/差分/通知，`ScoreFlowLogic`+`ScoreStoreLogic` 共 83 条断言）；真实会话下的取数未验 |
| M7-4 | 网费/流量提醒（270/300GB） | M5-2 | 造超限数据触发一次，文案与阈值对得上 | 🔄 判定逻辑与文案完成（`NetAlertLogic` 29 条单测 + `NotifySentStore` 已发记录去重，assembleHap 过）：流量 270/300 每周期各一次、越限不补发接近档；网费 <10 元按天去重；「请求失败≠没超」——判定时机挂在取数成功那一刻。发送/UI 在 M7-2 代理提醒 + M7-1 列表 |
| M7-5 | 提醒设置页（开关 + 提前量） | M7-2 | 关掉某类后不再排期；改提前量后排期时间变 | 🔄 代码完成（`NotifySettingsLogic` 纯逻辑 + `NotifySettingsStore` Prefs 薄壳 + `NotifySettingsPage` 内联开关/chip + 50 条单测，assembleHap 过）：13 项 1:1 Android（总开关/5 类/3 组提前量）；**每次改动即 save+reschedule**（对照 Android write 块，改了提前量立即生效）；总开关关 → cancelAll；提前量固定选项不给自由输入；教学调整只有开关无提前量。入口「我」页「提醒设置」行 |

**关键设计约束**：排期必须**看教学调整**——放假不排、补课按被指定那天排（错提醒比不发更糟）。`NotifyLogic` 已移植这条规则。

### M8 桌面卡片

| ID | 任务 | 依赖 | 验收判据 | 状态 |
|---|---|---|---|---|
| M8-1 | Form 框架 + 课程卡 | M2-7 | 卡片加到桌面显示当天完整行程 | ✅ 真机已验（2026-10-27，`evidence/m8-card-on-desktop-20261027.jpeg`）：4×4 卡上桌面，`assembleAndPush success len=882`，标题栏/Tab/页脚全走 gridTokens（Warm 棕，写死深绿已废）。修三处：①独立进程补 `Prefs.init`（缺=永久占位态）；②palette+深色由 FormExtension 读偏好随 binding data 下发；③学期统一 TermStore。⚠️ 预览实例 updateForm 报 401 属预期（无真 formId）。**欠**：课程缓存为空时「空闲」行时间列换行（36vp 窄）待修；4×4 布局排版未细调 |
| M8-2 | DDL 卡 | M4-2 | 显示未完成/已完成两栏 | 🔄 已集成进 WidgetPage（5页Tab中DDL页） |
| M8-3 | 动态卡 | M4-4 | 显示最新活动 | 🔄 已集成（空态，M9接eclass后再填） |
| M8-4 | 座位卡 | M9-5 | 显示我的下次预约 | 🔄 已集成（空态，M9完成后接入） |
| M8-5 | 刷新与配额 | M8-1 | 30min 自动刷新一次；不超 50 次/天 | ✅ 2026-10-28 代码完成：`WidgetRefreshLogic`（30min 间隔 + 50 次/天 + 跨天重置 + 时钟回拨不锁死），FormExtension 在 `onUpdateForm` 判闸门、`setFormNextRefreshTime` 交给系统（分钟数夹到 ≥5，小于 5 会被系统静默忽略）；44 条断言。**真机刷新节奏未观察**（需长时间挂机） |
| M8-6 | 卡片点击跳转 | M8-1 | 点课程条目直接进课表详情（不是只开 App） | ✅ 2026-10-28 代码完成：条目点击 → `postCardAction(router)` 带 `bit101Content` → `EntryAbility` 校验后写 AppStorage → `Index` 落到对应页签（脏值丢弃，不回落）；`sanitizeContentId` 有断言。**真机点击跳转未验** |

### M9 座位

| ID | 任务 | 依赖 | 验收判据 | 状态 |
|---|---|---|---|---|
| M9-1 | 座位 JWT 换取 | — | seatlib 业务接口 `code=1`（M1 已证） | ✅ 完成 |
| M9-2 | 座位树/楼层/区域 | M9-1 | 能列出校区→楼→楼层→区域 | 🔄 逻辑层（SeatTreeModel + SeatTreeService + SeatLogic 75 条）+ **UI 已建**（SeatPage 三级选择 campus/floor/area，groupTree 分组；test-seatview 58 条）；真机未验 |
| M9-3 | 房间底图选座（5 张底图 + 百分比坐标） | M9-2 | 底图上座位点位与真实布局对得上，点选有反馈 | 🔄 **底图已实测**（2026-10-22 真机：`/api/seat/map` 免认证可通，data = free/book/close/leave/use 五张 1920×1080 URL）+ **裁图渲染已实现**（SeatPage free 图铺底 + 逐座位状态图裁片，缩放/偏移百分比由纯逻辑层算，test-seatapi +24 条；色块兜底不假态）；⚠️ 真机渲染验证待登录（座位列表 `/api/Seat/seat` 必须活 JWT，实测死 JWT/无 JWT 均 HTTP 500） |
| M9-4 | 预约提交（单次模式） | M9-3 | 真机提交后服务端「我的预约」里出现该记录 | 🔄 逻辑层完成（SeatReserveLogic 21 条 + buildSlotOptions/validateSlot 时段校验）；**契约层已对齐**（SeatApiLogic `buildConfirmBody` seat_id(int)+segment，铁律 0.9）；**预约交互已建**（SeatPage 点空闲座位行→二次确认→confirmSeat→刷新座位+我的预约，对称于取消，铁律 0.6 守门）；真机未验。⚠️ **隐患待清**：旧 `SeatReserveLogic.calcSignInDeadline`（开始**-15min**）与权威 `SeatApiLogic.signInDeadline`（当日=开始**+60min**/次日=09:00）方向相反，前者零业务引用（仅旧单测用），M9-4 接线时删 |
| M9-5 | 我的预约 / 取消 | M9-4 | 取消后列表消失，服务端也消失 | 🔄 逻辑层（SeatReservationLogic 22 条）+ **UI 已建**（SeatPage 我的预约列表 + 取消二次确认，铁律 0.6 守门；取消走 `/api/Space/cancel` 传 record.id 非座位 id，契约层 SeatApiLogic 对齐）；真机未验 |
| M9-6 | 违约计数（N/5 + 明细） | M9-1 | 显示「违约 N/5」，与图书馆接口一致 | 🔄 **违约 UI 已建**（SeatPage 拉 `/api/Member/reneges` type=1 → wire `RenegeRecord[]` 直出渲染，`renegeText` 纯函数组文案 + 8 条单测 + compile-probe，空态/加载/错误/列表四态齐备，不造假数据）；真机未验 |
| M9-7 | 研讨间（看/取消） | M9-1 | 研讨间预约与座位**分开**计数 | ⬜ 逻辑层完成（SeminarLogic 15 条 + seminarVMs）；**UI 暂缓**——研讨间 wire 字段（`/api/Member/seminar`）未真机核对（铁律 0.9），SeatPage 诚实标注「暂不渲染，不造假数据」，待真机核对字段后再做 |
| M9-8 | 前台监控（无后台轮询） | M9-4 | App 前台时能发现空位并提示；退到后台**明确提示不监控** | ✅ 完成（alpha.8）：逻辑层（SeatMonitorLogic + SeatMonitorPolicy 纯决策函数 `decideNext` 守卫「只 FOUND 不自动预约」+ SeatTask 模型 + SeatTaskStore + ISeatService 接口 + 新建 SeatServiceMonitorAdapter 补齐契约落地）+ UI 面板 SeatMonitorPage（状态条 / 任务卡 / 显式确认 / 取消 / 删除）+ 前台生命周期（EntryAbility 前后台回调 + AppForegroundState 单例驱动轮询暂停与状态条）。全量单测 29/29 套件 / 1378 断言绿；BUILD SUCCESSFUL |

**⚠️ M9 契约层（铁律 0.9，2026-10-22 补齐 + 真机验证）**：早期 SeatService 用臆造端点（`/api/Seat/schedule`、`/reserve`、`/cancel`）+ 自造 body，与 Android 权威契约不符，对真实服务端全挂。现已建 `SeatApiLogic`（纯函数：端点表 `/api/Seat/seat` `/confirm`、`/api/Space/cancel`、`/api/index/subscribe`、`/api/Seat/date`、`/api/seat/map`、`/api/Member/reneges` `/seminar` + body 1:1 + 状态码映射 1→AVAILABLE/2,10,11→RESERVED/6,8,9→IN_USE/7→LEAVE/3,4,5→UNAVAILABLE + 签到截止当日=开始+60min/次日=09:00，102 条单测），SeatService 降为薄 @kit 壳（session+TLS CA+JAR_SEAT 罐+认证头），端点/body/解析全委托。

**⚠️ 认证模型（2026-10-22 真机探针 + Android SeatApi.kt 核对，铁律 0.9）**：
- authed 端点**两头都发**：① 头 `Authorization: bearer<jwt>`（**小写 bearer、无空格**，不是 RFC 的 `Bearer <jwt>`）② 请求体 JSON 带 `authorization: bearer<jwt>` 字段。原实现 `Bearer <jwt>` 且体不带字段 ⇒ 真机全部 10001，已修。
- 免认证端点（tree/date/map）**完全不带 Authorization 键**——带空 `Bearer ` 反而 10001（服务端对「有头但无效」与「无头」两种处理）。
- `/api/Seat/seat` **必须活 JWT**：无 token 或死 token 均 HTTP 500 + 空 body（真机实测，推翻了「seat 也许免认证」的假设）。
- **JWT 会过期**：设备上 513 字符 JWT 是死 token；`silentRenewJwt`（只靠 phpCAS cookie）实测失败 ⇒ **需用户显式登录**（铁律 0.6：凭据登录必须用户发起）。证据：`harmony/evidence/m9-wire-probe/`。

**⚠️ M9-4/M9-5 红线**：有对外副作用的动作（提交预约/取消）**绝不上自动路径**，必须用户显式点击且参数必填（MEMORY 铁律 0.6）。

### M10 周边与上架

| ID | 任务 | 依赖 | 验收判据 | 状态 |
|---|---|---|---|---|
| M10-1 | 校园楼栋索引（原计划：OSM 瓦片 + 49 坐标） | — | 点课程教室能落在正确楼栋；匹配不到明说「暂未收录」 | ✅ **改设计并在 2026-10-28 实现**：OSM 坐标精度约 31 米，同栋不同翼（文萃楼 H/I/K/M）投影到画布只差 0.001px ⇒ 画成地理图是骗人。改为 `CampusMapPage` 楼栋目录（48 栋 / 两校区 / 可搜索 / 显示「本机课表在这栋楼上过什么课」/ 经纬度 + 系统地图 `geo:` 打开）+ ODbL 署名。**代价**：不做在线瓦片（配额 + 条款），因此没有「地图底图」。**2026-10-28 真机已验**，并抓到一个只有上真机才现形的 bug：`aboutToAppear` 里 `loadCourses()` 是 async 却没 await，紧跟着同步 `refresh()` ⇒ **每栋楼都显示「没有课」**，看着像匹配坏了，其实纯逻辑（28 条断言）全对。已改成 `init()` 里 `await loadCourses()` 后再 `refresh()`，并加**源码栅栏**（读 .ets 断言 await 存在且 refresh 在其后；故意拆红 3 条全红）。顺带把空态文案「本机课表无这门楼」改成「课表里没有这栋楼的课」。**两校区 34 栋（良乡）/ 中关村另算** 与数据一致 |
| M10-2 | 成绩（异步挑战 + 直链） | M2-1 | 能取到成绩列表；通知直链能进成绩页 | ✅ 2026-10-28 代码完成：`ScoreFlowLogic`（快照解析+决策+按学期分组）/`ScoreStoreLogic`（缓存与快照序列化）/`ScoreService`（start→poll→fetch，`login.bit101.flwfdd.xyz`）/`ScoreCheckRunner`（12h 闸门+差分+通知）/`ScorePage`（分组列表、下拉刷新、无凭据时内联输入）。凭据默认不存，勾选后进**系统密钥库**（`ScoreCredentialStore`）。**未验**：真实会话下的取数、成绩页真机渲染、通知点击直链（通知未挂 wantAgent） |
| M10-3 | Web 壳（学校门户/认证页） | — | 学校域名一律留在 App 内，不踢外部浏览器 | ✅ 2026-10-28：`WebEntryLogic`（`*.bit.edu.cn` 判定防后缀伪装）+ `WebServicesPage` 六个已验证入口（延河/教务/图书馆/一卡通/座位/统一身份认证）。非学校域名**不跳系统浏览器**，只提示 |
| M10-4 | 版本说明与更新引导 | — | 显示版本与更新说明，引导去商店而非自下载 | ✅ 2026-10-28：`AboutPage`（bundleManager 读版本、`rawfile/changelog.json` 更新说明、AGPL-3.0 与仓库地址）+ `VersionLogic`（预发布排序 `1.0.0` > `1.0.0-alpha.9`、坏条目逐条丢）。**页面内无任何下载/安装动作** |
| M11-1 | 全局搜索 | — | 输入课程/作业/楼栋能出结果；多词是与关系；空查询不猜推荐 | ✅ 2026-10-28 代码完成：`SearchLogic`（归一化含全角、打分前缀>包含>副标题>附加、分组顺序固定、空查询返回空）+ `SearchPage`（四类数据全来自本机缓存，不发请求）；课程结果 → 课表定位到该课所在周。36 条断言。**2026-10-28 真机已验**：输入「计算机」→「找到 8 个结果」，副标题是「综教B301 · 付莹 · 4-19周」（地点·教师·周次），空态诚实显示「当前可搜 64 条（全部来自本机缓存）」 |
| M11-2 | 通知分组 / 未读 / 清空 | — | 今天/昨天/本周/更早分组；未读只算已发出的 | ✅ 2026-10-28：`NotifyGroupLogic`（连续分组 + 未读 + `99+` 徽标）+ `NotifySeenStore`（已读位置单独存，清记录不丢阅读状态）+ 清空二次确认。59 条断言。真机未验 |
| M11-3 | 通知点击深链 | — | 点成绩通知进成绩页，点上课通知进课表 | ✅ 2026-10-28 代码完成：`NotifyDeepLink`（kind → 页签/独立页，页面**白名单**）+ `InstantNotify` 挂 `wantAgent` + `EntryAbility` 写 `ui_open_page` + `Index.onPageShow` 消费。⚠️ 排期提醒（reminderAgent）的深链未做。真机未验 |
| M11-4 | 存储与清理 | — | 只清缓存，不删设置与凭据 | ✅ 2026-10-28：`CacheIndex`（**白名单**，6 项；`score_snapshot`/`score_last_check`/凭据/主题/学期**不在**白名单）+ `CacheCleaner`（只删命中键）+ `CacheCleanPage`（勾选、含用户数据项二次确认、显示占用）。55 条断言（含「16 个敏感键一个都没被归入」）。真机未验 |
| M11-5 | 诊断信息页 | — | 一键复制环境信息，学号脱敏、不含凭据 | ✅ 2026-10-28：`DiagnosticsLogic`（10 行结构化 + `maskStudent`）+ `DiagnosticsPage`（复制到剪贴板）。⚠️ 单测抓到真 bug：5 位学号按 `len-5` 算星号会得到 0 个 ⇒ 等于没脱敏，已修为至少 1 位。真机未验 |
| M11-6 | 无障碍（可点元素可读） | — | 读屏能念出「课程/作业/底栏」的完整语义 | 🔄 2026-10-28 部分完成：课表块、DDL 卡、底栏、搜索行、楼栋卡、通知卡、缓存项已加 `accessibilityText`；**M12-4 补了成绩行 / 考试卡 / 我页三卡 + 统一文案层 `A11yText`**。剩余：登录/座位/班车/空教室未扫。真机未验 |
| M12-1 | 课表左右滑动切周 | M2-3 | 手往左=下一周、往右=上一周；竖着划/斜着划**不能**误切周 | ✅ 2026-10-28：`WeekNav`（`clampWeek` / `shiftWeek` / `swipeWeek` / `swipeDirFromAngle` / `weekLabel` / `weekA11y`）+ 网格 `SwipeGesture`；‹ › 按钮、右下角 FAB、滑动三处共用一份落点算法。**主逻辑之外的发现**：总周数未知时原写法会把「第 5 周」显示成「第 1 周」⇒ 改为只报当前周、不谈边界。53 条断言。**2026-10-28 真机已验**：左滑「周9→周10」、右滑回「周9」、竖直划动不切周（三条都实测）。**结论：SwipeGesture 没被 Scroll 吞掉** |
| M12-2 | 通知免打扰时段 | M7-2 | 静默期内的提醒不响；关闭时行为和以前一致；起止相同不等于全天静默 | ✅ 2026-10-28：`QuietHoursLogic`（跨零点窗口 `[start,24:00)∪[0,end)`、终点不含、`NaN` 窗口必须判无效）+ `QuietHoursStore`（与 `notify_settings_v1` **分存**）+ 设置页「免打扰」组（三档预设 + 解释文案）+ 排期器最后一道闸。**推迟而非丢弃**，但推迟后超过「事件仍成立」的预算就丢（迟到 8 小时的「还有 10 分钟上课」是假信息）。73 条断言（含「单测抓到 NaN 窗口会让午夜后整天静默」的真 bug）。**2026-10-28 真机已验**：开关打开后行内显示「23:00 – 07:00（次日）」、三档预设渲染、提示行「该时段内的提醒会推到 07:00，不会丢」；落库日志 `QuietHours saved enabled=true 1380-420` |
| M12-3 | 排期提醒点击深链（M11-3 遗留） | M11-3 | 点「上课提醒」进课表、点「考试提醒」进考试页 | ✅ 2026-10-28：`ReminderScheduler.toRequest` 里挂 `wantAgent`（`requestCode` 每条不同，同 code 会跳同一个落点），落点走 `routeOfKind` + `EntryAbility` 既有的白名单校验。⚠️ **SDK d.ts 有坑**：`ReminderRequest.wantAgent` 被标成遗留全局接口 `{pkgName, abilityName}`，新 API 的句柄静态类型对不上 ⇒ 用 `Object.assign` 绕，代码里有注释留证。挂不上只退化成「只开 App」，不影响发提醒。真机未验 |
| M12-4 | 无障碍文案统一 + 扫尾 | M11-6 | 布尔念中文；空字段不留「，，」；未读 0 说「没有未读」 | ✅ 2026-10-28：`A11yText`（`joinA11y` 跳空段 / `switchA11y` 布尔中文化 / `unreadA11y` 与 `99+` 同口径 / `moneyA11y` NaN 说「未知」不显示 0.00 / `progressA11y` 分母非法不编 / `chipA11y` / `spanA11y`）+ 成绩行、考试卡、我页三卡接入。33 条断言。剩余页面未扫 |
| M12-5 | DDL 排序切换（按截止 / 按课程） | M4-2 | 同一门课的作业能聚在一起；切换后记住档位 | ✅ 2026-10-28：`DdlSortLogic`（分区不变、已完成恒截止倒序、空课程名排最后、同截止按 `uid` 兜底保证不跳位）+ 未完成区标题右侧一个 chip（两档循环）。**中文课程名用 `localeCompare` 而非码点序**，所以单测只钉「聚拢/组内按截止/空名靠后/组次序=课程名排序结果」，不钉跨语言环境的具体次序。25 条断言。真机未验 |
| M10-5 | 备案 / 软著 / 上架 | 用户办 | 提交通过 | ⛔ 等用户 |

### M12 交互断链与离线体验（2026-10-28 第二轮「只改代码」）

| ID | 任务 | 依赖 | 验收判据 | 状态 |
|---|---|---|---|---|
| M12-6 | 台账纠偏：课表离线缓存 | — | 冷启动无网络也能看到上次课表 | ✅ **其实早就做完了**（`CourseCache` cache-first + 联网刷新，`SchedulePage` 首屏先上屏缓存并标「离线缓存 · N 分钟前」）。本行原来挂 ⬜ 是台账过期，2026-10-28 核对代码后改正 —— 不是新写的 |
| M12-7 | 台账纠偏：卡片时间列换行 | M8-1 | 4×4 卡上时间列不折成两行 | ✅ 已修（36vp → **54vp** + `maxLines(1)`，注释里留了真机实拍证据）。台账原挂「待修」系过期 |
| M12-8 | 通知权限入口 + 排期文案统一 | M7-2 | 「没授权」不能被显示成「已重排 0 条」 | ✅ **2026-10-28 真机发现并修复**：①`ensureNotificationEnabled()` 写了但**全仓零引用** ⇒ 用户只看到一行「系统通知未开」的小字，没有任何入口去开；已接成页面上一颗「开启通知」按钮（点后弹系统授权框，允许后自动重排）。②两个入口（提醒设置 / 免打扰）各写一份 if-else，免打扰那边漏了 `user_disabled`/`notification_disabled` ⇒ **「系统没授权」被显示成「已重排 0 条」**。已抽成纯函数 `NotifyStatusText.scheduleStatusText()` 共用，单测钉「每个 reason 都有专属文案且不许出现『已重排』」。③按错误码 1700002 单独计数，全被系统拒时说「本机可能不支持代理提醒」而不是「N 条发布失败」。36 条断言。**真机已验**三条分支（关总开关 / 未授权 / 系统全拒） |
| M12-9 | 楼栋索引课表为空（时序竞态） | M10-1 | 每栋楼显示「本机课表 N 门」 | ✅ **2026-10-28 真机发现**：见 M10-1 行。修复后真机确认「文萃楼I → 本机课表 2 门」「综合教学大楼 → 5 门」。**源码栅栏**防回归（`test-campusdir` 28 断言，故意拆红 3 条全红） |

### M1 遗留（挂在最后，不影响主线）

| ID | 任务 | 依赖 | 验收判据 | 状态 |
|---|---|---|---|---|
| M1-5 | 短信二次验证续跑 | 用户在场 | 触发二验后输码能继续登录成功 | 🔄 代码在，未触发 |

### UI 迁移（对齐原版 BIT101；用户 2026-10-23 确认的顺序）

| ID | 页面 | 基准 | 验收判据 | 状态 |
|---|---|---|---|---|
| UI-81 | GridTokens 设计 token 层 | WarmColor.kt 1:1 + 外观设置页实证「清新青绿」 | 色值与 Android 源逐项一致（112 断言） | ✅ 完成（`281a7e9`） |
| UI-82 | 共享组件（GridCard/GridButton） | 原版 §5.1 卡片形态 | 组件测 95 断言 | ✅ 完成（`281a7e9`） |
| UI-83 | 首页 | ref-03 + UserScreen.kt | 卡片/按钮全 token 化 + 暗色真机截图 `evidence/ui83-home.jpeg` | ✅ 完成（`281a7e9`） |
| UI-84 | 课表页 | ref-01 + CourseScheduleCalendar.kt | 12 色块 + ink 竖条 + 今日列 peach + 调休 tint（104 断言） | ✅ 完成（`3461efe`） |
| UI-85 | 空教室页 | ref-07 + FreeClassroomSearch.kt | 三级折叠卡片化 + 教室项双色 + 校区分组（52 断言） | ✅ 完成（`2f87e7e`，已推远端） |
| UI-86 | 班车页 | ref-08 + TransportScreen.kt | M3 chip 语义 + 下一班 primaryContainer 卡 + 按小时分组 + 已发车分钟淡色（+11 断言） | ✅ 完成（`786c2ad`，已推远端） |
| UI-87 | 座位页 | ref-04/05 | 双 chip 视图 + 三卡列表 + 状态色对齐 SeatColors；监控面板 iOS 风→GridTokens | ✅ 1c1cab3 |
| UI-88 | 作业/DDL 页 | ref-02 | 分区标题单列表 + 紧急度混色卡 + 右勾选框 | ✅ cc94b20 |
| UI-89 | 我/设置 | ref-03/09/10 | 头像账号区 + 一卡通/校园网双卡横排 + 入口组；**palette 轴三套配色 + 切换接线** | ✅ 见摘要 |
| UI-90 | 框架 chrome（顶部 5 tab + 底部 6 项 + 各页 FAB 组） | ref-01~10 | Index.ets 切共享骨架；课表 5 键 / 空教室 2 键 FAB 补齐 | ✅ **外壳 + 课表 / 动态 / 空教室 chrome 已对齐**（顶部 5 tab / 底部 6 模块 / 图·网·话 占位；课表拆学期行+周导航行、5 颗 FAB、列头「周N」；动态页 1:1 ref-06 + 下拉刷新；空教室去标题/刷新钮、日期缩成一行小字、FAB = 刷新 + ⚙）。🔧 另修 **Scroll 顶对齐挂错节点**（11 页内容被垂直居中，含 DDL / 我 / 空教室 / 课表网格 / 班车），新增栅栏 `test-uiconventions`。**欠**：~~DDL「+ 新增 / 学士帽」、空教室「↑ 回到顶部」~~ → **2026-10-28 已做**（DDL 三颗 FAB + 本地新增/删除；空教室回顶 FAB + 下拉刷新）。~~我页入口组精简~~ → **已做（#91）**：入口组整组删除（原版 ref-03 无此组），「提醒设置」唯一入口先迁设置页「提醒」组再拆；账号区拆白卡改居中铺背景（UID/签名/粉丝鸿蒙无数据源不编造）；11 个 push 子页旧配色迁移 → **已做**（§14，待真机） |

> 基准：`harmony/ui-ref/MIGRATION-BASELINE.md`（安卓平板 adb 截图 + PIL 像素采样 + 源码双证，Warm 默认皮肤实证）。
> 每页流程：读原版源码定公式 → 切 gridTokens → 编译门 + 可证伪单测 →（鸿蒙手机连回后）真机截图归档。
> ⚠️ 后端服务器被封 ⇒ 需活 JWT 的页面（座位）真机验证不可行，只保结构与配色对齐，未验项如实标注。

---

## 5. 依赖与关键路径

### 5.1 关键路径（决定总工期）

```
M2-4 落库 ─┬─▶ M2-7 教学调整 ──▶ M7-2 提醒排期 ──▶ M8-1 课程卡
M2-2 网格 ─┘                        ▲
M3-1 空教室 ──▶ M3-3 自习卡 ────────┤
M4-1 eclass ──▶ M4-2 DDL ──▶ M7-1 ──┘
M9-1 JWT ✅ ──▶ M9-2 树 ──▶ M9-3 底图 ──▶ M9-4 预约 ──▶ M8-4 座位卡
```

**最短路径 = M2-4 → M2-7 → M3 → M4 → M7 → M8**。M5/M6 是旁支（不阻塞任何东西），M9 是独立支线。

### 5.2 可并行的三组（同一轮可一起推）

| 组 | 内容 | 为什么能并 |
|---|---|---|
| A | M3（空教室/自习） ∥ M4（DDL/动态） | 两个不同接口域，互不依赖 |
| B | M5（校园服务） ∥ M6（设置/深色） | 一个取数一个 UI，无交集 |
| C | M9（座位） ∥ 其他全部 | 独立后端（seatlib），JWT 已通 |

### 5.3 一次会话干一批（按用户偏好：一次性批量推进）

| 批次 | 内容 | 判据 |
|---|---|---|
| **B1（下一批，建议）** | M2-4 落库 + M2-7 教学调整 + M2-3 点验 | 飞行模式能看课表 + 补课日正确 + 切周生效 |
| B2 | M3 全套（空教室 → 自习卡 → 详情） | 自习卡在三种降级态下都不消失 |
| B3 | M4 + M5（DDL/动态 + 校园服务） | DDL 有真实截止 + 三张卡有真实数据 |
| B4 | M6 + M7（设置/深色 + 通知） | 深色对比度达标 + 提醒锁屏能弹 |
| B5 | M8 + M9（卡片 + 座位） | 卡片 4 页 + 座位能预约 |

---

## 6. 风险与阻塞

| # | 风险 | 现在状态 | 怎么验 | Plan B |
|---|---|---|---|---|
| R1 | CAS 登录页 Web 组件不渲染 | ✅ **已消除**（走纯 HTTP，比原方案更强） | — | — |
| R2 | seatlib TLS 只发叶证书 | ✅ 已解决（M1 用 CA 注入打通） | — | — |
| R3 | SSO 短信二验风控 | ⚠️ 未触发过 | 实测一次 | 用户去浏览器完成，等冷却 |
| R4 | `10.0.0.55` 校园网接口 | ✅ 开发机实测可达（2026-10-21，HTTP 200 + 真实 CSV）；⚠️ **手机侧明文 http 未验**（HarmonyOS 无 cleartext 开关，SDK 无相关配置项） | M5-2 真机连校园 Wi-Fi | 显示本月流量；断网显示「不在校园网」 |
| R5 | 卡片刷新配额（30min/50 次每天） | ⬜ 未验 | M8-5 观察 | `setFormNextRefreshTime` 最短 5min |
| R6 | 上架资质（备案/软著） | ⛔ 等用户 | 办理时知 | 先侧载自用 |
| R7 | AppGallery 是否要测试账号 | ❓ 无官方说法 | 提交时知 | 备只读演示账号 |
| R8 | eclass Keycloak broker 的 SameSite | ✅ **已消除**（2026-10-21 真机：抽得到 cookie、rcp 罐服务端认账，6 门课拿到） | — | — |
| R9 | 教务接口路径是黑盒 | 🔄 已部分破解（warmUp 是关键） | 逐接口验 | 对照 Android 抓包 |
| R10 | reminderAgent ≤30 条/应用 | 🔴 **2026-10-28 真机实测：这台机器上一条都排不进去**。8 条 publish 全报 `1700002 The number of reminders exceeds the limit`，但系统日志同时打出 `VerifyCloudCapability failed ... capability = reminder_capability` 与 `ReminderControl cn.bit101.next, notification not allowed`，上限被判成 `limit[0]` ⇒ **1700002 在这个机型上不等于「已满 30 条」，而是「本机不允许代理提醒」**。重启应用 / 重新授权通知后重试仍全失败（排除竞态与权限传播延迟） | M7-2 | 已做：UI 按错误码单独计数并如实说明「本机可能不支持代理提醒」；**待定**：是否改用 `notificationManager.publish` 定时降级（只能前台/定时任务触发，能力不等价，故未擅自实现） |
| R11 | Form Kit 能力边界（滚动列表） | ⚠️ 未验 | M8-1 | 降级为静态列表 |
| R12 | **USB 每 2~4 分钟掉线** | 🔄 已缓解 | — | 单次 shell 跑完整套 + `tools/run_*.sh` 重试脚本 |

**当前唯一硬阻塞**：无。设备在线（USB 不稳但可用），无等用户决策的事项。

---

## 7. 已付学费（别交第二次）

这几条是这轮真机踩出来的，写进路线图是因为它们会影响后面每一批的做法：

1. **金智 jwapp 模块 API 在「应用配置未加载」时返回 403 而不是 401**。必须先 GET `getAppConfig` 做预热。判据陷阱：PC 无 cookie 是 401、带 cookie 是 403 —— 差一个「已认证但无权限」，只看状态码会误判成「会话过期」。
2. **`autoRedirect` 要按用途分**：phpCAS 链必须 `false`（code 藏在 302 Location 的 hash）；教务必须 `true`（index.do 首次就是 302→换票→回应用的正常链）。
3. **ForEach 用索引当键会复用旧空单元格**：首帧空列表 → 数据回来后前 N 个键没变 → ArkUI 复用空格子，而状态栏已经算出「本周 8 节」。键必须内容派生。
4. **hilog 单行会截断**（~1KB）：长正文写沙箱文件再 `file recv`。
5. **`MSYS_NO_PATHCONV=1` 时不能给 hdc 传 `/f/...` 绝对路径**，要 `cd` + 相对路径。
6. **[10-20] 「今日高亮」必须连周次一起判**：只比「星期几」时，翻到第 6 周周二那列也被高亮成今天。
   凡「今天相关」的渲染都要问一句：**用户现在看的是本周吗**。
7. **[10-20] 测试绿不等于被测到**：把表格补课正则拆坏后，`10/10 按周四` 仍绿 —— 因为正文文字兜底也能命中。
   ⇒ 有多条解析路径时，必须**为每条路径单独构造 fixture**（只留那条路径的输入），否则「拆坏看红不红」也测不出来。
8. **[10-20] 「当前学期」不能读「上次查看的学期」**：空教室页与自习卡都用课表缓存的 `loadLast()`
   推周次，用户看过 2025-2026-2 之后再进来，页面把今天算成「第 34 周」，查出来的空教室全错。
   ⇒ 缓存键必须带学期；**需要「当前学期」的地方一律现查 `getCurrentTerm`**，再用该学期的缓存省请求。
9. **[10-20] 降级路径用故障注入验，别用推理**：把接口路径临时改成不存在的 `.do`，真机确认「缓存不清屏 + 如实标注刷新失败」，验完还原。
   `svc wifi disable` 能关 Wi-Fi，但 `svc data` 不支持、`settings` 命令不存在 ⇒ **鸿蒙沙箱里无法完全断网**，故障注入是唯一可行手段。
10. **[10-20] ArkUI 的 `Scroll` 内容不足一屏时会**垂直居中**：不设 `.align(Alignment.Top)` 时，
    详情页标题下方会空出一大块（dump 实测差 419px）。凡「内容可能不满一屏」的滚动页都要显式顶对齐。
11. **[10-20] 降级态里 `card.detail` 与 `error` 常是同一句话**：两处都渲染就会在界面上重复一遍
    （真机看到「网络不通，查不了空教室」连着两次）。渲染前必须去重。
12. **[10-20] 颜色写死在页面里 ⇒ 深色模式无从下手**：130 处 `'#888888'` 这类字面量，
    上线前才做深色会变成全院重写 + 靠肉眼验。而且原有的 `#888888`(3.54:1)、`#AAAAAA`(2.19:1)
    在浅色下就**已经不达标**。⇒ 语义色 + WCAG 单测必须**先于**深色功能落地。
13. **[10-20] 课程色板有深浅两套，别写死 `false`**：`courseColors(index, isDark)` 被我固定成浅色板，
    深色模式下深底页面里冒出一片浅色块。它的 `ink` 字段本来就是配好的文字色，跟着主题走即可。
14. **[10-20] 登出只清 Prefs 是不够的**：`CookieRepository.create(id)` 是**进程级单例**，
    只删持久化数据时内存罐里的会话仍然有效 —— 真机表现：设置页显示「未登录」，自习卡却照样
    查出 `20 栋楼 / 231 间 / 14.6 秒`。它没有 delete API，只能把每条 cookie 覆盖成 `maxAge: 0`。
    ⇒ 三个罐（`bit_login`/`bit_cas`/`bit_school`）的 id 必须**统一到一处**，否则登出必漏。
15. **[10-20] 改一节作息要连隔壁一起看**：把第 1 节从 08:00-08:45 改成 08:30-**09:15**，
    就直接压到第 2 节（08:50 开始）⇒ 校验报「重叠」。这不是 bug 是约束，
    但**我的第一版测试数据就是这么写的** —— 校验器把它拦下来了，正说明它有效。
16. **[10-20] 「在本机能跑」≠「可重跑」**：`test-parser.mjs` 读仓库外的 `../../evidence/*.html`，
    原工作区恰好命中、`git clone` 出来必然红。⇒ **fixture 必须随仓库走**，且缺失时要明确 `exit 1`，不许静默跳过。
    判据只有一条：**在干净 clone 上跑一遍**。
17. **[10-21] `build()` 根部不许声明局部变量**：本编译器 UI 描述只认「根节点起手」——
    `const x = …` 写在 build() 第一行就报 `Rollup Error: Unexpected token` +
    「build method can have only one root node」，错误位置钉在声明行上。
    派生列表一律走取值方法（`shownList()`），`now` 在用到处现算。
18. **[10-21] 测试 fixture 的数字键必须带引号**：`JSON.stringify(0)` 产出 `0:` 不是合法 JSON，
    `JSON.parse` 直接失败（Android 侧 Kotlin 字符串 `"\"$index\":"` 天然带引号，搬测试时看不出来）。
    构造「真实响应」类 fixture 后要先 `JSON.parse` 自检一遍。
19. **[10-21] hdc 通道不跨 Bash 调用存活**（无线更明显，几分钟就 isDead）⇒ 每次调用先 `tconn`；
    `uitest dumpLayout` 的保存路径是**自动生成**的（`/data/local/tmp/layout_<ts>.json`），
    从输出里 grep 出来再 `file recv`；**recv 不能用 `/f/...` 绝对路径**（cd + 相对路径才行）。
20. **[10-21] 鸿蒙杀进程/重启 App**：`kill` 对 app 进程 `Operation not permitted`（shell 属主不同），
    要用 `aa force-stop <bundle-name>`；重启用 `aa start -a EntryAbility -b <bundle-name>`。
21. **[10-21] tap 后立刻 dump 可能还是旧页面**（切换动画 ~1-2s）⇒ dump 与点击放同一次调用序列，
    且每步 tap 后重新 dump 验证再点下一步；设置页开合面板时 Scroll 会位移，跨调用点必漂。
22. **[10-21] ⚠️⚠️ 没注册进 `main_pages.json` 的页面根本不参与编译 ⇒ `BUILD SUCCESSFUL` 是假绿**：
    M5-3 五个新文件（service/data/corelogic/两个 page）写完跑 `assembleHap` 报成功，实际 rollup
    只编译从入口可达的文件——页面没注册 = 不可达 = 一行都没编译过。装到真机点入口没反应，
    才发现 `router.pushUrl` 目标漏注册。⇒ ① **新增 .ets 页面必须同步注册并重新构建**；
    ② `tools/test-routes.mjs` 守卫（扫全部 pushUrl/replaceUrl 目标对照注册表 + 反向查文件存在），
    已注册进 run-tests.sh；③ **「构建成功」不等于「新代码被编译过」**，判据是守卫 + 真机点一遍。
23. **[10-21] 注释里不许出现 `*/*` 连写**：`Accept */*` 写在块注释里，`*/` 被当成注释结束符，
    后半截中文按代码解析，炸出一串 `Cannot find name 'X'` / `Unterminated regular expression`
    假错误（报错行号就在注释行）。字符串字面量里的 `*/*` 无害，只有注释里会中招。
24. **[10-21] ArkTS 的 JSON 处理只能走项目既有模式**：`unknown` 类型被禁（arkts-no-any-unknown），
    要用 `JsonValue`（SchoolModels.ts）+ `str/num/objOf/arrOf`；`Object.values` 没人用过（返回
    any[] 有风险），遍历 Record 用 `Object.keys` + 下标；`catch (e)` 后 `(e as Error).message`
    是既有写法；`in` 操作符项目里零使用，判字段存在用 `obj[k] === undefined`。
    **Node 单测（transform-types）证明不了这些**——测试照跑 68 条全绿，ArkTS 编译器照样拒。
25. **[10-21] ForEach 的 keyGenerator 只能单参**：`(rec, idx?) => …` 双参写法在本编译器下
    连环报 `';' expected`（报错位置还漂到几十行外的容器闭合处）。照 DdlPage 的
    `(e: DdlEntry) => e.uid` 单参写法即可。
26. **[10-22] ⚠️⚠️⚠️ 全仓 ArkTS 合规扫描（自检）：Node 单测全绿 ≠ 能编译**，一次性修掉 31 处错误级语法：
    本机无 DevEco（`AppData/Local/Huawei/Sdk` 只剩 productConfig.json 空壳）+ CI 只跑 Node ⇒
    **鸿蒙仓从来没有过一次可信的 ArkTS 编译门**。按官方《从 TypeScript 到 ArkTS 的适配规则》逐类扫 + 修：
    ① `unknown`/`any`（arkts-no-any-unknown，10605008）22+3 处 → JsonValue idiom（SchoolModels
    `str/num/objOf/arrOf`，与 LibBorrowLogic/ScoreLogic 一致）。⚠️ 两个坑：`Record<K,V>` 下标类型是
    `V | undefined`（标注必须带 `| undefined`，strictNullChecks 会拒）；typeof 守卫后**仍需 `as`**
    （不依赖编译器窄化）。② `delete`（arkts-no-delete）NotifySentStore.prune → 重建新 map。
    ③ 解构赋值（arkts-no-destruct-assignment，10605069）5 处 → 索引/临时变量。
    ④ `globalThis`（SeatTaskStore 的 prefs hack，ArkTS 禁 globalThis）→ Prefs 封装（顺带消灭 `as any`）。
    ⚠️ **基线 tag 反证**：`h-v1.0.0-alpha.1` 编译图里就带 14 处 unknown + 11 处 as const + 3 处解构，
    与「assembleHap 已实测通过」的历史记录**矛盾** ⇒ 那条「通过」不可信（大概先行于这些文件或未真编），
    **不能当编译门**。唯一判据仍是 DevEco/真机 assembleHap。
27. **[10-22] as const / 字面量类型清理（第 26 条续）**：`as const`（arkts-no-as-const，10605142）
    11 文件 19 处 + `(typeof X)[keyof typeof X]` 16 处 + 裸字面量联合（WireSeatStatus /
    CasLoginService.LoginStatus，arkts-no-string-literal-type）全改 **string/number enum**。
    ① **官方口径**：字面量联合 `"A"|"B"` 也禁（不止 as const）⇒ union 方案不可行，enum 是唯一正路。
    ② **Node 链切换**：`--experimental-strip-types` **不支持 enum**（实测两版本都报错）⇒
    全链改 `--experimental-transform-types`（22.7+，实测 string enum 运行时值 === 原字符串，
    旧测试传字符串照跑绿 ⇒ **行为零变化**，测试文件零修改）。③ **test-enums.mjs 88 条锁定每个
    enum 成员运行时值**（防 value drift；单测传字符串绿证明不了这个）。④ 消费方只有成员访问
    `X.A`（enum 语法兼容）+ 6 处字符串比较（SeatPage/EclassActivityPage/WidgetPage/SeatApiLogic 内部）。
    ⑤ ⚠️⚠️ **compile-probe 自己是假绿受害者**：原探针用字符串字面量喂 enum 参数
    （`isFree("AVAILABLE")`）——Node 跑得过、ArkTS 编译必拒 ⇒ 探针全部改 enum 成员传参。
    ⑥ ⚠️ **SeatReservationLogic/SeatMonitorLogic 零 import**（⇒ SeatModel/SeatTask 不在编译图，
    enum 改造不会被编译器验证）⇒ probe 补拉 SeatModel/SeatTask/SeatReservationLogic 进编译图
    （SeatMonitorLogic 依赖 SeatTaskStore→@kit 链，Node probe 吃不了，留待 M9-8 接线）。
28. **[10-30] ⚠️⚠️ 「本机单测绿」不等于「CI 绿」：先把栅栏的读法改成平台无关的**。
    `test-uiconventions` 按 `'\n'` 切源码，本机 14 个 `.ets` 是 CRLF 工作副本（入库是 LF）⇒
    行尾残留 `\r`、`\{$` 匹配不上 ⇒ **本机悄悄漏扫这些文件里的 `Scroll()`，Linux CI 全扫**。
    CI 因此从 10-26 红到 10-30（20+ 次，无人发现），本机却一路绿。改按 `/\r?\n/` 切后立刻复现真 bug：
    `SeatMonitorPage.ets:345` 的 `Scroll` 有 `layoutWeight(1)` 缺 `.align(Alignment.Top)`（第 10 条同类）。
    ⇒ ① 读源码的脚本一律 `/\r?\n/`；② 工作副本 CRLF ≠ 入库 LF，别拿本机绿当结论；
    ③ 拿两套换行各跑一遍，或用 CI 复核。**顺带**：本仓库 job 日志要 admin 权限才读得到（403），
    唯一能匿名取证的通道是 **check-run annotations**；CI 失败时必须 `echo "::error::…"` 把失败套件
    与明细行打出来（`.github/workflows/test.yml` 已接），否则远端红了只能干瞪眼。

---

## 8. 版本管理（git）

**仓库位置**：`harmony/BIT101-harmony` 是**独立 git 仓库**（2026-10-20 建立）。
与 Android 的 `BIT101-seat` 物理隔离 —— 两条发布线、两套号段、两套 tag，互不影响。

**号段纪律（与 Android 完全隔离）**：

| | versionName | versionCode | tag |
|---|---|---|---|
| 鸿蒙线 | `1.0.0-alpha.N` | 自 1 起 | `h-v1.0.0-alpha.N` |
| Android 稳定线 | `1.11.x` | 92/93… | `v1.11.x` |
| Android 功能线 | `1.12.0-alpha.N` | 1001+ | `grid-alpha-N` |

⚠️ **每出一个包就 `versionCode +1`**，不分新功能还是修 bug（Android 线栽过：十批修复没改号，与已装包撞号）。

**已入库基线**：`h-v1.0.0-alpha.1`（`2df7790`，code=1）—— 真机可运行范围：登录 → 课表 → 空教室 → 自习卡 → 班车 → 考试。
`h-v1.0.0-alpha.9`（`a01d955`，code=9）—— 2026-10-27 发版：signed HAP 构建成功（1,329,839 bytes），单测 36/36 套件 2103 断言绿；内容含 #90 外壳 + 课表/动态/空教室 chrome 对齐 + Scroll 顶对齐等真机修复。⚠️ 发版当刻 USB 掉线（hdc `[Empty]`），真机安装验证未完成。

**提交纪律**：
- 显式列路径，禁 `git add -A`（除非是首次建仓，且已 `--dry-run` 核对清单）
- 提交前 `git status` 数条数；提交后 `git log --oneline -1` 复核
- **代码与证据分开**：`harmony/evidence/` 在仓库外（证据体积大、含截图），仓库只放源码 + 单测 fixture

**`.gitignore` 里两条不能想当然的规则**（都是差点埋雷的）：
- ❌ 不能忽略 `*.pem`：`entry/src/main/resources/rawfile/seatlib_tls_intermediate.pem` 是运行必需的 TLS
  中间证书，忽略了能编译通过、但 `loadCaPem` 静默降级空串 → TLS 握手失败（典型「降级后看起来也正常」）
- ❌ 不能用全局 `*.png`：`entry/src/main/resources/base/media/{startIcon,background,foreground}.png` 是 app 图标与启动图

**本地签名配置用 skip-worktree 挡着**（2026-10-21 补记）：本机 `build-profile.json5` 加了
`signingConfigs`（含 `.p12` 路径与口令，装真机必需），并对该文件设了
`git update-index --skip-worktree build-profile.json5` ⇒ `git status`/`git diff` 永远看不见它，
提交时不可能把凭证带进公开仓库。**远端与 `HEAD` 里 `signingConfigs: []`**。
⚠️ 换机器/重新 clone 后要重加签名配置并重设 skip-worktree；看到「status 干净但文件内容对不上」
先查 `git ls-files -v | grep '^S'`，别以为是 git 坏了。

**远端**：✅ 已配置 → **https://github.com/Star2121-1/BIT101-Harmony**（PUBLIC，默认分支 `main`）。
独立仓库，不塞进 `BIT101-S` 的分支 —— 两者源码结构完全不同，混在一个仓库会让 diff/review/CI 都变脏。

推送纪律：
- 日常 `git push origin main`；**`main` 之外还要显式 `git push origin --tags`**（`--push` 只推分支）
- 打 tag 前先确认它指向**能通过全部验收**的提交：`h-v1.0.0-alpha.1` 曾一度指向 fixture 修复之前的提交
  （那次 clone 出来 `test-parser` 必红），后来重打到修复提交上 —— **tag 是承诺，不是书签**
- 推前跑一遍敏感词扫描（学号/密码/真实 JWT/`ST-` 票据/私钥）；假票据 `ST-123456-abc` 属测试样例，可留

**CI（GitHub Actions，`.github/workflows/test.yml`）**：每次 push（**所有分支**，不只 main）跑两步：
1. `bash tools/run-tests.sh` 全部套件（当前 58 个 / 3017 条断言；断言条数由脚本自己统计，CI 不手抄）
   —— 不需要 HarmonyOS SDK，所以公开 runner 跑得动
2. **关键资源检查** —— TLS 中间证书在位；**图标三件套两处 × 三个全部验维度**（AppScope+entry，边长 ≥64；2026-10-24 堵 1x1 占位图漏检，见 `055a66f`）

> ⚠️ 原配置写成 `branches: [main]`，结果自检分支推上去压根不触发 CI，白等一轮。**功能分支也要跑**。
>
> **远端红了怎么查**：job 日志要仓库 admin 权限（匿名 `GET /actions/jobs/{id}/logs` → 403），
> 唯一匿名可读的是 **check-run annotations**（`GET /repos/{owner}/{repo}/check-runs/{id}/annotations`）。
> 所以单测 step 失败时会 `echo "::error::…"` 打出失败套件 + `FAIL`/`违规`/`entry/src/main/ets/` 明细行
> （`0bd93c1` + `050843e`）。**本机绿 ≠ CI 绿**：2026-10-30 的 CRLF 漏扫事故就是这么瞒了 4 天
> （详见 §7 第 28 条）。

**CI 守卫做过故意拆坏检验**（不然「CI 绿」可能只是检查写反了）：
开 `ci-selfcheck` 分支 → `.gitignore` 加 `*.pem` + `git rm --cached` 证书 → 推送：
单测 step `success`、**「关键资源」step `failure`**，日志 `❌ 缺 TLS 中间证书（运行期会静默降级）`。
验完即删该分支（远端 run 记录保留为失败，属于检验成本）。⇒ 守卫是真的，不是摆设。

**验收方式（唯一能证伪的办法）**：干净 `git clone` → 跑全部单测 → `assembleHap`。
2026-10-20 实测（本地 file:// clone 与 GitHub HTTPS clone 各一遍，结论一致）：
clone 出 88 个文件，`test-parser/teaching/edges/shuttle` 全 `exit=0`（31+50+40+30 = 151 条断言），
`BUILD SUCCESSFUL in 40s`，且 HAP 内 `resources/rawfile/seatlib_tls_intermediate.pem`（2926 bytes）在位。
GitHub clone 另验了行尾：`.sh`/`.ts` 均为 `w/lf`、0 个 CR（`.gitattributes` 生效，否则 Linux/CI 上 `bad interpreter: /bin/bash^M`）。

**本文件的位置**：已从 `harmony/ROADMAP.md` **移入仓库** → `docs/ROADMAP.md`（2026-10-20）。
一份文件、一个位置、一份历史；原路径只留一行指针文件，避免两边不同步。
`harmony/evidence/` 仍留在仓库外（体积大、含截图，属当次验证产物，不是源码）。

**文档分工**（记住这一条，别新开第四份）：

| 文件 | 作用 |
|---|---|
| `docs/ROADMAP.md`（本文） | **进度台账**：做什么、做到哪、怎么算做完 |
| `harmony/harmony-plan-2026-10-19.md`（仓库外） | **范围/架构/契约依据**：A 范围 / B 架构 / C 契约 / E 风险 |
| `README.md` | **对外门面**：这是什么、怎么构建、不支持什么 |

冲突时：**范围看计划，进度看本文**。

---

## 9. 进度统计

| 阶段 | 任务数 | ✅ | 🔄 | ⬜ | ⛔ | 完成率（不含⛔） |
|---|---|---|---|---|---|---|
| M1 遗留 | 1 | 0 | 1 | 0 | 0 | 0%（短信二验从未触发） |
| M2 课表 | 10 | 9 | 1 | 0 | 0 | 90%（M2-8 覆盖层待真机） |
| M3 空教室/自习 | 5 | 5 | 0 | 0 | 0 | 100%✅ |
| M4 DDL/动态 | 5 | 5 | 0 | 0 | 0 | 100%✅（M4-5 作业来源已做） |
| M5 校园服务 | 5 | 1 | 4 | 0 | 0 | 20%（4 项代码完、欠真机） |
| M6 设置/外观 | 5 | 5 | 0 | 0 | 0 | 100%✅ |
| M7 通知 | 5 | 0 | 5 | 0 | 0 | 0%（逻辑与管道全完，欠真机；代理提醒本机被禁） |
| M8 卡片 | 6 | 3 | 3 | 0 | 0 | 50%（M8-1/5/6 代码完，M8-2/3/4 页签空态） |
| M9 座位 | 8 | 2 | 5 | 1 | 0 | 25%（逻辑+契约+UI 全建；M9-7 研讨间 UI 暂缓） |
| M10 周边/上架 | 5 | 4 | 0 | 0 | 1 | 100%（不含 ⛔ 上架资质等用户） |
| M11 搜索/工具 | 6 | 5 | 1 | 0 | 0 | 83%（M11-6 无障碍剩余页面未扫） |
| M12 交互断链 | 9 | 9 | 0 | 0 | 0 | 100% |
| UI 迁移 | 10 | 10 | 0 | 0 | 0 | 100%（#81~#91，含子页细节欠账） |
| **合计** | **80** | **58** | **20** | **1** | **1** | **≈73%** |

> 统计时点 **2026-10-30**。数字由 §4 行首标记**直接计数**（脚本可复核），2026-10-30 起同时计入 M11/M12 新增行。
> ⚠️ **口径警告**：本表 ✅ 只代表「代码 + 单测 + 编译完成」，**不代表真机已验**。§4 里至少 10 行 ✅ 的正文明确写着「真机未验」：
> M2-7b / M8-6 / M10-2 / M11-2 / M11-3 / M11-4 / M11-5 / M12-3 / M12-5 / UI-90（子页）；另有 M12-4（剩余页面未扫）、
> M10-3/M10-4（无真机记录）、M8-5（刷新节奏未观察）。真机欠账以行内文字为准，**不要拿本表的 ✅ 对外报喜**。

> 历史快照（2026-10-27 00:45，UI 迁移 #81~#90 完成时）：外壳 + 课表 + 动态页 1:1 ref-06 + 空教室去多余 chrome，**真机逐页验过**，截图 `harmony/evidence/ui-6x-*`。三个系统性修复：①**8 位 hex alpha 在前**（`#AARRGGBB`）；②**Scroll 顶对齐挂错节点**（13 页内容被垂直居中）；③**11 个二级页迁到 gridTokens**（此前切皮肤对二级页不生效）。栅栏新增 `test-uiconventions` / `test-gridcontrast` / `test-pairstyle`。另修**开屏（启动窗）**：原为「白色底 + 中间一个橙色方块」（`startIcon.png` 是不透明合成图、底色写死 `#FFFFFF`），改为全屏品牌橙 `#FF9A57` + 透明底抠图鸽子，栅栏 `test-splash`，已真机抓帧验。当时全量 39/39 套件 2232 断言绿。⚠️ **②③ 只在编译+静态栅栏层面验过，无真机截图**（手机取走）；待验清单见 MIGRATION-BASELINE §14.6。我页入口组已删 + 账号区拆白卡（#91，真机已验，`evidence/ui-91-*`）。

> 注：M0/M1/M2-1 已完成的工作（约 15 人日）在表里已折算进 M2-1/M2-2/M9-1 三行，不另计。
> 「完成率」按任务数算，**不按工作量算**——M2-4/2-7 这类任务的工作量远大于 M2-9。

---

*下次更新时：改 §4 对应行的状态 → 在「验收判据」旁补证据路径 → 重算 §9。不要新开文档，不要只在会话里说「已验」。*
