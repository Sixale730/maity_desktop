#!/usr/bin/env node
/**
 * Verifica que el comentario MARKER critico siga presente en layout.tsx.
 *
 * El test AST en src/app/layout.test.ts valida la estructura del arbol JSX,
 * pero corre solo en `pnpm test`. Este script corre en cada `pnpm run
 * tauri:build:debug` (via run-pre-build-checks.js) y atrapa el caso de
 * "alguien borra el comentario MARKER al refactorizar" sin requerir correr
 * la suite completa de tests.
 *
 * Si este script falla, NO uses --skip-checks como solucion. Restaura el
 * comentario o, si tienes una razon legitima para removerlo, retira tambien
 * el invariante correspondiente de PROVIDER_INVARIANTS en layout.test.ts.
 */
const fs = require('fs');
const path = require('path');

const LAYOUT_PATH = path.resolve(__dirname, '..', 'src', 'app', 'layout.tsx');
const MARKER_SUBSTRING = 'CRITICAL: <UpdateCheckProvider> debe vivir FUERA';

if (!fs.existsSync(LAYOUT_PATH)) {
    console.error(`[lint-providers-tree] FAIL: layout.tsx no encontrado en ${LAYOUT_PATH}`);
    process.exit(1);
}

const content = fs.readFileSync(LAYOUT_PATH, 'utf-8');

if (!content.includes(MARKER_SUBSTRING)) {
    console.error('');
    console.error('[lint-providers-tree] FAIL: comentario MARKER ausente en layout.tsx.');
    console.error('');
    console.error('  El comentario que empieza con "CRITICAL: <UpdateCheckProvider> debe vivir FUERA"');
    console.error('  debe permanecer encima del JSX del root layout. Documenta una regresion historica');
    console.error('  (commit 230b807) y previene que el bug del auto-update vuelva a aparecer.');
    console.error('');
    console.error('  Si lo removiste a proposito, retira tambien el invariante correspondiente de');
    console.error('  PROVIDER_INVARIANTS en src/app/layout.test.ts.');
    console.error('');
    process.exit(1);
}

console.log('[lint-providers-tree] OK: MARKER comment presente');
