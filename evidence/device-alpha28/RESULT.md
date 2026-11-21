# alpha.28/29 真机验证结果（2026-11-19）

> 设备 nova 14 Pro `4CY9K25614019980` ｜ alpha.28 装机确认 versionCode 28（bm dump）｜ 会话数据保留（install -r，未卸载）
> 证据截图：`evidence/device-alpha28/` ｜ hdc 通道极不稳定，多次需 kill 重置；钉钉反复抢前台

## ✅ 已验证通过

| 项 | 结果 | 证据 |
|---|---|---|
| 装机 | versionCode 27→28，bm dump 确认 28，会话保留 | install-a28e.log |
| 首屏课表 | 5 页签(课表/DDL/动态/空教室/交通)+6 底栏齐全；深色态 Brand 深蓝正确；会话过期诚实显示缓存+提示，无伪造 | a28-01-launch.jpeg |
| 「图」瓦片地图 | ✅ 真实瓦片加载（良乡校区道路/建筑清晰，非灰格）；左上 5 钮(⚙+乡村珠嘉)默认「乡」高亮；弹「已切换到良乡校区」；底栏高亮 | a28-02-map.jpeg |
| 「网」WebView | ✅ #FF9A57 状态栏 + BIT101 站点头部加载（logo/返回/刷新/深色/信封）；主体空白=社区后端现状，非崩溃；底栏高亮 | a28-03-web.jpeg |
| 话廊四流 | ✅ 顺序「关注/推荐/最新/最热」；默认「推荐」高亮；真实帖子加载 | a28-04-gallery.jpeg |
| 「我」页成绩入口 | ✅ 右上 4 图标(刷新/学士帽成绩/铃铛/齿轮)；账号区+自习卡+一卡通/校园网双卡+图书馆卡正常 | a28-05-me.jpeg |

## ✅ 真机发现的 bug 已修复并复验（alpha.31）

- **地图浮层位置错**：ODbL 署名 +「已切换到…」提示条都贴在**左上角**（Stack 默认 TopStart）。
  - 提示条：`.position + .markAnchor` → alpha.29 复验 ✅ 底部居中（a29-map5.jpeg）。
  - 署名：ArkUI 层 position/markAnchor 在不同屏宽 vp 下反复飘（alpha.29/30 署名跑出屏幕）；**最终改为在 `rawfile/map.html` 里用 CSS `position:absolute; right:8px; bottom:74px` 固定定位** → alpha.31 复验 ✅ 右下角可见、与提示条不重叠（a31-map.jpeg）。
  - 地图瓦片 / 左上 5 钮在 alpha.29/31 复验均正常。

## ❌ 未验（如实）

- **浅色态 Brand 配色**：设备处于深色模式，设置页齿轮点击 coords 反复失败（hdc 坐标体系漂移 + 钉钉抢焦点），未进设置页确认浅色 chip。深色态 Brand 已确认正确；设置页配色逻辑有单测覆盖（test-gridtokens 换默认值已拆红验过）。
- **地图底部设置栏滑杆交互**：未在真机点开验证。
- **校区切换（村/珠/嘉）**：只验了默认「乡」。

## ✅ alpha.32 真机验证（2026-11-19 第二轮 6 项诉求，versionCode 32 确认）

| 项 | 结果 | 证据 |
|---|---|---|
| 沉浸式顶部 | ✅ 状态栏透明、页面背景延续到最顶部；顶部 5 页签完整未被前摄遮挡 | a32-launch.jpeg |
| 课程卡片左竖条 | ✅ 卡片左侧 4vp 深色竖条（对齐原版 CourseScheduleItem stripeColor） | a32-launch.jpeg |
| 地图默认 1 倍 | ✅ 默认显示整个良乡校区 + 周边道路 + 地铁线（完整校园范围），瓦片全加载无变灰 | a32-map.jpeg |
| 地图署名/提示条 | ✅ 署名右下、提示条底部（alpha.31 修复在 32 仍成立） | a32-map.jpeg |
| 课程详情点空白收起 | ✅ 点卡片弹出详情 → 点周7空白格 → 详情消失、课表恢复完整 | a32-detail-open.jpeg / a32-detail-closed.jpeg |
| 课程详情切页自动关 | ✅ 开详情 → 切「图」→ 切回「卷」→ 详情已自动关闭 | a32-switchback2.jpeg |
| 浅色态配色 | ✅ 本轮设备处于浅色态，浅灰底+深色文字的 Brand 浅色配色正常（先前未验项补上） | a32-launch.jpeg |

### 本轮代码改动（编译 BUILD SUCCESSFUL + 全量 81/81 套件 3762 断言绿）
1. 地图缩放变灰：map.html 引入 tilePx=TILE*2^(zoom-z) 统一可见范围与绘制尺寸（原先浮点 zoom 与整数瓦片层级坐标不一致导致轻微缩放变灰）；默认 mapScale 2→1、goto 沿用当前倍率。
2. 课程详情关闭：SchedulePage 空格子 onClick 收起 + onWake 入口切任意页清 selected/selectedPlanNote。
3. 课表版式：卡片左竖条 4vp ink（去掉整圈 secondary 边框，对齐原版）；话廊帖子卡加分隔线。
4. 我页文案：一卡通/校园网空态"A 原文"、校园网字号 15→20、双卡第三行"点开详情"、消息图标文案"消息"、自习卡文案对齐。
5. 沉浸式：EntryAbility setWindowLayoutFullScreen(true)+透明状态栏+topInset 写 AppStorage；Index 外壳 padding(topInset)+expandSafeArea；STORAGE_TOP_INSET 常量。
6. 统一登录：LoginPage 成功分支用同一学号密码 best-effort 调 CommunityAuthService.login 换 fake-cookie（社区免二次登录），短信分支仅 opt-in 凭据存在时补连；失败只提示不阻塞。

### ❌ 本轮未验（如实）
- **统一登录正路径**：CAS 登录需用户本人输密码/短信验证码，agent 不代输，故 community 自动连接只做了代码+编译验证，真机正路径未走。
- **座位静默续期（座位 500 根因）**：涉及 seatlib 域 cookie 持久化 + 真实预约副作用，需用户拍板方案（A 补 cookie / B 专用登录 / C 维持诚实报错），本轮不动。
- 地图缩放手势真机连续缩放未手动滑验（JS 换算有单测覆盖 tile 换算 34 条断言）。

## alpha.33 第三批（我页视觉 + 课表开关 + 座位500方案A′，versionCode 33）

> 本轮设备未连（2026-11-21 凌晨），**全部代码改动未真机验**，只做编译 + 单测。

### 代码改动
1. **我页账号区**（对齐 Android `UserInfoContentForMe`）：新增 `corelogic/CommunityUserLogic.ts`（解析 `/user/info/0`，49 断言）+ `service/CommunityUserService.ts`（带 fake-cookie GET，三态）。MePage 账号区补昵称/身份称号/签名/粉丝关注/UID/注册时间/认证勾；头像 72→78dp；字段取不到一律隐藏，不编造。`loggedIn`（学校 cookie）与 `communityLoggedIn`（社区票据）两套登录态独立判断。
2. **我页我的帖子**：`CommunityService.listMyPosts`（`GET /posters?mode=search&uid=0&page=0`），MePage 图书馆卡下加帖子列表（最多 5 条 + 0.5dp 分隔线 + Web 壳详情），三态文案（未登录/失败/空）如实区分，不伪装「暂无帖子」。
3. **课表显示开关**：新增 `corelogic/ScheduleDisplayLogic.ts`（7 开关默认值对齐 Android SettingDataStore + 22 断言）+ `data/ScheduleDisplayStore.ts`（Prefs 适配）。设置页「课表显示」组加边框/分隔线两个 Checkbox（真生效）；SchedulePage onWake 重读开关，课程卡整圈边框 + 空格网格线随开关变。周末列隐藏/当前时间线/考试信息**未接**（涉及网格结构，避免假开关）。
4. **座位 500 方案 A′**：新增 `corelogic/SeatCookieLogic.ts`（31 断言）+ `data/SeatCookieStore.ts`（独立 key `seatlib_cookies_v1`）。登录步骤8/短信c5在原 `snapshotAndSave` 之后追加 `SeatCookieStore.appendFromCas(JAR_CAS)`；`silentRenewJwt` 恢复 school cookies 后再恢复 seatlib cookies；`SessionStore.logoutAll` 补清独立 key。**不并入 school_cookies_v1**⇒`test-seat500rc`「无 seatlib」事实继续成立、`test-sso`「只下沉 sso 域不串罐」语义不破，源码栅栏锁死。

### 验证
- 新增 3 套件（communityuser 49 + scheduledisplay 22 + seat500a 31），全量见下方测试结果。
- 编译 `assembleHap` 结果见下方。**未真机验**：账号区/帖子/开关/座位续期正路径全未上机（设备未连）。

### ❌ 未验（如实）
- 社区 `/user/info/0` 与 `/posters?mode=search&uid=0` 真机契约（Android 已证实存在，H 端首次调用）——若 mode 序列化不符会如实降级，不伪造数据。
- 座位方案 A′ 生效判据：重新登录后 `seatlib_cookies_v1` 出现 seatlib 域记录 + 座位页不再恒 500。设备未连未验。

## ✅ alpha.33 真机验证（2026-11-21，versionCode 33 确认，nv14Pro）

| 项 | 结果 | 证据 |
|---|---|---|
| 「我」页账号区 | ✅ **大超预期**：社区 `/user/info/0` 真机契约成立——头像(78dp)+昵称 `BIT101-1b1da3de`+身份「普通用户」+签名+`UID：9597`+`2024-11-12加入` 全加载。认证勾未显示（id=0 符合逻辑）；粉丝/关注行未显示（该用户数=0，符合 `>0` 才显示） | a33-me.jpeg |
| 「我」页我的帖子 | ✅ 显示「还没有发帖」（真态，非失败伪装）；卡片正常入场 | a33-me.jpeg |
| 校园网卡 | ✅ 真实数据「本月 295.2 GB · 余额 ¥20.01」 | a33-me.jpeg |
| 课表默认态渲染 | ✅ 课程卡左侧 4vp 竖条 + 无整圈边框（边框默认关）+ 空格网格线可见（分隔线默认开）；今日列高亮 | a33-schedule.jpeg |
| **座位 A′ 落盘判据** | ✅ **关键通过**：prefs 实测 `seatlib_cookies_v1` 1 条 `PHPSESSID`（32位，domain=seatlib.bit.edu.cn, path=/）；`school_cookies_v1` 仍 10 条 sso/jxzx、**无 seatlib**（不串罐，守卫语义成立） | a33-prefs（未入库，含cookie值） |
| **座位 A′ 行为判据** | ❌ **仍 HTTP 500**：点「5层中厅」显示「座位状态（8）/ 响应解析失败（HTTP 500）」，但**无**「登录已失效」提示（静默续期路径已走通，服务端仍不认会话） | a33-seat-status.jpeg |

### 座位 500 结论（A′ 未完全生效，转方案 B）
落盘的是正确的 `PHPSESSID`，但服务端仍 500 ⇒ 命中根因报告预判的**反证分支**：旧 phpCAS 会话已过期/服务端不认。A′ 做到"cookie 能落盘、静默续期能带上"，但换不到有效 token。
**下一步**：需用户**本人重新登录一次**（走登录页输密码，agent 不代输）产生新 PHPSESSID，再验座位页。若重登后仍 500 ⇒ 服务端侧问题，非 App 可修。
⚠️ 未执行恢复出厂/卸载（保住会话），仅只读检查 prefs（脱敏，不打印 value）。

### 本轮未验（如实）
- **课表开关切换交互**：设置页齿轮点击在 dump 坐标 (1121,90)/(1106,93)/(906,168) 三次均未进设置页（Image 单独 onClick 在此设备 hitTest 失效，alpha.28 也踩过）。开关**默认值渲染已真机确认**，切换生效只靠单测（22 断言）+ 源码栅栏，未真机点验。
- 我页粉丝/关注行未显示（该账号数为 0）；认证勾未显示（普通用户），均为正确逻辑，未验"有值态"。
- 座位重登后判据未验（需用户本人输密码）。
- 设备曾锁屏一次（hdc 无自动解锁），已请用户解锁后继续。

## ✅ alpha.34 座位 500 真正根因 + 授权门禁（2026-11-21，用户提示查 BIT101-S）

用户指出"BIT101-S 里研究很透彻"——查 `BIT101-seat/docs/seatlib-contract.md` 找到**权威根因**（实测非推测）：
- **§1**：带失效/伪造 token 打 `/api/Seat/seat` → **HTTP 500 + 空 body**；不带 token → 200。认证失败是 200+code 10001，**不是 401** ⇒ 按 401 判失效永远不触发。
- **§5**：seatlib **单会话互踢**——同账号别处登录（网页/script）旧会话立即失效。我们 prefs 里的 `PHPSESSID` 是 2026-11-18 的，早已失效。
- **§6**：Android 靠 `SeatHttp.session` 单例常驻 phpCAS 会话 + `authenticateSeatlib()` 静默换 JWT；失败则**门禁 UI**「学校账号已登录，但座位系统尚未授权」+「授权座位系统」按钮（用户点击才 allowCredentials=true，可能弹短信验证码，框挂顶层）。
- **鸿蒙缺口**：500 只报"响应解析失败（HTTP 500）"看不懂，**没有门禁 UI 和授权入口**——用户不知道要重新授权。

### alpha.34 修复（对齐 Android SeatAuthGate）
- SeatPage 识别 HTTP 500 → `seatAuthExpired=true`，文案改「座位系统授权已失效」。
- 门禁 UI：文案「学校账号已登录，但座位系统尚未授权」+「授权座位系统」按钮 + 进行态「正在恢复座位系统授权…」（对齐 SeatAuthGate.kt 原文）。
- 按钮 `authorizeSeat()`：先只读 `silentRenewJwt`（cookie，不发短信）；失败跳 LoginPage 请用户本人重登（重登重建 seatlib phpCAS 会话 + A′ 落新 PHPSESSID）。
- ⚠️ 红线：授权只由用户点击触发；自动续期路径只做只读 cookie 续期，绝不走凭据直登（避免学校风控短信无人输入）。守卫 `test-seatauthgate` 12 条锁死。
- `test-seatauthgate` 12 断言 + 全量 85/85 套件 3876 断言绿 + 编译 BUILD SUCCESSFUL；versionCode 34（bm dump 确认装机）。

### ✅ alpha.34 真机验证（nv14Pro，已解锁）
| 项 | 结果 | 证据 |
|---|---|---|
| 座位 500 → 门禁 UI | ✅ 点「5层中厅」不再显示「响应解析失败（HTTP 500）」，改为「学校账号已登录，但座位系统尚未授权」+「授权座位系统」按钮；徐特立馆/五层/5层中厅正确选中 | a34-gate.jpeg |
| 授权按钮行为 | ✅ 点击后 silentRenewJwt 失败（旧 PHPSESSID 已死）→ 正确跳登录页请本人重登；**未自动走凭据、未代输密码、未触发短信**（红线保持） | a34-authorize.jpeg |
| 守卫有效性 | ✅ test-seatauthgate 故意拆红（把授权路径的 silentRenewJwt 去掉）→ 守卫 FAIL，恢复全绿 | — |

### 座位 500 最终结论
A′ 的"cookie 落盘/续期"链路是对的（落盘判据过），但服务端**单会话互踢**（seatlib-contract §5）——旧 PHPSESSID 早已失效，换不到新 JWT。alpha.34 补齐了 Android 同款**授权门禁 + 用户主动授权入口**，把"看不懂的 500"变成可操作的重新授权。
**最终验证需用户本人**：在登录页输一次密码重登 → 产生新 seatlib 会话 → 再进座位页。若重登后仍 500 ⇒ 服务端侧问题，非 App 可修。

## 装机踩坑（已解决，记录）
1. hdc 是 Windows 程序：不认 `/f/` 路径、`F:/` 绝对路径会拼到 cwd 后 ⇒ 必须 cd 到目标目录用相对文件名。
2. `hdc kill` 后通道重建需 ~4s，期间所有命令报 "need connect-key" ⇒ 脚本内探活+重试。
3. 连续 hdc 命令会竞争通道 ⇒ 每个动作独立脚本、内部串行、加 sleep。
4. 钉钉/微信自动弹前台 ⇒ 点坐标前必须截图确认目标 App 在前台（本次验证多次被钉断层）。
5. `uitest dumpLayout` 图标类 Image 无 accessibilityText，坐标解析只能靠 bounds，顶层图标坐标体系与底栏不一致，浅色验证因此放弃。
