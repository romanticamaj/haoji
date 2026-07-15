# -*- coding: utf-8 -*-
# 好記 Haoji — one-shot backend launcher (Windows GPU box).
#
# Brings the WHOLE backend up in the right order:
#   1. AI Service Manager (:8760)  — starts it if it's not already running
#   2. Breeze ASR (:8765)          — via the manager; if another GPU model owns
#                                    the GPU it ASKS before stopping it (GPU is
#                                    mutually exclusive — only one gpu:true svc
#                                    can run at a time)
#   3. Ollama (:11434)             — best-effort auto-start (needed at analyze)
#   4. 好記 backend (:8780)         — python app.py (foreground)
#
# Usage:  powershell -ExecutionPolicy Bypass -File start.ps1
#         (or just double-click start.bat, which calls this)
#
# Flags:
#   -Force            stop the GPU-owning model WITHOUT asking
#   -NoStop           never stop another model (abort if GPU is busy)
#   -RestartBackend   kill an already-running :8780 and relaunch it

param(
    [switch]$Force,
    [switch]$NoStop,
    [switch]$RestartBackend
)

$ErrorActionPreference = "Stop"
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path

# --- constants (mirror config.py / C:\ai-servers\services.json) ---------------
$ManagerBase   = "http://127.0.0.1:8760"
$ManagerBat    = "C:\ai-servers\start_manager.bat"
$ManagerDir    = "C:\ai-servers"
$AsrId         = "asr"
$AsrHealth     = "http://127.0.0.1:8765/health"
$OllamaTags    = "http://127.0.0.1:11434/api/tags"
$OllamaExe     = Join-Path $env:LOCALAPPDATA "Programs\Ollama\ollama.exe"
$HaojiHealth   = "http://127.0.0.1:8780/health"
$HaojiPort     = 8780

function Info($m)  { Write-Host $m }
function Ok($m)    { Write-Host $m -ForegroundColor Green }
function Warn($m)  { Write-Host $m -ForegroundColor Yellow }
function Err($m)   { Write-Host $m -ForegroundColor Red }

function Test-Http($url, $timeoutSec = 3) {
    try { $r = Invoke-WebRequest -Uri $url -TimeoutSec $timeoutSec -UseBasicParsing; return $r.StatusCode }
    catch { return $null }
}

# --- 1. AI Service Manager ---------------------------------------------------
Info "=== [1/4] AI Service Manager (:8760) ==="
$svc = $null
try { $svc = Invoke-RestMethod "$ManagerBase/api/services" -TimeoutSec 3 } catch {}
if (-not $svc) {
    Warn "  manager 沒在跑，啟動中… ($ManagerBat)"
    Start-Process -FilePath $ManagerBat -WorkingDirectory $ManagerDir -WindowStyle Minimized
    for ($i = 0; $i -lt 30; $i++) {
        Start-Sleep -Seconds 1
        try { $svc = Invoke-RestMethod "$ManagerBase/api/services" -TimeoutSec 2; break } catch {}
    }
    if (-not $svc) { Err "  啟動 manager 失敗，請手動跑 $ManagerBat"; exit 1 }
}
Ok "  manager OK"

# --- 2. Breeze ASR (with GPU handoff) ----------------------------------------
Info "=== [2/4] Breeze ASR (:8765) ==="
$asr = $svc | Where-Object { $_.id -eq $AsrId } | Select-Object -First 1

$asrHealthy = (Test-Http $AsrHealth 3) -eq 200
if ($asr.status -eq "running" -and $asrHealthy) {
    Ok "  Breeze ASR 已在跑"
} else {
    # Who owns the GPU right now? (any gpu:true svc that's up and isn't asr)
    $blockers = $svc | Where-Object { $_.gpu -eq $true -and $_.id -ne $AsrId -and ($_.status -eq "running" -or $_.status -eq "starting") }
    if ($blockers) {
        $names = ($blockers | ForEach-Object { $_.name }) -join ", "
        Warn "  GPU 正被佔用：$names"
        if ($NoStop) { Err "  -NoStop 已設，放棄啟動 ASR。請自行到 $ManagerBase 處理。"; exit 1 }
        $go = $Force
        if (-not $Force) {
            $ans = Read-Host "  要停掉上述模型並啟動 Breeze ASR 嗎？(Y/N)"
            $go = ($ans -match '^[Yy]')
        }
        if (-not $go) { Warn "  已取消，沒有停任何服務。"; exit 1 }
        foreach ($b in $blockers) {
            Info "  停止 $($b.name)…"
            try { Invoke-RestMethod "$ManagerBase/api/services/$($b.id)/stop" -Method Post -TimeoutSec 10 | Out-Null } catch { Warn "    停 $($b.id) 出錯：$_" }
        }
        Start-Sleep -Seconds 2
    }

    # clean any half-dead asr, then start fresh
    if ($asr.status -ne "stopped") {
        try { Invoke-RestMethod "$ManagerBase/api/services/$AsrId/stop" -Method Post -TimeoutSec 10 | Out-Null } catch {}
    }
    Info "  啟動 Breeze ASR…"
    try { Invoke-RestMethod "$ManagerBase/api/services/$AsrId/start" -Method Post -TimeoutSec 15 | Out-Null }
    catch { Err "  啟動 ASR 失敗：$_"; exit 1 }

    Info "  等待 ASR 就緒（載入模型，最多 180 秒）…"
    $ready = $false
    for ($i = 0; $i -lt 180; $i++) {
        Start-Sleep -Seconds 1
        try {
            $h = Invoke-RestMethod $AsrHealth -TimeoutSec 2
            if ($h.status -eq "ok" -or "$($h.model)" -match "breeze") { $ready = $true; break }
        } catch {}
        if ($i % 5 -eq 4) { Write-Host "." -NoNewline }
    }
    Write-Host ""
    if ($ready) { Ok "  Breeze ASR OK" }
    else { Err "  ASR 逾時未就緒。看 $ManagerBase 的 logs 找原因。"; exit 1 }
}

# --- 3. Ollama ---------------------------------------------------------------
Info "=== [3/4] Ollama (:11434) ==="
if ((Test-Http $OllamaTags 3) -eq 200) {
    Ok "  Ollama OK"
} else {
    Warn "  Ollama 沒回應，嘗試啟動…"
    if (Test-Path $OllamaExe) {
        Start-Process -FilePath $OllamaExe -ArgumentList "serve" -WindowStyle Hidden
        $up = $false
        for ($i = 0; $i -lt 15; $i++) { Start-Sleep -Seconds 1; if ((Test-Http $OllamaTags 2) -eq 200) { $up = $true; break } }
        if ($up) { Ok "  Ollama OK" } else { Warn "  Ollama 仍未起（analyze 生會議記錄時才需要，可稍後再開）。" }
    } else {
        Warn "  找不到 $OllamaExe，請手動開 Ollama。"
    }
}

# --- 4. 好記 backend ---------------------------------------------------------
Info "=== [4/4] 好記 backend (:8780) ==="
$beUp = (Test-Http $HaojiHealth 3) -eq 200
if ($beUp -and -not $RestartBackend) {
    Ok "  好記後端已在跑 :8780（要重啟加 -RestartBackend）"
    Ok ""
    Ok "全部就緒。App 可連 http://100.106.118.45:8780 (Tailscale)"
    exit 0
}
if ($beUp -and $RestartBackend) {
    Warn "  重啟 :8780，先關掉舊的…"
    Get-NetTCPConnection -LocalPort $HaojiPort -State Listen -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique |
        ForEach-Object { try { Stop-Process -Id $_ -Force } catch {} }
    Start-Sleep -Seconds 1
}

Info "  啟動好記後端於 :8780…"
$env:PYTHONIOENCODING = "utf-8"
Set-Location $Here
python app.py
