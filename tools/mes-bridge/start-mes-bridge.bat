@echo off
rem MES Bridge: lets the /MES web page read the Keyence scanner connected to this PC.
rem Keep this window open while using the page.
rem Node.js: uses node.exe in this folder if present (no install needed), otherwise installed Node.js.
rem Auto start: put a shortcut of this file in shell:startup
title MES Bridge
cd /d "%~dp0"
set "NODE_EXE=node"
if exist "%~dp0node.exe" set "NODE_EXE=%~dp0node.exe"
if /i "%NODE_EXE%"=="node" (
  where node >nul 2>nul
  if errorlevel 1 (
    echo [ERROR] Node.js not found.
    echo         Copy node.exe into this folder: %~dp0
    echo         ^(from a PC with Node.js: C:\Program Files\nodejs\node.exe^)
    pause
    exit /b 1
  )
)
echo Using Node: %NODE_EXE%
:loop
"%NODE_EXE%" mes-bridge.cjs
echo [WARN] MES Bridge stopped. Restarting in 5 seconds...
timeout /t 5 /nobreak >nul
goto loop
