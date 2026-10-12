@echo off
setlocal
echo ============================================================
echo   Starting Omniverse Kit Mechanical Streaming Server
echo   Model: D:\Mechnical_Ai_Chatbot\Model\Assembly.usd
echo   Mode: Headless (--no-window)
echo   Signaling: 127.0.0.1
echo ============================================================

cd /d "%~dp0kit-app-template"
call ".\_build\windows-x86_64\release\my_company.my_usd_viewer_streaming.kit.bat" --no-window --/app/auto_load_usd="D:/Mechnical_Ai_Chatbot/Model/Assembly.usd" %*
endlocal
