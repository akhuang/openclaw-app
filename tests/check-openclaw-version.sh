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

expect_contains "$ROOT/run.bat" "openclaw.version"
expect_contains "$ROOT/run.sh" "openclaw.version"
expect_contains "$ROOT/install.bat" "openclaw.version"

expect_contains "$ROOT/run.bat" "pkg\\openclaw-!REQUIRED_VER!.tgz"
expect_contains "$ROOT/run.sh" "pkg/openclaw-\${REQUIRED_VER}.tgz"
expect_contains "$ROOT/install.bat" "pkg\\openclaw-%REQUIRED_VER%.tgz"
expect_contains "$ROOT/run.sh" 'CURRENT_VER="${CURRENT_VER#OpenClaw }"'

expect_contains "$ROOT/README.md" "openclaw.version"
expect_contains "$ROOT/build/README.md" "openclaw.version"

expect_missing "$ROOT/run.bat" "2026.3.13"
expect_missing "$ROOT/run.sh" "2026.3.13"
expect_missing "$ROOT/install.bat" "2026.3.13"
expect_missing "$ROOT/README.md" "2026.3.13"
expect_missing "$ROOT/build/README.md" "2026.3.13"

echo "PASS: OpenClaw version references are centralized at $VERSION"
