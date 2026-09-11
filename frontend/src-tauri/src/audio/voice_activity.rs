//! Rastreador de actividad de voz por canal (F5 de la migración a lote).
//!
//! En modo LOTE el pipeline no construye Silero (F3) y el coach deja de recibir
//! `transcript-update`, así que sus métricas de participación (tiempo de
//! palabra, monólogo, "esperando audio") se quedarían sin fuente. Este módulo
//! es esa fuente alternativa: una **compuerta de energía por bloques de
//! 100 ms**, por canal, deliberadamente sin modelo — cero RAM residente, cero
//! hilos, coste por bloque de un RMS. Es el mismo enfoque que la compuerta del
//! transcriptor de lote (`batch/transcriber.rs`), pero en vivo y sobre el
//! audio a 48 kHz que ya pasa por `AudioPipeline::run`.
//!
//! Quién escribe / quién lee:
//! - `AudioPipeline` (solo en modo lote) alimenta `VoiceActivityTracker::push`
//!   con cada chunk de mic/sistema ANTES de que el chunk se mueva al ring
//!   buffer stereo, y sin contar mientras la grabación está en pausa.
//! - El tracker publica en `VoiceActivityStats` (atómicos, `Arc` compartido a
//!   través de `RecordingState::voice_activity`) y el coach por audio
//!   (`coach/audio_heuristics.rs` vía `live_feedback`) lee `snapshot()` cada
//!   3 s. Nunca hay un lock entre el hilo de audio y el coach.
//!
//! Ganancia: la R del stereo grabado es `sistema × system_audio_gain`
//! (`pipeline.rs`, STEP 2), y los umbrales de la compuerta del lote se
//! validaron en F1 sobre ESE audio. Para conservar esos umbrales, el RMS del
//! canal sistema se multiplica aquí por la misma ganancia.
//!
//! Riesgos conocidos (documentados en el plan de F5, no resueltos aquí): eco
//! por altavoces sin audífonos infla `user_voiced_ms` (la detección de
//! monólogo sí rompe bien porque el canal sistema tiene voz); un mic muy bajo
//! (< 0.006 RMS) nunca es "voiced" → el coach se queda en "Esperando audio"
//! (por eso el `info!` único por canal en el primer bloque con voz).

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use log::info;

use super::dsp::{dc_remove, high_pass_80hz, HighPassState};
use super::recording_state::DeviceType;

/// Tamaño del bloque de decisión. 100 ms es el grano del hangover, de las
/// rachas y del reloj de sesión; todo lo que publica el tracker es múltiplo.
pub const BLOCK_MS: u32 = 100;
/// Umbral = `max(piso_de_ruido × 3, 0.006)`. El piso mínimo evita que el
/// silencio digital (RMS ≈ 0) haga que cualquier rumor cuente como voz.
pub const NOISE_FLOOR_MULT: f32 = 3.0;
pub const MIN_THRESHOLD_RMS: f32 = 0.006;
/// Piso de ruido: MISMA ley que la compuerta del lote (`batch/energy_gate.rs`,
/// validada en F1): `piso = min(rms, piso × LEAK)` en TODOS los bloques (con o
/// sin voz), acotado a `[1e-5, 0.1]`. Baja al instante al RMS más bajo que ve
/// (una micro-pausa basta) y sube por fuga lenta (×3.3 por minuto), así se
/// adapta a un ruido que cambia sin perseguir la voz. Por qué no "aprender
/// solo de los bloques sin voz" (ley anterior): con un ruido de fondo estable
/// por encima de 0.006 (ventilador, aire acondicionado) TODO bloque salía
/// voiced desde el primero, el piso jamás aprendía nada, `user_silence_ms`
/// no avanzaba y el coach avisaba de un monólogo falso a los 61 y 151 s.
const NOISE_FLOOR_INIT: f32 = 0.01;
const NOISE_FLOOR_LEAK: f32 = 1.002;
const NOISE_FLOOR_MIN: f32 = 1e-5;
const NOISE_FLOOR_MAX: f32 = 0.1;
/// Bloques que siguen contando como voz tras el último bloque por encima del
/// umbral: puentea las micro-pausas entre palabras (500 ms).
pub const HANGOVER_BLOCKS: u8 = 5;
/// Voz CONTINUA del interlocutor (con su hangover) que rompe la racha de
/// monólogo del usuario. Una tos de 300 ms (+500 de hangover = 800) no llega.
/// Se calibra con `longest_user_mono_ms` de la telemetría del piloto.
pub const INTERRUPT_MS: u32 = 1500;
/// Silencio propio continuo que cierra la racha de monólogo del usuario.
///
/// Se cuenta en bloques SIN voz, y el hangover (5 bloques) sigue contando como
/// voz: el silencio REAL efectivo es `3000 + 500 = 3500 ms`. Una pausa de
/// 3.0 s exactos NO cierra la racha (solo 2.5 s de bloques sin voz); una de
/// 3.5 s sí. Misma convención que `INTERRUPT_MS` (que incluye el hangover del
/// interlocutor). Fijado por test (`pausa_de_3_0s_exactos_no_cierra_la_racha`).
pub const USER_PAUSE_END_MS: u32 = 3000;
/// Canal sistema ESTANCADO: si en el reloj del mic pasan más de esto sin que
/// llegue ningún bloque de sistema (dispositivo perdido, hot-swap, loopback
/// que deja de entregar), el latch "el interlocutor tiene la palabra" se
/// suelta. Sin esto, `sys_continuous_voiced_ms` solo volvía a 0 en un bloque
/// de sistema sin voz — que nunca llegaba — y ninguna racha de monólogo
/// volvía a abrirse en toda la sesión. En operación normal los bloques de
/// ambos canales llegan intercalados (decenas de ms), así que 1 s no dispara.
pub const SYS_STALL_MS: u64 = 1000;

// ────────────────────────────────────────────────────────────────────────────
// Estadísticas compartidas (escritor: hilo del pipeline; lector: coach)
// ────────────────────────────────────────────────────────────────────────────

/// Contadores de la sesión, en milisegundos de audio. Viven en `RecordingState`
/// (un `RecordingState` nuevo por grabación, así que no hay reset explícito).
#[derive(Debug, Default)]
pub struct VoiceActivityStats {
    user_voiced_ms: AtomicU64,
    interlocutor_voiced_ms: AtomicU64,
    /// Duración de la racha de monólogo del usuario EN CURSO (0 si no hay).
    current_user_mono_ms: AtomicU64,
    longest_user_mono_ms: AtomicU64,
    /// Rachas abiertas en la sesión. El coach por audio lo usa como id de
    /// racha: "un tip de monólogo por racha".
    user_mono_runs: AtomicU64,
    /// Reloj de audio del micrófono (ms de audio de mic procesados, sin pausa).
    session_ms: AtomicU64,
    /// Reloj del mic (`session_ms`) del último bloque de sistema con voz
    /// MIENTRAS el interlocutor tenía la palabra (`interlocutor_holds_floor`:
    /// voz continua ≥ `INTERRUPT_MS`), es decir, el mismo evento que rompe la
    /// racha del usuario; una tos de 300 ms no lo mueve. 0 = la audiencia
    /// nunca intervino. Lo lee el coach de ponente
    /// (`coach/presenter_heuristics.rs`) para "nadie ha intervenido en N min".
    last_interlocutor_voice_ms: AtomicU64,
}

impl VoiceActivityStats {
    pub fn new() -> Arc<Self> {
        Arc::new(Self::default())
    }

    /// Siembra determinista para tests de consumidores (coach): el pipeline
    /// real solo escribe desde el tracker.
    #[cfg(test)]
    pub fn seed_for_test(&self, s: VoiceActivitySnapshot) {
        self.user_voiced_ms.store(s.user_voiced_ms, Ordering::Relaxed);
        self.interlocutor_voiced_ms.store(s.interlocutor_voiced_ms, Ordering::Relaxed);
        self.current_user_mono_ms.store(s.current_user_mono_ms, Ordering::Relaxed);
        self.longest_user_mono_ms.store(s.longest_user_mono_ms, Ordering::Relaxed);
        self.user_mono_runs.store(s.user_mono_runs, Ordering::Relaxed);
        self.session_ms.store(s.session_ms, Ordering::Relaxed);
        self.last_interlocutor_voice_ms
            .store(s.last_interlocutor_voice_ms, Ordering::Relaxed);
    }

    /// Lectura consistente "a ojo" (cada campo es atómico; el conjunto puede
    /// estar a un bloque de distancia entre sí, irrelevante para un coach
    /// que muestrea cada 3 s).
    pub fn snapshot(&self) -> VoiceActivitySnapshot {
        VoiceActivitySnapshot {
            user_voiced_ms: self.user_voiced_ms.load(Ordering::Relaxed),
            interlocutor_voiced_ms: self.interlocutor_voiced_ms.load(Ordering::Relaxed),
            current_user_mono_ms: self.current_user_mono_ms.load(Ordering::Relaxed),
            longest_user_mono_ms: self.longest_user_mono_ms.load(Ordering::Relaxed),
            user_mono_runs: self.user_mono_runs.load(Ordering::Relaxed),
            session_ms: self.session_ms.load(Ordering::Relaxed),
            last_interlocutor_voice_ms: self.last_interlocutor_voice_ms.load(Ordering::Relaxed),
        }
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct VoiceActivitySnapshot {
    pub user_voiced_ms: u64,
    pub interlocutor_voiced_ms: u64,
    pub current_user_mono_ms: u64,
    pub longest_user_mono_ms: u64,
    pub user_mono_runs: u64,
    pub session_ms: u64,
    /// Ver `VoiceActivityStats::last_interlocutor_voice_ms` (0 = nunca).
    pub last_interlocutor_voice_ms: u64,
}

impl VoiceActivitySnapshot {
    /// Ms de audio desde la última intervención (≥ `INTERRUPT_MS`) de la
    /// audiencia. Si nunca intervino, toda la sesión (`saturating_sub(0)`).
    /// Mismo reloj que `session_ms` (audio del mic, no pared).
    pub fn interlocutor_silence_ms(&self) -> u64 {
        self.session_ms.saturating_sub(self.last_interlocutor_voice_ms)
    }

    /// ¿Algún canal ha tenido voz? El gauge muestra "Esperando audio…" hasta
    /// que sea `true`.
    pub fn any_voiced(&self) -> bool {
        self.user_voiced_ms + self.interlocutor_voiced_ms > 0
    }

    /// Fracción del tiempo de palabra del usuario. `0.5` sin voz (mismo
    /// neutro que `FeedbackState::talk_ratio` sin turnos).
    pub fn user_talk_ratio(&self) -> f32 {
        let total = self.user_voiced_ms + self.interlocutor_voiced_ms;
        if total == 0 {
            0.5
        } else {
            self.user_voiced_ms as f32 / total as f32
        }
    }
}

// ────────────────────────────────────────────────────────────────────────────
// Compuerta por canal
// ────────────────────────────────────────────────────────────────────────────

/// Compuerta de energía de UN canal. `partial` acumula solo el resto (< 1
/// bloque) entre pushes y se vacía al cerrar cada bloque: nunca crece más
/// allá de `block_len` — cero acumulación de audio.
struct ChannelGate {
    label: &'static str,
    sample_rate: f32,
    block_len: usize,
    partial: Vec<f32>,
    hp: HighPassState,
    /// Multiplicador del RMS (1.0 para mic; `system_audio_gain` para sistema).
    gain: f32,
    noise_floor: f32,
    hangover_left: u8,
    /// `info!` único por canal en el primer bloque con voz (diagnóstico del
    /// "Esperando audio" eterno con un mic muy bajo).
    announced: bool,
}

impl ChannelGate {
    fn new(label: &'static str, sample_rate: u32, gain: f32) -> Self {
        let block_len = ((sample_rate as u64 * BLOCK_MS as u64) / 1000).max(1) as usize;
        Self {
            label,
            sample_rate: sample_rate as f32,
            block_len,
            partial: Vec::with_capacity(block_len),
            hp: HighPassState::new(),
            gain,
            noise_floor: NOISE_FLOOR_INIT,
            hangover_left: 0,
            announced: false,
        }
    }

    /// Alimenta muestras mono y llama `on_block(voiced)` por cada bloque de
    /// 100 ms completado, en orden. Independiente del tamaño de los chunks:
    /// N pushes de 777 muestras equivalen a un push de N×777.
    fn feed(&mut self, samples: &[f32], mut on_block: impl FnMut(bool)) {
        let mut rest = samples;
        while !rest.is_empty() {
            let need = self.block_len - self.partial.len();
            let take = need.min(rest.len());
            self.partial.extend_from_slice(&rest[..take]);
            rest = &rest[take..];
            if self.partial.len() == self.block_len {
                let voiced = self.classify_block();
                self.partial.clear();
                on_block(voiced);
            }
        }
    }

    /// Decide el bloque completo que hay en `partial`. Pre-proceso barato en
    /// sitio (DC + paso-alto 80 Hz de `dsp.rs`, el mismo del transcriptor),
    /// RMS × ganancia contra el umbral adaptativo, hangover de 5 bloques.
    fn classify_block(&mut self) -> bool {
        dc_remove(&mut self.partial);
        high_pass_80hz(&mut self.partial, self.sample_rate, &mut self.hp);
        let energy = self.partial.iter().map(|s| s * s).sum::<f32>() / self.partial.len() as f32;
        let rms = if energy.is_finite() { energy.sqrt() * self.gain } else { 0.0 };

        // Piso de ruido (ley de `energy_gate.rs`, ver las constantes): se
        // actualiza ANTES de decidir y en TODOS los bloques — baja al instante,
        // sube por fuga lenta, nunca 0 para que el umbral relativo no colapse
        // con silencio digital perfecto.
        self.noise_floor = rms
            .min(self.noise_floor * NOISE_FLOOR_LEAK)
            .clamp(NOISE_FLOOR_MIN, NOISE_FLOOR_MAX);
        let threshold = (self.noise_floor * NOISE_FLOOR_MULT).max(MIN_THRESHOLD_RMS);
        let raw_voiced = rms >= threshold;

        if raw_voiced {
            self.hangover_left = HANGOVER_BLOCKS;
            if !self.announced {
                self.announced = true;
                info!(
                    "🎙️ Rastreador de voz: primer bloque con voz en el canal {} (rms={:.4}, umbral={:.4}, gain={:.1}x)",
                    self.label, rms, threshold, self.gain
                );
            }
            true
        } else if self.hangover_left > 0 {
            self.hangover_left -= 1;
            true
        } else {
            false
        }
    }
}

// ────────────────────────────────────────────────────────────────────────────
// Máquina de monólogo (fuente de verdad de las rachas)
// ────────────────────────────────────────────────────────────────────────────

/// Estado por sesión de las rachas del usuario. Todo en ms de audio del
/// canal correspondiente; el reloj de sesión es el del micrófono.
struct MonologueMachine {
    stats: Arc<VoiceActivityStats>,
    session_ms: u64,
    run_active: bool,
    run_start_ms: u64,
    /// Silencio propio continuo desde el último bloque de mic con voz.
    user_silence_ms: u32,
    /// Voz continua del interlocutor (con hangover). Mientras sea
    /// ≥ `INTERRUPT_MS` el interlocutor "tiene la palabra": rompe la racha y
    /// además impide abrir una nueva (si no, con crosstalk se abriría y
    /// cerraría una racha por bloque, inflando `user_mono_runs`).
    sys_continuous_voiced_ms: u32,
    /// Reloj del mic (`session_ms`) en el ÚLTIMO bloque de sistema, con o sin
    /// voz. Sirve para detectar el canal sistema estancado (`SYS_STALL_MS`).
    last_sys_block_at_ms: Option<u64>,
}

impl MonologueMachine {
    fn new(stats: Arc<VoiceActivityStats>) -> Self {
        Self {
            stats,
            session_ms: 0,
            run_active: false,
            run_start_ms: 0,
            user_silence_ms: 0,
            sys_continuous_voiced_ms: 0,
            last_sys_block_at_ms: None,
        }
    }

    fn interlocutor_holds_floor(&self) -> bool {
        self.sys_continuous_voiced_ms >= INTERRUPT_MS
    }

    /// Si el canal sistema dejó de entregar bloques (medido con el reloj del
    /// mic, que sí sigue corriendo), su racha de voz no puede seguir viva:
    /// se suelta el latch. Solo se evalúa desde el mic porque es el único
    /// canal que avanza cuando el otro se estanca.
    fn release_stalled_sys_latch(&mut self) {
        if self.sys_continuous_voiced_ms == 0 {
            return;
        }
        if let Some(last) = self.last_sys_block_at_ms {
            if self.session_ms.saturating_sub(last) > SYS_STALL_MS {
                self.sys_continuous_voiced_ms = 0;
            }
        }
    }

    fn on_mic_block(&mut self, voiced: bool) {
        let block = BLOCK_MS as u64;
        self.session_ms += block;
        self.stats.session_ms.store(self.session_ms, Ordering::Relaxed);
        self.release_stalled_sys_latch();

        if voiced {
            self.stats.user_voiced_ms.fetch_add(block, Ordering::Relaxed);
            self.user_silence_ms = 0;
            if !self.run_active && !self.interlocutor_holds_floor() {
                self.run_active = true;
                self.run_start_ms = self.session_ms - block;
                self.stats.user_mono_runs.fetch_add(1, Ordering::Relaxed);
            }
            if self.run_active {
                // La racha mide desde su apertura hasta el último bloque con
                // voz: las pausas cortas (< USER_PAUSE_END_MS) quedan dentro,
                // el silencio terminal no.
                let current = self.session_ms - self.run_start_ms;
                self.stats.current_user_mono_ms.store(current, Ordering::Relaxed);
                self.stats.longest_user_mono_ms.fetch_max(current, Ordering::Relaxed);
            }
        } else {
            self.user_silence_ms = self.user_silence_ms.saturating_add(BLOCK_MS);
            if self.run_active && self.user_silence_ms >= USER_PAUSE_END_MS {
                self.close_run();
            }
        }
    }

    fn on_sys_block(&mut self, voiced: bool) {
        // Con o sin voz: lo que importa para el estancamiento es que el canal
        // sigue entregando.
        self.last_sys_block_at_ms = Some(self.session_ms);
        if voiced {
            self.stats
                .interlocutor_voiced_ms
                .fetch_add(BLOCK_MS as u64, Ordering::Relaxed);
            self.sys_continuous_voiced_ms = self.sys_continuous_voiced_ms.saturating_add(BLOCK_MS);
            if self.interlocutor_holds_floor() {
                // "Intervención" de la audiencia = tiene la palabra (≥ INTERRUPT_MS),
                // el mismo evento que rompe la racha; un `store` Relaxed por bloque.
                self.stats
                    .last_interlocutor_voice_ms
                    .store(self.session_ms, Ordering::Relaxed);
            }
            if self.run_active && self.interlocutor_holds_floor() {
                self.close_run();
            }
        } else {
            self.sys_continuous_voiced_ms = 0;
        }
    }

    fn close_run(&mut self) {
        self.run_active = false;
        self.stats.current_user_mono_ms.store(0, Ordering::Relaxed);
    }
}

// ────────────────────────────────────────────────────────────────────────────
// Tracker (lo que posee el pipeline)
// ────────────────────────────────────────────────────────────────────────────

/// Rastreador de voz de la grabación en curso. Lo construye `AudioPipeline`
/// solo en modo LOTE y lo alimenta desde `run()`; publica en el
/// `VoiceActivityStats` de `RecordingState`.
pub struct VoiceActivityTracker {
    mic: ChannelGate,
    sys: ChannelGate,
    machine: MonologueMachine,
}

impl VoiceActivityTracker {
    /// `system_gain`: el `system_audio_gain` del pipeline (la R del stereo es
    /// sistema × gain; el RMS del canal sistema se escala igual para
    /// conservar los umbrales validados en F1).
    pub fn new(sample_rate: u32, system_gain: f32, stats: Arc<VoiceActivityStats>) -> Self {
        Self {
            mic: ChannelGate::new("microphone", sample_rate, 1.0),
            sys: ChannelGate::new("system", sample_rate, system_gain.clamp(0.5, 3.0)),
            machine: MonologueMachine::new(stats),
        }
    }

    /// Espejo de `AudioPipeline::set_system_audio_gain` (mismo clamp).
    pub fn set_system_gain(&mut self, gain: f32) {
        self.sys.gain = gain.clamp(0.5, 3.0);
    }

    /// Alimenta un chunk mono de un canal. `Mixed` se ignora (es la salida
    /// stereo del propio pipeline, no una fuente).
    pub fn push(&mut self, device: &DeviceType, samples: &[f32]) {
        let Self { mic, sys, machine } = self;
        match device {
            DeviceType::Microphone => mic.feed(samples, |voiced| machine.on_mic_block(voiced)),
            DeviceType::System => sys.feed(samples, |voiced| machine.on_sys_block(voiced)),
            DeviceType::Mixed => {}
        }
    }
}

// ────────────────────────────────────────────────────────────────────────────
// Tests sintéticos (48 kHz; seno 440 Hz o ceros; pushes intercalados de 100 ms)
// ────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    const SR: u32 = 48_000;
    const BLOCK: usize = 4_800;

    fn tone_hz(ms: u32, amp: f32, hz: f32) -> Vec<f32> {
        let n = (SR as u64 * ms as u64 / 1000) as usize;
        (0..n)
            .map(|i| amp * (2.0 * std::f32::consts::PI * hz * i as f32 / SR as f32).sin())
            .collect()
    }

    fn tone(ms: u32, amp: f32) -> Vec<f32> {
        tone_hz(ms, amp, 440.0)
    }

    /// Suma muestra a muestra (mezcla de dos fuentes de la misma duración).
    fn mix(a: &[f32], b: &[f32]) -> Vec<f32> {
        assert_eq!(a.len(), b.len());
        a.iter().zip(b).map(|(x, y)| x + y).collect()
    }

    fn silence(ms: u32) -> Vec<f32> {
        vec![0.0; (SR as u64 * ms as u64 / 1000) as usize]
    }

    fn concat(parts: &[Vec<f32>]) -> Vec<f32> {
        parts.iter().flat_map(|p| p.iter().copied()).collect()
    }

    fn tracker(system_gain: f32) -> (VoiceActivityTracker, Arc<VoiceActivityStats>) {
        let stats = VoiceActivityStats::new();
        (VoiceActivityTracker::new(SR, system_gain, Arc::clone(&stats)), stats)
    }

    /// Pushes intercalados de 100 ms: por cada bloque, primero mic y luego
    /// sistema — el mismo orden de llegada que en el pipeline real.
    fn drive(t: &mut VoiceActivityTracker, mic: &[f32], sys: &[f32]) {
        assert_eq!(mic.len(), sys.len(), "los dos canales deben durar lo mismo en el test");
        for (m, s) in mic.chunks(BLOCK).zip(sys.chunks(BLOCK)) {
            t.push(&DeviceType::Microphone, m);
            t.push(&DeviceType::System, s);
        }
    }

    #[test]
    fn bloque_de_100ms_por_sample_rate() {
        assert_eq!(ChannelGate::new("microphone", 48_000, 1.0).block_len, 4_800);
        assert_eq!(ChannelGate::new("microphone", 16_000, 1.0).block_len, 1_600);
    }

    #[test]
    fn silencio_no_cuenta_voz() {
        let (mut t, stats) = tracker(1.5);
        drive(&mut t, &silence(2_000), &silence(2_000));
        let s = stats.snapshot();
        assert_eq!(s.user_voiced_ms, 0);
        assert_eq!(s.interlocutor_voiced_ms, 0);
        assert_eq!(s.current_user_mono_ms, 0);
        assert_eq!(s.longest_user_mono_ms, 0);
        assert_eq!(s.user_mono_runs, 0);
        assert_eq!(s.session_ms, 2_000, "el reloj de sesión es el del mic, con o sin voz");
        assert!(!s.any_voiced());
        assert_eq!(s.user_talk_ratio(), 0.5);
        assert_eq!(s.last_interlocutor_voice_ms, 0);
        assert_eq!(s.interlocutor_silence_ms(), 2_000, "sin intervención, el silencio es toda la sesión");
    }

    #[test]
    fn tono_de_1s_cuenta_1500ms_con_hangover() {
        let (mut t, stats) = tracker(1.5);
        let mic = concat(&[tone(1_000, 0.1), silence(2_000)]);
        drive(&mut t, &mic, &silence(3_000));
        let s = stats.snapshot();
        assert_eq!(s.user_voiced_ms, 1_500, "1 s de voz + 5 bloques de hangover");
        assert_eq!(s.user_mono_runs, 1);
        assert_eq!(s.longest_user_mono_ms, 1_500);
        assert!(s.any_voiced());
    }

    #[test]
    fn chunks_de_777_muestras_equivalen_a_un_push() {
        let audio = concat(&[tone(2_000, 0.1), silence(1_000)]);

        let (mut a, stats_a) = tracker(1.5);
        a.push(&DeviceType::Microphone, &audio);

        let (mut b, stats_b) = tracker(1.5);
        for chunk in audio.chunks(777) {
            b.push(&DeviceType::Microphone, chunk);
        }

        assert_eq!(stats_a.snapshot(), stats_b.snapshot());
        assert_eq!(stats_a.snapshot().user_voiced_ms, 2_500);
    }

    #[test]
    fn interlocutor_de_2s_rompe_la_racha() {
        let (mut t, stats) = tracker(1.5);
        let mic = tone(6_000, 0.1);
        let sys = concat(&[silence(1_000), tone(2_000, 0.1), silence(3_000)]);
        drive(&mut t, &mic, &sys);
        let s = stats.snapshot();
        assert_eq!(s.user_mono_runs, 2, "la voz continua del interlocutor cierra la racha y el usuario abre otra");
        assert_eq!(s.interlocutor_voiced_ms, 2_500);
        assert_eq!(s.user_voiced_ms, 6_000);
        assert!(s.current_user_mono_ms > 0, "la segunda racha sigue abierta");
        assert!(s.longest_user_mono_ms >= 2_500, "la primera racha duró hasta la interrupción");
        // La audiencia tuvo la palabra hasta el último bloque con voz (hangover
        // incluido): 1000 + 2000 + 500 = 3500 en el reloj del mic.
        assert_eq!(s.last_interlocutor_voice_ms, 3_500);
        assert_eq!(s.interlocutor_silence_ms(), 2_500);
    }

    #[test]
    fn tos_de_300ms_no_rompe_la_racha() {
        let (mut t, stats) = tracker(1.5);
        let mic = tone(4_000, 0.1);
        let sys = concat(&[silence(1_000), tone(300, 0.1), silence(2_700)]);
        drive(&mut t, &mic, &sys);
        let s = stats.snapshot();
        assert_eq!(s.user_mono_runs, 1, "300 ms + 500 de hangover = 800 < INTERRUPT_MS");
        assert_eq!(s.current_user_mono_ms, 4_000);
        assert_eq!(s.interlocutor_voiced_ms, 800);
        assert_eq!(s.last_interlocutor_voice_ms, 0, "una tos no es una intervención");
        assert_eq!(s.interlocutor_silence_ms(), 4_000);
    }

    #[test]
    fn pausa_de_3_5s_cierra_la_racha() {
        let (mut t, stats) = tracker(1.5);
        let mic = concat(&[tone(2_000, 0.1), silence(3_500)]);
        drive(&mut t, &mic, &silence(5_500));
        let s = stats.snapshot();
        assert_eq!(s.user_mono_runs, 1);
        assert_eq!(s.current_user_mono_ms, 0, "3 s de silencio propio cierran la racha");
        assert_eq!(s.longest_user_mono_ms, 2_500, "la racha mide hasta el último bloque con voz (hangover incluido)");

        // El usuario retoma: nueva racha.
        drive(&mut t, &tone(1_000, 0.1), &silence(1_000));
        let s = stats.snapshot();
        assert_eq!(s.user_mono_runs, 2);
        assert_eq!(s.current_user_mono_ms, 1_000);
    }

    #[test]
    fn pausa_de_3_0s_exactos_no_cierra_la_racha() {
        // Frontera de `USER_PAUSE_END_MS`: el hangover (500 ms) cuenta como voz,
        // así que 3.0 s de silencio real son solo 2.5 s de bloques sin voz.
        let (mut t, stats) = tracker(1.5);
        let mic = concat(&[tone(2_000, 0.1), silence(3_000)]);
        drive(&mut t, &mic, &silence(5_000));
        let s = stats.snapshot();
        assert_eq!(s.user_mono_runs, 1);
        assert_eq!(s.current_user_mono_ms, 2_500, "3.0 s exactos: la racha sigue abierta (silencio efectivo = 3000 + 500)");

        // 500 ms más de silencio (3.5 s reales) sí la cierran.
        drive(&mut t, &silence(500), &silence(500));
        let s = stats.snapshot();
        assert_eq!(s.user_mono_runs, 1);
        assert_eq!(s.current_user_mono_ms, 0, "3.5 s reales cierran la racha");
        assert_eq!(s.longest_user_mono_ms, 2_500);
    }

    #[test]
    fn canal_sistema_estancado_suelta_el_latch_del_interlocutor() {
        // 2 s de interlocutor con el mic callado: el interlocutor "tiene la
        // palabra" (2000 + 500 de hangover ≥ INTERRUPT_MS).
        let (mut t, stats) = tracker(1.5);
        drive(&mut t, &silence(2_000), &tone(2_000, 0.1));
        assert_eq!(stats.snapshot().interlocutor_voiced_ms, 2_000);
        assert_eq!(stats.snapshot().user_mono_runs, 0);

        // Desde aquí SOLO llegan bloques de mic con voz (el canal sistema se
        // perdió: dispositivo desconectado / hot-swap). Sin el reset por
        // estancamiento el latch quedaba armado toda la sesión y ninguna racha
        // volvía a abrirse.
        for chunk in tone(3_000, 0.1).chunks(BLOCK) {
            t.push(&DeviceType::Microphone, chunk);
        }
        let s = stats.snapshot();
        assert_eq!(s.user_voiced_ms, 3_000);
        assert_eq!(s.user_mono_runs, 1, "el estancamiento del sistema libera el latch y la racha abre");
        // Latch soltado en el bloque 11 (gap > SYS_STALL_MS = 1000 ms) → la racha
        // abre en el segundo 3.0 del reloj de mic y mide 2.0 s al final.
        assert_eq!(s.current_user_mono_ms, 2_000);
        assert!(s.longest_user_mono_ms >= 1_500);
    }

    #[test]
    fn ruido_estable_no_cuenta_como_voz() {
        // Ruido de fondo estable por encima del piso absoluto (amp 0.017 →
        // RMS ≈ 0.012 > 0.006) durante 60 s. Con la ley vieja (piso solo de
        // bloques sin voz, inicio en 0) TODO bloque salía voiced para siempre.
        let noise = tone_hz(60_000, 0.017, 1_000.0);
        let (mut t, stats) = tracker(1.5);
        drive(&mut t, &noise, &silence(60_000));
        let s = stats.snapshot();
        assert!(
            s.user_voiced_ms <= 2_000,
            "el piso aprende el ruido: como mucho un transitorio inicial (got {} ms)",
            s.user_voiced_ms
        );
        assert_eq!(s.current_user_mono_ms, 0, "sin racha de monólogo falsa");
        assert_eq!(s.session_ms, 60_000);
    }

    #[test]
    fn la_voz_sigue_por_encima_del_ruido_aprendido() {
        // 20 s de ruido estable y después 2 s de voz (amp 0.1) mezclada con el
        // mismo ruido: el piso quedó en ≈0.012 (umbral ≈0.036) y la voz
        // (RMS ≈ 0.07) sigue siendo voz.
        let noise = tone_hz(22_000, 0.017, 1_000.0);
        let voice = concat(&[silence(20_000), tone(2_000, 0.1)]);
        let (mut t, stats) = tracker(1.5);
        drive(&mut t, &mix(&noise, &voice), &silence(22_000));
        let s = stats.snapshot();
        assert!(s.user_voiced_ms >= 2_000, "got {} ms", s.user_voiced_ms);
        assert!(s.user_voiced_ms <= 2_000 + 500 + 2_000, "sin contar el ruido como voz (got {} ms)", s.user_voiced_ms);
        assert_eq!(s.user_mono_runs, 1);
    }

    #[test]
    fn pausa_corta_no_cierra_la_racha() {
        let (mut t, stats) = tracker(1.5);
        // 2 s voz, 2 s pausa (< 3 s tras el hangover), 1 s voz: una sola racha de 5 s.
        let mic = concat(&[tone(2_000, 0.1), silence(2_000), tone(1_000, 0.1)]);
        drive(&mut t, &mic, &silence(5_000));
        let s = stats.snapshot();
        assert_eq!(s.user_mono_runs, 1);
        assert_eq!(s.current_user_mono_ms, 5_000);
    }

    #[test]
    fn gain_del_sistema_afecta_el_umbral() {
        // amp 0.02 → RMS ≈ 0.014: por debajo del umbral inicial (piso 0.01 × 3 =
        // 0.03) con gain 1, por encima (0.042) con gain 3. (Con la ley del piso de
        // F1 un tono constante y débil nunca supera 3× su propio piso, así que la
        // amplitud del test tiene que cruzar el umbral INICIAL, no el absoluto.)
        let quiet = tone(2_000, 0.02);

        let (mut g1, stats1) = tracker(1.0);
        drive(&mut g1, &silence(2_000), &quiet);
        assert_eq!(stats1.snapshot().interlocutor_voiced_ms, 0, "gain 1: sin voz");

        let (mut g3, stats3) = tracker(3.0);
        drive(&mut g3, &silence(2_000), &quiet);
        assert!(stats3.snapshot().interlocutor_voiced_ms > 0, "gain 3: voz");

        // El cambio en caliente aplica al canal sistema (mismo clamp que el pipeline).
        let (mut hot, stats_hot) = tracker(1.0);
        hot.set_system_gain(3.0);
        drive(&mut hot, &silence(2_000), &quiet);
        assert!(stats_hot.snapshot().interlocutor_voiced_ms > 0);
    }

    #[test]
    fn el_mic_no_lleva_ganancia() {
        let (mut t, stats) = tracker(3.0);
        drive(&mut t, &tone(2_000, 0.02), &silence(2_000));
        assert_eq!(stats.snapshot().user_voiced_ms, 0, "la ganancia es solo del sistema");
    }

    #[test]
    fn ratio_0_5_sin_voz_y_proporcional_con_voz() {
        let sin_voz = VoiceActivitySnapshot::default();
        assert_eq!(sin_voz.user_talk_ratio(), 0.5);
        assert!(!sin_voz.any_voiced());

        let con_voz = VoiceActivitySnapshot {
            user_voiced_ms: 3_000,
            interlocutor_voiced_ms: 1_000,
            ..Default::default()
        };
        assert!((con_voz.user_talk_ratio() - 0.75).abs() < 1e-6);
        assert!(con_voz.any_voiced());
    }

    #[test]
    fn interlocutor_silence_ms_es_toda_la_sesion_sin_intervencion() {
        // Voz del sistema que nunca llegó a INTERRUPT_MS: cuenta como voz pero
        // no como intervención, así que el silencio es toda la sesión.
        let s = VoiceActivitySnapshot {
            interlocutor_voiced_ms: 800,
            last_interlocutor_voice_ms: 0,
            session_ms: 4_000,
            ..Default::default()
        };
        assert_eq!(s.interlocutor_silence_ms(), 4_000);
        let con = VoiceActivitySnapshot { last_interlocutor_voice_ms: 3_500, ..s };
        assert_eq!(con.interlocutor_silence_ms(), 500);
    }

    #[test]
    fn mixed_se_ignora() {
        let (mut t, stats) = tracker(1.5);
        t.push(&DeviceType::Mixed, &tone(2_000, 0.5));
        assert_eq!(stats.snapshot(), VoiceActivitySnapshot::default());
    }
}
