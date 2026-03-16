@echo off
chcp 65001 >nul 2>&1
setlocal
cd /d "%~dp0"

echo ============================================
echo   OpenClaw 内网版 启动器
echo ============================================
echo.

:: 检查 openclaw 命令
where openclaw >nul 2>&1
if errorlevel 1 (
    echo [错误] 未找到 openclaw 命令
    echo        请先运行 install.bat 安装官方包
    pause
    exit /b 1
)

:: 检查模板配置
if not exist "script\openclaw.json" (
    echo [错误] 找不到配置模板 script\openclaw.json
    pause
    exit /b 1
)

:: 步骤 1: 配置初始化 + 注册 + 启动代理 (后台)
echo [启动] 初始化配置并启动代理...
start /b "launcher" node --no-warnings script\launcher.js

:: 等待配置写入完成
timeout /t 3 /nobreak >nul

:: 步骤 2: 直接用官方 openclaw 启动 Gateway (前台)
echo [启动] 启动 OpenClaw Gateway...
echo.

openclaw gateway --port 18789

echo.
echo [INFO] OpenClaw 已停止
pause
