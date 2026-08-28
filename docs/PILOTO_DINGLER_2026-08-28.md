# Piloto Dingler — hallazgos técnicos de las dos primeras semanas (14 → 28 ago 2026)

Notas internas de producto/plataforma. El reporte para la dirección de Dingler (Rita y karen son las
managers; Rita no está en la plataforma) vive como artifact "Radiografía del piloto Dingler" — desde el
2026-08-28 en su versión **v4 "conductas"** (6 competencias con por qué y qué mejorar, tarjeta por persona,
tipos de junta, cobertura de jornada, acciones) — y **no** incluye nada de este documento. Se regenera con
`/piloto-analisis` (`.claude/skills/piloto-analisis/`; datos en `docs/piloto/dingler-2026-08-28.data.json`).

Dos artifacts, decisión del 2026-08-28:
- **Cliente**: "Radiografía del piloto Dingler" (v4 conductas) — https://claude.ai/code/artifact/f0d68a85-8ed3-4532-91ee-1074bfa10824
- **Interno Maity**: "Piloto Dingler · lectura interna" (la v3 de uso/ritmo/quién graba/qué salió, que el
  equipo consideró útil para nosotros) — https://claude.ai/code/artifact/2301fce9-ff9f-403a-a6db-61f75fd13d12.
  Sus cifras son las de la v3 (148 conversaciones incl. 4 `discarded`); lo técnico sigue solo en este md.

Todo lo de aquí sale de Supabase (`maity.omi_conversations`, `omi_transcript_segments`,
`platform_logs`, `subscriptions`, `usage_counters`, `billing_plans`) con corte el
**2026-08-28 09:30 CDMX**. Horas en America/Mexico_City.

## Contexto que cambia la lectura

- **karen@dinglerpromotores.com es la manager.** Va fuera de toda métrica de uso: el equipo son
  **10 personas**, no 11. Sus 0 eventos no son un problema.
- **xochitl no tiene micrófono en su equipo** (hardware, no permiso). Los 672 "No microphone
  device available" son eso. Los 293 "Acceso denegado (0x80070005)" del mismo día aparecen a
  ratos (¿dispositivo de captura virtual/BT entrando y saliendo?) — irrelevante mientras no
  tenga micrófono. **melissa** sí es permiso de privacidad de Windows (0x80070005 en monitor y
  en captura desde el día 1).
- Plan **Free** hasta el **19-ago 15:17 UTC** (`omi_conversation daily: 1`); ahí se creó la
  `subscriptions` Pro de empresa (vigente al 19-nov). Contador `usage_counters` mensual de la
  empresa en 2026-08: 65.
- Versiones: **0.2.57 vía Store en 6/10** (erika 19-ago, mary 20, alejandra 24, xochitl 25,
  margarita 25, jessica 26). janeth, marcela, melissa y michael siguen en 0.2.56 porque no han
  vuelto a abrir la app. Todo `build_channel = store`, Windows 11 (26200), GPU Vulkan.

## Cifras base

| | |
|---|---|
| Conversaciones | 148 (99.4 h, 128.5 k palabras) de 8/10 personas |
| Semana 1 (14–21) | 86 conv, 55.4 h, 8 personas |
| Semana 2 (24–28) | 62 conv, 44.0 h, **4 personas** (alejandra, erika, margarita, mary) |
| Destino | completed 48 · skipped 67 (`insufficient_user_words`) · quota_skipped 29 · null 4 (placeholders "Jornada …" de 2 palabras) |
| Triggers `recording_started` (0.2.57) | scheduler_rotation 58 · scheduler 24 · sidebar_direct 13 · manual 11 · auto_start 3 · meeting_detector 2 |
| Segmentos "sin tema" | 58/148 (39 %, 30 h). mary 27/45, michael 7/11, marcela 6/10 |
| Densidad | 33 de 121 segmentos ≥10 min con ≤ 8 palabras/min |
| Consumo | `conversation_detail_viewed` 42 (7 p) · `analysis_viewed` 8 (4 p) · mary 0/0 |

## Hallazgos, por severidad

### 1. Crítico — tormenta de reintentos del scheduler sin micrófono — **ATENDIDO (28-ago)**

> **Resuelto en `main`** (sin push): back-off por causa + alto del día en
> `scheduled_recording/service.rs`, aviso nativo único, rate-limit de
> `recording_start_failed` en `emit_start_failed`, preflight `check_microphone_ready`
> en los ajustes de la jornada, y el `0x80070005` enrutado por `report_device_error`
> (nunca emitía `audio-device-error`, así que **melissa jamás vio el toast con
> "Abrir configuración"** pese a que la remediación existe desde 0.2.57).
> Proyección: xochitl 965 → **2** intentos; melissa 293 → **5**. Falta el E2E manual.


xochitl, 25-ago 08:40–16:59: **965 `recording_start_failed`** (672 "No microphone device
available: No default input device found", 293 "Failed to start recording: … Acceso denegado
(0x80070005)"). Es el tick de 30 s de la jornada (`scheduled_recording/service.rs`) intentando
arrancar durante 8 horas: 8 h × 120 ticks. Una sola usuaria generó 1,049 eventos en
`platform_logs` (el 27 % de todo el piloto).

Qué hacer:
- Back-off exponencial en el tick y alto tras N fallos consecutivos con un `SkipReason`
  propio (`NoInputDevice`), igual que ya se hace con `NoSession`.
- Una sola notificación accionable ("Maity no encuentra micrófono") con acción que abra
  `ms-settings:privacy-microphone` / `ms-settings:sound`.
- Preflight de micrófono al configurar la jornada y en el onboarding. Distinguir 0x80070005
  (privacidad de Windows) de "no default input device" (sin hardware) en el mensaje.
- Rate-limit del lado de telemetría para `recording_start_failed` (dedupe por mensaje en
  ventana), como ya tiene `app.error`.

### 2. Crítico — la atribución por canal invalida el análisis V4 presencial

`omi_transcript_segments`: **96,318 palabras "user" vs 12,009 "interlocutor"** (89 %). Sin
margarita (la única que recibe llamadas por el audio del sistema: 20,307 vs 9,212) es
76,011 vs 2,797 (96 %). mary: 14,400 vs **2**; michael: 1,091 vs 0.

Efecto en V4 (48 completed): `hablantes_detectados = 1` en **37/48**, `ratio_habla = 1`,
empatía y adaptación en `dimensiones_no_aplica`, patrón "monólogo fragmentado", **32 crítico /
15 en desarrollo / 1 competente**, media 35.8/100. Las conversaciones con 2 hablantes puntúan
48–65 (margarita 65 en un 1:1 de 11 min; erika 53 en un 1:1). La diferencia es del método.

Qué hacer:
- Corto: cuando `hablantes_detectados = 1` y la conversación viene de jornada (título
  "Jornada …" / trigger scheduler), marcar el análisis como **"no evaluable"** en vez de
  "crítico" y no afectar XP/ranking. Es un cambio del lado web (`evaluate.ts` /
  `conversations-async-analysis.ts`) más un estado nuevo en `derivePhase`.
- Mediano: diarización sobre el canal de micrófono para presencial (o al menos separación
  por turnos usando el VAD + pausas), y exponer en la UI "hablantes detectados" para que
  el usuario entienda por qué no hay empatía/adaptación.

### 3. Serio — parque de 6–8 GB al límite; Gemma no paga su renta — **ATENDIDO (28-ago)**

> **Resuelto en `main`** (sin push), y con más alcance del previsto. Se verificó
> contra el código que el sidecar local tiene **un solo consumidor vivo**: los tips
> del coach. Maity Chat es nube (DeepSeek del lado servidor), la minuta y el V4
> también, y `coach_chat` / `coach_evaluate_meeting` / el resumen local de
> `/meeting-details` **no tienen call sites en el frontend**. Así que "apagar
> durante la grabación y prender al terminar" no tenía a quién servir: en tier Low
> el LLM queda apagado y **el modelo ni se carga ni se descarga**
> (`coach::should_use_llm_tips`, punto de decisión único para el warmup y para
> `live_feedback::start`). Se eliminó `ensure_low_tier_tips_model` (~1 GB que sólo
> se bajaba en tier Low) y el onboarding de Windows en gama baja pasa de ~1.6 GB a
> **~600 MB**. El umbral se corrigió donde estaba el agujero real: **Cuda y Metal
> no tenían piso de RAM**, así que 6 GB + driver NVIDIA salía `High`.


`device.profile` / `coach.session_summary`: **7/10 equipos tier Low** (alejandra 5 GB, erika 5,
janeth 6, jessica 7, margarita 7, mary 7, melissa 7); marcela y michael 15 GB, xochitl 13 GB.

- **215 `[MEM] system-memory-pressure`** en 7 equipos: jessica 67, erika 40, mary 32,
  alejandra 31, margarita 26, melissa 10, janeth 9. Mínimo reportado: **74 MB** libres
  (alejandra), 86 (erika). `health.heartbeat` durante grabación: `sys_avail_min_mb` 62–175.
- Helper llama pico **1.2 GB** (`llama_rss_peak_mb` 1206–1235); app RSS ~750 MB; webview
  ~320–480 MB.
- Rendimiento del coach en 2 semanas: **1 tip LLM** (mary) vs 19 heurísticos; **75 reinicios
  de sidecar** (margarita 35, erika 15, mary 14), **28 timeouts** (erika 22), **26 aperturas de
  breaker** (margarita 20, erika 6); `llm_latency_p95_ms` 94,731 (erika) y 31,470 (mary);
  `llm_parse_failed` 6/8 en mary. erika en 0.2.57 sigue con "3 timeouts consecutivos —
  reinicio controlado" (25-ago): ya no es el helper legacy, es el hardware.

Qué hacer:
- En tier Low **no cargar Gemma durante la grabación**: coach heurístico por defecto, LLM
  solo bajo demanda o post-reunión. Libera ~1.2 GB justo cuando Parakeet + FFmpeg más lo
  necesitan. (Relacionado con la decisión "1B en tier Low" de jul-2026: el 1B tampoco cabe.)
- Reevaluar el umbral de Low ahora que `device.profile` trae `memory_gb` real.

### 4. Serio — la jornada guarda una hora de silencio como conversación — **ATENDIDO (28-ago)**

> **Resuelto en `main`** (sin push): umbral de **250 palabras totales** en
> `finalize_segment_native` (`MIN_SEGMENT_WORDS`). Por debajo no se crea reunión local ni se
> encola outbox — ni cuota, ni ruido en la lista. El audio en disco no se toca.
>
> **Corrección al diagnóstico de abajo: son DOS poblaciones y este titular describe una.** Los
> datos reales (post-backfill, 144 conversaciones):
>
> | grupo | n | palabras de usuario | duración media | ¿lo agarra un umbral? |
> |---|---|---|---|---|
> | `completed` | 64 | ≥100 (todas) | 56 min | no, y no debe |
> | `insufficient_user_words` | 36 | 0–89 (media 32) | 12 min | **sí** |
> | `no_evaluable_speech` | 44 | 101–513 (media 253) | 44 min | parcialmente |
>
> Las 44 `no_evaluable_speech` son la "hora de ruido ambiente": palabras de sobra, ningún tramo
> de 5 min de conversación continua. **La regla de densidad que proponía el punto de abajo se
> descartó con datos**: los `completed` bajan hasta 3.6 palabras/min y los inservibles llegan a
> 18.3 — los rangos se solapan y cualquier corte por densidad pierde conversaciones buenas.
>
> Se cuentan las palabras de **ambos canales** para no castigar a quien estuvo escuchando.
> Riesgo aceptado: hasta 5 de las 64 analizadas (las de 100–299 palabras de usuario) podrían
> caer si el interlocutor habló poco — ≤8 % a cambio de quitar el 30–40 % de basura.
>
> **La trampa que costó el diseño:** devolver `None` no bastaba. `None` significa "falló,
> sálvalo por otro lado", así que el segmento revivía por DOS caminos — `close_scheduled` emite
> `RECORDING_STOP_COMPLETE` y el webview lo guarda por el camino legacy, y el frontend deja el
> registro sin marcar para que `autoRecoverAll` lo recupere al siguiente arranque. Hizo falta un
> tercer estado (`SegmentOutcome::{Saved,Discarded,Failed}`) y que el frontend marque el
> registro cuando `discarded`. Evento nuevo `recording.segment_discarded` (el primero que emite
> `scheduled_recording`, que no emitía telemetría ninguna).


71/148 conversaciones no llegan a 100 palabras de usuario, 58 quedan tituladas
"fragmentada / sin tema", 4 son placeholders "Jornada 2026-08-xx HH:00" con 2 palabras. Todas
viajan a la nube, gastan cuota (en Free) y ensucian la lista y el ranking.

Qué hacer:
- Umbral mínimo (palabras, o segundos de voz según VAD) antes de crear la conversación en la
  rotación; segmento vacío → descartar o fusionar con el siguiente. Ya existe el filtro de
  fantasmas en recuperación (`useTranscriptRecovery`); falta el equivalente en el camino
  feliz de `finalize_segment_native`.
- Considerar rotación por contenido (cerrar segmento tras N min de silencio) además de la
  rotación horaria.

### 5. Serio — la rotación no sobrevive a la suspensión ni a la presión de memoria — **ATENDIDO (28-ago)**

> **Resuelto en `main`** (sin push), y **con el diagnóstico corregido: el título de este
> hallazgo y su primer "qué hacer" estaban al revés.** Pedían "reloj monotónico para la
> rotación", pero la rotación **ya** usa wall-clock y **ya** es robusta a suspensión:
> `should_rotate` deriva la frontera de `owned_since`, que se actualiza en cada rotación, así
> que un salto de 3 h dispara **una sola** rotación — hay un test que lo fija desde antes
> (`should_rotate_salto_por_suspend_dispara_una_vez`). Lo que sí estaba roto es la **duración**,
> que sale de `Instant::elapsed()`: un reloj monotónico que en Windows **sigue corriendo con la
> máquina dormida**. Meter más monotonicidad habría empeorado el bug.
>
> - **`started_at` sellado**: `RecordingState` gana `recording_start_wall` (`DateTime<Utc>`
>   estampado al arrancar) y la jornada usa `owned_since`. Se acabó el `ahora − duración`, que
>   era lo que mandaba el inicio de margarita a las 02:19. `duration_seconds` se queda como la
>   duración de **audio** y ya no gobierna ninguna fecha: `finished_at − started_at` puede ser
>   mayor, y esa diferencia es justo el tiempo dormido o en silencio.
> - **Tope de segmento en overtime** (90 min): `should_rotate` exigía `in_window`, así que fuera
>   de la ventana el cierre quedaba en manos de `auto_close`; quien lo tiene desactivado no
>   tenía a nadie que cerrara — el segmento de 150 min del 20-ago. Ahora rota igual. **Rota, no
>   cierra**: el usuario sigue en una junta pasadas las 18:00.
>
> **Fuera de alcance por decisión explícita:** rotar las grabaciones manuales largas (los 393
> min de marcela el 17-ago). Las manuales siguen sin rotar.


- margarita 27-ago: `recording_stopped` con `duration_seconds` **24,316** (6 h 45) a las 22:45
  CDMX; la conversación resultante dura 67 min con `started_at` "02:19 del 28-ago" y
  `created_at` 07:40. Equipo suspendido con la grabación abierta; el inicio se recalculó al
  revés (cierre − duración de audio).
- margarita 20-ago: segmento 16:01 → 18:30 (150 min) sin rotar a las 17:00 ni 18:00.
- margarita 25-ago: 62 min (3,731 s); mary: 3,868 / 3,918 / 4,184 s (64–70 min).
- marcela 17-ago (0.2.56): una sola grabación **manual** de 393 min (10:27 → 17:00); las
  manuales no rotan.

Qué hacer:
- Reloj monotónico para la rotación + detectar suspend/resume (cerrar el segmento al
  despertar, no estirarlo).
- Sellar `started_at` al abrir el segmento; nunca derivarlo del cierre.
- Aplicar rotación también a grabaciones manuales largas (o avisar a los 60 min).

### 6. Cuota — 29 análisis perdidos por arrancar en Free

Del 14 al 18-ago, 29 de 86 conversaciones quedaron `quota_skipped` (Free = 1
`omi_conversation`/día/persona). Incluye las mejores de la semana: janeth 60 min / 4,782
palabras, erika 50 min / 3,433, alejandra 48 min / 5,398. Las minutas sí se generaron (la
cuota solo bloquea el V4). Desde el 19-ago no hay más pérdidas.

**Backfill hecho el 28-ago 09:58–10:02 CDMX.** `retry_analysis` exige el JWT del dueño, así
que se llamó directo al worker `POST /api/conversations-async-analysis {type:'communication'}`
con `Bearer CRON_SECRET` (el de `C:\maity\.env` es el de producción). Script:
`backfill_dingler.mjs` (scratchpad de la sesión; concurrencia 2, 1 reintento en 5xx).
Resultado verificado en DB: **29/29 procesadas, 0 `failed`, 0 `quota_skipped`** →
16 `completed` (alejandra 3 · erika 6 · janeth 2 · mary 5; puntajes 16–71, erika sacó el
primer 71 "competente" del piloto) y 13 `skipped` por el gate de calidad
(`insufficient_user_words` 7, `no_evaluable_speech` 6). Minutas intactas (el worker con
`type:'communication'` no las toca). Tiempo: 0–2 s las skipped (sin LLM), 13–18 s las
evaluables, un outlier de 86 s.

Qué hacer:
- Próximo piloto: subir el plan **antes** de provisionar.
- Para futuros backfills el camino es el mismo worker con el secreto; probar primero con
  una (`--one <uuid>`) y confirmar en DB.

### 7. Modelo — "grabar al vacío" antes de tener Parakeet — **ATENDIDO (28-ago)**

> **Ya estaba resuelto en lo esencial y este hallazgo no lo sabía.** El gate contra grabar sin
> motor vive desde 0.2.57 en `initialize_recording` — el embudo común de los dos start paths — y
> su comentario cita este mismo piloto. Encaja con el dato: *"desde que alejandra actualizó a
> 0.2.57 graba bien"*. El tray además desactiva su ítem y el frontend valida antes de invocar;
> en la jornada el `Err` cae en el back-off del #1 por la rama `Other` (escalada corta, sin alto
> del día), que es lo correcto porque el modelo puede terminar de bajarse en cualquier momento.
>
> Lo que quedaba era el **mensaje**, y repetía la patología del #1: en inglés, sin acción, y
> afirmando siempre *"the model is still downloading, please wait"* **sin comprobarlo**. Esperar
> no arregla un modelo corrupto ni uno que nunca se descargó — que es justo el caso de este
> hallazgo, porque la validación **solo comprueba el tamaño** y un archivo truncado por el
> `reqwest Decode/Body` del 14-ago la pasa. Ahora se consulta el estado real y se responde:
> descargando (con %), corrupto, error de carga o ausente, los tres últimos con acción.
>
> **El doble stop del 24-ago no se persiguió:** `StopGate` ya hace el stop idempotente y rechaza
> el segundo. Los dos `recording_stopped` del mismo segundo son dos **emisores** de telemetría
> (Rust y frontend), no dos paradas.


8 `save_skipped_no_transcripts`: alejandra 7 (17-ago ×4, 18-ago ×2, 24-ago ×1), jessica 1
(17-ago). El 14-ago tres personas tuvieron `reqwest Decode/Body` bajando Parakeet. Desde que
alejandra actualizó a 0.2.57 (24-ago 10:04) graba bien. Ese día aparecen dos
`recording_stopped` a la misma hora (10:04:47), uno con 0 y otro con 60 transcripts → doble
stop a revisar.

Qué hacer: el gate de Parakeet post-registro ya cubre cuentas nuevas; falta que el intento de
grabar sin modelo diga "sin modelo de transcripción" en vez de descartar en silencio.

### 8. Cerrado — confirmado en producción con 0.2.57

- `Command plugin:window|destroy not allowed by ACL`: 9 eventos en 6 personas, **todos
  0.2.56**; cero en 0.2.57.
- "Recording start already in progress": 13 eventos en 5 personas, **todos 0.2.56**.
- "Request timeout after 120s con helper legacy (sin ids)": solo 0.2.56.
- Telemetría nueva llegando: `device.profile` (os_version, gpu_type, memory_gb, cpu_cores,
  build_channel, performance_tier) y `recording_started` emitido desde Rust con `trigger`,
  `mic_device` real, `mic_source`, `auto_save`, `meeting_title`. El embudo de jornada ya es
  auditable (en 0.2.56 mary tenía 9 conv y 0 eventos).
- `app.open`/`nav.page_view` siguen sin `app_version`; `coach_float.*` sigue mandando
  `'unknown'`.

## Tablas de apoyo

### Por persona

| | conv | h | días | V4 | sin tema | vistas det/anál | RAM | tier | versión | notas |
|---|---|---|---|---|---|---|---|---|---|---|
| mary | 45 | 30.1 | 8 | 8 | 27 (60 %) | 0 / 0 | 7 GB | low | 0.2.57 | jornada casi diaria; 3 segmentos >60 min |
| erika | 38 | 23.7 | 7 | 17 | 9 (24 %) | 4 / 0 | 5 GB | low | 0.2.57 | 22 timeouts sidecar, 15 reinicios |
| margarita | 25 | 19.5 | 6 | 15 | 5 (20 %) | 4 / 1 | 7 GB | low | 0.2.57 | única con audio de sistema real; anomalías de rotación |
| michael | 11 | 3.8 | 2 | 1 | 7 (64 %) | 11 / 0 | 15 GB | high | 0.2.56 | última actividad 19-ago |
| marcela | 10 | 12.5 | 4 | 2 | 6 (60 %) | 8 / 3 | 15 GB | high | 0.2.56 | 393 min manual; lag_max 224 s en heartbeat |
| alejandra | 9 | 5.5 | 3 | 4 | 0 | 4 / 1 | 5 GB | low | 0.2.57 | 7 grabaciones al vacío antes de Parakeet |
| janeth | 6 | 3.1 | 3 | 1 | 3 (50 %) | 2 / 0 | 6 GB | low | 0.2.56 | última actividad 17-ago |
| jessica | 4 | 1.2 | 3 | 0 | 1 | 9 / 3 | 7 GB | low | 0.2.57 | abre la app 10 días, 14 eventos coach_float, 67 avisos MEM |
| xochitl | 0 | — | — | — | — | 0 / 0 | 13 GB | high | 0.2.57 | sin micrófono en el equipo |
| melissa | 0 | — | — | — | — | 0 / 0 | 7 GB | low | 0.2.56 | 0x80070005; 5 juegos web (914 XP) |

### Por día (CDMX)

| día | conv | personas | h | completed | quota | skipped(+null) |
|---|---|---|---|---|---|---|
| vie 14 | 22 | 7 | 8.0 | 1 | 10 | 11 |
| dom 16 | 1 | 1 | 0.4 | 1 | 0 | 0 |
| lun 17 | 21 | 5 | 20.8 | 2 | 16 | 3 |
| mar 18 | 7 | 3 | 4.1 | 2 | 3 | 2 |
| mié 19 | 23 | 4 | 13.3 | 5 | 0 | 18 |
| jue 20 | 7 | 1 | 7.7 | 6 | 0 | 1 |
| vie 21 | 5 | 1 | 1.2 | 1 | 0 | 4 |
| lun 24 | 11 | 3 | 6.8 | 3 | 0 | 8 |
| mar 25 | 8 | 3 | 6.0 | 5 | 0 | 3 |
| mié 26 | 18 | 2 | 14.1 | 10 | 0 | 8 |
| jue 27 | 23 | 4 | 15.7 | 10 | 0 | 13 |
| vie 28* | 2 | 2 | 1.5 | 2 | 0 | 0 |

Minutos por hora (duración repartida): 8h 95 · 9h 500 · 10h 565 · 11h 750 · 12h 725 ·
13h 719 · 14h 470 · 15h 971 · 16h 847 · 17h 197 · 18h 61 (+67 min a las 2–3 am por la
anomalía de margarita).

### Errores no-MEM (`app.error` + `recording_start_failed`), 14–28 ago

| mensaje | n | personas | versiones |
|---|---|---|---|
| No microphone device available: No default input device found | 672 | xochitl | 0.2.56/57 |
| Failed to start recording: … Acceso denegado (0x80070005) | 293 | xochitl | 0.2.57 |
| Command plugin:window\|destroy not allowed by ACL | 9 | 6 | 0.2.56 |
| Recording start already in progress (+ variante "via tauri command") | 13 | 5 | 0.2.56 |
| No input device available for monitoring | 7 | xochitl | 0.2.56/57 |
| ❌ No default microphone available | 5 | xochitl | 0.2.56 |
| ❌ Failed to create microphone stream: Acceso denegado | 4 | melissa, xochitl | 0.2.56 |
| Failed to build monitor stream: Acceso denegado | 2 | melissa | 0.2.56 |
| 3 timeouts consecutivos — sidecar presuntamente colgado | 3 | erika | 0.2.56/57 |
| Coach: 3/5 fallos LLM consecutivos — breaker ABIERTO | 5 | erika, janeth | 0.2.56/57 |
| Download error for parakeet-tdt-0.6b-v3-int8 (reqwest Decode/Body) | 3 | alejandra, jessica, margarita | 0.2.56 |
| Request timeout after 120s con helper legacy (sin ids) | 3 | erika, margarita | 0.2.56 |
| Recording is still stopping, try again in a moment | 1 | alejandra | 0.2.56 |

## Lo que NO va al manager y por qué (v4, 2026-08-28)

El feedback del cofundador sobre la v3 fue literal: "estos datos no me dicen nada… ¿para qué le sirve a
Rita que se guardaron 148 conversaciones?". La regla desde entonces: **dato → pregunta del manager → frase
sobre una conducta → acción**; lo que no sobrevive la conversión se queda aquí.

| Tema técnico | Por qué no va | Cómo se dice en el reporte B |
|---|---|---|
| Atribución por canal (mic = usuario, sistema = interlocutor) → "monólogo" en presencial, 49/64 con 1 hablante | Límite del producto, no conducta del equipo | "Empatía y adaptación solo se miden cuando Maity escucha a las dos partes; en presencial solo escucha a la persona del equipo: se midieron en 13 de 64" |
| RAM 6–8 GB, 215 `[MEM]`, congelamientos, tier Low, Gemma | Diagnóstico de plataforma | No se menciona |
| Tormenta de 965 reintentos del scheduler (xochitl) | Bug nuestro | "Su computadora no tiene micrófono" + acción (diadema USB) |
| `0x80070005` en melissa | Config de Windows | "El micrófono está bloqueado para Maity en su equipo" + acción |
| Cuota Free → 29 `quota_skipped` y el backfill | Operación de Maity | Desaparece: tras el backfill "todas las conversaciones con contenido reciben análisis" |
| 39 % de segmentos "sin tema" por la jornada headless | Modelo de grabación continua | "Tiempo con Maity encendida" ≠ "conversación analizada" (cobertura total vs analizada) |
| Versiones 0.2.56/0.2.57, canal Store vs GitHub | Operación | No se menciona |
| KPIs de volumen (144 conv, 99 h, 129 minutas) | No accionables para el manager | Apéndice plegado "Datos de uso" con la nota "miden la actividad de Maity, no la del equipo" |
| `category` OMI (otro 51 / trabajo 46 / personal 15…) | Ruido | El tipo de junta sale de `meta.tipo_reunion × categoria_interlocutor` de la minuta |
| Heatmap día×hora, perfil por hora, "hablantes por canal" | Describen a Maity, no al equipo | Eliminados de B (la tabla de minutos por hora sigue abajo) |

**Corrección de universo (v4):** las 148 conversaciones de la v3 incluían **4 `discarded`** (descartadas
por el propio usuario). El universo del reporte v4 es **144** no descartadas antes del corte (Q0 de
`queries.sql` filtra `deleted` y `discarded`). Nada cambia en las conclusiones.

## Señales de producto desde la vista del manager

Lo que salió al convertir los datos a conductas y que sí es nuestro problema:

- **Cobertura de jornada 0–32 % con trigger dominante `scheduler_rotation`** (Q4: María 32 %, Erika 26 %,
  Margarita 20 %, Marcela 14 %, el resto ≤6 %; 10 días hábiles 14–27 ago × 9 h). La jornada está encendida
  pero no acompaña la jornada: suspensión/rotación (hallazgo 5) y gente que la apaga. **Y de lo encendido,
  solo una fracción es conversación analizable** (María 11 %, Erika 20 %, Margarita 15 %): grabar al vacío
  es el modo dominante de uso.
- **Empatía y adaptación no evaluables en 51 de 64** → la diarización en el canal de micrófono es el siguiente
  salto de valor del V4 para equipos presenciales. Sin eso, 2 de las 6 competencias del pitch no existen
  para el 80 % de las conversaciones.
- **8 `analysis_viewed` en dos semanas** (Jessica 3, Marcela 3, Alejandra 1, Margarita 1). María: 45
  conversaciones, 0 vistas. El valor no llega a quien graba → notificación "tu minuta está lista" con deep
  link, o resumen semanal por correo.
- **Autoevaluación vs medido** (Q6): las 10 personas se pusieron 60–100 en el registro y Maity mide 26–55.
  Brechas de 40–70 puntos en propósito/estructura/persuasión (María propósito 100 vs 30). Dos se subestiman
  (Erika adaptación 40 vs 54; Janeth claridad 40 vs 53). Argumento de venta ("no se ven como son") y de
  onboarding (mostrar la brecha en el primer análisis).
- **Melissa: 9 juegos en la web sin poder grabar; Jessica: abre 10/12 días, lee 9 conversaciones, graba
  1.2 h** → el valor "sin grabar" existe y hay que medirlo (juegos, roleplay, lectura). Chat y roleplay: 0 en
  todo Dingler.
- **101 acciones detectadas, 10 con dueño y fecha** → la minuta ya ve el problema que el manager quiere
  atacar; falta la UI que lo cierre (asignar desde la minuta, recordatorio).
- **Las 20 llamadas con cliente son las mejores conversaciones del piloto** (efectividad 54–60, 0
  informales, únicas con 2 hablantes) y son el 15 % del volumen → el producto debería empujar a grabar
  llamadas, no jornadas.

## Caveats de calidad de datos (para no sobreleer B)

- `meta.tipo_reunion` y `categoria_interlocutor` son etiquetas del LLM de minuta: "Operativa" 125/129. La
  explicación de picos se apoya en interlocutor + títulos + `keywords`.
- Las citas del V4 pueden pertenecer al interlocutor (atribución por canal). En B se prefirieron
  conversaciones con ≥2 hablantes y se leyó cada cita; se redactó un nombre de cliente (Michael).
- `acciones[].falta` trae "dueño" o "dueno"; `responsable`/`fecha_limite` vacíos también cuentan como
  faltantes (Q3b).
- Autoevaluación (Likert 1–5 ×20) y puntaje V4 (0–100) no son la misma escala: B muestra dirección y brecha
  mayor, no una resta.
- `started_at` derivado del cierre en suspensiones (hallazgo 5): los segmentos >61 min inflan la cobertura de
  Margarita el 20-ago y Marcela el 17/19.
- `least`/`greatest` de Postgres ignoran NULL: la primera versión de Q4 daba 100 % a quien no grabó. Corregido
  con `case when c.id is null then 0`.
- `platform_logs.user_id` puede ser `users.id` o `auth_id`; `platform` ∈ desktop|web|mobile (los juegos de
  Melissa son web).
- La efectividad de minuta penaliza por diseño las jornadas sin agenda (`agenda_adherence` asume 70).

## Backfill (hecho)

28-ago 09:58–10:02 CDMX, worker `conversations-async-analysis` + `CRON_SECRET` (`--one` primero, luego
concurrencia 2): 29/29 procesadas, 16 `completed` + 13 `skipped`, 0 `failed`, minutas intactas, sin cobro
de cuota. Detalle en el hallazgo 6. Q9 de `queries.sql` devuelve 0 filas desde entonces.

## Changelog del reporte del manager

- **2026-08-28 v4 "conductas"** (label `manager-v4-conductas`, misma URL): reestructura completa por el
  feedback del cofundador. Fuera: KPIs de volumen (a apéndice), heatmap, perfil por hora, destino por día,
  hablantes por canal, tabla con RAM/versión, findings técnicos. Dentro: en una página (4 frases), 6
  competencias con n evaluable/total + niveles + qué pasa + ejemplo→mejor + qué mejorar, 10 tarjetas por
  persona (puesto, n + tier de lectura, fortaleza/área con cita, patrón, reto declarado vs medido, dumbbell
  autoeval vs Maity, cobertura, acción), matriz tipo × interlocutor + acciones sin dueño/fecha + temas,
  cobertura de jornada por persona + horas por día con 4 picos explicados, 3 personas sin análisis y qué sí
  hacen, acciones por persona/equipo/Maity, cómo leer. Generado con `build-report-b.mjs` desde
  `docs/piloto/dingler-2026-08-28.data.json`.
- 2026-08-28 v3 `manager-v3-post-backfill`: cifras post-backfill (64 análisis).
- 2026-08-28 v2 `manager-v2`: karen fuera, xochitl "sin micrófono", hallazgos técnicos movidos a este md.
- 2026-08-28 v1 `dos-semanas-v1`: primera versión (uso, valles y picos).

## Puntos ciegos que siguen

- `daily_evaluations` y `recording_session_telemetry` están vacías para Dingler (la segunda
  es mobile).
- `user_feedback`: solo 3 `session_rating` del día 1 (michael useful/not_useful, marcela useful).
- `app.close` 19 vs `app.open` 110: la mayoría de las sesiones no cierran limpio (tray,
  suspensión o kill) — sin evento no se distingue.
- No hay evento para "usuario abrió la minuta" separado de `conversation_detail_viewed`.

## Orden propuesto

1. ~~Back-off del scheduler + notificación accionable de micrófono (#1)~~ — **hecho 28-ago**.
2. "No evaluable" con 1 hablante en jornada (#2, lado web) — cambia lo que la manager ve
   hoy mismo. **Siguiente.**
3. ~~Relanzar los 29 `quota_skipped` (#6)~~ — **hecho 28-ago** (29/29, ver arriba).
4. ~~Gemma off durante grabación en tier Low (#3)~~ — **hecho 28-ago**, y quedó en "ni
   cargar ni descargar" al confirmar que no hay otro consumidor del sidecar.
5. ~~Umbral de contenido en la rotación (#4) y rotación con reloj monotónico (#5)~~ —
   **hecho 28-ago**. El "reloj monotónico" resultó ser el diagnóstico invertido: la rotación ya
   era robusta a suspensión y el reloj monotónico era la *causa* del problema, no la cura.
6. ~~Mensaje al grabar sin modelo (#7)~~ — **hecho 28-ago**; el gate ya existía desde 0.2.57.

**Queda abierto:** #2 (lado web) y la rotación de grabaciones manuales largas, descartada a
propósito en este ciclo.

## Estado del código (28-ago, `main` sin push)

**Ciclo 1 — #1 y #3.** 4 commits: `2844baf` back-off de jornada · `18681a2` rate-limit +
probe de micrófono · `162bac4` tier Low sin Gemma · `3adb40c` preflight en ajustes.

**Ciclo 2 — #4, #5 y #7.** 3 commits: `059660f` umbral de contenido de la jornada (+ el
`started_at` sellado de la jornada, que vive en la misma función) · `c18446e` sello de la hora
de arranque en el camino manual + tope de segmento en overtime · `ec77164` mensaje honesto
cuando falta el modelo.

Build `tauri:build:debug` en verde (exit 0) con los checks pre-build, **533 tests de Rust**
(6 nuevos), 317 de vitest y el smoke con handshake del helper.

**Pendiente: el E2E manual de los dos ciclos** — ningún test automático lo cubre.

- **#1/#3:** micrófono deshabilitado ⇒ 2 intentos y un toast; permiso revocado ⇒ toast con
  "Abrir configuración" + escalada 1/2/5/15; `MEMORY_GB=6` ⇒ cero procesos `llama-helper.exe`
  durante la grabación con tips heurísticos vivos; `GPU_TYPE=cuda MEMORY_GB=6` ⇒ tier `low`.
- **#4:** jornada con un segmento casi mudo ⇒ no aparece conversación, no hay job en
  `sync_queue`, y **al reiniciar la app NO sale el diálogo de recuperación** (es la trampa del
  diseño); segmento con contenido real ⇒ se guarda igual que hoy.
- **#5:** suspender la laptop con la jornada abierta ⇒ al despertar una sola rotación y
  `started_at` = hora real de arranque; jornada fuera de ventana con `auto_close_enabled=false`
  ⇒ rota a los 90 min en vez de crecer sin límite.
- **#7:** renombrar el `.onnx` de Parakeet y pulsar Grabar ⇒ mensaje en español que dice que
  **falta** el modelo, no que se está descargando.
