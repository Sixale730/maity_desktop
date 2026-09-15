#!/usr/bin/env node
// Lint de imports de los binarios embarcados en Windows. Dos garantías:
//
// 1. DirectML delay-load (#33 de la auditoría de recursos,
//    docs/AUDITORIA_RECURSOS_2026-09-02.md, docs/ONNX_EXECUTION_PROVIDERS.md):
//    `maity-desktop.exe` NO debe importar en tiempo de carga
//    directml.dll / d3d12.dll / dxcore.dll / dxgi.dll. Esos cuatro los arrastra el
//    provider DirectML que viene compilado dentro del prebuilt estático de ONNX
//    Runtime (pyke, `onnxruntime.lib`), aunque ningún motor lo registre — el
//    default corre en CPU. `build.rs` los pasa a /DELAYLOAD, así que solo deben
//    aparecer en la tabla de DELAY imports (se cargan al primer uso, que en el
//    build por defecto nunca llega). Si vuelven a la tabla normal — porque alguien
//    quitó el /DELAYLOAD, subió `ort` a un prebuilt que los referencia desde otro
//    sitio, o entró un crate nuevo que los usa de carga — el build falla aquí.
//
// 2. Cierre del VC++ Runtime (docs/CANALES_DISTRIBUCION.md § VC++ Runtime
//    app-local): TODO DLL del runtime de MSVC (msvcp*/vcruntime*/vcomp*/concrt*/
//    vccorlib*) que importe `maity-desktop.exe` O el sidecar `llama-helper.exe`
//    (carga o delay-load) tiene que existir en `src-tauri/vcredist/`, que es lo
//    que stage-vcredist.js embarca junto al exe. El conjunto embarcado se lee del
//    directorio REAL, no de una lista duplicada. Por qué: en dev y en CI el VC++
//    Redist completo siempre está instalado en System32, así que un import nuevo
//    resuelve y nadie lo ve; en un Windows limpio revienta con el diálogo
//    "no se encontró X.DLL". Así se embarcó `vcomp140.dll` (OpenMP, feature por
//    defecto de llama-cpp-2) en el helper durante meses hasta que un usuario sin
//    Redist lo reportó (sep-2026, v0.2.52). El fix correcto es quitar la
//    dependencia (feature de Cargo); el alternativo es sumar el DLL a
//    stage-vcredist.js y al staging MSIX. Nunca ignorar el FAIL.
//
// Parser PE mínimo en Node puro (sin dumpbin, cuya ruta cambia con cada
// versión del toolset de VS): DOS header → PE → data directories [1] (imports)
// y [13] (delay imports) → tabla de secciones para RVA→offset → nombre de DLL.
//
// Uso: node scripts/lint-exe-imports.js [--exe <ruta>] [--report]
//   sin --exe  revisa target/debug/maity-desktop.exe (garantías 1 y 2) Y el
//              helper bundleado en src-tauri/binaries/ (garantía 2; obligatorio).
//   --exe      revisa SOLO ese binario (garantía 1 si es el exe principal;
//              garantía 2 siempre). Sirve para el release o el helper suelto.
//   --report   imprime todas las tablas sin fallar (diagnóstico).
// Corre en run-post-build-checks.js (solo win32) y al final de
// tauri:build:store. Escape hatch: pnpm run tauri:build:debug:skip-checks

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_EXE = path.join(REPO_ROOT, 'target', 'debug', 'maity-desktop.exe');
const HELPER_EXE = path.join(
    REPO_ROOT, 'frontend', 'src-tauri', 'binaries', 'llama-helper-x86_64-pc-windows-msvc.exe'
);
const VCREDIST_DIR = path.join(REPO_ROOT, 'frontend', 'src-tauri', 'vcredist');

// DLLs que solo pueden ser delay-load (comparación case-insensitive).
const FORBIDDEN_LOAD_TIME = ['directml.dll', 'd3d12.dll', 'dxcore.dll', 'dxgi.dll'];

// Imports que pertenecen al VC++ Runtime redistribuible (NO a la UCRT, que es
// parte de Windows 10+: api-ms-win-crt-*.dll / ucrtbase.dll no cuentan).
const CRT_DLL = /^(msvcp|vcruntime|vcomp|concrt|vccorlib)\d.*\.dll$/i;

const argv = process.argv.slice(2);
const REPORT_MODE = argv.includes('--report');
const exeIdx = argv.indexOf('--exe');
const exePath = exeIdx >= 0 ? path.resolve(argv[exeIdx + 1]) : DEFAULT_EXE;

function readCString(buf, offset) {
    let end = offset;
    while (end < buf.length && buf[end] !== 0) end++;
    return buf.toString('latin1', offset, end);
}

/**
 * Devuelve { loadTime: string[], delayLoad: string[] } con los nombres de DLL
 * de ambas tablas de imports de un PE32/PE32+.
 */
function parseImports(buf) {
    if (buf.length < 0x40 || buf.readUInt16LE(0) !== 0x5a4d) {
        throw new Error('no es un ejecutable PE (falta la firma MZ)');
    }
    const peOff = buf.readUInt32LE(0x3c);
    if (buf.toString('ascii', peOff, peOff + 4) !== 'PE\0\0') {
        throw new Error('firma PE no encontrada');
    }
    const coff = peOff + 4;
    const numSections = buf.readUInt16LE(coff + 2);
    const sizeOptional = buf.readUInt16LE(coff + 16);
    const opt = coff + 20;
    const magic = buf.readUInt16LE(opt);
    let dataDirOff;
    let imageBase;
    if (magic === 0x20b) {
        // PE32+
        imageBase = buf.readBigUInt64LE(opt + 24);
        dataDirOff = opt + 112;
    } else if (magic === 0x10b) {
        imageBase = BigInt(buf.readUInt32LE(opt + 28));
        dataDirOff = opt + 96;
    } else {
        throw new Error(`magic de optional header desconocido: 0x${magic.toString(16)}`);
    }
    const numDirs = buf.readUInt32LE(magic === 0x20b ? opt + 108 : opt + 92);

    const sections = [];
    const secTable = opt + sizeOptional;
    for (let i = 0; i < numSections; i++) {
        const s = secTable + i * 40;
        const virtualSize = buf.readUInt32LE(s + 8);
        const virtualAddress = buf.readUInt32LE(s + 12);
        const sizeOfRawData = buf.readUInt32LE(s + 16);
        const pointerToRawData = buf.readUInt32LE(s + 20);
        sections.push({ virtualAddress, size: Math.max(virtualSize, sizeOfRawData), pointerToRawData });
    }
    const rvaToOffset = (rva) => {
        for (const sec of sections) {
            if (rva >= sec.virtualAddress && rva < sec.virtualAddress + sec.size) {
                return rva - sec.virtualAddress + sec.pointerToRawData;
            }
        }
        throw new Error(`RVA 0x${rva.toString(16)} fuera de toda sección`);
    };
    const dir = (index) => {
        if (index >= numDirs) return { rva: 0, size: 0 };
        return { rva: buf.readUInt32LE(dataDirOff + index * 8), size: buf.readUInt32LE(dataDirOff + index * 8 + 4) };
    };

    // [1] IMAGE_DIRECTORY_ENTRY_IMPORT: descriptores de 20 bytes, terminados en ceros.
    const loadTime = [];
    const imp = dir(1);
    if (imp.rva !== 0) {
        let d = rvaToOffset(imp.rva);
        for (;;) {
            const nameRva = buf.readUInt32LE(d + 12);
            const firstThunk = buf.readUInt32LE(d + 16);
            if (nameRva === 0 && firstThunk === 0) break;
            if (nameRva !== 0) loadTime.push(readCString(buf, rvaToOffset(nameRva)));
            d += 20;
        }
    }

    // [13] IMAGE_DIRECTORY_ENTRY_DELAY_IMPORT: descriptores de 32 bytes, terminados
    // en DllNameRVA == 0. Con Attributes bit0 == 0 (formato viejo) los campos son
    // VAs, no RVAs: se les resta ImageBase.
    const delayLoad = [];
    const del = dir(13);
    if (del.rva !== 0) {
        let d = rvaToOffset(del.rva);
        for (;;) {
            const attrs = buf.readUInt32LE(d);
            let nameRva = buf.readUInt32LE(d + 4);
            if (nameRva === 0) break;
            if ((attrs & 1) === 0) nameRva = Number(BigInt(nameRva) - imageBase);
            delayLoad.push(readCString(buf, rvaToOffset(nameRva)));
            d += 32;
        }
    }

    return { loadTime, delayLoad };
}

if (process.platform !== 'win32' && !REPORT_MODE && exeIdx < 0) {
    console.log(`[lint-exe-imports] SKIP: solo aplica a Windows (${process.platform})`);
    process.exit(0);
}

// Conjunto embarcado: lo que stage-vcredist.js dejó en src-tauri/vcredist/.
// Se lee del disco para que la fuente de verdad sea lo que se empaqueta.
function shippedCrtDlls() {
    if (!fs.existsSync(VCREDIST_DIR)) return null;
    const dlls = fs
        .readdirSync(VCREDIST_DIR)
        .filter((f) => f.toLowerCase().endsWith('.dll') && fs.statSync(path.join(VCREDIST_DIR, f)).size > 0)
        .map((f) => f.toLowerCase());
    return dlls.length > 0 ? dlls : null;
}

const shipped = shippedCrtDlls();
if (!shipped) {
    console.error(`[lint-exe-imports] FAIL: ${VCREDIST_DIR} no existe o no tiene DLLs.`);
    console.error('  Sin él no se puede verificar el cierre del VC++ Runtime (garantía 2).');
    console.error('  Corre: node scripts/stage-vcredist.js (lo hace run-pre-build-checks.js).');
    process.exit(1);
}

// Sin --exe: exe principal debug + helper bundleado (externalBin, obligatorio).
// Con --exe: solo ese binario.
const targets = exeIdx >= 0
    ? [{ file: exePath, main: true }]
    : [{ file: DEFAULT_EXE, main: true }, { file: HELPER_EXE, main: false, required: true }];

const lower = (arr) => arr.map((n) => n.toLowerCase());
let failed = false;

for (const target of targets) {
    const name = path.basename(target.file);

    if (!fs.existsSync(target.file)) {
        if (target.required) {
            console.error(`[lint-exe-imports] FAIL: falta el sidecar bundleado ${target.file}`);
            console.error('  Es externalBin de Tauri: sin él el paquete no se arma. Regenerar con');
            console.error('  node scripts/verify-helper-binary.js --fix');
            failed = true;
            continue;
        }
        console.error(`[lint-exe-imports] no existe el exe: ${target.file}`);
        process.exit(2);
    }

    let tables;
    try {
        tables = parseImports(fs.readFileSync(target.file));
    } catch (err) {
        console.error(`[lint-exe-imports] no se pudo leer la tabla de imports de ${target.file}: ${err.message}`);
        process.exit(2);
    }

    const loadTime = lower(tables.loadTime);
    const delayLoad = lower(tables.delayLoad);
    const crtImports = [...new Set([...loadTime, ...delayLoad].filter((dll) => CRT_DLL.test(dll)))].sort();
    const missing = crtImports.filter((dll) => !shipped.includes(dll));

    if (REPORT_MODE) {
        console.log(`[lint-exe-imports] ${target.file}`);
        console.log(`  imports de carga (${loadTime.length}): ${loadTime.join(', ')}`);
        console.log(`  delay-load (${delayLoad.length}): ${delayLoad.join(', ') || '(ninguno)'}`);
        console.log(`  cierre CRT: ${crtImports.join(', ') || '(ninguno)'}`);
        console.log(`  embarcado en vcredist/: ${shipped.join(', ')}`);
        console.log(`  faltantes: ${missing.join(', ') || '(ninguno)'}`);
    }

    // Garantía 1 (solo exe principal): DirectML y cía. nunca de carga.
    if (target.main) {
        const violations = FORBIDDEN_LOAD_TIME.filter((dll) => loadTime.includes(dll));
        const delayed = FORBIDDEN_LOAD_TIME.filter((dll) => delayLoad.includes(dll));
        if (violations.length > 0) {
            console.error(`[lint-exe-imports] FAIL: ${name} importa en tiempo de CARGA: ${violations.join(', ')}`);
            console.error('  Deben ir por /DELAYLOAD (frontend/src-tauri/build.rs, configure_windows_delay_load).');
            console.error('  Si un crate nuevo los trae de carga, es él quien tiene que justificarlo: hoy el STT');
            console.error('  por defecto corre en CPU y nadie necesita D3D12/DirectML mapeados al arrancar.');
            console.error('  Contexto: docs/ONNX_EXECUTION_PROVIDERS.md y #33 de docs/AUDITORIA_RECURSOS_2026-09-02.md.');
            console.error('  Diagnóstico: node scripts/lint-exe-imports.js --report');
            failed = true;
        } else {
            console.log(
                `[lint-exe-imports] OK ${name}: sin imports de carga de ${FORBIDDEN_LOAD_TIME.join('/')} ` +
                `(delay-load: ${delayed.length ? delayed.join(', ') : 'ninguno'}; ${loadTime.length} DLLs de carga)`
            );
        }
    }

    // Garantía 2 (todos): cada DLL del VC++ Runtime que importe viaja en el paquete.
    if (missing.length > 0) {
        console.error(`[lint-exe-imports] FAIL: ${name} importa DLLs del VC++ Runtime que NO se embarcan: ${missing.join(', ')}`);
        console.error(`  Embarcados (src-tauri/vcredist/): ${shipped.join(', ')}`);
        console.error('  En dev/CI no se nota porque el VC++ Redist completo está en System32; en un Windows');
        console.error('  limpio el binario no arranca ("no se encontró X.DLL"). Opciones, en este orden:');
        console.error('    1. Quitar la dependencia (feature de Cargo). Ej.: vcomp140.dll = OpenMP, que');
        console.error('       llama-cpp-2 activa por defecto → `default-features = false` en llama-helper/Cargo.toml.');
        console.error('    2. Si es imprescindible, sumar el DLL a DLLS en scripts/stage-vcredist.js Y al');
        console.error('       staging MSIX (.claude/skills/store-msix/SKILL.md § Stagear el payload).');
        console.error('  Contexto: docs/CANALES_DISTRIBUCION.md § VC++ Runtime app-local.');
        failed = true;
    } else {
        console.log(`[lint-exe-imports] OK ${name}: cierre CRT embarcado (${crtImports.join(', ') || 'sin imports CRT'})`);
    }
}

if (failed) process.exit(1);
