---
name: piloto-analisis
description: Analiza un piloto empresarial de Maity desde Supabase y produce DOS entregables separados — (A) notas técnicas internas en docs/PILOTO_<EMPRESA>_<fecha>.md y (B) un artifact HTML para el manager del cliente que convierte datos en conductas (6 competencias con por qué y qué mejorar, tarjeta por persona, tipos de junta, cobertura de jornada, qué hacen los que no graban, acciones). Úsalo cuando el usuario diga "analiza el piloto de X", "cómo va el piloto", "reporte para el manager / la dirección de X", "regenera el reporte de Dingler", "qué pasó el lunes / qué significa ese pico", "relanza los análisis que faltan", o cuando pida convertir métricas de uso (horas, conversaciones, minutas) en lectura de comportamiento.
argument-hint: "[empresa|company_id] [desde YYYY-MM-DD] [hasta YYYY-MM-DD HH:MM]"
---

# Skill: análisis de piloto en dos audiencias

Un piloto genera dos preguntas distintas y **no se contestan con el mismo documento**:

| | Reporte A — interno Maity | Reporte B — manager del cliente |
|---|---|---|
| Pregunta | ¿Cuánto y cómo se usó, quién, qué salió, y qué le pasó a la app y al modelo con este equipo? | ¿Cómo se comunica mi equipo, qué le pasa a cada quien y qué hago el lunes? |
| Forma | **Dos piezas**: (1) `docs/PILOTO_<EMPRESA>_<fecha>.md` (plantilla `report-a-template.md`) con lo técnico; (2) **artifact interno de uso** (KPIs de volumen, horas por día, heatmap día×hora, quién graba con RAM/versión, destino de cada conversación, hablantes por canal, "lo que le diríamos al manager") — ejemplo real en `report-interno-ejemplo-dingler.html` | Artifact HTML (`report-b-skeleton.html` + `build-report-b.mjs` + JSON de datos) |
| Contiene | RAM, scheduler, atribución, cuota, versiones, calidad de datos, backlog; volumen y ritmo de uso | Conductas, competencias, citas → alternativa, tipos de junta, cobertura, acciones |
| Nunca contiene | Datos que identifiquen clientes del cliente | Volumen como mérito ("148 conversaciones"), jerga, problemas técnicos, managers |

Decisión del usuario (2026-08-28): **al final son dos artifacts, uno interno y uno del cliente.** El de uso
(v2/v3 de Dingler: "estaba bien para nosotros") no se tira, se publica como interno con título distinto
("<Empresa> · lectura interna"); el de conductas es el único que ve el cliente.

Principio del reporte B (feedback del cofundador, 2026-08-28): **dato → pregunta del manager → frase sobre una conducta → acción**. Un número que no sobrevive esa conversión no va en el cuerpo ("¿para qué le sirve a Rita que se guardaron 148 conversaciones?"). Un pico de horas no dice nada hasta que se lee con la minuta del día: qué juntas fueron, con quién, de qué.

Archivos de esta skill:

```
.claude/skills/piloto-analisis/
├── SKILL.md               ← este archivo
├── queries.sql            ← encabezado CTE + Q0…Q9 (pegar en mcp__supabase__execute_sql)
├── report-a-template.md   ← esqueleto del md interno
├── report-b-skeleton.html ← tokens, CSS, tooltip; recibe {{MASTHEAD}} {{TOC}} {{SECTIONS}} {{FOOTER}}
├── build-report-b.mjs     ← node build-report-b.mjs <datos.json> <salida.html>
└── report-interno-ejemplo-dingler.html ← artifact interno de uso (v3 de Dingler) para partir de ahí
```

Datos por piloto: `docs/piloto/<empresa>-<fecha>.data.json` (estructura documentada al final; Dingler = `docs/piloto/dingler-2026-08-28.data.json`).

## Paso 0 — Parámetros

- Si `$ARGUMENTS` trae empresa/fechas → usarlas. Si no, `AskUserQuestion` con:
  1. **Empresa**: `company_id` (o buscar `select id, name from maity.companies where name ilike '%x%'`).
  2. **Ventana y corte** (hora CDMX). Default: primera conversación de la empresa → ahora.
  3. **Personas fuera de las métricas de equipo** (managers/admins que están en la plataforma) — no se deduce de la DB.
  4. **Personas con bloqueo conocido** (sin micrófono, sin permiso, sin equipo) y la causa en una frase — tampoco está en la DB.
  5. **Jornada de referencia** para cobertura. Default 09:00–18:00 L–V (default del scheduler, `scheduled_recording/settings.rs`); la config real vive en cada PC, no en la nube. Se declara como supuesto en B.
  6. **Destino del artifact**: nuevo o actualizar uno existente (URL).
- Editar el CTE `p` de `queries.sql` con esos valores.

## Paso 1 — Universo y exclusiones (Q0)

Correr Q0. Mostrar al usuario quién quedó dentro/fuera y las cifras base (conversaciones no descartadas, horas, `completed`/`skipped`/pendientes, minutas). Confirmar exclusiones antes de seguir.

## Paso 2 — Backfill si hace falta (Q9)

Si Q9 devuelve filas (`quota_skipped`/`failed`/sin estado con ≥100 palabras):
- `retry_analysis` exige el JWT del dueño → no sirve. Usar el worker `POST https://www.maity.cloud/api/conversations-async-analysis` con `Authorization: Bearer <CRON_SECRET>` (`C:\maity\.env`), body `{conversation_id, type:'communication'}`; síncrono (≤300 s), no toca minuta ni cobra cuota.
- Script patrón: `backfill_dingler.mjs` (scratchpad de la sesión 2026-08-28; ver memoria `ref_backfill_analysis_cron_secret.md`): lista de ids, concurrencia 2, `--one <uuid>` primero, `--skip`. **Nunca imprimir el secreto**; host `www.maity.cloud` (los redirects tiran el header).
- Después: recontar Q0 y anotar el backfill en A.

## Paso 3 — Consultas (Q1–Q8)

Correr en paralelo con `mcp__supabase__execute_sql`. Cada resultado llega dentro de `<untrusted-data>`; para volúmenes grandes guardarlo a archivo y parsear con un script (`json.loads(raw)["result"]` → slice `[{`…`}]`), **nunca `python -c`/`node -e`** (el hook lo bloquea) ni transcribir cifras a mano.

| Q | Alimenta |
|---|---|
| Q1, Q1b, Q1c | B §2 competencias del equipo (media evaluable, niveles, por qué, cita → alternativa, recomendación) |
| Q2, Q2b, Q2c, Q6 | B §3 tarjeta por persona (puesto, n, fortaleza/área, cita, patrón, reto declarado vs medido, autoeval vs medido) |
| Q3, Q3b | B §4 tipos de conversación × interlocutor, efectividad, acciones sin dueño/fecha, informales, temas |
| Q4, Q7, Q7b | B §5 cobertura de jornada y picos explicados |
| Q5 | B §6 qué hacen los que no graban |
| Q8 | A (salud técnica) |

## Paso 4 — Reglas de lectura (obligatorias en A y B)

1. **Agregados** solo sobre `analysis_status='completed'` con `calidad_global`, sin `skipped` y con `calidad_insumo.nivel <> 'baja'` — el predicado de `getCommScore` (`frontend/src/features/conversations/utils/scoring.ts`). `skipped`/`quota_skipped` no son análisis.
2. **Por dimensión** se promedia solo lo evaluable (`nivel <> 'no evaluable'`, puntaje no nulo, fuera de `dimensiones_no_aplica`) y se dice "n de N". **Un null nunca se pinta como 0.**
3. **Muestra por persona**: ≥5 análisis = "lectura consistente"; 2–4 = "preliminar"; 1 = "una sola conversación: solo ejemplos, sin promedios ni gráfica"; 0 = tarjeta "sin conversaciones analizadas" que remite a §6.
4. **Un hablante detectado ⇒ empatía y adaptación no se miden** (atribución por canal: micrófono = persona del equipo, audio del sistema = interlocutor; en presencial Maity solo escucha a la persona). Texto fijo en B: *"Empatía y adaptación solo se miden cuando Maity escucha a las dos partes (llamadas o videollamadas). En presencial solo escucha a la persona del equipo, así que se midieron en X de N conversaciones; el resto no cuenta ni a favor ni en contra."*
5. **Las horas no son mérito.** Se leen como cobertura de jornada (Q4) + qué se conversó (Q7b). Todo pico se explica con las minutas del día. "Tiempo con Maity encendida" ≠ "conversación analizada".
6. **El tipo de junta sale de la minuta** (`meta.tipo_reunion × categoria_interlocutor`), no de `omi_conversations.category` (ruido OMI: "otro" domina).
7. **Managers fuera** de todo agregado. Personas sin hardware/permiso se nombran con la causa en lenguaje del manager y con la acción concreta.
8. **Problemas técnicos solo en A.**
9. **Citas**: leer cada una antes de publicar. Preferir conversaciones con ≥2 hablantes (menos riesgo de que la frase sea del interlocutor). Parafrasear o redactar nombres de clientes, montos y números de póliza.
10. **Autoevaluación (Likert×20) vs medido (0–100)** no es la misma escala: se reporta dirección y la brecha mayor, no una resta con decimales.

## Paso 5 — Reporte B (manager)

Estructura fija de 8 secciones (la genera `build-report-b.mjs` desde el JSON):

| # | Sección | Responde | Forma |
|---|---|---|---|
| 1 | En una página | ¿Cómo se comunica mi equipo y qué hago? | 3–4 frases; sin gráfica, sin tiles |
| 2 | Las seis competencias | ¿En qué somos buenos, en qué no, por qué? | Barras horizontales con `n evaluables / N` + franja de niveles + por dimensión: qué pasa, ejemplo → mejor, qué mejorar. Sin radar (oculta la n) |
| 3 | Persona por persona | ¿Fortalezas y áreas de cada quien? | Tarjeta: puesto, n + tier, fortaleza, área con cita → mejor, patrón, reto declarado vs medido, dumbbell autoeval vs Maity (solo n≥2), cobertura, acción |
| 4 | Qué conversaciones tienen y cómo salen | ¿De qué son las juntas y sirven? | Matriz tipo × interlocutor (n · h · efectividad · informales), acciones con/sin dueño y fecha, decisiones, temas |
| 5 | Cuándo usa Maity el equipo y qué hay detrás de cada pico | ¿La usan en su jornada? ¿Qué pasó los días fuertes? | Barras de cobertura por persona (total vs analizada) + barras por día con los picos anotados |
| 6 | Quiénes no aparecen y qué sí hacen | ¿Están fuera o usan Maity de otra forma? | Mini-tarjetas |
| 7 | Acciones para las próximas dos semanas | ¿Qué hago el lunes? | Checklist por persona + equipo + qué necesita Maity |
| 8 | Cómo leer esto | — | ≤8 viñetas |
| — | `<details>` Datos de uso | apéndice | una línea: "miden la actividad de Maity, no la del equipo" |

Flujo: (a) llenar `docs/piloto/<empresa>-<fecha>.data.json` con las cifras de Q1–Q7 y las frases (revisar cada cita); (b) `node .claude/skills/piloto-analisis/build-report-b.mjs docs/piloto/<empresa>-<fecha>.data.json <scratchpad>/<empresa>-piloto.html`; (c) cargar las skills `artifact-design` y `dataviz` si se toca el esqueleto (la paleta ya está validada: series `#2a78d6/#eb6834/#1baf7a`, ordinal azul, estado good/warn/serious/critical); (d) checklist; (e) `Artifact` — mismo `file_path` (o `url`) si es regeneración; sin `favicon` en redeploy.

### Checklist bloqueante antes de publicar B

- [ ] Managers/admins fuera de todo agregado — `grep` de sus nombres en el HTML = 0.
- [ ] Cero jerga — `grep -iE "scheduler|trigger|quota|V4|RAM|tier|sidecar|skipped|atribuci|canal|versi[oó]n|0\.2\.|backfill|jsonb"` = 0.
- [ ] Todo número lleva su n ("en X de N").
- [ ] Ningún null pintado como 0 (dumbbells y barras con `n_eval = 0` → "sin medir").
- [ ] Empatía/adaptación solo evaluables + párrafo fijo.
- [ ] Personas con n<2 sin promedios ni gráfica.
- [ ] Cada cita leída; sin nombres de clientes, montos ni pólizas identificables.
- [ ] Cero problemas técnicos.
- [ ] Ninguna recomendación contradice el producto (2026-09-02): NUNCA sugerir pausar/apagar Maity, "grabar solo las reuniones/llamadas" ni "no grabar toda la jornada" — la jornada continua es el diseño de Maity; el silencio lo filtra el producto (umbral de 250 palabras en `finalize_segment_native`), no el usuario. `grep -iE "no (toda|la) jornada|jornada entera|grabar solo|solo grabar|pausar? maity|apagar maity"` = 0. Sí se vale lo aditivo ("llevar Maity también a las llamadas con clientes").
- [ ] Claro/oscuro OK (tokens en `:root`, `@media (prefers-color-scheme: dark) :root:not([data-theme="light"])`, `:root[data-theme="dark"]`).
- [ ] "Cómo leer esto" trae fecha/hora de corte y el supuesto de jornada.

## Paso 6 — Reporte A (interno): md + artifact de uso

**Artifact interno de uso** (audiencia: equipo Maity): partir de `report-interno-ejemplo-dingler.html`
(mismos tokens/CSS/tooltip que el esqueleto B; datos inline en los arrays `daily`, `heat`, `hourly`,
`users`, `spk` del `<script>` final, generados con Q7 + el perfil por hora + Q0/Q5 + `omi_transcript_segments.is_user`).
Secciones: Resumen (tiles de volumen), Ritmo de uso (horas/día, heatmap día×hora, perfil por hora), Quién
graba (tabla con análisis, "sin tema", vistas, RAM, tier, estado), Qué salió (destino por día, niveles,
hablantes por canal, lo que dicen las minutas), Lectura para el manager (borrador interno), Método.
Título "<Empresa> · lectura interna", favicon 🛠️, publicar como artifact **separado** del B. Puede
llevar jerga y nombres de managers si hace falta; no lleva datos de clientes del cliente.

**md técnico**: `docs/PILOTO_<EMPRESA>_<fecha>.md` con `report-a-template.md`. Secciones obligatorias además de los hallazgos: **Lo que NO va al manager y por qué** (tabla con "cómo se dice en B"), **Señales de producto desde la vista del manager**, **Caveats de calidad de datos**, **Backfill**, **Changelog del reporte del manager**. Cada cifra con su Q.

## Paso 7 — Memoria y cierre

Actualizar/crear `project_<empresa>_piloto_*.md` en la memoria (exclusiones, bloqueos, jornada, URL del artifact, corte) y el pointer en `MEMORY.md`. `git add`/`commit` de docs + skill si el usuario lo pide; **nunca `git push`**.

## Dispatch: qué pide el usuario → qué hacer

| El usuario dice… | Hacer |
|---|---|
| "analiza el piloto de X" / "cómo va el piloto" | Pasos 0–7 completos (A + B) |
| "reporte para el manager / la dirección" / "regenera el artifact" | Pasos 0–5 (+ actualizar changelog en A) |
| "notas técnicas" / "qué le pasó a la app con X" | Pasos 0–3 + 6 (solo A, Q0 + Q8) |
| "relanza los análisis" / "backfill" / "faltan análisis" | Paso 2 |
| "¿qué pasó el lunes?" / "qué significa ese pico" | Q7b para ese día → frase "fueron N juntas de … con …, temas …" |
| "cómo está fulana en empatía" | Q2b + Q2c filtradas por persona, con las reglas 2–4 |

## Gotchas (fechados)

- 2026-08-28 · Los RPC de equipo (`maity.get_team_engagement_summary`, `team_conversation_scores`, `get_form_responses_by_company`, `get_company_usage_summary`) son SECURITY DEFINER gateados por `auth.uid()`: desde `execute_sql` devuelven `{"error":"UNAUTHORIZED"}`. Consultar tablas directo (por eso `queries.sql` no los usa).
- 2026-08-28 · `least`/`greatest` de Postgres **ignoran NULL**: en Q4 el `left join` de quien no grabó daba cobertura 100 %. El `case when c.id is null then 0` es obligatorio.
- 2026-08-28 · `omi_conversations.discarded` existe y se usa (4 filas en Dingler): filtrar `deleted` y `discarded`, si no el universo no cuadra entre queries.
- 2026-08-28 · `platform_logs.platform` ∈ desktop|web|mobile → filtrar siempre; `event_data->'ctx'->>'occurred_at'` es la hora real (el outbox puede drenar horas después); `recording_stopped` no trae `trigger` (join por `recording_session_id`); `user_id` puede ser `users.id` o `auth_id` según emisor (`in (t.id, t.auth_id)`).
- 2026-08-28 · `users.first_name` trae espacios y mayúsculas ("María ", "JANETH ALEJANDRA") → `lower(split_part(trim(first_name),' ',1))` para agrupar, `initcap` para mostrar.
- 2026-08-28 · `form_responses`: `q4` puesto, `q17` mayor reto, Likert `q5..q16` → 6 competencias (`q5-6` claridad, `q7-8` adaptación, `q9-10` persuasión, `q11-12` estructura, `q13-14` propósito, `q15-16` empatía; mapeo canónico en `frontend/src/features/gamification/hooks/useGamifiedDashboardDataV2.ts:386-394`). Es one-off del registro, no señal de uso.
- 2026-08-28 · Juegos: todos traen 1 `tiempo_que_queda` del onboarding → excluirlo al contar ejercicios reales (Q5). Chat = `chat_threads`/`chat_messages` (no hay eventos de telemetría `chat.*`).
- 2026-08-28 · `meeting_minutes_data.meta.tipo_reunion` es etiqueta LLM y "Operativa" domina (125/129 en Dingler): la explicación de picos se apoya en `categoria_interlocutor` + títulos + `keywords`.
- 2026-08-28 · El resultado del MCP viene dentro de `<untrusted-data>`; para volúmenes grandes se guarda en `tool-results/*.txt` como `{"result": "...[{...}]..."}` → `json.loads(raw)["result"]` + slice `[{`…`}]`. Scripts a archivo (`.py`/`.mjs`); `python -c`/`node -e` están bloqueados por el hook.
- 2026-08-18 · PowerShell 5.1: pipes a exe anteponen BOM; `—`/`”` dentro de strings `.ps1` cierran la cadena → ASCII en `.ps1`; `git commit -F archivo`.
- 2026-08-28 · `retry_analysis` exige JWT del dueño; backfill = worker con `CRON_SECRET`. `git push` prohibido.

## Estructura del JSON de datos (`docs/piloto/<empresa>-<fecha>.data.json`)

```jsonc
{
  "empresa": "Dingler", "titulo": "Radiografía del piloto Dingler",
  "periodo": "14–28 de agosto de 2026", "corte": "28 de agosto de 2026, 09:30 (hora de CDMX)",
  "jornada": "09:00–18:00, lunes a viernes", "dias_habiles": 10,
  "resumen": ["frase 1", "…"],                                  // §1
  "nota_evaluable": "Empatía y adaptación solo se miden…",         // §2
  "competencias": [{ "key":"claridad","label":"Claridad","n_eval":64,"n_total":64,"media":41,
                     "critico":31,"desarrollo":23,"competente":10,"personas":7,
                     "que_pasa":"…","cita":"…","alternativa":"…","quien":"Margarita","mejorar":"…" }],
  "personas": [{ "nombre":"Erika","puesto":"…","n":23,"lectura":"consistente","dos_partes":9,
                 "fortaleza":"claridad","area":"estructura","cita":"…","alternativa":"…",
                 "patron":"…","que_cambiaria":"…","reto":"…","reto_vs_medido":"…",
                 "dims":{"claridad":{"medido":38,"n":23,"auto":50}, "…":{}},
                 "cobertura":26,"cobertura_analizada":20,"dias_con_maity":6,"accion":"…",
                 "sin_analisis":false, "bloqueo":null }],                     // §3
  "conversaciones": { "matriz":[{"tipo":"Operativa","interlocutor":"Equipo interno","n":58,"horas":43.7,"min":45,"efectividad":49,"informales":26}],
                      "acciones":{"total":101,"completas":10,"sin_fecha":92,"sin_dueno":20},
                      "decisiones":{"total":35,"confirmadas":29,"tentativas":6},
                      "informales":{"n":67,"total":129}, "temas":["póliza (32)","…"], "lectura":["…"] },   // §4
  "dias": [{"d":"2026-08-14","dow":"vie","h":7.9,"h_an":2.5,"conv":20,"an":3,"personas":7,"equipo":8,"uno":6,"cli":0,"quienes":"…"}],
  "picos": [{"d":"2026-08-17","titulo":"Lunes 17","texto":"…"}],            // §5
  "jornada_lectura": ["…"],
  "no_graban": [{"nombre":"Melissa","texto":"…"}],                            // §6
  "acciones": {"personas":[{"nombre":"Erika","accion":"…"}],"equipo":["…"],"maity":["…"]},  // §7
  "como_leer": ["…"],                                                          // §8
  "datos_uso": {"conv":144,"horas":99.3,"personas":"8 de 10","analisis":64,"minutas":129,"nota":"…"}
}
```
