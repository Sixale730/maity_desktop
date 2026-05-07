#!/usr/bin/env node
// Pre-build checks. Runs BEFORE tauri:build / tauri:build:debug.
// Currently: state-access lint (fast, ~1s) + providers-tree lint (fast, <100ms).
//
// To skip (NOT recommended), use: pnpm run tauri:build:debug:skip-checks

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const LINT_SCRIPT = path.join(REPO_ROOT, 'scripts', 'lint-state-access.sh');
const PROVIDERS_TREE_SCRIPT = path.join(__dirname, 'lint-providers-tree.js');
// On Windows, bash (Git Bash/MINGW) treats backslashes as escapes, mangling
// `C:\maity_desktop\...` into `C:maity_desktop...`. Forward slashes work on
// every platform.
const BASH_LINT_SCRIPT = LINT_SCRIPT.replace(/\\/g, '/');

// On Windows, `bash` in PATH may resolve to WSL's bash (C:\Windows\System32\bash.exe),
// which only sees `/mnt/c/...` paths. Force Git Bash when available so we can pass
// native Windows paths.
function resolveBash() {
    if (process.platform !== 'win32') return 'bash';
    const candidates = [
        'C:\\Program Files\\Git\\bin\\bash.exe',
        'C:\\Program Files\\Git\\usr\\bin\\bash.exe',
        'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
    ];
    for (const c of candidates) {
        if (fs.existsSync(c)) return c;
    }
    return 'bash';
}

const BASH = resolveBash();

console.log('[pre-build] Running state-access lint...');

const result = spawnSync(BASH, [BASH_LINT_SCRIPT], {
    stdio: 'inherit',
    shell: false,
});

if (result.status !== 0) {
    console.error('');
    console.error('[pre-build] FAIL: state-access lint failed.');
    console.error('  Fix the violations above, or add `// state-allow: <reason>` if intentional.');
    console.error('  Escape hatch: pnpm run tauri:build:debug:skip-checks');
    process.exit(1);
}

console.log('[pre-build] OK: state-access lint passed');

console.log('[pre-build] Running providers-tree lint...');
const treeResult = spawnSync(process.execPath, [PROVIDERS_TREE_SCRIPT], {
    stdio: 'inherit',
    shell: false,
});

if (treeResult.status !== 0) {
    console.error('');
    console.error('[pre-build] FAIL: providers-tree lint failed.');
    console.error('  Restore the MARKER comment in src/app/layout.tsx, or update');
    console.error('  PROVIDER_INVARIANTS in src/app/layout.test.ts if intentional.');
    console.error('  Escape hatch: pnpm run tauri:build:debug:skip-checks');
    process.exit(1);
}

console.log('[pre-build] OK: providers-tree lint passed');
