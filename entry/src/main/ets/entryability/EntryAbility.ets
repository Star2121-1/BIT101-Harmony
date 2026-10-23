/*
 * Copyright (c) 2026 Huawei Device Co., Ltd.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { AbilityConstant, Configuration, ConfigurationConstant, UIAbility, Want } from '@kit.AbilityKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { window } from '@kit.ArkUI';
import { runProbe } from '../corelogic/compile-probe.ts';
import { setProbeCreds } from '../probe/CasProbe.ts';
import { Prefs } from '../data/Prefs.ts';
import { ThemeStore } from '../data/ThemeStore.ts';
import { ReminderScheduler } from '../service/ReminderScheduler.ts';
import { setDumpDir } from '../core/log/DebugDump.ts';
import { JxzxProbe } from '../service/JxzxProbe.ts';
import { setForeground } from '../core/AppForegroundState.ts';

const DOMAIN = 0x0000;

export default class EntryAbility extends UIAbility {
  /** 测试期常亮用的主窗口句柄（onWindowStageCreate 时取得）。 */
  private mainWindow: window.Window | undefined = undefined;

  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    try {
      this.context.getApplicationContext().setColorMode(ConfigurationConstant.ColorMode.COLOR_MODE_NOT_SET);
    } catch (err) {
      hilog.error(DOMAIN, 'testTag', 'Failed to set colorMode. Cause: %{public}s', JSON.stringify(err));
    }
    // M0 编译探针：真正触发 13 个算法模块被 ArkTS 编译器吃一遍（防 dead-code 假通过）
    hilog.info(DOMAIN, 'testTag', '%{public}s', 'Ability onCreate; probe=' + runProbe());
    // M2：本地存储初始化（幂等；所有读写都会 await 同一个 promise，页面不会抢跑）
    // ⚠️ 主题初始化必须排在 Prefs 之后：它要读回用户上次选的三档模式。
    Prefs.init(this.context.getApplicationContext())
      .then(() => ThemeStore.init(this.context))
      .then(() => {
        // M7-2：冷启动重排代理提醒（对照 Android「每次开 App 重排」）。
        // reminderAgent 是系统托管：排好即弹，App 退不退都弹 ⇒ 满足「锁屏/App 退出也弹」。
        // 全程不抛：通知开关没开会回报原因，由「我」页/通知列表引导开启。
        return ReminderScheduler.reschedule(this.context);
      })
      .then((r) => {
        hilog.info(DOMAIN, 'testTag', 'reminder rescheduled published=%{public}d reason=%{public}s',
          r.published, r.reason);
      })
      .catch((e: Error) => {
        hilog.error(DOMAIN, 'testTag', 'Prefs/Theme/reminder init failed: %{public}s', JSON.stringify(e));
      });
    // 诊断落盘目录（接口返回非 JSON 时把正文写这里，供 hdc 拉取；不含任何凭据）
    setDumpDir(this.context.filesDir);
    hilog.info(DOMAIN, 'testTag', 'dumpDir=%{public}s', this.context.filesDir);
    // 裸协议探针阶段 B：凭据经 `aa start --ps` 运行时传入，只进进程内存，绝不落文件。
    // ⚠️ 只打"是否收到"，绝不打值。
    try {
      const params: Record<string, object> = want.parameters ?? {};
      const u: string = String(params['probe_user'] ?? '');
      const p: string = String(params['probe_pass'] ?? '');
      if (u.length > 0 && p.length > 0) {
        setProbeCreds(u, p);
        hilog.info(DOMAIN, 'testTag', 'probe creds received (userLen=%{public}d passLen=%{public}d)',
          u.length, p.length);
      } else {
        hilog.info(DOMAIN, 'testTag', 'probe creds absent (userLen=%{public}d passLen=%{public}d)',
          u.length, p.length);
      }
      // 诊断开关：`--ps probe_jxzx 1` ⇒ 启动后自动跑一次教务接口矩阵（结果写沙箱文件）
      if (String(params['probe_jxzx'] ?? '') === '1') {
        JxzxProbe.requestAutoRun();
        hilog.info(DOMAIN, 'testTag', 'probe_jxzx auto-run armed');
      }
    } catch (err) {
      hilog.error(DOMAIN, 'testTag', 'probe param read failed: %{public}s', JSON.stringify(err));
    }
  }

  /**
   * 系统深浅色切换（用户在系统设置里改、或定时深色生效时）。
   * 只有 `auto` 模式才跟随；手动选了浅/深的用户不该被系统设置顶掉。
   */
  onConfigurationUpdate(newConfig: Configuration): void {
    hilog.info(DOMAIN, 'testTag', 'onConfigurationUpdate colorMode=%{public}d',
      newConfig.colorMode ?? -1);
    ThemeStore.onSystemChange(this.context);
  }

  onDestroy(): void {
    hilog.info(DOMAIN, 'testTag', '%{public}s', 'Ability onDestroy');
  }

  onWindowStageCreate(windowStage: window.WindowStage): void {
    // Main window is created, set main page for this ability
    hilog.info(DOMAIN, 'testTag', '%{public}s', 'Ability onWindowStageCreate');

    windowStage.loadContent('pages/Index', (err) => {
      if (err.code) {
        hilog.error(DOMAIN, 'testTag', 'Failed to load the content. Cause: %{public}s', JSON.stringify(err));
        return;
      }
      hilog.info(DOMAIN, 'testTag', 'Succeeded in loading the content.');
      if (JxzxProbe.shouldAutoRun()) {
        const ctx = this.context;
        setTimeout(() => {
          JxzxProbe.run(ctx).then((r: string) => {
            hilog.info(DOMAIN, 'testTag', 'jxzx probe auto done, lines=%{public}d', r.split('\n').length);
          }).catch((e: Error) => {
            hilog.error(DOMAIN, 'testTag', 'jxzx probe auto fail: %{public}s', JSON.stringify(e));
          });
        }, 1500);
      }
    });

    // 测试期常亮：App 在前台时屏幕不自动熄灭（避免 M1/M2 调试中反复锁屏）
    windowStage.getMainWindow()
      .then((win: window.Window) => {
        this.mainWindow = win;
        this.keepScreenOn(true);
      })
      .catch((err: Error) => {
        hilog.error(DOMAIN, 'testTag', 'getMainWindow fail: %{public}s', JSON.stringify(err));
      });
  }

  onWindowStageDestroy(): void {
    // Main window is destroyed, release UI related resources
    hilog.info(DOMAIN, 'testTag', '%{public}s', 'Ability onWindowStageDestroy');
  }

  onForeground(): void {
    // Ability has brought to foreground
    hilog.info(DOMAIN, 'testTag', '%{public}s', 'Ability onForeground');
    this.keepScreenOn(true);
    // M9-8 前台监控生命周期：App 回到前台，解除监控暂停
    setForeground(true);
  }

  onBackground(): void {
    // Ability has back to background
    hilog.info(DOMAIN, 'testTag', '%{public}s', 'Ability onBackground');
    // 退后台就交还系统正常休眠，避免整机耗电
    this.keepScreenOn(false);
    // M9-8 前台监控生命周期：App 退后台，监控轮询必须暂停（鸿蒙限制 + 铁律 0.6 禁止后台抢座）
    setForeground(false);
  }

  /** 常亮开关（测试辅助）。仅作用于主窗口，前后台自动切换。
   *  窗口句柄在 onWindowStageCreate 时已取得并存到 this.mainWindow。 */
  private keepScreenOn(on: boolean): void {
    const win = this.mainWindow;
    if (win === undefined) {
      hilog.warn(DOMAIN, 'testTag', 'keepScreenOn skipped: mainWindow not ready (on=%{public}s)', on ? 'on' : 'off');
      return;
    }
    win.setWindowKeepScreenOn(on);
    hilog.info(DOMAIN, 'testTag', 'keepScreenOn=%{public}s', on ? 'on' : 'off');
  }
}