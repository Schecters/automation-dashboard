@echo off
chcp 65001 >nul
rem ==========================================
rem  MES Bridge: ให้หน้าเว็บ /MES อ่านเครื่องสแกน Keyence ที่ต่อกับ PC เครื่องนี้
rem  ต้องมี Node.js ในเครื่อง / เปิดหน้าต่างนี้ค้างไว้ระหว่างใช้งาน
rem  เปิดอัตโนมัติตอนเปิดเครื่อง: วาง shortcut ของไฟล์นี้ใน shell:startup
rem ==========================================
title MES Bridge
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo ไม่พบ Node.js ในเครื่องนี้ กรุณาติดตั้ง Node.js ก่อน
  pause
  exit /b 1
)
:loop
node mes-bridge.cjs
echo MES Bridge หยุดทำงาน จะเปิดใหม่ใน 5 วินาที...
timeout /t 5 /nobreak >nul
goto loop
