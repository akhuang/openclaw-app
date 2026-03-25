@echo off
chcp 65001 >nul 2>&1
setlocal
cd /d "%~dp0"

echo ============================================
echo   OpenClaw 官方包离线安装
echo ============================================
echo.

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

:: 检查 Node.js
node --version >nul 2>&1
if errorlevel 1 (
    echo [错误] 未找到 Node.js，请先安装 Node.js 22.x
    echo        下载: https://nodejs.org/
    pause
    exit /b 1
)

for /f "tokens=*" %%v in ('node --version') do echo [信息] Node.js 版本: %%v

:: 安装官方包
echo.
echo [安装] 正在安装 OpenClaw 官方包 v%REQUIRED_VER%...

if exist "pkg\openclaw-%REQUIRED_VER%.tgz" (
    npm install -g "pkg\openclaw-%REQUIRED_VER%.tgz"
) else (
    echo [信息] 本地包不存在，从 npm 在线安装...
    npm install -g openclaw@%REQUIRED_VER%
)

if errorlevel 1 (
    echo [错误] 安装失败
    pause
    exit /b 1
)

echo.
echo [验证] 检查安装结果...
openclaw --version

echo.
echo ============================================
echo   安装完成！可以使用 openclaw 命令了
echo ============================================
pause
