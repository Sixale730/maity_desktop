#!/usr/bin/env node
// Deja el `ffmpeg.exe` LGPL PINEADO que Tauri bundlea como externalBin en Windows:
//   frontend/src-tauri/binaries/ffmpeg-x86_64-pc-windows-msvc.exe
//   frontend/src-tauri/binaries/ffmpeg-LICENSE.txt      (COPYING.LGPLv3 del zip)
//   frontend/src-tauri/binaries/ffmpeg-windows.stamp    (url + sha del zip + sha del exe)
//   msix_staging/ffmpeg.exe + ffmpeg-LICENSE.txt        (si el dir existe; en AMBOS caminos)
//
// Por que existe (#32): sin esto `audio/ffmpeg.rs` DESCARGA ffmpeg en runtime desde
// gyan.dev (ffmpeg-release-essentials.zip, 106 MB, GPLv3) al primer checkpoint de 30 s
// de una grabacion — dentro del spawn_blocking que retiene el UNICO permiso del
// semaforo de IncrementalAudioSaver, con el checkpoint_buffer creciendo sin tope y un
// timeout de 300 s en finalize(). Ademas desempaqueta en el directorio del ejecutable
// (Program Files / contenedor MSIX: solo lectura) y deja ffprobe.exe + ffplay.exe que
// el codigo no ejecuta nunca (cero referencias a ffprobe en src-tauri/src).
//
// Por que un PREBUILT y no la receta de build-ffmpeg-macos.sh: compilar FFmpeg 8.x en
// Windows exige MSYS2 + make + un gcc moderno, que esta maquina NO tiene (verificado:
// gcc 6.3.0 de MinGW.org 2016, sin make, sin nasm, sin msys64) y que build.yml /
// build-windows.yml tampoco instalan. BtbN/FFmpeg-Builds publica builds win64-lgpl
// reproducibles y con digest SHA-256 en la API de releases.
//
// OJO con la licencia: los builds `lgpl` de BtbN pasan `--enable-version3` (ver
// variants/defaults-lgpl.sh) => el binario es LGPL **v3** y el LICENSE.txt del zip es
// COPYING.LGPLv3. NO pasan `--disable-gpl`, asi que ese flag NUNCA aparece en
// `ffmpeg -version`: el discriminante real frente al build GPL es la AUSENCIA de
// `--enable-gpl` (defaults-gpl.sh = "--enable-gpl --enable-version3 --disable-debug").
//
// A diferencia de verify-helper-binary.js, este script NO se salta en CI: en CI es
// quien produce el binario.
//
// Modos:
//   node scripts/stage-ffmpeg-windows.js           # asegura (descarga si hace falta)
//   node scripts/stage-ffmpeg-windows.js --fix     # idem (alias explicito)
//   node scripts/stage-ffmpeg-windows.js --force   # re-descarga aunque el stamp coincida
//   node scripts/stage-ffmpeg-windows.js --check   # solo verifica; exit 1 si falta/no cuadra
//   node scripts/stage-ffmpeg-windows.js --report  # imprime hashes y sale
//   FFMPEG_WORK_DIR=... node scripts/stage-ffmpeg-windows.js   # cache del zip (CI)
//
// Lo invocan run-pre-build-checks.js (rama win32), tauri:dev, tauri:build:store,
// build.yml y build-windows.yml.

const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const path = require('path');
const { spawnSync } = require('child_process');

// ------------------------------------------------------------------ pin
// Tag de autobuild FIJO (nunca `latest`: ese es un tag rodante que GitHub reescribe
// cada dia, y con el el SHA-256 dejaria de coincidir sin que nadie cambiara nada).
// Datos leidos de https://api.github.com/repos/BtbN/FFmpeg-Builds/releases/tags/<tag>.
// Serie n8.1 = la misma que compila macOS (build-ffmpeg-macos.sh: FFMPEG_VERSION=8.1.2).
const FFMPEG_TAG = 'autobuild-2026-09-04-14-01';
const FFMPEG_ASSET = 'ffmpeg-n8.1.2-50-g1a748fe2cd-win64-lgpl-8.1.zip';
const FFMPEG_URL = `https://github.com/BtbN/FFmpeg-Builds/releases/download/${FFMPEG_TAG}/${FFMPEG_ASSET}`;
const FFMPEG_ZIP_SHA256 = 'aaea14506158ce84049a35139512e75a1628dd7641813c273d0b9f4bdb2f8b72';
const FFMPEG_ZIP_BYTES = 146078607;

// El zip de BtbN se descomprime en una carpeta con el mismo nombre que el asset
// (build.sh: BUILD_NAME + `zip -9 -r`), con bin/, doc/, presets/ y LICENSE.txt.
const ZIP_ROOT = FFMPEG_ASSET.replace(/\.zip$/, '');
const ZIP_ENTRY_EXE = `${ZIP_ROOT}/bin/ffmpeg.exe`;
const ZIP_ENTRY_LICENSE = `${ZIP_ROOT}/LICENSE.txt`;
// "ffmpeg-n8.1.2-50-g1a748fe2cd-win64-lgpl-8.1" -> "n8.1.2-50-g1a748fe2cd"
const VERSION_TOKEN = ZIP_ROOT.replace(/^ffmpeg-/, '').replace(/-win64-lgpl-8\.1$/, '');

const TARGET_TRIPLE = 'x86_64-pc-windows-msvc';
const MIN_EXE_BYTES = 20 * 1024 * 1024; // anti-stub: el build estatico ronda los 100 MB
const MAX_EXE_BYTES = 400 * 1024 * 1024;

// ------------------------------------------------------------------ rutas
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const BINARIES_DIR = path.join(REPO_ROOT, 'frontend', 'src-tauri', 'binaries');
const MSIX_STAGING = path.join(REPO_ROOT, 'msix_staging');
const BUNDLED = path.join(BINARIES_DIR, `ffmpeg-${TARGET_TRIPLE}.exe`);
const LICENSE_OUT = path.join(BINARIES_DIR, 'ffmpeg-LICENSE.txt');
const STAMP = path.join(BINARIES_DIR, 'ffmpeg-windows.stamp');
const STAGED = path.join(MSIX_STAGING, 'ffmpeg.exe');
const STAGED_LICENSE = path.join(MSIX_STAGING, 'ffmpeg-LICENSE.txt');
// Espejo de build-ffmpeg-macos.sh:109-117 — el dir de trabajo se puede sacar de
// target/ para que la cache de CI no muera con swatinem/rust-cache.
const WORK = process.env.FFMPEG_WORK_DIR || path.join(REPO_ROOT, 'target', 'ffmpeg-windows');
const ZIP_PATH = path.join(WORK, FFMPEG_ASSET);
const EXTRACT_DIR = path.join(WORK, 'extract');
const TAR = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');

const args = new Set(process.argv.slice(2));
const CHECK = args.has('--check');
const FORCE = args.has('--force');
const REPORT = args.has('--report');

// ------------------------------------------------------------------ helpers
function log(msg) { console.log(`[ffmpeg-win] ${msg}`); }

function fail(lines) {
    console.error('');
    console.error('[ffmpeg-win] FAIL:');
    for (const l of lines) console.error(`  ${l}`);
    process.exit(1);
}

function sha256(file) {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

if (process.platform !== 'win32') {
    log(`SKIP: solo aplica en Windows (plataforma actual: ${process.platform})`);
    process.exit(0);
}

function readStamp() {
    try { return JSON.parse(fs.readFileSync(STAMP, 'utf8')); } catch (_) { return null; }
}

/** Idempotencia: stamp con la MISMA url+sha del zip y un exe cuyo sha coincide. */
function isCurrent() {
    const s = readStamp();
    if (!s || s.url !== FFMPEG_URL || s.zipSha256 !== FFMPEG_ZIP_SHA256) return false;
    if (!fs.existsSync(BUNDLED)) return false;
    const size = fs.statSync(BUNDLED).size;
    if (size < MIN_EXE_BYTES || size > MAX_EXE_BYTES) return false;
    if (!fs.existsSync(LICENSE_OUT) || fs.statSync(LICENSE_OUT).size === 0) return false;
    return sha256(BUNDLED) === s.exeSha256;
}

function runFfmpeg(exe, ffArgs) {
    const r = spawnSync(exe, ffArgs, { encoding: 'utf8', shell: false, maxBuffer: 32 * 1024 * 1024 });
    if (r.error) fail([`no se pudo ejecutar ${exe}: ${r.error.message}`]);
    if (r.status !== 0) fail([`\`${path.basename(exe)} ${ffArgs.join(' ')}\` salio con codigo ${r.status}`]);
    return `${r.stdout || ''}${r.stderr || ''}`;
}

/**
 * Verificaciones de licencia y capacidades sobre el binario ya extraido.
 * Espejo de build-ffmpeg-macos.sh:189-204, ajustado a lo que BtbN SI imprime.
 * `deep` (solo tras una extraccion fresca) anade encoders/demuxers/muxers.
 */
function assertLgplBuild(exe, deep) {
    const out = runFfmpeg(exe, ['-hide_banner', '-version']);
    const head = out.split(/\r?\n/)[0];

    if (!out.includes(`ffmpeg version ${VERSION_TOKEN}`)) {
        fail([
            `version inesperada: ${head}`,
            `esperada: ffmpeg version ${VERSION_TOKEN} (del pin ${FFMPEG_TAG})`,
        ]);
    }
    // NO se puede exigir `--disable-gpl`: BtbN no lo pasa a configure (variants/
    // defaults-lgpl.sh = "--enable-version3 --disable-debug"). El discriminante es
    // la AUSENCIA de --enable-gpl, que es lo unico que anade defaults-gpl.sh.
    if (out.includes('--enable-gpl')) {
        fail([
            'el binario reporta --enable-gpl: es el build GPL, no el LGPL.',
            'Un ffmpeg GPL no es distribuible con los terminos de la Store y contradice',
            'el aviso de Ajustes -> Acerca de y docs/THIRD-PARTY-NOTICES.md.',
            head,
        ]);
    }
    if (out.includes('--enable-nonfree')) {
        fail(['el binario reporta --enable-nonfree: no es redistribuible.', head]);
    }
    if (!out.includes('--enable-version3')) {
        fail([
            'el binario no reporta --enable-version3; los builds lgpl de BtbN si lo llevan.',
            '¿Se cambio el asset del pin sin actualizar esta verificacion?',
            head,
        ]);
    }

    if (deep) {
        const encoders = runFfmpeg(exe, ['-hide_banner', '-encoders']);
        if (!encoders.includes(' aac ')) fail(['falta el encoder aac (encode.rs lo exige)']);
        const demuxers = runFfmpeg(exe, ['-hide_banner', '-demuxers']);
        if (!demuxers.includes(' concat ')) fail(['falta el demuxer concat (merge_checkpoints)']);
        const muxers = runFfmpeg(exe, ['-hide_banner', '-muxers']);
        if (!muxers.includes(' mp4 ')) fail(['falta el muxer mp4']);
    }

    return head;
}

function download(url, dest, redirectsLeft = 6) {
    return new Promise((resolve, reject) => {
        if (!url.startsWith('https://')) return reject(new Error(`URL no https: ${url}`));
        const req = https.get(url, { headers: { 'User-Agent': 'maity-stage-ffmpeg' } }, (res) => {
            const { statusCode, headers } = res;
            // GitHub redirige a objects.githubusercontent.com con 302.
            if (statusCode >= 300 && statusCode < 400 && headers.location) {
                res.resume();
                if (redirectsLeft === 0) return reject(new Error('demasiados redirects'));
                const next = new URL(headers.location, url).toString();
                return resolve(download(next, dest, redirectsLeft - 1));
            }
            if (statusCode !== 200) {
                res.resume();
                return reject(new Error(`HTTP ${statusCode} al bajar ${url}`));
            }
            const total = Number(headers['content-length'] || 0);
            let seen = 0;
            let lastPct = -1;
            const out = fs.createWriteStream(dest);
            res.on('data', (c) => {
                seen += c.length;
                if (!total) return;
                const pct = Math.floor((seen / total) * 10) * 10;
                if (pct !== lastPct) {
                    lastPct = pct;
                    process.stdout.write(`\r[ffmpeg-win] descargando... ${pct}%`);
                }
            });
            res.on('error', reject);
            out.on('error', reject);
            out.on('finish', () => { process.stdout.write('\n'); resolve(); });
            res.pipe(out);
        });
        req.on('error', reject);
        req.setTimeout(180000, () => req.destroy(new Error('timeout de 180 s en la descarga')));
    });
}

function extractPinnedEntries() {
    if (!fs.existsSync(TAR)) {
        fail([
            `no existe ${TAR}.`,
            'bsdtar viene con Windows 10 1803+ y el Package.appxmanifest ya exige 10.0.18362.',
            'Sin el no hay forma de extraer una sola entrada del zip sin dependencias nuevas.',
        ]);
    }
    fs.rmSync(EXTRACT_DIR, { recursive: true, force: true });
    fs.mkdirSync(EXTRACT_DIR, { recursive: true });

    const r = spawnSync(
        TAR,
        ['-xf', ZIP_PATH, '-C', EXTRACT_DIR, '--strip-components=1', ZIP_ENTRY_EXE, ZIP_ENTRY_LICENSE],
        { stdio: 'inherit', shell: false }
    );
    if (r.status !== 0) {
        const list = spawnSync(TAR, ['-tf', ZIP_PATH], { encoding: 'utf8', shell: false });
        fail([
            `tar fallo extrayendo ${ZIP_ENTRY_EXE} de ${ZIP_PATH} (codigo ${r.status}).`,
            'Primeras entradas reales del zip:',
            ...String(list.stdout || '').split(/\r?\n/).slice(0, 10).map((l) => `    ${l}`),
        ]);
    }

    const exe = path.join(EXTRACT_DIR, 'bin', 'ffmpeg.exe');
    const lic = path.join(EXTRACT_DIR, 'LICENSE.txt');
    if (!fs.existsSync(exe)) fail([`tar salio 0 pero no aparecio ${exe}`]);
    if (!fs.existsSync(lic)) fail([`tar salio 0 pero no aparecio ${lic}`]);
    const size = fs.statSync(exe).size;
    if (size < MIN_EXE_BYTES || size > MAX_EXE_BYTES) {
        fail([`ffmpeg.exe extraido con tamano sospechoso: ${size} bytes`]);
    }
    return { exe, lic };
}

/**
 * Un ffmpeg.exe viejo en target/{debug,release} GANA sobre el PATH desde que
 * find_ffmpeg_path mira primero la carpeta del exe en Windows. Si no es byte a byte
 * el pineado, se borra: Tauri lo vuelve a copiar desde binaries/ en el proximo build.
 * ffprobe/ffplay se borran siempre (el codigo no los ejecuta jamas).
 */
function cleanupResiduals(bundledHash) {
    for (const profile of ['debug', 'release']) {
        const dir = path.join(REPO_ROOT, 'target', profile);
        if (!fs.existsSync(dir)) continue;
        for (const name of ['ffprobe.exe', 'ffplay.exe']) {
            const p = path.join(dir, name);
            if (fs.existsSync(p)) { fs.rmSync(p, { force: true }); log(`residual borrado: ${path.relative(REPO_ROOT, p)}`); }
        }
        const stale = path.join(dir, 'ffmpeg.exe');
        if (fs.existsSync(stale) && sha256(stale) !== bundledHash) {
            fs.rmSync(stale, { force: true });
            log(`ffmpeg.exe STALE borrado de target/${profile} (no era el pineado)`);
        }
    }
    // El staging MSIX arrastra un ffprobe.exe de 94.5 MB que nadie ejecuta.
    const stagedProbe = path.join(MSIX_STAGING, 'ffprobe.exe');
    if (fs.existsSync(stagedProbe)) {
        fs.rmSync(stagedProbe, { force: true });
        log('msix_staging/ffprobe.exe borrado (peso muerto: cero call sites)');
    }
}

/**
 * Deja en msix_staging/ el ffmpeg.exe pineado y su LICENSE. El canal Store empaqueta
 * DESDE ese directorio y `tauri build --no-bundle` NO copia externalBin, asi que esta
 * es la unica via por la que el MSIX recibe ffmpeg.
 *
 * Corre en los DOS caminos del script (extraccion fresca E idempotente) a proposito:
 * msix_staging/ esta gitignored y el operador lo recrea entre ciclos, asi que con el
 * stamp al dia y el staging nuevo el MSIX saldria SIN ffmpeg — `Failed to spawn FFmpeg
 * process: os error 2` en cada chunk, cero audio.mp4 — y ningun check lo atraparia
 * (`--check` no mira el staging y el smoke solo mira target\debug).
 */
function syncMsixStaging(bundledHash) {
    if (!fs.existsSync(MSIX_STAGING)) return;
    for (const [src, dest, knownHash] of [
        [BUNDLED, STAGED, bundledHash],
        [LICENSE_OUT, STAGED_LICENSE, null],
    ]) {
        if (!fs.existsSync(src)) continue;
        const want = knownHash || sha256(src);
        if (fs.existsSync(dest) && sha256(dest) === want) continue;
        fs.copyFileSync(src, dest);
        log(`copiado -> ${path.relative(REPO_ROOT, dest)}`);
    }
}

// ------------------------------------------------------------------ main
async function main() {
    fs.mkdirSync(BINARIES_DIR, { recursive: true });

    if (REPORT) {
        const s = readStamp();
        log(`pin       : ${FFMPEG_TAG} / ${FFMPEG_ASSET}`);
        log(`zip sha256: ${FFMPEG_ZIP_SHA256}`);
        log(`stamp     : ${s ? JSON.stringify(s) : '(ausente)'}`);
        log(`bundleado : ${fs.existsSync(BUNDLED) ? sha256(BUNDLED) : '(ausente)'}  ${path.relative(REPO_ROOT, BUNDLED)}`);
        if (fs.existsSync(STAGED)) log(`staged    : ${sha256(STAGED)}  ${path.relative(REPO_ROOT, STAGED)}`);
        if (fs.existsSync(STAGED_LICENSE)) log(`staged lic: ${path.relative(REPO_ROOT, STAGED_LICENSE)}`);
        process.exit(0);
    }

    if (!FORCE && isCurrent()) {
        // Barato y es lo unico que atrapa un binario cambiado a mano por uno GPL.
        const head = assertLgplBuild(BUNDLED, false);
        log(`OK: ${head}`);
        log(`OK: ${path.relative(REPO_ROOT, BUNDLED)} al dia (stamp ${FFMPEG_TAG})`);
        if (!CHECK) {
            const bundledHash = sha256(BUNDLED);
            cleanupResiduals(bundledHash);
            syncMsixStaging(bundledHash);
        }
        process.exit(0);
    }

    if (CHECK) {
        fail([
            `falta o no cuadra ${path.relative(REPO_ROOT, BUNDLED)}.`,
            'Regenerar: cd frontend; node scripts/stage-ffmpeg-windows.js --fix',
        ]);
    }

    fs.mkdirSync(WORK, { recursive: true });
    log(`dir de trabajo: ${WORK}`);

    const zipOk = () => fs.existsSync(ZIP_PATH)
        && fs.statSync(ZIP_PATH).size === FFMPEG_ZIP_BYTES
        && sha256(ZIP_PATH) === FFMPEG_ZIP_SHA256;

    if (!zipOk()) {
        log(`descargando ${FFMPEG_URL}`);
        fs.rmSync(ZIP_PATH, { force: true });
        try {
            await download(FFMPEG_URL, ZIP_PATH);
        } catch (e) {
            fs.rmSync(ZIP_PATH, { force: true });
            fail([`descarga fallida: ${e.message}`]);
        }
        if (!zipOk()) {
            const got = fs.existsSync(ZIP_PATH) ? sha256(ZIP_PATH) : '(no se escribio nada)';
            fs.rmSync(ZIP_PATH, { force: true });
            fail([
                'el SHA-256 del zip NO coincide con el pineado. No se extrae nada.',
                `  esperado : ${FFMPEG_ZIP_SHA256}`,
                `  obtenido : ${got}`,
            ]);
        }
    }
    log(`OK: zip verificado (sha256 ${FFMPEG_ZIP_SHA256})`);

    const { exe, lic } = extractPinnedEntries();
    fs.copyFileSync(exe, BUNDLED);
    fs.copyFileSync(lic, LICENSE_OUT);
    fs.rmSync(EXTRACT_DIR, { recursive: true, force: true });

    const head = assertLgplBuild(BUNDLED, true);
    const exeSha = sha256(BUNDLED);

    fs.writeFileSync(
        STAMP,
        `${JSON.stringify({ url: FFMPEG_URL, zipSha256: FFMPEG_ZIP_SHA256, exeSha256: exeSha }, null, 0)}\n`,
        'utf8'
    );

    syncMsixStaging(exeSha);
    cleanupResiduals(exeSha);

    log(`OK: ${head}`);
    log(`OK: ${path.relative(REPO_ROOT, BUNDLED)} (${(fs.statSync(BUNDLED).size / 1048576).toFixed(1)} MB, sha ${exeSha.slice(0, 12)}...)`);
}

main().catch((e) => fail([e && e.stack ? e.stack : String(e)]));
