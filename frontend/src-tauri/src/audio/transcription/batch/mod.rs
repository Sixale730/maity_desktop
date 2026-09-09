// audio/transcription/batch/mod.rs
//
// Transcripción por LOTE (F1 de la migración, sep-2026): en vez de transcribir
// en vivo durante la grabación, el audio.mp4 ya grabado se decodifica por
// canal, se filtra voz con una compuerta de energía (sin Silero), se trocea en
// chunks de 10-30 s y se transcribe con Parakeet — escribiendo el MISMO
// `transcripts.json` que consume `finalize_segment_native`, así el conteo de
// palabras, Saved/Discarded/Failed, SQLite y sync_queue se reusan sin tocar.
//
// Vive en `transcription/` (no en `scheduled_recording/`) porque lo disparan
// tanto la jornada como el stop manual, y su dependencia dura es el ciclo de
// vida del motor STT (`engine.rs`: ensure_stt_warm_parakeet + BatchSttLease).
//
// En F1 el único entrypoint es el comando dev `batch_transcribe_folder`
// (instrumento de WER/RTF); la cola persistente y el planificador híbrido con
// `pressure_level()` llegan en F2.

pub mod chunker;
pub mod decoder;
pub mod energy_gate;
pub mod planner;
pub mod transcriber;
pub mod writer;

pub use transcriber::BatchMetrics;
