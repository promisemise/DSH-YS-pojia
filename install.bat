@echo off
setlocal
title YS-pojia 一键安装

echo.
echo ==========================================
echo   YS-pojia 破甲插件 - 一键安装
echo ==========================================
echo.
echo 正在调用安装脚本...
echo.

"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" %*
set "DSH_INSTALL_RESULT=%ERRORLEVEL%"

echo.
if not "%DSH_INSTALL_RESULT%"=="0" (
    echo ==========================================
    echo   安装失败
    echo ==========================================
    echo.
    echo   具体原因见上方输出。常见情况：
    echo.
    echo   - 没找到 DSH 目录：先启动一次 DSH 再装
    echo   - 文件被占用：先完全退出 DSH 再装
    echo   - 没装 Node.js：https://nodejs.org/
    echo.
)

if not "%DSH_INSTALL_NO_PAUSE%"=="1" pause
exit /b %DSH_INSTALL_RESULT%
