#!/usr/bin/env python3
"""M6-2 真机取证：作息编辑页 + TimePicker + 保存后课表时间列是否跟着变。

跑法：python tools/run_timetable.py
产物：evidence/m6-timetable/*.json / *.jpeg
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
OUTDIR = r"F:/Agent_Work/BIT-102/harmony/evidence/m6-timetable"
HAP = os.path.join(PROJ, "entry/build/default/outputs/default/entry-default-signed.hap")
MARK = "现在去哪儿自习"

os.environ["MSYS_NO_PATHCONV"] = "1"


def run(args, timeout=90, cwd=None):
    try:
        p = subprocess.run(args, capture_output=True, text=True, timeout=timeout,
                           encoding="utf-8", errors="replace", cwd=cwd)
        return p.returncode, (p.stdout or "") + (p.stderr or "")
    except subprocess.TimeoutExpired:
        return 124, "TIMEOUT"


def wait_device(max_tries=40, gap=3):
    for i in range(max_tries):
        code, out = run([HDC, "list", "targets"], timeout=20)
        if SERIAL in out:
            c2, o2 = run([HDC] + TARGET + ["shell", "echo DEV_OK"], timeout=25)
            if "DEV_OK" in o2:
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


def tap(texts, label, nth=0):
    hits = [(t, b) for t, b in (texts or []) if t == label]
    if len(hits) <= nth:
        print("    WARN 找不到「%s」" % label)
        return False
    c = center(hits[nth][1])
    if c is None:
        return False
    sh("uitest uiInput click %d %d" % (c[0], c[1]), timeout=40)
    print("    点了「%s」@%s" % (label, c))
    return True


def show(texts, n=20):
    for t, _ in (texts or [])[:n]:
        print("      " + t)


def ensure_foreground():
    for attempt in range(4):
        sh("aa start -b cn.bit101.next -a EntryAbility", timeout=40)
        time.sleep(6 if attempt == 0 else 3)
        texts = dump_named("tt-fg")
        if texts and any(MARK in t for t, _ in texts):
            return texts
    return None


def main():
    os.makedirs(OUTDIR, exist_ok=True)
    if not wait_device():
        print("FAIL 设备不可用")
        return 1

    print("[1] 装包")
    code, out = run([HDC] + TARGET + ["install", "-r", HAP], timeout=120)
    print("    " + ("ok" if "successfully" in out else "可能失败"))

    print("[2] 冷启动")
    sh("hilog -r; aa force-stop cn.bit101.next; sleep 1", timeout=60)
    if ensure_foreground() is None:
        print("FAIL App 起不到前台")
        return 1

    print("[3] 设置 → 作息时间")
    tap(dump_named("tt-home"), "设置")
    time.sleep(3)
    st = dump_named("tt-settings")
    if not tap(st, "作息时间"):
        show(st, 26)
        return 1
    time.sleep(3)
    tt = dump_named("tt-page")
    shot("tt-page")
    show(tt, 20)

    print("[4] 点第 1 节的开始时间（应弹 TimePicker）")
    # 第一行第一个时间按钮：文本形如 08:00
    first_time = None
    for t, b in (tt or []):
        if re.fullmatch(r"\d{2}:\d{2}", t):
            first_time = (t, b)
            break
    if first_time is None:
        print("    WARN 页面上没找到时间按钮")
        return 1
    c = center(first_time[1])
    print("    起点 = %s @%s" % (first_time[0], c))
    sh("uitest uiInput click %d %d" % (c[0], c[1]), timeout=40)
    time.sleep(3)
    dlg = dump_named("tt-picker")
    shot("tt-picker")
    show(dlg, 20)

    print("DONE")
    return 0


if __name__ == "__main__":
    sys.exit(main())
