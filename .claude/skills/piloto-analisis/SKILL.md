---
name: piloto-analisis
description: Analiza un piloto empresarial de Maity desde Supabase y produce DOS entregables separados — (A) notas técnicas internas en docs/PILOTO_<EMPRESA>_<fecha>.md + artifact interno de uso y (B) un artifact HTML para el manager del cliente que convierte datos en conductas (resumen en porcentajes, 6 competencias con ejemplos con nombre, tarjeta por persona con radar y recomendaciones, resumen de juntas, acciones). Úsalo cuando el usuario diga "analiza el piloto de X", "cómo va el piloto", "reporte para el manager / la dirección de X", "regenera el reporte de Dingler", "qué pasó el lunes / qué significa ese pico", "relanza los análisis que faltan", o cuando pida convertir métricas de uso (horas, conversaciones, minutas) en lectura de comportamiento.
argument-hint: "[empresa|company_id] [desde YYYY-MM-DD] [hasta YYYY-MM-DD HH:MM]"
---

# Skill: análisis de piloto en dos audiencias

Un piloto genera dos preguntas distintas y **no se contestan con el mismo documento**:

| | Reporte A — interno Maity | Reporte B — manager del cliente |
|---|---|---|
| Pregunta | ¿Cuánto y cómo se usó, quién, qué salió, y qué le pasó a la app y al modelo con este equipo? | ¿Cómo se comunica mi equipo, qué le pasa a cada quien y qué hago el lunes? |
| Forma | **Dos piezas**: (1) `docs/PILOTO_<EMPRESA>_<fecha>.md` (plantilla `report-a-template.md`) con lo técnico; (2) **artifact interno de uso** (KPIs de volumen, horas por día, heatmap día×hora, quién graba con RAM/versión, destino de cada conversación, hablantes por canal, "lo que le diríamos al manager") — ejemplo real en `report-interno-ejemplo-dingler.html` | Artifact HTML (`report-b-skeleton.html` + `build-report-b.mjs` + JSON de datos) |
| Contiene | RAM, scheduler, atribución, cuota, versiones, calidad de datos, backlog; volumen y ritmo de uso; picos por día; quiénes no graban y por qué | Conductas en %, competencias con ejemplos con nombre, tarjeta por persona con radar y recomendaciones, resumen de juntas, acciones |
| Nunca contiene | Datos que identifiquen clientes del cliente | Volumen como mérito ("148 conversaciones"), jerga, problemas técnicos, managers, método en el cuerpo, etiquetas del modelo ("monólogo fragmentado") |

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

Datos por piloto: `docs/piloto/<empresa>-<fecha>.data.json` (estructura documentada al final; Dingler = `docs/piloto/dingler-2026-09-07.data.json`).

> **Los datos de clientes NO van al repo (decisión del usuario, 2026-09-07).** `docs/piloto/`, `docs/PILOTO_*.md` y `report-interno-ejemplo-dingler.html` están en `.gitignore` y se sacaron del índice (`git rm --cached`); viven solo en disco local. Al commitear un ciclo de piloto se commitea el skill (builder, esqueleto, queries, SKILL.md), nunca el JSON, el md ni el HTML con nombres y citas del equipo del cliente. Si el ejemplo interno hace falta en otra máquina, se regenera desde Supabase con Q7 + Q0/Q5.

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
| Q1, Q1b, Q1c | B §2 competencias del equipo (`media_all`, niveles `*_all` en %, qué pasa, 3 ejemplos con nombre, qué mejorar) |
| Q2, Q2b, Q2c, Q6 | B §3 tarjeta por persona (puesto, n, fortaleza/área, 2–3 ejemplos, patrón llano, radar autoeval vs `medido_all`, recomendaciones) |
| Q3, Q3b | B §4 resumen de juntas (internas/clientes/otras en %, efectividad, tramos sin agenda, acciones sin dueño o fecha en %, temas en %) |
| Q4 | B §1 barra de cobertura por persona |
| Q7, Q7b | A artifact interno (horas por día y picos explicados) — ya no van en B |
| Q5 | A (quiénes no graban y qué sí hacen); en B solo la acción concreta en §5 |
| Q8 | A (salud técnica) |

## Paso 4 — Reglas de lectura (obligatorias en A y B)

1. **Agregados** solo sobre `analysis_status='completed'` con `calidad_global`, sin `skipped` y con `calidad_insumo.nivel <> 'baja'` — el predicado de `getCommScore` (`frontend/src/features/conversations/utils/scoring.ts`). `skipped`/`quota_skipped` no son análisis.
2. **Por dimensión** se promedia solo lo evaluable (`nivel <> 'no evaluable'`, puntaje no nulo, fuera de `dimensiones_no_aplica`) y se dice "n de N". **Un null nunca se pinta como 0.**
3. **Muestra por persona**: ≥5 análisis = lectura consistente (sin badge en B); 2–4 = "lectura preliminar" en la línea de n; 1 = "una sola conversación: solo ejemplos, sin promedios ni gráfica"; 0 = tarjeta corta "sin conversaciones analizadas" con el bloqueo (si lo hay) y la acción.
4. **Empatía y adaptación se promedian de todos modos** (decisión del usuario, 2026-09-07, sobre el deck "Dashboard Maity.pptx": *"debes medirlo sí o sí porque los demás rubros están bajo la misma circunstancia"*). En B se promedia **todo puntaje no nulo** aunque el V4 lo marque `nivel = 'no evaluable'` o lo liste en `dimensiones_no_aplica` (columna `media_all` de Q1/Q2b), y se pinta como las otras cuatro con su "medida en n conversaciones". Ya **no** va el párrafo fijo de "solo se miden cuando Maity escucha a las dos partes". La distinción evaluable/no evaluable (`n_eval`) sigue viva en A. **Verificado 2026-09-07 en Dingler: cuando el modelo no puede evaluar, el V4 escribe `puntaje: 0` como relleno** (68 de 84 filas, todas exactamente 0) — un `avg()` ingenuo daba 11/100. `media_all` excluye ese relleno (`no_evaluable and puntaje = 0`), así que en la práctica coincide con `media_eval` y su n (16 de 84); lo que cambia en B es la presentación, no el número. Un 0 de relleno o un null real es "sin medir": nunca se inventa una cifra.
5. **Las horas no son mérito.** Se leen como cobertura de jornada (Q4) + qué se conversó (Q7b). Todo pico se explica con las minutas del día. "Tiempo con Maity encendida" ≠ "conversación analizada".
6. **El tipo de junta sale de la minuta** (`meta.tipo_reunion × categoria_interlocutor`), no de `omi_conversations.category` (ruido OMI: "otro" domina).
7. **Managers fuera** de todo agregado. Personas sin hardware/permiso se nombran con la causa en lenguaje del manager y con la acción concreta.
8. **Problemas técnicos solo en A.**
9. **Citas**: leer cada una antes de publicar. Preferir conversaciones con ≥2 hablantes (menos riesgo de que la frase sea del interlocutor). Parafrasear o redactar nombres de clientes, montos y números de póliza.
10. **Autoevaluación (Likert×20) vs medido (0–100)** no es la misma escala: se reporta dirección y la brecha mayor, no una resta con decimales.

## Paso 5 — Reporte B (manager)

Estructura fija de **5 secciones** (v5, 2026-09-07; la genera `build-report-b.mjs` desde el JSON):

| # | Sección | Responde | Forma |
|---|---|---|---|
| 1 | Resumen del equipo | ¿Cómo se comunica mi equipo? | ≤4 titulares de ≤25 palabras con la cifra en **%**; debajo, una barra por persona "parte de la jornada con Maity encendida" (una sola barra, sin gráfica de horas/día ni picos: eso vive en A) |
| 2 | Las seis competencias | ¿En qué somos buenos, en qué no, por qué? | Barra del promedio + franja de niveles etiquetada en **%** (tooltip con "31 de 64") + qué pasa (≤2 frases), qué mejorar (≤2 frases), **3 ejemplos con nombre** (cita → mejor · quién) |
| 3 | Persona por persona | ¿Fortalezas y áreas de cada quien? | Tarjeta: puesto, n (y "lectura preliminar" si n<5), fortaleza, área con 2–3 ejemplos (cita → mejor), patrón en lenguaje llano, **radar** cómo se ve vs cómo lo mide Maity (mismo estilo que el dashboard de inicio, solo n≥2; leyenda una sola vez en la cabecera), "Qué hacer" con 2–3 viñetas. **Sin** badge de lectura, sin cobertura, sin "dos partes", sin reto declarado |
| 4 | Resumen de juntas | ¿De qué son las juntas y sirven? | Barra apilada 100 % internas / clientes / otras (con "% de la jornada" si viene); mini-tarjetas Efectividad (clientes vs internas, tooltip "cómo se mide") y Tramos sin agenda (%); línea Prioridad; **una frase** "X % de las acciones quedan sin dueño o sin fecha (n de N)" + decisiones confirmadas; temas como barras horizontales en % + callout de los 2 primeros |
| 5 | Acciones para las próximas dos semanas | ¿Qué hago el lunes? | Checklist por persona + equipo + qué necesita Maity |
| — | footer `<details>` "Cómo se midió" | método | corte, jornada supuesta y las viñetas de `como_leer` — **nunca en el cuerpo** |
| — | footer `<details>` Datos de uso | apéndice | una línea: "miden la actividad de Maity, no la del equipo" |

Secciones que **salieron** de B con el feedback del 2026-09-07 (siguen en A): "Quiénes no aparecen" (las 3 personas sin análisis quedan como tarjeta corta en §3 + su acción en §5), "Cuándo usa Maity el equipo" (picos por día), "Cómo leer esto" (ahora `<details>`), el callout de empatía/adaptación, la tabla tipo × interlocutor, los 4 tiles de acciones y los chips de temas.

### Reglas de redacción de B (feedback del cofundador, 2026-09-07 — deck "Dashboard Maity.pptx")

1. **Menos es más.** §1 son ≤4 frases de ≤25 palabras; cada sub de sección es UNA línea. Lo que no cabe, no va.
2. **Porcentajes, no conteos.** "81 % fueron internas o uno a uno", no "105 de 129". El "n de N" va en tooltip o en `<small>`.
3. **Ejemplos con nombre y en cantidad.** 3 por competencia (`ejemplos[]` con `quien`) y 2–3 por persona. *"Si son 50 conversaciones, un ejemplo no basta."*
4. **Prohibidas las etiquetas del modelo sin traducir**: "monólogo fragmentado", "fragmentado y confuso", "monólogo desordenado". `patron_llano` describe la conducta observable: *"habla en frases sueltas que no se conectan entre sí"*.
5. **La tarjeta no explica, recomienda.** Fuera "reto declarado vs medido", cobertura y "dos partes audibles"; dentro `recomendaciones[]` concretas.
6. **Todo tile o tabla de conteo se convierte en una frase con % o en una gráfica de una lectura.** El "¿qué me dice esto?" del manager es la prueba: si un número no cabe en una frase con verbo, no va.
7. **Nada de método en el cuerpo.** Corte, jornada supuesta, umbrales y escalas van al `<details>` del footer. El periodo sí va arriba, grande.
8. **Cero datos técnicos para el director**: bloqueos de micrófono, permisos y hardware se dicen SOLO como acción ("una diadema USB para X") en §5, no como diagnóstico.

Flujo: (a) llenar `docs/piloto/<empresa>-<fecha>.data.json` con las cifras de Q1–Q7 y las frases (revisar cada cita); (b) `node .claude/skills/piloto-analisis/build-report-b.mjs docs/piloto/<empresa>-<fecha>.data.json <scratchpad>/<empresa>-piloto.html`; (c) cargar las skills `artifact-design` y `dataviz` si se toca el esqueleto (la paleta ya está validada: series `#2a78d6/#eb6834/#1baf7a`, ordinal azul, estado good/warn/serious/critical; radar `--radar-auto`/`--radar-maity` tomados del `RadarChartV2` del dashboard de inicio); (d) checklist; (e) vista previa local con Edge headless (`msedge --headless=new --screenshot=… --window-size=1180,5200 file:///…`) envolviendo el HTML en un `<!doctype html>` como hace el Artifact; (f) `Artifact` — mismo `file_path` (o `url`) si es regeneración; sin `favicon` en redeploy.

### Checklist bloqueante antes de publicar B

- [ ] Managers/admins fuera de todo agregado — `grep -iE "\b(nombre1|nombre2)\b"` en el HTML = 0 (con `\b`: "rita" casa con "Margarita").
- [ ] Cero jerga — `grep -iE "\b(scheduler|trigger|quota|V4|RAM|tier|sidecar|skipped|atribuci[oó]n|canal|versi[oó]n|backfill|jsonb)\b|0\.2\."` = 0 (con `\b`: "Programa" casa con `RAM`, "tramos" con `RAM`).
- [ ] Cero etiquetas del modelo — `grep -iE "monólogo|fragmentad|desordenad"` = 0.
- [ ] Cero tiles ni tablas de conteo — `grep -c "kpi-row\|<table"` = 1 (la única tabla es el checklist de acciones).
- [ ] Todo número lleva su n, en tooltip o `<small>`.
- [ ] Ningún null pintado como 0 (radar: el eje sin valor dice "sin medir" y el polígono lo salta).
- [ ] Empatía/adaptación promediadas sobre todo puntaje no nulo (`media_all`), sin párrafo-excusa.
- [ ] Personas con n<2 sin promedios ni gráfica.
- [ ] §1 ≤4 titulares de ≤25 palabras; ejemplos con `quien` en §2.
- [ ] Cada cita leída; sin nombres de clientes, montos ni pólizas identificables.
- [ ] Cero problemas técnicos.
- [ ] Ninguna recomendación contradice el producto (2026-09-02): NUNCA sugerir pausar/apagar Maity, "grabar solo las reuniones/llamadas" ni "no grabar toda la jornada" — la jornada continua es el diseño de Maity; el silencio lo filtra el producto (umbral de 250 palabras en `finalize_segment_native`), no el usuario. `grep -iE "no (toda|la) jornada|jornada entera|grabar solo|solo grabar|pausar? maity|apagar maity"` = 0. Sí se vale lo aditivo ("llevar Maity también a las llamadas con clientes").
- [ ] Claro/oscuro OK (tokens en `:root`, `@media (prefers-color-scheme: dark) :root:not([data-theme="light"])`, `:root[data-theme="dark"]`).
- [ ] El `<details>` "Cómo se midió" del footer trae fecha/hora de corte y el supuesto de jornada; el periodo está arriba, bajo el título.

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

Todo campo marcado *v5* es opcional con fallback en el builder (un JSON v4 compila); los marcados *solo A* los ignora B.

```jsonc
{
  "empresa": "Dingler", "titulo": "Radiografía del piloto Dingler",
  "periodo": "14 al 28 de agosto de 2026",                          // va grande bajo el título
  "corte": "28 de agosto de 2026, 09:30 (hora de CDMX)",             // → <details> del footer
  "jornada": "09:00–18:00, lunes a viernes", "dias_habiles": 10, "equipo_n": 10,
  "resumen_titulo": "…",                                             // v5, opcional
  "resumen": ["<b>81 %</b> de las conversaciones fueron internas o uno a uno…", "…"],   // §1, ≤4 titulares en %
  "competencias_titulo": "…",                                        // v5, opcional
  "competencias": [{ "key":"claridad","label":"Claridad","n_eval":64,"n_total":64,"media":41,
                     "critico":31,"desarrollo":23,"competente":10,
                     "que_pasa":"≤2 frases","mejorar":"≤2 frases",
                     "ejemplos":[{"cita":"…","alternativa":"…","quien":"Margarita"}, {…}, {…}]   // v5; fallback: cita/alternativa/quien sueltos
                  }],
  "personas": [{ "nombre":"Erika","puesto":"…","n":23,
                 "fortaleza":"claridad","area":"estructura",
                 "ejemplos":[{"cita":"…","alternativa":"…"}, {…}],   // v5; fallback: cita/alternativa
                 "patron_llano":"habla en frases sueltas que no se conectan",  // v5; fallback: patron (¡etiqueta del modelo, prohibida en B!)
                 "recomendaciones":["…","…"],                         // v5; fallback: [accion]
                 "dims":{"claridad":{"medido":38,"n":23,"auto":50}, "…":{}},   // radar; medido null = "sin medir"
                 "cobertura":26, "dias_con_maity":6,                  // barra de §1
                 "sin_analisis":false, "bloqueo":null,
                 "lectura":"…","dos_partes":9,"reto":"…","reto_vs_medido":"…","cobertura_analizada":20,"extra":"…"   // solo A / ya no se pintan
               }],
  "conversaciones": { "titulo":"…",                                  // v5, opcional (h2 de §4)
                      "matriz":[{"tipo":"Operativa","interlocutor":"Junta de equipo interno","n":58,"horas":43.7,"min":45,"efectividad":49,"informales":26}],
                      // el builder agrupa por interlocutor: /cliente/ → clientes, /equipo interno|uno a uno/ → internas, resto → otras
                      "pct_jornada":{"internas":38,"clientes":9},     // v5, opcional: "% de la jornada" por grupo
                      "prioridad":"Más conversaciones con clientes + cierres internos con acción, responsable y fecha.",   // v5
                      "acciones":{"total":101,"completas":10,"sin_fecha":92,"sin_dueno":20},   // → "90 % sin dueño o sin fecha (91 de 101)"
                      "decisiones":{"total":35,"confirmadas":29,"tentativas":6},
                      "temas":[{"t":"pólizas","n":38}, "…"],           // v5 objetos; fallback strings "pólizas (38)"
                      "informales":{"n":67,"total":129}, "lectura":["…"] },   // solo A
  "acciones": {"personas":[{"nombre":"Erika","accion":"…"}],"equipo":["…"],"maity":["…"]},  // §5
  "como_leer": ["…"],                                                // → <details> "Cómo se midió"
  "datos_uso": {"conv":144,"horas":99.3,"personas":"8 de 10","analisis":64,"minutas":129,"nota":"…"},
  "dias": [...], "picos": [...], "jornada_lectura": [...], "no_graban": [...]   // solo A (artifact interno)
}
```
