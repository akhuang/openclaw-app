@echo off
chcp 65001 >nul 2>&1
setlocal
set "OC_ROOT=%~dp0"
set "OC_ROOT=%OC_ROOT:~0,-1%"
"%OC_ROOT%\bin\node.exe" --no-warnings "%OC_ROOT%\app\node_modules\openclaw\openclaw.mjs" %*
