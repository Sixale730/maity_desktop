# Plan: telemetria para saber por que alguien dejo de grabar (#83) + 9 bugs de salida, sesion y jornada

Spec: `spec.md` · Verificación: `verify.md`

## Tareas

El bloque JSON es la fuente de verdad para `/spec-execute`: se copia verbatim a `args.plan`.
Campos por tarea: `id` (único), `title`, `files` (rutas relativas, no vacío), `deps` (ids), `risk` (`low` = 0 refutadores; `medium` = 2; `high` = 2 + lente de seguridad + implementador Opus), `tdd` (solo si `verify.tests` es true), `suites` (claves de `verify.suites`; vacío = `verify.default`), `verify` (comandos propios; vacío = usar suites), `criteria` (ids AC-n), `commit` (mensaje exacto, con tag de fase).

```json
{
  "spec": "telemetria-ciclo-vida-83",
  "phaseTag": "S1",
  "tasks": [
    {
      "id": "A1",
      "title": "Contrato de eventos 83 en catalogo y TELEMETRIA",
      "files": [
        "frontend/src-tauri/src/logging/telemetry/catalog.rs",
        "frontend/src/lib/telemetry-events.ts",
        "docs/TELEMETRIA.md"
      ],
      "deps": [],
      "risk": "low",
      "tdd": false,
      "suites": [
        "telemetry",
        "build"
      ],
      "verify": [
        "cd /c/maity_desktop/frontend && node scripts/lint-telemetry.js"
      ],
      "criteria": [
        "AC-1",
        "AC-22",
        "AC-21"
      ],
      "commit": "docs(telemetria): contrato de los 8 eventos del issue 83 y query de por qué no grabó (S1)"
    },
    {
      "id": "A2",
      "title": "Drenado por fila y flush dirigido del outbox",
      "files": [
        "frontend/src-tauri/src/logging/telemetry/drain.rs",
        "frontend/src-tauri/src/logging/telemetry/emit.rs",
        "frontend/src-tauri/src/database/repositories/recording_log.rs",
        "frontend/src-tauri/src/cloud_sync/session.rs"
      ],
      "deps": [
        "A1"
      ],
      "risk": "medium",
      "tdd": false,
      "suites": [
        "build"
      ],
      "verify": [
        "cd /c/maity_desktop/frontend/src-tauri && cargo test --lib logging::telemetry",
        "cd /c/maity_desktop/frontend/src-tauri && cargo test --lib database::repositories::recording_log",
        "cd /c/maity_desktop/frontend/src-tauri && cargo test --lib cloud_sync::session",
        "cd /c/maity_desktop/frontend && node scripts/lint-telemetry.js"
      ],
      "criteria": [
        "AC-2",
        "AC-21"
      ],
      "commit": "refactor(telemetria): drenado del outbox por fila y flush dirigido con token vigente (S1)"
    },
    {
      "id": "J1",
      "title": "Causa del rearme y retencion de fin de sesion",
      "files": [
        "frontend/src-tauri/src/scheduled_recording/service.rs",
        "frontend/src-tauri/src/lib.rs",
        "frontend/src-tauri/src/rival_install.rs",
        "frontend/src-tauri/src/database/commands.rs"
      ],
      "deps": [
        "A2"
      ],
      "risk": "high",
      "tdd": false,
      "suites": [
        "build"
      ],
      "verify": [
        "cd /c/maity_desktop/frontend/src-tauri && cargo test --lib scheduled_recording::service",
        "cd /c/maity_desktop/frontend/src-tauri && cargo test --lib database::commands"
      ],
      "criteria": [
        "AC-3",
        "AC-21"
      ],
      "commit": "fix(jornada): salir o cerrar sesión ya no suprime la jornada hasta medianoche (S1)"
    },
    {
      "id": "J2",
      "title": "Aviso de dia cerrado y turno nocturno",
      "files": [
        "frontend/src-tauri/src/scheduled_recording/service.rs",
        "frontend/src-tauri/src/scheduled_recording/schedule.rs",
        "frontend/src/components/scheduled-recording/ScheduledRecordingSettings.tsx",
        "docs/ONBOARDING_Y_GATES.md"
      ],
      "deps": [
        "J1"
      ],
      "risk": "medium",
      "tdd": false,
      "suites": [
        "build"
      ],
      "verify": [
        "cd /c/maity_desktop/frontend/src-tauri && cargo test --lib scheduled_recording"
      ],
      "criteria": [
        "AC-4",
        "AC-23",
        "AC-21"
      ],
      "commit": "fix(jornada): el cierre automático avisa día cerrado y respeta el turno nocturno (S1)"
    },
    {
      "id": "J3",
      "title": "Evaluar ahora evalua de inmediato",
      "files": [
        "frontend/src-tauri/src/scheduled_recording/service.rs"
      ],
      "deps": [
        "J2"
      ],
      "risk": "low",
      "tdd": false,
      "suites": [
        "build"
      ],
      "verify": [
        "cd /c/maity_desktop/frontend/src-tauri && cargo test --lib scheduled_recording"
      ],
      "criteria": [
        "AC-5",
        "AC-21"
      ],
      "commit": "fix(jornada): Evaluar ahora evalúa en el siguiente instante (S1)"
    },
    {
      "id": "J4",
      "title": "Supresion de la jornada persistida entre reinicios",
      "files": [
        "frontend/src-tauri/src/scheduled_recording/runtime_state.rs",
        "frontend/src-tauri/src/scheduled_recording/mod.rs",
        "frontend/src-tauri/src/scheduled_recording/service.rs",
        "docs/ONBOARDING_Y_GATES.md"
      ],
      "deps": [
        "J3"
      ],
      "risk": "high",
      "tdd": false,
      "suites": [
        "build"
      ],
      "verify": [
        "cd /c/maity_desktop/frontend/src-tauri && cargo test --lib scheduled_recording::runtime_state",
        "cd /c/maity_desktop/frontend/src-tauri && cargo test --lib scheduled_recording::service"
      ],
      "criteria": [
        "AC-6",
        "AC-23",
        "AC-21"
      ],
      "commit": "feat(jornada): la supresión por paro o cierre del día sobrevive al reinicio (S1)"
    },
    {
      "id": "J5",
      "title": "Instantanea del scheduler e idle_reason con transiciones",
      "files": [
        "frontend/src-tauri/src/scheduled_recording/status_snapshot.rs",
        "frontend/src-tauri/src/scheduled_recording/mod.rs",
        "frontend/src-tauri/src/scheduled_recording/service.rs",
        "frontend/src-tauri/src/scheduled_recording/settings.rs"
      ],
      "deps": [
        "J4"
      ],
      "risk": "medium",
      "tdd": false,
      "suites": [
        "build",
        "telemetry"
      ],
      "verify": [
        "cd /c/maity_desktop/frontend/src-tauri && cargo test --lib scheduled_recording::status_snapshot",
        "cd /c/maity_desktop/frontend/src-tauri && cargo test --lib scheduled_recording::service",
        "cd /c/maity_desktop/frontend && node scripts/lint-telemetry.js"
      ],
      "criteria": [
        "AC-7",
        "AC-21"
      ],
      "commit": "feat(telemetria): instantánea del scheduler con idle_reason y sus transiciones (S1)"
    },
    {
      "id": "J6",
      "title": "idle_reason y bloque jornada en health.heartbeat",
      "files": [
        "frontend/src-tauri/src/logging/commands.rs",
        "frontend/src-tauri/src/logging/mem_sampler.rs",
        "frontend/src/services/healthHeartbeatService.ts",
        "frontend/src/services/healthHeartbeatService.test.ts"
      ],
      "deps": [
        "J5"
      ],
      "risk": "medium",
      "tdd": false,
      "suites": [
        "ts",
        "build"
      ],
      "verify": [
        "cd /c/maity_desktop/frontend/src-tauri && cargo test --lib logging::commands",
        "cd /c/maity_desktop/frontend && npx vitest run src/services/healthHeartbeatService.test.ts"
      ],
      "criteria": [
        "AC-7",
        "AC-21"
      ],
      "commit": "feat(telemetria): idle_reason y bloque jornada en health.heartbeat (S1)"
    },
    {
      "id": "J7",
      "title": "Configuracion de jornada en device.profile y settings_changed",
      "files": [
        "frontend/src-tauri/src/scheduled_recording/service.rs",
        "frontend/src-tauri/src/scheduled_recording/settings.rs",
        "frontend/src-tauri/src/scheduled_recording/status_snapshot.rs",
        "frontend/src-tauri/src/logging/commands.rs",
        "frontend/src/services/healthHeartbeatService.ts",
        "frontend/src/services/healthHeartbeatService.test.ts"
      ],
      "deps": [
        "J6"
      ],
      "risk": "medium",
      "tdd": false,
      "suites": [
        "ts",
        "build",
        "telemetry"
      ],
      "verify": [
        "cd /c/maity_desktop/frontend/src-tauri && cargo test --lib scheduled_recording::status_snapshot",
        "cd /c/maity_desktop/frontend/src-tauri && cargo test --lib logging::commands",
        "cd /c/maity_desktop/frontend && node scripts/lint-telemetry.js",
        "cd /c/maity_desktop/frontend && npx vitest run src/services/healthHeartbeatService.test.ts"
      ],
      "criteria": [
        "AC-8",
        "AC-21"
      ],
      "commit": "feat(telemetria): configuración de jornada en device.profile y jornada.settings_changed (S1)"
    },
    {
      "id": "P1a",
      "title": "Estado real del autostart en canal directo",
      "files": [
        "frontend/src-tauri/src/autostart_state.rs",
        "frontend/src-tauri/src/utils.rs",
        "frontend/src-tauri/src/lib.rs",
        "frontend/src-tauri/src/logging/commands.rs",
        "frontend/src/services/healthHeartbeatService.ts"
      ],
      "deps": [
        "J7",
        "J1"
      ],
      "risk": "medium",
      "tdd": false,
      "suites": [
        "build"
      ],
      "verify": [
        "cd /c/maity_desktop/frontend/src-tauri && cargo test --lib autostart_state",
        "cd /c/maity_desktop/frontend/src-tauri && cargo test --lib utils::tests",
        "cd /c/maity_desktop/frontend/src-tauri && cargo test --lib logging::commands"
      ],
      "criteria": [
        "AC-9",
        "AC-21"
      ],
      "commit": "feat(telemetria): el autostart del canal directo distingue el apagado desde el Administrador de tareas (S1)"
    },
    {
      "id": "P1b",
      "title": "Fecha de instalacion del paquete en device.profile",
      "files": [
        "frontend/src-tauri/src/utils.rs",
        "frontend/src-tauri/src/rival_install.rs",
        "frontend/src-tauri/src/logging/commands.rs",
        "frontend/src/services/healthHeartbeatService.ts"
      ],
      "deps": [
        "P1a",
        "J1"
      ],
      "risk": "medium",
      "tdd": false,
      "suites": [
        "build"
      ],
      "verify": [
        "cd /c/maity_desktop/frontend/src-tauri && cargo test --lib utils::tests",
        "cd /c/maity_desktop/frontend/src-tauri && cargo test --lib logging::commands",
        "cd /c/maity_desktop/frontend/src-tauri && cargo test --lib rival_install"
      ],
      "criteria": [
        "AC-9",
        "AC-21"
      ],
      "commit": "feat(telemetria): package_installed_at en device.profile desde el paquete MSIX o la llave de desinstalacion NSIS (S1)"
    },
    {
      "id": "L1",
      "title": "Marcador de ciclo de vida app.start y app.resumed",
      "files": [
        "frontend/src-tauri/src/logging/telemetry/lifecycle.rs",
        "frontend/src-tauri/src/logging/telemetry/mod.rs",
        "frontend/src-tauri/src/logging/telemetry/panics.rs",
        "frontend/src-tauri/src/lib.rs"
      ],
      "deps": [
        "P1b",
        "P1a",
        "A2"
      ],
      "risk": "high",
      "tdd": false,
      "suites": [
        "build"
      ],
      "verify": [
        "cd /c/maity_desktop/frontend/src-tauri && cargo test --lib logging::telemetry::lifecycle",
        "cd /c/maity_desktop/frontend/src-tauri && cargo test --lib logging::telemetry::panics",
        "cd /c/maity_desktop/frontend && node scripts/lint-telemetry.js"
      ],
      "criteria": [
        "AC-10",
        "AC-21"
      ],
      "commit": "feat(telemetria): marcador de ciclo de vida con app.start y app.resumed (S1)"
    },
    {
      "id": "L2",
      "title": "app.exit con motivo y ExitRequested",
      "files": [
        "frontend/src-tauri/src/logging/telemetry/lifecycle.rs",
        "frontend/src-tauri/src/lib.rs",
        "frontend/src-tauri/src/tray.rs",
        "frontend/src-tauri/src/rival_install.rs"
      ],
      "deps": [
        "L1",
        "P1b"
      ],
      "risk": "high",
      "tdd": false,
      "suites": [
        "build"
      ],
      "verify": [
        "cd /c/maity_desktop/frontend/src-tauri && cargo test --lib logging::telemetry::lifecycle"
      ],
      "criteria": [
        "AC-11",
        "AC-21"
      ],
      "commit": "feat(telemetria): app.exit con motivo de salida y manejo de ExitRequested (S1)"
    },
    {
      "id": "E1",
      "title": "Tipo de fin de sesion de Windows via subclass",
      "files": [
        "frontend/src-tauri/src/session_end.rs",
        "frontend/src-tauri/src/lib.rs",
        "frontend/src-tauri/src/logging/telemetry/lifecycle.rs",
        "frontend/src-tauri/Cargo.toml"
      ],
      "deps": [
        "L2"
      ],
      "risk": "high",
      "tdd": false,
      "suites": [
        "build"
      ],
      "verify": [
        "cd /c/maity_desktop/frontend/src-tauri && cargo test --lib session_end",
        "cd /c/maity_desktop/frontend/src-tauri && cargo test --lib logging::telemetry::lifecycle"
      ],
      "criteria": [
        "AC-11",
        "AC-21"
      ],
      "commit": "feat(salida): tipo de fin de sesión de Windows vía subclass de la ventana main (S1)"
    },
    {
      "id": "E2a",
      "title": "Flush acotado de la grabacion para fin de sesion",
      "files": [
        "frontend/src-tauri/src/audio/recording_lifecycle.rs",
        "frontend/src-tauri/src/audio/recording_manager.rs",
        "frontend/src-tauri/src/audio/recording_saver.rs",
        "frontend/src-tauri/src/audio/incremental_saver.rs",
        "frontend/src-tauri/src/audio/recording_phase.rs"
      ],
      "deps": [
        "E1"
      ],
      "risk": "high",
      "tdd": false,
      "suites": [
        "build"
      ],
      "verify": [
        "cd /c/maity_desktop/frontend/src-tauri && cargo test --lib audio::incremental_saver",
        "cd /c/maity_desktop/frontend/src-tauri && cargo test --lib audio::recording_phase",
        "cd /c/maity_desktop/frontend/src-tauri && cargo test --lib audio::recording_saver"
      ],
      "criteria": [
        "AC-12",
        "AC-21"
      ],
      "commit": "feat(grabacion): flush acotado de la grabación para el fin de sesión de Windows (S1)"
    },
    {
      "id": "E2b",
      "title": "Fin de sesion de Windows no bloquea 30 s",
      "files": [
        "frontend/src-tauri/src/lib.rs",
        "frontend/src-tauri/src/session_end.rs",
        "docs/REGLAS_AUDIO_GRABACION.md"
      ],
      "deps": [
        "E2a",
        "E1"
      ],
      "risk": "high",
      "tdd": false,
      "suites": [
        "build"
      ],
      "verify": [
        "cd /c/maity_desktop/frontend/src-tauri && cargo test --lib session_end",
        "cd /c/maity_desktop/frontend/src-tauri && cargo test --lib logging::telemetry::lifecycle"
      ],
      "criteria": [
        "AC-12",
        "AC-23",
        "AC-21"
      ],
      "commit": "fix(grabacion): el fin de sesión de Windows ya no bloquea 30 s guardando la grabación (S1)"
    },
    {
      "id": "E3",
      "title": "Recuperacion tolera chunks truncados sin borrar audio",
      "files": [
        "frontend/src-tauri/src/audio/incremental_saver.rs",
        "frontend/src/hooks/useTranscriptRecovery.ts",
        "frontend/src/hooks/useTranscriptRecovery.test.ts"
      ],
      "deps": [
        "E2b",
        "E2a"
      ],
      "risk": "high",
      "tdd": false,
      "suites": [
        "ts",
        "build"
      ],
      "verify": [
        "cd /c/maity_desktop/frontend/src-tauri && cargo test --lib audio::incremental_saver",
        "cd /c/maity_desktop/frontend && npx vitest run src/hooks/useTranscriptRecovery.test.ts"
      ],
      "criteria": [
        "AC-13",
        "AC-21"
      ],
      "commit": "fix(grabacion): la recuperación tolera checkpoints truncados y ya no borra audio tras un merge fallido (S1)"
    },
    {
      "id": "U1",
      "title": "Comando direct_update_install para el update NSIS",
      "files": [
        "frontend/src-tauri/src/direct_update.rs",
        "frontend/src-tauri/src/lib.rs",
        "docs/CANALES_DISTRIBUCION.md"
      ],
      "deps": [
        "E3",
        "E2b",
        "L2",
        "A2"
      ],
      "risk": "high",
      "tdd": false,
      "suites": [
        "build"
      ],
      "verify": [
        "cd /c/maity_desktop/frontend/src-tauri && cargo test --lib direct_update",
        "cd /c/maity_desktop/frontend/src-tauri && cargo test --lib audio::recording_phase"
      ],
      "criteria": [
        "AC-14",
        "AC-11",
        "AC-23",
        "AC-21"
      ],
      "commit": "fix(updater): el update NSIS pasa por direct_update_install y cierra DB y sidecar antes del instalador (S1)"
    },
    {
      "id": "U2",
      "title": "Dialogo NSIS usa direct_update_install y respeta el post-proceso",
      "files": [
        "frontend/src/components/updates/UpdateDialog.tsx",
        "frontend/src/components/updates/UpdateDialog.test.tsx",
        "frontend/src/services/updateService.ts",
        "frontend/src/lib/postStopState.ts",
        "frontend/src/hooks/useRecordingStop.ts"
      ],
      "deps": [
        "U1"
      ],
      "risk": "high",
      "tdd": false,
      "suites": [
        "ts",
        "lint",
        "build"
      ],
      "verify": [
        "cd /c/maity_desktop/frontend && npx vitest run src/components/updates/UpdateDialog.test.tsx",
        "cd /c/maity_desktop/frontend && npx vitest run src/services/updateService.test.ts"
      ],
      "criteria": [
        "AC-14",
        "AC-21"
      ],
      "commit": "fix(updates): el dialogo NSIS instala por Rust y se niega con grabacion o post-proceso en curso (S1)"
    },
    {
      "id": "L3",
      "title": "Salidas por update de la Store registradas desde Rust",
      "files": [
        "frontend/src-tauri/src/logging/telemetry/lifecycle.rs",
        "frontend/src-tauri/src/lib.rs",
        "frontend/src-tauri/src/store_update.rs",
        "frontend/src/components/updates/UpdateDialog.tsx",
        "frontend/src/components/updates/UpdateDialog.test.tsx"
      ],
      "deps": [
        "U2",
        "U1",
        "E1"
      ],
      "risk": "high",
      "tdd": false,
      "suites": [
        "ts",
        "build"
      ],
      "verify": [
        "cd /c/maity_desktop/frontend/src-tauri && cargo test --lib logging::telemetry::lifecycle",
        "cd /c/maity_desktop/frontend && npx vitest run src/components/updates/UpdateDialog.test.tsx"
      ],
      "criteria": [
        "AC-15",
        "AC-11",
        "AC-21"
      ],
      "commit": "feat(store): salidas por update de la Store registradas desde Rust con exit_for_update (S1)"
    },
    {
      "id": "U4",
      "title": "ACL del updater solo check y fitness test",
      "files": [
        "frontend/src-tauri/tauri.conf.json",
        "frontend/src/components/updates/updaterInstall.fitness.test.ts"
      ],
      "deps": [
        "L3",
        "U2"
      ],
      "risk": "medium",
      "tdd": false,
      "suites": [
        "ts",
        "build"
      ],
      "verify": [
        "cd /c/maity_desktop/frontend && npx vitest run src/components/updates/updaterInstall.fitness.test.ts",
        "cd /c/maity_desktop/frontend && npx vitest run src/components/updates/UpdateDialog.test.tsx",
        "cd /c/maity_desktop/frontend && node scripts/lint-tauri-acl.js"
      ],
      "criteria": [
        "AC-14",
        "AC-21"
      ],
      "commit": "fix(updater): la capability solo permite check y un fitness test impide instalar desde JS (S1)"
    },
    {
      "id": "P2",
      "title": "autostart.changed contra linea base y aviso en Ajustes",
      "files": [
        "frontend/src-tauri/src/autostart_state.rs",
        "frontend/src-tauri/src/logging/telemetry/lifecycle.rs",
        "frontend/src-tauri/src/lib.rs",
        "frontend/src/hooks/useAutostartBootstrap.ts",
        "frontend/src/components/settings/PreferenceSettings.tsx"
      ],
      "deps": [
        "U4",
        "L3",
        "L1",
        "P1a"
      ],
      "risk": "medium",
      "tdd": false,
      "suites": [
        "ts",
        "build"
      ],
      "verify": [
        "cd /c/maity_desktop/frontend/src-tauri && cargo test --lib autostart_state",
        "cd /c/maity_desktop/frontend/src-tauri && cargo test --lib logging::telemetry::lifecycle",
        "cd /c/maity_desktop/frontend && node scripts/lint-telemetry.js"
      ],
      "criteria": [
        "AC-16",
        "AC-21"
      ],
      "commit": "feat(telemetria): autostart.changed contra la línea base del marcador y aviso del Administrador de tareas en Ajustes (S1)"
    },
    {
      "id": "S1",
      "title": "Logout del sidebar del chat pasa por logout_cleanup",
      "files": [
        "frontend/src/shared/components/shell-v5/SidebarFooterV5.tsx",
        "frontend/src/contexts/AuthContext.tsx",
        "frontend/src/contexts/authSignOut.fitness.test.ts",
        "docs/NUBE_CUENTAS_SYNC.md"
      ],
      "deps": [
        "P2"
      ],
      "risk": "high",
      "tdd": false,
      "suites": [
        "ts",
        "lint",
        "build"
      ],
      "verify": [
        "cd /c/maity_desktop/frontend && npx vitest run src/contexts/authSignOut.fitness.test.ts"
      ],
      "criteria": [
        "AC-17",
        "AC-21",
        "AC-23"
      ],
      "commit": "fix(auth): el logout del sidebar del chat pasa por logout_cleanup y guarda la grabacion (S1)"
    },
    {
      "id": "S2",
      "title": "Recargar el webview no suelta al usuario en Rust",
      "files": [
        "frontend/src/contexts/AuthContext.tsx",
        "frontend/src/lib/authRelease.ts",
        "frontend/src/lib/authRelease.test.ts"
      ],
      "deps": [
        "S1"
      ],
      "risk": "high",
      "tdd": false,
      "suites": [
        "ts",
        "lint",
        "build"
      ],
      "verify": [
        "cd /c/maity_desktop/frontend && npx vitest run src/lib/authRelease.test.ts"
      ],
      "criteria": [
        "AC-18",
        "AC-21"
      ],
      "commit": "fix(auth): recargar el webview ya no suelta al usuario en Rust (S1)"
    },
    {
      "id": "S3a",
      "title": "auth.logout desde logout_cleanup con flush",
      "files": [
        "frontend/src-tauri/src/logging/telemetry/auth.rs",
        "frontend/src-tauri/src/logging/telemetry/mod.rs",
        "frontend/src-tauri/src/lib.rs"
      ],
      "deps": [
        "S2",
        "A1",
        "A2",
        "L1",
        "J1"
      ],
      "risk": "high",
      "tdd": false,
      "suites": [
        "build"
      ],
      "verify": [
        "cd /c/maity_desktop/frontend/src-tauri && cargo test --lib logging::telemetry::auth"
      ],
      "criteria": [
        "AC-19",
        "AC-21"
      ],
      "commit": "feat(telemetria): auth.logout desde logout_cleanup con flush dirigido de su fila (S1)"
    },
    {
      "id": "S3b",
      "title": "signOut con superficie desde cada boton",
      "files": [
        "frontend/src/contexts/AuthContext.tsx",
        "frontend/src/components/settings/PreferenceSettings.tsx",
        "frontend/src/components/Sidebar/SidebarControls.tsx",
        "frontend/src/shared/components/shell-v5/SidebarFooterV5.tsx",
        "frontend/src/components/Onboarding/OnboardingAccountBadge.tsx",
        "frontend/src/app/(main)/layout.tsx"
      ],
      "deps": [
        "S3a",
        "S2",
        "S1",
        "P2"
      ],
      "risk": "medium",
      "tdd": false,
      "suites": [
        "ts",
        "lint",
        "build"
      ],
      "verify": [
        "cd /c/maity_desktop/frontend && npx vitest run src/contexts/authSignOut.fitness.test.ts"
      ],
      "criteria": [
        "AC-17",
        "AC-19",
        "AC-21"
      ],
      "commit": "feat(auth): signOut informa la superficie de cada boton de cerrar sesion (S1)"
    },
    {
      "id": "S4",
      "title": "auth.session_lost solo en perdidas reales",
      "files": [
        "frontend/src-tauri/src/logging/telemetry/auth.rs",
        "frontend/src-tauri/src/lib.rs",
        "frontend/src-tauri/src/database/commands.rs",
        "frontend/src/contexts/AuthContext.tsx",
        "frontend/src/lib/authSessionLost.ts",
        "frontend/src/lib/authSessionLost.test.ts"
      ],
      "deps": [
        "S3b",
        "S3a",
        "S2",
        "L1",
        "A1",
        "A2"
      ],
      "risk": "high",
      "tdd": false,
      "suites": [
        "ts",
        "lint",
        "build"
      ],
      "verify": [
        "cd /c/maity_desktop/frontend/src-tauri && cargo test --lib logging::telemetry::auth",
        "cd /c/maity_desktop/frontend && npx vitest run src/lib/authSessionLost.test.ts"
      ],
      "criteria": [
        "AC-19",
        "AC-21"
      ],
      "commit": "feat(telemetria): auth.session_lost solo cuando la sesion se pierde de verdad (S1)"
    },
    {
      "id": "S5",
      "title": "Sesion perdida a media grabacion guarda antes de soltar",
      "files": [
        "frontend/src-tauri/src/lib.rs",
        "frontend/src/contexts/AuthContext.tsx"
      ],
      "deps": [
        "S4",
        "S2",
        "J1"
      ],
      "risk": "high",
      "tdd": false,
      "suites": [
        "ts",
        "lint",
        "build"
      ],
      "verify": [
        "cd /c/maity_desktop/frontend && npx vitest run src/lib/authRelease.test.ts",
        "cd /c/maity_desktop/frontend && npx vitest run src/lib/authSessionLost.test.ts"
      ],
      "criteria": [
        "AC-20",
        "AC-3",
        "AC-21"
      ],
      "commit": "fix(auth): una sesion perdida a media grabacion guarda el segmento antes de soltar al usuario (S1)"
    },
    {
      "id": "Z1",
      "title": "Reglas en CLAUDE.md y TELEMETRIA reconciliada con el codigo",
      "files": [
        "CLAUDE.md",
        "docs/TELEMETRIA.md"
      ],
      "deps": [
        "S5",
        "A1"
      ],
      "risk": "low",
      "tdd": false,
      "suites": [
        "telemetry"
      ],
      "verify": [
        "cd /c/maity_desktop/frontend && node scripts/lint-telemetry.js"
      ],
      "criteria": [
        "AC-23",
        "AC-1",
        "AC-24"
      ],
      "commit": "docs(telemetria): CLAUDE.md apunta a las reglas nuevas de #83 y TELEMETRIA.md coincide con el código (S1)"
    }
  ]
}
```

## Parte A - Contrato de telemetria y drenado del outbox

### A1. Contrato de eventos 83 en catalogo y TELEMETRIA

Objetivo: registrar el contrato de telemetría de #83 ANTES de que exista código emisor (AC-1) y dejar en `docs/TELEMETRIA.md` la query "¿Por qué no grabó? — persona × día hábil", ya validada en prod (AC-22). Las demás tareas (J*, P*, L*, S*) programan contra lo que esta tarea escribe. Es una tarea de docs + constantes: no se escribe ningún emisor.

Pasos:

1. `frontend/src-tauri/src/logging/telemetry/catalog.rs`. Inserta un bloque nuevo DESPUÉS del bloque "Bundle de incidente" (hoy termina en la línea 58, `INCIDENT_UPLOAD_FAILED`) y ANTES del comentario "Guardado post-grabación" (línea 60). Deja una línea en blanco antes y otra después. Contenido exacto:
   ```rust
   // ── Ciclo de vida del proceso, sesión y jornada (emisor: Rust; #83, desde 0.2.62) ──
   pub const APP_START: &str = "app.start";
   pub const APP_EXIT: &str = "app.exit";
   pub const APP_RESUMED: &str = "app.resumed";
   pub const AUTOSTART_CHANGED: &str = "autostart.changed";
   pub const AUTH_LOGOUT: &str = "auth.logout";
   pub const AUTH_SESSION_LOST: &str = "auth.session_lost";
   pub const JORNADA_SETTINGS_CHANGED: &str = "jornada.settings_changed";
   pub const JORNADA_IDLE_REASON_CHANGED: &str = "jornada.idle_reason_changed";
   ```
   Una constante por línea y SIN `// legacy`: todos llevan punto. El `#![allow(dead_code)]` de la línea 18 cubre que todavía nadie las use.

2. `frontend/src/lib/telemetry-events.ts`. Pon el bloque gemelo dentro de `TELEMETRY_EVENTS`, DESPUÉS de `INCIDENT_UPLOAD_FAILED: 'incident.upload_failed',` (línea 55) y antes del comentario "Guardado post-grabación" (línea 57). Una entrada por línea, en el formato que parsea el lint (`CLAVE: 'valor',`). No reformatees el objeto:
   ```ts
     // ── Ciclo de vida del proceso, sesión y jornada (emisor: Rust; #83, desde 0.2.62) ──
     APP_START: 'app.start',
     APP_EXIT: 'app.exit',
     APP_RESUMED: 'app.resumed',
     AUTOSTART_CHANGED: 'autostart.changed',
     AUTH_LOGOUT: 'auth.logout',
     AUTH_SESSION_LOST: 'auth.session_lost',
     JORNADA_SETTINGS_CHANGED: 'jornada.settings_changed',
     JORNADA_IDLE_REASON_CHANGED: 'jornada.idle_reason_changed',
   ```

3. `docs/TELEMETRIA.md`. Todo en español y redactado como contrato ("desde 0.2.62"). Las líneas citadas son las actuales; hazlo de ABAJO hacia ARRIBA para que no se muevan.

   3a. **Cabecera (líneas 3-6).** Reemplaza la primera frase por `> Última actualización: 2026-09-23 (0.2.62, issue #83 "¿por qué no grabó?": ciclo de vida del proceso (\`app.start\`/\`app.exit\`/\`app.resumed\` + marcador en disco), estado de la jornada en el latido (\`idle_reason\`, bloque \`jornada\`) y en \`device.profile\`, \`autostart.changed\`, \`auth.logout\`/\`auth.session_lost\`, \`jornada.settings_changed\`/\`jornada.idle_reason_changed\` y la query persona × día). Antes: 2026-08-17 (ciclo v0.2.57 "fail-closed": …` y conserva el resto del párrafo original (contrato `ctx` + `install_id`, …, **contrato ejecutable**).

   3b. **Bloque nuevo en el inventario.** Va entre el final del bloque "Mantenimiento local" (línea 207) y `**App / salud — …**` (línea 209). Encabezado en negrita: `**Ciclo de vida del proceso, sesión y jornada — emisor Rust, outbox (desde 0.2.62, #83).**`. Una línea que diga que responden "¿por qué X no grabó el día Y?" (query más abajo), que TODOS van por el outbox nativo (`emit_event` → `recording_logs` → `drain.rs`) y que la columna `session_id` de todos es `context::process_session_id()` (`proc-…`). Después, una tabla `| event_type | Emisor | Cuándo | Payload clave |` con estas 8 filas (nombre entre backticks, lo exige el lint (f)):
   - `app.start`: `logging/telemetry/lifecycle.rs`; 1× por proceso, después del init de la DB; `status` `ok`, o `warning` si el proceso anterior terminó sucio. Payload: `lifecycle_schema` (1), `build`, `build_channel`, `started_at_boot`, `autostart_state`, `started_at`, `os_boot_at`, `first_run`, `marker_status` (`ok|missing|corrupt|foreign`), `prev_session_id`, `prev_version` (nunca `'unknown'`: `null`), `prev_version_source` (`marker|outbox|null`), `version_changed`, `prev_started_at`, `prev_last_alive_at`, `prev_uptime_s`, `prev_exit_reason`, `prev_exit_detail`, `prev_exit_source` (`observed|intent|inferred|null`), `prev_exit_clean` (`null` = sin marcador: primer arranque o upgrade desde una versión anterior a 0.2.62), `prev_exit_interrupted` (salida empezada y no terminada), `prev_recording_active_at_exit`, `prev_panicked`, `prev_panic_count`, `os_rebooted_since_prev`, `downtime_s`, `clock_skew`.
   - `app.exit`: `lifecycle.rs`, en cada salida registrada. Primero escribe el marcador en disco y después inserta en el outbox con un tope de 750 ms. En las salidas propias (bandeja, instalación rival, update) además hace `flush_row`. `status` `ok`. Payload: `lifecycle_schema`, `reason` (tabla de motivos abajo), `detail`, `exit_code`, `uptime_s`, `recording_active`, `recording_phase`, `session_end_kind`, `critical`, `build`.
   - `app.resumed`: ticker de 60 s de `lifecycle.rs`. Se emite cuando el reloj de pared saltó más de 180 s entre dos ticks (suspensión). `status` `ok`. Payload: `suspended_at`, `resumed_at` (rfc3339), `gap_s`.
   - `autostart.changed`: `autostart_state.rs::reconcile`. Se emite cuando `autostart_state` difiere de la línea base guardada en el marcador. En el primer arranque solo se fija la línea base, sin fila. `status` `ok`. Payload: `from`, `to`, `trigger` (`boot|settings_toggle|bootstrap`), `mechanism` (`startup_task|run_key|plugin`), `disabled_at`.
   - `auth.logout`: `logout_cleanup` (`lib.rs`) vía `logging/telemetry/auth.rs`. Cuando el usuario pide el logout, desde cualquier botón. Se inserta en el outbox y se hace `flush_row` de 3 s con el token de quien sale. `status` `ok`. Payload: `reason` (`"user"`), `surface` (`settings|sidebar|chat_sidebar|onboarding_badge|account_error|unknown`), `maity_user_id`, `recording_was_active`, `recording_phase`.
   - `auth.session_lost`: comando Rust que invoca el JS (outbox). Se emite ante un `SIGNED_OUT` que el usuario no pidió, o al arrancar sin sesión cuando había marca de login previo y el error NO es reintentable (una red caída nunca lo emite). `status` `warning`. Payload: `source` (`webview_signed_out|boot_no_session`), `maity_user_id`, `recording_was_active`, `error_name`.
   - `jornada.settings_changed`: `ScheduledRecordingService::update_settings` (`scheduled_recording/service.rs`, único punto de persistencia). Solo se emite si hay diff (la UI guarda dos veces por acción y eso deja una sola fila). `status` `ok`. Payload: `from`/`to` (`JornadaConfig`, ver `device.profile`) y `changed` (nombres de campo).
   - `jornada.idle_reason_changed`: el scheduler (`service.rs`). Se emite cuando cambia `idle_reason`, ignorando `pending`/`initializing`, con un tope de 200 por proceso. `status` `ok`. Payload: `from`/`to` (`idle_reason` o `null`), `recording_phase`, `jornada` (el bloque del latido). Es la línea de tiempo preferente de la query porque va por el outbox y sobrevive sin red.

   Debajo de la tabla, cuatro notas `>`:
   (i) `app.exit` se escribe al salir, pero se DRENA en el siguiente arranque tras el login. La hora real es `ctx.occurred_at`, nunca `created_at`.
   (ii) El marcador `lifecycle.json` (`lifecycle-debug.json` en debug), en `app_local_data_dir`, es la verdad. La fila es best-effort: si Windows mata el proceso antes del commit del outbox, el motivo viaja como `app.start.prev_exit_reason`.
   (iii) Las filas escritas sin sesión (antes del login) se atribuyen a quien inicie sesión después, porque el RPC resuelve `auth.uid()` al drenar. `auth.*` llevan `maity_user_id` en el payload para atribuirlas bien.
   (iv) Ninguno de estos eventos se emite desde JS con `platformLogger`.

   3c. **Fila `app.open`/`app.close` (línea 213).** Reemplázala por: `| \`app.open\` / \`app.close\` | \`app/(main)/layout.tsx\` (\`AppContent\`) | \`app.open\`: cada MONTAJE del documento main: el arranque **y cada recarga** (\`window.location.href\` al detener una grabación manual, \`reload()\` de ErrorBoundary/ChunkErrorRecovery/useConversationLive); un \`referrer\` no vacío delata la recarga. \`app.close\`: el primer \`onCloseRequested\`/\`beforeunload\`/\`pagehide\` del documento; la X **esconde a la bandeja**, el proceso sigue vivo. Prod, 30 días al 2026-09-23: 203 \`app.open\` (13 con referrer), 41 \`app.close\`, y 9 procesos siguieron emitiendo >10 min después de su \`app.close\`. **Ninguno es ciclo de vida del proceso: para eso \`app.start\`/\`app.exit\`.** | \`app.open\`: \`referrer\`, \`screen\`, \`viewport\`, \`language\` |`

   3d. **Fila `device.profile` (línea 215).** Cambia "Desde 0.2.59 (caso Dingler)" por "Desde 0.2.60 (en 0.2.59 solo el build piloto: 1 de 27 perfiles)". Conserva la parte de `signature_kind` y agrega después: "Desde 0.2.62 (#83): `jornada` = `null` o `JornadaConfig` `{enabled, configured_by_user, windows: [{days_of_week (ISO, 1 = lunes), start_time "HH:MM", end_time "HH:MM"}] (máx. 3), windows_count, auto_close_enabled, auto_close_time, hourly_rotation_enabled, grace_period_minutes}`, en hora LOCAL de la PC. El JS re-emite el perfil (sin fijar su latch) mientras `jornada` sea `null`, hasta 3 ticks. En canal directo `autostart_state` puede decir `disabledByUser` (Task Manager, `StartupApproved\Run`) con el mismo predicado que auto-launch 0.5.0. También: `autostart_disabled_at` (`null` o rfc3339), `autostart_mechanism` (`startup_task|run_key|plugin`), `package_installed_at` (`null` o rfc3339, instalada o ACTUALIZADA por última vez) y `package_installed_at_source` (`null|package|nsis_uninstall_key`)."

   3e. **Latido (jsonc de las líneas 260-289).** Dentro del objeto, antes de la `}` final (después de `"queue"`), agrega. Pon una coma al final de la línea de `"queue"` si hace falta para que el jsonc siga leyéndose como JSON:
   ```jsonc
     "idle_reason": null,         // desde 0.2.62, AMBOS emisores; dominio cerrado (tabla abajo). null = grabando/arrancando/deteniendo
     "jornada": null | {          // desde 0.2.62, AMBOS emisores; null = scheduler aún no inicializado
       "enabled": true, "configured_by_user": true, "loop_running": true,
       "scheduler_phase": "disabled | idle | armed | recording | grace",
       "in_window": true,         // pertenencia al horario; IGNORA enabled (igual que ScheduledStatus.in_window)
       "skip": null,              // SkipReason::as_str existentes + "closed_for_day"
       "rearm_cause": null,       // user_stop | auto_close | session_end, solo mientras el rearme está vigente
       "rearm_until": null,       // "YYYY-MM-DDTHH:MM:SS" en hora LOCAL de la PC
       "backoff": null,           // { "code": mic_not_found|mic_permission_denied|mic_in_use|mic_format_unsupported|audio_unknown, "consecutive": 1, "halted_for_day": false }
       "settings_load": "ok | missing | error"
     }
   ```
   Después de la nota `> El nativo tampoco lleva …` (líneas 291-292), agrega el subtítulo "**`idle_reason` — dominio cerrado (desde 0.2.62)**" y la tabla `| fase de grabación | condición | valor |`. Gana la primera fila que aplica. Filas, en este orden:
   - recording/starting/stopping, cualquier condición → `null`
   - paused → `paused_by_user`
   - idle, sin snapshot del scheduler → `initializing`
   - idle, `!enabled && !configured_by_user` → `jornada_unconfigured`
   - idle, `!enabled` → `jornada_off`
   - idle, `!loop_running` → `scheduler_stopped`
   - idle, rearme vigente con causa `session_end` → `session_ending`
   - idle, `!in_window` → `outside_window`
   - idle, skip `NoSession` → `no_session`
   - idle, skip `RegistrationIncomplete` → `no_registration`
   - idle, rearme vigente con causa `auto_close` → `closed_for_day`
   - idle, rearme vigente con causa `user_stop` → `stopped_by_user`
   - idle, `backoff.code` `mic_not_found` → `mic_not_found`
   - idle, `mic_permission_denied` → `mic_permission_denied`
   - idle, `mic_in_use` → `mic_in_use`
   - idle, backoff con otro code, o skip `TranscriptionNotReady`/`StartBackoff` → `start_failed`
   - idle, cualquier otro caso (skip `ManualInProgress` recién terminado, primer tick…) → `pending`

   Debajo, estas notas:
   - `transcription_not_ready` NO se usa en telemetría porque esconde `mic_in_use`. El string de la UI (`SkipReason::as_str`) no cambia.
   - Los 16 valores no nulos viven en `IDLE_REASONS` (`scheduled_recording/status_snapshot.rs`). Un valor nuevo exige una fila aquí y una rama en la query.
   - Desde 0.2.62 `stopped_by_user` y `closed_for_day` sobreviven al reinicio de la app. Salir, cerrar sesión y el apagado nunca escriben supresión a disco.

   3f. **Cardinalidad (párrafo de las líneas 386-392).** Después de "Que no sea la puerta para las otras 8." agrega: "Segunda excepción deliberada (0.2.62, #83): `idle_reason` y el bloque `jornada` del latido son estado DINÁMICO (cambian durante el día), y un perfil 1×/sesión no dice a qué hora dejó de grabar. El horario estático (días/horas) NO se repite en el latido: vive en `device.profile.jornada` y en `jornada.settings_changed`."

   3g. **Tabla de motivos de salida.** Justo antes de `### \`app.error\` (jul-2026)` (línea 327), agrega el subtítulo `### Motivos de salida (\`app.exit.reason\` y \`app.start.prev_exit_reason\`, desde 0.2.62)` y una tabla `| motivo | tipo | significado |`:
   - `tray_quit`, observado: "Salir" de la bandeja.
   - `rival_install`, observado: se instaló el otro canal (Store ↔ directo) y esta copia se desinstala.
   - `update`, observado o inferido: detail `store_button|store_api|nsis`; inferido cuando queda una intención de update pendiente.
   - `restart`, observado: `ExitRequested` con `RESTART_EXIT_CODE`.
   - `app_exit`, observado: `ExitRequested` `Some(code)` sin motivo propio.
   - `last_window_closed`, observado: `ExitRequested` `None`; es una regresión tipo 0.2.57 (la X mataba la app).
   - `os_session_end`, observado: cierre de sesión o apagado de Windows. Detail `logoff|shutdown|unknown`, más `critical`.
   - `external_close`, observado: Restart Manager `CLOSEAPP` SIN apagado del sistema (instalador/desinstalación).
   - `loop_destroyed`, observado: WM_QUIT u otra causa rara.
   - `process_exit_after_cleanup`, observado: centinela, el proceso salió sin `RunEvent::Exit`.
   - `crash_panic`, inferido: pánico en el hilo `main` durante la vida del proceso.
   - `os_restart_unclean`, inferido: cambió `os_boot` sin salida registrada (Fast Startup lo debilita).
   - `unclean`, inferido: matado ("Finalizar tarea"), crash nativo, "Apagar de todos modos".

   Debajo: "Precedencia al arrancar (`summarize_prev`): exit observado (si es `os_session_end`/`external_close` y hay intención `update`, gana `update` con el detail de sesión) → intención pendiente → `crash_panic` → `os_restart_unclean` → `unclean`. Las intenciones no caducan por edad."

   3h. **Queries nuevas.** Después del bloque ```sql de "¿La app se abre sola?" (cierra en la línea 573) y antes de "Top de errores por versión:" (línea 575), agrega la sección "**¿Por qué no grabó? — persona × día hábil (#83)**". Primero van las reglas de lectura, en una lista:
   - (a) La hora del evento es `coalesce(ctx.occurred_at, created_at)`: 295 filas desktop de 30 días (pre-0.2.57) no traen `occurred_at`, y `app.exit` se drena al día siguiente.
   - (b) La atribución es `user_id in (u.id, u.auth_id)`, pero `event_data->>'maity_user_id'` gana cuando existe (`auth.*`).
   - (c) Las versiones se comparan como `int[]`, nunca como texto.
   - (d) Dedupe por `(ctx.session_id, event_type, ctx.occurred_at)`.
   - (e) La línea de tiempo preferente es `jornada.idle_reason_changed`: va por el outbox, sobrevive sin red y se pondera en segundos dentro del día. Después vienen los latidos, porque el latido JS no se encola sin red.
   - (f) "Sesión de Maity cerrada" SOLO cuando hay `auth.logout`/`auth.session_lost` o `idle_reason='no_session'`. Nunca por "no hubo latido".
   - (g) Una causa explícita previa (logout, `tray_quit`, update) gana a "posible desinstalación". Esa etiqueta solo queda para ≥ 7 días de silencio hasta hoy sin ningún evento ni conversación posterior, y no se puede probar.
   - (h) El fallback de versión es `not ant_nueva`: la salida anterior a un día sin señal es de una versión sin eventos de salida.
   - (i) `days_of_week` solo cuenta si `windows_count = 1`. `in_window` ya considera todas las ventanas.
   - (j) Si el mismo proceso sigue vivo al día siguiente, o hay un `app.resumed` que cubre el día, la causa es "PC suspendida".
   - (k) En días que grabaron, `motivo_parcial` = `pausada` / `detenida por el usuario` / `cerrada temprano` (10 min o más en ese estado, o salida por la bandeja ese día).
   - (l) El día es CDMX, pero `in_window` se calcula en la PC con su propia hora local.
   - (m) Las causas posibles son: grabó, grabó parcial, jornada sin configurar, jornada apagada, fuera de horario, sin micrófono / permiso, pausada, detenida por el usuario, cerrada por el usuario, sesión de Maity cerrada, registro incompleto, PC apagada / suspendida / sin sesión de Windows, sin arranque con Windows, cerrada para actualizar, crash / cierre forzado, falla al arrancar, posible desinstalación, versión < 0.2.62 y silencio reciente. Hay además dos cajones residuales: "abierta sin grabar (…)" y "sin señal (causa no identificada)".
   - (n) Validada en prod el 2026-09-23 (solo SELECT) con Dingler, del 1 al 23 de sep: sin datos de 0.2.62 todo cae en los cajones legacy.

   Después, el SQL de abajo, EXACTO, en un bloque ```sql, y al final la frase: "Resumen por persona: envolverla en `select nombre, causa, count(*) from (…) q group by 1, 2 order by 1, 3 desc`."

SQL de la query (pegar tal cual):

```sql
with p as (
  select '<company_id>'::uuid company_id, 'America/Mexico_City'::text tz,
         date '2026-09-01' d_desde, date '2026-09-23' d_hasta,
         array[date '2026-09-16']::date[] feriados,   -- días inhábiles (16-sep, 3er lunes de nov, 25-dic…)
         array['karen','rita']::text[] excluir,       -- managers (ej. Dingler): nombre de pila en minúscula
         array[0,2,62] v_nueva,                       -- primera versión con los eventos de #83
         interval '30 days' lookback,                 -- cuánto mirar atrás para el último estado conocido
         interval '7 days' silencio_desinstalacion
),
team as (
  select u.id, u.auth_id, initcap(split_part(trim(u.first_name),' ',1)) nombre
  from maity.users u, p
  where u.company_id = p.company_id
    and lower(split_part(trim(u.first_name),' ',1)) <> all (p.excluir)
),
raw as (
  select l.id, l.user_id, l.event_type, l.event_data, l.app_version, l.created_at
  from maity.platform_logs l, p
  where l.platform = 'desktop'
    and l.created_at >= (p.d_desde::timestamp at time zone p.tz) - p.lookback
),
ev0 as (
  -- atribución: maity_user_id del payload (auth.*) gana a la columna user_id (RPC al drenar)
  select t.id uid, r.event_type et, r.event_data d,
         r.event_data->'ctx'->>'session_id' sid,
         coalesce((r.event_data->'ctx'->>'occurred_at')::timestamptz, r.created_at) ts,
         coalesce(string_to_array(substring(coalesce(nullif(r.app_version,'unknown'), r.event_data->'ctx'->>'app_version')
                  from '^[0-9]+\.[0-9]+\.[0-9]+'), '.')::int[], array[0]) >= p.v_nueva nueva,
         row_number() over (partition by t.id, r.event_data->'ctx'->>'session_id', r.event_type,
                                         r.event_data->'ctx'->>'occurred_at',
                                         case when r.event_data->'ctx'->>'occurred_at' is null then r.id end
                            order by r.id) rn
  from raw r cross join p
  join team t on case when r.event_data->>'maity_user_id' is not null
                      then r.event_data->>'maity_user_id' = t.id::text
                      else r.user_id in (t.id, t.auth_id) end
),
ev as (   -- dedupe por (ctx.session_id, event_type, ctx.occurred_at)
  select uid, et, d, sid, ts, nueva,
         case when et = 'jornada.idle_reason_changed' then d->>'to'
              when et = 'health.heartbeat' then d->>'idle_reason' end ir
  from ev0 where rn = 1
),
tl as (   -- línea de tiempo del motivo: transiciones del outbox, cortadas por arranques y salidas
  select uid, sid, ts s0, ir, lead(ts) over (partition by uid order by ts) s1
  from ev where et in ('jornada.idle_reason_changed', 'app.start', 'app.exit')
),
dias as (
  select d::date dia, (d::date::timestamp at time zone p.tz) t0,
         ((d::date + 1)::timestamp at time zone p.tz) t1, extract(isodow from d)::int dow
  from p, generate_series(p.d_desde, p.d_hasta, interval '1 day') d
  where extract(isodow from d) <= 5 and d::date <> all (p.feriados)
),
conv as (
  select c.user_id uid, (c.started_at at time zone p.tz)::date dia, count(*) n
  from maity.omi_conversations c join team t on t.id = c.user_id cross join p
  where c.started_at >= (p.d_desde::timestamp at time zone p.tz)
    and c.started_at <  ((p.d_hasta + 1)::timestamp at time zone p.tz)
    and not coalesce(c.deleted, false) and not coalesce(c.discarded, false)
  group by 1, 2
),
f as (
  select t.id uid, t.nombre, d.dia, d.dow, coalesce(cv.n, 0) conv_n, x.*, tw.*,
         ant.ts ant_ts, coalesce(ant.nueva, false) ant_nueva,
         hb_ant.ts hb_ant_ts, lo_ant.ts logout_ant_ts, ir_ant.ir ir_ant,
         coalesce(sig.d->>'prev_exit_reason',
                  case when sal_ant.et = 'app.exit' then sal_ant.d->>'reason' end) prev_salida,
         (vivo.x is not null) vivo_todo_el_dia, (susp.x is not null) suspendida,
         aut.estado autostart, jor.j horario, (post.x is not null) hay_senal_despues
  from team t cross join dias d
  left join conv cv on cv.uid = t.id and cv.dia = d.dia
  cross join lateral (
    select count(*) n_ev,
           count(*) filter (where e.et = 'recording_started') rec_started,
           count(*) filter (where e.et = 'recording.segment_discarded') seg_desc,
           count(*) filter (where e.et = 'health.heartbeat') hb,
           count(*) filter (where e.et = 'health.heartbeat' and e.d->>'phase' in ('recording','starting','stopping')) hb_rec,
           count(*) filter (where e.et = 'health.heartbeat' and e.d->>'phase' = 'paused') hb_pausa,
           mode() within group (order by e.ir)
             filter (where e.et = 'health.heartbeat' and e.ir not in ('pending','initializing')) motivo_hb,
           count(*) filter (where e.et = 'recording_start_failed'
                              and e.d->>'code' in ('mic_not_found','mic_permission_denied')) fallo_mic,
           count(*) filter (where e.et = 'recording_start_failed'
                              and coalesce(e.d->>'code','') not in ('mic_not_found','mic_permission_denied')) fallo_arranque,
           count(*) filter (where e.et in ('auth.logout','auth.session_lost')) logout,
           (array_agg(e.d->>'reason' order by e.ts desc) filter (where e.et = 'app.exit'))[1] salida_dia,
           count(*) filter (where e.et = 'app.start'
                              and e.d->>'prev_exit_reason' in ('unclean','crash_panic')) arranque_sucio,
           count(*) filter (where e.et = 'app.resumed') resumed,
           coalesce(bool_or(e.nueva), false) nueva
    from ev e where e.uid = t.id and e.ts >= d.t0 and e.ts < d.t1
  ) x
  left join lateral (   -- segundos por idle_reason dentro del día (solo tramos de un proceso vivo ese día)
    select (array_agg(z.ir order by z.secs desc))[1] motivo_tl,
           coalesce(sum(z.secs) filter (where z.ir = 'paused_by_user'), 0) s_pausa,
           coalesce(sum(z.secs) filter (where z.ir = 'stopped_by_user'), 0) s_detenida,
           coalesce(sum(z.secs) filter (where z.ir = 'closed_for_day'), 0) s_cerrada
    from (select s.ir, sum(extract(epoch from least(coalesce(s.s1, now()), d.t1) - greatest(s.s0, d.t0))) secs
          from tl s
          where s.uid = t.id and s.ir is not null and s.ir not in ('pending','initializing')
            and s.s0 < d.t1 and coalesce(s.s1, now()) > d.t0
            and (s.s0 >= d.t0 or exists (select 1 from ev e2 where e2.uid = t.id and e2.sid = s.sid
                                                        and e2.ts >= d.t0 and e2.ts < d.t1))
          group by s.ir) z
  ) tw on true
  left join lateral (select e.ts, e.nueva, e.sid from ev e where e.uid = t.id and e.ts < d.t0
                     order by e.ts desc limit 1) ant on true
  left join lateral (select max(e.ts) ts from ev e where e.uid = t.id and e.ts < d.t0
                       and e.et = 'health.heartbeat') hb_ant on true
  left join lateral (select max(e.ts) ts from ev e where e.uid = t.id and e.ts < d.t0
                       and e.et in ('auth.logout','auth.session_lost')) lo_ant on true
  left join lateral (select e.ir from ev e where e.uid = t.id and e.ts < d.t0
                       and e.et = 'jornada.idle_reason_changed' order by e.ts desc limit 1) ir_ant on true
  left join lateral (select e.et, e.d from ev e where e.uid = t.id and e.ts < d.t0
                       and e.et in ('app.start','app.exit') order by e.ts desc limit 1) sal_ant on true
  left join lateral (select e.d from ev e where e.uid = t.id and e.ts >= d.t0 and e.et = 'app.start'
                     order by e.ts limit 1) sig on true
  left join lateral (   -- el mismo proceso siguió vivo todo el día (mismo ctx.session_id después, o su marcador)
    select 1 x from ev e where e.uid = t.id and e.sid = ant.sid and e.ts >= d.t1
    union all
    select 1 from ev e where e.uid = t.id and e.et = 'app.start' and e.ts >= d.t1
      and e.d->>'prev_session_id' = ant.sid and (e.d->>'prev_last_alive_at')::timestamptz >= d.t1
    limit 1) vivo on true
  left join lateral (select 1 x from ev e where e.uid = t.id and e.et = 'app.resumed'
                       and (e.d->>'suspended_at')::timestamptz < d.t1
                       and (e.d->>'resumed_at')::timestamptz > d.t0 limit 1) susp on true
  left join lateral (select coalesce(e.d->>'to', e.d->>'autostart_state') estado from ev e
                     where e.uid = t.id and e.ts < d.t1
                       and (e.et = 'autostart.changed' or e.d ? 'autostart_state')
                     order by e.ts desc limit 1) aut on true
  left join lateral (select coalesce(e.d->'to', e.d->'jornada') j from ev e
                     where e.uid = t.id and e.ts < d.t1
                       and (e.et = 'jornada.settings_changed'
                            or (e.et = 'device.profile' and jsonb_typeof(e.d->'jornada') = 'object'))
                     order by e.ts desc limit 1) jor on true
  left join lateral (select 1 x from ev e where e.uid = t.id and e.ts >= d.t1
                     union all
                     select 1 from maity.omi_conversations c where c.user_id = t.id and c.started_at >= d.t1
                       and not coalesce(c.deleted, false)
                     limit 1) post on true
),
g as (
  select f.*, coalesce(motivo_tl, motivo_hb) motivo,
         case when s_pausa >= 600 or hb_pausa > 0 then 'pausada'
              when s_detenida >= 600 then 'detenida por el usuario'
              when s_cerrada >= 600 or salida_dia = 'tray_quit' then 'cerrada temprano'
         end motivo_parcial
  from f
)
select nombre, dia,
  case
    -- 1) grabó (parcial = pausada / detenida / cerrada temprano)
    when conv_n > 0 or seg_desc > 0 or rec_started > 0 or hb_rec > 0
      then case when motivo_parcial is null then 'grabó' else 'grabó parcial' end
    -- 2) sin ninguna señal ese día: una causa explícita previa gana a "posible desinstalación"
    when n_ev = 0 and (logout_ant_ts > coalesce(hb_ant_ts, '-infinity')
                       or (vivo_todo_el_dia and ir_ant = 'no_session')) then 'sesión de Maity cerrada'
    when n_ev = 0 and prev_salida = 'tray_quit' then 'cerrada por el usuario'
    when n_ev = 0 and prev_salida in ('update','rival_install') then 'cerrada para actualizar'
    when n_ev = 0 and (suspendida or vivo_todo_el_dia) then 'PC apagada / suspendida / sin sesión de Windows'
    when n_ev = 0 and not hay_senal_despues
         and (ant_ts is null or now() - ant_ts >= (select silencio_desinstalacion from p)) then 'posible desinstalación'
    when n_ev = 0 and prev_salida in ('os_session_end','os_restart_unclean')
      then case when autostart in ('enabled','enabledByPolicy') then 'PC apagada / suspendida / sin sesión de Windows'
                else 'sin arranque con Windows' end
    when n_ev = 0 and prev_salida is not null then 'crash / cierre forzado'
    when n_ev = 0 and not hay_senal_despues then 'silencio reciente'
    when n_ev = 0 and not ant_nueva then 'versión < 0.2.62'
    when n_ev = 0 then 'sin señal (causa no identificada)'
    -- 3) Maity corrió pero no grabó
    when motivo = 'jornada_unconfigured' then 'jornada sin configurar'
    when motivo = 'jornada_off' then 'jornada apagada'
    when motivo in ('outside_window','closed_for_day')
         or (coalesce((horario->>'windows_count')::int, 0) = 1
             and not coalesce(horario->'windows'->0->'days_of_week' @> to_jsonb(dow), true)) then 'fuera de horario'
    when motivo = 'no_session' or logout > 0 then 'sesión de Maity cerrada'
    when motivo = 'no_registration' then 'registro incompleto'
    when motivo in ('mic_not_found','mic_permission_denied') or fallo_mic > 0 then 'sin micrófono / permiso'
    when motivo = 'paused_by_user' or hb_pausa > 0 then 'pausada'
    when motivo = 'stopped_by_user' then 'detenida por el usuario'
    when salida_dia = 'tray_quit' then 'cerrada por el usuario'
    when motivo = 'session_ending' or salida_dia = 'os_session_end' or resumed > 0
      then 'PC apagada / suspendida / sin sesión de Windows'
    when salida_dia = 'update' then 'cerrada para actualizar'
    when arranque_sucio > 0 then 'crash / cierre forzado'
    when motivo in ('mic_in_use','start_failed','scheduler_stopped') or fallo_arranque > 0 then 'falla al arrancar'
    when not nueva then 'versión < 0.2.62'
    when hb = 0 then 'abierta sin grabar (sin latido: sin red)'
    else 'abierta sin grabar (causa no identificada)'
  end causa,
  motivo_parcial, motivo, conv_n, n_ev, hb, hb_rec, hb_pausa, fallo_mic, salida_dia, prev_salida, autostart
from g order by nombre, dia;
```

   3i. **Queries de `app.start`/`app.exit`.** Van inmediatamente después de la query anterior, con el título "Arranques y salidas por versión (#83):". Pégalas tal cual; también se validaron en prod y hoy devuelven 0 filas sin error:
   ```sql
   select app_version, count(*) arranques,
          count(*) filter (where (event_data->>'started_at_boot')::boolean) con_windows,
          count(*) filter (where (event_data->>'prev_exit_clean')::boolean is false) tras_cierre_sucio,
          string_agg(distinct event_data->>'prev_exit_reason', ', ') motivos_previos,
          count(*) filter (where (event_data->>'prev_panicked')::boolean) tras_panic,
          count(*) filter (where (event_data->>'version_changed')::boolean) tras_update,
          percentile_disc(0.5) within group (order by (event_data->>'downtime_s')::bigint) downtime_mediana_s
   from maity.platform_logs
   where platform = 'desktop' and event_type = 'app.start' and created_at > now() - interval '30 days'
   group by 1 order by 1 desc;

   select app_version, event_data->>'reason' motivo, event_data->>'detail' detalle, count(*) salidas,
          count(*) filter (where (event_data->>'recording_active')::boolean) grabando,
          percentile_disc(0.5) within group (order by (event_data->>'uptime_s')::bigint) uptime_mediana_s
   from maity.platform_logs
   where platform = 'desktop' and event_type = 'app.exit' and created_at > now() - interval '30 days'
   group by 1, 2, 3 order by 1 desc, 4 desc;
   ```

   3j. **Runbook nuevo.** Va después del runbook "un usuario reporta que Maity traba su máquina" (termina en la línea 596) y antes de `## Prevención` (línea 598). Título: `## Runbook: "un manager pregunta por qué X no grabó el día Y"`. Pasos:
   1. Correr la query de persona × día filtrada a esa persona.
   2. Si la causa es un cajón "sin señal": mirar el `app.start` siguiente (`prev_exit_reason`/`prev_exit_source`, `prev_version`, `downtime_s`, `started_at_boot`, `os_rebooted_since_prev`).
   3. Si es "crash / cierre forzado": buscar `app.error` con `source=rust-panic` del arranque siguiente.
   4. Si es "fuera de horario" o "jornada apagada": leer `jornada.settings_changed` (quién cambió qué y cuándo) y la línea de tiempo de `jornada.idle_reason_changed`.
   5. Si es "posible desinstalación": preguntarle al manager, porque nada en la nube lo prueba.
   6. Si es "versión < 0.2.62": usar la heurística vieja (latidos idle sin fallos = jornada apagada o sin horario; pausa y luego silencio = pausada; códigos de mic = micrófono).

   3k. **"Lo que NO existe todavía" (línea 608).** Agrega como PRIMER bullet: "**Desinstalación**: no hay evento. MSIX no ofrece hook y el uninstaller NSIS mata el proceso. Se infiere en la nube: silencio ≥ 7 días sin eventos ni conversaciones posteriores y sin causa explícita previa. Con `autostart_state=enabled` conocido es casi seguro, porque prender la PC abre Maity. Tampoco se distingue 'PC apagada' de 'no la abrió' cuando el arranque con Windows está apagado, ni quién usó una PC compartida (las filas sin sesión se atribuyen al siguiente login)."

   3l. **"Resueltos en el ciclo 0.2.62 (#83)".** Es un párrafo nuevo ANTES de "Resueltos en el ciclo sep-2026 (v0.2.60)" (línea 638), redactado como contrato ("desde 0.2.62"). Enumera: `app.start`/`app.exit`/`app.resumed` con marcador síncrono en disco; `idle_reason` y bloque `jornada` en ambos latidos y `jornada.idle_reason_changed` por el outbox; `device.profile.jornada` + `jornada.settings_changed`; autostart real en canal directo (`disabledByUser`) + `autostart.changed`; `package_installed_at`; `auth.logout` (todo botón pasa por `AuthContext.signOut` → `logout_cleanup`) y `auth.session_lost` solo en pérdidas reales; drenado del outbox por fila y flush dirigido. Z1 afina esta redacción al final contra el código real.

4. Corre el lint y confirma que dice OK con 36 eventos (28 + 8).

Tests:
- No hay tests nuevos: son constantes con `allow(dead_code)` y documentación. Evidencia: `cd /c/maity_desktop/frontend && node scripts/lint-telemetry.js` → `[lint-telemetry] OK` con 36 eventos. Los checks que toca son (b) espejo TS↔Rust, (c) naming con punto y (f) catálogo→doc con backticks.
- Build obligatorio (AC-21): `cd /c/maity_desktop/frontend && npm run tauri:build:debug` en background con log, exit 0. El pre-build corre lint-telemetry.

Registro de validación en prod (AC-22), 2026-09-23, `mcp__supabase__execute_sql`, solo SELECT:
- Corrió la query de persona × día (versión de arriba, con `company_id = f983ab57-c097-4637-a5cf-d24ecd6238c7` (Dingler), 2026-09-01..2026-09-23, feriado 16-sep, excluir karen y rita) envuelta en `select causa, count(*), count(distinct nombre) … group by 1`. Terminó sin error: 160 filas = 10 personas × 16 días hábiles. Reparto: posible desinstalación 94 (8 personas), versión < 0.2.62 45 (6), grabó 13 (5), grabó parcial 3 (3; latidos `paused` legacy), silencio reciente 2 (1), sin micrófono / permiso 2 (1), PC apagada / suspendida 1 (1; mismo `ctx.session_id` antes y después del día). Como se esperaba sin datos de 0.2.62, las ramas nuevas no disparan.
- Las dos queries de `app.start`/`app.exit` corrieron sin error y devolvieron `[]`.
- Las ramas nuevas (idle_reason, marcador, `app.resumed`, `maity_user_id`) quedan validadas solo sintácticamente. Se confirmarán con la matriz E2E (AC-24, `verify.md` manual[1] y manual[2]).

Importadores / consumidores conocidos:
- `frontend/scripts/lint-telemetry.js:92-110` parsea los catálogos con regex (`pub const \w+: &str = "…";` y `\w+:\s*'…',`), y `:218-225` hace el check (f).
- Nadie importa todavía las constantes nuevas. Las usarán J5 (`JORNADA_IDLE_REASON_CHANGED`), J7 (`JORNADA_SETTINGS_CHANGED`), L1 (`APP_START`, `APP_RESUMED`), L2 (`APP_EXIT`), P2 (`AUTOSTART_CHANGED`), S3a (`AUTH_LOGOUT`) y S4 (`AUTH_SESSION_LOST`).
- La skill web `piloto-analisis` (Q11) NO se edita. Va como issue de `Sixale730/maity`, fuera de la spec.

Trampas:
- No reformatees `telemetry-events.ts` a multilínea ni pongas ejemplos con el formato `CLAVE: 'x',` en comentarios: el lint los contaría como eventos.
- No escribas `// legacy` en las constantes nuevas (el check (b) exige que el marcador coincida en ambos lados).
- La palabra que empieza con "shut" y termina con "down" no puede aparecer en comandos Bash ni en el mensaje del commit. En el doc escribe "apagado".
- No toques `C:\maity` (repo web) ni `.claude/skills/piloto-analisis`.
- No documentes `rearming_next_hour`, `closed_for_today`, `window_close` ni `os_shutdown`: son nombres de borradores viejos. Manda el contrato de arriba.
- Pega el SQL completo tal cual, sin "arreglarlo": la versión validada es esa. Deja el placeholder `'<company_id>'` en el doc.

Resultado esperado: `lint-telemetry` OK con 36 eventos. TELEMETRIA.md documenta los 8 eventos con sus payloads, el `idle_reason` y el bloque `jornada` del latido, los campos nuevos de `device.profile`, los motivos de salida, la query de clasificación validada y el runbook. `app.open`/`app.close` queda descrito como montaje de documento y ventana a la bandeja.

Referencias:
- `docs/specs/telemetria-ciclo-vida-83/research/areas/spec-docs-sql-T5.md` (§1: base de la query y de las secciones; ojo, su §0 de nombres está SUPERADO por el contrato de arriba)
- `docs/specs/telemetria-ciclo-vida-83/research/areas2/verify-docs-sql-T5.md` (correcciones ya incorporadas en esta query)
- `docs/specs/telemetria-ciclo-vida-83/research/query-por-que-no-grabo.sql` (el mismo SQL, con `excluir` genérico)

### A2. Drenado por fila y flush dirigido del outbox

Objetivo: AC-2. Hoy `drain_once` (`logging/telemetry/drain.rs:49-131`) postea hasta 50 filas y las marca SOLO al final del lote (`:124-130`). Si el future se corta a media pasada, o un flush coincide con el loop, las filas que ya recibieron 2xx se postean dos veces, y el RPC no deduplica. Además no hay forma de subir UNA fila concreta (el `app.exit` o el `auth.logout` recién escritos) sin esperar el lote ni refrescar el token a mitad de una salida. Esta tarea deja la infraestructura que usan L2, L3, S3a y E2b: marcado por fila, reclamo de filas en curso, `flush_row` dirigido, `set_exiting()` y el rowid del outbox. Ningún emisor nuevo.

Pasos:

1. `frontend/src-tauri/src/database/repositories/recording_log.rs` (dentro de `impl RecordingLogRepository`):
   - `pub async fn get_by_id(pool: &SqlitePool, id: i64) -> Result<Option<RecordingLog>, SqlxError>` con `sqlx::query_as::<_, RecordingLog>("SELECT * FROM recording_logs WHERE id = ?").bind(id).fetch_optional(pool).await`.
   - `pub async fn last_app_version_excluding_session(pool: &SqlitePool, proc_session_id: &str) -> Result<Option<String>, SqlxError>`. La usará L1 como fallback de `prev_version` (`prev_version_source: "outbox"`). SQL exacto: `json_extract` revienta con texto que no es JSON y SQLite no garantiza cortocircuito en `OR`, por eso va el `CASE`:
     ```sql
     SELECT app_version FROM recording_logs
      WHERE app_version IS NOT NULL AND app_version <> ''
        AND coalesce(CASE WHEN json_valid(event_data)
                          THEN json_extract(event_data, '$.ctx.session_id') END, '') <> ?
      ORDER BY id DESC LIMIT 1
     ```
     Usa `sqlx::query_scalar::<_, String>(…).bind(proc_session_id).fetch_optional(pool).await`.
   - No toques `log_event`, que ya devuelve `last_insert_rowid()` (línea 35), ni `mark_as_synced` (`:78-100`) ni `get_unsynced_logs` (`:65-75`).

2. `frontend/src-tauri/src/cloud_sync/session.rs`:
   - Función pura `pub fn fresh_token(session: Option<&CloudSession>, now: i64) -> Option<String>`: devuelve `Some(access_token.clone())` solo si `decide_token_action(s.expires_at, now) == TokenAction::Reuse` (`:136-142`), y `None` en otro caso.
   - `pub async fn token_if_fresh<R: Runtime>(app: &AppHandle<R>) -> Option<String>`. Toma `let state = app.state::<CloudSyncState>();` y, en un statement propio, `let snap = state.session.read().await.clone();`. Devuelve `fresh_token(snap.as_ref(), now_epoch())`. NUNCA llama a `refresh()` ni a `get_valid_token` y no toca `refresh_lock`: cancelar un refresh a mitad de salida perdería el refresh_token rotado. Pon un doc-comment que lo diga.

3. `frontend/src-tauri/src/logging/telemetry/emit.rs`:
   - `write_to_outbox` (`:89-132`) pasa a devolver `Option<i64>`. `return;` sin AppState (`:103-110`) pasa a `return None;`, y el `Err` del `log_event` (`:126-128`) también a `None`. En el `Ok(id)` se hace `drain_notify().notify_one();` y se devuelve `Some(id)`. Reescribe el `if let Err(e) = …` como `match`.
   - Añade `pub async fn emit_event_with_id<R: Runtime>(app: &AppHandle<R>, session_id: &str, event_type: &str, payload: serde_json::Value, status: Option<TelemetryStatus>, error: Option<&str>, meeting_id: Option<&str>) -> Option<i64>`, con el mismo cuerpo que `emit_event` hoy (`:41-62`) devolviendo el resultado de `write_to_outbox`. Lleva `#[allow(clippy::too_many_arguments)]` y un doc-comment: "rowid del outbox para `drain::flush_row`; `None` = el evento NO quedó en el outbox".
   - `emit_event` conserva su firma exacta y delega: `let _ = emit_event_with_id(app, session_id, event_type, payload, status, error, meeting_id).await;`. `emit_webview_event` (`:67-86`) hace `let _ = write_to_outbox(…).await;`. Ningún llamador cambia.

4. `frontend/src-tauri/src/logging/telemetry/drain.rs`:
   - Estado global:
     - `static EXITING: AtomicBool = AtomicBool::new(false);`
     - `pub fn set_exiting() { EXITING.store(true, Ordering::SeqCst) }`, con el doc-comment "lo llama la salida del proceso (L2/E2b); desde ahí el loop no refresca ni postea; `flush_row` sigue funcionando".
     - `fn is_exiting() -> bool`.
     - Filas reclamadas: `HashSet::new` no es `const`, así que usa el patrón `OnceLock` de `emit.rs:22-28`: `static INFLIGHT: OnceLock<std::sync::Mutex<HashSet<i64>>>` y `fn inflight() -> &'static std::sync::Mutex<HashSet<i64>>`. Para tomar el lock, sin `.lock().unwrap()`: `let mut g = match inflight().lock() { Ok(g) => g, Err(p) => p.into_inner() };`. El lock nunca se mantiene a través de un `.await`.
   - Guard RAII `struct Claim(i64);`, con `fn try_claim(id: i64) -> Option<Claim>`. Inserta en el set y devuelve `None` si ya estaba. Su `impl Drop` quita el id del set.
   - Pura y testeable: `fn claim_in(set: &mut HashSet<i64>, id: i64) -> bool` (inserta y devuelve si era nueva). `try_claim` la usa.
   - `post_row` (`:135-175`) gana un parámetro `timeout: Option<Duration>`. Si viene, aplica `.timeout(d)` al `RequestBuilder` antes de `.send()`. El error pasa a ser un enum privado `enum PostFail { Http(u16), Network, Timeout }`: el error de `send()` da `PostFail::Timeout` si `e.is_timeout()` y `PostFail::Network` en otro caso, y una respuesta no-2xx da `PostFail::Http(status)`.
   - Extrae `fn rpc_url(session: &CloudSession) -> String` (`format!("{}/rest/v1/rpc/insert_platform_log", session.supabase_url.trim_end_matches('/'))`) y conserva el comentario del schema `public` (`:89-91`). `insert_platform_log` sigue apareciendo SOLO en drain.rs (lint (a)).
   - `drain_once` (`:49-131`), en este orden:
     - (0) `if is_exiting() { return; }` al entrar.
     - (1) Leer el lote igual que hoy.
     - (2) Snapshot de sesión igual que hoy. Antes de `get_valid_token`, vuelve a mirar `is_exiting()` y, si está puesto, sale.
     - (3) En el `for row in &rows`: `if is_exiting() { break; }`. Después `let Some(_claim) = try_claim(row.id) else { continue };`. Vuelve a leer la fila con `get_by_id`, y si es `Ok(Some(r))` con `r.synced_to_cloud`, `continue` (la subió un `flush_row` entre la lectura del lote y el reclamo). Luego `post_row(client, &url, &session.anon_key, &token, row, None)`.
     - (4) Con `Ok(())`, `RecordingLogRepository::mark_as_synced(pool, &[row.id]).await` INMEDIATAMENTE (con `Err` hace `log::warn!`) y suma a un contador.
     - (5) `Err(PostFail::Http(401 | 403))` y `Err(PostFail::Network | PostFail::Timeout)` hacen `break`, como hoy. `Err(PostFail::Http(s))` hace el `log::warn!` actual.
     - (6) Quita el `mark_as_synced` del final. El `log::debug!` de "N/M filas sincronizadas" usa el contador. El `_claim` se suelta al final de cada iteración, DESPUÉS del mark.
   - `#[derive(Debug, Clone, Copy, PartialEq, Eq)] pub enum FlushOutcome { Sent, AlreadySynced, NoSession, TokenStale, Timeout, Rejected(u16), Network }`. Documenta que `Rejected(0)` = fallo LOCAL: sin `AppState` o error de SQLite.
   - Pura: `fn outcome_from_post(r: Result<(), PostFail>) -> FlushOutcome`. `Ok` da `Sent`, `Http(s)` da `Rejected(s)`, `Network` da `Network` y `Timeout` da `Timeout`.
   - `pub async fn flush_row<R: Runtime>(app: &AppHandle<R>, id: i64, budget: Duration) -> FlushOutcome`. Usa `tokio::time::{Instant, sleep}`; `let deadline = Instant::now() + budget;`. NO mira `EXITING`, porque es justo el camino de salida.
     - a) `let Some(state) = app.try_state::<crate::state::AppState>() else { return FlushOutcome::Rejected(0) };` y `let pool = state.db_manager.pool();`.
     - b) Bucle:
       - `match get_by_id(pool, id).await`: `Err(_)` devuelve `Rejected(0)`; `Ok(None)` y `Ok(Some(r)) if r.synced_to_cloud` devuelven `AlreadySynced`.
       - `if let Some(c) = try_claim(id) { break (c, row) }`. Si la tiene el loop: `if Instant::now() >= deadline { return Timeout }`, `sleep(Duration::from_millis(50)).await` y vuelve a empezar, releyendo la fila porque el loop pudo marcarla.
     - c) Ya reclamada: `CloudSyncState::snapshot()` con `None` devuelve `NoSession`. `crate::cloud_sync::session::token_if_fresh(app).await` con `None` devuelve `TokenStale`.
     - d) `let remaining = deadline.saturating_duration_since(Instant::now()); if remaining.is_zero() { return Timeout }`. Postea con `post_row(&crate::api::HTTP, &rpc_url(&session), &session.anon_key, &token, &row, Some(remaining))`.
     - e) Con `Ok`, `mark_as_synced(pool, &[id])` (si falla: `warn!`; se acepta el duplicado en el próximo drenado) y `Sent`. Con cualquier otro resultado, `outcome_from_post(r)`. El claim se suelta al salir de la función, siempre DESPUÉS del mark.
   - Actualiza el doc del módulo (`:1-12`): marcado por fila tras cada 2xx, `INFLIGHT` (la fila la sube uno solo), `flush_row` sin refresh, `EXITING`.

Tests:
- `recording_log.rs`: añade `#[cfg(test)] mod tests` con `setup_pool()`, copiando `database/repositories/meeting.rs:505-515` (`SqlitePoolOptions::new().max_connections(1).connect(":memory:")` + `sqlx::migrate!("./migrations")`). No uses un SCHEMA a mano. Casos:
  - (1) `log_event` devuelve ids crecientes y `get_by_id` trae la fila con `synced_to_cloud == false`. `get_by_id(9999)` da `None`.
  - (2) `mark_as_synced(&[id])` y después `get_by_id` da `synced_to_cloud == true`.
  - (3) `last_app_version_excluding_session`. Inserta en orden: a) `{"ctx":{"session_id":"proc-old"}}` con versión `0.2.60`; b) `event_data` = `no es json` con `0.2.61`; c) `{"ctx":{"session_id":"proc-cur"}}` con `0.2.62`; d) una fila con `app_version` NULL. Con `"proc-cur"` devuelve `Some("0.2.61")`: gana la más nueva de otro proceso, tolera el no-JSON y salta el NULL.
  - (4) Si solo hay filas de `proc-cur`, devuelve `None`.
- `session.rs` (módulo `tests` existente, `:305`): `fresh_token(None, NOW)` da `None`. Con `expires_at = NOW + 1800` da `Some(token)`. Con `NOW + REFRESH_MARGIN_SECS` da `None`, el mismo borde que `refresca_dentro_del_margen_y_en_el_borde`. Un helper `fn sesion(expires_at) -> CloudSession` arma el struct.
- `drain.rs`: añade `#[cfg(test)] mod tests`, puro, sin red ni AppHandle:
  - `claim_in` sobre un `HashSet` local: el primer reclamo da `true` y el segundo del mismo id da `false`.
  - `try_claim(id)` da `Some`; un segundo `try_claim(id)` da `None`; tras `drop` del primero, `try_claim(id)` vuelve a dar `Some`. Usa ids altos únicos por test (p. ej. `9_000_001`) porque el set es global.
  - `outcome_from_post`: `Ok(())` da `Sent`, `Http(422)` da `Rejected(422)`, `Http(401)` da `Rejected(401)`, `Network` da `Network`, `Timeout` da `Timeout`.
  - NO llames a `set_exiting()` en tests: es global y terminal.
- Comandos:
  - `cd /c/maity_desktop/frontend/src-tauri && cargo test --lib logging::telemetry`
  - `cd /c/maity_desktop/frontend/src-tauri && cargo test --lib database::repositories::recording_log`
  - `cd /c/maity_desktop/frontend/src-tauri && cargo test --lib cloud_sync::session`
  - `cd /c/maity_desktop/frontend && node scripts/lint-telemetry.js`
  - Al final, `cd /c/maity_desktop/frontend && npm run tauri:build:debug` en background con log y `EXIT=$?`; tiene que dar exit 0 (el build no compila `#[cfg(test)]`).

Importadores / consumidores conocidos:
- `drain_once` tiene un solo llamador, `drain.rs:39` (`run`). `spawn` se cablea en `lib.rs`; no cambia.
- `emit_event` conserva la firma. Sus llamadores (no se tocan): `audio/audio_retention.rs:321`, `audio/recording_helpers.rs:623`, `audio/recording_lifecycle.rs:218` y `:523`, `audio/recording_saver.rs:468`, `audio/transcription/batch/planner.rs:602` y `:636`, `audio/transcription/engine.rs:336`, `coach/live_feedback.rs:1332`, `logging/incident.rs:205`, `:433` y `:525`, `logging/mem_sampler.rs:405`, `logging/rust_error_bridge.rs:406`, `logging/telemetry/panics.rs:99`, `scheduled_recording/service.rs:1365`. `emit_webview_event` lo usa `emit.rs:205` (`log_analytics_event`).
- `RecordingLogRepository::get_unsynced_logs`/`mark_as_synced` también los exponen los comandos de `database/commands.rs:364` y `:377`; no cambian.
- Consumidores futuros: L1 (`last_app_version_excluding_session`), L2/L3/E2b (`emit_event_with_id`, `flush_row`, `set_exiting`), S3a (`flush_row` de 3 s tras `auth.logout`).

Trampas:
- Nunca envuelvas `drain_once` en `tokio::time::timeout`. El marcado por fila lo hace tolerable, pero el diseño es que solo `flush_row` tenga deadline.
- El claim se suelta DESPUÉS de `mark_as_synced`, en los dos caminos. Si lo sueltas antes, el otro camino puede postear la misma fila.
- Relee la fila después de reclamarla, en `drain_once` y en `flush_row`. Sin esa relectura, una fila que el flush subió después de la lectura del lote se duplica.
- `std::sync::Mutex` del set: nunca `.lock().unwrap()`, y el guard nunca vive a través de un `.await` (tómalo y suéltalo dentro de `try_claim`/`Drop`). Del `RwLock` tokio de la sesión, saca el snapshot en un statement propio (`let snap = …read().await.clone();`), sin `if let` sobre el guard.
- `flush_row` no refresca el token. Si está vencido o a menos de 120 s de vencer, devuelve `TokenStale` y la fila sale en el próximo arranque.
- No uses `log::error!` en `logging/telemetry/*`: `warn!`/`debug!`.
- En esta tarea no llames `set_exiting()` desde ningún sitio: lo cablean L2/E2b.
- Lint (a): el literal `insert_platform_log` sigue solo en `drain.rs` (y `platformLogger.ts`).
- La palabra que empieza con "shut" y termina con "down" no puede aparecer en comandos ni en el commit.

Resultado esperado: cada fila se marca en cuanto recibe su 2xx. Un loop y un flush nunca postean la misma fila. `flush_row(app, id, budget)` sube una fila concreta con el token vigente, sin refresh, con deadline, y devuelve un `FlushOutcome` explícito. Con `set_exiting()` el loop deja de refrescar y postear. `emit_event_with_id` devuelve el rowid. El comportamiento visible de la telemetría no cambia.

Referencias:
- `docs/specs/telemetria-ciclo-vida-83/research/areas/spec-lifecycle-T2.md` §(f). Ojo: su `DRAIN_LOCK`/`flush_rows(ids)` quedó REEMPLAZADO por `INFLIGHT` + `flush_row(id)` del contrato.
- `docs/specs/telemetria-ciclo-vida-83/research/areas3/verify-lifecycle-T2.md` (EXITING y cola de 50 filas).
- `docs/specs/telemetria-ciclo-vida-83/research/areas2/verify-autostart-logout-T3-T4-B1.md` (drenado cancelado = duplicados; token sin refresh).
- `docs/specs/telemetria-ciclo-vida-83/research/plan-agent-review.md` #2.

## Parte J - Jornada: rearme, dia cerrado, persistencia y estado en la telemetria

### J1. Causa del rearme y retencion de fin de sesion

Objetivo: AC-3. Bug vivo: `logout_cleanup`, salir por la bandeja, `RunEvent::Exit` e instalación rival pasan por `graceful_shutdown_before_exit` (lib.rs:1833) → `close_owned_segment_for_exit` (service.rs:393-407) → `close_scheduled` (service.rs:782), y las TRES salidas de `close_scheduled` escriben `rearm_at = start_of_next_day(now)` (service.rs:810, 841, 899). Un logout+login el mismo día deja la jornada apagada hasta medianoche con el aviso "siguiente hora en punto". Esta tarea tipa la causa del rearme, hace que la ruta de salida NO escriba supresión de día y añade una retención en memoria `SessionEnd` que se pone ANTES del stop (el loop sigue haciendo ticks durante la salida: el runtime de tauri es multi-hilo) y se libera en cuanto no hay sesión.

Pasos:
1. `frontend/src-tauri/src/scheduled_recording/service.rs`, después de `impl SkipReason` (termina en L117), añadir los tipos (nombres FIJOS por contrato §1.8):
   ```rust
   /// Por qué no se debe (re)arrancar la jornada antes de `until`.
   #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
   #[serde(rename_all = "snake_case")]
   pub(crate) enum RearmCause { UserStop, AutoClose, SessionEnd }
   impl RearmCause {
       pub(crate) fn as_str(self) -> &'static str { /* "user_stop" | "auto_close" | "session_end" */ }
   }
   #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
   pub(crate) struct Rearm { pub(crate) until: NaiveDateTime, pub(crate) cause: RearmCause, pub(crate) set_at: NaiveDateTime }
   /// Quién pide el cierre del segmento propio.
   #[derive(Debug, Clone, Copy, PartialEq, Eq)]
   pub(crate) enum CloseTrigger { AutoClose, SessionEnd }
   /// Tope de la retención de fin de sesión (backstop si la sesión nunca se limpia).
   pub(crate) const SESSION_END_HOLD_MINUTES: i64 = 15;
   ```
   Constructores en `impl Rearm`: `user_stop(now)` (until = `schedule::next_hour_boundary(now)`), `auto_close(now)` (until = `start_of_next_day(now)` — J2 lo cambia), `session_end(now)` (until = `now + Duration::minutes(SESSION_END_HOLD_MINUTES)`); los tres ponen `set_at: now`. `Serialize/Deserialize` ya están importados (L16) y chrono tiene feature `serde`.
2. Funciones PURAS (junto a `start_of_next_day`, L713-718), sin `AppHandle`:
   - `fn rearm_for_close(trigger: CloseTrigger, now: NaiveDateTime) -> Option<Rearm>`: `AutoClose => Some(Rearm::auto_close(now))`, `SessionEnd => None` (la ruta de salida NO escribe rearme de día; deja intacta la retención que ya existe).
   - `fn should_release_hold(rearm: Option<Rearm>, has_session: bool, now: NaiveDateTime) -> bool`: `!has_session || rearm.map_or(true, |r| now >= r.until)`.
   - `fn rearm_after_external_stop(current: Option<Rearm>, session_ending: bool, now: NaiveDateTime) -> Option<Rearm>`: si `session_ending` y `current` es `Some` con causa `SessionEnd` ⇒ devuelve `current` (no pisar la retención); si no ⇒ `Some(Rearm::user_stop(now))`.
3. `SchedulerShared` (L240-276): renombrar `rearm_at: Arc<RwLock<Option<NaiveDateTime>>>` a `rearm: Arc<RwLock<Option<Rearm>>>` y añadir `session_ending: Arc<AtomicBool>` (`AtomicBool` ya importado, L10). Inicializarlos en `new()` (L264-275). Actualizar los doc-comments de L250-252 y L257-259 (mencionan `rearm_at` y `RearmingNextHour`): el rearme lleva causa; `SessionEnd` es solo memoria.
4. Escritores y lectores (todos en service.rs; grep `rearm_at` debe quedar en 0):
   - L597-606 (brazo `(false, Some(_))`): `let rearm = *shared.rearm.read().await;` (statement propio) y comparar `r.until`; mientras `now < r.until` sigue devolviendo `(Armed, Some(SkipReason::RearmingNextHour))` (J2 introduce el mapeo por causa). Al vencer, `*shared.rearm.write().await = None;`.
   - L669-677 (brazo `(false, None)`): igual, con `r.until`.
   - L689 (paro del usuario dentro de ventana): `let current = *shared.rearm.read().await;` y `*shared.rearm.write().await = rearm_after_external_stop(current, shared.session_ending.load(Ordering::SeqCst), now);`.
   - L939 (carrera de rotación, `Ok(false)` en `rotate_scheduled`): mismo patrón con `rearm_after_external_stop` (causa `UserStop`).
   - `close_scheduled` (L782): nueva firma `close_scheduled(app, shared, settings, owned_since, now, trigger: CloseTrigger)`. En L810, L841 y L899 sustituir la escritura por `if let Some(r) = rearm_for_close(trigger, now) { *shared.rearm.write().await = Some(r); }` (el `if let` es sobre un valor, no sobre un guard). Actualizar el comentario de L780-781 y L895 ("supresión del resto del día" solo con `AutoClose`).
   - Llamadores de `close_scheduled`: L547 (`evaluate_tick`, cierre por hora fija) pasa `CloseTrigger::AutoClose`; L405 (`close_owned_segment_for_exit`) pasa `CloseTrigger::SessionEnd`.
5. Métodos públicos nuevos en `impl ScheduledRecordingService` (firmas del contrato; son `async` porque el rearme vive en un tokio RwLock):
   - `pub async fn begin_session_end(&self)`: (a) `self.shared.session_ending.store(true, SeqCst)`; (b) `let cur = *self.shared.rearm.read().await;` (c) si `cur` es `None` o ya venció (`now >= until`) ⇒ `*self.shared.rearm.write().await = Some(Rearm::session_end(now))`; si ya es `SessionEnd` ⇒ no-op (idempotente, NO extender el tope); si es un `UserStop`/`AutoClose` vigente ⇒ se conserva (ya impide arrancar). Sin E/S de disco.
   - `pub async fn cancel_session_end(&self)`: `session_ending=false` y, si el rearme es `SessionEnd`, ponerlo en `None`.
6. `close_owned_segment_for_exit` (L393-407), orden OBLIGATORIO: `owned` → snapshot de `owned_since` (ya existe) → `self.begin_session_end().await` → `self.shared.owned.store(false, SeqCst)` (así un tick concurrente cae en `(false, Some)`/retención y nunca en el brazo de "paro externo") → leer settings → `close_scheduled(app, &self.shared, &settings, since, now, CloseTrigger::SessionEnd).await`. Actualizar el doc-comment (L390-392): nunca suprime el día.
7. `evaluate_tick` (L499), inmediatamente DESPUÉS del early return de `!settings.enabled` (L506-510) y ANTES del bloque de cierre por hora fija:
   ```rust
   if shared.session_ending.load(Ordering::SeqCst) {
       let rearm = *shared.rearm.read().await;               // statement propio
       let has_session = crate::state::has_session(app).await;
       if should_release_hold(rearm, has_session, now) {
           shared.session_ending.store(false, Ordering::SeqCst);
           if matches!(rearm, Some(r) if r.cause == RearmCause::SessionEnd) { *shared.rearm.write().await = None; }
           // y seguir con la evaluación normal de este mismo tick
       } else {
           return (SchedulerPhase::Armed, None);               // sin mutar nada, sin toast
       }
   }
   ```
   Con esto un logout+login reanuda en ≤1 tick: el primer tick sin sesión libera la retención y el siguiente con sesión arranca (promesa de L581-584).
8. `frontend/src-tauri/src/lib.rs`, `graceful_shutdown_before_exit` (L1833): PRIMERA sentencia, antes del `if !is_recording().await { return; }` de L1834:
   ```rust
   if let Some(state) = app.try_state::<scheduled_recording::commands::ScheduledRecordingState>() {
       let begun = tokio::time::timeout(std::time::Duration::from_millis(200), async {
           state.read().await.begin_session_end().await;
       }).await;
       if begun.is_err() { log::warn!("begin_session_end: el lock del scheduler no respondió en 200 ms; se sigue con la salida"); }
   }
   ```
   Nunca bloquear la salida. El resto de la función no cambia (el `close_owned_segment_for_exit` de L1838-1842 vuelve a llamar `begin_session_end`, que es idempotente).
9. `frontend/src-tauri/src/rival_install.rs` L104: `launch_detached_uninstaller(&info, std::process::id())?;` pasa a un `match`/`if let Err(e)`: si falla, `if let Some(state) = app.try_state::<crate::scheduled_recording::commands::ScheduledRecordingState>() { state.read().await.cancel_session_end().await; }` y `return Err(e);` (la app sigue viva y la jornada debe poder reanudar). `use tauri::Manager;` ya está en el bloque (L72).

Tests:
- Nuevo `#[cfg(test)] mod rearm_tests` en service.rs (`use super::*;`, helper `fn t(y,m,d,h,min) -> NaiveDateTime` como en `backoff_tests` L1837-1842):
  - `salida_nunca_produce_rearme_de_dia`: `rearm_for_close(CloseTrigger::SessionEnd, now) == None`; y para cualquier `now` de una tabla (09:00, 17:00, 23:59) nunca devuelve causa `AutoClose`.
  - `cierre_automatico_produce_auto_close`: `rearm_for_close(AutoClose, 17:00)` = `Some` con causa `AutoClose`, `set_at == now`, `until == start_of_next_day(now)`.
  - `retencion_se_libera_sin_sesion_o_al_vencer`: `should_release_hold(Some(Rearm::session_end(now)), false, now) == true`; con sesión y dentro del tope ⇒ `false`; con sesión a `now + 15 min` ⇒ `true`; `None` con sesión ⇒ `true`.
  - `paro_externo_no_pisa_la_retencion`: `rearm_after_external_stop(Some(session_end), true, now)` conserva `SessionEnd`; con `session_ending=false` ⇒ `UserStop` hasta `next_hour_boundary(now)`.
  - `rearm_cause_as_str` y round-trip serde: `serde_json::to_string(&RearmCause::AutoClose) == "\"auto_close\""`.
- Comandos: `cd /c/maity_desktop/frontend/src-tauri && cargo test --lib scheduled_recording::service` (línea base del módulo: 51 tests verdes, deben seguir verdes) y la suite `build`.

Importadores / consumidores conocidos:
- `rearm_at`: solo service.rs (L252, 271, 599, 604, 671, 674, 689, 810, 841, 899, 939) y `docs/ONBOARDING_Y_GATES.md:23` (lo actualiza J2).
- `close_scheduled`: L405 y L547. `close_owned_segment_for_exit`: lib.rs:1840.
- `graceful_shutdown_before_exit`: tray.rs:69, lib.rs:161 (`logout_cleanup`, L157-169), lib.rs:1795 (`RunEvent::Exit`), rival_install.rs:78.

Trampas:
- Contrato de locks de `SchedulerShared` (service.rs:233-239): jamás un guard vivo cruzando un `.await`; lecturas `let x = *lock.read().await;` en statement propio; nunca `if let Some(x) = *lock.read().await { ... }` (en edition 2021 el guard vive todo el bloque y `close_scheduled` escribe el mismo lock ⇒ deadlock del loop, ya pasó en 0.2.52).
- `.lock().unwrap()` prohibido.
- El nombre de la función de salida contiene la palabra bloqueada por el guard de shell: editar con Edit/Grep/Read, nunca en un comando Bash; el mensaje de commit dice "salir"/"fin de sesión".
- NO borrar la retención en memoria "porque el proceso muere": el loop sigue haciendo ticks durante `block_on` de `RunEvent::Exit` y entre `logout_cleanup` y `clear_current_user` (AuthContext.tsx:108-124); sin la retención arrancaría una grabación durante la salida.
- No persistir nada a disco aquí (eso es J4). No añadir eventos Tauri.
- Protocolo Guardian: la tarea toca lib.rs; la rama de respaldo la crea Julio antes de ejecutar la spec.

Resultado esperado: logout con la jornada grabando + login en el mismo proceso ⇒ el segmento se guarda y la jornada rearranca en ≤2 ticks (antes: suprimida hasta medianoche). Salir/apagar no deja rearme de día. `grep rearm_at` = 0 en el repo Rust. Build debug exit 0.

Referencias: `scratchpad/areas/verify-jornada-telemetry-B3.md` (#1), `scratchpad/areas2/verify-jornada-persist-B4.md` (#1, #4), `scratchpad/areas/verify-jornada-persist-B4.md` (#1), `scratchpad/plan-agent-review.md` (P0-1), `scratchpad/areas/spec-jornada-persist-B4.md` §5-§6 (bajo el contrato: la causa del paro de rotación es `UserStop`, no `RotationRace`).

**Ajustes del líder tras la refutación del plan (mandan sobre lo anterior si chocan):**
1. Bandera sin lock: además del campo, `pub(crate) static SESSION_ENDING: AtomicBool` a nivel de módulo en `service.rs` (hay una sola instancia del servicio) con `pub fn mark_session_ending()` / `pub fn clear_session_ending_flag()` SÍNCRONAS. `graceful_shutdown_before_exit` (lib.rs) llama `scheduled_recording::service::mark_session_ending()` como PRIMERA sentencia, ANTES del `begin_session_end` con timeout de 200 ms; `evaluate_tick`, `rearm_after_external_stop` y (en J4) `set_rearm` leen la bandera estática, no el campo. Así un timeout del RwLock nunca deja el flag en false (si no, el tick escribiría un UserStop que J4 persistiría).
2. Liberar la retención en la transición de sesión, no solo por muestreo del tick: archivo nuevo en la lista `frontend/src-tauri/src/database/commands.rs`. En `set_current_user`, dentro del ramo None→Some (`was_logged_out`), y al FINAL de `clear_current_user`: `if let Some(st) = app.try_state::<crate::scheduled_recording::commands::ScheduledRecordingState>() { let st = st.inner().clone(); let _ = tokio::time::timeout(Duration::from_millis(200), async move { st.read().await.cancel_session_end().await }).await; }` (snapshot del guard en statement propio). Ambos corren DESPUÉS de que `logout_cleanup`/`session_lost_cleanup` terminaron el stop, así que no reabren la ventana de arranque durante el guardado. Con esto un logout+login rápido reanuda la jornada en el siguiente tick (AC-3). Test puro adicional: la política de liberación (transición de sesión ⇒ liberar). Verificar con `cargo test --lib database::commands` además de `scheduled_recording::service`.
3. `cancel_session_end` también limpia la bandera estática.

### J2. Aviso de dia cerrado y turno nocturno

Objetivo: AC-4. (a) Tras el cierre automático DENTRO del horario (p. ej. cierre 17:00 con ventana 09-18) el arm en ventana convierte cualquier rearme en `SkipReason::RearmingNextHour`, cuyo mensaje promete "la siguiente hora en punto" (service.rs:98-100): falso. (b) El rearme de `AutoClose` dura hasta medianoche (`start_of_next_day`), así que un turno 22:00-06:00 que cierra a las 06:00 pierde 22:00-00:00 cada noche. Esta tarea añade `SkipReason::ClosedForDay`, elige el aviso por la causa del rearme (tipos de J1) y calcula el fin del `AutoClose` desde el horario.

Pasos:
1. `frontend/src-tauri/src/scheduled_recording/schedule.rs`: mover `fn start_of_next_day` desde service.rs:713-718 SIN cambios de lógica como `pub fn start_of_next_day(now: NaiveDateTime) -> NaiveDateTime` (junto a `next_hour_boundary`, L77-84; `Duration` ya se usa en el archivo). En service.rs borrar la definición y añadir `use super::schedule::start_of_next_day;` (lo usan `next_backoff` L210, `Rearm::auto_close` y `backoff_tests` vía `use super::*`).
2. service.rs, `SkipReason` (L60-117): añadir la variante `ClosedForDay` junto a `RearmingNextHour`; `as_str` ⇒ `"closed_for_day"`; `message` ⇒ `"La jornada de hoy ya se cerró; la grabación se reanudará en tu siguiente horario."` (texto EXACTO del contrato; no dice "mañana" ni "siguiente hora"). Los demás strings de `as_str` NO cambian (compatibilidad del evento `scheduled-recording-skipped`).
3. `impl RearmCause` (J1): añadir `fn skip_reason(self) -> Option<SkipReason>`: `AutoClose => Some(ClosedForDay)`, `UserStop => Some(RearmingNextHour)`, `SessionEnd => None` (inalcanzable en el arm porque la retención de J1 retorna antes; `None` = sin toast).
4. Arm en ventana `(false, Some(_))` (bloque del rearme, ~L597-606 tras J1): mientras `now < r.until` ⇒ `return (SchedulerPhase::Armed, r.cause.skip_reason());`. El arm de paro del usuario (~L686-692) sigue devolviendo `RearmingNextHour`.
5. Duración del `AutoClose`: `Rearm::auto_close` pasa a `fn auto_close(now: NaiveDateTime, settings: &ScheduledRecordingSettings) -> Rearm` con `until = schedule::next_fire_at(now, settings).unwrap_or(start_of_next_day(now))` (`next_fire_at`, schedule.rs:139-172, devuelve el primer inicio de ventana ESTRICTAMENTE posterior a `now`). `rearm_for_close` (J1) pasa a `rearm_for_close(trigger: CloseTrigger, now: NaiveDateTime, settings: &ScheduledRecordingSettings) -> Option<Rearm>`; `close_scheduled` ya recibe `settings` y lo pasa en sus tres salidas (~L810, L841, L899). Actualizar los tests de J1 en `rearm_tests` a la nueva firma.
6. `frontend/src/components/scheduled-recording/ScheduledRecordingSettings.tsx`, bloque de cierre automático: en el `<p className="text-xs text-muted-foreground">` de L336-339 (el del margen de gracia) añadir al final la frase "Tras el cierre, la jornada no vuelve a arrancar hasta tu siguiente horario." (o un `<p>` hermano con la misma clase). NO tocar el texto de L205-208 ("se reanuda a la siguiente hora en punto": correcto para el paro del usuario).
7. `docs/ONBOARDING_Y_GATES.md:23`: reescribir el bullet "No reusar `rearm_at`…" así: el rearme es `rearm: Option<Rearm { until, cause, set_at }>` con causa `user_stop` (paro del usuario o carrera de rotación, hasta la siguiente hora en punto → `RearmingNextHour`), `auto_close` (cierre por hora fija, hasta el siguiente inicio de ventana → `ClosedForDay`, "…se reanudará en tu siguiente horario") o `session_end` (retención solo en memoria de la salida/logout, ≤15 min, sin aviso); no reusarlo para el back-off.

Tests:
- `rearm_tests` (service.rs): `RearmCause::AutoClose.skip_reason() == Some(ClosedForDay)`, `UserStop` ⇒ `Some(RearmingNextHour)`, `SessionEnd` ⇒ `None`; `SkipReason::ClosedForDay.message()` NO contiene "siguiente hora en punto" y SÍ contiene "siguiente horario"; `as_str() == "closed_for_day"`; array local con TODAS las variantes de `SkipReason`: cada `as_str` no vacío y único.
- Tabla de `until` (`rearm_for_close(AutoClose, now, &settings)`), settings = `ScheduledRecordingSettings::default()` con `windows` explícitas (`ScheduleWindow { days_of_week, start_time, end_time }`, ISO 1=lunes vía `weekday_num` = `number_from_monday`, schedule.rs:24-26):
  - diurna L-V 09:00-18:00, cierre martes 2026-09-22 17:00 ⇒ miércoles 2026-09-23 09:00;
  - misma ventana, cierre viernes 2026-09-25 17:00 ⇒ lunes 2026-09-28 09:00;
  - nocturna todos los días 22:00-06:00, cierre martes 06:00 ⇒ martes 22:00 del MISMO día (ya no se come 22:00-00:00);
  - `windows` vacío ⇒ `start_of_next_day(now)`.
  - `SessionEnd` sigue devolviendo `None`.
- `schedule.rs` `mod tests` (L174): `start_of_next_day(dt(2026,6,29,23,30)) == dt(2026,6,30,0,0)` y `start_of_next_day(dt(2026,6,29,0,0)) == dt(2026,6,30,0,0)` (helper `dt` en L179).
- `backoff_tests` debe seguir verde sin tocarlo.
- Comando: `cd /c/maity_desktop/frontend/src-tauri && cargo test --lib scheduled_recording` + suite `build`.

Importadores / consumidores conocidos:
- `start_of_next_day`: service.rs:210 (`next_backoff`), :810/:841/:899 (vía `rearm_for_close`), `backoff_tests` (service.rs:1828).
- `SkipReason::message()`: solo `emit_skipped` (service.rs:1639-1647) → evento `scheduled-recording-skipped` → `ScheduledRecordingIndicator.tsx:33-36` (muestra solo `message`; no ramifica por `reason`).
- `next_fire_at`: service.rs:370 (`get_status`), :1628 (`emit_status`).

Trampas:
- `next_fire_at` itera 8 días; con ventanas cuyos `days_of_week` estén vacíos puede devolver `None` ⇒ el `unwrap_or(start_of_next_day)` es obligatorio.
- No cambiar el `as_str` de ninguna variante existente.
- Lock contract igual que J1 (snapshots en statement propio).
- La UI no usa i18n: texto en español directo; nada de `console.*`.

Resultado esperado: tras un cierre automático a las 17:00 dentro de 09-18 el toast dice "La jornada de hoy ya se cerró; la grabación se reanudará en tu siguiente horario."; un turno 22-06 cerrado a las 06:00 vuelve a grabar a las 22:00 del mismo día; el paro del usuario sigue diciendo "siguiente hora en punto".

Referencias: `scratchpad/areas/spec-jornada-telemetry-B3.md` (Commit 1), `scratchpad/areas/verify-jornada-telemetry-B3.md` (#2 turno nocturno), `scratchpad/areas2/verify-jornada-telemetry-B3.md` (#5).

### J3. Evaluar ahora evalua de inmediato

Objetivo: AC-5. "Evaluar ahora" (`SchedulerCommand::CheckNow`) llama `tick.reset()`, que en tokio 1.49.0 es `reset(Instant::now() + period)` (tokio-1.49.0/src/time/interval.rs:524-526): en vez de evaluar ya, POSPONE la evaluación un periodo entero (30 s). El usuario pulsa el botón, ve el toast "Evaluación de horario solicitada" (ScheduledRecordingSettings.tsx:159) y el `reload()` lee el estado viejo.

Pasos:
1. `frontend/src-tauri/src/scheduled_recording/service.rs`, `run_scheduler_loop`, brazo `SchedulerCommand::CheckNow` (L483-488): sustituir `tick.reset();` por `tick.reset_immediately();` (existe en tokio 1.49, interval.rs:556-558 = `reset(Instant::now())`). La línea anterior que limpia `start_backoff` NO cambia.
2. Actualizar el comentario del brazo: "Evaluar ahora" evalúa en el siguiente instante (el `reset()` de tokio suma un periodo completo; por eso `reset_immediately`).
3. No tocar el brazo `UpdateSettings` (L470-482): allí se recrea el `interval` solo si cambió `check_interval_seconds`, y un `interval` nuevo ya dispara de inmediato su primer tick.

Tests:
- No hay test de unidad razonable (requiere el loop con `AppHandle`). Evidencia del AC-5: `grep -n "reset_immediately" frontend/src-tauri/src/scheduled_recording/service.rs` muestra la línea dentro del brazo `CheckNow` y `grep -n "tick.reset()"` no devuelve nada.
- Comando de regresión: `cd /c/maity_desktop/frontend/src-tauri && cargo test --lib scheduled_recording` + suite `build`.

Importadores / consumidores conocidos:
- `check_now` (service.rs:381-388) ← comando `check_scheduled_recording_now` en `scheduled_recording/commands.rs` ← botón "Evaluar ahora" de `ScheduledRecordingSettings.tsx` (~L155-160).

Trampas:
- `reset_immediately` hace que el siguiente `tick.tick()` del `select!` resuelva ya; el tick corre `evaluate_tick` completo (incluida la retención de fin de sesión de J1), así que no se salta ningún gate.
- No cambiar la cadencia normal ni `MissedTickBehavior`.

Resultado esperado: tras pulsar "Evaluar ahora" la evaluación (y un eventual arranque de jornada) ocurre en milisegundos, no 30 s después.

Referencias: `scratchpad/areas/spec-jornada-telemetry-B3.md` (Report-only, CheckNow), `scratchpad/areas/verify-jornada-telemetry-B3.md` (Confirmed claims: tokio 1.49.0 reset vs reset_immediately).

### J4. Supresion de la jornada persistida entre reinicios

Objetivo: AC-6. El rearme vive solo en memoria (`SchedulerShared.rearm`, J1): si el usuario detiene la jornada a las 10:15 y la app se reinicia (update, crash, reinicio de Windows), la jornada rearranca sola antes de las 11:00 (problema de privacidad: quizá paró por una conversación privada), y tras un cierre automático reiniciar abre un segmento de overtime. Esta tarea persiste SOLO las causas `UserStop` y `AutoClose` en un archivo de runtime, con escritura atómica, validación pura al cargar y la garantía estructural de que salida/logout/apagado (`SessionEnd`) NUNCA tocan disco.

Pasos:
1. NUEVO `frontend/src-tauri/src/scheduled_recording/runtime_state.rs` (y `pub mod runtime_state;` en `scheduled_recording/mod.rs`, junto a los `pub mod` de L9-12):
   ```rust
   pub(crate) const RUNTIME_STATE_VERSION: u32 = 1;
   pub(crate) const FILE_NAME: &str = "scheduled_recording_runtime.json";
   const CLOCK_SKEW_TOLERANCE_MINUTES: i64 = 10;
   const AUTO_CLOSE_MAX_DAYS: i64 = 8;
   #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
   #[serde(rename_all = "snake_case")]
   enum PersistedCause { UserStop, AutoClose }          // SIN SessionEnd: irrepresentable en disco
   #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
   pub(crate) struct PersistedRearm { cause: PersistedCause, until: NaiveDateTime, set_at: NaiveDateTime }
   #[derive(Debug, Serialize, Deserialize)]
   struct RuntimeStateFile { version: u32, #[serde(default)] rearm: Option<PersistedRearm> }
   ```
   Formato: `{"version":1,"rearm":{"cause":"user_stop","until":"2026-09-23T11:00:00","set_at":"2026-09-23T10:17:42.123"}}` (NaiveDateTime local). Sin `deny_unknown_fields` (campos futuros aditivos).
   Funciones PURAS (usan `super::service::{Rearm, RearmCause}` de J1 y `super::schedule::next_hour_boundary`):
   - `pub(crate) fn persisted_projection(r: Option<&Rearm>) -> Option<PersistedRearm>`: `UserStop`/`AutoClose` ⇒ `Some`, `SessionEnd`/`None` ⇒ `None`.
   - `pub(crate) fn serialize_state(r: Option<&Rearm>) -> Option<String>`: `None` si la proyección es `None` (⇒ el archivo se BORRA); si no, el JSON `{version:1, rearm}`.
   - `pub(crate) enum RestoreOutcome { Restored(Rearm), Empty, Discard(&'static str), Ignore(&'static str) }` (`Discard` = borrar el archivo; `Ignore` = no usar y NO borrar).
   - `pub(crate) fn restore(content: &str, now: NaiveDateTime) -> RestoreOutcome`, en este orden: (1) serde falla (incluye `"cause":"session_end"` o cualquier causa desconocida) ⇒ `Discard("corrupt")`; (2) `version > RUNTIME_STATE_VERSION` ⇒ `Ignore("future_version")`; (3) `rearm` ausente ⇒ `Empty`; (4) coherencia: `UserStop` exige `until == next_hour_boundary(set_at)`; `AutoClose` exige `set_at < until && until <= set_at + 8 días`; si no ⇒ `Discard("inconsistent")`; (5) `now < set_at - 10 min` ⇒ `Discard("clock_moved_back")`; (6) `now >= until` ⇒ `Discard("expired")`; (7) `until - now > (until - set_at) + 10 min` ⇒ `Discard("clock_moved_back")`; (8) `Restored(Rearm { until, cause, set_at })`.
   E/S:
   - `pub(crate) fn state_path<R: Runtime>(app: &AppHandle<R>) -> anyhow::Result<PathBuf>`: `app.path().app_local_data_dir()` (Local, NO Roaming: es estado de esta máquina) + `std::fs::create_dir_all` + `join(FILE_NAME)`.
   - `pub(crate) async fn write_to_path(path: &Path, content: Option<String>) -> std::io::Result<()>`: `Some` ⇒ escribe `.<FILE_NAME>.tmp` en el mismo directorio y `tokio::fs::rename` sobre el destino (en Windows reemplaza al existente; patrón recording_saver.rs:625-631); `None` ⇒ `tokio::fs::remove_file` ignorando `NotFound`.
   - `pub(crate) async fn read_to_string_opt(path: &Path) -> Option<String>` (`NotFound` ⇒ `None`).
2. `frontend/src-tauri/src/scheduled_recording/service.rs`, `SchedulerShared` (L240-276): añadir `persist_lock: Arc<tokio::sync::Mutex<()>>` (Mutex PROPIO, fuera del contrato de RwLocks: puede cruzar el await de E/S) y `runtime_path: Arc<std::sync::OnceLock<std::path::PathBuf>>` (se fija en `initialize`; vacío en tests ⇒ solo memoria).
3. Helper ÚNICO escritor de `shared.rearm` (junto a `start_of_next_day`/`rearm_for_close`):
   ```rust
   async fn set_rearm(shared: &SchedulerShared, value: Option<Rearm>) {
       let prev = std::mem::replace(&mut *shared.rearm.write().await, value); // el guard muere en este statement
       if shared.session_ending.load(Ordering::SeqCst) { return; }            // NUNCA disco durante una salida
       if runtime_state::persisted_projection(prev.as_ref()) == runtime_state::persisted_projection(value.as_ref()) { return; }
       let Some(path) = shared.runtime_path.get().cloned() else { return; };
       let _io = shared.persist_lock.lock().await;
       if shared.session_ending.load(Ordering::SeqCst) { return; }            // re-check bajo el lock
       let snap = *shared.rearm.read().await;                                  // gana el último valor en memoria
       if let Err(e) = runtime_state::write_to_path(&path, runtime_state::serialize_state(snap.as_ref())).await {
           warn!("[scheduled] no se pudo persistir la supresión: {}", e);
       }
   }
   ```
   Si la E/S falla solo `warn!` (la memoria manda en este proceso).
4. Reemplazar TODA escritura directa `*shared.rearm.write().await = …` (las de J1/J2: arm en ventana al vencer, arm de reposo al vencer, paro del usuario, carrera de rotación, las tres salidas de `close_scheduled`, la liberación de la retención al inicio de `evaluate_tick`, `begin_session_end`, `cancel_session_end`) por `set_rearm(shared, …).await` (en los métodos: `set_rearm(&self.shared, …)`). Tras el cambio, `grep -n "rearm.write()" service.rs` solo debe aparecer dentro de `set_rearm`. Orden en `begin_session_end`: el `store(true)` del flag va ANTES del `set_rearm` (así la retención nunca borra el archivo); en `cancel_session_end` y en la liberación de J1 el flag se pone en `false` ANTES del `set_rearm(None)`: la proyección de `SessionEnd` y de `None` es la misma ⇒ sin E/S, y un `UserStop` persistido conservado durante la salida sigue en disco.
5. `initialize` (L303-308), después de cargar settings y ANTES de que exista el loop (el setup lo llama bajo `write()` antes de `start()`, lib.rs:1376-1391):
   ```rust
   let now = Local::now().naive_local();
   match runtime_state::state_path(app_handle) {
       Ok(path) => {
           let _ = self.shared.runtime_path.set(path.clone());
           if let Some(content) = runtime_state::read_to_string_opt(&path).await {
               match runtime_state::restore(&content, now) {
                   RestoreOutcome::Restored(r) => { info!("[scheduled] supresión restaurada: {} hasta {}", r.cause.as_str(), r.until); *self.shared.rearm.write().await = Some(r); }
                   RestoreOutcome::Empty => { let _ = runtime_state::write_to_path(&path, None).await; }
                   RestoreOutcome::Discard(why) => { warn!("[scheduled] estado de supresión descartado ({})", why); let _ = runtime_state::write_to_path(&path, None).await; }
                   RestoreOutcome::Ignore(why) => { warn!("[scheduled] estado de supresión ignorado ({}); no se borra", why); }
               }
           }
       }
       Err(e) => warn!("[scheduled] sin ruta para el estado de supresión: {}", e),
   }
   ```
   La asignación directa del `Restored` es la ÚNICA excepción a "set_rearm único escritor" (el disco ya coincide); documentarla con un comentario. Se restaura aunque `enabled=false`. NO se persiste `start_backoff` (reiniciar es un reintento legítimo). NO añadir `observe_stop_before_exit` (choca con la ventana stop→restart de la rotación).
6. `docs/ONBOARDING_Y_GATES.md`: nueva sección "## Supresión de la jornada persistida (0.2.62)" justo después de la sección "Back-off del arranque de jornada" (que termina en la línea del bullet "Preflight", ~L27-28): qué se persiste (`UserStop` hasta la siguiente hora en punto, `AutoClose` hasta el siguiente inicio de ventana) y qué NO (`SessionEnd`, back-off, ownership); dónde (`app_local_data_dir/scheduled_recording_runtime.json`; bajo MSIX va redirigido a LocalCache); formato y validación (corrupt/inconsistent/expired/clock_moved_back ⇒ se borra; future_version ⇒ se ignora sin borrar; tolerancia de reloj 10 min; `AutoClose` ≤ 8 días); regla "no revertir": **toda ruta de salida llama `begin_session_end()` ANTES de detener, y con `session_ending` puesto nada toca disco**; "Evaluar ahora" y guardar ajustes solo levantan el back-off, no la supresión; `catch_up_on_start` sigue sin lectores (la supresión manda).

Tests:
- `runtime_state.rs` `#[cfg(test)] mod tests` (puros, helper `t(y,m,d,h,min)`):
  - round-trip `UserStop` (set_at 10:17:42.5) ⇒ `Restored` con until 11:00 y `set_at` exacto; round-trip `AutoClose` con until = siguiente inicio de ventana.
  - `serialize_state(Some(&Rearm::session_end(now))) == None` y `serialize_state(None) == None`; JSON a mano con `"cause":"session_end"` ⇒ `Discard("corrupt")`.
  - vencido: user_stop de 10:17 restaurado a 11:00:00 ⇒ `Discard("expired")`.
  - inconsistente: user_stop con until = set_at + 3 h ⇒ `Discard("inconsistent")`; auto_close con until = set_at + 9 días ⇒ `Discard("inconsistent")`; auto_close con until <= set_at ⇒ `Discard("inconsistent")`.
  - reloj: set_at 2026-09-23 18:05 (auto_close) y now 2026-09-23 00:30 ⇒ `Discard("clock_moved_back")`; now = set_at − 2 min ⇒ `Restored`; now tres días antes ⇒ `Discard("clock_moved_back")`.
  - formato: "no es json" ⇒ `Discard("corrupt")`; `version: 2` ⇒ `Ignore("future_version")`; `{"version":1}` ⇒ `Empty`; campo desconocido extra ⇒ sigue `Restored`.
  - `#[tokio::test]` con `tempfile::tempdir()` (dev-dep, Cargo.toml:321): `write_to_path(Some)` crea el archivo y no deja `.tmp`; un segundo write lo reemplaza; `write_to_path(None)` lo borra; `write_to_path(None)` sin archivo es `Ok`.
- `rearm_tests` (service.rs): `persisted_projection` de `rearm_for_close(SessionEnd, …)` y de `Rearm::session_end(now)` es `None`; `#[tokio::test]` con un `SchedulerShared::new()` cuyo `runtime_path` apunta a un tempdir: con `session_ending=true`, `set_rearm(Some(Rearm::user_stop(now)))` NO crea archivo; con `session_ending=false` sí lo crea; luego `set_rearm(Some(Rearm::session_end(now)))` con flag puesto no lo borra.
- Comandos: `cd /c/maity_desktop/frontend/src-tauri && cargo test --lib scheduled_recording::runtime_state`, `… cargo test --lib scheduled_recording::service`, suite `build`.

Importadores / consumidores conocidos:
- `shared.rearm`: solo service.rs (escritores de J1/J2). `initialize`: lib.rs:1376-1380 (setup, bajo `write()`), `commands.rs:18` `initialize_scheduled_recording` (sin llamadores).
- `ScheduledRecordingIndicator.tsx:33-36` mostrará un toast con el mensaje de la causa restaurada en el primer tick con sesión (deseado: "Grabación de jornada detenida…" o "La jornada de hoy ya se cerró…").

Trampas:
- La invariante más cara: una supresión escrita desde la ruta de salida apagaría la jornada de la flota tras cualquier reinicio. Defensas: `PersistedCause` sin `SessionEnd`, `session_ending` comprobado dos veces en `set_rearm`, flag puesto ANTES de la retención.
- Contrato de locks: `std::mem::replace(&mut *shared.rearm.write().await, value)` en un statement propio; `persist_lock` es un Mutex aparte y nunca se toma sosteniendo un guard de los RwLock.
- `.lock().unwrap()` prohibido; `OnceLock::set` devuelve `Err` si ya estaba: ignorarlo (`let _ =`).
- Canales Store/NSIS no comparten AppData: el archivo es por canal; migraciones de DB no aplican (no hay DB aquí).
- El nombre de la función de salida de lib.rs contiene la palabra bloqueada del guard de shell: al citarla en el doc usar Edit, nunca Bash.

Resultado esperado: detener la jornada a hh:15 y reiniciar la app ⇒ no graba hasta hh+1:00 (log "supresión restaurada"); cierre automático + reinicio ⇒ no graba hasta el siguiente horario; salir/apagar/logout con la jornada grabando ⇒ no queda archivo con supresión y al volver rearranca en ≤30 s.

Referencias: `scratchpad/areas/spec-jornada-persist-B4.md` (diseño base), `scratchpad/areas/verify-jornada-persist-B4.md` (correcciones: `now >= set_at − 10 min`, future_version sin borrar, `app_local_data_dir`, quitar §8), `scratchpad/areas2/verify-jornada-persist-B4.md` (session_ending, disco solo si cambia la proyección).

### J5. Instantanea del scheduler e idle_reason con transiciones

Objetivo: AC-7 (parte del scheduler). Hoy nadie fuera del loop sabe por qué la jornada no graba: la razón de omisión vive solo en `prev_skip` (service.rs:432) y la telemetría no puede distinguir "fuera de horario" de "sin micrófono" o "el usuario la detuvo". Esta tarea publica el estado del scheduler en una ranura global (lectores sin tocar el RwLock del servicio), define la función pura `idle_reason` con el dominio cerrado de 16 valores (contrato §1.3), el bloque `jornada` (§1.2) y emite `jornada.idle_reason_changed` por el outbox en cada transición. J6 lo conecta al latido.

Pasos:
1. service.rs: `SkipReason` (L60-61) y su `as_str` pasan a `pub(crate)`; `StartFailureKind` (L143-144) a `pub(crate)`. `StartBackoff` (L176-188) gana `code: &'static str`; en `record_start_failure` (L1716-1762) calcularlo con `crate::audio::device_errors::classify_device_error(raw).code()` (valores `mic_permission_denied|mic_not_found|mic_in_use|mic_format_unsupported|audio_unknown`, device_errors.rs:89-97) y guardarlo en el literal de L1734. Si la causa cambia, el `code` es el del fallo actual. (`StartBackoff` solo se construye en L1734; `check_start_backoff` copia el valor.)
2. NUEVO `frontend/src-tauri/src/scheduled_recording/status_snapshot.rs` + `pub mod status_snapshot;` en `mod.rs`:
   ```rust
   #[derive(Debug, Clone)]
   pub(crate) struct Slot { gen: u64, settings: ScheduledRecordingSettings, settings_load: &'static str, loop_running: bool,
                 phase: SchedulerPhase, skip: Option<SkipReason>, rearm: Option<Rearm>, backoff: Option<BackoffView> }
   static SLOT: std::sync::Mutex<Option<Slot>> = std::sync::Mutex::new(None);   // patrón mem_sampler::LAST_SAMPLE (mem_sampler.rs:71)
   #[derive(Debug, Clone, Copy, PartialEq, Eq)]
   pub(crate) struct BackoffView { pub code: &'static str, pub consecutive: u32, pub halted_for_day: bool }
   ```
   Publicadores (`pub(super)`, locks SOLO para asignar/clonar, `if let Ok(mut g) = SLOT.lock()`, nunca `.unwrap()`):
   - `publish_settings(s: &ScheduledRecordingSettings, load: &'static str)`: crea la ranura si falta (`gen 0, loop_running false, phase Disabled`, resto `None`) y actualiza `settings`/`settings_load`; limpia `backoff` (espejo del `UpdateSettings` del loop, L480).
   - `begin_loop() -> u64`: `gen += 1`, `loop_running = true`; devuelve la generación.
   - `publish_stopped()`: `loop_running=false`, `phase=Disabled`, `skip=None`, `backoff=None`.
   - `publish_tick(gen: u64, phase, skip: Option<SkipReason>, rearm: Option<Rearm>, backoff: Option<BackoffView>)`: IGNORADO si `gen != slot.gen` o `!loop_running` (un tick tardío de un loop detenido no revive la fase).
   Vista y función pura:
   ```rust
   #[derive(Debug, Clone, PartialEq)]
   pub(crate) struct JornadaView { pub enabled: bool, pub configured_by_user: bool, pub loop_running: bool, pub phase: SchedulerPhase,
       pub in_window: bool /* schedule::active_window_at(now,&settings).is_some(): IGNORA enabled, igual que ScheduledStatus.in_window L371 */,
       pub skip: Option<SkipReason>, pub rearm: Option<Rearm> /* solo si now < until */, pub backoff: Option<BackoffView>, pub settings_load: &'static str }
   pub(crate) fn view_from_slot(slot: &Slot, now: NaiveDateTime) -> JornadaView   // pura (clonar la ranura bajo el lock, calcular fuera)
   pub(crate) fn idle_reason(rec: RecordingPhase, v: Option<&JornadaView>) -> Option<&'static str>   // PURA
   pub const IDLE_REASONS: &[&str] = &["paused_by_user","initializing","jornada_unconfigured","jornada_off","scheduler_stopped","session_ending",
       "outside_window","no_session","no_registration","closed_for_day","stopped_by_user","mic_not_found","mic_permission_denied","mic_in_use","start_failed","pending"];
   ```
   Tabla de `idle_reason` (primera fila que aplica gana; contrato §1.3): `Recording|Starting|Stopping` ⇒ `None`; `Paused` ⇒ `paused_by_user`; `Idle` y vista `None` ⇒ `initializing`; `!enabled && !configured_by_user` ⇒ `jornada_unconfigured`; `!enabled` ⇒ `jornada_off`; `!loop_running` ⇒ `scheduler_stopped`; rearme vigente `SessionEnd` ⇒ `session_ending`; `!in_window` ⇒ `outside_window`; skip `NoSession` ⇒ `no_session`; skip `RegistrationIncomplete` ⇒ `no_registration`; rearme vigente `AutoClose` ⇒ `closed_for_day`; rearme vigente `UserStop` ⇒ `stopped_by_user`; backoff code `mic_not_found`/`mic_permission_denied`/`mic_in_use` ⇒ ese mismo valor; backoff con otro code, o skip `TranscriptionNotReady`/`StartBackoff` ⇒ `start_failed`; cualquier otro caso (skip `ManualInProgress` recién terminado, primer tick…) ⇒ `pending`. `transcription_not_ready` NUNCA sale en telemetría (escondía `mic_in_use`).
   Bloque serializable (§1.2; todos los campos `pub` porque J6 construye literales en tests):
   ```rust
   #[derive(Debug, Clone, PartialEq, serde::Serialize)]
   pub struct JornadaTelemetry { pub enabled: bool, pub configured_by_user: bool, pub loop_running: bool,
       pub scheduler_phase: &'static str /* disabled|idle|armed|recording|grace */, pub in_window: bool,
       pub skip: Option<&'static str> /* SkipReason::as_str */, pub rearm_cause: Option<&'static str> /* solo si vigente */,
       pub rearm_until: Option<String> /* "%Y-%m-%dT%H:%M:%S" local */, pub backoff: Option<BackoffTelemetry>, pub settings_load: &'static str }
   #[derive(Debug, Clone, PartialEq, serde::Serialize)]
   pub struct BackoffTelemetry { pub code: &'static str, pub consecutive: u32, pub halted_for_day: bool }
   pub fn heartbeat_fields(rec: RecordingPhase, now: NaiveDateTime) -> (Option<&'static str>, Option<JornadaTelemetry>)
   ```
   `heartbeat_fields`: clona la ranura, construye la vista FUERA del lock, devuelve `(idle_reason(rec, vista), telemetría)`; ranura ausente ⇒ `(idle_reason(rec, None), None)`. `scheduler_phase` con un `match` exhaustivo; `SchedulerPhase::Stopping` no tiene escritores hoy (grep = 0): mapearlo a `"idle"` con un comentario.
3. Transiciones (`jornada.idle_reason_changed`): en status_snapshot.rs, `static LAST_EMITTED: std::sync::Mutex<(Option<Option<&'static str>>, u32)>` (último valor emitido, contador) y la función PURA `fn idle_transition(last: Option<Option<&'static str>>, current: Option<&'static str>) -> Option<(Option<&'static str>, Option<&'static str>)>`: `None` si `current` es `pending` o `initializing` (ni se emite ni reemplaza el último), o si `Some(current) == last`; si no ⇒ `Some((last.flatten(), current))`. `pub(super) fn take_idle_transition(rec, now) -> Option<serde_json::Value>`: calcula `heartbeat_fields`, aplica `idle_transition`, respeta el tope de 200 emisiones por proceso, actualiza `LAST_EMITTED` y devuelve el payload `{from, to, recording_phase: rec.as_str(), jornada: <JornadaTelemetry>}` (contrato §1.6).
   En service.rs, helper `fn spawn_idle_reason_emit<R: Runtime>(app: &AppHandle<R>)`: `let now = Local::now().naive_local(); let rec = crate::audio::recording_phase::current_phase(); if let Some(payload) = status_snapshot::take_idle_transition(rec, now) { let app = app.clone(); tauri::async_runtime::spawn(async move { crate::logging::telemetry::emit::emit_event(&app, crate::logging::telemetry::context::process_session_id(), crate::logging::telemetry::catalog::JORNADA_IDLE_REASON_CHANGED, payload, Some(crate::logging::telemetry::status::TelemetryStatus::Ok), None, None).await; }); }` (precedente de `emit_event` en service.rs:1365-1379; la constante la registró A1).
4. Llamadas de publicación en service.rs:
   - `initialize` (L303-308): cambiar `load_settings(app_handle).await.unwrap_or_default()` por un `match` que registre `settings_load`: `Err(e)` ⇒ `warn!` + default + `"error"`; `Ok` ⇒ `"ok"`, o `"missing"` si el archivo no existía (antes de cargar: `app_handle.path().app_config_dir().map(|d| d.join("scheduled_recording_settings.json").exists())`, mismo nombre que settings.rs:142). Tras escribir `shared.settings`: `status_snapshot::publish_settings(&settings, load)` y `spawn_idle_reason_emit(app_handle)`.
   - `start` (L311-327): `let gen = status_snapshot::begin_loop();` antes del `tokio::spawn` y pasar `gen` a `run_scheduler_loop(app_handle, shared, rx, gen)` (nuevo parámetro `gen: u64`); tras el spawn, `spawn_idle_reason_emit(&app_handle)` requiere clonar el handle ANTES del `move`.
   - `stop` (L330-338): tras `phase=Disabled`, `status_snapshot::publish_stopped()` (sin `AppHandle`: no emite; ver Trampas).
   - `update_settings` (L345-358): tras la escritura en memoria, `status_snapshot::publish_settings(&settings, "ok")` y `spawn_idle_reason_emit(app_handle)`.
   - Loop, tras `*shared.phase.write().await = new_phase;` (L450), en TODOS los ticks: `let rearm = *shared.rearm.read().await;` y `let backoff = *shared.start_backoff.read().await;` (statements propios) ⇒ `status_snapshot::publish_tick(gen, new_phase, skip, rearm, backoff.map(|b| BackoffView { code: b.code, consecutive: b.consecutive, halted_for_day: b.halted_for_day }));` ⇒ `spawn_idle_reason_emit(&app);`. `prev_skip` sigue igual (dedup del toast).

Tests:
- `status_snapshot.rs` `#[cfg(test)] mod tests` (funciones puras, sin tocar el `static` salvo un único `#[test]` serial):
  - una fila por cada entrada de la tabla §1.3 (incluidas: `Paused` con vista `None` ⇒ `paused_by_user`; `Idle` sin vista ⇒ `initializing`; fuera de ventana con rearme `AutoClose` ⇒ `outside_window`; retención `SessionEnd` fuera de ventana ⇒ `session_ending`; skip `TranscriptionNotReady` con backoff code `mic_in_use` ⇒ `mic_in_use`; skip `StartBackoff` con code `audio_unknown` ⇒ `start_failed`; skip `ManualInProgress` ⇒ `pending`); y un barrido que verifique que todo valor devuelto está en `IDLE_REASONS`, que `IDLE_REASONS.len() == 16`, sin duplicados y sin `transcription_not_ready`.
  - `view_from_slot`: `in_window` ignora `enabled`; `rearm` presente solo si `now < until`.
  - `idle_transition`: `pending`/`initializing` ⇒ `None`; valor igual al último ⇒ `None`; primer valor real ⇒ `Some((None, Some(v)))`; paso a grabación ⇒ `Some((Some(v), None))`.
  - un `#[test]` serial sobre el `static`: `publish_settings` + `begin_loop` + `publish_tick(gen_viejo, …)` ignorado; `publish_stopped` y luego `publish_tick(gen_actual, …)` ignorado.
- Comandos: `cd /c/maity_desktop/frontend/src-tauri && cargo test --lib scheduled_recording::status_snapshot`, `… cargo test --lib scheduled_recording::service`, `cd /c/maity_desktop/frontend && node scripts/lint-telemetry.js`, suite `build`.

Importadores / consumidores conocidos:
- Futuros: `logging/commands.rs::get_health_snapshot` (L345-372) y `logging/mem_sampler.rs::emit_native_heartbeat` (L377-414) en J6; `jornada_config()` en J7.
- `SkipReason` no se usa fuera de service.rs (el `SkipReason` de `audio/bluetooth_guard.rs:72` es OTRO tipo: no confundir en los `use`).
- `record_start_failure`: service.rs:661 (arranque) y :1025 (reinicio de rotación).

Trampas:
- Los lectores (heartbeats) NUNCA tocan `ScheduledRecordingState` (tokio RwLock justo: un escritor en cola bloquea lectores; lib.rs:1839-1840 lo retiene durante un cierre y commands.rs:64-70 lo toma de escritura).
- El `std::sync::Mutex` jamás se sostiene cruzando un `.await` ni se toma dentro de otro lock.
- `stop()` no tiene `AppHandle`: la transición a `jornada_off` la emite `update_settings`, que en `set_scheduled_recording_enabled` corre ANTES del `stop` (commands.rs:52-58).
- `emit_event` va en una task aparte desde `initialize`/`update_settings` (el caller retiene el lock exterior); en el loop también se usa el spawn para no retrasar el tick.
- Sin eventos Tauri nuevos; `.lock().unwrap()` prohibido.

Resultado esperado: `status_snapshot::heartbeat_fields` devuelve `idle_reason` y el bloque `jornada` coherentes con el scheduler en cada tick; en `maity.platform_logs` aparece una fila `jornada.idle_reason_changed` por transición real (p. ej. `outside_window` → `null` al arrancar la jornada, `null` → `stopped_by_user` al detenerla).

Referencias: `scratchpad/areas/spec-jornada-telemetry-B3.md` (Commit 2), `scratchpad/areas/verify-jornada-telemetry-B3.md` (#3 code en StartBackoff, #6 generación del loop), `scratchpad/areas2/verify-jornada-telemetry-B3.md`, `scratchpad/plan-agent-review.md` (P1-7, P1-8).

**Ajustes del líder tras la refutación del plan (mandan sobre lo anterior si chocan):**
1. `settings_load`: archivo nuevo en la lista `frontend/src-tauri/src/scheduled_recording/settings.rs`: exponer `pub fn settings_file_exists<R: Runtime>(app: &AppHandle<R>) -> bool` (reusa `get_settings_path`) en lugar de duplicar el nombre del archivo en service.rs; `initialize` publica `settings_load = ok|missing|error` con eso y con el resultado del parseo.
2. Sin filas espurias al arrancar: si `enabled && !loop_running && generación == 0` (el loop todavía no arrancó nunca en este proceso) la instantánea reporta `initializing` (no se emite como transición). Tras el primer `start()` (generación ≥ 1), `enabled && !loop_running` sí es `scheduler_stopped`. Test de tabla para la secuencia de arranque: initialize(enabled=true) ⇒ initializing (sin fila); start() ⇒ primer valor real emitido; stop() ⇒ scheduler_stopped/jornada_off.

### J6. idle_reason y bloque jornada en health.heartbeat

Objetivo: AC-7 (parte del latido). `health.heartbeat` (emisores JS y nativo) no dice por qué la jornada no graba. Esta tarea añade `idle_reason` (top-level, dominio de 16 valores) y el bloque `jornada` (contrato §1.2) a AMBOS emisores, usando `status_snapshot::heartbeat_fields` de J5 (sin `AppHandle`, sin tocar el lock del servicio).

Pasos:
1. `frontend/src-tauri/src/logging/commands.rs`, `HealthSnapshot` (L328-340): añadir
   ```rust
   /// Por qué no se graba (dominio cerrado `status_snapshot::IDLE_REASONS`); None = grabando.
   pub idle_reason: Option<&'static str>,
   /// Estado dinámico del scheduler de jornada (§1.2); None = scheduler aún no inicializado.
   pub jornada: Option<crate::scheduled_recording::status_snapshot::JornadaTelemetry>,
   ```
2. `get_health_snapshot` (L345-372): antes del `Ok(HealthSnapshot { … })`: `let rec = crate::audio::recording_phase::current_phase();` y `let (idle_reason, jornada) = crate::scheduled_recording::status_snapshot::heartbeat_fields(rec, chrono::Local::now().naive_local());`; en el literal usar `phase: rec.as_str()` (misma lectura que hoy, una sola vez) y los dos campos nuevos. La firma del comando NO cambia (sin `AppHandle`).
3. Los DOS literales de test en `mod health_snapshot_tests` (L485-554):
   - `health_snapshot_serializa_con_keys_esperadas` (L493-517): `idle_reason: Some("outside_window")`, `jornada: Some(JornadaTelemetry { enabled: true, configured_by_user: true, loop_running: true, scheduler_phase: "idle", in_window: false, skip: None, rearm_cause: None, rearm_until: None, backoff: Some(BackoffTelemetry { code: "mic_in_use", consecutive: 1, halted_for_day: false }), settings_load: "ok" })`. Asserts nuevos: `v["idle_reason"] == "outside_window"`, `v["jornada"]["scheduler_phase"] == "idle"`, `v["jornada"]["in_window"] == false`, `v["jornada"]["skip"].is_null()`, `v["jornada"]["backoff"]["code"] == "mic_in_use"`, `v["jornada"]["settings_load"] == "ok"`, y que el objeto `jornada` tiene EXACTAMENTE las 10 claves de §1.2 (enabled, configured_by_user, loop_running, scheduler_phase, in_window, skip, rearm_cause, rearm_until, backoff, settings_load) — mensaje: "espejo de healthHeartbeatService.ts y de docs/TELEMETRIA.md".
   - `health_snapshot_mem_none_serializa_null` (L535-548): `idle_reason: None, jornada: None`; asserts `v["idle_reason"].is_null()` y `v["jornada"].is_null()` (las claves existen con null, no desaparecen).
4. `frontend/src-tauri/src/logging/mem_sampler.rs`, `emit_native_heartbeat` (L377-414): antes del `json!`, `let (idle_reason, jornada) = crate::scheduled_recording::status_snapshot::heartbeat_fields(phase, chrono::Local::now().naive_local());` y en el payload, después de `"phase"`: `"idle_reason": idle_reason, "jornada": jornada,`. `phase` ya es el parámetro de la función.
5. `frontend/src/services/healthHeartbeatService.ts`:
   - Exportar `export interface JornadaTelemetry { enabled: boolean; configured_by_user: boolean; loop_running: boolean; scheduler_phase: string; in_window: boolean; skip: string | null; rearm_cause: string | null; rearm_until: string | null; backoff: { code: string; consecutive: number; halted_for_day: boolean } | null; settings_load: string }` (espejo de Rust).
   - `HealthSnapshot` (L75-84): añadir `idle_reason?: string | null` y `jornada?: JornadaTelemetry | null` (opcionales: tolera un Rust viejo en dev).
   - Exportar la función pura `export function jornadaHeartbeatFields(snapshot: { idle_reason?: string | null; jornada?: JornadaTelemetry | null }): { idle_reason: string | null; jornada: JornadaTelemetry | null }` que normaliza `undefined` a `null`.
   - En el payload de `platformLogger.log('health.heartbeat', …)` (L211-233), justo después de `phase: snapshot.phase,`: `...jornadaHeartbeatFields(snapshot),`. Comentario: son estado DINÁMICO (segunda excepción de cardinalidad, documentada en TELEMETRIA.md), no atributos estáticos; el horario estático va en `device.profile` (J7).
6. `frontend/src/services/healthHeartbeatService.test.ts`: importar `jornadaHeartbeatFields` en el import existente (L15-20) y añadir `describe('jornadaHeartbeatFields', …)` con: (a) un snapshot con `idle_reason: 'closed_for_day'` y un `jornada` completo pasa ambos tal cual; (b) un snapshot sin las claves (Rust viejo) da `{ idle_reason: null, jornada: null }`; (c) `idle_reason: null` (grabando) se conserva como `null`.

Tests:
- `cd /c/maity_desktop/frontend/src-tauri && cargo test --lib logging::commands` (los dos tests de `health_snapshot_tests` actualizados y verdes).
- `cd /c/maity_desktop/frontend && npx vitest run src/services/healthHeartbeatService.test.ts`.
- Suites `ts` (línea base 513 tests, debe subir) y `build`.

Importadores / consumidores conocidos:
- `HealthSnapshot` se construye en 3 lugares: commands.rs:364 (comando) y los dos tests (L493, L535). Único invoker JS de `get_health_snapshot`: `healthHeartbeatService.ts:181`.
- `emit_native_heartbeat` lo llama el loop del sampler (mem_sampler.rs:296-305), con gate `should_emit_native_heartbeat && has_session`.
- `JornadaTelemetry`/`BackoffTelemetry`/`heartbeat_fields`: `scheduled_recording/status_snapshot.rs` (J5).

Trampas:
- No leer `ScheduledRecordingState` desde aquí (el lock puede estar retenido segundos); solo `heartbeat_fields`.
- `phase` e `idle_reason` deben salir de la MISMA lectura de `current_phase()` para no contradecirse.
- Frontend: nada de `console.*` (usar `logger` si hiciera falta); `invoke` con claves camelCase (aquí no hay args).
- El JS vuelve a no emitir sin sesión (L178-179): no cambiar ese gate.
- No se añaden eventos nuevos: `lint-telemetry` no cambia.

Resultado esperado: en DevTools `await window.__TAURI__.core.invoke('get_health_snapshot')` (o el invoke equivalente) muestra `idle_reason` y `jornada`; las filas `health.heartbeat` (JS y `reason: native`) de `maity.platform_logs` llevan ambos campos.

Referencias: `scratchpad/areas/spec-jornada-telemetry-B3.md` (Commit 2: HealthSnapshot, native heartbeat, TS), `scratchpad/areas2/verify-jornada-telemetry-B3.md` (Confirmed claims: 3 literales, payload nativo propio).

### J7. Configuracion de jornada en device.profile y settings_changed

Objetivo: AC-8. La nube no sabe qué horario tiene configurado cada usuario ni cuándo lo cambió (p. ej. "apagó la jornada el martes"). Esta tarea proyecta la configuración de jornada (`JornadaConfig`, contrato §1.4) en `device.profile` (1× por sesión, con reintento acotado si el scheduler aún no publicó) y emite `jornada.settings_changed {from, to, changed}` desde el único punto de persistencia (`update_settings`), solo si cambió algo (el gate de activación llama dos veces con el mismo contenido).

Pasos:
1. `frontend/src-tauri/src/scheduled_recording/settings.rs` L97: añadir `PartialEq` al derive de `ScheduleWindow` (`#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]`).
2. `frontend/src-tauri/src/scheduled_recording/status_snapshot.rs` (creado en J5):
   ```rust
   #[derive(Debug, Clone, PartialEq, serde::Serialize)]
   pub struct JornadaConfig { pub enabled: bool, pub configured_by_user: bool,
       pub windows: Vec<ScheduleWindow> /* primeras 3; {days_of_week ISO 1=lunes, start_time "HH:MM", end_time "HH:MM"} */,
       pub windows_count: usize, pub auto_close_enabled: bool, pub auto_close_time: String,
       pub hourly_rotation_enabled: bool, pub grace_period_minutes: u32 }
   impl From<&ScheduledRecordingSettings> for JornadaConfig { /* windows.iter().take(3).cloned().collect(), windows_count = windows.len() */ }
   pub fn jornada_config() -> Option<JornadaConfig>            // desde SLOT.settings (None = scheduler sin inicializar)
   pub(crate) fn changed_fields(a: &JornadaConfig, b: &JornadaConfig) -> Vec<&'static str>   // PURA, orden de declaración
   ```
   Excluidos a propósito: `notify_on_start`, `respect_manual_recording` y `catch_up_on_start` (sin lectores), `check_interval_seconds`, `meeting_name_template` (texto libre) y `settings_schema_version`. Horas en hora LOCAL de la PC. `changed_fields` compara campo por campo y devuelve los nombres (`"enabled"`, `"configured_by_user"`, `"windows"`, `"windows_count"`, `"auto_close_enabled"`, `"auto_close_time"`, `"hourly_rotation_enabled"`, `"grace_period_minutes"`).
3. `frontend/src-tauri/src/scheduled_recording/service.rs`, `update_settings` (L345-358 + publicación de J5): tras `save_settings(…)?` (si falla: sin evento), calcular el diff BAJO el write guard y soltarlo antes de emitir:
   ```rust
   let (from, to) = {
       let mut guard = self.shared.settings.write().await;
       let from = status_snapshot::JornadaConfig::from(&*guard);
       *guard = settings.clone();
       (from, status_snapshot::JornadaConfig::from(&settings))
   };                                                             // guard soltado aquí
   // publish_settings + spawn_idle_reason_emit de J5 siguen aquí
   let changed = status_snapshot::changed_fields(&from, &to);
   if !changed.is_empty() {
       let app = app_handle.clone();
       tauri::async_runtime::spawn(async move {   // el caller retiene el read() exterior (commands.rs:41, 56)
           crate::logging::telemetry::emit::emit_event(&app, crate::logging::telemetry::context::process_session_id(),
               crate::logging::telemetry::catalog::JORNADA_SETTINGS_CHANGED,
               serde_json::json!({ "from": from, "to": to, "changed": changed }),
               Some(crate::logging::telemetry::status::TelemetryStatus::Ok), None, None).await;
       });
   }
   ```
   El `tx.send(UpdateSettings)` del final no cambia. La constante `JORNADA_SETTINGS_CHANGED` la registró A1 (catalog.rs + telemetry-events.ts + TELEMETRIA.md).
4. `frontend/src-tauri/src/logging/commands.rs`, `DeviceProfile` (L399-424): añadir `/// Configuración de jornada al emitir (1× por sesión; cambios vía jornada.settings_changed). None = scheduler aún no inicializado. Desde 0.2.62.` `pub jornada: Option<crate::scheduled_recording::status_snapshot::JornadaConfig>,` y en `get_device_profile` (L454-482) `jornada: crate::scheduled_recording::status_snapshot::jornada_config(),`. `logging/incident.rs` serializa el perfil entero en el bundle con consentimiento: viaja solo, sin cambios.
5. `frontend/src/services/healthHeartbeatService.ts`:
   - `export interface JornadaConfig { enabled: boolean; configured_by_user: boolean; windows: { days_of_week: number[]; start_time: string; end_time: string }[]; windows_count: number; auto_close_enabled: boolean; auto_close_time: string; hourly_rotation_enabled: boolean; grace_period_minutes: number }` y en `DeviceProfile` (L108-122) `jornada?: JornadaConfig | null`.
   - `export const DEVICE_PROFILE_MAX_EMITS = 3` y la función pura `export function shouldLatchDeviceProfile(profile: { jornada?: unknown | null }, emits: number): boolean` = `profile.jornada != null || emits >= DEVICE_PROFILE_MAX_EMITS`.
   - Latch (L133-135 y L189-197): añadir `private deviceProfileEmits = 0`; tras `void platformLogger.log('device.profile', { ...this.deviceProfile })` hacer `this.deviceProfileEmits += 1` y `this.deviceProfileEmitted = shouldLatchDeviceProfile(this.deviceProfile, this.deviceProfileEmits)` (mientras `jornada` sea null se re-emite en los ticks siguientes, máx. 3 filas por proceso; `performance_tier` del latido sigue leyendo `this.deviceProfile`).

Tests:
- `status_snapshot.rs` tests: `changed_fields` de configs idénticas ⇒ `[]` (el diff guard del doble llamado del gate); toggle de `enabled` ⇒ `["enabled"]`; editar `windows[0].end_time` ⇒ `["windows"]`; activar el gate (`enabled` + `configured_by_user`) ⇒ `["enabled","configured_by_user"]`; `JornadaConfig::from` con 5 ventanas ⇒ `windows.len()==3` y `windows_count==5`; claves serializadas EXACTAS (golden: las 8 de §1.4) y `windows[0]` con `days_of_week/start_time/end_time`.
- `logging::commands` sigue verde (no hay test de `DeviceProfile`; no crear literal nuevo).
- Comandos: `cd /c/maity_desktop/frontend/src-tauri && cargo test --lib scheduled_recording::status_snapshot`, `… cargo test --lib logging::commands`, `cd /c/maity_desktop/frontend && node scripts/lint-telemetry.js`, suites `ts` y `build`.
- `shouldLatchDeviceProfile` NO se puede testear en esta tarea (el `.test.ts` no está en su lista de archivos; ver issues.json): mantenerla pura y exportada.

Importadores / consumidores conocidos:
- `update_settings`: commands.rs:42 (`set_scheduled_recording_settings`) y :56-58 (`set_scheduled_recording_enabled`, que después arranca/detiene el loop). UI: `ScheduledRecordingSetupGate.tsx:26-33` (setSettings y luego setEnabled con el mismo contenido ⇒ UNA fila), `useScheduledRecording.ts`.
- `DeviceProfile`: `get_device_profile` (commands.rs:426-483), `logging/incident.rs` (bundle), `healthHeartbeatService.ts:191-192`; `lib/deviceTier.ts` es un espejo parcial y NO cambia.

Trampas:
- Contrato de locks: el guard de `settings.write()` debe morir antes del `spawn` (bloque propio); nada de `if let` sobre un guard.
- `AppHandle<R>` se clona para la task (R: Runtime es 'static; precedente del spawn en `start`, service.rs:320-323).
- Cardinalidad (TELEMETRIA.md): el horario es estático ⇒ SOLO en `device.profile` y en `jornada.settings_changed`, nunca en el latido.
- Frontend: sin `console.*`; no cambiar el gate de sesión del tick.

Resultado esperado: el primer `device.profile` tras el login trae `jornada` con el horario; guardar el horario produce exactamente una fila `jornada.settings_changed` con `changed: ["windows"]`; el gate de activación produce una sola fila.

Referencias: `scratchpad/areas/spec-jornada-telemetry-B3.md` (Commit 3), `scratchpad/areas/verify-jornada-telemetry-B3.md` (#5 diff bajo el write), `scratchpad/areas2/verify-jornada-telemetry-B3.md` (#3 re-emisión de device.profile).

**Ajustes del líder tras la refutación del plan (mandan sobre lo anterior si chocan):**
1. Archivo nuevo en la lista: `frontend/src/services/healthHeartbeatService.test.ts`. Tests de `shouldLatchDeviceProfile`: perfil con `jornada` objeto ⇒ fija el latch en la emisión 1; `jornada` null ⇒ no fija en las emisiones 1-2 y fija en la 3; `jornada` undefined (Rust viejo) ⇒ igual que null. Verificar con `cd /c/maity_desktop/frontend && npx vitest run src/services/healthHeartbeatService.test.ts`.

## Parte P - Autostart real, fecha de instalacion y autostart.changed

### P1a. Estado real del autostart en canal directo

Objetivo: AC-9 (primera mitad). Hoy `device.profile.autostart_state` en el canal directo (NSIS) solo puede valer `enabled|disabled|unknown` (`logging/commands.rs:430-444` mapea `app.autolaunch().is_enabled()`), así que "lo apagué en la app" y "Windows/Task Manager lo apagó" se ven igual. Esta tarea crea `autostart_state.rs` con el estado REAL del autostart (mismo predicado exacto que auto-launch 0.5.0, más `disabledByUser` y la fecha del apagado), lo usa en `get_device_profile` y expone el comando `autostart_get_state` (lo consumirá P2 en Ajustes). Sin eventos nuevos en esta tarea (`autostart.changed` es P2).

Pasos:
1. `frontend/src-tauri/src/utils.rs` — agregar (fuera de cualquier `cfg`, pura, testeable en todos los SO):
   ```rust
   /// FILETIME (ticks de 100 ns desde 1601-01-01 UTC) → rfc3339 UTC. `None` si cae en/antes de 1970-01-01T00:00:00Z.
   /// Mismo epoch y unidad que `Windows.Foundation.DateTime.UniversalTime` (lo reusa P1b).
   pub fn filetime_ticks_to_rfc3339(ticks: u64) -> Option<String>
   ```
   Implementación: `let secs = (ticks / 10_000_000) as i64 - 11_644_473_600; if secs <= 0 { return None; }` y `chrono::DateTime::<chrono::Utc>::from_timestamp(secs, 0).map(|d| d.to_rfc3339())` (chrono 0.4 ya es dependencia, `Cargo.toml:92`). Se descartan los sub-segundos a propósito.
2. Crear `frontend/src-tauri/src/autostart_state.rs` (doc de módulo en español explicando: MSIX ⇒ StartupTask; directo Windows ⇒ Run + StartupApproved con el predicado de auto-launch 0.5.0; otros SO ⇒ plugin). Contenido:
   ```rust
   #[derive(Debug, Clone, serde::Serialize, PartialEq)]
   pub struct AutostartSnapshot {
       pub state: String,               // enabled|enabledByPolicy|disabled|disabledByUser|disabledByPolicy|unknown
       pub disabled_at: Option<String>, // rfc3339; solo canal directo con disabledByUser y FILETIME no cero
       pub mechanism: &'static str,     // startup_task | run_key | plugin
   }
   pub async fn current<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> AutostartSnapshot
   #[tauri::command]
   pub async fn autostart_get_state<R: tauri::Runtime>(app: tauri::AppHandle<R>) -> AutostartSnapshot  // = current(&app).await
   pub(crate) fn classify_direct(run_present: bool, approved: Option<&[u8]>) -> (&'static str, Option<u64>)
   ```
   Lógica de `current`:
   a. `match crate::startup_task::startup_task_get_state().await`: `Ok(s) if s != "unsupported"` ⇒ `{state: s, disabled_at: None, mechanism: "startup_task"}`; `Err(_)` ⇒ `{"unknown", None, "startup_task"}` (el Err solo ocurre bajo MSIX, como documenta hoy `commands.rs:442`).
   b. `Ok("unsupported")` y `#[cfg(target_os = "windows")]` ⇒ `read_direct_windows(&app.package_info().name)` (nombre del valor = `Maity`, el productName; así lo resuelve el plugin: `tauri-plugin-autostart-2.5.1 lib.rs:178-182`). Lecturas de registro síncronas (microsegundos), sin COM.
   c. `Ok("unsupported")` en macOS/Linux ⇒ el plugin como hoy: `use tauri_plugin_autostart::ManagerExt; app.autolaunch().is_enabled()` ⇒ `Ok(true)`→`enabled`, `Ok(false)`→`disabled`, `Err`→`unknown`; mecanismo `plugin`.
   `read_direct_windows(name: &str) -> AutostartSnapshot` (`#[cfg(target_os = "windows")]`, winreg 0.56 ya es dependencia, `Cargo.toml:300`; patrón de uso en `rival_install.rs:141-146`):
   - `let hkcu = winreg::RegKey::predef(winreg::enums::HKEY_CURRENT_USER);`
   - `let run = match hkcu.open_subkey(r"SOFTWARE\Microsoft\Windows\CurrentVersion\Run") { Ok(k) => k, Err(_) => return {"unknown", None, "run_key"} };` (auto-launch devuelve Err en ese caso y el plugin lo mapea a `unknown`).
   - `let run_present = run.get_value::<String, _>(name).is_ok();` — EXACTAMENTE `get_value::<String>` como auto-launch (`windows.rs:76-79`): acepta REG_SZ/REG_EXPAND_SZ/REG_MULTI_SZ, rechaza binarios. NO usar `get_raw_value(..).is_ok()`.
   - `let approved: Option<Vec<u8>> = hkcu.open_subkey(r"SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run").ok().and_then(|k| k.get_raw_value(name).ok()).map(|v| v.bytes);`
   - `let (state, ticks) = classify_direct(run_present, approved.as_deref());` ⇒ `AutostartSnapshot { state: state.into(), disabled_at: ticks.and_then(crate::utils::filetime_ticks_to_rfc3339), mechanism: "run_key" }`.
   `classify_direct` (pura, SIN cfg; `#[cfg_attr(not(target_os = "windows"), allow(dead_code))]`), réplica exacta de `auto-launch-0.5.0/src/windows.rs:73-102` (`is_enabled = al_enabled && task_manager_enabled.unwrap_or(true)`, donde `task_manager_enabled` = `None` si no hay valor o `len < 8`, si no "los ÚLTIMOS 8 bytes son cero"):
   - `!run_present` ⇒ `("disabled", None)` (apagado desde la app: el `disable()` del plugin borra el valor Run y deja StartupApproved viejo).
   - `approved == None` ⇒ `("enabled", None)`.
   - `bytes.len() < 8` ⇒ `("enabled", None)`.
   - los últimos 8 bytes (`bytes[len-8..]`) todos cero ⇒ `("enabled", None)` — sin importar el primer byte.
   - en otro caso ⇒ `("disabledByUser", ticks)` con `ticks = if len >= 12 { let t = u64::from_le_bytes(bytes[4..12].try_into().unwrap_or([0;8])); (t != 0).then_some(t) } else { None }`. El primer byte NUNCA decide el estado (0x02/0x03/0x01/0x06 se tratan igual); bytes 4..12 solo sirven para la fecha. (Nada de `.unwrap()` sobre locks; el `try_into` sobre un slice de largo fijo 8 no falla, pero usar `unwrap_or` igual.)
3. `frontend/src-tauri/src/lib.rs` — declarar el módulo junto a sus vecinos (lista `pub mod …;` en `lib.rs:37-69`; insertar `pub mod autostart_state;` entre `pub mod auth_server;` (L39) y `pub mod builtin_ai;` (L40)) y registrar el comando en `tauri::generate_handler![…]` (abre en `lib.rs:1399`) junto a los de `startup_task` (`lib.rs:1777-1782`): `autostart_state::autostart_get_state,` con comentario `// Estado real del autostart (MSIX StartupTask / Run+StartupApproved en NSIS); lo lee Ajustes (P2)`. No hace falta capability (sin AppManifest en `build.rs`). No tocar nada más de `lib.rs`.
4. `frontend/src-tauri/src/logging/commands.rs`:
   - `DeviceProfile` (struct en `commands.rs:399-424`, puede haberse corrido por J6/J7): actualizar el doc de `autostart_state` ("en canal directo `disabledByUser` = apagado en el Administrador de tareas y la app SÍ puede reactivarlo — `enable()` del plugin reescribe 0x02; bajo MSIX no puede") y AGREGAR al final, sin reordenar lo existente (J7 ya añadió `jornada`):
     ```rust
     /// Desde 0.2.62: FILETIME de StartupApproved\Run (bytes 4..12) cuando `autostart_state = disabledByUser` en canal directo; null en el resto.
     pub autostart_disabled_at: Option<String>,
     /// Desde 0.2.62: `startup_task` (MSIX) | `run_key` (NSIS Windows) | `plugin` (macOS/Linux).
     pub autostart_mechanism: &'static str,
     ```
   - `get_device_profile` (`commands.rs:426-483`): reemplazar el bloque `let autostart_state = match crate::startup_task::startup_task_get_state().await { … };` (`commands.rs:430-444`) por `let autostart = crate::autostart_state::current(&app).await;` y en el literal único `DeviceProfile { … }` (`commands.rs:454`): `autostart_state: autostart.state.clone(), autostart_disabled_at: autostart.disabled_at.clone(), autostart_mechanism: autostart.mechanism,`. Si quedó sin uso el `use tauri_plugin_autostart::ManagerExt` local, quitarlo. `signature_kind` no se toca (P1b lo cambia).
5. `frontend/src/services/healthHeartbeatService.ts` — espejo TS: en `interface DeviceProfile` (`healthHeartbeatService.ts:108-122`, tras los campos que haya dejado J7) agregar `autostart_disabled_at: string | null` y `autostart_mechanism: string` con un comentario de una línea cada uno (`/** Desde 0.2.62: … */`). El spread `{ ...this.deviceProfile }` (`:191-192`) ya los manda; no cambiar la lógica.

Tests:
- `autostart_state.rs` `#[cfg(test)] mod tests` (tabla de `classify_direct`, corre en cualquier SO):
  - `(false, None)` ⇒ `("disabled", None)`; `(false, Some(&[0x03,0,0,0, 1,2,3,4,5,6,7,8]))` ⇒ `("disabled", None)` (sin Run manda aunque StartupApproved diga apagado).
  - `(true, None)` ⇒ `("enabled", None)`.
  - `(true, Some(&[0x02,0,0,0,0,0,0,0,0,0,0,0]))` ⇒ `("enabled", None)`.
  - `(true, Some(&[0x03,0,0,0,0,0,0,0,0,0,0,0]))` ⇒ `("enabled", None)` (primer byte 03 pero cola cero: auto-launch dice enabled).
  - `(true, Some(&[0x03,0,0,0]))` (len < 8) ⇒ `("enabled", None)`.
  - `(true, Some(&[0x03,0,0,0] ++ 134116992000000000u64.to_le_bytes()))` ⇒ `("disabledByUser", Some(134116992000000000))`.
  - `(true, Some(&[0x01,0,0,0] ++ [0,0,0,0,0,0,0,1]))` ⇒ `("disabledByUser", Some(u64::from_le_bytes([0,0,0,0,0,0,0,1])))` (primer byte desconocido: gana la cola).
  - `(true, Some(&[0x03,0,0,0,0,0,0,0,9]))` (len 9, cola no cero) ⇒ `("disabledByUser", None)`.
  - `AutostartSnapshot` serializa con claves exactas `state`, `disabled_at`, `mechanism` (`serde_json::to_value` y comparar el set de claves).
- `utils.rs` `mod tests` (ya existe en `utils.rs:164-177`): `filetime_ticks_to_rfc3339(0) == None`; `filetime_ticks_to_rfc3339(116_444_736_000_000_000) == None` (1970-01-01 exacto ⇒ secs = 0); `filetime_ticks_to_rfc3339(134_116_992_000_000_000) == Some("2026-01-01T00:00:00+00:00".into())`; `filetime_ticks_to_rfc3339(134_116_992_009_999_999)` también da `2026-01-01T00:00:00+00:00` (trunca sub-segundos).
- `logging/commands.rs` `mod health_snapshot_tests`: test `device_profile_serializa_campos_de_autostart` que arma un `DeviceProfile` literal (todos los campos; `jornada: None` si J7 lo añadió) con `autostart_disabled_at: Some("2026-01-01T00:00:00+00:00".into())` y `autostart_mechanism: "run_key"`, lo serializa y comprueba que existen las claves `autostart_state`, `autostart_disabled_at`, `autostart_mechanism`.
- Comandos: `cd /c/maity_desktop/frontend/src-tauri && cargo test --lib autostart_state`, `… cargo test --lib utils::tests`, `… cargo test --lib logging::commands`; luego la suite `build` (`cd /c/maity_desktop/frontend && npm run tauri:build:debug`, en background con log y `EXIT=$?`).

Importadores / consumidores conocidos:
- `logging/commands.rs:426` `get_device_profile` (registrado en `lib.rs:1682`); `logging/incident.rs:327` lo serializa entero para el bundle de incidente (hereda los campos nuevos sin cambios).
- `services/healthHeartbeatService.ts:191-192` emite `device.profile` con el spread del perfil.
- `lib/deviceTier.ts:10-24` usa un espejo PARCIAL (`DeviceProfileLite`) — no tocar.
- `startup_task.rs:92` `startup_task_get_state` (se reusa, no se cambia) y `startup_task.rs:47` `with_mta`.
- Consumidores futuros: L1 (`app.start.autostart_state` vía `autostart_state::current`), P2 (`reconcile`, Ajustes vía `autostart_get_state`).

Trampas:
- El predicado DEBE ser idéntico al de auto-launch 0.5.0 (`C:/Users/jagv1/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/auto-launch-0.5.0/src/windows.rs:73-102`): el primer byte no decide nada; la cola son los ÚLTIMOS 8 bytes del valor completo. Si difiere, la telemetría contradice al toggle de Ajustes (que usa `isEnabled()` del plugin).
- `classify_direct` y `filetime_ticks_to_rfc3339` sin `cfg(windows)` para que los tests compilen en cualquier SO; `read_direct_windows` sí con `#[cfg(target_os = "windows")]`, y la rama del plugin con `#[cfg(not(target_os = "windows"))]` — cuidar que no queden `unused` (`let _ = app;` donde haga falta, como `rival_install.rs:126`).
- En MSIX NO leer el Run key (el plugin no aplica ahí; una entrada Run sería la de la instalación NSIS rival).
- Nada de `.lock().unwrap()`; nada de `log::error!` (usar `log::warn!` si se loguea algo). No escribir en el registro (solo lectura; `enable()`/`disable()` siguen siendo del plugin).
- `'unknown'` es válido aquí (no es un campo de versión); no ponerlo en una línea que contenga la palabra "version" (lint-telemetry (d) escanea TS completo).
- `DeviceProfile` tiene un único literal (`commands.rs:454`) más el de test: el compilador marcará cualquier literal olvidado.
- No editar `docs/TELEMETRIA.md` (A1 ya documentó los campos; Z1 reconcilia) ni `PreferenceSettings.tsx` (es de P2).
- Protocolo de build: la tarea no está cerrada sin `npm run tauri:build:debug` exit 0; el build NO compila los `#[cfg(test)]`: correr los `cargo test --lib` aparte. Guard de shell: ningún comando con la palabra "shut…down".

Resultado esperado: en una instalación NSIS con Maity apagado en Inicio del Administrador de tareas, `invoke('get_device_profile')` devuelve `autostart_state: "disabledByUser"`, `autostart_disabled_at` con la hora del cambio y `autostart_mechanism: "run_key"`; apagado desde Ajustes ⇒ `disabled`; bajo MSIX igual que hoy con `autostart_mechanism: "startup_task"`; `invoke('autostart_get_state')` devuelve `{state, disabled_at, mechanism}`.

Referencias: `docs/specs/telemetria-ciclo-vida-83/research/areas/spec-autostart-logout-T3-T4-B1.md` §6 (diseño base; su tabla de `classify_direct` está CORREGIDA por las revisiones), `…/areas/verify-autostart-logout-T3-T4-B1.md` (issue "classify_direct falls back…") y `…/areas2/verify-autostart-logout-T3-T4-B1.md` (mismo punto: predicado exacto con `get_value::<String>`).

### P1b. Fecha de instalacion del paquete en device.profile

Objetivo: AC-9 (segunda mitad). `device.profile` no dice cuándo se instaló (o actualizó por última vez) la versión que corre, así que en SQL no se distingue "instalación nueva" de "equipo viejo" ni se confirma un update. Esta tarea agrega `package_installed_at` + `package_installed_at_source` (desde 0.2.62): bajo MSIX sale de `Package::Current().InstalledDate()` ("installed or last updated", doc de Microsoft); en el canal directo, del last-write de la llave `Uninstall\Maity` que escribe el NSIS de Tauri (el template de Tauri CLI 2.9.6 NO escribe `InstallDate`). Sin eventos nuevos.

Pasos:
1. `frontend/src-tauri/src/rival_install.rs` — cambiar `const NSIS_UNINSTALL_SUBKEY` (`rival_install.rs:134`, sigue bajo `#[cfg(target_os = "windows")]` en L133; puede haberse corrido por J1) a `pub(crate) const NSIS_UNINSTALL_SUBKEY: &str = …;`. Nada más en ese archivo.
2. `frontend/src-tauri/src/utils.rs` — agregar (P1a ya dejó `filetime_ticks_to_rfc3339(u64) -> Option<String>` en este archivo; reusarlo):
   a. Pura, sin cfg: `pub fn winrt_datetime_to_rfc3339(universal_time: i64) -> Option<String>` = `u64::try_from(universal_time).ok().and_then(filetime_ticks_to_rfc3339)` (`Windows.Foundation.DateTime.UniversalTime` usa el mismo epoch 1601 y ticks de 100 ns; negativo ⇒ None).
   b. Pura, sin cfg (`#[cfg_attr(not(target_os = "windows"), allow(dead_code))]`): `pub(crate) fn install_location_matches(install_location: &str, exe_dir: &std::path::Path) -> bool` — normaliza ambos lados con: `trim()`, quitar comillas `"` de los extremos, quitar `\` y `/` finales, `to_lowercase()`; devuelve `false` si `install_location` queda vacío; si no, igualdad de las cadenas normalizadas. Sirve para que un build de desarrollo (`target/debug/…`) en una PC con Maity NSIS instalado NO reporte la fecha de esa otra instalación (contrato: "dev ⇒ None").
   c. `pub fn package_installed_at() -> Option<(String, &'static str)>` con doc "fecha de instalación O ÚLTIMA ACTUALIZACIÓN de la versión que corre; llamar dentro de `startup_task::with_mta` (bajo MSIX usa WinRT)":
      - `#[cfg(target_os = "windows")]`: si `is_running_under_package_identity()` ⇒ `match windows::ApplicationModel::Package::Current().and_then(|p| p.InstalledDate()) { Ok(dt) => winrt_datetime_to_rfc3339(dt.UniversalTime).map(|s| (s, "package")), Err(e) => { log::warn!("[utils] Package::Current().InstalledDate() falló: {e}"); None } }` (misma forma que `package_signature_kind`, `utils.rs:51-69`; `InstalledDate` está en `windows-0.58 ApplicationModel/mod.rs:1684` con las features actuales, `Cargo.toml:289-291`).
      - si NO hay identidad de paquete ⇒ `nsis_uninstall_key_last_write().map(|s| (s, "nsis_uninstall_key"))`.
      - `#[cfg(not(target_os = "windows"))]` ⇒ `None`.
   d. Privada `#[cfg(target_os = "windows")] fn nsis_uninstall_key_last_write() -> Option<String>`: `let exe_dir = std::env::current_exe().ok()?.parent()?.to_path_buf();` y `for hive in [HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE]` (mismo orden que `rival_install.rs:144`): `let Ok(key) = winreg::RegKey::predef(hive).open_subkey(crate::rival_install::NSIS_UNINSTALL_SUBKEY) else { continue };` `let loc: String = key.get_value("InstallLocation").unwrap_or_default(); if !install_location_matches(&loc, &exe_dir) { continue; }` `let Ok(meta) = key.query_info() else { continue };` `let ft = &meta.last_write_time;` (winreg 0.56 `RegKeyMetadata.last_write_time: FileTime`, que hace `Deref` a `windows_sys FILETIME` con campos públicos) ⇒ `let ticks = ((ft.dwHighDateTime as u64) << 32) | ft.dwLowDateTime as u64; return filetime_ticks_to_rfc3339(ticks);`. Si ese acceso por Deref no compilara, alternativa equivalente: `meta.get_last_write_time_system()` (SYSTEMTIME UTC) → `chrono::NaiveDate::from_ymd_opt(..)?.and_hms_opt(..)?.and_utc().to_rfc3339()` sin `expect`. Al terminar el loop ⇒ `None`.
3. `frontend/src-tauri/src/logging/commands.rs`:
   - `DeviceProfile` (tras los campos que agregó P1a, sin reordenar): 
     ```rust
     /// Desde 0.2.62: fecha (rfc3339 UTC) en que se instaló O ACTUALIZÓ por última vez la versión que corre; null en dev/macOS/Linux o si no se pudo leer.
     pub package_installed_at: Option<String>,
     /// Desde 0.2.62: `package` (MSIX, Package.InstalledDate) | `nsis_uninstall_key` (last-write de Uninstall\Maity); null si no hay fecha.
     pub package_installed_at_source: Option<&'static str>,
     ```
   - `get_device_profile`: sustituir el cálculo de `signature_kind` (`commands.rs:446-451`) para computar ambos en el MISMO `with_mta`:
     ```rust
     #[cfg(target_os = "windows")]
     let (signature_kind, installed) = crate::startup_task::with_mta(|| {
         Ok((crate::utils::package_signature_kind(), crate::utils::package_installed_at()))
     })
     .await
     .unwrap_or((Some("unknown"), None));
     #[cfg(not(target_os = "windows"))]
     let (signature_kind, installed) = (crate::utils::package_signature_kind(), crate::utils::package_installed_at());
     ```
     y en el literal: `package_installed_at: installed.as_ref().map(|(at, _)| at.clone()), package_installed_at_source: installed.map(|(_, src)| src),`. Conservar intacto el `unwrap_or(Some("unknown"))` de `signature_kind` (comportamiento actual).
4. `frontend/src/services/healthHeartbeatService.ts` — espejo en `interface DeviceProfile` (`healthHeartbeatService.ts:108-122` + lo que agregaron J7/P1a): `package_installed_at: string | null` y `package_installed_at_source: string | null`, con `/** Desde 0.2.62: … */`. Sin cambios de lógica.

Tests:
- `utils.rs` `mod tests`:
  - `winrt_datetime_to_rfc3339(134_116_992_000_000_000) == Some("2026-01-01T00:00:00+00:00".into())`; `winrt_datetime_to_rfc3339(-1) == None`; `winrt_datetime_to_rfc3339(0) == None`.
  - `install_location_matches(r"C:\Users\x\AppData\Local\Maity", Path::new(r"C:\Users\x\AppData\Local\Maity"))` ⇒ true; con comillas y barra final `"\"C:\\Users\\x\\AppData\\Local\\Maity\\\""` ⇒ true; mayúsculas distintas ⇒ true; `""` ⇒ false; otra carpeta (`C:\maity_desktop\target\debug`) ⇒ false.
- `logging/commands.rs` `mod health_snapshot_tests`: ampliar el test de P1a (`device_profile_serializa_campos_de_autostart`) o agregar `device_profile_serializa_package_installed_at` que verifique las claves `package_installed_at` y `package_installed_at_source` (valores `Some("2026-01-01T00:00:00+00:00")` / `Some("package")`) y que con `None` serializan como `null`.
- Comandos: `cd /c/maity_desktop/frontend/src-tauri && cargo test --lib utils::tests`, `… cargo test --lib logging::commands`, `… cargo test --lib rival_install`; después la suite `build` (`npm run tauri:build:debug` en background con log y `EXIT=$?`).

Importadores / consumidores conocidos:
- `rival_install.rs:140-146` `read_nsis_uninstall_entry` (único usuario actual de `NSIS_UNINSTALL_SUBKEY`; solo cambia la visibilidad).
- `utils.rs:51` `package_signature_kind` (misma forma WinRT; se sigue llamando en el mismo `with_mta`).
- `startup_task.rs:47` `with_mta` (COM MTA en `spawn_blocking`).
- `logging/commands.rs:426` `get_device_profile` (registrado en `lib.rs:1682`); `logging/incident.rs:327` serializa el perfil; `services/healthHeartbeatService.ts:191-192` emite `device.profile`.

Trampas:
- WinRT (`Package::Current()`) SOLO dentro de `with_mta`: el hilo principal es STA de wry (ver doc de `startup_task.rs:18-23`). En canal directo el registro no necesita COM, pero va en el mismo closure para no duplicar el spawn.
- Bajo MSIX NUNCA leer `Uninstall\Maity`: esa llave es de la instalación NSIS RIVAL (`rival_install.rs`), no de la que corre.
- Sin `expect`/`unwrap` en conversiones de fecha (una fecha fuera de rango no debe tumbar `get_device_profile`, que también usa el bundle de incidente).
- La semántica documentada es "instalada O ACTUALIZADA por última vez"; NO está verificado que el update NSIS reescriba la llave ni que `InstalledDate` cambie con cada update de la Store (se valida en la matriz E2E, escenario 11). No prometer más en comentarios.
- No escribir `'unknown'` en líneas con "version" (lint-telemetry (d)). No `log::error!`. No tocar `docs/` (A1 ya documentó `package_installed_at`; Z1 reconcilia).
- `rival_install.rs` es de J1 y L2 también: cambiar SOLO la visibilidad de la constante.
- Build obligatorio (`npm run tauri:build:debug` exit 0) + los `cargo test --lib` (el build no compila `#[cfg(test)]`). Guard de shell: ningún comando con la palabra "shut…down".

Resultado esperado: `invoke('get_device_profile')` bajo MSIX trae `package_installed_at` = fecha de instalación/actualización del paquete y `package_installed_at_source: "package"`; en NSIS instalado, la fecha de la llave `Uninstall\Maity` con `"nsis_uninstall_key"`; en `tauri dev`/debug desde `target/` y en macOS/Linux, ambos `null`.

Referencias: `docs/specs/telemetria-ciclo-vida-83/research/areas/spec-autostart-logout-T3-T4-B1.md` §8 (diseño base) y "Current behavior" (NSIS sin InstallDate, `Package.InstalledDate`, winreg `query_info`); `…/areas/verify-autostart-logout-T3-T4-B1.md` (línea correcta de la constante: 134); `…/areas2/verify-autostart-logout-T3-T4-B1.md` (confirma el diseño; puntos sin verificar).

### P2. autostart.changed contra linea base y aviso en Ajustes

Objetivo: AC-16. Hoy no hay evento cuando el autostart cambia (el usuario lo apaga en el Administrador de tareas, en Ajustes, o el bootstrap lo enciende en una instalación nueva), así que "la app no arrancó con la PC" no se puede fechar. Esta tarea agrega `autostart_state::reconcile(app, trigger)`, que compara el estado real (`current()`, de P1a) con la línea base guardada en el marcador de ciclo de vida (`lifecycle.json`, campo `last_autostart_state`, accesor `swap_last_autostart_state` de L1) y emite `autostart.changed` por el outbox; y en Ajustes (canal directo) muestra un aviso ámbar cuando Task Manager lo apagó. NO se usa `telemetry.json` (plugin-store no atómico, guarda `install_id`).

Pasos:
1. `frontend/src-tauri/src/autostart_state.rs` (creado en P1a) — agregar:
   ```rust
   static RECONCILE_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
   /// Pura. `None` si no hay línea base (primer arranque con 0.2.62 / marcador missing|corrupt|foreign ⇒ solo se guarda la base) o si no cambió.
   pub(crate) fn decide_change(prev: Option<&str>, cur: &str) -> Option<(String, String)>
   /// Pura: allowlist del comando. Solo `settings_toggle` y `bootstrap`; `boot` lo dispara SOLO Rust.
   pub(crate) fn parse_trigger(raw: &str) -> Option<&'static str>
   /// Pura: payload del contrato 1.6 `{from, to, trigger, mechanism, disabled_at}`.
   pub(crate) fn changed_payload(from: &str, to: &str, trigger: &str, snap: &AutostartSnapshot) -> serde_json::Value
   pub async fn reconcile<R: tauri::Runtime>(app: &tauri::AppHandle<R>, trigger: &'static str)
   #[tauri::command]
   pub async fn autostart_reconcile<R: tauri::Runtime>(app: tauri::AppHandle<R>, trigger: String) -> Result<(), String>
   ```
   `reconcile`, en orden:
   a. `let _guard = RECONCILE_LOCK.lock().await;` (serializa boot / settings_toggle / bootstrap; se mantiene durante toda la función).
   b. `let snap = current(app).await;` Si `snap.state == "unknown"` ⇒ `return` SIN tocar la línea base (un fallo transitorio de lectura no debe producir `enabled→unknown→enabled`).
   c. `let prev = crate::logging::telemetry::lifecycle::swap_last_autostart_state(&snap.state);` (L1: escribe el nuevo valor en el marcador y devuelve el anterior; síncrono, `std::sync::Mutex` interno — no lo envuelvas en otro lock).
   d. `let Some((from, to)) = decide_change(prev.as_deref(), &snap.state) else { return };`
   e. `let id = crate::logging::telemetry::emit::emit_event_with_id(app, crate::logging::telemetry::context::process_session_id(), crate::logging::telemetry::catalog::AUTOSTART_CHANGED, changed_payload(&from, &to, trigger, &snap), Some(crate::logging::telemetry::status::TelemetryStatus::Ok), None, None).await;` (API de A2, contrato 1.8).
   f. Si `id.is_none()` (la fila NO quedó en el outbox: sin `AppState` o fallo del insert) ⇒ revertir la base: `let _ = crate::logging::telemetry::lifecycle::swap_last_autostart_state(&from);` + `log::warn!("[autostart] autostart.changed no quedó en el outbox; la línea base vuelve a {from}")`. Así el cambio se reintenta en el siguiente disparador (regla del contrato 4.3: la base avanza solo si la fila quedó en el outbox).
   `decide_change`: `match prev { None => None, Some(p) if p == cur => None, Some(p) => Some((p.to_string(), cur.to_string())) }`.
   `parse_trigger`: `"settings_toggle" => Some("settings_toggle")`, `"bootstrap" => Some("bootstrap")`, cualquier otro (incluido `"boot"`) ⇒ `None`.
   `changed_payload`: `serde_json::json!({ "from": from, "to": to, "trigger": trigger, "mechanism": snap.mechanism, "disabled_at": snap.disabled_at })` — exactamente esas 5 claves (el envelope `ctx` lo agrega el emisor).
   `autostart_reconcile`: `let Some(t) = parse_trigger(&trigger) else { return Err(format!("trigger no permitido: {trigger}")) }; reconcile(&app, t).await; Ok(())`.
2. `frontend/src-tauri/src/logging/telemetry/lifecycle.rs` (creado por L1, tocado por L2/E1/L3) — disparador `boot`: dentro de la tarea async que emite `app.start` (la función `emit_start(app)` de L1, que corre tras el init de la DB), DESPUÉS de escribir la fila `app.start`, llamar `crate::autostart_state::reconcile(&app, "boot").await;` (con el `AppHandle` que ya use esa tarea). Una línea + comentario: `// P2: línea base del autostart y autostart.changed(trigger=boot); después de app.start para que el orden en platform_logs sea start → changed.` No cambiar nada más de `lifecycle.rs` (ni el payload de `app.start`, ni el marcador, ni `swap_last_autostart_state`).
3. `frontend/src-tauri/src/lib.rs` — registrar `autostart_state::autostart_reconcile,` en `tauri::generate_handler![…]` justo debajo de `autostart_state::autostart_get_state,` (lo agregó P1a junto a los `startup_task::*`, hoy `lib.rs:1777-1782`). No agregar spawns en `setup()`: el `boot` sale de `lifecycle` (paso 2). Sin capability (no hay AppManifest).
4. `frontend/src/hooks/useAutostartBootstrap.ts` — en la rama `if (!alreadyEnabled) { await enable(); … }` (`useAutostartBootstrap.ts:76-83`), justo después de `await enable();`: `void invoke('autostart_reconcile', { trigger: 'bootstrap' }).catch((e) => logger.warn('[AutostartBootstrap] autostart_reconcile falló:', e));`. `invoke` y `logger` ya están importados (L4, L8). Documentar en un comentario que en una instalación NSIS nueva esto produce `autostart.changed disabled→enabled` con `trigger=bootstrap` (ESPERADO: el reconcile de `boot` ya grabó `disabled` como base antes de que el webview corriera).
5. `frontend/src/components/settings/PreferenceSettings.tsx`:
   a. Tipo local junto a `MsixStartupState` (`PreferenceSettings.tsx:19-…`): `interface AutostartSnapshot { state: string; disabled_at: string | null; mechanism: string }`.
   b. Estado nuevo junto a `msixStartupState` (`:117`): `const [directAutostartState, setDirectAutostartState] = useState<string | null>(null);` y un helper `const refreshDirectAutostartState = () => invoke<AutostartSnapshot>('autostart_get_state').then((s) => setDirectAutostartState(s.state)).catch((err) => logger.warn('Failed to read direct autostart state:', err));`
   c. En el efecto de carga (`:118-139`), dentro del `.then(([enabled, isProd, packaged]) => …)`: `if (!packaged) { invoke<AutostartSnapshot>('autostart_get_state').then((s) => { if (!cancelled) setDirectAutostartState(s.state); }).catch((err) => logger.warn('Failed to read direct autostart state:', err)); }` (respeta `cancelled`).
   d. En `handleToggleAutostart` (`:140-178`): rama MSIX, después del `Analytics.track(...)` exitoso (`:160`) ⇒ `void invoke('autostart_reconcile', { trigger: 'settings_toggle' }).catch(() => {});`. Rama plugin, después del `Analytics.track(...)` exitoso (`:173`) ⇒ la misma línea + `void refreshDirectAutostartState();` (para que el aviso desaparezca al reactivar). Mantener `Analytics.track('autostart_toggled', …)`: ya existía y ya llega a `platform_logs` (Z1 lo documenta); `autostart.changed` no lo reemplaza.
   e. JSX del bloque de autostart (`:399-421`): después del `<span>` de MSIX `disabledByUser` (`:399-411`) agregar
      ```tsx
      {!isPackaged && directAutostartState === 'disabledByUser' && (
        <span className="block mt-2 text-amber-500 text-xs">
          Lo desactivaste desde el Administrador de tareas de Windows; si lo activas aquí se vuelve a habilitar.
        </span>
      )}
      ```
      Texto EXACTO del contrato. `checked` del `Switch` sigue saliendo del plugin (`autostartEnabled`), que ya es `false` en ese caso. NO tocar `onClick={signOut}` (`:505`, es de S3b).

Tests:
- `autostart_state.rs` `mod tests` (se suman a los de P1a):
  - `decide_change(None, "enabled") == None`; `decide_change(Some("enabled"), "enabled") == None`; `decide_change(Some("enabled"), "disabledByUser") == Some(("enabled".into(), "disabledByUser".into()))`; `decide_change(Some("disabled"), "enabled") == Some(("disabled".into(), "enabled".into()))`.
  - `parse_trigger("settings_toggle") == Some("settings_toggle")`, `parse_trigger("bootstrap") == Some("bootstrap")`, `parse_trigger("boot") == None`, `parse_trigger("") == None`, `parse_trigger("x") == None`.
  - `changed_payload("enabled", "disabledByUser", "boot", &AutostartSnapshot{ state: "disabledByUser".into(), disabled_at: Some("2026-01-01T00:00:00+00:00".into()), mechanism: "run_key" })` tiene exactamente las claves `from, to, trigger, mechanism, disabled_at` con esos valores; con `disabled_at: None` la clave existe y vale `null`.
- `logging::telemetry::lifecycle`: los tests de L1 deben seguir verdes (`cargo test --lib logging::telemetry::lifecycle`); no se agregan tests ahí.
- Comandos: `cd /c/maity_desktop/frontend/src-tauri && cargo test --lib autostart_state`, `… cargo test --lib logging::telemetry::lifecycle`, `cd /c/maity_desktop/frontend && node scripts/lint-telemetry.js` (el `AUTOSTART_CHANGED` ya lo registró A1), suites `ts` (`npm run test`) y `build` (`npm run tauri:build:debug`, en background con log y `EXIT=$?`).

Importadores / consumidores conocidos:
- `autostart_state::current` (P1a) — también lo usa `lifecycle::emit_start` para `app.start.autostart_state` (L1) y `logging/commands.rs::get_device_profile`.
- `lifecycle::swap_last_autostart_state` (L1): único escritor/lector de `last_autostart_state` en `lifecycle.json`; el valor se arrastra entre arranques en `rotate_at_boot`.
- `emit::emit_event_with_id` (A2) y `catalog::AUTOSTART_CHANGED` (A1).
- JS: `hooks/useAutostartBootstrap.ts:76-83`, `components/settings/PreferenceSettings.tsx:118-178, 399-421`.

Trampas:
- Orden a respetar: snapshot → (unknown ⇒ salir) → swap → decide → emit → revertir si la fila no quedó. Nunca avanzar la base sin fila en el outbox.
- `RECONCILE_LOCK` es `tokio::sync::Mutex` (se sostiene a través de `.await`); el `std::sync::Mutex` del marcador vive dentro de `lifecycle` y no se toca desde aquí. Nada de `.lock().unwrap()`.
- Límite conocido (documentarlo en un comentario, no "arreglarlo"): si el reconcile `bootstrap` llegara antes que el de `boot`, el primero toma la base y no hay evento; y si el marcador no se pudo escribir (`swap` devuelve siempre `None`), nunca hay evento — preferible a eventos falsos.
- Bajo MSIX un cambio en Task Manager con la app abierta se ve en el siguiente arranque (`trigger=boot`); `disabled_at` es `null` bajo MSIX.
- El callback de `onAuthStateChange` no se toca. En TS: `logger` de `@/lib/logger`, nunca `console.*`; `invoke` con clave `trigger` (una palabra, no hay problema camelCase/snake_case).
- `'unknown'` no debe aparecer en una línea con "version" en `logging/telemetry/*` ni en TS (lint-telemetry (d)).
- Sin eventos Tauri nuevos (solo el comando). No editar `docs/` (A1/Z1). `lib.rs` es compartido: SOLO la línea del comando.
- Build obligatorio + `cargo test --lib` aparte (el build no compila `#[cfg(test)]`). Guard de shell: ningún comando con la palabra "shut…down".

Resultado esperado: primer arranque con 0.2.62 (upgrade) ⇒ solo se guarda la base, sin `autostart.changed`; NSIS nuevo ⇒ `autostart.changed` `disabled→enabled` `trigger=bootstrap`; toggle en Ajustes ⇒ `trigger=settings_toggle`; apagar en Task Manager y reiniciar ⇒ `to=disabledByUser`, `trigger=boot` (con `disabled_at` en NSIS); en NSIS con Task Manager apagado, Ajustes muestra el aviso ámbar y desaparece al reactivar.

Referencias: `docs/specs/telemetria-ciclo-vida-83/research/areas/spec-autostart-logout-T3-T4-B1.md` §6 (aviso en Ajustes) y §7 (reconcile; su persistencia en `telemetry.json` queda REEMPLAZADA por el marcador del contrato 1.5); `…/areas/verify-autostart-logout-T3-T4-B1.md` (issues "Persist … telemetry.json" y "first run only saves the baseline"); `…/areas2/verify-autostart-logout-T3-T4-B1.md` (issues "reconcile always persists the new baseline" y "autostart_toggled ya existe").

## Parte L - Ciclo de vida del proceso, fin de sesion de Windows y salidas de la Store

### L1. Marcador de ciclo de vida app.start y app.resumed

Objetivo: AC-10. Hoy no hay forma de saber, en el arranque, cómo terminó el proceso anterior (versión previa, motivo, si fue limpio, cuánto estuvo apagado) ni de distinguir "laptop suspendida" de "sin señal". Se crea el marcador de ciclo de vida `lifecycle.json` (contrato §1.5), el evento `app.start` (payload §1.6) y el evento `app.resumed` (suspensión >180 s). Esta tarea crea el módulo y TODA la lógica de lectura (`summarize_prev`), incluida la interpretación de bloques `exit` e intenciones que escribirán L2, E1 y L3 más adelante.

Pasos:
1. `frontend/src-tauri/src/logging/telemetry/mod.rs`: agregar `pub mod lifecycle;` (orden alfabético, entre `emit` y `panics`) y una línea en el doc del módulo: "- `lifecycle`: marcador de ciclo de vida del PROCESO (`lifecycle.json`), `app.start`/`app.exit`/`app.resumed` (#83, desde 0.2.62). No confundir con `app.open`/`app.close`, que emite el webview."
2. `frontend/src-tauri/src/logging/telemetry/panics.rs`:
   - `const PANIC_FILE_NAME` (línea 19) pasa a `pub(crate) const`.
   - En el hook (líneas 39-66) agregar al JSON de cada línea el campo `"thread": std::thread::current().name()` (Option<&str> → null si el hilo no tiene nombre). Sigue siendo solo I/O síncrona de std; no agregar log/tracing.
   - Nueva función pura `pub(crate) struct PanicTs { pub ts_ms: u64, pub thread: Option<String> }` y `pub(crate) fn parse_panic_ts(contents: &str) -> Vec<PanicTs>`: una entrada por línea JSON válida con `ts_ms` numérico; líneas vacías, JSON roto o sin `ts_ms` se saltan. `import_pending` NO cambia (sigue borrando el archivo después).
3. Nuevo `frontend/src-tauri/src/logging/telemetry/lifecycle.rs`:
   a. Tipos serde (todos `#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]`, `#[serde(default)]` en cada campo, SIN `deny_unknown_fields`), exactamente con los nombres del contrato §1.5:
      - `LifecycleMarker { schema: u32, proc_session_id: String, version: String, build: String, build_channel: String, started_at_ms: u64, last_alive_ms: u64, os_boot_ms: Option<u64>, exit: Option<MarkerExit>, exit_intent: Option<MarkerIntent>, last_resume: Option<MarkerResume>, last_autostart_state: Option<String>, last_login_user: Option<LastLoginUser> }` (`pub const MARKER_SCHEMA: u32 = 1`).
      - `MarkerExit { reason: String, detail: Option<String>, exit_code: Option<i32>, begun_at_ms: u64, done_at_ms: Option<u64>, recording_active: bool, session_end_kind: Option<String>, critical: bool }`.
      - `MarkerIntent { reason: String /* update|session_end */, via: Option<String> /* store_button|store_api|nsis */, detail: Option<String>, target_version: Option<String>, at_ms: u64 }`.
      - `MarkerResume { suspended_at_ms: u64, resumed_at_ms: u64, gap_s: u64 }`; `LastLoginUser { maity_user_id: String, since_ms: u64 }`.
      Los strings de motivo se guardan como `String` (una versión más nueva puede traer motivos que esta no conoce).
   b. `pub(crate) fn marker_file_name(debug: bool) -> &'static str` → `"lifecycle-debug.json"` / `"lifecycle.json"`; se llama con `cfg!(debug_assertions)`. Directorio: `app.path().app_local_data_dir()` (contrato §1.5; NO `app_data_dir`).
   c. Estado: `static MARKER: std::sync::Mutex<Option<MarkerSlot>> = Mutex::new(None);` con `struct MarkerSlot { path: PathBuf, marker: LifecycleMarker }`. Lock SIEMPRE con `MARKER.lock().unwrap_or_else(|e| e.into_inner())` (nunca `.unwrap()`). Documentar en un comentario que el lock cubre la E/S a propósito (serializa escritores: ticker, WndProc de E1, hilo principal en Exit).
   d. `fn write_atomic(path: &Path, bytes: &[u8], durable: bool) -> std::io::Result<()>`: escribe `path.with_extension("json.tmp")` con `write_all`, `sync_all()` si `durable`, luego `std::fs::rename(tmp, path)`; si el rename falla: `std::thread::sleep(20 ms)` y reintenta una vez; si vuelve a fallar, escribe in-place sobre `path` (`File::create` + `write_all` + `sync_all` si durable) y borra el `.tmp`.
   e. `fn mutate_marker(durable: bool, f: impl FnOnce(&mut LifecycleMarker)) -> Result<(), String>`: toma el lock, si el slot es `None` no hace nada (Ok), aplica `f`, serializa con `serde_json::to_vec`, llama `write_atomic`. El error se devuelve como String; el llamador lo loguea DESPUÉS de soltar el lock con `warn_once(kind, msg)` (rate-limit: un `static` `AtomicBool` por tipo de error: rotate, tick, accessor). Nunca `log::error!` en este módulo (el bridge lo excluye, pero la regla del contrato es solo `warn!`).
   f. `pub(crate) enum MarkerRead { Missing, Corrupt, Foreign(LifecycleMarker), Ok(LifecycleMarker) }` y `pub(crate) fn parse_marker(raw: Option<&str>, current_channel: &str) -> MarkerRead` (pura): `None` → Missing; JSON inválido → Corrupt; `build_channel` no vacío y distinto de `current_channel` → Foreign; si no, Ok.
   g. Resumen de arranque pendiente: `static BOOT_PREV: std::sync::OnceLock<BootPrev>` con `struct BootPrev { read: MarkerRead, panics: Vec<PanicTs>, now_ms: u64, os_boot_ms: Option<u64> }`.
   h. `pub fn rotate_at_boot<R: Runtime>(app: &AppHandle<R>)` (síncrona): `now_ms` de `SystemTime`; `os_boot_ms = sysinfo::System::boot_time()` × 1000 (0 ⇒ None); `current_channel = if crate::utils::is_running_under_package_identity() {"store"} else {"direct"}` (misma regla que `logging/commands.rs`); lee el marcador anterior con `std::fs::read_to_string` (error ⇒ None) y lo parsea; lee `app.path().app_data_dir()/panics::PANIC_FILE_NAME` (el archivo de pánicos vive en `app_data_dir`, no en el local) con `parse_panic_ts` sin modificarlo; construye el marcador nuevo `{schema:1, proc_session_id: context::process_session_id(), version: app.package_info().version.to_string(), build: if cfg!(debug_assertions) {"debug"} else {"release"}, build_channel, started_at_ms: now, last_alive_ms: now, os_boot_ms, exit: None, exit_intent: None, last_resume: None, last_autostart_state y last_login_user ARRASTRADOS del anterior si era Ok}`; crea el directorio si falta (`create_dir_all`), guarda el slot en `MARKER` y lo escribe durable; guarda `BootPrev` en el OnceLock. Si `app_local_data_dir()` falla: guarda `BootPrev` igual (para emitir app.start con marker_status) y deja `MARKER` en None.
   i. `pub fn emit_start<R: Runtime>(app: &AppHandle<R>)`: `tauri::async_runtime::spawn` de una tarea que: (1) si `read` es Missing/Corrupt/Foreign y `!cfg!(debug_assertions)`, consulta `crate::database::repositories::recording_log::RecordingLogRepository::last_app_version_excluding_session(pool, context::process_session_id())` (creada en A2; pool desde `app.try_state::<crate::state::AppState>()`, error ⇒ None); (2) `let auto = crate::autostart_state::current(app)` (P1a) para `autostart_state`; (3) calcula `summarize_prev(...)`; (4) `emit::emit_event(app, context::process_session_id(), catalog::APP_START, payload, Some(status), None, None)` con status `TelemetryStatus::Warning` si `prev_exit_clean == Some(false)`, si no `TelemetryStatus::Ok`; (5) arranca el ticker (paso j). Revisar la firma exacta de `emit_event` en `emit.rs:41`.
   j. Ticker propio (NO usar mem_sampler, que arranca tarde): `fn spawn_alive_ticker<R: Runtime>(app: AppHandle<R>)`: bucle `tokio::time::sleep(60 s)`; `now = wall ms`; si `now - prev_tick_ms > 180_000` ⇒ `mutate_marker(true, |m| m.last_resume = Some(MarkerResume{suspended_at_ms: prev_tick_ms, resumed_at_ms: now, gap_s}))` y `emit_event(.., catalog::APP_RESUMED, {suspended_at, resumed_at, gap_s} (rfc3339), Some(TelemetryStatus::Ok), None, None)`; siempre `mutate_marker(false, |m| m.last_alive_ms = now)` dentro de `tokio::task::spawn_blocking`; errores con `warn_once`. (En Windows `tokio::time::sleep` usa Instant, que sigue corriendo durante la suspensión: el tick dispara justo al reanudar y el salto de reloj de pared es la suspensión.)
   k. Pura: `pub(crate) struct PrevInput<'a> { read: &'a MarkerRead, now_ms: u64, current_version: &'a str, panics: &'a [PanicTs], os_boot_ms: Option<u64>, fallback_prev_version: Option<String> }` → `pub(crate) fn summarize_prev(input: &PrevInput) -> PrevSummary`, y `PrevSummary::to_payload(&self, extras: &StartExtras) -> serde_json::Value` con TODOS los campos de `app.start` del contrato §1.6 (`lifecycle_schema:1, build, build_channel, started_at_boot (crate::STARTED_AT_BOOT.load(Relaxed)), autostart_state, started_at, os_boot_at, first_run, marker_status, prev_session_id, prev_version, prev_version_source, version_changed, prev_started_at, prev_last_alive_at, prev_uptime_s, prev_exit_reason, prev_exit_detail, prev_exit_source, prev_exit_clean, prev_exit_interrupted, prev_recording_active_at_exit, prev_panicked, prev_panic_count, os_rebooted_since_prev, downtime_s, clock_skew`). Timestamps rfc3339 con `chrono::DateTime::<chrono::Utc>::from_timestamp_millis(ms).map(|d| d.to_rfc3339())`.
      Reglas (contrato §1.7):
      - `marker_status`: ok | missing | corrupt | foreign. Missing/Corrupt/Foreign ⇒ todos los `prev_*` de salida en null, `prev_exit_clean: null`; `prev_version` = fallback (fuente `"outbox"`) o null; `first_run = Missing && fallback == None`.
      - Ok: `prev_version` = marker.version si no vacía (fuente `"marker"`); `version_changed = prev_version != current`. NUNCA el literal `"unknown"` en una línea que mencione `version` (lint (d) de `lint-telemetry.js`): usar `None`/null.
      - `end_ms` = `exit.begun_at_ms` si hay exit, si no `max(last_alive_ms, started_at_ms)`; `prev_uptime_s = (end_ms - started_at_ms)/1000`; `downtime_s = now - max(exit.done_at_ms.unwrap_or(begun_at_ms), last_alive_ms)`; si negativo ⇒ 0 y `clock_skew: true`.
      - Pánicos en ventana `[started_at_ms, last_alive_ms + 120_000]`: `prev_panicked`, `prev_panic_count`; `main_panic` = alguno con `thread == Some("main")`.
      - `os_rebooted_since_prev`: ambos `os_boot_ms` presentes y difieren >120 000 ms (null si falta alguno).
      - Precedencia del motivo: (1) exit observado ⇒ `(exit.reason, exit.detail, "observed", clean true)`; excepción: si `exit.reason` es `os_session_end` o `external_close` y hay intención con reason `update` ⇒ `("update", exit.detail, "observed", true)`. `prev_exit_interrupted = exit.done_at_ms.is_none()`; `prev_recording_active_at_exit = exit.recording_active`. (2) intención pendiente (NO caducan por edad: toda intención no borrada es del proceso anterior): reason `update` ⇒ `("update", intent.via, "intent", true)`; reason `session_end` ⇒ `("os_session_end", intent.detail, "intent", true)`. (3) `main_panic` ⇒ `("crash_panic", None, "inferred", false)`. (4) `os_rebooted_since_prev == Some(true)` ⇒ `("os_restart_unclean", None, "inferred", false)`. (5) `("unclean", None, "inferred", false)`.
   l. Accesores arrastrados (contrato §1.8, síncronos): `pub fn swap_last_autostart_state(new: &str) -> Option<String>` (mutate no durable; devuelve el valor previo), `pub fn set_last_login_user(maity_user_id: &str)` (durable, `since_ms = now`), `pub fn peek_last_login_user() -> Option<LastLoginUser>` (lee el slot sin escribir), `pub fn take_last_login_user() -> Option<LastLoginUser>` (durable, lo deja en None). Pueden quedar sin llamador (warnings de dead code aceptables: P2 y S4 los usan).
4. `frontend/src-tauri/src/lib.rs` (las líneas pueden haberse corrido por J1/P1a/P1b; ubicar por contenido):
   - Primera sentencia útil de `.setup(|_app| {` (hoy lib.rs:683-689, justo después de los dos `log::info!` iniciales y ANTES del `match tauri::async_runtime::block_on(... initialize_database_on_startup ...)` de lib.rs:696): `logging::telemetry::lifecycle::rotate_at_boot(_app.handle());`.
   - Inmediatamente DESPUÉS del `match` del init de la DB (cierra en lib.rs:728, antes del comentario "Warm-up de ffmpeg"): `logging::telemetry::lifecycle::emit_start(_app.handle());`.
   Nada más cambia en lib.rs en esta tarea.

Tests: en `lifecycle.rs` `#[cfg(test)] mod tests`:
- `parse_marker`: None ⇒ Missing; basura ⇒ Corrupt; JSON v1 válido roundtrip ⇒ Ok; JSON con campos desconocidos y `schema: 2` ⇒ Ok con sus campos conocidos; campos faltantes ⇒ defaults; `build_channel` "store" leído con canal actual "direct" ⇒ Foreign.
- `marker_file_name(true/false)`.
- `write_atomic` en `tempfile::tempdir()` (dev-dependency existente): crea, sobrescribe, no deja `.tmp`, durable y no durable.
- `summarize_prev` en tabla: (1) Missing sin fallback ⇒ first_run true, prev_* null, prev_exit_clean null; (2) Missing con fallback "0.2.61" ⇒ first_run false, prev_version_source "outbox", version_changed true; (3) exit observado `tray_quit` con done ⇒ observed/clean true/interrupted false, uptime y downtime correctos; (4) exit con begun y sin done ⇒ interrupted true; (5) intención `update` via `store_api` sin exit ⇒ reason update, detail store_api, source intent, aunque `at_ms` sea muy anterior a `last_alive_ms` (no caduca); (6) intención `session_end` detail logoff ⇒ os_session_end/logoff/intent; (7) exit `os_session_end` + intención update ⇒ update con el detail de sesión; (8) pánico del hilo `main` dentro de la ventana ⇒ crash_panic, prev_panicked true; (9) pánico de otro hilo dentro de la ventana ⇒ unclean, prev_panicked true; (10) pánico fuera de la ventana ⇒ no cuenta; (11) os_boot distinto >120 s sin exit ⇒ os_restart_unclean, os_rebooted true; (12) sin nada ⇒ unclean, clean false; (13) now < last_alive ⇒ downtime 0, clock_skew true; (14) Foreign ⇒ marker_status foreign y prev_* null.
- El payload de `app.start` nunca contiene el string "unknown" en campos de versión y siempre lleva `lifecycle_schema` y `build`.
En `panics.rs` tests: `parse_panic_ts` con varias líneas, líneas vacías y rotas saltadas, sin `ts_ms` saltada, `thread` leído o None.
Comandos: `cd /c/maity_desktop/frontend/src-tauri && cargo test --lib logging::telemetry::lifecycle`, `cargo test --lib logging::telemetry::panics`, `cd /c/maity_desktop/frontend && node scripts/lint-telemetry.js`, y el build `npm run tauri:build:debug` (en background con log, `EXIT=$?`).

Importadores / consumidores conocidos:
- `panics::install` / `panics::import_pending`: lib.rs:1060-1066 (después del init de la DB; el archivo de pánicos todavía existe cuando corre `rotate_at_boot`).
- `emit::emit_event`: emit.rs:41; catálogo `APP_START`/`APP_RESUMED` los registró A1 en `catalog.rs` (bloque "Ciclo de vida del proceso, sesión y jornada").
- `crate::STARTED_AT_BOOT`: lib.rs:89. `context::process_session_id()`: context.rs:34. `utils::is_running_under_package_identity()`: utils.rs:14.
- `RecordingLogRepository::last_app_version_excluding_session` (A2) y `autostart_state::current` (P1a): verificar que existen con esas firmas antes de usarlas.
- Consumidores futuros del módulo: L2 (`begin_exit`, `finish_exit`), E1 (`note_session_ending`), L3 (`record_update_intent`), P2 (`swap_last_autostart_state`), S4 (`*_last_login_user`).

Trampas:
- Guard de shell: ningún comando Bash puede contener la palabra que empieza con "shut" y termina con "down" (aparece en lib.rs); usar Read/Grep/Edit.
- `.lock().unwrap()` prohibido; nada de `log::error!` en `logging::telemetry` (warn con rate-limit, fuera del lock).
- lint (d): ningún `"unknown"` en líneas con "version" en archivos de `logging/telemetry`.
- `rotate_at_boot` va ANTES del init de la DB (para que un cuelgue de la DB se vea como "arrancó y nunca vivió"); `app.start` se emite DESPUÉS (el outbox necesita `AppState`).
- `emit_start` no debe bloquear el setup: todo en `spawn`. `sysinfo::System::boot_time()` es una función asociada (sysinfo 0.32), no requiere refrescar un `System`.
- Solo archivos de la tarea: NO tocar `catalog.rs`, `telemetry-events.ts` ni `TELEMETRIA.md` (A1 ya registró `app.start`/`app.resumed`); si el lint falla por un nombre, revisar la constante que dejó A1, no agregar otra.
- Protocolo Guardian: la rama de respaldo la crea Julio antes de ejecutar.

Resultado esperado: cada arranque escribe `%LOCALAPPDATA%\com.maity.ai\lifecycle.json` (debug: `lifecycle-debug.json`) y deja en el outbox una fila `app.start` con la versión previa y el motivo del cierre anterior (`unclean` tras "Finalizar tarea", `prev_exit_clean: null` en el primer arranque de 0.2.62); una suspensión de más de 3 min produce `app.resumed`.

Referencias: `docs/specs/telemetria-ciclo-vida-83/research/areas/spec-lifecycle-T2.md` (secciones a-c, h), `docs/specs/telemetria-ciclo-vida-83/research/areas3/verify-lifecycle-T2.md` (issues de intenciones, pánicos, suspensión, foreign, rename). Donde choquen con este texto o con el contrato, manda el contrato (marcador en `app_local_data_dir`, rotación al inicio de setup, intenciones sin caducidad).

**Ajustes del líder tras la refutación del plan (mandan sobre lo anterior si chocan):**
1. Contrato con P2: `swap_last_autostart_state(new) -> Option<String>` es SÍNCRONA, reentrante tras soltar el Mutex, y escribe el marcador (no durable) aunque el valor sea igual al anterior; P2 la usa para swap → emitir → swap de reversa si la fila no quedó en el outbox.
2. `summarize_prev` debe aceptar que el exit observado `process_exit_after_cleanup` (centinela) también lo sobreescriba una intención `update` pendiente (defensa si un camino de update no llamó `begin_exit`).

### L2. app.exit con motivo y ExitRequested

Objetivo: AC-11. Hoy el `.run` de lib.rs solo mira `RunEvent::Exit`, así que el código y la causa de salida se pierden. Esta tarea registra cada salida con motivo (contrato §1.7): escribe el bloque `exit` del marcador ANTES de cualquier otra cosa, deja la fila `app.exit` en el outbox (insert acotado a 750 ms), y cablea las salidas propias (bandeja y rival). El tipo exacto de fin de sesión de Windows lo agrega E1; aquí solo el respaldo `GetSystemMetrics(SM_SHUTTINGDOWN)`.

Pasos:
1. `frontend/src-tauri/src/logging/telemetry/lifecycle.rs` (creado en L1), agregar:
   a. `pub enum ExitHint { TrayQuit, RivalInstall, Update { via: &'static str } }` → motivos `tray_quit`, `rival_install`, `update` (detail = via: `store_button|store_api|nsis`).
   b. `pub(crate) enum ExitRequestSeen { NotSeen, Programmatic(i32), UserInteraction }` y `static EXIT_REQUESTED: std::sync::Mutex<ExitRequestSeen>` (lock con `unwrap_or_else(|e| e.into_inner())`). `pub fn note_exit_requested(code: Option<i32>)`: `Some(c)` ⇒ `Programmatic(c)`, `None` ⇒ `UserInteraction`. Síncrona, sin `prevent_exit` (no cambia el comportamiento).
   c. `pub(crate) fn os_shutting_down() -> bool`: `#[cfg(windows)]` con `#[link(name = "user32")] extern "system" { fn GetSystemMetrics(n_index: i32) -> i32; }` y `const SM_SHUTTINGDOWN: i32 = 0x2000;` (precedente de extern crudo: `console_utils/console_utils.rs:9-10`; NO agregar features al crate `windows`); en no-Windows devuelve false. `pub(crate)` porque E1 la reusa.
   d. `pub(crate) struct SessionEndHint { pub detail: &'static str /* logoff|shutdown|unknown */, pub critical: bool, pub external_close: bool }` (E1 lo llena desde el subclass; en esta tarea solo se construye con el respaldo del SM).
   e. Pura: `pub(crate) struct ExitClass { pub reason: &'static str, pub detail: Option<String>, pub exit_code: Option<i32>, pub session_end_kind: Option<&'static str>, pub critical: bool }` y `pub(crate) fn classify_exit(hint: Option<&ExitHint>, requested: &ExitRequestSeen, session_end: Option<&SessionEndHint>, os_shutting_down: bool) -> ExitClass` con esta precedencia: (1) `hint` gana; (2) `Programmatic(tauri::RESTART_EXIT_CODE)` ⇒ `restart`; (3) `Programmatic(c)` ⇒ `app_exit` con `exit_code: Some(c)`; (4) `UserInteraction` ⇒ `last_window_closed`; (5) `NotSeen` + `session_end` Some con `external_close` ⇒ `external_close`; (6) `NotSeen` + `session_end` Some ⇒ `os_session_end` con detail = `hint.detail`, `session_end_kind`, `critical`; (7) `NotSeen` + `os_shutting_down` ⇒ `os_session_end` detail `unknown`; (8) si no ⇒ `loop_destroyed`.
   f. `static EXIT_BEGUN: AtomicBool` (emit-once). `pub(crate) struct ExitRecord { pub reason: String, pub detail: Option<String>, pub exit_code: Option<i32>, pub begun_at_ms: u64, pub uptime_s: u64, pub recording_active: bool, pub recording_phase: &'static str, pub session_end_kind: Option<String>, pub critical: bool }`.
      `pub fn begin_exit(hint: Option<ExitHint>) -> Option<ExitRecord>`: si `EXIT_BEGUN.swap(true)` ya era true ⇒ None. Lee `EXIT_REQUESTED`; llama `os_shutting_down()` solo si es `NotSeen`; `session_end = None` (E1 lo conecta); `classify_exit`; `let phase = crate::audio::recording_phase::current_phase();` (`is_session_active()`, `as_str()`); `mutate_marker(true, |m| { m.exit = Some(MarkerExit{reason, detail, exit_code, begun_at_ms: now, done_at_ms: None, recording_active, session_end_kind, critical}); m.last_alive_ms = now })` (escritura durable, lo PRIMERO); luego `crate::logging::telemetry::drain::set_exiting()` (A2); devuelve el record. `uptime_s` desde el `started_at_ms` del slot.
   g. `pub const EXIT_ROW_TIMEOUT: Duration = Duration::from_millis(750);` y `pub async fn emit_exit_row<R: Runtime>(app: &AppHandle<R>, rec: &ExitRecord) -> Option<i64>`: `tokio::time::timeout(EXIT_ROW_TIMEOUT, emit::emit_event_with_id(app, context::process_session_id(), catalog::APP_EXIT, payload, Some(TelemetryStatus::Ok), None, None))` (A2; timeout ⇒ None). Payload del contrato §1.6: `{lifecycle_schema:1, reason, detail, exit_code, uptime_s, recording_active, recording_phase, session_end_kind, critical, build}`.
   h. `pub fn finish_exit()`: `mutate_marker(true, |m| if let Some(e) = m.exit.as_mut() { if e.done_at_ms.is_none() { e.done_at_ms = Some(now) } })`. Funciona aunque `begin_exit` de este llamador haya devuelto None.
   i. Centinela: `struct ExitSentinel;` con `impl tauri::Resource for ExitSentinel {}` y `impl Drop for ExitSentinel`: si `!EXIT_BEGUN.swap(true)` escribe (durable) el bloque exit con reason `process_exit_after_cleanup` (begun y done = now). Cubre el `cleanup_before_exit()` sin `RunEvent::Exit` (on_before_exit del updater NSIS, `restart()` en el hilo principal, fallback de `AppHandle::exit`). `pub fn install_exit_sentinel<R: Runtime>(app: &AppHandle<R>)`: `let _ = app.resources_table().add(ExitSentinel);`.
2. `frontend/src-tauri/src/lib.rs` (ubicar por contenido; las líneas se corren):
   - En `setup()`, justo después de `rotate_at_boot(...)` (L1): `logging::telemetry::lifecycle::install_exit_sentinel(_app.handle());`.
   - `.run(|_app_handle, event| { if let tauri::RunEvent::Exit = event { ... } })` (hoy lib.rs:1786-1824) pasa a `match event`:
     - `tauri::RunEvent::ExitRequested { code, .. } => logging::telemetry::lifecycle::note_exit_requested(code),` (el variant es `#[non_exhaustive]`: el `..` es obligatorio).
     - `tauri::RunEvent::Exit => {` log actual; `let exit_rec = logging::telemetry::lifecycle::begin_exit(None);` como PRIMERA sentencia tras el log; dentro del `block_on` existente, ANTES del backstop de 30 s: `if let Some(rec) = &exit_rec { let _ = logging::telemetry::lifecycle::emit_exit_row(_app_handle, rec).await; }`; el resto del bloque (backstop 30 s, cleanup de la DB, sidecar) queda BYTE A BYTE igual; después del `block_on` y antes del log final: `logging::telemetry::lifecycle::finish_exit();`.
     - `_ => {}`.
3. `frontend/src-tauri/src/tray.rs`, rama `"quit"` (hoy tray.rs:60-78), dentro del `spawn`, antes de `set_tray_state(&app_clone, RecordingState::Stopping)`:
   `let exit_id = match crate::logging::telemetry::lifecycle::begin_exit(Some(crate::logging::telemetry::lifecycle::ExitHint::TrayQuit)) { Some(rec) => crate::logging::telemetry::lifecycle::emit_exit_row(&app_clone, &rec).await, None => None };`
   Después del timeout del graceful de 60 s y ANTES de `app_clone.exit(0)`: `if let Some(id) = exit_id { let _ = crate::logging::telemetry::drain::flush_row(&app_clone, id, std::time::Duration::from_secs(3)).await; }` (el flush va después del stop para no retrasar el guardado de la grabación).
4. `frontend/src-tauri/src/rival_install.rs`, en `uninstall_rival` (hoy :104-110): DESPUÉS de `launch_detached_uninstaller(&info, std::process::id())?;` (solo si tuvo éxito) y ANTES del paso 5 `db.cleanup()`: `if let Some(rec) = crate::logging::telemetry::lifecycle::begin_exit(Some(crate::logging::telemetry::lifecycle::ExitHint::RivalInstall)) { let _ = crate::logging::telemetry::lifecycle::emit_exit_row(&app, &rec).await; }`. SIN flush (el pool se cierra enseguida; la fila sube en el siguiente arranque).

Tests: en `lifecycle.rs` tests:
- Tabla de `classify_exit`: hint `TrayQuit` gana sobre `Programmatic(0)` y sobre `os_shutting_down`; `Update{via:"store_button"}` ⇒ update/store_button; `Programmatic(i32::MAX)` (= `tauri::RESTART_EXIT_CODE`) ⇒ restart; `Programmatic(0)` ⇒ app_exit con exit_code 0; `UserInteraction` ⇒ last_window_closed; `NotSeen` + hint de sesión logoff ⇒ os_session_end/logoff; `NotSeen` + external_close ⇒ external_close; `NotSeen` + `os_shutting_down` ⇒ os_session_end/unknown; `NotSeen` sin nada ⇒ loop_destroyed.
- Todos los `reason` posibles de `classify_exit` pertenecen a la lista del contrato §1.7 (constante de test con los strings).
- emit-once: probar la lógica con un `AtomicBool` local (extraer `fn claim_once(flag: &AtomicBool) -> bool` y testearla), sin tocar el static global.
Comandos: `cd /c/maity_desktop/frontend/src-tauri && cargo test --lib logging::telemetry::lifecycle` y el build `npm run tauri:build:debug` en background con log.

Importadores / consumidores conocidos:
- `graceful_..._before_exit` (lib.rs:1833) lo llaman el Exit handler (lib.rs:1795) y el quit de la bandeja (tray.rs:69); no cambia.
- `tauri::RESTART_EXIT_CODE` = `i32::MAX` (tauri 2.11.2 app.rs:77, re-exportado).
- `drain::flush_row`, `drain::set_exiting`, `emit::emit_event_with_id`: creados en A2 (verificar firmas: contrato §1.8).
- `recording_phase::current_phase()`: audio/recording_phase.rs:140.
- E1 reemplaza el `session_end = None` de `begin_exit` por `crate::session_end::observed()`; E2b reestructura el brazo `Exit` para fin de sesión; L3 usa `ExitHint::Update { via: "store_button" }`.

Trampas:
- Guard de shell: la función de graceful y el sidecar tienen la palabra bloqueada en el nombre; editar lib.rs y tray.rs solo con Edit/Read/Grep, nunca con sed/grep por Bash que la contenga.
- `begin_exit` escribe el marcador ANTES del insert al outbox y antes del backstop; el insert está acotado a 750 ms porque el pool tiene `acquire_timeout` de 30 s (el marcador es la fuente de verdad; la fila es best-effort).
- No cambiar el orden ni el contenido del camino actual del Exit (backstop 30 s, DB, sidecar): E2b es quien lo acota en fin de sesión.
- `ExitRequested` también llega en la salida de la bandeja (`app.exit(0)` ⇒ `Programmatic(0)`); no importa porque el hint ya ganó y `begin_exit(None)` del Exit devuelve None.
- Sin `prevent_exit` en `ExitRequested`. Sin eventos Tauri nuevos.
- En `rival_install.rs`, si el lanzamiento falla la app sigue viva: por eso `begin_exit` va DESPUÉS del `?`.

Resultado esperado: salir desde la bandeja deja una fila `app.exit` con `reason: tray_quit` que sube en segundos; la desinstalación rival deja `rival_install`; un reinicio programático `restart`; cerrar la última ventana (regresión tipo 0.2.57) `last_window_closed`; un fin de sesión sin E1 `os_session_end`/`unknown`; y el siguiente `app.start` lo reporta como `prev_exit_source: observed`.

Referencias: `docs/specs/telemetria-ciclo-vida-83/research/areas/spec-lifecycle-T2.md` (secciones d-g), `docs/specs/telemetria-ciclo-vida-83/research/areas3/verify-lifecycle-T2.md` (timeout de 750 ms, centinela), `docs/specs/telemetria-ciclo-vida-83/research/plan-agent-review.md` (P0 #3-#4). Los nombres de motivo del informe T2 (`rival_uninstall`, `update_store`, `session_end`...) están OBSOLETOS: mandan los del contrato §1.7.

**Ajustes del líder tras la refutación del plan (mandan sobre lo anterior si chocan):**
1. `emit_exit_row` recibe el timeout como parámetro: `pub async fn emit_exit_row<R: Runtime>(app: &AppHandle<R>, rec: &ExitRecord, timeout: Duration) -> Option<i64>` con `pub const EXIT_ROW_TIMEOUT: Duration = 750 ms` para las salidas normales y `pub const EXIT_ROW_TIMEOUT_SESSION_END: Duration = 400 ms` que usa E2b en la rama de fin de sesión. Todos los llamadores de esta tarea pasan `EXIT_ROW_TIMEOUT`.

### E1. Tipo de fin de sesion de Windows via subclass

Objetivo: AC-11 (parte de fin de sesión). tao ignora WM_QUERYENDSESSION y descarta el lParam de WM_ENDSESSION, así que hoy no se sabe si la app murió por cierre de sesión, apagado/reinicio o un cierre del Restart Manager (instalador). Se crea `session_end.rs` con un subclass en el HWND de la ventana `main` que registra el tipo, y `lifecycle::begin_exit` lo usa para clasificar `os_session_end` (detail `logoff|shutdown|unknown`, `critical`) o `external_close`. En esta tarea NO cambia el comportamiento de la salida (el acotado es E2b).

Pasos:
1. Nuevo `frontend/src-tauri/src/session_end.rs`. Parte pura (compila en todas las plataformas):
   - Literales (sin feature nueva del crate `windows`): `pub const WM_QUERYENDSESSION: u32 = 0x0011; pub const WM_ENDSESSION: u32 = 0x0016; pub const WM_NCDESTROY: u32 = 0x0082; pub const LP_CLOSEAPP: u32 = 0x0000_0001; pub const LP_CRITICAL: u32 = 0x4000_0000; pub const LP_LOGOFF: u32 = 0x8000_0000;` y `const SUBCLASS_ID: usize = 0x4D41_4954;` (tao usa 0 y 1).
   - `#[derive(Debug, Clone, Copy, PartialEq, Eq)] pub enum SessionEndKind { Logoff, Shutdown, CloseApp, Unknown }` con `as_str()` ⇒ `logoff|shutdown|close_app|unknown`.
   - `#[derive(Debug, Clone, Copy, PartialEq, Eq)] pub enum SessionEndSource { QueryEndSession, EndSession, SystemMetric }`.
   - `#[derive(Debug, Clone, Copy)] pub struct SessionEndInfo { pub kind: SessionEndKind, pub critical: bool, pub close_app: bool, pub source: SessionEndSource, pub lparam: u32, pub observed_at: std::time::Instant }`.
   - `pub fn classify(lparam: u32, shutting_down: bool) -> (SessionEndKind, bool /*critical*/, bool /*close_app*/)`: `critical = lparam & LP_CRITICAL != 0`; si CLOSEAPP: con `shutting_down` ⇒ `Logoff` si hay bit LOGOFF, si no `Shutdown`, y `close_app: true` (un reinicio con EWX_RESTARTAPPS llega como CLOSEAPP); sin `shutting_down` ⇒ `CloseApp` (Restart Manager real); si LOGOFF ⇒ `Logoff`; resto ⇒ `Shutdown`.
   - `pub struct SessionEndCell { inner: std::sync::Mutex<Option<SessionEndInfo>> }` con `pub const fn new()`, `record(&self, info)` (QES: sobrescribe), `record_if_absent(&self, info, now: Instant)` (ES(TRUE): no pisa un registro FRESCO, pero SÍ reemplaza uno más viejo que `RECORD_TTL`), `clear(&self)`, `fresh(&self, now: Instant, ttl: Duration) -> Option<SessionEndInfo>`. Lock con `if let Ok(mut g) = self.inner.lock()` (nunca `.unwrap()`). `pub const RECORD_TTL: Duration = Duration::from_secs(120);` `static CELL: SessionEndCell = SessionEndCell::new();`.
   - `pub fn observed() -> Option<SessionEndInfo>`: `CELL.fresh(Instant::now(), RECORD_TTL)`; si None y `crate::logging::telemetry::lifecycle::os_shutting_down()` ⇒ `Some(SessionEndInfo{kind: Unknown, critical: false, close_app: false, source: SystemMetric, lparam: 0, ..})`; si no, None. En no-Windows devuelve siempre None.
2. Parte Windows `#[cfg(target_os = "windows")] mod imp`:
   - `pub fn install(window: &tauri::WebviewWindow)`: `window.hwnd()` (en el hilo principal tauri lo sirve inline); convertir como `store_update.rs:83-84` y `:92` (`hwnd.0 as isize` ⇒ `windows::Win32::Foundation::HWND(v as *mut core::ffi::c_void)`); `unsafe { windows::Win32::UI::Shell::SetWindowSubclass(hwnd, Some(subclass_proc), SUBCLASS_ID, 0) }` (ya disponible por `Win32_UI_Shell`, implícito en `Win32_UI_Shell_PropertiesSystem`); `log::info!("[session_end] subclass instalado en main")` o `log::warn!` si devuelve FALSE; nunca panic.
   - `unsafe extern "system" fn subclass_proc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM, _id: usize, _ref: usize) -> LRESULT`: el cuerpo dentro de `std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| { ... }))`; al final SIEMPRE `DefSubclassProc(hwnd, msg, wparam, lparam)` (nunca devolver FALSE: no vetamos el fin de sesión).
     - `WM_QUERYENDSESSION`: `let sd = lifecycle::os_shutting_down(); let (kind, critical, close_app) = classify(lparam.0 as u32, sd); CELL.record(SessionEndInfo{source: QueryEndSession, ..}); crate::logging::telemetry::lifecycle::note_session_ending(kind);` + `log::info!("[session_end] WM_QUERYENDSESSION kind={} critical={} lparam={:#x}")`.
     - `WM_ENDSESSION` con `wparam.0 == 0` (cancelado): `CELL.clear(); lifecycle::clear_session_ending();` + info. Con `wparam != 0`: `CELL.record_if_absent(info con source EndSession, Instant::now())`.
     - `WM_NCDESTROY`: `RemoveWindowSubclass(hwnd, Some(subclass_proc), SUBCLASS_ID)`.
   - Stub no-Windows: `pub fn install(_w: &tauri::WebviewWindow) {}`. Re-exportar `pub use imp::install;` según cfg.
3. `frontend/src-tauri/src/logging/telemetry/lifecycle.rs`:
   - `pub fn note_session_ending(kind: crate::session_end::SessionEndKind)`: síncrona, segura dentro de un WndProc (sin await); `mutate_marker(true, |m| if m.exit_intent.as_ref().map(|i| i.reason.as_str()) != Some("update") { m.exit_intent = Some(MarkerIntent{reason: "session_end".into(), via: None, detail: Some(kind.as_str().into()), target_version: None, at_ms: now}) })` — no pisa una intención `update`. Warn (con el rate-limit del módulo) fuera del lock si falla.
   - `pub fn clear_session_ending()`: durable; borra `exit_intent` SOLO si su `reason == "session_end"`.
   - En `begin_exit`: reemplazar `session_end = None` por el mapeo de `crate::session_end::observed()` (solo cuando `requested` es `NotSeen`): `Logoff`⇒`SessionEndHint{detail:"logoff", critical, external_close:false}`, `Shutdown`⇒`"shutdown"`, `Unknown`⇒`"unknown"`, `CloseApp`⇒`external_close: true`. `classify_exit` (L2) no cambia de firma.
4. `frontend/src-tauri/src/lib.rs`: `pub mod session_end;` junto a `pub mod rival_install;` (hoy lib.rs:62). En `setup()`, dentro del bloque `if let Some(main_window) = _app.get_webview_window("main") {` (hoy lib.rs:922-949), DESPUÉS del `main_window.on_window_event(...)`: `session_end::install(&main_window);`. En el brazo `RunEvent::Exit` agregar tras `begin_exit` un `log::info!("Application exiting (session_end={:?})", session_end::observed().map(|s| (s.kind.as_str(), s.critical, s.source)))`. Ningún otro cambio de comportamiento.
5. `frontend/src-tauri/Cargo.toml`: NO se toca (preferido: literales + extern `user32` de L2). Solo si el implementador decide usar `Win32_UI_WindowsAndMessaging` lo agrega a la lista `windows = { version = "0.58", features = [` (hoy :272-296) con comentario y lo justifica en el commit; en ese caso editar con Edit (nunca Bash).

Tests: `session_end.rs` `#[cfg(test)] mod tests`:
- Tabla `classify(lparam, shutting_down)`: (0,false)⇒(Shutdown,false,false); (0x8000_0000,*)⇒Logoff; (0x1,false)⇒(CloseApp,false,false); (0x1,true)⇒(Shutdown,false,true); (0x8000_0001,true)⇒(Logoff,false,true); (0x4000_0000,*)⇒(Shutdown,true,false); (0x4000_0001,false)⇒(CloseApp,true,false); (0xC000_0000,*)⇒(Logoff,true,false).
- `SessionEndCell` sobre una instancia LOCAL (no el static): record⇒fresh Some; record_if_absent no pisa un registro fresco de QES; record_if_absent SÍ reemplaza uno más viejo que el TTL (inyectar `now = observed_at + 121 s`); clear⇒None; fresh None pasado el TTL.
- `#[cfg(all(test, windows))]`: si el crate expone las constantes con las features actuales, compararlas; si no (caso sin `Win32_UI_WindowsAndMessaging`), fijar los literales contra los valores documentados por Microsoft (0x11, 0x16, 0x82, 0x1, 0x4000_0000, 0x8000_0000, SM_SHUTTINGDOWN 0x2000) para detectar cambios accidentales.
- `lifecycle.rs`: agregar a la tabla de `classify_exit` los casos que ahora produce el mapeo (Logoff crítico ⇒ os_session_end/logoff critical true; CloseApp ⇒ external_close) y un test de la lógica de `note_session_ending`/`clear_session_ending` extrayendo las funciones puras `fn apply_session_intent(m: &mut LifecycleMarker, kind, now)` y `fn clear_session_intent(m: &mut LifecycleMarker)` (no pisa `update`; clear solo borra `session_end`).
Comandos: `cd /c/maity_desktop/frontend/src-tauri && cargo test --lib session_end`, `cargo test --lib logging::telemetry::lifecycle`, build `npm run tauri:build:debug` en background con log.

Importadores / consumidores conocidos:
- `store_update.rs:78-92`: patrón de conversión del HWND de tauri (windows 0.61) al de windows 0.58.
- `lib.rs:922-949`: hook existente de la ventana main en setup (lugar del `install`).
- `lifecycle::os_shutting_down` (L2), `lifecycle::begin_exit` / `classify_exit` (L2).
- Consumidores futuros: E2b (`observed()`, presupuestos, `SetProcessShutdownParameters` dentro de `install`).

Trampas:
- Guard de shell: nada de Bash con la palabra bloqueada (nombres de APIs/funciones); nunca nombrar archivos/módulos con ella. Editar con Edit/Grep.
- Dentro del WndProc: sin await, sin getters de ventana, sin emits; solo atomics, el Mutex de la celda, la escritura síncrona del marcador y logs `info!`/`warn!` (nunca `log::error!`: `session_end` NO está excluido del bridge de errores y dispararía telemetría desde el WndProc).
- QES no detiene nada: otra app puede cancelar el fin de sesión (ES(FALSE)); por eso `clear_session_ending` borra la intención.
- `catch_unwind` obligatorio: un panic cruzando FFI aborta el proceso.
- SIN `ShutdownBlockReasonCreate` y sin checkpoint temprano en QES (decisión del contrato).
- `lifecycle.rs` pasa a depender de `crate::session_end` (mismo crate): el módulo puro debe compilar en macOS/Linux (solo `imp` va con cfg windows).

Resultado esperado: tras cerrar sesión de Windows y volver, el siguiente `app.start` trae `prev_exit_reason: os_session_end`, `prev_exit_detail: logoff` (reinicio/apagado ⇒ `shutdown`, instalador con Restart Manager ⇒ `external_close`); si Windows mató el proceso durante WM_ENDSESSION antes del bloque exit, la intención `session_end` lo reporta con `prev_exit_source: intent`. El log muestra `[session_end] WM_QUERYENDSESSION kind=...`.

Referencias: `docs/specs/telemetria-ciclo-vida-83/research/areas/spec-session-end-B5.md` §1-2, `docs/specs/telemetria-ciclo-vida-83/research/areas/verify-session-end-B5.md` issue 1 (CLOSEAPP con apagado), `docs/specs/telemetria-ciclo-vida-83/research/areas3/verify-session-end-B5.md` (record_if_absent con TTL). Los strings `os_shutdown`/`os_close_app` del informe B5 están OBSOLETOS: mandan los del contrato §1.7.

**Ajustes del líder tras la refutación del plan (mandan sobre lo anterior si chocan):**
1. Restart Manager en la intención: si el QES trae CLOSEAPP sin apagado del sistema (`kind = CloseApp`), `note_session_ending` guarda la intención `session_end` con detail `close_app`; `summarize_prev` (este archivo, lifecycle.rs) la mapea a `("external_close", None, "intent", true)` y NO a `os_session_end`. Fila nueva en el test de tabla de `summarize_prev`.
2. Subclass también de las demás ventanas top-level del hilo principal (incluida la ventana oculta de tao que dispara `loop_destroyed` desde su WM_ENDSESSION): en `install`, además de `main`, enumerar con `EnumThreadWindows(GetCurrentThreadId(), …)` (extern `user32` con literales, sin feature nueva) y aplicar el MISMO `subclass_proc`/`SUBCLASS_ID` a cada HWND top-level que no lo tenga. Nuestra subclass se instala después que la de tao, así que corre ANTES y registra el `lParam` del ES aunque no haya QES (EWX_FORCE). Si la enumeración falla, seguir solo con `main` (log warn). Documentar que el `lParam` fiable es el del QES y el del ES es respaldo.

### E2a. Flush acotado de la grabacion para fin de sesion

Objetivo: AC-12 (capa de grabación). En un fin de sesión de Windows el stop normal espera hasta 120 s la cola de transcripción antes de escribir el último checkpoint, así que Windows mata el proceso y el final se pierde. Esta tarea agrega, SIN cablearlo todavía (lo cablea E2b en `RunEvent::Exit`), un flush acotado que: congela los arranques, detiene la captura, escribe `transcripts.json`, intenta el checkpoint final solo si alcanza, y nunca hace merge, finalize, emits ni borra audio. Los warnings de dead code entre E2a y E2b son aceptables.

Pasos:
1. `frontend/src-tauri/src/audio/recording_phase.rs`:
   - `static SESSION_ENDING: std::sync::atomic::AtomicBool = AtomicBool::new(false);`, `pub fn set_session_ending()` (store true, SeqCst) y `pub fn is_session_ending() -> bool`. Irreversible a propósito (solo lo pone E2b dentro de `RunEvent::Exit`).
   - Pura `fn session_end_refusal(ending: bool) -> Option<String>` ⇒ `Some("Recording refused: session ending".into())` si `ending`.
   - `StartGate::acquire()` (hoy :166-168, el del singleton de producción): antes de delegar en `acquire_on`, `if let Some(e) = session_end_refusal(is_session_ending()) { return Err(e); }`. NO tocar `acquire_on` (los tests usan máquinas propias y no deben depender del flag global).
2. `frontend/src-tauri/src/audio/incremental_saver.rs`:
   - `#[derive(Debug, Clone, Copy, PartialEq, Eq)] pub enum SessionEndAudio { Written, SkippedEmpty, SkippedSlow, FinalTimedOut, FinalFailed, NoSaver, LockTimedOut }`.
   - Helper `pub(crate) fn quarantine_file(path: &Path, suffix: &str) -> bool`: renombra `x.mp4` a `x.mp4.<suffix>` (`std::fs::rename`), true si lo logró; nunca borra. E3 lo reusa con `"bad"`.
   - `pub async fn flush_for_session_end(&mut self, soft: Instant, hard: Instant) -> SessionEndAudio` (mismo `Instant` de tokio que usan `acquire_encode_slot` :257 y `FINALIZE_ENCODE_TIMEOUT` :21/:293):
     a. `let inflight_idx = self.checkpoint_count.checked_sub(1); let errs0 = self.encode_errors.load(SeqCst);`
     b. `match self.acquire_encode_slot(soft, "session end").await`:
        - `Ok(permit)`: si `encode_errors > errs0` y hay `inflight_idx`, el encode que estaba en vuelo falló ⇒ `quarantine_file(checkpoints_dir/audio_chunk_{idx:03}.mp4, "failed")`. Si el buffer está vacío ⇒ `drop(permit)` y `SkippedEmpty`. Si no: `let errs1 = load; let buf = self.take_buffer_for_checkpoint(); self.dispatch_checkpoint_encode(buf, permit);` (:160, :175; `dispatch` numera con `checkpoint_count` ANTES de incrementarlo, así que el archivo recién despachado es `count-1`). Barrera: `match self.acquire_encode_slot(hard, "session end barrier").await { Err(_) => FinalTimedOut /* no renombrar: puede seguir escribiendo */, Ok(p) => { drop(p); if encode_errors > errs1 { quarantine_file(.. audio_chunk_{count-1:03}.mp4, "failed"); FinalFailed } else { Written } } }`.
        - `Err(_)` (vence `soft` con un encode lento en vuelo): NO despachar otro (se pierde la cola); esperar `self.acquire_encode_slot(hard, ..)` para no truncar el archivo en vuelo y soltar el permiso; devolver `SkippedSlow` (buffer intacto).
     c. NUNCA llamar `merge_checkpoints` ni `remove_dir_all(checkpoints_dir)`: los checkpoints son la fuente de la recuperación.
3. `frontend/src-tauri/src/audio/recording_saver.rs`:
   - Extraer el preludio de `stop_and_save` (hoy :407-446: `is_saving=false`, cancelar el token de cancelación del writer (campo :119), sleep 200 ms, join de `writer_handle` con timeout y abort, escritura temprana de `transcripts.json`) a `async fn quiesce_writer_and_write_transcripts(&mut self, grace: Duration, join_timeout: Duration)`. `stop_and_save` lo llama con `(200 ms, 5 s)`: comportamiento idéntico, mismos logs.
   - `pub async fn flush_for_session_end(&mut self, soft: tokio::time::Instant, hard: tokio::time::Instant) -> SessionEndAudio`: `quiesce_writer_and_write_transcripts(min(200 ms, restante), min(1 s, restante hasta soft))`; si `incremental_saver` es None ⇒ `NoSaver`; si no `let Ok(mut saver) = tokio::time::timeout_at(hard, saver_arc.lock()).await else { return SessionEndAudio::LockTimedOut };` y `saver.flush_for_session_end(soft, hard).await`. No tocar metadata.json, no emitir `RECORDING_SAVED`, no limpiar el store de transcripts.
4. `frontend/src-tauri/src/audio/recording_manager.rs`: `pub async fn flush_for_session_end(&mut self, soft, hard) -> SessionEndAudio` que delega en `self.recording_saver` (campo :29).
5. `frontend/src-tauri/src/audio/recording_lifecycle.rs`, junto a `stop_recording_reporting` (:460):
   - `#[derive(Debug, Clone, Copy)] pub struct SessionEndBudgets { pub stream: Duration, pub soft: Duration, pub hard: Duration }` (medidos desde `t0`).
   - `#[derive(Debug)] pub struct SessionEndFlushReport { pub was_recording: bool, pub mode: &'static str /* batch|streaming|none */, pub audio: Option<SessionEndAudio>, pub stream_stop_timed_out: bool, pub manager_missing: bool, pub elapsed_ms: u64 }`.
   - `pub async fn flush_recording_for_session_end(t0: tokio::time::Instant, b: SessionEndBudgets) -> SessionEndFlushReport`:
     1. `let gate = match StopGate::acquire() { Ok(g) => g, Err(_) => return report NotRecording (was_recording false, mode "none") };` (StopGate cubre Recording y Paused, recording_phase.rs:237-246).
     2. `let mode = if crate::audio::transcription::engine::active_recording_uses_stt() { "streaming" } else { "batch" };` (como en :752).
     3. Tomar el manager como en :547-550 (`RECORDING_MANAGER.lock()` con `map_err`/match, `.take()`, soltar el guard en su propio statement). Si None (p. ej. `switch_audio_device` lo tiene prestado) ⇒ `manager_missing: true`, `std::mem::forget(gate)` y devolver.
     4. `stream_stop_timed_out = tokio::time::timeout_at(t0 + b.stream, manager.stop_streams_and_force_flush()).await.is_err()` (recording_manager.rs:262-296; en timeout `warn!` y seguir).
     5. `let audio = manager.flush_for_session_end(t0 + b.soft, t0 + b.hard).await;`
     6. `std::mem::forget(gate);` (la fase queda en `Stopping`: el scheduler no rearranca y `recover_orphans` de este proceso no toma su propia fila batch) y `std::mem::forget(manager);` (su Drop podría hacer join de hilos de captura).
     7. Un solo `info!("[session_end] flush: {:?}", report)` y devolver.
     Omitido A PROPÓSITO: espera de transcripción, `live_feedback::stop`, `save_recording_only`, `mark_pending` del batch (la fila queda `recording` y es huérfana al próximo arranque porque cambia el pid), `finalize_segment_native`/`close_scheduled`, `app.emit`, bandeja y notificaciones.

Tests (ninguno puede despachar un encode real: sin ffmpeg en PATH el `spawn_blocking` se cuelga; ver el comentario de `test_checkpoint_defers_without_dropping_audio_when_encode_busy`, :722-738):
- `incremental_saver` tests: (a) permiso tomado a mano (`saver.encode_slots.clone().try_acquire_owned()`), buffer con datos, `soft = now+50 ms`, `hard = now+100 ms` ⇒ `SkippedSlow`, largo del buffer y `checkpoint_count` sin cambio, sin `concat_list.txt` ni `audio.mp4`, `.checkpoints/` intacto; (b) permiso libre y buffer vacío ⇒ `SkippedEmpty`, `checkpoint_count` sin cambio; (c) `quarantine_file` en `tempdir`: el `.mp4` pasa a `.mp4.failed`, el original ya no existe, el contenido se conserva.
- `recording_phase` tests: `session_end_refusal(false) == None`, `session_end_refusal(true)` contiene "session ending". NO setear el static global en tests.
- `recording_saver`: los tests existentes (`mod transcript_writer_tests`, :688) siguen verdes tras extraer el preludio.
Comandos: `cd /c/maity_desktop/frontend/src-tauri && cargo test --lib audio::incremental_saver`, `cargo test --lib audio::recording_phase`, `cargo test --lib audio::recording_saver`, build `npm run tauri:build:debug` en background con log.

Importadores / consumidores conocidos:
- `StartGate::acquire()`: embudos de arranque de grabación (grep `StartGate::acquire` en `audio/`); todos reciben ahora el Err mientras el flag está puesto.
- `RecordingSaver::stop_and_save`: lo llama `RecordingManager::save_recording_only` (recording_manager.rs:299).
- `RECORDING_MANAGER`: recording_lifecycle.rs:24 (std Mutex).
- Consumidor futuro: E2b (`flush_recording_for_session_end`, `set_session_ending`, `SessionEndBudgets`); E3 (`quarantine_file`).

Trampas:
- Reglas de checkpoints (`docs/REGLAS_AUDIO_GRABACION.md` #08/#18): no cambiar el intervalo de 30 s, la extensión `.mp4` ni el semáforo de 1 encode.
- Nunca sostener el guard std de `RECORDING_MANAGER` a través de un `.await`.
- Mutex con `.lock().map_err()`/match, nunca `.lock().unwrap()`.
- Sin emits, getters de ventana, bandeja ni notificaciones: en E2b esto corre mientras el hilo principal está en `block_on`, y cualquier llamada que necesite el hilo principal se queda colgada.
- Un chunk fallido se RENOMBRA (`.failed`), nunca se borra; el filtro de recuperación por extensión `.mp4` lo excluye solo.
- Guard de shell: no usar Bash con la palabra bloqueada (aparece en nombres del área, p. ej. el campo `writer_...` de recording_saver.rs y la función de graceful de lib.rs): buscar y editar con Edit/Read/Grep.

Resultado esperado: existe `flush_recording_for_session_end` que termina en ≤ `hard` desde `t0` sin merge ni finalize, deja los checkpoints y `transcripts.json` en disco y congela la fase en `Stopping`; `StartGate::acquire()` se niega con el flag puesto; el camino normal de stop (`stop_and_save`) se comporta igual que antes.

Referencias: `docs/specs/telemetria-ciclo-vida-83/research/areas/spec-session-end-B5.md` §3.2-3.3, `docs/specs/telemetria-ciclo-vida-83/research/areas/verify-session-end-B5.md` (flag SESSION_ENDING), `docs/specs/telemetria-ciclo-vida-83/research/areas3/verify-session-end-B5.md` (renombrar en vez de borrar). El checkpoint temprano en QES del informe B5 queda FUERA (contrato).

### E2b. Fin de sesion de Windows no bloquea 30 s

Objetivo: AC-12 y AC-23. Hoy `RunEvent::Exit` corre dentro del WM_ENDSESSION de tao en el hilo principal y lo bloquea hasta 30 s (backstop de graceful) más un cleanup de la DB y un kill del sidecar sin límite: Windows muestra "esta app impide apagar" o mata el proceso a los 5 s y el final de la grabación se pierde. Esta tarea agrega una rama de fin de sesión acotada (< 5 s en total en el hilo principal) que usa el flush de E2a en un worker, congela el scheduler y los arranques, y deja intacto el camino actual para todas las demás salidas. Además, `SetProcessShutdownParameters(0x3FF, 0)` para recibir QES/ES antes que los hijos ffmpeg/llama-helper.

Pasos:
1. `frontend/src-tauri/src/session_end.rs` (creado en E1):
   - Presupuestos (sin reason string de Windows): `pub const STREAM_STOP_BUDGET: Duration = 1000 ms; pub const FINAL_ENCODE_SOFT: Duration = 1500 ms; pub const HARD_BUDGET: Duration = 3000 ms; pub const DB_CLEANUP_BUDGET: Duration = 500 ms; pub const SIDECAR_BUDGET: Duration = 300 ms; pub const SCHED_FREEZE_BUDGET: Duration = 200 ms;` y `pub fn budgets() -> crate::audio::recording_lifecycle::SessionEndBudgets { stream: STREAM_STOP_BUDGET, soft: FINAL_ENCODE_SOFT, hard: HARD_BUDGET }`.
   - En `imp::install` (Windows), al principio: `unsafe { windows::Win32::System::Threading::SetProcessShutdownParameters(0x3FF, 0) }` (feature `Win32_System_Threading` ya habilitada, Cargo.toml:283); si devuelve Err ⇒ `log::warn!`, nunca panic. Nivel 0x3FF = Maity recibe el fin de sesión antes que sus hijos (nivel por defecto 0x280), así el ffmpeg del checkpoint final sigue vivo.
2. `frontend/src-tauri/src/lib.rs`, brazo `tauri::RunEvent::Exit` (tras L2+E1 empieza con `let exit_rec = logging::telemetry::lifecycle::begin_exit(None);` y el log de `observed()`):
   - Decidir la rama: `let se = session_end::observed(); let se_by_reason = matches!(exit_rec.as_ref().map(|r| r.reason.as_str()), Some("os_session_end") | Some("external_close")); if se.is_some() || se_by_reason { run_session_end_exit(_app_handle, exit_rec.as_ref(), se); return; }` — `return` desde el brazo del `match` (o estructurar con `if/else`); todo lo demás del brazo (emit de la fila, backstop 30 s, DB, sidecar, `finish_exit`) queda EXACTAMENTE como lo dejó L2.
   - Nueva función en lib.rs (junto a la función de graceful de :1833): `fn run_session_end_exit(app: &tauri::AppHandle, exit_rec: Option<&logging::telemetry::lifecycle::ExitRecord>, se: Option<session_end::SessionEndInfo>)`, síncrona, hilo principal:
     1. `audio::recording_phase::set_session_ending();` (PRIMERO: desde aquí ningún `StartGate::acquire()` arranca). `let phase_at_entry = audio::recording_phase::current_phase();`
     2. `tauri::async_runtime::block_on(async { ... })` con, en orden:
        a. Congelar el scheduler (J1): `if let Some(st) = app.try_state::<scheduled_recording::commands::ScheduledRecordingState>() { let st = st.inner().clone(); let _ = tokio::time::timeout(session_end::SCHED_FREEZE_BUDGET, async move { let svc = st.read().await; svc.begin_session_end() /* .await si J1 la hizo async: revisar su firma */; }).await; }`. Snapshot del guard en su propio statement (regla del contrato §1.9).
        b. `if let Some(rec) = exit_rec { let _ = logging::telemetry::lifecycle::emit_exit_row(app, rec).await; }` (ya acotado a 750 ms por L2; SIN `flush_row`: nada de red en fin de sesión).
        c. `let t0 = tokio::time::Instant::now(); let h = tauri::async_runtime::spawn(audio::recording_lifecycle::flush_recording_for_session_end(t0, session_end::budgets()));` y `match tokio::time::timeout_at(t0 + session_end::HARD_BUDGET, h).await { Ok(Ok(report)) => log::info!(...), Ok(Err(e)) => log::warn!(...), Err(_) => log::warn!("[session_end] flush excedió el presupuesto") }`. El flush corre en un worker: las llamadas síncronas (drop de streams cpal, lock std de `RECORDING_MANAGER`) no pueden alargar el hilo principal.
        d. DB: si `phase_at_entry != RecordingPhase::Stopping`: `if let Some(st) = app.try_state::<state::AppState>() { let db = st.db_manager.clone(); /* DatabaseManager es Clone, manager.rs:48 */ let h = tauri::async_runtime::spawn(async move { db.cleanup().await }); let _ = tokio::time::timeout(session_end::DB_CLEANUP_BUDGET, h).await; }`. Si la fase era `Stopping` al entrar (un stop o rotación con finalize en vuelo): NO cerrar el pool, solo `log::info!` (ese segmento queda para la recuperación del próximo arranque).
        e. Sidecar: `let h = tauri::async_runtime::spawn(<la función de summary/summary_engine/client.rs:203 que ya usa el Exit handler>()); let _ = tokio::time::timeout(session_end::SIDECAR_BUDGET, h).await;`.
     3. `log::logger().flush(); logging::telemetry::lifecycle::finish_exit();`
     4. Si `se` es `Some` con `kind == SessionEndKind::CloseApp` (Restart Manager SIN apagado del sistema: Windows NO mata el proceso y tao quedaría en un loop `Destroyed` que entra en panic): `app.cleanup_before_exit(); std::process::exit(0);`. En los demás casos, volver normal (Windows termina el proceso al devolver WM_ENDSESSION).
   - Nada de emits, getters de ventana, bandeja, toasts ni `flush_row` en esta función.
3. `docs/REGLAS_AUDIO_GRABACION.md`: nueva sección "Fin de sesión de Windows con grabación activa (#83, desde 0.2.62)" con: mapa de hilos (WndProc de `main` registra el tipo en QES; `RunEvent::Exit` corre dentro del WM_ENDSESSION de tao en el hilo principal; el flush corre en un worker de tokio acotado con `timeout_at`); prohibiciones dentro de WM_ENDSESSION (merge, finalize, `mark_pending`, emits, getters de ventana, bandeja, notificaciones, red); presupuestos (congelado 0.2 s + fila 0.75 s + flush 3 s + DB 0.5 s + sidecar 0.3 s < 5 s, sin reason string); `SESSION_ENDING` congela arranques y scheduler; `mem::forget(StopGate)` y por qué (fase en `Stopping`: sin rearranque y sin auto-reclamar la fila batch); contrato de recuperación (batch: fila huérfana por pid ⇒ planner; streaming: IndexedDB + checkpoints ⇒ `autoRecoverAll`; chunks fallidos quedan como `.failed`); CloseApp sin apagado ⇒ `cleanup_before_exit` + `process::exit(0)`; `SetProcessShutdownParameters(0x3FF, 0)`; SIN `ShutdownBlockReasonCreate` (pendiente de E2E) ni checkpoint temprano en QES; y la regla "no reintroducir el graceful de 30 s en fin de sesión". Escribir el doc con Edit (contiene la palabra bloqueada en nombres de API).

Tests: `session_end.rs` tests de invariante de presupuestos: `STREAM_STOP_BUDGET < FINAL_ENCODE_SOFT < HARD_BUDGET`; `SCHED_FREEZE_BUDGET + lifecycle::EXIT_ROW_TIMEOUT + HARD_BUDGET + DB_CLEANUP_BUDGET + SIDECAR_BUDGET < 5 s` (umbral de Windows sin reason string); `budgets()` devuelve las tres constantes. Extraer la decisión de rama a una función pura `pub(crate) fn is_session_end_exit(observed: bool, reason: Option<&str>) -> bool` (en session_end.rs) y testearla: (true, *) ⇒ true; (false, Some("os_session_end"|"external_close")) ⇒ true; (false, Some("tray_quit"|"restart"|"app_exit"|"last_window_closed"|"loop_destroyed")) ⇒ false; (false, None) ⇒ false. Comandos: `cd /c/maity_desktop/frontend/src-tauri && cargo test --lib session_end`, `cargo test --lib logging::telemetry::lifecycle`, build `npm run tauri:build:debug` en background con log.

Importadores / consumidores conocidos:
- Exit handler actual: lib.rs:1786-1824 (antes de L2/E1; ubicar por contenido).
- `flush_recording_for_session_end`, `SessionEndBudgets`, `set_session_ending`: E2a (recording_lifecycle.rs / recording_phase.rs).
- `ScheduledRecordingService::begin_session_end`: J1 (scheduled_recording/service.rs); estado gestionado en lib.rs:675 como `Arc<RwLock<ScheduledRecordingService>>`.
- `DatabaseManager::cleanup`: database/manager.rs:296; `AppState.db_manager`: state.rs:8.
- `emit_exit_row`, `finish_exit`, `EXIT_ROW_TIMEOUT`: L2.

Trampas:
- Guard de shell: lib.rs, client.rs y el doc tienen la palabra bloqueada; usar solo Edit/Read/Grep.
- Tokio timeouts solo disparan en `.await`: por eso el flush, la DB y el sidecar van cada uno en su `spawn` + timeout; nunca llamar código de stop bloqueante directo dentro del `block_on`.
- `set_session_ending()` se pone SOLO aquí (irreversible), nunca en QES: otra app puede cancelar el fin de sesión.
- Todas las salidas que no son fin de sesión (bandeja, rival, update, restart, `app_exit`, `last_window_closed`, `loop_destroyed`) deben seguir por el camino actual byte a byte.
- Sin `ShutdownBlockReasonCreate` (y por lo tanto sin feature `Win32_System_Shutdown`) y sin checkpoint temprano en QES: decisión del contrato.
- `.lock().unwrap()` prohibido; tokio RwLock: guard en statement propio, nada de `if let` sobre el guard.
- Protocolo Guardian: cambio en lib.rs y en el pipeline de grabación; la rama de respaldo la crea Julio antes de ejecutar.

Resultado esperado: reiniciar o cerrar sesión de Windows con una grabación activa ya no deja la pantalla de bloqueo más que un instante: el log muestra `[session_end] flush: ...` con `elapsed_ms` < 3000 y el cleanup completo en < 5 s; el scheduler no escribe rearme ni back-off durante el flush; al volver, la jornada rearranca dentro del horario y la grabación se recupera una sola vez. Un Restart Manager sin apagado termina el proceso limpio con `process::exit(0)`.

Referencias: `docs/specs/telemetria-ciclo-vida-83/research/areas/spec-session-end-B5.md` §3.4-3.6 y §6, `docs/specs/telemetria-ciclo-vida-83/research/areas/verify-session-end-B5.md` (SESSION_ENDING, spawn+timeout, presupuestos adaptativos, CloseApp, fase Stopping), `docs/specs/telemetria-ciclo-vida-83/research/areas3/verify-session-end-B5.md` (SetProcessShutdownParameters, logger flush). Los presupuestos 1.5/2.5/7 s del informe B5 están OBSOLETOS: mandan 1/1.5/3 s del contrato §5.5.

**Ajustes del líder tras la refutación del plan (mandan sobre lo anterior si chocan):**
1. Presupuestos con margen para la escritura durable del marcador (fuera del `block_on`): `HARD_BUDGET = 2500 ms`, `pub const MARKER_WRITE_ALLOWANCE: Duration = 300 ms`, y en la rama de fin de sesión la fila `app.exit` usa `lifecycle::EXIT_ROW_TIMEOUT_SESSION_END` (400 ms). Test de invariante: `MARKER_WRITE_ALLOWANCE + SCHED_FREEZE_BUDGET + EXIT_ROW_TIMEOUT_SESSION_END + HARD_BUDGET + DB_CLEANUP_BUDGET + SIDECAR_BUDGET < 5 s` (0.3+0.2+0.4+2.5+0.5+0.3 = 4.2 s) y `STREAM_STOP_BUDGET < FINAL_ENCODE_SOFT < HARD_BUDGET`.
2. Congelado del scheduler: primero `scheduled_recording::service::mark_session_ending()` (síncrona, de J1) y `recording_phase::set_session_ending()`; después el `begin_session_end().await` con `SCHED_FREEZE_BUDGET`.

### E3. Recuperacion tolera chunks truncados sin borrar audio

Objetivo: AC-13. Dos defectos: (1) `recover_audio_from_checkpoints` concatena todos los `.mp4` sin validar; un solo checkpoint truncado (proceso matado a mitad de encode, apagón, fin de sesión) hace fallar la recuperación completa con `status: "failed"`; (2) BUG NUEVO: `useTranscriptRecovery.ts` llama `cleanup_checkpoints` SIEMPRE después de `saveMeeting`, incluso si el merge falló, así que borra `.checkpoints/` y con él todo el audio recuperable. Esta tarea valida cada chunk cuando el concat falla, concatena solo los válidos (`partial`), renombra los malos a `.bad` sin borrarlos, y condiciona el cleanup del frontend al resultado.

Pasos:
1. `frontend/src-tauri/src/audio/incremental_saver.rs`:
   a. `AudioRecoveryStatus` (hoy :500-507): agregar `#[serde(default)] pub excluded_chunks: Vec<String>` (nombres de archivo excluidos). Actualizar los 4 constructores de `recover_audio_from_checkpoints` (:524, :544, :594, :604) con `excluded_chunks: Vec::new()`. El planner (transcription/batch/planner.rs:343-350) solo lee `status`/`chunk_count` y ya acepta `"partial"`: no cambia.
   b. Puras: `pub(crate) fn concat_list_content(files: &[PathBuf]) -> String` (una línea `file '<ruta>'\n` por archivo, en orden; reemplaza el bucle de :563-569, que sigue canonicalizando antes de llamarla) y `pub(crate) fn partition_valid(files: &[PathBuf], valid: &[bool]) -> (Vec<PathBuf> /*válidos*/, Vec<PathBuf> /*excluidos*/)` preservando el orden.
   c. `async fn ffmpeg_validate(ffmpeg_path: &Path, file: &Path) -> bool`: corre `ffmpeg -v error -i <file> -f null -` con el mismo estilo de proceso que `run_ffmpeg_concat` (:461; mismo manejo de `CREATE_NO_WINDOW` en Windows y de stdout/stderr) y devuelve `true` solo si sale con código 0 y stderr vacío. Usar el `ffmpeg_path` ya resuelto por `find_ffmpeg_path()` (:580), no un `ffmpeg` del PATH.
   d. En `recover_audio_from_checkpoints`, rama `Err(e)` del concat (:602-611): si hay ≥ 1 archivo, validar cada uno en orden; `partition_valid`; si `válidos` no está vacío y `excluidos` no está vacío: reescribir `concat_list.txt` con `concat_list_content(&válidos)` y reintentar `run_ffmpeg_concat` UNA vez; si el reintento sale bien ⇒ renombrar cada excluido con `quarantine_file(path, "bad")` (helper creado en E2a; `x.mp4` ⇒ `x.mp4.bad`) y devolver `status: "partial"`, `chunk_count = válidos.len()`, `estimated_duration_seconds = válidos.len() * 30.0`, `audio_file_path: Some(..)`, `excluded_chunks` con los nombres, `message` que los nombre. En cualquier otro caso (ninguno válido, todos válidos pero el concat falla igual, o el reintento falla) ⇒ `status: "failed"` como hoy, SIN renombrar nada (queda todo en disco para un intento manual) y con `excluded_chunks` vacío.
   e. Los `.mp4.failed` que deja E2a y los `.mp4.bad` ya quedan fuera del escaneo porque el filtro es por extensión `mp4` (:537-539); agregar un comentario que lo diga.
   f. No cambiar el intervalo de 30 s ni la extensión `.mp4` (REGLAS § Checkpoints), ni `cleanup_checkpoints` (:618).
2. `frontend/src/hooks/useTranscriptRecovery.ts`:
   - Interfaz `AudioRecoveryStatus` (:14-20): agregar `excluded_chunks?: string[];`.
   - Exportar un helper puro `export function shouldCleanupCheckpoints(s: AudioRecoveryStatus | null): boolean` ⇒ `s?.status === 'success' || (s?.status === 'partial' && (s.excluded_chunks?.length ?? 0) === 0)`.
   - Paso "8. Clean up checkpoint files" (:269-278): `if (folderPath && shouldCleanupCheckpoints(audioRecoveryStatus)) { ... invoke('cleanup_checkpoints', ...) }`; si no se limpia, `logger.info('[recovery] checkpoints conservados', { status, excluded })` con `logger` de `@/lib/logger` (ya importado en :12). No agregar `console.*` nuevos (los existentes pueden quedar).
   - El resto del flujo (saveMeeting, markMeetingSaved, quitar de la lista) no cambia: la reunión se guarda aunque el audio falle; lo que cambia es que ya no se borra el audio recuperable.

Tests: `incremental_saver.rs` tests: `concat_list_content` con 3 rutas ⇒ 3 líneas `file '...'` en orden; `partition_valid` con `[true,false,true]` ⇒ válidos = 1º y 3º, excluidos = 2º (orden preservado); `AudioRecoveryStatus` deserializa sin `excluded_chunks` (default vacío). Test de integración `#[ignore]` (necesita ffmpeg en PATH; NO debe correr por defecto): 3 checkpoints reales con el del medio truncado a la mitad de bytes ⇒ `partial`, `chunk_count` 2, `excluded_chunks` con el del medio, el archivo `.mp4.bad` existe y `audio.mp4` también. Frontend: no hay archivo de test en la lista de esta tarea; la verificación es la suite `ts` completa (`npm run test`) verde y la lectura del gate en el código. Comandos: `cd /c/maity_desktop/frontend/src-tauri && cargo test --lib audio::incremental_saver`, `cd /c/maity_desktop/frontend && npm run test`, build `npm run tauri:build:debug` en background con log.

Importadores / consumidores conocidos:
- `recover_audio_from_checkpoints`: comando registrado en lib.rs:1489; llamado por el planner batch (transcription/batch/planner.rs:343) y por `useTranscriptRecovery.ts:221`.
- `cleanup_checkpoints`: lib.rs:1490; llamado por `useTranscriptRecovery.ts:273`.
- `quarantine_file`: E2a (incremental_saver.rs).
- `AudioRecoveryStatus` en TS solo en `useTranscriptRecovery.ts` (:14, :42, :189).

Trampas:
- Los tests por defecto NO pueden invocar ffmpeg (sin ffmpeg en PATH el test se cuelga o descarga): la validación real va solo en el test `#[ignore]`.
- La validación por archivo solo corre cuando el concat falla (camino normal sin costo extra).
- Nunca borrar un chunk en la recuperación: renombrar a `.bad`. `cleanup_checkpoints` solo se llama desde el frontend y ahora solo en éxito real.
- ESLint `no-console`: usar `logger`.
- Guard de shell: no usar Bash con la palabra bloqueada.

Resultado esperado: una grabación con un checkpoint truncado se recupera con el resto del audio (`partial`), el chunk malo queda como `audio_chunk_NNN.mp4.bad`, y tras un merge fallido la carpeta `.checkpoints/` sigue en disco en vez de borrarse.

Referencias: `docs/specs/telemetria-ciclo-vida-83/research/areas/spec-session-end-B5.md` §4, `docs/specs/telemetria-ciclo-vida-83/research/areas3/verify-session-end-B5.md` (issue 2: validación por archivo y cleanup incondicional). El "reintento sin el último chunk" del informe B5 está OBSOLETO: manda la validación por archivo del contrato §5.6.

**Ajustes del líder tras la refutación del plan (mandan sobre lo anterior si chocan):**
1. Archivo nuevo en la lista: `frontend/src/hooks/useTranscriptRecovery.test.ts` (ya existe, con `defaultInvoke` que mockea `recover_audio_from_checkpoints`/`cleanup_checkpoints`). Exportar un helper puro `shouldCleanupCheckpoints(result)` y testearlo en tabla (success ⇒ true; partial sin excluidos ⇒ true; partial con excluidos ⇒ false; failed/none/null ⇒ false) + un caso de `recoverMeeting` con `status: 'failed'` donde `cleanup_checkpoints` NUNCA se invoca. Verificar con `cd /c/maity_desktop/frontend && npx vitest run src/hooks/useTranscriptRecovery.test.ts`.
2. La línea de "checkpoints conservados" usa `logger.warn` (info/debug solo escriben en dev).

### L3. Salidas por update de la Store registradas desde Rust

Objetivo: AC-15 (y AC-11 para `update`). Hoy "Cerrar Maity para actualizar" (canal Store) llama `exit(0)` de `@tauri-apps/plugin-process` desde JS: la salida no deja motivo y el siguiente arranque no sabe que fue un update. Y cuando la app instala por StoreContext (`store_install_updates`), Windows la cierra sin `RunEvent::Exit` propio. Esta tarea: (1) nuevo comando Rust `exit_for_update` que registra `app.exit` con `reason: update`, `detail: store_button`, sube la fila y sale; (2) intención `update` via `store_api` en el marcador justo antes de `imp::install`, borrada si el resultado no es `Completed`; (3) el diálogo usa el comando.

Pasos:
1. `frontend/src-tauri/src/logging/telemetry/lifecycle.rs`:
   - `pub fn record_update_intent(via: &str, target_version: Option<&str>)`: síncrona, durable: `m.exit_intent = Some(MarkerIntent{reason: "update".into(), via: Some(via.into()), detail: None, target_version: target_version.map(Into::into), at_ms: now})` (reemplaza una intención `session_end` si la hubiera). Warn con el rate-limit del módulo, fuera del lock.
   - `pub fn clear_update_intent()`: durable; borra `exit_intent` SOLO si `reason == "update"`.
   - Comando: `#[tauri::command] pub async fn exit_for_update(app: tauri::AppHandle) -> Result<(), String>`: si `crate::audio::recording_phase::current_phase() != RecordingPhase::Idle` ⇒ `return Err("recording_active".into())` (se niega también en Starting/Stopping: post-proceso en curso); `if let Some(rec) = begin_exit(Some(ExitHint::Update { via: "store_button" })) { if let Some(id) = emit_exit_row(&app, &rec).await { let _ = super::drain::flush_row(&app, id, Duration::from_secs(3)).await; } }`; `app.exit(0); Ok(())`.
   - Pura para testear: extraer `fn apply_update_intent(m: &mut LifecycleMarker, via, target, now)` y `fn clear_update_intent_in(m: &mut LifecycleMarker)`.
2. `frontend/src-tauri/src/lib.rs`: registrar `logging::telemetry::lifecycle::exit_for_update,` en `tauri::generate_handler![` junto a `store_update::store_install_updates,` (hoy lib.rs:1769; ubicar por contenido). Los comandos propios no necesitan capability (no hay AppManifest).
3. `frontend/src-tauri/src/store_update.rs`, `store_install_updates` (hoy :165-195): dentro del closure de `with_mta`, justo ANTES de `imp::install(&ctx, &updates)` (:187), `crate::logging::telemetry::lifecycle::record_update_intent("store_api", None);`. Después del `.await` del `with_mta` y antes del `match &outcome` de log: `if !matches!(outcome, Ok(StoreInstallOutcome::Completed)) { crate::logging::telemetry::lifecycle::clear_update_intent(); }` (incluye `Err`, `Canceled`, `Error(_)`, `NoUpdates`). Con `Completed` la intención queda: si Windows mata el proceso, el siguiente `app.start` reporta `prev_exit_reason: update`, `prev_exit_detail: store_api`, `prev_exit_source: intent`; si llega un fin de sesión (Restart Manager), `summarize_prev` (L1) lo convierte en `update` con el detail de sesión.
4. `frontend/src/components/updates/UpdateDialog.tsx`, `handleCloseToUpdate` (hoy :210-224; U2 pudo mover líneas):
   - Conservar el pre-chequeo JS con `get_recording_state` y su toast.
   - Reemplazar `await exit(0);` por `await invoke('exit_for_update');`.
   - En el `catch`: si `String(err)` incluye `'recording_active'` ⇒ `toast.warning('Hay una grabación en curso. Detenla antes de cerrar Maity para actualizar.')` (mismo texto que el pre-chequeo); si no, el `toast.error` actual.
   - Actualizar el comentario del doc de la función (hoy :206) que menciona `exit(0)`.
   - Quitar `exit` del import de `@tauri-apps/plugin-process` (:15). Si tras U2 `relaunch` tampoco se usa en el archivo, quitar el import completo (ESLint de vars sin uso).
5. `frontend/src/components/updates/UpdateDialog.test.tsx`: el mock de `@tauri-apps/api/core` ya es `invoke: vi.fn()` (:17) y sonner ya está mockeado (:18-20). Importar `invoke` y `toast` de los módulos mockeados y agregar al `describe('UpdateDialog — canal Store')`:
   - "Cerrar Maity para actualizar invoca exit_for_update y no plugin-process exit": `invoke` resuelve `{ is_recording: false }` para `get_recording_state` y `undefined` para `exit_for_update` (`mockImplementation` por nombre de comando); render con el `updateInfo` del test existente "respaldo por system_config" (:54-60); click en el botón `/Cerrar Maity para actualizar/`; `await waitFor(() => expect(invoke).toHaveBeenCalledWith('exit_for_update'))`; y el `exit` mockeado de plugin-process (si el import sigue existiendo en el mock) no fue llamado.
   - "rechazo recording_active muestra el aviso de grabación": `exit_for_update` rechaza con `'recording_active'` ⇒ `toast.warning` llamado con el texto de grabación en curso.
   - Mantener el `vi.mock('@tauri-apps/plugin-process', ...)` si el componente todavía importa `relaunch`; resetear mocks en `beforeEach`.

Tests: Rust en `lifecycle.rs`: `apply_update_intent` escribe reason `update`, via y target, y reemplaza una `session_end`; `clear_update_intent_in` borra `update` pero NO una `session_end`; `summarize_prev` con intención `update`/`store_api` ⇒ `prev_exit_reason: update`, `prev_exit_detail: store_api` (si L1 ya tiene el caso, agregar el de `store_button` observado: exit `update` con detail `store_button` ⇒ observed). La negativa por fase: extraer `fn update_exit_refusal(phase: RecordingPhase) -> Option<&'static str>` (Idle ⇒ None; resto ⇒ Some("recording_active")) y testearla. TS: los dos casos nuevos de `UpdateDialog.test.tsx`. Comandos: `cd /c/maity_desktop/frontend/src-tauri && cargo test --lib logging::telemetry::lifecycle`, `cd /c/maity_desktop/frontend && npx vitest run src/components/updates/UpdateDialog.test.tsx`, `npm run test`, build `npm run tauri:build:debug` en background con log.

Importadores / consumidores conocidos:
- `handleCloseToUpdate` en UpdateDialog.tsx:210 (botón "Cerrar Maity para actualizar" del canal Store).
- `store_install_updates`: store_update.rs:165, registrado en lib.rs:1769; lo invoca `handleInstallFromStore` (UpdateDialog.tsx ~:236-265).
- `begin_exit`, `emit_exit_row`, `ExitHint` (L2); `drain::flush_row` (A2); `summarize_prev` (L1).

Trampas:
- La negativa del comando va por fase (`!= Idle`), más estricta que `is_recording()`: incluye el post-proceso (Stopping) que U2 protege.
- `record_update_intent` corre dentro del closure de `with_mta` (hilo MTA de `spawn_blocking`): es std síncrona, sin await, OK.
- El `Err(String)` de un comando Tauri llega a JS como el string tal cual (`'recording_active'`).
- Sin eventos Tauri nuevos. Frontend: `logger`, nunca `console.*` nuevo.
- Guard de shell: no usar Bash con la palabra bloqueada.
- No tocar `tauri.conf.json` (ACL del updater: U4).

Resultado esperado: en el canal Store, "Cerrar Maity para actualizar" deja una fila `app.exit` `reason: update`, `detail: store_button` que sube antes de cerrar; con grabación o post-proceso en curso muestra el aviso y Maity sigue abierta; tras "Actualizar ahora" (StoreContext) el siguiente `app.start` reporta `prev_exit_reason: update` y `version_changed: true`.

Referencias: `docs/specs/telemetria-ciclo-vida-83/research/areas/spec-lifecycle-T2.md` (d) puntos 4-5, `docs/specs/telemetria-ciclo-vida-83/research/areas3/verify-lifecycle-T2.md` (intenciones sin caducidad, clear en Err). Los nombres `exit_for_store_update`/`update_store_api`/`lifecycle_record_exit_intent` del informe T2 están OBSOLETOS: mandan `exit_for_update`, `record_update_intent(via, ..)` y `clear_update_intent()` del contrato §1.8/§5.7.

## Parte U - Updater NSIS seguro

### U1. Comando direct_update_install para el update NSIS

Objetivo: AC-14 (y la fila `app.exit` `update`/`nsis` de AC-11). Hoy el update del canal directo (NSIS) lo hace el JS con `Update.downloadAndInstall()` de `@tauri-apps/plugin-updater` 2.10.0. En Windows el plugin termina con `std::process::exit(0)` (`tauri-plugin-updater-2.10.0/src/updater.rs:865`), así que NUNCA corre el handler `RunEvent::Exit` de `lib.rs`: no se guarda nada, no se hace checkpoint ni cierre del pool y `llama-helper.exe` queda vivo bloqueando el instalador. Además nadie comprueba si hay una grabación. Esta tarea crea el comando Rust `direct_update_install`, que hace TODO el update (check, descarga con progreso, candado de arranque, install) con un `on_before_exit` propio que registra la salida y cierra la DB y el sidecar SOLO después de un `extract()` exitoso. Esta tarea NO toca el frontend (eso es U2) ni el ACL (U4).

Pasos:
1. Lee primero `frontend/src-tauri/src/logging/telemetry/lifecycle.rs` (creado por L1/L2) y `frontend/src-tauri/src/logging/telemetry/drain.rs` (A2) para confirmar los nombres exactos: `lifecycle::begin_exit(Option<ExitHint>) -> Option<ExitRecord>`, `lifecycle::emit_exit_row(app, &ExitRecord) -> Option<i64>` (acotado a 750 ms), `lifecycle::finish_exit()`, `drain::flush_row(app, id: i64, budget: Duration) -> FlushOutcome` (contrato §1.8). Localiza la variante de update de `ExitHint` que L2 definió (el contrato la escribe `Update{via: nsis}`; §1.7: reason `update`, detail `nsis`). Si L2 la modeló como `ExitHint::Update { via: "nsis" }`, con un enum `UpdateVia::Nsis` o de otra forma, usa exactamente esa forma. NO la redefinas ni edites lifecycle.rs (no está en tu lista de archivos). Comprueba también si `emit_exit_row` es `async fn` o una fn síncrona.
2. Crea `frontend/src-tauri/src/direct_update.rs` con un doc de módulo en español. Debe explicar: en Windows `Update::install` termina en `process::exit(0)` y se salta `RunEvent::Exit`; la limpieza vive en un `on_before_exit` propio que el plugin llama solo tras un `extract()` exitoso (updater.rs:794 y después :837-840); nunca corre bajo MSIX (#71) ni en Mac App Store. Imports: `serde::Serialize`, `std::sync::atomic::{AtomicBool, Ordering}`, `std::time::Duration`, `tauri::{ipc::Channel, AppHandle, Manager}`, `tauri_plugin_updater::UpdaterExt`, `crate::audio::recording_phase::{self, RecordingPhase, StartGate}`, `crate::database::manager::DatabaseManager` (así lo importa `state.rs:1`).
3. Tipos (mismo estilo serde que `StoreInstallOutcome` en `store_update.rs`):
   - `#[derive(Debug, Clone, Serialize, PartialEq, Eq)] #[serde(tag = "event", content = "data")] pub enum DirectUpdateEvent { #[serde(rename_all = "camelCase")] Started { content_length: Option<u64> }, #[serde(rename_all = "camelCase")] Progress { chunk_length: usize }, Finished }`. Es la misma forma que el `DownloadEvent` privado del plugin (commands.rs:14-26), para que el JS reuse el tipo `DownloadEvent` y su `switch (event.event)`.
   - `#[derive(Debug, Clone, Serialize, PartialEq, Eq)] #[serde(tag = "kind", content = "detail", rename_all = "camelCase")] pub enum DirectInstallOutcome { Restarting, NoUpdate, RecordingActive, PostProcessing, Busy, Unsupported, Error(String) }`. Se serializa a `{kind:"restarting"}`, `{kind:"noUpdate"}`, `{kind:"recordingActive"}`, `{kind:"postProcessing"}`, `{kind:"busy"}`, `{kind:"unsupported"}` y `{kind:"error", detail:"..."}`. U2 espeja estos literales en TS: no los cambies.
4. Estado global: `static INSTALL_IN_FLIGHT: AtomicBool` (single-flight) con un guard RAII `struct InFlightGuard;` cuyo `Drop` hace `store(false)`. Más `static EXIT_HOOK_RAN: AtomicBool`: desde que es `true`, el pool puede estar cerrado.
5. Funciones puras, testeables sin Tauri:
   - `pub fn refusal_for_phase(phase: RecordingPhase) -> Option<DirectInstallOutcome>`: `None` solo en `Idle`; cualquier otra fase (Starting, Recording, Paused, Stopping) devuelve `Some(RecordingActive)`. `is_recording()` no cubre Starting ni Stopping, y Stopping (guardando) también debe bloquear.
   - `pub fn refusal_for_processing(processing_jobs: i64) -> Option<DirectInstallOutcome>`: `Some(PostProcessing)` si `> 0`.
   - `#[derive(Debug, PartialEq, Eq)] enum GateOnFailure { Drop, ForgetAndRestart }` y `fn gate_on_failure(hook_ran: bool) -> GateOnFailure`.
   - `fn run_exit_hook(flag: &AtomicBool, body: impl FnOnce()) -> bool`: pone `flag` en `true` PRIMERO y luego ejecuta `body` dentro de `std::panic::catch_unwind(std::panic::AssertUnwindSafe(body))`. Devuelve `true` si `body` terminó sin pánico. Recibir el flag por parámetro permite que los tests usen un `AtomicBool` local y no el static.
6. `async fn processing_batch_jobs(pool: &sqlx::SqlitePool) -> i64`: `sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM batch_transcription_queue WHERE status = 'processing'")`. Si da error, `log::warn!` y devuelve 0 (la fase y el JS siguen protegiendo; nunca bloquees los updates para siempre por un error de consulta). Es válido contar TODAS las filas `processing`: al arrancar, `BatchQueueRepository::reset_processing` (`database/repositories/batch_queue.rs:194`) regresa a `pending` todo lo abandonado, así que cualquier fila `processing` es de este proceso. El repositorio no tiene un helper sin `user_id` (`list_active` en :295 lo exige) y `batch_queue.rs` no está en tu lista: la consulta va en direct_update.rs.
7. Hook de salida, `fn exit_cleanup_blocking(app: &AppHandle, db: Option<DatabaseManager>)`. Es síncrono y corre en el hilo de `spawn_blocking`, dentro del `on_before_exit` del plugin. Llama `let ok = run_exit_hook(&EXIT_HOOK_RAN, || { ... })` y dentro, EN ESTE ORDEN (contrato §6.1):
   a. `let record = lifecycle::begin_exit(Some(<hint de update con via nsis>));`. Es lo primero, con el marcador durable, y además activa `drain::set_exiting()`.
   b. `tauri::async_runtime::block_on(async { ... })` con: si hay `record`, `emit_exit_row(app, &record)` y, si devuelve `Some(id)`, `drain::flush_row(app, id, Duration::from_secs(2)).await` (ignora el `FlushOutcome`, solo haz `log::info!`). Después `tokio::time::timeout(5 s, db.cleanup())` si hay `db` (checkpoint TRUNCATE + `pool.close()`, `database/manager.rs:296`), con warn si excede. Después `log::logger().flush()`. Al final `tokio::time::timeout(5 s, crate::summary::summary_engine::force_shutdown_sidecar())` con warn si excede o da `Err`. El sidecar va al FINAL a propósito: `get_sidecar_pool` lo re-crea de forma perezosa, y matarlo antes de la espera de la DB abriría una ventana para que reapareciera llama-helper.exe.
   c. `lifecycle::finish_exit()` (pone `done_at_ms`; sin esto el siguiente `app.start` leería `prev_exit_interrupted=true`; ver la nota en issues).
   Fuera del closure: si `ok`, llama `app.cleanup_before_exit()`. Nuestro hook REEMPLAZA al default del plugin (`updater.rs:288-291` usa `.replace`; el default de `updater lib.rs:107-110` solo hacía `cleanup_before_exit`), así que hay que llamarlo a mano. Si hubo pánico, NO lo llames (Tauri documenta que tras `cleanup_before_exit` no se debe usar la API) y deja un `log::warn!`.
8. El comando `#[tauri::command] pub async fn direct_update_install(app: AppHandle, on_event: Channel<DirectUpdateEvent>) -> Result<DirectInstallOutcome, String>`:
   1) Si `crate::utils::is_running_under_package_identity() || crate::utils::is_mac_app_store_build()`, devuelve `Ok(Unsupported)` (son fns normales con `#[tauri::command]`, `utils.rs:14` y `:87`).
   2) Si `INSTALL_IN_FLIGHT.swap(true, SeqCst)` ya estaba en true, devuelve `Ok(Busy)`; si no, `let _in_flight = InFlightGuard;`.
   3) `refusal_for_phase(recording_phase::current_phase())`: si es Some, `log::warn!` con `current_phase().as_str()` y return.
   4) `let db = app.try_state::<crate::state::AppState>().map(|s| s.db_manager.clone());` (el mismo patrón que rival_install.rs). Si hay db, `refusal_for_processing(processing_batch_jobs(db.pool()).await)`: si es Some, return.
   5) `let hook_app = app.clone(); let hook_db = db.clone();` y construye `app.updater_builder().on_before_exit(move || exit_cleanup_blocking(&hook_app, hook_db.clone())).build().map_err(|e| e.to_string())?`. `updater_builder()` conserva config, pubkey, modo Passive y `current_exe_args`; NO toques `tauri_plugin_updater::Builder::new().build()` de lib.rs.
   6) `updater.check().await`: `Ok(None)` devuelve `NoUpdate` y `Err(e)` devuelve `Error(e.to_string())`. Haz `log::info!` con `update.version` y `update.current_version`.
   7) `update.download(on_chunk, on_finish).await` con `let mut first = true;`. En el primer chunk manda `Started { content_length }`, en cada chunk manda `Progress { chunk_length }` y al terminar manda `Finished` (clona el `Channel` para el segundo closure). Ignora los errores de `send`, como hace el plugin. Un `Err` devuelve `Error`. La firma ya se verifica dentro de `download`.
   8) `let gate = match StartGate::acquire() { Ok(g) => g, Err(e) => { log::warn!(...); return Ok(RecordingActive) } };`. Desde aquí ningún camino de arranque entra (scheduler incluido: trata "already in progress" como benigno, service.rs ~654-658; tras E2a también se niega con "session ending").
   9) Vuelve a comprobar el post-proceso con el gate tomado: si `refusal_for_processing(...)` es Some, `drop(gate)` y return.
   10) `let joined = tauri::async_runtime::spawn_blocking(move || update.install(bytes)).await;`. SIEMPRE dentro de `spawn_blocking`: el `block_on` del hook entraría en pánico si `install` corriera en un worker async.
   11) `match joined`. `Ok(Ok(()))` solo llega en macOS/Linux (en Windows el proceso ya murió): `std::mem::forget(gate)` (la fase queda en Starting hasta el reinicio), `app.request_restart()` y `Ok(Restarting)`. `Ok(Err(e))` devuelve `on_failure(&app, gate)` y `Ok(Error(e.to_string()))`. `Err(join)` devuelve `on_failure(&app, gate)` y `Ok(Error(format!("el instalador abortó: {join}")))`. Escribe los dos brazos de falla explícitos: NO copies el brazo `Ok(Err(e)) | Err(_) if false => unreachable!()` del informe, que no compila (E0408).
   12) `fn on_failure(app: &AppHandle, gate: StartGate)`: `match gate_on_failure(EXIT_HOOK_RAN.load(SeqCst))`. En `ForgetAndRestart` haz `std::mem::forget(gate)` (la fase sigue en Starting y bloquea arranques contra un pool cerrado), `log::error!` y `app.request_restart()`. En `Drop` haz `drop(gate)` (vuelve a Idle; nada se cerró). Revisa el flag ANTES de soltar el gate.
9. `frontend/src-tauri/src/lib.rs`: agrega `pub mod direct_update;` en la lista de módulos, justo después de `pub mod database;` (hoy en la línea 44; ubícalo con Grep). Registra `direct_update::direct_update_install,` en `generate_handler!` justo después de `store_update::store_install_updates,` (hoy en la línea 1769; ubícalo con Grep, porque las tareas anteriores movieron las líneas), con el comentario `// Update del canal directo (NSIS): se niega con grabación o post-proceso y cierra DB/sidecar antes del instalador (B2)`. No cambies nada más en lib.rs: ni el `.plugin(tauri_plugin_updater::Builder::new().build())` (hoy en la línea 638), ni la rama `RunEvent::Exit`.
10. `docs/CANALES_DISTRIBUCION.md`: agrega al final una sección nueva `## Updater de descarga directa (NSIS) — B2 (desde 0.2.62)` que diga:
    - en Windows `Update::install` del plugin termina en `std::process::exit(0)`, sin `RunEvent::Exit`;
    - el ÚNICO camino es el comando `direct_update_install`; el JS nunca llama `download`, `install` ni `downloadAndInstall` (la capability queda en `updater:allow-check` desde U4);
    - rechazos: `unsupported` (MSIX/MAS), `busy`, `recordingActive` (cualquier fase distinta de Idle, al inicio, y el StartGate después de descargar), `postProcessing` (filas `processing` en `batch_transcription_queue`, al inicio y con el gate tomado; el JS además revisa la bandera post-stop);
    - el hook se ejecuta después de `extract()`: marcador y `app.exit` `update`/`nsis` + flush de 2 s, `db.cleanup()` 5 s, flush del log, kill del sidecar 5 s al final y `cleanup_before_exit()` solo si no hubo pánico;
    - nunca cerrar el pool antes de ese punto;
    - nunca llamar `install` desde un contexto async;
    - el hook reemplaza el default;
    - si el hook corrió y seguimos vivos: `mem::forget(gate)` + `request_restart`;
    - no hay `relaunch()` en JS (NSIS `/P /R` relanza);
    - si `ShellExecuteW` falla, el plugin sale igual: la app se cierra sin instalar;
    - solo protege binarios desde 0.2.62 y exige un release de GitHub para llegar al canal NSIS estancado.

Tests:
- En `direct_update.rs`, `#[cfg(test)] mod tests`:
  - `refusal_for_phase`: Idle da None; Starting, Recording, Paused y Stopping dan `Some(RecordingActive)`.
  - `refusal_for_processing`: 0 da None; 1 y 3 dan `Some(PostProcessing)`.
  - `gate_on_failure`: `true` da `ForgetAndRestart`; `false` da `Drop`.
  - Serialización con `serde_json::to_value`. Outcome: `Error("x")` da `{kind:"error",detail:"x"}`, `RecordingActive` da `{kind:"recordingActive"}`, `PostProcessing` da `{kind:"postProcessing"}` y `NoUpdate` da `{kind:"noUpdate"}`. Evento: `Started{content_length:Some(3)}` da `{event:"Started",data:{contentLength:3}}`, `Progress{chunk_length:5}` da `{event:"Progress",data:{chunkLength:5}}` y `Finished` da `{event:"Finished"}`.
  - `run_exit_hook` con un `AtomicBool` local (nunca `EXIT_HOOK_RAN`): (i) desde `std::thread::spawn(...).join()` con un body que hace `tauri::async_runtime::block_on(async { tokio::time::sleep(Duration::from_millis(1)).await })` devuelve `true` y deja el flag en `true` (así se prueba el `block_on` desde un hilo no async; NO uses `#[tokio::test]` más `spawn_blocking` de tauri, que toca el runtime global); (ii) un body que hace `panic!` devuelve `false` y el flag queda en `true`.
  - StartGate como candado sobre una máquina de test, con el patrón `leaked_machine()` de `recording_phase.rs:272` (`Box::leak(Box::new(PhaseMachine::new()))`): `StartGate::acquire_on(m)` desde Idle deja `m.current() == Starting`; un segundo `acquire_on` falla con un texto que contiene "already in progress"; al hacer `drop` vuelve a Idle; con `std::mem::forget` se queda en Starting.
  - `processing_batch_jobs` con `SqlitePoolOptions::new().max_connections(1).connect(":memory:")` y un esquema mínimo `CREATE TABLE batch_transcription_queue (id INTEGER PRIMARY KEY, status TEXT NOT NULL)`: con filas `pending` y `done` devuelve 0; al agregar una `processing` devuelve 1; sin la tabla devuelve 0, sin pánico. Usa `#[tokio::test]`, como en `batch_queue.rs`.
- Comandos: `cd /c/maity_desktop/frontend/src-tauri && cargo test --lib direct_update` y `cargo test --lib audio::recording_phase` (regresión). Al final el build completo `cd /c/maity_desktop/frontend && npm run tauri:build:debug` debe dar exit 0 (en background con log y `EXIT=$?`).

Importadores / consumidores conocidos:
- `frontend/src-tauri/src/lib.rs:44` (`pub mod database;`, ancla del `pub mod`) y `lib.rs:1769` (`store_update::store_install_updates,`, ancla del registro). Rama `RunEvent::Exit` en `lib.rs:1786-1824`: no se toca y no corre en este camino.
- `frontend/src-tauri/src/audio/recording_phase.rs:140` `current_phase()`, `:166` `StartGate::acquire`, `:171` `acquire_on`, `:213-222` `Drop` (Starting pasa a Idle), `:272` `leaked_machine` (tests).
- `frontend/src-tauri/src/database/manager.rs:213` `pool()`, `:296` `cleanup()`; `state.rs:1` importa `DatabaseManager`.
- `frontend/src-tauri/src/summary/summary_engine/mod.rs:15` re-exporta `force_shutdown_sidecar` (`client.rs:203`).
- `frontend/src-tauri/src/database/repositories/batch_queue.rs:194` `reset_processing` (por qué `processing` pertenece a este proceso).
- `frontend/src-tauri/src/utils.rs:14` `is_running_under_package_identity`, `:87` `is_mac_app_store_build`.
- El consumidor JS llega en U2 (`UpdateDialog.tsx`, `invoke('direct_update_install', { onEvent })`).

Trampas:
- Guard de shell: ningún comando Bash ni mensaje puede contener la palabra que empieza con "shut" y termina con "down". Para buscar `force_shutdown_sidecar` o `graceful_..._before_exit` usa Grep/Read, nunca Bash. Nada de `python -c` ni `node -e`.
- `block_on` dentro de `block_on` entra en pánico. Si `emit_exit_row` resultó ser síncrona y por dentro hace su propio `block_on`, llámala ANTES del `tauri::async_runtime::block_on` del hook, no dentro. `flush_row` es async: va dentro.
- El closure de `on_before_exit` debe ser `Fn + Send + Sync + 'static`: clona `db` dentro del closure en cada llamada (`hook_db.clone()`), no lo muevas.
- Nunca `.lock().unwrap()`. Aquí no hace falta ningún Mutex: bastan los AtomicBool.
- No llames `graceful_..._before_exit` (el de lib.rs): el StartGate tomado desde Idle prueba que no hay sesión viva.
- No caches el `Update` entre llamadas ni lo expongas al JS. Tampoco cambies `tauri_plugin_updater::Builder` en lib.rs (no expone `on_before_exit`).
- Los comandos propios no necesitan capability (build.rs sin AppManifest) y el fetch de `Channel` está exento de ACL. No agregues eventos Tauri nuevos.
- `cleanup_before_exit()` limpia `resources_table`: el centinela de L2 se dropea ahí, pero como `begin_exit` ya corrió (EXIT_BEGUN), no sobrescribe el motivo `update`. Por eso `begin_exit` va PRIMERO.
- En macOS/Linux el plugin no llama `on_before_exit`, así que `EXIT_HOOK_RAN` queda en false y la salida se registra por `RunEvent::Exit` como `restart`. Es aceptable y no hay que forzarlo.
- Protocolo Guardian: la tarea toca lib.rs. La rama `backup/2026-09-23-telemetria-83` la crea Julio antes de ejecutar; no crees ramas.

Resultado esperado: existe el comando `direct_update_install`. Con una grabación en cualquier fase distinta de Idle, o con un job de lote en `processing`, se niega sin descargar. En reposo descarga con progreso por Channel, toma el StartGate y llama al instalador. En Windows, justo antes de `ShellExecuteW`, deja en el marcador y en el outbox un `app.exit` con reason `update`/detail `nsis` (con flush dirigido de 2 s), cierra el pool con checkpoint, vacía el log, mata llama-helper y limpia el tray. Si algo falla antes de `extract()`, la app queda intacta (pool abierto y fase de nuevo en Idle). `CANALES_DISTRIBUCION.md` documenta las reglas.

Referencias:
- docs/specs/telemetria-ciclo-vida-83/research/areas/spec-nsis-update-B2.md (diseño base; el orden del hook y el brazo `if false` están CORREGIDOS arriba)
- docs/specs/telemetria-ciclo-vida-83/research/areas/verify-nsis-update-B2.md (orden DB antes del sidecar, catch_unwind, test con std::thread)
- docs/specs/telemetria-ciclo-vida-83/research/areas2/verify-nsis-update-B2.md (postProcessing, gate antes de soltar, ACL)
- docs/specs/telemetria-ciclo-vida-83/spec.md (AC-14, AC-11) y el contrato §1.7, §1.8, §6.1

### U2. Dialogo NSIS usa direct_update_install y respeta el post-proceso

Objetivo: AC-14, lado frontend. El botón "Descargar e Instalar" del canal directo (NSIS) hoy llama `updateToUse.downloadAndInstall(...)` + `relaunch()` (`UpdateDialog.tsx:128` y `:174`) sin revisar la grabación. Pasa a invocar el comando Rust `direct_update_install` que creó U1. Antes hace un pre-chequeo en JS: fase distinta de idle o bandera post-stop en vuelo se rechaza con toast, porque tras `drop(stop_gate)` (`audio/recording_lifecycle.rs:795`) la fase ya es Idle pero el guardado streaming sigue en JS (`useRecordingStop.ts:407-459`). Se borra el `downloadAndInstall` muerto de `updateService.ts` y se evita que un re-check del tray reinicie el diálogo a media descarga.

Pasos:
1. Crea `frontend/src/lib/postStopState.ts`, una bandera de MÓDULO y no un contexto: `UpdateCheckProvider` vive fuera de `RecordingStateProvider` (`app/(main)/layout.tsx:834` vs `:544`). API exacta:
   ```ts
   /** Tope de seguridad: una bandera más vieja que esto se considera rancia (un stop colgado no bloquea updates para siempre). */
   export const POST_STOP_MAX_MS = 15 * 60 * 1000;
   export function beginPostStop(now: number = Date.now()): void   // inFlight += 1; lastBeganAt = now
   export function endPostStop(): void                               // inFlight = max(0, inFlight - 1)
   export function isPostStopInFlight(now: number = Date.now()): boolean // inFlight > 0 && now - lastBeganAt < POST_STOP_MAX_MS
   ```
   Estado: `let inFlight = 0; let lastBeganAt = 0;`. Sin React, sin imports y sin efectos al cargar. Va con comentario de cabecera en español (qué protege: el update NSIS no debe matar el proceso mientras el JS guarda la reunión o el lote transcribe; por qué es módulo y no contexto).
2. `frontend/src/hooks/useRecordingStop.ts`, en `handleRecordingStop` (línea 289):
   - justo después de `stopInProgressRef.current = true;` (L294) llama `beginPostStop();`;
   - en el `finally` (L660-663), junto a `stopInProgressRef.current = false;`, llama `endPostStop();`.
   El `finally` cubre todos los estados terminales: rama lote con `return` (L386-400), guardado con navegación dura (L551-552; `saveMeeting` ya se esperó antes), `IDLE` sin transcripts (L646) y `ERROR` (L557/L658). No toques nada más del hook. Importa desde `@/lib/postStopState`.
3. `frontend/src/services/updateService.ts`:
   - Borra el método muerto `downloadAndInstall` (L344-370, JSDoc incluido; no tiene llamadores).
   - Borra `import { relaunch } from '@tauri-apps/plugin-process';` (L25).
   - Cambia la L21 a `import { check } from '@tauri-apps/plugin-updater';`. `Update` solo se usaba en el método borrado; verifícalo con Grep antes de quitarlo.
   - Actualiza la cabecera L8-9 a algo como: "`github`: instalación NSIS → `tauri-plugin-updater` contra `latest.json` de GitHub Releases; el JS solo hace `check()`; la descarga y la instalación las hace el comando Rust `direct_update_install` (se niega con grabación o post-proceso y cierra DB/sidecar antes del instalador, B2)".
   - Agrega y exporta, cerca de `UpdateProgress`:
   ```ts
   /** Resultado de `direct_update_install` (Rust, direct_update.rs): `{kind, detail}` en camelCase. */
   export type DirectInstallOutcome =
     | { kind: 'restarting' | 'noUpdate' | 'recordingActive' | 'postProcessing' | 'busy' | 'unsupported' }
     | { kind: 'error'; detail: string };
   ```
4. `frontend/src/components/updates/UpdateDialog.tsx`:
   - Imports: `import React, { useState, useEffect, useRef } from 'react';`, `import { check, type DownloadEvent } from '@tauri-apps/plugin-updater';` (sin `Update`), `import { exit } from '@tauri-apps/plugin-process';` (sin `relaunch`; `exit` lo sigue usando `handleCloseToUpdate` y L3 lo cambia después), `import { Channel, invoke } from '@tauri-apps/api/core';`, `import { isPostStopInFlight } from '@/lib/postStopState';` y agrega `type DirectInstallOutcome` al import de `@/services/updateService`.
   - Quita el estado `update`/`setUpdate` (L34) y todas sus llamadas (L68, L75, L88, L103).
   - Agrega `const installInFlightRef = useRef(false);`. Al inicio del `useEffect` sobre `[open, updateInfo]` (L57) pon `if (installInFlightRef.current) return;`: el tray (`UpdateCheckProvider.tsx:86-87`) cambia `updateInfo` a media descarga y el efecto reseteaba `isDownloading`/`progress`. `Busy` de Rust sigue como respaldo entre instancias (About.tsx:180 monta otra).
   - En ese efecto, `check()` queda SOLO como sonda de disponibilidad: `if (!updateResult?.available) setError('Actualización ya no disponible');`. En el `catch` cambia `console.error(...)` por `logger.error('[UpdateDialog] check falló', err)` y deja el `setError(...)` como está.
   - Reescribe `handleDownloadAndInstall` completo (L95-182):
     1) Pre-chequeo: `try { const state = await invoke<RecordingState>('get_recording_state'); const busy = state?.phase ? state.phase !== 'idle' : Boolean(state?.is_recording); if (busy) { void fileLogger.info('updater_dialog', 'direct-install-refused-recording', { phase: state?.phase }); toast.warning('Hay una grabación en curso. Detenla antes de actualizar Maity.'); return; } } catch { /* Rust es la autoridad: direct_update_install se niega igual */ }`.
     2) `if (isPostStopInFlight()) { void fileLogger.info('updater_dialog', 'direct-install-refused-post-stop', {}); toast.warning('Maity está guardando o transcribiendo la última grabación. Actualiza cuando termine.'); return; }`.
     3) `installInFlightRef.current = true; setIsDownloading(true); setError(null); setProgress({ downloaded: 0, total: 0, percentage: 0 });`, luego `let downloaded = 0; let contentLength = 0; const onEvent = new Channel<DownloadEvent>(); onEvent.onmessage = (event) => { switch (event.event) { ... } };` con EXACTAMENTE el mismo switch Started/Progress/Finished de hoy (L129-161, con los `logger.debug`). Declara `const percentage` dentro de un bloque `{ }` en el `case 'Progress'` para no violar `no-case-declarations`.
     4) `try { void fileLogger.info('updater_dialog', 'direct-install-start', { version: updateInfo?.version }); const outcome = await invoke<DirectInstallOutcome>('direct_update_install', { onEvent }); void fileLogger.info('updater_dialog', 'direct-install-result', { ...outcome }); switch (outcome.kind) { ... } } catch (err: unknown) { ... } finally { installInFlightRef.current = false; }`.
     5) Mapeo:
        - `restarting`: `toast.success('Actualización instalada. Maity se reiniciará…')`, deja `isDownloading` (el proceso se va);
        - `noUpdate`: `setIsDownloading(false); setError('Actualización ya no disponible')`;
        - `recordingActive`: `setIsDownloading(false); setProgress(null); toast.warning('Empezó una grabación durante la descarga. Actualiza cuando la detengas.')`;
        - `postProcessing`: `setIsDownloading(false); setProgress(null); toast.warning('Maity está guardando o transcribiendo la última grabación. Actualiza cuando termine.')`;
        - `busy`: `setIsDownloading(false); toast.info('La actualización ya se está instalando.')`;
        - `unsupported`: `setIsDownloading(false); setError('Esta instalación se actualiza desde su tienda.')`;
        - `error`: `setIsDownloading(false); setError(outcome.detail || 'Error al descargar o instalar actualización'); toast.error('Actualización fallida: ' + outcome.detail)`.
        En el `catch`: `const errMsg = err instanceof Error ? err.message : String(err); void fileLogger.error('updater_dialog', 'direct-install-failed', { message: errMsg }); setError(errMsg || 'Error al descargar o instalar actualización'); setIsDownloading(false); toast.error('Actualización fallida: ' + errMsg);`.
     6) En esta ruta NO hay `downloadAndInstall`, `download`, `install` ni `relaunch`: en Windows el proceso muere dentro del invoke y NSIS `/P /R` relanza; en macOS/Linux Rust hace `request_restart`.
   - No toques `handleCloseToUpdate`, `handleInstallFromStore` ni el JSX (lo de la Store es de L3). El botón "Descargar e Instalar" (L540) sigue llamando `handleDownloadAndInstall`.
5. `frontend/src/components/updates/UpdateDialog.test.tsx`:
   - Cambia el mock de core (L17) a `vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), Channel: class { onmessage: unknown = null } }));`.
   - Importa `invoke` desde `@tauri-apps/api/core`, `check` desde `@tauri-apps/plugin-updater`, `toast` desde `sonner`, `relaunch` desde `@tauri-apps/plugin-process` y `beginPostStop, endPostStop` desde `@/lib/postStopState` (el módulo real, sin mock). Agrega `waitFor` al import de testing-library.
   - Agrega un nuevo `describe('UpdateDialog — canal directo (NSIS)', ...)` con `const githubInfo: UpdateInfo = { available: true, currentVersion: '0.2.61', version: '0.2.62', channel: 'github' };` y `const downloadAndInstallSpy = vi.fn(); const installSpy = vi.fn();`.
     - En `beforeEach`: `vi.mocked(check).mockResolvedValue({ available: true, version: '0.2.62', downloadAndInstall: downloadAndInstallSpy, install: installSpy } as never)`, limpia los mocks (`vi.mocked(invoke).mockReset()`, `vi.mocked(toast.warning).mockClear()`, etc.) y define `mockInvoke({ phase, outcome })` con `mockImplementation(async (cmd) => cmd === 'get_recording_state' ? { is_recording: phase === 'recording', phase } : cmd === 'direct_update_install' ? outcome : undefined)`.
     - En `afterEach`: `endPostStop()` hasta vaciar (llámalo 3 veces) y `vi.mocked(check).mockResolvedValue(null as never)` para no romper los tests Store.
     - En cada caso: `renderDialog(githubInfo)` y luego `fireEvent.click(await screen.findByRole('button', { name: /Descargar e Instalar/ }))`.
   - Casos:
     (1) fase `recording` da `toast.warning` con 'Hay una grabación en curso…' y `invoke` nunca se llama con `'direct_update_install'`;
     (2) fase `stopping` también se niega;
     (3) fase `idle` con `beginPostStop()` antes del clic da `toast.warning` con 'guardando o transcribiendo' y sin invoke del comando;
     (4) idle con outcome `{kind:'error', detail:'boom'}`: aparece el texto 'boom' y se llama `toast.error`;
     (5) idle con `{kind:'recordingActive'}`: `toast.warning` y ya no se ve 'Descargando Actualización' (`waitFor`);
     (6) idle con `{kind:'postProcessing'}`: `toast.warning`;
     (7) idle con cualquier outcome: `expect(invoke).toHaveBeenCalledWith('direct_update_install', { onEvent: expect.any(Object) })`, y `downloadAndInstallSpy`, `installSpy` y `relaunch` NUNCA se llaman;
     (8) en vuelo: `direct_update_install` devuelve una promesa que no resuelve (`new Promise(() => {})`); tras el clic se ve 'Descargando Actualización'; `rerender(<UpdateDialog open onOpenChange={() => {}} updateInfo={{ ...githubInfo }} />)` (objeto nuevo, como el re-check del tray) sigue mostrando 'Descargando Actualización'.
   - Los 5 tests Store existentes deben seguir verdes sin cambios. `check` resuelve a `null` para ellos, pero con `channel: 'store'` no se llama.

Tests:
- `cd /c/maity_desktop/frontend && npx vitest run src/components/updates/UpdateDialog.test.tsx` (los 5 casos Store + los 8 nuevos).
- `cd /c/maity_desktop/frontend && npx vitest run src/services/updateService.test.ts` (regresión tras borrar `downloadAndInstall`; su mock de `plugin-process` sigue siendo inofensivo).
- Suites: `npm run test` (ratchet: más de 513 tests), `npm run lint` sin errores nuevos y `npm run tauri:build:debug` con exit 0 (en background con log y `EXIT=$?`).

Importadores / consumidores conocidos:
- `frontend/src/components/updates/UpdateDialog.tsx:128` (`downloadAndInstall`, se reemplaza), `:174` (`relaunch`, se borra), `:57-93` (efecto de apertura), `:95-182` (`handleDownloadAndInstall`), `:540` (botón).
- `frontend/src/components/updates/UpdateCheckProvider.tsx:86-87` (re-check del tray más `setShowDialog(true)`), `:119` (instancia del diálogo); `frontend/src/components/settings/About.tsx:180` (segunda instancia).
- `frontend/src/services/updateService.ts:21` y `:25` (imports), `:344-370` (método muerto); `frontend/src/services/updateService.test.ts:16-17` (mock de relaunch, sin cambios).
- `frontend/src/services/recordingService.ts:14` y `:18` (`RecordingState.is_recording` y `phase?`).
- `frontend/src/hooks/useRecordingStop.ts:289-294` (inicio del stop), `:660-663` (`finally`).
- Rust: `direct_update_install` y `DirectInstallOutcome` en `frontend/src-tauri/src/direct_update.rs` (U1).

Trampas:
- La bandera post-stop NO puede ser un contexto de React ni leer `useRecordingState()` desde el diálogo: `UpdateCheckProvider` está fuera de `RecordingStateProvider`.
- Nada de `console.*` nuevo: usa `logger` de `@/lib/logger` (ESLint `no-console`; el `console.error` del bloque que tocas pasa a `logger.error`).
- Los literales de `kind` deben coincidir con el serde de Rust (`rename_all = "camelCase"`): `postProcessing`, `recordingActive`, `noUpdate`.
- La clave del invoke es `onEvent` en camelCase (el parámetro Rust `on_event`); con `on_event` no llegaría el Channel.
- No quites el import de `exit`: `handleCloseToUpdate` lo usa hasta L3.
- El pre-chequeo de fase va en un `try` propio. Si `get_recording_state` falla, se sigue igual, porque Rust se niega de todas formas.
- Deja `installInFlightRef.current = false` en el `finally`, también cuando el invoke lanza.
- `useRecordingStop` tiene un guard `stopInProgressRef` antes del primer await. `beginPostStop()` va DESPUÉS de ese guard, así un stop duplicado no incrementa el contador sin su `endPostStop()`.
- Guard de shell: ningún comando ni commit con la palabra que empieza con "shut" y termina con "down".

Resultado esperado: con una grabación en cualquier fase distinta de idle, o mientras el JS guarda o transcribe la última grabación, "Descargar e Instalar" muestra un toast y no descarga. En reposo invoca `direct_update_install` y pinta el progreso por Channel; cada outcome tiene su mensaje. El diálogo ya no usa `downloadAndInstall` ni `relaunch`. Un re-check del tray a media descarga no resetea la barra. `updateService` ya no tiene camino de instalación desde JS.

Referencias:
- docs/specs/telemetria-ciclo-vida-83/research/areas/spec-nsis-update-B2.md § Frontend (base del handler; agrega `postProcessing` y el ref en vuelo)
- docs/specs/telemetria-ciclo-vida-83/research/areas2/verify-nsis-update-B2.md (post-stop, ref en vuelo, mock de check con Update disponible)
- docs/specs/telemetria-ciclo-vida-83/research/areas/verify-nsis-update-B2.md
- docs/specs/telemetria-ciclo-vida-83/spec.md (AC-14) y el contrato §6.2

### U4. ACL del updater solo check y fitness test

Objetivo: AC-14, el candado duro. Tras U2 y L3 ningún código JS instala updates: el NSIS va por `direct_update_install` y la Store por `store_install_updates`/`exit_for_update`. Pero la capability `main` sigue concediendo `updater:default` (`frontend/src-tauri/tauri.conf.json:73`), que según `tauri-plugin-updater-2.10.0/permissions/default.toml` incluye `allow-check`, `allow-download`, `allow-install` y `allow-download-and-install`. Cualquier `invoke('plugin:updater|download_and_install')` o un copy-paste futuro de `downloadAndInstall()` volvería al camino que mata el proceso con `process::exit(0)` sin guardar. Esta tarea reduce el ACL a `updater:allow-check` (el JS solo necesita `check()` como sonda) y agrega un fitness test que falla si reaparece una instalación desde JS o si alguien regresa el permiso.

Pasos:
1. `frontend/src-tauri/tauri.conf.json`: en `app.security.capabilities`, dentro de la capability con `"identifier": "main"` (L46), cambia la entrada `"updater:default",` (L73) por `"updater:allow-check",`. No toques nada más: ni otras capabilities, ni el bloque `plugins.updater` (L159: endpoints/pubkey), ni `identifier` o `bundle.windows`. Es la config BASE a propósito: la regla aplica a todas las plataformas. `tauri.windows.conf.json` y `tauri.macos.conf.json` no declaran capabilities (verificado con Grep) y no existe `src-tauri/capabilities/`.
2. Antes de escribir el test, confirma con Grep sobre `frontend/src` (excluyendo `*.test.*`) que no quedan `downloadAndInstall(`, `plugin:updater|install`, `plugin:updater|download` ni, en archivos que importen `@tauri-apps/plugin-updater`, `.install(`/`.download(`. Tras U2 los únicos importadores de runtime son `services/updateService.ts` (solo `check`) y `components/updates/UpdateDialog.tsx` (`check` + `type DownloadEvent`). Si encuentras un llamador vivo, NO lo edites (fuera de tu lista): regístralo como bloqueo en el reporte.
3. Crea `frontend/src/components/updates/updaterInstall.fitness.test.ts`, con el mismo patrón que `src/app/(aux)/layout.test.ts:28-56` (`readdirSync`/`statSync`/`readFileSync` de `node:fs`, `path` de `node:path`, `describe/it/expect` de vitest, `walk` recursivo). Cabecera en español: por qué existe (en Windows el plugin termina en `std::process::exit(0)` y se salta `RunEvent::Exit`: grabación sin guardar, DB abierta, llama-helper vivo bloqueando el instalador; el único camino es `invoke('direct_update_install')`, ver `docs/CANALES_DISTRIBUCION.md` § B2).
   - `const SRC = path.resolve(__dirname, '..', '..');` (`src/`). `const TAURI_CONF = path.resolve(SRC, '..', 'src-tauri', 'tauri.conf.json');`.
   - `function stripComments(src: string): string`: quita `/* ... */` (regex no codiciosa con `[\s\S]*?`) y los comentarios `//` de línea que no vayan precedidos de `:`, para no romper URLs `https://`. Así la documentación que menciona `downloadAndInstall()` no dispara el test.
   - `export function findUpdaterInstallCalls(file: string, source: string): string[]` (pura). Sobre `stripComments(source)` devuelve una descripción por hallazgo:
     (a) `/\bdownloadAndInstall\s*\(/` en cualquier archivo;
     (b) `/plugin:updater\|(install|download|download_and_install)\b/` en cualquier archivo;
     (c) si el archivo importa `@tauri-apps/plugin-updater` (regex `from\s+['"]@tauri-apps\/plugin-updater['"]`), también `/\.(install|download)\s*\(/`.
   - Archivos escaneados: todos los `.ts`/`.tsx` bajo `SRC` excepto `/\.(test|spec)\.(ts|tsx)$/` (los tests mockean `downloadAndInstall` a propósito).
   - Casos:
     1) `it('ningún archivo de src instala updates del plugin desde JS')`: junta los hallazgos de todos los archivos con su ruta relativa y hace `expect(violations).toEqual([])`, con un mensaje que apunte a `direct_update_install`.
     2) `it('el detector no es vacuo')`: `findUpdaterInstallCalls('x.ts', "import { check } from '@tauri-apps/plugin-updater';\nawait u.install();")` tiene longitud 1; `"await u.downloadAndInstall(cb)"` da 1; `"invoke('plugin:updater|download_and_install')"` da 1; `"// nunca uses downloadAndInstall() aquí"` da 0; `"server.install()"` sin el import del plugin da 0.
     3) `it('la capability main solo concede updater:allow-check')`: lee y parsea `TAURI_CONF`; en `app.security.capabilities` normaliza cada permiso a string (`typeof p === 'string' ? p : p.identifier`, igual que `scripts/lint-tauri-acl.js:102`). La capability `main` contiene `updater:allow-check`; NINGUNA capability contiene `updater:default`, `updater:allow-install`, `updater:allow-download` ni `updater:allow-download-and-install`.
4. Corre `node scripts/lint-tauri-acl.js`: debe seguir en OK, porque no revisa permisos del updater (sus RULES en `scripts/lint-tauri-acl.js:197-205` cubren ventana, diálogo y `getVersion`). Si falla, es por otra cosa: diagnostícala, no la silencies.

Tests:
- `cd /c/maity_desktop/frontend && npx vitest run src/components/updates/updaterInstall.fitness.test.ts` (los 3 casos).
- `cd /c/maity_desktop/frontend && npx vitest run src/components/updates/UpdateDialog.test.tsx` (regresión; el ACL no afecta a los mocks).
- `cd /c/maity_desktop/frontend && node scripts/lint-tauri-acl.js`: OK.
- Suites: `npm run test` y `npm run tauri:build:debug` con exit 0 (en background con log y `EXIT=$?`). El build valida el ACL: con un identificador de permiso inexistente, `tauri_build` falla al generar el contexto, así que el build confirma que `updater:allow-check` existe (está en `permissions/autogenerated/commands/check.toml` del plugin).
- Recomendado, sin bloquear: en `tauri:dev`, abrir Ajustes > Acerca de > Buscar actualizaciones y confirmar que el check sigue funcionando. Un `Update` devuelto por `check()` se libera con `core:resources:default`, que ya está en la capability.

Importadores / consumidores conocidos:
- `frontend/src-tauri/tauri.conf.json:46` (capability `main`), `:73` (`updater:default`, se reemplaza), `:159` (config `plugins.updater`, no se toca).
- JS que usa el plugin tras U2/L3: `frontend/src/services/updateService.ts:21` (`import { check }`, `check()` en `:171`) y `frontend/src/components/updates/UpdateDialog.tsx` (`check()` en el efecto de apertura). Tests con mocks del plugin: `frontend/src/services/updateService.test.ts:3`, `frontend/src/components/updates/UpdateDialog.test.tsx:15`.
- Lado Rust: `direct_update.rs` (U1) usa `app.updater_builder()`. El ACL solo gobierna IPC desde el webview y no afecta a Rust.
- `frontend/scripts/lint-tauri-acl.js:98-102` (lectura de capabilities; mismo normalizado de permisos).

Trampas:
- No cambies `tauri_plugin_updater::Builder::new().build()` en `lib.rs` (no está en tu lista y el plugin tiene que seguir registrado para `check` y para el `updater_builder()` de Rust).
- No borres el permiso del updater del todo: sin `allow-check`, `check()` del JS lanzaría un error de ACL y la app nunca avisaría de updates.
- El test no debe marcar comentarios ni los mocks de los tests. Cubre esos dos casos en el caso "el detector no es vacuo".
- `__dirname` funciona en los tests de vitest de este repo (`layout.test.ts:33` lo usa); el entorno es `jsdom` pero `node:fs` está disponible.
- Guard de shell: nada de la palabra que empieza con "shut" y termina con "down" en comandos ni en el commit; nada de `node -e`.

Resultado esperado: la capability `main` concede solo `updater:allow-check`. Una llamada a `download`, `install` o `download_and_install` del plugin desde el webview la rechaza el ACL en todas las plataformas. El fitness test falla en CI local si alguien reintroduce `downloadAndInstall(`, `.install(`/`.download(` sobre el plugin, `invoke('plugin:updater|…')` o regresa `updater:default`.

Referencias:
- docs/specs/telemetria-ciclo-vida-83/research/areas2/verify-nsis-update-B2.md (issue 2: `updater:default` a `updater:allow-check`)
- docs/specs/telemetria-ciclo-vida-83/research/areas/verify-nsis-update-B2.md (issue 5: fitness test como complemento del selector de ESLint)
- docs/specs/telemetria-ciclo-vida-83/research/areas/spec-nsis-update-B2.md
- docs/specs/telemetria-ciclo-vida-83/spec.md (AC-14) y el contrato §6.3

## Parte S - Sesion: logout, recarga, auth.logout, session_lost

### S1. Logout del sidebar del chat pasa por logout_cleanup

Objetivo: arreglar el bug B1 (AC-17). El boton "Cerrar sesion" del footer del sidebar del chat (`SidebarFooterV5`) llama `supabase.auth.signOut()` directo. Asi se salta `AuthContext.signOut`, y con el `logout_cleanup` de Rust, que detiene y GUARDA la grabacion activa mientras `current_user_id` sigue vivo. El resultado era que el segmento de jornada terminaba `Failed` ("sin usuario logueado", `scheduled_recording/service.rs:1291`), y ademas `cloud_sync_clear_session` nunca corria desde esa superficie. Esta tarea tambien agrega un guard de re-entrada a `signOut` (un doble clic ya no lanza dos `logout_cleanup`) y un fitness test que prohibe `.auth.signOut(` fuera de AuthContext.

Pasos:
1. `frontend/src/shared/components/shell-v5/SidebarFooterV5.tsx`
   - L3: hoy es `import { supabase, useAvatarWithDefault } from '@maity/shared';`. Dejalo en `import { useAvatarWithDefault } from '@maity/shared';`, sin `supabase`.
   - Agrega `import { useAuth } from '@/contexts/AuthContext';`.
   - Dentro de `SidebarFooterV5()` agrega `const { signOut } = useAuth();`.
   - `handleLogout` (hoy en L36-39) queda asi: `const handleLogout = async () => { await signOut(); navigate('/'); };`. En esta tarea `signOut()` va SIN argumento: la superficie `'chat_sidebar'` la agrega S3b.
   - En el JSDoc del componente (L17-29) agrega un parrafo: "ADAPTACION DESKTOP: la web borro shell-v5 (Sixale730/maity b0f8de1e); aqui el logout DEBE pasar por useAuth().signOut -> logout_cleanup, que guarda la grabacion activa antes de soltar current_user_id. No volver al signOut directo del cliente supabase." Ese comentario NO debe contener el literal `.auth.signOut(`. El fitness test quita comentarios antes de buscar, pero no lo escribas igual.
2. `frontend/src/contexts/AuthContext.tsx`: `signOut` esta en L895-941.
   - Primera sentencia del cuerpo del `useCallback`, antes de `logger.debug('[Auth] signOut called')` y antes de `isSigningOut.current = true`: `if (signOutPromise.current) return signOutPromise.current`. El ref `signOutPromise` ya existe (L102) y ya lo usa `waitForSignOut` (L681-686). No cambies su semantica: se asigna en L938 y se limpia en L940.
   - Comentario de una linea: "re-entrada: un doble clic en Cerrar sesion reusa el logout en curso (no dos logout_cleanup)".
   - No toques el orden `logout_cleanup` (L905) -> `cloud_sync_clear_session` (L911) -> limpieza local -> `supabase.auth.signOut()` (L925).
   - Encima de L925 agrega un comentario que diga que este es el UNICO signOut de supabase autorizado, porque `logout_cleanup` ya corrio. Si es necesario para el fitness test, esa linea queda permitida por la exclusion de `contexts/AuthContext.tsx`.
   - No cambies la firma publica `signOut: () => Promise<void>` (L36): S3b la cambia.
3. Crea `frontend/src/contexts/authSignOut.fitness.test.ts`, al estilo de `src/lib/supabase.test.ts` (L25-63: `readdirSync` recursivo + `path.resolve(__dirname, '..')`).
   - Imports: `import { readdirSync, readFileSync } from 'node:fs'`, `import path from 'node:path'`, `import { describe, it, expect } from 'vitest'`.
   - `SRC_ROOT = path.resolve(__dirname, '..')`, que apunta a `frontend/src`.
   - Recorre recursivamente los `*.ts` y `*.tsx` (saltando `node_modules` y `.d.ts`). Excluye:
     - archivos cuyo nombre contenga `.test.` o `.spec.`
     - todo lo que este bajo `shared/maity-shared/` (arbol zero-drift de la web)
     - `test/mocks/`
     - `contexts/AuthContext.tsx`
     - Normaliza separadores con `.split(path.sep).join('/')` antes de comparar; el repo corre en Windows.
   - Para cada archivo: quita los comentarios con `src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')`, cuidando no romper `http://`, y busca `/\.auth\s*\.\s*signOut\s*\(/`.
   - Caso 1: `it('ningun archivo fuera de AuthContext llama al signOut de supabase-js directo', …)`. Acumula las violaciones como `ruta:linea` y hace `expect(violations).toEqual([])`, con un mensaje que apunte a `docs/NUBE_CUENTAS_SYNC.md`.
   - Caso 2 (sanidad del detector): `it('el detector reconoce la forma prohibida', …)`. Aplica la misma funcion `findViolations(src)` a un string literal que contenga una llamada `supabase.auth.signOut()`, arma el string por concatenacion para que el propio test no dispare nada, y espera 1 violacion. Tambien aplica la funcion a un string con esa misma llamada dentro de un comentario `//` y espera 0.
4. `docs/NUBE_CUENTAS_SYNC.md`: agrega una seccion nueva despues de la de `onAuthStateChange` (termina en L33, antes de `## Sistema de Roles` en L35), titulada `## Todo logout pasa por AuthContext.signOut (sep-2026, #83)`. Contenido en 3-5 lineas:
   - Sintoma: el sidebar del chat cerraba sesion sin `logout_cleanup` y la grabacion activa perdia el segmento por falta de `current_user_id`.
   - Regla: todo boton de logout usa `useAuth().signOut()`; solo `AuthContext` llama al signOut de supabase-js, DESPUES de `logout_cleanup` y `cloud_sync_clear_session`.
   - Guard: `src/contexts/authSignOut.fitness.test.ts`.
   - `signOut` es re-entrante: devuelve el promise en curso.
   - `shell-v5` es una adaptacion desktop: la web lo borro, no re-sincronizarlo.
5. Corre el test (debe pasar), `npm run lint`, `npm run test` y el build integrado.

Tests:
- Nuevo `frontend/src/contexts/authSignOut.fitness.test.ts`, con los 2 casos descritos. Antes del paso 1 el caso 1 FALLA contra el `SidebarFooterV5.tsx` viejo (L37). Si quieres comprobarlo, corre el test antes de editar el componente; es lo que pide AC-17.
- Comandos:
  - `cd /c/maity_desktop/frontend && npx vitest run src/contexts/authSignOut.fitness.test.ts`
  - `npm run test`
  - `npm run lint`
  - `npm run tauri:build:debug` (en background con log; ver verify.md)

Importadores / consumidores conocidos:
- `SidebarFooterV5` lo monta `shared/components/shell-v5/CombinedSidebar.tsx` (import L5, uso ~L98). A este lo usa `MaityChatLayout`, renderizado por `app/(main)/chat/page.tsx`.
- Otros logouts que ya pasan por `useAuth().signOut` (no se tocan aqui):
  - `app/(main)/layout.tsx:257`
  - `components/Onboarding/OnboardingAccountBadge.tsx:74`
  - `components/Sidebar/SidebarControls.tsx:64`
  - `components/settings/PreferenceSettings.tsx:505`
- `waitForSignOut` (AuthContext.tsx:681) espera `signOutPromise.current` antes de un sign-in.
- `src/test/mocks/supabase.ts:158` define `signOut: vi.fn(...)` dentro de un mock. No es una llamada `.auth.signOut(` y ademas `test/mocks/` queda excluido.

Trampas:
- `useUser()` (UserContext) es un shim que NO expone `signOut`: usa `useAuth()`.
- El `supabase` que importa SidebarFooterV5 viene de `@maity/shared`. Despues del cambio no debe quedar import sin usar (ESLint `@typescript-eslint/no-unused-vars`).
- Frontend: nada de `console.*` nuevo (`no-console`); usa `logger` de `@/lib/logger` si hace falta loguear.
- No edites `.eslintrc.json`: no esta en la lista de archivos de esta tarea. El guard de esta tarea es el fitness test.
- El guard de re-entrada va ANTES de `isSigningOut.current = true`. Si queda despues, un segundo clic vuelve a poner el flag en `true` mientras el primero ya lo puso en `false` en su `finally`, y se pierde el filtro de SIGNED_OUT.
- `navigate('/')` sigue despues del `await signOut()`: el AuthGate de la main se encarga del login compacto.
- La palabra que empieza con "shut" y termina con "down" no puede aparecer en ningun comando Bash ni en el commit.

Resultado esperado:
- Cerrar sesion desde el sidebar del chat grabando: el log muestra el camino de `logout_cleanup` ("Segmento de jornada cerrado y guardado antes de salir" o el stop manual) y la conversacion aparece al volver a entrar.
- Un doble clic en cualquier boton de logout ejecuta un solo `logout_cleanup`.
- El fitness test falla si alguien vuelve a llamar al signOut de supabase-js fuera de AuthContext.

Referencias:
- `docs/specs/telemetria-ciclo-vida-83/research/areas/spec-autostart-logout-T3-T4-B1.md` (seccion 1, "B1")
- `docs/specs/telemetria-ciclo-vida-83/research/areas2/verify-autostart-logout-T3-T4-B1.md` (issue minor "signOut(surface) from the chat sidebar is safe as-is" -> guard de re-entrada)
- `docs/specs/telemetria-ciclo-vida-83/research/plan-agent-review.md` (#5)

### S2. Recargar el webview no suelta al usuario en Rust

Objetivo: arreglar un bug nuevo (AC-18). El efecto de `AuthContext` que sincroniza al usuario con Rust (`frontend/src/contexts/AuthContext.tsx:108-124`) llama `clear_current_user` y `cloud_sync_clear_session` en CUALQUIER render con `maityUser == null`, y eso incluye el primer render del montaje. Rust sobrevive a una recarga del webview (F5, ChunkErrorRecovery, HMR), pero el webview monta de nuevo con `maityUser = null` y le suelta el usuario a Rust. Mientras `getSession` restaura la sesion, Rust queda sin `current_user_id`. En ese hueco la jornada ve `has_session == false`, y un segmento que se cierre ahi termina `Failed` (`scheduled_recording/service.rs:1291`). Ademas la sesion cloud del sync headless se borra, y la vuelve a sembrar otro efecto. La correccion es liberar SOLO cuando la inicializacion de auth ya termino y no hay usuario, o cuando hubo una transicion real Some -> None.

Pasos:
1. Crea `frontend/src/lib/authRelease.ts`: una funcion pura, sin imports de React, Tauri ni supabase.
   ```ts
   /**
    * ¿Debe el webview soltar al usuario en Rust (clear_current_user + cloud_sync_clear_session)?
    * - nextId presente: nunca (hay usuario; el efecto hace set_current_user).
    * - prevId presente y nextId ausente: sí (transición real Some→None: logout o sesión perdida).
    * - ninguno de los dos: solo si la inicialización de auth YA terminó (authReady) — durante la
    *   carga inicial del montaje (recarga del webview) Rust conserva al usuario de antes.
    */
   export function shouldReleaseRustUser(prevId: string | null, nextId: string | null, authReady: boolean): boolean
   ```
   Implementacion: `if (nextId) return false; if (prevId) return true; return authReady;`.
2. Crea `frontend/src/lib/authRelease.test.ts` (vitest) con `describe('shouldReleaseRustUser')` y estos casos:
   - `(null, null, false)` -> `false`. Es el montaje durante la recarga, el bug.
   - `(null, null, true)` -> `true`. La inicializacion termino sin usuario.
   - `('u1', null, false)` -> `true`.
   - `('u1', null, true)` -> `true`.
   - `(null, 'u1', false)` -> `false`; `(null, 'u1', true)` -> `false`.
   - `('u1', 'u2', true)` -> `false`. Cambio de cuenta: lo cubre `set_current_user`.
3. `frontend/src/contexts/AuthContext.tsx`:
   - `import { shouldReleaseRustUser } from '@/lib/authRelease'`.
   - Junto a los otros refs (L99-102): `const lastSyncedUserIdRef = useRef<string | null>(null)`, que guarda el id del ultimo usuario sincronizado con Rust.
   - Antes del efecto: `const authReady = !isLoading && !user`. `isLoading` pasa a `false` en el `finally` de `initialize()` (L428-432). Eso ocurre DESPUES de `await fetchOrCreateMaityUserRef.current(existingSession.user)` (L424), asi que con sesion viva `maityUser` ya esta resuelto cuando `isLoading` baja. `!user` hace que una falla de `fetchOrCreateMaityUser` con sesion viva, por ejemplo al recargar sin red, NO suelte a Rust: sigue siendo la misma cuenta.
   - Reescribe el efecto de L108-124 con dependencias `[maityUser?.id, authReady]`:
     ```ts
     useEffect(() => {
       const nextId = maityUser?.id ?? null
       const prevId = lastSyncedUserIdRef.current
       lastSyncedUserIdRef.current = nextId
       if (nextId) {
         invoke('set_current_user', { userId: nextId }).catch(...)   // igual que hoy
         return
       }
       if (!shouldReleaseRustUser(prevId, nextId, authReady)) {
         logger.debug('[Auth] Carga inicial sin usuario todavía: Rust conserva current_user_id')
         return
       }
       invoke('clear_current_user').catch(...)       // igual que hoy
       invoke('cloud_sync_clear_session').catch(...) // igual que hoy
     }, [maityUser?.id, authReady])
     ```
     Actualiza el comentario de L106-107 y L117-119: explica que liberar durante la carga inicial soltaba al usuario al recargar el webview, cita `lib/authRelease.ts` y conserva la nota de que `cloud_sync_clear_session` tambien corre aqui para las perdidas que no pasan por `signOut`.
4. No toques `signOut`. Ya limpia `session`, `user` y `maityUser` en L920-922, y con eso `prevId` pasa de Some a None, `authReady` se vuelve `true` y se libera. Tampoco toques el callback de `onAuthStateChange`.
5. Corre el test nuevo, `npm run test`, `npm run lint` y el build integrado.

Tests:
- Nuevo `frontend/src/lib/authRelease.test.ts`, con los casos del paso 2.
- Comandos:
  - `cd /c/maity_desktop/frontend && npx vitest run src/lib/authRelease.test.ts`
  - `npm run test`
  - `npm run lint`
  - `npm run tauri:build:debug` (en background con log)

Importadores / consumidores conocidos:
- `clear_current_user`: `frontend/src-tauri/src/database/commands.rs:510`, registrado en `lib.rs:1599`. Limpia `current_user_id` y `registration_completed`, cierra el coach-float y descarga el STT (L514-528). Por eso liberar de mas tambien descargaba el motor en cada recarga.
- `set_current_user`: `database/commands.rs:457`. Detecta la transicion None -> Some (L464-469) y es idempotente con el mismo id.
- `cloud_sync_clear_session`: `lib.rs:1643` (`cloud_sync::commands`).
- `has_session`: `state.rs:33`. Es el gate de la jornada y del tray y lee `current_user_id`.

Trampas:
- El callback de `onAuthStateChange` (L446-487) sigue SINCRONO: esta tarea no lo toca. La regla ESLint `no-restricted-syntax` falla si aparece un `AwaitExpression` dentro.
- `authReady` depende de `user` (el estado de auth), no de `session`, porque `setUser` y `setSession` van juntos en todas las ramas. No uses `session` aqui.
- `lastSyncedUserIdRef.current` se actualiza SIEMPRE, antes de decidir; si no, dos renders seguidos con `null` dejan `prevId` desfasado.
- Las tareas S4 y S5 extienden este mismo efecto y el callback: deja el efecto legible, con la decision en una sola llamada a `shouldReleaseRustUser`.
- Frontend: `logger` de `@/lib/logger`, nada de `console.*` nuevo. Hay `console.error` viejos en el archivo: no los muevas.
- La palabra que empieza con "shut" y termina con "down" no puede aparecer en ningun comando ni en el commit.

Resultado esperado:
- Recargar el webview (F5 o Ctrl+R en DevTools) con sesion viva ya no loguea `[AppState] current_user_id cleared (logout)` ni `STT unload tras logout` en el log de Rust.
- Una jornada en curso no pierde al usuario ni un segmento por recargar.
- Logout y sesion perdida siguen liberando igual que antes.

Referencias:
- `docs/specs/telemetria-ciclo-vida-83/research/areas/spec-autostart-logout-T3-T4-B1.md` (Current behavior, "Consequence of B1": efecto L108-124)
- `docs/specs/telemetria-ciclo-vida-83/research/areas2/verify-autostart-logout-T3-T4-B1.md` (Confirmed claims: "clear_current_user … also fires at mount while maityUser is null")

**Ajustes del líder tras la refutación del plan (mandan sobre lo anterior si chocan):**
1. Arranque offline con token vencido NO es "sin usuario": en `initialize()` desestructurar `const { data: { session: existingSession }, error } = await supabase.auth.getSession()`; si no hay sesión y (`isAuthRetryableFetchError(error)` de `@supabase/supabase-js` o `navigator.onLine === false`) ⇒ `bootSessionUncertainRef.current = true`. `authReady = !isLoading && !user && !bootSessionUncertainRef.current`. El callback síncrono de `onAuthStateChange` limpia la bandera cuando llega un evento con sesión o un SIGNED_OUT real (asignar un ref está permitido; nada de await). `shouldReleaseRustUser` gana el caso "incierto ⇒ no soltar" en su test (`(null, null, false)` ⇒ false). S4 reutiliza este mismo `error` en lugar de volver a tocar la línea de `getSession`.

### S3a. auth.logout desde logout_cleanup con flush

Objetivo: emitir `auth.logout` (AC-19) desde Rust, dentro de `logout_cleanup`, y subir esa misma fila con el token de quien sale ANTES de que el frontend corra `cloud_sync_clear_session` (`AuthContext.tsx`: `logout_cleanup` en L905 y despues `cloud_sync_clear_session` en L911). Hoy un logout no deja ningun rastro en `maity.platform_logs`, y con el logout la clasificacion de #83 no puede distinguir "cerro sesion" de "la app no grabo". La fila se escribe PRIMERO al outbox y luego corren en paralelo el stop de la grabacion (<=30 s) y el flush dirigido de esa fila (<=3 s). Al final se borra la marca de ultimo login, porque un logout del usuario no es una sesion perdida (S4).

Pasos:
1. Crea `frontend/src-tauri/src/logging/telemetry/auth.rs` con un doc-comment de modulo en español: emisor de `auth.logout` (y, desde S4, de `auth.session_lost`); outbox + `flush_row`; por que `maity_user_id` va en el payload (una fila que se drena despues se atribuye en el RPC a quien este logueado en ese momento).
   ```rust
   use serde_json::json;
   use tauri::{AppHandle, Runtime};

   /// Superficies de logout aceptadas (dominio cerrado; cualquier otra ⇒ "unknown").
   pub(crate) const LOGOUT_SURFACES: &[&str] =
       &["settings", "sidebar", "chat_sidebar", "onboarding_badge", "account_error", "unknown"];

   pub(crate) fn normalize_surface(surface: Option<&str>) -> &'static str
   // Devuelve el &'static str de LOGOUT_SURFACES que coincide EXACTO (sin trim ni lowercase);
   // None, vacío o desconocido ⇒ "unknown".

   #[derive(Debug, Clone)]
   pub(crate) struct LogoutFacts {
       pub surface: &'static str,
       pub maity_user_id: Option<String>,
       pub recording_was_active: bool,
       pub recording_phase: &'static str,
   }

   /// Payload de `auth.logout` (contrato 1.6), puro.
   pub(crate) fn logout_payload(f: &LogoutFacts) -> serde_json::Value
   // json!({ "reason": "user", "surface": f.surface, "maity_user_id": f.maity_user_id,
   //         "recording_was_active": f.recording_was_active, "recording_phase": f.recording_phase })

   /// Escribe `auth.logout` al outbox y devuelve el id de la fila (None si no se escribió).
   pub(crate) async fn emit_logout<R: Runtime>(app: &AppHandle<R>, f: &LogoutFacts) -> Option<i64>
   // super::emit::emit_event_with_id(app, super::context::process_session_id(),
   //     super::catalog::AUTH_LOGOUT, logout_payload(f), Some(super::status::TelemetryStatus::Ok), None, None).await
   ```
   Antes de escribir la llamada, confirma la firma exacta de `emit_event_with_id` en `logging/telemetry/emit.rs` (la agrega A2, contrato 1.8) y la ruta del enum `TelemetryStatus` (`logging/telemetry/status.rs:20`).
2. `frontend/src-tauri/src/logging/telemetry/mod.rs`: agrega `pub mod auth;` en orden alfabetico, antes de `pub mod catalog;`. L1 ya agrego `pub mod lifecycle;`: no lo muevas. Suma una linea al doc-comment del modulo describiendo `auth`.
3. `frontend/src-tauri/src/lib.rs`: `logout_cleanup` esta en L153-169 (verificalo, J1/L1/L2/E1/E2b/U1/L3/P2 lo pudieron desplazar).
   - La firma pasa a `async fn logout_cleanup<R: Runtime>(app: AppHandle<R>, surface: Option<String>) -> Result<(), String>`. El parametro se llama `surface`, NO `_surface`: la clave del `invoke` sale del nombre (S3b manda `{ surface }`). Hasta S3b el JS no la manda y llega `None`, que se reporta como `"unknown"`.
   - El cuerpo va en este orden:
     1. `let phase = crate::audio::recording_phase::current_phase();` (`recording_phase.rs:140`; `as_str()` en L48, `is_session_active()` en L61).
     2. `let maity_user_id = match app.try_state::<crate::state::AppState>() { Some(s) => s.current_user_id().await, None => None };`. El snapshot va en un statement propio: nada de `if let` sobre un guard de tokio.
     3. `let facts = logging::telemetry::auth::LogoutFacts { surface: logging::telemetry::auth::normalize_surface(surface.as_deref()), maity_user_id, recording_was_active: phase.is_session_active(), recording_phase: phase.as_str() };`
     4. `let row_id = logging::telemetry::auth::emit_logout(&app, &facts).await;`: la fila se escribe PRIMERO, antes del stop.
     5. `let stop = async { if tokio::time::timeout(Duration::from_secs(30), graceful_…_before_exit(&app)).await.is_err() { log::warn!("logout_cleanup: stop de grabación excedió 30s; continuando logout"); } };`. Es el mismo stop de hoy. Escribe el nombre completo de la funcion con Edit, nunca en un comando de shell.
     6. `let flush = async { match row_id { Some(id) => Some(logging::telemetry::drain::flush_row(&app, id, Duration::from_secs(3)).await), None => None } };`. Confirma la firma real de `flush_row` en `drain.rs` (A2: `flush_row(app, id: i64, budget: Duration) -> FlushOutcome`) y si recibe `&AppHandle`.
     7. `let (_, flushed) = tokio::join!(stop, flush);` y luego `log::info!("logout_cleanup: auth.logout surface={} fila={:?} flush={:?}", facts.surface, row_id, flushed);`. Si `FlushOutcome` no deriva `Debug`, loguea con un `match`.
     8. `let _ = logging::telemetry::lifecycle::take_last_login_user();` (L1, contrato 1.5/1.8; confirma la firma: no recibe `app`).
     9. `Ok(())`: nunca falla, igual que hoy.
   - Actualiza el doc-comment de `logout_cleanup` (L153-156): emite `auth.logout` primero, luego stop + flush dirigido en paralelo, y borra la marca de login.
   - `Duration` es `std::time::Duration`: usa la ruta completa o el `use` que ya exista en lib.rs.
   - La entrada de `generate_handler!` (`logout_cleanup,` ~L1604) no cambia.
4. Tests en `auth.rs`, dentro de `#[cfg(test)] mod tests`:
   - `normalize_surface`: `Some("settings")` -> `"settings"`; `Some("chat_sidebar")` -> `"chat_sidebar"`; `None` -> `"unknown"`; `Some("")` -> `"unknown"`; `Some("Settings")` -> `"unknown"` (exacto); `Some("<script>")` -> `"unknown"`.
   - Todo valor de `LOGOUT_SURFACES` pasa por `normalize_surface` y vuelve igual.
   - `logout_payload`:
     - `reason == "user"`.
     - Lleva `surface`, `recording_phase` y `recording_was_active`.
     - Con `maity_user_id: None` serializa `null`.
     - Con `Some("u1")` serializa `"u1"`.
     - Sus claves son exactamente `{reason, surface, maity_user_id, recording_was_active, recording_phase}`: compara el set de `as_object().keys()`.
5. Corre `cargo test --lib logging::telemetry::auth` y despues el build integrado.

Tests:
- `frontend/src-tauri/src/logging/telemetry/auth.rs` `mod tests`, con los casos del paso 4.
- Comandos:
  - `cd /c/maity_desktop/frontend/src-tauri && cargo test --lib logging::telemetry::auth`
  - `cd /c/maity_desktop/frontend && npm run tauri:build:debug` (en background con log; el pre-build corre `lint-telemetry.js`, que exige que `auth.logout` ya este en el catalogo; lo registro A1)

Importadores / consumidores conocidos:
- `logout_cleanup`: lo invoca `AuthContext.tsx:905` (`invoke('logout_cleanup')`, sin argumentos hasta S3b) y esta registrado en `lib.rs` `generate_handler!` (~L1604).
- La funcion de stop es `pub async fn graceful_…_before_exit` (`lib.rs:1833`, verificalo). J1 puso `begin_session_end()` como su primera sentencia, y por eso el logout deja la retencion SessionEnd, que se libera cuando no hay sesion.
- `catalog::AUTH_LOGOUT` (A1), `emit::emit_event_with_id` y `drain::flush_row` (A2), `lifecycle::take_last_login_user` (L1).
- `state::AppState::current_user_id()` en `state.rs:24`.

Trampas:
- Orden obligatorio: la fila se escribe ANTES del stop. Si se emite despues, `recording_was_active` siempre sale `false` y la fila compite con el cierre del segmento.
- `flush_row` usa `cloud_sync::session::token_if_fresh` y nunca refresca el token durante el logout (refrescar rotaria el refresh_token justo cuando la UI hace el signOut). Si no hay token fresco, la fila queda en el outbox con `maity_user_id`: no la reintentes aqui.
- No envuelvas `flush_row` ni el drenado en otro `tokio::time::timeout`: el presupuesto de 3 s ya es suyo. Cancelar un drenado a medias duplica filas.
- `.lock().unwrap()` esta prohibido. Los locks de tokio van con snapshot en un statement propio.
- Nunca `log::error!` en telemetria (lo agarra el bridge de errores); usa `warn!` o `info!`.
- Guard de shell: el nombre de la funcion de stop contiene la palabra prohibida. Editala solo con Edit y nunca la escribas en un comando Bash ni en el commit.
- No se agregan eventos Tauri. Los comandos propios no necesitan capability (no hay AppManifest en `build.rs`).

Resultado esperado:
- Cerrar sesion con red deja en `maity.platform_logs`, segundos despues del clic, una fila `auth.logout` con status `ok`, `surface` = `unknown` hasta S3b, `recording_was_active` correcto y `user_id` de quien salio.
- Sin red, la fila queda en el outbox y lleva `maity_user_id` para atribuirla despues.
- El logout no tarda mas que hoy: el flush corre en paralelo con el stop.

Referencias:
- `docs/specs/telemetria-ciclo-vida-83/research/areas/spec-autostart-logout-T3-T4-B1.md` (seccion 4, "T4a")
- `docs/specs/telemetria-ciclo-vida-83/research/areas2/verify-autostart-logout-T3-T4-B1.md` (issues flush_now/timeout, token reuse-only, `surface` vs `_surface`)
- `docs/specs/telemetria-ciclo-vida-83/research/plan-agent-review.md` (#5)

### S3b. signOut con superficie desde cada boton

Objetivo: que `auth.logout` (S3a, AC-19) diga desde que boton se cerro la sesion (`surface`). Para eso `AuthContext.signOut` acepta una superficie opcional y la pasa a `invoke('logout_cleanup', { surface })`. Los tres botones de esta tarea (Ajustes, sidebar principal y sidebar del chat) pasan la suya. La normalizacion por `typeof` protege del caso `onClick={signOut}`, que hoy existe en PreferenceSettings y le pasaria el MouseEvent como primer argumento.

Pasos:
1. `frontend/src/contexts/AuthContext.tsx`:
   - Exporta el tipo, cerca de `AuthContextType` (L22-38):
     `export type LogoutSurface = 'settings' | 'sidebar' | 'chat_sidebar' | 'onboarding_badge' | 'account_error' | 'unknown'`
     Debe ser el mismo dominio que `LOGOUT_SURFACES` de `logging/telemetry/auth.rs` (S3a).
   - En `AuthContextType` (L36): `signOut: (surface?: LogoutSurface) => Promise<void>`.
   - `const signOut = useCallback(async (surface?: LogoutSurface) => { … })`:
     - Primera linea del cuerpo, antes del guard de re-entrada que agrego S1:
       `const s: LogoutSurface = typeof surface === 'string' ? surface : 'unknown'`.
       El guard de re-entrada (`if (signOutPromise.current) return signOutPromise.current`) se queda: una segunda llamada devuelve el logout en curso y su superficie se ignora.
     - En `doSignOut` cambia `await invoke('logout_cleanup')` por `await invoke('logout_cleanup', { surface: s })`. La clave es `surface`: es el nombre del parametro Rust (S3a) y en Tauri la clave del invoke sale del nombre del parametro.
     - Actualiza `logger.debug('[Auth] signOut called')` a `logger.debug('[Auth] signOut called', { surface: s })`.
2. `frontend/src/components/settings/PreferenceSettings.tsx`, L505 (verificala; P2 edito este archivo):
   - Cambia `onClick={signOut}` por `onClick={() => void signOut('settings')}`. Es obligatorio: con la firma nueva, `onClick={signOut}` ya no tipa (MouseEvent no es `LogoutSurface`) y ademas mandaria basura.
3. `frontend/src/components/Sidebar/SidebarControls.tsx`, L63-65:
   - Cambia `void signOut();` por `void signOut('sidebar');`.
4. `frontend/src/shared/components/shell-v5/SidebarFooterV5.tsx`:
   - En `handleLogout` (S1 lo dejo como `await signOut(); navigate('/');`) pasa a `await signOut('chat_sidebar');`.
5. No toques `app/(main)/layout.tsx:257` (`signOut()` -> `'unknown'`) ni `components/Onboarding/OnboardingAccountBadge.tsx:74`: no estan en la lista de archivos de esta tarea y siguen tipando porque el argumento es opcional.
6. Corre el fitness test, `npm run test`, `npm run lint` y el build integrado.

Tests:
- No hay test nuevo. La superficie la normaliza Rust (`normalize_surface`, con tests en S3a), y el tipo `LogoutSurface` lo verifica `tsc`/`next build` dentro del build integrado.
- `authSignOut.fitness.test.ts` (S1) debe seguir verde.
- Comandos:
  - `cd /c/maity_desktop/frontend && npx vitest run src/contexts/authSignOut.fitness.test.ts`
  - `npm run test`
  - `npm run lint`
  - `npm run tauri:build:debug` (en background con log)

Importadores / consumidores conocidos:
- Consumidores de `useAuth().signOut`:
  - `app/(main)/layout.tsx:126` (desestructura) y `:257` (`onClick={() => signOut()}`)
  - `components/Onboarding/OnboardingAccountBadge.tsx:19`/`:74`
  - `components/Sidebar/SidebarControls.tsx:26`/`:64`
  - `components/settings/PreferenceSettings.tsx:37`/`:505`
  - `shared/components/shell-v5/SidebarFooterV5.tsx` (S1)
- Rust: `logout_cleanup(app, surface: Option<String>)` en `lib.rs` (S3a).

Trampas:
- La clave del invoke es `surface`, en minusculas y sin `rename_all`. Si la clave no coincide con el parametro, Rust recibe `None` sin error y todo sale `unknown`. Es el mismo fallo silencioso que documenta CLAUDE.md para las claves en snake_case.
- `typeof surface === 'string'` es la defensa contra un MouseEvent. No la cambies por `surface ?? 'unknown'`, que dejaria pasar el objeto.
- No reordenes `doSignOut`. El orden sigue siendo `logout_cleanup`, luego `cloud_sync_clear_session`, luego la limpieza local y al final el signOut de supabase-js.
- Frontend: nada de `console.*` nuevo.
- La palabra que empieza con "shut" y termina con "down" no puede aparecer en ningun comando ni en el commit.

Resultado esperado:
- `auth.logout` llega con `surface` en `settings`, `sidebar` o `chat_sidebar` segun el boton usado.
- Los logouts desde el badge de onboarding y desde la pantalla de error de cuenta siguen llegando como `unknown`.

Referencias:
- `docs/specs/telemetria-ciclo-vida-83/research/areas/spec-autostart-logout-T3-T4-B1.md` (seccion 1, "Call sites")
- `docs/specs/telemetria-ciclo-vida-83/research/areas2/verify-autostart-logout-T3-T4-B1.md` (issue "Commit 1: Rust accepts surface…")

**Ajustes del líder tras la refutación del plan (mandan sobre lo anterior si chocan):**
1. Archivos nuevos en la lista: `frontend/src/components/Onboarding/OnboardingAccountBadge.tsx` (`void signOut('onboarding_badge')`, hoy :74) y `frontend/src/app/(main)/layout.tsx` (botón "Cerrar sesión" de la pantalla de error de cuenta, hoy :257 ⇒ `onClick={() => signOut('account_error')}`). Con eso los 6 valores de `surface` del contrato son alcanzables. Ruta con paréntesis: entrecomillar en Bash.

### S4. auth.session_lost solo en perdidas reales

Objetivo: emitir `auth.session_lost` (AC-19, status `warning`) solo cuando la sesion se pierde sin que el usuario la cierre. Son dos fuentes:
- (a) `webview_signed_out`: un SIGNED_OUT espontaneo de supabase-js mientras la app corre, por refresh rechazado o sesion revocada.
- (b) `boot_no_session`: la app arranca sin sesion, existe la marca persistida de un login previo y `getSession` NO fallo por red.

Nunca se emite por red caida. El caso tipico del piloto es un autostart antes de que suba el Wi-Fi, con el token vencido: `getSession` devuelve `session: null` con un error reintentable. auth-js descarta la sesion muerta dentro de `initialize()`, antes de que nos suscribamos (GoTrueClient 2.93.3, L1092/L1909-1926), asi que el listener no alcanza a ver el caso (b). Por eso (b) va en `initialize()`. La emite un comando Rust (outbox) porque el `platformLogger` de JS postea directo con supabase-js y sin sesion no puede reportar nada. La marca de login vive en el marcador de ciclo de vida de L1 (`last_login_user`) y la escribe `set_current_user` en el login.

Pasos:
1. `frontend/src-tauri/src/logging/telemetry/auth.rs` (creado en S3a). Agrega:
   ```rust
   /// Fuentes aceptadas de `auth.session_lost` (dominio cerrado).
   pub(crate) const SESSION_LOST_SOURCES: &[&str] = &["webview_signed_out", "boot_no_session"];

   /// Regla pura: ¿se emite? Fuente desconocida ⇒ no. `boot_no_session` exige marca de login
   /// previa (sin marca = primer arranque o el anterior cerró sesión limpio). `webview_signed_out` ⇒ sí.
   pub(crate) fn should_emit_session_lost(source: &str, has_login_marker: bool) -> bool

   /// Nombre de error saneado: solo [A-Za-z0-9_.], máx. 64 chars; vacío ⇒ None (sin PII ni mensajes).
   pub(crate) fn sanitize_error_name(name: Option<&str>) -> Option<String>

   /// Payload contrato 1.6, puro.
   pub(crate) fn session_lost_payload(source: &str, maity_user_id: Option<&str>,
       recording_was_active: bool, error_name: Option<&str>) -> serde_json::Value
   // json!({ "source", "maity_user_id", "recording_was_active", "error_name" })

   #[tauri::command]
   pub async fn telemetry_auth_session_lost<R: Runtime>(app: AppHandle<R>, source: String,
       error_name: Option<String>) -> Result<(), String>
   ```
   Cuerpo del comando, en este orden:
   1. `if !SESSION_LOST_SOURCES.contains(&source.as_str()) { log::warn!(...); return Ok(()); }`
   2. `let marker = crate::logging::telemetry::lifecycle::peek_last_login_user();`. Confirma la firma y el tipo en `lifecycle.rs` (L1, contrato 1.5: `{maity_user_id, since_ms}`).
   3. `if !should_emit_session_lost(&source, marker.is_some()) { log::info!(...); return Ok(()); }`
   4. `maity_user_id`:
      - para `webview_signed_out`: primero `AppState::current_user_id()` (Rust todavia lo tiene, porque `clear_current_user` corre despues); si falta, el de la marca.
      - para `boot_no_session`: el de la marca.
   5. `let phase = crate::audio::recording_phase::current_phase();` y `recording_was_active = phase.is_session_active()`.
   6. `let row = super::emit::emit_event_with_id(app, super::context::process_session_id(), super::catalog::AUTH_SESSION_LOST, payload, Some(TelemetryStatus::Warning), None, None).await;`
   7. `if row.is_some() { let _ = crate::logging::telemetry::lifecycle::take_last_login_user(); }`. La marca se consume SOLO si la fila quedo en el outbox. Sin sesion no hay flush: la fila espera a la siguiente siembra de sesion.
   8. `Ok(())`: nunca falla.
2. `frontend/src-tauri/src/lib.rs`: registra `logging::telemetry::auth::telemetry_auth_session_lost,` en `generate_handler!`, junto a `logout_cleanup,` (~L1604). Es un comando propio y no necesita capability.
3. `frontend/src-tauri/src/database/commands.rs`, `set_current_user` (L457-505): dentro de `if was_logged_out {` (L477, la transicion None -> Some) agrega:
   ```rust
   let already = crate::logging::telemetry::lifecycle::peek_last_login_user()
       .map(|u| u.maity_user_id == user_id)   // ajustar al tipo real que devuelve L1
       .unwrap_or(false);
   if !already { crate::logging::telemetry::lifecycle::set_last_login_user(&user_id); }
   ```
   La escritura va "solo si cambio", porque cada `set_last_login_user` escribe `lifecycle.json` a disco. `clear_current_user` NO toca la marca: una sesion perdida debe dejarla para que el siguiente arranque la detecte. El logout del usuario la borra en `logout_cleanup` (S3a).
4. Crea `frontend/src/lib/authSessionLost.ts`, logica pura:
   ```ts
   import { isAuthRetryableFetchError } from '@supabase/supabase-js'
   export type SessionLostSource = 'webview_signed_out' | 'boot_no_session'
   /** SIGNED_OUT sin sesión nueva y sin logout en curso ⇒ 'webview_signed_out'; cualquier otro caso ⇒ null. */
   export function signedOutSessionLostSource(event: string, hasNewSession: boolean, isSigningOut: boolean): 'webview_signed_out' | null
   /** Arranque sin sesión: reportar solo si no hay sesión, el error es null o NO reintentable, y online !== false. */
   export function shouldReportBootNoSession(hasSession: boolean, error: unknown, online: boolean | undefined): boolean
   /** error?.name si es string (p. ej. 'AuthApiError', 'AuthSessionMissingError'); si no, null. */
   export function authErrorName(error: unknown): string | null
   ```
   `isAuthRetryableFetchError` viene de `@supabase/supabase-js`, que re-exporta auth-js 2.93.3 (`errors.d.ts:206`).
5. Crea `frontend/src/lib/authSessionLost.test.ts` (vitest):
   - `signedOutSessionLostSource`:
     - `('SIGNED_OUT', false, false)` -> `'webview_signed_out'`
     - `('SIGNED_OUT', false, true)` -> `null` (logout propio)
     - `('SIGNED_OUT', true, false)` -> `null`
     - `('TOKEN_REFRESHED', false, false)` -> `null`
     - `('INITIAL_SESSION', false, false)` -> `null`
   - `shouldReportBootNoSession`:
     - `(true, null, true)` -> `false`
     - `(false, null, true)` -> `true`
     - `(false, null, undefined)` -> `true`
     - `(false, null, false)` -> `false` (offline)
     - `(false, new AuthRetryableFetchError('net', 0), true)` -> `false`
     - `(false, new AuthApiError('invalid', 400, 'refresh_token_not_found'), true)` -> `true`. Confirma el constructor de `AuthApiError` en `errors.d.ts` de auth-js 2.93.3. Si no se puede construir, usa `new AuthSessionMissingError()`.
   - `authErrorName`: `null` -> `null`; `{ name: 'AuthApiError' }` -> `'AuthApiError'`; `'x'` -> `null`.
6. `frontend/src/contexts/AuthContext.tsx`:
   - `import { signedOutSessionLostSource, shouldReportBootNoSession, authErrorName } from '@/lib/authSessionLost'`.
   - En `initialize()` (L409-432) cambia L412 por `const { data: { session: existingSession }, error: sessionError } = await supabase.auth.getSession()`. Despues del `if (existingSession && isMounted) { … }` agrega:
     ```ts
     const online = typeof navigator !== 'undefined' ? navigator.onLine : undefined
     if (isMounted && shouldReportBootNoSession(!!existingSession, sessionError, online)) {
       void invoke('telemetry_auth_session_lost', { source: 'boot_no_session', errorName: authErrorName(sessionError) })
         .catch((e) => logger.warn('[Auth] telemetry_auth_session_lost (boot) falló:', e))
     }
     ```
     Esto esta fuera del callback de `onAuthStateChange`, asi que no hay problema de lock. Rust decide con la marca: si no hay marca, no emite.
   - En el callback de `onAuthStateChange` (L446-487), despues del guard `if (isSigningOut.current) { … return }` y antes de `setSession(newSession)`:
     ```ts
     const lostSource = signedOutSessionLostSource(event, !!newSession, isSigningOut.current)
     if (lostSource) {
       setTimeout(() => {
         void invoke('telemetry_auth_session_lost', { source: lostSource, errorName: null })
           .catch((e) => logger.warn('[Auth] telemetry_auth_session_lost falló:', e))
       }, 0)
     }
     ```
     Sin `await` y sin `async` en el callback: la IPC se difiere a un macrotask. S5 extiende esta misma rama.
7. Corre los tests (cargo y vitest), `npm run test`, `npm run lint` y el build integrado.

Tests:
- `auth.rs` `mod tests`, casos nuevos:
  - `should_emit_session_lost`:
    - `("boot_no_session", false)` -> `false`
    - `("boot_no_session", true)` -> `true`
    - `("webview_signed_out", false)` -> `true`
    - `("native_refresh_rejected", true)` -> `false`
    - `("", true)` -> `false`
  - `sanitize_error_name`:
    - `None` -> `None`
    - `Some("")` -> `None`
    - `Some("AuthApiError")` se conserva
    - `Some("a b<c>")` pierde los caracteres fuera del conjunto
    - una cadena de 200 chars se trunca a 64
  - `session_lost_payload`: claves exactas `{source, maity_user_id, recording_was_active, error_name}`, con los `null` correctos.
- Nuevo `frontend/src/lib/authSessionLost.test.ts`, con los casos del paso 5.
- Comandos:
  - `cd /c/maity_desktop/frontend/src-tauri && cargo test --lib logging::telemetry::auth`
  - `cd /c/maity_desktop/frontend && npx vitest run src/lib/authSessionLost.test.ts`
  - `npm run test`
  - `npm run lint`
  - `npm run tauri:build:debug` (en background con log)

Importadores / consumidores conocidos:
- `set_current_user`: `database/commands.rs:457`, registrado en `lib.rs:1598`. Lo invoca el efecto de `AuthContext.tsx` (~L108, reescrito en S2).
- `clear_current_user`: `database/commands.rs:510`. No se toca.
- `CLOUD_SESSION_EXPIRED` (`AuthContext.tsx:584-586`) se queda como esta. El refresh nativo rechazado NO es `auth.session_lost`, porque supabase-js puede seguir vivo (decision del contrato: sin `native_refresh_rejected`).
- La marca la provee `lifecycle::{set,peek,take}_last_login_user` (L1). `take` tambien se llama en `logout_cleanup` (S3a).

Trampas:
- Claves del invoke en camelCase: `{ source, errorName }`. El parametro Rust `error_name` se mapea a `errorName`. Con `error_name` en el JS llega `None` sin error.
- El callback de `onAuthStateChange` sigue SINCRONO: nada de `await` ni `async`. El guard ESLint `no-restricted-syntax` (selector `…onAuthStateChange'] AwaitExpression`) lo rompe en `next build`. `.catch()` encadenado sin `await` si esta permitido.
- `shouldReportBootNoSession` NUNCA reporta con `isAuthRetryableFetchError(error)` ni con `navigator.onLine === false`. Un falso positivo cada mañana ademas consumiria la marca y taparia una perdida real posterior.
- La marca se toma SOLO si `emit_event_with_id` devolvio `Some`.
- `isSigningOut.current` ya hace `return` antes de este punto. Pasarlo a la funcion pura igual es a proposito: la regla queda explicita y probada.
- Los locks de tokio van con snapshot en un statement propio. Nada de `.lock().unwrap()`. Nunca `log::error!` en telemetria.
- La palabra que empieza con "shut" y termina con "down" no puede aparecer en ningun comando ni en el commit.

Resultado esperado:
- Si se revoca la sesion con la app abierta y se fuerza un refresh (`__pollDebug.forceTokenRefresh()`), aparece `auth.session_lost` con `source='webview_signed_out'` y la UI no se congela.
- Si se invalida la sesion con la app cerrada y se reabre con red, aparece `source='boot_no_session'`, con el `maity_user_id` correcto, en cuanto alguien vuelve a iniciar sesion.
- No se emite nada al reabrir despues de un logout limpio, ni al arrancar sin red.

Referencias:
- `docs/specs/telemetria-ciclo-vida-83/research/areas/spec-autostart-logout-T3-T4-B1.md` (seccion 5, "T4b")
- `docs/specs/telemetria-ciclo-vida-83/research/areas2/verify-autostart-logout-T3-T4-B1.md` (issues major "boot_no_session" y minor "native_refresh_rejected", "marker taken before emitting")

**Ajustes del líder tras la refutación del plan (mandan sobre lo anterior si chocan):**
1. `set_current_user` ya tiene (desde J1) la llamada a `cancel_session_end()` en el ramo None→Some: conservarla al agregar `lifecycle::set_last_login_user(id)` (poner la marca de login después de cancelar la retención).
2. `initialize()` ya desestructura `{ data, error }` desde S2 (`bootSessionUncertainRef`): reutilizar ese `error` para decidir `boot_no_session` (no emitir si es reintentable o si `navigator.onLine === false`).

### S5. Sesion perdida a media grabacion guarda antes de soltar

Objetivo: arreglar un bug nuevo (AC-20). Cuando la sesion se pierde en medio de una grabacion (refresh rechazado o sesion revocada), supabase-js emite SIGNED_OUT y el callback pone `setMaityUser(null)`. El efecto de liberacion (S2) llama entonces `clear_current_user` mientras la grabacion sigue corriendo. `clear_current_user` no detiene nada (`database/commands.rs:510-530`), y cuando el segmento se cierra ya no hay usuario: `scheduled_recording/service.rs:1291` ("sin usuario logueado; segmento queda local-only") devuelve `SegmentOutcome::Failed`. La correccion es un comando Rust `session_lost_cleanup` que detiene y guarda la grabacion (<=30 s) con el usuario todavia vivo; el efecto de liberacion espera ese promise antes de `clear_current_user`. Por J1, la funcion de stop pone la retencion SessionEnd como primera sentencia. Esa retencion impide que el scheduler rearranque la jornada en el hueco y se libera sola en cuanto no hay sesion (`evaluate_tick`); un re-login reanuda la jornada (AC-3).

Pasos:
1. `frontend/src-tauri/src/lib.rs`: junto a `logout_cleanup` (~L153-170; verifica la linea, S3a lo reescribio), agrega:
   ```rust
   /// Sesión perdida SIN logout del usuario (SIGNED_OUT espontáneo en el webview): detiene y
   /// GUARDA la grabación activa mientras `current_user_id` sigue vivo — el frontend espera este
   /// comando antes de `clear_current_user` (sin usuario el segmento termina Failed,
   /// scheduled_recording/service.rs). La función de stop pone la retención SessionEnd de J1, que
   /// `evaluate_tick` libera sola al no haber sesión; un re-login reanuda la jornada.
   /// Sin telemetría propia (la emite `telemetry_auth_session_lost`). Nunca falla.
   #[tauri::command]
   async fn session_lost_cleanup<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
       if tokio::time::timeout(Duration::from_secs(30), <funcion de stop>(&app)).await.is_err() {
           log::warn!("session_lost_cleanup: stop de grabación excedió 30s");
       }
       log::info!("session_lost_cleanup: grabación detenida/guardada antes de soltar al usuario");
       Ok(())
   }
   ```
   `<funcion de stop>` es la misma que usa `logout_cleanup` (`pub async fn graceful_…_before_exit`, `lib.rs:~1833`). Escribela con Edit copiando el nombre que ya aparece en `logout_cleanup`, nunca en un comando Bash. Registra `session_lost_cleanup,` en `generate_handler!`, justo despues de `logout_cleanup,` (~L1604).
2. `frontend/src/contexts/AuthContext.tsx`:
   - Agrega un ref junto a los demas: `const sessionLostCleanupRef = useRef<Promise<void> | null>(null)`.
   - En el callback de `onAuthStateChange`, dentro de la rama `if (lostSource) { … }` que agrego S4: el ref se asigna SINCRONICAMENTE con un promise que envuelve el `setTimeout`. Asi el efecto de liberacion, que corre despues del commit de `setMaityUser(null)`, ya lo ve, y la IPC sigue diferida a un macrotask. Sustituye el `setTimeout` de S4 por:
     ```ts
     sessionLostCleanupRef.current = new Promise<void>((resolve) => {
       setTimeout(() => {
         // Telemetría primero (captura recording_was_active ANTES del stop), luego guardar.
         invoke('telemetry_auth_session_lost', { source: lostSource, errorName: null })
           .catch((e) => logger.warn('[Auth] telemetry_auth_session_lost falló:', e))
           .then(() => invoke('session_lost_cleanup'))
           .catch((e) => logger.warn('[Auth] session_lost_cleanup falló:', e))
           .finally(() => resolve())
       }, 0)
     })
     ```
     Sin `await` ni `async` dentro del callback: son promesas encadenadas.
   - En el efecto de liberacion (S2; deps `[maityUser?.id, authReady]`) cambia la rama que libera, es decir la que corre cuando `shouldReleaseRustUser(...)` es `true`:
     ```ts
     const pending = sessionLostCleanupRef.current
     sessionLostCleanupRef.current = null
     void (async () => {
       if (pending) {
         logger.warn('[Auth] Sesión perdida: esperando a que Rust guarde la grabación antes de soltar al usuario')
         await pending.catch(() => {})
         // Carrera: si el usuario volvió a entrar mientras se guardaba, NO soltarlo.
         if (lastSyncedUserIdRef.current) return
       }
       invoke('clear_current_user').catch(...)        // igual que en S2
       invoke('cloud_sync_clear_session').catch(...)  // igual que en S2
     })()
     ```
     La rama `nextId` (`set_current_user`) no cambia. `lastSyncedUserIdRef` es el ref que agrego S2, y el efecto lo actualiza en cada corrida: si hubo re-login durante la espera, ya vale el id nuevo. Se usa `logger.warn` porque en `@/lib/logger` `info` y `debug` solo escriben en dev (L5-7), y este evento debe verse en release.
3. No toques `signOut`. El logout del usuario ya pasa por `logout_cleanup` (con el mismo stop) antes de limpiar, y `isSigningOut` impide que su SIGNED_OUT entre en la rama espontanea.
4. Corre `npm run test`, `npm run lint` y el build integrado.

Tests:
- No hay test unitario nuevo. `session_lost_cleanup` es un envoltorio de E/S sobre la funcion de stop, que ya tiene la cobertura de J1/E2a, y la orquestacion del efecto depende de React y de Tauri. La logica pura que la gobierna ya esta probada:
  - `shouldReleaseRustUser` en `authRelease.test.ts` (S2)
  - `signedOutSessionLostSource` en `authSessionLost.test.ts` (S4)
  Ambos tests deben seguir verdes.
- Comprobacion manual (AC-20): con una jornada o una grabacion manual en curso, revoca la sesion en Supabase Auth y fuerza un refresh (`await window.__pollDebug.forceTokenRefresh()`). En el log deben aparecer, en este orden:
  1. `telemetry_auth_session_lost`
  2. "Segmento de jornada cerrado y guardado antes de salir" (o el stop manual)
  3. `session_lost_cleanup: grabación detenida…`
  4. `[AppState] current_user_id cleared`
  La conversacion aparece al volver a iniciar sesion, y la jornada reanuda en <=30 s tras el re-login si sigue en horario.
- Comandos:
  - `cd /c/maity_desktop/frontend && npx vitest run src/lib/authRelease.test.ts`
  - `npx vitest run src/lib/authSessionLost.test.ts`
  - `npm run test`
  - `npm run lint`
  - `npm run tauri:build:debug` (en background con log)

Importadores / consumidores conocidos:
- Funcion de stop: `lib.rs:~1833`. Tambien la usan `logout_cleanup`, el cierre de la app (L2/E2b) y `rival_install` (J1).
- `close_owned_segment_for_exit`: `scheduled_recording/service.rs`, llamada desde la funcion de stop.
- `evaluate_tick` libera la retencion SessionEnd cuando `!has_session` (J1). `has_session` esta en `state.rs:33` y lee `current_user_id`.
- `clear_current_user`: `database/commands.rs:510`.
- El efecto de liberacion y los refs vienen de S2/S4 en `AuthContext.tsx`.

Trampas:
- El callback de `onAuthStateChange` sigue SINCRONO: nada de `await` ni `async`. El guard ESLint `no-restricted-syntax` falla en `next build`. Crear el `Promise` y encadenar `.then/.catch/.finally` si esta permitido.
- Asigna el ref ANTES de `setMaityUser(null)`, que ocurre al final del callback (L485). Si lo asignas dentro del `setTimeout`, el efecto puede correr antes y liberar sin esperar, y vuelve el bug.
- El orden telemetria -> cleanup es a proposito: `auth.session_lost` lee `recording_was_active` y el `maity_user_id` de AppState ANTES del stop y de `clear_current_user`.
- Tras la espera, re-chequea `lastSyncedUserIdRef.current` antes de `clear_current_user`. Si no, un re-login rapido dentro de los <=30 s del stop quedaria borrado.
- `Duration` es `std::time::Duration` (usa lo que ya use `logout_cleanup`). Nada de `.lock().unwrap()`.
- Guard de shell: el nombre de la funcion de stop contiene la palabra que empieza con "shut" y termina con "down". Solo con Edit, nunca en un comando Bash ni en el commit.
- Sin eventos Tauri nuevos: es un comando.

Resultado esperado:
- Una sesion perdida a media grabacion ya no deja el segmento `Failed` ni audio huerfano: la grabacion se detiene y se guarda en SQLite con su usuario.
- Rust suelta al usuario solo despues de guardar.
- Tras volver a iniciar sesion la jornada sigue sin esperar al dia siguiente, porque la retencion SessionEnd no escribe rearme de dia.

Referencias:
- `docs/specs/telemetria-ciclo-vida-83/research/areas/spec-autostart-logout-T3-T4-B1.md` (seccion 2, "B1b")
- `docs/specs/telemetria-ciclo-vida-83/research/areas2/verify-autostart-logout-T3-T4-B1.md` (issue major B1b: por que NO va dentro de `clear_current_user` ni por el rearme de dia)
- Contrato §3.1 (J1: retencion SessionEnd) y §7.6

**Ajustes del líder tras la refutación del plan (mandan sobre lo anterior si chocan):**
1. Tras `session_lost_cleanup`, el `clear_current_user` del efecto libera la retención SessionEnd (J1, ajuste 2); si un re-login ganó la carrera durante el guardado, `set_current_user` también la libera. Verificar ambos órdenes en el narrativo de pruebas manuales.

## Parte Z - Docs finales

### Z1. Reglas en CLAUDE.md y TELEMETRIA reconciliada con el codigo

Objetivo: cerrar AC-23 (y re-comprobar AC-1). Es la ÚLTIMA tarea de la spec, y solo toca documentación. `docs/TELEMETRIA.md` lo escribió A1 como contrato ANTES del código, así que ahora hay que reconciliarlo con lo que A2..S5 implementaron de verdad: cada nombre, campo, valor de dominio, archivo y comando que el doc menciona tiene que existir en el código. Además hay que dejar en `CLAUDE.md` bullets BREVES que apunten al doc de cada área (CLAUDE.md se carga en cada sesión, así que nada de párrafos largos). No se toca código, así que esta tarea no lleva AC-21 ni build.

Archivos permitidos: SOLO `CLAUDE.md` (raíz del repo) y `docs/TELEMETRIA.md`. Los demás docs (`ONBOARDING_Y_GATES.md`, `REGLAS_AUDIO_GRABACION.md`, `CANALES_DISTRIBUCION.md`, `NUBE_CUENTAS_SYNC.md`) los escribieron J2/J4, E2b, U1 y S1. Aquí solo se LEEN para citar su sección exacta.

Pasos:

1. Línea base. Corre `cd /c/maity_desktop/frontend && node scripts/lint-telemetry.js`. Tiene que decir `[lint-telemetry] OK: catálogo espejo (36 eventos, 12 legacy)…` (28 de antes + los 8 de #83). Si falla, casi siempre es la regla (f): algún nombre de `catalog.rs` no aparece entre backticks en TELEMETRIA.md. Arréglalo en el doc. El código no se toca.

2. Inventario del código real, antes de editar. Usa Grep (no Bash) para confirmar cada punto y anota `archivo:línea`:
   a. Las 8 constantes, en `frontend/src-tauri/src/logging/telemetry/catalog.rs` y en `frontend/src/lib/telemetry-events.ts`: `APP_START` `app.start`, `APP_EXIT` `app.exit`, `APP_RESUMED` `app.resumed`, `AUTOSTART_CHANGED` `autostart.changed`, `AUTH_LOGOUT` `auth.logout`, `AUTH_SESSION_LOST` `auth.session_lost`, `JORNADA_SETTINGS_CHANGED` `jornada.settings_changed`, `JORNADA_IDLE_REASON_CHANGED` `jornada.idle_reason_changed`.
   b. Emisor real y claves del payload de cada evento. Grep de la constante (`catalog::APP_START`, etc.) y del `json!` que la acompaña:
      - `app.start`, `app.exit`, `app.resumed`: `frontend/src-tauri/src/logging/telemetry/lifecycle.rs`. Las claves están en el contrato §1.6: `lifecycle_schema`, `build`, `build_channel`, `started_at_boot`, `autostart_state`, `prev_session_id`, `prev_version`, `prev_version_source`, `prev_exit_reason`, `prev_exit_detail`, `prev_exit_source`, `prev_exit_clean`, `prev_exit_interrupted`, `prev_panicked`, `prev_panic_count`, `os_rebooted_since_prev`, `downtime_s`, `clock_skew`, `marker_status`, …; para `app.exit`: `reason`, `detail`, `exit_code`, `uptime_s`, `recording_active`, `recording_phase`, `session_end_kind`, `critical`.
      - Motivos de salida (§1.7). Grep de cada string en `lifecycle.rs` y `frontend/src-tauri/src/session_end.rs`: `tray_quit`, `rival_install`, `update` (detail `store_button|store_api|nsis`), `restart`, `app_exit`, `last_window_closed`, `os_session_end` (detail `logoff|shutdown|unknown`), `external_close`, `loop_destroyed`, `process_exit_after_cleanup`, y los inferidos `crash_panic`, `os_restart_unclean`, `unclean`.
      - Marcador: nombres `lifecycle.json` / `lifecycle-debug.json`, en `app_local_data_dir`, y los campos `exit`, `exit_intent`, `last_resume`, `last_autostart_state`, `last_login_user`.
      - `autostart.changed`: `frontend/src-tauri/src/autostart_state.rs` (`reconcile`). Claves `from`, `to`, `trigger` (`boot|settings_toggle|bootstrap`), `mechanism` (`startup_task|run_key|plugin`), `disabled_at`. Los comandos son `autostart_get_state` y `autostart_reconcile`.
      - `auth.logout` / `auth.session_lost`: `frontend/src-tauri/src/logging/telemetry/auth.rs`, con `logout_cleanup(app, surface)` y el comando `telemetry_auth_session_lost` en `frontend/src-tauri/src/lib.rs`. Claves: `reason`, `surface` (`settings|sidebar|chat_sidebar|onboarding_badge|account_error|unknown`), `maity_user_id`, `recording_was_active`, `recording_phase` / `source` (`webview_signed_out|boot_no_session`), `error_name`. El status de `auth.logout` es `ok` y el de `session_lost` es `warning`.
      - `jornada.settings_changed`: `ScheduledRecordingService::update_settings` en `frontend/src-tauri/src/scheduled_recording/service.rs`, más `JornadaConfig` y `changed_fields`. Estos viven en `status_snapshot.rs` o en `settings.rs`, así que Grep `fn changed_fields` y `struct JornadaConfig`.
      - `jornada.idle_reason_changed`: el emisor está en `service.rs`, y `IDLE_REASONS` / `fn idle_reason` / `fn heartbeat_fields` están en `frontend/src-tauri/src/scheduled_recording/status_snapshot.rs`. Copia los 16 valores EXACTOS de `IDLE_REASONS`.
   c. `health.heartbeat`. Mira `HealthSnapshot` en `frontend/src-tauri/src/logging/commands.rs` (hoy `pub struct HealthSnapshot` en :329; la línea se habrá movido), `emit_native_heartbeat` en `frontend/src-tauri/src/logging/mem_sampler.rs` y el payload JS en `frontend/src/services/healthHeartbeatService.ts`. `idle_reason` va en el nivel superior del payload y `jornada` es un objeto anidado con las claves `enabled`, `configured_by_user`, `loop_running`, `scheduler_phase`, `in_window`, `skip`, `rearm_cause`, `rearm_until`, `backoff{code,consecutive,halted_for_day}` y `settings_load`.
   d. `device.profile`. Revisa `DeviceProfile` en `logging/commands.rs` (hoy :400) y el tipo TS en `healthHeartbeatService.ts`: `jornada`, `autostart_state` (ahora con `disabledByUser` en el canal directo), `autostart_disabled_at`, `autostart_mechanism`, `package_installed_at` y `package_installed_at_source` (`package|nsis_uninstall_key`). Los structs NO llevan `rename_all` (hoy son snake_case). Si algún implementador agregó `#[serde(rename…)]`, en el doc va la clave SERIALIZADA.
   e. Drenado (A2). En `frontend/src-tauri/src/logging/telemetry/drain.rs` están `flush_row`, `FlushOutcome`, `set_exiting` y el marcado por fila. `token_if_fresh` está en `frontend/src-tauri/src/cloud_sync/session.rs`.
   f. Comandos citados en el doc: `direct_update_install` (`frontend/src-tauri/src/direct_update.rs`), `exit_for_update` (lifecycle.rs), `session_lost_cleanup` y `logout_cleanup` (lib.rs). La persistencia de la jornada es `scheduled_recording_runtime.json` (`frontend/src-tauri/src/scheduled_recording/runtime_state.rs`).
   Si el código NO coincide con el contrato (otro nombre, otra clave, otro dominio), el doc sigue al CÓDIGO. La divergencia se reporta en el mensaje final de la tarea como "divergencia contrato→código: …". Z1 no corrige código.

3. `docs/TELEMETRIA.md`, reconciliación. A1 la reescribió, así que las líneas se movieron: localiza cada sección con Grep.
   a. Cabecera `> Última actualización:`. Pon la fecha real de hoy (sustituye cualquier `2026-09-XX`) y deja "0.2.62, issue #83".
   b. Quita las marcas de "pendiente" que puso A1 cuando el código no existía: Grep en el doc `pendiente`, `por implementar`, `se implementa`, `se implementará`, `(contrato)`, `TODO`, `XX`, `<` seguido de un marcador de relleno. Reescríbelas en presente ("desde 0.2.62 …"). NO quites los usos legítimos de "contrato" que ya existían: "Contrato `ctx`", "El doc es contrato ejecutable", `docs/platform-logs-status.sql` como "contrato".
   c. Tabla de los 8 eventos (bloque "Ciclo de vida del proceso, sesión y jornada"). Emisor, cuándo, claves y status tienen que ser los del paso 2. Donde A1 citó `archivo:línea` que ya se movió (por ejemplo `service.rs:345`), cambia a `archivo::función`, que no se desfasa.
   d. Menciona `autostart_toggled`. Ya existe: es el passthrough `Analytics.track` desde `frontend/src/components/settings/PreferenceSettings.tsx`; hoy está en :160 (MSIX) y :173 (directo), pero P2 y S3b movieron el archivo, así que re-Grep. Pon una nota junto a la fila de `autostart.changed`: `autostart_toggled` solo registra toggles hechos DENTRO de la app, va por JS directo y queda fuera del catálogo; `autostart.changed` compara el estado REAL contra la línea base del marcador, así que también ve el Administrador de tareas y el bootstrap.
   e. Párrafo "Pipeline (dos writers, y solo dos)" (hoy ~L37-55). Hoy dice que `app.*` va por JS directo. Corrígelo: `app.open`/`app.close`/`app.error` van por JS; `app.start`/`app.exit`/`app.resumed` van por el outbox nativo. El drenado ya no marca "solo al final del lote": desde A2 marca cada fila tras su 2xx, `flush_row(id, budget)` sube una fila concreta con `token_if_fresh` (sin refresh) y `set_exiting()` apaga el loop en la salida.
   f. Bloque jsonc de `health.heartbeat` y tabla `idle_reason`: tienen que coincidir con el paso 2c y con `IDLE_REASONS` (16 valores, mismo orden de precedencia que `fn idle_reason`). Confirma que la excepción de cardinalidad (hoy "**Cardinalidad (`device.profile` vs heartbeat):**", ~L386) menciona `jornada` como estado dinámico.
   g. Fila `device.profile`: "Desde 0.2.60" para `autostart_state` (no 0.2.59), más los campos de 0.2.62 del paso 2d.
   h. Queries ("¿Por qué no grabó? — persona × día hábil", `app.start`, `app.exit`): revisa que cada ruta JSON use las claves reales. Por ejemplo, `event_data->>'idle_reason'` va en el nivel superior del latido, NO dentro de `jornada`; `surface`, no `source`, para `auth.logout`; `trigger`, no `source`, para `autostart.changed`; `prev_exit_reason`/`prev_exit_clean`/`prev_exit_source`. Si cambias SQL, sigue siendo solo SELECT; no hace falta re-ejecutarla si el cambio es solo de nombres que ya validó A1.
   i. "Lo que NO existe todavía" debe decir que la desinstalación se infiere (no existe un evento). "Resueltos en el ciclo 0.2.62 (#83)" va en presente y cita los arreglos reales: logout del chat, update NSIS, día cerrado / turno nocturno, supresión persistida, fin de sesión acotado, recarga que no suelta al usuario, sesión perdida que guarda, "Evaluar ahora", recuperación que no borra audio.
   j. Vuelve a correr `node scripts/lint-telemetry.js`: OK con 36 eventos.

4. `CLAUDE.md`, bullets breves (1-2 líneas cada uno, en español, con puntero al doc). Primero haz Grep en cada doc de área para sacar el título REAL de su sección (contrato: J4 "Supresión de la jornada persistida (0.2.62)" en `docs/ONBOARDING_Y_GATES.md`; E2b "Fin de sesión de Windows con grabación activa" en `docs/REGLAS_AUDIO_GRABACION.md`; U1, la sección del updater NSIS en `docs/CANALES_DISTRIBUCION.md`; S1, "todo logout pasa por AuthContext.signOut" en `docs/NUBE_CUENTAS_SYNC.md`) y cítalo como `docs/X.md` § <título real>. Los anclajes de abajo son de hoy; re-Grep antes de editar:
   a. Bajo `**Reglas de canales (detalle en `docs/CANALES_DISTRIBUCION.md`):**` (hoy L48-52), agrega un bullet: el updater NSIS va SOLO por el comando `direct_update_install` (`direct_update.rs`). El plugin sale con `std::process::exit(0)` sin `RunEvent::Exit`. El comando se niega si hay grabación o post-proceso, y cierra la DB y el sidecar en el hook solo después de `extract`. La ACL queda en `updater:allow-check` y el guard es `updaterInstall.fitness.test.ts`. La Store sale para actualizar por `exit_for_update`.
   b. En `### Gates, sesión y onboarding` (hoy L217-224), agrega un bullet después de "Back-off del arranque de jornada" (hoy L221). El rearme lleva causa (`UserStop|AutoClose|SessionEnd`). Toda ruta de salida, logout o apagado marca `session_ending` (`begin_session_end`) ANTES de detener y NUNCA escribe supresión de día. Solo `UserStop`/`AutoClose` persisten (`scheduled_recording_runtime.json`, único escritor `set_rearm`). Tras el cierre automático el skip es `closed_for_day` y dura hasta el siguiente inicio de ventana, así que el turno nocturno no pierde las horas antes de medianoche. "Evaluar ahora" usa `reset_immediately`. Puntero a ONBOARDING_Y_GATES.
   c. En `### Cuentas, nube y análisis` (hoy L235-244), agrega un bullet: TODO logout (Ajustes, Sidebar, sidebar del chat) pasa por `AuthContext.signOut(surface)` y nunca por `supabase.auth.signOut()` directo (B1; guard `contexts/authSignOut.fitness.test.ts`). Recargar el webview NO suelta al usuario en Rust (`lib/authRelease.ts::shouldReleaseRustUser`). Una sesión perdida a media grabación espera `session_lost_cleanup` antes de `clear_current_user`. Puntero a NUBE_CUENTAS_SYNC.
   d. En el blockquote `> **Reglas obligatorias del área**` de audio (hoy ~L165), agrega AL FINAL una cláusula corta: en fin de sesión de Windows (`WM_ENDSESSION`) la salida va acotada a menos de 5 s (`session_end.rs` + `flush_recording_for_session_end`: sin merge, finalize ni emits, y un chunk fallido se renombra, no se borra). No reintroducir ahí el graceful de 30 s. Puntero a REGLAS_AUDIO_GRABACION.
   e. En `## Telemetria y diagnostico remoto` (hoy L305-311), agrega UN párrafo corto: "**¿Por qué no grabó? (#83, desde 0.2.62):**" con `app.start` (causa del cierre anterior), `app.exit` (motivo), `app.resumed`, `autostart.changed`, `auth.logout`/`auth.session_lost` y `jornada.settings_changed`/`jornada.idle_reason_changed`, todos por el outbox; `idle_reason` + bloque `jornada` en `health.heartbeat`; y el marcador síncrono `lifecycle.json` (`logging/telemetry/lifecycle.rs`), que es la verdad del ciclo de vida (la fila es best-effort). Debe decir explícitamente que `app.close` NO es la salida del proceso (es la ventana que se va a la bandeja) y que la desinstalación se infiere. Cierra con el puntero a la query persona × día en `docs/TELEMETRIA.md`.
   Presupuesto: como mucho unas 10 líneas netas nuevas en CLAUDE.md. No reescribas bullets existentes salvo para agregar una cláusula.

5. Comprobación final: vuelve a correr el lint (paso 3j). Para cada sección citada en el paso 4, anota en el mensaje final `docs/X.md:línea` (es la evidencia de AC-23), junto con las divergencias contrato→código que encontraste.

Tests:
- No se agregan tests: la tarea es solo de documentación.
- `cd /c/maity_desktop/frontend && node scripts/lint-telemetry.js`: `[lint-telemetry] OK` con 36 eventos y 12 legacy.
- No hace falta `npm run tauri:build:debug`: no cambia código ni configuración. El pre-build solo lee TELEMETRIA.md a través de lint-telemetry, que ya corre arriba.

Importadores / consumidores conocidos:
- `frontend/scripts/lint-telemetry.js:38` lee `docs/TELEMETRIA.md`; la regla (f) está en :218-223 (solo va catálogo→doc).
- `frontend/scripts/run-pre-build-checks.js:199` cita TELEMETRIA.md en un mensaje de error.
- `frontend/scripts/run-pre-build-checks.js:242` y `:264`, `frontend/scripts/lint-cargo-workspace.js:153` y `frontend/scripts/lint-cargo-deps.js:128` citan las secciones de CLAUDE.md "Plataformas y GPU" y "Dependencias Rust: una sola pila TLS" por su nombre.
- `frontend/src/components/settings/PreferenceSettings.tsx:160,173`: `autostart_toggled` (líneas de hoy; P2/S3b las movieron).

Trampas:
- No renombres ni muevas encabezados existentes de CLAUDE.md: los scripts de build los citan por nombre (ver consumidores). Tampoco toques la línea de `/piloto-analisis` (L46): la copia de la skill está fuera del alcance de la spec.
- La palabra que empieza con "shut" y termina con "down" NO puede ir en ningún comando Bash ni en el mensaje de commit (el guard los bloquea). Para buscar `graceful_…_before_exit` usa Grep/Read, y en el texto escribe "apagado"/"fin de sesión". Dentro del contenido del doc SÍ puedes escribir nombres de funciones que la contengan, pero con Edit, nunca por Bash.
- Nada de `python -c`/`node -e`. Edita con Edit, no con sed.
- El doc sigue al CÓDIGO, no al informe T5 (`areas/spec-docs-sql-T5.md`): sus nombres están VIEJOS (`closed_for_today`, `os_shutdown`, `update_restart`, `rival_uninstall`, `source` en `auth.logout`, status `success`, `idle_reason` dentro de `jornada`). Ninguno de esos puede quedar en TELEMETRIA.md salvo que el código lo use.
- `prev_version` nunca es `'unknown'` (la regla (d) del lint escanea TS y `logging/telemetry`; el doc no, pero debe decir `null`).
- La columna `status` es un dominio cerrado (`success|error|timeout|skipped|ok|partial|warning`): documenta solo esos valores.
- No edites los otros docs de reglas aunque les falte algo. Si una sección que CLAUDE.md debe citar no existe, apunta al doc sin `§`, pon en el mensaje final "falta sección X en docs/Y.md (tarea Z)" y sigue.
- CLAUDE.md se carga en cada sesión: frases cortas, sin cifras de prod ni historia (eso va en los docs).
- No hagas `git push`. El commit lleva el mensaje exacto del plan.

Resultado esperado: `node scripts/lint-telemetry.js` da OK con 36 eventos. TELEMETRIA.md no tiene marcas de "pendiente/por implementar" y cada evento, clave, valor de dominio, comando y archivo que menciona existe en el código con ese mismo nombre. Menciona `autostart_toggled` frente a `autostart.changed` y describe el drenado por fila. CLAUDE.md tiene 5 adiciones breves (canales/updater, jornada, logout/recarga, fin de sesión en audio, #83 en telemetría), cada una con puntero a la sección real de su doc.

Referencias:
- Contrato: `docs/specs/telemetria-ciclo-vida-83/contract.md` §1 (nombres y esquemas) y §2.1 (qué escribió A1 en TELEMETRIA.md).
- Informe de docs: `docs/specs/telemetria-ciclo-vida-83/research/areas/spec-docs-sql-T5.md` §2 (propuesta original de bullets para CLAUDE.md; usar la redacción, NO sus nombres de campos).
- `docs/specs/telemetria-ciclo-vida-83/spec.md` (AC-23, sección "Qué NO hacer").

**Ajustes del líder tras la refutación del plan (mandan sobre lo anterior si chocan):**
1. AC-24 (matriz E2E manual de `verify.md` manual[1]/[2]) queda referenciada por esta tarea: el narrativo final de Z1 debe listar la matriz como pendiente de Julio (no la ejecuta ningún agente).

## Verificación

Ver `verify.md`. Cada tarea corre sus `suites` o `verify`; después, 2 refutadores independientes (0 si `risk: low`) intentan demostrar que no cumple sus `criteria`. Una sola corrección por tarea.

## Commit

Un commit por tarea con el mensaje de `commit` (dos si `tdd: true`: `test:` y luego el de la tarea). **Sin `git push`** — lo hace Julio.
