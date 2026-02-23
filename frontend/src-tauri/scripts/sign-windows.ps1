param(
    [Parameter(Mandatory=$true)]
    [string]$FilePath
)

# ============================================================
# Code Signing Script for Maity Desktop
# Supports: Certum Cloud (SimplySign) via signtool
#
# Prerequisites:
#   1. SimplySign Desktop installed and connected
#   2. Certificate visible to signtool (SHA1 hash configured below)
#
# Environment variables (optional overrides):
#   CERTUM_SHA1 - SHA1 thumbprint of the signing certificate
#   SKIP_CODE_SIGNING - Set to "true" to skip signing entirely
# ============================================================

# Allow skipping signing for local dev builds
if ($env:SKIP_CODE_SIGNING -eq "true") {
    Write-Host "Skipping code signing - SKIP_CODE_SIGNING=true"
    exit 0
}

# Certificate SHA1 thumbprint - Certum Code Signing (Asertio)
# Override with CERTUM_SHA1 env var if needed
$sha1 = if ($env:CERTUM_SHA1) { $env:CERTUM_SHA1 } else { "81DACE307F40CC0BB002FFB5B4785BFAB97DCF7F" }

# Certum RFC 3161 Timestamp Authority
$timestampUrl = "http://time.certum.pl"

# Find signtool.exe - prefer newer SDK versions (older ones have bugs with SimplySign virtual smart card)
$signtoolPaths = @(
    "${env:ProgramFiles(x86)}\Windows Kits\10\bin\10.0.26100.0\x64\signtool.exe",
    "${env:ProgramFiles(x86)}\Windows Kits\10\bin\10.0.22621.0\x64\signtool.exe",
    "${env:ProgramFiles(x86)}\Windows Kits\10\bin\10.0.22000.0\x64\signtool.exe",
    "${env:ProgramFiles(x86)}\Windows Kits\10\bin\10.0.19041.0\x64\signtool.exe"
)

$signtool = $null
foreach ($path in $signtoolPaths) {
    if (Test-Path $path) {
        $signtool = $path
        break
    }
}

# Fallback: search in PATH
if (-not $signtool) {
    $signtool = Get-Command signtool.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source
}

if (-not $signtool) {
    Write-Error "signtool.exe not found. Install Windows SDK."
    exit 1
}

Write-Host "Signing: $FilePath"
Write-Host "Using certificate SHA1: $sha1"
Write-Host "Timestamp server: $timestampUrl"
Write-Host "SignTool: $signtool"

# Sign the file
# /sha1   - Select certificate by thumbprint
# /fd     - File digest algorithm (SHA256)
# /tr     - RFC 3161 timestamp server URL
# /td     - Timestamp digest algorithm (SHA256)
# /v      - Verbose output
& $signtool sign /sha1 $sha1 /fd SHA256 /tr $timestampUrl /td SHA256 /v "$FilePath"
$signExitCode = $LASTEXITCODE

if ($signExitCode -ne 0) {
    Write-Error "Signing failed with exit code: $signExitCode"
    Write-Host ""
    Write-Host "Common issues:"
    Write-Host "  - SimplySign Desktop not running or not connected"
    Write-Host "  - Token expired (reconnect SimplySign Desktop)"
    Write-Host "  - Certificate SHA1 mismatch (check with: signtool sign /debug /fd SHA256 /v)"
    exit $signExitCode
}

# Verify using signtool (more reliable than Get-AuthenticodeSignature for dual-signed files)
& $signtool verify /pa /q "$FilePath"
$verifyExitCode = $LASTEXITCODE

if ($verifyExitCode -ne 0) {
    Write-Error "Signature verification failed after signing"
    exit 1
}

Write-Host "Successfully signed and verified: $FilePath"
