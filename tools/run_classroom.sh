#!/bin/bash
# 空教室页真机取证（带重试；USB 每 2~4 分钟掉一次，必须自带等待）
# 用法：bash tools/run_classroom.sh
export MSYS_NO_PATHCONV=1
HDC="${HDC_BIN:-/f/Agent_Work/BIT-102/harmony/clt/command-line-tools/sdk/default/openharmony/toolchains/hdc.exe}"
SERIAL="${1:-4CY9K25614019980}"
T="-t $SERIAL"
PROJ="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$PROJ/../evidence/m3-classroom"
mkdir -p "$OUT"
cd "$PROJ" || exit 1

wait_device() {
  for i in $(seq 1 40); do
    $HDC list targets 2>&1 | grep -q "$SERIAL" && return 0
    sleep 3
  done
  return 1
}

for attempt in 1 2 3 4 5; do
  echo "=== attempt $attempt ==="
  wait_device || { echo "device absent"; continue; }

  # 一次 shell 跑完整套：启动 → 空教室 → 展开第一栋楼 → dump + 截图
  $HDC $T shell "hilog -r; aa force-stop cn.bit101.next; aa start -b cn.bit101.next -a EntryAbility; sleep 7; uitest uiInput click 768 255; sleep 13; uitest uiInput click 574 693; sleep 8; uitest dumpLayout -p /data/local/tmp/nc.json; snapshot_display -f /data/local/tmp/nc.jpeg; hilog -x | grep BIT101 > /data/local/tmp/nc.log; echo SHELL_DONE" 2>&1 | tail -2

  cd "$OUT" && rm -f nc.json nc.jpeg nc.log
  $HDC $T file recv /data/local/tmp/nc.json nc.json >/dev/null 2>&1
  $HDC $T file recv /data/local/tmp/nc.jpeg nc.jpeg >/dev/null 2>&1
  $HDC $T file recv /data/local/tmp/nc.log nc.log >/dev/null 2>&1
  cd "$PROJ" || exit 1

  if [ -s "$OUT/nc.json" ]; then
    echo "=== OK ==="
    ( cd "$OUT" && python - <<'PY'
import json
d=json.load(open('nc.json',encoding='utf-8'))
out=[]
def walk(n):
    a=n.get('attributes',{}); t=(a.get('text') or '').strip()
    if t: out.append(t)
    for c in n.get('children',[]): walk(c)
walk(d)
print(' | '.join(out[:30]))
PY
    )
    grep -E "rooms|ClassroomService" "$OUT/nc.log" 2>/dev/null | tail -3
    exit 0
  fi
  echo "no layout; retry"
done
echo "ALL ATTEMPTS FAILED"
exit 1
