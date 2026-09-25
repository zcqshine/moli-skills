#!/usr/bin/env bash
#
# sync-moli-skills.sh — 把 moli skills 从「已安装版」同步到另两份副本，
#                      并自动处理 frontmatter 里 agent_created 标记的加/去。
#
# 三份副本：
#   1. 源     $HOME/.workbuddy/skills/<skill>    ← 改代码只改这里（唯一真源）
#   2. agents $HOME/.agents/skills/<skill>       ← 保留 agent_created: true
#   3. 镜像   <repo>/skills/<skill>              ← 去掉 agent_created（对外分发）
#
# 背景：三份副本曾经静默漂移（改完只同步 mirror、漏掉 agents），导致另一份一直跑旧行为。
#       本脚本把同步 + 标记处理 + 一致性校验做成一条命令。
#
# 用法：
#   sync-moli-skills.sh                      # 同步默认 skill（moli-e2e-test）
#   sync-moli-skills.sh moli-webfetch        # 指定 skill（可传多个）
#   sync-moli-skills.sh --all                # 同步源里全部 moli-* skill
#   sync-moli-skills.sh --check              # 只报漂移，不改动（有漂移则退出码 1）
#   sync-moli-skills.sh --dry-run            # 预览将要同步/删除的内容
#   sync-moli-skills.sh --git                # 同步后对镜像仓库 commit + push
#   sync-moli-skills.sh --repo <dir>         # 指定镜像仓库路径
#
# 环境变量：
#   MOLI_SKILLS_REPO   镜像仓库路径（默认自动探测 $HOME/WorkBuddy/*/moli-skills）
#
# 退出码：0 成功 / 无漂移；1 校验失败或有漂移；2 用法或环境错误
#
# 兼容 macOS 自带 bash 3.2（不用关联数组 / ${var,,} / mapfile）。
#
set -uo pipefail

SRC_ROOT="${HOME}/.workbuddy/skills"
AGENTS_ROOT="${HOME}/.agents/skills"
REPO_ROOT="${MOLI_SKILLS_REPO:-}"
DEFAULT_SKILLS=("moli-e2e-test")

# 不参与同步的内容：依赖、运行产物、系统垃圾
# 注意 rsync 与 diff 的排除参数写法不同，必须分开定义
RSYNC_OPTS=(-a --delete --checksum)   # --checksum：按内容判断，避免 mtime 噪声
# SKILL.md 需要按目标加/去 agent_created，不走 rsync 直传（否则每次都会重写目标文件）
RSYNC_EXCLUDES=(
  --exclude 'node_modules'
  --exclude '.DS_Store'
  --exclude 'e2e'
  --exclude 'moli-reports'
  --exclude '.git'
  --exclude '*.log'
  --exclude 'SKILL.md'
)
DIFF_EXCLUDES=(
  -x 'node_modules'
  -x '.DS_Store'
  -x 'e2e'
  -x 'moli-reports'
  -x '.git'
  -x '*.log'
  -x 'SKILL.md'
)

MODE="sync"        # sync | check
DRY_RUN=0
DO_GIT=0
ALL=0
SKILLS=()          # bash 3.2 下空数组 + set -u 有坑，配合 NSKILL 计数使用
NSKILL=0
EXIT=0

# ---------- 输出 ----------
c_ok()   { printf '  [ok]   %s\n' "$*"; }
c_warn() { printf '  [warn] %s\n' "$*"; }
c_err()  { printf '  [err]  %s\n' "$*"; }
c_drift(){ printf '  [drift] %s\n' "$*"; }
hdr()    { printf '\n%s\n' "$*"; }

usage() {
  sed -n '2,29p' "$0" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

# ---------- 参数 ----------
while [ $# -gt 0 ]; do
  case "$1" in
    --all)      ALL=1 ;;
    --check)    MODE="check" ;;
    --dry-run)  DRY_RUN=1 ;;
    --git)      DO_GIT=1 ;;
    --repo)     shift
                REPO_ROOT="${1:-}"
                if [ -z "$REPO_ROOT" ]; then c_err "--repo 需要一个目录参数"; exit 2; fi ;;
    -h|--help)  usage 0 ;;
    -*)         echo "未知参数: $1" >&2; usage 2 ;;
    *)          SKILLS[${NSKILL}]="$1"; NSKILL=$((NSKILL + 1)) ;;
  esac
  shift
done

# ---------- 定位镜像仓库 ----------
if [ -z "$REPO_ROOT" ]; then
  for d in "$HOME"/WorkBuddy/*/moli-skills; do
    if [ -d "$d/skills" ]; then REPO_ROOT="$d"; break; fi
  done
fi
if [ -z "$REPO_ROOT" ] || [ ! -d "$REPO_ROOT/skills" ]; then
  c_err "找不到镜像仓库（需含 skills/ 目录）。用 --repo <dir> 或设置 MOLI_SKILLS_REPO。"
  exit 2
fi
REPO_ROOT="$(cd "$REPO_ROOT" && pwd)"

# ---------- 解析要同步的 skill ----------
if [ "$ALL" = 1 ]; then
  for d in "$SRC_ROOT"/moli-*; do
    [ -d "$d" ] || continue
    SKILLS[${NSKILL}]="$(basename "$d")"
    NSKILL=$((NSKILL + 1))
  done
fi
if [ "$NSKILL" -eq 0 ]; then
  SKILLS=("${DEFAULT_SKILLS[@]}")
  NSKILL=${#DEFAULT_SKILLS[@]}
fi

# ---------- frontmatter 标记处理 ----------
has_marker() { grep -q '^agent_created:' "$1" 2>/dev/null; }

add_marker() {
  local f="$1"
  if has_marker "$f"; then return 0; fi
  # 插到 name: 那一行之后（三份副本的既有版式）
  perl -i -CSD -pe 'if (!$d && /^name:\s/) { $_ .= "agent_created: true\n"; $d = 1 }' "$f"
  if ! has_marker "$f"; then
    c_err "无法写入 agent_created: $f"
    return 1
  fi
  return 0
}

strip_marker() {
  local f="$1"
  if ! has_marker "$f"; then return 0; fi
  perl -i -CSD -pe 's/^agent_created:[^\n]*\n//' "$f"
  if has_marker "$f"; then
    c_err "无法去除 agent_created: $f"
    return 1
  fi
  return 0
}

# 去掉标记行后的正文（用于比对，忽略标记差异）
body_of() { grep -v '^agent_created:' "$1"; }

# 从 rsync -i 输出里滤掉「仅 mtime 不同」的噪声行。
# itemize 串格式 YXcstpoguax：先去掉更新类型(Y)与文件类型(X)，余下若只含 '.'/'t'，即纯粹时间戳差异。
# 例：.f..t....  → 滤掉；.f..tp...（权限也变了）→ 保留；>fcst.... → 保留；*deleting → 保留。
filter_changes() {
  printf '%s\n' "$1" | awk '
    /^[[:space:]]*$/ { next }
    {
      tok = $1
      if (tok == "*deleting") { print; next }
      rest = substr(tok, 1, 1) substr(tok, 3)
      if (rest ~ /^[.t]*$/) { next }
      print
    }'
}

# ---------- 一致性校验 ----------
# 返回 0 = 一致；否则打印差异并返回 1
verify() {
  local skill="$1" src="$2" tgt="$3" want_marker="$4"
  local bad=0

  if [ ! -d "$tgt" ]; then c_drift "$skill: 目标不存在 → $tgt"; return 1; fi

  # 1) 除 SKILL.md 外的文件全量比对（SKILL.md 已在 DIFF_EXCLUDES 中排除）
  local d
  d="$(diff -rq "$src" "$tgt" "${DIFF_EXCLUDES[@]}" 2>&1)"
  if [ -n "$d" ]; then
    printf '%s\n' "$d" | while IFS= read -r line; do c_drift "$skill: $line"; done
    bad=1
  fi

  # 2) SKILL.md 正文比对（忽略 agent_created 行）
  if [ ! -f "$tgt/SKILL.md" ]; then
    c_drift "$skill: 目标缺 SKILL.md"; bad=1
  elif ! diff <(body_of "$src/SKILL.md") <(body_of "$tgt/SKILL.md") >/dev/null 2>&1; then
    c_drift "$skill: SKILL.md 正文不一致"
    diff <(body_of "$src/SKILL.md") <(body_of "$tgt/SKILL.md") 2>&1 | head -12 | sed 's/^/         /'
    bad=1
  fi

  # 3) 标记状态
  if [ "$want_marker" = 1 ]; then
    has_marker "$tgt/SKILL.md" || { c_drift "$skill: 缺少 agent_created 标记"; bad=1; }
  else
    has_marker "$tgt/SKILL.md" && { c_drift "$skill: 残留 agent_created 标记"; bad=1; }
  fi

  # 4) run.sh 执行位
  if [ -f "$tgt/scripts/run.sh" ] && [ ! -x "$tgt/scripts/run.sh" ]; then
    c_drift "$skill: scripts/run.sh 丢了执行位"
    bad=1
  fi

  return "$bad"
}

# ---------- 同步一份 ----------
# $1 skill  $2 目标根目录  $3 是否保留 agent_created (1/0)
do_sync() {
  local skill="$1" tgt_root="$2" want_marker="$3"
  local src="$SRC_ROOT/$skill"
  local tgt="$tgt_root/$skill"
  local label
  [ "$want_marker" = 1 ] && label="agents" || label="mirror"

  mkdir -p "$tgt_root"

  # SKILL.md 特殊处理：源带标记、目标不带（或反之），直接 rsync 覆盖会导致每次都被重写。
  # 改为只比「去掉 agent_created 后的正文」，正文真变了才重写，再强制标记状态。
  local body_differs=0 marker_differs=0
  if [ ! -f "$tgt/SKILL.md" ]; then
    body_differs=1
  elif ! diff <(body_of "$src/SKILL.md") <(body_of "$tgt/SKILL.md") >/dev/null 2>&1; then
    body_differs=1
  fi
  if [ "$want_marker" = 1 ]; then
    has_marker "$tgt/SKILL.md" 2>/dev/null || marker_differs=1
  else
    # 正文若要重写，复制过来的副本自带标记，同样需要去除
    if [ "$body_differs" = 1 ] || has_marker "$tgt/SKILL.md" 2>/dev/null; then
      marker_differs=1
    fi
  fi

  if [ "$DRY_RUN" = 1 ]; then
    local changed
    changed="$(filter_changes "$(rsync "${RSYNC_OPTS[@]}" -n -i "${RSYNC_EXCLUDES[@]}" "$src/" "$tgt/" 2>&1)")"
    [ -n "$changed" ] && printf '%s\n' "$changed" | sed 's/^/         /'
    [ "$body_differs" = 1 ] && echo "         > SKILL.md（正文将更新）"
    if [ "$marker_differs" = 1 ]; then
      if [ "$want_marker" = 1 ]; then
        echo "         + 将添加 agent_created: true"
      else
        echo "         - 将去除 agent_created"
      fi
    fi
    if [ -z "$changed" ] && [ "$body_differs" = 0 ] && [ "$marker_differs" = 0 ]; then
      echo "         （已是最新，无变化）"
    fi
    return 0
  fi

  # 同步前记录是否已有漂移（用于最后汇总用词）
  local pre_drift=0
  verify "$skill" "$src" "$tgt" "$want_marker" >/dev/null 2>&1 || pre_drift=1

  local out rc changes
  out="$(rsync "${RSYNC_OPTS[@]}" -i "${RSYNC_EXCLUDES[@]}" "$src/" "$tgt/" 2>&1)"
  rc=$?
  if [ "$rc" -ne 0 ]; then
    c_err "$skill → $label: rsync 失败（exit ${rc}）"
    printf '%s\n' "$out" | sed 's/^/         /'
    return 1
  fi
  # 报出内容/属性变化与删除（mtime 噪声已由 --checksum + filter_changes 排除）
  changes="$(filter_changes "$out")"
  if [ -n "$changes" ]; then
    printf '%s\n' "$changes" | sed 's/^/         /'
  fi

  # SKILL.md：正文有变才重写，然后强制标记状态
  if [ "$body_differs" = 1 ]; then
    if ! cp "$src/SKILL.md" "$tgt/SKILL.md"; then
      c_err "$skill → $label: 复制 SKILL.md 失败"
      return 1
    fi
    echo "         > SKILL.md（正文已更新）"
  fi
  if [ "$want_marker" = 1 ]; then
    add_marker "$tgt/SKILL.md" || return 1
  else
    strip_marker "$tgt/SKILL.md" || return 1
  fi

  # 校验
  if verify "$skill" "$src" "$tgt" "$want_marker"; then
    if [ "$pre_drift" = 1 ]; then c_ok "$skill → $label: 已同步并校验通过"
    else c_ok "$skill → $label: 已是最新（校验通过）"; fi
  else
    c_err "$skill → $label: 同步后校验失败"
    return 1
  fi
}

# ---------- 主流程 ----------
hdr "源:     $SRC_ROOT"
hdr "agents: $AGENTS_ROOT"
hdr "镜像:   $REPO_ROOT/skills"
printf '\nskills: %s\n' "${SKILLS[*]}"
[ "$MODE" = "check" ] && printf '模式: 只检查（--check）\n'
[ "$DRY_RUN" = 1 ]    && printf '模式: 预览（--dry-run）\n'

for skill in "${SKILLS[@]}"; do
  hdr "── $skill ──"
  src="$SRC_ROOT/$skill"

  if [ ! -d "$src" ]; then
    c_err "源不存在: $src"
    EXIT=1
    continue
  fi
  if [ ! -f "$src/SKILL.md" ]; then
    c_err "源缺 SKILL.md: $src/SKILL.md"
    EXIT=1
    continue
  fi

  if [ "$MODE" = "check" ]; then
    if verify "$skill" "$src" "$AGENTS_ROOT/$skill" 1; then
      c_ok "$skill → agents: 一致"
    else
      c_warn "$skill → agents: 有漂移"
      EXIT=1
    fi
    if verify "$skill" "$src" "$REPO_ROOT/skills/$skill" 0; then
      c_ok "$skill → mirror: 一致"
    else
      c_warn "$skill → mirror: 有漂移"
      EXIT=1
    fi
    continue
  fi

  do_sync "$skill" "$AGENTS_ROOT" 1 || EXIT=1
  do_sync "$skill" "$REPO_ROOT/skills" 0 || EXIT=1
done

# ---------- 镜像仓库 git ----------
if [ "$DO_GIT" = 1 ] && [ "$MODE" = "sync" ] && [ "$DRY_RUN" = 0 ]; then
  hdr "── git（镜像仓库）──"
  if [ -z "$(git -C "$REPO_ROOT" status --porcelain -- skills 2>/dev/null)" ]; then
    c_ok "skills/ 无改动，跳过提交"
  else
    out_msg="$(printf '%s' "${SKILLS[*]}")"
    if ! git -C "$REPO_ROOT" add -A skills >/dev/null 2>&1; then
      c_err "git add 失败"
      EXIT=1
    elif ! git -C "$REPO_ROOT" commit -q -m "sync(moli-skills): 同步 ${out_msg} 副本（自动处理 agent_created）" >/dev/null 2>&1; then
      c_err "git commit 失败"
      EXIT=1
    elif push_out="$(git -C "$REPO_ROOT" push 2>&1)"; then
      c_ok "已提交并推送（${out_msg}）"
    else
      c_err "已提交，但 push 失败（检查 remote / SSH key）："
      printf '%s\n' "$push_out" | grep -v '^[[:space:]]*$' | tail -3 | sed 's/^/         /'
      EXIT=1
    fi
  fi
fi

hdr "完成（退出码 ${EXIT}）"
exit "$EXIT"
