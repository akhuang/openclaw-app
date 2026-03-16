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
set "OC_ENTRY=!OC_ROOT!\app\node_modules\openclaw\openclaw.mjs"

:: 检查 Node
if not exist "!OC_NODE!" (
    echo [错误] 找不到 bin\node.exe
    echo        请将 Node.js 22.x 的 node.exe 放入 bin\ 目录
    pause
    exit /b 1
)

:: 检查 app
if not exist "!OC_ENTRY!" (
    echo [错误] 找不到 OpenClaw 入口文件
    echo        请确认 app\ 目录已正确构建
    pause
    exit /b 1
)

:: 检查模板配置
if not exist "script\openclaw.json" (
    echo [错误] 找不到配置模板 script\openclaw.json
    pause
    exit /b 1
)

:: ============================================================
:: 注册 openclaw 全局命令
:: ============================================================
call :register_global_cmd

:: ============================================================
:: 步骤 1: 配置 + 注册 (launcher.js 只做初始化，完成后退出)
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
start /b "proxy" "!OC_NODE!" --no-warnings script\proxy.js

:: ============================================================
:: 步骤 3: 直接启动 Gateway (前台，不包在子进程里)
:: ============================================================
echo [启动] 启动 OpenClaw Gateway...
echo.

"!OC_NODE!" --no-warnings --max-old-space-size=8192 "!OC_ENTRY!" gateway --port 18789

echo.
echo [INFO] OpenClaw 已停止
pause
goto :eof

:: ============================================================
:: 子程序: 注册全局命令
:: ============================================================
:register_global_cmd

set "SIGNATURE=:: generated-by-openclaw-app"
set "TARGET_CMD=!OC_ROOT!\openclaw.cmd"

set "NEED_WRITE=1"

if exist "!TARGET_CMD!" (
    set "FOUND_SIG="
    set "NEXT_LINE="
    for /f "usebackq tokens=*" %%l in ("!TARGET_CMD!") do (
        if defined FOUND_SIG if not defined NEXT_LINE set "NEXT_LINE=%%l"
        if "%%l"=="!SIGNATURE!" set "FOUND_SIG=1"
    )
    if defined FOUND_SIG (
        if "!NEXT_LINE!"==""!OC_NODE!" --no-warnings "!OC_ENTRY!" %%*" (
            set "NEED_WRITE="
        )
    )
)

if defined NEED_WRITE (
    (
        echo @echo off
        echo !SIGNATURE!
        echo "!OC_NODE!" --no-warnings "!OC_ENTRY!" %%*
    ) > "!TARGET_CMD!"
    echo [配置] 已生成: !TARGET_CMD!
)

:: 确保 OC_ROOT 在用户 PATH 中
powershell -NoProfile -Command ^
    "$p = [Environment]::GetEnvironmentVariable('PATH','User');" ^
    "if ($p -split ';' | Where-Object { $_.TrimEnd('\') -ieq '%OC_ROOT%'.TrimEnd('\') }) { exit 0 } else { exit 1 }"

if errorlevel 1 (
    echo [配置] 将 !OC_ROOT! 加入用户 PATH...
    powershell -NoProfile -Command ^
        "$p = [Environment]::GetEnvironmentVariable('PATH','User');" ^
        "if ($p -and -not $p.EndsWith(';')) { $p += ';' };" ^
        "$p += '%OC_ROOT%';" ^
        "[Environment]::SetEnvironmentVariable('PATH', $p, 'User')"
    if not errorlevel 1 (
        echo [配置] 已加入用户 PATH，新开命令行窗口后可使用: openclaw 命令
    ) else (
        echo [警告] PATH 写入失败，请手动将 !OC_ROOT! 加入系统 PATH
    )
)

goto :eof
