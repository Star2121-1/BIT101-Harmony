# 06 社区话廊 / 消息 / 通知 —— Android ↔ 鸿蒙 功能对齐差距文档

> 审计性质：**只读、可证伪**。本次只读源码与文档，未改任何源码、未跑网络/真机/构建、未提交 git。
> 状态判定从严：**⚠️ 不写成 ✅**。凡单端有、另一端无者一律写「未找到证据」并给出检索式；不把「代码写了」当「功能对齐」，不把「编译过」当「验收过」。
> 进度数字：**仅引用 `docs/ROADMAP.md`**，不引用其它计划文档的进度结论。
> 已知起点（来自 ROADMAP）：alpha.26 话廊只读、alpha.27 写操作（发帖/点赞/评论/举报）落地；图片与 H5 富文本属 H5 专属明确不做；通知的已读/分组/深链/免打扰已做。本文以源码复核这些起点，并找出仍存的差距。

---

## 1. 域范围与已读文件

### 1.1 域范围

**纳入（三块）**：

1. **话廊/社区**：四流列表（关注/推荐/最新/最热）、搜索、列表三态、登录与 401 静默刷新、社区资料与「我的帖子」、纯文字发帖/点赞/评论/举报、写操作对象模型（`obj`/`claimId`/`plugins`/`poster`/`comment`）。
2. **消息中心**（社区互动消息：点赞/评论/关注/系统四类，含未读数与深链）。
3. **通知**（校园能力提醒）：排期提醒与即时提醒两类来源、通知渠道与优先级、历史 14 天保留、分组、未读快照、深链白名单、免打扰时段、设置项。

**明确排除**：
- 图片上传（发帖/评论）、H5 富文本 `plugins`/EditorJS 原生渲染、帖子详情原生解析 —— 均为 H5 专属，用户已拍板纯文字等价（见 §5）。
- 座位「违约记录展示/判定」（`SeatPage.ets`、`SeatLogic.ts`、`SeatApiLogic.ts`）归域 04「座位模块」；本文只把它作为「座位违约**通知**是否存在」的对照面，不展开违约数据逻辑（已与 gap04-seat 边界对齐）。
- `OverlayPage.ets` 经读第 1–17 行确认是**手动改课表覆盖层**（`CourseOverlayStore`/`CourseOverlayLogic`），与本域无关，仅列名备查，不作为行级证据。
- 校园网费/流量/借阅的**取数逻辑本身**归域 03，本文只对照其「通知出口」。

### 1.2 实际读过的文件

**Android（`BIT101-seat`，均排除 build/ 产物）**

| # | 路径 | 用途 |
|---|---|---|
| 1 | `features/message/src/main/java/cn/bit101/android/features/message/MessageScreen.kt` | 消息中心 4 tab / 未读徽标 / 深链 |
| 2 | `features/message/src/main/java/cn/bit101/android/features/message/MessageViewModel.kt` | 分开计数 / 分页 |
| 3 | `features/notify/.../NotifyCenter.kt` | 9 个通知渠道 / 优先级 / 发送出口 / 深链 |
| 4 | `features/notify/.../NotifyLogic.kt`（读 20–70 行 + Grep 全量符号） | 5 类 ReminderKind / plan |
| 5 | `features/notify/.../NotifyScheduler.kt` | WorkManager 排期 + 周期兜底 |
| 6 | `features/notify/.../NetFeeCheckWorker.kt` | 即时检查 Worker / 周期调度 |
| 7 | `features/notify/.../NetFlowChecker.kt`、`ScoreNotifyChecker.kt`、`LibBorrowChecker.kt`、`SeatReminderSource.kt`、`SeatViolationNotifier.kt`、`NotifySentStore.kt`、`NotifyAppStartup.kt`、`NotifyRepositoryHolder.kt` | 通知来源与去重（Grep + 部分通读） |
| 8 | `features/poster/.../PosterScreen.kt` | 帖子详情：评论/子评论/赞/举报/删除/编辑 |
| 9 | `features/poster/.../PosterViewModel.kt` | 写操作对象模型 `ObjectType`/`CommentType` / 评论体系 |
| 10 | `features/poster/.../PosterContent.kt`（Grep 全文关键字） | 正文渲染：text/images/tags，无 EditorJS 原生解析 |
| 11 | `features/postedit/.../PostEditScreen.kt` | 发帖 UI：claim / tags / 匿名 / 公开 / 图片 |
| 12 | `features/postedit/.../PostEditViewModel.kt` | `post()` 默认值 `claimId=0` / `imageMids` / `plugins` 契约 |

**鸿蒙（`BIT101-harmony`）**

| # | 路径 | 用途 |
|---|---|---|
| 1 | `entry/src/main/ets/pages/CommunityPage.ets` | 话廊四流/搜索/写操作 UI |
| 2 | `entry/src/main/ets/pages/NotifyListPage.ets` | 通知列表/分组/未读/清空 |
| 3 | `entry/src/main/ets/pages/NotifySettingsPage.ets`（读 1–70 行） | 提醒设置/免打扰/重排 |
| 4 | `entry/src/main/ets/pages/OverlayPage.ets`（读 1–55 行） | 边界核对：课表覆盖层，非本域 |
| 5 | `entry/src/main/ets/pages/MePage.ets`（Grep 社区行） | 社区资料 / 我的帖子入口 |
| 6 | `entry/src/main/ets/service/CommunityService.ts` | 四流列表 / 我的帖子 / 举报类型 |
| 7 | `entry/src/main/ets/service/CommunityAuthService.ts` | 登录 / 401 静默刷新 / 带票据 GET+POST |
| 8 | `entry/src/main/ets/service/CommunityWriteService.ts` | 点赞/评论/发帖/举报（副作用红线） |
| 9 | `entry/src/main/ets/service/CommunityUserService.ts` | 社区资料取数 |
| 10 | `entry/src/main/ets/service/InstantNotify.ts` | 即时通知出口 + wantAgent 深链 |
| 11 | `entry/src/main/ets/service/ReminderScheduler.ts`（读 1–130 行） | 排期提醒调度 + 免打扰/深链接入 |
| 12 | `entry/src/main/ets/corelogic/CommunityLogic.ts` | 列表解析 / 搜索 / 举报类型解析 |
| 13 | `entry/src/main/ets/corelogic/CommunityWriteLogic.ts` | obj 构造 / 请求体 / 响应解析 / 三态分类 |
| 14 | `entry/src/main/ets/corelogic/NotifyRecordLogic.ts` | 通知记录合并/去重/prune/类型 |
| 15 | `entry/src/main/ets/corelogic/NotifyGroupLogic.ts` | 按天分组 / 徽标 / 清空文案 |
| 16 | `entry/src/main/ets/corelogic/NotifyReadLogic.ts` | 已读键快照 / 未读计算 |
| 17 | `entry/src/main/ets/corelogic/NotifyDeepLink.ts` | 通知深链白名单 / 键 / 包名 |
| 18 | `entry/src/main/ets/corelogic/NotifySettingsLogic.ts` | 13 项设置 / 提前量选项 |
| 19 | `entry/src/main/ets/corelogic/NotifyAdapter.ts` | 课程/DDL/考试 → 提醒输入 |
| 20 | `entry/src/main/ets/corelogic/QuietHoursLogic.ts` | 免打扰时段 / 推迟不丢弃 |
| 21 | `entry/src/main/ets/corelogic/InstantAlertLogic.ts` | 流量跨周期状态机 / 本地日期键 |
| 22 | `docs/ROADMAP.md`（Grep 社区/通知/alpha 相关行） | 进度数字与已知边界 |

**检索式（用于「未找到证据」判定）**：在 `entry/src/main/ets` 全量 Grep `getMessages|GetMessages|MessageType|separateUnread|消息中心|社区消息|互动消息|/messages|messageRepo` → **No matches found**；Grep `NotificationSlot|slotType|channel|渠道` → 仅命中无关注释，无通知渠道实现；Grep `免打扰|quiet|Quiet` 于 Android `features/notify/src` → 仅命中 1 处测试注释（`NotifyLogicTest.kt:910`），无主源码实现。

---

## 2. 功能对照表

> 状态图例：**✅** 两端均有代码证据且语义等价（**代码层对照，不代表真机验收**）；**⚠️** 有差异/单端有/契约未核；**⚫ 未找到证据**；**🚫 明确不做**（见 §5）。

### 2.1 话廊 / 社区资料

| 功能点 | Android | 鸿蒙 | 状态 | 证据(file:line) |
|---|---|---|---|---|
| 四流顺序与默认落点 | 关注/推荐/最新/最热，initialPage=1 | `COMMUNITY_MODES=['follow','recommend','latest','hot']`，`modeIndex=1` | ✅ | `ROADMAP.md:94` / `CommunityService.ts:26`、`CommunityPage.ets:33-34,347-360` |
| 四流列表取数 | `GET /posters?mode=&page=` | `list(ctx,mode,0,query)` 拼 `mode/page/search` | ✅ | `CommunityService.ts:32-43` |
| 搜索 | 服务端 `search` 参数 | 传 `search` 参数 + `searchPosts` 本地多词与过滤 | ✅ | `CommunityLogic.ts:103-114`、`CommunityService.ts:39-42,54` |
| 列表三态（未登录/失败/空） | `SimpleDataState` 三态 | `stateKind=idle/ok/needLogin/failed` 分离 | ✅ | `CommunityPage.ets:38,111-114,373-385` |
| 帖子卡片副标题（匿名隐藏） | 作者+时间 | `posterSubtitle` 匿名显示「匿名用户」 | ✅ | `CommunityLogic.ts:96-101` |
| 列表分隔线 0.5dp | 原版 PostersTabPage | `divider({strokeWidth:0.5,...})` | ✅ | `CommunityPage.ets:453-454` |
| 详情正文渲染 | 原生 `PosterContent` 渲染 text/images/tags | Web 壳，原生不解析 plugins | ⚠️ | `PosterContent.kt:370-403`、`CommunityPage.ets:398-404` |
| 社区登录 | `DefaultLoginRepo.loginBIT101` | `CommunityAuthService.login`，密码 md5 后 POST | ✅ | `CommunityAuthService.ts:71-102` |
| 401 静默刷新一次 | `DefaultAPIManager` | `getWithAuth/postWithAuth`，`attempts` 限一次 | ✅ | `CommunityAuthService.ts:117-153` |
| 社区资料（本人） | `UserViewModel.loadUser id=0` | `fetchMe` → `GET /user/info/0` | ✅ | `CommunityUserService.ts:28-49` |
| 我的帖子 | `getPostersOfUserByUid` | `listMyPosts` → `/posters?mode=search&uid=0` | ✅ | `CommunityService.ts:63-87`、`MePage.ets:218,515-570` |

### 2.2 写操作（对外副作用）

| 功能点 | Android | 鸿蒙 | 状态 | 证据(file:line) |
|---|---|---|---|---|
| 发帖请求体（纯文字） | `post()`：`claimId=0` / `imageMids` / `public`/`tags` | `postBody`：`claimId=0` / `imageMids:[]` / `plugins:'[]'` | ✅ | `PostEditViewModel.kt:153-171`、`CommunityWriteLogic.ts:115-133` |
| 发帖校验 | UI 要求标题/内容/≥2 标签 | `validatePost` 标题正文不都为空 + 长度 | ⚠️ | `PostEditScreen.kt:519-531`、`CommunityWriteLogic.ts:62-76` |
| 点赞（服务返回操作后状态） | `likePoster/likeComment`，回写 `like/likeNum` | `like(kind,id)` + `parseLikeResponse`，UI 用返回值覆盖 | ✅ | `PosterViewModel.kt:186-226`、`CommunityWriteService.ts:26-52`、`CommunityPage.ets:159-189` |
| 评论（对帖子） | `sendCommentToPoster`：text/replyUid/anonymous/images | `commentBody`：text/anonymous/`replyUid=0`/`imageMids:[]` | ⚠️ | `PosterViewModel.kt:279-307`、`CommunityPage.ets:219-236`、`CommunityWriteLogic.ts:87-104` |
| 举报（类型动态取） | `NavDest.Report("poster"/"comment",id)` + typeId | `report` + `reportTypes()` 取 `/manage/report_types`，空则禁用 | ✅ | `PosterScreen.kt:346-363`、`CommunityService.ts:89-104`、`CommunityPage.ets:434-446` |
| 评论对象写操作（赞评论/回复评论/举报评论/删评论/编辑帖） | `MoreActionOfCommentBottomSheet` 等完整体系 | 未找到证据（UI 仅有对帖子的赞/评/举报） | ⚫ | `PosterScreen.kt:276-277,339-368`、`PosterViewModel.kt:279-307,369-379` / 鸿蒙 `CommunityPage.ets:406-447` 仅 poster |
| 创作者声明 claim 选择 | `SelectClaimDialog` + `loadClaim` | 未找到证据（请求体 `claimId` 恒 0） | ⚫ | `PostEditScreen.kt:137-196,499-501` / `CommunityWriteLogic.ts:129` |
| 标签 tags 输入 | `TagEditDialog`，至少 2 个且不重复 | 未找到证据（发帖 `tags` 传 `[]`） | ⚫ | `PostEditScreen.kt:88-135,524-527` / `CommunityPage.ets:204` |
| 图片上传 | `UploadRepo.uploadImage` + `imageMids` | 未实现（明确不做） | 🚫 | `PostEditViewModel.kt:108-151` / `CommunityWriteLogic.ts:118-119` |
| 写操作副作用红线 | 用户 UI 点击触发 | 全部由 `.onClick` 触发，禁 `aboutToAppear`/定时器 | ✅ | `CommunityPage.ets:4-7,159-254`、`CommunityWriteService.ts:4-6` |

### 2.3 消息中心（社区互动消息）

| 功能点 | Android | 鸿蒙 | 状态 | 证据(file:line) |
|---|---|---|---|---|
| 消息中心页 + 4 tab（点赞/评论/关注/系统） | `MessageScreen` HorizontalPager + TabRow | 未找到证据 | ⚫ | `MessageScreen.kt:66-78,262-369` / 鸿蒙 Grep 无匹配 |
| 消息列表项（头像/昵称/动作文案/正文/时间） | `MessageItem` + `actionText`/`objLabel` | 未找到证据 | ⚫ | `MessageScreen.kt:80-97,117-191` |
| 分开未读数 + 徽标 | `getSeparateUnreadMessageCount` 四类求和 + `BadgedBox` | 未找到证据 | ⚫ | `MessageViewModel.kt:44-55,100-109`、`MessageScreen.kt:322-350` |
| 消息分页加载 | `getMessages(type,lastID)` 触底加载 | 未找到证据 | ⚫ | `MessageViewModel.kt:82-98`、`MessageScreen.kt:203-212` |
| 消息深链 | `parseTarget`：`poster{id}`/`user{id}`，FOLLOW→`fromUser` | 未找到证据 | ⚫ | `MessageScreen.kt:102-115,111-115` |
| 刷新入口 | TopAppBar 刷新按钮 | 未找到证据 | ⚫ | `MessageScreen.kt:297-304` |

### 2.4 通知（校园提醒）

| 功能点 | Android | 鸿蒙 | 状态 | 证据(file:line) |
|---|---|---|---|---|
| 排期提醒 5 类 | `ReminderKind` CLASS/DDL/SEAT_SIGN_IN/EXAM/ADJUSTMENT | `allKinds()` 同 5 类 | ✅ | `NotifyLogic.kt:28-62`、`NotifyRecordLogic.ts:151-160` |
| 排期调度机制 | WorkManager OneTime + Periodic 兜底 | `reminderAgentManager` 日历提醒 + 全量 cancelAll 重建 | ✅（平台等价） | `NotifyScheduler.kt:41-79`、`ReminderScheduler.ts:20-23,113-123` |
| 排期数据来源 | 课表/DDL/考试/教学调整 | `coursesToNotify`/`ddlsToNotify`/`examsToNotify` + 教学调整 | ✅ | `NotifyAdapter.ts:22-122`、`ReminderScheduler.ts:54-57,67` |
| 出分提醒（不含分数） | `notifyScores`，文案由 `summaryText` 保证 | `NOTIFY_ID_SCORES` + wantAgent | ✅ | `NotifyCenter.kt:48-54,242-256`、`InstantNotify.ts:26,66-85` |
| 网费/流量提醒 | `CHANNEL_NETFEE`/`CHANNEL_NETFLOW` + Checker | `NOTIFY_ID_NET_FEE/NET_FLOW` + `decideFlowState` | ✅ | `NotifyCenter.kt:56-60,264-308`、`InstantNotify.ts:27-30`、`InstantAlertLogic.ts:42-73` |
| 借阅到期提醒（不含书名） | `notifyLibDue` | `NOTIFY_ID_LIB_DUE` + `freshLibKeys` | ✅ | `NotifyCenter.kt:71-77,171-192`、`InstantNotify.ts:31-32`、`InstantAlertLogic.ts:100-120` |
| 座位违约通知 | `CHANNEL_SEAT_VIOLATION` + `notifySeatViolation` | 未找到证据（仅违约记录展示，无通知发送） | ⚫ | `NotifyCenter.kt:62-69,142-163`、`SeatViolationNotifier.kt:14-17` / 鸿蒙 Grep 无通知发送 |
| 通知渠道/优先级分级 | 9 个 `NotificationChannel` + IMPORTANCE_HIGH/DEFAULT | 无渠道概念，`publish` id + `reminderAgent` | ⚠️（平台差异） | `NotifyCenter.kt:26-85,121-135`、`InstantNotify.ts:56-65` |
| 通知历史 14 天保留 | `NotifySentStore` KEEP_DAYS | `NOTIFY_KEEP_DAYS=14` + `pruneNotifyRecords` | ✅ | `NotifySentStore.kt:17`、`NotifyRecordLogic.ts:24-25,105-119` |
| 已发不回滚（去重键只增） | `sentKeys` 只增不减 | `mergeNotifyRecords` 保留旧 `firedMillis` | ✅ | `NotifySentStore.kt:34-63`、`NotifyRecordLogic.ts:27-72` |
| 按天分组（今天/昨天/本周/更早） | 未找到证据（notify 目录无 group 实现） | `NotifyGroupLogic.groupSpans`/`labelOfDay` | ⚠️ | 鸿蒙 `NotifyGroupLogic.ts:55-70,75-100` / Android Grep 无匹配 |
| 未读快照 + tab 徽标（99+） | 未找到证据（仅 sentStore 去重） | `NotifyReadLogic` 显式键快照 + `badgeText` | ✅（语义等价） | `NotifyReadLogic.ts:112-128`、`NotifyGroupLogic.ts:117-123`、`NotifyListPage.ets:121-146` |
| 打开通知页标记已读 | `NotifyFireWorker` 发后 `sentStore.mark` | `markKeys(firedKeys(all))`，先算 unread 再标记 | ✅ | `NotifyFireWorker.kt`、`NotifyListPage.ets:127-135` |
| 清空历史二次确认 | 未找到证据 | `confirmClear` + `clearConfirmText` | ⚠️ | `NotifyListPage.ets:66-84`、`NotifyGroupLogic.ts:125-128` / Android 未找到证据 |
| 通知深链（白名单校验） | `bit101_goto` route + 页面白名单 | `bit101Page/bit101Content` + `PAGE_WHITELIST` | ✅ | `NotifyCenter.kt:87-89,310-329`、`NotifyDeepLink.ts:28-89` |
| 免打扰时段（推迟不丢弃） | 未找到证据（主源码无） | `QuietHoursLogic` 完整 + `applyQuiet` | ⚠️（鸿蒙新增） | `QuietHoursLogic.ts:1-16,98-170,220-261` / Android Grep 仅测试注释 |
| 设置项（13 项 + 提前量） | 13 项 + 提前量选项 | 13 项 + 2 项即时开关 + 3 组提前量 | ✅ | `NotifySettingsLogic.ts:17-62,59-62` |
| 改设置立即重排 | `NotifySettingViewModel.write` | 每个开关 `onClick→commit()`（save+reschedule） | ✅ | `NotifySettingsPage.ets:4-7` |
| 系统通知开关关闭时整批不排 | `runCatching` 静默放弃 | `isNotificationEnabled` 前置 + cancelAll | ✅ | `NotifyCenter.kt:230-233`、`ReminderScheduler.ts:14-18,129-131` |

---

## 3. 关键差异详述

### D1【P0】社区消息中心整体缺失（最大缺口）
Android 有完整的社区互动消息中心：`messageTypes` 四类（LIKE/COMMENT/FOLLOW/SYSTEM，`MessageScreen.kt:66-71`），HorizontalPager + TabRow（`MessageScreen.kt:272,322-366`），消息项渲染头像/昵称/动作文案/正文/时间（`MessageScreen.kt:117-191`），分开未读数求和与 tab 徽标（`MessageViewModel.kt:44-55,100-109`；`MessageScreen.kt:322-350`），触底分页（`MessageViewModel.kt:82-98`），以及 `parseTarget` 深链（`MessageScreen.kt:102-115`）。
鸿蒙端对 `entry/src/main/ets` 全量 Grep `getMessages|GetMessages|MessageType|separateUnread|消息中心|社区消息|互动消息|/messages|messageRepo` → **No matches found**。鸿蒙 `NotifyListPage` 是**本机排期提醒记录**（`NotifyListPage.ets:1-8`），并非社区互动消息，二者语义不同，不能互相顶替。

### D2【P1】写操作对象能力边界：鸿蒙只有「对帖子」的赞/评/举报
Android `PosterViewModel` 定义 `ObjectType.PosterObject/CommentObject` 与 `CommentType.ToPoster/ToComment`（`PosterViewModel.kt:57-74`），支持对评论点赞（`PosterViewModel.kt:201-219`）、对评论回复（`sendCommentToComment`，`PosterViewModel.kt:295-306`）、举报评论（`PosterScreen.kt:345-352`）、删除帖子/评论（`PosterViewModel.kt:369-379`）、编辑帖子（`PosterScreen.kt:360`）。
鸿蒙 `CommunityPage` 的三处写操作均硬编码 `'poster'`：`doLike` `CommunityWriteService.like(ctx,'poster',p.id)`（`CommunityPage.ets:166`）、`doComment`（`CommunityPage.ets:225-226`）、`doReport`（`CommunityPage.ets:244-245`）。底层 `CommunityWriteLogic` 已支持 `poster|comment` 双 kind（`CommunityWriteLogic.ts:15,21-24`），但**没有 UI 触发点**。这是「底层契约已备、上层入口缺失」，非契约错误。

### D3【P1】座位违约通知未找到证据
Android 有独立渠道 `CHANNEL_SEAT_VIOLATION`（`NotifyCenter.kt:62-69`）与发送入口 `notifySeatViolation`（`NotifyCenter.kt:142-163`），由 `SeatViolationNotifier.kt:14-17` 调用，且给 HIGH（错过签到的后果见 `NotifyCenter.kt:31-38`）。
鸿蒙端 Grep `SeatViolation|seat_violation|违约|violation` 的命中全部是**违约记录的展示与判定**（`SeatPage.ets:702-723,1374-1396`、`SeatLogic.ts:300-336`、`SeatApiLogic.ts:313-343`），**未找到任何通知发送证据**；ROADMAP 亦记为暂缓（M14-A+）。

### D4【P2】通知渠道模型为平台差异，非功能缺失
Android 用 9 个 `NotificationChannel` 并按 `IMPORTANCE_HIGH/DEFAULT` 分级（`NotifyCenter.kt:26-85,121-135`），锁屏可见性依赖渠道重要性。鸿蒙 Grep `NotificationSlot|slotType|channel|渠道` 无渠道实现，用 `notificationManager.publish` 的 4 个固定 id（`InstantNotify.ts:26-32,56-65`）与 `reminderAgentManager` 日历提醒（`ReminderScheduler.ts:26-27`）。两端「紧急提醒要弹出来」的意图一致（Android `urgent = kind != CLASS`，`NotifyCenter.kt:213-224`；鸿蒙 `applyQuiet` 推迟预算 `QuietHoursLogic.ts:189-218`），但实现载体不同，归为平台约束，不强行对齐。

### D5【超出项】免打扰为鸿蒙新增，Android 无对应实现
Android `features/notify/src` Grep `免打扰|quiet|Quiet|DoNotDisturb|silent` 仅命中 1 处测试注释（`NotifyLogicTest.kt:910`），主源码无实现。鸿蒙 `QuietHoursLogic` 完整实现跨零点窗口、`start===end` 不静默、静默期**推迟到窗口结束而非丢弃**、超预算丢弃（`QuietHoursLogic.ts:1-16,98-170,220-261`），ROADMAP M12-2 记为鸿蒙新增。此项为**鸿蒙超出**，不是缺口，不应反向裁剪。

### D6【超出/待核】通知分组与清空确认 Android 侧未找到证据
鸿蒙 `NotifyGroupLogic` 有「今天/昨天/本周早些时候/更早」按天分组（`NotifyGroupLogic.ts:55-70`）与清空二次确认文案（`NotifyGroupLogic.ts:125-128`、`NotifyListPage.ets:66-84`）。Android notify 目录无 group 实现文件，Grep 未找到证据。ROADMAP M11-2 记为对齐项，但本次在给定的 Android `features/notify/src` 材料中**未找到对应代码**，故标 ⚠️ 而非 ✅；需在 Android 全仓复核后再定。

### D7【P2】话廊分页与搜索契约未真机核对
鸿蒙 `CommunityPage.load()` 固定 `page=0`（`CommunityPage.ets:110`），无「加载更多/触底分页」；Android 消息中心有 `lastID` 分页（`MessageViewModel.kt:82-98`），帖子详情评论也有分页（`PosterViewModel.kt:113-135`）。另外 `CommunityService.ts:35-36,66-67` 两处注释明示「mode 序列化值需真机核对」「`mode=search` 的序列化值需真机核对」。本审计不做真机，故按契约待核处理。

### D8【P2】发帖字段简化：tags / claim
Android 发帖 UI 要求至少 2 个不重复标签（`PostEditScreen.kt:524-527`），并强制默认选第一个 claim（`PostEditScreen.kt:499-501`）。鸿蒙发帖面板只有标题/正文/匿名/仅自己可见（`CommunityPage.ets:307-345`），调用 `createPost(...,[])`（`CommunityPage.ets:203-204`）传空 tags，`claimId` 恒 0（`CommunityWriteLogic.ts:129`）。ROADMAP 已确认纯文字帖 `claimId=0` 可发，属**等价简化**；tags 入口缺失属体验差异，非请求契约错误。

### D9【边界】详情走 Web 壳是明确取舍，不是缺口
Android `PosterContent` 渲染的是 `data.text`（纯文本）+ `data.images` + `data.tags`（`PosterContent.kt:370-403`），并未原生解析 EditorJS `plugins`；鸿蒙 `CommunityLogic.ts:8` 与 `CommunityPage.ets:398-404` 明示详情走 Web 壳、原生不解析 plugins。两端在「正文是纯文本、富文本归 H5」上等价，属 §5 明确不做项。

---

## 4. 可执行修复清单

> ⚠️ **副作用红线**：发帖/点赞/评论/举报是对外可见的真实写操作，**必须用户本人在 UI 主动点击后触发**；新增代码不得在 `aboutToAppear`/`onPageShow`/定时器/任何自动路径调用 `CommunityWriteService`，不得为此类操作加自动重试或后台代发。验收判据均可证伪（给出可执行的检查动作与预期结果）。

| 编号 | 改动点 | 鸿蒙文件 | 验收判据（可证伪） | 风险 | 优先级 |
|---|---|---|---|---|---|
| G06-P0-1 | 新建社区消息中心页：4 tab（点赞/评论/关注/系统）+ 消息列表 + 触底分页；与通知页明确分开 | 新增 `pages/MessagePage.ets`、`service/MessageService.ts`、`corelogic/MessageLogic.ts` | 在 `entry/src/main/ets` Grep `getMessages` 能命中服务；4 个 tab 各能拉到对应 type 的列表；空态与失败态文案不同 | 只读，无副作用 | P0 |
| G06-P0-2 | 消息未读数：分开计数四类求和 + tab 徽标 + 读后清空 | `pages/MessagePage.ets`、`service/MessageService.ts` | 构造 like=1/comment=2/follow=3/system=4 时徽标总数=10；切到某 tab 后该 tab 计数归零且总数同步下降 | 只读 | P0 |
| G06-P0-3 | 消息深链：`poster{id}`→详情 Web 壳、`user{id}`→用户页、FOLLOW→`fromUser`；脏值丢弃 | 新增 `corelogic/MessageDeepLink.ts`，复用 `NotifyDeepLink` 白名单纪律 | `parseTarget('poster123')` 得到 id=123；`parseTarget('junk')` 返回空；点击消息落在对应页而非首页 | 只读 | P0 |
| G06-P1-4 | 补齐评论对象写操作入口：对评论点赞/回复/举报，obj=`comment{id}` | `pages/CommunityPage.ets`、`service/CommunityWriteService.ts`、`corelogic/CommunityWriteLogic.ts` | UI 能对一条评论触发 `like('comment',id)`，请求体 `obj` 为 `comment<id>`；**未点击时网络面板无任何写请求** | ⚠️ 点赞/评论/举报属对外副作用，必须用户本人点击触发，不进自动路径 | P1 |
| G06-P1-5 | 座位违约通知：仅在检测到新增违约记录时发一条，正文含累计次数 | `service/InstantNotify.ts`（新增 id）、`service/ServiceAlertRunner.ts` 或新增 runner | 造假数据：无违约时 0 条通知；新增 1 条违约时恰好 1 条通知且含「累计 N/5」；同键重复取数不重复发 | ⚠️ 通知可见且有去重状态，仅数据增量后触发，不自动轮询发通知 | P1 |
| G06-P2-6 | 话廊列表分页：page 递增 + 触底加载更多 | `pages/CommunityPage.ets`、`service/CommunityService.ts` | 第 2 页能追加到列表末尾；连续触底不重复请求同一 page | 只读 | P2 |
| G06-P2-7 | 搜索契约核对：`mode/search` 序列化值与服务端一致后再决定是否保留本地二次过滤 | `service/CommunityService.ts`、`corelogic/CommunityLogic.ts` | 同一 query 下服务端返回命中数与 UI 展示数一致；契约未核前不得删本地兜底 | 只读 | P2 |
| G06-P2-8 | 发帖 tags 入口（claim 维持 `claimId=0` 等价简化，不新增选择器） | `pages/CommunityPage.ets`、`corelogic/CommunityWriteLogic.ts` | 用户可添加/删除标签，`postBody.tags` 含用户所填；无点击时 `tags` 仍为 `[]` | ⚠️ 发帖属对外副作用，必须用户本人点「发布」触发 | P2 |

---

## 5. 明确不做项及原因

| # | 不做项 | 原因 | 证据 |
|---|---|---|---|
| 1 | 图片上传（发帖/评论的 `imageMids`） | H5 专属能力，用户已拍板纯文字等价；鸿蒙请求体恒 `imageMids:[]`，与 Android 纯文字帖默认值一致 | `ROADMAP.md:111`、`CommunityWriteLogic.ts:87-104,118-119` |
| 2 | H5 富文本 `plugins`/EditorJS 原生渲染 | 社区详情本身是 H5，Android 原生也只渲染纯文本 + 图片，不解析 plugins | `CommunityLogic.ts:8`、`CommunityPage.ets:398-404`、`PosterContent.kt:370-403`、`ROADMAP.md:119` |
| 3 | 帖子详情原生解析（text/images/tags 全量） | 走 Web 壳即可达到等价展示，原生重复实现无收益且易漂移 | `CommunityPage.ets:398-404`、`ROADMAP.md:119` |
| 4 | 通知渠道/重要性分级逐条对齐 | 平台差异：鸿蒙无 `NotificationChannel`/`NotificationSlot` 概念，用 `publish` id 与 `reminderAgent`；「紧急要弹」的意图已由 wantAgent 与推迟预算保证 | `NotifyCenter.kt:121-135`、`InstantNotify.ts:56-65`、`QuietHoursLogic.ts:189-218` |
| 5 | 反向裁剪鸿蒙免打扰以「对齐」Android | Android 主源码无免打扰实现，此项是鸿蒙超出，不做反向功能删减 | `QuietHoursLogic.ts:1-16` / Android Grep 仅测试注释 |
| 6 | 社区消息中心/写操作的真机代验 | 写操作与登录正路径需用户本人触发，agent 不代替点击、不碰明文密码 | `ROADMAP.md:101,111`、`CommunityPage.ets:124-154` |
| 7 | 本次跑网络/真机/构建 | 本审计红线：只读、可证伪，未找到证据即如实标注，不以「编译过」充当对齐 | 文档前言 |

---

## 6. 进度数字（仅引用 ROADMAP）

- alpha.26：话廊只读四流/搜索/详情；发帖/点赞/评论/举报（#155）当时未做；社区是 H5，详情走 Web 壳不解析 plugins（`ROADMAP.md:116-119`）。
- alpha.27：话廊写操作 #155 落地；发帖契约 `claimId=0`/`plugins="[]"`/无图；举报类型动态取 `/manage/report_types`，拿不到就禁用（`ROADMAP.md:109-114`）。
- alpha.28：四流顺序改「关注/推荐/最新/最热」+ 默认落推荐（`ROADMAP.md:94`）。
- alpha.29→31：真机验证第一批；话廊写操作正路径未点（会真发到社区，agent 不代发）；通知分组切换真生效、无通知数据时清空/已读未触发（`ROADMAP.md:83-106`）。
- 全量 84/84 套件 3864 断言绿 + assembleHap BUILD SUCCESSFUL（versionCode 33）（`ROADMAP.md:72`）。
- M7 通知中心进度表：5 项计划、0 项完成外推、5 项标完成、`0%` 真机验收（逻辑与管道全完，欠真机；代理提醒本机被禁）（`ROADMAP.md:855`）。
- M11-2 通知分组/未读/清空、M11-3 通知点击深链均标代码完成（`ROADMAP.md:497-498`）；M12-2 通知免打扰时段（`ROADMAP.md:140`）。
- M14-A+ 座位违约通知标「⬜ 暂缓：后端不可验，不靠推理接线」（`ROADMAP.md:539`）。

> 说明：以上 ✅ 判定为**代码层静态对照**，不等同真机验收；ROADMAP 多处标注「真机未验」，本文不因其为 ✅ 而升级为已验收。

---

v1.0 / 2026-11-24

---

## 修复进度登记（2026-11-27，v1.0 审计内容不改动）

| 编号 | 状态 | 证据 |
|---|---|---|
| G06-P0-3 (消息深链) | ⚠️ 解析逻辑完成 + 静态绿，**点击落点真机待验** | commit `c03d959`（alpha.54/versionCode 54）；`MessageDeepLink.ts` 逐条对齐 A:MessageScreen.kt:101-114（linkObj>obj>FOLLOW 顺序、只认 poster/user+正整数、脏值丢弃）；`pageOfTarget` 落点页在 main_pages 白名单；`test-messagedeelink` 26 断言 + 优先级拆红-恢复 `evidence/g06-deeplink-20261127/`；全测 98/98、4354 断言 EXITCODE:0；hvigor BUILD SUCCESSFUL；装机 `bm dump`=54、MD5 `B72B84E014804859E31B878790000AE7`。真机：消息中心页(P0-1/2)未做，无消息数据可点验 |
| G06-P0-1/2 (消息中心页+未读数) | ❌ 未做（下一步） | 依赖消息接口 `getMessages` 4 类列表，当前账号无消息数据风险（同成绩接口空数组），留待有数据时真机验 |

> G06-P0-3 不判 ✅（G5 未签字）；派生成果为纯逻辑层，待消息中心页落地后接线并真机验。

*v1.1 进度登记 / 2026-11-27*
