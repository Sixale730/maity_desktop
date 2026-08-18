#!/usr/bin/env pwsh
# Smoke test: launch the debug binary, wait 12s, kill, and grep the log for
# panic patterns + confirm AppState was managed. Then handshake with the
# bundled llama-helper (version/protocol) to catch a stale sidecar.
#
# Catches: panics during startup, silent DB init failures (sqlx checksum
# mismatch, etc.), missing AppState management, stale llama-helper.
#
# Usage:
#   powershell -File scripts\smoke-test-startup.ps1
#   pwsh -File scripts\smoke-test-startup.ps1
#
# Run this after every `pnpm tauri:build:debug` and before promoting to a
# production build / release.

$ErrorActionPreference = 'Stop'

$exe = "C:\maity_desktop\target\debug\maity-desktop.exe"
$logDir = "$env:LOCALAPPDATA\Maity\logs"

# Sanity check
if (-not (Test-Path $exe)) {
    Write-Error "Binary not found at $exe"
    Write-Error "   Run: cd frontend; pnpm run tauri:build:debug"
    exit 1
}

Write-Host "Smoke test: $exe"

# Tauri uses single-instance — if another maity-desktop is running, our launch
# will be silently killed and no logs will be written for our run. Abort early
# with a clear message so the user can close the running app first.
$existing = Get-Process -Name 'maity-desktop' -ErrorAction SilentlyContinue
if ($existing) {
    Write-Error "Another maity-desktop instance is running (PIDs: $($existing.Id -join ', ')). Close it before running smoke test (Tauri single-instance will silently kill our launch)."
    exit 1
}

# Get log file path for today. tracing-appender uses UTC for rotation
# filenames, so we must convert to UTC here too — otherwise we'd look at
# yesterday's log file across the UTC midnight boundary.
$today = (Get-Date).ToUniversalTime().ToString('yyyy-MM-dd')
$logFile = Join-Path $logDir "maity.$today.log"

# Snapshot current log size so we only inspect lines added during this run
$baselineSize = 0
if (Test-Path $logFile) {
    $baselineSize = (Get-Item $logFile).Length
}

# Launch + wait + graceful close.
# Note: 12s gives a debug build enough time to: load DLLs, init tracing-appender,
# run sqlx migrations (8s for the local-analysis migration on first run), and
# manage AppState. Production builds would need much less but this is debug.
#
# We try graceful close first (CloseMainWindow → Tauri unwinds stack → tracing
# guard drops → log buffer flushes). Then -Force as a last resort. If we
# Force-kill immediately, the non-blocking tracing channel never flushes and
# we get zero log output.
$proc = Start-Process $exe -PassThru
Write-Host "   Launched PID $($proc.Id), waiting 12s for startup + DB init..."
Start-Sleep -Seconds 12

# Graceful close first
$proc.Refresh()
if (-not $proc.HasExited) {
    $closed = $proc.CloseMainWindow()
    if ($closed) {
        $proc.WaitForExit(5000) | Out-Null
    }
}
# Force-kill anything left
Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
# Give 1s for child writer thread to drain
Start-Sleep -Seconds 1
# Also kill any orphaned children (sidecar, etc.)
Get-Process -Name 'maity-desktop' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-Process -Name 'llama-helper-x86_64-pc-windows-msvc' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

# Validate log
if (-not (Test-Path $logFile)) {
    Write-Error "Log file not created at $logFile"
    Write-Error "   App likely crashed before logger init"
    exit 1
}

# Read only the bytes appended during this run
$fs = [System.IO.File]::Open($logFile, 'Open', 'Read', 'ReadWrite')
$fs.Seek($baselineSize, 'Begin') | Out-Null
$reader = New-Object System.IO.StreamReader($fs)
$log = $reader.ReadToEnd()
$reader.Close()
$fs.Close()

if ([string]::IsNullOrWhiteSpace($log)) {
    Write-Error "No log lines appended during this run - app may have crashed before logger init"
    exit 1
}

$panicPatterns = @(
    'PANIC',
    'state\(\) called before manage',
    'Failed to initialize database',
    'VersionMismatch',
    'previously applied migration was modified'
)

$hadFailure = $false
foreach ($pat in $panicPatterns) {
    if ($log -match $pat) {
        Write-Host ""
        Write-Host "FAIL: Critical pattern detected: '$pat'" -ForegroundColor Red
        $log -split "`n" `
            | Select-String -Pattern "PANIC|Failed to|ERROR|VersionMismatch|state\(\)" `
            | Select-Object -First 15 `
            | ForEach-Object { Write-Host "  $_" -ForegroundColor Yellow }
        $hadFailure = $true
        break
    }
}

if ($hadFailure) {
    exit 1
}

if ($log -notmatch '\[DB Init\] AppState managed successfully') {
    Write-Host ""
    Write-Host "FAIL: '[DB Init] AppState managed successfully' not found in log" -ForegroundColor Red
    Write-Host "   DB init likely failed silently. Recent [DB Init] lines:" -ForegroundColor Yellow
    $log -split "`n" `
        | Select-String -Pattern "\[DB Init\]" `
        | Select-Object -First 10 `
        | ForEach-Object { Write-Host "  $_" -ForegroundColor Yellow }
    exit 1
}

# ---------------------------------------------------------------------------
# Handshake de version del sidecar llama-helper (provenance, ago-2026).
# Tauri copia el externalBin junto al exe (target\debug\llama-helper.exe). Un
# binario stale compila y arranca "verde"; solo hablandole se sabe que helper
# se embarco (3 meses de helper sin ids en 0.2.51-0.2.53 pasaron este smoke).
# ---------------------------------------------------------------------------
$helperCandidates = @(
    "C:\maity_desktop\target\debug\llama-helper.exe",
    "C:\maity_desktop\target\debug\llama-helper-x86_64-pc-windows-msvc.exe"
)
$helper = $helperCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
$bundledHelper = "C:\maity_desktop\frontend\src-tauri\binaries\llama-helper-x86_64-pc-windows-msvc.exe"
$helperCargo = "C:\maity_desktop\llama-helper\Cargo.toml"

if (-not $helper) {
    Write-Host ""
    Write-Host "FAIL: llama-helper no encontrado junto al exe (buscado: $($helperCandidates -join ', '))" -ForegroundColor Red
    Write-Host "   El externalBin no se bundleo. Revisar frontend/src-tauri/binaries/ y tauri.conf.json (externalBin)." -ForegroundColor Yellow
    exit 1
}

# (a) El helper bundleado junto al exe == el de src-tauri/binaries (mismos bytes)
if (Test-Path $bundledHelper) {
    $h1 = (Get-FileHash -Algorithm SHA256 $helper).Hash
    $h2 = (Get-FileHash -Algorithm SHA256 $bundledHelper).Hash
    if ($h1 -ne $h2) {
        Write-Host ""
        Write-Host "FAIL: el llama-helper junto al exe difiere del de src-tauri/binaries" -ForegroundColor Red
        Write-Host "   junto al exe : $h1" -ForegroundColor Yellow
        Write-Host "   binaries/    : $h2" -ForegroundColor Yellow
        exit 1
    }
}

# (b) Handshake: {"type":"version","id":1} => {"type":"version","version":"X","protocol":N,"id":1}
$expectedVersion = $null
if (Test-Path $helperCargo) {
    $m = Select-String -Path $helperCargo -Pattern '^version\s*=\s*"([^"]+)"' | Select-Object -First 1
    if ($m) { $expectedVersion = $m.Matches[0].Groups[1].Value }
}

$job = Start-Job -ScriptBlock {
    param($exePath)
    # ASCII: Windows PowerShell 5.1 con $OutputEncoding UTF-8 antepone un BOM al
    # pipear a un exe nativo (el helper 0.1.1 lo tolera, pero uno viejo no, y
    # ese "no" seria indistinguible de "no soporta version").
    $OutputEncoding = [System.Text.Encoding]::ASCII
    # El helper sale al EOF de stdin (main.rs), asi que el pipe termina solo.
    '{"type":"version","id":1}' | & $exePath 2>$null
} -ArgumentList $helper
$done = Wait-Job $job -Timeout 15
if (-not $done) {
    Stop-Job $job | Out-Null
    Remove-Job $job -Force | Out-Null
    Write-Host ""
    Write-Host "FAIL: llama-helper no respondio al handshake de version en 15s" -ForegroundColor Red
    exit 1
}
$helperOut = (Receive-Job $job | Out-String).Trim()
Remove-Job $job -Force | Out-Null

$versionLine = ($helperOut -split "`n" | Where-Object { $_ -match '"type"\s*:\s*"version"' } | Select-Object -First 1)
if (-not $versionLine) {
    Write-Host ""
    Write-Host "FAIL: llama-helper no responde 'version' - binario STALE (anterior a 0.1.1)" -ForegroundColor Red
    Write-Host "   Respuesta: $helperOut" -ForegroundColor Yellow
    Write-Host "   Regenerar: cd frontend; node scripts/verify-helper-binary.js --fix" -ForegroundColor Yellow
    exit 1
}
$versionJson = $versionLine | ConvertFrom-Json
if ($versionJson.id -ne 1) {
    Write-Host ""
    Write-Host "FAIL: el helper no devolvio el id del handshake (protocolo sin correlacion): $versionLine" -ForegroundColor Red
    exit 1
}
if ($expectedVersion -and $versionJson.version -ne $expectedVersion) {
    Write-Host ""
    Write-Host "FAIL: helper v$($versionJson.version) bundleado, pero llama-helper/Cargo.toml dice v$expectedVersion" -ForegroundColor Red
    Write-Host "   Regenerar: cd frontend; node scripts/verify-helper-binary.js --fix" -ForegroundColor Yellow
    exit 1
}

Write-Host ""
Write-Host "OK: Startup smoke test passed" -ForegroundColor Green
Write-Host "   - No panic patterns detected"
Write-Host "   - AppState managed successfully"
Write-Host "   - llama-helper v$($versionJson.version) (protocol $($versionJson.protocol)) responde al handshake"
