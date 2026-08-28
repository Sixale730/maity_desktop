# Piloto <EMPRESA> — hallazgos técnicos (<desde> → <hasta>)

> Documento **interno** de Maity (producto/plataforma). Nada de lo que está aquí va al reporte del manager
> (artifact "<título del artifact>"): ahí solo van conductas, competencias y acciones en lenguaje del cliente.
> Corte: `<YYYY-MM-DD HH:MM>` CDMX. Horas en `America/Mexico_City`. Fuente: Supabase `maity.*` vía
> `.claude/skills/piloto-analisis/queries.sql` (Q0–Q9) con los parámetros del encabezado.

## Contexto que cambia la lectura

- Personas excluidas de las métricas de equipo (managers/admins): <lista + por qué>.
- Personas con bloqueo conocido (sin micrófono, sin permiso, sin equipo): <lista>. No es "no quiso", es "no pudo".
- Plan/cuota: <Free→Pro, fecha>; efecto en `analysis_status='quota_skipped'`.
- Versiones instaladas (`device.profile.app_version` / `build_channel`): <tabla corta>.
- Jornada de referencia usada para cobertura: <09–18 L–V default> (supuesto; la config real del scheduler vive en cada PC).

## Cifras base

Universo: <N> conversaciones no descartadas · <h> h · <N personas> de <M>. Estado de análisis: completed <n> · skipped <n>
(`insufficient_user_words` <n> / `no_evaluable_speech` <n>) · quota_skipped/failed <n> (backfill: ver abajo). Minutas <n>.

## Hallazgos, por severidad

### 1. <Crítico|Serio|Cuota|Modelo|Cerrado> — <título en una línea>
<Evidencia con números y query de origen.> **Qué hacer:** Corto: … · Mediano: …

(repetir)

## Lo que NO va al manager y por qué

| Tema técnico | Por qué no va | Cómo se dice en el reporte B |
|---|---|---|
| Atribución por canal (mic=usuario / sistema=interlocutor) → "monólogo" en presencial | Es un límite del producto, no una conducta del equipo | "En presencial Maity solo escucha a la persona del equipo; empatía y adaptación se midieron en X de N" |
| RAM / tier / congelamientos | Diagnóstico de plataforma | No se menciona; si bloquea grabar, va como "no ha podido grabar" + acción |
| Tormenta de reintentos del scheduler / errores | Bug nuestro | No se menciona |
| Cuota Free y backfill | Operación de Maity | "Todas las conversaciones con contenido reciben análisis" |
| Jornada en silencio (segmentos sin conversación) | Modelo de grabación continua | "Tiempo con Maity encendida" vs "conversación analizada" |
| Versiones / canal Store vs GitHub | Operación | No se menciona |

## Señales de producto desde la vista del manager

- Cobertura de jornada (<rango>) con trigger dominante `<scheduler_rotation|manual>` → <lectura: el scheduler no acompaña la jornada / la gente sí la usa a mano>.
- % de tiempo grabado sin conversación evaluable → <lectura>.
- Empatía/adaptación no evaluables en <x %> → diarización en micrófono es el siguiente salto de valor.
- Vistas de análisis (`analysis_viewed`) <n> vs conversaciones <N> → el valor no llega; notificación/resumen semanal.
- Autoevaluación (registro) vs medido: <patrón> → argumento de venta y de onboarding.
- Uso fuera de grabar (juegos, roleplay, chat): <lectura>.

## Caveats de calidad de datos

- `tipo_reunion` / `categoria_interlocutor` son etiquetas del LLM de minuta; "Operativa" domina.
- Citas: pueden pertenecer al interlocutor (atribución por canal). Leer cada una antes de publicar; parafrasear si expone datos de clientes.
- `acciones[].falta` puede traer "dueño" o "dueno"; `responsable`/`fecha_limite` vacíos también cuentan.
- Autoevaluación Likert×20 y puntaje 0–100 no son la misma escala: se reporta dirección y brecha mayor, no diferencia numérica.
- `started_at` puede venir derivado del cierre en suspensiones (segmentos >61 min).
- `platform_logs.user_id` puede ser `users.id` o `auth_id` según emisor; filtrar `platform`.

## Backfill de análisis (si aplicó)

Fecha/hora · candidatos (Q9) · método (worker `conversations-async-analysis` con `CRON_SECRET`, `--one` primero) · resultado (`completed`/`skipped` por persona) · cifras actualizadas después.

## Tablas de apoyo

### Por persona
| Persona | Puesto | Conv | Horas | Analizadas | Sin conversación | Minutas | Cobertura 9–18 | RAM / tier | Versión |

### Por día (CDMX)
| Día | Horas | Conv | Personas | Analizadas | Equipo | 1:1 | Clientes |

### Errores (app.error + recording_start_failed)

## Puntos ciegos que siguen

## Changelog del reporte del manager

- `<fecha>` v<N>: <qué cambió y por qué>.

## Orden propuesto
