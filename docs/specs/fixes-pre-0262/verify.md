# Verificación: fixes-pre-0262

El bloque JSON es la fuente de verdad para `/spec-execute`: se copia verbatim a `args.verify`.

- `tests`: `true` si el repo tiene tests ejecutables; `false` con el motivo en `reason`. Con `false` ninguna tarea puede usar `tdd`.
- `suites`: comandos por suite, en forma `cd /c/<repo> && <comando>` (rutas POSIX, sin `git -C`, sin `node -e`, sin heredocs). `expect` describe cómo se ve el éxito.
- `default`: suites que corre una tarea que no declara `suites`.
- `ratchets`: métricas que solo pueden mejorar (v1: se reportan, no bloquean).
- `manual`: comprobaciones que hace Julio a mano después.
- `prompts`: comandos que solo pasan por allow-list exacta (p. ej. gradle) y podrían pedir permiso.

Política de esta spec (igual que #83): cada tarea corre SOLO sus `verify` (tests del módulo que toca). El build
integrado `tauri:build:debug` NO corre por tarea: es la compuerta final manual (`manual[1]`), obligatoria antes del bump.

```json
{
  "tests": true,
  "reason": "",
  "suites": {
    "build": [
      { "cmd": "cd /c/maity_desktop/frontend && npm run tauri:build:debug", "expect": "exit 0 (pre-build: lint-telemetry, lint-tauri-acl, lint-tauri-events, lint-cargo-*; next build; cargo build debug; bundle; post-build lint-exe-imports/lint-aux-bundle/lint-main-bundle). Tarda 10-20 min. NO se usa por tarea en esta spec: es la compuerta final manual" }
    ],
    "ts": [
      { "cmd": "cd /c/maity_desktop/frontend && npm run test", "expect": "vitest: 0 failed (línea base 2026-09-24: 564 tests verdes)" }
    ],
    "rust": [
      { "cmd": "cd /c/maity_desktop/frontend/src-tauri && cargo test --lib", "expect": "test result: ok. 0 failed (línea base 2026-09-24: 958 passed, 3 ignored). Correr en FOREGROUND con timeout 600000: el reaper de Claude Code mató un cargo test en background por RAM" }
    ],
    "telemetry": [
      { "cmd": "cd /c/maity_desktop/frontend && node scripts/lint-telemetry.js", "expect": "[lint-telemetry] OK (línea base 2026-09-24: 36 eventos, 12 legacy; tras F5: 37)" }
    ]
  },
  "default": ["ts"],
  "ratchets": [
    { "name": "vitest tests", "cmd": "cd /c/maity_desktop/frontend && npm run test", "metric": "número de tests que pasan", "baseline": 564, "direction": "up" },
    { "name": "eventos en catálogo", "cmd": "cd /c/maity_desktop/frontend && node scripts/lint-telemetry.js", "metric": "eventos del catálogo espejo", "baseline": 36, "direction": "up" },
    { "name": "cargo tests lib", "cmd": "cd /c/maity_desktop/frontend/src-tauri && cargo test --lib", "metric": "tests que pasan", "baseline": 958, "direction": "up" }
  ],
  "manual": [
    "Antes de ejecutar: git branch backup/2026-09-24-fixes-pre-0262 (Protocolo Guardian de CLAUDE.md: F1 toca recording_manager.rs y F5 toca lib.rs). Ejecutar SOLO con el motor serial: /spec-execute fixes-pre-0262 (sin --parallel: F2, F3, F4 y F5 comparten docs/TELEMETRIA.md en secuencia).",
    "Compuerta final OBLIGATORIA antes del bump (nunca corrió sobre el código de #83 tampoco): cd /c/maity_desktop/frontend && npm run tauri:build:debug con exit 0, y cd /c/maity_desktop/frontend/src-tauri && cargo test --lib completo en verde. Si el smoke del build falla por una instancia corriendo, matar el PID y re-correr.",
    "E2E con un MSIX local (/store-msix) y la NSIS debug, además de la matriz de 11 escenarios de docs/specs/telemetria-ciclo-vida-83/verify.md: (a) grabar y detener -> metadata.json de la carpeta de la grabación con duration_seconds numérico; (b) arranque de jornada -> el health.heartbeat con reason recording-start trae jornada.scheduler_phase=recording y jornada.skip=null; (c) Finalizar tarea de Maity en el Administrador de tareas, cerrar sesión de Windows y volver a entrar -> el siguiente app.start trae logon_changed_since_prev=true y prev_exit_reason=os_session_end_unclean; (d) apagar con Fast Startup activo y volver a encender -> device.profile.hiberboot_enabled=true; app.start con os_rebooted_since_prev=false, logon_changed_since_prev=true y prev_exit_reason=os_session_end (observado); (e) cada arranque deja UNA fila app.window_shown; un arranque con la PC cargada muestra shown_by=fallback y app_ready_ms numérico.",
    "Correr la query '¿Por qué no grabó? — persona × día hábil' de docs/TELEMETRIA.md sobre el usuario de pruebas para los días del E2E y confirmar que un día con os_session_end_unclean cae en 'PC apagada / suspendida / sin sesión de Windows'.",
    "graphify update . al terminar la ejecución (regla de CLAUDE.md).",
    "Después: push (Julio), /build patch (0.2.62), /store-msix y bump de maity.system_config['desktop_store_latest_version']."
  ],
  "prompts": [
    "cd /c/maity_desktop/frontend/src-tauri && cargo test --lib <modulo>  (nightshift lo auto-aprueba; check-spec lo marca como forma fuera de su lista conocida: es esperado)"
  ]
}
```

## Receta legible

| Suite | Comando | Éxito se ve como |
|---|---|---|
| (por tarea) | `cd /c/maity_desktop/frontend/src-tauri && cargo test --lib <modulo>` | `test result: ok` (en foreground, timeout 600000) |
| ts | `cd /c/maity_desktop/frontend && npm run test` | vitest verde (línea base 564) |
| telemetry | `cd /c/maity_desktop/frontend && node scripts/lint-telemetry.js` | `[lint-telemetry] OK` (36 → 37 eventos tras F5) |
| rust | `cd /c/maity_desktop/frontend/src-tauri && cargo test --lib` | 958+ passed, 0 failed |
| build (final, manual) | `cd /c/maity_desktop/frontend && npm run tauri:build:debug` | exit 0 |

## Comprobaciones manuales
- Rama de respaldo antes de ejecutar y motor serial (`manual[0]`).
- Compuerta final: `tauri:build:debug` exit 0 + `cargo test --lib` completo (`manual[1]`).
- E2E (a)-(e) en MSIX y NSIS (`manual[2]`) y query de clasificación (`manual[3]`).
- `graphify update .`, push, bump.
