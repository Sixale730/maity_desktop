# Coach IA — Copiloto de Reuniones en Tiempo Real

## Qué es

El **Coach** es un copiloto silencioso que acompaña al usuario durante una reunión en vivo (llamada de venta, demo, entrevista) y le da sugerencias cortas accionables (1-2 oraciones) para mejorar la conversación: cómo romper el hielo, qué pregunta hacer, cómo manejar una objeción de precio, cómo cerrar.

**100% local. Privacidad garantizada.** El coach SOLO usa Ollama corriendo en localhost. Las transcripciones NUNCA salen del equipo del usuario.

## Modelos soportados

| Modelo | Tamaño disco | RAM | Latencia CPU i5 | Licencia | Notas |
|---|---|---|---|---|---|
| **phi3.5:3.8b-mini-instruct-q4_K_M** (default) | ~2.3 GB | ~2.8 GB | 2-2.5s | MIT | Mejor balance latencia/calidad |
| **gemma4:e4b** (alternativa) | ~3 GB | ~3.5 GB | 3-4s | Apache 2.0 | Mejor calidad español, lanzado 2026-04-02 |

El usuario puede cambiar el modelo en runtime vía `coach_set_model`.

## Arquitectura

```
┌─────────────────────────────────────────────────────────┐
│  Frontend (CoachContext - Fase 2 pendiente)             │
│  - Rolling window 2000 chars de transcripción           │
│  - Trigger: timer 20s + cambio de speaker (silencio 2s) │
└────────────────┬────────────────────────────────────────┘
                 │ Tauri invoke
       ┌─────────▼─────────────────────────┐
       │  coach::commands::coach_suggest   │
       │  - Reusa LLMClient (no duplica)   │
       │  - Provider FIJO: Ollama          │
       │  - max_tokens: 150                │
       │  - temperature: 0.7               │
       └─────────┬─────────────────────────┘
                 │ HTTP
       ┌─────────▼─────────────────────────┐
       │  Ollama (localhost:11434)         │
       │  - phi3.5 o gemma4:e4b            │
       │  - Output JSON estricto           │
       └───────────────────────────────────┘
```

## API Tauri

### `coach_suggest(window, role, language) → CoachSuggestion`

**Argumentos:**
- `window: String` — últimos ~2000 chars de la transcripción acumulada
- `role: String` — rol del usuario (ej: "vendedor", "consultor", "entrevistador")
- `language: String` — código de idioma (`"es"` | `"en"`)

**Retorna:**
```rust
pub struct CoachSuggestion {
    pub tip: String,         // Máx 25 palabras
    pub category: String,    // icebreaker | question | objection | closing | pacing | rapport
    pub confidence: f32,     // 0.0-1.0
    pub timestamp: i64,      // Unix epoch seconds
    pub model: String,       // Modelo que generó
    pub latency_ms: u64,     // Latencia del LLM
}
```

**Filtrado**: el cliente debe descartar sugerencias con `confidence < 0.6`.

### `coach_set_model(model_id) → ()`

Cambia el modelo activo. Solo acepta `phi3.5:3.8b-mini-instruct-q4_K_M` o `gemma4:e4b`. Cualquier otro valor retorna error.

### `coach_get_status() → CoachStatus`

```rust
pub struct CoachStatus {
    pub model: String,           // Modelo activo
    pub ollama_running: bool,    // Health check rápido a localhost:11434
    pub last_latency_ms: u64,    // Latencia del último coach_suggest
}
```

## Prompt del Coach

El system prompt está en `coach/prompt.rs::SALES_COACH_SYSTEM_PROMPT`. Reglas estrictas:

1. Output **SOLO JSON** sin markdown.
2. Tip máximo 25 palabras (idealmente 10-15).
3. Tono natural, conversacional, sin jerga corporativa.
4. Categoría obligatoria: `icebreaker | question | objection | closing | pacing | rapport`.
5. Si el contexto no aporta señal, responde `confidence < 0.5` con tip genérico de pacing.
6. Idioma: responde en el MISMO idioma del contexto.
7. NUNCA inventa datos del cliente. NUNCA promete cosas en su nombre.

## Capa Heurística Español (Bonus de la Fase 1)

`audio/transcription/spanish_postprocess.rs` aplica correcciones livianas (sin LLM) sobre la salida cruda de Parakeet/Canary, antes de emitir `transcript-update`:

| Heurística | Ejemplo |
|---|---|
| Capitalización inicial | `"hola mundo"` → `"Hola mundo"` |
| Capitalización post-puntuación | `"hola. cómo estás"` → `"Hola. Cómo estás"` |
| Tildes interrogativas | `"que tal el día?"` → `"¿Qué tal el día?"` |
| Apertura `¿` | `"donde vives?"` → `"¿Dónde vives?"` |
| Atenuación muletillas inicio | `"eh, hola cómo estás"` → `"Hola cómo estás"` |
| Normalización espacios | `"hola    mundo"` → `"Hola mundo"` |
| Espacio antes de puntuación | `"hola , mundo ."` → `"Hola, mundo."` |
| Dedupe puntuación | `"hola..  mundo"` → `"Hola. Mundo"` |

**Garantías:**
- **Idempotente**: aplicar dos veces produce el mismo resultado.
- **Cero LLM**: 100% reglas, latencia <0.1ms en strings típicos.
- **Solo español**: si `language` no empieza con `"es"`, solo aplica capitalización.
- **Conservadora**: NO tilda `que` en afirmaciones (`"creo que me gusta"` queda igual).
- **Sin allocs hot path**: usa `String::with_capacity` y evita clones innecesarios.

**Tests**: 13/13 PASS (`cargo test --lib spanish_postprocess`).

## Estado actual

- ✅ **Fase 1**: Backend Rust + heurística español + tests + build verde
- ✅ **Fase 2**: Frontend `CoachContext` + `CoachPanel` UI lateral
- ✅ **Fase 3 (parcial)**: Communication Evaluator post-llamada + VAD Parakeet tuning + anti-stutter
- ⏳ **Fase 4**: Settings UI para cambio de modelo + reuso de `OllamaDownloadContext`
- ⏳ **Fase 5**: Feedback 👍👎 + métricas A/B en IndexedDB
- ⏳ **Futuro**: Moonshine engine como ASR alternativo

## Communication Evaluator (Ciclo #3)

Nuevo comando Tauri post-llamada que evalúa la comunicación del usuario.

### `coach_evaluate_communication(transcript, model?) → CommunicationFeedback`

```rust
pub struct CommunicationFeedback {
    pub overall_score: Option<f32>,    // 0-10
    pub clarity: Option<f32>,          // 0-10
    pub engagement: Option<f32>,       // 0-10
    pub structure: Option<f32>,        // 0-10
    pub feedback: Option<String>,      // resumen accionable
    pub strengths: Option<Vec<String>>,
    pub areas_to_improve: Option<Vec<String>>,
    pub observations: Option<CommunicationObservations>,
    pub model: Option<String>,
    pub latency_ms: Option<u64>,
}
```

**Uso típico**: invocar al cerrar una reunión sobre el `transcript` completo. La UI puede mostrar las métricas en una tarjeta resumen.

## VAD Parakeet-tuned (Ciclo #3)

Tras detectar hallucinations de Parakeet en grabaciones reales (`"Chandler vine a los diamantes"`, `"Adokín"`), se ajustó `vad.rs` con valores adoptados del proyecto referencia D:\Maity_Desktop:

| Param | Antes (Whisper-era) | Después (Parakeet) |
|---|---|---|
| `min_speech_time` | 150 ms | **300 ms** |
| `positive_speech_threshold` | 0.50 | **0.55** |
| `pre_speech_pad` | 150 ms | **200 ms** |
| `post_speech_pad` | 400 ms | **500 ms** |
| `min_silence_floor` | — | **400 ms** |

Resultado esperado: cero hallucinations en segmentos cortos de ruido (clicks, silencios entre frases).

## Anti-stutter (Ciclo #3)

`spanish_postprocess::clean_repetitive_text` aplica al INICIO del pipeline `enhance()`, antes de cualquier heurística español. Se ejecuta para todos los idiomas.

| Pattern | Input | Output |
|---|---|---|
| Word repeat | `"el el el caso"` | `"el caso"` |
| Phrase 2 repeat | `"creo que creo que es bueno"` | `"creo que es bueno"` |
| Phrase multi-repeat | `"creo que creo que creo que es bueno"` | `"creo que es bueno"` |
| Case-insensitive | `"El el el caso"` | `"El caso"` |

Conservador: NO toca palabras únicas consecutivas (`"el coche es rojo"` queda igual).

## Cómo probar manualmente (Fase 1)

1. Instalar Ollama: https://ollama.com/download
2. Descargar Phi-3.5: `ollama pull phi3.5:3.8b-mini-instruct-q4_K_M`
3. Verificar Ollama: `curl http://localhost:11434/api/tags`
4. Compilar Maity: `corepack pnpm run tauri:build` (en `frontend/`)
5. Abrir DevTools en la app y ejecutar:

```js
const { invoke } = window.__TAURI__.core;

// Health check
await invoke('coach_get_status');
// → { model: "phi3.5:3.8b-mini-instruct-q4_K_M", ollama_running: true, last_latency_ms: 0 }

// Pedir sugerencia
await invoke('coach_suggest', {
  window: "Hola Juan, gracias por tu tiempo. Quería contarte sobre nuestra plataforma de gestión de proyectos para equipos remotos.",
  role: "vendedor",
  language: "es"
});
// → { tip: "Pregúntale qué herramientas usa hoy y qué le gustaría mejorar", category: "question", confidence: 0.85, ... }
```

## Restricciones de privacidad

- **Provider hardcoded**: `coach_suggest` SOLO usa `LLMProvider::Ollama`. No hay rama para Claude/OpenAI/Groq aunque `LLMClient` los soporte.
- **Endpoint hardcoded**: `localhost:11434`. NO hay configuración para Ollama remoto.
- **Sin telemetría**: las sugerencias y feedback NO se envían a ningún servidor externo. Persistencia 100% local en IndexedDB.
