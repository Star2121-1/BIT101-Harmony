#!/bin/bash
# 真机验证重试脚本（USB 极不稳定，设备随时掉线）
# 用法：bash tools/run_probe.sh [hdc目标序列号]
# 逻辑：等设备 → 装包 → 启动并自动跑教务探针 → 读沙箱报告；任一步失败整体重试。
export MSYS_NO_PATHCONV=1
HDC="${HDC_BIN:-/f/Agent_Work/BIT-102/harmony/clt/command-line-tools/sdk/default/openharmony/toolchains/hdc.exe}"
SERIAL="${1:-4CY9K25614019980}"
T="-t $SERIAL"
PROJ="$(cd "$(dirname "$0")/.." && pwd)"
HAP_REL="entry/build/default/outputs/default/entry-default-signed.hap"
FILES="/data/app/el2/100/base/cn.bit101.next/haps/entry/files"

cd "$PROJ" || exit 1
[ -f "$HAP_REL" ] || { echo "HAP 不存在：$HAP_REL（先 assembleHap）"; exit 1; }

for attempt in 1 2 3 4 5 6 7 8; do
  echo "=== attempt $attempt ==="
  for i in $(seq 1 40); do
    $HDC list targets 2>&1 | grep -q "$SERIAL" && break
    sleep 3
  done
  $HDC list targets 2>&1 | grep -q "$SERIAL" || { echo "device absent, wait more"; continue; }

  echo "device present; installing..."
  $HDC $T install -r "$HAP_REL" 2>&1 | grep -q "successfully" || { echo "install failed; retry"; continue; }

  echo "installed; running probe..."
  OUT=$($HDC $T shell "aa force-stop cn.bit101.next; aa start -b cn.bit101.next -a EntryAbility --ps probe_jxzx 1; sleep 16; cat $FILES/jxzx_probe.txt" 2>&1)
  if echo "$OUT" | grep -q "cookies="; then
    echo "=== PROBE REPORT ==="
    echo "$OUT"
    exit 0
  fi
  echo "no report (device dropped?); retry"
done
echo "ALL ATTEMPTS FAILED"
exit 1
