# 座位"未授权"根因重判（2026-11-21 23:56 真机探针，权威）

## 结论先行（更正此前"单会话互踢"的归因）
用户本人重登后座位页仍显示"学校账号已登录，但座位系统尚未授权"。
**真因不是登录态没保存、也不是 token 失效、更不是单会话互踢** —— 而是
**鸿蒙座位页 `/api/Seat/seat` 的 segment 参数写死为空串 `''`，服务端对空/非法 segment 直接回 HTTP 500 + 空 body，
前端把 HTTP 500 一律判成"授权失效"**（`SeatPage.loadSeats`: `seatAuthExpired = message.indexOf('HTTP 500')>=0`）。
单会话互踢（契约 §5）真实存在，但与本次"未授权"无关：本次 JWT 一直有效。

## 探针铁证（设置→开发者选项→座位 wire 探针，2026-11-21 23:56，versionCode 36）
用**同一把** SessionStore JWT（len=513）逐端点实测：

| 端点 | 认证 | 结果 | 说明 |
|---|---|---|---|
| session | - | ✅ JWT len=513 | 登录态在 |
| renew | 静默 | ❌ code 0 | phpCAS 会话/PHPSESSID 已死（**但 JWT 仍有效，不影响 authed 端点**） |
| tree | 免 | ✅ 200 code 1 | - |
| date | 免 | ✅ 200 code 1 | times[].id=null（不传 build_id 时，正常） |
| **subscribe** | **需 JWT** | **✅ 200 code 1** | 我的预约通，返回真实数据 |
| **reneges** | **需 JWT** | **✅ 200 code 1** | 通 |
| **seminar** | **需 JWT** | **✅ 200 code 1** | 通，返回 real booker=1120241355 的 9 条 |

⇒ **JWT 认证完全正常**。3 个需认证端点全 200 code 1。所谓"未授权"是误判。

## 根因链（对照 Android 权威基线）
`BIT101-seat/docs/seatlib-contract.md` §1/§2：
- §1：`/api/Seat/seat` 免认证；**带失效 token → 500 空 body；不带 → 200**；确认类接口认证失败是 200+code 10001，**不是 401**。
- §2：`segment` 必须是真实时段 id；传非法/不存在值 → **HTTP 500 空 body**（PHP 崩，无错误信息）。
- §2：`/api/Seat/date` 的 `times[].id` **只在 `build_id`=区域 id 时非空**（如 area 3→354438）；不传 build_id → id/start/end 恒 null。

Android 正确流程（`SeatViewModel.resolveSegmentParams` + `openSeatMap`）：
1. `getSeatDates(areaId)` —— **传区域 id 作 build_id** 拿真实时段
2. 解析出 `segmentId`/`startTime`/`endTime`（回落 "1"/"08:00"/"22:30"）
3. `getSeats(areaId, segmentId, day, startTime, endTime)`

鸿蒙现状（`SeatPage.loadSeats`）:
- **从不调 `fetchSeatDates`**；`fetchSeats(ctx, jwt, selArea, '', day, '00:00', '24:00')`
- segment 写死 `''`、时间写死 `00:00-24:00`；confirm 也传 `''`
- ⇒ 服务端对空 segment 回 500 ⇒ 前端误判"授权失效"

## 修法（下一步，待实施）
1. 新增纯逻辑 `resolveSeatSegment(areaId, day, dates)`（corelogic，可离线单测）：对齐 Android
   `resolveSegmentParams`——从带 build_id=areaId 拉回的 dates 里取当天时段，
   `segmentId`/`start`/`end` 有值用值、缺则回落 `DEFAULT_SEGMENT_ID='1'`/`08:00`/`22:30`。
2. `SeatPage.loadSeats`：先 `fetchSeatDates(ctx, jwt, selArea)` 拿时段，用解析出的
   segment/start/end 调 `fetchSeats`；不再写死空串。
3. `confirmReserve` 的 `confirmSeat` 也用解析出的 segment（而非 `''`）。
4. 修正 500 判据：契约 §1 说"带失效 token 打免认证接口 → 500"，但本次已证明有效 token + 合法参数才是常态；
   修好参数后若仍 500，再按"会话失效"处理。判别升级为：**先按修正参数重试一次成功则不算失效**。
5. 回归：全量套件 + `test-seat*` 新增"时段参数"守卫；真机设置→探针 + 座位页复验不再"未授权"。

## 诚实边界
- 本轮只取证 + 定位，**未改代码、未修**。上面修法待用户确认后实施。
- 探针 raw 全文落沙箱 `files/seatprobe-*.txt`，设备不可调试 ⇒ file recv permission denied，
  判据用探针页屏幕摘要（含 HTTP 状态 + code + data 摘要），足够定性。
