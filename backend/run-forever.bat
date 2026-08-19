@echo off
REM 好記 Haoji backend — AUTO-RESTARTING launcher for the Windows GPU box.
REM Unlike start.bat (runs python app.py ONCE and stays down if it exits), this relaunches the
REM backend whenever it exits/crashes, and appends every run + crash to logs\backend.log so a stop
REM no longer means the service is dead until someone notices — and the next crash is captured for
REM diagnosis. Leave this window open (or run it as a service via NSSM — see docs/backend-followups).
cd /d "%~dp0"
set PYTHONIOENCODING=utf-8
if not exist logs mkdir logs

echo === prerequisites ===
curl -s -o nul -w "  Ollama (11434):    HTTP %%{http_code}\n" http://127.0.0.1:11434/api/tags
curl -s -o nul -w "  Breeze ASR (7765): HTTP %%{http_code}\n" http://127.0.0.1:7765/health
echo   ^(if ASR shows 000, start it via C:\ai-servers\start_manager.bat then the "Breeze ASR" service^)
echo.

:loop
echo [%date% %time%] starting haoji backend on :7780
echo [%date% %time%] --- start --- >> logs\backend.log
python app.py >> logs\backend.log 2>&1
echo [%date% %time%] backend EXITED (code %errorlevel%) — restarting in 3s.  Ctrl+C twice to stop.
echo [%date% %time%] --- exited code %errorlevel% --- >> logs\backend.log
timeout /t 3 /nobreak >nul
goto loop
