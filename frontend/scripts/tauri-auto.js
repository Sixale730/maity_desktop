#!/usr/bin/env node
/**
 * Auto-detect GPU and run Tauri with appropriate features
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Get the command (dev or build) and optional flags
const command = process.argv[2];
const extraArgs = process.argv.slice(3); // e.g. --debug, --target universal-apple-darwin
if (!command || !['dev', 'build'].includes(command)) {
  console.error('Usage: node tauri-auto.js [dev|build] [--debug] [--target <triple>]');
  process.exit(1);
}
const isDebug = extraArgs.includes('--debug');
// Tauri-level flags to forward. Drop --debug (handled separately) and any standalone
// `--` separator that pnpm injects when the caller does `pnpm run tauri:build -- --foo`
// — without dropping it, the separator leaks into the tauri command and pushes
// subsequent flags (like --target) into cargo's arg space, breaking virtual targets
// such as universal-apple-darwin.
const forwardedTauriArgs = extraArgs.filter((a) => a !== '--debug' && a !== '--');
const targetIdx = forwardedTauriArgs.indexOf('--target');
const tauriTarget = targetIdx >= 0 ? forwardedTauriArgs[targetIdx + 1] : null;

// Detect GPU feature
let feature = '';

// Check for environment variable override first
if (process.env.TAURI_GPU_FEATURE) {
  feature = process.env.TAURI_GPU_FEATURE;
  console.log(`🔧 Using forced GPU feature from environment: ${feature}`);
} else {
  try {
    const result = execSync('node scripts/auto-detect-gpu.js', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'inherit']
    });
    feature = result.trim();
  } catch (err) {
    // If detection fails, continue with no features
  }
}

console.log(''); // Empty line for spacing

// Platform-specific environment variables
const platform = os.platform();
const env = { ...process.env };

if (platform === 'linux' && feature === 'cuda') {
  console.log('🐧 Linux/CUDA detected: Setting CMAKE flags for NVIDIA GPU');
  env.CMAKE_CUDA_ARCHITECTURES = '75';
  env.CMAKE_CUDA_STANDARD = '17';
  env.CMAKE_POSITION_INDEPENDENT_CODE = 'ON';
}

// Builds DEBUG en Windows: omitir la firma Authenticode por default.
// Sin SimplySign/Certum conectado, sign-windows.ps1 sale != 0 y Tauri aborta el
// bundling ("failed to bundle project `failed to run powershell`") ANTES de
// generar MSI/NSIS. Un build debug nunca necesita Authenticode; sign-windows.ps1
// respeta SKIP_CODE_SIGNING=true (exit 0 sin firmar). Los builds release no se
// tocan: ahí la firma sigue siendo obligatoria salvo override explícito.
if (command === 'build' && isDebug && platform === 'win32' && env.SKIP_CODE_SIGNING === undefined) {
  env.SKIP_CODE_SIGNING = 'true';
  console.log('🔏 Build debug: firma Authenticode omitida (SKIP_CODE_SIGNING=true automático)');
}

// Build the tauri command
let tauriCmd = `tauri ${command}`;
if (isDebug) {
  tauriCmd += ' --debug';
}
if (forwardedTauriArgs.length > 0) {
  tauriCmd += ' ' + forwardedTauriArgs.join(' ');
}
if (feature && feature !== 'none') {
  // Pass --features directly to tauri (not via `--` separator) so it works
  // with virtual targets like --target universal-apple-darwin where Tauri
  // invokes cargo per-arch internally and the `--` forwarding breaks.
  tauriCmd += ` --features ${feature}`;
  console.log(`🚀 Running: tauri ${command}${isDebug ? ' --debug' : ''}${forwardedTauriArgs.length ? ' ' + forwardedTauriArgs.join(' ') : ''} with features: ${feature}`);
} else {
  console.log(`🚀 Running: tauri ${command}${isDebug ? ' --debug' : ''}${forwardedTauriArgs.length ? ' ' + forwardedTauriArgs.join(' ') : ''} (CPU-only mode)`);
}
console.log('');

// Execute the command
// Timestamp del arranque del build: el escaneo de artefactos del catch solo debe
// contar archivos escritos DESPUÉS de este instante. Antes miraba el filesystem
// sin filtro y artefactos VIEJOS de builds anteriores enmascaraban fallos reales
// de bundling como "éxito con warning" (exit 0 engañoso).
const buildStartTime = Date.now();
try {
  execSync(tauriCmd, { stdio: 'inherit', env });
} catch (err) {
  // For build command: check if the failure is only due to missing updater signing key
  // The actual compilation and bundling may have succeeded
  if (command === 'build') {
    // When --target is passed, bundles live in target/<triple>/<profile>/bundle
    const targetDir = tauriTarget
      ? path.resolve(__dirname, '..', '..', 'target', tauriTarget, isDebug ? 'debug' : 'release', 'bundle')
      : path.resolve(__dirname, '..', '..', 'target', isDebug ? 'debug' : 'release', 'bundle');

    // Solo cuentan artefactos frescos (escritos por ESTE build).
    const isFreshArtifact = (fullPath) => {
      try {
        return fs.statSync(fullPath).mtimeMs >= buildStartTime;
      } catch {
        return false;
      }
    };

    // Walk bundle dir for FINAL installer artifacts. Mere presence of intermediate
    // files (.app, rw.*.dmg) is not enough — earlier bug masked real bundling failures
    // (e.g. bundle_dmg.sh failure leaves a partial .app but no .dmg).
    const FINAL_ARTIFACT_EXTS = ['.dmg', '.msi', '.deb', '.AppImage', '.rpm'];
    const hasFinalArtifact = (() => {
      if (!fs.existsSync(targetDir)) return false;
      const stack = [targetDir];
      while (stack.length) {
        const dir = stack.pop();
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) stack.push(full);
          else if (FINAL_ARTIFACT_EXTS.some((ext) => entry.name.endsWith(ext)) && isFreshArtifact(full)) return true;
        }
      }
      return false;
    })();
    // For NSIS Windows builds, the installer is .exe — check that separately to avoid
    // matching unrelated .exe files
    const nsisDir = path.join(targetDir, 'nsis');
    const hasNsisInstaller = fs.existsSync(nsisDir) &&
      fs.readdirSync(nsisDir).some((f) => f.endsWith('-setup.exe') && isFreshArtifact(path.join(nsisDir, f)));

    if ((hasFinalArtifact || hasNsisInstaller) && !process.env.TAURI_SIGNING_PRIVATE_KEY) {
      console.log('');
      console.log('⚠️  Build completed but updater signing was skipped (TAURI_SIGNING_PRIVATE_KEY not set).');
      console.log('   This is expected for local development. CI/CD builds will sign properly.');
      console.log(`   Final installer artifact found in: ${targetDir}`);
      process.exit(0);
    }
  }
  process.exit(err.status || 1);
}
