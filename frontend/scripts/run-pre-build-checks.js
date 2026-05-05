#!/usr/bin/env node
// Pre-build checks. Runs BEFORE tauri:build / tauri:build:debug.
// Currently: state-access lint (fast, ~1s).
//
// To skip (NOT recommended), use: pnpm run tauri:build:debug:skip-checks

const { spawnSync } = require('child_process');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const LINT_SCRIPT = path.join(REPO_ROOT, 'scripts', 'lint-state-access.sh');

console.log('[pre-build] Running state-access lint...');

// `bash` works on Windows too (git bash) and natively on mac/linux
const result = spawnSync('bash', [LINT_SCRIPT], {
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
