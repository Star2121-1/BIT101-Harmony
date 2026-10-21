# BIT101 Harmony

北京理工大学（BIT）校园助手的 **HarmonyOS NEXT** 版本。课表、空教室、「现在去哪儿自习」、班车时刻、考试安排、座位查询。

> **非官方客户端**：与学校及任何校内机构无关，纯个人项目，仅供学习交流。
> 接口来自学校公开的服务，随时可能变更；请不要用于任何违规用途。

---

## 为什么单独做一版

Android 版是用 WebView 承载学校 CAS 登录页的，在 HarmonyOS 上这条路走不通：登录页的 Angular 应用能加载、脚本也跑了，但**表单输入框永远不渲染**（实测 `inputs=0`），页面上只剩第三方登录（微信 / SAML / Office365）。

所以这版改成**纯 HTTP 协议登录**，完全不依赖 WebView：

```
取登录页 → 解析六锚点 → AES 加密口令 → USTS 风控指纹
  → POST 得 302 + ticket → phpCAS → seatlib JWT → 业务接口
```

全链路已在真机逐环节验证（含对照组：不给 token 时业务接口返回 `code=10001`，给真 token 返回 `code=1`）。

---

## 现在能做什么

| 功能 | 状态 | 说明 |
|---|---|---|
| 学号密码登录 | ✅ | 纯 HTTP，密码不落盘 |
| 登录态持久化 | ✅ | 冷启动靠落盘会话静默恢复，不用重登 |
| 课表网格 | ✅ | 13 节 × 7 天，课程 12 色，跨节次合并 |
| 学期 / 周次切换 | ✅ | 一次拉回 61 个学期 |
| **教学调整（放假 / 补课）** | ✅ | 自动识别「10/10 按周四课表上课」这类通知 |
| 课表离线可读 | ✅ | 有缓存先上屏，刷新失败会如实标注「显示的是缓存」 |
| 考试安排 | ✅ | 日期 / 时间 / 地点 / 座位号 |
| 空教室查询 | ✅ | 校区 → 楼 → 教室，逐节显示忙闲 |
| **「现在去哪儿自习」** | ✅ | 有课就告诉你正在上什么；空闲给 8 个候选，可换一批 |
| 班车时刻 | ✅ | 两站，末班判定「今天已发完」 |
| 深色模式 | ✅ | 三档（跟随系统/浅色/深色），由 WCAG 对比度单测钉住 |
| 作息自定义 | ✅ | 13 节可改，重叠/越界会被拦下并说明原因 |
| **手动改课表** | 🔄 | 代码完成：改教室/时间/周次、隐藏已退的课、新增旁听课；同步课表不会冲掉修改（覆盖层） |
| **延河课堂作业（DDL）** | ✅ | App 内 Web 登录抽 cookie → 同步截止时间；未完成/已完成两栏，勾选杀进程不丢 |
| **课程动态** | ✅ | 各课程最新活动流；点条目在 App 内 Web 壳带会话打开课程页 |
| 图书馆借阅 | 🔄 | 代码与单测完成（当前在借/历史 + 到期倒数），待真机登录验证 |
| **一卡通余额** | 🔄 | 代码与单测完成（余额 + 近 N 天趋势，「请求失败≠未登录」三态分离），待真机登录验证 |
| **校园网流量** | 🔄 | 代码与单测完成（本月流量/今日用量/月末预测；三态分离：在线 / 未认证给登录入口 / 不在校园网），待真机验证 |
| **「我」页** | 🔄 | 代码完成：账号状态 + 一卡通/校园网/图书馆三卡摘要（各自兜底）+ 作业与设置入口；待真机验证 |

**还没做的**：座位预约的选座界面、桌面卡片、校园地图、成绩查询。

**不做**：NFC 校园卡（设备与协议都不支持）、社区论坛。

进度台账见 [`docs/ROADMAP.md`](docs/ROADMAP.md)（54 项任务，含每项的验收判据）。

---

## 构建

需要 **DevEco Studio** 或 HarmonyOS **command-line-tools**（`targetSdkVersion` / `compatibleSdkVersion` 均为 **26.0.0**）。

```bash
# 用 DevEco Studio 直接打开工程即可
# 命令行构建（以 clt 为例，注意必须指定 SDK 路径）：
DEVECO_SDK_HOME=/path/to/commandline-tools/sdk \
  hvigorw --mode module -p product=default -p module=entry@default \
  -p buildMode=debug assembleHap --no-daemon
```

产物：`entry/build/default/outputs/default/entry-default-signed.hap`

> 未指定 SDK 路径时构建会直接失败（`DEVECO_SDK_HOME` 缺失）。这不是环境问题，是本工程没做默认推断。

### 签名（clone 后必看）

仓库里的 `build-profile.json5` **不含签名配置**（`signingConfigs: []`），所以直接构建出的是
`entry-default-unsigned.hap` —— 能验证代码可编译，但**装不到真机**。

要出可安装的 signed hap，二选一：

- **DevEco Studio**：`File > Project Structure > Signing Configs` → 勾 **Automatically generate signature**
- **命令行**：在 `build-profile.json5` 的 `app` 里补回 `signingConfigs`，并给 `products[].signingConfig` 写上 `'default'`

签名材料（`.p12` / `.cer` / `.p7b`）与密码**一律不入库**（`.gitignore` 已拦住）。原工程里那份配置含
本机绝对路径 `C:\Users\...`，放进仓库会让所有人 clone 后构建失败。

---

## 测试

单测是**纯 Node 跑真源码**（`--experimental-strip-types` 直接吃 `.ts`），不需要鸿蒙 SDK、不需要设备：

```bash
node --version          # 需要 22.6+（支持 --experimental-strip-types）
bash tools/run-tests.sh # 17 个套件，802 条断言
```

| 套件 | 断言数 | 测什么 |
|---|---|---|
| `test-parser` | 31 | CAS 登录页解析（吃真机抓的原始 HTML fixture） |
| `test-teaching` | 50 | 教学调整通知解析（表格 + 四种句式） |
| `test-edges` | 40 | 节次 / 周次 / 日期边界 |
| `test-shuttle` | 30 | 班车时刻表 |
| `test-colors` | 83 | 深浅两套配色的 WCAG 对比度（含 24 个课程色组合） |
| `test-timetable` | 28 | 作息表校验（重叠/越界/往返）与「改时间→文案变」 |
| `test-eclass` | 40 | eclass 契约字段解析 + 课程/动态模型 |
| `test-ddl` | 39 | DDL 合并规则（保留 done）+ remainTime 口径 1:1 Android |
| `test-libborrow` | 68 | 图书馆借阅解析（JSON 套 HTML 套 JS 数组）+ 到期判定 + 「通知不含书名」 |
| `test-routes` | 33 | 路由守卫：所有 `router.pushUrl` 目标都必须在 `main_pages.json` 里（漏了 = 页面不进编译器，构建假绿） |
| `test-card` | 70 | 一卡通解析（最终 URL 判登录、余额字段去重）+ 趋势口径（7 天窗口、样本不足如实降级、残差按无变化） |
| `test-net` | 77 | 校园网 CSV 解析 + 三类结果 + **计费周期重置**（累计变小 ⇒ 旧采样全废）+ 月末预测 |
| `test-overlay` | 51 | 改课表覆盖层：改/藏/加、HIDE 优先、**锚点与显示值分离**（改时间仍匹配原课）、脏数据跳过 |
| `test-netalert` | 29 | 校园网提醒判定：流量 270/300 每周期各一次、越限不补发接近档；网费 <10 元按天去重；文案逐字对照 Android |
| `test-notify` | 32 | 通知历史：合并三条纪律（**已发不回滚** / 独有 key 保留 / 同 key 覆盖显示）+ 14 天双锚点清理 + 分类型筛选 |
| `test-schedule` | 37 | 提醒排期：课程周次 01 串→[n] 串（错则一条都排不出）、**考试时刻 fail-closed**（解析不出就整场跳过）、DateTime→本地年月日时分（时区陷阱）、30 条配额裁剪 |
| `test-settings` | 50 | 提醒设置：默认值对齐 `DEFAULT_POLICY`、`toPolicy` 挑 10 项不串不漏、提前量钳制（越界回落最近档）、逐项归一不整块回退 |





CI（`.github/workflows/test.yml`）每次 push 自动跑这些，外加一条**关键资源存在性检查** —— 它守的是两个真实踩过的坑：TLS 中间证书被 `.gitignore` 误伤（编译能过、运行期静默降级）、app 图标被全局 `*.png` 误删。

---

## 目录结构

```
entry/src/main/ets/
├── core/
│   ├── crypto/     AES-ECB、风控指纹、CAS 六锚点与票据解析（纯函数，零依赖）
│   ├── net/        rcp 工厂：TLS 中间证书注入、隔离 cookie 罐、超时分档、域判据
│   ├── model/      课表 / 考试 / 教室等数据模型
│   ├── log/        脱敏日志 + 长文本落盘（hilog 单行会截断）
│   └── theme/      课程色板
├── corelogic/      算法层（13 个模块，从 Android 版移植，纯函数、可单测）
├── data/           Preferences、cookie / JWT / 课表缓存（缓存按学期分键）
├── service/        CAS 登录、教务会话、空教室、自习、教学调整
└── pages/          登录 / 课表 / 考试 / 空教室 / 班车 / 首页

tools/              离线单测 + 真机取证脚本 + fixtures（真机抓取的原始页面）
docs/ROADMAP.md     进度台账
```

---

## 几个花了时间才搞明白的问题（写下来省后来人一轮）

1. **金智 jwapp 的模块接口在「应用配置未加载」时返回 403，不是 401**。必须先 GET `getAppConfig` 预热。坑在于：没 cookie 是 401、有 cookie 是 403 —— 只看状态码会误判成「会话过期」，方向全错。
2. **`autoRedirect` 要按用途分**：phpCAS 链必须 `false`（cas code 藏在 302 的 Location 里）；教务接口必须 `true`（首次访问就是 302 → 换票 → 回应用的正常链）。
3. **ArkUI `ForEach` 用索引当键会复用旧组件**：首帧空列表 → 数据回来后前 N 个键没变 → 复用空单元格，而状态栏已经算出「本周 8 节」。
4. **「今天」的高亮必须连周次一起判**：只比星期几的话，翻到历史周时那一列也被标成「今天」。
5. **「当前学期」不能读「上次查看的学期」**：缓存键必须带学期，否则看过历史学期之后算出来的周次是错的。
6. **`*.pem` 不能进 `.gitignore`**：这个工程依赖一份 TLS 中间证书，忽略后编译照过、运行期静默降级。

---

## 隐私

- 学号密码**只在登录请求里用一次**，不写入任何存储，不进日志。
- 会话 cookie 与 JWT 存在应用私有目录（`Preferences`），卸载即清。
- 没有任何统计、上报、第三方 SDK。
- 仓库里公开的 fixture 是**登录页原始 HTML**（浏览器打开就能看到的内容），不含任何票据、cookie 或学号。

---

## 许可

尚未指定开源许可证（即默认保留所有权利）。如果你要复用其中代码，请先开 issue 说明用途。

学校名称、课程数据等归各自权利人所有；本仓库只包含客户端代码与脱敏后的测试样例。
