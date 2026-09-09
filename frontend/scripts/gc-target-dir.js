#!/usr/bin/env node
// GC del directorio `target/` de Cargo: evita que el disco se llene de sesiones
// incrementales viejas (2026-09-09: 43.7 GB en ~40 carpetas `app_lib-*` + 5 GB de
// rlibs viejos; el build murió con `os error 112` con 0.8 GB libres).
//
// Por qué se acumula: Cargo crea UNA carpeta `target/<perfil>/incremental/<crate>-<hash>/`
// por combinación de perfil (dev/test/check), features (`onnx-directml`, `cuda`, …) y
// flags (RUSTFLAGS de `tauri dev`), y nunca borra las que dejan de usarse. Lo mismo con
// los artefactos hasheados de `deps/` (`app_lib-<hash>.rlib/.pdb/.exe`). `cargo clean -p`
// lo arregla, pero tira también la sesión CALIENTE (recompilación completa de app_lib,
// 2-3 min) y hay que acordarse de correrlo.
//
// Política (conservadora a propósito):
//   1. incremental/: se borra toda sesión `<crate>-<hash>` que lleve >STALE_DAYS sin
//      usarse (mtime más reciente de la carpeta y de sus hijos), EXCEPTO la más reciente
//      de cada crate (la caliente nunca se toca).
//   2. Si tras (1) el incremental de un perfil sigue por encima de MAX_INCREMENTAL_GB, se
//      borran las sesiones más viejas (misma excepción) hasta caber.
//   3. deps/: sólo artefactos hasheados de las crates de ESTE paquete (app_lib,
//      maity_desktop) con >STALE_DAYS, conservando el grupo más reciente por crate. Los
//      artefactos sin hash (`app_lib.lib`, `libapp_lib.rlib`, `*.pdb` "uplifted") y las
//      dependencias externas NO se tocan.
//   4. Espacio libre: <WARN_FREE_GB avisa; <FAIL_FREE_GB falla (exit 1) porque el build
//      moriría igual a mitad del link (app_lib.lib pesa 2.4 GB) con un error críptico.
//
// Sólo actúa sobre un `target/` real (exige el CACHEDIR.TAG que escribe Cargo) y nunca
// fuera de `<perfil>/incremental` y `<perfil>/deps`. No correrlo con un cargo en marcha.
//
// Uso: node scripts/gc-target-dir.js [--dry-run] [--report]
//   pnpm run target:gc / target:gc:dry
// Env: CARGO_TARGET_DIR, MAITY_TARGET_GC_STALE_DAYS (7), MAITY_TARGET_GC_MAX_INCREMENTAL_GB (12),
//      MAITY_TARGET_GC_SKIP=1 (no borra nada; sólo mide), MAITY_TARGET_GC_NO_FAIL=1 (no falla
//      por espacio libre).
// Corre como PRIMER paso de run-pre-build-checks.js y de `tauri:dev`.

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const TARGET = process.env.CARGO_TARGET_DIR
    ? path.resolve(process.env.CARGO_TARGET_DIR)
    : path.join(REPO_ROOT, 'target');

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes('--dry-run') || process.env.MAITY_TARGET_GC_SKIP === '1';
const REPORT = argv.includes('--report');

function envNum(name, fallback) {
    const v = Number(process.env[name]);
    return Number.isFinite(v) && v > 0 ? v : fallback;
}
const STALE_DAYS = envNum('MAITY_TARGET_GC_STALE_DAYS', 7);
const MAX_INCREMENTAL_GB = envNum('MAITY_TARGET_GC_MAX_INCREMENTAL_GB', 12);
const WARN_FREE_GB = 15;
const FAIL_FREE_GB = 5;
const PROFILES = ['debug', 'release'];
// Crates de ESTE paquete (lib + bin). Los artefactos hasheados de las dependencias
// no se tocan: los invalida cargo solo cuando cambia Cargo.lock.
const PACKAGE_CRATES = ['app_lib', 'maity_desktop'];

const GB = 1024 ** 3;
const NOW = Date.now();
const STALE_MS = STALE_DAYS * 24 * 3600 * 1000;
const fmtGB = (b) => (b / GB).toFixed(2) + ' GB';
const days = (ms) => ((NOW - ms) / 86400000).toFixed(1) + ' d';

function log(msg) { console.log(`[target-gc] ${msg}`); }
function warn(msg) { console.warn(`[target-gc] ⚠️  ${msg}`); }

/** Tamaño total y mtime más reciente de un árbol (sin seguir symlinks). */
function walk(dir) {
    let size = 0;
    let newest = 0;
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return { size, newest };
    }
    try {
        newest = fs.statSync(dir).mtimeMs;
    } catch { /* ignore */ }
    for (const e of entries) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
            const sub = walk(p);
            size += sub.size;
            if (sub.newest > newest) newest = sub.newest;
        } else if (e.isFile()) {
            try {
                const st = fs.statSync(p);
                size += st.size;
                if (st.mtimeMs > newest) newest = st.mtimeMs;
            } catch { /* ignore */ }
        }
    }
    return { size, newest };
}

/** Nombre de crate de `<crate>-<hash>` (el hash es el último segmento, sin guiones). */
function crateOf(dirName) {
    const i = dirName.lastIndexOf('-');
    return i > 0 ? dirName.slice(0, i) : dirName;
}

function remove(p, what) {
    if (DRY_RUN) {
        log(`  (dry-run) borraría ${what}: ${p}`);
        return true;
    }
    try {
        fs.rmSync(p, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
        return true;
    } catch (err) {
        warn(`no se pudo borrar ${p}: ${err.message}`);
        return false;
    }
}

// ---------------------------------------------------------------------------
// 0. Salvaguardas
// ---------------------------------------------------------------------------
if (!fs.existsSync(TARGET)) {
    log(`SKIP: no existe ${TARGET} (primer build)`);
    process.exit(0);
}
if (!fs.existsSync(path.join(TARGET, 'CACHEDIR.TAG'))) {
    warn(`${TARGET} no tiene CACHEDIR.TAG: no parece un target/ de Cargo, no se toca nada.`);
    process.exit(0);
}

let freedBytes = 0;
let removedCount = 0;

// ---------------------------------------------------------------------------
// 1 + 2. Sesiones incrementales por perfil
// ---------------------------------------------------------------------------
for (const profile of PROFILES) {
    const incDir = path.join(TARGET, profile, 'incremental');
    if (!fs.existsSync(incDir)) continue;

    const sessions = [];
    for (const e of fs.readdirSync(incDir, { withFileTypes: true })) {
        if (!e.isDirectory()) continue;
        const full = path.join(incDir, e.name);
        const { size, newest } = walk(full);
        sessions.push({ name: e.name, crate: crateOf(e.name), full, size, newest });
    }
    if (sessions.length === 0) continue;

    // La sesión más reciente de cada crate es la caliente: intocable.
    const hot = new Map();
    for (const s of sessions) {
        const cur = hot.get(s.crate);
        if (!cur || s.newest > cur.newest) hot.set(s.crate, s);
    }
    const isHot = (s) => hot.get(s.crate) === s;

    let total = sessions.reduce((a, s) => a + s.size, 0);
    if (REPORT) {
        log(`${profile}/incremental: ${sessions.length} sesiones, ${fmtGB(total)}`);
        for (const s of [...sessions].sort((a, b) => b.size - a.size)) {
            log(`  ${isHot(s) ? '🔥' : '  '} ${s.name.padEnd(40)} ${fmtGB(s.size).padStart(9)}  último uso hace ${days(s.newest)}`);
        }
    }

    // (1) stale
    for (const s of sessions) {
        if (isHot(s) || NOW - s.newest < STALE_MS) continue;
        log(`stale (${days(s.newest)} sin uso): ${profile}/incremental/${s.name} ${fmtGB(s.size)}`);
        if (remove(s.full, 'sesión incremental')) {
            freedBytes += s.size;
            removedCount++;
            total -= s.size;
            s.removed = true;
        }
    }

    // (2) tope de tamaño: las más viejas primero, nunca la caliente
    if (total > MAX_INCREMENTAL_GB * GB) {
        const candidates = sessions
            .filter((s) => !s.removed && !isHot(s))
            .sort((a, b) => a.newest - b.newest);
        for (const s of candidates) {
            if (total <= MAX_INCREMENTAL_GB * GB) break;
            log(`tope ${MAX_INCREMENTAL_GB} GB superado (${fmtGB(total)}): ${profile}/incremental/${s.name} ${fmtGB(s.size)} (último uso hace ${days(s.newest)})`);
            if (remove(s.full, 'sesión incremental')) {
                freedBytes += s.size;
                removedCount++;
                total -= s.size;
                s.removed = true;
            }
        }
        if (total > MAX_INCREMENTAL_GB * GB) {
            warn(`${profile}/incremental sigue en ${fmtGB(total)} sólo con sesiones calientes; si estorba: cargo clean -p maity-desktop`);
        }
    }
}

// ---------------------------------------------------------------------------
// 3. Artefactos hasheados viejos de las crates del paquete en deps/
// ---------------------------------------------------------------------------
const HASHED_RE = new RegExp(`^(lib)?(${PACKAGE_CRATES.join('|')})-([0-9a-f]{16})\\.(rlib|rmeta|exe|pdb|d|dll|lib|exp)$`);
for (const profile of PROFILES) {
    const depsDir = path.join(TARGET, profile, 'deps');
    if (!fs.existsSync(depsDir)) continue;

    // grupo = crate + hash; se borra entero o no se borra.
    const groups = new Map();
    for (const e of fs.readdirSync(depsDir, { withFileTypes: true })) {
        if (!e.isFile()) continue;
        const m = HASHED_RE.exec(e.name);
        if (!m) continue;
        const key = `${m[2]}-${m[3]}`;
        const full = path.join(depsDir, e.name);
        let st;
        try { st = fs.statSync(full); } catch { continue; }
        const g = groups.get(key) || { crate: m[2], files: [], size: 0, newest: 0 };
        g.files.push(full);
        g.size += st.size;
        if (st.mtimeMs > g.newest) g.newest = st.mtimeMs;
        groups.set(key, g);
    }
    if (groups.size === 0) continue;

    const hot = new Map();
    for (const [key, g] of groups) {
        const cur = hot.get(g.crate);
        if (!cur || g.newest > cur.g.newest) hot.set(g.crate, { key, g });
    }
    for (const [key, g] of groups) {
        if (hot.get(g.crate).key === key) continue;
        if (NOW - g.newest < STALE_MS) continue;
        log(`stale (${days(g.newest)} sin uso): ${profile}/deps/${key}.* (${g.files.length} archivos, ${fmtGB(g.size)})`);
        let ok = true;
        for (const f of g.files) ok = remove(f, 'artefacto') && ok;
        if (ok) {
            freedBytes += g.size;
            removedCount++;
        }
    }
}

// ---------------------------------------------------------------------------
// 4. Espacio libre
// ---------------------------------------------------------------------------
let freeBytes = null;
try {
    const st = fs.statfsSync(TARGET);
    freeBytes = Number(st.bavail) * Number(st.bsize);
} catch (err) {
    warn(`no se pudo medir el espacio libre: ${err.message}`);
}

const verb = DRY_RUN ? 'liberaría' : 'liberó';
log(`${verb} ${fmtGB(freedBytes)} en ${removedCount} elemento(s)` +
    (freeBytes !== null ? `; libre en el volumen de target/: ${fmtGB(freeBytes)}` : ''));

if (freeBytes !== null && process.env.MAITY_TARGET_GC_NO_FAIL !== '1') {
    if (freeBytes < FAIL_FREE_GB * GB) {
        console.error(`[target-gc] FAIL: sólo ${fmtGB(freeBytes)} libres (< ${FAIL_FREE_GB} GB).`);
        console.error('  Un build debug escribe ~6 GB (app_lib.lib 2.4 GB + rlib + pdbs) y un cargo test ~2 GB:');
        console.error('  moriría a mitad del link con "os error 112". Libera espacio o corre');
        console.error('  `cargo clean -p maity-desktop` (tira también la sesión caliente, +2-3 min al siguiente build).');
        console.error('  Diagnóstico: pnpm run target:gc:dry -- --report. Escape: MAITY_TARGET_GC_NO_FAIL=1');
        process.exit(1);
    }
    if (freeBytes < WARN_FREE_GB * GB) {
        warn(`quedan ${fmtGB(freeBytes)} libres (< ${WARN_FREE_GB} GB): un ciclo test + build consume ~10 GB.`);
    }
}
