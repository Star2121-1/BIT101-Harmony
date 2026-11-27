# 04 座位 —— Android ↔ 鸿蒙 功能对齐差距文档

> 审计性质：**只读、可证伪**。本次只读源码与文档，未改任何源码、未跑构建/真机/网络、未提交 git。
> 立场边界：后台抢座、自动抢位、自动路径凭据直登（会触发学校真实短信）**一律不做**（第 5 节）。本审计**不因 Android 端存在这些代码路径，就建议鸿蒙放宽**。
> 进度数字：**仅引用 `docs/ROADMAP.md`**。`FULL-PARITY-PLAN.md` 与 `evidence/seat-ui-parity-gap-20261123.md` 只用于背景，不引其进度结论。
> ⚠️ 状态判定从严：⚠️ 不写成 ✅；无代码/文件支撑的一律写「未找到证据」。
> ⚠️ 重要更正：`evidence/seat-ui-parity-gap-20261123.md:26-41` 记录的是**四阶段迁移之前**的旧状态（如「❌ 无模式概念」「只有跳网页规则」），当前代码已变；本文判据**全部按当前源码 file:line**，不沿用该旧表结论。

---

## 1. 域范围与已读文件

### 1.1 域范围

**纳入**：三级选址（校区→楼层→区域）、楼层平面图、座位图与五状态底图叠图、选座模式（单次/监控/优先）、选座回传、预约、取消、签到提示、我的预约、违约记录、研讨间、规则弹窗、取消额度、任务区（进行中/已结束/存活信息）、监控、会话静默续期与重登、自动重登限流。

**相邻域排除**：登录页本身（账号体系、`LoginPage.ets` 的 CAS 全链路）归域 01「登录/会话/账号」；本文只在**座位自动重登的 opt-in 凭据与短信二验落点**处引用 `LoginPage.ets`，不展开登录流程全貌（已与 `gap01-login` 协调）。通知/闹钟调度归域 06；地图瓦片归域 07。

**路径别名**（后文表格用缩写，`file:line` 均可直接定位）：

| 别名 | 实际前缀 |
|---|---|
| `A/` | `F:/Agent_Work/BIT-102/BIT101-seat/features/seat/src/main/java/cn/bit101/android/features/seat/` |
| `AD/` | `F:/Agent_Work/BIT-102/BIT101-seat/data/src/main/java/cn/bit101/android/data/repo/` |
| `H/` | `F:/Agent_Work/BIT-102/harmony/BIT101-harmony/entry/src/main/ets/` |
| `HD/` | `F:/Agent_Work/BIT-102/harmony/BIT101-harmony/docs/` |
| `HE/` | `F:/Agent_Work/BIT-102/harmony/BIT101-harmony/evidence/` |

### 1.2 实际读过的文件路径

**Android（`BIT101-seat`，均排除 build/ 产物）**

| # | 路径 |
|---|---|
| 1 | `AD/DefaultLoginRepo.kt`（重点 `:340-392`，密码落盘锚点 `:379`） |
| 2 | `A/SeatScreen.kt`（顶层 tab/导航/短信唯一入口） |
| 3 | `A/SeatViewModel.kt`（`:84-85` 额度、`:130-139` 短信、`:382-394` 本地额度、`:736-741` 取消） |
| 4 | `A/api/SeatSmsChallenge.kt`（`SeatSmsChallengeHub`，5min 超时） |
| 5 | `A/api/SeatAutoLogin.kt`（续期限流判据，全程） |
| 6 | `A/api/SeatSession.kt`（`:107/110/113/177` 短信挂起链） |
| 7 | `A/ui/component/SmsCodeDialog.kt`（`:26-52` 全校唯一入口） |
| 8 | `A/ui/component/LocationPicker.kt`（三级选址 + 楼层平面图 + 放大） |
| 9 | `A/ui/component/ModeSelector.kt`（三种模式 chip） |
| 10 | `A/ui/component/SeatMapCanvas.kt`（五状态图裁片 + 缩放/拖动） |
| 11 | `A/ui/screen/SeatRulesDialog.kt`、`A/SeatRules.kt`（规则 6 条 + disclaimer） |
| 12 | `A/ui/screen/TaskListLogic.kt`（排序/分组/存活文案） |
| 13 | `A/ui/screen/TaskListScreen.kt`（通知横幅/下拉刷新/研讨间/规则入口） |
| 14 | `A/ui/screen/SeatMapScreen.kt`（`:159-185` 取消、`:439` 取消按钮） |
| 15 | `A/model/{Area,Seat,Task,Seminar,Reservation,Renege}.kt`（树/状态图/任务/预约/违约模型） |
| 16 | `A/ui/screen/SeatViolationCard.kt`（违约明细弹窗 + 研讨室违约） |
| 17 | `A/SeatMonitorService.kt`（前台服务自动 confirm 抢座） |

**鸿蒙（`BIT101-harmony`，均排除 build/ 产物）**

| # | 路径 |
|---|---|
| 1 | `H/pages/SeatPage.ets`（1658 行，主页/表单/列表/规则/研讨间/去授权，分段读取） |
| 2 | `H/pages/SeatMapPage.ets`（`:123-179` 取数、`:502-556` 底图叠图） |
| 3 | `H/pages/SeatMonitorPage.ets`（前台监控状态条/去预约） |
| 4 | `H/service/SeatService.ts`（`:157-299` 各端点契约） |
| 5 | `H/service/SeatTreeService.ts`（只读树探针） |
| 6 | `H/service/SeatServiceMonitorAdapter.ts`（ISeatService 桥接） |
| 7 | `H/service/CasLoginService.ts`（短信发送/校验/停手） |
| 8 | `H/service/AutoReloginService.ts`（自动重登编排） |
| 9 | `H/corelogic/AutoReloginLogic.ts`（10min/3 次/8h 闸门） |
| 10 | `H/corelogic/SeatAutoReloginLogic.ts`（座位重登 → goto-login） |
| 11 | `H/data/AutoLoginCredentialStore.ts`（opt-in 凭据，系统密钥库） |
| 12 | `H/corelogic/SeatMonitorLogic.ts`、`SeatMonitorPolicy.ts`（前台轮询 + FOUND 守卫） |
| 13 | `H/corelogic/SeatFormLogic.ts`、`SeatListLogic.ts`、`SeatMapPageLogic.ts`、`SeatApiLogic.ts`、`SeatMapModel.ts`、`SeatTreeModel.ts`、`SeatViolationLogic.ts`、`SeminarLogic.ts` |
| 14 | `H/model/{SeatTask,SeatMapData,SeatMapModel,SeatTreeModel}.ts` |
| 15 | `H/data/CancelQuotaStore.ts`（本地额度） |
| 16 | `H/pages/LoginPage.ets`（opt-in 勾选、短信输入、pending 续接） |
| 17 | `HD/ROADMAP.md`（唯一进度权威）、`HD/SEAT-SIDEEFFECT-TESTCASE.md`、`HE/seat-ui-parity-gap-20261123.md`、`HE/seat-stage3-implementation-20261123.md`、`HE/device-a47-stage4-verify-20261123.md` |

---

## 2. 功能对照表

> 状态口径：✅ = 当前源码可直接对齐；⚠️ = 有差异/部分缺；⚠️ 不做 = 见第 5 节，属有意取舍，不是待修缺陷。

| 功能点 | Android | 鸿蒙 | 状态 | 证据(file:line) |
|---|---|---|---|---|
| 三级选址（校区→楼层→区域） | 校区/楼层下拉 + 区域芯片，层级 `type=0/0/1` | 三级全芯片，层级同构，`parseSeatTree` 1:1 移植 | ⚠️ 控件形态差异 | `A/ui/component/LocationPicker.kt:64-70,79-92,123-139` / `H/model/SeatTreeModel.ts:8,72-91` / `H/pages/SeatPage.ets:1020-1068` |
| 楼层平面图 + 放大弹窗 | 楼层节点 `imageUrl` 渲染 110dp 预览 + 「放大」AlertDialog | 模型有 `imageUrl` 字段，页面无渲染、无放大 | ⚠️ 缺 | `A/ui/component/LocationPicker.kt:95-113,143-158` / `A/model/Area.kt:8-13` / `H/model/SeatTreeModel.ts:18-19` / `H/pages/SeatPage.ets:1020-1068`（未找到证据） |
| 预约日期（今天/明天/服务端 availableDays） | 顶部日期 chip，`availableDays` 回落今天/明天 | `SeatFormLogic.dateOptions` 同口径，页面 chip | ✅ 对齐 | `A/SeatViewModel.kt`（日期参数）/ `H/corelogic/SeatFormLogic.ts:20-40,76-83` / `H/pages/SeatPage.ets:94-95,273-277,985-1006` |
| 选座模式（单次/监控/优先） | `ModeSelector` 三 chip | `FormMode` 三值 + 模式 chip，文案逐条对齐 | ✅ 对齐 | `A/ui/component/ModeSelector.kt:22-38` / `H/corelogic/SeatFormLogic.ts:6-18` / `H/pages/SeatPage.ets:968` |
| 选座模式（监控/优先可选被占座位、优先级按点选顺序） | `pickable`/`togglePick` | `pickable`/`togglePicked`，监控单选可反选、优先多选保序 | ✅ 对齐 | `A/SeatViewModel.kt:291-315` / `H/corelogic/SeatMapPageLogic.ts:26-30,36-45` / `HE/seat-stage3-implementation-20261123.md:17-18` |
| 独立座位图详情页 + 顶栏/信息条/底栏 | `SeatMapScreen` 独立路由 | `SeatMapPage` 独立路由，标题随模式变 | ✅ 对齐 | `A/SeatScreen.kt:159-168` / `H/pages/SeatMapPage.ets:18-30,438-475` |
| 五状态底图 + 每座位按状态裁片 | 五张完整房间图，**每座位只选一张，绝不叠加** | 状态裁片逐座位取图一致，但**额外用 `images.free` 整图铺底** | ⚠️ 画法差异 | `A/model/Seat.kt:65-103,87-88` / `A/ui/component/SeatMapCanvas.kt:53-77,71-77` / `H/corelogic/SeatApiLogic.ts:523-542,582-593` / `H/pages/SeatMapPage.ets:507-508` |
| 座位图双指缩放/平移 | `detectTransformGestures` + `graphicsLayer(scale/offset)`，初始 1.8 倍 | 固定 16:9 Stack，未找到缩放/平移手势 | ⚠️ 缺 | `A/ui/component/SeatMapCanvas.kt:108,117-139,255-264,270-281` / `H/pages/SeatMapPage.ets:502-521`（未找到证据） |
| 无底图方格兜底（按座位号数值排序） | `SeatGrid` + `SeatNumberComparator` | `sortedSeatsForGrid` + Flex 方格 + 图例 | ✅ 对齐 | `A/model/Seat.kt:131-138` / `A/ui/component/SeatGrid.kt` / `H/pages/SeatMapPage.ets:558-560` / `HE/seat-stage3-implementation-20261123.md:16` |
| 「我已预约」交叉标记 MINE（可取消） | `Seat.asMine()` 只改 RESERVED | `markMineSeats()` 只改 RESERVED | ✅ 对齐 | `A/model/Seat.kt:17-19,61-62` / `H/corelogic/SeatMapPageLogic.ts:68-76` |
| 预约（二次确认、签到时限文案、成功跳列表 tab） | ReserveBottomBar → confirm → 跳列表 tab | 点选→确认→`confirmReserve`；含签到文案；`seatTab='list'` | ✅ 对齐 | `A/SeatScreen.kt:108` / `A/SeatMapScreen.kt` / `H/pages/SeatPage.ets:638-696,686-691` / `HD/ROADMAP.md:18,37` |
| 取消（传**预约记录 id**） | 「我的预约」按 `record.id` 取消 | 同样按 `record.id`，第一次点击只进确认态 | ⚠️ 交互差异（鸿蒙多一次二次确认） | `A/model/Reservation.kt:12-14` / `A/SeatViewModel.kt:741` / `H/pages/SeatPage.ets:597-632` / `HD/SEAT-SIDEEFFECT-TESTCASE.md:15,19` |
| 任务区（进行中/已结束折叠/清除/存活信息行） | `TaskListScreen` + `TaskListLogic` | 阶段4 `taskCard()` + `SeatListLogic` | ✅ 对齐 | `A/ui/screen/TaskListLogic.kt:30-35,164-178` / `H/pages/SeatPage.ets:1499-1541,1544-1560` / `H/corelogic/SeatListLogic.ts:80-108,169-178` / `HD/ROADMAP.md:9` |
| 任务状态机 | 5 态 `IDLE/RUNNING/SUCCESS/FAILED/CANCELLED` | 6 态，多 `FOUND`（发现空位等用户确认） | ⚠️ 模型差异 | `A/model/Task.kt:13-19` / `H/model/SeatTask.ts:21-34,48-51` |
| 监控 / 后台抢座 | 前台 Service 持续轮询并**自动 `confirmSeat`** | 前台轮询，FOUND 只报告不预约，退后台即暂停 | ⚠️ 不做（见 §5） | `A/SeatMonitorService.kt:32-39,231-250` / `H/corelogic/SeatMonitorLogic.ts:159-186` / `H/corelogic/SeatMonitorPolicy.ts:21,35-38` / `HD/ROADMAP.md:265` |
| 研讨间（我的预约 + 取消，共用 `/api/Space/cancel`） | `Seminar.kt` + `SeminarCard` | `SeminarLogic` + `seminarCard()`，取消二次确认 | ✅ 对齐 | `A/model/Seminar.kt:15-26,36-62` / `A/ui/screen/TaskListScreen.kt:292-326` / `H/corelogic/SeminarLogic.ts:42-58,96-98` / `H/pages/SeatPage.ets:1411-1492` |
| 研讨间 App 内发起预约（整间+时段+成员） | 未实现，留网页入口 | 未实现，留网页入口 | ✅ 对齐（两端均不做） | `A/ui/screen/TaskListScreen.kt:296-301` / `H/pages/SeatPage.ets:1477-1487` |
| 规则弹窗（6 条要点 + 免责声明） | `SeatRulesDialog` | 阶段4 本地要点弹窗，非网页跳转 | ✅ 对齐 | `A/SeatRules.kt:18-45,48` / `A/ui/screen/SeatRulesDialog.kt:29-67` / `H/corelogic/SeatListLogic.ts:18-48` / `H/pages/SeatPage.ets:866,1575` / `HD/ROADMAP.md:8` |
| 取消额度（每天 2 次，本地计数、跨天重置） | `CANCELS_PER_DAY=2`，SP `seat_cancels` | 同口径，Prefs `seat_cancel_quota_v1` | ✅ 对齐 | `A/SeatViewModel.kt:84-85,377-394` / `H/data/CancelQuotaStore.ts:15-18,40-50` / `H/corelogic/SeatListLogic.ts:53-75` |
| 违约卡（N/5 + 明细弹窗 + 研讨室违约 type=2） | `ViolationCard` 含明细弹窗，座位/研讨室分节 | `违约 N/5` 直出，**无明细弹窗**，**不渲染 type=2** | ⚠️ 部分缺 | `A/ui/screen/SeatViolationCard.kt:52-62,96-97,108-111,126-134` / `H/pages/SeatPage.ets:703,1380,1395-1403,1613` |
| 下拉刷新 + 「刚刚更新」相对时间 | `PullToRefreshContainer` | `Refresh` + `updatedAgoText` | ✅ 对齐 | `A/ui/screen/TaskListScreen.kt:37-38,228-230` / `H/corelogic/SeatListLogic.ts:181-188` / `H/pages/SeatPage.ets:858` / `HD/ROADMAP.md:10,17` |
| 通知权限横幅 | `NotificationPermissionBanner`（有进行中任务且未授权时） | 未找到证据 | ⚠️ 缺（§5 连带） | `A/ui/screen/TaskListScreen.kt:98,247-248` / `H/pages/SeatPage.ets`（未找到证据） |
| 会话与重登（cookie 静默→凭据直登，**仅用户显式点击**） | `SeatAutoLogin.renew(allowCredentials)` | alpha.48 `authorizeSeat()` → `AutoReloginService.renew()` → 再换 JWT | ✅ 对齐 | `A/api/SeatAutoLogin.kt:74-113` / `H/pages/SeatPage.ets:431-465` / `H/corelogic/SeatAutoReloginLogic.ts:33-37` / `HD/ROADMAP.md:3` |
| 登录即默认存密码 | **是**，学校登录成功无条件 `loginStatus.password.set(password)` | **opt-in**：不勾选就永远为空，密码进系统密钥库 | ⚠️ 差异①（鸿蒙更严格） | `AD/DefaultLoginRepo.kt:379` / `H/data/AutoLoginCredentialStore.ts:2,12,56-78` / `H/pages/LoginPage.ets:45,98-102,285` |
| 短信二验落点 + 等待超时 | 座位页顶层就地弹码框，**5min** 挂起等待，取消可收起 | 跳登录页输码；登录页无 5min 超时/自动收起 | ⚠️ 差异② | `A/SeatScreen.kt:72-83` / `A/api/SeatSmsChallenge.kt:42,48,51-62` / `A/ui/component/SmsCodeDialog.kt:26-32` / `H/corelogic/AutoReloginLogic.ts:108-109,124` / `H/corelogic/SeatAutoReloginLogic.ts:25,33-37` / `H/pages/LoginPage.ets:300-314` |
| 续期限流参数与持久化 | 成功 30s 冷却 / 失败 5min 退避，进程内 `nextAllowedAt`，**不落盘** | 10min 闸门 / 连续失败 3 次冻结 8h，落盘防重启绕过 | ⚠️ 差异③ | `A/api/SeatAutoLogin.kt:49,52,59,80,91,110` / `H/corelogic/AutoReloginLogic.ts:20,22,24,57-68,86-101` / `H/service/AutoReloginService.ts:54-70` |

**统计**：对照表 26 行 → ✅ 对齐 **14** 项，⚠️ 差异/部分缺 **12** 项（其中 1 项归 §5 不做项、1 项为 §5 连带）。

---

## 3. 关键差异详述

### 3.1 D-01 登录默认存密码 vs opt-in（差异①，起点已复核）

- Android：`AD/DefaultLoginRepo.kt:375-380` —— 学校登录成功后**无条件**执行 `loginStatus.sid.set(username)` / `loginStatus.password.set(password)` / `status.set(true)`；注释 `:375-377` 说明后续 BIT101 代理登录失败也不回滚。密码是学校明文密码，落 `LoginStatus`（`A/api/SeatAutoLogin.kt:22-23` 明说"已经加密持久化了学号和密码"）。
- 鸿蒙：`H/data/AutoLoginCredentialStore.ts:2`「opt-in，默认不存」、`:12`「用户不在登录页勾『记住密码以便自动续期』，这里永远是空的」、`:56-78` `save()` 仅勾选时调用、密码进 `AssetStoreKit` 密钥库（`DEVICE_FIRST_UNLOCKED`）而非明文偏好；`H/pages/LoginPage.ets:45`（默认 false）、`:98-102`（`reachedLogin && remember` 才 save）。
- **判断**：鸿蒙更严格（隐私/凭据落盘面更小）。这是**不建议反向对齐**的差异——详见 S-03，需用户拍板，审计不擅自把鸿蒙改成默认存密码。
- 可证伪：删掉 `LoginPage.ets:285` 勾选后 `AutoLoginCredentialStore.has()` 必须为 false（`AutoLoginCredentialStore.ts:46-48`）。

### 3.2 D-02 短信二验就地弹框 vs 跳登录页（差异②，起点已复核）

- Android：`A/SeatScreen.kt:72-83` 把 `SmsCodeDialog` 挂在顶层（注释明说"全校唯一入口"，`:74-75` 说明从任何路径触发都能输入）；`A/api/SeatSmsChallenge.kt:42` `WAIT_CODE_TIMEOUT_MS = 5 * 60_000L`、`:51-62` `awaitCode()` 用 `CompletableDeferred` 挂起登录流程等码、超时抛 `IOException("验证码输入超时，请重新授权")`、`:72-74` 可取消；`A/api/SeatAutoLogin.kt:102-106` 刻意**不设网络总超时**，把时限交给 Hub。
- 鸿蒙：`H/corelogic/AutoReloginLogic.ts:108-109` 把 `sms_required`/`captcha_required` 归为 `need_user`，`:124` 文案「请到登录页手动登录」；`H/corelogic/SeatAutoReloginLogic.ts:25,33-37` `seatRenewAction()` 对非 `renewed` 一律 `goto-login`；`H/pages/LoginPage.ets:300-314` 短信输入框在**登录页**，`:179-208` 提交。
- **重要澄清（避免过度归因）**：鸿蒙**不会白发短信**——`H/service/CasLoginService.ts:83,240` 把 `pending`（含表单/会话/手机号）存进程内，`:324` 提交时取回，`H/pages/LoginPage.ets:62,71` 进页即 `hasPendingSms()` 续接。差异是**落点与超时**：① 用户被带离座位页；② 登录页无 5min 倒计时/自动收起；③ 座位页无就地输入框。
- 可证伪：模拟 `sms_required` 后当前页面 `path` 应为登录页（`SeatAutoReloginLogic.ts:37`），且 `H/pages/LoginPage.ets` 中未找到 `WAIT_CODE_TIMEOUT_MS` 或任何 5 分钟计时。

### 3.3 D-03 续期限流参数与持久化（差异③，起点已复核）

| 维度 | Android | 鸿蒙 |
|---|---|---|
| 成功冷却 | 30s（`A/api/SeatAutoLogin.kt:49` `SUCCESS_COOLDOWN_MS = 30_000L`，`:80/:110` 写入） | 无「成功冷却」独立参数：`nextThrottle` 对 `renewed` 只记 `lastAttemptMs`（`AutoReloginLogic.ts:87-88`），下次受 10min 闸门约束 |
| 失败退避 | 5min（`:52` `FAIL_BACKOFF_MS = 5 * 60_000L`，`:97/:110` 写入） | 连续失败 3 次后冻结 8h（`:22` `MAX_FAILS_BEFORE_FREEZE=3`、`:24` `FREEZE_MS=8*60*60*1000`、`:95-99`） |
| 统一最小间隔 | 无（仅上面两条） | 10min（`:20` `MIN_RETRY_MS=10*60*1000`，`:64-66` `canAttempt`） |
| 持久化 | `nextAllowedAt` 进程内变量（`:59`），重启归零 | `RenewThrottleStore` 落盘，`AutoReloginService.ts:54,70` 每次读写，注释「防进程重启绕过闸门」（`AutoReloginLogic.ts:41`） |
| cookie 静默路径 | 不受凭据限流，随时可先试（`:77-83`） | `authorizeSeat()` 先 `silentRenewJwt`（`SeatPage.ets:445`），失败才进 `renew` 闸门，语义一致 |

- 可证伪：`H/corelogic/AutoReloginLogic.ts:20/22/24` 三个常量与 `A/api/SeatAutoLogin.kt:49/52` 数值不同；`H/service/AutoReloginService.ts:70` 存在 `RenewThrottleStore.save`，Android 无对应落盘。

### 3.4 D-04 后台抢座 vs 前台监控（有意不做）

- Android：`A/SeatMonitorService.kt:32-39` 前台 Service，注释「退到后台、锁屏乃至进程被杀后重建都能继续」；`:231-236` 发现空位直接 `seatApi.confirmSeat(target.id, ...)`；`:48-57` 10s/5s 基准间隔。
- 鸿蒙：`H/corelogic/SeatMonitorPolicy.ts:21,35-38` 决策类型只有 `WAIT/FOUND`，**编译期就没有 auto-confirm 分支**；`SeatMonitorLogic.ts:159-186` 退后台立即 break、FOUND 态停轮询；`SeatMonitorPage.ets:331` 明说「已暂停：App 在后台时不轮询监控（不会后台抢座）」；`HD/ROADMAP.md:265` 官方降级口径。
- 详见 §5 N-01/N-02。

### 3.5 D-05 楼层平面图 + 放大弹窗缺失

- Android `A/ui/component/LocationPicker.kt:95-113` 用 `AsyncImage` 渲染 `selectedFloor.imageUrl`（110dp，`ContentScale.Fit`），`:143-158` 点「放大」弹 AlertDialog 全屏看图，注释 `:49-50` 说明用途是「认路」。
- 鸿蒙 `H/model/SeatTreeModel.ts:18-19` 虽保留 `imageUrl` 字段并解析 `:77-81`，但三级选址渲染（`H/pages/SeatPage.ets:1020-1068`）只有校区/楼层/区域三行 chip + 已选区域卡片，全仓检索 `平面图|放大|planUrl` 在 `SeatPage.ets` 无命中 → **未找到证据**。
- 可证伪：在 `SeatPage.ets` 三级选址段落加 `Image(floor.imageUrl)` 前，选中楼层不会出现任何平面图。

### 3.6 D-06 座位图缩放/平移缺失

- Android `A/ui/component/SeatMapCanvas.kt:108` `scale`、`:117-139` `graphicsLayer{scaleX/scaleY/transformOrigin}`、`:255-264` `detectTransformGestures` 双指以中心为锚缩放+拖动、`:270-281` 点击坐标按 `scale/offset` 反算热区。初始 1.8 倍解决 16:9 横图在竖屏留白。
- 鸿蒙 `H/pages/SeatMapPage.ets:506-516` 是固定 `.aspectRatio(16/9).clip(true)` 的 Stack，`:524-556` 每座位百分比定位；全页检索 `PinchGesture|scale|zoom|平移|缩放` **No matches found** → **未找到证据**。
- 可证伪：座位图页无双指手势处理，16:9 图在窄屏只能看全貌、不能放大看座位号。

### 3.7 D-07 底图铺底方式差异（视觉正确性风险）

- Android `A/model/Seat.kt:87-88`「五张图是各自完整的房间图，不是互补图层 —— 必须每座位选一张，**绝不能叠加**」；`A/ui/component/SeatMapCanvas.kt:58-77` 记录了曾把五张全叠导致「所有座位都显示成临时离开」的回归。
- 鸿蒙逐座位取图**正确**：`H/corelogic/SeatApiLogic.ts:530` `mapImageForStatus(s.status, images)`、`:582-593` 映射与 Android `forStatus` 一致；但 `H/pages/SeatMapPage.ets:507-508` 额外铺了一张 `images.free` 整图作底，`:529-535` 再逐座位叠状态裁片。
- 判断：当前 `free` 整图作为背景（含全部座位图标）再叠裁片，可能与 Android「只显示座位那一张」的视觉不一致；是否构成 bug 需真机对照，**本次不做真机/网络验证**。建议作为 P1 视觉核对项，不擅自改。

### 3.8 D-08 违约卡明细弹窗与研讨室违约未渲染

- Android `A/ui/screen/SeatViolationCard.kt:52-62` 同时接收座位违约与研讨室违约两个列表（注释 `:53-56` 明确「不并入计数，各算各的」），`:96-97` 「明细」按钮，`:127-134` `AlertDialog("违约明细（共 N 条）")` 分「座位违约」「研讨室违约」两节，`:108-111` 研讨室违约单独一行。
- 鸿蒙 `H/pages/SeatPage.ets:703` 明确「研讨间（type=2）…wire 字段未真机核对，本页不渲染，仅违约直出」；`:1380` 只显示 `违约 N/5`，`:1401-1403` 平铺记录，无「明细」按钮/弹窗（全文检索无 `AlertDialog` 用于违约） → 研讨室违约与明细弹窗**未找到证据**。
- 注：`H/corelogic/SeatViolationLogic.ts:34,39,93-96` 的 5/30 天纯逻辑是本地模型，服务端权威数据走 `H/service/SeatService.ts:250-260 reneges()`；`HD/SEAT-SIDEEFFECT-TESTCASE.md:48` 如实标注研讨间取消是否共用额度「服务端未明示，用例也不断言」。

### 3.9 D-09 取消交互：鸿蒙多一次二次确认

- Android `A/ui/screen/SeatMapScreen.kt:179` 点「取消预约」按钮直接 `viewModel.cancelReservation(seat.id)`（`:439` 按钮），无二次确认。
- 鸿蒙 `H/pages/SeatPage.ets:597` 点取消先进 `cancelTarget` 确认态，`:603-632` 二次确认后才真调；研讨间同理（`H/corelogic/SeminarLogic.ts:10-12`、`H/pages/SeatPage.ets:756-774`）；`HE/seat-stage3-implementation-20261123.md:21` 明说这是「铁律 0.6 高于 Android 的单击取消」。
- 判断：鸿蒙更保守（防误触对外副作用），**不建议反向对齐**；详见 S-08。

### 3.10 D-10 通知权限横幅缺失（不做项连带）

- Android `A/ui/screen/TaskListScreen.kt:98` `rememberNotificationPermissionState()`，`:247-248` 有进行中任务且未授权时显示 `NotificationPermissionBanner`（为后台抢座结果通知服务）。
- 鸿蒙 `H/pages/SeatPage.ets` 全文检索 `通知权限|横幅|NotificationPermission` **No matches found** → **未找到证据**。因鸿蒙不做后台抢座（§5），常驻通知与横幅失去前提；登记为「不修」，不列为缺陷。

### 3.11 D-11 三级选址控件形态

- Android 校区/楼层用 `ExposedDropdownMenuBox`（`LocationPicker.kt:173-198`），区域用 `FilterChip`（`:123-139`）。
- 鸿蒙三级均 `SeatChip`（`SeatPage.ets:1020-1068`）。层级语义与数据一致（✅），仅交互控件不同；`H/corelogic/SeatViewLogic.ts:93` 的 `FloorGroup.imageUrl` 已透传但未被 UI 使用。低优先级。

### 3.12 D-12 任务状态机多 FOUND 态

- Android 5 态（`A/model/Task.kt:13-19`）；鸿蒙 6 态多 `FOUND`（`H/model/SeatTask.ts:21-34`），`H/corelogic/SeatMonitorLogic.ts:183-186` FOUND 态停轮询等用户确认。此差异是 D-04「不自动预约」的直接结果，不单独修复。

---

## 4. 可执行修复清单

> 风险列口径：**是否触对外副作用 / 学校风控**。「是」= 会打 seatlib 写接口或学校 CAS（可能触发真实短信），必须用户本人确认；「否」= 纯本地/UI。

| 编号 | 改动点 | 鸿蒙文件 | 验收判据(可证伪) | 风险(是否触对外副作用/学校风控) | 优先级 |
|---|---|---|---|---|---|
| S-01 | 续期限流口径统一：明确「成功冷却/失败退避」与「10min 闸门+3 次冻结 8h」取哪套；若对齐 Android 则把 `MIN_RETRY_MS`/`FREEZE_MS` 改为 30s/5min 并确定是否继续落盘 | `H/corelogic/AutoReloginLogic.ts:20,22,24,57-68,86-101`；`H/service/AutoReloginService.ts:54,70` | 改后 `MAX_FAILS_BEFORE_FREEZE` 次失败所需冻结时长按所选口径复算；`HD/ROADMAP.md` 同步登记。**未拍板前不得改** | **是**（放宽会加密 CAS 登录次数→学校风控真实短信无人输；收紧则功能退化）。需用户拍板 | **P0** |
| S-02 | 短信二验落点：评估把 `need_user` 从「跳登录页」改为座位页就地码框 + 5min 倒计时（复用 `CasLoginService.pending` 续接） | `H/corelogic/SeatAutoReloginLogic.ts:25,33-37`；`H/pages/SeatPage.ets:454-465`；`H/pages/LoginPage.ets:300-314`；`H/service/CasLoginService.ts:83,240,324` | 触发 `sms_required` 后当前页仍在座位页且出现验证码输入框；5min 后码框自动收起并报「验证码输入超时」。**未找到证据前不得写成已实现** | **是**（涉及学校真实短信；改动不当会白发短信/用户无法输入）。需用户拍板 | **P0** |
| S-03 | 密码默认存储：决定「对齐 Android 登录即存」还是「保持鸿蒙 opt-in」。**审计建议保持 opt-in**；若必须对齐，需显式征询用户同意并把风险写入设置页 | `H/data/AutoLoginCredentialStore.ts:12,56-78`；`H/pages/LoginPage.ets:45,98-102,285` | 未勾选「记住密码」时 `AutoLoginCredentialStore.has()` 恒为 false（`AutoLoginCredentialStore.ts:46-48`）；若改为默认存，须有用户显式同意记录 | **是**（凭据落盘面扩大→隐私/合规风险；不触学校风控）。需用户拍板 | **P0** |
| S-04 | 底图铺底核对：确认 `images.free` 整图铺底是否造成与 Android「每座位仅一张、不叠加」视觉不一致；如不一致改为不铺底或铺中性底色 | `H/pages/SeatMapPage.ets:507-508,529-535`；参照 `H/corelogic/SeatApiLogic.ts:530,582-593` | 单个已预约座位位置显示 `book` 裁片而非 `free` 底图透出；用固定 fixture 逐像素对照 Android `A/ui/component/SeatMapCanvas.kt:58-77` 的实测结论 | 否（纯渲染） | P1 |
| S-05 | 违约卡补齐：渲染 `type=2` 研讨室违约（不计入 5 次），并加「明细」弹窗分节展示 | `H/pages/SeatPage.ets:703,1380,1395-1403`；`H/service/SeatService.ts:250-260`；对照 `A/ui/screen/SeatViolationCard.kt:52-62,127-134` | 拉到研讨室违约时页面上出现独立行；有违约时点「明细」弹出分节列表，计数仍为座位 N/5 | 否（只读接口） | P1 |
| S-06 | 三级选址补楼层平面图预览 + 放大弹窗（服务端 `image_url` 可用时） | `H/pages/SeatPage.ets:1020-1068`；`H/model/SeatTreeModel.ts:18-19`；`H/corelogic/SeatViewLogic.ts:93` | 选中带 `imageUrl` 的楼层后出现预览图；点「放大」出现全图弹窗；无图时不渲染（容错） | 否（只读图片） | P1 |
| S-07 | 座位图补双指缩放/平移（按热区反算点击坐标） | `H/pages/SeatMapPage.ets:502-556`；对照 `A/ui/component/SeatMapCanvas.kt:108,255-281` | 双指缩放后点座位仍能命中正确 `seatId`（坐标反算与 `H/corelogic/SeatMapModel.ts:86-111` 一致） | 否（纯手势/渲染） | P2 |
| S-08 | 取消二次确认：**建议保持鸿蒙现状**（更保守），仅在文档登记差异，不反向改成单击取消 | `H/pages/SeatPage.ets:597-632`（保持不变） | 回归验证：点「取消」首次不调用 `cancelReservation`，二次确认后才调用（`HD/SEAT-SIDEEFFECT-TESTCASE.md:19`） | 否（保持现状） | P2 |
| S-09 | 三级选址控件形态（可选）：评估下拉+芯片是否比全芯片更贴近 Android | `H/pages/SeatPage.ets:1020-1068` | 层级选择结果与 `parseSeatTree` 一致（`H/model/SeatTreeModel.ts:72-91`），不改变服务端参数 | 否（纯 UI） | P2 |
| S-10 | 通知权限横幅：因鸿蒙不做后台抢座而**不修**，仅在文档登记 | `H/pages/SeatPage.ets`（保持现状） | 回归验证：进行中监控任务不申请通知权限、不发后台通知（`H/corelogic/SeatMonitorLogic.ts:159-164`） | 否（保持现状） | P3 |

**P0 编号列表：`S-01`、`S-02`、`S-03`**（均需用户拍板，审计不擅自变更对外副作用/凭据策略）。

---

## 5. 明确不做项及原因

| 编号 | 不做项 | Android 存在形态 | 鸿蒙立场与原因 | 证据(file:line) |
|---|---|---|---|---|
| N-01 | 后台/锁屏抢座（前台 Service 常驻轮询） | `SeatMonitorService` 前台服务，退后台/锁屏继续轮询，常驻通知 | 鸿蒙长时任务类型不含此场景，**降级为「App 前台可监控」**；退后台即暂停，回前台用户点「继续监控」恢复 | `A/SeatMonitorService.kt:32-39,89` / `H/corelogic/SeatMonitorLogic.ts:159-164` / `H/pages/SeatMonitorPage.ets:328-341` / `HD/ROADMAP.md:265` |
| N-02 | 自动抢位（发现空位自动发 `confirmSeat`） | `:231-236` 发现空位立刻下单，`:233` 记 attempts | 决策类型只有 `WAIT/FOUND`，**编译期无 auto-confirm 分支**；预约必须由用户点「去预约」二次确认（对外副作用，铁律 0.6） | `A/SeatMonitorService.kt:231-236` / `H/corelogic/SeatMonitorPolicy.ts:21,35-38` / `H/corelogic/SeatMonitorLogic.ts:117-138,183-186` / `HD/SEAT-SIDEEFFECT-TESTCASE.md:5-7` |
| N-03 | 自动路径（进页面/取数失效/401 重试）走凭据 CAS 直登 | `allowCredentials` 严格限制，仅用户显式授权路径传 true | 同样只在我方 `authorizeSeat()`（用户显式点击）内调 `AutoReloginService.renew()`；自动路径只走 cookie 静默续期，避免学校风控发真实短信却无人输入 | `A/api/SeatAutoLogin.kt:64-70,85-88` / `H/pages/SeatPage.ets:431-465,499-510` / `H/corelogic/SeatAutoReloginLogic.ts:10-11` / `HD/ROADMAP.md:3` |
| N-04 | App 内发起研讨间预约（整间 + 时段 + 参与成员） | 两端均未实现，只提供网页入口与查看/取消 | 发起流程涉及成员与整间资源申请，两端均保留网页预约；不列为差距 | `A/ui/screen/TaskListScreen.kt:296-301` / `H/pages/SeatPage.ets:1477-1487` |

**理由总述**：N-01/N-02 是平台能力与「铁律 0.6（有对外副作用的动作绝不上自动路径）」共同决定，属有意取舍而非缺陷；N-03 是学校风控红线（真实短信无人输入是真机反馈过的痛点，`A/api/SeatAutoLogin.kt:64-70`）；N-04 两端行为一致。`HD/SEAT-SIDEEFFECT-TESTCASE.md:46-49` 还如实标注了「服务端额度是否真的扣减/跨设备同步」「研讨间取消是否共用座位额度」「优先模式多选副作用真机未跑」三项**未覆盖**，本文不把它们写成已验。

---

## 附：进度口径（仅引用 ROADMAP，本次未自行推算）

- `HD/ROADMAP.md:3`：alpha.48（versionCode 47→48）`authorizeSeat()` 接 `AutoReloginService.renew()`；全量 **94/94 套件 4091 断言绿**；**真机待验**。
- `HD/ROADMAP.md:5`：alpha.47 修复任务冷启动丢失；全量 **92/92 套件 4020 断言绿**。
- `HD/ROADMAP.md:12`：alpha.46 阶段4 列表 tab 补齐；全量 **92/92 套件 4019 断言绿**；真机待验。
- `HD/ROADMAP.md:20`：alpha.44 阶段3 独立座位图页；全量 **91/91 套件 3961 断言绿**；真机未验。
- `HD/ROADMAP.md:265`：后台抢座轮询降级为前台可监控（N-01 依据）。

> 本次为**纯静态审计**：未做网络请求、未连真机、未跑构建；上述数字全部为 ROADMAP 记载的历史口径，不代表本次验证结果。

v1.0 / 2026-11-24

---

## 修复进度登记（2026-11-27，v1.0 审计内容不改动）

| 编号 | 状态 | 证据 |
|---|---|---|
| S-01 | ⚠️ 代码完成 + 静态绿，**真机待集中验** | 已随 P0 第9条 F01-01 落地：`AutoReloginLogic` 两套口径，seat 模式成功 30s 冷却 / 失败 5min 退避；`SeatPage.authorizeSeat` 显式传 `'seat'`（`renew(ctx, 'seat')`）。`test-sessionparity` 69 断言覆盖。 |
| S-02 | ⚠️ 代码完成 + 静态绿 + 编译通过，**真机待集中验** | commit 待提交（alpha.58/versionCode 58）。新增 `corelogic/SeatSmsChallengeLogic.ts`：`seatSmsRoute` 仅在 `need_user + hasPendingSms` 走就地码框（图形验证码/密码错/节流仍跳登录页，防误引）；5min 超时 `SMS_WAIT_TIMEOUT_MS=300000` 对齐 Android `SeatSmsChallengeHub`。`SeatPage.authorizeSeat` 就地弹 `SmsChallengeDialog`（成功→`afterSmsSuccess` 换 seatlib JWT + 重试，不跳登录页不重输密码；取消 clearPending；超时报「验证码输入超时，请重新授权」）。`SmsChallengeDialog` 加可选 `timeoutMs`（默认 0，向后兼容 CardPage/LibBorrowPage）。`test-seatsms` 47 断言 + 两组拆红-恢复（`evidence/seatsms-20261127/`：删就地路由分支红、删码框分支 return 红）。红线守住：4 处 `authorizeSeat` 入口全在 `.onClick`（静态守卫），自动路径绝不发短信。 |
| S-03 | ⚠️ 代码完成 + 静态绿，**真机待集中验** | 已随 P0 第9条 F01-02 落地（用户拍板 B：无条件存，对齐 Android）：`LoginPage` 登录成功即存 AssetStoreKit 密钥库；本域不再单独改。 |

> 本批不判 ✅（G5 集中验收未做；S-02 需真实短信二验上机才成立）。按用户要求真机留到最后集中做，编译/全测通过不等于真机通过。

*v1.1 进度登记 / 2026-11-27*

### 7.2 S-08/S-10 保持现状登记（2026-11-27，v1.0 审计内容不改动）

| 编号 | 状态 | 证据 |
|---|---|---|
| S-08 | ✅ 保持鸿蒙现状（不反向改单击取消） | 取消仍走二次确认（`SeatPage` 的 confirmCancel，铁律 0.6）；`test-seatsideeffect` 守卫仍在。更保守，不改成 Android 单击。 |
| S-10 | ✅ 登记为平台不做（通知权限横幅） | 鸿蒙不做后台抢座（N-01），故无「进行中任务未授权通知权限」横幅场景；审计 §3/§5 已登记，`SeatMonitorPage` 明示「后台暂停」。不修。 |

*v1.2 S-08/S-10 登记 / 2026-11-27*
