#!/usr/bin/env node
// Copia el Visual C++ Runtime redistribuible a src-tauri/vcredist/ para que
// viaje DENTRO del paquete, junto al .exe (app-local deployment).
//
// Por que: el binario es Rust, pero enlaza C++ compilado con /MD (whisper.cpp,
// ONNX Runtime, y el sidecar llama-helper) => depende de MSVCP140.dll y cia.
// En una maquina de desarrollo ese runtime SIEMPRE esta instalado (lo meten
// VS, Office, Steam, juegos...), por eso el bug era invisible. En un Windows
// recien formateado la app ni arranca:
//   "The code execution cannot proceed because MSVCP140.dll was not found"
// Eso hizo que la Microsoft Store devolviera el reporte de certificacion
// 2026-07-17 con la politica 10.2.4.1 (Software Dependencies, "Undisclosed
// software: C++"), y afecta igual al .exe NSIS de GitHub Releases.
//
// Cierre de dependencias (verificado sobre los binarios con dumpbin/grep):
//   maity-desktop.exe -> MSVCP140.dll, MSVCP140_1.dll
//   llama-helper.exe  -> MSVCP140.dll, VCRUNTIME140.dll, VCRUNTIME140_1.dll
//   msvcp140.dll      -> VCRUNTIME140.dll, VCRUNTIME140_1.dll
//   msvcp140_1.dll    -> MSVCP140.dll, VCRUNTIME140.dll
// Las api-ms-win-crt-*.dll son la UCRT: parte de Windows 10+ (el manifest MSIX
// exige MinVersion 10.0.18362) => NO se embarcan.
//
// Se copian del VC Redist del VS Build Tools que compila el binario, NO de una
// copia commiteada: asi la version del DLL siempre coincide con el toolset. Un
// msvcp140.dll viejo junto a un binario compilado con un toolset mas nuevo
// puede quedarse sin un export => mismo crash que intentamos evitar.
//
// Corre en run-pre-build-checks.js (debug + release) y en tauri:build:store.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const DEST_DIR = path.join(__dirname, '..', 'src-tauri', 'vcredist');

// Solo el cierre de imports. NO agregar concrt140/msvcp140_2/vccorlib140/
// vcomp140 "por si acaso": es peso y superficie de escaneo en la Store sin
// razon. Si un dia un binario nuevo los importa, verificarlo y sumarlos aqui.
const DLLS = [
    'msvcp140.dll',
    'msvcp140_1.dll',
    'vcruntime140.dll',
    'vcruntime140_1.dll',
];

if (process.platform !== 'win32') {
    console.log(`[vcredist] SKIP: solo aplica en Windows (plataforma actual: ${process.platform})`);
    process.exit(0);
}

/** Compara versiones tipo "14.44.35112" numericamente (14.44 > 14.9). */
function compareVersions(a, b) {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const da = pa[i] || 0;
        const db = pb[i] || 0;
        if (da !== db) return da - db;
    }
    return 0;
}

/**
 * Dado un `<vsInstall>\VC\Redist\MSVC`, devuelve el `Microsoft.VC1XX.CRT` de la
 * version mas alta, o null.
 */
function crtDirFromRedistRoot(redistRoot) {
    if (!fs.existsSync(redistRoot)) return null;

    const versions = fs
        .readdirSync(redistRoot)
        .filter((d) => /^\d+\.\d+/.test(d))
        .sort(compareVersions)
        .reverse();

    for (const version of versions) {
        const x64 = path.join(redistRoot, version, 'x64');
        if (!fs.existsSync(x64)) continue;
        const crt = fs
            .readdirSync(x64)
            .filter((d) => /^Microsoft\.VC\d+\.CRT$/i.test(d))
            .sort()
            .reverse()[0];
        if (crt) return path.join(x64, crt);
    }
    return null;
}

/** Localiza el directorio Microsoft.VCxxx.CRT del redist x64. */
function findCrtDir() {
    // 1. Developer Prompt: VCToolsRedistDir apunta a <install>\VC\Redist\MSVC\<version>\
    const fromEnv = process.env.VCToolsRedistDir;
    if (fromEnv) {
        const x64 = path.join(fromEnv, 'x64');
        if (fs.existsSync(x64)) {
            const crt = fs
                .readdirSync(x64)
                .filter((d) => /^Microsoft\.VC\d+\.CRT$/i.test(d))
                .sort()
                .reverse()[0];
            if (crt) return path.join(x64, crt);
        }
    }

    // 2. vswhere: es la via soportada por Microsoft y funciona en runners de CI.
    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const vswhere = path.join(programFilesX86, 'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
    if (fs.existsSync(vswhere)) {
        try {
            const installs = execFileSync(
                vswhere,
                ['-products', '*', '-property', 'installationPath', '-nologo'],
                { encoding: 'utf8' }
            )
                .split(/\r?\n/)
                .map((l) => l.trim())
                .filter(Boolean);

            const candidates = installs
                .map((install) => crtDirFromRedistRoot(path.join(install, 'VC', 'Redist', 'MSVC')))
                .filter(Boolean);

            if (candidates.length > 0) {
                // Preferir el toolset mas nuevo entre todas las instalaciones.
                candidates.sort((a, b) => compareVersions(versionOfCrtDir(a), versionOfCrtDir(b)));
                return candidates[candidates.length - 1];
            }
        } catch (err) {
            console.warn(`[vcredist] vswhere fallo (${err.message}), probando rutas por defecto...`);
        }
    }

    // 3. Fallback: rutas conocidas de VS 2022 (Community/Professional/Enterprise/BuildTools).
    const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
    for (const root of [programFilesX86, programFiles]) {
        const vs2022 = path.join(root, 'Microsoft Visual Studio', '2022');
        if (!fs.existsSync(vs2022)) continue;
        for (const edition of fs.readdirSync(vs2022)) {
            const crt = crtDirFromRedistRoot(path.join(vs2022, edition, 'VC', 'Redist', 'MSVC'));
            if (crt) return crt;
        }
    }

    return null;
}

/** "...\VC\Redist\MSVC\14.44.35112\x64\Microsoft.VC143.CRT" -> "14.44.35112" */
function versionOfCrtDir(crtDir) {
    const parts = crtDir.split(path.sep);
    return parts[parts.length - 3] || '0';
}

const crtDir = findCrtDir();

if (!crtDir) {
    console.error('');
    console.error('[vcredist] FAIL: no se encontro el Visual C++ Redistributable del VS Build Tools.');
    console.error('  Se busco en VCToolsRedistDir, vswhere y las rutas por defecto de VS 2022.');
    console.error('  Instala el workload "Desktop development with C++" (Visual Studio Build');
    console.error('  Tools 2022) — es el mismo que ya necesitas para compilar whisper-rs.');
    console.error('  Sin estos DLLs el paquete crashea en Windows limpios (cert Store 10.2.4.1).');
    process.exit(1);
}

console.log(`[vcredist] Redist encontrado: ${crtDir}`);

fs.mkdirSync(DEST_DIR, { recursive: true });

let copied = 0;
let skipped = 0;

for (const dll of DLLS) {
    const src = path.join(crtDir, dll);
    const dest = path.join(DEST_DIR, dll);

    if (!fs.existsSync(src)) {
        console.error('');
        console.error(`[vcredist] FAIL: falta ${dll} en ${crtDir}`);
        console.error('  La instalacion del redist parece incompleta; reinstala el workload');
        console.error('  "Desktop development with C++".');
        process.exit(1);
    }

    const srcStat = fs.statSync(src);

    // Idempotente: no recopiar si ya esta al dia (mismo tamano y no mas viejo).
    if (fs.existsSync(dest)) {
        const destStat = fs.statSync(dest);
        if (destStat.size === srcStat.size && destStat.mtimeMs >= srcStat.mtimeMs) {
            skipped++;
            continue;
        }
    }

    fs.copyFileSync(src, dest);
    copied++;
}

// Verificacion final: los 4 tienen que existir y no estar vacios (un stub de 0
// bytes falla igual de feo que la ausencia, y en runtime).
for (const dll of DLLS) {
    const dest = path.join(DEST_DIR, dll);
    if (!fs.existsSync(dest) || fs.statSync(dest).size === 0) {
        console.error('');
        console.error(`[vcredist] FAIL: ${dest} no existe o esta vacio despues de copiar.`);
        process.exit(1);
    }
}

console.log(
    `[vcredist] OK: ${DLLS.length} DLLs en src-tauri/vcredist/ (${copied} copiados, ${skipped} ya al dia)`
);
