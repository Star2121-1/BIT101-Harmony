// 鸿蒙 @kit.* 内核模块在 Node 单测环境下的空桩。
// 仅用于 `node --experimental-loader` 把 @kit.* 解析到此文件，
// 使 SeatTaskStore/Prefs 等能在 Node 下被 import（运行时调用被 try/catch 吞，不影响内存 repo）。
export const preferences = {};
export const Context = {};
export const UIAbility = {};
export const AbilityConstant = {};
export const window = {};
export const router = {};
export const hilog = {
  info() {},
  warn() {},
  error() {},
  debug() {},
  fatal() {},
};
export const promptAction = {};
export const bundleManager = {};
export const AbilityKit = {};
export const ArkData = {};
export const ArkUI = {};
export const PerformanceAnalysisKit = {};
export default {};
