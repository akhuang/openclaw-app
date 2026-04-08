#!/bin/bash
set -euo pipefail

echo "============================================"
echo "  OpenClaw 内网版 启动器"
echo "============================================"
echo ""

OC_ROOT="$(cd "$(dirname "$0")" && pwd)"
NODE_VERSION="22.16.0"
VERSION_FILE="$OC_ROOT/openclaw.version"
OC_DATA_DIR="$OC_ROOT/data"
OC_STATE_DIR="$OC_DATA_DIR/.openclaw"
OC_CONFIG_PATH="$OC_STATE_DIR/openclaw.json"
OC_WORKSPACE_DIR="$OC_DATA_DIR/workspace"
OC_RUNTIME_DIR="$OC_ROOT/runtime"
OC_NPM_PREFIX="$OC_RUNTIME_DIR/npm-global"
OC_NPM_CACHE="$OC_RUNTIME_DIR/npm-cache"
OPENCLAW_CMD="$OC_NPM_PREFIX/bin/openclaw"

export OPENCLAW_STATE_DIR="$OC_STATE_DIR"
export OPENCLAW_CONFIG_PATH="$OC_CONFIG_PATH"
export OPENCLAW_WORKSPACE_DIR="$OC_WORKSPACE_DIR"
export OC_LOCAL_NPM="${OC_ROOT}/bin/npm"
export OC_LOCAL_OPENCLAW_CMD="$OPENCLAW_CMD"

load_dotenv() {
    local node_cmd=""

    if [ -x "$OC_ROOT/bin/node" ]; then
        node_cmd="$OC_ROOT/bin/node"
    elif command -v node &>/dev/null; then
        node_cmd="$(command -v node)"
    else
        return
    fi

    if [ ! -f "$OC_ROOT/script/print-dotenv.js" ]; then
        return
    fi

    local dotenv_exports
    dotenv_exports="$("$node_cmd" --no-warnings "$OC_ROOT/script/print-dotenv.js" --format=sh)"
    if [ -n "$dotenv_exports" ]; then
        eval "$dotenv_exports"
        echo "[信息] 已加载 .env 配置"
    fi
}

echo "[信息] OpenClaw 状态目录: $OPENCLAW_STATE_DIR"
echo "[信息] OpenClaw 配置文件: $OPENCLAW_CONFIG_PATH"
echo "[信息] OpenClaw 工作区: $OPENCLAW_WORKSPACE_DIR"
echo ""

if [ ! -s "$VERSION_FILE" ]; then
    echo "[错误] 找不到版本文件 $VERSION_FILE"
    exit 1
fi

REQUIRED_VER="$(tr -d '\r\n' < "$VERSION_FILE")"
LOCAL_TGZ="$OC_ROOT/pkg/openclaw-${REQUIRED_VER}.tgz"

# ============================================================
# 检查 / 安装 Node.js
# ============================================================
NODE_MAJOR_MIN=22
NEED_NODE_INSTALL=0

if command -v node &>/dev/null; then
    SYS_NODE_MAJOR=$(node --version | sed 's/v\([0-9]*\).*/\1/')
    if [ "$SYS_NODE_MAJOR" -ge "$NODE_MAJOR_MIN" ]; then
        echo "[信息] 使用系统 Node.js $(node --version)"
    else
        echo "[信息] 系统 Node 版本过低 (需要 v${NODE_MAJOR_MIN}+)，将安装内置版本"
        NEED_NODE_INSTALL=1
    fi
else
    NEED_NODE_INSTALL=1
fi

if [ "$NEED_NODE_INSTALL" = "1" ]; then
    echo "[安装] 安装 Node.js v${NODE_VERSION}..."

    ARCH=$(uname -m)
    OS=$(uname -s | tr '[:upper:]' '[:lower:]')

    case "$ARCH" in
        x86_64)  ARCH="x64" ;;
        aarch64|arm64) ARCH="arm64" ;;
        *) echo "[错误] 不支持的架构: $ARCH"; exit 1 ;;
    esac

    NODE_TAR=$(ls "$OC_ROOT"/pkg/node-v*-${OS}-${ARCH}.tar.* 2>/dev/null | head -1)

    if [ -n "$NODE_TAR" ]; then
        echo "[安装] 发现离线 Node.js 包: $(basename "$NODE_TAR")"
    else
        echo "[错误] 未找到离线 Node.js 包，已禁止联网下载"
        echo "[错误] 请先将 node-v${NODE_VERSION}-${OS}-${ARCH}.tar.xz 放入 pkg/"
        exit 1
    fi

    echo "[安装] 正在解压..."
    mkdir -p "$OC_ROOT/bin"
    tar -xf "$NODE_TAR" -C "$OC_ROOT/bin" --strip-components=1

    if ! "$OC_ROOT/bin/node" --version &>/dev/null; then
        echo "[错误] Node.js 安装失败"
        exit 1
    fi
    echo "[安装] Node.js $("$OC_ROOT/bin/node" --version) 安装完成"

    export PATH="$OC_ROOT/bin:$PATH"
fi

load_dotenv

OPENCLAW_EXTRA_ARGS=()
if [ -n "${OPENCLAW_LOG_LEVEL:-}" ]; then
    OPENCLAW_EXTRA_ARGS+=(--log-level "$OPENCLAW_LOG_LEVEL")
    echo "[信息] OpenClaw 日志级别: $OPENCLAW_LOG_LEVEL"
fi

# ============================================================
# 安装/更新官方 openclaw CLI
# ============================================================
NEED_INSTALL=1
CURRENT_VER=""

if [ -x "$OPENCLAW_CMD" ]; then
    CURRENT_VER=$("$OPENCLAW_CMD" --version 2>/dev/null || echo "0")
    CURRENT_VER="${CURRENT_VER#OpenClaw }"
    CURRENT_VER="${CURRENT_VER%% *}"
    if [ "$CURRENT_VER" != "$REQUIRED_VER" ]; then
        echo "[安装] 当前 openclaw 版本 $CURRENT_VER，需要 $REQUIRED_VER"
        NEED_INSTALL=1
    else
        NEED_INSTALL=0
    fi
fi

if [ "$NEED_INSTALL" = "1" ]; then
    echo "[安装] 安装 openclaw@${REQUIRED_VER}..."
    NPM=""
    if [ -x "$OC_ROOT/bin/npm" ]; then
        NPM="$OC_ROOT/bin/npm"
    elif command -v npm &>/dev/null; then
        NPM="npm"
    fi
    if [ -z "$NPM" ]; then
        echo "[错误] 未找到 npm，无法安装 openclaw CLI"
        exit 1
    fi
    mkdir -p "$OC_NPM_PREFIX" "$OC_NPM_CACHE"
    if [ -f "$LOCAL_TGZ" ]; then
        "$NPM" install -g --prefix "$OC_NPM_PREFIX" --cache "$OC_NPM_CACHE" "$LOCAL_TGZ"
    else
        echo "[错误] 未找到匹配版本的离线包: $LOCAL_TGZ"
        echo "[错误] 已禁止从 npm registry 下载 openclaw"
        exit 1
    fi
    if [ ! -x "$OPENCLAW_CMD" ]; then
        echo "[错误] openclaw CLI 安装失败: $OPENCLAW_CMD"
        exit 1
    fi
    echo "[安装] openclaw CLI 安装成功"
fi

# ============================================================
# 步骤 0.5: 修复 Control UI 停止任务失效问题
# ============================================================
node --no-warnings "$OC_ROOT/script/patch-openclaw-runtime.js" || {
    echo "[异常] Control UI 补丁应用失败"
    exit 1
}

# ============================================================
# 检查 openclaw 可用
# ============================================================
if [ ! -x "$OPENCLAW_CMD" ]; then
    echo "[错误] openclaw 命令不可用: $OPENCLAW_CMD"
    exit 1
fi

# 检查模板配置
if [ ! -f "$OC_ROOT/script/openclaw.json" ]; then
    echo "[错误] 找不到配置模板 script/openclaw.json"
    exit 1
fi

# ============================================================
# 步骤 1: 配置初始化 + 注册
# ============================================================
echo ""
node --no-warnings "$OC_ROOT/script/launcher.js"

# ============================================================
# 步骤 1.5: 自动准备本地 Welink 插件
# ============================================================
if [ -f "$OC_ROOT/extensions/welink/package.json" ]; then
    echo ""
    echo "[安装] 检查 Welink 本地插件..."
    node --no-warnings "$OC_ROOT/script/setup-welink-plugin.js"
fi

# ============================================================
# 步骤 2: 启动代理 (后台)
# ============================================================
echo ""
echo "[启动] 启动安全代理..."
node --no-warnings "$OC_ROOT/script/proxy.js" &
PROXY_PID=$!

cleanup() {
    echo ""
    echo "[INFO] 正在清理..."
    kill $PROXY_PID 2>/dev/null
    exit 0
}
trap cleanup SIGINT SIGTERM EXIT

# ============================================================
# 步骤 3: 启动 Gateway (前台)
# ============================================================
echo "[启动] 启动 OpenClaw Gateway..."
echo ""

"$OPENCLAW_CMD" "${OPENCLAW_EXTRA_ARGS[@]}" gateway run --port 18789
