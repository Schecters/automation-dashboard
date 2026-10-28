@echo off
rem MES Bridge: lets the /MES web page read the Keyence scanner connected to this PC.
rem Requires Node.js. Keep this window open while using the page.
rem Auto start: put a shortcut of this file in shell:startup
title MES Bridge
cd /d "%~dp0"
where node >/dev/null 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js is not installed on this PC. Please install Node.js first.
  pause
  exit /b 1
)
:loop
node mes-bridge.cjs
echo [WARN] MES Bridge stopped. Restarting in 5 seconds...
timeout /t 5 /nobreak >nul
goto loop
