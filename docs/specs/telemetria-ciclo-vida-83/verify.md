# Verificación: telemetria-ciclo-vida-83

El bloque JSON es la fuente de verdad para `/spec-execute`: se copia verbatim a `args.verify`.

- `tests`: `true` si el repo tiene tests ejecutables; `false` con el motivo en `reason`. Con `false` ninguna tarea puede usar `tdd`.
- `suites`: comandos por suite, en forma `cd /c/<repo> && <comando>` (rutas POSIX, sin `git -C`, sin `node -e`, sin heredocs). `expect` describe cómo se ve el éxito.
- `default`: suites que corre una tarea que no declara `suites`.
- `ratchets`: métricas que solo pueden mejorar (v1: se reportan, no bloquean).
- `manual`: comprobaciones que hace Julio a mano después.
- `prompts`: comandos que solo pasan por allow-list exacta (p. ej. gradle) y podrían pedir permiso.

```json
{
  "tests": true,
  "reason": "",
  "suites": {
    "build": [
      { "cmd": "cd /c/maity_desktop/frontend && npm run tauri:build:debug", "expect": "exit 0 (pre-build: lint-telemetry, lint-tauri-acl, lint-tauri-events, lint-cargo-*; next build; cargo build debug; bundle; post-build). Tarda 10-20 min: correrlo con run_in_background y log en el scratchpad terminado en EXIT=$?; nunca en foreground (tope de 10 min)" }
    ],
    "ts": [
      { "cmd": "cd /c/maity_desktop/frontend && npm run test", "expect": "vitest: Test Files N passed, Tests N passed, 0 failed (línea base 2026-09-23: 64 archivos, 513 tests)" }
    ],
    "lint": [
      { "cmd": "cd /c/maity_desktop/frontend && npm run lint", "expect": "next lint sin errores nuevos (warnings previos OK)" }
    ],
    "telemetry": [
      { "cmd": "cd /c/maity_desktop/frontend && node scripts/lint-telemetry.js", "expect": "[lint-telemetry] OK (línea base: 28 eventos, 12 legacy)" }
    ]
  },
  "default": ["build"],
  "ratchets": [
    { "name": "vitest tests", "cmd": "cd /c/maity_desktop/frontend && npm run test", "metric": "número de tests que pasan", "baseline": 513, "direction": "up" },
    { "name": "eventos en catálogo", "cmd": "cd /c/maity_desktop/frontend && node scripts/lint-telemetry.js", "metric": "eventos del catálogo espejo", "baseline": 28, "direction": "up" }
  ],
  "manual": [
    "Antes de ejecutar: git branch backup/2026-09-23-telemetria-83 (Protocolo Guardian: la spec toca lib.rs, scheduler y pipeline de grabación). Ejecutar SOLO con el motor serial: /spec-execute telemetria-ciclo-vida-83 (sin --parallel).",
    "Matriz E2E en Windows 11 con la build de la spec (NSIS debug y un MSIX local vía /store-msix): (1) Salir desde la bandeja -> fila app.exit reason tray_quit en maity.platform_logs en segundos; (2) cerrar sesión de Windows y volver -> app.start prev_exit_reason os_session_end detail logoff; (3) reiniciar Windows grabando la jornada -> la jornada rearranca sola tras el login, la grabación se recupera una sola vez y no aparece la pantalla de 'esta app impide apagar' más de un instante; (4) Finalizar tarea en el Administrador de tareas -> siguiente app.start con prev_exit_clean=false y prev_exit_reason unclean; (5) desactivar Maity en Inicio del Administrador de tareas y reiniciar -> autostart.changed to disabledByUser (MSIX y NSIS); (6) apagar la jornada en Ajustes -> jornada.settings_changed + latidos con idle_reason jornada_off; (7) detener la grabación de jornada dentro del horario y reiniciar la app -> no rearranca hasta la siguiente hora en punto; (8) cierre automático a una hora dentro del horario -> aviso 'La jornada de hoy ya se cerró…' e idle_reason closed_for_day; (9) cerrar sesión desde el sidebar del chat grabando -> la conversación se guarda y aparece auth.logout surface chat_sidebar; (10) cerrar la tapa (suspensión) 10+ min -> app.resumed; (11) update NSIS con grabación en curso o recién detenida -> se niega; en reposo -> instala y relanza, siguiente app.start prev_exit_reason update detail nsis.",
    "Correr la query '¿Por qué no grabó? — persona × día hábil' de docs/TELEMETRIA.md sobre el usuario de pruebas para los días de la matriz y confirmar que cada día cae en la causa esperada.",
    "Control de dominio tras la primera semana de 0.2.62 en campo: select event_data->>'idle_reason', count(*) from maity.platform_logs where event_type='health.heartbeat' and created_at > now() - interval '7 days' group by 1; y distinct de app.exit reason: todo valor debe estar en las tablas del contrato.",
    "graphify update . al terminar la ejecución (regla de CLAUDE.md)."
  ],
  "prompts": [
    "cd /c/maity_desktop/frontend/src-tauri && cargo test --lib <modulo>  (nightshift lo auto-aprueba; check-spec lo marca como forma fuera de su lista conocida: es esperado)"
  ]
}
```

## Receta legible

| Suite | Comando | Éxito se ve como |
|---|---|---|
| build | `cd /c/maity_desktop/frontend && npm run tauri:build:debug` | exit 0 (en background con log; 10-20 min) |
| ts | `cd /c/maity_desktop/frontend && npm run test` | vitest verde (línea base 64 archivos / 513 tests) |
| lint | `cd /c/maity_desktop/frontend && npm run lint` | sin errores nuevos |
| telemetry | `cd /c/maity_desktop/frontend && node scripts/lint-telemetry.js` | `[lint-telemetry] OK` |
| (por tarea) | `cd /c/maity_desktop/frontend/src-tauri && cargo test --lib <modulo>` | `test result: ok` (el build NO compila `#[cfg(test)]`) |

Línea base medida el 2026-09-23: `lint-telemetry` OK (28 eventos, 12 legacy); `npm run test` 64 archivos / 513 tests
en 45 s; `cargo test --lib scheduled_recording` 51 passed (773 tests en la lib).

## Comprobaciones manuales
- Rama de respaldo antes de ejecutar y motor serial (ver `manual[0]`).
- Matriz E2E de 11 escenarios en Windows 11, NSIS y MSIX (ver `manual[1]`).
- Query de clasificación sobre los días de la matriz y control de dominio tras una semana en campo.
- `graphify update .` al final.
