@echo off
setlocal
echo ============================================================
echo   Starting Mechanical AI Copilot Web Client
echo   URL: http://localhost:5173
echo ============================================================

cd /d "%~dp0Web_Front"
call npm run dev
endlocal
