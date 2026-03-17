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
set "NODE_MAJOR_MIN=22"
set "REQUIRED_VER=2026.3.13"

:: ============================================================
:: 检查 Node.js
:: ============================================================
set "USE_SYSTEM_NODE="

if not exist "!OC_NODE!" (
    where node >nul 2>&1
    if not errorlevel 1 (
        for /f "tokens=1 delims=v." %%m in ('node --version 2^>nul') do set "SYS_NODE_MAJOR=%%m"
        if !SYS_NODE_MAJOR! geq %NODE_MAJOR_MIN% (
            echo [信息] 使用系统 Node.js
            for /f "tokens=*" %%v in ('node --version') do echo [信息] 版本: %%v
            set "USE_SYSTEM_NODE=1"
            set "OC_NODE=node"
        ) else (
            echo [信息] 系统 Node 版本过低，需要 v%NODE_MAJOR_MIN%+，将安装内置版本
        )
    )
)

if not defined USE_SYSTEM_NODE if not exist "!OC_ROOT!\bin\node.exe" (
    echo [安装] 安装 Node.js v%NODE_VERSION%...

    if exist "pkg\node-v*.zip" (
        echo [安装] 发现离线包，正在解压...
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

if not defined USE_SYSTEM_NODE (
    set "PATH=!OC_ROOT!\bin;!PATH!"
)

:: ============================================================
:: 安装/更新官方 openclaw CLI
:: ============================================================
set "NEED_INSTALL=0"

where openclaw >nul 2>&1
if errorlevel 1 (
    set "NEED_INSTALL=1"
) else (
    for /f "tokens=*" %%v in ('openclaw --version 2^>nul') do set "CURRENT_VER=%%v"
    if "!CURRENT_VER!" neq "!REQUIRED_VER!" (
        echo [安装] 当前 openclaw 版本 !CURRENT_VER!，需要 !REQUIRED_VER!
        set "NEED_INSTALL=1"
    )
)

if "!NEED_INSTALL!"=="1" (
    echo [安装] 安装 openclaw@!REQUIRED_VER!...
    if exist "pkg\openclaw-*.tgz" (
        for %%f in (pkg\openclaw-*.tgz) do npm install -g "%%f"
    ) else (
        npm install -g openclaw@!REQUIRED_VER!
    )
    where openclaw >nul 2>&1
    if errorlevel 1 (
        echo [错误] openclaw CLI 安装失败
        pause
        exit /b 1
    )
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
:: 步骤 2: 注册 Gateway 服务并启动
:: ============================================================
echo.
echo [启动] 注册并启动 OpenClaw Gateway...

openclaw gateway stop >nul 2>&1
openclaw gateway install --force
if errorlevel 1 (
    echo [警告] 服务注册失败，尝试前台启动...
    goto :foreground
)

:: 等待 Gateway 就绪
echo [启动] 等待 Gateway 就绪...
set "RETRY=0"
:wait_loop
if !RETRY! geq 15 (
    echo [警告] Gateway 启动超时
    goto :foreground
)
set /a RETRY+=1
powershell -NoProfile -Command "Start-Sleep -Milliseconds 2000"
openclaw gateway probe >nul 2>&1
if errorlevel 1 goto :wait_loop

echo [启动] Gateway 已就绪

:: ============================================================
:: 步骤 3: 打开浏览器 + 启动代理 (前台保持窗口)
:: ============================================================
set "GW_URL=http://127.0.0.1:18789"
echo.
echo ============================================
echo   OpenClaw 已就绪!
echo   访问地址: !GW_URL!
echo   代理端口: 18889
echo   按 Ctrl+C 或关闭窗口停止代理
echo ============================================

start "" "!GW_URL!"

echo.
echo [运行中] 安全代理已启动...
"!OC_NODE!" --no-warnings script\proxy.js
goto :eof

:: ============================================================
:: 回退: 前台直接运行 Gateway
:: ============================================================
:foreground
echo.
start /b "" "!OC_NODE!" --no-warnings script\proxy.js
start "" "http://127.0.0.1:18789"
openclaw gateway run --port 18789
echo.
echo [INFO] OpenClaw 已停止
pause
