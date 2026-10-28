@echo off
rem Force MES Bridge on this PC to close all scanner connections (Modbus / TCP)
rem so another PC can connect to the Keyence. The Bridge keeps running.
rem Usage: disconnect-scanner.bat              -> close all
rem        disconnect-scanner.bat 192.168.1.49 502  -> close only this scanner
if "%~1"=="" (
  curl -s -X POST http://127.0.0.1:18080/disconnect -H "Content-Type: application/json" -d "{}"
) else (
  curl -s -X POST http://127.0.0.1:18080/disconnect -H "Content-Type: application/json" -d "{\"host\":\"%~1\",\"port\":%~2}"
)
echo.
if errorlevel 1 echo [ERROR] MES Bridge is not running on this PC.
pause
