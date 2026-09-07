// ============================================================================
// COPIA VENDORIZADA — NO ES EL UPSTREAM TAL CUAL.
//
// Origen: https://github.com/emotechlab/silero-rs
// Rev:    1283485dfd4ce6fda25248d52f6f68e27418d46c (main, 2026-07-23,
//         "Fixes some stuff in trim_start_silence (#82)")
// Motivo: hallazgo #01 de docs/AUDITORIA_RECURSOS_2026-09-02.md — el buffer
//         `session_audio` crecía sin tope en silencio y en habla continua.
//
// Parches locales respecto al upstream (candidatos a PR):
//
//  P1. `process_internal`, brazo `SpeechEnd`: el segmento arranca en
//      `max(state.start_ms, speech_start_ms)` en vez de `state.start_ms`.
//      `take_until()` mueve `speech_start_ms` pero NO el `start_ms` del enum
//      `VadState::Speech`; en upstream el siguiente `SpeechEnd` hacía
//      `get_speech(start_ms_viejo)` sobre audio ya borrado → panic en
//      `unchecked_duration_to_index`. `speech_end_ms` y el fin con padding se
//      clampan a ese arranque (un `take_until` dentro de la redemption produce
//      un `SpeechEnd` con `samples` vacío, no un panic) y el drain usa
//      `duration_to_index` acotado al buffer. Además `take_until` conserva
//      `speech_start_ms` cuando ya está después de la frontera (upstream hacía
//      `.take()` y sólo lo restauraba si estaba antes → quedaba en `None`), y
//      clampa la frontera a `processed_duration()`: borrar audio aún no visto
//      por el modelo dejaba `deleted > processed` y el siguiente `process()`
//      hacía underflow.
//  P2. `trim_start_silence`, brazo `Speech`: recorta hasta
//      `max(start_ms, speech_start_ms)` por la misma razón.
//  P3. Modelo en `<crate>/silero_vad.onnx` en vez de `<crate>/models/`: el
//      `.gitignore` del repo ignora `**/models/*.onnx`.
//
// Recortes (sin cambio de comportamiento para Maity):
//  - Sin feature `audio_resampler` (Maity siempre alimenta 16 kHz).
//  - Sin los tests que leen `tests/audio/*.wav` (punteros git-LFS) ni
//    `#[traced_test]`; se conservan los sintéticos y se añaden los de P1/P2.
// ============================================================================
#![doc = include_str!("../README.md")]
pub use crate::errors::VadError;
use anyhow::{bail, Context, Result};
use ndarray::{Array1, Array2, Array3, ArrayBase, Ix1, Ix3, OwnedRepr};
use ort::session::{builder::GraphOptimizationLevel, Session};
use ort::value::TensorRef;
use std::fmt;
use std::ops::Range;
use std::path::Path;
use std::time::Duration;
use tracing::trace;

pub mod errors;

/// Parameters used to configure a vad session. These will determine the sensitivity and switching
/// speed of detection.
#[derive(Clone, Copy, Debug, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct VadConfig {
    pub positive_speech_threshold: f32,
    pub negative_speech_threshold: f32,
    pub pre_speech_pad: Duration,
    pub post_speech_pad: Duration,
    pub redemption_time: Duration,
    pub sample_rate: usize,
    pub min_speech_time: Duration,
}

/// A VAD session create one of these for each audio stream you want to detect voice activity on
/// and feed the audio into it.
pub struct VadSession {
    config: VadConfig,
    model: Session, // TODO: would this be safe to share? does the runtime graph hold any state?
    h_tensor: ArrayBase<OwnedRepr<f32>, Ix3>,
    c_tensor: ArrayBase<OwnedRepr<f32>, Ix3>,
    sample_rate_tensor: ArrayBase<OwnedRepr<i64>, Ix1>,
    state: VadState,
    session_audio: Vec<f32>,
    processed_samples: usize,
    deleted_samples: usize,
    silent_samples: usize,

    /// Current start of the speech in milliseconds
    speech_start_ms: Option<usize>,

    /// Cached current active samples
    cached_active_speech: Vec<f32>,
}

impl fmt::Debug for VadSession {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("VadSession")
            .field("config", &self.config)
            .field("model", &self.model)
            .field("state", &self.state)
            .field("session_audio::len", &self.session_audio.len())
            .field(
                "cached_active_speech::len",
                &self.cached_active_speech.len(),
            )
            .field("processed_samples", &self.processed_samples)
            .field("deleted_samples", &self.deleted_samples)
            .field("silent_samples", &self.silent_samples)
            .field("speech_start_ms", &self.speech_start_ms)
            .finish()
    }
}

/// Current state of the VAD (speaking or silent)
#[derive(Clone, Debug)]
enum VadState {
    Speech {
        start_ms: usize,
        redemption_passed: bool,
        speech_time: Duration,
    },
    Silence,
}

#[derive(Clone, Debug)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub enum VadTransition {
    SpeechStart {
        /// When the speech started, in milliseconds since the start of the VAD session.
        timestamp_ms: usize,
    },
    SpeechEnd {
        /// When the speech started, in milliseconds since the start of the VAD session.
        start_timestamp_ms: usize,
        /// When the speech ended, in milliseconds since the start of the VAD session.
        end_timestamp_ms: usize,
        /// The active speech samples. This field is skipped in serde output even serde feature is enabled.
        #[cfg_attr(feature = "serde", serde(default, skip))]
        samples: Vec<f32>,
    },
}

impl PartialEq for VadTransition {
    fn eq(&self, other: &Self) -> bool {
        match (self, other) {
            (
                VadTransition::SpeechStart { timestamp_ms: ts1 },
                VadTransition::SpeechStart { timestamp_ms: ts2 },
            ) => ts1 == ts2,
            (
                VadTransition::SpeechEnd {
                    start_timestamp_ms: ts1,
                    end_timestamp_ms: ts2,
                    ..
                },
                VadTransition::SpeechEnd {
                    start_timestamp_ms: ts3,
                    end_timestamp_ms: ts4,
                    ..
                },
            ) => ts1 == ts3 && ts2 == ts4,
            _ => false,
        }
    }
}

impl Eq for VadTransition {}

impl VadSession {
    /// Create a new VAD session loading an onnx file from the specified path and using the
    /// provided config.
    pub fn new_from_path(file: impl AsRef<Path>, config: VadConfig) -> Result<Self> {
        let bytes = std::fs::read(file.as_ref())
            .with_context(|| format!("Couldn't read onnx file: {}", file.as_ref().display()))?;
        Self::new_from_bytes(&bytes, config)
    }

    /// Create a new VAD session loading an onnx file from memory and using the provided config.
    pub fn new_from_bytes(model_bytes: &[u8], config: VadConfig) -> Result<Self> {
        if ![8000_usize, 16000].contains(&config.sample_rate) {
            bail!("Unsupported sample rate, use 8000 or 16000!");
        }
        let model = Session::builder()?
            .with_optimization_level(GraphOptimizationLevel::Level3)?
            .with_intra_threads(1)?
            .commit_from_memory(model_bytes)?;
        let h_tensor = Array3::<f32>::zeros((2, 1, 64));
        let c_tensor = Array3::<f32>::zeros((2, 1, 64));
        let sample_rate_tensor = Array1::from_vec(vec![config.sample_rate as i64]);

        Ok(Self {
            config,
            model,
            h_tensor,
            c_tensor,
            sample_rate_tensor,
            state: VadState::Silence,
            session_audio: vec![],
            processed_samples: 0,
            deleted_samples: 0,
            silent_samples: 0,
            speech_start_ms: None,
            cached_active_speech: vec![],
        })
    }

    /// Create a new VAD session using the provided config. The ONNX file has been statically
    /// embedded within the library so this will increase binary size by 1.7M.
    ///
    /// P3: el modelo vive en la raíz del crate (ver cabecera).
    #[cfg(feature = "static-model")]
    pub fn new(config: VadConfig) -> Result<Self> {
        let model_bytes: &[u8] = include_bytes!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/silero_vad.onnx"
        ));
        Self::new_from_bytes(model_bytes, config)
    }

    /// Reserve the session audio buffer size by number of samples
    pub fn reserve_audio_buffer(&mut self, samples: usize) {
        self.session_audio.reserve(samples);
    }

    pub fn validate_input(&self, audio_frame: &[f32]) -> Result<()> {
        if audio_frame
            .iter()
            .all(|&sample| -1.0 <= sample && sample <= 1.0)
        {
            Ok(())
        } else {
            Err(VadError::InvalidData.into())
        }
    }

    /// Pass in some audio to the VAD and return a list of any speech transitions that happened
    /// during the segment. User input is expected to be either 8000 or 16000Hz.
    pub fn process(&mut self, audio_frame: &[f32]) -> Result<Vec<VadTransition>> {
        #[cfg(debug_assertions)]
        if let Err(e) = self.validate_input(audio_frame) {
            return Err(e);
        }

        const VAD_BUFFER: Duration = Duration::from_millis(30); // TODO This should be configurable
        let vad_segment_length = VAD_BUFFER.as_millis() as usize * self.config.sample_rate / 1000;

        let unprocessed = self.deleted_samples + self.session_audio.len() - self.processed_samples;
        let num_chunks = (unprocessed + audio_frame.len()) / vad_segment_length;

        self.session_audio.extend_from_slice(audio_frame);

        let mut transitions = vec![];

        for _ in 0..num_chunks {
            // We have removed non-determinism by only keeping to 30ms frames, but this means any
            // remainder at the end of the audio file will never be processed. This is fine because
            // we don't expect to get useful speech in <30ms and if it's at the end and it's
            // speaking we don't lose anything by keeping an extra silence <30ms at the end.
            //
            // So in summary, the remainder will be processed on the next call to process, but if
            // there's no more calls to process it will be left untouched.
            let sample_range = (self.processed_samples - self.deleted_samples)
                ..(self.processed_samples + vad_segment_length - self.deleted_samples);
            let vad_result = self.process_internal(sample_range)?;

            if let Some(vad_ev) = vad_result {
                transitions.push(vad_ev);
            }
        }
        Ok(transitions)
    }

    pub fn forward(&mut self, input: Vec<f32>) -> Result<ort::value::Value> {
        let samples = input.len();
        let audio_tensor = Array2::from_shape_vec((1, samples), input)?;
        let mut result = self.model.run(ort::inputs![
            TensorRef::from_array_view(audio_tensor.view())?,
            TensorRef::from_array_view(self.sample_rate_tensor.view())?,
            TensorRef::from_array_view(self.h_tensor.view())?,
            TensorRef::from_array_view(self.c_tensor.view())?
        ])?;

        // Update internal state tensors.
        self.h_tensor = result
            .get("hn")
            .unwrap()
            .try_extract_array::<f32>()?
            .to_owned()
            .into_shape_with_order((2, 1, 64))
            .context("Shape mismatch for h_tensor")?;

        self.c_tensor = result
            .get("cn")
            .unwrap()
            .try_extract_array::<f32>()?
            .to_owned()
            .into_shape_with_order((2, 1, 64))
            .context("Shape mismatch for h_tensor")?;

        let prob_tensor = result.remove("output").unwrap();
        Ok(prob_tensor)
    }

    /// Advance the VAD state machine with an audio frame. Keep between 30-96ms in length.
    /// Return indicates if a transition from speech to silence (or silence to speech) occurred.
    ///
    /// Important: don't implement your own endpointing logic.
    /// Instead, when a `SpeechEnd` is returned, you can use the `get_current_speech()` method to retrieve the audio.
    fn process_internal(&mut self, range: Range<usize>) -> Result<Option<VadTransition>> {
        let audio_frame = self.session_audio[range].to_vec();
        let samples = audio_frame.len();
        let frame_duration = self.samples_to_duration(samples);

        let result = self.forward(audio_frame)?;

        let prob = *result.try_extract_array::<f32>().unwrap().first().unwrap();

        let mut vad_change = None;

        if prob < self.config.negative_speech_threshold {
            self.silent_samples += samples;
        } else {
            self.silent_samples = 0;
        }

        trace!(
            vad_likelihood = prob,
            samples,
            silent_samples = self.silent_samples,
            "performed silero inference"
        );

        let current_silence = self.current_silence_duration();

        match self.state {
            VadState::Silence => {
                let start_ms = self
                    .processed_duration()
                    .saturating_sub(self.config.pre_speech_pad)
                    .as_millis() as usize;
                let deleted_end =
                    self.samples_to_duration(self.deleted_samples).as_millis() as usize;
                let start_ms = start_ms.max(deleted_end);
                if prob > self.config.positive_speech_threshold {
                    self.state = VadState::Speech {
                        start_ms,
                        redemption_passed: false,
                        speech_time: Duration::ZERO,
                    };
                }
            }
            VadState::Speech {
                start_ms,
                ref mut redemption_passed,
                ref mut speech_time,
            } => {
                *speech_time += frame_duration;
                if !*redemption_passed && *speech_time > self.config.min_speech_time {
                    *redemption_passed = true;
                    // TODO: the pre speech padding should not cross over the previous speech->silence
                    // transition, if there was one
                    vad_change = Some(VadTransition::SpeechStart {
                        timestamp_ms: start_ms,
                    });
                    self.speech_start_ms = Some(start_ms);
                }

                if prob < self.config.negative_speech_threshold {
                    if !*redemption_passed {
                        self.state = VadState::Silence;
                    } else if current_silence > self.config.redemption_time {
                        if *redemption_passed {
                            // P1: `take_until()` mueve `speech_start_ms` hacia adelante pero el
                            // `start_ms` del enum no cambia; el segmento que se entrega (y lo
                            // que se lee del buffer) arranca en el mayor de los dos. Todo lo
                            // derivado del fin se clampa a ese arranque para que un corte
                            // dentro de la redemption no indexe audio ya borrado.
                            let seg_start_ms =
                                self.speech_start_ms.map_or(start_ms, |s| s.max(start_ms));

                            let speech_end_ms = ((self.processed_samples + samples
                                - self.silent_samples)
                                / (self.config.sample_rate / 1000))
                                .max(seg_start_ms);

                            // Since speech_end_ms does not include silent_samples, the post
                            // padding should be added to speech_end_ms.
                            let mut speech_end_with_pad_ms =
                                speech_end_ms + self.config.post_speech_pad.as_millis() as usize;

                            let end_time_ms = self.session_time().as_millis() as usize;

                            if end_time_ms < speech_end_with_pad_ms {
                                trace!("Padding exceeds speech buffer, truncating cached speech");
                                speech_end_with_pad_ms = end_time_ms;
                            }
                            let speech_end_with_pad_ms = speech_end_with_pad_ms.max(seg_start_ms);

                            self.cached_active_speech = self
                                .get_speech(seg_start_ms, Some(speech_end_with_pad_ms))
                                .to_vec();

                            vad_change = Some(VadTransition::SpeechEnd {
                                start_timestamp_ms: seg_start_ms,
                                end_timestamp_ms: speech_end_with_pad_ms,
                                samples: self.cached_active_speech.clone(),
                            });

                            // Need to delete the current speech samples from internal buffer to prevent OOM.
                            assert!(self.speech_start_ms.is_some());
                            let speech_end_idx = self
                                .duration_to_index(Duration::from_millis(speech_end_ms as u64))
                                .unwrap_or(0);
                            let to_delete = (speech_end_idx + 1).min(self.session_audio.len());
                            self.session_audio.drain(0..to_delete);
                            self.deleted_samples += to_delete;
                            self.speech_start_ms = None;
                        }
                        self.state = VadState::Silence
                    }
                }
            }
        };

        self.processed_samples += samples;

        Ok(vad_change)
    }

    /// Removes the starting silence from the session audio. If the vad is speaking this will
    /// remove all audio up-to the utterance start. If it is not speaking it will keep silence
    /// equal to the pre-speech padding frames at the end.
    ///
    /// P2: en habla, el arranque efectivo es `max(start_ms, speech_start_ms)` (ver P1).
    pub fn trim_start_silence(&mut self) {
        let remove_to = match self.state {
            VadState::Speech { start_ms, .. } => {
                Duration::from_millis(start_ms.max(self.speech_start_ms.unwrap_or(0)) as u64)
            }
            VadState::Silence => self
                .processed_duration()
                .saturating_sub(self.config.pre_speech_pad),
        };
        if let Some(last_index) = self.duration_to_index(remove_to) {
            let last_index = last_index.min(self.session_audio.len());
            self.session_audio.drain(..last_index);
            self.deleted_samples += last_index;
        }
    }

    /// This will remove audio in the buffer until a duration and panic if it exceeds the duration.
    /// This won't touch the active speech cache or the VAD state. It's intended usage is if the
    /// current speech buffer is too long and you want to remove some for processing and not have
    /// it be re-processed or considered again.
    ///
    /// If there is no remaining audio within the range this will return an empty vector.
    /// Additionally, if the speech is just in the cached last-segment it won't take from that
    /// (though this could be done in the future).
    ///
    /// P1: the boundary is clamped to `processed_duration()`. Audio past that point has not
    /// been seen by the model yet; deleting it would leave `deleted_samples > processed_samples`
    /// and the next `process()` call would underflow (upstream behaviour).
    ///
    /// # Panics
    ///
    /// If the time given is beyond the range of the current session this will panic.
    pub fn take_until(&mut self, end: Duration) -> Vec<f32> {
        if end > self.session_time() {
            panic!(
                "{}ms is greater than session time of {}ms",
                end.as_millis(),
                self.session_time().as_millis()
            );
        } else {
            let end = end.min(self.processed_duration());
            match self.duration_to_index(end) {
                Some(s) => {
                    let mut returned_audio = self.session_audio.split_off(s);
                    std::mem::swap(&mut self.session_audio, &mut returned_audio);
                    self.deleted_samples += returned_audio.len();
                    if matches!(self.state, VadState::Speech { .. }) {
                        if let Some(start_ms) = self.speech_start_ms.take() {
                            if start_ms < end.as_millis() as usize {
                                self.speech_start_ms = Some(end.as_millis() as usize);
                            } else {
                                self.speech_start_ms = Some(start_ms);
                            }
                        }
                    }
                    returned_audio
                }
                None => vec![],
            }
        }
    }

    /// Returns whether the vad current believes the audio to contain speech
    pub fn is_speaking(&self) -> bool {
        matches!(self.state, VadState::Speech {
            redemption_passed, ..
        } if redemption_passed)
    }

    /// Takes a duration and converts it to an index if it's within the current session audio or
    /// `None` if it's not.
    ///
    /// # Panics
    ///
    /// If this is out of the range it will panic
    fn unchecked_duration_to_index(&self, duration: Duration) -> usize {
        match self.duration_to_index(duration) {
            Some(idx) => idx,
            None => panic!(
                "Duration {}ms is outside of session audio range",
                duration.as_millis()
            ),
        }
    }

    /// Takes a duration and converts it to an index if it's within the current session audio or
    /// `None` if it's not.
    fn duration_to_index(&self, duration: Duration) -> Option<usize> {
        let unadjusted_index = duration.as_millis() as usize * (self.config.sample_rate / 1000);
        if unadjusted_index < self.deleted_samples {
            None
        } else {
            Some(unadjusted_index - self.deleted_samples)
        }
    }

    /// Gets the speech within a given range of milliseconds. You can use previous speech start/end
    /// event pairs to get speech windows before the current speech using this API. If end is
    /// `None` this will return from the start point to the end of the buffer.
    ///
    /// # Panics
    ///
    /// If the range is out of bounds of the speech buffer this method will panic due to an
    /// assertion failure.
    pub fn get_speech(&self, start_ms: usize, end_ms: Option<usize>) -> &[f32] {
        let speech_start_idx =
            self.unchecked_duration_to_index(Duration::from_millis(start_ms as u64));
        if let Some(speech_end) = end_ms {
            let speech_end_idx =
                self.unchecked_duration_to_index(Duration::from_millis(speech_end as u64));
            &self.session_audio[speech_start_idx..speech_end_idx]
        } else {
            &self.session_audio[speech_start_idx..]
        }
    }

    /// Gets a buffer of the most recent active speech frames from the time the speech started to the
    /// end of the speech. Parameters from `VadConfig` have already been applied here so this isn't
    /// derived from the raw VAD inferences but instead after padding and filtering operations have
    /// been applied.
    pub fn get_current_speech(&self) -> &[f32] {
        if let Some(speech_start) = self.speech_start_ms {
            if self
                .duration_to_index(Duration::from_millis(speech_start as u64))
                .is_some()
            {
                self.get_speech(speech_start, None)
            } else {
                &self.cached_active_speech
            }
        } else {
            &self.cached_active_speech
        }
    }

    /// Get how long the current speech is in samples.
    pub fn current_speech_samples(&self) -> usize {
        self.get_current_speech().len()
    }

    /// Returns the duration of the current speech segment. It is possible for this and
    /// `Self::current_silence_duration` to both report >0s at  the same time as this takes into
    /// account the switching and padding parameters of the VAD whereas the silence measure ignores
    /// them instead of just focusing on raw network output.
    pub fn current_speech_duration(&self) -> Duration {
        self.samples_to_duration(self.current_speech_samples())
    }

    /// Get the current duration of the VAD session, which includes both processed and unprocessed
    /// samples.
    pub fn session_time(&self) -> Duration {
        self.samples_to_duration(self.session_audio.len() + self.deleted_samples)
    }

    /// Get the current duration of processed samples. A sample is considered as processed if it has
    /// been seen by Silero neural network.
    pub fn processed_duration(&self) -> Duration {
        self.samples_to_duration(self.processed_samples)
    }

    /// Reset the status of the model
    // TODO should this reset the audio buffer as well?
    pub fn reset(&mut self) {
        self.h_tensor = Array3::<f32>::zeros((2, 1, 64));
        self.c_tensor = Array3::<f32>::zeros((2, 1, 64));
        self.speech_start_ms = None;
        self.silent_samples = 0;
        self.state = VadState::Silence;
    }

    /// Returns the length of the end silence in number of samples. The VAD may be showing this as
    /// speaking because of redemption frames or other parameters that slow down the speed it can
    /// switch at. But this measure is a raw unprocessed look of how many segments since the last
    /// speech are below the negative speech threshold.
    pub fn current_silence_samples(&self) -> usize {
        self.silent_samples
    }

    /// Returns the duration of the end silence. The VAD may be showing this as speaking because of
    /// redemption frames or other parameters that slow down the speed it can switch at. But this
    /// measure is a raw unprocessed look of how many segments since the last speech are below the
    /// negative speech threshold.
    pub fn current_silence_duration(&self) -> Duration {
        self.samples_to_duration(self.silent_samples)
    }

    /// Returns an inclusive range of the audio currently stored in the session buffer. The
    /// previously complete active speech segment may exceed these bounds!
    pub fn current_buffer_range(&self) -> (Duration, Duration) {
        (
            self.samples_to_duration(self.deleted_samples),
            self.session_time(),
        )
    }

    /// Returns a mutable reference to the VadConfig.
    /// Changes to this will take effect on the next inference, and won't modify past state
    pub fn config_mut(&mut self) -> &mut VadConfig {
        &mut self.config
    }

    #[inline(always)]
    fn samples_to_duration(&self, samples: usize) -> Duration {
        Duration::from_secs_f64(samples as f64 / self.config.sample_rate as f64)
    }

    /// Utility function to add a bit more tracking into the snapshot tests
    #[doc(hidden)]
    pub fn session_audio_samples(&self) -> usize {
        self.session_audio.len()
    }
}

impl Default for VadConfig {
    fn default() -> Self {
        Self {
            // https://github.com/ricky0123/vad/blob/ea584aaf66d9162fb19d9bfba607e264452980c3/packages/_common/src/frame-processor.ts#L52
            positive_speech_threshold: 0.5,
            negative_speech_threshold: 0.35,
            pre_speech_pad: Duration::from_millis(600),
            post_speech_pad: Duration::from_millis(0),
            redemption_time: Duration::from_millis(600),
            sample_rate: 16000,
            min_speech_time: Duration::from_millis(90),
        }
    }
}

impl VadConfig {
    pub fn new(
        positive_speech_threshold: f32,
        negative_speech_threshold: f32,
        pre_speech_pad: Duration,
        post_speech_pad: Duration,
        redemption_time: Duration,
        sample_rate: usize,
        min_speech_time: Duration,
    ) -> Result<Self> {
        let config = VadConfig {
            positive_speech_threshold,
            negative_speech_threshold,
            pre_speech_pad,
            post_speech_pad,
            redemption_time,
            sample_rate,
            min_speech_time,
        };
        match config.validate_config() {
            Ok(_) => Ok(config),
            Err(e) => Err(e),
        }
    }

    pub fn validate_config(&self) -> Result<()> {
        // Sin la feature `audio_resampler` sólo se aceptan 8 y 16 kHz.
        self.validate_config_internal(false)
    }

    fn validate_config_internal(&self, has_resampler: bool) -> Result<()> {
        if self.post_speech_pad > self.redemption_time {
            bail!("post speech pad cannot be longer than redemption time")
        }

        if has_resampler {
            Ok(())
        } else {
            if ![8000, 16000].contains(&self.sample_rate) {
                bail!(
                    "Invalid sample rate of {}, expected either 8000Hz or 16000Hz",
                    self.sample_rate
                );
            } else {
                Ok(())
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MODEL: &[u8] = include_bytes!(concat!(env!("CARGO_MANIFEST_DIR"), "/silero_vad.onnx"));

    /// Feed only silence into the network and ensure that `get_current_speech` returns an empty
    /// slice
    #[test]
    fn only_silence_get_speech() {
        let mut session = VadSession::new(VadConfig::default()).unwrap();
        let short_audio = vec![0.0; 1000];

        session.process(&short_audio).unwrap();

        assert!(session.get_current_speech().is_empty());
    }

    /// Basic smoke test that the model loads correctly and we haven't committed rubbish to the
    /// repo.
    #[test]
    fn model_loads() {
        let _session = VadSession::new(VadConfig::default()).unwrap();
        let _session = VadSession::new_from_bytes(MODEL, VadConfig::default()).unwrap();
    }

    /// Too short tensors result in inference errors which we don't want to unnecessarily bubble up
    /// to the user and instead handle in our buffering implementation. This test will check that a
    /// short inference in the internal inference call bubbles up an error but when using the
    /// public API no error is presented.
    #[test]
    fn short_audio_handling() {
        let mut session = VadSession::new(VadConfig::default()).unwrap();

        let short_audio = vec![0.0; 160];

        session.session_audio = short_audio.clone();
        assert!(session.process_internal(0..160).is_err());
        session.session_audio.clear();
        assert!(session.process(&short_audio).unwrap().is_empty());
    }

    /// Check that a long enough packet of just zeros gets an inference and it doesn't flag as
    /// transitioning to speech
    #[test]
    fn silence_handling() {
        let mut session = VadSession::new(VadConfig::default()).unwrap();
        let silence = vec![0.0; 30 * 16]; // 30ms of silence

        assert!(session.process(&silence).unwrap().is_empty());
        assert_eq!(session.processed_samples, silence.len());
    }

    /// We only allow for 8khz and 16khz audio.
    #[test]
    fn reject_invalid_sample_rate() {
        let mut config = VadConfig::default();
        config.sample_rate = 16000;
        VadSession::new(config.clone()).unwrap();
        config.sample_rate = 8000;
        VadSession::new(config.clone()).unwrap();

        config.sample_rate += 1;
        assert!(VadSession::new(config.clone()).is_err());
        assert!(VadSession::new_from_bytes(MODEL, config).is_err());
    }

    /// Just a sanity test of speech duration to make sure the calculation seems roughly right in
    /// terms of number of samples, sample rate and taking into account the speech starts/ends.
    #[test]
    fn simple_speech_duration() {
        let mut config = VadConfig::default();
        config.sample_rate = 8000;
        let mut session = VadSession::new(config.clone()).unwrap();
        session.session_audio.resize(16080, 0.0);

        assert_eq!(session.current_speech_duration(), Duration::from_secs(0));

        session.speech_start_ms = Some(10);
        assert_eq!(session.current_speech_duration(), Duration::from_secs(2));

        session.config.sample_rate = 16000;
        session.session_audio.resize(16160, 0.0);
        assert_eq!(session.current_speech_duration(), Duration::from_secs(1));
    }

    /// The provided audio sample must be in the range -1.0 to 1.0
    #[test]
    fn audio_sample_range() {
        let config = VadConfig::default();

        let mut session = VadSession::new(config.clone()).unwrap();
        let valid_samples = [0.0; 1000];
        let result = session.process(&valid_samples);
        assert!(result.is_ok());

        let mut session2 = VadSession::new(config).unwrap();
        let mut invalid_samples = valid_samples.clone();
        invalid_samples[0] = -1.01;
        let result = session2.process(&invalid_samples);
        assert!(matches!(
            result.unwrap_err().downcast::<VadError>().unwrap(),
            VadError::InvalidData
        ));
    }

    /// If we take past our boundary we panic!
    #[test]
    #[should_panic]
    fn excessive_take() {
        let config = VadConfig::default();
        let mut session = VadSession::new(config).unwrap();

        let silence = vec![0.0; 16000];
        let _ = session.process(&silence);

        session.take_until(Duration::from_millis(1001));
    }

    /// Repeatedly trimming a silent stream keeps the buffer bounded while retaining pre-speech
    /// padding and any audio that has not yet been processed.
    #[test]
    fn trim_start_silence_bounds_silent_buffer() {
        let config = VadConfig::default();
        let mut session = VadSession::new(config.clone()).unwrap();
        let silence = vec![0.0; 16000];

        for _ in 0..60 {
            session.process(&silence).unwrap();
            session.trim_start_silence();
        }

        let (start, end) = session.current_buffer_range();
        assert!(end - start >= config.pre_speech_pad);
        assert!(end - start < config.pre_speech_pad + Duration::from_millis(30));
        assert_eq!(
            silence.len() * 60,
            session.deleted_samples + session.session_audio.len()
        );
    }

    #[test]
    fn validate_config() {
        VadConfig::default().validate_config().unwrap();

        let mut config = VadConfig::default();
        config.sample_rate = 8000;

        config.validate_config_internal(true).unwrap();
        config.validate_config_internal(false).unwrap();

        config.sample_rate = 9000;
        config.validate_config_internal(true).unwrap();
        assert!(config.validate_config_internal(false).is_err());

        config.post_speech_pad = 2 * config.redemption_time;

        assert!(config.validate_config().is_err());
        assert!(config.validate_config_internal(false).is_err());
        assert!(config.validate_config_internal(true).is_err());
    }

    // ------------------------------------------------------------------
    // Tests de los parches locales (P1/P2). Sin audio real: se procesan
    // 2 s de ceros y se fuerza el estado "hablando desde 0 ms" a mano; los
    // ceros posteriores dan probabilidad baja y agotan la redemption.
    // ------------------------------------------------------------------

    /// Sesión con 2 s de ceros procesados y estado forzado a habla activa desde 0 ms.
    fn session_speaking_since_zero(config: VadConfig) -> VadSession {
        let mut session = VadSession::new(config).unwrap();
        let silence = vec![0.0; 16000];
        session.process(&silence).unwrap();
        session.process(&silence).unwrap();
        session.state = VadState::Speech {
            start_ms: 0,
            redemption_passed: true,
            speech_time: Duration::from_secs(2),
        };
        session.speech_start_ms = Some(0);
        session.silent_samples = 0;
        session
    }

    /// Alimenta chunks de 30 ms de ceros hasta que aparezca un `SpeechEnd` (o se agote el tope).
    fn feed_silence_until_speech_end(session: &mut VadSession, max_chunks: usize) -> VadTransition {
        let chunk = vec![0.0; 480];
        for _ in 0..max_chunks {
            for transition in session.process(&chunk).unwrap() {
                if matches!(transition, VadTransition::SpeechEnd { .. }) {
                    return transition;
                }
            }
        }
        panic!("no llegó SpeechEnd en {} chunks", max_chunks);
    }

    /// P1: `take_until` en plena habla y luego `SpeechEnd` natural. En upstream esto hace panic
    /// (`get_speech(start_ms_viejo)` sobre audio borrado). Aquí el segmento entregado empieza en
    /// la frontera del `take_until` y contiene exactamente la cola.
    #[test]
    fn take_until_mid_speech_then_speech_end_returns_only_the_tail() {
        let mut config = VadConfig::default();
        config.post_speech_pad = Duration::from_millis(100);
        let mut session = session_speaking_since_zero(config);

        let taken = session.take_until(Duration::from_millis(1500));
        assert_eq!(taken.len(), 1500 * 16);
        assert_eq!(session.speech_start_ms, Some(1500));
        assert_eq!(session.current_buffer_range().0, Duration::from_millis(1500));

        let end = feed_silence_until_speech_end(&mut session, 60);
        let VadTransition::SpeechEnd {
            start_timestamp_ms,
            end_timestamp_ms,
            samples,
        } = end
        else {
            unreachable!()
        };

        assert_eq!(start_timestamp_ms, 1500, "el segmento arranca en la frontera del take_until");
        assert!(end_timestamp_ms >= start_timestamp_ms);
        assert_eq!(
            samples.len(),
            (end_timestamp_ms - start_timestamp_ms) * 16,
            "samples cubren exactamente [start, end)"
        );
        // Tras el drain, el buffer no conserva la elocución.
        assert!(session.session_audio_samples() < 16000);
        assert_eq!(session.speech_start_ms, None);
    }

    /// P1: `take_until` más allá del fin real de la voz (corte dentro de la redemption). El
    /// `SpeechEnd` sale con `samples` vacío y `start == end == frontera`, sin panic.
    #[test]
    fn take_until_past_speech_end_yields_empty_segment_without_panic() {
        let mut session = session_speaking_since_zero(VadConfig::default());

        // Acumular silencio sin llegar a la redemption (600 ms): 10 chunks = 300 ms.
        let chunk = vec![0.0; 480];
        for _ in 0..10 {
            assert!(session.process(&chunk).unwrap().is_empty());
        }
        assert!(session.current_silence_duration() < session.config.redemption_time);

        // `process(&[f32; 16000])` deja un resto sin procesar (16000 no es múltiplo de 480), así
        // que session_time > processed_duration: el take se pide hasta el final de la sesión y
        // debe quedar clampeado a lo procesado (P1), no borrar audio que el modelo no ha visto.
        let take_at = session.session_time();
        assert!(take_at > session.processed_duration());
        let take_at_ms = session.processed_duration().as_millis() as usize;
        session.take_until(take_at);
        assert_eq!(session.speech_start_ms, Some(take_at_ms));
        assert_eq!(session.deleted_samples, session.processed_samples);

        let end = feed_silence_until_speech_end(&mut session, 60);
        let VadTransition::SpeechEnd {
            start_timestamp_ms,
            end_timestamp_ms,
            samples,
        } = end
        else {
            unreachable!()
        };

        assert_eq!(start_timestamp_ms, take_at_ms);
        assert_eq!(end_timestamp_ms, take_at_ms);
        assert!(samples.is_empty());
        assert_eq!(session.speech_start_ms, None);
    }

    /// P2: tras un `take_until` en habla, `trim_start_silence` no retrocede por debajo de la
    /// frontera movida (no reintroduce audio borrado ni hace panic).
    #[test]
    fn trim_start_silence_respects_take_until_boundary_while_speaking() {
        let mut session = session_speaking_since_zero(VadConfig::default());
        session.take_until(Duration::from_millis(1200));

        session.trim_start_silence();
        session.trim_start_silence();

        let (start, end) = session.current_buffer_range();
        assert_eq!(start, Duration::from_millis(1200));
        assert_eq!(end, Duration::from_secs(2));
        assert_eq!(session.session_audio_samples(), 800 * 16);
    }

    /// Sin `take_until`, `trim_start_silence` en habla recorta exactamente hasta `start_ms`.
    #[test]
    fn trim_start_silence_while_speaking_trims_to_speech_start() {
        let mut session = VadSession::new(VadConfig::default()).unwrap();
        let silence = vec![0.0; 16000];
        session.process(&silence).unwrap();
        session.process(&silence).unwrap();
        session.state = VadState::Speech {
            start_ms: 700,
            redemption_passed: false,
            speech_time: Duration::from_millis(60),
        };
        // Pre-redemption: `speech_start_ms` sigue en None y aun así el trim se detiene en 700 ms.
        session.trim_start_silence();
        assert_eq!(session.current_buffer_range().0, Duration::from_millis(700));
    }
}
