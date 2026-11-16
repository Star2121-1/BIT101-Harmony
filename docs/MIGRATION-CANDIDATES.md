# 功能迁移候选清单（2026-11-16）

> 三份并行审查（原版 Web → BIT101-S、iOS 原版独有、BIT101-S → 鸿蒙）的结论汇总。
> 目标读者：决定下一批次做什么。**本清单只列候选，不代表已决策开工**。
> 证据均来自源码 grep / 文档原文；「未验」≠「不存在」，「代码在」≠「用户可用」。

## 仓库定位

| 仓库 | 定位 | 当前 HEAD |
|---|---|---|
| `.ref/BIT101` | 原版 Web（Vue），22 路由 | `b8912d7` |
| `.ref/BIT101-iOS` | 原版 iOS，27 个 SwiftPM 模块 | `74848c5` |
| `BIT101-seat` | 我方 Android（BIT101-S） | `7d107ad` |
| `harmony/BIT101-harmony` | 我方鸿蒙（本文主体） | `c160a7d`，alpha.12 |

---

## 结论先行

鸿蒙版**不缺页面**——38 项功能矩阵里绝大多数 Android 能力已落地。真正欠的是三类：

1. **通知发送链路断链**（3 处，逻辑全写好、零引用）——成本最低、价值最直接
2. **工程地基能力**（账号隔离、网络请求边界）——纯客户端、无服务端依赖，但改动面大
3. **社区内容**（文章 / 课程评价 / 订阅）——原版三大支柱，但鸿蒙 §1.2 已决策「不做社区」，**需重新拍板**

高价值但被前置依赖卡住的：可信成绩单（学校接口协议）、云同步（需自建后端）。

## 本轮决策（2026-11-16）

**推荐并已开工：A1 + A2**（M14-A）。理由：判定逻辑与文案早已写好，缺的只是「取数成功那一刻」的接线；
不依赖活 JWT、不碰服务端、不改远端状态；按项目铁律配齐「用户可关 + 去重 + 通知直达对应页」。
落点是 `ServiceAlertRunner` + 两个取数页 + 提醒设置页两项开关，全量单测与 ArkTS 编译门已过；
2026-11-17 真机验了开关持久化、两页落点、图书馆登录后 `cur=ok`（在借 0 本）与“无对象不发”，阈值/临期触发仍缺数据未验。

**随后落地 B3 通知已读快照**（M15-B3）：把「上次打开时刻」换成显式已读键快照，修晚到/重排旧消息被误判已读；
旧时间戳只迁移一次，快照版本化、上限 1024、单键原子写。纯客户端，无服务端依赖。

**A3 座位违约通知暂缓**：依赖活座位 JWT 与 wire 字段核对，当前后端不可验；不能靠推理把通知接上。
**A4 研讨间 UI 暂缓**：`/api/Member/seminar` wire 字段未真机核对，且取消是**对外副作用**，必须用户在场确认。
**B/C/D 档不在本轮**：B 是工程地基需独立批次，C 与「不做社区」边界冲突需重新拍板，D 卡服务端契约。

---

## A 档：立刻可做（逻辑现成，只差接线）

三者完全同型：`判定逻辑已写 + NotifySentStore 去重骨架现成 + InstantNotify 可发 ⇒ 全仓零引用`。建议**一批接完**。

| # | 功能 | 现状证据 | 迁移动作 | 价值 | 成本 | 前置 |
|---|---|---|---|---|---|---|
| A1 | **网费不足 / 流量超阈值提醒** | `corelogic/NetAlertLogic.ts` 全仓仅自身 + 测试引用；`NetPage.refresh()` 取数后从未调用 | 在取到网费/流量那一刻判一次 → 去重 → 发通知 | 高 | 极低 | 无 |
| A2 | **图书馆借阅到期/逾期提醒** | `corelogic/LibBorrowLogic.ts:225 alertRecords`、`:277 noticeBody`、`:291 noticeTitle` 判定与文案齐（隐私边界已锁「不写书名」），但发送链路零引用；`InstantNotify.ts` 只被 `ScoreCheckRunner` 用 | 借阅取数成功那一刻调 `alertRecords` → 去重（复用 `NotifySentStore`）→ `InstantNotify.publishText` | 高 | 极低 | 图书馆登录态（M5-3 已做未验）；移动端深澜接口校外不可达 ⇒ 触发时机必须是「取到数据那一刻」，不能挂周期任务 |
| A3 | **座位违约事后通知** | Android 有 `SeatViolationTracker.observe` + `SeatViolationNotifier`（文案带「违约 N/5，累计 5 次暂停 7 天」）；鸿蒙只有违约卡展示（`SeatPage.ets:819`），无新增违约→发通知链路 | 移植「首次建基线只存不发、新增才通知」+ 固定 id 通知（后发覆盖） | 中高 | 中 | 🔴 **座位活 JWT**（当前后端被封，真机不可验）；wire 字段真机核对 |
| A4 | **研讨间预约查看/取消 UI** | `corelogic/SeminarLogic.ts` 的 `buildCancelSeminarBody`/`parseSeminarCancelResponse` 零引用；`SeatService.seminarReservations()`、`SeatViewLogic.seminarVMs()` 无 UI 消费 | 补页面 + 接线 | 中 | 中 | wire 字段真机核对；**对外副作用（预约变更）必须用户在场确认，不上自动路径** |

> ⚠️ A1~A3 都发即时通知。按项目铁律，对外副作用绝不上无条件自动路径——去重 + 用户可关 + 文案如实，三者缺一不可。

---

## B 档：工程地基（纯客户端，可立即落地，但改动面大）

来自 iOS 的能力对照。价值在于**决定正确性**，不在功能数量。

| # | 能力 | iOS 证据 | 我方现状 | 价值 | 成本 |
|---|---|---|---|---|---|
| B1 | **账号存储身份隔离 + 代际核对** | `Modules/StorageCore/Sources/AppStorageSession.swift`（SHA256 稳定身份、账号级键/目录、访客分区、Keychain、损坏恢复） | 鸿蒙 `SessionStore` 把 JWT 明文存全局 Prefs；两端单账号全局偏好 | 高（切号/退出/迟到结果不串号） | 中（改动面大） |
| B2 | **网络请求预算 / 容量上限 / 取消 / 结构化错误 / 诊断库存** | `Modules/TransportCore/Sources/HTTPBoundedTransfer.swift`、`HTTPRequestEvidence.swift` | 鸿蒙 `core/net/RcpFactory.ts`、Android OkHttp 有超时/证书/cookie，但无系统化预算+容量+代际隔离 | 高（弱网稳定性 + 可诊断性） | 中 |
| B3 | **消息已读快照**（1024 项/分类、版本校验、原子写入、边界推进） | `docs/ARCHITECTURE.md:129`（`message-read-snapshot.json`） | 鸿蒙仅一个时间戳 `NotifySeenStore`；Android 有未读数但机制不同 | 中（"全部已读"后旧消息不复活） | 中 |
| B4 | **系统日历批量导入 / 增量 / 回滚 / 坐标校准** | `docs/ARCHITECTURE.md:235` | Android 仅单条 `ACTION_INSERT` + ICS 交接；鸿蒙未见日历写入 | 中高 | 中（系统日历权限） |
| B5 | **实况窗（Live Activity 等价形态）** | `Modules/ScheduleActivityContracts/Sources/ScheduleSharedLiveActivity.swift` | 鸿蒙有 LiveViewKit 未用；Android 前台服务+锁屏通知未用于课表 | 中（锁屏看下一节课/DDL 倒计时） | 中 |
| B6 | **UI 交互覆盖门禁 + 失败保留元素树/截图** | `docs/UI_INTERACTION_COVERAGE.md`、`TESTING.md` | 鸿蒙有 `test-uiconventions` 静态栅栏，但无逐控件交互合同 | 中（工程能力，防 UI 回归） | 中 |

---

## C 档：原版社区内容（需重新拍板）

原版 Web 的三大内容支柱，Android 与鸿蒙**都没有**。但鸿蒙 ROADMAP §1.2 已决策「不做社区」——严格说这些属于新增产品线，不是"迁移缺口"。

| # | 功能 | Android 现状 | 证据 | 价值 | 成本 | 卡点 |
|---|---|---|---|---|---|---|
| C1 | **文章（Paper）列表/详情** | API 齐全、业务零调用 | `api/.../PapersApiService.kt`；`NavDestConfig.kt:13-28` 无目的地 | 高 | 小（只读） | 需推翻「不做社区」决策 |
| C2 | **文章发布/编辑**（富文本、匿名、`publicEdit` 协作） | API 齐全、业务零调用 | `PapersApiService.kt:26-40`；`Papers.kt:31,44,59` 有 publicEdit | 高 | 大（EditorJS 富文本是主要工作量） | 同上 |
| C3 | **课程库 + 星级评价 + 教师反查** | API 齐全、`Comment.kt:28` 有 `rate` 字段、业务零调用 | `api/.../CoursesApiService.kt:16-26` | 高（选课决策；可与本地课表联动，Web 做不到） | 中 | 同上 |
| C4 | **订阅（插眼 4 级）+ 订阅列表 + 订阅消息分类** | 全仓零命中 | `MessageType.kt:4-7` 仅 4 类；`/subscriptions` 无 Retrofit service | 高 | 中 | 同上 + 服务端 |
| C5 | **课程资料上传**（3.2MB 分块 + 4 类别 + 回执） | API 链齐全、业务零调用 | `CoursesApiService.kt:28-38`；`MaterialType.kt` | 中高 | 中 | 同上；上传发公共服务器，先只读、上传单独确认 |
| C6 | **课程历史趋势图** | API 齐全、零调用 | `CoursesApiService.kt:46-49` | 中 | 小 | 同上；可与 C3 一次做 |
| C7 | 注册入口（邮箱验证码 / 统一身份认证） | API 齐、登录页只有登录动作 | `UserApiService.kt:29-37`；`LoginPage.kt:41-66` | 中 | 小 | 不涉及社区，可独立做 |
| C8 | 首页轮播/公告栏 | `VariablesApiService` 零调用 | `VariablesApiService.kt:10-16` | 低中 | 小 | 运营位需求确认 |

> C 档有个矛盾要解：文章/课程评价属于**内容库**而非社交话廊，与「不做社区」决策的边界模糊。建议单独拍板，不要顺手做。

---

## D 档：高价值但被前置依赖卡住（暂不动）

| 能力 | 价值 | 卡点 |
|---|---|---|
| **可信成绩单** | 高（毕业/求职刚需），两端空白 | 学校可信成绩单接口协议 + 验证码认证通道；鸿蒙当前明确不放入口（无契约依据） |
| **课表云同步 + 三方冲突决策** | 高（换机不丢） | iOS 用 CloudKit，**不可直接迁移**；需自建云同步后端 + 冲突协议，属重构 |
| **成绩 KVS 加密云同步** | 中 | 同上，平台绑定 |
| **Watch App / Watch Widget** | 低（用户面窄） | watchOS/硬件绑定，暂不可行；鸿蒙穿戴形态不同 |
| **待确认发布事务日志 + 读回确认** | 高（弱网不重复发帖） | 需服务端按幂等键去重；依赖 C 档社区先立项 |

---

## E 档：明确不迁移（已决策，别反复讨论）

NFC 校园卡（鸿蒙无三方 NFC reader API）· 话廊/发帖/举报/用户主页/关注列表 · 应用内自更新（AppGallery 唯一正道）· 一卡通流水（学校限定钉钉）· 后台抢座轮询（长时任务类型不含，已降级前台监控）· 校园支付/闸机 · 一卡通明细。

平台适配差异不是遗漏：CAS WebView→纯 HTTP、Room→Preferences、WorkManager→代理提醒、RemoteViews→Form Kit、Hilt→手工单例。

---

## 建议的批次顺序

1. **M14-A（本轮已做）：A1 + A2**，共用 `InstantNotify` 骨架；流量/借阅的去重状态单独落盘，不用会被 14 天 prune 的 `NotifySentStore`。
2. **M14-A+（待 JWT）：A3 座位违约通知**——先核对 wire 字段，再做「首次建基线、新增才通知」。
3. **M14-B：研讨间 UI**（A4）——需先真机核对 wire 字段。
4. **M15：工程地基**（B1/B2/B3）——B3 已落地（已读快照），B1/B2 改动面大，单独立项。
5. **C 档先拍板再做**——尤其 C1~C6 与「不做社区」的边界。

⚠️ 本清单**不含真机验证债务**：ROADMAP 中标 🔄 的 20 多项是「代码完成未验」，属于验证批次，不是迁移缺口，别混进来充数。
