#!/usr/bin/env python3
"""未登录态取证：M6-4 判据（课表变「需要登录」）+ M3-5 的 nologin 降级分支。

前提：设备当前处于「无 cookie 但保留了课表缓存」的状态（登出后的状态）。

跑法：python tools/run_nologin.py
产物：evidence/m6-settings/nologin-*.json / *.jpeg
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
MARK = "现在去哪儿自习"

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


def tap(texts, label):
    for t, b in texts or []:
        if t == label:
            c = center(b)
            if c:
                sh("uitest uiInput click %d %d" % (c[0], c[1]), timeout=40)
                print("    点了「%s」@%s" % (label, c))
                return True
    print("    WARN 找不到「%s」" % label)
    return False


def show(texts, n=16):
    for t, _ in (texts or [])[:n]:
        print("      " + t)


def ensure_foreground():
    for attempt in range(4):
        sh("aa start -b cn.bit101.next -a EntryAbility", timeout=40)
        time.sleep(6 if attempt == 0 else 3)
        texts = dump_named("nologin-fg")
        if texts and any(MARK in t for t, _ in texts):
            return texts
    return None


def main():
    os.makedirs(OUTDIR, exist_ok=True)
    if not wait_device():
        print("FAIL 设备不可用")
        return 1

    print("[1] 装包（带上刚修的 cookie 罐清理）")
    code, out = run([HDC] + TARGET + ["install", "-r", HAP], timeout=120)
    print("    " + ("ok" if "successfully" in out else "可能失败"))

    print("[2] 冷启动")
    sh("hilog -r; aa force-stop cn.bit101.next; sleep 1", timeout=60)
    home = ensure_foreground()
    if home is None:
        print("FAIL App 起不到前台")
        return 1

    print("[3] 点「算一下」（未登录态）")
    if tap(home, "算一下"):
        time.sleep(8)
        card = dump_named("nologin-card")
        shot("nologin-card")
        show(card, 14)

    print("[4] 进课表（未登录态）")
    cur = dump_named("nologin-home2")
    if tap(cur, "课表"):
        time.sleep(14)
        sch = dump_named("nologin-schedule")
        shot("nologin-schedule")
        show(sch, 14)

    print("DONE")
    return 0


if __name__ == "__main__":
    sys.exit(main())
