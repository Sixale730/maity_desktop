// `system_monitor` / `parallel_processor` / `parallel_commands` se borraron en
// sep-2026 (#21 de la auditoría de recursos): 11 comandos sin un solo call
// site en el frontend, y su `ParallelProcessorState` se registraba con
// `manage()` antes del `setup()` pagando un `System::new_all()` (tabla
// completa de procesos, 1-5 MB retenidos) en cada arranque. Recuperables de
// git si algún día se retoma el procesamiento paralelo de Whisper.
pub mod whisper_engine;
pub mod commands;
// pub mod stderr_suppressor;

pub use whisper_engine::*;
pub use commands::*;
// pub use stderr_suppressor::*;
