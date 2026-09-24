with p as (
  select '<company_id>'::uuid company_id, 'America/Mexico_City'::text tz,
         date '2026-09-01' d_desde, date '2026-09-23' d_hasta,
         array[date '2026-09-16']::date[] feriados,   -- días inhábiles (16-sep, 3er lunes de nov, 25-dic…)
         array['karen']::text[] excluir,              -- managers: nombre de pila en minúscula
         array[0,2,62] v_nueva,                       -- primera versión con los eventos de #83
         interval '30 days' lookback,                 -- cuánto mirar atrás para el último estado conocido
         interval '7 days' silencio_desinstalacion
),
team as (
  select u.id, u.auth_id, initcap(split_part(trim(u.first_name),' ',1)) nombre
  from maity.users u, p
  where u.company_id = p.company_id
    and lower(split_part(trim(u.first_name),' ',1)) <> all (p.excluir)
),
raw as (
  select l.id, l.user_id, l.event_type, l.event_data, l.app_version, l.created_at
  from maity.platform_logs l, p
  where l.platform = 'desktop'
    and l.created_at >= (p.d_desde::timestamp at time zone p.tz) - p.lookback
),
ev0 as (
  -- atribución: maity_user_id del payload (auth.*) gana a la columna user_id (RPC al drenar)
  select t.id uid, r.event_type et, r.event_data d,
         r.event_data->'ctx'->>'session_id' sid,
         coalesce((r.event_data->'ctx'->>'occurred_at')::timestamptz, r.created_at) ts,
         coalesce(string_to_array(substring(coalesce(nullif(r.app_version,'unknown'), r.event_data->'ctx'->>'app_version')
                  from '^[0-9]+\.[0-9]+\.[0-9]+'), '.')::int[], array[0]) >= p.v_nueva nueva,
         row_number() over (partition by t.id, r.event_data->'ctx'->>'session_id', r.event_type,
                                         r.event_data->'ctx'->>'occurred_at',
                                         case when r.event_data->'ctx'->>'occurred_at' is null then r.id end
                            order by r.id) rn
  from raw r cross join p
  join team t on case when r.event_data->>'maity_user_id' is not null
                      then r.event_data->>'maity_user_id' = t.id::text
                      else r.user_id in (t.id, t.auth_id) end
),
ev as (   -- dedupe por (ctx.session_id, event_type, ctx.occurred_at)
  select uid, et, d, sid, ts, nueva,
         case when et = 'jornada.idle_reason_changed' then d->>'to'
              when et = 'health.heartbeat' then d->>'idle_reason' end ir
  from ev0 where rn = 1
),
tl as (   -- línea de tiempo del motivo: transiciones del outbox, cortadas por arranques y salidas
  select uid, sid, ts s0, ir, lead(ts) over (partition by uid order by ts) s1
  from ev where et in ('jornada.idle_reason_changed', 'app.start', 'app.exit')
),
dias as (
  select d::date dia, (d::date::timestamp at time zone p.tz) t0,
         ((d::date + 1)::timestamp at time zone p.tz) t1, extract(isodow from d)::int dow
  from p, generate_series(p.d_desde, p.d_hasta, interval '1 day') d
  where extract(isodow from d) <= 5 and d::date <> all (p.feriados)
),
conv as (
  select c.user_id uid, (c.started_at at time zone p.tz)::date dia, count(*) n
  from maity.omi_conversations c join team t on t.id = c.user_id cross join p
  where c.started_at >= (p.d_desde::timestamp at time zone p.tz)
    and c.started_at <  ((p.d_hasta + 1)::timestamp at time zone p.tz)
    and not coalesce(c.deleted, false) and not coalesce(c.discarded, false)
  group by 1, 2
),
f as (
  select t.id uid, t.nombre, d.dia, d.dow, coalesce(cv.n, 0) conv_n, x.*, tw.*,
         ant.ts ant_ts, coalesce(ant.nueva, false) ant_nueva,
         hb_ant.ts hb_ant_ts, lo_ant.ts logout_ant_ts, ir_ant.ir ir_ant,
         coalesce(sig.d->>'prev_exit_reason',
                  case when sal_ant.et = 'app.exit' then sal_ant.d->>'reason' end) prev_salida,
         (vivo.x is not null) vivo_todo_el_dia, (susp.x is not null) suspendida,
         aut.estado autostart, jor.j horario, (post.x is not null) hay_senal_despues
  from team t cross join dias d
  left join conv cv on cv.uid = t.id and cv.dia = d.dia
  cross join lateral (
    select count(*) n_ev,
           count(*) filter (where e.et = 'recording_started') rec_started,
           count(*) filter (where e.et = 'recording.segment_discarded') seg_desc,
           count(*) filter (where e.et = 'health.heartbeat') hb,
           count(*) filter (where e.et = 'health.heartbeat' and e.d->>'phase' in ('recording','starting','stopping')) hb_rec,
           count(*) filter (where e.et = 'health.heartbeat' and e.d->>'phase' = 'paused') hb_pausa,
           mode() within group (order by e.ir)
             filter (where e.et = 'health.heartbeat' and e.ir not in ('pending','initializing')) motivo_hb,
           count(*) filter (where e.et = 'recording_start_failed'
                              and e.d->>'code' in ('mic_not_found','mic_permission_denied')) fallo_mic,
           count(*) filter (where e.et = 'recording_start_failed'
                              and coalesce(e.d->>'code','') not in ('mic_not_found','mic_permission_denied')) fallo_arranque,
           count(*) filter (where e.et in ('auth.logout','auth.session_lost')) logout,
           (array_agg(e.d->>'reason' order by e.ts desc) filter (where e.et = 'app.exit'))[1] salida_dia,
           count(*) filter (where e.et = 'app.start'
                              and e.d->>'prev_exit_reason' in ('unclean','crash_panic')) arranque_sucio,
           count(*) filter (where e.et = 'app.resumed') resumed,
           coalesce(bool_or(e.nueva), false) nueva
    from ev e where e.uid = t.id and e.ts >= d.t0 and e.ts < d.t1
  ) x
  left join lateral (   -- segundos por idle_reason dentro del día (solo tramos de un proceso vivo ese día)
    select (array_agg(z.ir order by z.secs desc))[1] motivo_tl,
           coalesce(sum(z.secs) filter (where z.ir = 'paused_by_user'), 0) s_pausa,
           coalesce(sum(z.secs) filter (where z.ir = 'stopped_by_user'), 0) s_detenida,
           coalesce(sum(z.secs) filter (where z.ir = 'closed_for_day'), 0) s_cerrada
    from (select s.ir, sum(extract(epoch from least(coalesce(s.s1, now()), d.t1) - greatest(s.s0, d.t0))) secs
          from tl s
          where s.uid = t.id and s.ir is not null and s.ir not in ('pending','initializing')
            and s.s0 < d.t1 and coalesce(s.s1, now()) > d.t0
            and (s.s0 >= d.t0 or exists (select 1 from ev e2 where e2.uid = t.id and e2.sid = s.sid
                                                        and e2.ts >= d.t0 and e2.ts < d.t1))
          group by s.ir) z
  ) tw on true
  left join lateral (select e.ts, e.nueva, e.sid from ev e where e.uid = t.id and e.ts < d.t0
                     order by e.ts desc limit 1) ant on true
  left join lateral (select max(e.ts) ts from ev e where e.uid = t.id and e.ts < d.t0
                       and e.et = 'health.heartbeat') hb_ant on true
  left join lateral (select max(e.ts) ts from ev e where e.uid = t.id and e.ts < d.t0
                       and e.et in ('auth.logout','auth.session_lost')) lo_ant on true
  left join lateral (select e.ir from ev e where e.uid = t.id and e.ts < d.t0
                       and e.et = 'jornada.idle_reason_changed' order by e.ts desc limit 1) ir_ant on true
  left join lateral (select e.et, e.d from ev e where e.uid = t.id and e.ts < d.t0
                       and e.et in ('app.start','app.exit') order by e.ts desc limit 1) sal_ant on true
  left join lateral (select e.d from ev e where e.uid = t.id and e.ts >= d.t0 and e.et = 'app.start'
                     order by e.ts limit 1) sig on true
  left join lateral (   -- el mismo proceso siguió vivo todo el día (mismo ctx.session_id después, o su marcador)
    select 1 x from ev e where e.uid = t.id and e.sid = ant.sid and e.ts >= d.t1
    union all
    select 1 from ev e where e.uid = t.id and e.et = 'app.start' and e.ts >= d.t1
      and e.d->>'prev_session_id' = ant.sid and (e.d->>'prev_last_alive_at')::timestamptz >= d.t1
    limit 1) vivo on true
  left join lateral (select 1 x from ev e where e.uid = t.id and e.et = 'app.resumed'
                       and (e.d->>'suspended_at')::timestamptz < d.t1
                       and (e.d->>'resumed_at')::timestamptz > d.t0 limit 1) susp on true
  left join lateral (select coalesce(e.d->>'to', e.d->>'autostart_state') estado from ev e
                     where e.uid = t.id and e.ts < d.t1
                       and (e.et = 'autostart.changed' or e.d ? 'autostart_state')
                     order by e.ts desc limit 1) aut on true
  left join lateral (select coalesce(e.d->'to', e.d->'jornada') j from ev e
                     where e.uid = t.id and e.ts < d.t1
                       and (e.et = 'jornada.settings_changed'
                            or (e.et = 'device.profile' and jsonb_typeof(e.d->'jornada') = 'object'))
                     order by e.ts desc limit 1) jor on true
  left join lateral (select 1 x from ev e where e.uid = t.id and e.ts >= d.t1
                     union all
                     select 1 from maity.omi_conversations c where c.user_id = t.id and c.started_at >= d.t1
                       and not coalesce(c.deleted, false)
                     limit 1) post on true
),
g as (
  select f.*, coalesce(motivo_tl, motivo_hb) motivo,
         case when s_pausa >= 600 or hb_pausa > 0 then 'pausada'
              when s_detenida >= 600 then 'detenida por el usuario'
              when s_cerrada >= 600 or salida_dia = 'tray_quit' then 'cerrada temprano'
         end motivo_parcial
  from f
)
select nombre, dia,
  case
    -- 1) grabó (parcial = pausada / detenida / cerrada temprano)
    when conv_n > 0 or seg_desc > 0 or rec_started > 0 or hb_rec > 0
      then case when motivo_parcial is null then 'grabó' else 'grabó parcial' end
    -- 2) sin ninguna señal ese día: una causa explícita previa gana a "posible desinstalación"
    when n_ev = 0 and (logout_ant_ts > coalesce(hb_ant_ts, '-infinity')
                       or (vivo_todo_el_dia and ir_ant = 'no_session')) then 'sesión de Maity cerrada'
    when n_ev = 0 and prev_salida = 'tray_quit' then 'cerrada por el usuario'
    when n_ev = 0 and prev_salida in ('update','rival_install') then 'cerrada para actualizar'
    when n_ev = 0 and (suspendida or vivo_todo_el_dia) then 'PC apagada / suspendida / sin sesión de Windows'
    when n_ev = 0 and not hay_senal_despues
         and (ant_ts is null or now() - ant_ts >= (select silencio_desinstalacion from p)) then 'posible desinstalación'
    when n_ev = 0 and prev_salida in ('os_session_end','os_restart_unclean')
      then case when autostart in ('enabled','enabledByPolicy') then 'PC apagada / suspendida / sin sesión de Windows'
                else 'sin arranque con Windows' end
    when n_ev = 0 and prev_salida is not null then 'crash / cierre forzado'
    when n_ev = 0 and not hay_senal_despues then 'silencio reciente'
    when n_ev = 0 and not ant_nueva then 'versión < 0.2.62'
    when n_ev = 0 then 'sin señal (causa no identificada)'
    -- 3) Maity corrió pero no grabó
    when motivo = 'jornada_unconfigured' then 'jornada sin configurar'
    when motivo = 'jornada_off' then 'jornada apagada'
    when motivo in ('outside_window','closed_for_day')
         or (coalesce((horario->>'windows_count')::int, 0) = 1
             and not coalesce(horario->'windows'->0->'days_of_week' @> to_jsonb(dow), true)) then 'fuera de horario'
    when motivo = 'no_session' or logout > 0 then 'sesión de Maity cerrada'
    when motivo = 'no_registration' then 'registro incompleto'
    when motivo in ('mic_not_found','mic_permission_denied') or fallo_mic > 0 then 'sin micrófono / permiso'
    when motivo = 'paused_by_user' or hb_pausa > 0 then 'pausada'
    when motivo = 'stopped_by_user' then 'detenida por el usuario'
    when salida_dia = 'tray_quit' then 'cerrada por el usuario'
    when motivo = 'session_ending' or salida_dia = 'os_session_end' or resumed > 0
      then 'PC apagada / suspendida / sin sesión de Windows'
    when salida_dia = 'update' then 'cerrada para actualizar'
    when arranque_sucio > 0 then 'crash / cierre forzado'
    when motivo in ('mic_in_use','start_failed','scheduler_stopped') or fallo_arranque > 0 then 'falla al arrancar'
    when not nueva then 'versión < 0.2.62'
    when hb = 0 then 'abierta sin grabar (sin latido: sin red)'
    else 'abierta sin grabar (causa no identificada)'
  end causa,
  motivo_parcial, motivo, conv_n, n_ev, hb, hb_rec, hb_pausa, fallo_mic, salida_dia, prev_salida, autostart
from g order by nombre, dia;
