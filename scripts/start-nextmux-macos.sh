#!/bin/bash

set -Eeuo pipefail

# Keep the launcher non-interactive when it is opened by double-clicking the
# .command file. Wrangler otherwise asks for confirmation before local D1
# migrations, which would leave the launcher waiting in a hidden terminal.
export CI="${CI:-1}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_ROOT="$ROOT/.nextmux-run"
WEB_URL="http://127.0.0.1:4173/"
PLATFORM_URL="http://127.0.0.1:4173"
WEB_PID=""
NODE_BIN=""
NODE_EXPECTED_ARCH=""
ELECTRON_BIN=""
DEPENDENCIES_UPDATED=0
DESKTOP_PROFILE="$RUN_ROOT/electron-user-data"

mkdir -p "$RUN_ROOT"

# Every launch is also written to .nextmux-run/launcher.log (and kept as a
# timestamped copy) so a failed start can be diagnosed without the terminal.
LOG_FILE="$RUN_ROOT/launcher.log"
: > "$LOG_FILE"
exec > >(tee -a "$LOG_FILE") 2>&1
printf '[NextMux] 启动时间 %s\n' "$(date '+%Y-%m-%d %H:%M:%S %z')"
on_launch_error() {
  local status=$?
  printf '\n[NextMux] 启动失败（退出码 %s，位置：第 %s 行）。完整日志：%s\n' "$status" "${BASH_LINENO[0]:-?}" "$LOG_FILE" >&2
  cp "$LOG_FILE" "$RUN_ROOT/launcher-failed-$(date '+%Y%m%d-%H%M%S').log" 2>/dev/null || true
}
trap on_launch_error ERR

log_step() {
  printf '\n[NextMux] %s\n' "$1"
}

node_is_supported() {
  local version=""
  local major=""
  local minor=""
  version="$("$1" -p 'process.versions.node' 2>/dev/null || true)"
  IFS=. read -r major minor _ <<< "$version"
  [[ "$major" =~ ^[0-9]+$ && "$minor" =~ ^[0-9]+$ ]] || return 1
  (( major > 22 || (major == 22 && minor >= 12) ))
}

expected_node_arch() {
  local kernel_arch=""
  kernel_arch="$(uname -m)"
  if [[ "$kernel_arch" == "x86_64" && "$(sysctl -in sysctl.proc_translated 2>/dev/null || true)" == "1" ]]; then
    kernel_arch="arm64"
  fi
  case "$kernel_arch" in
    arm64) printf 'arm64\n' ;;
    x86_64) printf 'x64\n' ;;
    *)
      printf '不支持的 macOS CPU 架构：%s（仅支持 Apple Silicon arm64 与 Intel x64）。\n' "$kernel_arch" >&2
      return 1
      ;;
  esac
}

select_node() {
  local candidate=""
  local candidate_arch=""
  local codex_runtime_node=""
  local mismatched_nodes=""
  NODE_EXPECTED_ARCH="$(expected_node_arch)"
  if [[ -n "${HOME:-}" ]]; then
    codex_runtime_node="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
  fi
  local candidates=(
    "$(command -v node 2>/dev/null || true)"
    "/opt/homebrew/opt/node@24/bin/node"
    "/opt/homebrew/opt/node@22/bin/node"
    "/usr/local/opt/node@24/bin/node"
    "/usr/local/opt/node@22/bin/node"
    "$codex_runtime_node"
    "/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node"
  )

  for candidate in "${candidates[@]}"; do
    if [[ -n "$candidate" && -x "$candidate" ]] && node_is_supported "$candidate"; then
      candidate_arch="$("$candidate" -p 'process.arch' 2>/dev/null || true)"
      if [[ "$candidate_arch" == "$NODE_EXPECTED_ARCH" ]]; then
        NODE_BIN="$candidate"
        export PATH="$(dirname "$NODE_BIN"):$PATH"
        return 0
      fi
      mismatched_nodes="${mismatched_nodes}${mismatched_nodes:+, }${candidate_arch:-unknown} ($candidate)"
    fi
  done

  if [[ -n "$mismatched_nodes" ]]; then
    printf '找到 Node.js 22.12+，但架构与本机不匹配（需要 %s）：%s。请安装本机架构的 Node.js。\n' "$NODE_EXPECTED_ARCH" "$mismatched_nodes" >&2
    return 1
  fi
  printf '没有找到 Node.js 22.12 或更高版本。请先执行：brew install node@24\n' >&2
  return 1
}

select_pnpm() {
  local codex_runtime_pnpm=""
  if command -v pnpm >/dev/null 2>&1; then
    PNPM=("$(command -v pnpm)")
    return 0
  fi
  if [[ -n "${HOME:-}" ]]; then
    codex_runtime_pnpm="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm"
  fi
  if [[ -n "$codex_runtime_pnpm" && -x "$codex_runtime_pnpm" ]]; then
    PNPM=("$codex_runtime_pnpm")
    return 0
  fi
  if command -v corepack >/dev/null 2>&1; then
    PNPM=("$(command -v corepack)" pnpm)
    return 0
  fi
  printf '没有找到 pnpm。请安装 pnpm 11.19.0：npm install -g pnpm@11.19.0\n' >&2
  return 1
}

select_electron() {
  # Invoke the downloaded Electron binary directly. The package CLI shim can
  # fall back to Electron's `default_app.asar` when a package-manager worker
  # drops the application path; an absolute binary plus absolute app path
  # makes that failure mode impossible. Keep the shim as a fallback for
  # nonstandard installations.
  local native_binary="$ROOT/apps/desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
  local cli_shim="$ROOT/apps/desktop/node_modules/.bin/electron"
  if [[ -x "$native_binary" ]]; then
    ELECTRON_BIN="$native_binary"
    return 0
  fi
  if [[ -x "$cli_shim" ]]; then
    ELECTRON_BIN="$cli_shim"
    return 0
  fi
  printf '没有找到 NextMux Electron 运行时：%s\n' "$native_binary" >&2
  return 1
}

# Workspace scripts call plain `pnpm` (for example `pnpm desktop:prepare`), so
# the pnpm this script selected must also be reachable by name from the child
# shells, even when it came from the Codex runtime fallback or from corepack.
ensure_pnpm_on_path() {
  if command -v pnpm >/dev/null 2>&1; then
    return 0
  fi
  local shim_dir="${TMPDIR:-/tmp}/nextmux-pnpm-shim-$UID"
  mkdir -p "$shim_dir"
  # A wrapper, not a symlink: bundled pnpm launchers locate their own Node
  # runtime relative to their real path, which a symlink would change.
  rm -f "$shim_dir/pnpm"
  {
    printf '#!/bin/sh\nexec'
    printf ' %q' "${PNPM[@]}"
    printf ' "$@"\n'
  } > "$shim_dir/pnpm"
  chmod 755 "$shim_dir/pnpm"
  export PATH="$shim_dir:$PATH"
}

pnpm_run() {
  (cd "$ROOT" && "${PNPM[@]}" "$@")
}

lock_hash() {
  shasum -a 256 "$ROOT/pnpm-lock.yaml" | awk '{print $1}'
}

dependency_stamp() {
  local electron_version=""
  electron_version="$(cd "$ROOT" && "$NODE_BIN" -p "require('./package.json').devDependencies.electron")"
  printf 'lock=%s;platform=%s;arch=%s;modules=%s;electron=%s\n' \
    "$(lock_hash)" \
    "$("$NODE_BIN" -p 'process.platform')" \
    "$("$NODE_BIN" -p 'process.arch')" \
    "$("$NODE_BIN" -p 'process.versions.modules')" \
    "$electron_version"
}

dependencies_need_install() {
  [[ ! -f "$ROOT/node_modules/.modules.yaml" ]] && return 0
  [[ ! -f "$RUN_ROOT/dependencies.sha256" ]] && return 0
  [[ "$(dependency_stamp)" != "$(tr -d '\r\n' < "$RUN_ROOT/dependencies.sha256")" ]]
}

desktop_build_required() {
  local marker="$ROOT/apps/desktop/lib/frontend/bundle.js"
  [[ ! -f "$marker" ]] && return 0

  find \
    "$ROOT/packages/agent-runtime/src" \
    "$ROOT/packages/model-runtime/src" \
    "$ROOT/packages/comic-core/src" \
    "$ROOT/packages/media-core/src" \
    "$ROOT/packages/theia-nextmux-extension/src" \
    "$ROOT/package.json" \
    "$ROOT/pnpm-lock.yaml" \
    "$ROOT/apps/desktop/package.json" \
    -type f -newer "$marker" -print -quit 2>/dev/null | grep -q .
}

port_owner() {
  lsof -nP -iTCP:4173 -sTCP:LISTEN -t 2>/dev/null | head -n 1
}

wait_for_port() {
  local deadline=$((SECONDS + 30))
  while (( SECONDS < deadline )); do
    if nc -z 127.0.0.1 4173 >/dev/null 2>&1; then
      return 0
    fi
    if [[ -n "$WEB_PID" ]] && ! kill -0 "$WEB_PID" 2>/dev/null; then
      printf '商家门户提前退出。请查看：%s\n' "$RUN_ROOT/web.err.log" >&2
      tail -n 30 "$RUN_ROOT/web.err.log" 2>/dev/null || true
      return 1
    fi
    sleep 0.35
  done
  printf '商家门户未能在 30 秒内监听 127.0.0.1:4173。\n' >&2
  return 1
}

cleanup() {
  if [[ -n "$WEB_PID" ]] && kill -0 "$WEB_PID" 2>/dev/null; then
    log_step "关闭本次启动器创建的后台服务"
    kill "$WEB_PID" 2>/dev/null || true
    wait "$WEB_PID" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

select_node
select_pnpm
ensure_pnpm_on_path

log_step "检查开发环境"
printf '  ✓ Node %s · %s (%s)\n' "$($NODE_BIN --version)" "$NODE_EXPECTED_ARCH" "$NODE_BIN"
printf '  ✓ pnpm %s\n' "$("${PNPM[@]}" --version)"

if dependencies_need_install; then
  log_step "安装或同步 macOS 项目依赖（首次运行可能需要几分钟）"
  pnpm_run install --frozen-lockfile --force
  DEPENDENCIES_UPDATED=1
else
  printf '  ✓ macOS 项目依赖已就绪\n'
fi

if (( DEPENDENCIES_UPDATED == 1 )) || desktop_build_required; then
  log_step "构建 macOS 桌面应用"
  pnpm_run desktop:build
  if (( DEPENDENCIES_UPDATED == 1 )); then
    dependency_stamp > "$RUN_ROOT/dependencies.sha256"
  fi
else
  printf '  ✓ 桌面构建已是最新\n'
fi

# Resolve Electron only after dependency installation/build. This keeps a
# clean checkout bootstrappable while still enforcing the explicit app path
# for the final launch.
select_electron
printf '  ✓ Electron %s (%s)\n' "$(cd "$ROOT/apps/desktop" && "$NODE_BIN" -p "require('./package.json').devDependencies.electron")" "$ELECTRON_BIN"

log_step "准备商家门户本地数据库"
pnpm_run --filter @nextmux/cloudflare-platform run db:migrate:local

owner="$(port_owner || true)"
if [[ -n "$owner" ]]; then
  owner_command="$(ps -p "$owner" -o command= 2>/dev/null || true)"
  if [[ "$owner_command" != *wrangler* && "$owner_command" != *workerd* ]]; then
    printf '端口 4173 已被其他进程占用（PID %s）：%s\n' "$owner" "$owner_command" >&2
    exit 1
  fi
  printf '  ✓ 商家门户已运行（端口 4173，PID %s）\n' "$owner"
else
  log_step "启动 NextMux 网页与平台 API"
  : > "$RUN_ROOT/web.out.log"
  : > "$RUN_ROOT/web.err.log"
  (
    cd "$ROOT/apps/cloudflare-platform"
    exec "${PNPM[@]}" run start >> "$RUN_ROOT/web.out.log" 2>> "$RUN_ROOT/web.err.log"
  ) &
  WEB_PID=$!
  wait_for_port
  printf '  ✓ 商家门户已启动（端口 4173，PID %s）\n' "$WEB_PID"
fi

if [[ "${NEXTMUX_OPEN_PORTAL:-0}" == "1" ]]; then
  log_step "打开 NextMux 门户"
  printf '  %s\n' "$WEB_URL"
  open "$WEB_URL" >/dev/null 2>&1 || true
else
  printf '  ✓ 门户 API 已就绪（需要浏览器预览时设置 NEXTMUX_OPEN_PORTAL=1）\n'
fi

# The desktop client must use the production CF API by default.  The local
# Wrangler server above is only the optional portal preview; local API testing
# remains explicit via NEXTMUX_PLATFORM_API_URL=http://127.0.0.1:4173.
export NEXTMUX_PLATFORM_API_URL="${NEXTMUX_PLATFORM_API_URL:-https://nextmux.app}"
log_step "启动 macOS 桌面应用"
printf '  关闭桌面应用后，本窗口会自动结束。\n'
mkdir -p "$DESKTOP_PROFILE"
# Invoke the Electron package with an explicit application directory.  Theia's
# `start` wrapper can fall back to Electron's default_app when its cwd is
# inherited from a package-manager worker; that is the stock Electron screen
# users were seeing.  A persistent, app-specific profile also prevents other
# Electron programs from stealing the single-instance lock while preserving
# window size and local preferences between launches.
(
  cd "$ROOT/apps/desktop"
  exec "$ELECTRON_BIN" "$ROOT/apps/desktop" \
    --user-data-dir="$DESKTOP_PROFILE" \
    --electronUserData="$DESKTOP_PROFILE" \
    --plugins="local-dir:$ROOT/plugins"
)
