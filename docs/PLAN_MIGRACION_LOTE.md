# Plan: Migración a transcripción por lote (sep-2026)

> **Estado de avance** (actualizar al cerrar cada fase):
>
> | Fase | Estado | Commit |
> |---|---|---|
> | F0 — Prerrequisitos (#22 pressure_level, integridad de checkpoints, medición F0c) | ✅ cerrada | `095abb5` |
> | F1 — Núcleo `batch_transcriber` + comando dev | ✅ cerrada | `5f40647` |
> | F2 — Cola persistente + planificador híbrido | ✅ cerrada | `1768725` |
> | F3 — Cablear disparadores (default sigue streaming) | ✅ cerrada | `4c38d37` |
> | F4 — Frontend | ✅ cerrada | `9119753` |
> | F5 — Coach por heurísticos de audio | ✅ cerrada | `9119753` |
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
- **Arranque**: en lote NO se valida el motor STT, el pipeline no construye Silero (`AudioPipeline` con VAD `Option`; STEP 2 de grabación intacto), sin worker ni transcript-listener; `uses_stt=false`; la fila de la cola nace con la grabación (trigger `manual`/`rotation` según origen — el origen decide la política de descarte). `idle_unload` sin prewarm en lote. **Desde el 2026-09-10 tampoco hay precarga al login/registro/descarga** (`ensure_stt_warm` → `WarmOutcome::SkippedBatch` cuando `effective_mode()` es lote; el piloto 0.2.59 cargó Parakeet al login y tuvo ~700 MB residentes sin consumidor hasta que la presión forzó el unload). `ensure_stt_warm_parakeet` (el del planner) no se gatea.
- **Stop (embudo común)**: `mark_pending` + notify + `batch-transcription-status {pending}`. **NO restaura `uses_stt`** (2026-09-10): el flag lo SELLA el start para ambos modos (`set_active_recording_uses_stt(!batch_mode)` al resolver el modo, `recording_helpers.rs`); restaurarlo a `true` con la fase aún en `Stopping` hacía que `gate()` viera `streaming_active` y difiriera cada segmento al tick de 5 min (5/5 rotaciones del piloto 0.2.59: stop 17:00:17 → job 17:05:17). En `Idle` nadie lo consulta (`unload_allowed` corta por fase; el gate exige grabación activa).
- **Scheduler**: rotate/close en lote no llaman finalize (emiten sus eventos con `batch:true`); el cierre de jornada pide `request_drain()`. `finalize_segment_native` es `pub(crate)` con flag `enforce_min_words` — el planner lo invoca al terminar cada job (jornada con umbral, manual sin). `mark_crash_recovery` CONSERVA el trigger de origen (marca en `last_error`).
- **Evento gemelo** `batch-transcription-status` (`pending → processing → ready(meetingId) | discarded | failed`).
- **Decisiones tomadas al implementar** (difieren del plan original): (1) el payload de `RECORDING_STOP_COMPLETE` sigue siendo el booleano histórico — extenderlo a objeto rompería al `RecordingPostProcessingProvider` actual; el meetingId del lote viaja por `batch-transcription-status {ready}`. (2) El **placeholder de `meetings` + columna `transcription_status` se movieron a F4**: sin UI que lo explique, una reunión vacía en la lista local-first parecería rota; en F4 llegan juntos badge + placeholder. La reunión del lote se crea al completar el job (`save_transcript` vía finalize). *(F4 acabó descartando la columna y el placeholder: el bloque de pendientes lee la cola directamente — ver sus decisiones.)*

**Verificación F3 pendiente de humo manual** (con preferencia forzada a `batch`): (a) manual 3 min → lote → transcripts → sync jobs; (b) jornada simulada con rotación; (c) streaming intacto.

---

## Fase 4 — Frontend ✅ `9119753`

Detalle del contrato Rust↔TS en `docs/TRANSCRIPTION_PIPELINE.md` § "Frontend del lote (F4)".

- **Setting**: select "Modo de transcripción" DENTRO de `components/recording/RecordingSettings.tsx` (único escritor vía `savePreferences`: `set_recording_preferences` reemplaza el objeto ENTERO); visible solo con `isAdmin && roleKnown` (fail-closed, patrón `forceParakeet`). Hint "Aplica a la siguiente grabación" y aviso ámbar si `!auto_save && batch` (sin checkpoints no hay qué transcribir: cae a streaming). Al guardar: `resetTranscriptionModeCache()` + `refreshSummaryModelRequired()`; si vuelve a streaming, `startBackgroundDownloads(true)` (F5).
- **Bloque "Transcripciones pendientes"** (`features/conversations/components/PendingTranscriptionsBlock.tsx`, montado en `ConversationsList` entre el header y el loading): `useQuery(['batch-queue-active', maityUser.id])` sobre `batch_queue_list_active`, refetch 15 s mientras haya filas no terminales; filas con nombre, fecha, origen (Manual / Jornada / Recuperada por `last_error==='crash_recovery'`) y estado (`pending` → "Pendiente de transcribir" + "reintento N" si `attempts>0`; `processing` → "Transcribiendo…"; `failed` → "No se pudo transcribir" + Reintentar → `batch_queue_retry`). Servicio `features/conversations/services/batchQueue.service.ts`.
- **`hooks/useRecordingStop.ts`**: rama por `sessionStorage.last_recording_transcription_mode` — en lote NO llama `saveMeeting`, ni `has_audio_checkpoints`/`recover_audio_from_checkpoints`, ni `enqueueCloudSync` (Rust es el dueño): `markMeetingAsSaved()`, limpia las keys de sesión, deja `batch_pending_navigation = folderPath`, toast "Grabación guardada — se transcribirá al terminar" y soft `router.push('/conversations')`. Test `useRecordingStop.batch.test.tsx` (lote sin/con transcripts → nada de save/recover/sync; streaming intacto).
- **`contexts/RecordingPostProcessingProvider.tsx`**: puentea `batch-transcription-status` al bus DOM `batch-transcription-status-changed`; en `ready` con `trigger==='manual'` y `batch_pending_navigation === folderPath` navega al detalle (`?localId=…&source=recording`) si seguimos en `/conversations` sin detalle abierto, si no toast "Transcripción lista → Ver" + notificación nativa; `failed` → toast con "Abrir carpeta". Jornada: silenciosa (la lista se invalida por el bus). Los payloads de rotate/close del scheduler llevan `batch?: boolean` → marca el registro guardado igual que con `meetingId`.
- **`contexts/TranscriptContext.tsx`**: el registro WAL de IndexedDB lleva `transcriptionMode` leído de `get_recording_state`; `TranscriptPanel` muestra "Transcribiendo al finalizar la grabación" en lugar de la vista en vivo.
- **`hooks/useTranscriptRecovery.ts`**: los registros `transcriptionMode==='batch'` se BORRAN como fantasmas (decisión 3 abajo). Tests nuevos.

**Decisiones tomadas al implementar (difieren del plan original):**
1. **Sin columna `transcription_status` ni placeholder en `meetings`.** La cola `batch_transcription_queue` ya guarda `folder_path, trigger_kind, status, attempts, last_error, segment_started_at` y conserva filas terminales; una columna obligaría a que `save_transcript` hiciera UPDATE, cambiaría la semántica de `localId` y sumaría superficie de version-skew. En su lugar, el bloque de pendientes se alimenta desde la cola con dos comandos nuevos: `batch_queue_list_active` (pending|processing|failed del usuario, `ORDER BY id DESC LIMIT 50`; **excluye `recording`**: una fila stale de un crash se vería como "Grabando" hasta la pasada de recovery) y `batch_queue_retry(folderPath)` (`failed→pending`, `attempts=0`, `last_error=NULL`, + `notify_enqueued`; no toca pending/processing).
2. **El modo llega al frontend por dos vías Rust aditivas**, no por `recording-stop-complete` (booleano emitido desde 5 sitios; `useRecordingStop` no puede ramificar por él): `recording-stopped` gana `transcription_mode` y `get_recording_state` gana `transcription_mode` (el `RecordingStateProvider` ya hace poll cada 500 ms y sync al montar → cubre arranque y recarga del webview a mitad de grabación sin tocar `live_feedback::start`, que es zona de F5).
3. **Registros IndexedDB en lote = fantasmas SIEMPRE** (`transcriptCount===0 || transcriptionMode==='batch'` → se borran), al revés de lo que decía este plan. Excluirlos del filtro los empujaba a `recentMeetings` → `has_audio_checkpoints` → diálogo de recuperación → `recoverMeeting` falla con "No transcripts found". El dueño de la recuperación en lote es el planner (`crash_recovery`).
4. **Navegación keyed por carpeta**, no por un `meetingId` del payload de stop (no existe hasta `ready`, F3): `sessionStorage.batch_pending_navigation = folderPath` + campo aditivo `trigger` en `emit_status` (solo para textos y para decidir si se navega). **Soft `router.push`**, no `window.location.href`: en lote no hay STT/sidecar que "envenene" el estado y el provider debe seguir vivo para recibir `processing/ready`.
5. La key `last_recording_transcription_mode` se sobrescribe **incondicionalmente** en cada `recording-stopped` (`payload.transcription_mode ?? 'streaming'`): una key `batch` rancia haría que un stop streaming saltara `saveMeeting` = pérdida de datos.
6. Sin eventos Tauri nuevos ni telemetría nueva (el lint exige literales del catálogo; no se añade `recordingLogService.log` en la rama de lote). Los comandos custom no necesitan entrada en capabilities (`lint-tauri-acl.js` solo cruza APIs de window/dialog/app).

---

**Ajustes tras la refutación adversarial (2026-09-09, misma noche):**
- **El stop ya no decide lote/streaming leyendo `sessionStorage`**: `useRecordingStop` crea un *deferred* por sesión en `recording-started`, lo resuelve en `recording-stopped` con `{folderPath, transcriptionMode}` y `handleRecordingStop` ramifica por ese valor (race de `RECORDING_STOPPED_WAIT_MS`=3 s; sin evento fresco ⇒ streaming, comportamiento histórico). La key `last_recording_transcription_mode` queda solo como espejo de diagnóstico y se limpia también en la rotación. **Invariante Rust→TS: todo arranque de sesión (manual, scheduler, rotación) DEBE emitir `recording-started`.**
- **El flag `batch` de `scheduled-segment-rotated`/`scheduled-jornada-closed` refleja el modo SELLADO de la sesión** (`recording_lifecycle::active_session_transcription_mode()`, leído ANTES de parar), no la preferencia viva: con lote+`auto_save=false` o un cambio de modo a mitad de jornada, el segmento que grabó en streaming se finaliza como siempre. `service.rs::batch_transcription_mode()` desapareció; política pura `segment_is_batch(sealed, prefs_effective)` con tests.
- Fechas del bloque de pendientes: `segment_started_at` es hora LOCAL naive (así lo escribe `recording_helpers.rs`) y `updated_at` es UTC (`datetime('now')`); `parseSqliteTs` los trata distinto. El poll del bloque no se apaga con lista vacía (60 s con sesión; 15 s con filas activas) por la carrera con `set_current_user`.
- `RecordingSettings` no escribe `set_recording_preferences` hasta que la carga haya tenido éxito (el objeto se reemplaza entero: un guardado con estado incompleto resetearía `transcription_mode` al default del build).

## Fase 5 — Coach por heurísticos de audio ✅ `9119753`

Detalle de reglas en `docs/COACH_LLM_ARCHITECTURE.md` § Apéndice "En modo LOTE el coach es por audio".

- **Nuevo `audio/voice_activity.rs`**: `VoiceActivityTracker` alimentado en `pipeline.rs` donde mic/sistema aún viajan separados (antes del mix; la pausa congela), construido SOLO en modo lote. Compuerta por canal: bloques de 100 ms (4800 muestras @48 kHz), `dc_remove`+`high_pass_80hz`, RMS×gain, piso de ruido con fuga, umbral `(nf*3).max(0.006)`, hangover 500 ms. Máquina de monólogo: la racha del usuario la rompe voz CONTINUA del interlocutor ≥ `INTERRUPT_MS`=1500 ms (una tos de 300 ms no) o silencio propio ≥ `USER_PAUSE_END_MS`=3000 ms. Atómicos (`VoiceActivityStats`): `user_voiced_ms`, `interlocutor_voiced_ms`, `current_user_mono_ms`, `longest_user_mono_ms`, `user_mono_runs`, `session_ms`. El canal sistema multiplica su RMS por `system_audio_gain` (la R del stereo ya es sistema×gain) para conservar los umbrales validados en F1.
- **`coach/audio_heuristics.rs`** (puro): `AudioSnapshot::from_voice` (`is_monologue`, `health_score`, `user_talk_ratio`), `AudioTipState`, `evaluate_audio_tips` → dos tips: monólogo (`>60 s` `audio_monologue_long`; `>150 s` crítico `audio_monologue_critical`) y dominancia (`>70 %` con interlocutor presente, sesión ≥120 s, voz total ≥60 s, cada 5 min; suprimida en modo ponente, el monólogo no).
- **`coach/mod.rs`**: `CoachMode {Transcript, Audio}`, `CoachSource {Transcript, Audio(Arc<VoiceActivityStats>)}` con `from_recording(&RecordingState)` (`RecordingState::transcription_mode` sellado en `initialize_recording`); `should_use_llm_tips(mode)`: `Audio → false` incondicional, `Transcript → tier != Low`.
- **`coach/live_feedback.rs`**: `start(app, CoachSource)`; en audio no se toma lease del sidecar, no se registra listener de `TRANSCRIPT_UPDATE` ni se spawnea el nudge loop; `meeting-metrics` lleva `mode:"audio"` + `voiced` (pct por ms de voz, turnos 0) → `useMeetingMetrics` deriva `isWaitingForAudio` de `!voiced`. `session_summary` suma `coach_mode, user_voiced_ms, interlocutor_voiced_ms, longest_user_mono_ms, audio_session_ms` (spread de `useCoachMetricsTelemetry`, sin catálogo).
- **Warmup del sidecar (`lib.rs`)**: lee `load_recording_preferences` y se omite en lote ("Sidecar warmup omitido — modo audio"). Timeouts/breaker/lease intactos.
- **Saltar la descarga de Gemma en modo lote** (cierra #29 de verdad para ese modo): `lib/transcriptionMode.ts` (espejo de `deviceTier.ts`: single-flight, cachea solo éxito, fail-closed a `streaming`; `batch` solo si `auto_save !== false`, espejo de `is_batch_mode()`) + helper único `summaryModelNeeded() = needsSummaryModel() && !isBatchTranscriptionMode()` en `OnboardingContext` (kickoff y `summaryModelRequired`). Si un admin vuelve a streaming, `RecordingSettings` relanza la descarga.

**Decisiones tomadas al implementar (difieren del plan original):**
1. **Los dos tips por audio viven en el loop heurístico de 3 s** (`evaluate_health_tips` → `audio_heuristic_tick`), NO en el nudge loop de 15 s: todo `evaluate_nudge` devuelve `tip: None` (= petición al LLM), así que en audio ese loop y el listener de `TRANSCRIPT_UPDATE` no se spawnean. Sin doble disparo por construcción; `evaluate_nudge`/`ConversationSnapshot` no se tocan.
2. **Gating por racha / 5 min en vez de Jaccard**: con 2-3 textos fijos, `is_duplicate_tip` (últimos 5) avisaría una sola vez por sesión. En audio: una vez por racha de monólogo (`user_mono_runs` del tracker) y dominancia cada 5 min; `can_emit` (caps/cooldowns) se respeta igual.
3. **`should_use_llm_tips(CoachMode)`** sigue siendo el punto único, con el modo como entrada; los dos callers lo calculan por su cuenta: el warmup con `load_recording_preferences(app).await` (`Err` → Transcript), el coach desde `RecordingState` (verdad sellada por sesión: cambiar el modo a mitad de grabación solo aplica a la siguiente).
4. **`summaryModelNeeded()` pliega el modo lote** en los dos sitios: saltar solo el kickoff dejaba `summaryModelReady=false` y el widget/`BackgroundDownloadStarter` reclamaban la descarga en cada arranque; había que tocar también `summaryModelRequired`.
5. **`coach-float/page.tsx` no cambia**: solo pinta `health`, `userTalkPct`, `interlocutorTalkPct`, `sessionSecs`, `isWaitingForAudio` (`userTurns` no se renderiza) y el label ya dice "Tiempo de palabra". El flag de modo va en `meeting-metrics` (lo que alimenta los gauges), no en `coach-metrics` (solo telemetría).

**Riesgos F5 (documentados, no resueltos):** eco por altavoces sin audífonos infla `user_voiced_ms` (la detección de monólogo sí rompe bien porque el canal sistema tiene voz); mic muy bajo (<0.006 RMS) nunca es "voiced" → "Esperando audio" (log info en el primer bloque con voz por canal para diagnosticar); `INTERRUPT_MS` se calibra con `longest_user_mono_ms` de la telemetría del piloto interno; cambios de modo a mitad de sesión solo aplican a la siguiente grabación.

---

**Ajustes tras la refutación adversarial (2026-09-09, misma noche):**
- `voice_activity.rs`: el piso de ruido sigue la **ley del gate de F1** (`noise_floor = rms.min(nf·1.002).clamp(1e-5, 0.1)` en TODOS los bloques, init 0.01, umbral `(nf·3).max(0.006)`) — la variante que solo aprendía en bloques sin voz dejaba un canal con ruido estable >0.006 en "siempre voz" (monólogo falso a los 61 s). Caveat heredado de F1: una señal de nivel CONSTANTE sin micro-pausas deja de contar como voz cuando el piso la alcanza (~43 s a amp 0.1); la voz real tiene huecos.
- Latch del interlocutor con decaimiento: `SYS_STALL_MS`=1000 — si el canal sistema deja de entregar bloques (dispositivo perdido), el "floor" se suelta y el monólogo puede volver a abrirse.
- Los tips por audio usan el **reloj de audio del mic** (`session_ms/1000`, a prueba de pausa/suspend) como `session_secs`; `MeetingMetrics.session_secs` y `can_emit` siguen con reloj de pared.
- `start_live_coach` es **fail-closed**: sin manager o lock envenenado NO arranca el coach (antes caía a Transcript = lease + listener).
- `USER_PAUSE_END_MS`=3000 se mide tras el hangover de 500 ms: silencio real efectivo 3.5 s (test de frontera).
- Aceptado sin cambio: el warmup del sidecar lee el modo una vez por arranque; un cambio a lote a mitad de sesión deja Gemma residente hasta el idle-kill.

## Fase 6 — Flip del default

- `default_transcription_mode()` → `"batch"`; Rust impone lote a non-admin aunque el JSON diga streaming (espejo de `forceParakeet`); admins conservan elección.
- **Precondiciones del flip**: WER sobre AAC 64k aceptable (medición F1), pico de carga < headroom en tier Low confirmado (F0c), una jornada piloto interna con `stt.batch_job` limpia.
- **Build PILOTO sin flip (sep-2026)**: compilar con `MAITY_PILOT_BATCH=1` hace que `recording_preferences::default_transcription_mode()` devuelva `"batch"` (solo el DEFAULT: una preferencia ya persistida manda; `build.rs` declara `rerun-if-env-changed`; el arranque loguea "Default de transcripción: batch (build piloto…)"). Así el MSIX de prueba de Poncho (0.2.59, 2026-09-10) graba en lote desde el primer arranque con cualquier cuenta, mientras el build de la Store y el de GitHub siguen en `streaming` hasta este flip. **Nunca compilar el paquete de la Store con la variable puesta** (ver `.claude/skills/store-msix/SKILL.md` § 3).
- Actualizar `docs/TRANSCRIPTION_PIPELINE.md` y `docs/REGLAS_AUDIO_GRABACION.md`; marcar hallazgos cerrados en el artifact de la auditoría.

---

## Riesgos

1. **WER sobre AAC 64k**: medir antes del flip; si degrada, subir bitrate es 1 constante en `encode_args` (compatible con `-c copy`).
2. **Pico ~1.3 GB/hora en máquinas de 5 GB**: gate de headroom + drain a fin de jornada + `Critical` nunca transcribe; peor caso todo se difiere al siguiente arranque, nunca se pierde.
3. **`Failed` sin fallback del webview**: fila `failed` con audio intacto en disco + reintentos en arranque + telemetría.
4. **Doble guardado** (lote + `saveMeeting` legacy): la rama por `transcriptionMode` en `useRecordingStop` + test de regresión.
5. **Version skew Store/NSIS**: una sola migración aditiva (la cola, F2); F4 no añadió columna a `meetings` (una versión vieja simplemente no muestra el bloque de pendientes). Los campos nuevos de los payloads (`transcription_mode`, `trigger`, `batch`) son opcionales en TS.

## Orden de entrega

F0 → F1 → F2 → F3 → F4 → F5 → F6. Cada fase compila y embarca sola con streaming como default hasta F6. Build obligatorio por fase: `cd frontend && pnpm run tauri:build:debug` exit 0. Tras cada fase: actualizar este doc (tabla de estado) y los docs del área tocada.

## Issues de la auditoría después de la migración completa

Cierra o deja sin consumidor: #22 (directo), #13, #04, #29 (con el skip de descarga de F5), #30 — los cuatro últimos siguen vivos solo en el modo streaming de admins. Se encogen: #06, #09, #12, #15, #16 (el lote ya nace con `spawn_blocking`), #19. No cambian: #28, #31.
