// audio/transcription/onnx_providers.rs
//
// Helper centralizado para construir sesiones ONNX Runtime (`ort`) con el mejor
// execution provider (EP) disponible por plataforma, cayendo a CPU automaticamente.
//
// Por que existe: los 3 engines ONNX (Parakeet, Moonshine, Canary) construian sus
// sesiones a mano, siempre con CPUExecutionProvider. Este helper unifica esa logica
// y habilita GPU sin tocar modelos, descargas ni precision (WER identico):
//   - Windows -> DirectML (cualquier GPU DX12: NVIDIA/AMD/Intel, sin deps del usuario)
//   - macOS   -> CoreML (Apple Silicon / ANE)
//   - resto   -> CPU
//
// ort registra los EP en el orden dado y cae al siguiente (o a CPU) si uno falla
// al registrar o no soporta un operador del grafo; por eso el CPU va SIEMPRE al
// final, garantizando una sesion funcional.
// Docs: https://ort.pyke.io/perf/execution-providers
//
// Nota DirectML: requiere modo de ejecucion secuencial (with_parallel_execution(false))
// y memory pattern desactivado. Docs:
// https://onnxruntime.ai/docs/execution-providers/DirectML-ExecutionProvider.html
//
// Override de soporte/debug: MAITY_ONNX_FORCE_CPU=1 fuerza CPU en todas las sesiones.

use std::path::Path;

use ort::execution_providers::CPUExecutionProvider;
use ort::session::builder::GraphOptimizationLevel;
use ort::session::Session;

// Gateado por target_os (no por `feature`): el feature `directml`/`coreml` es del
// crate `ort`, no de esta app, y se habilita en las dependencias por target del
// Cargo.toml. Por eso el struct existe exactamente en su plataforma.
#[cfg(target_os = "windows")]
use ort::execution_providers::DirectMLExecutionProvider;
#[cfg(target_os = "macos")]
use ort::execution_providers::CoreMLExecutionProvider;

use crate::audio::hardware_detector::HardwareProfile;

/// Plataforma de compilacion, abstraida para poder testear `resolve_plan` sin
/// depender del target real.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[allow(dead_code)] // segun el target, alguna variante no se construye en codigo no-test
pub enum Platform {
    Windows,
    Macos,
    Other,
}

/// Execution provider elegido para una sesion.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EpKind {
    DirectML,
    CoreML,
    Cpu,
}

impl EpKind {
    fn name(self) -> &'static str {
        match self {
            EpKind::DirectML => "DirectML",
            EpKind::CoreML => "CoreML",
            EpKind::Cpu => "CPU",
        }
    }
}

/// Decision resuelta para construir la sesion: que EP usar y los flags de ejecucion.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SessionPlan {
    pub ep: EpKind,
    pub parallel: bool,
    pub disable_memory_pattern: bool,
}

/// Opciones para construir una sesion ONNX.
pub struct OnnxSessionOpts<'a> {
    /// Desactiva la arena del CPUExecutionProvider. `true` para Parakeet/Moonshine
    /// (shapes dinamicos -> la arena acumula buffers y nunca encoge, ver Microsoft
    /// issue #11627); `false` para Canary (mantiene la arena por default, como hoy).
    pub disable_arena: bool,
    /// Permite usar GPU para esta sesion. `false` para sesiones chicas (p.ej. el
    /// preprocessor mel) donde el ida/vuelta CPU<->GPU no compensa.
    pub prefer_gpu: bool,
    /// Etiqueta para logs (p.ej. "parakeet-encoder").
    pub label: &'a str,
}

/// Logica PURA de seleccion de EP y flags de sesion. Sin efectos secundarios ni
/// dependencias de `ort`/hardware/env, para poder testearla en aislamiento.
///
/// Reglas:
/// - Solo se usa GPU si `prefer_gpu` y NO se forzo CPU.
/// - Windows -> DirectML, macOS -> CoreML, resto -> CPU.
/// - DirectML exige ejecucion secuencial (`parallel=false`) y memory pattern off.
/// - Con arena desactivada tambien hay que desactivar memory pattern.
fn resolve_plan(
    platform: Platform,
    prefer_gpu: bool,
    forced_cpu: bool,
    disable_arena: bool,
) -> SessionPlan {
    let use_gpu = prefer_gpu && !forced_cpu;

    let ep = if use_gpu {
        match platform {
            Platform::Windows => EpKind::DirectML,
            Platform::Macos => EpKind::CoreML,
            Platform::Other => EpKind::Cpu,
        }
    } else {
        EpKind::Cpu
    };

    let directml = ep == EpKind::DirectML;

    SessionPlan {
        ep,
        parallel: !directml,
        disable_memory_pattern: disable_arena || directml,
    }
}

/// Parsea el valor de `MAITY_ONNX_FORCE_CPU`. Pura para testear sin tocar el env.
fn parse_force_cpu(val: Option<&str>) -> bool {
    match val {
        Some(v) => v == "1" || v.eq_ignore_ascii_case("true"),
        None => false,
    }
}

/// Indica si el usuario forzo CPU via env var (`MAITY_ONNX_FORCE_CPU=1`).
fn force_cpu() -> bool {
    parse_force_cpu(std::env::var("MAITY_ONNX_FORCE_CPU").ok().as_deref())
}

/// Plataforma de compilacion actual.
fn current_platform() -> Platform {
    #[cfg(target_os = "windows")]
    {
        Platform::Windows
    }
    #[cfg(target_os = "macos")]
    {
        Platform::Macos
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        Platform::Other
    }
}

/// Construye una sesion ONNX para `model_path` con el mejor EP disponible.
///
/// El CPUExecutionProvider siempre va al final de la lista, asi que si el EP de
/// GPU no registra o no soporta un operador, `ort` cae a CPU sin romper la sesion.
pub fn build_session(model_path: &Path, opts: OnnxSessionOpts) -> Result<Session, ort::Error> {
    let hw = HardwareProfile::detect();
    let forced_cpu = force_cpu();
    let plan = resolve_plan(
        current_platform(),
        opts.prefer_gpu,
        forced_cpu,
        opts.disable_arena,
    );

    let mut providers = Vec::new();

    // --- Execution provider de GPU por plataforma (segun el plan) ---
    #[cfg(target_os = "windows")]
    {
        if plan.ep == EpKind::DirectML {
            providers.push(DirectMLExecutionProvider::default().build());
        }
    }
    #[cfg(target_os = "macos")]
    {
        if plan.ep == EpKind::CoreML {
            providers.push(CoreMLExecutionProvider::default().build());
        }
    }

    // --- CPU como fallback (siempre presente, siempre al final) ---
    let cpu = CPUExecutionProvider::default();
    let cpu = if opts.disable_arena {
        cpu.with_arena_allocator(false)
    } else {
        cpu
    };
    providers.push(cpu.build());

    log::info!(
        "ONNX[{}] EP solicitado: {} (gpu_detectada={:?}, force_cpu={}, parallel={})",
        opts.label,
        plan.ep.name(),
        hw.gpu_type,
        forced_cpu,
        plan.parallel,
    );

    let mut builder = Session::builder()?
        .with_optimization_level(GraphOptimizationLevel::Level3)?
        .with_execution_providers(providers)?;

    if plan.disable_memory_pattern {
        // Requerido cuando la arena esta desactivada (shapes dinamicos) y/o con
        // DirectML: memory pattern depende de la arena para optimizar allocations.
        builder = builder.with_memory_pattern(false)?;
    }

    builder = builder.with_parallel_execution(plan.parallel)?;

    builder.commit_from_file(model_path)
}

#[cfg(test)]
mod tests {
    use super::*;

    // ---- resolve_plan: rutas con GPU ----

    #[test]
    fn windows_con_gpu_usa_directml_secuencial() {
        // Parakeet/Moonshine en Windows: DirectML, secuencial, memory pattern off.
        let plan = resolve_plan(Platform::Windows, true, false, true);
        assert_eq!(plan.ep, EpKind::DirectML);
        assert!(!plan.parallel, "DirectML exige ejecucion secuencial");
        assert!(plan.disable_memory_pattern);
    }

    #[test]
    fn windows_canary_directml_desactiva_memory_pattern_aunque_arena_activa() {
        // Canary mantiene arena (disable_arena=false) pero DirectML obliga a
        // desactivar memory pattern de todas formas.
        let plan = resolve_plan(Platform::Windows, true, false, false);
        assert_eq!(plan.ep, EpKind::DirectML);
        assert!(!plan.parallel);
        assert!(plan.disable_memory_pattern, "DirectML fuerza memory pattern off");
    }

    #[test]
    fn macos_con_gpu_usa_coreml_paralelo() {
        // CoreML no exige modo secuencial: parallel sigue activo.
        let plan = resolve_plan(Platform::Macos, true, false, true);
        assert_eq!(plan.ep, EpKind::CoreML);
        assert!(plan.parallel, "CoreML permite ejecucion paralela");
        assert!(plan.disable_memory_pattern, "por disable_arena=true");
    }

    #[test]
    fn macos_canary_coreml_respeta_arena_activa() {
        // Canary en mac: CoreML, arena activa -> memory pattern se mantiene (no off).
        let plan = resolve_plan(Platform::Macos, true, false, false);
        assert_eq!(plan.ep, EpKind::CoreML);
        assert!(plan.parallel);
        assert!(!plan.disable_memory_pattern);
    }

    // ---- resolve_plan: rutas CPU ----

    #[test]
    fn force_cpu_anula_gpu_en_cualquier_plataforma() {
        for platform in [Platform::Windows, Platform::Macos, Platform::Other] {
            let plan = resolve_plan(platform, true, true, true);
            assert_eq!(plan.ep, EpKind::Cpu, "forced_cpu debe ganar en {platform:?}");
            assert!(plan.parallel, "CPU permite paralelo");
            assert!(plan.disable_memory_pattern, "por disable_arena=true");
        }
    }

    #[test]
    fn prefer_gpu_false_usa_cpu_preprocessor() {
        // El preprocessor mel pasa prefer_gpu=false aun en Windows.
        let plan = resolve_plan(Platform::Windows, false, false, true);
        assert_eq!(plan.ep, EpKind::Cpu);
        assert!(plan.parallel);
        assert!(plan.disable_memory_pattern);
    }

    #[test]
    fn linux_siempre_cpu() {
        let plan = resolve_plan(Platform::Other, true, false, true);
        assert_eq!(plan.ep, EpKind::Cpu);
        assert!(plan.parallel);
        assert!(plan.disable_memory_pattern);
    }

    #[test]
    fn cpu_respeta_disable_arena_false() {
        // Sin GPU y con arena activa: memory pattern NO se desactiva.
        let plan = resolve_plan(Platform::Other, false, false, false);
        assert_eq!(plan.ep, EpKind::Cpu);
        assert!(plan.parallel);
        assert!(!plan.disable_memory_pattern);
    }

    // ---- parse_force_cpu ----

    #[test]
    fn parse_force_cpu_reconoce_valores_truthy() {
        assert!(parse_force_cpu(Some("1")));
        assert!(parse_force_cpu(Some("true")));
        assert!(parse_force_cpu(Some("TRUE")));
        assert!(parse_force_cpu(Some("True")));
    }

    #[test]
    fn parse_force_cpu_rechaza_otros_valores() {
        assert!(!parse_force_cpu(None));
        assert!(!parse_force_cpu(Some("")));
        assert!(!parse_force_cpu(Some("0")));
        assert!(!parse_force_cpu(Some("false")));
        assert!(!parse_force_cpu(Some("yes")));
    }

    // ---- EpKind::name ----

    #[test]
    fn ep_kind_name_es_estable() {
        assert_eq!(EpKind::DirectML.name(), "DirectML");
        assert_eq!(EpKind::CoreML.name(), "CoreML");
        assert_eq!(EpKind::Cpu.name(), "CPU");
    }
}
