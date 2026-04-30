//! Modulo `llm/` — interfaz comun para servicios LLM (coach + summary).
//!
//! Define el trait `LlmService` que abstrae generacion de texto, configuraciones
//! por servicio (`LlmConfig`), errores tipados (`LlmError`) y metricas comunes
//! (`LlmMetrics`). Los servicios concretos viven en `coach/llm_service.rs` y
//! `summary/llm_service.rs`. El transporte a `llama-helper` se agregara en
//! commits siguientes como pool indexado por modelo.
//!
//! Este modulo no contiene implementaciones de servicios — solo el contrato.

pub mod error;
pub mod metrics;
pub mod request;
pub mod response;
pub mod service;

pub use error::LlmError;
pub use metrics::{LlmMetrics, LlmMetricsSnapshot};
pub use request::GenerationRequest;
pub use response::GenerationResponse;
pub use service::{LlmConfig, LlmService};
