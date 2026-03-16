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
:: 每次启动都校验，路径变化时自动修复
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

:: 生成期望的 cmd 内容
set "EXPECTED_LINE="!OC_NODE!" --no-warnings "!OC_ENTRY!" %%*"

:: 检查现有的 openclaw 命令是否指向正确路径
where openclaw >nul 2>&1
if not errorlevel 1 (
    :: 找到了，检查内容是否是我们的且路径正确
    for /f "tokens=*" %%f in ('where openclaw 2^>nul') do (
        set "EXISTING_CMD=%%f"
        goto :check_content
    )
)
goto :do_register

:check_content
:: 读取现有 cmd 的第二行，看路径是否匹配当前 OC_ROOT
findstr /i /c:"!OC_ROOT!" "!EXISTING_CMD!" >nul 2>&1
if not errorlevel 1 (
    :: 路径正确，跳过注册
    goto :eof
)
:: 路径不对（目录移动过），需要重写
echo [配置] 检测到 openclaw 命令路径已过期，正在更新...
goto :write_cmd

:do_register
echo [配置] 注册 openclaw 全局命令...

:write_cmd
:: 找一个确实在 PATH 中且可写的目录
set "TARGET_DIR="

:: 遍历 PATH 中的每个目录，找第一个可写的
for %%d in ("%PATH:;=" "%") do (
    if not defined TARGET_DIR (
        if exist "%%~d" (
            :: 尝试写一个临时文件测试可写性
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

:: 写入 openclaw.cmd (单一来源，不依赖仓库里的 openclaw.cmd)
set "TARGET_CMD=!TARGET_DIR!\openclaw.cmd"
(
    echo @echo off
    echo "!OC_NODE!" --no-warnings "!OC_ENTRY!" %%*
) > "!TARGET_CMD!"

if not errorlevel 1 (
    echo [配置] 已写入: !TARGET_CMD!
    echo [配置] 新开命令行窗口后可使用: openclaw 命令
) else (
    echo [警告] 写入失败: !TARGET_CMD!
    echo        请手动将 !OC_ROOT! 加入系统 PATH
)
goto :eof
