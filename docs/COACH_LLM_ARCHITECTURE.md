# Coach LLM — Arquitectura, decisiones y guía de aceleración GPU

Documento de referencia con todo lo aprendido al portar la arquitectura `llama-helper`
sidecar desde el repo de Poncho (`ponchovillalobos/maity-copiloto`) a Maity Desktop.
Cubre conceptos fundamentales, qué decisiones tomar para la velocidad de los tips
contextuales, y los pasos exactos para activar GPU en cada plataforma.

> Última actualización: 2026-04-29
>
> **Nota PR coach-cadencia-y-modal (abril 2026)**: el modelo `gemma3-1b-q8` fue
> retirado del proyecto. Onboarding, registry, fallbacks y migración SQL ahora
> apuntan exclusivamente a `gemma3-4b-q4`. Las secciones que mencionan 1B quedan
> con valor histórico (motiva por qué 4B es mejor) pero no reflejan el estado
> actual del código. Ver §4.1 de `PLAN_COACH_FLOATING_GAUGE.md`.
>
> **⚠️ La nota de arriba quedó OBSOLETA (julio 2026).** El 1B volvió y es la ruta
> por defecto en la mayoría de las máquinas:
> - `builtin_ai_get_recommended_model` es `if is_macos && ram > 16 { 4b } else { 1b }`
>   → **todo Windows/Linux descarga `gemma3:1b`** para el resumen.
> - `95bb3f4` (16-jul) reinstauró el 1B en el coach para hardware tier Low, con
>   auto-descarga (`ensure_low_tier_tips_model`) y tips apagados hasta tenerlo;
>   `resolve_effective_tips_model` es quien elige, y degrada a `Unavailable` en vez
>   de fallar si no hay modelo.
> - El onboarding **ya no exige el 4b**: aceptar solo el 4b convertía cada
>   instalación limpia de Windows en un bucle de onboarding (ver el bloque
>   "estado del onboarding es MONÓTONO" en `CLAUDE.md`).

---

## Conceptos fundamentales

### El modelo y el motor son cosas distintas

| Pieza | Qué es | Tamaño / formato |
|---|---|---|
| **Modelo (`.gguf`)** | El "cerebro": pesos numéricos de la red neuronal | Archivo de 1-3 GB. Estático. No hace nada por sí solo |
| **Runtime / motor de inferencia** | El "lector": ejecuta el modelo, hace las multiplicaciones de matrices | Programa compilado (~5-50 MB). Aquí está la velocidad |
| **Backend** | Dónde se hacen las cuentas | `cpu`, `cuda` (NVIDIA), `metal` (Apple), `vulkan` (universal), `rocm` (AMD) |

### Las tres "llamas" no son lo mismo

| Nombre | Qué es |
|---|---|
| **LLaMA** | Familia de modelos creada por Meta. Significa "Large Language Model Meta AI" |
| **llama.cpp** | Librería open source en C++ que ejecuta modelos LLaMA y compatibles (Gemma, Qwen, etc.) |
| **`llama-helper`** | Binario nuestro/Poncho que **usa llama.cpp** internamente. Solo es el "ayudante" |
| **Ollama** | Programa **independiente** que también usa llama.cpp. Marca comercial. **No tiene relación con `llama-helper`** |

```
LLaMA (modelo de Meta) → arquitectura
    ↓
llama.cpp (motor en C++) → librería open source
    ↓
        ┌────────────┬─────────────────┬──────────────┐
        ↓            ↓                 ↓              ↓
    Ollama      llama-helper      Jan, LM Studio,    Otros wrappers
    (programa   (binario          GPT4All           (cada uno empaqueta
    externo)    embebido en                          llama.cpp distinto)
                nuestra app)
```

Todos pueden ejecutar **el mismo archivo `.gguf`**. La velocidad depende de cómo
fueron compilados (con o sin GPU).

### Driver vs Toolkit (importante)

| | **Driver** | **Toolkit** |
|---|---|---|
| Qué es | Software del SO para hablar con la GPU | Kit de desarrollo para compilar apps que usen GPU |
| Quién lo necesita | Usuario final | Desarrollador (al compilar) |
| Tamaño | ~500 MB | ~3 GB |
| Lo trae | Windows Update / actualización del SO | Descarga manual del fabricante |

**Analogía**: el driver es como tener un horno en casa. El Toolkit es la fábrica de
hornos. Solo el fabricante necesita la fábrica; quien usa el horno solo necesita el horno.

---

## Arquitectura actual del Coach

### Flujo de tips

```
Grabación activa
    ↓ "transcript-update" (eventos Tauri cada chunk de habla)
live_feedback.rs
    │
    ├── Listener: actualiza FeedbackState (window 180s, métricas, dedup HashSet)
    │   ├── Si trigger.rs detecta señal léxica crítica (objection/price/etc)
    │   │   → call_ollama_and_emit (vía LLM)
    │   └── Sino: solo actualiza estado
    │
    └── Nudge loop (cada 45s)
        ├── evaluate_nudge(snapshot)
        ├── Si should_nudge && tip hardcoded → emit instantáneo
        └── Si should_nudge && tip None → call_ollama_and_emit (vía LLM)
```

### Llamada al LLM (call_ollama_and_emit)

`coach/live_feedback.rs::call_ollama_and_emit` →
`summary::llm_client::generate_summary(LLMProvider::BuiltInAI, ...)` →
`summary::summary_engine::generate_with_builtin(...)` →
`SidecarManager::send_request(...)` →
**`llama-helper.exe` (child process, stdin/stdout JSON)**

### Mapping de IDs

- `coach::model_registry` usa IDs estilo filename: `gemma3-4b-q4`, `gemma3-1b-q8`
- `summary_engine::models` usa IDs estilo família:variante: `gemma3:4b`, `gemma3:1b`
- `coach::llama_engine::map_to_builtin_id()` traduce entre los dos sistemas

### Archivos clave

| Archivo | Rol |
|---|---|
| `llama-helper/src/main.rs` | Binario sidecar standalone (561 líneas). Lee JSON de stdin, ejecuta llama.cpp, escribe JSON a stdout |
| `frontend/src-tauri/src/summary/summary_engine/sidecar.rs` | Gestor del child process (singleton SidecarManager, health check, idle timeout, warmup LLM-005) |
| `frontend/src-tauri/src/summary/summary_engine/client.rs` | API pública `generate_with_builtin()` |
| `frontend/src-tauri/src/summary/summary_engine/models.rs` | Defs GGUF, templates Gemma3, sampling params |
| `frontend/src-tauri/src/summary/llm_client.rs` | Branch `LLMProvider::BuiltInAI` que delega al sidecar |
| `frontend/src-tauri/src/coach/llama_engine.rs` | Utilidades pasivas: paths .gguf y mapper de IDs (~45 líneas, sin HTTP) |
| `frontend/src-tauri/src/coach/live_feedback.rs` | Listener + nudge loop. Llama al LLM cuando hace falta |
| `frontend/src-tauri/src/coach/nudge_engine.rs` | 6 NudgeTypes con `tip: None` (forzando paso por LLM con contexto) |
| `frontend/src-tauri/tauri.conf.json` | `bundle.externalBin: ["binaries/llama-helper"]` para empaquetar el sidecar |
| `frontend/src-tauri/binaries/` | Binarios compilados por target triple |

---

## Por qué los tips son lentos (50s+) actualmente

### Diagnóstico raíz

**Compilamos `llama-helper.exe` sin features de GPU** — corre 100% en CPU.

```bash
# Lo que hicimos (CPU only):
cargo build --release -p llama-helper

# Lo que falta (GPU NVIDIA):
cargo build --release -p llama-helper --features cuda
```

### Math con hardware típico

Tip de 200 tokens en CPU (Ryzen 5 5600H, 12 cores):
- Throughput: ~7 tokens/seg
- Tiempo: **~28 segundos**

Tip de 200 tokens en GPU (RTX 3050):
- Throughput: ~50 tokens/seg
- Tiempo: **~4 segundos**

Tip de 4096 tokens (default, sin override de `max_tokens`):
- En CPU: ~9 minutos → **timeout (60s) lo mata**
- En GPU: ~80 segundos → posible pero todavía lento

### Por qué la RAM no es el cuello de botella

| Componente | Para qué sirve | ¿Cuello? |
|---|---|---|
| RAM (16 GB) | Guardar modelo cargado y datos temporales | ✗ Suficiente (Gemma 4B usa ~3 GB) |
| CPU (12 cores) | Hacer multiplicaciones de matrices | ✓ **Aquí está el cuello** |
| GPU (RTX 3050, 4 GB VRAM) | Hacer multiplicaciones masivamente paralelas | ✗ Dormida — no la usamos |

Generar un token requiere multiplicar matrices grandes (millones de números).
- CPU: 12 cores secuenciales, ~7 tok/s
- GPU: ~3000 cores CUDA paralelos, ~50 tok/s

**No es la RAM. Es el procesador.**

---

## Por qué Ollama parece "rápido" y nuestro motor "lento"

**No es magia de Ollama. Es simplemente que Ollama viene pre-compilado con CUDA activado.**

| | Nuestro `llama-helper.exe` | Ollama |
|---|---|---|
| Motor de inferencia | llama.cpp | llama.cpp (mismo) |
| Compilado con CUDA | **No** (lo armé sin features GPU) | **Sí** (la web de Ollama distribuye binarios con CUDA pre-built) |
| Ve la GPU del usuario | No | Sí |
| Velocidad en CPU | ~7 tok/s | ~7 tok/s (si cae a CPU) |
| Velocidad en GPU NVIDIA | N/A | ~50 tok/s |

Ambos cargan exactamente el mismo `.gguf`. La diferencia es **un flag al compilar**.

### Lo que hace Poncho actualmente

`coach_suggest` en Poncho llama a `LLMProvider::Ollama` (HTTP a `localhost:11434`),
**no a su propio sidecar**. Es decir, **Poncho exige que el usuario tenga Ollama instalado**
para que los tips contextuales y el chat IA funcionen rápido.

Si el usuario NO tiene Ollama:
- ❌ Tips contextuales fallan
- ❌ Chat IA falla
- ✅ Solo funcionan los nudges hardcoded del nudge_engine

Por eso "se ve rápido" — implícitamente requiere Ollama instalado, que es quien trae GPU
configurada. Su sidecar `llama-helper` lo reservan para evaluación post-meeting (donde
60s+ de espera es aceptable porque es bajo demanda).

---

## Decisión: cómo lograr velocidad sin Ollama

**No se necesita Ollama**. Se necesita activar GPU en nuestro propio sidecar.

### El usuario final NO tiene que instalar nada extra

El binario `llama-helper.exe` lo compilamos NOSOTROS con CUDA. El binario resultante
queda dentro del `.msi`. El usuario solo necesita:
- ✅ Driver NVIDIA (la mayoría de usuarios con GPU NVIDIA ya lo tiene, viene con Windows Update)
- ❌ NO necesita CUDA Toolkit
- ❌ NO necesita Ollama
- ❌ NO necesita instalar nada extra

### Quién instala qué

| | Usuario final | Desarrollador (yo, en la máquina que compila) |
|---|---|---|
| App Maity (.msi/.dmg) | ✓ | ✓ |
| Driver NVIDIA | (si tiene GPU NVIDIA, casi todos) | ✓ |
| Ollama | ❌ no necesita | ❌ no necesita |
| CUDA Toolkit | ❌ no necesita | ✓ una sola vez (~3 GB, instalación 15 min) |
| Vulkan SDK (alternativa) | ❌ no necesita | ✓ si optas por Vulkan en lugar de CUDA |

---

## Plan de acción multiplataforma

### macOS (más fácil — usa Metal)

```bash
cargo build --release -p llama-helper --features metal
```

- **Metal viene incluido en macOS** desde 2014. No requiere SDKs adicionales
- Funciona en todos los Mac modernos: Intel + AMD/Iris, Apple Silicon (M1/M2/M3/M4)
- En M1+ hay **memoria unificada**: la RAM y VRAM son lo mismo. La GPU integrada accede al modelo sin copiar
- **Performance excelente** out of the box. Un MacBook Air M2 ejecuta Gemma 4B a ~30 tok/s

### Windows con NVIDIA (CUDA)

Pre-requisito (solo en máquina del desarrollador):

```bash
# Verificar si está instalado
nvcc --version

# Si no: descargar CUDA Toolkit de https://developer.nvidia.com/cuda-downloads
# Windows → x86_64 → 11 → exe (local), ~3 GB
```

Compilación:

```bash
cd c:/maity_desktop
cargo build --release -p llama-helper --features cuda
cp target/release/llama-helper.exe \
   frontend/src-tauri/binaries/llama-helper-x86_64-pc-windows-msvc.exe
```

Primer build con CUDA tarda 15-25 min (compila kernels CUDA). Builds subsiguientes son rápidos.

### Windows sin NVIDIA o cross-vendor (Vulkan)

```bash
cargo build --release -p llama-helper --features vulkan
```

- Vulkan funciona en cualquier GPU (NVIDIA, AMD, Intel)
- Requiere [Vulkan SDK](https://vulkan.lunarg.com/) en máquina del desarrollador (~500 MB)
- Performance ~20-30% peor que CUDA pero universal
- ⚠️ Poncho lo rechazó por race conditions con CMake al compilar — verificar si nos pasa

### Linux

Igual que Windows:
- NVIDIA: `--features cuda`
- AMD: `--features rocm` (requiere ROCm instalado)
- Cross-vendor: `--features vulkan`

### Workflow CI por plataforma

```yaml
# .github/workflows/build-macos.yml
- name: Build llama-helper sidecar (macOS Metal)
  run: |
    cargo build --release -p llama-helper --features metal
    TARGET=$(rustc -vV | grep "host:" | awk '{print $2}')
    mkdir -p frontend/src-tauri/binaries
    cp target/release/llama-helper "frontend/src-tauri/binaries/llama-helper-${TARGET}"

# .github/workflows/build-windows.yml (con CUDA)
- name: Install CUDA Toolkit
  uses: Jimver/cuda-toolkit@v0.2.x
  with:
    cuda: '12.3.0'
- name: Build llama-helper sidecar (Windows CUDA)
  run: |
    cargo build --release -p llama-helper --features cuda
    New-Item -ItemType Directory -Force -Path "frontend/src-tauri/binaries"
    Copy-Item "target/release/llama-helper.exe" `
      -Destination "frontend/src-tauri/binaries/llama-helper-x86_64-pc-windows-msvc.exe"

# .github/workflows/build-linux.yml
- name: Build llama-helper sidecar (Linux)
  run: |
    cargo build --release -p llama-helper
    # CPU only por simplicidad. Activar --features cuda si los runners tienen NVIDIA
```

### Comportamiento del binario en máquina del usuario

```
Usuario lanza la app
   ↓
llama-helper.exe arranca (compilado con --features cuda)
   ↓
Detecta hardware:
   ├── ¿Tiene driver NVIDIA + GPU compatible?
   │       ├── Sí → carga capas en VRAM, inferencia GPU (~50 tok/s)
   │       └── No → fallback automático a CPU (~7 tok/s)
   └── (sin choque con Ollama, sin requerir Ollama)
```

El binario con CUDA habilitado **nunca crashea por ausencia de GPU**. Cae a CPU
gracefully. Funciona en cualquier máquina, va más rápido cuando hay GPU.

---

## Optimizaciones complementarias (independientes de GPU)

Aunque no tengas GPU, hay 3 cambios que mejoran significativamente la experiencia:

### 1. `max_tokens=200` en llamadas live

Actualmente `live_feedback.rs::call_ollama_and_emit` pasa `None` para max_tokens →
default `4096`. Un tip cabe en 200. Cambio:

```rust
// En live_feedback.rs::call_ollama_and_emit
generate_summary(
    &HTTP_CLIENT,
    &LLMProvider::BuiltInAI,
    builtin_model,
    "",
    COACH_SYSTEM_PROMPT,
    &user_prompt,
    None,
    None,
    Some(200),         // ← antes None (4096), ahora 200
    Some(0.3),
    None,
    Some(&app_data_dir),
    Some(&cancel),
)
```

**Impacto en CPU**: 28s en lugar de 9 min. Aún lento, pero viable.

### 2. Tips hardcoded como fallback (Poncho-style)

Restaurar `tip: Some("...")` en los 6 NudgeTypes de `nudge_engine.rs`.
- Tip aparece **instantáneo** cuando el nudge se gatilla (sin LLM)
- LLM solo se invoca para señales léxicas críticas de `trigger.rs`

Strings de Poncho:
- `LowHealthScore`: "Atención: la conversación necesita mejorar. Pregúntale: '¿cómo te sientes con lo que hemos hablado?'"
- `Monologue`: "Llevas más de 1 minuto hablando. Haz pausa y pregunta: '¿esto te hace sentido?'"
- `TalkRatioDominant`: "Estás hablando mucho. Pregúntale: '¿qué opinas tú sobre esto?'"
- `SpeakingTooFast`: "Estás acelerando. Baja el ritmo y respira entre oraciones."
- `NoQuestions`: "Llevas rato sin preguntar. Pregúntale: '¿qué es lo más importante para ti?'"
- `NextStepsReminder`: "Llevas 20+ min. Pregúntale: '¿cuáles serían los siguientes pasos?'"

### 3. Bajar thresholds del nudge_engine

Actuales (idénticos a Poncho) son conservadores y solo gatillan después de 2-3 min:

| Nudge | Threshold actual | Sugerido para feedback temprano |
|---|---|---|
| Monologue | mono > 60s | mono > 40s |
| TalkRatioDominant | ratio > 0.65 + session > 120s | ratio > 0.55 + session > 75s |
| NoQuestions | q == 0 + session > 180s | q == 0 + session > 90s |
| LowHealthScore | health < 30 + session > 120s | health < 45 + session > 90s |

---

## Estado actual del código (post-port)

### Completado y funcionando

- ✅ Sidecar `llama-helper` arquitectura embebida (sin Ollama externo)
- ✅ `LLMProvider::BuiltInAI` interceptado en `llm_client.rs`
- ✅ `coach/llama_engine.rs` reescrito (45 líneas, sin HTTP, sin spawn de procesos)
- ✅ `coach/{commands, live_feedback, evaluator, setup}.rs` adaptados a BuiltInAI
- ✅ `tauri.conf.json` con `externalBin: ["binaries/llama-helper"]`
- ✅ Defaults a `gemma3-4b-q4`
- ✅ Migraciones SQL para corregir DB existente
- ✅ Onboarding con reconciliación con disco (cura DB rota)
- ✅ Frontend `PipelineSelector.tsx` adaptado a nuevo shape de status
- ✅ Build debug exitoso
- ✅ Tips se generan (verificado en logs)
- ✅ Logs de diagnóstico en cada tick del nudge loop
- ✅ Mejoras locales propias: warmup LLM-005, dedup `HashSet<String>`, paths fallback `models/llm/` → `models/summary/`

### Decisiones pendientes

- ⏸️ Restaurar tips hardcoded de Poncho como fallback rápido — recomendado
- ⏸️ Ajustar `max_tokens=200` en llamadas live — recomendado
- ⏸️ Bajar thresholds del nudge_engine — opcional
- ⏸️ Recompilar `llama-helper` con GPU:
  - macOS: `--features metal` — alta prioridad (out-of-the-box win)
  - Windows: `--features cuda` o `--features vulkan` — requiere instalación de SDK por desarrollador
  - Linux: `--features cuda` o `--features vulkan` — igual

### Issues residuales conocidos

- ⚠️ Atribución de speaker: el listener de `transcript-update` recibe muchos chunks como `speaker="user"` aunque sean del interlocutor. Probable bug en el pipeline de audio dual-canal que asigna `source_type`. Investigar `audio/pipeline.rs` y `audio/transcription/worker.rs` para confirmar que el sistema audio genera segmentos VAD propios con `DeviceType::System`.

- ⚠️ Generación de tip de calidad: Gemma 1B (modelo más liviano) no genera contenido coherente — repite fragmentos del system prompt. Por eso default es ahora `gemma3-4b-q4`. El 1B queda solo para máquinas sin GPU y RAM muy limitada, idealmente con prompt simplificado.

- ⚠️ Timeout del sidecar: 60s actual. En CPU sin override de `max_tokens` tarda más → kill del child process → siguiente request falla con "Sidecar closed stdout". Subir a 180s o aplicar `max_tokens=200`.

---

## Comparación final

| Característica | Poncho | Maity Desktop (post-port, CPU) | Maity Desktop (post-port + GPU) |
|---|---|---|---|
| Tips hardcoded instantáneos | ✓ | ✗ (cambiamos a `tip: None`) | ✗ |
| Tips contextuales del LLM | ✓ vía Ollama externo (rápido si Ollama instalado) | ✓ vía sidecar embebido (lento, ~30-50s) | ✓ vía sidecar embebido (rápido, ~3-5s) |
| Requiere Ollama instalado | ✓ Sí | ✗ No | ✗ No |
| Empaquetado de motor LLM | Sidecar para chat post-meeting solamente | Sidecar para todo | Sidecar para todo |
| Velocidad chat IA en grabación | Rápida (Ollama externo + GPU) | Lenta (CPU) | Rápida (GPU) |
| Funciona en máquina sin GPU | Solo nudges hardcoded | ✓ Funciona pero lento | ✓ Cae a CPU automáticamente |

**Camino más sólido**: combinar todo lo bueno:
1. Restaurar tips hardcoded (Poncho UX)
2. LLM solo desde triggers léxicos críticos (Poncho design)
3. Compilar con GPU en cada plataforma (resuelve velocidad sin requerir Ollama)
4. `max_tokens=200` en llamadas live (Poncho param)
5. Ajustar thresholds para feedback más temprano

Resultado: tips instantáneos siempre + tips contextuales rápidos cuando hay señal +
cero dependencias externas para el usuario + funcional en cualquier hardware.

---

# Apéndice (extraído de CLAUDE.md, sep-2026): estado real del sidecar en producción

Las secciones siguientes son el estado VIGENTE y de cumplimiento obligatorio; prevalecen sobre el análisis histórico de arriba.

## Qué usa REALMENTE el sidecar local (Gemma) — ago-2026

**Verificado contra el código, no contra la intención.** El único consumidor vivo del `llama-helper` en el producto embarcado son los **tips en vivo del coach** durante la grabación (más el warmup de arranque que existe sólo para alimentarlos). Todo lo demás que "parecía" depender de Gemma es nube o código muerto, y confundirlo ya costó una investigación entera:

| Camino | Realidad |
|---|---|
| **Maity Chat** | **Nube.** `https://www.maity.cloud/api/maity-chat` por SSE (`features/maity-chat/services/maityChatService.ts`); **DeepSeek corre del lado servidor**, el desktop nunca nombra el modelo. Cero `invoke(` en toda la feature. |
| `coach_chat` (Rust) | **Código muerto**: registrado en `lib.rs`, cero call sites en TS. Su helper `call_coach_builtin` muere con él. |
| `coach_evaluate_meeting` | **Código muerto**: cero call sites en TS. |
| Minuta / análisis V4 | **Nube**: `api/finalize.rs` → `POST www.maity.cloud/api/conversations`. |
| Resumen local (`api_process_transcript` → `LLMProvider::BuiltInAI`) | **Inalcanzable en la práctica**: vive tras `/meeting-details`, ruta **sin un solo enlace entrante**; y el provider por defecto de una instalación limpia es `'ollama'`, no `'builtin-ai'`. |

No se borró nada de eso (decisión de ago-2026: documentar, no borrar — el diff no aporta al usuario). Pero **no asumir que algo "usa Gemma" sin buscar su call site en TS**.

## En tier Low el LLM del coach está APAGADO (ago-2026, piloto Dingler)

`coach::should_use_llm_tips()` (en `coach/mod.rs`) es el punto de decisión **único**: lo consultan el warmup de `lib.rs` y `live_feedback::start`. Si divergieran, el modelo quedaría residente en RAM sin nadie que lo consuma — el peor de los dos mundos. Motivo: en dos semanas y 7 equipos de 5–7 GB el LLM produjo **1 tip** contra 19 heurísticos, a cambio de 75 reinicios de sidecar, 28 timeouts, 26 aperturas de breaker y `p95 = 94 s`; el helper pica en 1.2 GB justo cuando Parakeet y FFmpeg más memoria necesitan (215 avisos de presión de memoria, mínimos de **74 MB** libres).

- **No se re-enciende al terminar la grabación**: por la tabla de arriba, no hay otro consumidor al que servir.
- Los tips **heurísticos** (`evaluate_health_tips`, tick de 3 s) y el gauge de participación siguen intactos. El coach no se apaga, sólo su mitad cara.
- `ensure_low_tier_tips_model` fue **eliminada**: bajaba ~1 GB en background y sólo corría en tier Low, es decir en los equipos que menos podían pagarlo. La descarga manual desde Ajustes → Pipeline sigue disponible.
- El umbral de tier se corrigió a la vez: las ramas **Cuda y Metal no tenían piso de RAM**, así que una laptop de 6 GB con driver NVIDIA salía `High` y recibía el modelo grande. Ahora `<8 GB` → Low, `<12` → Medium (la rama Vulkan ya tenía su piso desde jul-2026).

## El sidecar no muere por idle durante una grabación con tips-LLM (sep-2026, #03 de la auditoría de recursos)

El idle-kill de `sidecar.rs` (300 s sin Generate) y el cooldown del breaker del coach (300 s) eran el mismo número: tres tips fallidos abrían el breaker, con el circuito abierto `call_ollama_and_emit` retornaba antes de tocar el pool (nadie llamaba a `ensure_running`, lo único que refresca `last_activity` aparte de un Generate exitoso), el idle loop mataba el helper a los 300-360 s y el probe half-open caía en un spawn frío (relectura de 1-2.4 GB de GGUF, 50-90 s de CPU); y como el contador de fallos no se reiniciaba al abrir, el primer fallo del probe reabría otros 300 s. Lo mismo pasaba en cualquier tramo callado de 5 min de un segmento. Era el mecanismo de 55 reinicios en 62 sesiones Low de 0.2.57 (hoy Low ya no usa el LLM; esto aplica a Medium+). Reglas, todas deliberadas:
- **Lease de sesión, no gate por fase.** `SidecarManager::keepalive()` devuelve un guard RAII (`SidecarKeepAlive`, contador `keepalive_holds`) y el idle loop trata `holds > 0` igual que un request en vuelo: refresca `last_activity` y sigue (`idle_verdict`, pura, con tabla). `live_feedback::start` lo toma con `llm_helper::acquire_sidecar_keepalive` → `SidecarPool::get_or_create` (crea el manager SIN spawnear; el proceso sigue naciendo lazy en el primer tick) **sólo cuando `LLM_TIPS_ENABLED` resolvió `true`**, con la clave del pool = `map_to_builtin_id(modelo)` (la misma que usa `CoachLlmService`), y `stop()` lo suelta. `summary/` no importa `recording_phase` ni estado del coach: la política es del manager, es por modelo (el del resumen no queda vivo de rebote) y se prueba con I/O falsa y tiempo pausado. Todo consumidor de larga duración nuevo toma un lease; no refresca `update_activity` a mano.
- **Refrescar mientras se sostiene es a propósito**: al soltar el lease quedan ≥300 s de pista, que cubren el hueco stop→start de la rotación por hora (`start()` llama a `stop()` primero). Sin el refresco, la rotación mataría el helper en el siguiente tick.
- El lease vive en el manager (`Arc` del pool), así que **sobrevive respawns**: strikes por timeout y cooldown del presupuesto siguen matando el proceso, y deben — el lease sólo gobierna el idle loop. `shutdown_all` al salir y `shutdown_sidecar_gracefully` tampoco lo consultan.
- **El timer de idle del propio `llama-helper` es inerte mientras el manager está sano**: el health loop hace `ping` cada 30 s y `Ping` refresca su reloj (`main.rs`). Si cae a unhealthy deja de recibir pings y se despide solo a los 300 s: es el camino de respawn de siempre.
- **`last_activity` es `tokio::time::Instant` (`ActivityInstant`), no `std`**: en producción es idéntico; en tests con `start_paused` sigue el reloj pausado. Con `std::time::Instant` el test del idle loop nunca vería pasar los 300 s.
- **El breaker es un tipo (`coach/breaker.rs`) con un solo `static COACH_BREAKER`** y política pura (`record_failure(now_ms)` → `Counting(n) | Opened`); **al abrir se reinicia el contador**, así el half-open exige 3 fallos nuevos. `LlmError::Cancelled` **no cuenta**: es `stop()`/rotación a media generación, no salud del sidecar (inflaba `breaker_opens` justo al cerrar). Ojo: los timeouts del sidecar llegan como `LlmError::Internal` (`From<anyhow::Error>`); la clasificación sigue siendo gruesa.
- **No se tocaron `DEFAULT_IDLE_TIMEOUT_SECS`, `COOLDOWN` del breaker ni `RESTART_COOLDOWN`.** Con el lease la coincidencia deja de importar dentro de la grabación, y fuera de ella 300 s es el valor correcto para soltar 1-2.4 GB rápido (#04). Un Generate que expira ahora sí refresca actividad: si pagó 120 s de carga fría, el modelo está caliente y matarlo 3 min después tira justo ese trabajo.
- `SidecarPool::get_or_create` inserta el manager ANTES del primer spawn (antes un primer spawn fallido tiraba el manager y con él el presupuesto de reinicios) y ya no se sostiene el write lock del pool durante los 50-90 s del spawn.
- Verificación en producción: `coach.session_summary.sidecar_idle_kills` (delta de `SIDECAR_IDLE_KILLS_TOTAL`, 4.º elemento de `supervision_counters()`) **debe ser 0 en Medium+**; >0 es regresión. Viaja por el spread de `useCoachMetricsTelemetry` (cero entradas de catálogo nuevas).
- Pendiente anotado (no es #03): `CoachLlmService::generate_internal` hace `manager.shutdown()` al cancelar (`llm_service.rs`, brazo `token.cancelled()`); un tip en vuelo en el `stop()` de la rotación sigue costando un arranque frío al segmento siguiente — con ids confirmados el kill ya no haría falta, pero tiene su propia arista (escritura parcial en el pipe si la cancelación cae a media `write_all`). Y guardar la config de modelos en Ajustes durante una grabación drena el pool entero (`shutdown_sidecar_gracefully` hace `take()`), dejando el lease sobre un manager huérfano hasta el siguiente `start()`.

## Resumen built-in (Gemma) — requisitos y provenance del sidecar

- El resumen con IA local usa el sidecar `llama-helper.exe` (`externalBin: ["binaries/llama-helper"]` en `tauri.conf.json`; fuente en `C:\maity_desktop\llama-helper\`, `cargo build --release -p llama-helper`). Debe existir el binario REAL en `frontend/src-tauri/binaries/llama-helper-x86_64-pc-windows-msvc.exe` (y en `msix_staging/llama-helper.exe` para el MSIX) — un stub de 0 bytes hace fallar el `spawn`. Además el modelo Gemma debe estar descargado (`gemma3:1b`/`gemma3:4b` según plataforma).
- **Provenance del sidecar (ago-2026):** `binaries/` está **gitignored** y nada lo construía en el build local — así se embarcaron 3 meses de helper stale (0.2.51-0.2.53, sin protocolo de ids → kill en cada timeout). Hoy el pre-build corre `frontend/scripts/verify-helper-binary.js`: compila `cargo build -p llama-helper --release` (cacheado; la primera vez compila llama.cpp, minutos) y **falla si el SHA-256 del bundleado no coincide**. Regenerar con `node scripts/verify-helper-binary.js --fix` (copia a `binaries/` y a `msix_staging/` si existe). Se salta en CI (los workflows compilan el sidecar con features de plataforma). El smoke post-build además le habla al helper bundleado (`{"type":"version","id":1}` → `{"type":"version","version":"0.1.1","protocol":2,"id":1}`); un helper viejo responde `error` sin id. **Al spawn**, `sidecar.rs` negocia capacidades con un ping correlacionado (`probe_capabilities`, 5 s, sin tocar el modelo) y loguea la versión del helper: `ids_confirmed` ya no se infiere del primer Generate; la ventana fría de 120 s la gobierna `model_warm` (primer Generate respondido), independiente de los ids.
