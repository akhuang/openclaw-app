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
set "OC_NODE=!OC_ROOT!\bin\node.exe"
set "NODE_VERSION=22.16.0"

:: ============================================================
:: 检查 / 安装 Node.js
:: ============================================================
if not exist "!OC_NODE!" (
    echo [安装] 未检测到 bin\node.exe

    if exist "pkg\node-v*.zip" (
        echo [安装] 发现离线 Node.js 包，正在解压...
        for %%f in (pkg\node-v*.zip) do (
            powershell -NoProfile -Command "Expand-Archive -Path '%%f' -DestinationPath '%TEMP%\oc_node_tmp' -Force"
        )
    ) else (
        echo [安装] 正在下载 Node.js v%NODE_VERSION%...
        set "NODE_URL=https://nodejs.org/dist/v%NODE_VERSION%/node-v%NODE_VERSION%-win-x64.zip"
        powershell -NoProfile -Command ^
            "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12;" ^
            "Invoke-WebRequest -Uri '!NODE_URL!' -OutFile '%TEMP%\node.zip' -UseBasicParsing"
        if errorlevel 1 (
            echo [错误] Node.js 下载失败
            echo        请手动下载 Node.js v%NODE_VERSION% 并解压到 bin\ 目录
            pause
            exit /b 1
        )
        powershell -NoProfile -Command "Expand-Archive -Path '%TEMP%\node.zip' -DestinationPath '%TEMP%\oc_node_tmp' -Force"
        del "%TEMP%\node.zip" >nul 2>&1
    )

    if not exist "bin" mkdir "bin"
    for /d %%d in ("%TEMP%\oc_node_tmp\node-v*") do (
        xcopy /E /Y /Q "%%d\*" "bin\" >nul
    )
    rd /s /q "%TEMP%\oc_node_tmp" >nul 2>&1

    if not exist "!OC_NODE!" (
        echo [错误] Node.js 安装失败
        pause
        exit /b 1
    )
    for /f "tokens=*" %%v in ('"!OC_NODE!" --version') do echo [安装] Node.js %%v 安装完成
)

:: ============================================================
:: 首次安装官方 openclaw CLI
:: ============================================================
where openclaw >nul 2>&1
if errorlevel 1 (
    echo [安装] 安装 openclaw CLI 命令...
    set "NPM_CMD=!OC_ROOT!\bin\npm.cmd"
    if exist "!NPM_CMD!" (
        if exist "pkg\openclaw-*.tgz" (
            for %%f in (pkg\openclaw-*.tgz) do "!NPM_CMD!" install -g "%%f"
        ) else (
            "!NPM_CMD!" install -g openclaw@2026.3.13
        )
        where openclaw >nul 2>&1
        if not errorlevel 1 (
            echo [安装] openclaw CLI 安装成功
        ) else (
            echo [错误] openclaw CLI 安装失败
            pause
            exit /b 1
        )
    ) else (
        echo [错误] 未找到 npm，无法安装 openclaw
        echo        请确认 bin\ 目录包含完整的 Node.js (含 npm)
        pause
        exit /b 1
    )
)

:: 检查模板配置
if not exist "script\openclaw.json" (
    echo [错误] 找不到配置模板 script\openclaw.json
    pause
    exit /b 1
)

:: ============================================================
:: 步骤 1: 配置初始化 + 注册
:: ============================================================
echo.
"!OC_NODE!" --no-warnings script\launcher.js
if errorlevel 1 (
    echo [异常] 初始化失败
    pause
    exit /b 1
)

:: ============================================================
:: 步骤 2: 启动代理 (后台)
:: ============================================================
echo.
echo [启动] 启动安全代理...
start /b "" "!OC_NODE!" --no-warnings script\proxy.js

:: ============================================================
:: 步骤 3: 启动 Gateway (前台，用官方命令)
:: ============================================================
echo [启动] 启动 OpenClaw Gateway...
echo.

openclaw gateway --port 18789

echo.
echo [INFO] OpenClaw 已停止
pause
