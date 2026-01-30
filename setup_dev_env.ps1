#Requires -Version 5.1
<#
.SYNOPSIS
    Setup script for Meetily (Maity Desktop) development environment on Windows.

.DESCRIPTION
    Detects prerequisites, installs missing tools via winget, configures the
    project (frontend deps + backend venv), and verifies the final state.
    Idempotent: safe to run multiple times.

.EXAMPLE
    .\setup_dev_env.ps1
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ── Helpers ──────────────────────────────────────────────────────────────────

function Write-Status {
    param(
        [string]$Message,
        [ValidateSet("OK","FAIL","WARN","INFO","INSTALL")]
        [string]$Level = "INFO"
    )
    switch ($Level) {
        "OK"      { Write-Host "  [OK] "      -ForegroundColor Green   -NoNewline; Write-Host $Message }
        "FAIL"    { Write-Host "  [FAIL] "    -ForegroundColor Red     -NoNewline; Write-Host $Message }
        "WARN"    { Write-Host "  [WARN] "    -ForegroundColor Yellow  -NoNewline; Write-Host $Message }
        "INFO"    { Write-Host "  [INFO] "    -ForegroundColor Cyan    -NoNewline; Write-Host $Message }
        "INSTALL" { Write-Host "  [INSTALLING] " -ForegroundColor Yellow -NoNewline; Write-Host $Message }
    }
}

function Write-Header {
    param([string]$Title)
    Write-Host ""
    Write-Host ("=" * 60) -ForegroundColor DarkGray
    Write-Host "  $Title" -ForegroundColor White
    Write-Host ("=" * 60) -ForegroundColor DarkGray
}

function Test-CommandExists {
    param([string]$Command)
    $null -ne (Get-Command $Command -ErrorAction SilentlyContinue)
}

function Get-VersionFromString {
    param([string]$Raw)
    if ($Raw -match '(\d+\.\d+(\.\d+)?)') {
        return [version]$Matches[1]
    }
    return $null
}

function Refresh-PathEnv {
    # Reload PATH from registry so newly-installed tools are visible
    $machinePath = [System.Environment]::GetEnvironmentVariable("Path", "Machine")
    $userPath    = [System.Environment]::GetEnvironmentVariable("Path", "User")
    $env:Path = "$machinePath;$userPath"
}

function Test-WingetAvailable {
    if (-not (Test-CommandExists "winget")) {
        Write-Status "winget not found. winget is required for automatic installation." "FAIL"
        Write-Status "winget is included in Windows 10 (1709+) and Windows 11 via App Installer." "INFO"
        Write-Status "Install it from: https://aka.ms/getwinget" "INFO"
        return $false
    }
    return $true
}

# ── Resolve script root ─────────────────────────────────────────────────────

$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Definition

# ── Banner ───────────────────────────────────────────────────────────────────

Write-Host ""
Write-Host "  Meetily (Maity Desktop) - Development Environment Setup" -ForegroundColor Cyan
Write-Host "  --------------------------------------------------------" -ForegroundColor DarkGray
Write-Host ""

# ── Phase 1: Detect prerequisites ───────────────────────────────────────────

Write-Header "Phase 1: Detecting prerequisites"

$missing = @()

# Git
if (Test-CommandExists "git") {
    $gitRaw = (git --version 2>&1) | Out-String
    $gitVer = Get-VersionFromString $gitRaw
    Write-Status "Git $gitVer" "OK"
} else {
    Write-Status "Git - not found" "FAIL"
    $missing += "git"
}

# Node.js (>= 18)
if (Test-CommandExists "node") {
    $nodeRaw = (node --version 2>&1) | Out-String
    $nodeVer = Get-VersionFromString $nodeRaw
    if ($nodeVer -and $nodeVer -ge [version]"18.0") {
        Write-Status "Node.js $nodeVer" "OK"
    } else {
        Write-Status "Node.js $nodeVer found but >= 18.0 required" "FAIL"
        $missing += "node"
    }
} else {
    Write-Status "Node.js - not found" "FAIL"
    $missing += "node"
}

# pnpm (>= 9)
if (Test-CommandExists "pnpm") {
    $pnpmRaw = (pnpm --version 2>&1) | Out-String
    $pnpmVer = Get-VersionFromString $pnpmRaw
    if ($pnpmVer -and $pnpmVer -ge [version]"9.0") {
        Write-Status "pnpm $pnpmVer" "OK"
    } else {
        Write-Status "pnpm $pnpmVer found but >= 9.0 required" "FAIL"
        $missing += "pnpm"
    }
} else {
    Write-Status "pnpm - not found" "FAIL"
    $missing += "pnpm"
}

# Rust (>= 1.77)
if (Test-CommandExists "rustc") {
    $rustRaw = (rustc --version 2>&1) | Out-String
    $rustVer = Get-VersionFromString $rustRaw
    if ($rustVer -and $rustVer -ge [version]"1.77") {
        Write-Status "Rust $rustVer" "OK"
    } else {
        Write-Status "Rust $rustVer found but >= 1.77 required" "FAIL"
        $missing += "rust"
    }
} else {
    Write-Status "Rust - not found" "FAIL"
    $missing += "rust"
}

# Python (>= 3.8)
$pythonCmd = $null
foreach ($cmd in @("python", "python3")) {
    if (Test-CommandExists $cmd) {
        $pythonCmd = $cmd
        break
    }
}

if ($pythonCmd) {
    $pyRaw = (& $pythonCmd --version 2>&1) | Out-String
    $pyVer = Get-VersionFromString $pyRaw
    if ($pyVer -and $pyVer -ge [version]"3.8") {
        Write-Status "Python $pyVer ($pythonCmd)" "OK"
    } else {
        Write-Status "Python $pyVer found but >= 3.8 required" "FAIL"
        $missing += "python"
    }
} else {
    Write-Status "Python - not found" "FAIL"
    $missing += "python"
}

# Visual Studio Build Tools 2022
$vswhereExe = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
$vsBuildToolsOk = $false
if (Test-Path $vswhereExe) {
    $vsInstalls = & $vswhereExe -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2>&1
    if ($vsInstalls -and (Test-Path "$vsInstalls")) {
        Write-Status "Visual Studio Build Tools (C++ workload)" "OK"
        $vsBuildToolsOk = $true
    }
}
if (-not $vsBuildToolsOk) {
    Write-Status "Visual Studio Build Tools (C++ workload) - not found" "FAIL"
    $missing += "vsbuildtools"
}

# CMake
if (Test-CommandExists "cmake") {
    $cmakeRaw = (cmake --version 2>&1 | Select-Object -First 1) | Out-String
    $cmakeVer = Get-VersionFromString $cmakeRaw
    Write-Status "CMake $cmakeVer" "OK"
} else {
    Write-Status "CMake - not found" "FAIL"
    $missing += "cmake"
}

# ── Phase 2: Install missing prerequisites ──────────────────────────────────

if ($missing.Count -gt 0) {
    Write-Header "Phase 2: Installing missing prerequisites"

    Write-Host ""
    Write-Host "  The following tools need to be installed:" -ForegroundColor Yellow
    foreach ($tool in $missing) {
        switch ($tool) {
            "git"          { Write-Host "    - Git                  (via winget: Git.Git)" }
            "node"         { Write-Host "    - Node.js LTS          (via winget: OpenJS.NodeJS.LTS)" }
            "pnpm"         { Write-Host "    - pnpm                 (via npm install -g pnpm)" }
            "rust"         { Write-Host "    - Rust (rustup)        (via winget: Rustlang.Rustup)" }
            "python"       { Write-Host "    - Python 3.12          (via winget: Python.Python.3.12)" }
            "vsbuildtools" { Write-Host "    - VS Build Tools 2022  (via winget: Microsoft.VisualStudio.2022.BuildTools + C++ workload)" }
            "cmake"        { Write-Host "    - CMake                (via winget: Kitware.CMake)" }
        }
    }
    Write-Host ""

    $answer = Read-Host "  Install all missing tools? (Y/N)"
    if ($answer -notin @("Y","y","yes","Yes","YES")) {
        Write-Host ""
        Write-Status "Installation cancelled. Please install the missing tools manually and re-run this script." "WARN"
        exit 0
    }

    if (-not (Test-WingetAvailable)) {
        exit 1
    }

    # Install each missing tool
    foreach ($tool in $missing) {
        switch ($tool) {
            "git" {
                Write-Status "Installing Git..." "INSTALL"
                winget install --id Git.Git -e --accept-source-agreements --accept-package-agreements
                Refresh-PathEnv
            }
            "node" {
                Write-Status "Installing Node.js LTS..." "INSTALL"
                winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
                Refresh-PathEnv
            }
            "pnpm" {
                # pnpm depends on node; if node was also missing it was just installed above
                Refresh-PathEnv
                if (-not (Test-CommandExists "npm")) {
                    Write-Status "npm not available after Node.js install. Please restart your terminal and re-run this script." "FAIL"
                    exit 1
                }
                Write-Status "Installing pnpm via npm..." "INSTALL"
                npm install -g pnpm
                Refresh-PathEnv
            }
            "rust" {
                Write-Status "Installing Rustup..." "INSTALL"
                winget install --id Rustlang.Rustup -e --accept-source-agreements --accept-package-agreements
                Refresh-PathEnv
                # Ensure stable toolchain is set
                if (Test-CommandExists "rustup") {
                    rustup default stable
                }
            }
            "python" {
                Write-Status "Installing Python 3.12..." "INSTALL"
                winget install --id Python.Python.3.12 -e --accept-source-agreements --accept-package-agreements
                Refresh-PathEnv
            }
            "vsbuildtools" {
                Write-Status "Installing Visual Studio 2022 Build Tools with C++ workload..." "INSTALL"
                Write-Status "This may take several minutes..." "INFO"
                winget install --id Microsoft.VisualStudio.2022.BuildTools -e --accept-source-agreements --accept-package-agreements --override "--add Microsoft.VisualStudio.Workload.VCTools --includeRecommended --passive"
                Refresh-PathEnv
            }
            "cmake" {
                Write-Status "Installing CMake..." "INSTALL"
                winget install --id Kitware.CMake -e --accept-source-agreements --accept-package-agreements
                Refresh-PathEnv
            }
        }
    }

    Write-Host ""
    Write-Status "Installation phase complete." "INFO"
} else {
    Write-Header "Phase 2: All prerequisites already installed"
    Write-Status "Nothing to install." "OK"
}

# ── Phase 3: Configure project ──────────────────────────────────────────────

Write-Header "Phase 3: Configuring project"

# Refresh PATH one more time before project setup
Refresh-PathEnv

# Resolve python command (may have changed after install)
$pythonCmd = $null
foreach ($cmd in @("python", "python3")) {
    if (Test-CommandExists $cmd) {
        $pythonCmd = $cmd
        break
    }
}

# 3a. Frontend dependencies
$frontendDir = Join-Path $ScriptRoot "frontend"
$nodeModulesDir = Join-Path $frontendDir "node_modules"

if (Test-Path $nodeModulesDir) {
    Write-Status "Frontend dependencies already installed (node_modules exists)" "OK"
} else {
    if (Test-CommandExists "pnpm") {
        Write-Status "Installing frontend dependencies (pnpm install)..." "INSTALL"
        Push-Location $frontendDir
        try {
            pnpm install
            if ($LASTEXITCODE -eq 0) {
                Write-Status "Frontend dependencies installed" "OK"
            } else {
                Write-Status "pnpm install failed (exit code $LASTEXITCODE)" "FAIL"
            }
        } finally {
            Pop-Location
        }
    } else {
        Write-Status "pnpm not available, cannot install frontend dependencies" "FAIL"
    }
}

# 3b. Backend virtual environment
$backendDir = Join-Path $ScriptRoot "backend"
$venvDir = Join-Path $backendDir "venv"
$requirementsFile = Join-Path $backendDir "requirements.txt"
$requirementsDevFile = Join-Path $backendDir "requirements-dev.txt"

if (Test-Path (Join-Path $venvDir "Scripts\python.exe")) {
    Write-Status "Backend virtual environment already exists" "OK"
} else {
    if ($pythonCmd) {
        Write-Status "Creating backend virtual environment..." "INSTALL"
        Push-Location $backendDir
        try {
            & $pythonCmd -m venv venv
            if ($LASTEXITCODE -eq 0) {
                Write-Status "Virtual environment created" "OK"
            } else {
                Write-Status "Failed to create virtual environment (exit code $LASTEXITCODE)" "FAIL"
            }
        } finally {
            Pop-Location
        }
    } else {
        Write-Status "Python not available, cannot create virtual environment" "FAIL"
    }
}

# Install backend pip dependencies inside venv
$venvPip = Join-Path $venvDir "Scripts\pip.exe"
if ((Test-Path $venvPip) -and (Test-Path $requirementsFile)) {
    Write-Status "Installing backend Python dependencies..." "INSTALL"
    & $venvPip install -r $requirementsFile
    if ($LASTEXITCODE -eq 0) {
        Write-Status "Backend dependencies installed" "OK"
    } else {
        Write-Status "pip install requirements.txt failed (exit code $LASTEXITCODE)" "WARN"
    }

    if (Test-Path $requirementsDevFile) {
        Write-Status "Installing backend dev dependencies..." "INSTALL"
        & $venvPip install -r $requirementsDevFile
        if ($LASTEXITCODE -eq 0) {
            Write-Status "Backend dev dependencies installed" "OK"
        } else {
            Write-Status "pip install requirements-dev.txt failed (exit code $LASTEXITCODE)" "WARN"
        }
    }
} elseif (-not (Test-Path $venvPip)) {
    Write-Status "Backend venv pip not found, skipping dependency install" "WARN"
}

# ── Phase 4: Final verification ─────────────────────────────────────────────

Write-Header "Phase 4: Verification"

# Re-detect everything for final report
Refresh-PathEnv

# Git
if (Test-CommandExists "git") {
    $v = Get-VersionFromString ((git --version 2>&1) | Out-String)
    Write-Status "Git $v" "OK"
} else { Write-Status "Git - not found" "FAIL" }

# Node
if (Test-CommandExists "node") {
    $v = Get-VersionFromString ((node --version 2>&1) | Out-String)
    Write-Status "Node.js $v" "OK"
} else { Write-Status "Node.js - not found" "FAIL" }

# pnpm
if (Test-CommandExists "pnpm") {
    $v = Get-VersionFromString ((pnpm --version 2>&1) | Out-String)
    Write-Status "pnpm $v" "OK"
} else { Write-Status "pnpm - not found" "FAIL" }

# Rust
if (Test-CommandExists "rustc") {
    $v = Get-VersionFromString ((rustc --version 2>&1) | Out-String)
    Write-Status "Rust $v" "OK"
} else { Write-Status "Rust - not found" "FAIL" }

# Python
if ($pythonCmd -and (Test-CommandExists $pythonCmd)) {
    $v = Get-VersionFromString ((& $pythonCmd --version 2>&1) | Out-String)
    Write-Status "Python $v" "OK"
} else { Write-Status "Python - not found" "FAIL" }

# VS Build Tools
$vsBuildToolsOk = $false
if (Test-Path $vswhereExe) {
    $vsInstalls = & $vswhereExe -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2>&1
    if ($vsInstalls -and (Test-Path "$vsInstalls")) {
        $vsBuildToolsOk = $true
    }
}
if ($vsBuildToolsOk) {
    Write-Status "VS Build Tools 2022 (C++ workload)" "OK"
} else {
    Write-Status "VS Build Tools 2022 (C++ workload) - not found" "FAIL"
}

# CMake
if (Test-CommandExists "cmake") {
    $v = Get-VersionFromString ((cmake --version 2>&1 | Select-Object -First 1) | Out-String)
    Write-Status "CMake $v" "OK"
} else { Write-Status "CMake - not found" "FAIL" }

# Frontend deps
if (Test-Path $nodeModulesDir) {
    Write-Status "Frontend dependencies installed (node_modules exists)" "OK"
} else {
    Write-Status "Frontend dependencies not installed" "FAIL"
}

# Backend venv
if (Test-Path (Join-Path $venvDir "Scripts\python.exe")) {
    Write-Status "Backend virtual environment configured" "OK"
} else {
    Write-Status "Backend virtual environment not configured" "FAIL"
}

# ── Phase 5: Next steps ─────────────────────────────────────────────────────

Write-Header "Setup complete - Next steps"

Write-Host ""
Write-Host "  Start the frontend in development mode:" -ForegroundColor White
Write-Host "    cd frontend" -ForegroundColor Gray
Write-Host "    pnpm run tauri:dev" -ForegroundColor Gray
Write-Host ""
Write-Host "  Build for production:" -ForegroundColor White
Write-Host "    cd frontend" -ForegroundColor Gray
Write-Host "    pnpm run tauri:build" -ForegroundColor Gray
Write-Host ""
Write-Host "  Start the backend:" -ForegroundColor White
Write-Host "    cd backend" -ForegroundColor Gray
Write-Host "    .\venv\Scripts\Activate.ps1" -ForegroundColor Gray
Write-Host "    python app\main.py" -ForegroundColor Gray
Write-Host ""
Write-Host "  Full documentation:" -ForegroundColor White
Write-Host "    Backend API docs:  http://localhost:5167/docs" -ForegroundColor Gray
Write-Host "    Frontend dev:      http://localhost:3118" -ForegroundColor Gray
Write-Host ""
