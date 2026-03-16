@echo off
chcp 65001 >nul 2>&1
setlocal
cd /d "%~dp0"
bin\node.exe --no-warnings app\node_modules\openclaw\openclaw.mjs %*
