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

:: 检查现有命令
set "EXISTING_CMD="
for /f "tokens=*" %%f in ('where openclaw 2^>nul') do (
    if not defined EXISTING_CMD set "EXISTING_CMD=%%f"
)

:: 记录需要排除的目录
set "EXCLUDE_DIR="

if defined EXISTING_CMD (
    findstr /x /c:"!SIGNATURE!" "!EXISTING_CMD!" >nul 2>&1
    if errorlevel 1 (
        for %%f in ("!EXISTING_CMD!") do set "EXCLUDE_DIR=%%~dpf"
        set "EXCLUDE_DIR=!EXCLUDE_DIR:~0,-1!"
        echo [配置] 发现已有 openclaw 命令: !EXISTING_CMD! (非本工具生成，不覆盖)
        goto :find_dir_and_write
    )
    :: 是我们的，检查签名后一行是否匹配
    set "FOUND_SIG="
    set "NEXT_LINE="
    for /f "usebackq tokens=*" %%l in ("!EXISTING_CMD!") do (
        if defined FOUND_SIG if not defined NEXT_LINE set "NEXT_LINE=%%l"
        if "%%l"=="!SIGNATURE!" set "FOUND_SIG=1"
    )
    if "!NEXT_LINE!"==""!OC_NODE!" --no-warnings "!OC_ENTRY!" %%*" (
        goto :eof
    )
    echo [配置] 检测到 openclaw 命令内容已过期，正在更新...
    set "TARGET_CMD=!EXISTING_CMD!"
    goto :write_cmd
)

:: 不存在，新注册
echo [配置] 注册 openclaw 全局命令...

:find_dir_and_write
:: 用 PowerShell 安全解析 PATH 并找到第一个可写目录
set "TARGET_DIR="
set "_PATHFILE=%TEMP%\_oc_pathlist.tmp"

powershell -NoProfile -Command "$env:PATH -split ';' | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne '' -and (Test-Path $_ -PathType Container) } | ForEach-Object { $_ }" > "!_PATHFILE!" 2>nul

for /f "usebackq tokens=* delims=" %%d in ("!_PATHFILE!") do (
    if not defined TARGET_DIR (
        set "CANDIDATE=%%d"
        set "SKIP="
        if defined EXCLUDE_DIR if /i "!CANDIDATE!"=="!EXCLUDE_DIR!" set "SKIP=1"
        if not defined SKIP (
            copy /y nul "!CANDIDATE!\_oc_test.tmp" >nul 2>&1
            if not errorlevel 1 (
                del "!CANDIDATE!\_oc_test.tmp" >nul 2>&1
                set "TARGET_DIR=!CANDIDATE!"
            )
        )
    )
)
del "!_PATHFILE!" >nul 2>&1

if not defined TARGET_DIR (
    echo [警告] 未找到可写的 PATH 目录，无法注册全局命令
    echo        请手动将 !OC_ROOT! 加入系统 PATH
    goto :eof
)

set "TARGET_CMD=!TARGET_DIR!\openclaw.cmd"

:write_cmd
(
    echo @echo off
    echo !SIGNATURE!
    echo "!OC_NODE!" --no-warnings "!OC_ENTRY!" %%*
) > "!TARGET_CMD!"

if errorlevel 1 (
    echo [警告] 写入失败: !TARGET_CMD!
    echo        请手动将 !OC_ROOT! 加入系统 PATH
    goto :eof
)

:: 写入后验证
set "VERIFY_CMD="
for /f "tokens=*" %%f in ('where openclaw 2^>nul') do (
    if not defined VERIFY_CMD set "VERIFY_CMD=%%f"
)

if "!VERIFY_CMD!"=="!TARGET_CMD!" (
    echo [配置] 已写入: !TARGET_CMD!
    echo [配置] 新开命令行窗口后可使用: openclaw 命令
) else if defined VERIFY_CMD (
    echo [警告] 已写入 !TARGET_CMD!
    echo        但 where 优先找到: !VERIFY_CMD!
    echo        该命令非本工具生成，openclaw 可能指向其他程序
) else (
    echo [配置] 已写入: !TARGET_CMD!
    echo [配置] 新开命令行窗口后可使用: openclaw 命令
)
goto :eof
