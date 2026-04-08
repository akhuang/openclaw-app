@echo off
chcp 65001 >nul 2>&1
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo ============================================
echo   OpenClaw 官方包离线安装
echo ============================================
echo.

set "OC_ROOT=%~dp0"
set "OC_ROOT=!OC_ROOT:~0,-1!"
set "OC_BIN_DIR=!OC_ROOT!\bin"
set "OC_NODE=!OC_BIN_DIR!\node.exe"
set "OC_NPM=!OC_BIN_DIR!\npm.cmd"
set "OC_DATA_DIR=!OC_ROOT!\data"
set "OC_STATE_DIR=!OC_DATA_DIR!\.openclaw"
set "OC_CONFIG_PATH=!OC_STATE_DIR!\openclaw.json"
set "OC_WORKSPACE_DIR=!OC_DATA_DIR!\workspace"
set "OC_RUNTIME_DIR=!OC_ROOT!\runtime"
set "OC_NPM_PREFIX=!OC_RUNTIME_DIR!\npm-global"
set "OC_NPM_CACHE=!OC_RUNTIME_DIR!\npm-cache"
set "OPENCLAW_CMD=!OC_NPM_PREFIX!\openclaw.cmd"
set "OPENCLAW_ENTRY=!OC_NPM_PREFIX!\node_modules\openclaw\openclaw.mjs"

if not exist "openclaw.version" (
    echo [错误] 找不到版本文件 openclaw.version
    pause
    exit /b 1
)

set /p REQUIRED_VER=<openclaw.version
if not defined REQUIRED_VER (
    echo [错误] openclaw.version 为空
    pause
    exit /b 1
)

if not exist "!OC_NODE!" (
    echo [错误] 找不到预置 Node.js: !OC_NODE!
    echo [错误] 当前分发包应直接包含 bin\node.exe 和 bin\npm.cmd
    pause
    exit /b 1
)

if not exist "!OC_NPM!" (
    echo [错误] 未生成 npm.cmd: !OC_NPM!
    pause
    exit /b 1
)

set "PATH=!OC_BIN_DIR!;!OC_NPM_PREFIX!;!PATH!"
set "OPENCLAW_STATE_DIR=!OC_STATE_DIR!"
set "OPENCLAW_CONFIG_PATH=!OC_CONFIG_PATH!"
set "OPENCLAW_WORKSPACE_DIR=!OC_WORKSPACE_DIR!"

for /f "usebackq delims=" %%i in (`"!OC_NODE!" --no-warnings script\print-dotenv.js --format=cmd`) do %%i
if exist ".env" echo [信息] 已加载 .env 配置
if exist ".env.local" echo [信息] 已加载 .env.local 配置

for /f "tokens=*" %%v in ('"!OC_NODE!" --version') do echo [信息] Node.js 版本: %%v
for /f "tokens=*" %%v in ('"!OC_NPM!" --version') do echo [信息] npm 版本: %%v
echo [信息] OpenClaw 状态目录: !OPENCLAW_STATE_DIR!
echo [信息] OpenClaw 配置文件: !OPENCLAW_CONFIG_PATH!
echo [信息] OpenClaw 工作区: !OPENCLAW_WORKSPACE_DIR!

echo.
echo [安装] 正在安装 OpenClaw 官方包 v!REQUIRED_VER!...

if not exist "pkg\openclaw-!REQUIRED_VER!.tgz" (
    echo [错误] 本地包不存在: pkg\openclaw-!REQUIRED_VER!.tgz
    pause
    exit /b 1
)

if not exist "!OC_RUNTIME_DIR!" mkdir "!OC_RUNTIME_DIR!"
if not exist "!OC_NPM_PREFIX!" mkdir "!OC_NPM_PREFIX!"
if not exist "!OC_NPM_CACHE!" mkdir "!OC_NPM_CACHE!"

call "!OC_NPM!" install -g --prefix "!OC_NPM_PREFIX!" --cache "!OC_NPM_CACHE!" --verbose "pkg\openclaw-!REQUIRED_VER!.tgz"
if errorlevel 1 (
    echo [错误] 安装失败
    pause
    exit /b 1
)

if not exist "!OPENCLAW_CMD!" (
    echo [错误] 未生成 openclaw 命令入口: !OPENCLAW_CMD!
    pause
    exit /b 1
)

if not exist "!OPENCLAW_ENTRY!" (
    echo [错误] 未找到 openclaw 入口文件: !OPENCLAW_ENTRY!
    pause
    exit /b 1
)

echo.
echo [验证] 检查安装结果...
call "!OPENCLAW_CMD!" --version
if errorlevel 1 (
    echo [错误] openclaw 版本校验失败
    pause
    exit /b 1
)

echo.
"!OC_NODE!" --no-warnings script\patch-openclaw-runtime.js
if errorlevel 1 (
    echo [错误] Control UI 补丁应用失败
    pause
    exit /b 1
)

echo.
echo ============================================
echo   安装完成！启动请使用 run.bat
echo ============================================
pause
