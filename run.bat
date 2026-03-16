@echo off
chcp 65001 >nul 2>&1
setlocal
cd /d "%~dp0"

echo ============================================
echo   OpenClaw 内网版 启动器
echo ============================================
echo.

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
