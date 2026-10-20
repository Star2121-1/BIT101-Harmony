#!/usr/bin/env python3
"""M3-4/M3-5 真机取证脚本。

为什么是脚本而不是一串手敲命令：这台机的 USB 每 2~4 分钟掉一次，
任何「多轮小往返」都会在中途断掉。这里每一步都带等待设备 + 重试，
坐标从 dumpLayout 里**动态解析**（不写死），UI 一改就不用改脚本。

跑法：python tools/run_spot.py
产物：evidence/m3-spot-detail/*.json / *.jpeg（拉到指定目录）
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
OUTDIR = r"F:/Agent_Work/BIT-102/harmony/evidence/m3-spot-detail"
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
    """等到「设备出现在列表里」**并且**能真正执行命令。

    ⚠️ 只判断 list targets 不够：这台机常见「列表里有、一执行就 Device not found」。
    所以等到 list 命中后，再真的跑一条 echo 验一下。
    """
    for i in range(max_tries):
        if os.path.exists(HDC):
            code, out = run([HDC, "list", "targets"], timeout=20)
            if SERIAL in out:
                code2, out2 = run([HDC] + TARGET + ["shell", "echo DEV_OK"], timeout=25)
                if "DEV_OK" in out2:
                    return True
        # 连续等不到就重启 hdc 服务（这台机的 hdc 会卡在坏连接上）
        if i > 0 and i % 6 == 0:
            run([HDC, "kill"], timeout=15)
            time.sleep(2)
        time.sleep(gap)
    return False


def sh(cmd, timeout=90):
    """在设备上跑一条 shell 命令；断了就等设备回来重试。"""
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
    """拉文件。用 cwd + 相对文件名 —— hdc 对 F:/ 这种正斜杠绝对路径不可靠。"""
    d = os.path.dirname(local)
    base = os.path.basename(local)
    for attempt in range(6):
        if not wait_device():
            continue
        code, out = run([HDC] + TARGET + ["file", "recv", remote, base],
                        timeout=timeout, cwd=d)
        if os.path.exists(local) and os.path.getsize(local) > 0:
            return True
        if attempt >= 2:
            run([HDC, "kill"], timeout=15)
        time.sleep(4)
    return False


def dump(path):
    sh("uitest dumpLayout -p " + path)
    return path


def parse_texts(node, acc):
    a = node.get("attributes", {})
    txt = (a.get("text") or "").strip()
    if txt:
        acc.append((txt, a.get("bounds") or ""))
    for c in node.get("children", []):
        parse_texts(c, acc)
    return acc


def center(bounds):
    m = re.findall(r"-?\d+", bounds or "")
    if len(m) < 4:
        return None
    x1, y1, x2, y2 = (int(v) for v in m[:4])
    return ((x1 + x2) // 2, (y1 + y2) // 2)


def local_dump(name):
    """拉回一份 dump 并解析成 [(text, bounds)]。"""
    remote = "/data/local/tmp/%s.json" % name
    dump(remote)
    local = os.path.join(OUTDIR, "%s.json" % name)
    if os.path.exists(local):
        os.remove(local)
    if not recv(remote, local):
        return None
    with open(local, encoding="utf-8") as f:
        return parse_texts(json.load(f), [])


def tap(x, y):
    sh("uitest uiInput click %d %d" % (x, y), timeout=40)


def shot(name):
    remote = "/data/local/tmp/%s.jpeg" % name
    local = os.path.join(OUTDIR, "%s.jpeg" % name)
    sh("snapshot_display -f " + remote, timeout=60)
    if os.path.exists(local):
        os.remove(local)
    return recv(remote, local)


def find(texts, pred):
    for t, b in texts or []:
        if pred(t):
            return t, b
    return None, None


def main():
    os.makedirs(OUTDIR, exist_ok=True)
    if not wait_device():
        print("FAIL: 设备一直没回来")
        return 1

    print("[1] 装包")
    code, out = run([HDC] + TARGET + ["install", "-r", HAP], timeout=120)
    print("    " + ("ok" if "successfully" in out else "install 可能失败: " + out[-200:]))

    print("[2] 冷启动 + 首页 dump")
    sh("hilog -r; aa force-stop cn.bit101.next; "
       "aa start -b cn.bit101.next -a EntryAbility; sleep 9", timeout=150)
    texts = local_dump("spot-home")
    if texts is None:
        print("FAIL: 首页 dump 拉不回来")
        return 1
    print("    首页文案: " + " | ".join(t for t, _ in texts[:10]))

    # 找「算一下」/「重新算」按钮
    label, bounds = find(texts, lambda t: t in ("算一下", "重新算"))
    if label is None:
        print("FAIL: 首页找不到「算一下」按钮")
        return 1
    c = center(bounds)
    print("[3] 点「%s」@%s" % (label, c))
    tap(c[0], c[1])

    print("[4] 等 30 秒（逐栋查空教室）")
    time.sleep(30)
    texts2 = local_dump("spot-card")
    shot("spot-card")
    if texts2:
        for t, _ in texts2[:14]:
            print("    " + t)

    # 找「全部 N 个」
    label2, bounds2 = find(texts2, lambda t: t.startswith("全部 ") and t.endswith(" 个"))
    if label2 is None:
        print("WARN: 没看到「全部 N 个」按钮（降级态可能没有候选）")
        return 0
    c2 = center(bounds2)
    print("[5] 点「%s」@%s" % (label2, c2))
    tap(c2[0], c2[1])
    time.sleep(4)
    texts3 = local_dump("spot-detail")
    shot("spot-detail")
    if texts3:
        print("[6] 详情页文案:")
        for t, _ in texts3[:22]:
            print("    " + t)
    print("DONE")
    return 0


if __name__ == "__main__":
    sys.exit(main())
