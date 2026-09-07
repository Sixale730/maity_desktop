//! Circuit breaker del LLM del coach (patrón Fowler / *Release It!*).
//!
//! Antes, cada tick reintentaba a ciegas tras un fallo: si el sidecar no podía
//! cargar el modelo bajo carga, el coach lo martillaba durante horas (death
//! spiral, logs jul-2026). Tras `FAIL_THRESHOLD` fallos consecutivos el circuito
//! abre `COOLDOWN` y los ticks se saltan la llamada LLM (los tips heurísticos
//! siguen por su propio loop). Pasado el cooldown, el siguiente tick actúa como
//! half-open: si funciona, cierra y resetea.
//!
//! **Al abrir se reinicia el contador** (sep-2026, #03 de la auditoría de
//! recursos): antes el contador seguía en 3 tras abrir, así que el probe
//! half-open reabría con UN solo fallo; y como el idle-kill del sidecar dura lo
//! mismo que el cooldown (300 s), cada apertura terminaba en un spawn frío
//! (1-2.4 GB de GGUF). Ahora el half-open exige `FAIL_THRESHOLD` fallos nuevos.
//!
//! El estado va en atómicos para poder vivir en un `static`; la política es
//! pura sobre `now_ms` (lo pone el caller) y se prueba con tabla, siguiendo la
//! convención de `idle_unload.rs` / `next_backoff`.

use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

/// Fallos consecutivos que abren el circuito.
pub(crate) const FAIL_THRESHOLD: u64 = 3;
/// Tiempo con el circuito abierto antes del probe half-open.
pub(crate) const COOLDOWN: Duration = Duration::from_secs(300);

/// Resultado de registrar un fallo.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum FailureOutcome {
    /// Aún cerrado: `n` fallos consecutivos acumulados (1..FAIL_THRESHOLD-1).
    Counting(u64),
    /// Este fallo abrió (o reabrió) el circuito por `COOLDOWN`.
    Opened,
}

pub(crate) struct CoachBreaker {
    consec_fails: AtomicU64,
    open_until_ms: AtomicU64,
    /// Aperturas y re-aperturas (fallo en half-open) desde el último `reset`.
    opens: AtomicU64,
}

impl CoachBreaker {
    pub(crate) const fn new() -> Self {
        Self {
            consec_fails: AtomicU64::new(0),
            open_until_ms: AtomicU64::new(0),
            opens: AtomicU64::new(0),
        }
    }

    /// `Some(ms restantes)` si el circuito está abierto en `now_ms`; `None` si
    /// está cerrado o el cooldown ya venció (el siguiente intento es el probe
    /// half-open). Mismo `<` estricto que la implementación original.
    pub(crate) fn open_remaining_ms(&self, now_ms: u64) -> Option<u64> {
        let until = self.open_until_ms.load(Ordering::Relaxed);
        if until > 0 && now_ms < until {
            Some(until - now_ms)
        } else {
            None
        }
    }

    /// Registra un fallo. Al alcanzar `FAIL_THRESHOLD` abre el circuito Y
    /// reinicia el contador, así el probe half-open acumula fallos desde cero.
    pub(crate) fn record_failure(&self, now_ms: u64) -> FailureOutcome {
        let fails = self.consec_fails.fetch_add(1, Ordering::Relaxed) + 1;
        if fails < FAIL_THRESHOLD {
            return FailureOutcome::Counting(fails);
        }
        self.consec_fails.store(0, Ordering::Relaxed);
        self.open_until_ms
            .store(now_ms + COOLDOWN.as_millis() as u64, Ordering::Relaxed);
        self.opens.fetch_add(1, Ordering::Relaxed);
        FailureOutcome::Opened
    }

    /// El LLM respondió: cerrar el circuito (éxito en half-open) y resetear.
    pub(crate) fn record_success(&self) {
        self.consec_fails.store(0, Ordering::Relaxed);
        self.open_until_ms.store(0, Ordering::Relaxed);
    }

    /// Reset por sesión (`live_feedback::start`): cierra y olvida las aperturas.
    pub(crate) fn reset(&self) {
        self.record_success();
        self.opens.store(0, Ordering::Relaxed);
    }

    pub(crate) fn opens(&self) -> u64 {
        self.opens.load(Ordering::Relaxed)
    }

    #[cfg(test)]
    fn consec_fails(&self) -> u64 {
        self.consec_fails.load(Ordering::Relaxed)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const T0: u64 = 1_700_000_000_000;
    const COOLDOWN_MS: u64 = COOLDOWN.as_millis() as u64;

    #[test]
    fn tres_fallos_abren_y_reinician_el_contador() {
        let b = CoachBreaker::new();
        assert_eq!(b.record_failure(T0), FailureOutcome::Counting(1));
        assert_eq!(b.record_failure(T0), FailureOutcome::Counting(2));
        assert_eq!(b.open_remaining_ms(T0), None, "dos fallos no abren");
        assert_eq!(b.record_failure(T0), FailureOutcome::Opened);
        assert_eq!(b.consec_fails(), 0, "al abrir se reinicia el contador");
        assert_eq!(b.open_remaining_ms(T0), Some(COOLDOWN_MS));
        assert_eq!(b.opens(), 1);
    }

    #[test]
    fn half_open_exige_tres_fallos_nuevos() {
        // El pedido de #03: antes el contador seguía en 3 y un solo fallo del
        // probe reabría otros 300 s.
        let b = CoachBreaker::new();
        for _ in 0..FAIL_THRESHOLD {
            b.record_failure(T0);
        }
        assert_eq!(b.opens(), 1);
        let probe = T0 + COOLDOWN_MS + 1_000;
        assert_eq!(b.open_remaining_ms(probe), None, "cooldown vencido: toca probe");
        assert_eq!(b.record_failure(probe), FailureOutcome::Counting(1));
        assert_eq!(b.open_remaining_ms(probe), None, "un fallo del probe no reabre");
        assert_eq!(b.record_failure(probe), FailureOutcome::Counting(2));
        assert_eq!(b.record_failure(probe), FailureOutcome::Opened);
        assert_eq!(b.opens(), 2, "la re-apertura sí cuenta");
    }

    #[test]
    fn exito_cierra_y_resetea() {
        let b = CoachBreaker::new();
        b.record_failure(T0);
        b.record_failure(T0);
        b.record_success();
        assert_eq!(b.record_failure(T0), FailureOutcome::Counting(1));

        for _ in 0..FAIL_THRESHOLD {
            b.record_failure(T0);
        }
        assert!(b.open_remaining_ms(T0).is_some());
        b.record_success();
        assert_eq!(b.open_remaining_ms(T0), None, "éxito en half-open cierra");
        assert_eq!(b.opens(), 1, "el éxito no borra el historial de aperturas");
    }

    #[test]
    fn cooldown_vence_a_los_300s() {
        let b = CoachBreaker::new();
        for _ in 0..FAIL_THRESHOLD {
            b.record_failure(T0);
        }
        assert_eq!(b.open_remaining_ms(T0 + COOLDOWN_MS - 1), Some(1));
        assert_eq!(b.open_remaining_ms(T0 + COOLDOWN_MS), None);
    }

    #[test]
    fn reset_limpia_aperturas() {
        let b = CoachBreaker::new();
        for _ in 0..FAIL_THRESHOLD {
            b.record_failure(T0);
        }
        b.record_failure(T0);
        b.reset();
        assert_eq!(b.opens(), 0);
        assert_eq!(b.consec_fails(), 0);
        assert_eq!(b.open_remaining_ms(T0), None);
    }
}
