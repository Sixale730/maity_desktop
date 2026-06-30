//! Lógica pura de horarios para la grabación programada.
//!
//! Sin efectos secundarios ni acceso al reloj real: todas las funciones reciben un
//! `NaiveDateTime` explícito, de modo que son completamente testeables. El loop del
//! servicio (`service.rs`) inyecta `chrono::Local::now().naive_local()` en cada tick.

use chrono::{Datelike, Duration, NaiveDateTime, NaiveTime, Timelike, Weekday};

use super::settings::{ScheduledRecordingSettings, ScheduleWindow};

/// Convierte "HH:MM" a minutos desde medianoche (0..=1439). `None` si es inválido.
fn parse_hm(s: &str) -> Option<u32> {
    let mut parts = s.split(':');
    let h: u32 = parts.next()?.trim().parse().ok()?;
    let m: u32 = parts.next()?.trim().parse().ok()?;
    if parts.next().is_some() || h > 23 || m > 59 {
        return None;
    }
    Some(h * 60 + m)
}

/// Mapea un `Weekday` a 1=Lunes..7=Domingo.
fn weekday_num(wd: Weekday) -> u8 {
    wd.number_from_monday() as u8
}

fn day_listed(w: &ScheduleWindow, day: u8) -> bool {
    w.days_of_week.contains(&day)
}

fn minutes_of(now: NaiveDateTime) -> u32 {
    now.hour() * 60 + now.minute()
}

/// ¿`now` cae dentro de la ventana `w`?
///
/// La ventana es semiabierta `[start, end)`: en `start` está dentro, en `end` está fuera
/// (para que se detenga exactamente a la hora de fin). `days_of_week` lista los días en que
/// la ventana ARRANCA. Si `end <= start`, la ventana cruza medianoche y su porción de
/// madrugada pertenece al día siguiente al de arranque.
pub fn is_within_window(now: NaiveDateTime, w: &ScheduleWindow) -> bool {
    let (start, end) = match (parse_hm(&w.start_time), parse_hm(&w.end_time)) {
        (Some(s), Some(e)) => (s, e),
        _ => return false,
    };
    // Ventana de longitud cero o inválida => nunca activa (evita sorpresa de 24h).
    if start == end {
        return false;
    }

    let now_min = minutes_of(now);
    let today = weekday_num(now.weekday());

    if start < end {
        // Ventana del mismo día.
        day_listed(w, today) && now_min >= start && now_min < end
    } else {
        // Cruza medianoche: [start..24h) en el día de arranque, o [0..end) al día siguiente.
        let yesterday = weekday_num(now.weekday().pred());
        (day_listed(w, today) && now_min >= start)
            || (day_listed(w, yesterday) && now_min < end)
    }
}

/// Devuelve la primera ventana activa en `now`, si hay alguna.
pub fn active_window_at<'a>(
    now: NaiveDateTime,
    settings: &'a ScheduledRecordingSettings,
) -> Option<&'a ScheduleWindow> {
    settings.windows.iter().find(|w| is_within_window(now, w))
}

/// Próxima hora EN PUNTO estrictamente después de `now` (trunca minutos/segundos y suma 1h).
/// 9:30→10:00, 9:00:30→10:00, 9:00:00→10:00, 23:30→día siguiente 00:00. Para el re-arme
/// tras un paro manual dentro de la ventana (Incremento 3).
pub fn next_hour_boundary(now: NaiveDateTime) -> NaiveDateTime {
    // `now.hour()` ∈ 0..=23 ⇒ el `and_hms_opt` nunca devuelve None; el `unwrap_or` es defensivo.
    let truncated = now
        .date()
        .and_hms_opt(now.hour(), 0, 0)
        .unwrap_or(now);
    truncated + Duration::hours(1)
}

/// Primera ocurrencia de la hora-del-día `auto_close_time` ("HH:MM") ESTRICTAMENTE después de
/// `owned_since`. Robusto a turnos noche: si esa hora ya pasó el día en que arrancó la grabación,
/// devuelve la del día siguiente. `None` si la hora es inválida. Usado por el cierre por hora fija
/// (Incremento 3): el instante en que el scheduler debe detener su propia grabación.
pub fn auto_close_at(owned_since: NaiveDateTime, auto_close_time: &str) -> Option<NaiveDateTime> {
    let mins = parse_hm(auto_close_time)?;
    let close_time = NaiveTime::from_hms_opt(mins / 60, mins % 60, 0)?;
    let candidate = owned_since.date().and_time(close_time);
    if candidate > owned_since {
        Some(candidate)
    } else {
        Some(candidate + Duration::days(1))
    }
}

/// Próximo instante en que ARRANCA alguna ventana, mirando hasta 8 días hacia delante.
/// Devuelve `None` si no hay ninguna ventana futura configurada. Solo para mostrar en UI.
pub fn next_fire_at(
    now: NaiveDateTime,
    settings: &ScheduledRecordingSettings,
) -> Option<NaiveDateTime> {
    let mut best: Option<NaiveDateTime> = None;

    for day_offset in 0..8 {
        let date = now.date() + Duration::days(day_offset);
        let wd = weekday_num(date.weekday());

        for w in &settings.windows {
            if !day_listed(w, wd) {
                continue;
            }
            let start = match parse_hm(&w.start_time) {
                Some(s) => s,
                None => continue,
            };
            let start_time = match NaiveTime::from_hms_opt(start / 60, start % 60, 0) {
                Some(t) => t,
                None => continue,
            };
            let dt = date.and_time(start_time);
            if dt > now {
                best = Some(match best {
                    Some(b) if b <= dt => b,
                    _ => dt,
                });
            }
        }
    }

    best
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::NaiveDate;

    fn dt(y: i32, m: u32, d: u32, h: u32, min: u32) -> NaiveDateTime {
        NaiveDate::from_ymd_opt(y, m, d)
            .unwrap()
            .and_hms_opt(h, min, 0)
            .unwrap()
    }

    fn weekday_window(days: Vec<u8>, start: &str, end: &str) -> ScheduleWindow {
        ScheduleWindow {
            days_of_week: days,
            start_time: start.to_string(),
            end_time: end.to_string(),
        }
    }

    // 2026-06-29 es LUNES (weekday 1).
    #[test]
    fn lunes_dentro_de_9_a_18() {
        let w = weekday_window(vec![1, 2, 3, 4, 5], "09:00", "18:00");
        assert!(is_within_window(dt(2026, 6, 29, 9, 0), &w), "== start está dentro");
        assert!(is_within_window(dt(2026, 6, 29, 13, 30), &w));
        assert!(is_within_window(dt(2026, 6, 29, 17, 59), &w));
    }

    #[test]
    fn limite_de_fin_excluido() {
        let w = weekday_window(vec![1], "09:00", "18:00");
        assert!(!is_within_window(dt(2026, 6, 29, 18, 0), &w), "== end está FUERA");
        assert!(!is_within_window(dt(2026, 6, 29, 8, 59), &w), "antes de start está fuera");
    }

    #[test]
    fn dia_no_listado_queda_fuera() {
        // Domingo 2026-06-28 (weekday 7), ventana solo Lun-Vie.
        let w = weekday_window(vec![1, 2, 3, 4, 5], "09:00", "18:00");
        assert!(!is_within_window(dt(2026, 6, 28, 12, 0), &w));
    }

    #[test]
    fn ventana_cero_nunca_activa() {
        let w = weekday_window(vec![1], "09:00", "09:00");
        assert!(!is_within_window(dt(2026, 6, 29, 9, 0), &w));
    }

    #[test]
    fn horas_invalidas_no_activan() {
        let w = weekday_window(vec![1], "25:00", "99:99");
        assert!(!is_within_window(dt(2026, 6, 29, 9, 0), &w));
    }

    #[test]
    fn wrap_medianoche_porcion_noche() {
        // Turno noche Lun 22:00 -> Mar 06:00. Día de arranque = Lunes (1).
        let w = weekday_window(vec![1], "22:00", "06:00");
        // Lunes 23:00 => dentro (porción de noche del día de arranque).
        assert!(is_within_window(dt(2026, 6, 29, 23, 0), &w));
        // Lunes 21:59 => fuera (antes de start).
        assert!(!is_within_window(dt(2026, 6, 29, 21, 59), &w));
    }

    #[test]
    fn wrap_medianoche_porcion_madrugada() {
        // Mismo turno noche con arranque el Lunes. Martes 05:00 pertenece a la madrugada
        // del día siguiente al arranque => dentro.
        let w = weekday_window(vec![1], "22:00", "06:00");
        assert!(is_within_window(dt(2026, 6, 30, 5, 0), &w), "martes madrugada dentro");
        assert!(!is_within_window(dt(2026, 6, 30, 6, 0), &w), "== end fuera");
        // Pero el martes a las 23:00 NO está dentro porque el martes (2) no es día de arranque.
        assert!(!is_within_window(dt(2026, 6, 30, 23, 0), &w));
    }

    #[test]
    fn next_hour_boundary_trunca_y_suma_una_hora() {
        // 9:30 => 10:00
        assert_eq!(next_hour_boundary(dt(2026, 6, 29, 9, 30)), dt(2026, 6, 29, 10, 0));
        // 9:00 (en punto) => 10:00 (estrictamente la siguiente).
        assert_eq!(next_hour_boundary(dt(2026, 6, 29, 9, 0)), dt(2026, 6, 29, 10, 0));
        // 9:59 => 10:00
        assert_eq!(next_hour_boundary(dt(2026, 6, 29, 9, 59)), dt(2026, 6, 29, 10, 0));
    }

    #[test]
    fn next_hour_boundary_cruza_medianoche() {
        // 23:30 => día siguiente 00:00.
        assert_eq!(next_hour_boundary(dt(2026, 6, 29, 23, 30)), dt(2026, 6, 30, 0, 0));
    }

    #[test]
    fn auto_close_at_mismo_dia() {
        // Arrancó a las 09:00, cierre 18:00 => hoy 18:00.
        let close = auto_close_at(dt(2026, 6, 29, 9, 0), "18:00").unwrap();
        assert_eq!(close, dt(2026, 6, 29, 18, 0));
    }

    #[test]
    fn auto_close_at_turno_noche_salta_al_dia_siguiente() {
        // Arrancó Lunes 22:00, cierre 06:00 (ya pasó hoy) => Martes 06:00.
        let close = auto_close_at(dt(2026, 6, 29, 22, 0), "06:00").unwrap();
        assert_eq!(close, dt(2026, 6, 30, 6, 0));
    }

    #[test]
    fn auto_close_at_hora_de_cierre_anterior_al_arranque() {
        // Arrancó 09:00 pero el cierre 08:00 ya pasó => mañana 08:00 (config rara, manejada).
        let close = auto_close_at(dt(2026, 6, 29, 9, 0), "08:00").unwrap();
        assert_eq!(close, dt(2026, 6, 30, 8, 0));
    }

    #[test]
    fn auto_close_at_hora_invalida_es_none() {
        assert!(auto_close_at(dt(2026, 6, 29, 9, 0), "25:99").is_none());
    }

    #[test]
    fn next_fire_mismo_dia_mas_tarde() {
        let mut s = ScheduledRecordingSettings::default();
        s.windows = vec![weekday_window(vec![1, 2, 3, 4, 5], "09:00", "18:00")];
        // Lunes 07:00 => próximo arranque hoy 09:00.
        let next = next_fire_at(dt(2026, 6, 29, 7, 0), &s).unwrap();
        assert_eq!(next, dt(2026, 6, 29, 9, 0));
    }

    #[test]
    fn next_fire_salta_al_siguiente_dia_habil() {
        let mut s = ScheduledRecordingSettings::default();
        s.windows = vec![weekday_window(vec![1, 2, 3, 4, 5], "09:00", "18:00")];
        // Viernes 19:00 (2026-07-03 es viernes) => próximo arranque lunes 09:00 (2026-07-06).
        let next = next_fire_at(dt(2026, 7, 3, 19, 0), &s).unwrap();
        assert_eq!(next, dt(2026, 7, 6, 9, 0));
    }

    #[test]
    fn next_fire_none_si_no_hay_ventanas() {
        let mut s = ScheduledRecordingSettings::default();
        s.windows = vec![];
        assert!(next_fire_at(dt(2026, 6, 29, 7, 0), &s).is_none());
    }
}
