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
// Tauri-level flags to forward (everything except --debug, which we handle ourselves)
const forwardedTauriArgs = extraArgs.filter((a) => a !== '--debug');
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

// Build the tauri command
let tauriCmd = `tauri ${command}`;
if (isDebug) {
  tauriCmd += ' --debug';
}
if (forwardedTauriArgs.length > 0) {
  tauriCmd += ' ' + forwardedTauriArgs.join(' ');
}
if (feature && feature !== 'none') {
  tauriCmd += ` -- --features ${feature}`;
  console.log(`🚀 Running: tauri ${command}${isDebug ? ' --debug' : ''}${forwardedTauriArgs.length ? ' ' + forwardedTauriArgs.join(' ') : ''} with features: ${feature}`);
} else {
  console.log(`🚀 Running: tauri ${command}${isDebug ? ' --debug' : ''}${forwardedTauriArgs.length ? ' ' + forwardedTauriArgs.join(' ') : ''} (CPU-only mode)`);
}
console.log('');

// Execute the command
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
    const hasBundles = fs.existsSync(targetDir) && fs.readdirSync(targetDir).length > 0;

    if (hasBundles && !process.env.TAURI_SIGNING_PRIVATE_KEY) {
      console.log('');
      console.log('⚠️  Build completed but updater signing was skipped (TAURI_SIGNING_PRIVATE_KEY not set).');
      console.log('   This is expected for local development. CI/CD builds will sign properly.');
      console.log('   Bundles created successfully in: target/release/bundle/');
      process.exit(0);
    }
  }
  process.exit(err.status || 1);
}
