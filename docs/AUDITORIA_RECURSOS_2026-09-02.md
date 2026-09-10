# Auditoría de recursos — Maity Desktop (2026-09-02)

Dónde se va la RAM, la CPU, el disco y la red en las cuatro situaciones que importan: la jornada
grabando en segundo plano, la app en reposo en la bandeja, el cierre de cada segmento y el arranque.

- **Telemetría**: 1,380 latidos con memoria, 30 días, 23 usuarios (`maity.platform_logs`).
- **Hardware**: 20 perfiles, **11 en tier Low** (5–7 GB, iGPU).
- **Código**: 5 auditorías por área sobre `main@6fe10eb`; los hallazgos marcados *verificado* llevan la
  línea citada revisada a mano, no solo el reporte del auditor.
- **Versión en campo**: 0.2.57 (Store).

**Checklist vivo**: artifact [Huella de recursos de Maity](https://claude.ai/code/artifact/3f618734-11a8-4d9d-998c-22db7e994bd2).
El estado de cada hallazgo **no vive en este archivo**, vive en la base de datos del artifact. Este
documento es el contenido (inmutable, es una foto del 2026-09-02); el estado es lo único que cambia.

Leer el estado desde Claude Code:

```
Artifact action:read_db url:<la de arriba> db_op:list collection:hallazgos
```

Marcar un hallazgo como cerrado al landear su fix:

```
Artifact action:write_db url:<la de arriba> db_op:set collection:hallazgos doc_id:"13"
        data:{"done":true,"at":"2026-09-XX","commit":"<sha>","note":"<qué se hizo>"}
```

**Ausencia de documento = pendiente.** Por eso la colección no se siembra con los 35: contiene
exactamente lo cerrado. La tabla de abajo es una foto del estado; la verdad es la colección.

> Regla al portar esto: **no se reescriben los números ni las conclusiones.** Es un registro fechado. Si
> algo se descubre falso después, se anota como corrección con su fecha (igual que se hizo con el
> MSIX/AppData en `CLAUDE.md`).

---

## Estado (foto del 2026-09-02)

`L` = efecto si la jornada dejara de transcribir en tiempo real y pasara a lote
(ver [Alternativa: transcribir por lote](#alternativa-transcribir-la-jornada-por-lote)):
**✗** desaparece · **↓** se encoge · **=** no cambia.

| # | Hallazgo | Sev | Recursos | Etapa | Esf | L | Estado |
|---|---|---|---|---|---|---|---|
| 01 | VAD de Silero guarda cada muestra de silencio | Crítico | RAM | Jornada | S | ✗ | **cerrado** `a62c4ef` |
| 02 | Parakeet se carga al arrancar y nunca se descarga | Crítico | RAM | Idle/Arranque/Jornada | M | ↓ | **cerrado** `252ed41` |
| 03 | Idle-kill del sidecar coincide con el cooldown del breaker | Alto | RAM/CPU/Disco | Jornada | S | ✗ | **cerrado** `167df50` |
| 04 | Warmup del sidecar carga Gemma antes del login | Medio | RAM/CPU/Disco | Arranque/Idle | S | ✗ | abierto |
| 05 | Lista de conversaciones con `select(*)` sin límite | Alto | RAM/Red/CPU | Post/Idle/Jornada | M | = | **cerrado** `1571eda` |
| 06 | Ocultar a la bandeja no pausa nada de la main | Alto | RAM/CPU | Jornada/Idle | M | ↓ | abierto |
| 07 | Coach-float re-renderiza a 10 Hz tras un blur de 22 px | Alto | CPU/RAM | Jornada/Idle | S | = | **cerrado** `477bfa0` |
| 08 | El encoder de checkpoints copia 11.5 MB dos veces | Medio | RAM/CPU | Jornada/Post | S | = | **cerrado** `5584e3e` |
| 09 | Tres canales sin límite en la ruta de grabación | Medio | RAM | Jornada | S | ↓ | abierto |
| 10 | `AudioMetricsBatcher` acumula resúmenes que nadie lee | Bajo | RAM/CPU | Jornada | S | = | **cerrado** `4144eaa` |
| 11 | El normalizador EBU R128 guarda historial ilimitado | Bajo | RAM | Jornada | S | = | **cerrado** `4144eaa` |
| 12 | El VAD usa 4 hilos intra-op por sesión, dos sesiones | Alto | CPU | Jornada | M | ↓ | abierto |
| 13 | Tormenta de `snapshot_now` con backlog múltiplo de 30 | Alto | CPU | Jornada | S | ✗ | abierto |
| 14 | El muestreador de memoria refresca más de lo que lee | Medio | CPU | Jornada/Idle/Arranque | S | = | **cerrado** `0506582` |
| 15 | Sondeos del frontend por IPC que no hacen falta | Medio | CPU | Jornada/Idle | S | ↓ | abierto |
| 16 | La inferencia de Parakeet corre en un hilo de tokio | Medio | CPU | Jornada | M | ↓ | abierto |
| 17 | El monitor re-enumera endpoints WASAPI cada 5 s | Bajo | CPU | Jornada | S | = | **cerrado** `475e071` |
| 18 | El concat final de ffmpeg corre síncrono en una `async fn` | Bajo | CPU | Post | S | = | **cerrado** `475e071` |
| 19 | ONNX Runtime escribe a INFO: 35-64 % del log | Medio | Disco/CPU | Jornada/Arranque | S | ↓ | abierto |
| 20 | `reqwest::Client` se construye por request en ~20 sitios | Bajo | CPU/Red | Post/Jornada | S | = | **cerrado** `9b6879c` |
| 21 | `System::new_all()` para un procesador que nadie invoca | Bajo | RAM/CPU | Arranque | S | = | **cerrado** `37c6e7c` |
| 22 | La presión de memoria se observa pero no se actúa | Alto | RAM | Jornada/Post | M | = | abierto |
| 23 | Las ventanas auxiliares cargan el grafo del layout raíz | Bajo | RAM/CPU | Arranque/Jornada | M | = | **cerrado** `0528562` |
| 24 | Bundle de arranque de 2.1 MB con librerías pesadas | Bajo | RAM/CPU/Disco | Arranque | M | = | **cerrado** `03c7040` |
| 25 | El logging diagnóstico escribe por IPC en cada poll | Bajo | Disco/CPU | Post | S | = | **cerrado** `3793da7` |
| 26 | `sync_queue` nunca se poda | Bajo | Disco | Post | S | = | **cerrado** `a783644` |
| 27 | Audio AAC 192 kbps y ningún borrado: 0.7 GB/día | Medio | Disco | Jornada/Post | S | = | **cerrado** `f52472d` |
| 28 | Pool de SQLite sin ajustar | Bajo | RAM/Disco | Post | S | = | abierto |
| 29 | Gemma 1B se descarga sin consumidor | Bajo | Disco/Red | Arranque | S | ✗ | abierto |
| 30 | El helper crea un `LlamaContext` por request | Bajo | CPU/RAM | Jornada | M | ✗ | abierto |
| 31 | El workspace ignora el `[profile.release]` y el `[patch]` de cpal | Medio | CPU/Disco | Arranque | S | = | **cerrado** `6f46f9f` |
| 32 | En Windows ffmpeg se descarga en runtime | Alto | Disco/Red/RAM | Jornada/Post | M | = | **cerrado** `6b906a6` |
| 33 | DirectML y D3D12 son imports de carga del exe | Bajo | RAM/CPU | Arranque | S | = | **cerrado** `06c6da6` |
| 34 | Los segmentos descartados dejan su carpeta huérfana | Medio | Disco | Post | S | = | **cerrado** `f52472d` |
| 35 | Dos pilas HTTP/TLS, crates duplicados y deps muertas | Bajo | Disco/CPU | Arranque | S | = | **cerrado** `a3a0881` |

**16 abiertos de 35** (al 09-sep-2026); los 2 críticos (#01, #02) ya están cerrados.

---

## Lo que dicen los datos

La mitad del parque real vive con 5 a 7 GB y una GPU integrada. En esas máquinas Maity ocupa alrededor
de 1 GB en cuanto graba por primera vez, **y ya no lo suelta**. El sistema pasa la jornada por debajo de
1 GB libre.

| Métrica (tier Low) | Valor | Nota |
|---|---|---|
| Proceso Rust al grabar (p50) | **652 MB** | Arranca en 46 MB. En reposo **después** de grabar sigue en 650 MB. |
| WebView2 al grabar (p50, 8 procesos) | **483 MB** | ~90 MB por ventana: 6 procs 301 MB · 7 procs 392 MB · 9 procs 585 MB. |
| Latidos con <1 GB libre (grabando) | **89 %** | 173 de 195. Mediana de memoria disponible 653 MB; p10 315 MB. |
| Sidecar LLM en 0.2.57 | **1,018 MB** | Pico p50 en 40 de 62 sesiones, para **2 tips generados**. El apagado en tier Low ya está en main. |

### Composición de la RSS en tier Low, por estado (medianas, MB)

| Estado | Rust | WebView2 | Sidecar | Total |
|---|---:|---:|---:|---:|
| Arranque / login (antes de grabar) | 46 | 298 | 0 | 344 |
| Idle **después** de grabar | 650 | 347 | 0 | 997 |
| Grabando, main sin publicar | 652 | 347 | 0 | 999 |
| Grabando, 0.2.57 en campo | 652 | 347 | 1,018 | 2,017 |

### Disco y red por jornada de 8 horas

| Concepto | Por jornada | Nota |
|---|---:|---|
| `audio.mp4` (AAC 192 kbps estéreo) | 691 MB | 86 MB/h; **nunca se borra**: ~14 GB al mes. |
| Checkpoints `.checkpoints/` | +130 MB | Transitorio por segmento de 90 min; se borra tras el merge. |
| SQLite (transcripts + `sync_queue` ×2) | ~3 MB | Los payloads de jobs completados no se podan. |
| Logs rotativos | 0.25–0.85 MB | Hasta 1.4 MB/h grabando; 7 archivos diarios. |
| Red total | 3.5–4 MB | Solo texto e ids; **el audio nunca sale**. +3.6 MB por conversación mientras se analiza. |
| Primera vez: modelos | 0.67–1.7 GB | Parakeet 670 MB; Gemma 1B 1,019 MB fuera de tier Low. |
| Primera vez: ffmpeg (canal NSIS) | 287 MB | Descarga de ~100 MB en runtime; tres binarios, uno en uso. |
| Primera vez: perfil WebView2 | 82 MB | `EBWebView` en LocalAppData. |

---

## Puntos ciegos de la medición

Antes de optimizar conviene saber qué **no** estamos viendo. Tres huecos distorsionan cualquier
conclusión sobre la jornada; por eso van antes de los hallazgos.

1. **El latido muere con la ventana oculta.** Cero sesiones con más de 3 h de latidos en 30 días,
   mientras que las grabaciones de 0.2.57 duran 57 min de mediana en segmentos de jornada. El heartbeat
   es JavaScript y WebView2 lo suspende en la bandeja: **el estado más largo del día no aparece en la
   nube**. El muestreador Rust de 30 s ya tiene el dato; falta que lo emita por el outbox.
2. **`cpu_pct` es la CPU del sistema, no la de Maity.** Viene de `global_cpu_usage()`
   (`logging/mem_sampler.rs:232`). Un idle al 85 % en tier High describe la máquina, no la app. No hay
   CPU por proceso en la telemetría, así que **todo lo de CPU en este documento es estimación de
   código**.
3. **WebView2 se mide como bloque.** La suma de los 6 a 9 procesos no dice cuánto pesa la ventana
   principal oculta frente al coach-float. Decidir si el coach se cierra en la jornada exige ese reparto
   por ventana.

> **Actualización 2026-09-07.** Los puntos 1 y 2 tienen arreglo en `main` desde `0506582` (#14, 04-sep):
> el `mem_sampler` emite el mismo `health.heartbeat` con `reason:"native"` cada 15 min por el outbox (solo
> con sesión y solo si el webview lleva > 20 min sin pedir `get_health_snapshot`), y el latido lleva el campo
> nuevo `proc_cpu_pct` (CPU del proceso propio ×nb_cpus; `cpu_pct` sigue siendo del sistema a propósito).
> **Ningún release lo lleva todavía**: a 07-sep `platform_logs` tiene 0 latidos con `reason:"native"` y solo
> 4 con `proc_cpu_pct`, todos de builds 0.2.58 de desarrollo; en campo (0.2.57) los dos huecos siguen
> abiertos y falta el smoke de una jornada en bandeja. El punto 3 sigue abierto en código: `webview_rss_mb`
> es una sola suma, sin reparto por ventana. Detalle en `docs/TELEMETRIA.md` § `health.heartbeat`.

---

## Los 35 hallazgos

Ordenados por impacto estimado en RAM, luego CPU, luego disco y red.

### #01 · El VAD de Silero guarda cada muestra de silencio hasta el próximo fin de voz
`Crítico` · RAM · Jornada · esfuerzo S · verificado · **desaparece por lote** · **CERRADO** `a62c4ef`

- **Impacto**: de 0 a ~700 MB por segmento de 90 min: 230 MB/h por canal, dos canales, en sierra que
  solo se vacía al rotar.
- **Dónde**: `silero-rs lib.rs:213` (extend_from_slice en cada process) · `silero-rs lib.rs:357` (único
  drain, en SpeechEnd) · `audio/vad.rs:256-258` (nunca llama `trim_start_silence`) ·
  `audio/pipeline.rs:919` y `:1011` (ambos canales, sin compuerta).
- **Qué pasa**: `session_audio` es un `Vec<f32>` a 16 kHz que solo se poda cuando termina un tramo de
  voz. En silencio no se suelta nada. El tope de `vad.rs:13` acota el buffer propio, no el del crate. El
  canal del sistema sin llamadas en todo el día crece el segmento entero.
- **Cambio**: tras `session.process(chunk)`, si no hay voz, llamar `session.trim_start_silence()`;
  conserva los 200 ms de pre-speech y mantiene los timestamps. Para voz continua, `take_until` tras cada
  force-cut de 2 s, con test.
- **Riesgo**: validar con los tests snapshot y consistency del crate; `trim_start_silence` es API
  pública pensada para esto.

### #02 · Parakeet se carga al arrancar, antes del login, y nunca se descarga
`Crítico` · RAM · Idle/Arranque/Jornada · esfuerzo M · verificado · **se encoge por lote** · **CERRADO** `252ed41`

- **Impacto**: ~600 MB residentes desde el arranque para siempre; pico de ~1.3 GB al cargar y de
  +700 MB durante el reciclado, que carga el modelo nuevo antes de soltar el viejo.
- **Dónde**: `lib.rs:1119` → `audio/transcription/engine.rs:165-220` ·
  `audio/recording_lifecycle.rs:624-627` ("~600MB is acceptable") ·
  `parakeet_engine/parakeet_engine.rs:625` y `:644-646` · telemetría: idle tras grabar 650 MB p50 (Low).
- **Qué pasa**: la precarga no consulta sesión ni registro; en la pantalla de login y en la bandeja el
  motor está residente sin consumidor posible. El encoder int8 pesa 652 MB en disco y son tres sesiones
  ORT. La telemetría lo confirma: 46 MB antes de grabar, 650 MB después, aunque la app quede en reposo.
- **Cambio**: disparar la precarga en la transición None→Some de `set_current_user` y exigir registro.
  En tier Low, descargar tras N minutos fuera de la ventana de jornada y recargar desde el tick del
  scheduler (30 s; carga fría 3-6 s). Reciclado drop-then-load bajo el write lock.
- **Riesgo**: la primera grabación manual tras el login paga 3-10 s de carga; el autostart al boot no
  carga hasta que alguien inicia sesión, que es lo deseado.

### #03 · Idle-kill del sidecar (300 s) coincide con el cooldown del breaker (300 s)
`Alto` · RAM/CPU/Disco · Jornada · esfuerzo S · **desaparece por lote** · **CERRADO** `167df50`

- **Impacto**: por ciclo, relectura de 1.0 GB (1B) o 2.4 GB (4B) del GGUF y 50-90 s de 2-4 núcleos. Es
  el mecanismo detrás de los 55 reinicios en 62 sesiones Low de 0.2.57.
- **Dónde**: `summary/summary_engine/models.rs:258` · `coach/live_feedback.rs:47-48` y `:1232-1247` ·
  `summary/summary_engine/sidecar.rs:1080-1127` y `:639-643`.
- **Qué pasa**: tres tips fallidos abren el breaker 300 s; sin Generates el idle loop mata el helper a
  los 300-360 s; el probe half-open cae en un spawn frío con timeout efectivo de 120 s;
  `COACH_LLM_CONSEC_FAILS` no se reinicia al abrir, así que reabre al primer fallo. El mismo idle-kill
  dispara en cualquier tramo callado de 5 min de un segmento.
- **Cambio**: no matar por idle mientras hay grabación con `LLM_TIPS_ENABLED` (o `update_activity` al
  abrir el breaker e idle ≥ 2× cooldown); reiniciar el contador de fallos al abrir para que half-open
  exija 3 fallos nuevos.
- **Riesgo**: mantiene 1.2-3 GB residentes durante todo el segmento: solo en Medium+ (ya es así).
- **Cierre (2026-09-07, `167df50`)**: se tomó la primera opción, como *lease* de sesión en vez de gate
  por fase: `SidecarManager::keepalive()` (guard RAII) lo toma `live_feedback::start` sólo con
  `LLM_TIPS_ENABLED`, vía `SidecarPool::get_or_create` (sin spawn), y el idle loop lo trata como un
  request en vuelo. El breaker pasó a `coach/breaker.rs` y reinicia el contador al abrir;
  `LlmError::Cancelled` no cuenta. Sin tocar constantes. Verificación en producción:
  `coach.session_summary.sidecar_idle_kills` debe ser 0 en Medium+. **Fuera del cierre, candidato a
  hallazgo propio**: `CoachLlmService::generate_internal` hace `manager.shutdown()` al cancelar un
  tip en vuelo (`coach/llm_service.rs`, brazo `token.cancelled()`), así que cada rotación por hora
  que cae a media generación sigue costando un spawn frío al segmento siguiente. Con ids confirmados
  el kill ya no haría falta (la respuesta tardía se drena por id); la arista es una escritura parcial
  en el pipe si la cancelación cae a media `write_all`.

### #04 · El warmup del sidecar al arranque carga Gemma antes del login y lo tira a los 5 minutos
`Medio` · RAM/CPU/Disco · Arranque/Idle · esfuerzo S · **desaparece por lote** · abierto

- **Impacto**: 0.8-2.4 GB durante ~5 min y ~1 núcleo por ~1 min en cada arranque, sin beneficio salvo
  que se grabe en esos 5 min. Hoy solo dispara en macOS >16 GB por el desajuste de modelos (#29).
- **Dónde**: `lib.rs:1122-1213` (sin check de sesión) · `sidecar.rs:821-848` (el ping no cuenta como
  actividad).
- **Qué pasa**: carga el GGUF completo, corre dos Generates de un token, y el idle loop lo cierra 300 s
  después. Para una máquina de jornada (app al boot, scheduler a las 9:00) es I/O y CPU a cambio de
  nada, repetido en cada relanzamiento.
- **Cambio**: eliminarlo, o moverlo a `live_feedback::start` / al tick del scheduler ≤2 min antes de un
  arranque programado.
- **Riesgo**: latencia del primer tip en la primera grabación del día, que ya es el caso común.

### #05 · La lista de conversaciones es un `select(*)` sin límite
`Alto` · RAM/Red/CPU · Post/Idle/Jornada · esfuerzo M · verificado · no cambia por lote · **CERRADO** `1571eda`

- **Impacto**: usuario p95: 3 MB por fetch (6-9 MB de heap JS retenidos toda la sesión), 2-4 fetches por
  minuto mientras se analiza un segmento, ~180 MB/día de red en una jornada de 6 segmentos.
- **Dónde**: `features/conversations/services/conversations.service.ts:718-724` ·
  `components/Sidebar/index.tsx:66-70` (segundo observer, nunca se recolecta) ·
  `components/GlobalConversationNotifier.tsx:160` (invalida en cada UPDATE de Realtime).
- **Qué pasa**: trae `transcript_text`, `communication_feedback_v4` y minuta completos de todas las
  conversaciones. Se invalida en cada UPDATE de Realtime (cada 30 s durante el procesado), en cada
  `sync-status-changed`, cada 15 s con filas no terminales y en cada foco de ventana.
- **Cambio aplicado**: proyección de lista con escalares del JSONB, tope de 200 + "Cargar más", parche
  de fila con `setQueriesData`, borrado de la query del Sidebar, `refetchInterval` colgado de
  `derivePhase` y gamificación en key propia. Detalle en `CLAUDE.md` § *Features*.
- **Nota de la medición**: al implementarlo se comprobó contra producción que **813 de 1,893 filas
  (43 %) tienen `analysis_status = NULL`**, así que el poll de 15 s no se quedaba encendido "a veces"
  sino **siempre**; y que **0 filas** pierden el badge con la proyección.

### #06 · Ocultar a la bandeja no pausa nada de la ventana principal
`Alto` · RAM/CPU · Jornada/Idle · esfuerzo M · **se encoge por lote** · abierto

- **Impacto**: renderer completo residente (150-300 MB estimados, por medir): árbol React, caché de
  React Query (#5), 2.1 MB de JS parseado; los polls IPC siguen a ritmo throttled y cada chunk hace tres
  operaciones de IndexedDB y un re-render.
- **Dónde**: `lib.rs:894-906` (solo hide, cierra coach, para preview) ·
  `contexts/TranscriptContext.tsx:269-311` · `services/indexedDBService.ts:233-277`.
- **Qué pasa**: WebView2 throttlea los timers pero no los evals de eventos Tauri: la ventana oculta en
  `/` sigue recibiendo niveles a 10 Hz y cada chunk de transcripción. Solo cuatro sitios del código
  miran `visibilityState` y ninguno es un poll IPC.
- **Cambio**: en `AppContent`, desmontar `MainContent` y `Sidebar` mientras `document.hidden`,
  manteniendo `TranscriptProvider` (es el WAL de recuperación), `RecordingStateProvider`,
  `RecordingWidgetListener` y `CloudSyncInitializer`; guard de `document.hidden` en
  `useRecordingLevels`, `usePermissionCheck` y `HeadphonesRecommendationWarning`;
  `RecordingStateContext` por evento con refetch en `visibilitychange`.
- **Riesgo**: `useRecordingStop` navega con `window.location.href`; `TranscriptContext` debe seguir
  montado.

### #07 · Coach-float re-renderiza la página entera a 10 Hz detrás de un blur de 22 px
`Alto` · CPU/RAM · Jornada/Idle · esfuerzo S · verificado · no cambia por lote · **CERRADO** `477bfa0`

- **Impacto**: 36,000 renders/h con recomposición del `backdrop-filter` en cada uno (compositing por CPU
  sin dGPU), más un proceso renderer de ~90 MB, más 2 IPC cada 2 s y un ticker de 1 s.
- **Dónde**: `app/coach-float/page.tsx:134` y `:893` (blur 22px saturate 180%) ·
  `app/coach-float/page.tsx:155` y `:234` (setLevels a nivel de página) · `coach/commands.rs:292-303`.
- **Cambio aplicado**: `lib/audioLevelsStore.ts` (store fuera de React con epsilon y coalescing a 4 Hz)
  + `components/audio/AudioLevelBars.tsx` (hoja memoizada, `transform: scaleY()`), fondo opaco `#0F1018`
  sin `backdrop-filter`. Aplicado también a `recording-widget`, que tenía el patrón idéntico. Detalle en
  `CLAUDE.md` § *Ventanas auxiliares*.
- **Pendiente anotado**: el `setInterval` de 2 s con doble `invoke` y el ticker de 1 s siguen en ambas
  páginas.

### #08 · El encoder de checkpoints copia 11.5 MB dos veces y no acota la concurrencia
`Medio` · RAM/CPU · Jornada/Post · esfuerzo S · verificado · no cambia por lote · **CERRADO** `5584e3e`

- **Impacto**: normal: 11.5 MB fijos + 23 MB transitorios + un ffmpeg (~30 MB) cada 30 s. Con CPU
  saturada, encodes que tardan más de 30 s se solapan y cada uno retiene su buffer: N × (23 MB + ffmpeg)
  sin tope.
- **Dónde**: `audio/incremental_saver.rs:56` (2,880,000 f32) · `:117-121` (concat a segundo Vec) ·
  `:107` (spawn_blocking sin semáforo) · `audio/encode.rs:36-83` (sin `-threads`, sin `-loglevel`).
- **Cambio aplicado**: `Vec<f32>` contiguo preasignado, `Semaphore(1)` por saver con `try_acquire_owned`
  en el camino sync (difiere sin perder audio) y `acquire().await` en `finalize()`, latch en el aviso de
  flush diferido, flags `-hide_banner -loglevel error -nostats -threads 1` y drenado de stderr en
  paralelo con el `write_all` (cerraba un deadlock real). Detalle en `CLAUDE.md` § *Rendimiento de
  Audio*.

### #09 · Tres canales sin límite en la ruta de grabación
`Medio` · RAM · Jornada · esfuerzo S · verificado · **se encoge por lote** · abierto

- **Impacto**: si el pipeline se atasca (Parakeet en el runtime, #16), el canal de captura crece 384 KB
  por segundo de retraso sin señal alguna.
- **Dónde**: `audio/pipeline.rs:1264` (captura → pipeline, ~200 msg/s) · `audio/recording_manager.rs:75`
  (pipeline → dispatcher) · `audio/recording_saver.rs:214` (pipeline → saver, 10/s).
- **Qué pasa**: los callbacks de WASAPI de 10 ms envían a un `unbounded_channel`; el único con
  backpressure real es el del worker (256 × ≤384 KB = 96 MB con drop-oldest).
- **Cambio**: acotar el canal de captura a ~200 mensajes (1 s de audio) con `try_send` y contador de
  descartes; el del saver a ~300 (30 s) con drop-newest.
- **Riesgo**: el audio descartado bajo inanición pasa a ser explícito y contable; hoy se retrasa en
  silencio.

### #10 · `AudioMetricsBatcher` acumula resúmenes que nadie lee
`Bajo` · RAM/CPU · Jornada · esfuerzo S · no cambia por lote · **CERRADO** `4144eaa`

- **Impacto**: 1-2 MB por segmento de 90 min más una tarea, un canal y un `Instant::now()` por callback
  de 10 ms.
- **Dónde**: `audio/pipeline.rs:817` y `:882-893` · `audio/batch_processor.rs:56-78` y `:185-192`
  (`get_summaries` sin llamadores).
- **Qué pasa**: 4 resúmenes por segundo se empujan a un `Arc<RwLock<Vec>>` que solo se libera al soltar
  el pipeline.
- **Cambio**: borrar el batcher y la macro `batch_audio_metric!`. **Riesgo**: ninguno.
- **Cierre (09-sep)**: borrado `batch_processor.rs` entero (`BatchProcessor`, `AudioMetricsBatcher` y la
  macro) y el bloque de `pipeline.rs` que lo alimentaba; el `set_audio_level` del mismo bloque se queda
  (sí tiene consumidor: las barras de nivel del frontend). De paso, `BatchProcessor::new` hacía
  `tokio::spawn` dentro de un constructor síncrono y recreaba un `sleep(5 s)` por iteración del
  `select!`. Mismo commit que #11.

### #11 · El normalizador EBU R128 guarda un historial de sonoridad ilimitado
`Bajo` · RAM · Jornada · esfuerzo S · no cambia por lote · **CERRADO** `4144eaa`

- **Impacto**: 0.4 MB por segmento; además `normalize_loudness` asigna un Vec de salida por callback.
- **Dónde**: `audio/audio_processing.rs:165` y `:186-224` · crate `ebur128`: `history = usize::MAX`.
- **Qué pasa**: `set_max_history` nunca se llama, así que el estado integrado crece 80 B/s.
- **Cambio**: `set_max_history(600_000)` tras construir; escribir en sitio en `normalize_loudness`.
- **Riesgo**: la sonoridad integrada pasa a ventana de 10 min; para 90 min es más apropiado.
- **CORRECCIÓN al remedio (09-sep)**: `set_max_history` NO se usó, por dos razones. (1) En `ebur128 0.1.10`
  `Queue::set_max_size` (`history.rs:181-188`) hace `queue.resize(max, 0.0)` cuando `len < max`, o sea
  **rellena con 6000 ceros** una instancia recién creada, y `calc_relative_threshold` los cuenta en `len`:
  el umbral relativo queda diluido (≈ −20 LU en vez de −10 LU al minuto 1) hasta que 10 min de bloques
  reales los expulsan. (2) La ventana deslizante de 10 min no es "más apropiada" para la jornada, es
  peor: tras un silencio largo la cola queda sólo con ruido de sala (> −70 LUFS absoluto), la sonoridad
  integrada cae a ~−60 y la ganancia sube ~+37 dB — y ese audio amplificado es el que ve el VAD
  (`pipeline.rs` normaliza ANTES del VAD). Con la integración sobre todo el segmento la energía del habla
  domina el promedio y eso no vuelve a pasar una vez que hubo voz. Además el hallazgo era también de CPU:
  `loudness_global()` se llama cada 512 muestras y recorría la cola entera, O(n) creciente.
- **Cierre (09-sep)**: `Mode::I | TRUE_PEAK | HISTOGRAM` → 1000 bins fijos (8 KB) y `loudness_global()`
  O(1000) constante; misma integración sobre todo el segmento, ±0.1 LU por la cuantización de los bins.
  `normalize_loudness(&mut [f32])` escribe en sitio. Tests: `usa_histograma_para_acotar_la_memoria` y
  `el_histograma_no_cambia_la_sonoridad_integrada` (Queue vs Histogram sobre 18 s de señal con dos
  niveles y silencio, < 0.2 LU). Pendiente anotado: `HighPassFilter::process` y
  `NoiseSuppressionProcessor::process` siguen asignando un `Vec` por callback en la misma ruta. Mismo
  commit que #10.

### #12 · El VAD usa 4 hilos intra-op por sesión, dos sesiones, para un modelo de 1.7 MB
`Alto` · CPU · Jornada · esfuerzo M · verificado · **se encoge por lote** · abierto

- **Impacto**: en una laptop de 4 núcleos: 8 hilos del VAD + 6 de Parakeet + workers de tokio +
  WebView2. Los hilos de ORT hacen spin-wait tras cada run; con una inferencia cada 30 ms por canal, las
  ventanas de spin se solapan casi siempre. Estimación 0.5-1.5 núcleos en tier Low.
- **Dónde**: `silero-rs lib.rs:142-145` (`with_intra_threads(4)`) ·
  `audio/transcription/onnx_providers.rs:130` y `:213-226`.
- **Qué pasa**: un hilo es más rápido que cuatro para un frame de 480 muestras; el spin por defecto de
  ORT (`allow_spinning=1`) suma CPU sin trabajo útil.
- **Cambio**: parchear el fork a `with_intra_threads(1)` e inter 1; en `build_session` añadir
  `session.intra_op.allow_spinning=0` para Parakeet; valorar un pool global de ORT para las cinco
  sesiones.
- **Riesgo**: el RTF de Parakeet puede subir algo sin spin: re-medir contra el 0.39 del A/B de julio.

### #13 · Tormenta de `snapshot_now` en el dispatcher cuando el backlog cae en un múltiplo de 30
`Alto` · CPU · Jornada · esfuerzo S · verificado · **desaparece por lote** · abierto

- **Impacto**: mientras el worker pasa 2-30 s en un chunk con `pending = 60, 90, 120…`, la condición es
  cierta en cada iteración del bucle (cada segmento o 200 ms): cinco o más recorridos completos de la
  tabla de procesos por segundo, justo cuando la máquina ya va atrasada.
- **Dónde**: `audio/transcription/worker.rs:836-843` · `:849-859` (mismo patrón para el lag warning) ·
  `logging/mem_sampler.rs:169-192` (System fresco + `refresh_processes` All).
- **Qué pasa**: `pending` solo cambia al encolar o completar; la comprobación por módulo se repite en
  cada vuelta del loop.
- **Cambio**: latch por bucket: `let bucket = pending / 30; if bucket != last_bucket { … }`. Igual para
  el emit de lag. **Riesgo**: ninguno.

### #14 · El muestreador de memoria refresca más de lo que lee, cada 30 s, incluso en el login
`Medio` · CPU · Jornada/Idle/Arranque · esfuerzo S · verificado · no cambia por lote · **CERRADO** `0506582`

- **Impacto**: `refresh_processes(All, true)` abre un handle por proceso para IoCounters y exe en
  250-400 procesos: 10-40 ms por tick, 1,080 ticks por jornada, desde el arranque.
- **Dónde**: `logging/mem_sampler.rs:188` · `:232` (cpu global).
- **Qué pasa**: el sampler consume solo `memory()`, `name()` y `parent()`; el kind por defecto de
  sysinfo 0.32 añade cpu, `disk_usage` y exe.
- **Cambio**: `refresh_processes_specifics(All, true, ProcessRefreshKind::nothing().with_memory())`;
  60 s cuando la fase es Idle. Y ya que se toca: **emitir un latido de salud desde aquí por el outbox**
  (punto ciego nº 1) y medir cpu del proceso propio.
- **Riesgo**: `cpu_pct` sigue saliendo de `refresh_cpu_usage`.

### #15 · Sondeos del frontend por IPC que no hacen falta o no se apagan
`Medio` · CPU · Jornada/Idle · esfuerzo S · verificado · **se encoge por lote** · abierto

- **Impacto**: `get_recording_state` cada 500 ms toda la grabación (64,800 IPC por jornada) más un
  duplicado muerto a 1 s; sync statuses cada 10 s en toda ruta y en reposo (8,640/día); enumeración
  WASAPI completa cada 5 s en una laptop sin micrófono (6,480 por jornada); salida de audio cada 5 s en
  el home; 2 IPC cada 2 s en coach-float y recording-widget.
- **Dónde**: `contexts/RecordingStateContext.tsx:101` · `hooks/useRecordingStateSync.ts:57` (sin
  consumidores) · `hooks/useCloudSyncStatuses.ts:38` · `hooks/usePermissionCheck.ts:96` ·
  `components/recording/HeadphonesRecommendationWarning.tsx:42` · `app/coach-float/page.tsx:359`.
- **Qué pasa**: los cuatro listeners de transición ya actualizan el estado de grabación; el puente
  `sync-status-changed` ya refresca al instante; `usePermissionCheck` ya escucha `devicechange`.
- **Cambio**: estado de grabación por evento con refetch en `visibilitychange` (o 5 s); borrar
  `useRecordingStateSync`; sync statuses solo mientras haya pending/in_progress, si no 60 s; permisos
  con tope de 60 s; audífonos desde el device monitor de Rust. **Riesgo**: ninguno funcional.

### #16 · La inferencia de Parakeet corre en un hilo del runtime de tokio
`Medio` · CPU · Jornada · esfuerzo M · **se encoge por lote** · abierto

- **Impacto**: uno de los N workers queda pinneado 1-3 s por chunk; el pipeline (que también corre
  Silero en síncrono), el saver, el tick de niveles y el scheduler comparten ese runtime. En 2-4 núcleos
  produce picos de latencia y deja crecer el canal sin límite (#9).
- **Dónde**: `audio/transcription/worker.rs:1121` → `parakeet_engine/parakeet_engine.rs:537-558` ·
  `parakeet_engine/model.rs:462-487`.
- **Qué pasa**: `transcribe_samples` es síncrono y se llama bajo `current_model.write().await` sin
  `spawn_blocking`.
- **Cambio**: ejecutarlo en `tokio::task::spawn_blocking` (`blocking_write` dentro del closure o
  `Option<ParakeetModel>` tras un `std::sync::Mutex`). Igual para Moonshine y Canary.
- **Riesgo**: el swap del reciclado debe seguir usando el mismo lock.
- **Avance (sep-2026, F1 del lote)**: el pipeline por lote nace con la inferencia fuera del runtime
  (`transcription/batch/transcriber.rs::transcribe_chunk`: `spawn_blocking` + `Handle::block_on`).
  El hot path de STREAMING (`worker.rs`) sigue pinneando un worker — el hallazgo queda abierto para
  ese pipeline (y se encoge a medida que el lote se vuelva el default, F6).

### #17 · El monitor de dispositivos re-enumera todos los endpoints WASAPI cada 5 s mientras graba
`Bajo` · CPU · Jornada · esfuerzo S · no cambia por lote · **CERRADO** `475e071`

- **Impacto**: 20-100 ms por sondeo (0.4-2 % de un núcleo) más asignaciones; el stop ya tuvo que
  tratarlo aparte porque la enumeración "corre 90+ s" en el teardown.
- **Dónde**: `audio/device_monitor.rs:171`, `:186`, `:255-258` · `audio/recording_manager.rs:259-264`.
- **Cambio aplicado** (2026-09-08): la causa real era peor que "leer el nombre de cada endpoint": en
  cpal 0.15 `input_devices()`/`output_devices()` filtran con `supported_*_configs()`, que en WASAPI
  **activa un `IAudioClient` por endpoint** + `GetMixFormat` + varios `IsFormatSupported` — dos
  enumeraciones completas con activación de TODOS los endpoints por tick, incluido el de captura de un
  headset BT (lo que `bluetooth_guard.rs` existe para evitar). El tick usa ahora
  `snapshot_device_names` → `platform::snapshot_active_endpoints` (sólo property store +
  `IMMEndpoint::GetDataFlow`, en `spawn_blocking`); `ComScope`/`read_string_property` pasan a
  `devices/platform/wasapi_com.rs`, compartidos con el guard. **Ni intervalo de 30 s ni callbacks**:
  los umbrales de desconexión se cuentan en ciclos y fijan la latencia del toast y de la
  auto-reconexión; el ahorro vino de abaratar el tick (~1-2 ms). Lógica del tick pura y con tests.
  Bonus: el primer tick ya no emite `DeviceListChanged` (comparaba contra una lista vacía → toast
  "Cambio en dispositivos de audio" en cada grabación manual). Detalle en `CLAUDE.md` §
  *Convenciones → Sondeo del monitor de dispositivos*.

### #18 · El concat final de ffmpeg corre síncrono dentro de una función async
`Bajo` · CPU · Post · esfuerzo S · no cambia por lote · **CERRADO** `475e071`

- **Impacto**: bloquea un worker de tokio durante todo el concat en cada rotación; con 8 hilos se
  disimula, con 2-4 se nota en el resto de tareas.
- **Dónde**: `audio/incremental_saver.rs:233-240` (`Command::output()` en `async fn`) · `:157-165`
  (spin-wait de 50 ms hasta `pending = 0`).
- **Cambio aplicado** (2026-09-08): `run_ffmpeg_concat` con `tokio::process::Command` (stdin nulo +
  `-nostdin` porque el `output()` de tokio no anula stdin; `kill_on_drop`) para `merge_checkpoints` y
  `recover_audio_from_checkpoints`; flags en `concat_args`, pura y con golden test. El spin-wait no se
  cambió por un `Notify` sino por el permiso de `encode_slots` que #08 ya había introducido (sostenerlo
  ⇔ ningún encode en vuelo), con `timeout_at` y UNA fecha límite de 300 s que cubre también el flush
  del último tramo — que hasta ahora esperaba SIN timeout. `pending_encodes`/`PendingGuard`
  eliminados. Detalle en `CLAUDE.md` § *Rendimiento de Audio* (blockquote de #08).

### #19 · ONNX Runtime escribe a nivel INFO y es del 35 al 64 % del log
`Medio` · Disco/CPU · Jornada/Arranque · esfuerzo S · verificado · **se encoge por lote** · abierto

- **Impacto**: 1.2-1.4 MB/h grabando (88-109 líneas/min), 11-13 MB por jornada, 80-90 MB con la
  retención de 7 días; cada línea se formatea también para un stdout que no existe bajo
  `windows_subsystem`.
- **Dónde**: `logging/file_logger.rs:65-66` (EnvFilter "info" para todo) · `:59-62` (capa de consola
  siempre) · `audio/transcription/worker.rs` (`info!` por chunk, 55 % de las líneas propias).
- **Cambio**: `EnvFilter::new("info,ort=warn")`; consola solo con `cfg(debug_assertions)`; demote del
  `info!` por chunk del worker a `debug!`.
- **Riesgo**: ninguno; la diagnosticabilidad mejora porque las líneas propias dejan de ahogarse.

### #20 · `reqwest::Client` se construye por request en unos 20 sitios
`Bajo` · CPU/Red · Post/Jornada · esfuerzo S · verificado · no cambia por lote · **CERRADO** `9b6879c`

- **Impacto**: cada construcción enumera y parsea el root store de Windows (100-300 certificados) y tira
  el pool: 5-30 ms de CPU, ~1 MB transitorio y un handshake TLS completo por request. Un cierre de
  segmento construye al menos cuatro.
- **Dónde**: `logging/telemetry/drain.rs:93` · `cloud_sync/executors.rs:276` y `:340` ·
  `cloud_sync/session.rs:210` · `api/finalize.rs:145` · `api/retry_analysis.rs:77` ·
  `logging/incident.rs:416`.
- **Qué pasa**: el patrón correcto **ya existe** en `coach/commands.rs:50`
  (`static HTTP_CLIENT: Lazy<Client>`).
- **Cambio aplicado** (2026-09-08): `api/http.rs` → `pub static HTTP: Lazy<reqwest::Client>` con
  timeout total de 30 s, re-exportado como `crate::api::HTTP`. Lo usan los siete sitios de arriba más
  `api/regenerate_minutes.rs`, `deepgram_commands.rs`, `api/client.rs` y los tres de `api/endpoints.rs`
  (12 sitios; de 26 construcciones quedan 14, todas deliberadas). **El "timeout de 30 s" plano de este
  hallazgo estaba mal para `finalize`**: el handler de la nube (`api/conversations.ts`) corre DOS LLM
  síncronos dentro del request (`processLongTranscript` para título/overview y luego
  `extractMemoriesFromTranscript`) y cobra la cuota (`recordUsage`) antes de responder; con 30 s el job
  quedaba en `retrying` y el reintento cobraba la unidad otra vez. Lleva override por request de 300 s
  (`FINALIZE_TIMEOUT`, tope de Vercel Fluid) — `RequestBuilder::timeout` sobreescribe el del cliente
  sólo para ese request; `regenerate_minutes` conserva sus 180 s. Fuera a propósito (allow-list):
  descargas de modelos (perfil 1 h + `tcp_nodelay`), Ollama (localhost, timeouts por request),
  OpenRouter (`blocking`), y los LLM del coach y del resumen (sin timeout). Fitness test
  `solo_los_sitios_permitidos_construyen_un_client` recorre `src/` y falla ante una construcción nueva
  fuera de la lista o una entrada obsoleta. Sigue cierto que reqwest cierra las ociosas a los 90 s.

### #21 · `System::new_all()` completo al construir la app para un procesador que nadie invoca
`Bajo` · RAM/CPU · Arranque · esfuerzo S · verificado · no cambia por lote · **CERRADO** `37c6e7c`

- **Impacto**: 1-5 MB retenidos toda la vida del proceso (entornos y cmdlines de 250-400 procesos) y
  50-200 ms de arranque; el mismo patrón en `builtin_ai_get_recommended_model` solo para leer la RAM
  total.
- **Dónde**: `lib.rs:669` → `whisper_engine/system_monitor.rs:46-47` ·
  `summary/summary_engine/commands.rs:387` · frontend: cero call sites de
  `initialize_parallel_processor` / `get_system_resources`.
- **Cambio aplicado** (2026-09-08): ni "perezoso" ni sólo quitar el `manage()`: se **borraron**
  `whisper_engine/{system_monitor,parallel_processor,parallel_commands}.rs` (1,032 líneas, con un
  `AudioChunk` duplicado del de `audio::recording_state`), el `manage()` y las 11 entradas del
  `generate_handler!` — los 11 comandos tenían cero call sites en el frontend (grep por cada nombre) y
  el módulo sólo se referenciaba a sí mismo. Recuperables de git. La RAM total sale del
  `HardwareProfile` cacheado (`OnceLock`, respeta `MEMORY_GB`), como ya hacía
  `summary_engine::models:271`: una sola fuente para el tier y el modelo recomendado, cero syscalls
  tras la primera lectura. Bonus: `logging/commands.rs:189` (`generate_system_info`, export de logs y
  bundle de incidente) era el tercer `new_all()` del crate y no estaba anotado; ahora pide sólo RAM +
  lista de CPUs con `new_with_specifics` (verificado en sysinfo 0.32.1 que `refresh_cpu_specifics`
  inicializa la lista desde un `System::new()` vacío en Windows/macOS/Linux). No queda ningún
  `new_all()` ni `refresh_all()` en el crate. CLAUDE.md actualizado (3 menciones).

### #22 · La presión de memoria se observa pero nunca se actúa sobre ella
`Alto` · RAM · Jornada/Post · esfuerzo M · verificado · no cambia por lote · abierto

- **Impacto**: los 215 avisos del piloto equivalen a ~36 h de presión sostenida en 7 máquinas; la app
  tiene la señal y no descarga nada. Además el mensaje lleva cifras cambiantes, así que cada aviso se
  come una de las 20 plazas de `app.error` por proceso.
- **Dónde**: `logging/mem_sampler.rs:336-367` (`ConditionWarns::check`) ·
  `logging/rust_error_bridge.rs:132-165` (dedup por mensaje).
- **Cambio**: exponer `mem_sampler::pressure_level()`; consumidores: saltar o abortar el warmup del
  sidecar, `SidecarManager::shutdown()` con presión sostenida y sin requests activos, pausar los tips
  LLM del segmento, descargar Parakeet en reposo. Loguear con clave sin números.
- **Riesgo**: definir la histéresis para no oscilar.
- **Nota**: si se adopta la transcripción por lote, esta política **deja de ser opcional** (el pico de
  carga de Parakeet cada hora la necesita).
- **Avance (sep-2026, F0b del modo lote)**: `mem_sampler::pressure_level()` implementado con
  histéresis doble (`Normal|Elevated|Critical`, detalle en `docs/TELEMETRIA.md` § nivel 3) y TRES
  consumidores: warmup del sidecar se salta con `Elevated+` (o avail bajo umbral al arranque), el
  tick LLM del coach cede (`call_ollama_and_emit`), y el `idle_unload` del STT descarga sin esperar
  los 10 min. Log de transición `[MEM] pressure-level: a->b` con clave sin números. **Pendiente para
  cerrar**: `SidecarManager::shutdown()` con presión sostenida y sin requests activos, y el consumidor
  principal — el gate del planner del lote (Fase 2).

### #23 · Las ventanas auxiliares cargan el grafo completo del layout raíz
`Bajo` · RAM/CPU · Arranque/Jornada · esfuerzo M · no cambia por lote · **CERRADO** `0528562`

- **Impacto**: `coach-float.html` carga 1,457 KB de JS de los que la página son 34 KB (supabase-js,
  sonner, Radix, polyfills); +10-20 MB de heap y peor primer pintado por ventana; es también la razón
  del sleep de 180 ms antes del `show()`.
- **Dónde**: `app/layout.tsx:785` (early-return en runtime, no en bundling) · `coach/commands.rs:320`.
- **Cambio**: route groups `app/(main)/layout.tsx` y `app/(aux)/layout.tsx` con un layout auxiliar
  mínimo; mantener `isAuxWindowPath` como gate defensivo.
- **Riesgo**: invariantes de `layout.test.ts`; las aux siguen necesitando `globals.css`.
- **Cierre (09-sep)**: el remedio se aplicó tal cual (route groups `(main)`/`(aux)`, root layout aux
  mínimo como server component, early-return conservado como defensa), pero **solo cubría la mitad
  del peso**. Medido en el `out/` del 09-09 antes del cambio: coach-float 1,172 KB en 29 scripts
  (no 1,457: #05 y compañía ya habían adelgazado la main), de los que ~310 KB eran supabase-js
  **importado por la propia página** — `import { supabase }` para la RPC `insert_user_feedback` del
  👍/👎 y `Analytics.track` → `platformLogger` → `supabase` — y eso los route groups no lo tocan.
  Peor: `lib/supabase.ts` es un Proxy perezoso, así que el primer tip de cada grabación
  (`drawer_auto_opened`) instanciaba un **segundo cliente GoTrue con `autoRefreshToken`** en el
  webview del coach. Julio eligió cerrar las dos causas: analítica de las aux por
  `lib/auxAnalytics.ts::trackAux` → comando `log_analytics_event` → outbox `recording_logs`
  (`ctx.emitter='webview'` + `window` real; la columna `session_id` pasa a `proc-…`), y el sync del
  feedback desde Rust (`cloud_sync/feedback.rs`, único escritor de la RPC; `SessionFeedbackModal`
  también dejó de llamarla). Hallazgo lateral arreglado de paso: los tres `layout.tsx` anidados de
  las aux (de `45a4cbd`) devolvían `<html><body>` DENTRO del body del root — **2 `<html>` por
  documento** — y se borraron. El `sleep(180)` se sustituyó por la señal `on_page_load(Finished)`
  que ya usaba el device-picker (helper compartido). Resultado (bytes ejecutados, sin el polyfill
  `nomodule`): coach-float **1,172 → 336 KB**, recording-widget **1,158 → 325 KB**, device-picker
  **1,137 → 304 KB**; el piso restante (~297 KB) es react-dom + runtime del App Router. Guards:
  `app/(aux)/layout.test.ts` (estructura + grafo de imports con lista negra) y
  `scripts/lint-aux-bundle.js` en el post-build (sin chunks de `(main)`, sin sonner/gotrue, ≤450 KB).
  Pendientes anotados: el sync de feedback sigue siendo best-effort (sin outbox propio, paridad con
  el JS); `recording-widget` arranca visible (posible flash, otro tema); `metadata.ts(x)` duplicados
  y sin uso en `app/`.

### #24 · Bundle de arranque de 2.1 MB de JS con tres familias tipográficas y librerías pesadas
`Bajo` · RAM/CPU/Disco · Arranque · esfuerzo M · no cambia por lote · **CERRADO** `03c7040`

- **Impacto**: `index.html` carga 40 scripts sin gzip (protocolo custom); recharts 346 KB y
  framer-motion 111 KB en el home (framer para un solo fade-in); BlockNote, tiptap y prosemirror suman
  2 MB solo alcanzables desde `/meeting-details`, **ruta sin enlace entrante**.
- **Dónde**: `out/index.html` (build 2026-08-28) · `app/page.tsx:256` (framer) · `next.config.js` (sin
  `optimizePackageImports`).
- **Cambio**: quitar framer del home y de settings; `dynamic()` para la sección de recharts; borrar
  `/meeting-details` con su árbol; una sola familia tipográfica. **Riesgo**: bajo.
- **Cierre (09-sep)**: dos commits, `9c97c5a` (borrado) + `03c7040` (diferir/reemplazar + guard).
  Medido sobre `out/` (línea base del mismo día, ya con #23):

  | Métrica | Antes | Después |
  |---|---:|---:|
  | `index.html` scripts / KB total / KB ejecutados | 38 / 1,842 / 1,733 | 32 / 1,379 / **1,269** |
  | `@font-face` en el CSS de `index.html` | 60 | **0** (31 sólo en `chat.html`) |
  | `.woff2` en `out/_next/static/media` | 24 · 583 KB | 8 · 296 KB |
  | `settings.html` | 35 scripts · 1,431 KB | 30 · 1,309 KB |
  | `meeting-details.html` | 42 scripts · 2,315 KB (+1,256 KB de editor lazy) | no existe |
  | `out/` | 13 MB | 9 MB |

  (1) `/meeting-details` **borrada con su árbol** (`components/MeetingDetails`, `hooks/meeting-details`,
  `components/AISummary`, `components/BlockNoteEditor`, `usePaginatedTranscripts`, `EmptyStateSummary`,
  `BluetoothPlaybackWarning`, tipos V1 `api`/`blocknote`/`communication`) y `@blocknote/*` fuera de
  `package.json` (−101 paquetes: tiptap, 20 `prosemirror-*`, yjs). Verificado con dos barridos
  independientes que no tenía un solo enlace entrante: `useRecordingStop.ts` navega a
  `/conversations?localId=` desde hace meses (el diagrama de CLAUDE.md estaba mal) y la página leía
  `?id=`, así que la URL documentada jamás funcionó. Los seis comandos Rust que quedan sin call site
  (`api_process_transcript`, `api_cancel_summary`, `api_list_templates`, `api_save_meeting_summary`,
  `open_meeting_folder`, `api_get_meeting_transcripts`) siguen registrados por la decisión de ago-2026
  "documentar, no borrar" (`docs/COACH_LLM_ARCHITECTURE.md`). (2) **recharts diferido**:
  `CommunicationTrendChart.tsx` + `LazyCommunicationTrendChart` (`next/dynamic`, `ssr: false`); el chunk
  de 342 KB ya no lo referencia ningún html. (3) **framer-motion fuera del arranque** (opción A acordada:
  se queda SOLO bajo `features/auth/**`, cuyo chunk de `/registration` ya era dinámico — 120 KB una vez
  por cuenta): ~25 `motion.*` de la home, el transcript en vivo, la barra "Grabando", Ajustes y los tres
  gestores de modelos (clones) pasan a keyframes de `globals.css` **sin `forwards`** (un `transform`
  residual crea stacking context), transiciones CSS sobre `style` de React y `group-hover` para el botón
  de borrar modelo (sin estado `isHovered`, y ahora accesible por teclado). Borrados de paso
  `CanaryModelManager`, `TranscriptView` y `ProgressChartsSection` (framer/recharts sin importadores).
  (4) **Fuentes**: el root layout no declara `next/font`; `Source Sans 3` no la usaba nadie; Geist e Inter
  se declaran en `app/(main)/chat/page.tsx` (wrapper `display: contents`) porque sólo shell-v5 y
  maity-chat las usan. **Guard** `frontend/scripts/lint-main-bundle.js` en `run-post-build-checks.js`
  (presupuesto 1,400 KB = medido + 10 %, marcadores de framer/recharts/ProseMirror/three/pptx en los
  chunks de `index.html`, cero `@font-face`), probado en rojo contra el `out/` anterior. Reglas en
  `docs/UI_REGLAS.md` § "Bundle de arranque" y CLAUDE.md. **Correcciones al hallazgo**: no existe
  `@mantine` (BlockNote 0.36 iba por `@blocknote/shadcn`); las fuentes NO se descargaban en el home (sin
  `<link rel=preload>`, `font-display: swap`: el navegador sólo baja una cara cuando un texto la usa), así
  que su costo de arranque real era el CSS de 60 `@font-face` (16 KB) y el disco del instalador; y no
  hace falta `optimizePackageImports` (lucide-react ya está en la lista por defecto de Next 14 y recharts
  sale por `dynamic()`). **Fuera, anotado**: `tailwindcss-animate` está instalado pero NO registrado en
  `tailwind.config.ts` (todos los `animate-in fade-in …` de shadcn y del dashboard son no-op hoy;
  activarlo cambia el look de diálogos/selects en toda la app); `features/conversations/components/minuta/`
  + `charts/` muertos (cero importadores, no entran al bundle); `reactStrictMode` sigue en `false` con
  el comentario corregido. Build debug + lints + smoke OK ×2, lint limpio, 363 tests vitest. Pendiente:
  smoke manual (dashboard con 2+ análisis → skeleton y gráfica; subrayado de tabs; hover en tarjeta de
  modelo; transcript en vivo; `/chat` con Geist/Inter; `/registration` sigue animando pasos).

### #25 · El logging diagnóstico escribe al log de Rust por IPC en cada tick de poll
`Bajo` · Disco/CPU · Post · esfuerzo S · no cambia por lote · **CERRADO** `3793da7`

- **Impacto**: ~60 IPC y 60 líneas por minuto con un detalle en procesado abierto; también en cada
  UPDATE de Realtime.
- **Dónde**: `lib/diagnostics.ts:28-33` (`logPoll` = console.log + `fileLogger.info` → invoke) ·
  `features/conversations/hooks/useConversationLive.ts:60`, `:63`, `:97`.
- **Cambio**: muestrear `logPoll` o dejarlo tras una preferencia de debug. **Riesgo**: ninguno.
- **Cierre (08-sep)**: la causa era más ancha que "cada tick": TanStack 5.90 evalúa la **función**
  `refetchInterval` en `setOptions()` (que `useBaseQuery` llama en un `useEffect` en cada render) y en
  cada cambio de estado de la query, así que eran ≥4 IPC por poll de 3 s más una por re-render.
  Se muestreó, no se gateó: `logPollIfChanged(key, event, data, signature)` en `lib/diagnostics.ts`
  emite sólo si la firma cambia o si pasó el latido de 60 s (`heartbeat: true`, `suppressed: n`),
  aplicado a `refetchInterval_eval` (sin `fetch_status` en la firma), `queryFn_success`/`_error`
  (`queryFn_start` se eliminó; su timing viaja como `elapsed_ms`) y `realtime_update` (firma =
  `analysis_status`, así el heartbeat de la nube cada 30 s se colapsa). Los eventos one-shot
  (`stalled_*`, `watchdog_*`) siguen incondicionales. Un poll atorado se lee como latidos de
  `refetchInterval_eval` sin `queryFn_success` entre medio. Se descartó la preferencia de debug: no
  existe ninguna hoy y un gate apagado por default silenciaría la traza que existe para cazar el bug
  intermitente en producción. Tests en `lib/diagnostics.test.ts`.

### #26 · `sync_queue` nunca se poda: cada job completado conserva su payload completo
`Bajo` · Disco · Post · esfuerzo S · verificado · no cambia por lote · **CERRADO** `a783644`

- **Impacto**: en la DB de desarrollo 37 jobs retienen 606 KB de 1.67 MB (36 %); un usuario de jornada
  crea ~24 jobs/día: 50-100 MB al año, más los backups con `VACUUM INTO`.
- **Dónde**: `database/repositories/sync_queue.rs:447` (`cleanup_old_completed`, cero llamadores) ·
  `lib.rs:961` (`reset_stale_jobs`, sitio natural).
- **Cambio**: llamar `cleanup_old_completed(pool, 7)` tras `reset_stale_jobs` o una vez al día desde el
  sweep del worker.
- **Riesgo**: mantener 7 días: `sync_queue_get_finalize_result` lee `result_data` de jobs recientes.
- **CORRECCIÓN al remedio (08-sep)**: `cleanup_old_completed` era un `DELETE`, y llamarlo con 7 días
  habría roto tres cosas que dependen de las filas completadas: (1) el barrido de audio de **#27**
  exige un `finalize_conversation` completado con `completed_at` ≥ `audio_retention_days` (default
  30) → sin la fila, cero candidatas para siempre; (2) `api_get_meetings_overview::sync_states`
  deriva `sync_state` del `MAX(status)` y lee el badge "Cuota agotada" del `result_data` del
  finalize; (3) un `finalize` diferido por cuota (`defer_job`, semanas en el piloto Dingler) necesita
  el `result_data` de su padre — con la FK `ON DELETE SET NULL`, borrar al padre lo vuelve "listo"
  sin `conversation_id` → `validation:` permanente y esa conversación no se finaliza nunca. Lo que
  pesa es el `payload` (`transcript_text` en `save_conversation`, `segments` en
  `save_transcript_segments`), no la fila ni el `result_data` (que es chico: `{"conversation_id"}` o
  la `FinalizeResponse`, **no** la respuesta con el análisis). Y `payload` sólo lo lee `execute()`
  para jobs `pending → in_progress`: un completado nunca se re-ejecuta.
- **Cierre (08-sep)**: `SyncQueueRepository::trim_completed_payloads(pool, 7)` hace `UPDATE … SET
  payload='{}'` sobre los `completed` de ≥7 días (idempotente por `payload <> '{}'`) y conserva
  fila, `status`, `completed_at`, `result_data` y `depends_on`; `cleanup_old_completed` se
  **borró**. Corre desde `database/maintenance.rs` (tarea propia, molde `audio_retention.rs`: 120 s
  de retraso y luego cada 24 h) — ni en el `block_on` del arranque (hilo principal) ni en el tick del
  worker (se gatea por sesión y esto no necesita usuario). El riesgo anotado arriba desaparece
  porque `result_data` no se toca. SQLite reutiliza las páginas: el archivo deja de crecer, no se
  encoge; los backups con `VACUUM INTO` sí. Tests: `trim_*` en `sync_queue.rs` (incluido el que un
  `DELETE` reprobaría: hijo diferido por cuota sigue resolviendo el `conversation_id` del padre) y
  `la_poda_de_payloads_no_borra_lo_que_lee_la_lista` en `meetings_overview.rs`.

### #27 · Audio AAC estéreo a 192 kbps para voz, y ningún borrado: 0.7 GB por día que se quedan
`Medio` · Disco · Jornada/Post · esfuerzo S · verificado · no cambia por lote · **CERRADO** `f52472d`

- **Impacto**: 86 MB por hora → 691 MB por jornada de 8 h, **~14 GB al mes por usuario**. Confirmado con
  una reunión real de 111 min: 160 MB. Ninguna ruta del código borra carpetas de reunión; solo se borran
  modelos y `.checkpoints`. El pico en disco al hacer el merge es 2× el segmento.
- **Dónde**: `audio/encode.rs:49-50` (`-b:a 192k`, "increased from 64k") ·
  `audio/incremental_saver.rs:181` (borra solo `.checkpoints`).
- **Qué pasa**: el audio **nunca sube a la nube**: el análisis consume solo texto. Se conserva en
  estéreo L/R para la atribución de hablantes, y eso no depende del bitrate.
- **Cambio**: `-b:a 64k` (AAC-LC estéreo sigue limpio para voz, −67 %) y un ajuste de retención que
  borre `audio.mp4` N días después de que la conversación esté sincronizada y analizada.
- **Riesgo**: expectativas de reproducción local; la transcripción no lo usa. Si se adopta el lote,
  **medir WER antes de bajar el bitrate** (la transcripción saldría del AAC decodificado).

### #28 · Pool de SQLite sin ajustar: 10 conexiones y `synchronous FULL`
`Bajo` · RAM/Disco · Post · esfuerzo S · no cambia por lote · abierto

- **Impacto**: hasta 10 × 2 MB de page cache si el pool se abre en abanico (worker, drain y comandos UI
  abren 3-4 a la vez); un fsync por commit en el cierre de segmento.
- **Dónde**: `database/manager.rs:39` (`SqlitePool::connect` con defaults de sqlx).
- **Cambio**: `SqlitePoolOptions::new().max_connections(4)` y `synchronous(Normal)` — WAL ya está
  activo y NORMAL es igual de durable en WAL. **Riesgo**: ninguno con WAL.

### #29 · Gemma 1B se descarga sin consumidor; un 4B instalado desde Ajustes nunca se puede cargar
`Bajo` · Disco/Red · Arranque · esfuerzo S · **desaparece por lote** · abierto

- **Impacto**: 1 GB de disco y de red por instalación que nada carga; 2.4 GB del 4B desperdiciados y
  tips LLM que fallan en silencio en esos usuarios.
- **Dónde**: `summary/summary_engine/commands.rs:359-372` (recomienda 1B en todo Windows) ·
  `coach/llama_engine.rs:444-475` (candidatos 4B y qwen, nunca 1B fuera de Low) · `coach/setup.rs:251-257`
  (descarga a `models/llm`) vs `coach/llm_service.rs:216` (resuelve solo `models/summary`).
- **Qué pasa**: el onboarding baja el 1B; el coach en Medium/High pide el 4B; el 4B manual va a otra
  carpeta que el servicio no mira.
- **Cambio**: añadir el 1B como último candidato en Medium/High (y así el timeout de 30 s es alcanzable)
  o no descargar Gemma en Windows; resolver la ruta una sola vez con `llama_engine::model_file_path`.

### #30 · El helper crea un `LlamaContext` por request y re-decodifica ~2,000 tokens en cada tip
`Bajo` · CPU/RAM · Jornada · esfuerzo M · **desaparece por lote** · abierto

- **Impacto**: KV cache y buffers (109 MB en 1B, 570 MB en 4B a n_ctx 4096) asignados y liberados por
  tip; 850 tokens de prefijo de sistema recalculados cada vez. El timeout de 30 s es **estructuralmente
  inalcanzable** con el 4B en CPU (60-120 s por tip).
- **Dónde**: `llama-helper/src/main.rs:199-209` y `:132-138` · `coach/llm_service.rs:39-44` (n_ctx 4096,
  timeout 30 s) · `coach/prompt.rs:39-90` (2,797 bytes de sistema).
- **Cambio**: contexto persistente por modelo con caché de prefijo; n_ctx del coach a 3072; una sola
  Generate en vuelo (`Semaphore(1)`).
- **Riesgo**: recrear el contexto cuando cambie `context_size` entre coach (4096) y resumen (8192).

### #31 · El workspace ignora el `[profile.release]` del helper y el `[patch.crates-io]` de cpal
`Medio` · CPU/Disco · Arranque · esfuerzo S · verificado · no cambia por lote · **CERRADO** `6f46f9f`

- **Impacto**: ambos binarios se compilan con los defaults de Cargo (sin LTO, 16 codegen-units, sin
  strip): exe de 72 MB, NSIS de 26.5 MB. Y `Cargo.lock` resuelve **cpal 0.15.3 desde crates.io**, no la
  rev `51c3b43` del fork que el manifiesto cree usar: **el backend de audio en producción no es el que
  se pineó**.
- **Dónde**: `Cargo.toml` (raíz): sin `[profile.release]` ni `[patch]` ·
  `frontend/src-tauri/Cargo.toml:294-296` (`[patch.crates-io]` ignorado por no ser raíz) ·
  `Cargo.lock:1131-1134` · `llama-helper/Cargo.toml:19-22` · `llama-helper/src/main.rs:159`
  (`n_gpu_layers 999`) · `.github/workflows/build-windows.yml:646` y `:677`.
- **Qué pasa**: Cargo solo honra profiles y patches del paquete **raíz** del workspace. Además el
  feature de GPU del binario principal lo decide `auto-detect-gpu.js` en la máquina que compila.
- **Cambio**: mover `[profile.release]` y el `[patch]` a la raíz; **antes, decidir a conciencia si se
  quiere el fork de cpal, porque cambiará el audio**. Fijar `TAURI_GPU_FEATURE` en el skill `/build` y
  en CI.
- **Riesgo**: activar el patch cambia el backend de audio real: probar captura y hot-swap. Mantener
  `panic = "unwind"` por los hooks de Sentry y `telemetry/panics.rs`.
- **CORRECCIÓN al remedio (09-sep)**, cuatro hechos que el hallazgo no tenía:
  1. **El patch nunca aplicó en Maity**: la línea y el `Cargo.toml` raíz nacen en el MISMO commit
     inicial (`dbc1bc7`, 2026-01-29, herencia de Meetily). Todo release 0.2.0..0.2.58 lleva cpal
     0.15.3 de crates.io: "el backend de audio en producción no es el que se pineó" es cierto, pero
     el pineado jamás existió como binario. La rev `51c3b43` es master de RustAudio/cpal del
     2025-02-16, sin release, versión 0.15.3 y `windows 0.54`; su único cambio con nombre es #946
     (CoreAudio macOS, `supported_output_configs` en salidas no default); el resto son once meses de
     master. **Se RETIRÓ, no se activó** (decisión de Julio tras explicación): cambiar el WASAPI real
     de Windows sin beneficio. Subir cpal a 0.16+ (trae #946; 0.18.2 exige rust 1.85 y `windows
     0.62`) es tarea aparte.
  2. **`strip = "symbols"` no va**: en MSVC los símbolos viven en el `.pdb` (el exe no encoge) y en
     macOS/Linux quita la tabla de símbolos, dejando los stack traces de Sentry
     (`attach_stacktrace(true)`) como direcciones; rustc lo desaconseja para apps con crash reporting.
  3. **CI ya pasaba `--features vulkan` explícito** (build-windows.yml); el hueco real era el `/build`
     local (auto-detect: `nvidia-smi` sin CUDA Toolkit → CPU) y la divergencia entre canales: los
     releases reales (NSIS vía `/build`, MSIX vía `/store-msix`) siempre fueron CPU, app y helper, y
     CI compilaba app+helper con Vulkan en unos workflows y helper CPU en otros. Con helper CPU,
     `n_gpu_layers(999)` era inerte para todos los usuarios. Decisión: **CPU explícito en todos los
     canales** (Windows/Linux; macOS sigue metal/coreml), `TAURI_GPU_FEATURE` fijado en `/build`.
  4. `TAURI_GPU_FEATURE=""` (receta de BUILDING.md) caía en auto-detect por truthiness.
- **Cierre** (`6f46f9f`): `[profile.release]` en la raíz con `lto = "thin"`, `codegen-units = 1`,
  `panic = "unwind"`, sin strip (thin y no fat: link paralelo, sin riesgo de OOM con 15 GB aquí y 16
  en el runner); bloque del helper y patch borrados; helper con `MAITY_LLAMA_N_GPU_LAYERS` (default
  999, sólo actúa con backend de GPU compilado); `tauri-auto.js` con variable vacía = CPU; skill
  `/build` con `none`/`coreml`; 4 workflows sin vulkan; guard `lint-cargo-workspace.js` (pre-build,
  probado en rojo). **Medido** (release `--no-bundle`): `maity-desktop.exe` 72,254,464 → 63,500,288 B
  (−12 %); `llama-helper.exe` 3,286,528 → 3,271,680 B; cargo release 22 min en frío (recompiló
  todas las crates por el cambio de perfil; no hay línea base en frío del perfil viejo);
  `lint-exe-imports` verde sobre el exe release (el delay-load de #33 sobrevive al LTO);
  `cargo metadata` sin warnings; build debug + smoke OK. Doc: `docs/BUILDING.md` § #31.

### #32 · En Windows ffmpeg se descarga en runtime, en el primer checkpoint
`Alto` · Disco/Red/RAM · Jornada/Post · esfuerzo M · verificado · no cambia por lote · **CERRADO** `6b906a6`

- **Impacto**: ~100 MB de descarga desde gyan.dev **que el usuario nunca aceptó**, desempaquetados en
  287 MB (ffmpeg, ffplay y ffprobe; solo `ffmpeg.exe` se ejecuta). En una red de 3 Mbps son ~5 min con
  el `Lazy` bloqueando a todos los llamadores: cada checkpoint de 30 s que llega ya lleva sus
  11.5-23 MB de muestras → 115-230 MB de RAM inmovilizados, y posible timeout de 300 s al parar.
- **Dónde**: `audio/ffmpeg.rs:1-3` y `:189` · `audio/encode.rs:30` (primer llamador, desde el
  checkpoint) · `tauri.conf.json:137` (`externalBin` solo llama-helper) · `msix_staging`
  (`ffprobe.exe` de 99 MB, sin uso).
- **Cambio**: empaquetar un `ffmpeg.exe` mínimo LGPL para Windows **como ya hace macOS** (solo
  f32le→aac/mp4 y concat `-c copy`, 5-10 MB) vía `bundle.externalBin`. Mientras tanto: resolver
  `find_ffmpeg_path()` al arrancar fuera de la ruta de audio y borrar ffplay/ffprobe tras desempaquetar.
- **Riesgo**: receta de build MSVC/mingw; actualizar el skill `store-msix`, que copia ambos binarios a
  mano.

### #33 · DirectML y D3D12 son imports de carga del exe aunque el motor por defecto corre en CPU
`Bajo` · RAM/CPU · Arranque · esfuerzo S · verificado · no cambia por lote · **CERRADO** `06c6da6`

- **Impacto**: `directml.dll`, `d3d12.dll`, `dxcore.dll` y `dxgi.dll` se mapean en cada arranque (3-8 MB
  de RSS privado estimados, latencia y un toque al driver de GPU); el EP de DML enlazado estáticamente
  son 15-25 MB del exe de 72 MB.
- **Dónde**: `frontend/src-tauri/Cargo.toml:236` · `audio/transcription/onnx_providers.rs:112-121` (DML
  solo para Moonshine y Canary) · `parakeet_engine/model.rs:120` (`prefer_gpu = false`).
- **Cambio**: quitar directml en Windows (solo CPU EP) o dejarlo tras un feature de Cargo.
- **Riesgo**: Moonshine y Canary pierden GPU; ambos son opcionales.
- **CORRECCIÓN al remedio (09-sep)**: "quitar `directml`" **no tiene efecto ni en RAM ni en el exe**. El
  feature es del crate `ort` y solo da cuerpo a `DirectMLExecutionProvider::register()` (sin él devuelve
  `RegisterError::MissingFeature`); qué código entra al exe lo decide el prebuilt de pyke, y para
  `x86_64-pc-windows-msvc` `ort-sys/dist.txt` tiene UNA sola fila sin variante (`none`, 289 MB, hash
  `540D19…`) que ya trae el provider DML compilado (`Dml::DmlGraphFusionTransformer` en
  `dumpbin /symbols`), con `static_link_prerequisites` enlazando `DXCORE/DXGI/D3D12/DirectML`
  **incondicionalmente** en Windows. El exe importaba exactamente 5 funciones (`DMLCreateDevice1`,
  `D3D12CreateDevice`, `D3D12SerializeVersionedRootSignature`, `CreateDXGIFactory2`,
  `DXCoreCreateAdapterFactory`), todas funciones y sin sección delay-load. Lo que sí quita el costo de
  arranque es **`/DELAYLOAD`**, que es lo que hace el propio ORT en su `onnxruntime.dll`
  (`cmake/onnxruntime_providers_dml.cmake`). Los "15-25 MB del exe" **no se recuperan** por ninguna vía
  de features: exigirían un ORT sin `--use_dml` (`ORT_LIB_LOCATION`) o `load-dynamic` + el
  `onnxruntime.dll` CPU-only oficial. Además, el `DirectML.dll` "que no se empaqueta" SÍ viaja en el
  **MSI** (17.7 MB, lo copia `copy-dylibs` de `ort` a `target/debug` y WiX lo recoge); NSIS y MSIX no
  lo llevan, así que dev y producción resolvían DLLs distintos (pyke vs System32) en 0.2.51–0.2.57.
- **Cierre (09-sep)**: `build.rs::configure_windows_delay_load` (`/DELAYLOAD` de los 4 DLLs + `delayimp`
  + `/IGNORE:4199`, `rustc-link-arg` para que cubra también `cargo test`), y de paso DML **opt-in**:
  feature de la app `onnx-directml` (= `ort/directml`), OFF por defecto; el target Windows deja de pedir
  `directml`; `onnx_providers.rs` gatea `use`/`push` con `all(windows, onnx-directml)` y
  `resolve_plan(directml_compiled)` devuelve CPU en Windows sin el feature (Moonshine/Canary a CPU como
  Parakeet, con log explícito). Guard `frontend/scripts/lint-exe-imports.js` (parser PE en Node, en el
  post-build; probado en rojo contra el exe de 0.2.58). Verificado: `dumpbin /dependents` sin los 4,
  `/imports` con los 4 bajo "delay load imports", **0 módulos DX cargados** en login/idle
  (`Get-Process … Modules`, 65 módulos, WS 68 MB), 16 tests, `cargo check --features onnx-directml`,
  build debug + smoke. Exe debug 97.6 → 93 MB, pero la baja es de `cargo clean -p` (incrementales), no
  del cambio. Referencia y checklist para darle GPU a un modelo nuevo: `docs/ONNX_EXECUTION_PROVIDERS.md`;
  reglas en CLAUDE.md § "Motores de Transcripcion".

### #34 · Los segmentos descartados por contenido dejan su carpeta huérfana con el audio dentro
`Medio` · Disco · Post · esfuerzo S · verificado · no cambia por lote · **CERRADO** `f52472d`

- **Impacto**: cada segmento por debajo de 250 palabras (en el piloto, **más de la mitad**) deja
  `audio.mp4` de hasta 130 MB, `transcripts.json` y `metadata.json` en `Music/maity-recordings` sin fila
  en la DB ni entrada en la UI. Nadie los borra.
- **Dónde**: `scheduled_recording/service.rs:1107-1114` (Discarded sin tocar la carpeta) ·
  `RecordingPostProcessingProvider.tsx` (marca guardado, no borra).
- **Cambio**: `remove_dir_all(folder)` al devolver `Discarded`, o conservar el audio detrás de un
  ajuste; la telemetría ya lleva `words_total`.
- **Riesgo**: decisión de producto sobre conservar audio de segmentos sin conversación.
- **Cierre (04-sep, dentro de #27)**: `scheduled_recording/service.rs` llama
  `audio_retention::remove_audio_artifacts(&folder)` justo después de `emit_segment_discarded` y antes
  de devolver `SegmentOutcome::Discarded`: borra `audio.mp4` y `.checkpoints/` (lo que pesa) y parchea
  `metadata.json` (`audio_file: ""` + `audio_deleted_at`). Es el único punto donde todavía se sabe
  dónde está la carpeta: el descarte retorna antes de tocar SQLite, así que nunca hay `folder_path` y
  el barrido periódico de #27 no la vería jamás. Test:
  `remove_audio_artifacts_borra_audio_y_checkpoints_conservando_los_json`.
- **CORRECCIÓN al remedio**: NO se usa `remove_dir_all(folder)`. Se conservan `transcripts.json` y
  `metadata.json` (unos KB) como rastro auditable de por qué se descartó, y porque el filtro de
  fantasmas del frontend nunca toca disco: borrar la carpeta entera le quitaría su red de seguridad.
  Tampoco consulta `audio_retention_days`: aquí se borra aunque el usuario haya elegido "nunca
  borrar", porque ningún otro camino puede volver a encontrar ese audio (por eso la opción de la UI
  dice "de las reuniones **guardadas**"). La "decisión de producto" del riesgo ya está tomada y
  documentada en CLAUDE.md § "Umbral de contenido de la jornada".

### #35 · Dos pilas HTTP/TLS, crates duplicados y dependencias muertas
`Bajo` · Disco/CPU · Arranque · esfuerzo S · no cambia por lote · **CERRADO** `a3a0881`

- **Impacto**: reqwest 0.12 y 0.13 (plugin updater), rustls 0.22 y 0.23, dos rustls-native-certs, cuatro
  versiones de windows-sys, clap v3 y v4, zip 2 y 4: 3-6 MB de exe estimados, dos cargadores de root
  store y compilaciones más largas. `clap`, `esaxx-rs` y `symphonia` no tienen un solo call site;
  `@remirror` y `@tiptap` (12 paquetes npm) tienen cero imports.
- **Dónde**: `frontend/src-tauri/Cargo.toml:75`, `:155-156` · `cargo tree -d` · `frontend/package.json`.
- **Cambio**: reqwest a 0.13, sentry con rustls 0.23, nnnoiseless sin default-features, borrar clap,
  esaxx-rs, symphonia y los paquetes remirror/tiptap.
- **Riesgo**: reqwest 0.13 renombró los flags de TLS.
- **CORRECCIÓN al diagnóstico (09-sep)**: `rustls 0.22` no venía sólo de sentry 0.34 (que sí la
  declaraba directo) sino también de **tokio-tungstenite 0.21**, con su propia pila (tokio-rustls
  0.25, rustls-native-certs 0.7, rustls-webpki 0.102, webpki-roots 0.26); `reqwest 0.13` lo traía
  únicamente el updater, y el `reqwest 0.12` nuestro estaba además en `[build-dependencies]` sin que
  `build.rs` lo use. Y "reqwest a 0.13" no es un bump: 0.13 renombró `rustls-tls` → `rustls` **y esa
  feature enciende aws-lc-rs** (un segundo proveedor criptográfico junto a ring), borró las
  `*-native-roots`/`*-webpki-roots` (siempre `rustls-platform-verifier`, el verificador del SO, el
  mismo que ya usaba el updater 2.10), y con `rustls-no-provider` reqwest 0.13.5 **no** cae al
  proveedor de las features del árbol: `Client::build()` hace panic si nadie instaló uno (así falló
  `el_cliente_compartido_se_construye` al subir). sentry 0.49 además volvió `ClientOptions`
  `#[non_exhaustive]` (sólo builder).
- **Cierre (09-sep)**: sentry 0.34 → 0.49 y tokio-tungstenite 0.21 → 0.30 (ambos sobre rustls 0.23 con
  `default-features = false`), reqwest 0.12 → 0.13 con `rustls-no-provider` (sin `multipart`, cero
  usos; sin `system-proxy`, que cambiaría el comportamiento del proxy), `rustls 0.23` directo sólo
  para `api::http::install_crypto_provider()` (ring, `Once`, llamado desde `main` antes de
  `init_sentry` y desde el `Lazy` del cliente compartido), zip 2 → 4 (sólo `deflate`), dirs 5 → 6,
  winreg 0.52 → 0.56 (último ancla de windows-sys 0.48), nnnoiseless sin default-features (su `bin`
  arrastraba clap 3 + hound); borrados clap, esaxx-rs (+ su `[patch]`), symphonia, el reqwest de
  build-deps y los 12 paquetes `@remirror/*`/`@tiptap/*`. Resultado: **751 → 667 crates** en el
  árbol, exe debug 100.9 → 97.6 MB, `cargo tree -d` sin reqwest/rustls/tokio-rustls/webpki/zip/dirs/
  clap y sin windows-sys 0.48; `cargo tree -i aws-lc-rs` vacío. Guard:
  `frontend/scripts/lint-cargo-deps.js` en el pre-build (probado en rojo por los dos caminos). Reglas
  en CLAUDE.md § "Dependencias Rust: una sola pila TLS". Quedan fuera (no son S): `windows
  0.54/0.57/0.58/0.61` (cpal, sysinfo, WASAPI propio, tauri) y `windows-sys 0.59-0.61`; `rand` ×4 lo
  ancla `phf_generator` (build-deps de html5ever) y subir el nuestro no elimina versiones.

---

## Plan por fases

Lo que ya está en main se publica primero porque es lo que más devuelve por cero esfuerzo adicional.

### Fase 0 — ya en main, sin release
- Tier Low sin LLM del coach y sin descarga de Gemma.
- Back-off del scheduler por causa (fin de las 965 filas por día).
- Umbral de 250 palabras, `started_at` sellado, tope de 90 min.
- **Además, cerrado el 2026-09-02**: #05, #07 y #08.

> Recupera ~1 GB de RSS en el 55 % del parque y elimina 55 reinicios de sidecar por cada 62 sesiones.

### Fase 1 — cambios S, un ciclo
`trim_start_silence()` en el VAD fuera de voz (#1) · precarga de Parakeet y warmup del sidecar solo con
sesión (#2, #4) · latch en la tormenta de `snapshot_now` (#13) y muestreador sin `disk_usage` (#14) ·
idle-kill del sidecar desacoplado del breaker (#3) · filtro `ort=warn` y consola solo en debug (#19) ·
polls del frontend (#15) · cliente HTTP compartido (#20), poda de `sync_queue` (#26), perfil y patch a
la raíz del workspace (#31) · borrar la carpeta de los segmentos descartados (#34); resolver ffmpeg al
arrancar y borrar ffplay/ffprobe (#32).

> Quita el crecimiento de hasta 700 MB por segmento, unos 600 MB en reposo antes de grabar y 190 MB de
> binarios muertos en disco.

### Fase 2 — cambios M
Descarga de Parakeet en reposo fuera de la ventana de jornada y recarga desde el tick del scheduler
(#2) · reciclado drop-then-load e inferencia en `spawn_blocking` (#2, #16) · ventana principal "dormida"
al ocultar (#6) · política de presión de memoria con acciones (#22) · latido de salud emitido desde Rust
por el outbox (punto ciego) · ffmpeg mínimo LGPL empaquetado en Windows (#32); retención de audio con
borrado diferido (#27).

> Presupuesto objetivo en tier Low grabando: **~700 MB** contra ~1 GB hoy y ~2 GB en 0.2.57; disco de
> 0.7 GB por día a 0.23 GB y con caducidad.

### Fase 3 — decisiones de producto
Coach-float cerrado mientras la main está oculta (#7) · hilos del VAD y spin de ORT: medir RTF antes y
después (#12) · bitrate 192 → 64 kbps (#27) · activar o retirar el fork de cpal (#31) · borrar
`/meeting-details` y su árbol BlockNote/tiptap (#24) · **transcribir la jornada por lote** (abajo).

> Cada punto necesita una medición o una decisión explícita antes de tocar código.

---

## Alternativa: transcribir la jornada por lote

La pregunta que reordena el plan: **qué pasaría si la jornada dejara de forzar a Parakeet en tiempo real
y transcribiera cada hora al cerrar el segmento, sin transcript en vivo.** De los 35 hallazgos, 6
desaparecen, 7 se encogen y 22 no cambian; pero los que desaparecen son los más pesados del día.

### Hoy (streaming)
1. Micrófono y sistema entran al pipeline cada 10 ms.
2. El VAD de Silero corta tramos de voz al vuelo, en dos canales.
3. Cada tramo va a Parakeet de inmediato: **el modelo vive en RAM las 9 horas**.
4. El transcript se pinta en la ventana, aunque esté oculta en la bandeja.
5. El coach lee ese transcript y pide tips al sidecar.
6. Al cerrar la hora se guarda lo transcrito y se sube.

> Todo corre a la vez que la captura. En tier Low son ~1 GB de RSS durante toda la jornada.

### Por lote (al cerrar el segmento)
1. Durante la hora, Maity solo captura y guarda checkpoints de 30 s. **Ya lo hace hoy.**
2. Al cerrar el segmento carga Parakeet, transcribe la hora desde el audio saltando el silencio con una
   compuerta de energía, y **lo descarga**.
3. Cuenta palabras, decide si el segmento vale, guarda y sube.
4. Sin transcript en vivo ni tips durante la hora.

> Captura sola: ~80 MB. El lote concentra el costo en 3 a 25 minutos por hora y el resto del tiempo la
> máquina queda libre.

### Presupuesto de RAM en tier Low grabando

Estimación a partir de la telemetría y del código; **el pico del lote necesita medirse**.

| Componente | Hoy | Por lote |
|---|---:|---:|
| Rust en reposo grabando | ~650 MB | ~80 MB |
| VAD de Silero en silencio | 0 a 700 MB por segmento | 0 |
| Sidecar LLM (Medium y High) | 1.2 a 3 GB intermitentes | 0 |
| Pico del lote por hora | no aplica | ~700 MB durante 3 a 25 min |

### Qué se mueve

- **Desaparecen por construcción (6)**: el buffer de silencio del VAD (#1), la tormenta de
  `snapshot_now` (#13), y toda la familia del sidecar: idle-kill contra breaker (#3), warmup al arranque
  (#4), contexto por request (#30) y Gemma sin consumidor (#29). **Los tips LLM viven del transcript en
  vivo; sin él, el sidecar no tiene razón de existir durante la grabación.**
- **Se encogen (7)**: Parakeet residente (#2) pasa a cargarse por lote y descargarse, pero hay que
  escribirlo. Los hilos del VAD (#12) y la inferencia en el runtime (#16) salen de la ventana de
  grabación. Dos de los tres canales sin límite (#9). De los polls (#15), la ventana oculta (#6) y el
  log (#19) se va lo ligado al transcript.
- **No cambian (22)**: WebView2 y el coach-float (#7), la lista de conversaciones (#5), el encoder de
  checkpoints (#8), el muestreador (#14), ffmpeg en runtime (#32), el audio sin retención (#27), el
  patch de cpal (#31) y todo lo de disco, red y build.

### Lo que cuesta y los riesgos nuevos

- **El lote compite con la siguiente hora de grabación.** A RTF 0.39, una hora de audio son 23 min de
  CPU; con compuerta de energía sobre los checkpoints, en una jornada típica del piloto serían 3 a
  7 min. Se puede diferir a después de las 18:00 si el análisis puede llegar al final del día.
- **Cargar Parakeet tiene un pico transitorio cercano a 1.3 GB** mientras ORT parsea el modelo. Un pico
  así cada hora en una máquina de 5 GB **puede ser peor que la residencia constante**: medirlo, y cargar
  solo sin presión de memoria. La política de presión (#22) deja de ser opcional.
- **El audio pasa a ser la única fuente de verdad.** La pregunta abierta de las carpetas de jornada con
  8 KB de audio por hora tiene que resolverse antes: si los checkpoints fallan en silencio, hoy
  sobreviven los transcripts y mañana no sobrevive nada.
- **Se pierde el panel en vivo y los tips que leen texto.** Los heurísticos basados en niveles de audio
  (proporción de habla, monólogo) pueden seguir. Falta confirmar cuáles del coach dependen del texto.
- **La transcripción sale del AAC decodificado** en vez del PCM crudo. A 96 kbps o más no debería
  notarse; a 64 kbps conviene medir WER antes de bajar el bitrate (#27).

### Recomendación: modo por disparador, no un cambio global

La jornada del scheduler arranca sin ventana, nadie mira el transcript y el valor llega al final con la
minuta y el análisis. **Ahí el lote es la arquitectura correcta**: paga el mismo costo total de CPU,
pero concentrado en unos minutos por hora, y sin nada residente el resto del tiempo. La grabación manual
con el coach abierto es el caso donde el usuario paga voluntariamente el pipeline en vivo, y puede
seguir en streaming.

**Prerrequisitos**: checkpoints fiables y el pico de carga de Parakeet medido en una máquina de 5 GB.

---

## Verificado y en orden

Lo que se revisó y **no** necesita cambio, para no volver a auditarlo.

- El audio completo del segmento no vive en RAM: la mezcla estéreo se vuelca a un checkpoint AAC cada
  30 s y el `audio.mp4` final es un concat con `-c copy`, sin recodificar.
- El ring buffer de mezcla, los buffers de staging del VAD y la cola del worker (256 × ≤384 KB) están
  acotados con drop-oldest.
- Solo un modelo STT queda residente por defecto; Whisper, Moonshine y Canary son perezosos. RNNoise
  está apagado.
- Las 79 líneas de "DeviceBasedPartition" del log son subgrafos de **una misma** construcción de sesión
  ONNX (ráfagas en el mismo milisegundo), no 79 sesiones.
- El estado de transcripción del frontend está acotado a 500 items, virtualizado y con dedup por `Set`;
  IndexedDB se limpia a los 7 días.
- Los listeners de Tauri pasan por grupos con unlisten seguro; un `emit` broadcast no cuesta nada en
  ventanas sin listener.
- Runtime de tokio por defecto, sin bucles de espera activa; el trabajo de proceso va en
  `spawn_blocking`. `perf_debug!` compila a nada en release.
- Cloud sync y drenador de telemetría no giran sin sesión; back-off exponencial con tope de 15 min.
  PostHog es un stub sin autocapture.
- La rotación es secuencial: nunca conviven dos pipelines, dos workers de Parakeet ni dos concat.
- Sin recursos remotos en runtime: fuentes autohospedadas, sin video ni audio montados, iframe de
  YouTube solo en el registro.
- El audio **nunca sale de la máquina** ni se vuelve a leer entero: a la nube viajan solo JSON de
  transcripts e ids; cero lecturas de `audio.mp4` ni base64 en el código embarcado.
- Las descargas de Parakeet y Gemma reanudan con Range y verifican sha256; la guarda de descargas
  activas es atómica.
- Todo el grafo de Windows va sobre rustls (sin OpenSSL ni native-tls); sqlx compila solo sqlite; tokio
  no lleva full; whisper-rs es CPU-only en los builds locales.

---

## Mediciones pendientes

Lo que hay que medir en una laptop de 6 GB antes de cerrar cifras.

- Delta de RSS de la precarga de Parakeet y pico del reciclado (ya hay `snapshot_now("onnx-recycle")`).
  **Procedimiento (F0c del modo lote, sep-2026)** — es el gate de la Fase 2 del lote (calibra el
  `BATCH_HEADROOM_MB` del planner): en una máquina de 5-6 GB, repetir 5 veces el ciclo login → logout y
  leer del log rotativo los `[METRIC] mem-sample` etiquetados `stt-warm` (post-carga) y `stt-unload`
  (post-descarga). Registrar (a) el **delta estable** de `app_rss_mb` entre unload y warm (residencia
  del modelo) y (b) el **pico transitorio**: el máximo de `app_rss_mb` en los samples `periodic` de los
  ~60 s posteriores al `stt-warm` (ORT parsea el modelo con buffers temporales; la estimación de la
  sección "por lote" es ~1.3 GB). Si el pico real ≥ 1.3 GB, el headroom del planner se fija en
  pico + 300 MB; si durante la carga aparece `[MEM] pressure-level: normal->elevated` (#22, ya
  implementado), anotarlo — es la evidencia de que cargar por hora sin gate sería peor que la
  residencia constante.
- Sierra de `session_audio` del VAD en una jornada tranquila: debería verse como +4 MB/min por canal en
  los `[METRIC] mem-sample` de los pilotos.
- Reparto de RSS de WebView2 entre ventana principal oculta, coach-float y device-picker.
- CPU real del renderer del coach-float a 10 Hz con y sin `backdrop-filter`. *(El #07 ya quitó el blur;
  la medición sirve ahora para cuantificar la ganancia.)*
- Costo de `refresh_processes` en una máquina con 300+ procesos.
- Tokens por segundo del helper con 1B Q8 y 4B Q4 a 2 hilos; si iSWA está activo en la llama.cpp
  pineada.
- Si `hide()` produce `visibilityState = hidden` en WebView2 y cuándo entra el throttling intensivo.
- **Posible bug de rotación**: `SEQUENCE_COUNTER` se reinicia por sesión pero el frontend solo limpia
  `seenSequenceIds` en el arranque manual; el panel en vivo podría congelarse tras la primera rotación.
- Carpetas de jornada de esta máquina con 8 KB a 21 MB de audio por hora (12 de 20 sin transcripts):
  ¿el encoder AAC comprime el silencio o fallan checkpoints en silencio? ~~`incremental_saver.rs`
  solo avisa y salta el archivo ausente, **sin telemetría**~~ — **instrumentado en la F0a del modo
  lote (sep-2026)**: `finalize()` devuelve un `FinalizeReport` y `stop_and_save` emite
  `audio.checkpoint_integrity` cuando hay checkpoints perdidos, encodes con error o un merge <100 KB
  con ≥4 checkpoints (la firma exacta de estas carpetas). Falta esperar datos de campo para responder
  la pregunta.
- Con qué features de GPU se compiló el `setup.exe` publicado en GitHub: la selección depende del
  entorno de la máquina que compila (#31). Revisar sus imports.

---

## Método

Consultas sobre `maity.platform_logs` (heartbeat, `device.profile`, `coach.session_summary`,
`recording_stopped`); cinco auditorías de código en paralelo (audio y STT, tareas de fondo Rust, coach y
sidecar, frontend, post-procesado y build); verificación manual de las líneas citadas en los hallazgos
de mayor peso.

Los porcentajes de CPU son **estimaciones a partir del código**: la telemetría no mide CPU por proceso
(punto ciego nº 2).
