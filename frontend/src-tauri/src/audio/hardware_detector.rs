use std::sync::OnceLock;
use log::info;

/// Hardware capabilities for audio processing optimization
#[derive(Debug, Clone, PartialEq)]
pub struct HardwareProfile {
    pub cpu_cores: u8,
    pub has_gpu_acceleration: bool,
    pub gpu_type: GpuType,
    pub memory_gb: u8,
    pub performance_tier: PerformanceTier,
}

#[derive(Debug, Clone, PartialEq)]
pub enum GpuType {
    None,
    Metal,      // Apple Silicon
    Cuda,       // NVIDIA
    Vulkan,     // AMD/Intel
    OpenCL,     // Generic GPU compute
}

#[derive(Debug, Clone, PartialEq)]
pub enum PerformanceTier {
    Low,      // CPU-only, limited resources
    Medium,   // CPU-only but powerful, or basic GPU
    High,     // Dedicated GPU with good compute
    Ultra,    // High-end hardware with fast GPU
}

/// Adaptive Whisper configuration based on hardware
#[derive(Debug, Clone)]
pub struct AdaptiveWhisperConfig {
    pub beam_size: usize,
    pub temperature: f32,
    pub use_gpu: bool,
    pub max_threads: Option<usize>,
    pub chunk_size_preference: ChunkSizePreference,
}

#[derive(Debug, Clone, PartialEq)]
pub enum ChunkSizePreference {
    Fast,       // Smaller chunks for responsiveness
    Balanced,   // Medium chunks for balance
    Quality,    // Larger chunks for accuracy
}

static HARDWARE_PROFILE: OnceLock<HardwareProfile> = OnceLock::new();

impl HardwareProfile {
    /// Get the detected hardware profile (cached after first call)
    pub fn detect() -> &'static HardwareProfile {
        HARDWARE_PROFILE.get_or_init(|| {
            let profile = Self::detect_hardware();
            info!("Detected hardware profile: {:?}", profile);
            profile
        })
    }

    /// Perform hardware detection
    fn detect_hardware() -> HardwareProfile {
        let cpu_cores = Self::detect_cpu_cores();
        let (has_gpu_acceleration, gpu_type) = Self::detect_gpu();
        let memory_gb = Self::detect_memory_gb();
        let performance_tier = Self::calculate_performance_tier(cpu_cores, &gpu_type, memory_gb);

        HardwareProfile {
            cpu_cores,
            has_gpu_acceleration,
            gpu_type,
            memory_gb,
            performance_tier,
        }
    }

    /// Detect number of CPU cores
    fn detect_cpu_cores() -> u8 {
        std::thread::available_parallelism()
            .map(|n| n.get().min(255) as u8)
            .unwrap_or(4) // Default to 4 cores
    }

    /// Detect GPU acceleration capabilities
    fn detect_gpu() -> (bool, GpuType) {
        // Override manual para pruebas (parejo con MEMORY_GB): permite simular
        // tier Low en máquinas dev con GPU real. Ej: GPU_TYPE=none MEMORY_GB=8.
        if let Ok(forced) = std::env::var("GPU_TYPE") {
            match forced.to_ascii_lowercase().as_str() {
                "none" | "cpu" => return (false, GpuType::None),
                "cuda" => return (true, GpuType::Cuda),
                "vulkan" => return (true, GpuType::Vulkan),
                "metal" => return (true, GpuType::Metal),
                _ => {}
            }
        }

        // Check for Metal (Apple Silicon)
        #[cfg(target_os = "macos")]
        {
            if Self::has_metal_support() {
                return (true, GpuType::Metal);
            }
        }

        // Check for CUDA (NVIDIA)
        if Self::has_cuda_support() {
            return (true, GpuType::Cuda);
        }

        // Check for Vulkan (AMD/Intel/others)
        if Self::has_vulkan_support() {
            return (true, GpuType::Vulkan);
        }

        // Fallback to CPU-only
        (false, GpuType::None)
    }

    /// Detect available system memory in GB
    fn detect_memory_gb() -> u8 {
        // Override manual para pruebas
        if let Ok(mem_str) = std::env::var("MEMORY_GB") {
            if let Ok(v) = mem_str.parse() {
                return v;
            }
        }
        // RAM real vía sysinfo (misma técnica que summary_engine::get_system_ram_gb).
        // Antes retornaba 8 hardcodeado → máquinas con 28 GB quedaban en tier Low
        // (reporte usuario jul-2026) y las configs adaptativas decidían con datos falsos.
        let mut sys = sysinfo::System::new();
        sys.refresh_memory();
        let gb = sys.total_memory() / (1024 * 1024 * 1024);
        gb.clamp(1, 255) as u8
    }

    /// Calculate performance tier based on hardware
    fn calculate_performance_tier(cpu_cores: u8, gpu_type: &GpuType, memory_gb: u8) -> PerformanceTier {
        match gpu_type {
            // Metal y CUDA comparten piso de RAM: tener GPU no crea memoria de
            // sistema. Hasta ago-2026 estas dos ramas NO tenían piso alguno, así
            // que una laptop de 6 GB con driver NVIDIA salía `High` y recibía el
            // modelo grande — justo el perfil que el piloto Dingler mostró
            // ahogándose (215 avisos de presión de memoria, mínimos de 74 MB
            // libres). La rama Vulkan ya tenía su piso desde jul-2026; esto cierra
            // el mismo agujero para las otras dos.
            GpuType::Metal | GpuType::Cuda => {
                if memory_gb >= 16 && cpu_cores >= 8 {
                    PerformanceTier::Ultra
                } else if memory_gb >= 12 {
                    PerformanceTier::High
                } else if memory_gb >= 8 {
                    PerformanceTier::Medium
                } else {
                    PerformanceTier::Low
                }
            }
            GpuType::Vulkan | GpuType::OpenCL => {
                // vulkan-1.dll existe en casi cualquier Windows con driver
                // gráfico moderno, incluidas iGPU cuya "VRAM" es RAM del
                // sistema COMPARTIDA: detectar Vulkan no implica GPU útil.
                // Con <12 GB de RAM el tier debe ser Low — de eso dependen el
                // fallback del coach a gemma-1b (llama_engine) y que Whisper
                // no duplique pesos en memoria compartida. Antes esta rama
                // nunca daba Low y las máquinas de 8 GB recibían el 4b.
                if memory_gb >= 12 && cpu_cores >= 6 {
                    PerformanceTier::High
                } else if memory_gb >= 12 {
                    PerformanceTier::Medium
                } else {
                    PerformanceTier::Low
                }
            }
            GpuType::None => {
                if cpu_cores >= 8 && memory_gb >= 16 {
                    PerformanceTier::Medium
                } else {
                    PerformanceTier::Low
                }
            }
        }
    }

    #[cfg(target_os = "macos")]
    fn has_metal_support() -> bool {
        // Simple check for Apple Silicon (Metal is available on Intel Macs too, but less optimal for ML)
        std::env::consts::ARCH == "aarch64"
    }

    fn has_cuda_support() -> bool {
        // Windows: nvcuda.dll la instala el DRIVER de NVIDIA (presente con cualquier
        // GPU NVIDIA, sin requerir el CUDA Toolkit). Chequear solo CUDA_PATH producía
        // falsos negativos: una RTX 3060 reportaba gpu=None (reporte usuario jul-2026).
        #[cfg(target_os = "windows")]
        {
            let sysroot = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".to_string());
            if std::path::Path::new(&sysroot).join("System32").join("nvcuda.dll").exists() {
                return true;
            }
        }
        // Entornos de desarrollo / Linux con toolkit instalado
        std::env::var("CUDA_PATH").is_ok() ||
        std::env::var("CUDA_HOME").is_ok() ||
        std::path::Path::new("/usr/local/cuda").exists()
    }

    fn has_vulkan_support() -> bool {
        // Windows: vulkan-1.dll la instalan los drivers de GPU modernos
        // (NVIDIA/AMD/Intel). Señal de que hay una GPU con soporte Vulkan.
        #[cfg(target_os = "windows")]
        {
            let sysroot = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".to_string());
            if std::path::Path::new(&sysroot).join("System32").join("vulkan-1.dll").exists() {
                return true;
            }
        }
        std::env::var("VULKAN_SDK").is_ok() ||
        std::path::Path::new("/usr/lib/x86_64-linux-gnu/libvulkan.so").exists() ||
        std::path::Path::new("/usr/lib/libvulkan.so").exists()
    }

    /// Generate adaptive Whisper configuration based on hardware
    pub fn get_whisper_config(&self) -> AdaptiveWhisperConfig {
        // Windows-specific override: Always use beam size 2 for stability
        #[cfg(target_os = "windows")]
        {
            return AdaptiveWhisperConfig {
                beam_size: 2,
                temperature: 0.2,
                // En tier Low la "GPU" suele ser una iGPU con memoria
                // compartida: el backend Vulkan de whisper duplicaría los
                // pesos en RAM del sistema. La protección Low→CPU del match
                // de abajo solo compila fuera de Windows, así que se replica
                // aquí.
                use_gpu: self.has_gpu_acceleration
                    && self.performance_tier != PerformanceTier::Low,
                max_threads: Some(self.cpu_cores.min(8) as usize),
                chunk_size_preference: ChunkSizePreference::Balanced,
            };
        }

        // Platform-adaptive configuration for non-Windows systems
        #[cfg(not(target_os = "windows"))]
        {
            match self.performance_tier {
                PerformanceTier::Ultra => AdaptiveWhisperConfig {
                    beam_size: 5,  // Maximum quality
                    temperature: 0.1,
                    use_gpu: self.has_gpu_acceleration,
                    max_threads: Some(self.cpu_cores.min(8) as usize),
                    chunk_size_preference: ChunkSizePreference::Quality,
                },
                PerformanceTier::High => AdaptiveWhisperConfig {
                    beam_size: 3,  // High quality
                    temperature: 0.2,
                    use_gpu: self.has_gpu_acceleration,
                    max_threads: Some(self.cpu_cores.min(6) as usize),
                    chunk_size_preference: ChunkSizePreference::Balanced,
                },
                PerformanceTier::Medium => AdaptiveWhisperConfig {
                    beam_size: 2,  // Balanced
                    temperature: 0.3,
                    use_gpu: self.has_gpu_acceleration,
                    max_threads: Some(self.cpu_cores.min(4) as usize),
                    chunk_size_preference: ChunkSizePreference::Balanced,
                },
                PerformanceTier::Low => AdaptiveWhisperConfig {
                    beam_size: 1,  // Fast processing
                    temperature: 0.4,
                    use_gpu: false, // Force CPU to avoid GPU overhead on weak hardware
                    max_threads: Some(2),
                    chunk_size_preference: ChunkSizePreference::Fast,
                },
            }
        }
    }

    /// Get recommended chunk duration in milliseconds based on performance tier
    pub fn get_recommended_chunk_duration_ms(&self) -> u32 {
        match self.performance_tier {
            PerformanceTier::Ultra => 25000,   // 25 seconds for maximum accuracy
            PerformanceTier::High => 20000,    // 20 seconds for high quality
            PerformanceTier::Medium => 15000,  // 15 seconds for balance
            PerformanceTier::Low => 10000,     // 10 seconds for responsiveness
        }
    }

    /// Check if hardware can handle real-time processing of given sample rate
    pub fn can_handle_realtime(&self, sample_rate: u32, channels: u16) -> bool {
        let data_rate = sample_rate * channels as u32;

        match self.performance_tier {
            PerformanceTier::Ultra => data_rate <= 192000, // Up to 192kHz stereo
            PerformanceTier::High => data_rate <= 96000,   // Up to 96kHz stereo or 192kHz mono
            PerformanceTier::Medium => data_rate <= 48000, // Up to 48kHz stereo
            PerformanceTier::Low => data_rate <= 22050,    // Up to 22kHz stereo or 48kHz mono
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hardware_detection() {
        let profile = HardwareProfile::detect();
        assert!(profile.cpu_cores > 0);
        // Performance optimization: remove println! from tests
        log::debug!("Detected profile: {:?}", profile);
    }

    #[test]
    fn test_whisper_config_generation() {
        let profile = HardwareProfile::detect();
        let config = profile.get_whisper_config();

        assert!(config.beam_size >= 1 && config.beam_size <= 5);
        assert!(config.temperature >= 0.0 && config.temperature <= 1.0);

        // Performance optimization: remove println! from tests
        log::debug!("Generated config: {:?}", config);
    }

    #[test]
    fn test_performance_tier_logic() {
        // Test different hardware combinations
        let low_tier = HardwareProfile::calculate_performance_tier(2, &GpuType::None, 4);
        assert_eq!(low_tier, PerformanceTier::Low);

        let high_tier = HardwareProfile::calculate_performance_tier(8, &GpuType::Metal, 16);
        assert_eq!(high_tier, PerformanceTier::Ultra);
    }

    #[test]
    fn test_vulkan_con_poca_ram_es_tier_low() {
        // vulkan-1.dll presente NO implica GPU útil: una laptop de 8 GB con
        // iGPU debe quedar en Low para que el coach elija gemma-1b.
        let tier = HardwareProfile::calculate_performance_tier(8, &GpuType::Vulkan, 8);
        assert_eq!(tier, PerformanceTier::Low);

        // Con RAM suficiente, Vulkan conserva sus tiers históricos.
        let high = HardwareProfile::calculate_performance_tier(8, &GpuType::Vulkan, 16);
        assert_eq!(high, PerformanceTier::High);
        let medium = HardwareProfile::calculate_performance_tier(4, &GpuType::Vulkan, 16);
        assert_eq!(medium, PerformanceTier::Medium);
    }

    #[test]
    fn gpu_dedicada_con_poca_ram_tambien_baja_de_tier() {
        // El agujero que cerró el piloto Dingler: hasta ago-2026 las ramas Cuda y
        // Metal no tenían piso de RAM, así que estas dos máquinas salían `High` y
        // recibían el modelo grande del coach.
        assert_eq!(
            HardwareProfile::calculate_performance_tier(8, &GpuType::Cuda, 6),
            PerformanceTier::Low,
            "6 GB con NVIDIA sigue siendo una máquina de 6 GB"
        );
        assert_eq!(
            HardwareProfile::calculate_performance_tier(8, &GpuType::Metal, 8),
            PerformanceTier::Medium
        );
        assert_eq!(
            HardwareProfile::calculate_performance_tier(4, &GpuType::Cuda, 12),
            PerformanceTier::High
        );
        // Sin regresión en el tope: la GPU dedicada con RAM de sobra sigue Ultra.
        assert_eq!(
            HardwareProfile::calculate_performance_tier(8, &GpuType::Cuda, 32),
            PerformanceTier::Ultra
        );
    }

    #[test]
    fn tier_low_no_usa_llm_para_los_tips() {
        // Contrato entre el tier y el coach: el punto de decisión es único
        // (`coach::should_use_llm_tips`) para que el warmup del arranque y
        // `live_feedback::start` no puedan divergir — divergir dejaría el modelo
        // residente en RAM sin nadie que lo consuma, el peor de los dos mundos.
        for (cores, gpu, ram) in [
            (8u8, GpuType::Cuda, 6u8),
            (8, GpuType::Vulkan, 8),
            (2, GpuType::None, 4),
        ] {
            assert_eq!(
                HardwareProfile::calculate_performance_tier(cores, &gpu, ram),
                PerformanceTier::Low,
                "{:?} con {} GB debe ser Low",
                gpu,
                ram
            );
        }
    }
}