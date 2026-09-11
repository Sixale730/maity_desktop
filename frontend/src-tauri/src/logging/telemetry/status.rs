//! Dominio cerrado de la columna `status` de `maity.platform_logs`.
//!
//! La tabla tiene un `CHECK` sobre `status` y el RPC `insert_platform_log`
//! (SECURITY DEFINER, `EXCEPTION WHEN OTHERS THEN NULL`) **traga la violación
//! y responde 200**: `drain.rs` toma el 2xx por éxito, marca la fila del
//! outbox como sincronizada y el evento desaparece sin rastro. Así se
//! perdieron TODOS los `stt.*`, `audio.*` e `incident.*` hasta el 2026-09-11
//! (mandaban `"ok"`/`"partial"`/`"warning"` contra un CHECK de cuatro valores).
//!
//! Por eso `emit_event` ya no acepta un `&str` libre: solo este enum. El
//! contrato con la DB es `docs/platform-logs-status.sql` (lo aplica la web
//! como migración) y el test de abajo lo ata en las dos direcciones. El lado
//! JS (`PlatformLogStatus` en `lib/platformLogger.ts`) es un subconjunto.
//!
//! Vive en su propio archivo a propósito: `lint-telemetry.js` regex-parsea
//! `catalog.rs` (`pub const X: &str = "…"`) como nombres de evento.

/// Valores admitidos por `platform_logs_status_check`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TelemetryStatus {
    /// Operación completada (emisores JS históricos y ciclo de vida de grabación).
    Success,
    /// Falló (`recording_start_failed`, `app.error`, `stt.*` con fallo).
    Error,
    /// Expiró (solo JS hoy).
    Timeout,
    /// Se omitió a propósito (`recording.segment_discarded`).
    Skipped,
    /// Éxito de un emisor Rust de mantenimiento (`stt.*`, `incident.bundle_uploaded`,
    /// `audio.retention_swept` sin fallos).
    Ok,
    /// Terminó con parte del trabajo fallido o anómalo (`audio.retention_swept`,
    /// `audio.checkpoint_integrity`).
    Partial,
    /// Aviso sin fallo de la operación (`incident.detected`, `incident.upload_failed`).
    Warning,
}

impl TelemetryStatus {
    /// Todas las variantes, en el orden del CHECK. El test de contrato itera esto.
    pub const ALL: [TelemetryStatus; 7] = [
        TelemetryStatus::Success,
        TelemetryStatus::Error,
        TelemetryStatus::Timeout,
        TelemetryStatus::Skipped,
        TelemetryStatus::Ok,
        TelemetryStatus::Partial,
        TelemetryStatus::Warning,
    ];

    /// Literal que viaja en la columna `status`.
    pub const fn as_str(self) -> &'static str {
        match self {
            TelemetryStatus::Success => "success",
            TelemetryStatus::Error => "error",
            TelemetryStatus::Timeout => "timeout",
            TelemetryStatus::Skipped => "skipped",
            TelemetryStatus::Ok => "ok",
            TelemetryStatus::Partial => "partial",
            TelemetryStatus::Warning => "warning",
        }
    }

    /// Inversa de `as_str` (exacta, sensible a mayúsculas: la DB también lo es).
    pub fn parse(s: &str) -> Option<Self> {
        Self::ALL.iter().copied().find(|v| v.as_str() == s)
    }
}

/// Saneado para el comando `log_recording_event` (JS → outbox), donde el
/// status llega como `String` libre. Un valor fuera del dominio se **degrada
/// a NULL** (el CHECK admite NULL, así que la fila sí llega) y se señala con
/// `true` para que el caller lo advierta en el log. Devolver `Err` perdería la
/// fila: exactamente el modo de fallo que este módulo corrige.
pub fn sanitize_status(raw: Option<&str>) -> (Option<&'static str>, bool) {
    match raw {
        None => (None, false),
        Some(s) => match TelemetryStatus::parse(s) {
            Some(v) => (Some(v.as_str()), false),
            None => (None, true),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    /// Quita comentarios `-- …` (el contrato anota cada grupo de valores y
    /// esos comentarios llevan paréntesis que romperían el corte por `)`).
    fn sin_comentarios_sql(sql: &str) -> String {
        sql.lines()
            .map(|l| match l.find("--") {
                Some(i) => &l[..i],
                None => l,
            })
            .collect::<Vec<_>>()
            .join("\n")
    }

    /// Literales `'…'` en orden de aparición.
    fn literales_entre_comillas(s: &str) -> Vec<String> {
        s.split('\'')
            .enumerate()
            .filter(|(i, _)| i % 2 == 1)
            .map(|(_, v)| v.to_string())
            .collect()
    }

    fn lista_del_check() -> (std::path::PathBuf, Vec<String>) {
        let sql_path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../docs/platform-logs-status.sql");
        let sql = std::fs::read_to_string(&sql_path)
            .unwrap_or_else(|e| panic!("no se pudo leer el contrato {:?}: {}", sql_path, e));
        let limpio = sin_comentarios_sql(&sql).to_lowercase();
        let check = limpio
            .find("check (")
            .map(|i| &limpio[i..])
            .expect("el contrato define el CHECK con `check (`");
        let in_start = check.find("in (").expect("el CHECK enumera los valores con `in (`");
        let lista = &check[in_start + "in (".len()..];
        let in_len = lista.find(')').expect("cierre del `in (…)`");
        (sql_path, literales_entre_comillas(&lista[..in_len]))
    }

    /// Contrato ejecutable en las DOS direcciones: cada variante Rust está
    /// LITERAL en el CHECK del SQL, y cada literal del SQL tiene variante. Un
    /// status nuevo sin su línea en el contrato (o al revés) rompe el build —
    /// antes compilaba verde y la fila se perdía en producción.
    #[test]
    fn todo_status_de_rust_esta_en_el_check_del_contrato() {
        let (sql_path, lista) = lista_del_check();
        assert!(!lista.is_empty(), "el `in (…)` de {:?} no lista valores", sql_path);
        for v in TelemetryStatus::ALL {
            assert!(
                lista.iter().any(|l| l == v.as_str()),
                "el CHECK de {:?} no lista {:?}; hoy: {:?}",
                sql_path,
                v.as_str(),
                lista
            );
        }
        for l in &lista {
            assert!(
                TelemetryStatus::parse(l).is_some(),
                "el CHECK de {:?} lista {:?} pero TelemetryStatus no lo conoce",
                sql_path,
                l
            );
        }
    }

    /// El tipo del webview (`PlatformLogStatus`) debe ser subconjunto del CHECK:
    /// un literal nuevo en TS sin su fila en el SQL se perdería igual de mudo.
    #[test]
    fn platform_log_status_de_ts_es_subconjunto_del_check() {
        let ts_path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../src/lib/platformLogger.ts");
        let ts = std::fs::read_to_string(&ts_path)
            .unwrap_or_else(|e| panic!("no se pudo leer {:?}: {}", ts_path, e));
        let linea = ts
            .lines()
            .find(|l| l.contains("type PlatformLogStatus ="))
            .expect("platformLogger.ts declara `type PlatformLogStatus =`");
        let literales = literales_entre_comillas(linea);
        assert!(!literales.is_empty(), "sin literales en {:?}", linea);
        for l in &literales {
            assert!(
                TelemetryStatus::parse(l).is_some(),
                "{:?} declara {:?} y no está en el dominio Rust/SQL",
                ts_path,
                l
            );
        }
    }

    #[test]
    fn as_str_y_parse_son_inversos() {
        for v in TelemetryStatus::ALL {
            assert_eq!(TelemetryStatus::parse(v.as_str()), Some(v));
        }
        assert_eq!(TelemetryStatus::parse("OK"), None, "sensible a mayúsculas, como la DB");
        assert_eq!(TelemetryStatus::parse(""), None);
    }

    #[test]
    fn status_fuera_del_dominio_se_degrada_a_null() {
        assert_eq!(sanitize_status(Some("partial")), (Some("partial"), false));
        assert_eq!(sanitize_status(Some("success")), (Some("success"), false));
        assert_eq!(sanitize_status(Some("weird")), (None, true));
        assert_eq!(sanitize_status(None), (None, false));
    }
}
