# 阶段3 独立座位图页实现对照（2026-11-23，alpha.44 / versionCode 44）

## 对照对象
Android 权威版 `BIT101-seat/features/seat/src/main/java/cn/bit101/android/features/seat/ui/screen/SeatMapScreen.kt`
+ `SeatViewModel.kt`（选座状态机）+ `NewTaskScreen.kt`（入口与回传）+ `model/Seat.kt asMine()`。

## 已实现（代码层）

| Android | 鸿蒙 alpha.44 | 说明 |
| --- | --- | --- |
| SeatMapScreen 独立路由 | `pages/SeatMapPage.ets`（main_pages.json 已注册） | 由新建预约表单 pushUrl 进入 |
| pickMode RESERVE/MONITOR/PREFER | 复用 `FormMode` SINGLE/MONITOR/PREFER | 不另起枚举，表单与图页同一份语义 |
| 40dp 蓝顶栏 + 返回 + 标题随模式变 | 44vp primary 顶栏 + 返回箭头 + `mapTitle(mode)` | 中文标题略高于 Android 的 40dp |
| FlowRow 信息条（区域/时段/空闲/我的/换区域） | `Flex({wrap: FlexWrap.Wrap})` + SeatMapChip | 避免横向滚动藏掉「空闲」「换区域」 |
| SeatMapCanvas 底图叠图 | `buildMapPoints` + 百分比 Stack 叠图 | 复用 M9-3 已真机验过的裁图规格 |
| 无底图 SeatGrid + 按座位号排序 + FallbackLegend | `sortedSeatsForGrid` + Flex 方格 + `legend()` | 服务端返回顺序是乱的 |
| `pickable`：选座任意 / 预约空位与 MINE | `pickable()` 纯逻辑 | 监控正是要等被占座位空出来 |
| `togglePick`：监控单选可反选，优先多选保序 | `togglePicked()` 纯逻辑，不改入参 | 优先级 = 点选顺序 |
| `Seat.asMine()` 交叉标记 | `markMineSeats()` + `WireSeatStatus.MINE` | 只改写 RESERVED；色 `#2E7D32`，底图复用 book |
| PickerBottomBar 文案/按钮 | `pickedSummary` / `pickerConfirmLabel` / `pickerGuard` | 监控空选不放行；优先空选 = 不限座位 |
| ReserveBottomBar 预约/取消 | `doReserve()` / `doCancel()` | 取消二次确认（铁律 0.6 高于 Android 的单击取消） |
| 预约成功 → onNavigateToTasks | AppStorage `RESERVE_DONE/MSG` → SeatPage 切列表 tab | 带上签到时限文案，结果同屏可见 |
| 选座回传表单 | `id|座位号;…` 串 → SeatPage `onSeatPickBack` 回填 | ArkTS 禁动态对象进 AppStorage，用 split 还原且保序 |
| 表单「创建任务」 | `createTask()` + `getTaskRepository().addTask()` | 本地任务仓库已存在，阶段3只补接线 |

## 验证
- 新增 `tools/test-seatmappage.mjs`：67 条断言（纯逻辑 + 页面源码栅栏），**故意拆红一次确认守卫会红**（改 `mapTitle(MONITOR)` 文案后退出码 1），已恢复。
- `tools/test-seatloop.mjs`：删除过时的「下一阶段占位提示」守卫，换成「真跳 SeatMapPage + 结果回传」守卫（54 条绿）。
- 全量 `bash tools/run-tests.sh`：**91/91 套件，3961 条断言绿**。
  - 注：受管 Node v24 在本机偶发 `UV_HANDLE_CLOSING` 崩溃（退出码 127），改用系统 Node v22.22.2 全量通过；与本次改动无关。
- `assembleHap buildMode=debug`：**BUILD SUCCESSFUL**（2m26s），versionCode 44。

## 未验（如实）
- **真机未验**：2026-11-23 提交时再次尝试——`hdc list targets` 能看到 `4CY9K25614019980`，但 `hdc shell` 与 `hdc install -r` 均报 `E000004: The communication channel is being established`（`hdc kill` 重启服务后仍如此），alpha.44 未装机。需用户物理重插 USB 后验：
  1. 单次预约入口 → 座位图顶栏/信息条/底图渲染；
  2. 监控/优先选座 → 回填表单（含优先级顺序）；
  3. 直接预约成功 → 回列表 tab 能看到「我的预约」+ 签到提示；
  4. MINE 座位显示「我已预约」并可取消（二次确认）。
- 阶段4 未做：规则弹窗、任务区、下拉刷新、取消额度明细。
- 已知差异：Android 底栏有「任务列表」常驻按钮，鸿蒙改为预约成功后自动切列表 tab（阶段1已落地的能力），未重复放按钮。
