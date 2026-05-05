#!/usr/bin/env pwsh
# Smoke test: launch the debug binary, wait 6s, kill, and grep the log for
# panic patterns + confirm AppState was managed.
#
# Catches: panics during startup, silent DB init failures (sqlx checksum
# mismatch, etc.), missing AppState management.
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

Write-Host ""
Write-Host "OK: Startup smoke test passed" -ForegroundColor Green
Write-Host "   - No panic patterns detected"
Write-Host "   - AppState managed successfully"
