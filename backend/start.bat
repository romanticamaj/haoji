@echo off
REM 好記 Haoji backend launcher (Windows GPU box).
REM The Expo app (Mac dev / TestFlight) connects here over Tailscale (100.106.118.45:8780).
cd /d "%~dp0"

echo === prerequisites ===
curl -s -o nul -w "  Ollama (11434):    HTTP %%{http_code}\n" http://127.0.0.1:11434/api/tags
curl -s -o nul -w "  Breeze ASR (8765): HTTP %%{http_code}\n" http://127.0.0.1:8765/health
echo   ^(if ASR shows 000, start it via C:\ai-servers\start_manager.bat then the "Breeze ASR" service^)
echo.
echo === starting haoji backend on :8780 ===
set PYTHONIOENCODING=utf-8
python app.py
