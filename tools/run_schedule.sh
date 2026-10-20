#!/bin/bash
# 真机课表验证脚本（带重试，USB 不稳）
# 做四件事：装包 → 冷启动 → 进入课表页 → 拉回布局与日志并打印页面文字。
export MSYS_NO_PATHCONV=1
HDC="${HDC_BIN:-/f/Agent_Work/BIT-102/harmony/clt/command-line-tools/sdk/default/openharmony/toolchains/hdc.exe}"
SERIAL="${1:-4CY9K25614019980}"
T="-t $SERIAL"
PROJ="$(cd "$(dirname "$0")/.." && pwd)"
HAP_REL="entry/build/default/outputs/default/entry-default-signed.hap"
OUTDIR="$PROJ/../evidence/m2-1-session/tmp"
mkdir -p "$OUTDIR"

cd "$PROJ" || exit 1
[ -f "$HAP_REL" ] || { echo "HAP 缺失：先 assembleHap"; exit 1; }

for attempt in 1 2 3 4 5 6 7 8; do
  echo "=== attempt $attempt ==="
  for i in $(seq 1 40); do
    $HDC list targets 2>&1 | grep -q "$SERIAL" && break
    sleep 3
  done
  $HDC list targets 2>&1 | grep -q "$SERIAL" || { echo "device absent"; continue; }

  $HDC $T install -r "$HAP_REL" 2>&1 | grep -q "successfully" || { echo "install failed"; continue; }
  echo "installed; running UI flow..."

  $HDC $T shell "hilog -r; aa force-stop cn.bit101.next; aa start -b cn.bit101.next -a EntryAbility; sleep 6; uitest uiInput click 911 255; sleep 22; uitest dumpLayout -p /data/local/tmp/sched.json; hilog -x | grep BIT101 > /data/local/tmp/sched_h.log" >/dev/null 2>&1

  cd "$OUTDIR" && rm -f sched.json sched_h.log
  $HDC $T file recv /data/local/tmp/sched.json sched.json >/dev/null 2>&1
  $HDC $T file recv /data/local/tmp/sched_h.log sched_h.log >/dev/null 2>&1
  cd "$PROJ" || exit 1

  if [ -s "$OUTDIR/sched.json" ]; then
    echo "=== PAGE TEXTS ==="
    ( cd "$OUTDIR" && python - <<'PY'
import json
d=json.load(open('sched.json',encoding='utf-8'))
out=[]
def walk(n):
    a=n.get('attributes',{}); t=(a.get('text') or '').strip()
    if t: out.append(t)
    for c in n.get('children',[]): walk(c)
walk(d)
print(' | '.join(out[:40]))
PY
    )
    echo "=== HILOG (BIT101) ==="
    tail -15 "$OUTDIR/sched_h.log" 2>/dev/null
    exit 0
  fi
  echo "no layout (device dropped?); retry"
done
echo "ALL ATTEMPTS FAILED"
exit 1
