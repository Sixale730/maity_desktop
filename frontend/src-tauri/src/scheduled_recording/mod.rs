//! Grabación Programada por Jornada
//!
//! Servicio de fondo que, según un horario configurado (ventana horaria + días de la
//! semana), arranca y detiene la grabación de forma autónoma —incluso con la ventana
//! minimizada al tray— reutilizando el lifecycle de grabación existente.
//!
//! Ver spec: "Maity - Documentación Técnica / Grabación Programada por Jornada".

pub mod commands;
pub mod schedule;
pub mod service;
pub mod settings;

pub use commands::*;
pub use service::ScheduledRecordingService;
pub use settings::ScheduledRecordingSettings;
