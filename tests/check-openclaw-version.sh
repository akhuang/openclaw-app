#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION_FILE="$ROOT/openclaw.version"

fail() {
    echo "FAIL: $1" >&2
    exit 1
}

expect_contains() {
    local file="$1"
    local needle="$2"
    if ! rg -F -q "$needle" "$file"; then
        fail "$file is missing expected text: $needle"
    fi
}

expect_missing() {
    local file="$1"
    local needle="$2"
    if rg -F -q "$needle" "$file"; then
        fail "$file still contains stale text: $needle"
    fi
}

[ -s "$VERSION_FILE" ] || fail "missing version file: $VERSION_FILE"

VERSION="$(tr -d '\r\n' < "$VERSION_FILE")"
[ -n "$VERSION" ] || fail "version file is empty"
TGZ="$ROOT/pkg/openclaw-${VERSION}.tgz"
NODE_EXE="$ROOT/bin/node.exe"
NPM_CMD="$ROOT/bin/npm.cmd"

expect_contains "$ROOT/run.bat" "openclaw.version"
expect_contains "$ROOT/run.sh" "openclaw.version"
expect_contains "$ROOT/install.bat" "openclaw.version"
expect_contains "$ROOT/run.bat" 'set "OPENCLAW_STATE_DIR=!OC_STATE_DIR!"'
expect_contains "$ROOT/run.bat" 'set "OPENCLAW_CONFIG_PATH=!OC_CONFIG_PATH!"'
expect_contains "$ROOT/run.bat" 'set "OPENCLAW_WORKSPACE_DIR=!OC_WORKSPACE_DIR!"'
expect_contains "$ROOT/run.bat" 'script\open-dashboard.js'
expect_contains "$ROOT/run.bat" 'script\patch-openclaw-runtime.js'
expect_contains "$ROOT/install.bat" 'set "OPENCLAW_STATE_DIR=!OC_STATE_DIR!"'
expect_contains "$ROOT/install.bat" 'set "OPENCLAW_CONFIG_PATH=!OC_CONFIG_PATH!"'
expect_contains "$ROOT/install.bat" 'set "OPENCLAW_WORKSPACE_DIR=!OC_WORKSPACE_DIR!"'
expect_contains "$ROOT/install.bat" 'script\patch-openclaw-runtime.js'
expect_contains "$ROOT/run.sh" 'export OPENCLAW_STATE_DIR="$OC_STATE_DIR"'
expect_contains "$ROOT/run.sh" 'export OPENCLAW_CONFIG_PATH="$OC_CONFIG_PATH"'
expect_contains "$ROOT/run.sh" 'export OPENCLAW_WORKSPACE_DIR="$OC_WORKSPACE_DIR"'
expect_contains "$ROOT/run.sh" 'script/patch-openclaw-runtime.js'
expect_contains "$ROOT/run.sh" '[异常] Control UI 补丁应用失败'
expect_contains "$ROOT/script/launcher.js" "process.env.OPENCLAW_STATE_DIR"
expect_contains "$ROOT/script/launcher.js" "process.env.OPENCLAW_CONFIG_PATH"
expect_contains "$ROOT/script/launcher.js" "process.env.OPENCLAW_WORKSPACE_DIR"
expect_contains "$ROOT/script/patch-openclaw-runtime.js" "openclaw.version"

expect_contains "$ROOT/run.bat" "pkg\\openclaw-!REQUIRED_VER!.tgz"
expect_contains "$ROOT/run.sh" "pkg/openclaw-\${REQUIRED_VER}.tgz"
expect_contains "$ROOT/install.bat" "pkg\\openclaw-!REQUIRED_VER!.tgz"
expect_contains "$ROOT/run.sh" 'CURRENT_VER="${CURRENT_VER#OpenClaw }"'
expect_contains "$ROOT/run.bat" 'set "OC_NPM_PREFIX=!OC_RUNTIME_DIR!\npm-global"'
expect_contains "$ROOT/run.bat" 'set "OPENCLAW_CMD=!OC_NPM_PREFIX!\openclaw.cmd"'
expect_contains "$ROOT/run.bat" 'set "OPENCLAW_ENTRY=!OC_NPM_PREFIX!\node_modules\openclaw\openclaw.mjs"'
expect_contains "$ROOT/install.bat" 'set "OC_NPM_PREFIX=!OC_RUNTIME_DIR!\npm-global"'
expect_contains "$ROOT/install.bat" 'set "OPENCLAW_CMD=!OC_NPM_PREFIX!\openclaw.cmd"'
expect_contains "$ROOT/install.bat" 'set "OPENCLAW_ENTRY=!OC_NPM_PREFIX!\node_modules\openclaw\openclaw.mjs"'

expect_contains "$ROOT/README.md" "openclaw.version"
expect_contains "$ROOT/build/README.md" "openclaw.version"

expect_missing "$ROOT/run.bat" "2026.3.13"
expect_missing "$ROOT/run.bat" 'timeout /t 5 /nobreak >nul && start http://127.0.0.1:18789'
expect_missing "$ROOT/run.sh" "2026.3.13"
expect_missing "$ROOT/install.bat" "2026.3.13"
expect_missing "$ROOT/README.md" "2026.3.13"
expect_missing "$ROOT/build/README.md" "2026.3.13"
expect_missing "$ROOT/README.md" "~/.openclaw/openclaw.json"

[ -f "$ROOT/script/open-dashboard.js" ] || fail "missing dashboard auto-open helper: $ROOT/script/open-dashboard.js"
[ -f "$ROOT/script/patch-openclaw-runtime.js" ] || fail "missing runtime patch helper: $ROOT/script/patch-openclaw-runtime.js"
[ -f "$TGZ" ] || fail "missing bundled package: $TGZ"
[ -f "$NODE_EXE" ] || fail "missing bundled node executable: $NODE_EXE"
[ -f "$NPM_CMD" ] || fail "missing bundled npm command: $NPM_CMD"
tar -tzf "$TGZ" | rg -F -q "package/openclaw.mjs" || fail "tgz is missing package/openclaw.mjs"

echo "PASS: OpenClaw version references are centralized at $VERSION"
