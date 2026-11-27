# 01 登录 / 会话 / 账号 —— Android ↔ 鸿蒙 功能对齐差距文档

> 审计性质：**只读、可证伪**。本次只读源码，未改任何源码、未跑构建/真机/网络、未提交 git。
> 状态判定从严：**⚠️ 一律不写成 ✅**；无代码/文件支撑的一律写「未找到证据」，不据此断言「不存在」。
> 进度数字：**仅引用 `docs/ROADMAP.md`**，不在本文复述任何进度百分比或完成度。
> 红线：自动路径不猜码、不代收短信、不在无用户界面的链路上打学校 SSO；本审计**不因 Android 端无条件存密码，就建议鸿蒙放宽 opt-in 隐私默认**。

---

## 1. 域范围与已读文件

### 1.1 域范围

**纳入**：校园账号登录（学号+密码 / CAS）、BIT101 社区连接与独立登录、凭据持久化（默认行为与存储机制）、会话失效后的自动重登（主账号与座位侧）、短信/图形二次验证交互、登出清理、账号隔离、会话失效提示、CAS cookie 跨子系统共享。

**相邻域排除**：座位预约业务（域 04）、成绩/图书馆/一卡通业务数据（域 03）、话廊帖子内容（域 06）。本文只在「登录态如何取得/失效/清理」层面触及这些子系统：鸿蒙 `LibBorrowService.ts:214-224`、`CampusCardService.ts:56-62`、Android `CampusServiceScreen.kt:136-145` 仅作为**重登触发点**引用。

**已知起点（可证伪，均已逐条核对）**：
- Android 登录成功无条件存密码：`DefaultLoginRepo.kt:379 loginStatus.password.set(password)`；登录页无「记住密码」控件（`LoginPage.kt` 全文无 Checkbox/Toggle）。
- 鸿蒙 opt-in 勾选才存、默认不存：`LoginPage.ets:48 @State remember: boolean = false`，`LoginPage.ets:98-109` 仅 `reachedLogin && this.remember` 才 `AutoLoginCredentialStore.save`。
- 鸿蒙 alpha.48 已把座位 `authorizeSeat` 接上 `AutoReloginService.renew()`：`SeatPage.ets:452`；`SeatAutoReloginLogic.ts:5-7` 记录「一卡通/图书馆在用，座位页之前没调」。

### 1.2 实际读过的文件路径

**Android（`BIT101-seat`，均排除 build/ 产物）**

| # | 路径 |
|---|---|
| 1 | `data/src/main/java/cn/bit101/android/data/repo/DefaultLoginRepo.kt`（登录/刷新/登出/401 重登主逻辑） |
| 2 | `data/src/main/java/cn/bit101/android/data/repo/base/LoginRetryPolicy.kt`（冷却与指数退避） |
| 3 | `data/src/main/java/cn/bit101/android/data/net/SessionCleanup.kt`（全 App 唯一清理入口） |
| 4 | `data/src/main/java/cn/bit101/android/data/common/SmsCodeRequestHub.kt`（短信验证码总线） |
| 5 | `features/login/src/main/java/cn/bit101/android/features/login/LoginOrLogoutViewModel.kt` |
| 6 | `features/login/src/main/java/cn/bit101/android/features/login/LoginPage.kt` |
| 7 | `features/login/src/main/java/cn/bit101/android/features/login/LoginOrLogoutScreen.kt` |
| 8 | `features/login/src/main/java/cn/bit101/android/features/login/LogoutPage.kt` |
| 9 | `features/common/src/main/java/cn/bit101/android/features/common/component/dialog/SmsCodeDialogHost.kt` |
| 10 | `features/seat/src/main/java/cn/bit101/android/features/seat/api/SeatAutoLogin.kt` |
| 11 | `config/src/main/java/cn/bit101/android/config/user/DefaultLoginStatus.kt` |
| 12 | `config/src/main/java/cn/bit101/android/config/user/base/LoginStatus.kt` |
| 13 | `config/src/main/java/cn/bit101/android/config/user/DefaultSeatLoginStatus.kt` |
| 14 | `config/src/main/java/cn/bit101/android/config/user/UserModule.kt` |
| 15 | `features/user/src/main/java/cn/bit101/android/features/user/UserViewModel.kt` |
| 16 | `features/user/src/main/java/cn/bit101/android/features/user/CampusServiceScreen.kt`（WebView 登录入口，节选 130-149） |

**鸿蒙（`BIT101-harmony/entry/src/main/ets/`）**

| # | 路径 |
|---|---|
| 1 | `pages/LoginPage.ets` |
| 2 | `data/SessionStore.ts` |
| 3 | `data/AutoLoginCredentialStore.ts` |
| 4 | `data/RenewThrottleStore.ts` |
| 5 | `corelogic/AutoReloginLogic.ts` |
| 6 | `corelogic/SeatAutoReloginLogic.ts` |
| 7 | `service/AutoReloginService.ts` |
| 8 | `service/CasLoginService.ts` |
| 9 | `service/SsoCookieBroker.ts` |
| 10 | `service/CommunityAuthService.ts` |
| 11 | `pages/SeatPage.ets`（`authorizeSeat` 节选 427-474、`loadSeats` 节选 476-529） |
| 12 | `service/CampusCardService.ts`（节选 40-71） |
| 13 | `service/LibBorrowService.ts`（节选 205-234） |

**未找到证据（不据此断言不存在）**：Android 侧 `UserDataStore.loginPassword` 的具体加密实现（本文只读到 `DefaultLoginStatus.kt:15` 的 `.toSettingItem()` 映射与 `SeatAutoLogin.kt:22` 的「已加密持久化」注释）；鸿蒙侧 `bit101Available` 等价的独立服务可用性标志；鸿蒙侧登出时清理座位预约任务（`SeatTaskStore`）的调用点；鸿蒙侧 BIT101 社区独立登录页的 UI 入口（`CommunityAuthService.login` 为程序内 best-effort，非登录页按钮）。

---

## 2. 功能对照表

状态口径：✅对齐 / ⚠️部分 / ❌缺失 / ⛔平台不做 / 🚫红线禁做。「鸿蒙增强」也记 ⚠️，不写 ✅。

| 编号 | 功能点 | Android 实现 | 鸿蒙实现 | 状态 | 证据（file:line） |
|---|---|---|---|---|---|
| L01 | 学号+密码登录表单 | 学号/密码框、密码显隐切换 | 学号/密码框、密码框不显示内容 | ✅ | A:`LoginPage.kt:103-105,128-169`；H:`LoginPage.ets:253-270` |
| L02 | 校园账号登录链路（非 WebView） | BIT-Login SDK `schoolLogin.login(username,password,smsCodeHandler)` | 手写 8 步纯 HTTP CAS（登录页→风控→表单→ticket→phpCAS→JWT→教务→落盘） | ⚠️ | A:`DefaultLoginRepo.kt:220-231`；H:`LoginPage.ets:2-5`,`CasLoginService.ts:97-314` |
| L03 | 登录成功是否保存密码 | 无条件存 `sid`/`password` | opt-in 勾选才存；默认 `remember=false`；取消勾选清旧凭据 | ⚠️ | A:`DefaultLoginRepo.kt:378-379`；H:`LoginPage.ets:48,98-109` |
| L04 | 密码持久化机制 | 经 `UserDataStore.loginPassword` 落盘；`SeatAutoLogin` 注释称「已加密持久化」，具体实现未找到证据 | 密码落 `AssetStoreKit` 系统密钥库（`DEVICE_FIRST_UNLOCKED`），学号落普通偏好 | ⚠️ | A:`DefaultLoginStatus.kt:15`,`SeatAutoLogin.kt:22-23`；H:`AutoLoginCredentialStore.ts:12-14,65-72` |
| L05 | 校园登录后 best-effort 连 BIT101 社区 | `loginBIT101` 成功后置 `bit101Available=true`，失败不阻断 | `autoConnectCommunity` 成功后提示，失败只提示不阻断 | ✅ | A:`DefaultLoginRepo.kt:375-389`；H:`LoginPage.ets:117-123,143-156` |
| L06 | 社区连接轻量优先 + 摘要缓存 + CAS 兜底 | ①摘要走 `/user/login`（不碰 CAS）②md5 试③都不行才 `webVpnVerify`；摘要分存 | 仅 `POST /user/login {sid,md5(pwd)}`；无摘要缓存、无 `webVpnVerify` 兜底 | ⚠️ | A:`DefaultLoginRepo.kt:245-268`；H:`CommunityAuthService.ts:72-102`,`LoginPage.ets:143-156` |
| L07 | BIT101 社区独立登录入口（统一认证/社区密码双按钮） | 两个 tab、两个 `LoginAction` | 未找到证据（登录页仅校园账号「登录」按钮） | ❌ | A:`LoginOrLogoutScreen.kt:82-93`；H:`LoginPage.ets:272-277`（未见社区入口） |
| L08 | 图形验证码登录 | `CaptchaError` → `NEEDS_INTERACTIVE`，走交互 | `captchaInvisible=true` → `CAPTCHA_REQUIRED`，「当前版本不支持」，停手 | ❌ | A:`DefaultLoginRepo.kt:198-200`；H:`CasLoginService.ts:150-157` |
| L09 | 短信二验须用户本人输入 | 全局 `SmsCodeDialogHost` 弹窗，用户输入 `onConfirm/onDismiss` | 登录页内输入，agent 不代收、不猜码 | ✅ | A:`SmsCodeDialogHost.kt:8-22`；H:`LoginPage.ets:10,178-211,301-327` |
| L10 | 短信二验交互形态 | 全局总线统一上抛，前台/后台/OkHttp 静默刷新均可就地弹窗完成 | 仅登录页本页输入；自动重登触发二验时停手跳登录页（`hasPendingSms` 可续输） | ⚠️ | A:`SmsCodeRequestHub.kt:12-17,29-37`；H:`CasLoginService.ts:85-91,238-243`,`LoginPage.ets:62` |
| L11 | 会话失效后自动重登并重试原请求 | 仅 HTTP 401 触发 `checkLogin()`，成功后 `operation()` 重放 | 取数确认失效后各子系统调 `renew`，`renewed` 后重试原请求 | ✅ | A:`DefaultLoginRepo.kt:405-437,447-455`；H:`LibBorrowService.ts:214-224`,`CampusCardService.ts:56-62` |
| L12 | 自动重登限流参数 | 身份验证 24h→48h→96h→192h；普通 30min/2h/24h；`Retry-After` 取较大值 | 两次重登至少 10min；连续 3 次失败冻结 8h；无 `Retry-After` 解析 | ❌ | A:`LoginRetryPolicy.kt:31,45-50,60-71`；H:`AutoReloginLogic.ts:20,22,24,86-101` |
| L13 | 失败状态持久化（重启不绕过闸门） | `identityRetryAt`/`identityAttempts` 落盘 | `RenewThrottle` 落盘 `Prefs` | ✅ | A:`DefaultLoginStatus.kt:25-27`,`LoginStatus.kt:67`；H:`RenewThrottleStore.ts:1-4,32-34` |
| L14 | 并发重登单飞去重 | `loginMutex` + `SeatAutoLogin.mutex` | 进程级 `inFlight` Promise 去重 | ✅ | A:`DefaultLoginRepo.kt:48`,`SeatAutoLogin.kt:56`；H:`AutoReloginService.ts:29-49` |
| L15 | 座位「去授权」显式路径允许凭据重登 | `renew(allowCredentials=true)` 仅用户显式点击时传 true | alpha.48 起 `authorizeSeat` 调 `AutoReloginService.renew`；红线只在用户点击时调 | ✅ | A:`SeatAutoLogin.kt:64-70`；H:`SeatPage.ets:427-474`,`SeatAutoReloginLogic.ts:5-15` |
| L16 | 凭据重登前先 cookie 静默续期 | `authenticateSeatlib()` 优先，不受凭据限流约束 | `CasLoginService.silentRenewJwt()` 优先，不用密码不发短信 | ✅ | A:`SeatAutoLogin.kt:77-83`；H:`SeatPage.ets:444-450`,`CasLoginService.ts:442-469` |
| L17 | 自动路径不打学校 SSO / 不发无人短信（座位侧） | 一切自动路径 `allowCredentials=false`，`cookie` 失败即返回 null | 自动取数路径只 `silentRenewJwt`，凭据重登仅在 `authorizeSeat` 用户点击路径 | ✅ | A:`SeatAutoLogin.kt:64-88`；H:`SeatPage.ets:429,476-529`,`SeatAutoReloginLogic.ts:10-11` |
| L18 | 需二验时停手、绝不自动猜码 | `SmsVerificationError`/`CaptchaError` → `NEEDS_INTERACTIVE`，`recordIdentityFailure` 不冷却 | `sms_required`/`captcha_required` → `need_user`，不自动猜码、不计失败次数 | ✅ | A:`DefaultLoginRepo.kt:183-200`；H:`AutoReloginLogic.ts:90-93,104-115` |
| L19 | 失败后清错误凭据 | 无对应；靠冷却窗口（密码保留，避免每次重输） | `bad_cred` 清 opt-in 凭据，下次必须手动登录（鸿蒙侧增强） | ⚠️ | A:`DefaultLoginRepo.kt:128-139,183-190`；H:`AutoReloginService.ts:76-80` |
| L20 | WebView 子系统登录（一卡通/图书馆/教务） | App 内 WebView 完成 CAS，不跳外部浏览器 | `CardLoginPage.ets`/`LibLoginPage.ets`/`EclassLoginPage.ets` 存在；`SsoCookieBroker` 下沉 CAS cookie | ✅ | A:`CampusServiceScreen.kt:136-145`；H:`SsoCookieBroker.ts:1-11,25-35`（页面由 Glob 确认存在） |
| L21 | CAS cookie 跨子系统共享 | 未找到证据（WebView 共享 cookie 的自然结果，未见显式搬运代码） | 显式筛选并灌入 CAS 域 cookie，不复制业务 cookie | ⚠️ | A:未找到证据；H:`SsoCookieBroker.ts:25-35` |
| L22 | 登出统一清理入口（全 App 一份） | `SessionCleanup.clearAll()` 唯一入口，禁止直接 `loginStatus.clear()` | `SessionStore.logoutAll()` 唯一入口，新增 store 只需加一行 | ✅ | A:`SessionCleanup.kt:9-25,39-43`；H:`SessionStore.ts:96-126` |
| L23 | 登出清 BIT101 会话与学校 cookie | `status/webVpn/sid/password/fakeCookie` 清、`cookieStore.removeAll()` | JWT + 学校 cookie 清（`clear()` 内含 `SchoolCookieStore.clear()`） | ✅ | A:`DefaultLoginStatus.kt:44-57`；H:`SessionStore.ts:80-88,110-111` |
| L24 | 登出清座位会话 | `seatLoginStatus.token.set("")` | JWT 清理 + `SeatCookieStore.clear()` | ✅ | A:`SessionCleanup.kt:41`；H:`SessionStore.ts:82,124` |
| L25 | 登出清座位预约任务 | `seatTaskStore.tasks.set("")` | 未找到证据（`logoutAll` 未见 `SeatTaskStore.clear()`） | ❌ | A:`SessionCleanup.kt:42`；H:`SessionStore.ts:109-126`（未见） |
| L26 | 登出清社区票据/凭据/节流 | 主动登出清 `communityPasswordDigest`；`fakeCookie` 随 `clear()` 清 | 清 `FakeCookieStore`/`AutoLoginCredentialStore`/`RenewThrottleStore` | ✅ | A:`DefaultLoginRepo.kt:394-403`,`DefaultLoginStatus.kt:49`；H:`SessionStore.ts:119-124` |
| L27 | 账号隔离（换号不继承旧账号凭据/冷却/票据） | `clear()` 解除冷却与失败计数；登出清社区摘要，避免拿旧摘要 | `logoutAll` 清凭据+节流+票据+座位 cookie，避免换号残留 | ✅ | A:`DefaultLoginStatus.kt:50-56`,`DefaultLoginRepo.kt:398-400`；H:`SessionStore.ts:119-124` |
| L28 | 登录态表示口径 | 持久化布尔 `status`，由 `checkLogin` 写入 | 不存布尔，一律 `hasToken()`/`hasSchoolSession()` 现算 | ⚠️ | A:`DefaultLoginStatus.kt:16`,`DefaultLoginRepo.kt:79-88`；H:`SessionStore.ts:4-6,53-56,66-78` |
| L29 | 会话失效提示分级（含 BIT101 服务降级） | `checkLogin` 三态 UI + snackbar；`bit101Available` 独立降级标志（不持久化） | `messageFor` 分类文案 + `seatsErr`/`seatAuthExpired`；`bit101Available` 未找到证据 | ⚠️ | A:`LoginOrLogoutScreen.kt:42-137,94-100`,`LoginStatus.kt:40-46`；H:`AutoReloginLogic.ts:121-139`,`SeatPage.ets:462-518` |
| L30 | 调试凭据注入通道（agent 不碰凭据） | 未找到证据 | 启动参数 `probe_user`/`probe_pass` 注入，凭据不经输入框、用完即清 | ⚠️（鸿蒙增强） | A:未找到证据；H:`LoginPage.ets:42-43,65-67,76-79,111-114` |

---

## 3. 关键差异详述

### 3.1 凭据存储默认行为

| 维度 | Android | 鸿蒙 | 判定 |
|---|---|---|---|
| 默认值 | 登录成功无条件写 `loginStatus.password.set(password)`（`DefaultLoginRepo.kt:379`），无勾选控件 | `@State remember: boolean = false`（`LoginPage.ets:48`），默认不存 | ⚠️ 行为相反 |
| 写入条件 | 仅「学校登录成功」一个条件（`DefaultLoginRepo.kt:375-380`） | `reachedLogin = ok || sms_required` 且 `remember=true`（`LoginPage.ets:98-101`）；失败/验证码错误不落地 | ⚠️ |
| 取消语义 | 无取消入口 | `ok && !remember` 主动 `AutoLoginCredentialStore.clear()`（`LoginPage.ets:106-109`） | ⚠️ 鸿蒙更明确 |
| 存储机制 | `UserDataStore.loginPassword.toSettingItem()`（`DefaultLoginStatus.kt:15`）；`SeatAutoLogin.kt:22` 注释称加密持久化，具体实现未找到证据 | 密码 `AssetStoreKit` 密钥库 `DEVICE_FIRST_UNLOCKED`，学号普通偏好（`AutoLoginCredentialStore.ts:12-14,65-72`） | ⚠️ |
| 密码内存生命周期 | 随登录态长期持有 | 用完立刻 `this.password=''`（`LoginPage.ets:92,110`），注入通道用完 `clearProbeCreds()`（`LoginPage.ets:111-114`） | ⚠️ 鸿蒙更严格 |

**结论**：这是一处**有意的产品/隐私差异**，不是单纯的漏实现。Android 无条件存密码是为了「登录一次不再输密码」；鸿蒙用 opt-in 把「会话过期自动重登」变成用户显式授权，且凭据隔离在独立 alias（`AutoLoginCredentialStore.ts:4-9`）。**不建议**为对齐而改成无条件存——那会同时放大凭据暴露面与 CAS 请求量。处理建议见 F01-02（决策项）。

### 3.2 自动重登触发范围与限流参数

| 维度 | Android 主账号 | Android 座位侧 | 鸿蒙 |
|---|---|---|---|
| 触发条件 | 仅 HTTP 401（`DefaultLoginRepo.kt:447-455`），`tryRefreshLogin` 供 OkHttp 拦截器非阻塞调用（`:112-123`） | 用户显式点击「授权」才 `allowCredentials=true`（`SeatAutoLogin.kt:64-70`） | 一卡通/图书馆自动取数失效（`CampusCardService.ts:56-62`、`LibBorrowService.ts:214-224`）；座位仅 `authorizeSeat` 用户点击（`SeatPage.ets:452`） |
| 冷却/退避 | identity 24h→48h→96h→192h，普通 30min/2h/24h，attempt 封顶 4（`LoginRetryPolicy.kt:31,60-71`） | 成功 30s 不重复、失败 5min 不再试（`SeatAutoLogin.kt:49,52,80,110`） | 两次重登 ≥10min、连续 3 次失败冻结 8h（`AutoReloginLogic.ts:20,22,24,95-100`） |
| 服务端 `Retry-After` | 解析秒数/RFC1123 并取较大值（`LoginRetryPolicy.kt:45-50,81-93`） | 未找到证据 | 未找到证据 |
| NEEDS_INTERACTIVE 处理 | 不冷却（`DefaultLoginRepo.kt:183-185`） | 不设总超时、等用户输入（`SeatAutoLogin.kt:102-106`） | `need_user` 不计失败次数（`AutoReloginLogic.ts:90-93`） |
| 冷却期行为 | 一律不发学校登录（含交互式），避免凌晨发短信（`DefaultLoginRepo.kt:133-139,418-420`） | `now < nextAllowedAt` 直接返回 null（`SeatAutoLogin.kt:91`） | `freezeUntilMs > now` 直接 `skipped`（`AutoReloginLogic.ts:61-63`） |
| 去重 | `loginMutex` + `SeatAutoLogin.mutex` | 同左 | `inFlight` 进程内单飞（`AutoReloginService.ts:29-49`） |
| 状态持久化 | `identityRetryAt`/`identityAttempts` 落盘（`DefaultLoginStatus.kt:25-27`） | 进程内 `nextAllowedAt`（`SeatAutoLogin.kt:59`） | `RenewThrottleStore` 落盘（`RenewThrottleStore.ts:32-34`） |

**核心差异**：鸿蒙把「学校身份验证失败冷却 24h 起」与「座位凭据直登冷却 30s/5min」两套口径合并为单一的「10min + 3 次失败冻结 8h」。对学校风控而言，鸿蒙的首次失败重试间隔（10min）显著短于 Android 主账号（24h），且没有 `Retry-After` 解析。属 ❌（L12），涉及对外副作用，修复须先确认风控口径（F01-01）。

**触发范围对齐良好**：座位侧 alpha.48 已把 `authorizeSeat` 接上 `AutoReloginService.renew`，且自动路径（`loadSeats`）只走 `silentRenewJwt`、不触发凭据重登（`SeatPage.ets:429,476-529`），与 Android `allowCredentials` 闸门一致（L15/L16/L17 均 ✅）。

### 3.3 CAS / WebView 登录方式

| 维度 | Android | 鸿蒙 |
|---|---|---|
| 校园账号主链路 | SDK 封装 `schoolLogin.login`，返回 cookies + webVpn（`DefaultLoginRepo.kt:220-231`） | 手写 8 步 HTTP CAS，含 USTC 指纹载荷、AES 密码加密、隔离罐换票（`CasLoginService.ts:97-314,566-617`） |
| 为什么不用 WebView | 未找到证据（校园账号本就走 SDK） | R1 已证伪：sso 表单在鸿蒙 Web 组件不渲染；M1 真机验过纯 HTTP 六步全通（`LoginPage.ets:2-5`,`CasLoginService.ts:10-12`） |
| 已有 CAS 会话复用 | `checkSchoolLogin` 先验学校会话，有效直接置位（`DefaultLoginRepo.kt:50-64,79-82`） | step1 检测 302+ticket 直接跳表单，复用有效 SSO 会话（`CasLoginService.ts:109-135`） |
| WebView 子系统 | 一卡通/图书馆 CAS 只能在 App 内 WebView 完成（`CampusServiceScreen.kt:136-145`） | `CardLoginPage`/`LibLoginPage`/`EclassLoginPage` 存在；`SsoCookieBroker.seed` 只下沉 CAS 域 cookie（`SsoCookieBroker.ts:1-11,25-35`） |
| 社区连接 | 轻量 `/user/login` 优先，失败才 `webVpnVerify`（`DefaultLoginRepo.kt:245-268`） | 仅 `/user/login`；无摘要缓存、无 CAS 兜底（`CommunityAuthService.ts:72-102`） |
| 单发不重试 | `classifyRefreshFailure` 分类后按冷却决定（`DefaultLoginRepo.kt:193-218`） | `login` 单发不重试，失败即停（`CasLoginService.ts:15,136-140`） |

**结论**：校园账号主链路两端都「非 WebView」，但实现路径不同（SDK vs 手写协议），故 L02 记 ⚠️。图形验证码是明确缺口（L08 ❌）：Android 把 `CaptchaError` 作为可交互状态处理，鸿蒙明确不支持并要求「到浏览器登录一次后重试」（`CasLoginService.ts:155`）。

### 3.4 短信二验交互

| 维度 | Android | 鸿蒙 |
|---|---|---|
| 输入位置 | 全局 `SmsCodeDialogHost` 弹窗（`SmsCodeDialogHost.kt:8-22`） | 登录页本页输入框（`LoginPage.ets:301-327`） |
| 触发源覆盖 | 前台登录、后台自动刷新、OkHttp 拦截器静默刷新统一走 `SmsCodeRequestHub`（`SmsCodeRequestHub.kt:12-17`） | 仅本页 `login`/`submitSmsCode` 流程；自动重登遇二验转 `need_user` 停手（`AutoReloginLogic.ts:108-109`） |
| 手机号展示 | 掩码 `maskedPhone`（`SmsCodeDialogHost.kt:18`、`SmsCodeRequestHub.kt:30`） | 掩码 `mask(sf.phone)`（`CasLoginService.ts:238-242`） |
| 取消/重入 | `onDismiss → request.cancel()`，总线复位（`SmsCodeDialogHost.kt:20`,`SmsCodeRequestHub.kt:32-36`） | `pending` 跨页面保存、`hasPendingSms()` 回填（`CasLoginService.ts:85-91`,`LoginPage.ets:62`） |
| 发短信 | 由 SDK `SmsCodeHandler` 间接完成 | `sendSmsCode` 显式 POST（`CasLoginService.ts:670-683`） |
| 自动路径保护 | 冷却期一律不发学校登录（含交互式，`DefaultLoginRepo.kt:133-139`） | 自动路径不打 CAS，故不触发短信；显式授权路径才可能触发（`SeatPage.ets:429`） |

**差异**：Android 的短信二验是**全局就地弹窗**——即使从后台刷新触发也能在当前页面完成；鸿蒙是**页面内输入 + 自动路径停手跳页**。鸿蒙设计上守住了「自动路径不发无人短信」，但 `need_user` 后用户需跳转到登录页续输（`hasPendingSms` 承接），交互链更长（L10 ⚠️）。红线一致：两端都不自动猜码（L18 ✅）。

### 3.5 登出清理

| 清理项 | Android | 鸿蒙 |
|---|---|---|
| 唯一入口 | `SessionCleanup.clearAll()`（`SessionCleanup.kt:9-25`） | `SessionStore.logoutAll()`（`SessionStore.ts:96-126`） |
| BIT101 侧 | `status/webVpn/sid/password/fakeCookie` + `cookieStore.removeAll()`（`DefaultLoginStatus.kt:44-57`） | JWT + 学校 cookie（`SessionStore.ts:80-88,110-111`） |
| 座位侧 | `seatLoginStatus.token=""`、`seatTaskStore.tasks=""`（`SessionCleanup.kt:41-42`） | JWT 清 + `SeatCookieStore.clear()`（`SessionStore.ts:82,124`）；**预约任务清理未找到证据** |
| 三个 Web 子系统 | 未找到证据（各处自行管理） | `EclassCookieStore`/`LibCookieStore`/`CardCookieStore.clear()`（`SessionStore.ts:112-115`） |
| 跨账号展示数据 | 未找到证据 | `CampusCardStore`/`CampusNetTrafficStore.clear()`（`SessionStore.ts:116-118`） |
| 凭据/节流/票据 | 主动登出额外清 `communityPasswordDigest`（`DefaultLoginRepo.kt:398-400`） | `AutoLoginCredentialStore`/`RenewThrottleStore`/`FakeCookieStore` 清（`SessionStore.ts:119-123`） |
| 明确不清 | `communityPasswordDigest` 不在 `clear()` 中清（为登录中途不清，`:50-53`） | 课表缓存 `TimeTableStore`/`CourseCache`（产品决定，`SessionStore.ts:103-105`） |

**差异**：鸿蒙的 `logoutAll` 覆盖面比 Android `clearAll` 更广（多清三类 Web 子系统、跨账号展示数据、票据），但**缺少座位预约任务清理**（L25 ❌）——Android `SessionCleanup.kt:42` 明确清 `seatTaskStore.tasks`，鸿蒙 `SessionStore.ts:109-126` 未见对应调用，换号后理论上可能看到旧账号预约任务。

### 3.6 账号隔离

| 机制 | Android | 鸿蒙 |
|---|---|---|
| 主凭据与社区凭据分存 | `password`（学校）与 `communityPasswordDigest`（社区 md5）分开（`LoginStatus.kt:48-57`） | 自动续期凭据与成绩凭据独立 alias（`AutoLoginCredentialStore.ts:4-9`） |
| 不混用学校密码 | 社区独立登录不写 `password`（`DefaultLoginRepo.kt:351-353`）；统一认证未验证社区密码，不存摘要（`:330-332`） | 社区 `login` 只 md5 后 POST，明文不落盘（`CommunityAuthService.ts:10,79-82`） |
| 换号解冷却 | `identityRetryAt/identityAttempts` 在 `clear()` 归零（`DefaultLoginStatus.kt:54-56`） | `RenewThrottleStore.clear()`（`SessionStore.ts:122`） |
| 换号清票据 | `fakeCookie` 随 `clear()` 清（`DefaultLoginStatus.kt:49`） | `FakeCookieStore`/`SeatCookieStore` 清（`SessionStore.ts:123-124`） |

**结论**：账号隔离双方都做了显式处理，L27 ✅。鸿蒙把「新增 store 只需在 `logoutAll` 加一行」作为单一来源（`SessionStore.ts:99-101`），比 Android 的分散清理更可维护。

### 3.7 会话失效提示

| 维度 | Android | 鸿蒙 |
|---|---|---|
| 登录态检查 UI | `checkLoginState` 四态：Fail→登录页 / Success→登出页 / Loading→转圈 / null→触发检查（`LoginOrLogoutScreen.kt:42-137`） | `AutoReloginLogic.messageFor` 六类文案（`AutoReloginLogic.ts:121-139`） |
| 结果提示 | snackbar「校园账号已连接OvO」「连接失败Orz」（`LoginOrLogoutScreen.kt:94-100`） | `statusText` + 语义色档位（`LoginPage.ets:33,41,71-134,213-226`） |
| 失效分类 | `classifyRefreshFailure` 四态（NEEDS_INTERACTIVE/TRANSIENT/FAILED/BUSY/COOLDOWN）（`DefaultLoginRepo.kt:193-218`） | `RenewKind` 六态（renewed/skipped/no_credential/need_user/bad_cred/failed）（`AutoReloginLogic.ts:27-33`） |
| 服务降级标志 | `bit101Available` 独立、不持久化，社区挂不影响学校会话（`LoginStatus.kt:40-46`,`DefaultLoginRepo.kt:158-169`） | 未找到证据；仅有 `seatsErr`/`seatAuthExpired` 等页面级提示（`SeatPage.ets:462-518`） |
| 403 处理 | 明确不算会话失效，避免死循环重登（`DefaultLoginRepo.kt:414-416,443-445`） | 未找到证据（按「确认失效」触发，逻辑上同类收窄） |

**差异**：鸿蒙的重登文案分类更细（六类 vs 四类），但没有 Android 那样独立的「BIT101 服务可用性」降级信号（L29 ⚠️），社区不可用时用户只能看到「可稍后在话廊登录」的一次性提示（`LoginPage.ets:151,154`）。

---

## 4. 可执行修复清单

> 每条均可直接派工，验收判据可证伪（能构造反例使其不成立）。**P0 = 触及学校风控/对外副作用或最大 parity 缺口；P1 = 功能补齐；P2 = 口径/呈现**。
> 本清单**不含**任何「改为无条件存密码」「自动猜码」「agent 代收短信」「自动路径打 SSO」项——这些属第 5 节红线。

| 编号 | 改动点 | 鸿蒙文件 | 验收判据（可证伪） | 风险 | 优先级 |
|---|---|---|---|---|---|
| F01-01 | 统一自动重登限流口径：把「学校身份验证」与「座位凭据直登」分两套参数，向 Android `LoginRetryPolicy`（identity 24h×2^(n-1)，普通 30min/2h/24h）与 `SeatAutoLogin`（成功 30s/失败 5min）对齐；至少补 `Retry-After`（秒数 + RFC1123）解析并取本地估算与服务端要求较大值 | `corelogic/AutoReloginLogic.ts`（常量与 `canAttempt`/`nextThrottle`）、`service/AutoReloginService.ts`、`data/RenewThrottleStore.ts` | ①注入 `attempt=1/2/3/4`，下次允许时间分别为 `now+24h/+48h/+96h/+192h`；②`need_user`/`no_credential` 不改变 `consecutiveFails`；③`Retry-After: 3600` 与 `Retry-After: Wed, 21 Oct 2026 07:28:00 GMT` 均能解析且取较大值；④杀进程重启后冻结状态仍生效；⑤**不得**给 `need_user` 加冷却 | **高：直接改变 CAS 请求频率，触及学校风控与对外副作用**。调整须产品/风控确认；不得取消 `NEEDS_INTERACTIVE` 不冷却与持久化 | **P0** |
| F01-02 | 对「Android 无条件存 / 鸿蒙 opt-in 默认不存」作出显式产品决策并落文档：二选一——(A) 保留差异，在代码注释与用户文案写清「有意不在本机保存密码」；(B) 对齐无条件存，须先完成隐私与风控评审 | `pages/LoginPage.ets`（文案 `:240-244`）、`data/AutoLoginCredentialStore.ts`（头注释 `:1-18`）、本差距文档 | ①文档中明确写出 A 或 B 且代码行为与决策一致；②若选 A：勾选默认 false、取消勾选即 `clear()`（`LoginPage.ets:48,106-109`）仍成立；③若选 B：须附评审记录，且自动重登仍受 F01-01 限流约束；④任一决策下密码都不打印、不进 `steps`、不拼进 URL | **高：若选 B 会扩大凭据暴露面并放大 CAS 请求量**，属隐私/风控决策，须主理人拍板，不得由执行者自行放宽 | **P0** |
| F01-03 | 收口自动重登触发短信副作用的交互：一卡通/图书馆在自动取数失效路径调 `AutoReloginService.renew` → `CasLoginService.login`，一旦风控要求二验会**真的发短信**后 `need_user` 停手；须让用户在当前流程可直接续输（对齐 Android 全局 `SmsCodeDialogHost`），而不是仅靠跳登录页 | `service/AutoReloginService.ts`、`service/CasLoginService.ts`（`hasPendingSms`/`pending`）、`pages/LoginPage.ets`、`service/CampusCardService.ts`、`service/LibBorrowService.ts` | ①自动重登返回 `need_user` 且 `hasPendingSms()` 为 true 时，用户无需重新输入学号密码即可提交验证码；②验证码错误不重试、不发第二条短信；③取消后 `pending` 复位；④显式授权路径 `SeatPage.ets:452` 行为不变；⑤源码检索：无自动路径调用 `CasLoginService.login` 后忽略 `need_user` 的分支 | **高：涉及真实短信（对外副作用）与学校风控**。不得改为 agent 代收/自动猜码；不得影响用户显式「去授权」路径 | **P0** |
| F01-04 | 图形验证码能力补齐或明确降级二选一：(A) 增加验证码输入交互；(B) 维持停手，但把文案与降级路径写进文档，并在 `CAPTCHA_REQUIRED` 时保留 `pending` 供用户在浏览器登录后继续 | `service/CasLoginService.ts:150-157`、`pages/LoginPage.ets`、`docs/parity-gap/01-login-session.md` | ①`captchaInvisible=true` 时不再把用户丢回空态；②若选 A：页面出现验证码输入框且提交后能完成登录；③若选 B：文案含明确操作指引（现有 `:155` 已满足），文档记录为不做项；④任一选项都不自动识别/绕过验证码 | 中：涉及风控指纹与表单字段，**须真机验证**（本审计不做）；不得引入自动打码 | P1 |
| F01-05 | 登出补清座位预约任务，对齐 Android `SessionCleanup.kt:42 seatTaskStore.tasks.set("")` | `data/SessionStore.ts:109-126`（`logoutAll` 增加一行）、`data/SeatTaskStore.ts` | ①登录后产生预约任务 → 调 `logoutAll()` → `SeatTaskStore` 读回为空；②换账号登录后不看到上一账号任务；③课表缓存仍保留（`SessionStore.ts:104`）；④不误清 `TermStore`/主题/通知设置 | 低：纯本地存储清理；须确认 `SeatTaskStore` 的 clear API 与 `logoutAll` 的单入口纪律一致 | P1 |
| F01-06 | 社区连接降级链补齐：对齐 Android `loginBIT101` 的「轻量摘要优先 → md5 试 → 都不行才 CAS」顺序；至少补 `communityPasswordDigest` 等价的摘要缓存，避免每次重登都打 `/user/login` 失败后无兜底 | `service/CommunityAuthService.ts`、`data/FakeCookieStore.ts`（或新增摘要 store）、`pages/LoginPage.ets:143-156` | ①首次成功后再次自动连接走摘要轻量路径，不再依赖明文密码；②摘要为空时行为与当前一致（只提示不阻断）；③源码检索：不存在把学校密码明文当社区密码写入 `communityPasswordDigest` 的路径（对齐 `DefaultLoginRepo.kt:330-332,351-353`） | 中：**不建议补 `webVpnVerify`（服务端代做 CAS）**，那会放大风控；建议只补摘要缓存或仅补文档说明 | P1 |
| F01-07 | 增加 BIT101 服务可用性降级标志（对齐 `bit101Available`，不持久化），把「社区不可用」与「学校会话失效」解耦 | 新增 `corelogic/` 运行期状态 + `service/CommunityAuthService.ts`、`pages/LoginPage.ets` | ①社区请求失败后学校侧功能（座位/课表）仍可用；②页面出现明确降级提示而非「会话已过期」；③杀进程重启后默认恢复可用（不持久化）；④不影响 `AutoReloginService.renew` 判定 | 低：纯运行期状态/UI；不得把该标志写入登录态判定 | P1 |
| F01-08 | 登录态口径差异文档化：明确 Android 持久化 `status` 布尔 vs 鸿蒙 `hasToken()`/`hasSchoolSession()` 现算，禁止在鸿蒙引入「一个状态多个写入者」的布尔 | `data/SessionStore.ts:4-6,53-78`、本差距文档 | ①文档中列出两端口径与选择理由；②源码检索 `SessionStore.ts` 无 `isLoggedIn` 布尔字段；③任意时刻 `snapshot().hasToken` 与 `getToken()` 非空等价 | 低：仅文档/约束；改动现有口径会波及所有取数页，不建议改代码 | P2 |
| F01-09 | CAS cookie 下沉口径说明：记录「鸿蒙显式 `SsoCookieBroker.seed` vs Android WebView 自然共享」的差异，保持只下沉 CAS 域 | `service/SsoCookieBroker.ts:1-11,25-35`、本差距文档 | ①文档写明该差异；②`seed()` 仍只复制 CAS 域、不复制 jxzx/lib/card 业务 cookie（`SsoCookieBroker.ts:10-11`）；③`seed` 返回 0 时页面表现与当前一致 | 低：仅文档；跨子系统串 cookie 会让服务端误判会话，严禁放宽 | P2 |
| F01-10 | 调试凭据注入通道加边界标注/release 保护，确保不会被误用为「agent 代收凭据」 | `pages/LoginPage.ets:42-43,65-67,76-79,111-114` | ①源码检索：注入仅在解析到 `probe_user`/`probe_pass` 时生效；②注入通道的密码不进输入框、不打印、不进 `steps`（`LoginPage.ets:8-9,92-93`）；③release 构建不默认注入；④用完 `clearProbeCreds()` 后 `hasInjectedCreds=false` | 低：仅保护性约束；须确认 release 构建不会默认注入 | P2 |
| F01-11 | 会话失效提示文案统一：两端同语义一张表（已连接/连接失败/会话过期/需手动登录/暂停续期/凭据失效） | `corelogic/AutoReloginLogic.ts:121-139`、`pages/LoginPage.ets:33,116,133,168,171,173,208`、本差距文档 | ①六类 `RenewKind` 均有中文文案且不含学号/手机号明文之外的敏感值；②与 Android snackbar 文案语义一一对应；③`bad_cred` 文案明确「记住的密码已失效，请重新登录」（`AutoReloginLogic.ts:127`） | 低：纯文案；不得把「失败」伪装成成功 | P2 |

---

## 5. 明确不做 / 平台受限项及原因

| 编号 | 项目 | 状态 | 原因 | 证据 |
|---|---|---|---|---|
| R01 | 鸿蒙 Web 组件渲染 sso 登录表单 | ⛔平台不做 | R1 已证伪：sso.bit.edu.cn 表单在鸿蒙 Web 组件不渲染；纯 HTTP 链路已真机验通 | H:`LoginPage.ets:2-5`,`CasLoginService.ts:10-12` |
| R02 | agent 代收短信验证码 / 自动猜码 | 🚫红线禁做 | 验证码必须由用户本人输入；自动路径无人输码会把短信变成「来路不明的验证码」 | H:`LoginPage.ets:10`,`AutoReloginLogic.ts:12,108-109`,`CasLoginService.ts:16`；A:`SeatAutoLogin.kt:64-70` |
| R03 | 自动路径（进页面/取数失效重试/预约重放）走凭据直登打学校 SSO | 🚫红线禁做 | 会触发学校风控真实短信；只有用户显式点「去授权」才允许 | A:`SeatAutoLogin.kt:64-88`；H:`SeatPage.ets:429`,`SeatAutoReloginLogic.ts:10-11` |
| R04 | 定时探测 / 启动就自动重登 | ⛔平台不做 | 凭空消耗 CAS 额度、撞学校风控 | H:`AutoReloginService.ts:5-6` |
| R05 | 密码打印 / 进日志 / 拼进 URL / 进 `LoginOutcome.steps` | 🚫红线禁做 | 凭据最小化暴露 | H:`LoginPage.ets:8-9,92-93`,`CasLoginService.ts:17`,`AutoLoginCredentialStore.ts:15` |
| R06 | 把学校密码当社区密码写入摘要 | 🚫红线禁做 | 统一认证未验证社区密码，存了会让下次拿错误摘要撞 `/user/login` | A:`DefaultLoginRepo.kt:330-332,351-353`；H:`CommunityAuthService.ts:10` |
| R07 | 图形验证码自动识别 / 绕过 | 🚫红线禁做 | 属风控对抗；鸿蒙当前版本明确停手，Android 也只弹交互不自动识别 | H:`CasLoginService.ts:153-157`；A:`DefaultLoginRepo.kt:198-200` |
| R08 | 登录失败后自动重试（单发不重试） | 🚫红线禁做 | 失败即停、把原始状态交回上层，避免放大 CAS 请求量 | H:`CasLoginService.ts:15`；A:`DefaultLoginRepo.kt:133-139` |
| R09 | 为对齐 Android 而把鸿蒙改为无条件存密码 | 🚫红线禁做 | 放大凭据暴露面与 CAS 请求量，违背 opt-in 隐私默认；须走产品/风控评审（F01-02） | H:`LoginPage.ets:48`,`AutoLoginCredentialStore.ts:12-14` |

---

## 6. 交付统计（供汇总用）

| 项 | 数值 |
|---|---|
| 功能对照表行数 | 30（L01–L30） |
| ✅ 对齐 | 16 |
| ⚠️ 部分（含鸿蒙增强 L19/L30） | 10 |
| ❌ 缺失 | 4（L07、L08、L12、L25） |
| **差异条数** | **14**（⚠️ 10 + ❌ 4） |
| 不做项数 | 9（⛔ 2 + 🚫 7，R01–R09） |
| 可执行修复清单 | 11 条（F01-01 ~ F01-11） |
| **P0 编号** | **F01-01、F01-02、F01-03** |
| 进度数字来源 | 仅 `docs/ROADMAP.md`（本文未复述任何进度数字） |
| C 级「未找到证据」 | Android `UserDataStore` 加密实现、鸿蒙 `bit101Available` 等价物、鸿蒙登出清座位预约任务、鸿蒙社区独立登录 UI 入口、鸿蒙 `Retry-After` 解析、Android CAS cookie 显式下沉（见 §1.2 / §3） |

---

v1.0 / 2026-11-24

---

## 7. 修复进度登记（2026-11-27，v1.0 审计内容不改动）

| 编号 | 状态 | 证据 |
|---|---|---|
| F01-01 | ⚠️ 代码完成 + 静态绿，**真机待集中验** | `AutoReloginLogic` 重写为两套口径：identity 24h×2^(n-1) 封顶 192h（A:LoginRetryPolicy）、seat 成功 30s/失败 5min（A:SeatAutoLogin）；`parseRetryAfter` 支持秒数与 RFC1123 并取较大值（**守卫抓到真 bug**：`-5` 曾被 Date.parse 误当年份，已修）；`retryAtMs` 落盘重启生效；`SeatPage` 显式授权传 `'seat'` 模式。`test-sessionparity` 69 断言；拆红反证 `evidence/session-parity-20261127/red-needuser-cooldown-20261127.log` |
| F01-02 | ⚠️ 代码完成 + 静态绿，**真机待集中验** | **用户拍板 B（无条件存，对齐 Android）**，风险评审见下方 §7.1；`LoginPage.doLogin` 登录成功即存凭据（不再看 remember 勾选），文案如实告知，勾选框退化为只读状态展示；凭据仍落 AssetStoreKit 系统密钥库（非明文偏好），密码不打印/不进 steps/不拼 URL |
| F01-03 | ⚠️ 代码完成 + 静态绿 + 编译通过，**真机待集中验** | 新增 `components/SmsChallengeDialog.ets`：自动重登 `need_user + hasPendingSms` 时一卡通/图书馆页就地弹框，用已有 `submitSmsCode` 凭 pending 续输（不重输学号密码）；错误不重试不发第二条短信（CasLoginService c2 rejected 已停手）；取消 clearPending；`SeatPage` 显式授权路径不变。**红线守住**：对话框本身不发短信、不代收、不猜码。编译门抓到 `LibBorrowResult` 加 `smsPending` 后 `LibLoginPage`/`MePage` 排除法窄化失效（`.records` 不存在），已改显式判 ok + 补 smsPending 分支，证据 `evidence/session-parity-20261127/build-success-20261127.log` |

### 7.1 F01-02 选 B（无条件存密码）风险评审（用户拍板 2026-11-27）

| 维度 | 评估 |
|---|---|
| 凭据暴露面 | 从「用户 opt-in 才落盘」扩大为「登录成功即落盘」。缓解：密码走 `AssetStoreKit`（DEVICE_FIRST_UNLOCKED，系统密钥库），不是明文偏好；学号普通偏好；登出 `SessionStore.logoutAll` 仍清两份凭据。 |
| CAS 请求放大 | 更多用户有凭据 ⇒ 会话失效时自动重登更频繁。缓解：F01-01 限流同步收紧——identity 失败 24h 起指数退避（原 10min/8h），seat 成功 30s/失败 5min；服务端 Retry-After 取较大值。 |
| 用户知情 | 登录页文案改为「登录成功后密码加密存入本机系统密钥库，会话过期时自动续期（对齐 Android 端）」，勾选框只读展示，不再声称「默认不保存」。 |
| 红线 | 密码不打印（mask）、不进 `LoginOutcome.steps`、不拼进 URL；`need_user` 不加冷却但必须用户介入；不自动猜验证码、不代发短信。 |
| 未验 | 真机密钥库读写、自动重登全链路（需真实会话失效 + 用户本人登录）未验；本评审不冒充真机通过。 |

> 本批不判 ✅（G5 集中验收未做，且 F01-02 需真机确认密钥库落盘/登出清除、F01-03 需真实短信二验）。红线项（need_user 不冷却、不发第二条短信、显式授权路径不变）已用拆红反证钉死。
> 静态验收：全量 **101/101 套件 4560 断言绿**（`tools/run-tests.sh` EXIT=0）；`assembleHap` BUILD SUCCESSFUL（`evidence/session-parity-20261127/build-success-20261127.log`）；拆红反证 `red-/green-needuser-cooldown-20261127.log`。按用户要求，真机验收留到最后集中做，本批不冒称真机通过。

*v1.1 进度登记 + 风险评审 / 2026-11-27*
