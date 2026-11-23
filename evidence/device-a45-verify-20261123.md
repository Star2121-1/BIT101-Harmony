# alpha.44 真机验证 + alpha.45 入口死结修复（2026-11-23）

设备 `4CY9K25614019980`。hdc 通道此前长时间 `E000004: communication channel is being established`，本次用 **`hdc kill -r`（强制重启 server）恢复**；后续每个 hdc 命令前同样重置可稳定通道。

## 装机确认
- `bm dump -n cn.bit101.next`：app 级 `"versionCode": 44` / `"versionName": "1.0.0-alpha.44"`（ability 级那些 `0` 不是 app 版本，别误读）。

## 已验（布局证据 `evidence/device-a44/*.xml`，均来自设备 `uitest dumpLayout`）
1. 阶段2表单选「三层 - 中厅」→ 点「选择座位」→ **进入 `pages/SeatMapPage`**（`a44-map.xml` 的 `pagePath` 实测）：
   - 信息条：`中厅` / `2026-11-23 08:00-22:30` / `空闲 60/72`；`换区域` 可点。
   - 72 个底图点位（001…072，父 Stack `clickable=true`），说明走的是官方底图叠图路径而非方格兜底。
   - 底栏：`请先在图上点选一个座位` + `立即预约`（可点）。
2. 点空闲座位 001（`a44-pick.xml`）：
   - 点位上出现 `✓` 选中角标；
   - 底栏变 `已选 001` + `请在 60 分钟内刷卡签到（当日预约，逾期记违约）` + `预约 001`。
   - 结论：选座态与签到时限文案在真机上正确，与 Android ReserveBottomBar 语义一致。
3. `uitest uiInput keyEvent Back` 回表单：三级选址（徐特立馆 - 三层 - 中厅）完整保留，无状态丢失。

## 真 bug（本次抓到）
监控模式点「选择目标座位」**不跳页且无任何提示**。根因：`SeatPage.openSeatMap()` 复用了 `validateForm(MONITOR, hasArea, pickedCount)`，那条规则要求「先在图上点选目标座位」——而目标座位恰恰要在图页里选，形成"进选座页必须先选座"的死结。静态源码守卫没抓到，靠真机点按才发现。

## alpha.45 修复
- `SeatFormLogic.validateMapEntry(hasArea)`：进图页只要求选好区域（纯逻辑，可单测）。
- `SeatPage.openSeatMap` 改用它；`test-seatform` +2 断言、`test-seatmappage` +1 源码守卫。改回旧写法拆红确认守卫会红（退出码 1）。
- 全量 **91/91 套件 3962 断言绿**，`assembleHap` BUILD SUCCESSFUL，versionCode 45。

## alpha.45 装机复验（同日 16:04–16:07）
- 装机确认 app 级 `versionCode=45` / `1.0.0-alpha.45`。
- 监控模式点「选择目标座位」→ **进入 `pages/SeatMapPage`**（`a45-monitor-map.xml`）：底栏 `未选择座位` / `确定监控这个座位`，提示语变 `点任意座位可选`。死结修复生效。
- 点座位 001 → 底栏 `001（空闲）` + `清空` + `确定监控这个座位`（`a45-monitor-picked.xml`）。
- 点「确定监控这个座位」→ 回表单显示 `已选：001` + `清空`（`a45-pickback.xml`），三级选址未丢。
- 点「创建任务」→ 切列表 tab + 显示 `已创建监控预约任务`（`a45-task.xml`）。全链路无服务端写操作。

## 未验（如实）
- **未代点「预约 001」**：预约是对外副作用（占位、逾期记违约），按铁律只由用户本人点击，agent 不代劳。
- 「我的预约」交叉标记 MINE 后的取消按钮同样有副作用，未代点。
- 优先模式多选 / 优先级顺序未在真机验（纯逻辑单测已覆盖 `togglePicked` 保序）。
