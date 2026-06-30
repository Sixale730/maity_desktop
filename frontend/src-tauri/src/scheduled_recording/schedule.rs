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

/// Momento (`NaiveDateTime`) en que termina la ventana activa que contiene a `now`.
/// Útil para el periodo de gracia y para marcar "ventana cancelada por el usuario".
pub fn current_window_end(now: NaiveDateTime, w: &ScheduleWindow) -> Option<NaiveDateTime> {
    let start = parse_hm(&w.start_time)?;
    let end = parse_hm(&w.end_time)?;
    let end_time = NaiveTime::from_hms_opt(end / 60, end % 60, 0)?;
    let now_min = minutes_of(now);
    let date = now.date();

    if start < end {
        Some(date.and_time(end_time))
    } else if now_min >= start {
        // Porción de noche => termina al día siguiente.
        Some((date + Duration::days(1)).and_time(end_time))
    } else {
        // Porción de madrugada => termina hoy.
        Some(date.and_time(end_time))
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
    fn current_window_end_mismo_dia() {
        let w = weekday_window(vec![1], "09:00", "18:00");
        let end = current_window_end(dt(2026, 6, 29, 10, 0), &w).unwrap();
        assert_eq!(end, dt(2026, 6, 29, 18, 0));
    }

    #[test]
    fn current_window_end_wrap_noche_y_madrugada() {
        let w = weekday_window(vec![1], "22:00", "06:00");
        // Lunes 23:00 => termina el martes 06:00.
        let end_noche = current_window_end(dt(2026, 6, 29, 23, 0), &w).unwrap();
        assert_eq!(end_noche, dt(2026, 6, 30, 6, 0));
        // Martes 05:00 => termina el martes 06:00 (mismo día).
        let end_madrugada = current_window_end(dt(2026, 6, 30, 5, 0), &w).unwrap();
        assert_eq!(end_madrugada, dt(2026, 6, 30, 6, 0));
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
