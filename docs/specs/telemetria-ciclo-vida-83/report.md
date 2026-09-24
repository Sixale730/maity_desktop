---
slug: telemetria-ciclo-vida-83
run_id: wf_a2a028d2-ec3
base_commit: 4ea3927bb77dbeca97ac2149ac1833d48c83930c
head_commit: 232037ce6aeb09fef57acb01c697739a5e8adbcb
status: failed
---

# Reporte de ejecución: telemetria-ciclo-vida-83

> REFERENCIA HISTÓRICA: este reporte describe una corrida ya terminada. No hay que volver a ejecutar sus tareas.

## Resumen
De 29 tareas, solo terminó A1. Añadió el contrato de los 8 eventos nuevos (`catalog.rs`, `telemetry-events.ts` y `docs/TELEMETRIA.md`, con la query "¿Por qué no grabó?") en el commit `232037c`. A2 (drenado puntual `flush_row`) se refutó dos veces y quedó sin commit. Los refutadores tenían razón en las dos observaciones; las comprobé en el árbol sucio. Las otras 27 tareas se saltaron en cascada porque dependían de A2. **Veredicto: la spec no se cumplió.** Solo hay 1 de 24 AC cumplido del todo. Además, `docs/TELEMETRIA.md` ya describe en `main` código que todavía no existe.

> **Notas del líder (correcciones al cuerpo que devolvió el workflow):**
> - **AC-22 sí se verificó.** El narrativo completo de A1 en el journal (`wf_a2a028d2-ec3/journal.jsonl`) registra la corrida en prod (solo SELECT, `mcp__supabase__execute_sql`) sobre Dingler (`f983ab57-…`, 01–23 sep 2026, feriado 16-sep, sin karen/rita): sin error, 160 filas / 10 personas, con la misma distribución que se pre-registró en `plan.md` (posible desinstalación 94/8, versión < 0.2.62 45/6, grabó 13/5, grabó parcial 3/3, silencio reciente 2/1, sin micrófono/permiso 2/1, PC apagada/suspendida 1/1). Las dos queries de `app.start`/`app.exit` por versión devolvieron `[]`, como se esperaba. Por eso AC-22 va como **cumplido**, no como "no verificable".
> - **El "(S1)" del commit no es un error**: es el `phaseTag` del plan y todas las tareas lo llevan.
> - Que A1 no tenga refutadores (`refuters: []`) es lo que toca a una tarea `risk: low` (0 refutadores); no es algo que se haya saltado.
> - El implementador de A1 dice explícitamente que no corrió `npm run tauri:build:debug` porque no venía en su lista de comandos de verificación. El motor tampoco corrió la suite `build` que A1 declaraba. Queda sin cumplir AC-21 y la regla de CLAUDE.md "build antes de commit".

## Criterios de aceptación
| AC | Evidencia (comando o archivo:línea) | Resultado |
|---|---|---|
| AC-1 | `node scripts/lint-telemetry.js` → `OK: catálogo espejo (36 eventos, 12 legacy)`. Las constantes están en `catalog.rs:60-68` y `telemetry-events.ts:57-65`. La tabla de payloads está en `docs/TELEMETRIA.md:221-228` y `idle_reason` en `:331`. | cumplido |
| AC-2 | Cambios sin commit en `drain.rs`. `flush_row` (`drain.rs:253-266`) no vuelve a leer la fila después de `claim()`, y `drain_once` (`drain.rs:124-152`) no vuelve a mirar `EXITING` antes de `get_valid_token`. | no cumplido |
| AC-3 | Tareas J1-J4 saltadas; no hay código. | no cumplido |
| AC-4 | Tareas J saltadas. | no cumplido |
| AC-5 | `service.rs` sin cambios. | no cumplido |
| AC-6 | `scheduled_recording::runtime_state` no existe. | no cumplido |
| AC-7 | `grep idle_reason` en `src-tauri/src` solo da la constante de `catalog.rs:68`; no hay emisor. | no cumplido |
| AC-8 | Tareas saltadas. | no cumplido |
| AC-9 | Tareas saltadas. | no cumplido |
| AC-10 | `logging/telemetry/lifecycle.rs` no existe (comprobado con `ls`). | no cumplido |
| AC-11 | Tareas saltadas. | no cumplido |
| AC-12 | Tareas saltadas. | no cumplido |
| AC-13 | Tareas saltadas. | no cumplido |
| AC-14 | Tareas saltadas. | no cumplido |
| AC-15 | Tareas saltadas. | no cumplido |
| AC-16 | Tareas saltadas. | no cumplido |
| AC-17 | Tareas saltadas. | no cumplido |
| AC-18 | Tareas saltadas. | no cumplido |
| AC-19 | Tareas saltadas. | no cumplido |
| AC-20 | Tareas saltadas. | no cumplido |
| AC-21 | A1 solo corrió `lint-telemetry.js`. Nadie corrió `npm run tauri:build:debug` sobre `232037c`, aunque toca `catalog.rs`. | no cumplido |
| AC-22 | La query está en `docs/TELEMETRIA.md:665-800`. Se corrió en prod (narrativo de A1 en el journal): 160 filas / 10 personas sin error, con la distribución pre-registrada (ver Notas del líder). | cumplido (corregido por el líder) |
| AC-23 | `TELEMETRIA.md` describe `logging/telemetry/lifecycle.rs` (`:221`) e `idle_reason` en ambos latidos (`:314`), y ninguno de los dos existe en el código. `CLAUDE.md`, `REGLAS_AUDIO_GRABACION.md`, `CANALES_DISTRIBUCION.md`, `NUBE_CUENTAS_SYNC.md` y `ONBOARDING_Y_GATES.md` no se tocaron. | no cumplido |
| AC-24 | Es comprobación manual de Julio; no se hizo. | no verificable |

## Tareas
| Tarea | Riesgo | Correcciones | Refutadores | Verificación | Commit |
|---|---|---|---|---|---|
| A1 | low | 0 | 0 (riesgo low) | verde (`lint-telemetry.js`; build no corrido) | `232037c` |
| A2 | medium | ≥1 | 2 sostenidas | refutada tras corrección | — (árbol sucio) |
| J1, J2, J3, J4, J5, J6, J7 | — | — | — | saltada (dependencia A2) | — |
| P1a, P1b | — | — | — | saltada (dependencia) | — |
| L1, L2, L3 | — | — | — | saltada (dependencia) | — |
| E1, E2a, E2b, E3 | — | — | — | saltada (dependencia) | — |
| U1, U2, U4 | — | — | — | saltada (dependencia) | — |
| P2 | — | — | — | saltada (dependencia) | — |
| S1, S2, S3a, S3b, S4, S5 | — | — | — | saltada (dependencia) | — |
| Z1 | — | — | — | saltada (dependencia) | — |

## Commits
- `232037c` · docs(telemetria): contrato de los 8 eventos del issue 83 y query de por qué no grabó (S1) · A1

## Fallos
- **A2**: refutada después de su corrección. Hay dos defectos, los dos confirmados por lectura:
  1. `flush_row` lee la fila con `get_by_id` antes de `claim()` y no la vuelve a leer después. Si el loop de 30 s la sube entre la lectura y el reclamo, el POST sale duplicado. Es el mismo TOCTOU que `drain_once` sí corrige en `drain.rs:180-197`, así que viola AC-2.
  2. `drain_once` no vuelve a mirar `EXITING` antes de `get_valid_token`, que puede refrescar el token. Eso viola el paso 2 de A2 en `plan.md:1297` y `contract.md:261`.
  - Archivos sucios que dejó, sin commit (`git diff --stat`: 4 archivos, +458/−16):
    - `frontend/src-tauri/src/cloud_sync/session.rs` (+19, agrega `token_if_fresh`)
    - `frontend/src-tauri/src/database/repositories/recording_log.rs` (+159, con aviso de CRLF→LF)
    - `frontend/src-tauri/src/logging/telemetry/drain.rs` (253 líneas cambiadas)
    - `frontend/src-tauri/src/logging/telemetry/emit.rs` (43 líneas cambiadas, agrega `emit_event_with_id`)
- **J1…Z1** (27 tareas): no se ejecutaron porque dependían en cadena de A2.

## Riesgos
- **La documentación va por delante del código en `main`.** `docs/TELEMETRIA.md` (+372 líneas) presenta como vigentes "desde 0.2.62" `app.start`/`app.exit`, `lifecycle.json`, `idle_reason` y el bloque `jornada`, y nada de eso existe. Si se hace un release con este commit, el doc-contrato miente. `lint-telemetry.js` pasa igual, porque solo cruza nombres de evento y no los módulos ni los campos de payload.
- Las 8 constantes nuevas no tienen emisor. La query "¿Por qué no grabó?" va a devolver vacío en todo lo que dependa de esos eventos hasta que se implementen.
- No hubo build integrado (`tauri:build:debug`) después de `232037c`, y los cambios sucios de A2 tampoco se compilaron en esta revisión.
- No se corrió `cargo test --lib logging::telemetry` sobre el árbol sucio en esta revisión. Según el refutador, pasan 17 tests, pero ninguno cubre la relectura posterior al `claim` en `flush_row`.
- Ratchets:
  - vitest: 513 tests pasan (64 archivos). La línea base es 513, sin avance.
  - Catálogo: 36 eventos. La línea base es 28, así que sube 8.
- La rama de respaldo `backup/2026-09-23-telemetria-83` sí existe (se creó en `4ea3927` antes de lanzar).

## Lecciones propuestas para CLAUDE.md
- En una spec, la tarea que documenta un contrato con "desde X.Y.Z" debe ir marcada "(pendiente de implementación)" hasta que el emisor esté commiteado, o ir al final del plan. Si no, un fallo en cascada deja el doc-contrato mintiendo en `main`.
- Todo reclamo in-process de una fila del outbox (`claim`) debe volver a leer `synced_to_cloud` después de reclamar, en todos los call sites y no solo en el loop.
- Si una tarea declara la suite `build`, el motor debe correrla aunque la tarea traiga su propia lista `verify`. Hoy la lista `verify` la reemplaza en silencio y se commitea sin build.

## Qué queda para Julio
- `git push` manual. Lo único que hay para subir es `232037c` más este reporte. Antes de subirlo hay que decidir si `232037c` se queda, porque el doc anuncia funcionalidad que no existe. Lo más limpio sería revertirlo, o agregar un aviso de "pendiente" en `TELEMETRIA.md`, hasta volver a correr la spec.
- Árbol sucio de A2: decidir si se conserva como base para la próxima corrida (hay que corregir la relectura post-`claim` en `flush_row` y el re-chequeo de `EXITING` antes de `get_valid_token`) o se descarta. No se tocó nada.
- Volver a correr `/spec-execute telemetria-ciclo-vida-83` con el motor serial desde A2, con `done` en A1, después de resolver lo de arriba. Con el árbol limpio, el Paso 2 detecta A1 por su mensaje de commit.
- Siguen pendientes y no aplican hasta que exista el código: la matriz E2E de 11 escenarios (NSIS y MSIX), la query "¿Por qué no grabó?" sobre el usuario de pruebas, el control de dominio de `idle_reason`/`app.exit` tras una semana de 0.2.62, y `graphify update .`.
