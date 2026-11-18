# 全功能对齐计划（2026-11-17）

> 目标：把 Android `BIT101-seat` 的话廊/发帖/举报/用户/关注、NFC、地图、一卡通、更新、座位等能力尽量搬到鸿蒙，
> 登录尽量一次 CAS 验证覆盖全部子系统，UI 以 Android Compose 为基准逐页对齐。
>
> **本文只列范围与边界，不代表“全部都能做”**。平台不可行/合规禁止的项单独标注，避免把不可实现的东西写进承诺。
> 进度以 `ROADMAP.md` 和任务列表为准；本文件负责“做什么、为什么、先后顺序”。

---

## 0. 结论先行

| 能力 | 结论 | 依据 |
|---|---|---|
| NFC 读 UID / technology / NDEF | **可做** | HarmonyOS `@kit.ConnectivityKit` 的 `tag` / `nfcController` 有对等 API |
| NFC 读 CPU 卡 APDU（IsoDep） | **可做，需真机验证** | `IsoDepTag.connect/transmit` 官方存在；目标机型是否下发 ISO_DEP 需真机确认 |
| NFC 读 Mifare Classic 扇区 | **API 存在，收益不确定** | `authenticateSector/readSingleBlock` 存在；校园卡密钥可能不是默认值 |
| NFC 写校园卡 / 模拟刷卡 / 过闸 | **不做** | 写卡可能损坏一卡通；HCE 只覆盖 APDU，Classic 不在通道内；闸机涉行踪合规 |
| 校园支付 / 充值 | **不做** | 资金合规 + 学校不对第三方开放；第三方代收代付风险不可控 |
| 话廊 / 发帖 / 举报 / 用户主页 / 关注列表 | **可做** | Android 有完整 API、Repo、Compose 页面；鸿蒙当前只有占位 |
| 图片上传 | **可做** | `POST /upload/image`，part 名 `file`；鸿蒙用 photoAccessHelper + RCP multipart |
| 地图瓦片 | **需决策/基础设施** | 鸿蒙 Map Kit 不能换瓦片源；Android 用个人反代，无 SLA |
| 一卡通余额 + 趋势 | **已做** | 现有 CampusCardService/Store |
| 一卡通流水/明细 | **大概率不可做** | Android 探针实测 302 到充值页、菜单仅钉钉；待 PC UA 桌面模板复核 |
| 应用内自下载 HAP 安装 | **平台不可行** | 系统不允许三方应用安装 HAP；上架后用 AppGallery `updateManager` |
| 后台秒级抢座轮询 | **平台不可行 + 项目禁止** | 长时任务无此类型；自动下单有对外副作用，必须用户在场确认 |
| 一次 CAS 登录覆盖全部 | **大部分可做，eclass 例外** | CAS 会话可下沉到图书馆/一卡通；eclass 是 Keycloak broker，首次仍需 Web 授权 |

---

## 1. 统一登录（P0）

### 现状硬伤

- 鸿蒙有 7 个独立 cookie 罐，`SchoolDomains.ts` 的 `isSsoDomain/isSchoolDomain` **全仓 0 调用**；
  图书馆/一卡通/Eclass 各自 `syncFromWeb()`，所以“登录一次”只对课表生效。
- `CasLoginService.submitSmsCode()` 在 `ensureJxzxSession()` **之前**落盘，短信登录后教务 cookie 不进快照。
- 三个 Store 的 `clear()` 调全局 `WebCookieManager.clearAllCookies()`，清一个子系统会误伤其它 Web 会话。
- 座位 JWT 过期后 `silentRenewJwt()` 生产路径无人调用；座位页没有“授权座位系统”入口。

### 目标

1. 只走一次 `LoginPage` CAS 登录；
2. 图书馆/一卡通能靠 CAS 总钥匙静默建立会话，不再要求单独登录；
3. eclass 首次仍需 Web 授权，但之后持久化，不再反复登录；
4. 切号/退出不串号；
5. 任何自动续期都有退避，绝不在后台触发短信。

### 任务

- **#149 统一登录 SSO**：CAS 会话下沉、短信顺序修复、WebView 双向 cookie 同步、失效三态。
  - 进度：代码 + 25 条单测 + 63/63 套件 + alpha.16 编译门已过；**真机未验**（设备掉线）。
- **#150 账号隔离/退出/座位续期**：SessionStore v2、统一 logout、SeatRenew。

---

## 2. NFC（P1，用户最高优先级）

### 能做

1. 三态检测：无 NFC 能力 / 已关闭 / 可用；
2. 前台 readerMode 读 UID、technology、历史字节；
3. CPU 卡 IsoDep APDU 快速读（`0001~001F`）；
4. 学号连续/分段匹配（Android 真卡实测：`11|06|202413|04|55`）；
5. Mifare Classic 默认密钥**只读**探测（失败即停）；
6. 自有 NDEF 贴纸读/写快捷入口。

### 不做

- 写校园卡任何块；
- HCE 模拟校园卡/门禁；
- 支付、充值、闸机；
- 破解非默认密钥。

### 任务

- **#151 NFC MVP**：能力探测 + UID/tech 诊断页（先验证目标机型下发哪些 tech）。
  - 进度：✅ 2026-11-18 真机已验（UID/technology/readerMode 全通，alpha.17/18）。
- **#152 APDU 快速读 + 学号**（= task #152/#163/#164）：移植 CardProbeLogic/StudentIdScan/BcdScan/CardIdentityLogic，注入式 runner 跑 quickScan。
  - 进度：代码 + 147 条新单测 + alpha.19 编译门已过；**真机待验**（能否从 0016 读出姓名/学号）。
- **#153 Classic 只读 + NDEF 贴纸**：未开始。

### 验收

- 真机贴卡能显示 UID/technology；
- 有 ISO_DEP 时能出 APDU 响应与学号命中/未命中；
- 无 NFC 设备/关闭 NFC 时有明确文案，不是死按钮；
- 所有写路径在源码层不存在（栅栏测试）。

---

## 3. 话廊（P2）

### 范围

| 子功能 | Android 参考 | 鸿蒙做法 |
|---|---|---|
| 四流列表 | `GalleryScreen` + `PostersTabPage` | 推荐/最新/最热先做，关注流需登录 |
| 搜索 | `SearchPage` | 关键词 + 排序 |
| 帖子详情 | `PosterScreen/PosterContent` | 纯文本 + 图片 + 标签 + 创作者声明 |
| 评论 | `CommentCard/MoreCommentsPage` | 只读树 + 二级页；写入在 #155 |
| 用户主页 | `UserScreen` | 头像/昵称/身份/UID/粉丝关注/帖子 |
| 关注列表 | `MyFollowListScreen` | 只读分页 |
| 消息中心 | `MessageScreen` | 4 分类 + 未读 + `last_id` 游标 |
| 发帖/编辑 | `PostEditScreen` | 纯文本 + 图片 + 标签；不接 EditorJS |
| 点赞/评论/举报/关注 | `PosterViewModel/ReportScreen` | 写操作，用户在场 |

### 关键约束

- BIT101 社区鉴权是 **`fake-cookie` 头**，不是学校 cookie；401 时静默刷新一次，失败清会话。
- JSON 字段是 **snake_case**；`page` 从 0 开始；消息用 `last_id`。
- 图片上传 part 名必须是 `file`；选图即上传，提交前必须全部 Success。
- 匿名/公开是提交字段，不要自行隐藏服务端下发的用户信息。
- **不做 EditorJS 插件渲染**：Android 本身也不解析 `plugins`，鸿蒙保持纯文本等价。
- `publicEdit` 只存在于 `papers`，话廊没有协作编辑，不规划。

### 任务

- **#154 话廊只读**（列表/搜索/详情/评论/用户/关注/消息）。
- **#155 话廊写操作**（发帖/编辑/图片/点赞/评论/举报/关注/资料）。

---

## 4. 地图（P3）

### 事实纠正

鸿蒙 `CampusMapPage` **不是在线 OSM 瓦片**，而是楼栋索引 + `geo:` 打开系统地图；没有瓦片、没有 Marker、没有 GPS。
Android 有瓦片（`map.bit101.flwfdd.xyz`，个人反代，z15~z18），但也**没有建筑多边形、没有定位蓝点、没有导航**。

### 分两步

1. **无服务端**：补珠海/嘉兴校区、校区定位语义、课表/考试教室跳转高亮；
2. **需决策**：自绘 Canvas 瓦片 / Web 组件 / 维持楼栋索引。Map Kit 不能替换瓦片源；OSM 官方瓦片不允许 App 批量直连。

任务 **#156**。

---

## 5. 一卡通（P3）

- 余额 + 多字段 + 7 天趋势：**保留**；
- 流水/明细：Android 探针已证 Web 端 302 到充值页、菜单仅钉钉；先用 PC UA 桌面模板复核“我的账户”是否有独立入口。
- 若仍不可达：文案明确“流水请在 i北理（钉钉）查看”，不伪造原生流水。
- 任务 **#157**。

---

## 6. 更新 / 后台 / 支付（P4）

| 项 | 结论 | 任务 |
|---|---|---|
| 版本检查 | 可做；接口可信边界需确认 | #158 |
| 应用内自下载 HAP | 平台不可行；上架后用 AppGallery updateManager | #158 |
| 后台秒级抢座 | 平台不可行；只做前台监控 + 通知，不自动下单 | #158 |
| 校园支付/闸机 | 合规禁止；只保留说明，不给支付入口 | #159 |

---

## 7. UI 对齐

基准优先级：
1. **同机 Android App**：结构、交互、间距、层级；
2. Android Compose 源码：`PosterCard`、`GalleryScreen`、`PosterContent`、`UserScreen`、`NfcSettingPage`；
3. 现有鸿蒙 `GridTokens` 三套皮肤：颜色按鸿蒙主题走，**不照抄 Android 动态色**。

每页交付：
- 截图对照（亮色 + 深色）；
- 结构差异清单（有/无、顺序、层级）；
- 文案逐字对照；
- 空态/错误态/加载态三态齐全。

任务 **#160**。

---

## 8. 执行顺序

1. #148 总台账（本文件）
2. #149 统一登录 SSO
3. #150 账号隔离/退出/座位续期
4. #151 NFC MVP（能力探测 + 诊断页）
5. #152 NFC APDU + 学号
6. #153 NFC Classic + NDEF
7. #154 话廊只读
8. #155 话廊写操作
9. #156 地图
10. #157 一卡通流水核实
11. #158 更新 + 座位监控修正
12. #159 支付/闸机结论
13. #160 UI 全量对齐（贯穿各阶段）

> 每个任务都必须有：可证伪单测/源码栅栏、`assembleHap` 编译门、能真机验的写清“验了什么/没验什么”、证据归档 `harmony/evidence/`、GitHub 提交。
