#!/usr/bin/env python3
"""M6 真机取证：设置页分组 + 深色三屏 + 登出。

沿用 run_spot.py 的重试骨架（这台机 USB 每 2~4 分钟掉一次），
坐标全部从 dumpLayout 动态解析，不写死。

跑法：python tools/run_theme.py [--logout]
  不加 --logout 只验深浅色；加了才会真的登出（**登出后需要重新登录**）。

产物：evidence/m6-settings/*.json / *.jpeg
"""

import json
import os
import re
import subprocess
import sys
import time

HDC = r"F:/Agent_Work/BIT-102/harmony/clt/command-line-tools/sdk/default/openharmony/toolchains/hdc.exe"
SERIAL = "4CY9K25614019980"
TARGET = ["-t", SERIAL]
PROJ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUTDIR = r"F:/Agent_Work/BIT-102/harmony/evidence/m6-settings"
HAP = os.path.join(PROJ, "entry/build/default/outputs/default/entry-default-signed.hap")

os.environ["MSYS_NO_PATHCONV"] = "1"


def run(args, timeout=90, cwd=None):
    try:
        p = subprocess.run(args, capture_output=True, text=True,
                           timeout=timeout, encoding="utf-8", errors="replace", cwd=cwd)
        return p.returncode, (p.stdout or "") + (p.stderr or "")
    except subprocess.TimeoutExpired:
        return 124, "TIMEOUT"


def wait_device(max_tries=40, gap=3):
    for i in range(max_tries):
        if os.path.exists(HDC):
            code, out = run([HDC, "list", "targets"], timeout=20)
            if SERIAL in out:
                code2, out2 = run([HDC] + TARGET + ["shell", "echo DEV_OK"], timeout=25)
                if "DEV_OK" in out2:
                    return True
        if i > 0 and i % 6 == 0:
            run([HDC, "kill"], timeout=15)
            time.sleep(2)
        time.sleep(gap)
    return False


def sh(cmd, timeout=90):
    for attempt in range(6):
        if not wait_device():
            continue
        code, out = run([HDC] + TARGET + ["shell", cmd], timeout=timeout)
        if ("Not match target" not in out and "Device not found" not in out
                and "need connect-key" not in out):
            return out
        if attempt >= 2:
            run([HDC, "kill"], timeout=15)
        time.sleep(5)
    return ""


def recv(remote, local, timeout=60):
    d, base = os.path.dirname(local), os.path.basename(local)
    for attempt in range(6):
        if not wait_device():
            continue
        run([HDC] + TARGET + ["file", "recv", remote, base], timeout=timeout, cwd=d)
        if os.path.exists(local) and os.path.getsize(local) > 0:
            return True
        if attempt >= 2:
            run([HDC, "kill"], timeout=15)
        time.sleep(4)
    return False


def parse_texts(node, acc):
    a = node.get("attributes", {})
    t = (a.get("text") or "").strip()
    if t:
        acc.append((t, a.get("bounds") or ""))
    for c in node.get("children", []):
        parse_texts(c, acc)
    return acc


def center(bounds):
    m = re.findall(r"-?\d+", bounds or "")
    if len(m) < 4:
        return None
    x1, y1, x2, y2 = (int(v) for v in m[:4])
    return ((x1 + x2) // 2, (y1 + y2) // 2)


def dump_named(name):
    remote = "/data/local/tmp/%s.json" % name
    sh("uitest dumpLayout -p " + remote)
    local = os.path.join(OUTDIR, "%s.json" % name)
    if os.path.exists(local):
        os.remove(local)
    if not recv(remote, local):
        return None
    with open(local, encoding="utf-8") as f:
        return parse_texts(json.load(f), [])


def shot(name):
    remote = "/data/local/tmp/%s.jpeg" % name
    local = os.path.join(OUTDIR, "%s.jpeg" % name)
    sh("snapshot_display -f " + remote, timeout=60)
    if os.path.exists(local):
        os.remove(local)
    return recv(remote, local)


def find(texts, pred, exact=True):
    for t, b in texts or []:
        if (t == pred) if exact else pred(t):
            return t, b
    return None, None


def tap_back(texts, note=""):
    """点返回。各页文案不统一（"‹ 返回" / "返回" / 纯 "‹"），按优先级依次尝试。"""
    for label in ("‹ 返回", "返回", "‹"):
        t, b = find(texts, label)
        if t is not None:
            c = center(b)
            if c is not None:
                sh("uitest uiInput click %d %d" % (c[0], c[1]), timeout=40)
                print("    返回：「%s」@%s%s" % (label, c, note))
                return True
    print("    WARN 找不到返回入口%s" % note)
    return False


def tap_label(texts, label, note=""):
    t, b = find(texts, label)
    if t is None:
        print("    WARN 找不到「%s」%s" % (label, note))
        return False
    c = center(b)
    if c is None:
        print("    WARN 「%s」没有 bounds" % label)
        return False
    sh("uitest uiInput click %d %d" % (c[0], c[1]), timeout=40)
    print("    点了「%s」@%s" % (label, c))
    return True


def show(texts, n=18):
    if texts:
        for t, _ in texts[:n]:
            print("      " + t)


MARK = "现在去哪儿自习"


def ensure_foreground():
    """确认我们的 App 真的在前台。

    ⚠️ 栽过：`aa start` 返回 success，但设备上用户正在刷别的 App，dump 出来是抖音界面。
    所以不能只看 aa start 的返回值，要以 dump 里有没有本 App 的特征文案为准。
    """
    for attempt in range(4):
        sh("aa start -b cn.bit101.next -a EntryAbility", timeout=40)
        time.sleep(6 if attempt == 0 else 3)
        texts = dump_named("fg-check")
        if texts and any(MARK in t for t, _ in texts):
            return texts
        print("    前台不是本 App（第 %d 次），重试启动" % (attempt + 1))
    return None


def main():
    do_logout = "--logout" in sys.argv
    os.makedirs(OUTDIR, exist_ok=True)
    if not wait_device():
        print("FAIL 设备不可用")
        return 1

    print("[1] 装包")
    code, out = run([HDC] + TARGET + ["install", "-r", HAP], timeout=120)
    print("    " + ("ok" if "successfully" in out else "可能失败: " + out[-160:]))

    print("[2] 冷启动并确认前台")
    sh("hilog -r; aa force-stop cn.bit101.next; sleep 1", timeout=60)
    home = ensure_foreground()
    if home is None:
        print("FAIL 无法让 App 到前台（设备可能正在被操作）")
        return 1
    home = dump_named("home-light")
    show(home, 6)

    print("[3] 进设置页")
    if not tap_label(home, "设置"):
        return 1
    time.sleep(3)
    st = dump_named("settings-light")
    shot("settings-light")
    show(st, 24)

    print("[4] 切深色")
    if not tap_label(st, "深色"):
        return 1
    time.sleep(2)
    st2 = dump_named("settings-dark")
    shot("settings-dark")
    show(st2, 12)

    print("[5] 返回首页（深色）")
    if not tap_label(st2, "‹ 返回"):
        return 1
    time.sleep(2)
    home2 = dump_named("home-dark")
    shot("home-dark")
    show(home2, 12)

    print("[6] 进课表（深色）")
    if tap_label(home2, "课表"):
        time.sleep(18)
        sch = dump_named("schedule-dark")
        shot("schedule-dark")
        show(sch, 10)

    print("[7] 进空教室（深色）")
    # 先回首页：上一步停在课表页，直接 dump 到的是课表，会找不到「空教室」
    back = dump_named("schedule-dark-check")
    tap_back(back)
    time.sleep(2)
    home3 = dump_named("home-dark2")
    if tap_label(home3, "空教室"):
        time.sleep(12)
        cls = dump_named("classroom-dark")
        shot("classroom-dark")
        show(cls, 8)

    if do_logout:
        print("[8] 登出")
        # 先回首页：上一步停在空教室页
        cur = dump_named("pre-logout-check")
        tap_back(cur)
        time.sleep(2)
        home4 = dump_named("home-dark3")
        tap_label(home4, "设置")
        time.sleep(2)
        st3 = dump_named("settings-before-logout")
        if tap_label(st3, "退出登录"):
            time.sleep(3)
            st4 = dump_named("settings-after-logout")
            shot("settings-after-logout")
            show(st4, 16)
            # 回首页看自习卡是否给「去登录」（M3-5 的 nologin 分支）
            tap_label(st4, "‹ 返回")
            time.sleep(2)
            home5 = dump_named("home-nologin")
            tap_label(home5, "算一下")
            time.sleep(6)
            nc = dump_named("home-nologin-card")
            shot("home-nologin-card")
            show(nc, 14)
    else:
        print("[8] 跳过登出（没加 --logout）")
        # 收尾：切回跟随系统，免得留一个深色状态给后续验证
        back2 = dump_named("classroom-dark-check")
        tap_back(back2)
        time.sleep(2)
        home4 = dump_named("home-dark4")
        tap_label(home4, "设置")
        time.sleep(2)
        st3 = dump_named("settings-restore")
        tap_label(st3, "跟随系统")
        time.sleep(1)

    print("DONE")
    return 0


if __name__ == "__main__":
    sys.exit(main())
