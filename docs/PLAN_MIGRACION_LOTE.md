# Plan: Migración a transcripción por lote (sep-2026)

> **Estado de avance** (actualizar al cerrar cada fase):
>
> | Fase | Estado | Commit |
> |---|---|---|
> | F0 — Prerrequisitos (#22 pressure_level, integridad de checkpoints, medición F0c) | ✅ cerrada | `095abb5` |
> | F1 — Núcleo `batch_transcriber` + comando dev | ✅ cerrada | `5f40647` |
> | F2 — Cola persistente + planificador híbrido | ✅ cerrada | `1768725` |
> | F3 — Cablear disparadores (default sigue streaming) | ✅ cerrada | `4c38d37` |
> | F4 — Frontend | pendiente | — |
> | F5 — Coach por heurísticos de audio | pendiente | — |
> | F6 — Flip del default a lote | pendiente | — |
>
> Pendientes transversales: medición física F0c (pico de Parakeet en máquina de
> 5-6 GB → calibra `BATCH_HEADROOM_MB`); WER sobre AAC 64k con
> `batch_transcribe_folder` (precondición del flip).

## Contexto

La auditoría de recursos (`docs/AUDITORIA_RECURSOS_2026-09-02.md` § "Alternativa: transcribir la jornada por lote") identificó que el streaming en vivo mantiene Parakeet residente ~650 MB durante 9 horas de jornada, más VAD Silero, sidecar Gemma y el panel en vivo — ~1 GB de RSS en tier Low. En modo lote, la grabación solo captura checkpoints AAC de 30s (~80 MB residentes) y la transcripción se concentra en 3-25 min por hora al cerrar cada segmento.

**Decisiones de producto ya tomadas (no re-litigar):**
1. **Todo por lote** (manual y jornada); el pipeline streaming SE CONSERVA como modo alternativo, no se borra.
2. **Default**: lote para todos; el toggle a streaming solo visible para admins (rol vía RPC `public.get_user_role`, fail-closed).
3. **Momento híbrido**: al cerrar el segmento SI hay memoria/CPU libre (política #22); si no, se difiere (reintento / drenaje a fin de jornada / siguiente arranque).
4. **Proveedor del lote**: siempre Parakeet local. Deepgram (WebSocket) queda ligado a streaming.
5. **Coach en lote**: solo heurísticos de AUDIO (nuevo rastreador de actividad por canal → monólogo y proporción de habla). Tips LLM, WPM y preguntas mueren en lote; el sidecar Gemma no arranca. Hoy TODOS los heurísticos se calculan desde transcript (`coach/live_feedback.rs`) — hay que reescribir esos dos sobre audio.
6. **Fase 0 obligatoria**: fiabilidad de checkpoints + medición del pico de Parakeet + #22 `pressure_level()`.

**Arquitectura clave del diseño:** el batch transcriber escribe el mismo `transcripts.json` (`{"segments":[...],"total_segments":N}`) que hoy consume `finalize_segment_native` — así el conteo de palabras (MIN_SEGMENT_WORDS=250), Saved/Discarded/Failed, SQLite y sync_queue se reusan sin tocar. La cola de lotes pendientes es una tabla SQLite (patrón outbox como `sync_queue`) con filas creadas al ARRANCAR el segmento → recuperación post-crash desde Rust.

---

## Fase 0 — Prerrequisitos ✅ (`095abb5`)

### 0a. Fiabilidad y telemetría de checkpoints
- `IncrementalAudioSaver::finalize()` devuelve `FinalizeReport {checkpoint_count, missing, encode_errors, merged_bytes, merged_duration_est_secs}`; `stop_and_save` emite `audio.checkpoint_integrity` SOLO en cierres anómalos (`is_anomalous()`: missing>0 || encode_errors>0 || merge <100 KB con ≥4 checkpoints — la firma de las carpetas de 8 KB/h).

### 0b. #22 — `pressure_level()` con histéresis (`logging/mem_sampler.rs`)
- `PressureLevel {Normal, Elevated, Critical}` en `AtomicU8`; subir exige presión sostenida (misma racha que el incidente #61); Critical inmediato con RSS crítico o avail < mitad del umbral; bajar exige recuperación sostenida 60 s con margen de 300 MB; Critical sin recuperar decae a Elevated.
- API: `pressure_level()`, `last_sys_avail_mb()` (F2 sumó `last_cpu_pct()`).
- Consumidores: warmup del sidecar (skip con Elevated+), tips LLM del coach (tick cedido), `idle_unload` (descarga sin esperar 10 min).

### 0c. Medición del pico de carga de Parakeet
- Procedimiento documentado en la auditoría (§ Mediciones pendientes): máquina de 5-6 GB, ciclo login→logout×5 leyendo `[METRIC] mem-sample` con etiquetas stt-warm/stt-unload. **Gate de F2/F6**: calibra `BATCH_HEADROOM_MB`. ⚠️ La medición física sigue pendiente.

---

## Fase 1 — Núcleo `batch_transcriber` ✅ (`5f40647`)

Módulo `frontend/src-tauri/src/audio/transcription/batch/`:

1. **`decoder.rs`** — un ffmpeg POR canal (filtro `pan`, no `-map_channel` que fue retirado en ffmpeg 7+) → f32le mono 16 kHz en un paso; ventanas de 60 s; stderr drenado en paralelo; `kill_on_drop`; `CREATE_NO_WINDOW`; `decode_args()` pura con golden test. Convención: L=mic="user", R=sistema="interlocutor".
2. **`energy_gate.rs`** — RMS por bloque de 100 ms con umbral adaptativo (piso de ruido con fuga), pre-pad 200 ms, hangover 500 ms, fusión de huecos <800 ms; pre-filtro `dc_remove`+`high_pass_80hz` con estado persistente. Sin Silero.
3. **`chunker.rs`** — regiones largas → chunks de 10-30 s cortando en el bloque de menor energía cercano a 20 s.
4. **`transcriber.rs`** — `ensure_stt_warm_parakeet` (forzado a Parakeet) + `snapshot_now("batch-load"/"batch-done")`; **inferencia por chunk en `spawn_blocking`** (avance del #16); mismo post-procesado que el worker (anti-hallucination + enhance); timestamps reconstruidos; métricas RTF.
5. **`writer.rs`** — mismo `transcripts.json` vía serialización compartida (`recording_saver::write_transcripts_atomic`); `sequence_id` monotónico intercalando canales.
6. **Comando dev `batch_transcribe_folder(folderPath)`** — escribe `transcripts.batch.json` AL LADO del streaming (no lo pisa); instrumento para WER sobre AAC 64k y RTF.

**Lease del STT**: `BatchSttLease` (RAII, contador en `engine.rs`); `unload_stt` rehúsa con lease vivo (`RefusedBatchLease`, bajo `STT_WARM_LOCK`); `idle_unload` ni lo intenta (ni bajo `Critical`).

---

## Fase 2 — Cola persistente + planificador híbrido ✅

- **Migración ADITIVA** `20260909000000_add_batch_transcription_queue.sql`: `folder_path UNIQUE`, `meeting_local_id`, `segment_started_at`, `trigger_kind (manual|rotation|auto_close|crash_recovery)`, `status (recording|pending|processing|done|discarded|failed)`, `attempts`, `last_error`, `user_id`. Filas terminales se CONSERVAN (regla #26).
- **`database/repositories/batch_queue.rs`**: upsert idempotente por carpeta, claim-mutex, fail con reintentos (5) / fail_permanent, reset_processing, crash_recovery. Tests in-memory.
- **`batch/planner.rs`**: tarea propia (delay 120 s); `notify_enqueued()` + tick 5 min + `request_drain()`; **gate híbrido puro**: `pressure==Normal && avail > headroom (1800 frío / 400 warm) && CPU <80%`; streaming activo SIEMPRE difiere; drain solo se detiene con `Critical`; diferir no quema attempts; single-flight; al vaciar → `unload_stt("batch_done")`. Recuperación al arranque (processing→pending; huérfanos→merge checkpoints→crash_recovery; carpeta desaparecida→failed; backlog→drain).
- **`engine.rs::unload_allowed(phase, recording_uses_stt)`** + señal `ACTIVE_RECORDING_USES_STT` (default true=streaming; F3 la setea).
- **Telemetría**: `stt.batch_job` (por job terminal) y `stt.batch_deferred` (latch por episodio) — 3 entradas cada una.

---

## Fase 3 — Cablear disparadores (Rust; default sigue streaming) ✅

- **`RecordingPreferences.transcription_mode`** con `#[serde(default)]` → `"streaming"` (flip en F6); `is_batch_mode()` único punto de decisión. Lote sin `auto_save` cae a streaming (sin checkpoints no hay qué transcribir).
- **Arranque**: en lote NO se valida el motor STT, el pipeline no construye Silero (`AudioPipeline` con VAD `Option`; STEP 2 de grabación intacto), sin worker ni transcript-listener; `uses_stt=false`; la fila de la cola nace con la grabación (trigger `manual`/`rotation` según origen — el origen decide la política de descarte). `idle_unload` sin prewarm en lote.
- **Stop (embudo común)**: restaura `uses_stt=true`, `mark_pending` + notify + `batch-transcription-status {pending}`.
- **Scheduler**: rotate/close en lote no llaman finalize (emiten sus eventos con `batch:true`); el cierre de jornada pide `request_drain()`. `finalize_segment_native` es `pub(crate)` con flag `enforce_min_words` — el planner lo invoca al terminar cada job (jornada con umbral, manual sin). `mark_crash_recovery` CONSERVA el trigger de origen (marca en `last_error`).
- **Evento gemelo** `batch-transcription-status` (`pending → processing → ready(meetingId) | discarded | failed`).
- **Decisiones tomadas al implementar** (difieren del plan original): (1) el payload de `RECORDING_STOP_COMPLETE` sigue siendo el booleano histórico — extenderlo a objeto rompería al `RecordingPostProcessingProvider` actual; el meetingId del lote viaja por `batch-transcription-status {ready}`. (2) El **placeholder de `meetings` + columna `transcription_status` se movieron a F4**: sin UI que lo explique, una reunión vacía en la lista local-first parecería rota; en F4 llegan juntos badge + placeholder. La reunión del lote se crea al completar el job (`save_transcript` vía finalize).

**Verificación F3 pendiente de humo manual** (con preferencia forzada a `batch`): (a) manual 3 min → lote → transcripts → sync jobs; (b) jornada simulada con rotación; (c) streaming intacto.

---

## Fase 4 — Frontend

- **Setting**: select de modo DENTRO de `components/recording/RecordingSettings.tsx`; visible solo con `isAdmin && roleKnown` (fail-closed, patrón `forceParakeet` de `ConfigContext.tsx`).
- **Estados**: lista de conversaciones y `meeting-details` pintan badge "Transcribiendo…/Pendiente/Descartada" desde `transcription_status`; refresco por listener de `batch-transcription-status` (patrón `CLOUD_SYNC_STATUS_CHANGED`).
- **`hooks/useRecordingStop.ts`**: rama por `transcriptionMode` del payload — en lote NO llama `storageService.saveMeeting` (Rust es el dueño), limpia sessionStorage, marca IndexedDB `savedToSQLite=true`, navega con el `meetingId` del payload.
- **`contexts/TranscriptContext.tsx`**: registro WAL de IndexedDB con campo `transcriptionMode:'batch'`; la vista en vivo muestra "Transcribiendo al finalizar".
- **Protección recovery** `hooks/useTranscriptRecovery.ts`: el filtro de fantasmas (`transcriptCount===0`) excluye registros `transcriptionMode==='batch'` — el dueño de la recuperación en lote es el drainer Rust. Test nuevo.

---

## Fase 5 — Coach por heurísticos de audio (paralelizable con F4)

- **Nuevo `audio/voice_activity.rs`**: rastreador por canal donde mic/system aún viajan separados en `pipeline.rs` (antes del mix) — RMS 100 ms con hangover (variante incremental del energy_gate de F1). Publica atómicos: `user_voiced_ms`, `interlocutor_voiced_ms`, `current_user_mono_ms`, `session_ms`. Solo activo en modo lote.
- **`coach/live_feedback.rs`**: en lote `start()` no registra listener de `TRANSCRIPT_UPDATE` ni toma lease del sidecar; `should_use_llm_tips()` (punto de decisión único) devuelve `false` en lote. El nudge loop alimenta SOLO dos nudges: monólogo y proporción de habla (por tiempo con voz, no por turnos). `coach-metrics` emite subset con flag `mode:'audio'` para que `LiveFeedbackPanel` oculte gauges sin datos.
- **Saltar la descarga de Gemma en modo lote** (cierra #29 de verdad): el kickoff de descarga del modelo de tips (mismo lugar único que ya respeta tier Low — `WelcomeStep`/`BackgroundDownloadStarter`) añade la condición `transcription_mode === 'batch'`; los consumidores ya miran `summaryModelReady`. Si un admin cambia a streaming, la descarga arranca entonces.

---

## Fase 6 — Flip del default

- `default_transcription_mode()` → `"batch"`; Rust impone lote a non-admin aunque el JSON diga streaming (espejo de `forceParakeet`); admins conservan elección.
- **Precondiciones del flip**: WER sobre AAC 64k aceptable (medición F1), pico de carga < headroom en tier Low confirmado (F0c), una jornada piloto interna con `stt.batch_job` limpia.
- Actualizar `docs/TRANSCRIPTION_PIPELINE.md` y `docs/REGLAS_AUDIO_GRABACION.md`; marcar hallazgos cerrados en el artifact de la auditoría.

---

## Riesgos

1. **WER sobre AAC 64k**: medir antes del flip; si degrada, subir bitrate es 1 constante en `encode_args` (compatible con `-c copy`).
2. **Pico ~1.3 GB/hora en máquinas de 5 GB**: gate de headroom + drain a fin de jornada + `Critical` nunca transcribe; peor caso todo se difiere al siguiente arranque, nunca se pierde.
3. **`Failed` sin fallback del webview**: fila `failed` con audio intacto en disco + reintentos en arranque + telemetría.
4. **Doble guardado** (lote + `saveMeeting` legacy): la rama por `transcriptionMode` en `useRecordingStop` + test de regresión.
5. **Version skew Store/NSIS**: ambas migraciones aditivas; `transcription_status NULL` = comportamiento viejo.

## Orden de entrega

F0 → F1 → F2 → F3 → F4 → F5 → F6. Cada fase compila y embarca sola con streaming como default hasta F6. Build obligatorio por fase: `cd frontend && pnpm run tauri:build:debug` exit 0. Tras cada fase: actualizar este doc (tabla de estado) y los docs del área tocada.

## Issues de la auditoría después de la migración completa

Cierra o deja sin consumidor: #22 (directo), #13, #04, #29 (con el skip de descarga de F5), #30 — los cuatro últimos siguen vivos solo en el modo streaming de admins. Se encogen: #06, #09, #12, #15, #16 (el lote ya nace con `spawn_blocking`), #19. No cambian: #28, #31.
