#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

fail() {
    echo "FAIL: $1" >&2
    exit 1
}

command -v node >/dev/null 2>&1 || fail "node is required to run this test"

TMP_BASE="$(mktemp -d)"
trap 'rm -rf "$TMP_BASE"' EXIT

STATE_DIR="$TMP_BASE/state"
WORKSPACE_DIR="$TMP_BASE/workspace"
FAKE_HOME="$TMP_BASE/home"
CONFIG_PATH="$STATE_DIR/openclaw.json"

mkdir -p "$STATE_DIR" "$WORKSPACE_DIR" "$FAKE_HOME"

make_skill() {
    local dir="$1"
    local name="$2"
    mkdir -p "$dir/$name"
    cat > "$dir/$name/SKILL.md" <<EOF
---
name: $name
description: "test skill $name"
---
# $name
EOF
}

# 模拟各类“外部” skills 来源
make_skill "$WORKSPACE_DIR/skills" "external-workspace-skill"        # ClawHub 安装落点
make_skill "$WORKSPACE_DIR/.agents/skills" "external-proj-agents-skill"
make_skill "$FAKE_HOME/.agents/skills" "external-personal-skill"
make_skill "$STATE_DIR/skills" "external-managed-skill"
make_skill "$STATE_DIR/plugin-skills" "external-plugin-skill"        # 插件生成的 skills 目录

HOME="$FAKE_HOME" \
OPENCLAW_STATE_DIR="$STATE_DIR" \
OPENCLAW_CONFIG_PATH="$CONFIG_PATH" \
OPENCLAW_WORKSPACE_DIR="$WORKSPACE_DIR" \
OPENCLAW_PRESERVE_CONFIG=0 \
node "$ROOT/script/launcher.js" >/dev/null 2>&1 || fail "launcher.js exited non-zero"

[ -f "$CONFIG_PATH" ] || fail "launcher did not write config: $CONFIG_PATH"

ROOT_DIR="$ROOT" CONFIG_PATH="$CONFIG_PATH" node <<'EOF' || exit 1
const fs = require('fs');
const path = require('path');

const root = process.env.ROOT_DIR;
const config = JSON.parse(fs.readFileSync(process.env.CONFIG_PATH, 'utf8'));

const failures = [];
const expect = (cond, message) => { if (!cond) failures.push(message); };

const PROJECT_SKILLS = ['intranet-analyzer', 'supply-query'];
const EXTERNAL_SKILLS = [
    'external-workspace-skill',
    'external-proj-agents-skill',
    'external-personal-skill',
    'external-managed-skill',
    'external-plugin-skill',
];

// 1. 只允许从仓库 skills/ 目录加载 extra skills
const extraDirs = config?.skills?.load?.extraDirs;
expect(
    Array.isArray(extraDirs) &&
        extraDirs.length === 1 &&
        path.resolve(extraDirs[0]) === path.resolve(root, 'skills'),
    `skills.load.extraDirs should only contain repo skills dir, got: ${JSON.stringify(extraDirs)}`
);

// 2. bundled skills 通过非空 allowlist 哨兵全量禁用
const allowBundled = config?.skills?.allowBundled;
expect(
    Array.isArray(allowBundled) && allowBundled.length > 0,
    `skills.allowBundled should be a non-empty sentinel allowlist, got: ${JSON.stringify(allowBundled)}`
);

// 3. 所有外部来源的 skills 都被按名称禁用
for (const name of EXTERNAL_SKILLS) {
    expect(
        config?.skills?.entries?.[name]?.enabled === false,
        `external skill should be disabled via skills.entries: ${name}`
    );
}

// 4. 仓库业务 skills 不允许被禁用
for (const name of PROJECT_SKILLS) {
    expect(
        config?.skills?.entries?.[name]?.enabled !== false,
        `project skill must stay enabled: ${name}`
    );
}

// 5. agents.defaults.skills 白名单兜底：只放行仓库业务 skills，
//    运行时新装的 ClawHub/workshop/plugin skills 即使启动后出现也不会激活
const agentSkills = config?.agents?.defaults?.skills;
expect(
    Array.isArray(agentSkills) && agentSkills.length > 0,
    `agents.defaults.skills allowlist should be set, got: ${JSON.stringify(agentSkills)}`
);
if (Array.isArray(agentSkills)) {
    expect(
        JSON.stringify([...agentSkills].sort()) === JSON.stringify([...PROJECT_SKILLS].sort()),
        `agents.defaults.skills should equal project skills ${JSON.stringify(PROJECT_SKILLS)}, got: ${JSON.stringify(agentSkills)}`
    );
}

if (failures.length > 0) {
    for (const message of failures) console.error(`FAIL: ${message}`);
    process.exit(1);
}
EOF

echo "PASS: launcher disables all external skills and allowlists project skills only"
