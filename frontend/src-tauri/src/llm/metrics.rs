//! Metricas comunes para servicios LLM (counts + sliding window de latencias).

use std::collections::VecDeque;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

const LATENCY_WINDOW_CAP: usize = 100;

/// Metricas acumuladas de un servicio LLM. Thread-safe.
#[derive(Debug)]
pub struct LlmMetrics {
    total_requests: AtomicU64,
    successful_requests: AtomicU64,
    failed_requests: AtomicU64,
    cancelled_requests: AtomicU64,
    /// Sliding window de las ultimas `LATENCY_WINDOW_CAP` latencias en ms.
    latencies_ms: Mutex<VecDeque<u64>>,
}

impl Default for LlmMetrics {
    fn default() -> Self {
        Self::new()
    }
}

impl LlmMetrics {
    pub fn new() -> Self {
        Self {
            total_requests: AtomicU64::new(0),
            successful_requests: AtomicU64::new(0),
            failed_requests: AtomicU64::new(0),
            cancelled_requests: AtomicU64::new(0),
            latencies_ms: Mutex::new(VecDeque::with_capacity(LATENCY_WINDOW_CAP)),
        }
    }

    pub fn record_request(&self) {
        self.total_requests.fetch_add(1, Ordering::Relaxed);
    }

    pub fn record_success(&self, latency_ms: u64) {
        self.successful_requests.fetch_add(1, Ordering::Relaxed);
        if let Ok(mut window) = self.latencies_ms.lock() {
            window.push_back(latency_ms);
            if window.len() > LATENCY_WINDOW_CAP {
                window.pop_front();
            }
        }
    }

    pub fn record_failure(&self) {
        self.failed_requests.fetch_add(1, Ordering::Relaxed);
    }

    pub fn record_cancellation(&self) {
        self.cancelled_requests.fetch_add(1, Ordering::Relaxed);
    }

    /// Calcula p95 sobre la sliding window. Devuelve None si vacia.
    pub fn p95_latency_ms(&self) -> Option<u64> {
        let window = self.latencies_ms.lock().ok()?;
        if window.is_empty() {
            return None;
        }
        let mut sorted: Vec<u64> = window.iter().copied().collect();
        sorted.sort_unstable();
        let idx = ((sorted.len() as f64) * 0.95) as usize;
        let idx = idx.min(sorted.len() - 1);
        Some(sorted[idx])
    }

    pub fn snapshot(&self) -> LlmMetricsSnapshot {
        LlmMetricsSnapshot {
            total_requests: self.total_requests.load(Ordering::Relaxed),
            successful_requests: self.successful_requests.load(Ordering::Relaxed),
            failed_requests: self.failed_requests.load(Ordering::Relaxed),
            cancelled_requests: self.cancelled_requests.load(Ordering::Relaxed),
            p95_latency_ms: self.p95_latency_ms(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct LlmMetricsSnapshot {
    pub total_requests: u64,
    pub successful_requests: u64,
    pub failed_requests: u64,
    pub cancelled_requests: u64,
    pub p95_latency_ms: Option<u64>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn records_success_and_failure_counts() {
        let m = LlmMetrics::new();
        m.record_request();
        m.record_success(100);
        m.record_request();
        m.record_failure();
        let snap = m.snapshot();
        assert_eq!(snap.total_requests, 2);
        assert_eq!(snap.successful_requests, 1);
        assert_eq!(snap.failed_requests, 1);
    }

    #[test]
    fn p95_returns_none_when_empty() {
        let m = LlmMetrics::new();
        assert_eq!(m.p95_latency_ms(), None);
    }

    #[test]
    fn p95_computes_over_window() {
        let m = LlmMetrics::new();
        for i in 1..=100 {
            m.record_success(i);
        }
        // p95 con 100 muestras 1..100 -> indice 95
        let p95 = m.p95_latency_ms().unwrap();
        assert!((95..=96).contains(&p95), "p95={}", p95);
    }

    #[test]
    fn window_cap_respected() {
        let m = LlmMetrics::new();
        for i in 0..150 {
            m.record_success(i);
        }
        let window = m.latencies_ms.lock().unwrap();
        assert_eq!(window.len(), LATENCY_WINDOW_CAP);
    }
}
