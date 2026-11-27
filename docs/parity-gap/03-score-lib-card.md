# BIT-102  parity 差距 · 域 03「成绩 / 图书馆 / 一卡通」

> 审计员：gap03-score-lib　｜　只读审计：未改任何源码、未做 git 提交、未做网络/真机/构建。
> 判据纪律：状态列用 ✅ 表示**两端均有且语义对齐**；⚠️ 表示**缺失/口径冲突/实现不同**（绝不写成 ✅）；
> 「未找到证据」= 在本次读取范围内确实没读到对应实现（不等于业务上一定没有）。
> 所有判断均附 `file:line`；进度数字只引用 `docs/ROADMAP.md`，不自行推算。

---

## ⚠️ 头号发现：任务口径背景与代码事实相反（需 lead 澄清后再定修复方向）

任务背景写的是「**鸿蒙**成绩按教务处红头文件（不及格计入分母、逐课绩点 half-up 到 0.1），与 BIT101 网页版有意分叉」。
本次逐行读码的事实是——**该红头文件口径实现在 Android 端，鸿蒙端明确不算 GPA**：

- Android `BIT101-seat/data/.../data/score/ScoreTable.kt:27-47`：类注释标题即「GPA 公式：按 教〔2022〕16号 走，**不跟网页版走**」；
  - `X < 60 ⇒ 课程绩点记为 0` 但学分照进分母（:32, :36, :351-353）；
  - 逐课绩点四舍五入到 1 位小数，`round1 = floor(x*10 + 0.5)/10`（:311-329），即 **half-up**（:313-322 明确禁用 `kotlin.math.round` 的银行家舍入）；
  - 「网页版把 `成绩==0` 整门剔除 ⇒ 不及格不进分母、绩点虚高，且没有逐课舍入」，实测 85分/3学分 + 45分/4学分 → 文件口径 **1.5429** vs 网页版 **3.5781**（:40-44）。
- 鸿蒙 `BIT101-harmony/.../corelogic/ScoreSummaryLogic.ts:9-16`：开头「能算的与**故意不算**」——
  - 「**不算 GPA / 加权绩点**：绩点换算表各院系不同，原始表里也没有绩点列。没有数据源就不造数字」（:11-12）；
  - 「**不算及格率**」「等级制分数不进数字分档」（:13-14）。
- 鸿蒙 `corelogic/ScoreLogic.ts:22-34`：`ScoreEntry` 只有 `course/score/term/credit`，无绩点/均分字段；`ScorePage.ets:18` 页头「只讲条数，不讲平均分/GPA（没有契约依据，不编造）」。

**结论**：口径分叉的主体是 Android（`ScoreTable.kt`），鸿蒙当前**没有**任何 GPA/绩点计算。
若 lead 的意图是「鸿蒙也应按红头文件算 GPA」，则这是 **P0 功能缺口**（见修复清单 G-01~G-03）；
若意图是「鸿蒙有意不算、保持现状」，则背景描述需更正。本文按「代码事实」记录，不按背景描述美化。

---

## 1. 域范围与实际读过的文件

### 1.1 域范围
成绩查询与出分提醒、图书馆借阅与到期提醒、一卡通余额与登录链，以及三者共享的 CAS 会话下沉 / 自动重登 / 本地缓存策略。

### 1.2 实际读过的文件（均为源码目录，已排除 build/ 产物）

**Android（`F:/Agent_Work/BIT-102/BIT101-seat/`，grep 定位后逐行读）**

| 子系统 | 文件 |
|---|---|
| 成绩 | `data/.../data/score/ScoreTable.kt`（1-90, 300-369）、`ScoreCsv.kt`、`ScoreCachePolicy.kt`、`ScoreQueryLogic.kt` |
| 成绩 repo/提醒 | `data/.../data/repo/DefaultScoreRepo.kt`（1-120）、`features/notify/.../ScoreNotifyChecker.kt`、`NotifyRefreshWorker.kt` |
| 成绩 UI | `features/user/.../page/ScorePage.kt`（60-90, 285-340 + grep 命中 115-129/148-149/195-246/276-279）、`ScoreViewModel.kt`（grep 命中） |
| 图书馆 | `data/.../data/repo/DefaultLibBorrowRepo.kt`、`data/.../data/school/LibBorrowLogic.kt`（grep 命中）、`features/notify/.../LibBorrowChecker.kt` |
| 一卡通 | `data/.../data/repo/DefaultCampusCardRepo.kt`、`data/.../data/school/CampusCardBalanceLogic.kt`（grep 命中）、`features/user/.../CampusServiceViewModel.kt`（grep 命中） |
| 会话 | `data/.../data/net/WebViewCookieSync.kt`（1-60）、`data/.../data/repo/DefaultLoginRepo.kt`（grep 命中 checkLogin/doOperationRequiresLogin） |
| 背景 | `docs/school-portal-map.md`、`docs/next-round-plan.md`、`CHANGES.md`（grep 命中：C2 GPA 趋势「用户 2026-10-10 明确：不做」） |

**鸿蒙（`F:/Agent_Work/BIT-102/harmony/BIT101-harmony/`，`entry/src/main/ets/` 下）**

| 子系统 | 文件 |
|---|---|
| 页面 | `pages/ScorePage.ets`、`pages/LibBorrowPage.ets`、`pages/LibLoginPage.ets`、`pages/CardPage.ets`、`pages/CardLoginPage.ets`（均全文） |
| 服务 | `service/ScoreService.ts`、`ScoreCheckRunner.ts`、`LibBorrowService.ts`、`CampusCardService.ts`、`ServiceAlertRunner.ts`、`SsoCookieBroker.ts`、`AutoReloginService.ts`、`CasLoginService.ts`（1-55） |
| 核心逻辑 | `corelogic/ScoreLogic.ts`、`ScoreSummaryLogic.ts`、`ScoreQueryLogic.ts`、`ScoreStoreLogic.ts`、`ScoreFlowLogic.ts`（1-85）、`LibBorrowLogic.ts`（1-75）、`CampusCardBalanceLogic.ts`（1-70）、`CampusCardLogic.ts`（grep 命中） |
| 基础设施 | `core/net/CookieJars.ts`（1-55）、`entryability/EntryAbility.ets`（grep 命中 :63 autoOnStart）、`data/ScoreStore.ts`（grep 命中 :8） |
| 进度背景 | `docs/ROADMAP.md`（:3, :100-107, :347, :349, :355, :363, :419, :421） |

---

## 2. 功能对照表

> 证据列格式：`file:line`。A=Android `BIT101-seat/...`，H=鸿蒙 `BIT101-harmony/...`（省略共同前缀时见 §1.2）。

### 2.1 成绩

| 功能点 | Android | 鸿蒙 | 状态 | 证据(file:line) |
|---|---|---|---|---|
| 成绩取数：认证主机异步挑战三步（起挑战→轮询 jwb 就绪→Bearer 取数） | DefaultScoreRepo 走三步，认证主机 | ScoreService 完全同构，含 200 直给与 202 挑战两分支 | ✅ | A:`DefaultScoreRepo.kt:26-30`；H:`ScoreService.ts:5-10,113-185` |
| 轮询参数 400ms×25 / 12h 检查闸门 | 400ms、25 次、12h | 同值 | ✅ | A:`ScoreQueryLogic.kt:17,20,29`；H:`ScoreQueryLogic.ts:13,16,25` |
| 失败分类：密码错(auth_failed)/短信(need_sms)/过期(expired)文案分开 | isRejected/needsSms/isExpired + 「重试无效，改密码」 | 同构 isRejected/needsSms/isExpired + humanReason | ✅ | A:`ScoreQueryLogic.kt:43-63`；H:`ScoreQueryLogic.ts:40-68`、`ScorePage.ets:228-245` |
| 成绩表解析：按列名取值、16列表头排除词、找不到列返回空 | 按列名 + SCORE_EXCLUDE | 按关键词优先级 + COURSE_EXCLUDE，同构 | ✅ | A:`ScoreTable.kt:16-25,52-88`；H:`ScoreLogic.ts:44-50,105-134` |
| 出分差分：首次只建基线 / 改分不提醒 / 通知不含分数 | summaryText 单测锁死无分数 | diff + summaryText 同构 | ✅ | A:`DefaultScoreRepo.kt:44-48`、`ScoreNotifyChecker.kt:18-21`；H:`ScoreCheckRunner.ts:5-13,124-130`、`ScoreLogic.ts:210-226,239-262` |
| 12h 闸门 + 取数前写时间戳 + 失败不清基线 + 空表不写基线 | 同构纪律 | 逐条对照，见 H 注释表 | ✅ | A:`ScoreQueryLogic.kt:29`；H:`ScoreCheckRunner.ts:8-13,80-106` |
| 30 分钟缓存窗口 + 空表不覆盖非空缓存 | FRESH_MS=30min；merge 守旧缓存 | TTL=30min；空表不写缓存/基线 | ✅ | A:`ScoreCachePolicy.kt:27-28,64-86`；H:`ScoreStoreLogic.ts:17-18`、`ScoreCheckRunner.ts:101-106` |
| 学分合计 / 分数分档展示 | 有（ScoreTable 统计） | creditSummary / buckets 1:1 能力 | ✅ | A:`ScoreTable.kt`（grep 命中统计）；H:`ScoreSummaryLogic.ts:132-185`、`ScorePage.ets:107-117` |
| opt-in 凭据保存（勾「记住」才存系统密钥库） | 登录态凭据由 LoginStatus 管理 | ScoreCredentialStore，勾选才 save | ✅ | A:`DefaultLoginRepo.kt`（grep 命中）；H:`ScorePage.ets:262-263`、`ScoreCredentialStore.ts`（grep 命中） |
| 出分自动检查开关（总开关 + scoreEnabled） | scoreNotifyEnabled 开关 | autoOnStart 双开关判据 | ✅ | A:`ScoreNotifyChecker.kt:32`；H:`ScoreCheckRunner.ts:159-168` |
| 凭据学号日志脱敏 | 已有 PiiRedact | BitLog.mask + redactPii | ✅ | A:`PiiRedact.kt`（grep 命中）；H:`ROADMAP.md:523` |
| **加权 GPA（红头文件口径）**：不及格计 0 分但学分进分母、逐课绩点 half-up 到 0.1、重修取最高 | `ScoreTable.kt` 完整实现：`gpaOf`/`round1`、五级制、跨学期去重取最高 | **未找到证据**；明确「不算 GPA/绩点」 | ⚠️ | A:`ScoreTable.kt:27-47,311-367,191`；H:`ScoreSummaryLogic.ts:9-16`、`ScoreLogic.ts:22-34` |
| **加权均分** | ScorePage 显示加权均分 | **未找到证据**（明确不算） | ⚠️ | A:`ScorePage.kt:71-72`；H:`ScoreSummaryLogic.ts:11` |
| **计算口径弹窗 FormulaDialog**（红头文件 + 为何与网页版不同） | 独立 Dialog，逐条列公式与例外 | **未找到证据**（ScorePage.ets 全文无） | ⚠️ | A:`ScorePage.kt:285-340` |
| **CSV 导出**（8 列 + BOM + CRLF + RFC4180 转义 + 系统另存为） | ScoreCsv.of + CreateDocument 导出按钮 | **未找到证据** | ⚠️ | A:`ScoreCsv.kt:20-67`、`ScorePage.kt:115-129,148-149,276-279` |
| 校公选课不及格不计入绩点 | 按课程性质整门剔除（唯一剔除项） | **未找到证据**（无课程性质列语义） | ⚠️ | A:`ScoreTable.kt:37,125-129` |
| 缺考/旷考/作弊按 0 分、缓考跳过 | ZERO_MARKERS + 缓考不在列 | **未找到证据** | ⚠️ | A:`ScoreTable.kt:300-308` |
| 成绩筛选：学期 / 课程性质 / 关键词 | onToggleTerm / onToggleType / onKeyword 三类 | 仅课名筛选 `filter` | ⚠️ | A:`ScorePage.kt:83-86`；H:`ScorePage.ets:66,396-403` |
| 出分检查触发：App 启动 + **每日周期任务** | NotifyAppStartup + NotifyRefreshWorker 挂出分检查 | 仅冷启动 autoOnStart + 用户手动 force；周期任务挂载**未找到证据** | ⚠️ | A:`ScoreNotifyChecker.kt:12-14`、`NotifyRefreshWorker.kt:36-37`；H:`EntryAbility.ets:63`、`ScoreCheckRunner.ts:57,159` |
| 空表给用户看的说明文案（EMPTY_TABLE_NOTE） | 「教务这次一门都没返回（多半没评教），没覆盖上次」 | 空表分支静默记 OK(0)，无同级提示文案 | ⚠️ | A:`ScoreCachePolicy.kt:30-32`；H:`ScoreCheckRunner.ts:101-106` |

### 2.2 图书馆

| 功能点 | Android | 鸿蒙 | 状态 | 证据(file:line) |
|---|---|---|---|---|
| 借阅四步顺序：同步 cookie → user-info 判登录 → sversion → data 解析 | 严格顺序，注释「别调换」 | 1:1 同序 | ✅ | A:`DefaultLibBorrowRepo.kt:20-28,76-102`；H:`LibBorrowService.ts:7-13,196-258` |
| 三态分离：未登录 / 取不到 / 确实没有（绝不显示 0 本） | LoggedOut/Failed/Ok | loggedOut/failed/ok + UI 三态 | ✅ | A:`DefaultLibBorrowRepo.kt:82-96`；H:`LibBorrowService.ts:69-76`、`LibBorrowPage.ets:185-207` |
| 当前在借 / 历史借阅两栏 | fetchCurrent / fetchHistory（history appId 纯展示） | 同构，两栏 | ✅ | A:`DefaultLibBorrowRepo.kt:72-74`；H:`LibBorrowService.ts:79-87`、`LibBorrowPage.ets:146-167` |
| sversion 兜底值 20260928388 | FALLBACK_SVERSION | 同值 | ✅ | A:`DefaultLibBorrowRepo.kt:44`；H:`LibBorrowService.ts:56` |
| Web 页登录 + cookie 抽入业务罐 | WebViewCookieSync.sync(listOf(PAGE_URL, LOGIN_URL)) | LibLoginPage Web CAS + fetchCookie 抽两主机入 JAR_LIB | ✅ | A:`DefaultLibBorrowRepo.kt:50-55`；H:`LibLoginPage.ets:31-67,104-117`、`LibBorrowService.ts:98-150` |
| 到期/逾期即时提醒：应还前 3 天、各记录一次、正文不含书名 | 只 Ok 才判；通知 3 次纪律 | checkLib 只 ok 判；noticeBody 锁死不含书名；按书键去重 | ✅ | A:`LibBorrowChecker.kt:12-29,38-66`；H:`ServiceAlertRunner.ts:128-169`、`LibBorrowLogic.ts:11-13,34` |
| 会话失效时的 CAS 总钥匙 bootstrap + opt-in 自动重登 | 未找到证据（repo 仅 WebViewCookieSync，无 renew 接线） | bootstrapFromSso + AutoReloginService.renew 自动重试 | ⚠️ | A:`DefaultLibBorrowRepo.kt:76-109`（全文件无 renew）；H:`LibBorrowService.ts:203-225,172-188` |

### 2.3 一卡通

| 功能点 | Android | 鸿蒙 | 状态 | 证据(file:line) |
|---|---|---|---|---|
| 首页抓取：跟随重定向后按**最终 URL 主机**判登录（不看状态码） | OkHttp resp.request.url → CampusCardLogic.parse | autoRedirect=true → finalUrl → parse | ✅ | A:`DefaultCampusCardRepo.kt:42-59`；H:`CampusCardService.ts:12-17,45-71` |
| 失败 ≠ 未登录三态（单列 failed:true） | 请求失败单独一路 | failed/loggedIn/none/ok 四态 | ✅ | A:`DefaultCampusCardRepo.kt:56-58`；H:`CardPage.ets:41-47,127-153` |
| 余额趋势：今日/近 N 天、7 天窗口、样本不足如实降级、同日同额合并 | CampusCardBalanceLogic + ViewModel | 1:1 移植，注入 DayOf 显时区 | ✅ | A:`CampusServiceViewModel.kt:168,232`；H:`CampusCardBalanceLogic.ts:2,12-17,53-63` |
| 余额采样只记「已登录且解析出金额」 | 有此纪律 | parsedAmount() 后才 record | ✅ | A:`CampusServiceViewModel.kt:232`；H:`CardPage.ets:59-80` |
| 消费流水/明细 | 不做（学校仅在 i北理钉钉提供） | 明确不做，不伪造 | ✅ | H:`CardPage.ets:169-176`；A:`ROADMAP` 对应不做项（H:`ROADMAP.md:267`） |
| Web 页登录 + cookie 同步（dkykt 主机） | sync(listOf(HOME_URL)) | CardLoginPage + fetchCookie 入 JAR_CARD | ✅ | A:`DefaultCampusCardRepo.kt:38-40`；H:`CardLoginPage.ets:31-72`、`CampusCardService.ts:81-125` |
| 会话失效 CAS 总钥匙 seed + opt-in 自动重登 | 未找到证据 | SsoCookieBroker.seed + AutoReloginService.renew | ⚠️ | A:`DefaultCampusCardRepo.kt:42-70`（无 renew）；H:`CampusCardService.ts:56-63,130-137` |
| 显式「清除会话」入口 | 未找到独立入口（走全局登出） | CardLoginPage.clearSession 独立按钮 | ⚠️ | H:`CardLoginPage.ets:74-81,117-121` |

### 2.4 会话下沉 / 自动重登 / 缓存（三者横向）

| 功能点 | Android | 鸿蒙 | 状态 | 证据(file:line) |
|---|---|---|---|---|
| 自动重登编排：opt-in 凭据、短信停手、密码错清凭据、10min 闸门/8h 冻结、进程级去重、成功仅返回 renewed | DefaultLoginRepo.checkLogin / doOperationRequiresLogin | AutoReloginService 逐条对齐 | ✅ | A:`DefaultLoginRepo.kt:66,405`；H:`AutoReloginService.ts:1-16,37-88` |
| 成绩链路不接 CAS 自动重登（走账密异步挑战） | 成绩走账密挑战 | ScoreService 走账密，不调 renew | ✅ | A:`DefaultScoreRepo.kt:26-30`；H:`ScoreService.ts:91-219` |
| CAS 会话下沉：只复制 CAS 域进业务罐，防跨子系统串罐 | 全局共用单一 CookieManager，「学校域会话在登录/座位/eclass 互通」 | 分罐 JAR_LIB/JAR_CARD/JAR_CAS/JAR_LOGIN + SsoCookieBroker 只下沉 CAS 域 | ⚠️ | A:`WebViewCookieSync.kt:18-26`；H:`CookieJars.ts:11-39`、`SsoCookieBroker.ts:2-11,25-40` |
| Cookie 隔离粒度 | 全 App 一份全局 cookieManager | 8 个独立罐，每子系统一罐 | ⚠️ | A:`WebViewCookieSync.kt:22-26`；H:`CookieJars.ts:11-53` |
| 成绩本地存储形状（快照 `课程\|学期→分数`） | filesDir/score_snapshot.json | Prefs `score_snapshot_v1`，同形状 | ✅ | A:`DefaultScoreRepo.kt:38-42`；H:`ScoreStore.ts:8`、`ScoreStoreLogic.ts:108-141` |

---

## 3. 关键差异详述

### 3.1 成绩计算口径 / GPA / CSV 导出 / 出分提醒

**（1）GPA 口径冲突（⚠️ P0，见 §1 头号发现）**
- Android 是完整实现：`ScoreTable.kt` 按红头文件算绩点（:27-47）；`gpaOf()`（:360-367）对百分制 `4 - 3×(100-X)²/1600`、X<60 记 0；`round1()`（:329）做 half-up；五级制映射优秀 4.0/良好 3.6/中等 2.8/及格 1.7/不及格 0（:34, :290）；缺考/旷考/作弊/无效按 0 分、缓考跳过（:300-308）；跨学期同课取最高（:38, :191）；校公选不及格整门剔除（:37, :125-129）。`ScorePage.kt:71-72` 声称「与官方 Web/iOS 逐条对齐」（此处「官方 Web」指 `Score.vue` 之外的口径依据，注释明确与 BIT101 **网页版**分叉）。
- 鸿蒙**完全没有**这些：`ScoreEntry` 无绩点字段（`ScoreLogic.ts:22-34`），`ScoreSummaryLogic.ts:9-16` 把 GPA/均分/及格率都列为「故意不算」，`ScorePage.ets:18` 页头只报条数。
- 可证伪判据：用 85分/3学分 + 45分/4学分，Android 应得 GPA≈1.5429（:43）；若鸿蒙页面能显示任何 GPA，即为口径事实变更——当前按 `ScoreSummaryLogic.ts:11` 文本可判定「无」。

**（2）CSV 导出（⚠️ P0）**
- Android：`ScoreCsv.of()` 拼 8 列（课程名称,成绩,平均分,学分,班级占,专业占,开课学期,课程性质），带 UTF-8 BOM + CRLF + RFC4180 转义（:23-66）；`ScorePage.kt:115-129` 用 `CreateDocument("text/csv")` 走系统另存为，按钮 :148-149，文件名 `成绩-<stamp>.csv` :276-279。
- 鸿蒙：`ScorePage.ets` 全文未找到任何导出入口/CSV 拼装——**未找到证据**。

**（3）计算口径弹窗（⚠️ P0）**
- Android `FormulaDialog`（`ScorePage.kt:285-340`）主动解释「我们的绩点故意跟网页版不一样，能差 2.0」，把依据与例外写给用户。
- 鸿蒙未找到；`ROADMAP.md:102` 曾记「口径弹窗/CSV 在查询结果页，无数据未触发」——但本次读 `ScorePage.ets` 全文并无这两个能力，说明该 ROADMAP 记录与当前代码不符（记录时点差异或指 Android），保守写「未找到证据」。

**（4）出分提醒（✅ 核心对齐，⚠️ 触发面略窄）**
- 编排纪律两端一致：12h 闸门（取数前判）、时间戳取数前写、失败不清基线、空表不写基线、通知不含分数、首次只建基线（`ScoreCheckRunner.ts:5-13` vs `DefaultScoreRepo.kt:44-48`）。
- 差异：Android 在 App 启动**之外**还把出分检查挂到每日周期任务 `NotifyRefreshWorker.kt:36-37`（「一周不开 App 期间出的分照样能报」）；鸿蒙仅在 `EntryAbility.ets:63` 冷启动 + 用户在成绩页手动查询（`ScoreCheckRunner.ts:57,159`），**未找到**周期任务挂载出分检查的证据。

### 3.2 图书馆借阅与即时提醒

- 抓取链 1:1：`LibBorrowService.ts:4` 自述「1:1 对照 Android DefaultLibBorrowRepo」；四步顺序（:7-13）、兜底 sversion（:56）、三态分离（:69-76）全部对齐。可证伪点：未登录时 user-info 仍返 200 且 div 里是 `checkHasData([])`，两端都靠 user-info 判登录避免误报「0 本」（A:`DefaultLibBorrowRepo.kt:22-26`；H:`LibBorrowService.ts:9-11,200-213`）。
- 到期提醒 1:1：应还前 3 天 + 逾期、每书一次、正文不含书名（锁屏隐私）；鸿蒙 `ServiceAlertRunner.checkLib`（:128-169）严格只在 `current.kind==='ok'` 时调用（`LibBorrowPage.ets:107-110`），与 Android「只 Ok 才判」一致（:17-20）。「首次不建基线」纪律两端都**故意不套用**（当前事实型提醒）——A:`LibBorrowChecker.kt:24-29`；H:`ServiceAlertRunner.ts:153` 注释。
- 鸿蒙增强（⚠️，非缺失）：无独立会话时先 `bootstrapFromSso` 走 CAS 总钥匙，仍失败则 `AutoReloginService.renew` 静默重登并重试（`LibBorrowService.ts:203-225`）；Android repo 中**未找到**对应 renew 接线。属鸿蒙多做的部分，不列为差距，但需在真机确认不会撞风控。

### 3.3 一卡通余额与登录链

- 登录判据两端都用「最终 URL 主机」而非状态码：Android `resp.request.url`（`DefaultCampusCardRepo.kt:52`），鸿蒙 `finalUrl`（`CampusCardService.ts:53`，`autoRedirect=true` 见 :12-17）。
- 失败≠未登录三态（A:`DefaultCampusCardRepo.kt:56-58`；H:`CardPage.ets:41-47,127-153`）、趋势 7 天窗口/样本不足降级（H:`CampusCardBalanceLogic.ts:12-17,53-63`）、消费流水不做（H:`CardPage.ets:169-176`）均对齐。
- 鸿蒙增强（⚠️）：`SsoCookieBroker.seed(JAR_CARD)` + `AutoReloginService.renew`（`CampusCardService.ts:56-63,133`），Android repo 未找到对应接线。
- 鸿蒙独有「清除会话」按钮（`CardLoginPage.ets:74-81`），Android 未找到独立入口。

### 3.4 三者会话下沉与自动重登接线

- **架构差异（⚠️）**：Android 全 App 一份全局 `CookieManager`，学校域会话在登录/座位/eclass/图书馆/一卡通之间天然互通（`WebViewCookieSync.kt:22-26`）；鸿蒙改为 8 个独立罐（`CookieJars.ts:11-53`），用 `SsoCookieBroker` 只把 CAS 域 cookie 定向复制进 JAR_LIB/JAR_CARD/JAR_CAS，明确「只复制 CAS 域，不复制业务 cookie，防串罐」（`SsoCookieBroker.ts:2-11`）。
- **重登编排（✅ 语义对齐）**：`AutoReloginService.ts:1-16` 自述对齐 `DefaultLoginRepo.checkLogin + doOperationRequiresLogin`，红线一致（opt-in、短信停手、密码错清凭据、10min/8h 节流、进程级单例去重、成功只返回 renewed 由调用方重试）。
- **接线差异（⚠️）**：鸿蒙把自动重登接到了图书馆（`LibBorrowService.ts:217`）与一卡通（`CampusCardService.ts:58`）两条业务链；成绩走账密异步挑战不接（合理）。Android 侧这两个 repo 未找到 renew 接线。
- 可证伪点：失败/未存凭据/需短信时，鸿蒙返回 `loggedOut` 并如实带原因，不显示「0 本」（`LibBorrowService.ts:214-228`）——真机可用无凭据账号验证不会凭空登录。

### 3.5 缓存策略

| 维度 | Android | 鸿蒙 | 判据 |
|---|---|---|---|
| 成绩表 TTL | 30min（`ScoreCachePolicy.kt:28`） | 30min（`ScoreStoreLogic.ts:18`） | ✅ |
| 空表处理 | 落盘但守住旧非空缓存 + 提示（:64-86） | 空表不写缓存/基线，记 OK(0)（`ScoreCheckRunner.ts:101-106`） | ⚠️ 空表提示文案缺失 |
| 出分基线 | filesDir/score_snapshot.json（:40） | Prefs score_snapshot_v1（`ScoreStore.ts:8`） | ✅ 形状同 |
| Cookie 存储 | 全局 CookieManager（系统管理） | 独立罐 + 落盘快照（LibCookieStore/CardCookieStore，grep 命中） | ⚠️ 粒度不同 |
| 成绩数据脱敏 | PiiRedact | redactPii + BitLog.mask（`ROADMAP.md:523`） | ✅ |

---

## 4. 可执行修复清单

> 验收判据均可证伪（给出可观察的文件/行状态或输入输出），风险如实标注，优先级 P0/P1/P2。
> 「不做项」另计：消费流水（两端一致不做，H:`CardPage.ets:169-176`）、鸿蒙 GPA/均分若 lead 确认「有意不算」则属不做项（H:`ScoreSummaryLogic.ts:9-16`）。

| 编号 | 改动点 | 鸿蒙文件 | 验收判据（可证伪） | 风险 | 优先级 |
|---|---|---|---|---|---|
| G-01 | 移植 Android `ScoreTable` 的 GPA 口径：按列名解析出课程性质/编号/平均分，算绩点（X<60 记0但学分进分母、逐课 half-up 到0.1）、五级制映射、缺考等 ZERO_MARKERS、缓考跳过、重修取最高、校公选不及格剔除 | 新增 `corelogic/ScoreGpaLogic.ts`；改 `corelogic/ScoreLogic.ts` 的 `ScoreEntry`（增列）、`ScorePage.ets` | 给定 85分/3学分+45分/4学分，函数输出 GPA≈1.5429（对齐 A:`ScoreTable.kt:43`）；80分→3.3 而非 3.2（half-up 判据 A:`ScoreTable.kt:315`）；无课程性质列时返回 null 不猜 | 高：与既有「不算 GPA」决定冲突（H:`ScoreSummaryLogic.ts:11`），须 lead 先确认；绩点口径影响保研/评奖，错算有用户影响 | P0 |
| G-02 | CSV 导出：8 列 + BOM + CRLF + RFC4180 转义 + 系统另存为 | 新增 `corelogic/ScoreCsv.ts`；改 `pages/ScorePage.ets` 顶栏加导出按钮 | 课名含逗号「高数,习题课」时导出行被引号包裹且打开不错列（A:`ScoreCsv.kt:54-65` 同判据）；导出文件头 8 列中文、UTF-8 BOM 开头 | 中：ArkTS 文件另存为 API 需选（CreateDocument 无直接对应），需确认可用能力 | P0 |
| G-03 | 计算口径弹窗：展示教〔2022〕16号依据、GPA 公式、为何与网页版不同 | 改 `pages/ScorePage.ets`（参照 FormulaDialog） | 成绩页存在可点开的口径说明，文案含「不及格按0绩点但学分进分母」「与网页版差2.0」关键词（对齐 A:`ScorePage.kt:303-333`） | 低：纯 UI；但须与 G-01 口径一致，口径未定会误导 | P0 |
| G-04 | 成绩筛选补「学期 / 课程性质」两维（现仅课名） | 改 `pages/ScorePage.ets`、`corelogic/ScoreFlowLogic.ts`（groupByTerm 复用） | 筛选后空态可「清空筛选」退出的路径存在（A:`ScorePage.kt:195-246` 曾踩筛选条消失坑） | 低：依赖 G-01 解析出课程性质列 | P1 |
| G-05 | 出分检查挂到鸿蒙周期任务（对齐 Android 每日任务兜底） | 改 `service/ScoreCheckRunner.ts`、`service/ReminderScheduler.ts` | 冷启动外有第二条周期触发路径调用 `check(false,true)`；一周不打开仍能检查的判据在代码可见 | 中：鸿蒙无 WorkManager，需评估后台唤醒限制（`ReminderScheduler.ts:5` 自述用 reminderAgent 兜底） | P1 |
| G-06 | 空表提示文案对齐 EMPTY_TABLE_NOTE | 改 `service/ScoreCheckRunner.ts:101-106`、`pages/ScorePage.ets` | 空表分支返回带文案状态，页面显示「教务这次一门都没返回…没覆盖上次」（A:`ScoreCachePolicy.kt:30-32`） | 低 | P2 |
| L-01 | 图书馆 CAS bootstrap + renew 接线补真机验证（代码已有） | `service/LibBorrowService.ts:203-225` | 用过期 CAS 会话账号运行：日志出现 `lib renew ok` 或如实 `loggedOut`，绝不出现「0 本」；需活会话+本人凭据 | 中：自动重登撞风控风险，铁律 0.6 已限制仅确认失效后触发 | P1 |
| C-01 | 一卡通 CAS seed + renew 接线补真机验证（代码已有） | `service/CampusCardService.ts:56-63,133` | 会话失效账号运行：返回 `loggedIn` 或如实 failed，不误报未登录；清除会话按钮可重置（`CardLoginPage.ets:74-81`） | 中：同 L-01 | P1 |
| S-01 | 补充「分罐 + CAS 定向下沉 vs Android 全局单罐」的等价性说明与守卫测试 | `service/SsoCookieBroker.ts`、`core/net/CookieJars.ts` | 单测断言：下沉只含 sso/login 域，JAR_LIB/JAR_CARD 无业务域串入（`ROADMAP.md:71` 同款守卫） | 低 | P2 |

**P0 编号列表：G-01、G-02、G-03。**

---

## 5. 未验项与环境限制（如实标注）

1. **成绩接口对该账号返 `[]`**：`ROADMAP.md:102` 明记「已知成绩接口对该账号返 `[]`，未验」；本次审计不做网络/真机，成绩取数正路径、口径弹窗/CSV（如存在）的真实触发均**未验**。任何「成绩页能正常显示」的结论都不成立。
2. **需活 JWT / 活学校会话**：一卡通、图书馆的登录后取数链（`CampusCardService.fetchSnapshot`、`LibBorrowService.fetch`）依赖真实 CAS 会话；`ROADMAP.md:153` 真机曾验「图书馆独立会话有效、一卡通 CAS 失效时如实显示未登录」，但本次无真机、无活会话，不能复现。
3. **⚠️ 口径背景冲突未解**：任务背景称鸿蒙按红头文件算 GPA，代码事实相反（§1）。在 lead 澄清前，G-01 的修复方向（移植 vs 维持不算）**不可定案**。
4. **不做项**：消费流水（两端一致不做，`CardPage.ets:169-176`）；鸿蒙 GPA/均分若确认为「有意不算」（`ScoreSummaryLogic.ts:9-16`）则不计入差距，仅计 1 项不做。
5. **构建/单测状态**：本次未运行任何构建或测试。`ROADMAP.md:3` 记全量 `94/94 套件 4091 断言绿`、`:419/:421` 记 M5-1/M5-3「代码完成待真机」——这些是 ROADMAP 既有记录，本次**未复验**。
6. **读取范围限制**：Android 侧部分文件（`ScoreViewModel.kt`、`LibBorrowLogic.kt`、`CampusCardBalanceLogic.kt`、`DefaultLoginRepo.kt`）仅 grep 命中未逐行读；凡标注「未找到证据」的差异，结论限定在本次读取范围内。

---

v1.0 / 2026-11-24

---

## 修复进度登记（2026-11-27，v1.0 审计内容不改动）

| 编号 | 状态 | 证据 |
|---|---|---|
| G-01 (GPA) | ⚠️ 代码完成 + 静态绿，**真机待验** | commit `26212af`（alpha.52/versionCode 52）；`ScoreGpaLogic.ts` 逐条照搬教〔2022〕16号：half-up 逐课绩点（80→3.3）、不及格记 0 进分母、校公选不及格剔除、全量行去重取最高、缓考/免修不计、缺考/旷考/作弊记 0；`test-scoregpa` 74 断言含关键对照 85/3+45/4=1.5429（网页版 3.5781 是错的）；half-up 守卫拆红-恢复 `evidence/g01-gpa-20261127/`；全测 96/96、4291 断言 EXITCODE:0；hvigor BUILD SUCCESSFUL；装机 `bm dump`=52、MD5 `3B0D8E24F61CA4C6BD3389D25FA437DC`。⚠️ 真机：该账号成绩接口返回 `[]`（服务端无数据），GPA 显示未验 |
| G-02 (CSV) | ⚠️ 代码完成 + 静态绿，**真机待验** | `ScoreCsvLogic.ts` RFC4180 转义（含引号 doubled）；剪贴板复制（对齐 DiagnosticsPage 现成模式）；测试含逗号/引号/换行/空表；真机剪贴板未验 |
| G-03 (口径弹窗) | ⚠️ 代码完成 + 静态绿，**真机待验** | 成绩页顶栏「口径」开关 + 红头文件口径说明 + 与网页版有意分叉的明示；真机未验 |

> 三项不判 ✅（G5 未签字）。GPA 真机需有成绩数据的账号（当前账号服务端返回空数组）；CSV/口径弹窗需用户在成绩页点验。

*v1.1 进度登记 / 2026-11-27*

### 7.2 G-04 成绩筛选补学期/课程性质两维（2026-11-27，v1.0 审计内容不改动）

| 编号 | 状态 | 证据 |
|---|---|---|
| G-04 | ⚠️ 代码完成 + 静态绿，**真机待集中验** | alpha.59；新增 `corelogic/ScoreFilterLogic.ts`（学期/性质选项抽取 + 三维 AND 谓词 + `hasAnyFilter` + `toggleChip` + 空态文案，课名/编号忽略大小写），复用 G-01 已解析的 `term`/`category`/`courseNumber`；`ScorePage` 加两组 chip + 清空筛选入口。**关键坑已防**：清空入口按筛选态判（不绑统计门数），筛到 0 门时仍在（对齐 Android `ScorePage.kt:195`）；空态只在「有成绩但筛空」显示，不与整块空态重复。`test-p1batch` 三维纯逻辑 20+ 断言 + 拆红反证（删性质维筛选即红，`evidence/p1batch-20261127/red-category-filter.log`）。顺带同步成绩页两处遗留的「密码默认不保存」旧文案（F01-02 已改无条件存）。真机需验：chip 切换可见变化 + 筛空能退出。 |

*v1.2 G-04 进度 / 2026-11-27*

### 7.3 G-06 空表文案 + S-01 分罐等价性（2026-11-27，v1.0 审计内容不改动）

| 编号 | 状态 | 证据 |
|---|---|---|
| G-06 | ⚠️ 代码完成 + 静态绿，**真机待集中验** | alpha.60；`ScoreCheckRunner` 空表分支（count=0）带 `EMPTY_TABLE_NOTE` 文案（逐字对齐 Android `ScoreCachePolicy.kt:30-32`「教务这次一门成绩都没返回（多半是还没评教），没覆盖掉上次取到的」），仍**不写基线**；`ScorePage` 按 `count===0 && detail` 显示专门文案，不谎报「0 门课」。`test-p1batch2` 静态守卫。真机需验：服务端返回空表时页面显示该文案。 |
| S-01 | ✅ 文档完成 + 守卫已存在（**文档项，无真机诉求**） | 等价性说明：Android 全局单罐靠 `WebViewCookieSync` 自然共享；鸿蒙分罐 `JAR_LOGIN/JAR_CAS/JAR_LIB/JAR_CARD` + `SsoCookieBroker` 只下沉 CAS/sso 域 cookie（**不复制 jxzx/lib/card 业务 cookie**）——两端效果等价（业务子系统各自持有自己的会话 cookie），且鸿蒙更防串罐。守卫 `tools/test-sso.mjs §2 只下沉 CAS 域` + `test-seat500rc`（sso 域 4 条、school_cookies_v1 无 seatlib）已存在；本批不再改代码，仅登记说明。 |

*v1.3 G-06/S-01 进度 / 2026-11-27*
