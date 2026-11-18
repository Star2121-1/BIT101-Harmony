# 座位接口 HTTP 500 根因分析（2026-11-19，只读取证）

## 现象
真机 alpha.26/27：座位页「5层中厅」取座位状态恒 `响应解析失败（HTTP 500）`，
「我的预约」显示「登录已失效」。静默续期 `silentRenewJwt` 试过仍失败。

## 排除项（不是这些原因）
- **不是座位树 bug**：type 字符串转换已在 alpha.25 修复，点五层能显示「5层中厅」。
- **不是没有换票链路**：鸿蒙 `CasLoginService.login` 六步全通（M1 真机验过业务接口 code=1），
  `exchangeJwt` / `followForCasCode` / `silentRenewJwt` 都在。
- **不是 JWT 没存**：真机 `seatlib_jwt_v1` len=513，保存时间 2026-11-18 16:35（用户重新登录时）。

## 根因（可证伪的证据链）
Android 原版座位系统有**独立的座位登录态**：
- `SeatApi` 的 token 来自 `seatLoginStatus.token`（座位专用持久化），请求时同时放
  `Authorization: bearer{token}` 头 **和** body 里的 `authorization`。
- `SeatSession.authenticateSeatlib()` 用 **seatlib 域自己的 phpCAS 会话**（`seatHttp.session`）
  静默打 `POST /api/cas/user` 换 token；换不到 ⇒ `ERR_SESSION_GONE`（200 无 token）。

鸿蒙现状：
1. `silentRenewJwt` 把 `SchoolCookieStore`（持久化 cookie）恢复到 `JAR_CAS` 后，
   直接 `exchangeJwt(session, '')` 打 seatlib `/api/cas/user`（CasLoginService.ts:416-427）。
2. 真机持久化 cookie 取证（`bit101_prefs` → `school_cookies_v1`，10 条）：
   `sso.bit.edu.cn`(4) + `jxzxehall.bit.edu.cn`(2) + `jxzxehallapp.bit.edu.cn`(4)，
   **没有任何 `seatlib.bit.edu.cn` 域 cookie**。
3. 为什么没有：`SchoolCookieStore.snapshotAndSave(repo)` 在登录步骤8用的是
   **JAR_LOGIN** 的 repo（CasLoginService.ts:103/279）；而 seatlib 域 phpCAS cookie 是
   `followForCasCode(sessionC)` 在 **JAR_CAS** 罐里跟跳种下的。落盘只抓了 JAR_LOGIN，
   且 `isSsoDomain` 设计上刻意排除 seatlib 子域——所以 seatlib 会话从未被持久化。
4. 结论：静默续期恢复的全是 sso/jxzx 域 cookie，打 seatlib `/api/cas/user` 时
   **跨域带不上任何 cookie**，服务端无法识别 phpCAS 会话 ⇒ 换不到 token ⇒ 座位 500。
   这不是网络故障，是**域不匹配的必然失败**。

## 判据（怎么算证伪）
若把 seatlib 域 phpCAS cookie 补进持久化 + 静默续期恢复后，`/api/cas/user` 返回 200 且
`member.token` 非空 ⇒ 上面结论成立。当前 hilog 在该设备持续 SIGTERM（ROM 压制），
无法从日志直接确认 cas/user 的返回；上述结论基于持久化 cookie 域清单 + 源码调用链的静态取证。

## 为什么本轮不改核心登录
- 修法要动登录步骤8的 cookie 快照策略（JAR_LOGIN → 合并 JAR_CAS），
  属于核心登录链路，`test-sso` 明确锁「只下沉 sso 域、不串子系统 cookie」——
  改它等于推翻一条有意的安全设计。
- 设备不可调试、hilog 抓不到，改完无法真机确认是否生效，容易变成"改了但没验"的假通过。
- 座位业务是真实对外副作用（预约），不能靠未经验证的会话去做。

## 结论与下一步选项
座位业务接口需要**座位专用登录态**，鸿蒙的自动续期在当前 cookie 策略下不可能成功。
可选：
- A. 改 cookie 持久化策略：登录时把 JAR_CAS 的 seatlib 域 cookie 也存下来（需重新登录一次再验，
  且要放宽 test-sso 的域栅栏并说明安全边界）。
- B. 加座位专用登录入口：用户主动输学号密码 → 走完整六步 CAS → 换座位 JWT（短信二验需用户在场）。
- C. 维持现状：座位页诚实报错「登录已失效」，不做假动作。

当前采用 C，A/B 待用户拍板。
