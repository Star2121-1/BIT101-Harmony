# 05 NFC / 校园卡 —— Android ↔ 鸿蒙 功能对齐差距文档

> 审计性质：**只读、可证伪**。本次只读源码与文档，未改任何源码、未跑构建/真机/网络、未提交 git。
> 立场边界：NFC 写卡、模拟刷卡、过闸机、支付/充值、破密钥、猜 6982 门后内容**一律不做**（第 5 节）；用户多次要求破密钥/猜门后均被拒，立场不变。本审计**不因 Android 端存在"写自有贴纸""试多个默认密钥"的代码路径，就建议鸿蒙放宽**。
> 进度数字：**仅引用 `docs/ROADMAP.md`**。`FULL-PARITY-PLAN.md` 只用于判定范围与边界，不引其进度结论。
> ⚠️ 状态判定从严：⚠️ 不写成 ✅；无代码/文件支撑的一律写「未找到证据」。

---

## 1. 域范围与已读文件

### 1.1 域范围

**纳入**：NFC 设备能力三态、前台 readerMode、UID/technology/NDEF 读取、CPU 卡 ISO 7816-4 APDU 只读探测（快速读 / 深度 dump / 6982 认证门只读研究）、Mifare Classic 全扇区**只读** dump、卡区域语义、NFC 应用层功能（保存卡名片 / 贴卡即用 / 贴纸快捷入口）、NFC 诊断页与设置页、两端平台 API 差异。

**相邻域排除（重要，避免重复）**：一卡通余额 / 趋势 / 消费流水的**网络侧与数据层**归域 03「成绩/图书馆/一卡通」——鸿蒙 `CampusCardService.ts`、`CampusCardLogic.ts`、`CampusCardBalanceLogic.ts`、`CampusCardStore.ts`、`CardCookieStore.ts`，Android `data/.../repo/{DefaultCampusCardRepo,CampusCardRepo}.kt`、`data/.../school/{CampusCardSnapshot,CampusCardLogic,CampusCardBalanceLogic,CampusCardBalanceStore}.kt`、`api/src/probe/.../CampusCardProbe.kt`。本文只把 `pages/CardPage.ets`、`pages/CardLoginPage.ets` 作为**页面入口**提及，不展开余额逻辑（已与 `gap03-score-lib` 通信协调）。佐证：对 `BIT101-seat/data/src/main/java/cn/bit101/android/data/school/*CampusCard*.kt` 检索 `nfc|uid|读卡|扇区|贴卡|卡号|tag` → **No matches found**，确认这批文件不含 NFC 读卡逻辑。

**已知边界（不可越界）**：
- NFC 写卡 / 模拟刷卡 / 过闸 = 明确不做（写卡可能损坏一卡通；HCE 只覆盖 APDU 无 Crypto1；闸机涉行踪合规）；
- Mifare Classic 只做**只读 dump**、绝不破密钥；
- 6982 认证门为**质询-应答型**、不破密钥、不猜门后；
- 鸿蒙已真机验 UID + IsoDep/MifareClassic/NdefFormatable、APDU 快速读（姓名/学号/日期/卡号）、全扇区只读 dump（ROADMAP M16-2/3/5/6/7 行）。

### 1.2 实际读过的文件路径

**Android（`BIT101-seat`，均排除 build/ 产物）**

| # | 路径 |
|---|---|
| 1 | `features/nfc/src/main/java/cn/bit101/android/features/nfc/NfcCapability.kt` |
| 2 | `features/nfc/src/main/java/cn/bit101/android/features/nfc/NfcController.kt` |
| 3 | `features/nfc/src/main/java/cn/bit101/android/features/nfc/NfcTap.kt` |
| 4 | `features/nfc/src/main/java/cn/bit101/android/features/nfc/NfcTapStore.kt` |
| 5 | `features/nfc/src/main/java/cn/bit101/android/features/nfc/NfcTapWatcher.kt` |
| 6 | `features/nfc/src/main/java/cn/bit101/android/features/nfc/NfcShortcut.kt` |
| 7 | `features/nfc/src/main/java/cn/bit101/android/features/nfc/NfcSettingPage.kt` |
| 8 | `features/nfc/src/main/java/cn/bit101/android/features/nfc/SavedCardStore.kt` |
| 9 | `features/nfc/src/main/java/cn/bit101/android/features/nfc/logic/NfcCardLogic.kt`（含 `RawTag`/`CardKind`/`StudentIdScan`/`NfcCardLogic`） |
| 10 | `features/nfc/src/main/java/cn/bit101/android/features/nfc/logic/CardProbeLogic.kt` |
| 11 | `features/nfc/src/main/java/cn/bit101/android/features/nfc/logic/CardIdentityLogic.kt` |
| 12 | `features/nfc/src/main/java/cn/bit101/android/features/nfc/logic/ClassicProbeLogic.kt` |
| 13 | `features/nfc/src/main/java/cn/bit101/android/features/nfc/logic/BcdScan.kt` |
| 14 | `features/nfc/src/main/java/cn/bit101/android/features/nfc/logic/NfcTapLogic.kt` |
| 15 | `features/nfc/src/main/java/cn/bit101/android/features/nfc/logic/NdefShortcutLogic.kt` |
| 16 | `features/nfc/src/main/java/cn/bit101/android/features/nfc/logic/SavedCardLogic.kt` |
| 17 | `docs/nfc-card-probe.md`（本次读第 1–45 行：§0 红线、§1 卡型、§2 Classic 基线） |
| 18 | `data/src/main/java/cn/bit101/android/data/school/*CampusCard*.kt`（Grep 边界核对，无 NFC 命中） |

另有 `logic/NdefShortcutLogic.kt`、`logic/NfcTapLogic.kt` 等的对应单测文件在目录中存在（Glob 到 `src/test/.../logic/*Test.kt`），本次未逐行读，不作为行级证据。

**鸿蒙（`BIT101-harmony`）**

| # | 路径 |
|---|---|
| 1 | `entry/src/main/ets/corelogic/NfcLogic.ts` |
| 2 | `entry/src/main/ets/corelogic/NfcModels.ts` |
| 3 | `entry/src/main/ets/corelogic/CardProbeLogic.ts` |
| 4 | `entry/src/main/ets/corelogic/CardProbeRunner.ts` |
| 5 | `entry/src/main/ets/corelogic/CardIdentityLogic.ts` |
| 6 | `entry/src/main/ets/corelogic/StudentIdScan.ts` |
| 7 | `entry/src/main/ets/corelogic/BcdScan.ts` |
| 8 | `entry/src/main/ets/corelogic/AuthGateLogic.ts` |
| 9 | `entry/src/main/ets/corelogic/DeepScanLogic.ts` |
| 10 | `entry/src/main/ets/corelogic/ClassicScanLogic.ts` |
| 11 | `entry/src/main/ets/service/NfcService.ts` |
| 12 | `entry/src/main/ets/pages/NfcPage.ets` |
| 13 | `entry/src/main/ets/pages/CardPage.ets`（页面入口） |
| 14 | `entry/src/main/ets/pages/CardLoginPage.ets`（页面入口） |
| 15 | `docs/NFC-CARD-REGIONS.md`（全文 324 行） |
| 16 | `docs/ROADMAP.md`（读 143–158、555–580 行；另 Grep 259–265、362–369、570 行） |
| 17 | `docs/FULL-PARITY-PLAN.md`（读 57–90 行；另 Grep 15–19、82、165、183–185 行） |
| 18 | `docs/README.md`（Grep 11–12、41 行） |
| 19 | `entry/src/main/ets/` 全目录 Grep：`SavedCard｜贴卡即用｜NfcTap｜writeNdef｜writeNdefMessage｜pendingWrite｜NdefFormatable｜historicalBytes｜ATS｜bit101://nfc｜nfc/shortcut｜routeOfTag｜shortcut` → 仅命中 `NfcLogic.ts:65` 的 tech 名字符串 `'NdefFormatable'`，**无其它实现** |
| 20 | `evidence/**`、`tools/*`（Glob 核对证据与单测文件名） |

### 1.3 证据分级与「未找到证据」声明

| 级别 | 含义 | 本次可核对象 |
|---|---|---|
| A | 本次实际打开、行号可核的源码 | 上表两端 `.kt`/`.ts`/`.ets`，证据列写 `file:line` |
| B | 本次实际打开的文档 | `ROADMAP.md`、`FULL-PARITY-PLAN.md`、`NFC-CARD-REGIONS.md`、`nfc-card-probe.md:1-45`、`README.md` |
| C | 文档**引用**、但本次在工作区**未找到文件**的原始真机日志 | 见下方清单。**仅登记为文档引用，不据此下任何新结论** |

**缩写**：`A:` = Android 路径；`H:` = 鸿蒙路径；`R:` = `docs/ROADMAP.md` 行；`REG:` = `docs/NFC-CARD-REGIONS.md` 行；`FP:` = `docs/FULL-PARITY-PLAN.md` 行；`E:` = `evidence/` 下证据名。

**C 级（文档引用、本次 Glob 未找到文件）**：`evidence/m14-alerts-20261116/device-*.json/png`、`device-a19-probe-hilog.txt`、`device-authgate-hilog.txt`、`device-a21-full-dump.txt`（365 条）、`device-a22-classic-result.json`、`AUTH-GATE-REPORT.md`、`device-49-v17-nfc.png`、`device-51-v17-nfc-scan.png`、`device-55/56/57-v18-*`、`device-63/64/67/69-a19-*`、`device-73-a20-authgate-result*`、`device-v17-sso-nfc-hilog.txt`。来源 `REG:11-16`、`R:562-571`、`R:147-153`。**本次 `evidence/**` Glob 中确实不含上述文件**（只有座位/UI/device-alpha28/device-a44/s4-sidecheck 等），故统一标注「未找到证据文件」。

**B 级真机证据路径（文档内文字，已读）**：
- Android 基线：`BIT101-seat/docs/nfc-card-probe.md`（393 行真卡实测，本次读 1–45 行）——**文件实际存在**。
- 鸿蒙进度与验收数字：`R:562`（M16-2）、`R:563`（M16-3）、`R:564`（M16-5）、`R:566`（M16-6）、`R:571`（M16-7）、`R:570`（M16-10）、`R:147-152`（alpha.22/21/20/19/18/17 版本行）。
- 卡区域语义：`REG:20-72`（双通道/Classic）、`REG:76-200`（MF/FID/目录/认证门）、`REG:204-253`（365 条 dump）、`REG:285-317`（速查/卡里没有什么）、`REG:321-323`（边界声明）。
- 设备与卡：鸿蒙真机 `4CY9K25614019980`（alpha.17~22 debug）、UID `77 75 F0 7B`；Android 开发机 ZTE NP05J 无 NFC 硬件，真卡数据来自另一台带 NFC 安卓机**七次贴卡**（`docs/nfc-card-probe.md:3-4`）。

---

## 2. 功能对照表

**状态图例**：✅ 两端对齐（含真机证据）｜⚠️ 部分差异 / 口径不同 / 未找到证据（**不写成 ✅**）｜❌ 鸿蒙缺失（Android 有）｜⛔ 平台不做（平台限制，非红线）｜🚫 红线禁做（明确决策排除，绝不实现）｜✅增 = 鸿蒙侧增强、Android 无对等实现（**非 parity 缺口**，不要求 Android 补齐、不建议删除）。

### A. 能力与基础读卡（N01–N10）

| 编号 | 能力 | Android | 鸿蒙 | 状态 | 证据（file:line + 真机证据路径） |
|---|---|---|---|---|---|
| N01 | NFC 三态（无能力/已关闭/可用） | `NfcCapability.check`：hasSystemFeature + NfcAdapter.isEnabled | `NfcService.capability`：canIUse(NFC.Core) + nfcController.isNfcOpen | ✅ | A:`NfcCapability.kt:45-57`；H:`NfcService.ts:108-125`；R:562（M16-2 真机「NFC 可用」） |
| N02 | 前台 readerMode 注册/停止 | `enableReaderMode`（NFC_A/B/F/V + SKIP_NDEF_CHECK） | `tag.on('readerMode', [NFC_A,NFC_B,NFC_F,NFC_V])`，`running` 幂等 | ✅ | A:`NfcController.kt:133-156`；H:`NfcService.ts:131-170`、`477-494`；R:562、R:152（`NfcService reader started`） |
| N03 | UID 读取与展示格式 | `uidHex` **紧凑无分隔符** `7775F07B` | `uidText` **空格分隔** `77 75 F0 7B` | ⚠️ | A:`NfcCardLogic.kt:454-455`；H:`NfcLogic.ts:52-54`、`NfcPage.ets:378-380`；R:562（鸿蒙显示空格分隔）；REG:3、REG:65 |
| N04 | technology 列表去重 | `techShortNames()` 用 `.distinct()` | `techListText()` 直接 `join`，**不去重** | ⚠️ | A:`NfcCardLogic.kt:450-451`；`docs/nfc-card-probe.md:28`（「NfcA 会重复出现，展示时要 distinct」）；H:`NfcLogic.ts:74-80`；R:152（鸿蒙真机显示 `IsoDep / NfcA / NfcA / MifareClassic / NdefFormatable`） |
| N05 | ISO 14443-4 历史字节 / ATS | `IsoDep.historicalBytes` → `historicalHex` 展示 | **未找到证据**（Grep `historical/ATS` 无实现） | ⚠️ | A:`NfcController.kt:257-265`、`NfcCardLogic.kt:499`；H:未找到证据 |
| N06 | 卡大类枚举（CPU/Classic/贴纸/NFC_V/UNKNOWN，IsoDep 优先） | `CardKind` 5 类 + `recognize()` | 仅 `supportsApdu`/`isMifareClassic` 两个布尔 | ⚠️ | A:`NfcCardLogic.kt:46-65`、`425-437`；H:`NfcLogic.ts:93-100`；`docs/nfc-card-probe.md:24-27` |
| N07 | 「双界面卡」识别与禁写说明 | `NfcScan.classicCompat` + 页面专门文案 | 仅两个能力 chip，无双界面/禁写说明 | ⚠️ | A:`NfcController.kt:240`、`NfcSettingPage.kt:588-594`；H:`NfcPage.ets:389-402` |
| N08 | NDEF 读取（`ndef=0` 视为正常空） | `readShortcut()`（URI 记录优先、UTF-8 兜底） | `readTag()`→`getNdef().readNdef()`→`ndefRecordText` | ✅ | A:`NfcController.kt:283-294`；H:`NfcService.ts:497-525`、`NfcLogic.ts:113-149`；R:562（`ndef=0` 未验贴纸文本）、REG:32 |
| N09 | NDEF 贴纸快捷 URI 白名单解析（**读方向**） | `NdefShortcutLogic.decode/encode` + `NfcShortcut` 双路（Intent/readerMode） | **未找到证据** | ❌ | A:`NdefShortcutLogic.kt:35-113`、`NfcShortcut.kt:35-81`；H:未找到证据（Grep `bit101://nfc｜nfc/shortcut｜routeOfTag｜shortcut` 无命中） |
| N10 | 写 / 格式化自有 NDEF 贴纸 | `writeShortcut()`（带 MifareClassic 的卡**直接拒绝写**） | **无写路径**（服务声明「写路径永远不会加进来」） | 🚫 | A:`NfcController.kt:783-847`、`NfcSettingPage.kt:718-764`；H:`NfcService.ts:4-6`、`NfcPage.ets:571`；FP:68-73；详见 R03 |

### B. CPU 卡 APDU 只读探测（N11–N20）

| 编号 | 能力 | Android | 鸿蒙 | 状态 | 证据（file:line + 真机证据路径） |
|---|---|---|---|---|---|
| N11 | APDU 快速读 `quickScan(0001~001F)` | `quickScan()` + 每文件 2 段 | `quickScan()`（SELECT MF + 逐 FID，2 段） | ✅ | A:`CardProbeLogic.kt:441-454`；H:`CardProbeLogic.ts:226-239`；R:563（M16-3 `probe done steps=50`） |
| N12 | 基础轮 `firstRound`（SELECT MF/PSE/PPSE + READ RECORD SFI=1~3） | `firstRound()` 完整一套 | `selectPse/selectPpse` 常量在，但 `quickScan` **不含基础轮** | ⚠️ | A:`CardProbeLogic.kt:306-318`、`NfcController.kt:192-194`；H:`CardProbeLogic.ts:111-124`、`226-239` |
| N13 | 只读闸门白名单（INS A4/B0/B2/C0/CA/84 + CLA 0~3） | `isReadOnly` + `send()` 最后一道门 | `isReadOnly` + `send()` + `isReadOnlyLocal()` 三处 | ✅ | A:`CardProbeLogic.kt:34-41`、`65-73`、`NfcController.kt:763-776`；H:`CardProbeLogic.ts:23-31`、`86-95`、`CardProbeRunner.ts:57-70`、`NfcService.ts:406-417`；`docs/nfc-card-probe.md:8-11` |
| N14 | `6Cxx` 改 Le 重发 / `61xx` GET RESPONSE | `exchange()` 最多 3 轮 | `exchange()` 最多 3 轮 | ✅ | A:`CardProbeLogic.kt:197-206`、`175-180`、`NfcController.kt:706-757`；H:`CardProbeRunner.ts:78-105`、`DeepScanLogic.ts:56-101` |
| N15 | `6981` 改 READ RECORD（当前 EF 与 SFI 两种寻址） | `readRecord(sfi)` / `readRecordCurrentEf` + `readRecords` | `readRecordCurrentEf` + 深度扫描内联 SFI 寻址 | ✅ | A:`CardProbeLogic.kt:107-121`、`167-173`、`NfcController.kt:394-398`、`465-483`；H:`CardProbeRunner.ts:152-164`、`174-183`、`DeepScanLogic.ts:293` |
| N16 | `6986` 目录下钻（≤2 层、每层 ≤2 目录） | `drillIntoDirectories` | `drillDown`（SFI 1~30 + FID 0000~0020，2 层封顶） | ✅ | A:`NfcController.kt:505-546`；H:`DeepScanLogic.ts:273-343` |
| N17 | 深度只读 dump（全 FID + 目录下钻） | `withSfiScan` ≈400 条（SFI 1~30 + FID 0001~00FF + 下钻） | #170 365 条（FID 0000~00FF + 目录）、掉卡熔断 `MAX_FAIL=3` | ✅（口径不同，见 §3.1） | A:`CardProbeLogic.kt:366-411`、`NfcController.kt:206-231`；H:`DeepScanLogic.ts:158-224`、`162-178`；R:566、R:148（365 条/约 6 秒）；REG:204-253 |
| N18 | TLV 摊平展示 + 从 tag `4F` 的 AID 做只读下钻 | `parseTlvs/aidsOf` + `tlvText` + 追加 `SELECT by AID` | **逻辑已实现**（`parseTlvs/aidsOf`）但**未接线**：Runner/DeepScan/页面均无 TLV 列 | ⚠️ | A:`CardProbeLogic.kt:660-709`、`NfcController.kt:320-331`、`910-946`；H:`CardProbeLogic.ts:364-429`、`CardProbeRunner.ts:108-129`（无 tlvs 字段）、`DeepScanLogic.ts`（未 import aidsOf） |
| N19 | `6982` 认证门：记录后跳过 | 深度轮遇 6982 记录、不认证 | 深度扫描 3 处「认证门：不认证、不猜门后」跳过 | ✅ | A:`NfcController.kt:211-231`；H:`DeepScanLogic.ts:208-212`、`286-288`、`334-336`；REG:249-251 |
| N20 | `6982` 认证门**只读类型研究**（GET CHALLENGE、判定质询-应答/权限位、已知/未知分离） | **未找到证据**（Android 无独立研究） | #168 完整实现（7 步、无 0x82、已知/未知分离） | ✅增 | A:未找到证据；H:`AuthGateLogic.ts:72-188`、`NfcService.ts:342-404`、`NfcPage.ets:338-342`；R:564、R:149；REG:185-200、321-323；E:`AUTH-GATE-REPORT.md`（C 级） |

### C. Mifare Classic 只读（N21–N25）

| 编号 | 能力 | Android | 鸿蒙 | 状态 | 证据（file:line + 真机证据路径） |
|---|---|---|---|---|---|
| N21 | 全扇区只读 dump（逐扇区认证 + 逐块读） | `probeClassic`（scan 内 `withClassicScan` 开关，默认开） | #153 独立「Classic dump」模式 | ✅ | A:`ClassicProbeLogic.kt:113-126`、`NfcController.kt:601-656`；H:`ClassicScanLogic.ts:82-123`、`NfcService.ts:283-333`；R:571、R:147（80 条流水）、REG:47-55 |
| N22 | Classic 密钥策略 | `DEFAULT_KEYS` **9 个**候选 × KeyA/KeyB 都试 | **唯一** `FFFFFFFFFFFF` KeyA，认证失败即跳过、不试第二密钥 | ⚠️（**不可反向对齐**） | A:`ClassicProbeLogic.kt:45-55`、`NfcController.kt:667-681`；H:`ClassicScanLogic.ts:21-22`、`92-103`、`NfcService.ts:276-278`；R:571；`docs/nfc-card-probe.md:33`、`41`；详见 §3.1、R07 |
| N23 | 扇区尾块 | `plan()` 跳过尾块（`0 until n-1`） | `runClassicScan` 读**全部块**（含尾块）→ 16×5=80 条 | ⚠️ | A:`ClassicProbeLogic.kt:101-126`；H:`ClassicScanLogic.ts:107-119`；R:571（80 条）、REG:47-49 |
| N24 | Classic 块三栏解码（hex / ASCII / BCD 数字串）+ 块内学号命中 | `BlockView.decode` + `StudentIdScan.find` | 仅 hex + `allZero` 标注 | ⚠️ | A:`ClassicProbeLogic.kt:128-167`、`NfcController.kt:636-648`；H:`ClassicScanLogic.ts:110-119`、`NfcPage.ets:549-564` |
| N25 | 写块 / 写 NDEF / 增值减值 | 源码层禁止 | 源码层禁止（栅栏拆红验证） | 🚫 | A:`NfcController.kt:588-600`；`docs/nfc-card-probe.md:8-15`；H:`ClassicScanLogic.ts:8-9`；R:571（「写块调用/第二密钥均红」） |

### D. 身份识别与结果呈现（N26–N33）

| 编号 | 能力 | Android | 鸿蒙 | 状态 | 证据（file:line + 真机证据路径） |
|---|---|---|---|---|---|
| N26 | 学号连续 / 分段匹配，「疑似」与「已核对」互斥 | `StudentIdScan.find/guess`（分隔符仅 0x01~0x1F） | `StudentIdScan.ts` 同判据 | ✅ | A:`NfcCardLogic.kt:116-407`；H:`StudentIdScan.ts:26-259`、`130-133`；R:563、R:150（真机两路径） |
| N27 | GBK 解码（不可打印 / U+FFFD 返回 null，宁可显示 hex） | `String(bytes, charset("GBK"))` | 注入 `util.TextDecoder('gbk')` | ✅ | A:`CardProbeLogic.kt:610-618`；H:`NfcService.ts:94-97`、`CardProbeLogic.ts:326-355`；R:563、R:150；REG:259-263 |
| N28 | 疑似 BCD 日期扫描（年份窗口 2020~2035、重叠去重、时间仅作后缀） | `BcdScan.scan` | `BcdScan.scan` | ✅ | A:`BcdScan.kt:30-146`；H:`BcdScan.ts:20-135`；REG:264、REG:148-156 |
| N29 | 身份名片（姓名/学号/日期/卡号，日期带「疑似」，卡片照常渲染） | `CardIdentityLogic.summarize/hasPerson` | `CardIdentityLogic.summarize/hasPerson` | ✅ | A:`CardIdentityLogic.kt:71-135`；H:`CardIdentityLogic.ts:46-112`；R:563（姓名「高天翔」） |
| N30 | UID→卡面号候选（6~8 种并列，不挑一个当结论） | `NfcCardLogic.candidates`（8 种） | `cardNoCandidates`（8 种） | ✅ | A:`NfcCardLogic.kt:468-490`；H:`CardIdentityLogic.ts:115-131`；REG:268-281、R:563（`2004217979`） |
| N31 | 结果页「复制诊断文本」+「只看有数据 / 展开全部」 | `dumpOf()` + `hasData` + `showAllProbe` | **未找到证据**（`ForEach` 全量平铺 365/80 条） | ❌ | A:`NfcSettingPage.kt:907-949`、`652-661`、`954-958`；H:`NfcPage.ets:516-529`、`549-564` |
| N32 | 一次贴卡多轮汇总（基础轮 + Classic + 快速/深度一次出结果） | `scan()` 一次自动跑三轮并汇总 `NfcScan` | 4 个**互斥**模式，需切换并重复贴卡 | ⚠️ | A:`NfcController.kt:182-249`；H:`NfcPage.ets:135-149`、`310-336` |
| N33 | 「去系统设置打开 NFC」跳转按钮 | `Settings.ACTION_NFC_SETTINGS` | 仅文案「应用无权替你打开」 | ⛔ 平台不做 | A:`NfcSettingPage.kt:271-277`；H:`NfcPage.ets:73-81`；详见 R01 |

### E. Android 应用层功能（N34–N38）

| 编号 | 能力 | Android | 鸿蒙 | 状态 | 证据（file:line + 真机证据路径） |
|---|---|---|---|---|---|
| N34 | 「我的校园卡」本机持久化名片（姓名/学号/是否核对/卡号/UID/时间；换卡整张替换；忘掉卡） | `SavedCardStore` + `SavedCardLogic.merge/decode` | **未找到证据**（Grep `SavedCard` 无命中） | ❌ | A:`SavedCardStore.kt:23-84`、`SavedCardLogic.kt:29-178`、`NfcSettingPage.kt:100-101`、`160-184`、`298-350`；H:未找到证据 |
| N35 | 学号输入框持久化（填一次自动回填） | `readStudentId/saveStudentId` | `@State studentIdInput` 临时变量 | ❌ | A:`SavedCardStore.kt:76-83`、`NfcSettingPage.kt:97`、`230-232`；H:`NfcPage.ets:39` |
| N36 | 「贴卡即用」（前台常驻只读监听、UID 比对、目标页、未登录分流、默认关、与诊断页互斥） | `NfcTap`/`NfcTapWatcher`/`NfcTapLogic`/`NfcTapStore` | **未找到证据**（Grep `贴卡即用｜NfcTap` 无命中） | ❌ | A:`NfcTap.kt:53-177`、`NfcTapWatcher.kt:31-80`、`NfcTapLogic.kt:27-83`、`NfcTapStore.kt:12-40`、`NfcSettingPage.kt:368-439`；H:未找到证据 |
| N37 | NFC **设置页**（能力/我的卡/贴卡即用/读卡诊断/贴纸快捷 5 区块） | `NfcSettingPage`（由 `features:setting` 挂 `"nfc"` 路由） | 仅诊断页 `NfcPage`（4 模式 + 结果） | ❌ | A:`NfcSettingPage.kt:80-251`；H:`NfcPage.ets:268-583`；R:156（alpha.17「设置页新增 NFC 校园卡」入口） |
| N38 | 卡上余额 / 钱包 / 消费流水 | 不在卡内（一卡通中心后台） | 不在卡内；`CardPage` 明确「网页端跳充值页、不伪造明细」 | 🚫（不猜） | REG:309-317；H:`CardPage.ets:169-176`；详见 R10 |

### F. 红线 / 明确不做（对照表内状态标注，详见第 5 节）

| 编号 | 能力 | Android | 鸿蒙 | 状态 | 证据（file:line + 真机证据路径） |
|---|---|---|---|---|---|
| N39 | 写校园卡任何块 / 给带 Classic 的卡写 NDEF | `writeShortcut` 见 Classic tech 直接拒绝 | 无写路径 | 🚫 | A:`NfcController.kt:783-816`；`docs/nfc-card-probe.md:8-15`；H:`NfcService.ts:4-6`、`NfcPage.ets:571` |
| N40 | HCE 模拟校园卡 / 门禁 | 不做 | 不做 | 🚫 | FP:18、FP:71；H:`NfcPage.ets:571` |
| N41 | 模拟刷卡 / 过闸机 | 不做 | 不做 | 🚫 | FP:18；R:570（M16-10） |
| N42 | 校园支付 / 充值 | 不做 | 不做 | 🚫 | FP:19；R:570（M16-10） |
| N43 | 破解非默认密钥 / 第二密钥 / MFOC / nested auth | `probeClassic` 自称「不破密钥」，但代码含 9 密钥遍历 | 唯一密钥、失败即停（更严格） | 🚫 | A:`NfcController.kt:595-599`；`docs/nfc-card-probe.md:16`、`41`；H:`ClassicScanLogic.ts:4-9`；R:571 |
| N44 | `EXTERNAL AUTHENTICATE(0x82)` / 猜 6982 门后 / 推断密钥算法 | 未找到证据（无此能力） | 明确拒绝、已知/未知分离 | 🚫 | H:`AuthGateLogic.ts:10-14`、`70-71`、`175-188`；REG:198-199、321-323；FP:82 |

**对照表统计**：44 行 = ✅ 对齐 **16** ＋ ✅增（鸿蒙侧增强）**1** ＋ ⚠️ **11** ＋ ❌ **6** ＋ ⛔ **1** ＋ 🚫 **9**。
**差异条数 = 17**（⚠️ 11 + ❌ 6）；**不做项数 = 10**（⛔ 1 + 🚫 9，即第 5 节 R01–R10）。

---

## 3. 关键差异详述

### 3.1 读卡能力

**（1）一次贴卡 vs 四次贴卡（N32）**。Android `NfcController.scan()` 一次贴卡顺序跑「基础 APDU 轮 → Classic 只读轮 → 快速/深度轮」，各自吞异常、前面拿到的数据先落袋，最后汇总成一个 `NfcScan`（`NfcController.kt:182-249`）。鸿蒙 `NfcPage` 用 4 个互斥布尔（`快速读名片 / 研究 6982 / 深度 dump / Classic dump`）分派，同一次贴卡只跑一种（`NfcPage.ets:135-149`、`310-336`），要拿全 4 类结果得切换模式重复贴卡。鸿蒙已有按 UID 去重 `lastProbedUid`（`NfcPage.ets:44-45`、`136-139`），汇总改造需保留它。

**（2）快速读 / 深度读口径**。两端都有 `quickScan(0001~001F)`，鸿蒙真机 50 条流水（R:563）。深度读：Android `withSfiScan` ≈400 条（SFI 1~30 + FID 0001~00FF + 目录下钻，`NfcController.kt:206-231`）；鸿蒙 #170 为 365 条（FID 0000~00FF + 目录内 SFI 1~30 + 目录内 FID 0000~0020，逐段读到 6B00，`DeepScanLogic.ts:158-224`），并有「连续 3 次 transmit 失败熔断」（`DeepScanLogic.ts:162-178`）。两端都到 2 层目录封顶；差异在范围起点、条数与熔断策略，**均为只读**。

**（3）Android 有、鸿蒙未接线的只读探测**：
- `firstRound()`（SELECT MF / PSE `1PAY.SYS.DDF01` / READ RECORD SFI=1~3 / PPSE 对照，`CardProbeLogic.kt:306-318`）；鸿蒙 `CardProbeLogic.ts:111-124` 有 `selectPse/selectPpse` 但 `quickScan` 未纳入。
- TLV 摊平与 AID 下钻：Android 把每条返回 `parseTlvs`→`tlvText`，并对 tag `4F` 的 AID 追加 `SELECT by DF name`（`NfcController.kt:320-331`、`910-946`）；鸿蒙 `CardProbeLogic.ts:364-429` **已实现** `parseTlvs/aidsOf`，但 `CardProbeRunner`、`DeepScanLogic`、`NfcPage` 都没有 `tlvs` 字段或调用（**未接线**，非未实现）。
- 带 SFI 的 `READ RECORD`（P2=(SFI<<3)|4）：Android 是导出函数 `readRecord`（`CardProbeLogic.kt:107-121`）；鸿蒙只在 `DeepScanLogic.ts:293` 内联一条，未抽成通用函数。

**（4）卡型/展示细节**：Android 有 `CardKind` 5 类枚举且 `IsoDep` 必须排在 `MifareClassic` 前（判反会掐掉唯一能安全取数的 APDU 通道，`docs/nfc-card-probe.md:24-27`）、`techShortNames().distinct()` 去重、历史字节 `historicalHex`、紧凑 `uidHex`、「双界面卡」禁写说明（`NfcSettingPage.kt:588-594`）。鸿蒙只有两个布尔 chip（N06/N07）、`techListText` 不去重（N04）、UID 空格分隔（N03）、**历史字节未找到证据**（N05）。这些均为纯展示/纯逻辑差异，见 F05-07/F05-10/F05-11。

**（5）Classic 密钥策略 —— 本域最重要的「不可反向对齐」项（N22）**。Android `ClassicProbeLogic.DEFAULT_KEYS` 列了 **9 个常见默认密钥**，`NfcController.authenticate` 对每个扇区 KeyA/KeyB 都试（`ClassicProbeLogic.kt:45-55`、`NfcController.kt:667-681`）。鸿蒙按真卡实测结论收窄为**唯一** `FFFFFFFFFFFF` KeyA、认证失败即跳过、`绝不试第二个密钥`（`ClassicScanLogic.ts:21-22`、`92-103`、`NfcService.ts:276-278`）。真卡基线本就「16 扇区全部用 FFFFFFFFFFFF KeyA 认证通过、除 UID 块外全零」（`docs/nfc-card-probe.md:30-43`），换密钥只会重复同一结论（`:41`）。**鸿蒙口径更严格、符合红线（R07），绝不能为了「对齐 Android」把鸿蒙改成多密钥试法**——那会越界。N23/N24（尾块、三栏解码）同理属低价值口径差异，只读无害。

**（6）结果呈现（N31）**：Android 有「复制诊断文本」`dumpOf()`（含 TLV/日期/学号，不掺推断，`NfcSettingPage.kt:907-949`）与默认只列 `hasData` 流水 + 一键展开（`652-661`）；鸿蒙 `NfcPage` 把 365 条深度流水、80 条 Classic 流水全量 `ForEach` 平铺（`516-529`、`549-564`），无复制、无折叠。

**（7）计划文字与现行红线的口径张力（如实记录）**：`FULL-PARITY-PLAN.md:66`「能做」第 6 条写「自有 NDEF 贴纸读/写快捷入口」、`FP:81` #153 含「NDEF 贴纸」，但 `R:570`（M16-10）、`NfcPage.ets:571`、`NfcService.ts:4-6` 与本次审计立场均为**纯只读**，且 `FP:89` 验收要求「所有写路径在源码层不存在（栅栏测试）」。本审计**按现行红线处理**：写 / 格式化贴纸不纳入可做清单（R03），仅把**只读解析**部分列为 F05-08；不因计划旧文字越界。

### 3.2 认证门（6982）

- 两端深度扫描遇 `6982` 都**只记录后跳过**（N19），不认证、不猜门后。
- 鸿蒙另有 #168 **只读类型研究**（N20，Android 无对等实现，属鸿蒙侧增强非缺口）：`gateProbeSteps()` 7 步（回 MF → MF/SELECT 0004 → MF/READ → SELECT 0010 → 目录内 SELECT 0004 → 目录内 READ → GET CHALLENGE 8），全部在只读白名单，`probeIsReadOnly()` 校验序列不含写/认证提交命令（`AuthGateLogic.ts:72-82`、`175-188`）；`analyzeGate` 只输出「锁的类型」与「已知 / 未知」分离（`102-164`）。真机判定 SELECT 0004=9000、READ=6982、GET CHALLENGE=9000 + 8 字节随机数 ⇒ **质询-应答型门**（非权限位），R:564、R:149。
- **措辞红线**：「质询-应答」只说明**锁的类型**，不等于「有钥匙」。门后数据、认证密钥、算法（3DES/AES）、是否关联钱包一律标【未知】（`AuthGateLogic.ts:104-108`、REG:198-199、REG:321-323）。
- **两端差异并列保留**：Android 历史文档记「SFI=4 与 0004 都回 6982」；鸿蒙真机为「MF 下 `SELECT 0004`=6A82（文件不存在）、目录 `0010` 内才 6982」（REG:191-200、R:564）。两边都不据此改判门的语义。
- **绝不**：`EXTERNAL AUTHENTICATE(0x82)`、破密钥、爆破、猜门后内容（R08/R09）。

### 3.3 卡区域语义（只读分析结论，不猜）

依据 `NFC-CARD-REGIONS.md`（全文 B 级已读）与 `docs/nfc-card-probe.md:18-43`：

| 区域 | 语义 | 证据 |
|---|---|---|
| technology | `IsoDep / NfcA / NfcA / MifareClassic / NdefFormatable`，**双界面卡**；`IsoDep` 判定优先于 `MifareClassic` | REG:20-35、REG:289-291 |
| Classic 层 | 16 扇区默认密钥全通、**除扇区0块0（UID/BCC/SAK/ATQA）外全零**＝出厂空壳、无业务数据 | REG:38-72、`docs/nfc-card-probe.md:30-43` |
| MF `3F00` | FCI 借用 `1PAY.SYS.DDF01`，但无真实 EMV 支付目录（PPSE=6A82） | REG:80-90 |
| `0010` | 目录 DF；目录内 `000n` ≡ `SFI n` 指同一文件 | REG:92-104、REG:169-183 |
| `0015` / `0016` / `0018` | 有效期 BCD `2028-08-30`（`DT8` 含义未知）／姓名 GBK「高天翔」+分段学号 `1120241355`／定长记录 1 条含 `2026-03-22 11:08:43` | REG:106-157、REG:212-226 |
| 目录内 `0004`/SFI4 | **6982 认证门**，质询-应答型，门后未知 | REG:185-200 |
| 目录内 SFI5/6/7 | 字节已 dump，**业务语义未证**（不猜配额/权限/版本） | REG:238-247、REG:301 |
| MF 与 DF 副本 | 身份数据 `0015/0016/0018` ≡ `SFI21/22/24` 逐字节一致，身份存两份 | REG:212-220、REG:298-300 |
| **卡里没有什么** | 无余额、无钱包、无资金数据（在一卡通中心后台）；`ndef=0` 无 NDEF 贴纸内容 | REG:309-317 |

所有「未知 / 推论」字段（`DT8`、`13 88`、`02`、`01`、SFI5/6/7）一律保持【未知】，不命名、不推断。UID→卡面印刷号 6~8 种换算**并列候选**、不由程序挑一个（REG:268-281）。卡上日期一律「疑似」、不叫「有效期」（`CardIdentityLogic.ts:4-6`、`CardIdentityLogic.kt:12-25`）。

### 3.4 平台 API 差异（Android `android.nfc.*` vs 鸿蒙 `@kit.ConnectivityKit`）

| 能力 | Android API | 鸿蒙 API | 差异 / 未找到证据 |
|---|---|---|---|
| 三态检测 | `PackageManager.hasSystemFeature(FEATURE_NFC)` + `NfcAdapter.getDefaultAdapter().isEnabled` | `canIUse('SystemCapability.Communication.NFC.Core')` + `nfcController.isNfcOpen()` | 语义对齐（N01） |
| 前台读卡 | `NfcAdapter.enableReaderMode(activity, cb, FLAG_READER_NFC_A\|B\|F\|V\|SKIP_NDEF_CHECK)` | `tag.on('readerMode', elementName, [tag.NFC_A, NFC_B, NFC_F, NFC_V], cb)` / `tag.off` | 鸿蒙需 `ElementName` + `running` 幂等（防 3100202）；Android `NfcTapWatcher` 只开 NFC_A 且**故意不加** SKIP_NDEF_CHECK（为让贴纸 NDEF 可读，`NfcTapWatcher.kt:55-60`） |
| CPU 卡 | `IsoDep.get(tag).connect/transceive/close/historicalBytes` | `tag.getIsoDep(tagInfo).connect/transmit/resetConnection` | 鸿蒙 **historicalBytes / ATS 未找到对等 API 证据**（本次不联网，仅据本地源码）；`transceive`↔`transmit` 命名差异 |
| Classic | `MifareClassic.get(tag)` + `authenticateSectorWithKeyA/B` + `readBlock` + `size/blockCount` | `tag.getMifareClassic` + `authenticateSector(sector,key,isKeyA)` + `readSingleBlock` + `getSectorCount/getBlockCountInSector` | 鸿蒙认证签名为「扇区+密钥+是否KeyA」单方法；块数按卡上报，兼容 1K/4K |
| NDEF 读 | `Ndef.get(tag).ndefMessage` / `NdefFormatable.get(tag)` | `tag.getNdef(tagInfo).readNdef()` | 对齐（N08） |
| NDEF 写 | `Ndef.writeNdefMessage` / `NdefFormatable.format` | **未找到写 API 使用**；服务声明只读 | 不引入（R02/R03） |
| GBK 解码 | `String(bytes, charset("GBK"))` | `util.TextDecoder.create('gbk').decodeToString` | 鸿蒙用注入式解码器，corelogic 不 import @kit，便于单测 |
| 技术常量 | 字符串 `android.nfc.tech.IsoDep` 等 | 数值 `tag.ISO_DEP=3`、`tag.MIFARE_CLASSIC=8`、`tag.NDEF=6` 等（`NfcLogic.ts:57-70`） | 表示方式不同；鸿蒙 `techName` 靠数字映射 |
| 系统设置跳转 | `Intent(Settings.ACTION_NFC_SETTINGS)` | 仅文案「应用无权替你打开」 | ⛔ 平台不做（R01） |
| HCE 卡模拟 | `HostApduService`（仅 APDU，无 Crypto1） | 不接入 | 🚫 红线（R04） |

### 3.5 一卡通页面入口（仅登记，不展开）

鸿蒙 `pages/CardPage.ets`（余额 + 趋势三态 + 「流水只在 i北理、网页端跳充值页、不伪造明细」说明，`CardPage.ets:169-176`）与 `pages/CardLoginPage.ets`（Web 组件走 CAS → 抽 cookie → `JAR_CARD`，`CardLoginPage.ets:1-11`、`32-72`）为**页面入口**；其网络/数据层归域 03。Android 对应 `DefaultCampusCardRepo` 等同样不含 NFC 读卡（§1.1 Grep 佐证）。**NFC 读卡与一卡通余额查询是两条独立链路**：卡里没有余额（REG:311），NFC 不负责取余额。

---

## 4. 可执行修复清单（仅限可做项）

> 全部为**纯只读**或纯本地存储 / 纯 UI 改动，**不含**任何写卡、写 NDEF、破密钥、第二密钥、认证提交、猜门后内容项。验收判据均可证伪（能构造反例使其不成立）。优先级：P0 最大 parity 缺口且零卡片风险；P1 探测能力补齐；P2 呈现/增强；P3 口径细节。

| 编号 | 改动点 | 鸿蒙文件 | 验收判据（可证伪） | 风险 | 优先级 |
|---|---|---|---|---|---|
| F05-01 | 新增「我的校园卡」本机持久化名片（姓名/学号/`sidConfirmed`/卡号候选/UID/更新时间）与学号输入框持久化；读卡成功后合并落盘、页面顶部展示、提供「忘掉这张卡」 | 新增 `corelogic/SavedCardLogic.ts`、`data/SavedCardStore.ts`；改 `pages/NfcPage.ets` | ①贴卡读出身份后杀进程重进 NfcPage，名片仍在且 UID 与上次一致；②换一张 UID 不同的卡时**整张替换**、不把两张卡字段拼成一个（注入两个不同 UID 的 `merge` 用例须只保留新卡姓名）；③「确认过的学号」不被后一次「疑似学号」顶替；④点「忘掉这张卡」后名片为空态而**学号输入框内容仍在**；⑤源码检索无 `password/token/cookie` 字段 | 纯本地存储、不碰卡；合并规则写错会把两张卡拼成一个不存在的人，须与 Android `SavedCardLogic.kt:135-161` 口径一致 | **P0** |
| F05-02 | 新增「贴卡即用」：前台常驻**只读**监听、按已存 UID 比对、命中跳用户选的目标页（未登录先去登录页）、开关默认关、进入 NfcPage 时让位诊断页 | 新增 `corelogic/NfcTapLogic.ts`、`data/NfcTapStore.ts`；改 `service/NfcService.ts`（全局 start/stop 与页面互斥）、`pages/NfcPage.ets`（让位）及设置入口 | ①开关默认关、未存卡时置灰并提示「先贴一次卡」；②存过卡后贴同 UID 才跳、贴不同 UID / 公交卡**静默不动**；③未登录跳登录页、已登录跳所选目标页；④退后台 / 进 NfcPage 后监听停止，**不与诊断页 readerMode 同时注册**；⑤文案写明「卡号是公开值、便利触发物非安全、不跳过任何验证」 | 纯读 UID、不写卡、不参与认证；常驻监听耗电、需 App 级生命周期 + 路由白名单单一来源；依赖 F05-01 先落地 | **P0** |
| F05-03 | 把已实现的 `parseTlvs`/`aidsOf` 接线：流水增加 TLV 摊平展示；深度扫描对 tag `4F` 的 AID 追加一次只读 `SELECT by DF name` | `corelogic/CardProbeLogic.ts`、`CardProbeRunner.ts`、`DeepScanLogic.ts`、`pages/NfcPage.ets` | ①喂 `6F 15 84 0E … A5 03 88 01 01` 能摊出 `88=01`（构造型递归不漏 SFI）；②构造含 `4F` 的假 `transmit`，深度流水里出现一条 `INS=A4` 的 `SELECT by AID` 且过 `isReadOnly` 闸门；③AID 长度 <5 或 >16 时**不发**该命令；④最多取 3 个 AID | 纯只读 SELECT；须防把构造型 TLV 误读成 AID、防无限下钻（沿用 2 层封顶） | P1 |
| F05-04 | 补齐 `firstRound()` 等价基础轮（SELECT MF / PSE `1PAY.SYS.DDF01` / READ RECORD SFI=1 记录 1~3 / PPSE 对照），作为可选只读步骤 | `corelogic/CardProbeLogic.ts`、`CardProbeRunner.ts` | ①新步骤 APDU 全部落在白名单 INS（A4/B2）且 CLA 0~3；②真卡预期 PSE=9000、PPSE=6A82，拿不到时**如实显示**不静默隐瞒；③源码检索无 `0x82`/写 INS；④快速读条数增加可预期、不拖慢到秒级外 | 纯只读 SELECT/READ；PSE/PPSE 是标准目录名不是密钥；注意别与 `quickScan` 的 SELECT MF 重复发太多 | P1 |
| F05-05 | 一次贴卡汇总：默认把 UID/tech/NDEF + APDU 快速读 + Classic 只读 dump 合并为一份结果；4 个模式改为可组合 / 提供「全部只读」入口 | `service/NfcService.ts`、`pages/NfcPage.ets` | ①一次贴卡后结果同时含 UID/tech/NDEF、APDU 流水、Classic 流水；②按 UID 去重 `lastProbedUid` 仍生效，同卡连续触发不重复跑几十条；③IsoDep / MifareClassic 各自 `connect` 后都 `resetConnection`；④任一通道失败不影响已得结果 | 会改动已真机验过的 4 模式；双通道切换需分别 connect、贴卡时间变长、掉卡率上升；**建议保留单模式入口作兜底** | P1 |
| F05-06 | 结果页补「复制诊断文本」与「只看有数据 / 展开全部」开关（对齐 Android `dumpOf` + `hasData` + `showAllProbe`） | `pages/NfcPage.ets`（可抽 `corelogic/NfcDump.ts`） | ①点复制得到含 UID/tech/各流水的纯文本，日期一律带「疑似」、不含推断；②365 条深度流水默认只列有数据的，展开后条数与 `deepLines.length` 相等；③导出文本不把 `studentIdHit` 说明文字当学号 | 纯 UI / 纯文本；导出文本不得把推论写成确定结论 | P2 |
| F05-07 | 卡大类枚举与「双界面卡」说明：`NfcLogic` 增加 `CardKind`（IsoDep 优先于 MifareClassic），页面展示卡类型与「同时有 Classic 层 → 不能写入」 | `corelogic/NfcLogic.ts`、`pages/NfcPage.ets` | ①tech=[IsoDep,NfcA,MifareClassic] 判为 CPU 卡而非 MifareClassic（顺序可单测、判反须红）；②页面出现「双界面卡」文案；③UNKNOWN 有明确文案而非空白；④不因此改变 `supportsApdu` 现有取值 | 纯逻辑 / 纯 UI；顺序必须与真卡实测一致，判反会掐掉 APDU 通道 | P2 |
| F05-08 | NDEF 贴纸快捷入口**只读**部分：解析 `bit101://nfc/shortcut?to=` 白名单 URI 并显示目标名（**不写标签、不加任何写路径**） | 新增 `corelogic/NdefShortcutLogic.ts`；`service/NfcService.ts`、`pages/NfcPage.ets` | ①`decode` 对非 `bit101` scheme / 缺 `to` / 非白名单 route 一律返回空；②读到自有贴纸 NDEF URI 时页面显示目标名，**不触发任何写**；③源码检索无 `writeNdef`/`format`/`NdefFormatable` 写入调用；④route 白名单与鸿蒙路由表单点维护 | 纯读 + 白名单；**写贴纸 / 格式化不在本项范围**（R03）；route 白名单漂移会导致「贴了没反应」 | P2 |
| F05-09 | Classic 只读流水口径对齐：跳过扇区尾块（对齐 Android `plan`），或**仅补文档说明**「鸿蒙读尾块但只读无害」 | `corelogic/ClassicScanLogic.ts`（或仅 `docs/NFC-CARD-REGIONS.md`） | ①若选择对齐：1K 卡流水由 80 条变为 16×(1 认证 + 3 块)=64 条，且尾块不出现在 readout；②源码仍无 `write`/第二密钥；③若选择文档说明：`NFC-CARD-REGIONS.md` §2 明确写出两端口径差异 | **低价值且会改动已真机验的 80 条证据口径**（R:571、REG:47-49）；默认建议**只补文档、不改代码**；若改须同步 ROADMAP M16-7 计数 | P3 |
| F05-10 | UID 展示口径对齐（Android 紧凑无分隔符 / 鸿蒙空格分隔），统一一种并同步卡号候选解析 | `corelogic/NfcLogic.ts`、`pages/NfcPage.ets`、`corelogic/CardIdentityLogic.ts` | ①同一 UID 两端展示字符串一致；②改后 `NfcPage.runProbe` 的 `uid.split(' ')` 仍解析出正确字节、卡号候选 `2004217979` 不变（R:563）；③`docs/NFC-CARD-REGIONS.md` 中 `77 75 F0 7B` 写法同步 | 纯展示；鸿蒙既有文档/真机证据用空格分隔，改动需同步多处文案 | P3 |
| F05-11 | technology 列表去重（对齐 Android `.distinct()`） | `corelogic/NfcLogic.ts`（`techListText`） | ①输入 `[3,1,1,8,7]`（IsoDep/NfcA/NfcA/MifareClassic/NdefFormatable）输出不含重复 `NfcA`；②`techs` 字符串与 `docs/nfc-card-probe.md:21` 去重后一致；③不改变 `hasTech`/`supportsApdu` 判定 | 纯逻辑；去重只影响展示数组，不得改变能力判定 | P3 |

**P0 编号：F05-01、F05-02**（均为 Android 有、鸿蒙完全缺失、且落在只读边界内的最大 parity 缺口；F05-02 依赖 F05-01）。

---

## 5. 明确不做 / 红线项清单及原因

| 编号 | 不做项 | 状态 | 为什么不能做（写清原因） | 证据 |
|---|---|---|---|---|
| R01 | 应用内「去系统设置打开 NFC」跳转按钮 | ⛔ 平台不做 | Android 有 `Settings.ACTION_NFC_SETTINGS`；鸿蒙页面明确「应用无权替你打开」，只给路径文案。属平台能力差异，不强行伪造跳转、不做假按钮 | A:`NfcSettingPage.kt:271-277`；H:`NfcPage.ets:73-81` |
| R02 | 写校园卡任何块 / 给带 `MifareClassic` 的卡写 NDEF | 🚫 红线禁做 | 校园卡 techList 含 `NdefFormatable` 但同时有 Classic 层；写 NDEF / `format()` 会**重写扇区尾块的密钥 A/B 与存取位**，学校读卡器将不认卡，手里没有厂商密钥**无法恢复**。Android 自己也在 `writeShortcut` 见 Classic tech 直接拒绝 | `docs/nfc-card-probe.md:8-15`；A:`NfcController.kt:783-816`；REG:57-59；H:`NfcService.ts:4-6` |
| R03 | 写 / 格式化**自有** NDEF 贴纸（含 `writeNdefMessage`、`NdefFormatable.format`、`pendingWrite`） | 🚫 不纳入可做清单 | 鸿蒙 `NfcService` 架构声明「写路径永远不会加进来」，验收要求「所有写路径在源码层不存在（栅栏测试）」；本次审计立场为纯只读。虽 `FP:66` 旧计划文字列过「读/写快捷入口」，**以现行红线为准**：只做只读解析（F05-08），不引入任何写方向代码 | H:`NfcService.ts:4-6`；R:570（M16-10）；FP:68-73、FP:89；FP:66（口径张力，见 §3.1(7)） |
| R04 | HCE 模拟校园卡 / 门禁 | 🚫 红线禁做 | 鸿蒙 HCE 只覆盖 APDU（ISO 7816-4）通道，**无 Crypto1 / Mifare Classic 模拟**；校园卡是双界面卡，Classic 层不在 HCE 通道内，模拟不出来；「迁移到手机当卡用」还缺密钥与后台钱包逻辑 | FP:18、FP:71、FP:82；REG:323 |
| R05 | 模拟刷卡 / 过闸机 | 🚫 红线禁做 | 闸机涉**行踪合规**；且属对外副作用动作，不做入口即正确实现 | FP:18；R:570（M16-10「不给支付入口、不做闸机模拟，只保留说明」） |
| R06 | 校园支付 / 充值 | 🚫 红线禁做 | 资金合规 + 学校不对第三方开放；第三方代收代付风险不可控 | FP:19；R:570 |
| R07 | 破解非默认密钥 / 试第二个密钥 / MFOC / nested authentication | 🚫 红线禁做 | 既是在撬别人的锁，也几乎肯定徒劳；真卡 16 扇区用唯一默认密钥已全通、除 UID 块外全零，**换密钥只重复同一结论**。鸿蒙「唯一 FFFFFFFFFFFF KeyA、失败即跳过」是更严格口径，**不得反向对齐 Android 的 9 密钥遍历**（N22） | `docs/nfc-card-probe.md:16`、`41`；A:`NfcController.kt:595-599`；H:`ClassicScanLogic.ts:4-9`、`92-103`；R:571 |
| R08 | `EXTERNAL AUTHENTICATE(0x82)` / 任何认证提交命令 | 🚫 红线禁做 | 带密钥的写方向命令，不在只读白名单 `A4 B0 B2 C0 CA 84` 内；`probeIsReadOnly` / `isReadOnlyLocal` 明确拦下 | H:`AuthGateLogic.ts:10-14`、`70-71`、`175-188`；H:`NfcService.ts:406-417`；`docs/nfc-card-probe.md:10-11` |
| R09 | 猜 `6982` 门后内容 / 推断认证密钥、算法、是否关联钱包 / 把「质询-应答」当「有钥匙」 | 🚫 红线禁做 | 判定只说明**锁的类型**，不等于有钥匙；门后数据、密钥、算法本次无证，一律【未知】、不猜。用户多次要求破密钥/猜门后均被拒，立场不变 | H:`AuthGateLogic.ts:104-108`；REG:198-199、REG:321-323；FP:82；R:564 |
| R10 | 把卡内当余额/钱包来源 / 把卡上日期命名为「有效期」/ 挑一个 UID→卡号候选当结论 | 🚫 红线禁做 | 余额与资金数据在一卡通中心后台、**不在卡上**（REG:311）；真卡同时有有效期、交易时间、未知日期，无依据区分，一律「疑似」并列；UID→印刷号换算各校自定、无标准，全列给用户对照 | REG:309-317、REG:268-281、REG:294；H:`CardIdentityLogic.ts:4-6`、`CardPage.ets:169-176`；A:`CardIdentityLogic.kt:12-25` |

**立场重申**：以上 10 项（⛔1 + 🚫9）不因 Android 端存在对应代码路径（写贴纸、多密钥遍历）或计划旧文字而放宽；本审计不鼓动破密钥、猜门后、写卡。第 4 节修复清单 11 条全部落在只读 / 纯本地 / 纯 UI 边界内。

---

## 6. 交付统计（供汇总用）

| 项 | 数值 |
|---|---|
| 功能对照表行数 | 44（N01–N44） |
| ✅ 对齐 | 16 |
| ✅增 鸿蒙侧增强（非缺口） | 1（N20 认证门只读研究） |
| **差异条数** | **17**（⚠️ 11 + ❌ 6） |
| 不做项数 | 10（⛔ 1 + 🚫 9，R01–R10） |
| 可做修复清单 | 11 条（F05-01 ~ F05-11） |
| **P0 编号** | **F05-01、F05-02** |
| 进度数字来源 | 仅 `docs/ROADMAP.md`（M16-2/3/5/6/7/10 行） |
| C 级「未找到证据文件」 | 12 类真机原始日志/截图（见 §1.3），仅登记文档引用、不据此下新结论 |

---

v1.0 / 2026-11-24

---

## 修复进度登记（2026-11-27，v1.0 审计内容不改动）

| 编号 | 状态 | 证据 |
|---|---|---|
| F05-01 | ⚠️ 代码完成 + 静态绿 + 已推远端，**贴卡真机待验** | commit `f5c3f1d` 本地（alpha.53/versionCode 53）；SavedCardLogic 逐条对齐 A:SavedCardLogic.kt（换 UID 整张替换防张冠李戴、确认学号优先、sameContent 不比 savedAt）；SavedCardStore 键名对齐 KEY_*、无凭据字段、忘名片不动输入框；test-savedcard 37 断言 + 拆红日志 `evidence/f05-savedcard-20261127/`（首次拆红假绿→补反例后真红→恢复绿，事故复盘留证）；全测 97/97、4328 断言 EXITCODE:0；hvigor BUILD SUCCESSFUL；装机 `bm dump`=53、MD5 `12E5C8E0DDA514D989F1E82F3566B75B`。push 初遇 GitHub 502/408，网络恢复后已成功推 `0fe552a`（`ls-remote` 确认）；贴卡真机未验 |

> F05-01 不判 ✅（G5 未签字）。待用户贴卡验证名片保持/换卡替换/忘掉保留输入框后回写。

*v1.1 进度登记 / 2026-11-27*
