// Node ESM resolve hook：把鸿蒙 @kit.* 裸模块名重映射到 kit-stub.mjs，
// 让依赖链（SeatMonitorLogic → SeatTaskStore → Prefs → @kit.ArkData）能在 Node 下被 import。
// 用法：node --experimental-transform-types --experimental-loader ./tools/node-loader.mjs <test>.mjs
export async function resolve(specifier, context, next) {
  if (specifier.startsWith('@kit.')) {
    return {
      url: new URL('./kit-stub.mjs', import.meta.url).href,
      shortCircuit: true,
    };
  }
  return next(specifier, context);
}
