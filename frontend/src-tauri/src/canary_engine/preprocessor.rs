//! Log-mel spectrogram preprocessor for Canary.
//!
//! Canary does NOT have an ONNX preprocessor (unlike Parakeet's nemo128.onnx).
//! We compute the log-mel spectrogram in Rust using rustfft.
//!
//! Parameters (matching NeMo defaults for Canary):
//! - Sample rate: 16kHz
//! - FFT size (n_fft): 512
//! - Window length: 400 samples (25ms)
//! - Hop length: 160 samples (10ms)
//! - Mel bins: 128
//! - Mel frequency range: 0 - 8000 Hz

use ndarray::{Array2, Array3};
use rustfft::{FftPlanner, num_complex::Complex};

const SAMPLE_RATE: f32 = 16000.0;
const N_FFT: usize = 512;
const WIN_LENGTH: usize = 400;
const HOP_LENGTH: usize = 160;
const N_MELS: usize = 128;
const F_MIN: f32 = 0.0;
const F_MAX: f32 = 8000.0;

/// Convert frequency in Hz to mel scale
fn hz_to_mel(hz: f32) -> f32 {
    2595.0 * (1.0 + hz / 700.0).log10()
}

/// Convert mel scale to frequency in Hz
fn mel_to_hz(mel: f32) -> f32 {
    700.0 * (10.0_f32.powf(mel / 2595.0) - 1.0)
}

/// Create mel filterbank matrix [n_mels, n_fft/2 + 1]
fn create_mel_filterbank() -> Array2<f32> {
    let n_fft_bins = N_FFT / 2 + 1; // 257
    let mut filterbank = Array2::zeros((N_MELS, n_fft_bins));

    let mel_min = hz_to_mel(F_MIN);
    let mel_max = hz_to_mel(F_MAX);

    // Create n_mels + 2 equally spaced points in mel space
    let mel_points: Vec<f32> = (0..=(N_MELS + 1))
        .map(|i| mel_min + (mel_max - mel_min) * i as f32 / (N_MELS + 1) as f32)
        .collect();

    // Convert back to Hz and then to FFT bin indices
    let bin_points: Vec<f32> = mel_points
        .iter()
        .map(|&mel| mel_to_hz(mel) * N_FFT as f32 / SAMPLE_RATE)
        .collect();

    for m in 0..N_MELS {
        let f_left = bin_points[m];
        let f_center = bin_points[m + 1];
        let f_right = bin_points[m + 2];

        for k in 0..n_fft_bins {
            let k_f = k as f32;
            if k_f >= f_left && k_f <= f_center && f_center > f_left {
                filterbank[[m, k]] = (k_f - f_left) / (f_center - f_left);
            } else if k_f > f_center && k_f <= f_right && f_right > f_center {
                filterbank[[m, k]] = (f_right - k_f) / (f_right - f_center);
            }
        }
    }

    filterbank
}

/// Create Hann window of given length
fn hann_window(length: usize) -> Vec<f32> {
    (0..length)
        .map(|n| {
            0.5 * (1.0 - (2.0 * std::f32::consts::PI * n as f32 / (length - 1) as f32).cos())
        })
        .collect()
}

/// Compute log-mel spectrogram from raw audio samples.
///
/// Input: audio samples at 16kHz mono
/// Output: Array3<f32> shape [1, n_frames, 128] (batch=1, time, mel_bins)
pub fn compute_log_mel_spectrogram(audio: &[f32]) -> Array3<f32> {
    let window = hann_window(WIN_LENGTH);
    let mel_filterbank = create_mel_filterbank();

    // Number of frames
    let n_frames = if audio.len() >= WIN_LENGTH {
        1 + (audio.len() - WIN_LENGTH) / HOP_LENGTH
    } else {
        1
    };

    let n_fft_bins = N_FFT / 2 + 1;

    // STFT
    let mut planner = FftPlanner::new();
    let fft = planner.plan_fft_forward(N_FFT);

    let mut power_spectrogram = Array2::zeros((n_frames, n_fft_bins));

    for frame_idx in 0..n_frames {
        let start = frame_idx * HOP_LENGTH;

        // Prepare FFT input: windowed + zero-padded
        let mut fft_buffer: Vec<Complex<f32>> = vec![Complex::new(0.0, 0.0); N_FFT];
        for i in 0..WIN_LENGTH {
            let sample_idx = start + i;
            let sample = if sample_idx < audio.len() {
                audio[sample_idx]
            } else {
                0.0
            };
            fft_buffer[i] = Complex::new(sample * window[i], 0.0);
        }

        fft.process(&mut fft_buffer);

        // Compute power spectrum (magnitude squared)
        for k in 0..n_fft_bins {
            power_spectrogram[[frame_idx, k]] = fft_buffer[k].norm_sqr();
        }
    }

    // Apply mel filterbank: [n_frames, n_fft_bins] x [n_fft_bins, n_mels] -> [n_frames, n_mels]
    // filterbank is [n_mels, n_fft_bins], so we do power_spec @ filterbank^T
    let mut mel_spectrogram = Array2::zeros((n_frames, N_MELS));
    for t in 0..n_frames {
        for m in 0..N_MELS {
            let mut sum = 0.0f32;
            for k in 0..n_fft_bins {
                sum += power_spectrogram[[t, k]] * mel_filterbank[[m, k]];
            }
            mel_spectrogram[[t, m]] = sum;
        }
    }

    // Log mel spectrogram (with floor to avoid log(0))
    let log_offset = 1e-10_f32;
    mel_spectrogram.mapv_inplace(|x| (x.max(log_offset)).ln());

    // Per-feature normalization (zero mean, unit variance)
    for m in 0..N_MELS {
        let col = mel_spectrogram.column(m);
        let mean = col.mean().unwrap_or(0.0);
        let variance = col.mapv(|x| (x - mean).powi(2)).mean().unwrap_or(1.0);
        let std = variance.sqrt().max(1e-5);

        for t in 0..n_frames {
            mel_spectrogram[[t, m]] = (mel_spectrogram[[t, m]] - mean) / std;
        }
    }

    // Reshape to [1, n_frames, 128]
    mel_spectrogram
        .into_shape_with_order((1, n_frames, N_MELS))
        .expect("Failed to reshape mel spectrogram to [1, n_frames, 128]")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_mel_filterbank_shape() {
        let fb = create_mel_filterbank();
        assert_eq!(fb.shape(), &[N_MELS, N_FFT / 2 + 1]);
    }

    #[test]
    fn test_hann_window() {
        let w = hann_window(WIN_LENGTH);
        assert_eq!(w.len(), WIN_LENGTH);
        // Hann window is 0 at endpoints
        assert!(w[0].abs() < 1e-6);
    }

    #[test]
    fn test_compute_log_mel_spectrogram_shape() {
        // 1 second of silence at 16kHz
        let audio = vec![0.0f32; 16000];
        let result = compute_log_mel_spectrogram(&audio);
        assert_eq!(result.shape()[0], 1); // batch
        assert_eq!(result.shape()[2], N_MELS); // mel bins
        // n_frames = 1 + (16000 - 400) / 160 = 98
        assert_eq!(result.shape()[1], 98);
    }
}
