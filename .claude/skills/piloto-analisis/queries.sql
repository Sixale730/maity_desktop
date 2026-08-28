-- =====================================================================================
-- /piloto-analisis — consultas Q0…Q9 (Supabase, schema maity). Ejecutar con
-- mcp__supabase__execute_sql pegando el ENCABEZADO + la Q deseada. Todas leen tablas
-- directo: los RPC de equipo (get_team_engagement_summary, team_conversation_scores,
-- get_form_responses_by_company) son SECURITY DEFINER gateados por auth.uid() y desde
-- execute_sql devuelven {"error":"UNAUTHORIZED"}.
--
-- Parámetros (editar el CTE `p`):
--   company_id   uuid de maity.companies
--   d_from/d_to  ventana por created_at, en hora local (tz)
--   excluir      nombres de pila en minúscula fuera de las métricas de equipo (managers)
--   j_ini/j_fin  jornada de referencia para cobertura (default 09:00–18:00)
--   j_desde/j_hasta  días hábiles que cuentan en el denominador de cobertura
--
-- Reglas que estas queries ya aplican (no relajar):
--   * v4 = analysis_status='completed' con calidad_global y calidad_insumo.nivel <> 'baja'
--     (mismo predicado que getCommScore en frontend/src/features/conversations/utils/scoring.ts).
--   * Una dimensión es NO evaluable si puntaje nulo, nivel 'no evaluable' o está en
--     dimensiones_no_aplica → se promedia SOLO lo evaluable y se reporta n_eval / n_total.
--   * Se excluyen conversaciones deleted o discarded.
-- Verificado 2026-08-28 contra producción con Dingler (f983ab57-c097-4637-a5cf-d24ecd6238c7).
-- =====================================================================================

-- ============================ ENCABEZADO (pegar antes de cada Q) ============================
with p as (
  select 'f983ab57-c097-4637-a5cf-d24ecd6238c7'::uuid company_id,
         (timestamp '2026-08-13 00:00' at time zone 'America/Mexico_City') d_from,
         (timestamp '2026-08-28 09:30' at time zone 'America/Mexico_City') d_to,
         'America/Mexico_City' tz,
         array['karen'] excluir,
         time '09:00' j_ini, time '18:00' j_fin,
         date '2026-08-14' j_desde, date '2026-08-27' j_hasta
),
team as (
  select u.id, u.auth_id, u.email,
         lower(split_part(trim(u.first_name),' ',1)) who,
         initcap(split_part(trim(u.first_name),' ',1)) nombre
  from maity.users u, p
  where u.company_id = p.company_id
    and lower(split_part(trim(u.first_name),' ',1)) <> all (p.excluir)
),
conv as (
  select c.*, t.who, t.nombre,
         coalesce(c.finished_at, c.started_at + make_interval(secs => coalesce(c.duration_seconds,0))) ended_at,
         (c.started_at at time zone p.tz)::date dia
  from maity.omi_conversations c join team t on t.id = c.user_id, p
  where c.created_at >= p.d_from and c.created_at < p.d_to
    and coalesce(c.deleted,false) = false and coalesce(c.discarded,false) = false
),
v4 as (
  select id conv_id, who, nombre, dia, title, communication_feedback_v4 v,
         coalesce((communication_feedback_v4->'calidad_insumo'->>'hablantes_detectados')::int,
                  (communication_feedback_v4->'radiografia'->>'hablantes_detectados')::int, 1) hablantes
  from conv
  where analysis_status = 'completed'
    and communication_feedback_v4 ? 'calidad_global'
    and coalesce(communication_feedback_v4->'calidad_insumo'->>'nivel','alta') <> 'baja'
),
dims as (
  select v.who, v.nombre, v.conv_id, v.hablantes, d.key dim,
         (d.value->>'puntaje')::numeric puntaje, d.value->>'nivel' nivel,
         d.value->>'tu_resultado' tu_resultado, d.value->'hallazgos' hallazgos,
         (d.value->>'puntaje' is null or d.value->>'nivel' = 'no evaluable'
          or coalesce(v.v->'dimensiones_no_aplica','[]'::jsonb) @> to_jsonb(d.key)) no_evaluable
  from v4 v, jsonb_each(v.v->'dimensiones') d
),
minuta as (
  select c.id conv_id, c.who, c.nombre, c.dia, c.duration_seconds, c.meeting_minutes_data m,
         m->'meta'->>'tipo_reunion' tipo, m->'meta'->>'categoria_interlocutor' interlocutor,
         (m->'efectividad'->>'score_global')::numeric efectividad,
         m->'efectividad'->'componentes' componentes,
         coalesce(m->'acciones','[]'::jsonb) acciones, coalesce(m->'decisiones','[]'::jsonb) decisiones,
         coalesce(m->'keywords','[]'::jsonb) keywords, coalesce(m->'meta'->>'titulo', c.title) titulo,
         coalesce(m->'meta'->>'titulo','') ~* 'informal|sin agenda|sin contenido|sin tema|fragment|breve|sin acuerdos|sin objetivo' informal
  from conv c, lateral (select c.meeting_minutes_data m) x
  where c.meeting_minutes_data ? 'meta'
),
fr as (select distinct on (user_id) * from maity.form_responses order by user_id, submitted_at desc)
-- ============================ FIN ENCABEZADO ============================

-- Q0 · Roster + actividad + pendientes de backfill (confirmar exclusiones con el usuario)
select t.nombre, t.who, fr.q4 puesto, fr.q17 reto, count(c.id) conv,
       round(coalesce(sum(c.duration_seconds),0)/3600.0,1) horas,
       count(*) filter (where c.analysis_status='completed') completed,
       count(*) filter (where c.analysis_status='skipped') skipped,
       count(*) filter (where c.analysis_status in ('quota_skipped','failed')) pendientes,
       count(*) filter (where c.meeting_minutes_data ? 'meta') minutas,
       max(c.dia) ultima
from team t left join fr on fr.user_id = t.id left join conv c on c.who = t.who
group by 1,2,3,4 order by conv desc;

-- Q1 · Seis competencias del equipo, SOLO evaluables, con n y distribución de niveles
select dim, count(*) n_total, count(*) filter (where not no_evaluable) n_eval,
       round(avg(puntaje) filter (where not no_evaluable),1) media_eval,
       count(*) filter (where not no_evaluable and nivel='crítico') critico,
       count(*) filter (where not no_evaluable and nivel='en desarrollo') desarrollo,
       count(*) filter (where not no_evaluable and nivel in ('competente','sólido')) competente_mas,
       count(distinct who) filter (where not no_evaluable) personas
from dims group by dim order by media_eval desc;

-- Q1b · "Por qué" del equipo: fortaleza/mejorar más citadas con sus hints + recomendaciones por frecuencia
select 'mejorar' k, v->'calidad_global'->>'mejorar' dim, count(*) n,
       left(string_agg(distinct v->'calidad_global'->>'mejorar_hint', ' || '), 700) hints from v4 group by 2
union all
select 'fortaleza', v->'calidad_global'->>'fortaleza', count(*),
       left(string_agg(distinct v->'calidad_global'->>'fortaleza_hint', ' || '), 500) from v4 group by 2
union all
select 'reco', lower(regexp_replace(r->>'titulo','[.]$','')), count(*),
       left(string_agg(distinct r->>'por_que', ' || '), 300) from v4, jsonb_array_elements(v->'recomendaciones') r group by 2
order by 1, 3 desc;

-- Q1c · Cita representativa por dimensión y nivel (para el "ejemplo → mejor" de cada competencia).
--       Prioriza conversaciones con ≥2 hablantes. LEER cada cita antes de publicar.
select dim, nivel, puntaje, hablantes, nombre, left(hh->>'cita',150) cita, left(hh->>'alternativa',180) alternativa,
       left(tu_resultado, 260) tu_resultado
from (
  select d.*, hh.hh,
         row_number() over (partition by d.dim, d.nivel in ('crítico','en desarrollo') order by d.hablantes desc, d.puntaje) rn
  from dims d, jsonb_array_elements(coalesce(d.hallazgos,'[]'::jsonb)) with ordinality hh(hh,i)
  where i = 1 and not d.no_evaluable
) x where rn <= 2 order by dim, nivel, rn;

-- Q2 · Tarjeta por persona (cabecera): n, tier de lectura, modas, conversaciones con dos partes
select nombre, count(*) n,
       case when count(*)>=5 then 'consistente' when count(*)>=2 then 'preliminar' else 'una sola' end lectura,
       round(avg((v->'calidad_global'->>'puntaje')::numeric),0) media,
       mode() within group (order by v->'calidad_global'->>'fortaleza') fortaleza,
       mode() within group (order by v->'calidad_global'->>'mejorar') mejorar,
       mode() within group (order by v->'patron'->>'actual') patron,
       mode() within group (order by v->'patron'->>'que_cambiaria') que_cambiaria,
       count(*) filter (where hablantes >= 2) dos_partes,
       round(avg((v->'radiografia'->>'muletillas_total')::numeric),0) muletillas,
       left(string_agg(distinct lower(regexp_replace(v->'recomendaciones'->0->>'titulo','[.]$','')), ' | '), 400) recos_p1
from v4 group by nombre order by n desc;

-- Q2b · Medias por dimensión por persona (evaluables) — alimenta radar/dumbbell de la tarjeta
select nombre, dim, count(*) filter (where not no_evaluable) n_eval, count(*) n,
       round(avg(puntaje) filter (where not no_evaluable),0) media
from dims group by 1,2 order by 1,2;

-- Q2c · Cita + alternativa de la dimensión "a mejorar" de cada persona (2 candidatas; elegir 1 a mano)
select nombre, dim, puntaje, hablantes, left(title,60) titulo, cita, alternativa from (
  select v.nombre, v.v->'calidad_global'->>'mejorar' dim, (v.v->'calidad_global'->>'puntaje')::numeric puntaje, v.hablantes, v.title,
         left(hh->>'cita',160) cita, left(hh->>'alternativa',200) alternativa,
         row_number() over (partition by v.nombre order by v.hablantes desc, (v.v->'calidad_global'->>'puntaje')::numeric desc) rn
  from v4 v, jsonb_array_elements(coalesce(v.v->'dimensiones'->(v.v->'calidad_global'->>'mejorar')->'hallazgos','[]'::jsonb)) with ordinality hh(hh,i)
  where i = 1
) x where rn <= 2 order by nombre, rn;

-- Q3 · Qué conversaciones tienen: tipo × interlocutor, cómo salen, cuántas son "informales"
select tipo, interlocutor, count(*) n, round(sum(duration_seconds)/3600.0,1) horas, round(avg(duration_seconds)/60.0,0) min_prom,
       round(avg(efectividad),0) efectividad,
       round(avg((componentes->'agenda_adherence'->>'valor')::numeric),0) agenda,
       round(avg((componentes->'action_completeness'->>'valor')::numeric),0) acciones_completas,
       round(avg((componentes->'closure_rate'->>'valor')::numeric),0) cierre,
       sum(jsonb_array_length(acciones)) acciones, sum(jsonb_array_length(decisiones)) decisiones,
       count(*) filter (where informal) informales, string_agg(distinct nombre, ', ') quienes
from minuta group by 1,2 order by n desc;

-- Q3b · Acciones sin dueño / sin fecha, decisiones por estado, reuniones informales por persona, temas
select 'acciones' k, nombre, count(*) n,
       count(*) filter (where nullif(a->>'responsable','') is null or coalesce(a->'falta','[]'::jsonb) @> '"dueño"' or coalesce(a->'falta','[]'::jsonb) @> '"dueno"') sin_dueno,
       count(*) filter (where nullif(a->>'fecha_limite','') is null or coalesce(a->'falta','[]'::jsonb) @> '"fecha"') sin_fecha,
       count(*) filter (where (a->>'completa')::boolean) completas, null::text extra
from minuta, jsonb_array_elements(acciones) a group by nombre
union all
select 'decisiones', nombre, count(*), count(*) filter (where d->>'estado'='confirmada'), count(*) filter (where d->>'estado'='tentativa'), count(*) filter (where d->>'estado'='diferida'), null
from minuta, jsonb_array_elements(decisiones) d group by nombre
union all
select 'informales', nombre, count(*), count(*) filter (where informal), null, null, null from minuta group by nombre
union all
select 'keywords', null, count(*), null, null, null, kw from (select lower(kw) kw from minuta, jsonb_array_elements_text(keywords) kw) x group by kw
order by 1, 3 desc limit 80;

-- Q4 · Cobertura de jornada por persona: ∩ con la ventana j_ini–j_fin de cada día hábil ÷ (días hábiles × horas de jornada).
--      "analizada" = la conversación pasó el filtro de calidad (analysis_status='completed').
--      OJO: least/greatest de Postgres IGNORAN NULL → el `case when c.id is null` es obligatorio,
--      si no, quien no grabó sale con 100 % (bug real del 2026-08-28).
with dias as (select d::date dia from p, generate_series(p.j_desde, p.j_hasta, interval '1 day') d where extract(isodow from d) <= 5),
win as (select dia, (dia + p.j_ini) at time zone p.tz w_ini, (dia + p.j_fin) at time zone p.tz w_fin, extract(epoch from (p.j_fin - p.j_ini)) seg_j from dias, p),
ov as (
  select t.nombre, w.dia, w.seg_j, (c.analysis_status = 'completed') analizada,
         case when c.id is null then 0
              else greatest(0, extract(epoch from (least(c.ended_at, w.w_fin) - greatest(c.started_at, w.w_ini)))) end seg
  from team t cross join win w
  left join conv c on c.nombre = t.nombre and coalesce(c.duration_seconds,0) > 0 and c.started_at < w.w_fin and c.ended_at > w.w_ini
)
select nombre, count(distinct dia) dias_habiles, count(distinct dia) filter (where seg > 0) dias_con_maity,
       round(100 * least(1, sum(seg) / (count(distinct dia) * max(seg_j)))) cobertura_pct,
       round(100 * sum(seg) filter (where analizada) / (count(distinct dia) * max(seg_j))) cobertura_analizada_pct,
       round(sum(seg)/3600.0,1) h_jornada, round(sum(seg) filter (where analizada)/3600.0,1) h_analizadas
from ov group by nombre order by cobertura_pct desc;

-- Q5 · Uso más allá de grabar: juegos (sin el `tiempo_que_queda` del onboarding), roleplay, chat, días con la app, vistas
select t.nombre,
  (select count(*) from maity.game_sessions g, p where g.user_id = t.id and g.completed_at is not null and g.completed_at >= p.d_from and g.game_type <> 'tiempo_que_queda') juegos,
  (select string_agg(distinct g.game_type, ', ') from maity.game_sessions g, p where g.user_id = t.id and g.completed_at >= p.d_from) tipos_juego,
  (select count(*) from maity.voice_sessions s where s.user_id = t.id) roleplays,
  (select count(*) from maity.chat_threads ct where ct.user_id = t.id) chats,
  (select count(distinct (coalesce((l.event_data->'ctx'->>'occurred_at')::timestamptz, l.created_at) at time zone p.tz)::date)
     from maity.platform_logs l, p where l.user_id in (t.id, t.auth_id) and l.platform='desktop' and l.event_type='app.open' and l.created_at >= p.d_from and l.created_at < p.d_to) dias_app,
  (select count(*) from maity.platform_logs l, p where l.user_id in (t.id, t.auth_id) and l.platform='desktop' and l.event_type='conversation_detail_viewed' and l.created_at >= p.d_from and l.created_at < p.d_to) vistas_conv,
  (select count(*) from maity.platform_logs l, p where l.user_id in (t.id, t.auth_id) and l.platform='desktop' and l.event_type='analysis_viewed' and l.created_at >= p.d_from and l.created_at < p.d_to) vistas_analisis,
  (select count(*) from maity.platform_logs l, p where l.user_id in (t.id, t.auth_id) and l.event_type='nav.page_view' and l.event_data->>'path' like '/skills-arena%' and l.created_at >= p.d_from and l.created_at < p.d_to) vistas_arena
from team t order by 1;

-- Q6 · Autoevaluación del registro (Likert 1–5 ×20, mapeo de useGamifiedDashboardDataV2.ts:386-394) vs medido por Maity
with auto as (
  select t.nombre, x.dim, x.val autoeval from team t join fr on fr.user_id = t.id, lateral (values
    ('claridad',(fr.q5::int+fr.q6::int)*10),('adaptacion',(fr.q7::int+fr.q8::int)*10),('persuasion',(fr.q9::int+fr.q10::int)*10),
    ('estructura',(fr.q11::int+fr.q12::int)*10),('proposito',(fr.q13::int+fr.q14::int)*10),('empatia',(fr.q15::int+fr.q16::int)*10)) x(dim,val)),
med as (select nombre, dim, count(*) filter (where not no_evaluable) n_eval, round(avg(puntaje) filter (where not no_evaluable),0) medido from dims group by 1,2)
select a.nombre, a.dim, a.autoeval, m.medido, m.n_eval, (a.autoeval - m.medido) brecha
from auto a left join med m using (nombre, dim) order by a.nombre, a.dim;

-- Q7 · Serie por día (para la gráfica) y explicación de picos (qué juntas, quién, qué temas)
select dia, to_char(dia,'Dy') dow, round(sum(duration_seconds)/3600.0,1) horas,
       round(sum(duration_seconds) filter (where analysis_status='completed')/3600.0,1) h_analizadas,
       count(*) conv, count(*) filter (where analysis_status='completed') analizadas, count(distinct nombre) personas,
       count(*) filter (where meeting_minutes_data->'meta'->>'categoria_interlocutor' = 'Cliente externo') clientes,
       count(*) filter (where meeting_minutes_data->'meta'->>'categoria_interlocutor' = 'Equipo interno') equipo,
       count(*) filter (where meeting_minutes_data->'meta'->>'categoria_interlocutor' = 'Individual (1:1)') uno_a_uno,
       (select string_agg(nombre||' '||h, ', ' order by h desc) from (select nombre, round(sum(duration_seconds)/3600.0,1) h from conv x where x.dia = conv.dia group by nombre) z) personas_h
from conv group by dia order by dia;

-- Q7b · Top días: composición por tipo × interlocutor, temas y títulos con contenido
select t.dia, t.horas,
  (select string_agg(tipo||' × '||interlocutor||' ('||n||', '||h||' h)', '; ' order by h desc) from (
     select coalesce(tipo,'sin minuta') tipo, coalesce(interlocutor,'—') interlocutor, count(*) n, round(sum(duration_seconds)/3600.0,1) h
     from minuta m where m.dia = t.dia group by 1,2) y) juntas,
  (select string_agg(kw||' ('||n||')', ', ' order by n desc) from (
     select lower(kw) kw, count(*) n from minuta m, jsonb_array_elements_text(m.keywords) kw where m.dia = t.dia group by 1 order by n desc limit 6) k) temas,
  (select left(string_agg(distinct titulo, ' | '), 400) from minuta m where m.dia = t.dia and not m.informal) titulos_con_contenido
from (select dia, round(sum(duration_seconds)/3600.0,1) horas from conv group by dia order by horas desc limit 4) t order by t.horas desc;

-- Q8 · Salud técnica (SOLO reporte A) — reusar los bloques de docs/PILOTO_DINGLER_2026-08-28.md:
--      app.error / recording_start_failed por persona y día, [MEM] system-memory-pressure,
--      coach.session_summary (tips_from_llm, sidecar_*), device.profile (memory_gb, performance_tier, build_channel, app_version).
select l.event_type, count(*) n, count(distinct l.user_id) usuarios, min(l.created_at)::date desde, max(l.created_at)::date hasta
from maity.platform_logs l join team t on l.user_id in (t.id, t.auth_id), p
where l.created_at >= p.d_from and l.created_at < p.d_to group by 1 order by 2 desc;

-- Q9 · Candidatos a backfill (correr ANTES de Q1–Q8; si hay filas, ver SKILL.md → Backfill)
select id, nombre, words_count, analysis_status, started_at from conv
where analysis_status in ('quota_skipped','failed') or (analysis_status is null and coalesce(words_count,0) >= 100)
order by words_count desc;
