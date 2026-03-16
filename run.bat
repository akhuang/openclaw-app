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
:: 注册/更新 openclaw 全局命令
:: 策略: openclaw.cmd 就放在本目录，把本目录加到用户 PATH
:: ============================================================
call :register_global_cmd

echo.
echo [启动] 正在初始化 OpenClaw 服务...
echo.

"!OC_NODE!" --no-warnings --max-old-space-size=8192 script\launcher.js

if errorlevel 1 (
    echo.
    echo [异常] 服务已退出，错误码: %errorlevel%
    pause
) else (
    pause
)
goto :eof

:: ============================================================
:: 子程序: 注册全局命令
:: ============================================================
:register_global_cmd

set "SIGNATURE=:: generated-by-openclaw-app"
set "TARGET_CMD=!OC_ROOT!\openclaw.cmd"

:: 1. 写入/更新 openclaw.cmd
set "NEED_WRITE=1"

if exist "!TARGET_CMD!" (
    :: 检查是否我们的且内容匹配
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

:: 2. 确保 OC_ROOT 在用户 PATH 中 (只加一次)
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
) else (
    :: 已在 PATH 中，检查当前会话是否能找到
    where openclaw >nul 2>&1
    if errorlevel 1 (
        echo [提示] openclaw 已注册，请新开命令行窗口使用
    )
)

goto :eof
