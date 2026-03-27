@echo off
chcp 65001 >nul 2>&1
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo ============================================
echo   OpenClaw 内网版 启动器
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
set "LOCAL_TGZ=pkg\openclaw-!REQUIRED_VER!.tgz"

:: ============================================================
:: 检查预置 Node.js
:: ============================================================
if not exist "!OC_NODE!" (
    echo [错误] 找不到预置 Node.js: !OC_NODE!
    echo [错误] 当前分发包应直接包含 bin\node.exe 和 bin\npm.cmd
    pause
    exit /b 1
)

if not exist "!OC_NPM!" (
    echo [错误] 找不到 npm.cmd: !OC_NPM!
    pause
    exit /b 1
)

set "PATH=!OC_BIN_DIR!;!OC_NPM_PREFIX!;!PATH!"
set "OPENCLAW_STATE_DIR=!OC_STATE_DIR!"
set "OPENCLAW_CONFIG_PATH=!OC_CONFIG_PATH!"
set "OPENCLAW_WORKSPACE_DIR=!OC_WORKSPACE_DIR!"

for /f "tokens=*" %%v in ('"!OC_NODE!" --version 2^>nul') do echo [信息] Node.js 版本: %%v
for /f "tokens=*" %%v in ('"!OC_NPM!" --version 2^>nul') do echo [信息] npm 版本: %%v
echo [信息] OpenClaw 状态目录: !OPENCLAW_STATE_DIR!
echo [信息] OpenClaw 配置文件: !OPENCLAW_CONFIG_PATH!
echo [信息] OpenClaw 工作区: !OPENCLAW_WORKSPACE_DIR!

:: ============================================================
:: 安装 / 更新本地 openclaw CLI
:: ============================================================
set "NEED_INSTALL=1"
set "CURRENT_VER_RAW="
set "CURRENT_VER="

if exist "!OPENCLAW_CMD!" if exist "!OPENCLAW_ENTRY!" (
    for /f "tokens=*" %%v in ('"!OPENCLAW_CMD!" --version 2^>nul') do if not defined CURRENT_VER_RAW set "CURRENT_VER_RAW=%%v"
    for /f "tokens=1,2 delims= " %%a in ('"!OPENCLAW_CMD!" --version 2^>nul') do if not defined CURRENT_VER (
        if /i "%%a"=="OpenClaw" (
            set "CURRENT_VER=%%b"
        ) else (
            set "CURRENT_VER=%%a"
        )
    )
)

if defined CURRENT_VER if /i "!CURRENT_VER!"=="!REQUIRED_VER!" (
    set "NEED_INSTALL=0"
)

if "!NEED_INSTALL!"=="0" if defined CURRENT_VER_RAW (
    echo [信息] 当前本地 openclaw 版本 !CURRENT_VER_RAW!，已满足 !REQUIRED_VER!
)

if "!NEED_INSTALL!"=="1" if defined CURRENT_VER_RAW (
    echo [安装] 当前本地 openclaw 版本 !CURRENT_VER_RAW!，需要 !REQUIRED_VER!
)

if "!NEED_INSTALL!"=="1" (
    echo [安装] 安装 openclaw@!REQUIRED_VER!...
    if not exist "!LOCAL_TGZ!" (
        echo [错误] 未找到匹配版本的离线包: !LOCAL_TGZ!
        echo [错误] 请先将 openclaw-!REQUIRED_VER!.tgz 放入 pkg\
        pause
        exit /b 1
    )

    if not exist "!OC_RUNTIME_DIR!" mkdir "!OC_RUNTIME_DIR!"
    if not exist "!OC_NPM_PREFIX!" mkdir "!OC_NPM_PREFIX!"
    if not exist "!OC_NPM_CACHE!" mkdir "!OC_NPM_CACHE!"

    echo [安装] 安装前缀: !OC_NPM_PREFIX!
    echo [安装] 使用离线包: !LOCAL_TGZ!
    call "!OC_NPM!" install -g --prefix "!OC_NPM_PREFIX!" --cache "!OC_NPM_CACHE!" --verbose "!LOCAL_TGZ!"
    if errorlevel 1 (
        echo [错误] 离线包安装失败: !LOCAL_TGZ!
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

    for /f "tokens=*" %%v in ('"!OPENCLAW_CMD!" --version 2^>nul') do echo [安装] openclaw 版本: %%v
    echo [安装] openclaw CLI 安装成功
)

:: 检查模板配置
if not exist "script\openclaw.json" (
    echo [错误] 找不到配置模板 script\openclaw.json
    pause
    exit /b 1
)

:: ============================================================
:: 步骤 1: 配置初始化 + 小鲁班注册
:: ============================================================
echo.
"!OC_NODE!" --no-warnings script\launcher.js
if errorlevel 1 (
    echo [异常] 初始化失败
    pause
    exit /b 1
)

:: ============================================================
:: 步骤 2: 停掉可能残留的旧 Gateway
:: ============================================================
call "!OPENCLAW_CMD!" gateway stop >nul 2>&1

:: ============================================================
:: 步骤 3: 启动代理 (后台)
:: ============================================================
echo.
echo [启动] 启动安全代理...
start /b "" "!OC_NODE!" --no-warnings script\proxy.js

:: ============================================================
:: 步骤 4: 延迟打开浏览器 (后台等5秒再开)
:: ============================================================
start /b cmd /c "timeout /t 5 /nobreak >nul && start http://127.0.0.1:18789"

:: ============================================================
:: 步骤 5: 前台启动 Gateway (窗口保持不关)
:: ============================================================
echo [启动] 启动 OpenClaw Gateway...
echo.
echo ============================================
echo   访问地址: http://127.0.0.1:18789
echo   代理端口: 18889
echo   按 Ctrl+C 停止
echo ============================================
echo.

call "!OPENCLAW_CMD!" gateway run --port 18789

echo.
echo [INFO] OpenClaw 已停止
pause
