# -*- coding: utf-8 -*-
# 好記 Haoji — headless keepalive (run by Task Scheduler every few minutes).
#
# Idempotent "ensure the backend stack is up" check. Safe to run on a timer.
#   1. AI Service Manager (:8760) — start it if it died
#   2. 好記 backend  (:8780, gpu:false) — start via manager if down (always safe)
#   3. Breeze ASR    (:8765, gpu:true) — start via manager ONLY if the GPU is free.
#      If another GPU model owns the GPU we DON'T touch it (a timer must never
#      kill your other work). When you actually need ASR and a model holds the
#      GPU, run start.bat interactively — it asks before stopping it.
#
# Never prompts, never throws out; logs one line per action to keepalive.log.

$ErrorActionPreference = "SilentlyContinue"
$Here        = Split-Path -Parent $MyInvocation.MyCommand.Path
$LogFile     = Join-Path $Here "keepalive.log"
$ManagerBase = "http://127.0.0.1:8760"
$ManagerBat  = "C:\ai-servers\start_manager.bat"
$ManagerDir  = "C:\ai-servers"

function Log($m) {
    $ts = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
    Add-Content -Path $LogFile -Value "[$ts] $m" -Encoding utf8
    # keep the log from growing forever (~last 500 lines)
    $lines = @(Get-Content $LogFile -ErrorAction SilentlyContinue)
    if ($lines.Count -gt 600) { Set-Content -Path $LogFile -Value ($lines | Select-Object -Last 500) -Encoding utf8 }
}
function Get-Json($url, $t = 3) { try { return Invoke-RestMethod $url -TimeoutSec $t } catch { return $null } }
function Post($url) { try { Invoke-RestMethod $url -Method Post -TimeoutSec 15 | Out-Null; return $true } catch { return $false } }

# --- 1. manager --------------------------------------------------------------
$svc = Get-Json "$ManagerBase/api/services"
if (-not $svc) {
    Log "manager down -> starting"
    Start-Process -FilePath $ManagerBat -WorkingDirectory $ManagerDir -WindowStyle Minimized
    for ($i = 0; $i -lt 20; $i++) { Start-Sleep 1; $svc = Get-Json "$ManagerBase/api/services"; if ($svc) { break } }
    if (-not $svc) { Log "manager FAILED to come up — giving up this cycle"; exit 0 }
    Log "manager up"
}

# --- 2. 好記 backend (gpu:false, always safe to start) -----------------------
$haojiUp = (Get-Json "http://127.0.0.1:8780/health") -ne $null
if (-not $haojiUp) {
    $h = $svc | Where-Object { $_.id -eq "haoji" }
    if ($h) {
        if ($h.status -ne "stopped") { Post "$ManagerBase/api/services/haoji/stop" | Out-Null; Start-Sleep 1 }
        if (Post "$ManagerBase/api/services/haoji/start") { Log "haoji :8780 was down -> started" }
        else { Log "haoji start request failed" }
    } else { Log "haoji not in services.json — cannot auto-start" }
}

# --- 3. Breeze ASR (gpu:true, only if GPU is free) ---------------------------
$asrHealth = Get-Json "http://127.0.0.1:8765/health"
$asrOk = $asrHealth -and ($asrHealth.status -eq "ok" -or "$($asrHealth.model)" -match "breeze")
if (-not $asrOk) {
    $blockers = $svc | Where-Object { $_.gpu -eq $true -and $_.id -ne "asr" -and ($_.status -eq "running" -or $_.status -eq "starting") }
    if ($blockers) {
        Log ("ASR down but GPU held by: " + (($blockers.name) -join ", ") + " — leaving it (run start.bat to force)")
    } else {
        $a = $svc | Where-Object { $_.id -eq "asr" }
        if ($a -and $a.status -ne "stopped") { Post "$ManagerBase/api/services/asr/stop" | Out-Null; Start-Sleep 1 }
        if (Post "$ManagerBase/api/services/asr/start") { Log "ASR :8765 was down, GPU free -> started" }
        else { Log "ASR start request failed" }
    }
}

exit 0
