#!/usr/bin/env bash
#
# moli-e2e-test · 一键运行器
#
#   一键完成：准备 Node → 确保 Moli CDP 服务 → 确保 playwright → 跑用例 → 出 HTML 报告
#
# 用法：
#   ./run.sh init                             # 在被测项目根创建 e2e/ 目录骨架
#   ./run.sh                                  # 跑内置自检，或自动跑 ./e2e/specs 下用例
#   ./run.sh ~/proj/e2e/specs/login.spec.mjs --base-url http://localhost:3000
#   ./run.sh ./e2e/specs --base-url http://localhost:3000
#   ./run.sh --list                           # 列出将要运行的用例文件
#
# 目录约定（重要）：所有 e2e 产物统一收在项目的 e2e/ 下，不在项目根散落：
#   e2e/specs/       用例（*.spec.mjs）
#   e2e/reports/     测试报告（report.html / report.json）
#   e2e/screenshots/ 截图
#
# 所有非本脚本自用的参数都会透传给 run.mjs（--base-url / --endpoint /
# --e2e-dir / --report-dir / --shots-dir / --no-human / --shots / --timeout / --list）。
#
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(dirname "$HERE")"

# ---------- 脚手架：在被测项目根创建 e2e/ 目录 ----------
if [ "${1:-}" = "init" ]; then
  E2E_DIR="${2:-e2e}"
  mkdir -p "$E2E_DIR/specs" "$E2E_DIR/reports" "$E2E_DIR/screenshots"
  touch "$E2E_DIR/reports/.gitkeep" "$E2E_DIR/screenshots/.gitkeep"
  if [ ! -f "$E2E_DIR/specs/example.spec.mjs" ] && [ -f "$SKILL_DIR/examples/login.spec.mjs" ]; then
    cp "$SKILL_DIR/examples/login.spec.mjs" "$E2E_DIR/specs/example.spec.mjs"
    echo "[moli-e2e] 已放置示例用例: $E2E_DIR/specs/example.spec.mjs（改选择器即可用）"
  fi
  echo "[moli-e2e] ✓ 已在 $(pwd)/$E2E_DIR 创建目录骨架："
  echo "            specs/        用例（*.spec.mjs）"
  echo "            reports/      测试报告（report.html / report.json）"
  echo "            screenshots/  截图"
  echo "          把用例放进 $E2E_DIR/specs/，然后："
  echo "            bash $0 ./$E2E_DIR/specs --base-url http://localhost:3000"
  exit 0
fi

# ---------- 选择 Node（需 >= 18）----------
pick_node() {
  local candidates=()
  command -v node >/dev/null 2>&1 && candidates+=("$(command -v node)")
  local v
  for v in "$HOME"/.workbuddy/binaries/node/versions/*/bin/node; do
    [ -x "$v" ] && candidates+=("$v")
  done
  local c major
  for c in "${candidates[@]}"; do
    major="$("$c" -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
    if [ "${major:-0}" -ge 18 ]; then echo "$c"; return 0; fi
  done
  return 1
}

NODE_BIN="$(pick_node)" || {
  echo "[moli-e2e] ❌ 需要 Node.js >= 18（当前 PATH 中的 node 版本过低或无 node）" >&2
  exit 2
}
NPM_BIN="$(dirname "$NODE_BIN")/npm"
[ -x "$NPM_BIN" ] || NPM_BIN="$(command -v npm || true)"

# ---------- 解析端点（本脚本据此管理服务）----------
ENDPOINT="${MOLI_CDP:-}"
if [ -z "$ENDPOINT" ]; then
  args=("$@")
  for ((i = 0; i < ${#args[@]}; i++)); do
    if [ "${args[i]}" = "--endpoint" ]; then ENDPOINT="${args[i + 1]:-}"; fi
  done
fi
ENDPOINT="${ENDPOINT:-http://127.0.0.1:9222}"
case "$ENDPOINT" in http*) ;; *) ENDPOINT="http://$ENDPOINT" ;; esac

# ---------- 定位 Moli ----------
find_moli() {
  command -v moli 2>/dev/null && return 0
  [ -x "$HOME/.local/bin/moli" ] && { echo "$HOME/.local/bin/moli"; return 0; }
  [ -x "$HOME/.moli/bin/moli" ] && { echo "$HOME/.moli/bin/moli"; return 0; }
  return 1
}

MOLI_BIN="$(find_moli)" || {
  echo "[moli-e2e] ❌ 未找到 moli，正在安装（最新版）..." >&2
  curl --proto '=https' --tlsv1.2 -fsSL \
    https://github.com/lexmount/moli/releases/latest/download/moli-installer.sh | sh >&2 || {
    echo "[moli-e2e] ❌ Moli 安装失败，请手动安装后重试" >&2
    exit 2
  }
  MOLI_BIN="$(find_moli)" || { echo "[moli-e2e] ❌ 安装后仍找不到 moli" >&2; exit 2; }
}

# ---------- 确保 Moli CDP 服务在跑 ----------
ensure_serve() {
  if curl -sf --max-time 2 "$ENDPOINT/json/version" >/dev/null 2>&1; then
    echo "[moli-e2e] ✓ Moli 服务已在 $ENDPOINT"
    return 0
  fi
  echo "[moli-e2e] 启动 Moli 服务: $MOLI_BIN serve --layout"
  local log="${TMPDIR:-/tmp}/moli_serve.log"
  nohup "$MOLI_BIN" serve --layout >"$log" 2>&1 &
  disown 2>/dev/null || true
  local i
  for i in $(seq 1 40); do
    if curl -sf --max-time 1 "$ENDPOINT/json/version" >/dev/null 2>&1; then
      echo "[moli-e2e] ✓ Moli 服务就绪（${i} 次探测）"
      return 0
    fi
    sleep 0.5
  done
  echo "[moli-e2e] ❌ Moli 服务启动超时，日志: $log" >&2
  tail -20 "$log" >&2 2>/dev/null || true
  return 1
}

ensure_serve || exit 3

# ---------- 确保 playwright 可用 ----------
ensure_pw() {
  # harness 能自行在多个目录解析；这里仅在全都找不到时安装到 skill 目录
  if MOLI_PW_PATHS="$SKILL_DIR" "$NODE_BIN" -e "require.resolve('playwright')" >/dev/null 2>&1; then
    echo "[moli-e2e] ✓ playwright 已就绪"
    return 0
  fi
  echo "[moli-e2e] 安装 playwright（跳过浏览器下载，Moli 即浏览器）..."
  if [ -z "$NPM_BIN" ]; then
    echo "[moli-e2e] ⚠️ 找不到 npm，无法自动安装 playwright" >&2
    return 0
  fi
  (cd "$SKILL_DIR" && PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 PLAYWRIGHT_SKIP_SHARD_DOWNLOAD=1 "$NPM_BIN" install --no-audit --no-fund) >&2 || {
    echo "[moli-e2e] ⚠️ playwright 安装失败（若别处已有可忽略）" >&2
  }
}
ensure_pw

# ---------- 运行用例 ----------
exec "$NODE_BIN" "$HERE/run.mjs" "$@"
