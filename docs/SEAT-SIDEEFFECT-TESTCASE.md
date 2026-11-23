# 座位预约 / 取消副作用测试用例

## 红线（先读）
预约与取消会**真的占位 / 释放座位**，属于对外副作用。按项目铁律 0.6：
- 自动测试**只验请求契约、副作用闸门、结果语义**，绝不发真实写请求；
- 真机正路径由**用户本人在设备上点击**确认按钮，脚本只做导航、定位、等待、取证、判定；
- 会话失效时用例必须 FAIL 并提示重登，**不允许把「看着没报错」当通过**。

## 一、自动边界用例（`tools/test-seatsideeffect.mjs`，40 条断言）
`bash tools/run-tests.sh` 会跑到，无需设备、无网络。

| 编号 | 覆盖点 | 判据 |
| --- | --- | --- |
| TC-A1 | 预约请求体 | `{seat_id: int, segment: 真实时段}`；补零座位号转 int；空段回落 `'1'`（不打非法段） |
| TC-A2 | 取消请求体 | **只有** `{id: 预约记录 id}`，不含 `seat_id`（传座位 id 实测恒失败） |
| TC-B1 | 服务层不自动重试 | `confirmSeat` / `cancelReservation` 各自只发一次 `postJson` |
| TC-B2 | 预约调用点 | 全页恰好 2 处（首调 + 会话失效后**同意图**重放），且都在 `doReserve()` 内 |
| TC-B3 | 自动路径无写操作 | `aboutToAppear` / `onAuthRetry` / `reload` / `loadSeats` 均无预约/取消调用 |
| TC-B4 | 取消二次确认 | 必须先点「我已预约」进 `cancelTarget`，`doCancel()` 无目标直接返回；从我的预约反查 `record.id` |
| TC-B5 | 表单页取消 | 卡片先 `requestCancel` 再 `confirmCancel`（两次点击），传的也是记录 id |
| TC-C1 | 签到提示 | 当日「60 分钟」/ 次日「9:00」 |
| TC-C2 | 额度语义 | 本地计数当天递减、跨天重置、下限 0；扣减后可正确读回 |

守卫为源码静态栅栏 + 纯逻辑断言，已用「移除 `cancelTarget` 赋值」拆红验证会红。

## 二、真机半自动用例（`tools/device-seat-sideeffect.mjs`）
```bash
node tools/device-seat-sideeffect.mjs reserve   # 只跑预约
node tools/device-seat-sideeffect.mjs cancel    # 只跑取消
node tools/device-seat-sideeffect.mjs all       # 依次跑
```
可选：`HDC=<hdc.exe>`、`DEVICE=<connectkey>`、`WAIT_MS=<等待用户点击毫秒>`。

| 编号 | 前置 | 脚本自动做 | 用户本人做 | 预期结果 | 证据 |
| --- | --- | --- | --- | --- | --- |
| TC-01 预约 | 已授权座位系统、有可约空位 | 进座位页→选三层/中厅→进图页→点选一个空闲座位→定位「预约 XXX」 | 点「预约 XXX」 | 回列表 tab，`我的预约（N）` 比操作前 +1，显示签到时限文案 | `evidence/device-sideeffect/reserve-*.xml` + `reserve-result.json` |
| TC-02 取消 | TC-01 后有一条可取消预约 | 进列表 tab→记录计数与额度→定位「取消」 | 点「取消」→再点「确认取消预约」 | `我的预约（N）` -1，额度「今天还剩 M 次」递减 | `evidence/device-sideeffect/cancel-*.xml` + `cancel-result.json` |

脚本判定用**计数变化**而不是截图观感；登录失效直接 FAIL（不会把降级态算通过）。

### 执行注意
- 设备 hdc 通道易卡，脚本每条命令前会 `hdc kill -r` 重置（本机已验证有效）。
- 座位树区域名变化时改脚本 `setupArea()` 里的目标文本；点击坐标一律来自 `dumpLayout`，不硬编码。
- 「今天还剩 N 次」是**本 App 本地计数**（与 Android 同口径），网页端/其它设备的取消不计入，不能当服务端权威额度。

## 未覆盖（如实）
- 服务端额度是否真的扣减、跨设备是否同步：服务端无可读额度接口，未验。
- 研讨间取消是否共用座位取消额度：服务端未明示，UI 不写结论，用例也不断言。
- 优先模式多选后的预约副作用：与单次走同一 `confirmSeat` 闸门，自动边界用例覆盖调用点，真机未单独跑。
