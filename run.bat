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

:: 检查 Node
if not exist "bin\node.exe" (
    echo [错误] 找不到 bin\node.exe
    echo        请将 Node.js 22.x 的 node.exe 放入 bin\ 目录
    pause
    exit /b 1
)

:: 检查 app
if not exist "app\node_modules\openclaw\openclaw.mjs" (
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

:: 注册 openclaw 全局命令 (仅首次)
where openclaw >nul 2>&1
if errorlevel 1 (
    echo [配置] 注册 openclaw 全局命令...

    :: 生成带绝对路径的 openclaw.cmd
    set "TARGET_CMD="

    :: 优先复制到 npm 全局目录
    for /f "tokens=*" %%p in ('npm prefix -g 2^>nul') do set "NPM_DIR=%%p"
    if defined NPM_DIR if exist "!NPM_DIR!" (
        set "TARGET_CMD=!NPM_DIR!\openclaw.cmd"
    )

    :: 备选: WindowsApps
    if not defined TARGET_CMD (
        set "TARGET_CMD=%USERPROFILE%\AppData\Local\Microsoft\WindowsApps\openclaw.cmd"
    )

    :: 写入 cmd 文件 (绝对路径)
    (
        echo @echo off
        echo "!OC_ROOT!\bin\node.exe" --no-warnings "!OC_ROOT!\app\node_modules\openclaw\openclaw.mjs" %%*
    ) > "!TARGET_CMD!"

    if not errorlevel 1 (
        echo [配置] 已写入: !TARGET_CMD!
        echo [配置] 新开命令行窗口后可直接使用: openclaw 命令
    ) else (
        echo [警告] 全局注册失败，请手动将 !OC_ROOT! 加入系统 PATH
    )
)

echo.
echo [启动] 正在初始化 OpenClaw 服务...
echo.

bin\node.exe --no-warnings --max-old-space-size=8192 script\launcher.js

if errorlevel 1 (
    echo.
    echo [异常] 服务已退出，错误码: %errorlevel%
    pause
) else (
    pause
)
