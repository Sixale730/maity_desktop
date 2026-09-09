#!/usr/bin/env node
// Post-build checks. Runs AFTER tauri:build:debug to validate the freshly
// built binary actually starts without panics.
//
// Skipped on prod build (tauri:build) since the production binary is signed
// and we don't want to launch it before signing. Only applies to debug.
//
// Skipped automatically on platforms where the smoke test isn't supported.

const { spawnSync } = require('child_process');
const path = require('path');
const os = require('os');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SMOKE_PS1 = path.join(REPO_ROOT, 'scripts', 'smoke-test-startup.ps1');
const SMOKE_SH = path.join(REPO_ROOT, 'scripts', 'smoke-test-startup.sh');
const EXE_IMPORTS_LINT = path.join(__dirname, 'lint-exe-imports.js');

const platform = os.platform();

// Windows: la tabla de imports del exe antes de lanzarlo. DirectML/D3D12/DXGI/DXCORE
// deben ser delay-load (#33 de la auditoría de recursos, build.rs); si vuelven a
// ser imports de carga, el exe arranca igual y el smoke no lo vería.
if (platform === 'win32') {
    console.log('[post-build] Checking exe import table (delay-load de DirectML/D3D12)...');
    const lint = spawnSync(process.execPath, [EXE_IMPORTS_LINT], { stdio: 'inherit', shell: false });
    if (lint.status !== 0) {
        console.error('');
        console.error('[post-build] FAIL: exe import table check failed (see above).');
        console.error('  Escape hatch: pnpm run tauri:build:debug:skip-checks');
        process.exit(1);
    }
}

console.log('[post-build] Running startup smoke test...');

let cmd, args;

if (platform === 'win32') {
    cmd = 'powershell';
    args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SMOKE_PS1];
} else if (platform === 'darwin' || platform === 'linux') {
    cmd = 'bash';
    args = [SMOKE_SH];
} else {
    console.log(`[post-build] SKIP: smoke test not supported on ${platform}`);
    process.exit(0);
}

const result = spawnSync(cmd, args, {
    stdio: 'inherit',
    shell: false,
});

if (result.status !== 0) {
    console.error('');
    console.error('[post-build] FAIL: startup smoke test failed.');
    console.error('  The binary built but does not start cleanly.');
    console.error('  Check the log output above for panic patterns or missing AppState init.');
    console.error('  Escape hatch: pnpm run tauri:build:debug:skip-checks');
    process.exit(1);
}

console.log('[post-build] OK: smoke test passed');
