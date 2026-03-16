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
:: 每次启动都校验内容，路径或参数变化时自动修复
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

:: 期望的 cmd 内容 (第二行)
set "EXPECTED_CONTENT="!OC_NODE!" --no-warnings "!OC_ENTRY!" %%*"

:: 检查现有的 openclaw 命令
set "EXISTING_CMD="
for /f "tokens=*" %%f in ('where openclaw 2^>nul') do (
    if not defined EXISTING_CMD set "EXISTING_CMD=%%f"
)

if defined EXISTING_CMD (
    :: 找到了，逐行比对内容是否完全匹配
    set "CONTENT_MATCH="
    for /f "tokens=*" %%l in ('type "!EXISTING_CMD!" 2^>nul') do (
        if "%%l"=="!EXPECTED_CONTENT!" set "CONTENT_MATCH=1"
    )
    if defined CONTENT_MATCH (
        :: 内容完全匹配，跳过
        goto :eof
    )
    :: 内容不匹配，原地重写这个文件
    echo [配置] 检测到 openclaw 命令内容已过期，正在更新...
    set "TARGET_CMD=!EXISTING_CMD!"
    goto :write_cmd
)

:: 不存在，新注册
echo [配置] 注册 openclaw 全局命令...

:: 找一个确实在 PATH 中且可写的目录
set "TARGET_DIR="
for %%d in ("%PATH:;=" "%") do (
    if not defined TARGET_DIR (
        if exist "%%~d" (
            copy /y nul "%%~d\_oc_test.tmp" >nul 2>&1
            if not errorlevel 1 (
                del "%%~d\_oc_test.tmp" >nul 2>&1
                set "TARGET_DIR=%%~d"
            )
        )
    )
)

if not defined TARGET_DIR (
    echo [警告] 未找到可写的 PATH 目录，无法注册全局命令
    echo        请手动将 !OC_ROOT! 加入系统 PATH
    goto :eof
)

set "TARGET_CMD=!TARGET_DIR!\openclaw.cmd"

:write_cmd
(
    echo @echo off
    echo "!OC_NODE!" --no-warnings "!OC_ENTRY!" %%*
) > "!TARGET_CMD!"

if errorlevel 1 (
    echo [警告] 写入失败: !TARGET_CMD!
    echo        请手动将 !OC_ROOT! 加入系统 PATH
    goto :eof
)

:: 写入后验证 where 能找到且是我们写的那个
set "VERIFY_CMD="
for /f "tokens=*" %%f in ('where openclaw 2^>nul') do (
    if not defined VERIFY_CMD set "VERIFY_CMD=%%f"
)

if "!VERIFY_CMD!"=="!TARGET_CMD!" (
    echo [配置] 已写入: !TARGET_CMD!
    echo [配置] 新开命令行窗口后可使用: openclaw 命令
) else if defined VERIFY_CMD (
    echo [警告] 已写入 !TARGET_CMD!，但 where 优先找到: !VERIFY_CMD!
    echo        可能有其他 openclaw 命令优先级更高，请手动清理
) else (
    echo [配置] 已写入: !TARGET_CMD!
    echo [配置] 新开命令行窗口后可使用: openclaw 命令
)
goto :eof
