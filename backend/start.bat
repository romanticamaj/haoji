@echo off
REM 好記 Haoji backend launcher (Windows GPU box).
REM One-shot: brings up AI Service Manager -> Breeze ASR (grabs the GPU, asking
REM first if another model is using it) -> Ollama -> 好記 backend (:7780).
REM The Expo app (Mac dev / TestFlight) connects here over Tailscale
REM (100.106.118.45:7780). Real logic lives in start.ps1.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" %*
