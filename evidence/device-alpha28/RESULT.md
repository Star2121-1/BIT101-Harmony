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

## 装机踩坑（已解决，记录）
1. hdc 是 Windows 程序：不认 `/f/` 路径、`F:/` 绝对路径会拼到 cwd 后 ⇒ 必须 cd 到目标目录用相对文件名。
2. `hdc kill` 后通道重建需 ~4s，期间所有命令报 "need connect-key" ⇒ 脚本内探活+重试。
3. 连续 hdc 命令会竞争通道 ⇒ 每个动作独立脚本、内部串行、加 sleep。
4. 钉钉/微信自动弹前台 ⇒ 点坐标前必须截图确认目标 App 在前台（本次验证多次被钉断层）。
5. `uitest dumpLayout` 图标类 Image 无 accessibilityText，坐标解析只能靠 bounds，顶层图标坐标体系与底栏不一致，浅色验证因此放弃。
