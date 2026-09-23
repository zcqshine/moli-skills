#!/usr/bin/env bash
#
# moli-e2e-test · 一键运行器
#
#   一键完成：准备 Node → 确保 Moli CDP 服务 → 确保 playwright → 跑用例 → 出 HTML 报告
#
# 用法：
#   ./run.sh init [--e2e-dir DIR]             # 在被测项目根创建 e2e/ 目录骨架
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
# 环境变量：
#   MOLI_VERSION             安装 moli 时锚定的版本，默认 v1.1.9（设为 latest 可拉最新）
#   MOLI_INSTALLER_SHA256    若提供，则校验安装脚本 sha256，不匹配即中止
#   MOLI_INSTALL_STRICT=1    严格模式：未提供 SHA256 时拒绝安装
#   MOLI_CDP / REPORT_DIR / SHOTS_DIR / E2E_DIR / MOLI_HUMAN / MOLI_SHOTS / MOLI_TIMEOUT
#
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(dirname "$HERE")"

# ---------- 小工具 ----------
has_arg() {  # has_arg <flag> "$@"
  local want="$1"; shift
  local a
  for a in "$@"; do [ "$a" = "$want" ] && return 0; done
  return 1
}

# ---------- 脚手架：在被测项目根创建 e2e/ 目录 ----------
if [ "${1:-}" = "init" ]; then
  shift || true
  E2E_DIR="e2e"
  if has_arg "--e2e-dir" "$@"; then
    while [ $# -gt 0 ]; do
      case "$1" in
        --e2e-dir) E2E_DIR="${2:-}"; shift 2 ;;
        --e2e-dir=*) E2E_DIR="${1#--e2e-dir=}"; shift ;;
        *) shift ;;
      esac
    done
  elif [ $# -ge 1 ] && [ "${1#-}" = "$1" ]; then
    E2E_DIR="$1"   # 兼容位置参数：run.sh init my-e2e
  fi
  if [ -z "$E2E_DIR" ] || [ "${E2E_DIR#-}" != "$E2E_DIR" ]; then
    echo "[moli-e2e] ❌ 无效的目录名: '${E2E_DIR:-<空>}'（用 --e2e-dir DIR）" >&2
    exit 2
  fi
  set -e
  mkdir -p -- "$E2E_DIR/specs" "$E2E_DIR/reports" "$E2E_DIR/screenshots"
  touch "$E2E_DIR/specs/.gitkeep" "$E2E_DIR/reports/.gitkeep" "$E2E_DIR/screenshots/.gitkeep"
  if [ ! -f "$E2E_DIR/specs/README.md" ]; then
    cat >"$E2E_DIR/specs/README.md" <<'SPEC_README'
# e2e/specs

把用例（`*.spec.mjs`）放在本目录，默认导出一个注册函数：

```js
export default function register(session) {
  session.describe('模块 · 场景', () => {
    session.it('用例名', async (t) => {
      await t.human.goto('/path');
      await t.expect.visible('.selector');
    });
  });
}
```

跑本目录全部用例：

```bash
bash <skill目录>/scripts/run.sh ./e2e/specs --base-url http://localhost:3000
```

模板可参考 skill 自带的 `examples/login.spec.mjs`。
SPEC_README
  fi
  echo "[moli-e2e] ✓ 已在 $(pwd)/$E2E_DIR 创建目录骨架："
  echo "            specs/        用例（*.spec.mjs）"
  echo "            reports/      测试报告（report.html / report.json）"
  echo "            screenshots/  截图"
  echo "          把用例放进 $E2E_DIR/specs/，然后："
  echo "            bash $0 ./$E2E_DIR/specs --base-url http://localhost:3000"
  echo "          验证环境（跑内置自检，不需要外部服务）："
  echo "            bash $0 \"$SKILL_DIR/scripts/self-test.spec.mjs\""
  exit 0
fi

# ---------- 选择 Node（需 >= 20，playwright 1.63 的 engines 要求）----------
pick_node() {
  local candidates=()
  command -v node >/dev/null 2>&1 && candidates+=("$(command -v node)")
  local v
  for v in "$HOME"/.workbuddy/binaries/node/versions/*/bin/node; do
    [ -x "$v" ] && candidates+=("$v")
  done
  local c major
  # bash 3.2 下空数组 + set -u 会因 "${arr[@]}" 报 unbound，故用 ${arr[@]+...}
  for c in ${candidates[@]+"${candidates[@]}"}; do
    major="$("$c" -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
    if [ "${major:-0}" -ge 20 ]; then echo "$c"; return 0; fi
  done
  return 1
}

NODE_BIN="$(pick_node)" || {
  echo "[moli-e2e] ❌ 需要 Node.js >= 20（playwright 依赖要求；当前 PATH 中的 node 版本过低或无 node）" >&2
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

# 拆出 host / port，供 moli serve 使用（自定义端口时不能只探不管）
EP_HOSTPORT="${ENDPOINT#http://}"
EP_HOSTPORT="${EP_HOSTPORT#https://}"
EP_HOSTPORT="${EP_HOSTPORT%%/*}"
case "$EP_HOSTPORT" in
  *:*) EP_HOST="${EP_HOSTPORT%%:*}"; EP_PORT="${EP_HOSTPORT##*:}" ;;
  *)   EP_HOST="$EP_HOSTPORT"; EP_PORT="9222" ;;
esac
[ -n "$EP_HOST" ] || EP_HOST="127.0.0.1"
[ -n "$EP_PORT" ] || EP_PORT="9222"

# ---------- 项目根校验：避免在子目录运行时产物静默错位 ----------
find_project_root() {
  local d="$PWD"
  while [ -n "$d" ] && [ "$d" != "/" ]; do
    if [ -e "$d/.git" ] || [ -e "$d/package.json" ] || [ -d "$d/e2e" ]; then
      echo "$d"; return 0
    fi
    d="$(dirname "$d")"
  done
  return 1
}
PROJECT_ROOT="$(find_project_root || true)"
if [ -n "$PROJECT_ROOT" ] && [ "$PROJECT_ROOT" != "$PWD" ] && ! has_arg "--e2e-dir" "$@" && ! has_arg "--report-dir" "$@"; then
  echo "[moli-e2e] ⚠️ 当前目录不是项目根（疑似项目根: $PROJECT_ROOT）。" >&2
  echo "[moli-e2e]    产物将落在 $PWD/e2e/；若想收在项目根，请在项目根运行或加 --e2e-dir $PROJECT_ROOT/e2e" >&2
fi

# ---------- 定位 / 安装 Moli ----------
find_moli() {
  command -v moli 2>/dev/null && return 0
  [ -x "$HOME/.local/bin/moli" ] && { echo "$HOME/.local/bin/moli"; return 0; }
  [ -x "$HOME/.moli/bin/moli" ] && { echo "$HOME/.moli/bin/moli"; return 0; }
  return 1
}

MOLI_VERSION="${MOLI_VERSION:-v1.1.9}"   # 默认锚定已验证版本，避免静默换引擎

install_moli() {
  local ver="$MOLI_VERSION" url tmp sum rc
  if [ "$ver" = "latest" ]; then
    url="https://github.com/lexmount/moli/releases/latest/download/moli-installer.sh"
  else
    url="https://github.com/lexmount/moli/releases/download/${ver}/moli-installer.sh"
  fi
  tmp="$(mktemp "${TMPDIR:-/tmp}/moli-installer.XXXXXX.sh")" || return 1
  echo "[moli-e2e] 下载 Moli 安装脚本: $url" >&2
  if ! curl --proto '=https' --tlsv1.2 -fsSL "$url" -o "$tmp"; then
    echo "[moli-e2e] ❌ 下载安装脚本失败" >&2; rm -f "$tmp"; return 1
  fi
  sum="$( { shasum -a 256 "$tmp" 2>/dev/null || sha256sum "$tmp" 2>/dev/null; } | awk '{print $1}' )"
  if [ -n "${MOLI_INSTALLER_SHA256:-}" ]; then
    if [ "$sum" != "$MOLI_INSTALLER_SHA256" ]; then
      echo "[moli-e2e] ❌ 安装脚本校验失败（期望 $MOLI_INSTALLER_SHA256，实际 $sum）" >&2
      rm -f "$tmp"; return 1
    fi
    echo "[moli-e2e] ✓ 安装脚本 sha256 校验通过" >&2
  else
    echo "[moli-e2e] ⚠️ 未提供 MOLI_INSTALLER_SHA256，安装脚本 sha256=$sum（可先行核对）" >&2
    if [ "${MOLI_INSTALL_STRICT:-0}" = "1" ]; then
      echo "[moli-e2e] ❌ 严格模式（MOLI_INSTALL_STRICT=1）要求提供 MOLI_INSTALLER_SHA256，已中止" >&2
      rm -f "$tmp"; return 1
    fi
  fi
  sh "$tmp" >&2; rc=$?
  rm -f "$tmp"
  return $rc
}

MOLI_BIN="$(find_moli)" || {
  echo "[moli-e2e] 未找到 moli，尝试安装（版本 ${MOLI_VERSION}）..." >&2
  install_moli || {
    echo "[moli-e2e] ❌ Moli 安装失败。可手动安装: https://github.com/lexmount/moli" >&2
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
  local log; log="$(mktemp "${TMPDIR:-/tmp}/moli_serve.XXXXXX.log")"
  echo "[moli-e2e] 启动 Moli 服务: $MOLI_BIN serve --layout --host $EP_HOST --port $EP_PORT"
  nohup "$MOLI_BIN" serve --layout --host "$EP_HOST" --port "$EP_PORT" >"$log" 2>&1 &
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
  # 探测 skill 目录下的 playwright（与 harness 的解析路径一致）
  if MOLI_PW_DIR="$SKILL_DIR" "$NODE_BIN" -e "require.resolve('playwright',{paths:[process.env.MOLI_PW_DIR]})" >/dev/null 2>&1; then
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
