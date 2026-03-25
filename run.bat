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
set "NEED_INSTALL=1"
set "CURRENT_VER_RAW="
set "CURRENT_VER="

where openclaw >nul 2>&1
if not errorlevel 1 (
    for /f "tokens=*" %%v in ('openclaw --version 2^>nul') do if not defined CURRENT_VER_RAW set "CURRENT_VER_RAW=%%v"
    for /f "tokens=1,2 delims= " %%a in ('openclaw --version 2^>nul') do if not defined CURRENT_VER (
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
    echo [信息] 当前 openclaw 版本 !CURRENT_VER_RAW!，已满足 !REQUIRED_VER!
)

if "!NEED_INSTALL!"=="1" if defined CURRENT_VER_RAW (
    echo [安装] 当前 openclaw 版本 !CURRENT_VER_RAW!，需要 !REQUIRED_VER!
)

if "!NEED_INSTALL!"=="1" (
    echo [安装] 安装 openclaw@!REQUIRED_VER!...
    where npm >nul 2>&1
    if errorlevel 1 (
        echo [错误] 找不到 npm，无法安装 openclaw CLI
        pause
        exit /b 1
    )
    for /f "tokens=*" %%p in ('where npm 2^>nul') do echo [安装] npm 路径: %%p
    for /f "tokens=*" %%v in ('npm --version 2^>nul') do echo [安装] npm 版本: %%v
    for /f "tokens=*" %%v in ('npm config get registry 2^>nul') do echo [安装] npm registry: %%v
    for /f "tokens=*" %%v in ('npm config get prefix 2^>nul') do echo [安装] npm prefix: %%v
    for /f "tokens=*" %%v in ('npm root -g 2^>nul') do echo [安装] npm 全局目录: %%v
    if exist "!LOCAL_TGZ!" (
        echo [安装] 检测到匹配版本的离线包，使用 !LOCAL_TGZ! 安装
        echo [安装] 执行: npm install -g --verbose "!LOCAL_TGZ!"
        call npm install -g --verbose "!LOCAL_TGZ!"
        if errorlevel 1 (
            echo [错误] 离线包安装失败: !LOCAL_TGZ!
            pause
            exit /b 1
        )
    ) else (
        if exist "pkg\openclaw-*.tgz" (
            echo [警告] 检测到离线包，但没有匹配版本 !REQUIRED_VER! 的 tgz，改用 npm registry
        )
        echo [安装] 未找到匹配版本的离线包，使用 npm registry 安装 openclaw@!REQUIRED_VER!
        echo [安装] 执行: npm install -g --verbose openclaw@!REQUIRED_VER!
        call npm install -g --verbose openclaw@!REQUIRED_VER!
        if errorlevel 1 (
            echo [错误] npm registry 安装失败: openclaw@!REQUIRED_VER!
            pause
            exit /b 1
        )
    )
    where openclaw >nul 2>&1
    if errorlevel 1 (
        echo [错误] openclaw CLI 安装失败
        pause
        exit /b 1
    )
    for /f "tokens=*" %%p in ('where openclaw 2^>nul') do echo [安装] openclaw 路径: %%p
    for /f "tokens=*" %%v in ('openclaw --version 2^>nul') do echo [安装] openclaw 版本: %%v
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
call openclaw gateway stop >nul 2>&1

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

call openclaw gateway run --port 18789

echo.
echo [INFO] OpenClaw 已停止
pause
