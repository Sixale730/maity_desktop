# Gates de sesión/registro, onboarding y descargas de modelos

> Extraído de CLAUDE.md (sep-2026) para adelgazar el contexto. **Leer la sección correspondiente ANTES de tocar AuthGate, onboarding, scheduler de jornada o descargas de modelos** — cada bloque documenta un bug real y decisiones que NO deben revertirse. El ciclo de vida del motor STT (#02, `ensure_stt_warm`/`unload_stt`) vive en `docs/TRANSCRIPTION_PIPELINE.md`; el LLM del coach en `docs/COACH_LLM_ARCHITECTURE.md`.

## Gate de Sesión (login compacto estilo Steam + coach-float + grabación) — ago-2026

Sin sesión la app NO graba por ninguna vía y NO muestra el coach-float; la ventana principal se compacta a un login de 480×640 (estilo Steam). Piezas (no revertir por separado — se diseñaron juntas):

- **Verdad de la sesión en Rust**: `state.rs::has_session(app)` lee `AppState.current_user_id` (lo llena `set_current_user` cuando `maityUser` carga en `AuthContext`; lo limpia `clear_current_user` al logout). Usa `try_state` por el orden de `manage` en first-launch.
- **Gate de grabación SOLO en entrypoints nativos**: `recording_lifecycle.rs::start_recording_with_meeting_name` (chokepoint de tray + scheduler) devuelve `Err` sin sesión; el tick del scheduler (`scheduled_recording/service.rs`, brazo `(false, Some(_))`) skipea con `SkipReason::NoSession` — al loguearse, el siguiente tick (≤30 s) arranca la jornada. Los paths de cierre/rotación NO llevan gate (un segmento owned debe poder cerrarse aunque muera la sesión). Los comandos `start_recording*` invocables por el frontend NO se gatean: viven detrás del AuthGate y gatearlos crea carrera con el IPC de `set_current_user` post-login.
- **Coach-float por sesión**: el auto-open ya NO vive en el `setup()` de lib.rs (el viejo spawn de 800 ms lo abría encima del LoginScreen). Vive en la transición None→Some de `set_current_user` → `coach::commands::open_coach_on_login` (respeta pref `coach_float_visible` y el override `STARTED_AT_BOOT`). `clear_current_user` cierra el coach. `open_floating_coach` tiene el check central (Ok silencioso sin sesión). El tray sin sesión enfoca el login en vez de grabar/togglear.
- **Login compacto**: comando `set_main_window_auth_layout(authenticated)` en lib.rs, idempotente vía `LOGIN_COMPACT_ACTIVE` (AtomicBool). El AuthGate lo invoca ANTES de emitir `app-ready` (ventana aún oculta → el primer `show()` sale ya con el tamaño correcto, sin flash) y en cada transición login/logout. Solo restaura 1100×700 si él mismo compactó: arrancar ya logueado es no-op y respeta el tamaño del usuario. Único flash posible: el fallback de 3 s de lib.rs si Next tarda >3 s en emitir `app-ready` (aceptado).
- **Logout**: `AuthContext.signOut` invoca `logout_cleanup` (reutiliza `graceful_shutdown_before_exit`, timeout 30 s) ANTES de limpiar estado local — detiene y GUARDA la grabación activa (jornada → persistencia nativa; manual → stop estándar) mientras `current_user_id` sigue vivo. Best-effort: nunca bloquea el logout.
- **Meeting detector**: sin cambios — solo emite eventos a la main; sin sesión no hay listeners montados (AuthGate).

## Back-off del arranque de jornada (ago-2026, piloto Dingler)

El tick de 30 s reintentaba indefinidamente y etiquetaba **todo** `Err` como `SkipReason::TranscriptionNotReady` ("se reintentará automáticamente") — una razón equivocada que además se auto-justificaba. Una usuaria sin micrófono generó **965 `recording_start_failed` en 8 h**, el 27 % de `platform_logs` de todo el piloto. Hoy `evaluate_tick` clasifica con `audio::device_errors::classify_device_error` (HRESULT primero, **nunca substring**: Windows traduce sus mensajes) y aplica política por causa, con el estado en `SchedulerShared.start_backoff`:
- `NoInputDevice` (sin hardware): **alto del día tras 2 fallos**; mientras esté parado, sondeo **barato** (`default_input_device().is_some()`, sólo enumeración, **jamás abre un stream**) cada 5 min que levanta el alto solo al conectar un micrófono.
- `MicAccessDenied` (`0x80070005`): escalada **1/2/5/15 min** y alto del día al 5º intento — el permiso SÍ se puede conceder sin tocar hardware, por eso reintenta antes de rendirse.
- Resto: escalada corta con tope de 5 min y **nunca** alto (el motor de transcripción puede terminar de descargarse en cualquier momento).
- `"already in progress"` es carrera benigna y **no** cuenta como fallo. `CheckNow` ("Evaluar ahora") y guardar ajustes **levantan el alto** — son el escape hatch explícito. `rotate_scheduled` alimenta el mismo back-off: soltar ownership al fallar reinyectaba el tick en el arm de arranque y era la **segunda** vía de la tormenta.
- **No reusar `rearm_at`** para esto: produce `SkipReason::RearmingNextHour` y lo limpia el arm de reposo; mezclarlos confunde los mensajes.
- Un solo aviso nativo por episodio (latch `notified`), por `show_native_toast` **directo** y no por `NotificationManager` (éste filtra por consentimiento/DND y esto es un fallo, no una cortesía). La jornada arranca headless: el toast in-app no basta.
- `next_backoff` es **pura** para poder testear la política con una tabla (`backoff_tests`), sin tokio ni `AppHandle`.
- Defensa en profundidad: `emit_start_failed` (`recording_lifecycle.rs`, el **único** emisor del evento) lleva un limiter calcado de `BridgeLimiter` — clave `código:trigger`, dedup sobre lo **ENVIADO**, y campos `code`/`suppressed` en el payload.
- **Preflight**: `check_microphone_ready` (comando; `probe_microphone_access` en `devices/discovery.rs`) abre y suelta un stream corto y devuelve el error clasificado. Va en **ajustes/onboarding/diagnóstico y sólo por acción del usuario** — nunca en `initialize_recording` ni en un intervalo. En particular **no** se metió en `usePermissionCheck`, que hace poll cada 5 s: ahí cambiaría una tormenta de telemetría por una de audio. Contar dispositivos NO sirve para el permiso denegado (en Windows la enumeración no está bloqueada por la privacidad: lista el micrófono y falla después en `IAudioClient::Initialize`).

## Gate de registro (ago-2026, #66) — Rust es la autoridad, fail-closed

El gate de `registration_form_completed` vivía SOLO en el render de la main (`layout.tsx`, `=== false`) y en producción un usuario con la UI parada en `/registration` grabó **21 jornadas** con 0.2.57: el scheduler, el tray y los floats (`/coach-float`, `/recording-widget` → `WIDGET_REQUEST_START_RECORDING` → `RecordingWidgetListener`, montado FUERA de la cadena de gates) nunca pasaban por ahí. Piezas, diseñadas juntas:
- **Verdad en Rust**: `AppState.registration_completed: Option<bool>` (`None` = desconocido). `state::registration_completed(app)` es **fail-closed** (`None` → `false`). Gate en el mismo embudo que la sesión: `recording_helpers::initialize_recording` (cubre ambos start paths), `scheduled_recording` (`SkipReason::RegistrationIncomplete`, el tick siguiente arranca al completar) y `tray.rs`.
- **Sincronización**: `useRegistrationGate` llama a `my_status` y espeja el valor con `set_registration_status(userId, completed)` (`registration_status.rs`). Lleva `userId` explícito para no depender del orden respecto a `set_current_user` (salen del mismo commit de React). Es la **única** fuente de `Some(false)`.
- **Caché monótona local** (`registration-status.json`, solo ids con `true`): `set_current_user` siembra `Some(true)` si el usuario ya se vio completado en esa máquina → un usuario registrado que arranca **sin red** no queda bloqueado. Si la RPC falla, el hook cae a `get_registration_status`; solo un `true` cacheado pasa. Un `false` confirmado por la RPC retira el id (admin reseteó el flag).
- **Frontend fail-closed**: `layout.tsx` usa `registrationFormCompleted !== true` (test AST en `layout.test.ts`); `false` → `/registration`, `null` con error → `RegistrationUnverified` ("No pudimos verificar…" + Reintentar; NO redirige al formulario: a un registrado sin red le pediría llenarlo otra vez). `RecordingWidgetListener` añade un guard UX con toast (misma query key, sin fetch extra); la autoridad sigue siendo Rust.
- No "simplificar" volviendo a `=== false` ni quitando el gate del embudo "porque el layout ya lo tiene": ese fue exactamente el bug.

## Gate de Registro (`useRegistrationGate` + `AppContent` en `layout.tsx`)

Orden de ramas en `AppContent` para cuentas nuevas:
1. Onboarding tecnico (**Welcome** + Permissions macOS) — la pantalla de bienvenida (`WelcomeStep`, "Bienvenido a Maity", con logo) es la ÚNICA con arranque de modelos. Su botón **"Comenzar y descargar"** arranca Parakeet **+** Gemma en background vía `startBackgroundDownloads(true)` y **avanza al instante** (Windows → registro; macOS → permisos, la descarga sigue en background). NO bloquea. Muestra el total dinámico (~1.6 GB Windows / ~3 GB macOS). (La antigua pantalla "Tu IA personal"/`ModelDownloadStep` fue eliminada.)
2. Splash mientras `modelGateActive` resuelve (`null` → comprobando)
3. Splash (`registrationLoading`)
4. Rama de registro: `/registration` (17 pasos) con `OnboardingDownloadWidget` en la esquina reportando progreso de las descargas en background
5. **`ModelDownloadGate`** — gate bloqueante que espera a Parakeet si falta en disco
6. Scheduled setup gate
7. Main app — el `OnboardingDownloadWidget` sigue mostrando el progreso de Gemma; el usuario ya puede navegar.

**SÍ hay pantalla de espera bloqueante, pero SOLO para Parakeet** (`components/ModelDownloadGate/`, restaurado en jul-2026 tras el rebote 10.3.1 de la Store). Razón: sin el modelo de transcripción, `useRecordingStart.ts` aborta la grabación con un toast y **no hay fallback a otro motor** — un usuario (o un reviewer de certificación) que llega al dashboard sin modelo no puede probar la funcionalidad principal.

Reglas del gate, todas deliberadas — **no "simplificar" sin leer esto**:
- **Solo Parakeet bloquea.** Gemma (resumen) sigue en background y nunca bloquea.
- **Va DESPUÉS del registro**, para que los 17 pasos solapen con la descarga. Ponerlo antes hace que una cuenta nueva mire una barra muerta de 600 MB sin nada que hacer.
- **Sin botón de omitir.** Decisión explícita del producto.
- **Es PASIVO**: no arranca ni cancela descargas, solo observa. Quien arranca sigue siendo `WelcomeStep`/`BackgroundDownloadStarter`. Si el gate arrancara descargas, competiría con la que ya existe.
- **Orden de fases obligatorio**: `isModelReady` → `isDownloading` → `error` → `conectando`. `isModelReady` va primero porque Rust emite COMPLETE *antes* de que el comando retorne `Ok`; con `isDownloading` primero el gate no se levantaría nunca tras un reintento exitoso.
- **Sin watchdog de stall propio**: Rust ya corta a los 30 s sin bytes. Un temporizador de frontend más corto ofrecería "Reintentar" con la tarea aún viva. El único timer es el de la fase "Conectando…" (60 s), por encima del `connect_timeout` de 30 s.

`ModelDownloadStep` ("Tu IA personal") sigue eliminado — el consentimiento vive en el botón "Comenzar y descargar" de `WelcomeStep`, y el gate solo espera.

Para cuentas existentes (`get_onboarding_status.completed===true`): saltan el onboarding técnico. Si les falta el modelo, `BackgroundDownloadStarter` arranca la descarga en background (sin pantalla) y entran directo al dashboard con el widget.
- `BackgroundDownloadStarter` (`components/Onboarding/BackgroundDownloadStarter.tsx`, renderiza null, montado dentro de `OnboardingProvider`): si `completed && !(parakeetDownloaded && summaryModelDownloaded)` y no es ruta especial (`/coach-float`, `/recording-widget`, `/device-picker`) → `startBackgroundDownloads(true)` (idempotente por los guards internos). Es quien ARRANCA la descarga para cuentas existentes sin modelo; el `ModelDownloadGate` (restaurado jul-2026) es pasivo y solo la observa.
- Si `my_status()` devuelve `registration_form_completed===false` → redirige a `/registration`
- `/registration` y `/billing/plans` excluyen el Sidebar; sus pages proveen su propio scroll (`h-screen overflow-y-auto` + wrapper `min-h-full`) porque `globals.css` fija `body { overflow: hidden }`
- Al completar el form, la web invalida `['user','status']` → el gate se levanta solo
- **`OnboardingAccountBadge`** (`components/Onboarding/OnboardingAccountBadge.tsx`, `fixed top-4 right-4 z-[60]`): como el Sidebar no se monta durante el onboarding, replica el indicador de cuenta + cerrar sesión (`useAuth().signOut`). Es un **icono redondo (avatar)**; al hacer clic despliega un menú (nombre/email/botón "Cerrar sesión"); cierra al hacer clic fuera. Se monta en las ramas de onboarding: técnico (`OnboardingFlow`), registro (`/registration`), scheduled setup, y en la rama main cuando `isRegistrationRoute` (`/billing/plans`). `z-[60]` sobre overlays; top-right para no chocar con `OnboardingDownloadWidget` (bottom-right).

## Descargas de Modelos (`WelcomeStep` + `BackgroundDownloadStarter` + `OnboardingContext` + `OnboardingDownloadWidget`)

**Concurrencia de descargas (arreglado jul-2026 — no revertir).** El arranque estaba duplicado: `WelcomeStep` dispara la descarga y completa el onboarding en el MISMO tick, lo que voltea `completed` y hace re-correr el efecto de `BackgroundDownloadStarter`, que llamaba otra vez. Como `startParakeet` tiene varios `await` antes del invoke, sus guards leían un estado que la primera llamada aún no había escrito → **toda cuenta nueva en Windows bajaba Parakeet dos veces**. Ahora `OnboardingContext` guarda la promesa del arranque (`parakeetKickoffRef`/`gemmaKickoffRef`) y la reusa. En Rust, el guard de `active_downloads` era TOCTOU (check con read lock, insert con write lock por separado) y 4 salidas `Err` no limpiaban la bandera, dejando el modelo en `Downloading{0}` para siempre. Hoy: check+insert atómico con `HashSet::insert`, y un único `remove` en el wrapper de `download_model_detailed`, que cubre todos los caminos de salida. `parakeet_retry_download` ya **no** fuerza el clear — si hay una descarga viva, no relanza (dos writers sobre el mismo `.onnx` no dan error en Windows: corrompen el archivo en silencio y pasan la validación, que es solo por tamaño).

- **Arranque en un solo lugar, no-bloqueante:**
  - **Cuentas nuevas**: `WelcomeStep` ("Bienvenido a Maity", paso 1 del onboarding técnico, con logo). Su botón "Comenzar y descargar" → `startBackgroundDownloads(true)` + (Windows) `completeOnboarding()` / (macOS) `goNext()` a permisos. Avanza al instante. Muestra el total con tamaño **dinámico por plataforma**: Parakeet ~600 MB + Gemma (`gemma3:1b` ~1 GB en Windows/RAM<16GB, `gemma3:4b` ~2.4 GB en macOS>16GB) → total ~1.6 GB / ~3 GB.
  - **Cuentas existentes sin modelo**: `BackgroundDownloadStarter` arranca la descarga en background al montar (sin pantalla).
- `OnboardingContext.startBackgroundDownloads(includeGemma)` — arranca Parakeet y opcionalmente Gemma con guards completos (idempotente):
  - Parakeet: `parakeet_init` → `parakeet_has_available_models` (skip si true) → `parakeet_get_available_models` para detectar `Downloading` (skip) y `Corrupted` (borrar con `parakeet_delete_corrupted_model` primero) → `parakeet_download_model` con `parakeet-tdt-0.6b-v3-int8`
  - Gemma (tras 3s delay para priorizar ancho de banda): `builtin_ai_is_model_ready` (skip si ready) → `builtin_ai_get_model_info` (skip si `status.type === 'downloading'`) → `builtin_ai_download_model` (`selectedSummaryModel`, recomendado por `builtin_ai_get_recommended_model`)
  - Setea `isBackgroundDownloading=true` → el widget aparece.
- **UNA sola UI de progreso de descarga**: `OnboardingDownloadWidget` (`bottom-4 right-4 z-50`), montado en la rama de registro Y en el main app. Por defecto es una **bolita redonda** con anillo de progreso (% combinado); al hacer clic se **expande al modal** completo (filas Parakeet/Gemma) y se minimiza con la X. Solo se muestra cuando hay actividad. **`DownloadProgressToastProvider` fue eliminado** del layout (antes duplicaba: toasts arriba + widget abajo).

## En tier Low NO se descarga Gemma (ago-2026)

Con el LLM del coach apagado en gama baja (ver `docs/COACH_LLM_ARCHITECTURE.md`), ese modelo no tiene consumidor: bajar ~1 GB sería gastar red y disco del equipo que menos lo puede pagar. El total del `WelcomeStep` pasa de ~1.6 GB a **~600 MB** (sólo Parakeet). El tier se resuelve en el frontend con `lib/deviceTier.ts` → comando `get_device_profile` (ya existía, lo usaba sólo `healthHeartbeatService`), cacheado con single-flight.

**Regla derivada, y es la que rompe si se ignora: los consumidores miran `summaryModelReady`, NO `summaryModelDownloaded`.** El segundo describe el **disco**, y en tier Low se queda en `false` **para siempre**. Usarlo como condición de "falta algo" hacía que `BackgroundDownloadStarter` llamara a `startBackgroundDownloads` en **cada arranque de la app**; y como esa función pone `isBackgroundDownloading = true` nada más entrar, el widget de descargas aparecía sin nada que descargar. `OnboardingContext` expone ambos: `summaryModelRequired` (¿hace falta?) y `summaryModelReady` (`!required || downloaded`).

**Efecto secundario aceptado:** `reconcile_status` (Rust) auto-repara un onboarding atorado sólo si `summary == "downloaded" && parakeet == "downloaded"`. Sin Gemma esa red de seguridad no se arma en equipos Low. No afecta el flujo normal — la completitud la fija `complete_onboarding()`, que no toca `model_status` — y la función sigue siendo **monótona**, así que no puede reproducir el bucle de onboarding de jul-2026.

`ensure_low_tier_tips_model` (`coach/setup.rs`) fue **eliminada** en el mismo cambio: bajaba el 1B en background y, con ironía, sólo corría en tier Low. La descarga manual desde Ajustes → Pipeline sigue disponible.

## El estado del onboarding es MONÓTONO y leerlo NO escribe (arreglado jul-2026 — no revertir)

`onboarding.rs::reconcile_status` solo puede **avanzar** el estado: nunca pone `completed=false` ni baja `current_step`. Retroceder el onboarding es una acción explícita del usuario (`reset_onboarding_status`), jamás un efecto de mirar el disco. Además `load_onboarding_status` es **lectura pura** (CQS) y la reconciliación corre **una sola vez** desde el `setup` de `lib.rs` (`reconcile_onboarding_status_at_startup`).

**Por qué**: hasta jul-2026 el reconciliador aplicaba la regla §4.1 de `fb1846b` — "si hay gemma 1b en disco pero no 4b → `completed=false`, volver al paso 3". Pero `builtin_ai_get_recommended_model` es `if is_macos && ram > 16 { 4b } else { 1b }`, o sea **todo Windows baja el 1b por diseño** → la regla declaraba "instalación rota" justo lo que el recomendador produce. Y como `useRecordingStop` hace hard navigate (`window.location.href`), cada fin de reunión remontaba el árbol React y volvía a disparar esa escritura: **el usuario terminaba en "Bienvenido a Maity" después de cada reunión, en bucle** (se rearmaba solo porque `complete_onboarding` reescribía `summary="cloud"` y borraba el centinela). Rompía toda instalación limpia de Windows, incluida la del reviewer de la Store. La salvaguarda original ya era redundante: el coach resuelve su propio modelo con `resolve_effective_tips_model` y degrada a `Unavailable` si falta.

Reglas derivadas: (a) el onboarding acepta **cualquier** modelo del registry (`summary_engine::models::any_model_on_disk`), no un modelo concreto; (b) los umbrales de tamaño viven en `ModelDef::size_bounds_mb` — no inventar umbrales nuevos por consumidor; (c) `complete_onboarding` **no toca** `model_status`: ese campo refleja el disco, no la transición; (d) `load_onboarding_status` tiene tres llamadores (`get_onboarding_status`, `OnboardingContext`, `tray::check_can_record`) — cualquier efecto secundario que se le agregue se multiplica por cada remonte del frontend. Cubierto por `#[cfg(test)] mod reconcile_tests` en `onboarding.rs`.

## Video de instrucciones (CSP)

El paso de instrucciones del registro (`features/auth/components/registration/RegistrationInstructions.tsx`) embebe un **iframe de YouTube**. Requiere `frame-src`/`child-src` con `https://www.youtube.com` en la CSP de `frontend/src-tauri/tauri.conf.json`; sin eso WebView2 lo bloquea en el build empaquetado (en `pnpm dev` no se nota).
