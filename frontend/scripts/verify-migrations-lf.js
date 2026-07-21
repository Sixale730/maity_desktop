#!/usr/bin/env node
// Verifica que cada migracion sqlx sea BYTE-IDENTICA a su checksum pinneado
// (.sha384) antes de compilar.
//
// Por que: sqlx::migrate! calcula sha384 sobre los BYTES del archivo y lo
// compara contra lo registrado en la _sqlx_migrations de cada usuario. Los
// bytes canonicos de cada migracion son LOS QUE EMBEBIO EL RELEASE que la
// aplico — historicamente una MEZCLA de line endings (las 16 primeras CRLF,
// las posteriores LF), capturada en los .sha384. Un binario con bytes
// distintos arranca en las DB de usuarios existentes con:
//   "migration N was previously applied but has been modified"
// y la app queda bloqueada (incidentes v0.2.38 y 2026-07-21; el segundo se
// atrapo probando el MSIX local antes de subirlo a la Store).
//
// REGLA: el pin es la verdad. NO normalizar line endings de migraciones, NO
// editarlas una vez aplicadas. Migracion nueva => generar su .sha384 con
// scripts/migrations-regen-checksums.sh y commitear ambos juntos.
//
// Corre en run-pre-build-checks.js (debug + release) y en tauri:build:store.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'src-tauri', 'migrations');

let failures = [];

const sqlFiles = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

for (const name of sqlFiles) {
    const filePath = path.join(MIGRATIONS_DIR, name);
    const bytes = fs.readFileSync(filePath);
    const pinnedPath = `${filePath}.sha384`;

    if (!fs.existsSync(pinnedPath)) {
        failures.push(`${name}: falta su .sha384 — genera el pin con scripts/migrations-regen-checksums.sh y commitea ambos.`);
        continue;
    }

    const pinned = fs.readFileSync(pinnedPath, 'utf8').trim();
    const actual = crypto.createHash('sha384').update(bytes).digest('hex');
    if (actual !== pinned) {
        failures.push(
            `${name}: bytes distintos al pin.\n` +
            `    actual : ${actual}\n` +
            `    pinned : ${pinned}\n` +
            `    Causa tipica: line endings alterados (autocrlf, editor, normalizacion).\n` +
            `    Restaurar los bytes originales; NUNCA regenerar el pin de una migracion ya aplicada.`
        );
    }
}

if (failures.length > 0) {
    console.error('[verify-migrations] FAIL:');
    for (const f of failures) console.error(`  - ${f}`);
    console.error('');
    console.error('  Un binario con estos bytes ROMPE el arranque de usuarios existentes.');
    console.error('  No compilar ni publicar hasta que todo coincida con los pins.');
    process.exit(1);
}

console.log(`[verify-migrations] OK: ${sqlFiles.length} migraciones byte-identicas a sus pins`);
