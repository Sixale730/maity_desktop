# A/B: Parakeet int8 — DirectML vs CPU (2026-07-20)

**Decisión: Parakeet corre en CPU.** `prefer_gpu = false` en `parakeet_engine/model.rs`
(encoder, decoder_joint y nemo128). Moonshine y Canary conservan GPU.
`MAITY_ONNX_FORCE_CPU=1` sigue existiendo como override global de debug.

## Contexto

Usuarios reportaban transcripción degradada (frases truncadas, palabras inventadas,
mezcla de inglés) desde ~v0.2.51. La auditoría de logs jul-2026 ya había identificado
lag de transcripción (causa #2: hasta 8.5 min de atraso, 369 errores ORT seguidos =
80 min sin texto) e inglés por LID inestable (causa #1). v0.2.51 (commit `666f976`,
30-jun) activó DirectML para los engines ONNX — sospechoso por fechas.

Hipótesis inicial: el modelo int8 sobre DirectML degrada la numérica (dequantize→
float→requantize en operadores no soportados) → peor WER.

## Setup

- Misma máquina (RTX 3050 4GB, `gpu_detectada=Cuda`), mismo día, mismo build (ciclo
  0.2.53, commits `dbb913b..24e8f88`).
- Log: `%LOCALAPPDATA%\Maity\logs\maity.2026-07-20.log` — sesiones 17:54Z (v0.2.52
  DirectML), 19:45Z (CPU vía `MAITY_ONNX_FORCE_CPU=1`), 19:56Z (DirectML).
- **Mismo audio de 3 min** (video en español) reproducido por bocinas en el run CPU
  (19:49Z) y el run DirectML (20:01Z) → entrada idéntica por el canal de sistema.
- Latencia medida pareando `Processing speech audio chunk N` → `transcription
  complete for chunk N` (script `lat_ab.py`).

## Resultado 1 — Velocidad: CPU gana 2.3×

| Sesión | EP | n | p50/chunk | p90 | max | RTF* |
|---|---|---|---|---|---|---|
| 11:54 (v0.2.52) | DirectML | 4 | 1.80s | 2.12s | 2.12s | 0.94 |
| 12:25 (0.2.53) | DirectML | 314 | 1.81s | 2.53s | 4.17s | 0.97 |
| 13:45 (0.2.53) | **CPU** | 40 | **0.78s** | **0.96s** | 1.16s | **0.39** |

*RTF = tiempo de inferencia ÷ duración del audio del chunk.

RTF ~0.95 = al borde del tiempo real: cualquier hipo (coach en GPU, otra app)
atrasa la cola → backpressure descarta chunks → **pedazos de conversación que nunca
se transcriben**. RTF 0.39 deja 60% de margen: nunca se atrasa, cero drops.
Consistente con la auditoría: la máquina de k_ore (8 cores, SIN GPU) lograba p50
0.69s/chunk en CPU.

## Resultado 2 — Precisión sobre audio idéntico: EMPATE (hipótesis numérica DESCARTADA)

Diff palabra a palabra de los mismos 3 minutos:

| Fragmento real | CPU | DirectML |
|---|---|---|
| "más **enojo** sienten sobre la inteligencia artificial" | "en ojos" ✗ | "enojo" ✓ |
| "de ira que de **esperanza**" | "de esperar" ✗ | ✓ |
| "en **particular** inteligencia artificial" | "investicular" ✗ | ✓ |
| "los data centers **destruyen** el agua" | omite ✗ | ✓ |
| "problemas **cognitivos** serios" | "definitivos" ✗ | ✓ |
| "Universidad de **Brown**" | "Brown. So you're quite." ✗ | ✓ |
| "se puede **delegar** pensar" | "de negar a" ✗ | ✓ |
| "empleo de **contador**" | ✓ | omitido ✗ |
| "**diseños** espectaculares" | ✓ | "señores" ✗ |

DirectML incluso ligeramente mejor en este pase. **La numérica int8 sobre DirectML
NO degrada el modelo.** (Caveat: el run CPU reprodujo el audio justo al final de una
junta; condiciones de mic/eco pudieron diferir un poco.)

## Interpretación

La "degradación percibida" era **latencia + incompletitud**, no WER:
- DirectML: texto tardío y con hoyos (drops por backpressure) → "se siente impreciso".
- CPU: texto instantáneo y completo → "se siente preciso y fluido".

La precisión real (palabras mal oídas) es idéntica en ambos EPs y su límite es el
**chunking de 2s** que parte frases a la mitad — visible en ambas columnas del diff.

## Beneficios colaterales del cambio

1. Adiós a la espiral de lag (causa #2 de la auditoría) en máquinas donde DirectML
   corre el int8 lento.
2. Los 4GB de VRAM quedan libres para el coach (gemma) → desaparece la contención
   que mataba grabaciones a los 8-11s (`incident_parakeet_vram_contention_coach`) y
   las ráfagas de errores ORT.

## Pendiente (la palanca real de WER)

El fix `1982e69` (chunks 4-6s para LID estable) está **inerte en tiempo real**: el
VAD emite ventanas de ~2s y el `flush_timeout=400ms` del ChunkAccumulator expira
antes de que llegue la siguiente (~2s de reloj) → despacha siempre 2.0s. Opciones:
1. Propagar flag `ended_by_silence` del VAD en `AudioChunk` (correcto, ~5 archivos).
2. Subir `flush_timeout` a ~2500ms (1 línea, +2s de latencia percibida).

Parakeet v3 NO admite forzar idioma (LID implícito por rangos de token-IDs — doc
NeMo); el único camino de precisión es más contexto por chunk, o Canary (que sí
acepta `source_lang`/`target_lang`, ya cableado dev-only).
