@echo off
chcp 65001 >nul 2>&1

:: ============================================================
::  启动 Chrome 并开启远程调试端口
::  OpenClaw 通过 CDP 连接到此端口复用登录态
:: ============================================================

set "CDP_PORT=9222"
set "CHROME_PATH="

:: 查找 Chrome 路径
for %%p in (
    "%ProgramFiles%\Google\Chrome\Application\chrome.exe"
    "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
    "%LocalAppData%\Google\Chrome\Application\chrome.exe"
) do (
    if exist %%p (
        set "CHROME_PATH=%%~p"
        goto :found
    )
)

echo [ERROR] 未找到 Chrome，请手动指定路径
pause
exit /b 1

:found
echo [INFO] Chrome 路径: %CHROME_PATH%
echo [INFO] CDP 调试端口: %CDP_PORT%
echo.

:: 检查是否已有 Chrome 在运行
tasklist /FI "IMAGENAME eq chrome.exe" 2>nul | findstr /i "chrome.exe" >nul
if %errorlevel%==0 (
    echo [WARN] Chrome 已在运行。
    echo        要使用远程调试，需要关闭所有 Chrome 窗口后重新启动。
    echo.
    set /p "RESTART=是否关闭并重启 Chrome？(Y/N): "
    if /i not "%RESTART%"=="Y" (
        echo [INFO] 已取消。如果 Chrome 启动时已带 --remote-debugging-port 参数则无需重启。
        pause
        exit /b 0
    )
    echo [INFO] 正在关闭 Chrome...
    taskkill /IM chrome.exe /F >nul 2>&1
    timeout /t 2 /nobreak >nul
)

echo [INFO] 正在启动 Chrome (带远程调试)...
start "" "%CHROME_PATH%" --remote-debugging-port=%CDP_PORT% --remote-allow-origins=http://127.0.0.1:*

echo.
echo ============================================================
echo   Chrome 已启动，远程调试端口: %CDP_PORT%
echo   现在可以正常使用 Chrome 登录内网站点
echo   OpenClaw 会通过此端口复用你的登录态
echo ============================================================
pause
