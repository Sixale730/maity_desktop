//! Helper genérico para reciclaje de sesión ONNX en background.
//!
//! Por qué existe: en sesiones ONNX de larga duración con shapes dinámicos, la
//! memoria nativa (BFCArena) puede crecer aunque hayamos desactivado el arena
//! (defensa principal en `*/model.rs::init_session`). Este helper es la
//! **red de seguridad**: cada N inferencias dispara un reload de la sesión
//! en `tokio::spawn` para liberar memoria, SIN bloquear el worker.
//!
//! La implementación previa (UX-012 inline en `parakeet_engine.rs`) hacía el
//! reload bloqueante en el hot path del worker. Como `worker.rs` tiene
//! `NUM_WORKERS=1`, eso colgaba el throughput a 0 durante 3-6 s mientras
//! cargaba 3 archivos ONNX desde disco. La queue mpsc se llenaba y se llegó
//! a ver chunks acumulados de 233 segundos en logs reales.
//!
//! Uso típico (ver `parakeet_engine.rs::transcribe_audio`):
//! ```ignore
//! self.lifecycle.note_inference();
//! self.lifecycle.maybe_recycle(|| async move {
//!     // Carga el modelo nuevo en variable LOCAL.
//!     // Si load OK, hace swap atómico en current_model.
//!     // Si load FAIL, modelo viejo se preserva intacto.
//!     Ok(())
//! });
//! ```

use std::future::Future;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use anyhow::Result;

/// Lifecycle de una sesión ONNX: cuenta inferencias y dispara un recycle en
/// background cuando se cruza un threshold.
pub struct OnnxSessionLifecycle {
    /// Contador atómico de inferencias completadas. Sin locks: hot path limpio.
    inference_count: AtomicU64,
    /// Timestamp del último recycle disparado, para anti-storm con `min_gap`.
    last_recycle: Mutex<Option<Instant>>,
    /// Cuántas inferencias entre recycles.
    recycle_every: u64,
    /// Tiempo mínimo entre recycles consecutivos (segunda capa de protección
    /// contra storms si el counter se inflara por algún edge case).
    min_gap: Duration,
    /// Etiqueta para logs (e.g. "parakeet"). Distingue motores en el output.
    label: &'static str,
}

impl OnnxSessionLifecycle {
    pub fn new(label: &'static str, recycle_every: u64, min_gap: Duration) -> Self {
        Self {
            inference_count: AtomicU64::new(0),
            last_recycle: Mutex::new(None),
            recycle_every,
            min_gap,
            label,
        }
    }

    /// Llama después de cada inferencia exitosa. Devuelve el contador post-incremento
    /// (útil para logs). Hot path puro: 1 fetch_add atómico, sin locks.
    pub fn note_inference(&self) -> u64 {
        self.inference_count.fetch_add(1, Ordering::Relaxed) + 1
    }

    /// Decide si toca recycle AHORA. Si sí, dispara `recycle_fn` en `tokio::spawn`
    /// y retorna inmediatamente — el caller no espera el reload.
    ///
    /// Garantías:
    /// - Bajo carrera concurrente (N callers simultáneos cruzan el threshold),
    ///   solo UNO dispara el recycle, los demás retornan sin spawn.
    /// - El counter se resetea atómicamente vía `compare_exchange` (no se queda
    ///   atascado en N*threshold como el bug del UX-012 viejo).
    /// - Si `recycle_fn` falla, el modelo viejo permanece intacto (responsabilidad
    ///   del cierre: cargar a variable local primero, swap solo si Ok).
    pub fn maybe_recycle<F, Fut>(&self, recycle_fn: F)
    where
        F: FnOnce() -> Fut + Send + 'static,
        Fut: Future<Output = Result<()>> + Send + 'static,
    {
        let count = self.inference_count.load(Ordering::Relaxed);
        if count < self.recycle_every {
            return;
        }

        // Anti-storm: si hicimos recycle hace muy poco, no dispares otro.
        if let Ok(guard) = self.last_recycle.try_lock() {
            if let Some(last) = *guard {
                if last.elapsed() < self.min_gap {
                    return;
                }
            }
        }

        // CAS: solo el primer caller que vea count >= threshold gana y resetea.
        // Si otro thread ya disparó (counter ya en 0), este retorna sin spawn.
        if self
            .inference_count
            .compare_exchange(count, 0, Ordering::AcqRel, Ordering::Relaxed)
            .is_err()
        {
            return;
        }

        // Marcar timestamp del recycle (best-effort; si try_lock falla, el min_gap
        // simplemente no aplica esta vez — inocuo).
        if let Ok(mut g) = self.last_recycle.try_lock() {
            *g = Some(Instant::now());
        }

        let label = self.label;
        tokio::spawn(async move {
            log::info!(
                "ONNX session recycle starting in background ({})",
                label
            );
            let started = Instant::now();
            match recycle_fn().await {
                Ok(()) => log::info!(
                    "ONNX session recycle ({}) completed in {:?}",
                    label,
                    started.elapsed()
                ),
                Err(e) => log::warn!(
                    "ONNX session recycle ({}) failed: {} — \
                     existing session retained, will retry on next threshold",
                    label,
                    e
                ),
            }
        });
    }

    /// Devuelve el conteo actual sin modificarlo. Útil para tests y diagnóstico.
    #[cfg(test)]
    pub fn current_count(&self) -> u64 {
        self.inference_count.load(Ordering::Relaxed)
    }
}

// ─── Tests ────────────────────────────────────────────────────────────────────
#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use std::sync::atomic::AtomicU32;

    #[test]
    fn note_inference_es_monotonico() {
        let lc = OnnxSessionLifecycle::new("test", 100, Duration::from_secs(60));
        assert_eq!(lc.note_inference(), 1);
        assert_eq!(lc.note_inference(), 2);
        assert_eq!(lc.note_inference(), 3);
        assert_eq!(lc.current_count(), 3);
    }

    #[tokio::test]
    async fn maybe_recycle_no_dispara_bajo_threshold() {
        let lc = OnnxSessionLifecycle::new("test", 5, Duration::from_secs(60));
        let dispara = Arc::new(AtomicU32::new(0));

        // Solo 3 inferencias, threshold es 5 -> no dispara.
        for _ in 0..3 {
            lc.note_inference();
        }
        let dispara_clone = dispara.clone();
        lc.maybe_recycle(move || {
            let d = dispara_clone.clone();
            async move {
                d.fetch_add(1, Ordering::SeqCst);
                Ok(())
            }
        });

        // Pequeña espera para ver si tokio::spawn corrió.
        tokio::time::sleep(Duration::from_millis(50)).await;
        assert_eq!(dispara.load(Ordering::SeqCst), 0, "no debe disparar bajo threshold");
        assert_eq!(lc.current_count(), 3, "counter no se reseta");
    }

    #[tokio::test]
    async fn maybe_recycle_dispara_solo_una_vez_bajo_carrera() {
        let lc = Arc::new(OnnxSessionLifecycle::new("test", 5, Duration::from_millis(0)));
        let dispara = Arc::new(AtomicU32::new(0));

        // Llegar al threshold.
        for _ in 0..5 {
            lc.note_inference();
        }

        // 10 callers concurrentes intentan disparar. Solo UNO debe ganar el CAS.
        let mut handles = vec![];
        for _ in 0..10 {
            let lc_clone = lc.clone();
            let dispara_clone = dispara.clone();
            handles.push(tokio::spawn(async move {
                lc_clone.maybe_recycle(move || {
                    let d = dispara_clone.clone();
                    async move {
                        d.fetch_add(1, Ordering::SeqCst);
                        Ok(())
                    }
                });
            }));
        }
        for h in handles {
            h.await.unwrap();
        }

        // Esperar a que el spawn corra.
        tokio::time::sleep(Duration::from_millis(100)).await;
        assert_eq!(
            dispara.load(Ordering::SeqCst),
            1,
            "bajo carrera de 10 callers, solo UNO debe disparar"
        );
        assert_eq!(lc.current_count(), 0, "counter reseteado por CAS");
    }

    #[tokio::test]
    async fn maybe_recycle_min_gap_bloquea_segundo_disparo_cercano() {
        let lc = OnnxSessionLifecycle::new("test", 3, Duration::from_secs(60));
        let dispara = Arc::new(AtomicU32::new(0));

        // Primer recycle.
        for _ in 0..3 {
            lc.note_inference();
        }
        let dispara_a = dispara.clone();
        lc.maybe_recycle(move || {
            let d = dispara_a.clone();
            async move {
                d.fetch_add(1, Ordering::SeqCst);
                Ok(())
            }
        });
        tokio::time::sleep(Duration::from_millis(50)).await;
        assert_eq!(dispara.load(Ordering::SeqCst), 1);

        // Segundo recycle muy cercano: counter vuelve al threshold pero min_gap (60s)
        // bloquea el disparo.
        for _ in 0..3 {
            lc.note_inference();
        }
        let dispara_b = dispara.clone();
        lc.maybe_recycle(move || {
            let d = dispara_b.clone();
            async move {
                d.fetch_add(1, Ordering::SeqCst);
                Ok(())
            }
        });
        tokio::time::sleep(Duration::from_millis(50)).await;
        assert_eq!(
            dispara.load(Ordering::SeqCst),
            1,
            "min_gap debe bloquear el segundo disparo"
        );
    }
}
