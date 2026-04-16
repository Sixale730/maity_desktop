# Prompt Lab — laboratorio local para iterar prompts de evaluación

## Qué es

Un laboratorio que corre en tu PC (sin internet) para probar variaciones del
prompt que evalúa tus reuniones. Usa **Ollama local** como "chef" en lugar del
servidor Vercel. Al final del ciclo, migramos el ganador a producción.

## Estructura

```
scripts/prompt_lab/
├── README.md              ← esto
├── fixtures/              ← transcripciones de muestra (.txt)
│   └── sample_standup.txt
├── prompts/               ← variantes del prompt (.txt)
│   ├── v1_actual.txt
│   └── v2_mckinsey.txt
├── out/                   ← resultados (.json + .html por cada run)
├── run_prompt.py          ← corre 1 prompt sobre 1 fixture con Ollama
├── render_dashboard.py    ← genera HTML con Chart.js de 1 caja V4
└── compare_prompts.py     ← corre matriz N prompts × M fixtures
```

## Flujo de una prueba (30 segundos)

```bash
# 1. Corre 1 prompt sobre 1 transcripción
python scripts/prompt_lab/run_prompt.py \
    --fixture scripts/prompt_lab/fixtures/sample_standup.txt \
    --prompt scripts/prompt_lab/prompts/v1_actual.txt \
    --model qwen3:14b

# Output: scripts/prompt_lab/out/sample_standup__v1_actual.json

# 2. Render HTML con gráficas
python scripts/prompt_lab/render_dashboard.py \
    --input scripts/prompt_lab/out/sample_standup__v1_actual.json

# Output: scripts/prompt_lab/out/sample_standup__v1_actual.html

# 3. Abre en navegador
start scripts/prompt_lab/out/sample_standup__v1_actual.html
```

## Flujo de comparación (matriz)

```bash
# Corre TODAS las combinaciones prompt × fixture
python scripts/prompt_lab/compare_prompts.py --model qwen3:14b

# Abre out/index.html con enlaces a los resultados
start scripts/prompt_lab/out/index.html
```

## Requisitos

- Python 3.11+
- Ollama instalado y corriendo (`ollama serve` o servicio Windows)
- Al menos un modelo: `ollama pull qwen3:14b` (recomendado) o `gemma4`, `qwen3:8b`, `gemma3:4b` (más rápido)

## Modelos recomendados

| Modelo | Tamaño | Velocidad | Calidad análisis |
|---|---|---|---|
| `qwen3:14b` | 9.3 GB | Media | ⭐⭐⭐⭐⭐ |
| `gemma4:latest` | 9.6 GB | Media | ⭐⭐⭐⭐ |
| `qwen3:8b` | 5.2 GB | Rápida | ⭐⭐⭐⭐ |
| `gemma3:4b` | 3.3 GB | Muy rápida | ⭐⭐⭐ |

## Schema de salida — caja V4 simplificada

```json
{
  "resumen": {
    "puntuacion_global": 78,
    "nivel": "Avanzado",
    "fortaleza": "...",
    "mejorar": "..."
  },
  "dimensiones": {
    "claridad": 8.0,
    "proposito": 7.5,
    "estructura": 7.0,
    "emociones": 6.8,
    "muletillas": 7.2,
    "adaptacion": 6.9,
    "persuasion": 7.1,
    "formalidad": 7.5
  },
  "radiografia": {
    "muletillas_total": 23,
    "muletillas_detalle": {"este": 8, "eh": 7, "o sea": 5, "basicamente": 3},
    "ratio_habla": 55,
    "participacion_pct": {"user": 55, "interlocutor": 45}
  },
  "timeline": {
    "segmentos": [
      {"momento": "intro", "desde_s": 0, "hasta_s": 30, "puntuacion": 8},
      {"momento": "cuerpo", "desde_s": 30, "hasta_s": 120, "puntuacion": 7}
    ]
  }
}
```

## Pasos para migrar un prompt ganador a producción

1. Guardar el prompt ganador como `prompts/production.txt`
2. Anotar el modelo y parámetros usados (temperature, etc.)
3. Copiar el texto al prompt real en `frontend/src-tauri/src/summary/communication_evaluator.rs`
4. Si el análisis V4 lo hace el Vercel API → abrir PR en el repo de la Edge Function
5. Agregar `prompt_version` al JSON de salida para trazabilidad histórica
