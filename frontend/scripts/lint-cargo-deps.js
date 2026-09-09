#!/usr/bin/env node
// Lint de dependencias Cargo: hace ejecutable el cierre de #35 de la auditoría de
// recursos (docs/AUDITORIA_RECURSOS_2026-09-02.md).
//
// Garantías (ambas fallan el pre-build):
//   (a) una sola versión — las crates de la pila HTTP/TLS (reqwest, rustls,
//       tokio-rustls, hyper-rustls, rustls-native-certs, rustls-webpki,
//       webpki-roots) y las que alineamos con tauri (zip, dirs, dirs-sys) no
//       pueden aparecer con dos versiones en `cargo tree -d`. Así se compilaban
//       rustls 0.22 Y 0.23 (sentry 0.34 + tokio-tungstenite 0.21), dos reqwest,
//       dos zip, dos dirs: 3-6 MB de exe y dos cargadores de root store.
//   (b) ausentes — aws-lc-rs/aws-lc-sys (un SEGUNDO proveedor criptográfico
//       junto a ring: con los dos en el árbol y ninguno instalado,
//       ClientConfig::builder() hace panic en el primer HTTPS; llega si alguien
//       activa `reqwest/rustls` o `sentry/rustls` en vez de `*-no-provider`),
//       clap/clap_lex (los traía la feature `bin` de nnnoiseless), esaxx-rs y
//       symphonia (deps sin un solo call site).
//
// Corre contra el HOST (cargo tree resuelve la plataforma actual), desde la raíz
// del workspace (Cargo.lock vive ahí y está gitignored). Tarda ~2-4 s con el
// lock al día; si Cargo.toml cambió, cargo resuelve primero (red).
//
// Escape hatch: pnpm run tauri:build:debug:skip-checks
// Corre en run-pre-build-checks.js. Uso manual: node scripts/lint-cargo-deps.js

const { spawnSync } = require('child_process');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const PACKAGE = 'maity-desktop';

// (a) Nombres que sólo admiten UNA versión en el árbol.
const SINGLE_VERSION = [
    'reqwest',
    'rustls',
    'tokio-rustls',
    'hyper-rustls',
    'rustls-native-certs',
    'rustls-webpki',
    'webpki-roots',
    'zip',
    'dirs',
    'dirs-sys',
];

// (b) Nombres que no deben existir en el árbol, con el porqué para el mensaje.
const FORBIDDEN = {
    'aws-lc-rs': 'segundo proveedor criptográfico junto a ring (¿alguien activó `reqwest/rustls` o `sentry/rustls`? usar `*-no-provider`)',
    'aws-lc-sys': 'segundo proveedor criptográfico junto a ring (¿alguien activó `reqwest/rustls` o `sentry/rustls`? usar `*-no-provider`)',
    'clap': 'sin call sites; lo arrastraba la feature `bin` de nnnoiseless (`default-features = false`)',
    'clap_lex': 'sin call sites; lo arrastraba la feature `bin` de nnnoiseless (`default-features = false`)',
    'esaxx-rs': 'dependencia muerta borrada en #35',
    'symphonia': 'dependencia muerta borrada en #35',
};

// Línea de `cargo tree --prefix none`: `nombre vX.Y.Z` + sufijos opcionales
// (`(proc-macro)`, `(https://…)`, `(C:\…)`). Las líneas `[build-dependencies]`
// y las vacías no casan y se ignoran.
const LINE_RE = /^([A-Za-z0-9_.-]+) v(\S+)/;

function cargoTree(extraArgs) {
    const args = ['tree', '-p', PACKAGE, '-e', 'normal,build', '--prefix', 'none', ...extraArgs];
    // Mismo patrón que verify-helper-binary.js: en Windows `cargo` se resuelve vía shell.
    const result = spawnSync('cargo', args, {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        shell: process.platform === 'win32',
        maxBuffer: 64 * 1024 * 1024,
    });
    if (result.error) {
        console.error(`[lint-cargo-deps] no se pudo ejecutar cargo: ${result.error.message}`);
        process.exit(2);
    }
    if (result.status !== 0) {
        // Los warnings de "patch/profiles for the non root package will be ignored"
        // (#31) van a stderr con status 0; aquí sólo llega un fallo real.
        console.error(`[lint-cargo-deps] cargo tree falló (exit ${result.status}):`);
        console.error(result.stderr);
        process.exit(2);
    }
    return result.stdout.split(/\r?\n/);
}

function parse(lines) {
    const versions = new Map(); // nombre -> Set<versión>
    for (const line of lines) {
        const m = LINE_RE.exec(line.trim());
        if (!m) continue;
        if (!versions.has(m[1])) versions.set(m[1], new Set());
        versions.get(m[1]).add(m[2]);
    }
    return versions;
}

const started = Date.now();
const violations = [];

// (a) Duplicados: `-d` lista sólo los paquetes con más de una versión.
const dupes = parse(cargoTree(['-d', '--depth', '0']));
for (const name of SINGLE_VERSION) {
    const set = dupes.get(name);
    if (set && set.size > 1) {
        violations.push(
            `${name} aparece con ${set.size} versiones (${[...set].sort().join(', ')}). ` +
            `Localiza quién trae cada una con: cargo tree -p ${PACKAGE} -i ${name}@<versión>`
        );
    }
}

// (b) Prohibidas: árbol completo.
const all = parse(cargoTree([]));
for (const [name, why] of Object.entries(FORBIDDEN)) {
    const set = all.get(name);
    if (set) {
        violations.push(
            `${name} v${[...set].sort().join(', v')} está en el árbol: ${why}. ` +
            `Quién lo trae: cargo tree -p ${PACKAGE} -i ${name}`
        );
    }
}

const elapsed = ((Date.now() - started) / 1000).toFixed(1);

if (violations.length > 0) {
    console.error(`[lint-cargo-deps] ${violations.length} violación(es) en ${elapsed}s:`);
    for (const v of violations) console.error(`  - ${v}`);
    console.error('');
    console.error('  Contexto: CLAUDE.md § "Dependencias Rust: una sola pila TLS" y #35 de');
    console.error('  docs/AUDITORIA_RECURSOS_2026-09-02.md.');
    process.exit(1);
}

console.log(
    `[lint-cargo-deps] OK: ${all.size} crates en el árbol de ${PACKAGE}, ` +
    `sin duplicados de ${SINGLE_VERSION.join('/')} ni crates prohibidas (${elapsed}s)`
);
