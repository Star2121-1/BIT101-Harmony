#!/usr/bin/env bash
# 跑全部离线单测。不需要 HarmonyOS SDK，不需要设备，纯 Node。
#
#   bash tools/run-tests.sh
#
# 断言条数由脚本自己统计（不手抄）：
#   - 套件在末行报告 `pass=N` 时取 N
#   - 否则数 `^PASS` 行
# 两个来源都只是「这个套件声明自己跑了几条」，真正的判据是退出码。

set -u
cd "$(dirname "$0")/.." || exit 1

NODE_BIN="${NODE_BIN:-node}"
if ! command -v "$NODE_BIN" >/dev/null 2>&1; then
  echo "找不到 node。需要 Node 22.6+（支持 --experimental-strip-types）" >&2
  echo "可用 NODE_BIN=/path/to/node bash tools/run-tests.sh 指定" >&2
  exit 1
fi

node_ver="$("$NODE_BIN" --version 2>/dev/null)"
# Node 22.6 起才有 --experimental-strip-types
major="$(echo "$node_ver" | sed -E 's/^v([0-9]+).*/\1/')"
minor="$(echo "$node_ver" | sed -E 's/^v[0-9]+\.([0-9]+).*/\1/')"
if [ "${major:-0}" -lt 22 ] || { [ "${major:-0}" -eq 22 ] && [ "${minor:-0}" -lt 6 ]; }; then
  echo "Node 版本过低：$node_ver（需要 22.6+ 才支持 --experimental-strip-types）" >&2
  exit 1
fi

suites="test-parser test-teaching test-edges test-shuttle test-colors test-timetable test-eclass test-ddl test-libborrow test-routes test-card test-net test-overlay test-netalert test-notify"
total=0
passed=0
failed_suites=""

for s in $suites; do
  printf '\n──────── %s ────────\n' "$s"
  out="$("$NODE_BIN" --experimental-strip-types "tools/$s.mjs" 2>&1)"
  code=$?
  printf '%s\n' "$out"

  # 断言条数：优先取套件自报的 pass=N，否则数 PASS 行
  n="$(printf '%s\n' "$out" | grep -oE 'pass=[0-9]+' | tail -1 | cut -d= -f2)"
  if [ -z "$n" ]; then
    n="$(printf '%s\n' "$out" | grep -c '^PASS')"
  fi

  if [ "$code" -eq 0 ]; then
    passed=$((passed + 1))
    total=$((total + n))
    printf '→ 通过（%s 条）\n' "$n"
  else
    failed_suites="$failed_suites $s"
    printf '→ 失败（退出码 %s）\n' "$code"
  fi
done

printf '\n════════════════════════════════════\n'
if [ -n "$failed_suites" ]; then
  printf '失败套件:%s\n' "$failed_suites"
  printf '通过 %s/%s 套件，累计 %s 条断言\n' "$passed" "$(echo $suites | wc -w | tr -d ' ')" "$total"
  exit 1
fi
printf 'ALL PASS  通过 %s/%s 套件，累计 %s 条断言\n' \
  "$passed" "$(echo $suites | wc -w | tr -d ' ')" "$total"
