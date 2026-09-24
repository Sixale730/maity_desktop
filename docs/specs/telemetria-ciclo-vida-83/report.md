---
slug: telemetria-ciclo-vida-83
run_id: wf_0e7106a1-adb
base_commit: 142c5ef3b8b46d1c6119c00d144bb7553ab9558b
head_commit: 07570e9
status: failed
---

# Reporte de ejecución: telemetria-ciclo-vida-83

> REFERENCIA HISTÓRICA — este reporte describe una corrida ya terminada; no re-ejecutar sus tareas.

> **Historial de corridas** (decisión de Julio desde A2: "solo tests sin smoke ni build"; desde P1a: "corrige lo que vaya saliendo")
> - 1.ª `wf_a2a028d2-ec3`: A1 (`232037c`); A2 refutada. Reporte en `75df2b9`.
> - A2 corregida a mano (relectura tras `claim` en `flush_row`, `EXITING` antes de `get_valid_token`): `4c34b81`.
> - 2.ª `wf_ce2ef218-3c7`: J1–J7 (`3dd8405`…`8cbacdb`); P1a refutada. Reporte en `9837727`.
> - P1a corregida a mano (`filetime_ticks_to_rfc3339` trunca sub-segundos + test literal del plan): `142c5ef`.
> - 3.ª `wf_0e7106a1-adb` (esta): P1b; L1 refutada.
>
> **Nota del líder:** AC-22 se verificó en prod durante A1 (1.ª corrida; ver `75df2b9`). AC-21 queda sin build por decisión de Julio.

## Resumen
Esta corrida (base `142c5ef`) terminó solo una tarea, P1b: `package_installed_at` y `package_installed_at_source` en `device.profile`, en el commit `07570e9`. Las tareas A1, A2, J1–J7 y P1a no se corrieron porque ya tenían commit; P1a se había corregido a mano en `142c5ef`. L1 (marcador de ciclo de vida `lifecycle.json`) falló. Un refutador sostuvo que la ventana de pánicos usa `last_seen` en lugar de `last_alive_ms`, como pide el plan. Su trabajo quedó sin commitear en el árbol. Las otras 17 tareas (L2…Z1) no corrieron porque dependen en cadena de L1. Veredicto: **ejecución parcial**. AC-9 queda cubierto en código y tests. AC-10 a AC-20 siguen sin implementar. En esta corrida no hay evidencia de que se haya corrido `tauri:build:debug`.

## Criterios de aceptación
| AC | Evidencia (comando o archivo:línea) | Resultado |
|---|---|---|
| AC-1 | `cd frontend && node scripts/lint-telemetry.js` → `OK: catálogo espejo (36 eventos, 12 legacy)…` (lo corrió el revisor) | cumplido |
| AC-2 | Hecho en `4c34b81` (antes de esta base). Esta corrida no volvió a correr los tests | cumplido (según el reporte anterior) |
| AC-3 | Hecho en `3dd8405` (J1), antes de esta base. Falta la matriz E2E | cumplido en tests (reporte anterior); falta la parte manual |
| AC-4 | Hecho en `664747e` (J2), antes de esta base | cumplido (reporte anterior) |
| AC-5 | Hecho en `8e3ad73` (J3), antes de esta base | cumplido (reporte anterior) |
| AC-6 | Hecho en `192ef5e` (J4), antes de esta base. Falta la comprobación manual (7) | cumplido en tests (reporte anterior) |
| AC-7 | Hecho en `dc3849e` y `b915bcb` (J5 y J6), antes de esta base. No se verificó en DevTools | cumplido en tests (reporte anterior) |
| AC-8 | Hecho en `8cbacdb` (J7), antes de esta base. Falta la comprobación manual (6) | cumplido en tests (reporte anterior) |
| AC-9 | Parte P1a en `142c5ef`: `autostart_state.rs:93` `classify_direct`, con tests en `:180-258`, y `utils.rs:38` `filetime_ticks_to_rfc3339`. Parte P1b en `07570e9`: `utils.rs:98` `winrt_datetime_to_rfc3339`, `utils.rs:130` `package_installed_at`, `utils.rs:155` `nsis_uninstall_key_last_write` y `logging/commands.rs:445,502`, con tests en `commands.rs:671` y `utils.rs:348-406`. Según el workflow, `cargo test --lib utils::tests` dio 17 passed, `logging::commands` 6 y `rival_install` 3. El revisor no volvió a correrlos | cumplido en código y tests; falta la comprobación manual (5) en MSIX y NSIS |
| AC-10 | L1 refutada. `lifecycle.rs:620-636` calcula `window_end = last_seen + PANIC_GRACE_MS`; `plan.md:2071` pide `[started_at_ms, last_alive_ms + 120_000]`. No hay commit y `lifecycle.rs` está untracked | no cumplido |
| AC-11 | L2/E1/L3 no se ejecutaron | no cumplido |
| AC-12 | E2a/E2b no se ejecutaron | no cumplido |
| AC-13 | E3 no se ejecutó | no cumplido |
| AC-14 | U1/U2/U4 no se ejecutaron | no cumplido |
| AC-15 | L3 no se ejecutó | no cumplido |
| AC-16 | P2 no se ejecutó | no cumplido |
| AC-17 | S1/S3b no se ejecutaron | no cumplido |
| AC-18 | S2 no se ejecutó | no cumplido |
| AC-19 | S3a/S3b/S4 no se ejecutaron | no cumplido |
| AC-20 | S5 no se ejecutó | no cumplido |
| AC-21 | Los tests de P1b pasaron según el workflow. `npm run test` (corrido por el revisor): 519 passed y 1 failed. La falla es un timeout de 5 s en `dashboard-guards.test.ts:138`, un test que recorre `src/`; no tiene relación con P1b. No consta ningún `tauri:build:debug` en esta corrida | no cumplido: falta el build y la suite no quedó 100 % verde |
| AC-22 | La query se corrió en prod durante A1 (1.ª corrida, reporte de `75df2b9`). En esta corrida no se ejecutó SQL | cumplido (según la corrida anterior) |
| AC-23 | Z1 no se ejecutó; los docs de reglas no se actualizaron | no cumplido |
| AC-24 | Matriz E2E manual | no verificable (pendiente para Julio) |

## Tareas
| Tarea | Riesgo | Correcciones | Refutadores | Verificación | Commit |
|---|---|---|---|---|---|
| A1, A2, J1, J2, J3, J4, J5, J6, J7, P1a | — | — | — | hechas en corridas anteriores | — |
| P1b | medium | 0 | 2 no sostenidas | verde | `07570e9` |
| L1 | — | ≥1 | 1 sostenidas | refutada tras corrección | — (árbol sucio) |
| L2, E1, E2a, E2b, E3, U1, U2, L3, U4, P2, S1, S2, S3a, S3b, S4, S5, Z1 | — | — | — | saltada (dependencia) | — |

## Commits
- `07570e9` · feat(telemetria): package_installed_at en device.profile desde el paquete MSIX o la llave de desinstalacion NSIS (S1) · P1b

`main` va 13 commits por delante de `origin/main`, todos sin push.

## Fallos
- **L1** (marcador de ciclo de vida, `app.start` y `app.resumed`): refutada tras una corrección. `summarize_prev` en `lifecycle.rs:620-636` usa como fin de la ventana de pánicos `last_seen`, que incluye `exit.done_at_ms`/`begun_at_ms`. El contrato de `plan.md:2071` pide `last_alive_ms + 120_000`. Con eso, un pánico de un hilo de fondo posterior a `last_alive_ms + 120 s` cuenta como `prev_panicked=true`. Ningún caso de la tabla de tests combina un exit observado con pánicos. Según el workflow, `cargo test --lib logging::telemetry::lifecycle` dio 26 passed, pero esos tests no cubren este caso.
  - Archivos sucios: `frontend/src-tauri/src/lib.rs` (+9: `rotate_at_boot` y `emit_start`), `frontend/src-tauri/src/logging/telemetry/mod.rs` (+4), `frontend/src-tauri/src/logging/telemetry/panics.rs` (+88: `PanicTs`, `parse_panic_ts` y el campo `thread`) y `frontend/src-tauri/src/logging/telemetry/lifecycle.rs` (untracked, 1196 líneas).
- **L2, E1, E2a, E2b, E3, U1, U2, L3, U4, P2, S1, S2, S3a, S3b, S4, S5, Z1**: no corrieron porque dependen en cadena de L1.

## Riesgos
- **Sin build integrado.** No consta `tauri:build:debug` para `07570e9`, así que AC-21 no se cumple. Las dos corridas anteriores tampoco lo corrieron, por instrucción de Julio ("solo tests sin smoke ni build").
- **Código WinRT y de registro sin probar en ejecución.** `Package::Current().InstalledDate()` y el last-write de `Uninstall\Maity` solo tienen tests de funciones puras. En un MSIX y un NSIS reales no se probaron.
- **El árbol sucio de L1 toca `lib.rs`.** Llama a `rotate_at_boot` antes de la DB. Cualquier commit o build hecho ahora lo arrastraría sin revisión aprobada.
- **Ratchets:**
  - vitest: 519 passing, contra 513 de línea base; sube. Hubo 1 falla por timeout, al parecer intermitente, en `dashboard-guards.test.ts`.
  - Catálogo de eventos: 36, contra 28 de línea base; sube.
- **Refutadores:** P1b tuvo 2 refutadores y ninguno sostuvo su objeción. No faltan refutadores.
- **Verificación del revisor.** Los tests de cargo de P1b no se volvieron a correr: salen del output del workflow y se cotejaron contra el diff, donde los tests existen.

## Lecciones propuestas para CLAUDE.md
- Cuando el plan define una ventana o umbral con una variable concreta (`last_alive_ms`), la tabla de tests de la función pura debe tener un caso en la frontera que distinga esa variable de sus alternativas (por ejemplo, exit observado junto con pánicos).
- En specs con cadena lineal de dependencias, una sola refutación salta todo el resto. Conviene marcar en el plan qué tareas son independientes (E3, U1, S2) para que corran aunque falle una tarea de la cadena.

## Qué queda para Julio
- **Push manual:** hay 13 commits en `main` sin push, que incluyen `07570e9`.
- **Decidir sobre L1:**
  - Opción 1: corregir a mano `window_end` para usar `alive + PANIC_GRACE_MS` y añadir el caso de tabla exit+pánicos. Después, commitear L1 como se hizo con A2 y P1a.
  - Opción 2: descartar el árbol sucio (`lib.rs`, `mod.rs`, `panics.rs` y `lifecycle.rs`).
  - Después, relanzar `/spec-execute telemetria-ciclo-vida-83` con el motor serial (sin `--parallel`) para L2…Z1.
- **Backup y build:**
  - Antes de continuar, crear `git branch backup/2026-09-23-telemetria-83` (Protocolo Guardian: lo que falta toca `lib.rs`, el scheduler y el pipeline de grabación).
  - Correr `cd frontend && npm run tauri:build:debug` al menos una vez sobre los commits acumulados.
- **Matriz E2E en Windows 11**, con NSIS debug y un MSIX local vía `/store-msix`, los 11 escenarios de `verify.md`:
  - `tray_quit`
  - logoff
  - reinicio grabando
  - Finalizar tarea
  - autostart apagado desde el Administrador de tareas (lo único que esta corrida puede validar, junto con `package_installed_at` en `device.profile`)
  - jornada apagada
  - paro dentro del horario y reinicio
  - cierre automático
  - logout desde el sidebar del chat
  - suspensión de 10+ min
  - update NSIS
- **Query en prod:** correr "¿Por qué no grabó? — persona × día hábil" de `docs/TELEMETRIA.md` para el usuario de pruebas en los días de la matriz.
- **Control de dominio tras la primera semana de 0.2.62:** revisar la distribución de `idle_reason` en `health.heartbeat` y los valores distintos de `app.exit reason`. Todo valor debe estar en las tablas del contrato.
- **Grafo:** `graphify update .` al terminar la ejecución.
- **Test intermitente:** revisar si el timeout de `dashboard-guards.test.ts:138` se repite y, si pasa, subirle el timeout.
