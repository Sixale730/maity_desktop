---
slug: telemetria-ciclo-vida-83
run_id: wf_44aba775-ed6
base_commit: c258088eae3c70287872177addeffb20958c06a2
head_commit: 2481aa7
status: failed
---

# Reporte de ejecución: telemetria-ciclo-vida-83

> REFERENCIA HISTÓRICA — este reporte describe una corrida ya terminada; no re-ejecutar sus tareas.

> **Historial de corridas** (decisión de Julio desde A2: "solo tests sin smoke ni build"; desde P1a: "corrige lo que vaya saliendo")
> - 1.ª `wf_a2a028d2-ec3`: A1 (`232037c`); A2 refutada. Reporte en `75df2b9`.
> - A2 corregida a mano (relectura tras `claim` en `flush_row`, `EXITING` antes de `get_valid_token`): `4c34b81`.
> - 2.ª `wf_ce2ef218-3c7`: J1–J7 (`3dd8405`…`8cbacdb`); P1a refutada. Reporte en `9837727`.
> - P1a corregida a mano (`filetime_ticks_to_rfc3339` trunca sub-segundos + test literal del plan): `142c5ef`.
> - 3.ª `wf_0e7106a1-adb`: P1b (`07570e9`); L1 refutada. Reporte en `aec36c2`.
> - L1 corregida a mano (ventana de pánicos anclada en `last_alive_ms + 120 s`, test `caso_10b`): `c258088`.
> - 4.ª `wf_44aba775-ed6` (esta): L2, E1, E2a, E2b, E3, U1, U2, L3, U4; P2 refutada.
>
> **Notas del líder:** AC-22 se verificó en prod durante A1 (1.ª corrida; ver `75df2b9`). AC-21 queda sin build por decisión de Julio. En esta corrida el implementador de E1 corrió por su cuenta `tauri:build:debug` (y con él el smoke del post-build) porque un refutador le reclamó AC-21: el build pasó (MSI + NSIS 0.2.61 debug, `lint-aux-bundle`, `lint-main-bundle`, `lint-exe-imports` OK), pero fue contra la instrucción "sin smoke ni build".

## Resumen
Esta corrida (base `c258088`) cerró 9 tareas con commit local: L2, E1, E2a, E2b, E3, U1, U2, L3 y U4. Cubren `app.exit` con motivo de salida, el fin de sesión de Windows acotado, la recuperación tolerante a checkpoints truncados, el update NSIS vía `direct_update_install`, `exit_for_update` para la Store y la ACL `updater:allow-check`. P2 (`autostart.changed`) fue refutada tras su corrección: en el disparador `boot` emite `autostart.changed` **antes** de `app.start`, y el plan pide lo contrario. Su trabajo quedó sin commitear en el árbol. Por la cadena de dependencias no corrieron S1, S2, S3a, S3b, S4, S5 ni Z1. Veredicto: **ejecución parcial**. AC-11 a AC-15 quedan cubiertos en código y tests. AC-16 a AC-20 siguen sin implementar y AC-23 está incompleto.

## Criterios de aceptación
| AC | Evidencia (comando o archivo:línea) | Resultado |
|---|---|---|
| AC-1 | `cd frontend && node scripts/lint-telemetry.js` → `OK: catálogo espejo (36 eventos, 12 legacy)` (corrido en esta revisión) | cumplido |
| AC-2 | Commit `4c34b81` (A2, de una corrida anterior). En esta revisión no se re-corrió `cargo test --lib logging::telemetry` | cumplido según corrida anterior (no re-verificado) |
| AC-3 | Commit `3dd8405` (J1, corrida anterior). La parte manual (matriz E2E) está pendiente | parcial: código de la corrida anterior, manual no verificable |
| AC-4 | Commit `664747e` (J2, corrida anterior). No se re-corrió `cargo test --lib scheduled_recording` | cumplido según corrida anterior (no re-verificado) |
| AC-5 | Commit `8e3ad73` (J3, corrida anterior) | cumplido según corrida anterior (no re-verificado) |
| AC-6 | Commit `192ef5e` (J4, corrida anterior). Manual (7) pendiente | parcial: manual no verificable |
| AC-7 | Commits `dc3849e` y `b915bcb` (J5/J6, corrida anterior). La prueba en DevTools está pendiente | parcial: manual no verificable |
| AC-8 | Commit `8cbacdb` (J7, corrida anterior). Manual (6) pendiente | parcial: manual no verificable |
| AC-9 | Commits `142c5ef` y `07570e9` (P1a/P1b, corrida anterior). Manual (5) pendiente | parcial: manual no verificable |
| AC-10 | Commit `c258088` (L1, base). Tests `caso_01…caso_14` de `summarize_prev` en `frontend/src-tauri/src/logging/telemetry/lifecycle.rs:1423-1643`. Según el workflow, la verificación de L3 dio 42/42 en `cargo test --lib logging::telemetry::lifecycle`. Manual (4) y (10) pendientes | parcial: código y tests sí, manual no verificable |
| AC-11 | `lifecycle.rs:1022` (`classify_exit`), tests `classify_exit_tabla` (`lifecycle.rs:1736`) y `classify_exit_con_el_mapeo_de_session_end` (`:1776`), `session_end.rs:443` (`classify_tabla`). Commits `e4400ef` y `f2dc99a`. Manual (1) y (2) pendientes | cumplido en código y tests; manual pendiente |
| AC-12 | `session_end.rs:571` (`presupuestos_de_fin_de_sesion_caben_en_5_s`). Commits `5bda495` y `c8049f1`. Manual (3) pendiente | cumplido en código y tests; manual pendiente |
| AC-13 | `useTranscriptRecovery.ts:287` (`shouldCleanupCheckpoints(audioRecoveryStatus)` condiciona `cleanup_checkpoints`), `incremental_saver.rs:623/634` (`concat_list_content`, `partition_valid`) y sus tests en `:1327/:1346`. Commit `614cab3`. El test E2E `recover_con_chunk_truncado_devuelve_partial_y_pone_bad` (`incremental_saver.rs:1391`) lleva `#[ignore]` porque necesita ffmpeg en PATH, así que no se ejecutó | cumplido (el test de integración con ffmpeg no corrió) |
| AC-14 | `tauri.conf.json:73` = `"updater:allow-check"`, `direct_update.rs` (9 tests), `UpdateDialog.test.tsx:247` (instala solo por `direct_update_install`), `updaterInstall.fitness.test.ts`. Commits `69b8522`, `8c553a2` y `2481aa7`. Manual (11) pendiente | cumplido en código y tests; manual pendiente |
| AC-15 | `UpdateDialog.test.tsx:64-69` (`exit_for_update`). Tests `intencion_update_store_api_pendiente_se_resume_como_update` en `lifecycle.rs`. Commit `4d46f10` | cumplido |
| AC-16 | P2 refutada: `lifecycle.rs:438` llama `reconcile_with(&app, "boot", …)` antes de `catalog::APP_START` (`:465`), y `plan.md:1992` pide ese orden al revés. Sin commit | no cumplido |
| AC-17 | S-tasks no ejecutadas (dependen de P2). `authSignOut.fitness.test.ts` no existe en ningún commit | no cumplido |
| AC-18 | Igual que AC-17 (`lib/authRelease.test.ts` no creado) | no cumplido |
| AC-19 | Igual que AC-17 | no cumplido |
| AC-20 | Igual que AC-17 | no cumplido |
| AC-21 | Hubo `npm run tauri:build:debug` EXIT=0 en E1, E2b, U1 y L3, según las notas del workflow. `target/debug/maity-desktop.exe` y `Maity_0.2.61_x64-setup.exe` son de las 02:26-02:28. **U4 (`2481aa7`, 02:36) cambia `tauri.conf.json` y no tuvo build integrado posterior.** L2 tampoco lo tuvo en su propia tarea, aunque la build de E1 ya incluye su código. `npm run test` = 542/542 (corrido en esta revisión) | parcial: falta la build después de U4 |
| AC-22 | Se corrió en prod durante A1 (1.ª corrida, reporte `75df2b9`). En esta corrida no se ejecutó SQL | cumplido según corrida anterior |
| AC-23 | Desde `4ea3927` se tocaron `TELEMETRIA.md`, `REGLAS_AUDIO_GRABACION.md`, `CANALES_DISTRIBUCION.md` y `ONBOARDING_Y_GATES.md`. **`CLAUDE.md` y `NUBE_CUENTAS_SYNC.md` no cambiaron**: eran parte de Z1/S*, que no corrieron | no cumplido |
| AC-24 | Matriz E2E manual de Julio | no verificable (pendiente) |

## Tareas
| Tarea | Riesgo | Correcciones | Refutadores | Verificación | Commit |
|---|---|---|---|---|---|
| A1, A2, J1, J2, J3, J4, J5, J6, J7, P1a, P1b, L1 | — | — | — | hechas en corridas anteriores | — |
| L2 | high | 1 | 2 no sostenidas | verde | `e4400ef` |
| E1 | high | 1 | 2 no sostenidas | verde | `f2dc99a` |
| E2a | high | 0 | 2 no sostenidas | verde | `5bda495` |
| E2b | high | 1 | 2 no sostenidas | verde | `c8049f1` |
| E3 | high | 0 | 2 no sostenidas | verde | `614cab3` |
| U1 | high | 1 | 2 no sostenidas | verde | `69b8522` |
| U2 | high | 0 | 2 no sostenidas | verde | `8c553a2` |
| L3 | high | 1 | 2 no sostenidas | verde | `4d46f10` |
| U4 | medium | 0 | 2 no sostenidas | verde | `2481aa7` |
| P2 | — | ≥1 | 1 sostenidas | refutada tras corrección | — (árbol sucio) |
| S1, S2, S3a, S3b, S4, S5, Z1 | — | — | — | saltada (dependencia) | — |

## Commits
- `e4400ef` · feat(telemetria): app.exit con motivo de salida y manejo de ExitRequested (S1) · L2
- `f2dc99a` · feat(salida): tipo de fin de sesión de Windows vía subclass de la ventana main (S1) · E1
- `5bda495` · feat(grabacion): flush acotado de la grabación para el fin de sesión de Windows (S1) · E2a
- `c8049f1` · fix(grabacion): el fin de sesión de Windows ya no bloquea 30 s guardando la grabación (S1) · E2b
- `614cab3` · fix(grabacion): la recuperación tolera checkpoints truncados y ya no borra audio tras un merge fallido (S1) · E3
- `69b8522` · fix(updater): el update NSIS pasa por direct_update_install y cierra DB y sidecar antes del instalador (S1) · U1
- `8c553a2` · fix(updates): el dialogo NSIS instala por Rust y se niega con grabacion o post-proceso en curso (S1) · U2
- `4d46f10` · feat(store): salidas por update de la Store registradas desde Rust con exit_for_update (S1) · L3
- `2481aa7` · fix(updater): la capability solo permite check y un fitness test impide instalar desde JS (S1) · U4

(`S1` es el `phaseTag` del plan, no la tarea S1.)

## Fallos
- **P2** · Refutada tras la corrección. En `boot`, `emit_start` llama `autostart_state::reconcile_with` (`lifecycle.rs:438`) antes de emitir `app.start` (`lifecycle.rs:465`). Si en ese arranque cambió el autostart, `autostart.changed` entra al outbox antes que `app.start`, y `plan.md:1992` exige start → changed. Archivos sucios, confirmados con `git status --short`:
  - `frontend/src-tauri/src/autostart_state.rs` (+144)
  - `frontend/src-tauri/src/lib.rs` (+4, registra `autostart_reconcile`)
  - `frontend/src-tauri/src/logging/telemetry/lifecycle.rs` (+4)
  - `frontend/src/components/settings/PreferenceSettings.tsx` (+39)
  - `frontend/src/hooks/useAutostartBootstrap.ts` (+6)
  
  El arreglo probable es mover la llamada después del `emit_event(… APP_START …)` y reusar `autostart`. No se verificó que el estado sucio compile con cargo.
- **S1, S2, S3a, S3b, S4, S5, Z1** · No se ejecutaron: la cadena depende de P2. No dejaron archivos sucios.

## Riesgos
- **Build pendiente tras U4**: `tauri.conf.json` cambió de `updater:default` a `updater:allow-check` después de la última build integrada (02:26). `lint-tauri-acl.js` y el fitness test pasan, pero nada prueba en runtime que el `check()` siga permitido.
- **Árbol sucio con P2 a medias**: una build o un commit hechos ahora arrastrarían el orden incorrecto `autostart.changed` → `app.start`. El `npm run test` de esta revisión (542) incluye esos cambios de TS de P2.
- **Test E2E de recuperación ignorado**: `recover_con_chunk_truncado_devuelve_partial_y_pone_bad` necesita ffmpeg en PATH. El camino `partial` con un `.mp4` truncado real solo quedó cubierto con tests unitarios.
- **Nada de la matriz E2E está verificado**: fin de sesión/apagado real, subclass de WM_ENDSESSION, update NSIS real, salida de la Store. Es código de alto riesgo (hilo principal durante WM_ENDSESSION, hook del instalador que cierra la DB y el sidecar) validado solo con tests puros.
- **AC-16…AC-20 sin implementar**: la brecha del logout (SidebarFooter sin `logout_cleanup`, `auth.logout`/`auth.session_lost`, grabación a media sesión caída) sigue abierta. `docs/TELEMETRIA.md` ya documenta eventos (`auth.*`, `autostart.changed`) que el código todavía no emite, aunque `lint-telemetry` pasa porque el catálogo espejo sí los tiene.
- **Ratchets**: vitest 542 pasan (baseline 513, sube, 65 archivos). Catálogo de telemetría: 36 eventos (baseline 28, sube). Ninguno retrocede.
- **Refutadores**: las 9 tareas hechas tuvieron 2 refutadores cada una, sin refutación sostenida. No hay refutadores ausentes.
- No se re-corrieron los `cargo test` en esta revisión; la evidencia Rust viene de los `verifyOutput` del workflow.

## Lecciones propuestas para CLAUDE.md
- Una tarea que toque `tauri.conf.json` (capabilities o plugins) necesita su propio `tauri:build:debug`. `lint-tauri-acl.js` no sustituye la build integrada.
- Cuando dos eventos del outbox se emiten en la misma tarea async, el orden que exige el contrato se fija con un test que inspeccione el orden de inserción, no solo con comentarios.

## Qué queda para Julio
- **Push manual** de los 9 commits (`e4400ef`…`2481aa7`), más los de corridas anteriores que siguen sin push.
- **Decidir sobre P2**: arreglar a mano el orden en `lifecycle.rs` (mover `reconcile_with` después del `emit_event` de `APP_START`) y commitearlo, o descartar los 5 archivos sucios. Después, re-lanzar `/spec-execute telemetria-ciclo-vida-83` con el motor serial para P2 → S1…S5 → Z1.
- Correr `cd frontend && npm run tauri:build:debug` sobre `HEAD` (después de U4) antes de cualquier release.
- Opcional: `cargo test --lib audio::incremental_saver -- --ignored` con ffmpeg en PATH.
- Antes de la próxima corrida: `git branch backup/2026-09-23-telemetria-83` (Protocolo Guardian).
- Matriz E2E en Windows 11 (NSIS debug y MSIX local vía `/store-msix`). Hoy aplican los escenarios (1), (2), (3), (4), (10) y (11). Los escenarios (5) a (8) dependen de código de corridas anteriores (J*/P1*); el (5) también necesita P2 y el (9) necesita las S-tasks.
- Correr la query "¿Por qué no grabó? — persona × día hábil" sobre el usuario de pruebas para los días de la matriz.
- Control de dominio de `idle_reason` y de `app.exit reason` tras la primera semana de 0.2.62 en campo.
- `graphify update .` al terminar.
