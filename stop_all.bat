@echo off
echo ============================================================
echo   Terminating Omniverse Kit and Web Client processes
echo ============================================================

taskkill /F /IM kit.exe /T 2>nul
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :5173') do (
    taskkill /F /PID %%a 2>nul
)

echo Shutdown complete.
