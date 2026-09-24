---
slug: telemetria-ciclo-vida-83
run_id: wf_ce2ef218-3c7
base_commit: 4c34b8159527968aeb3e10769b31507e04ef106b
head_commit: 8cbacdb
status: failed
---

# Reporte de ejecución: telemetria-ciclo-vida-83

> REFERENCIA HISTÓRICA — este reporte describe una corrida ya terminada; no re-ejecutar sus tareas.

> **Historial de corridas**
> - 1.ª corrida `wf_a2a028d2-ec3` (base `4ea3927`): solo A1 (`232037c`). A2 fue refutada y 27 tareas se saltaron en cascada. Su reporte está en el commit `75df2b9`.
> - Entre corridas: A2 se corrigió a mano a pedido de Julio (relectura tras `claim` en `flush_row` y re-chequeo de `EXITING` antes de `get_valid_token`) y se commiteó en `4c34b81`.
> - 2.ª corrida `wf_ce2ef218-3c7` (esta): J1–J7. P1a fue refutada y 19 tareas se saltaron en cascada.
> - Decisión de Julio para las dos corridas desde A2: **"solo tests sin smoke ni build"**. Por eso ninguna tarea corrió `tauri:build:debug`.

> **Notas del líder (correcciones al cuerpo del revisor final):**
> - **AC-22 está cumplido**, aunque abajo diga "no verificable". La query se corrió en prod durante A1 (1.ª corrida): 160 filas y 10 personas, sin error, con la distribución pre-registrada en `plan.md`. Está en el reporte de `75df2b9`.
> - Que AC-21 salga "no cumplido" por falta de build es consecuencia directa de la instrucción de Julio, no un olvido del motor.

## Resumen
Esta corrida terminó 7 de 27 tareas de la spec. Todas son del bloque de jornada y scheduler (J1–J7) y cada una tiene su commit local sobre `4c34b81`. Cubren estos criterios: rearme por causa, cierre del día y turno nocturno, "Evaluar ahora", supresión persistida, instantánea e `idle_reason`, y configuración en `device.profile`. A1 y A2 ya estaban hechas desde una corrida anterior (`232037c` y `4c34b81`). P1a (autostart/FILETIME) falló porque los dos refutadores la rechazaron: `filetime_ticks_to_rfc3339` conserva los nanosegundos en vez de truncarlos como pide el plan, y falta el test obligatorio del plan. Las otras 19 tareas (P1b…Z1) no corrieron porque dependen en cadena de P1a. Veredicto: **ejecución parcial**. Lo que se commiteó está verde en tests. AC-9 a AC-20 siguen sin implementar. No se corrió `tauri:build:debug` porque Julio pidió "solo tests sin smoke ni build".

## Criterios de aceptación
| AC | Evidencia (comando o archivo:línea) | Resultado |
|---|---|---|
| AC-1 | `node scripts/lint-telemetry.js` → `OK: catálogo espejo (36 eventos, 12 legacy)…` (lo hizo A1 en `232037c`, antes de la base) | cumplido |
| AC-2 | `cargo test --lib logging::` → 63 passed; `cargo test --lib database::repositories::recording_log` → 5 passed (lo hizo A2 en `4c34b81`, antes de la base) | cumplido |
| AC-3 | `service.rs:686-697` (`close_owned_segment_for_exit` llama a `begin_session_end` antes del stop), `lib.rs:1850`; test `rearm_tests::logout_y_login_el_mismo_dia_no_apagan_la_jornada` dentro de `cargo test --lib scheduled_recording` → 108 passed | cumplido en tests; falta la matriz E2E manual |
| AC-4 | `service.rs:112` (mensaje "…siguiente horario"); tests `cierre_automatico_turno_nocturno_no_pierde_22_00_00_00` y `cierre_automatico_viernes_salta_al_lunes` (108 passed) | cumplido |
| AC-5 | `service.rs:844` `tick.reset_immediately();` en `CheckNow` | cumplido |
| AC-6 | `scheduled_recording/runtime_state.rs` con 8 tests (vencido, corrupto, versión futura, reloj movido, SessionEnd nunca escrito) incluidos en los 108 passed; `docs/ONBOARDING_Y_GATES.md:31` | cumplido en tests; falta la comprobación manual (7) |
| AC-7 | `logging/commands.rs:341-343,369` (`idle_reason` y `jornada` en `HealthSnapshot`); `mem_sampler.rs:384-392` (latido nativo); `service.rs:262` emite `JORNADA_IDLE_REASON_CHANGED`; test `health_snapshot_serializa_con_keys_esperadas` (logging 63 passed) | cumplido en código y tests; no se verificó en DevTools |
| AC-8 | `status_snapshot.rs:371` `changed_fields` + tests en `:776-792`; `service.rs:291` emite `JORNADA_SETTINGS_CHANGED`; `logging/commands.rs:446` `DeviceProfile.jornada` | cumplido en tests; falta la comprobación manual (6) |
| AC-9 | P1a refutada. Hay trabajo sin commitear: `utils.rs:38-54` (nanosegundos sin truncar, falta el test de `134_116_992_009_999_999`) y `autostart_state.rs`, que está untracked | no cumplido |
| AC-10 | Tarea L1/L2 no ejecutada | no cumplido |
| AC-11 | Tareas L1/L2/E* no ejecutadas | no cumplido |
| AC-12 | Tareas E1–E3 no ejecutadas | no cumplido |
| AC-13 | Tarea de recuperación de checkpoints no ejecutada | no cumplido |
| AC-14 | Tareas U* no ejecutadas | no cumplido |
| AC-15 | Tareas U* no ejecutadas | no cumplido |
| AC-16 | Tarea P1b no ejecutada | no cumplido |
| AC-17 | Tareas S* no ejecutadas | no cumplido |
| AC-18 | Tareas S* no ejecutadas | no cumplido |
| AC-19 | Tareas S* no ejecutadas | no cumplido |
| AC-20 | Tareas S* no ejecutadas | no cumplido |
| AC-21 | Tests verdes: `cargo test --lib scheduled_recording` 108/108, `logging::` 63/63, `utils::tests` 7/7, `npm run test` 520/520. `tauri:build:debug` no se corrió por instrucción de Julio | no cumplido: falta el build |
| AC-22 | Query de prod ejecutada en el narrativo de A1 (corrida anterior); en esta corrida no se ejecutó SQL | no verificable |
| AC-23 | Solo se tocó `docs/ONBOARDING_Y_GATES.md` (+13). CLAUDE.md, REGLAS_AUDIO_GRABACION.md, CANALES_DISTRIBUCION.md y NUBE_CUENTAS_SYNC.md no cambiaron (Z1 no corrió). El lint de telemetría da OK | no cumplido |
| AC-24 | Matriz E2E manual | no verificable (pendiente para Julio) |

## Tareas
| Tarea | Riesgo | Correcciones | Refutadores | Verificación | Commit |
|---|---|---|---|---|---|
| A1 | low | — | — | hecha en la 1.ª corrida | `232037c` |
| A2 | medium | — | — | corregida a mano; tests verdes | `4c34b81` |
| J1 | high | 0 | 2 no sostenidas | verde | `3dd8405` |
| J2 | medium | 0 | 2 no sostenidas | verde | `664747e` |
| J3 | low | 0 | 0 (riesgo low) | verde | `8e3ad73` |
| J4 | high | 0 | 2 no sostenidas | verde | `192ef5e` |
| J5 | medium | 0 | 2 no sostenidas | verde | `dc3849e` |
| J6 | medium | 0 | 2 no sostenidas | verde | `b915bcb` |
| J7 | medium | 0 | 2 no sostenidas | verde | `8cbacdb` |
| P1a | medium | 1 | 2 sostenidas | refutada tras corrección | — (árbol sucio) |
| P1b, L1, L2, E1, E2a, E2b, E3, U1, U2, L3, U4, P2, S1, S2, S3a, S3b, S4, S5, Z1 | — | — | — | saltada (dependencia de P1a) | — |

## Commits
- `3dd8405` · fix(jornada): salir o cerrar sesión ya no suprime la jornada hasta medianoche (S1) · J1
- `664747e` · fix(jornada): el cierre automático avisa día cerrado y respeta el turno nocturno (S1) · J2
- `8e3ad73` · fix(jornada): Evaluar ahora evalúa en el siguiente instante (S1) · J3
- `192ef5e` · feat(jornada): la supresión por paro o cierre del día sobrevive al reinicio (S1) · J4
- `dc3849e` · feat(telemetria): instantánea del scheduler con idle_reason y sus transiciones (S1) · J5
- `b915bcb` · feat(telemetria): idle_reason y bloque jornada en health.heartbeat (S1) · J6
- `8cbacdb` · feat(telemetria): configuración de jornada en device.profile y jornada.settings_changed (S1) · J7

`main` va 10 commits por delante de `origin/main`. Son estos 7 más `4ea3927`, `232037c`, `75df2b9` y `4c34b81`, todos sin push.

## Fallos
- **P1a** (autostart real y `package_installed_at`)
  - **Causa:** la refutaron los dos refutadores tras corrección. `filetime_ticks_to_rfc3339` (`utils.rs:52-53`) pasa `nanos` a `from_timestamp` en vez de `0`. Con eso `134_116_992_009_999_999` produce `2026-01-01T00:00:00.999999900+00:00`, cuando el plan pide `…00:00:00+00:00` (plan.md:1823 y :1876). Ese test obligatorio no se escribió.
  - **Archivos sucios:**
    - ` M frontend/src-tauri/src/lib.rs`: `pub mod autostart_state` y registro de `autostart_get_state`.
    - ` M frontend/src-tauri/src/logging/commands.rs`: `autostart_disabled_at` y `autostart_mechanism` en `DeviceProfile`, más 2 tests.
    - ` M frontend/src-tauri/src/utils.rs`: `filetime_ticks_to_rfc3339` más 6 tests.
    - ` M frontend/src/services/healthHeartbeatService.ts`: tipos de las dos claves nuevas.
    - `?? frontend/src-tauri/src/autostart_state.rs`: 267 líneas, `classify_direct` más 9 tests.
  - El árbol sucio compila y sus tests pasan. Solo falla contra el plan.
- **P1b, L1, L2, E1, E2a, E2b, E3, U1, U2, L3, U4, P2, S1, S2, S3a, S3b, S4, S5, Z1**: no se ejecutaron porque dependen en cadena de P1a. No dejaron archivos sucios.

## Riesgos
- **Sin build integrado:** `npm run tauri:build:debug` no corrió en ninguna tarea, por instrucción de Julio. Los 7 commits no tienen verificación de bundle, ni lints post-build (`lint-exe-imports`, `lint-aux-bundle`, `lint-main-bundle`), ni smoke. Esto contradice el protocolo de compilación de CLAUDE.md y AC-21.
- **Tests corridos sobre el árbol sucio:** mis `cargo test`, `npm run test` y `lint-telemetry` se ejecutaron con los cambios de P1a en el working tree. HEAD solo no se verificó aislado, aunque los cambios de P1a son aditivos.
- **Ratchets:**
  - Vitest: **520** tests pasan (baseline 513, sube 7), 64 archivos.
  - Eventos en catálogo: **36** (baseline 28, sube 8).
- **Refutadores ausentes:** J3 no tuvo refutadores (`refuters: []`). Su evidencia es solo el diff de una línea (`service.rs:844`) y los tests del módulo.
- **Estado intermedio en código:** `idle_reason`, `jornada.idle_reason_changed` y `jornada.settings_changed` ya se emiten, pero `app.start`, `app.exit`, `autostart.changed`, `auth.*` y `app.resumed` no existen todavía en código. Los 8 eventos están en el catálogo y en `docs/TELEMETRIA.md`, pero 5 de ellos no tienen emisor. La query "¿Por qué no grabó?" no puede distinguir aún salida, apagado, logout ni autostart apagado.
- **Deuda de docs (AC-23):** CLAUDE.md y 3 de los 4 docs de reglas no describen todavía la supresión persistida (`runtime_state.rs`) ni la retención `SessionEnd`. Solo lo hace ONBOARDING_Y_GATES.md.
- **Sin comprobaciones manuales:** no se hizo ninguna de las de AC-3, AC-6, AC-7 (DevTools), AC-8 ni AC-24.

## Lecciones propuestas para CLAUDE.md
- En los `plan.md` de spec, declarar solo dependencias reales entre tareas. Aquí la refutación de P1a (una conversión FILETIME) bloqueó 19 tareas, entre ellas L*, E* y S*, sin que el plan mostrara que alguna dependiera de ella.
- Cuando el plan fija un caso de prueba literal (entrada y salida), el implementador debe escribir ese test tal cual antes que variantes propias. Omitirlo fue la causa directa del rechazo de P1a.

## Qué queda para Julio
- **Push manual** de `main` (10 commits por delante de `origin/main`). No se hizo push.
- **Decidir sobre P1a** (árbol sucio). Opción (a): corregir `utils.rs:52` a `from_timestamp(secs, 0)`, agregar el test de `134_116_992_009_999_999 → "2026-01-01T00:00:00+00:00"`, commitear y reanudar `/spec-execute telemetria-ciclo-vida-83` desde P1a con el motor serial. Opción (b): descartar los cambios sucios y re-ejecutar P1a desde cero.
- **Build integrado:** correr `cd frontend && pnpm run tauri:build:debug` sobre los commits J1–J7 antes de cualquier release. Esta corrida no lo hizo.
- **Rama de backup:** `backup/2026-09-23-telemetria-83` ya existe.
- **Matriz E2E en Windows 11** (NSIS debug y MSIX local). Con lo commiteado hoy solo se pueden probar los escenarios (6), (7) y (8), más la parte de jornada de (3). Los escenarios (1), (2), (4), (5), (9), (10) y (11) dependen de tareas que no corrieron.
- **Query "¿Por qué no grabó? — persona × día hábil"** y **control de dominio de `idle_reason` y `app.exit reason`** tras una semana en campo con 0.2.62. Hacerlo después de completar la spec.
- **`graphify update .`** al terminar la ejecución, como pide CLAUDE.md.
