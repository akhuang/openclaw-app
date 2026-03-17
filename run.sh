#!/bin/bash
set -e

echo "============================================"
echo "  OpenClaw 内网版 启动器"
echo "============================================"
echo ""

OC_ROOT="$(cd "$(dirname "$0")" && pwd)"
OC_ENTRY="$OC_ROOT/app/node_modules/openclaw/openclaw.mjs"
NODE_VERSION="22.16.0"

# ============================================================
# 检查 / 安装 Node.js
# ============================================================
if ! command -v node &>/dev/null; then
    echo "[安装] 未检测到 Node.js"

    ARCH=$(uname -m)
    OS=$(uname -s | tr '[:upper:]' '[:lower:]')

    case "$ARCH" in
        x86_64)  ARCH="x64" ;;
        aarch64|arm64) ARCH="arm64" ;;
        *) echo "[错误] 不支持的架构: $ARCH"; exit 1 ;;
    esac

    # 检查离线包
    NODE_TAR=$(ls "$OC_ROOT"/pkg/node-v*-${OS}-${ARCH}.tar.* 2>/dev/null | head -1)

    if [ -n "$NODE_TAR" ]; then
        echo "[安装] 发现离线 Node.js 包: $(basename "$NODE_TAR")"
    else
        NODE_TAR="/tmp/node-v${NODE_VERSION}-${OS}-${ARCH}.tar.xz"
        echo "[安装] 正在下载 Node.js v${NODE_VERSION}..."
        curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-${OS}-${ARCH}.tar.xz" -o "$NODE_TAR"
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

# ============================================================
# 检查 app
# ============================================================
if [ ! -f "$OC_ENTRY" ]; then
    echo "[错误] 找不到 OpenClaw 入口文件"
    echo "       请确认 app/ 目录已正确构建"
    exit 1
fi

# 检查模板配置
if [ ! -f "$OC_ROOT/script/openclaw.json" ]; then
    echo "[错误] 找不到配置模板 script/openclaw.json"
    exit 1
fi

# ============================================================
# 首次安装官方 openclaw CLI
# ============================================================
if ! command -v openclaw &>/dev/null; then
    echo "[安装] 安装 openclaw CLI 命令..."
    NPM_CMD="$OC_ROOT/bin/npm"
    if [ -x "$NPM_CMD" ] || command -v npm &>/dev/null; then
        NPM="${NPM_CMD:-npm}"
        TGZ=$(ls "$OC_ROOT"/pkg/openclaw-*.tgz 2>/dev/null | head -1)
        if [ -n "$TGZ" ]; then
            "$NPM" install -g "$TGZ" 2>/dev/null && echo "[安装] openclaw CLI 安装成功" || echo "[警告] CLI 安装失败"
        else
            "$NPM" install -g openclaw@2026.3.13 2>/dev/null && echo "[安装] openclaw CLI 安装成功" || echo "[警告] CLI 安装失败"
        fi
    else
        echo "[警告] 未找到 npm，跳过 CLI 安装"
    fi
fi

# ============================================================
# 步骤 1: 配置初始化 + 注册
# ============================================================
echo ""
node --no-warnings "$OC_ROOT/script/launcher.js"

# ============================================================
# 步骤 2: 启动代理 (后台)
# ============================================================
echo ""
echo "[启动] 启动安全代理..."
node --no-warnings "$OC_ROOT/script/proxy.js" &
PROXY_PID=$!

# Gateway 停止时清理代理进程
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

if command -v openclaw &>/dev/null; then
    openclaw gateway --port 18789
else
    node --no-warnings --max-old-space-size=8192 "$OC_ENTRY" gateway --port 18789
fi
