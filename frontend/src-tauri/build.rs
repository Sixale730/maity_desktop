fn main() {
    // GPU Acceleration Detection and Build Guidance
    detect_and_report_gpu_capabilities();

    // #33 de la auditoría de recursos: los DLLs de DirectX que arrastra ONNX Runtime
    // pasan a delay-load para que no se mapeen en cada arranque.
    configure_windows_delay_load();

    // Build piloto (sep-2026, F4/F5 de la migración por lote): con MAITY_PILOT_BATCH=1
    // `recording_preferences::default_transcription_mode()` devuelve "batch". Declarar la
    // dependencia para que cargo NO reuse un binario compilado con el otro default.
    println!("cargo:rerun-if-env-changed=MAITY_PILOT_BATCH");

    #[cfg(target_os = "macos")]
    {
        println!("cargo:rustc-link-lib=framework=AVFoundation");
        println!("cargo:rustc-link-lib=framework=Cocoa");
        println!("cargo:rustc-link-lib=framework=Foundation");

        // Let the enhanced_macos crate handle its own Swift compilation
        // The swift-rs crate build will be handled in the enhanced_macos crate's build.rs
    }
    tauri_build::build()
}

/// Detects GPU acceleration capabilities and provides build guidance
fn detect_and_report_gpu_capabilities() {
    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();

    println!("cargo:warning=🚀 Building Maity for: {}", target_os);

    match target_os.as_str() {
        "macos" => {
            println!("cargo:warning=✅ macOS: Metal GPU acceleration ENABLED by default");
            #[cfg(feature = "coreml")]
            println!("cargo:warning=✅ CoreML acceleration ENABLED");
        }
        "windows" => {
            if cfg!(feature = "onnx-directml") {
                println!("cargo:warning=✅ Windows: DirectML EP para los motores ONNX ENABLED (feature onnx-directml; solo lo piden Moonshine/Canary)");
            }
            if cfg!(feature = "cuda") {
                println!("cargo:warning=✅ Windows: CUDA GPU acceleration ENABLED");
            } else if cfg!(feature = "vulkan") {
                println!("cargo:warning=✅ Windows: Vulkan GPU acceleration ENABLED");
            } else if cfg!(feature = "openblas") {
                println!("cargo:warning=✅ Windows: OpenBLAS CPU optimization ENABLED");
            } else {
                println!("cargo:warning=⚠️  Windows: Using CPU-only mode (no GPU or BLAS acceleration)");
                println!("cargo:warning=💡 For NVIDIA GPU: cargo build --release --features cuda");
                println!("cargo:warning=💡 For AMD/Intel GPU: cargo build --release --features vulkan");
                println!("cargo:warning=💡 For CPU optimization: cargo build --release --features openblas");

                // Try to detect NVIDIA GPU
                if which::which("nvidia-smi").is_ok() {
                    println!("cargo:warning=🎯 NVIDIA GPU detected! Consider rebuilding with --features cuda");
                }
            }
        }
        "linux" => {
            if cfg!(feature = "cuda") {
                println!("cargo:warning=✅ Linux: CUDA GPU acceleration ENABLED");
            } else if cfg!(feature = "vulkan") {
                println!("cargo:warning=✅ Linux: Vulkan GPU acceleration ENABLED");
            } else if cfg!(feature = "hipblas") {
                println!("cargo:warning=✅ Linux: AMD ROCm (HIP) acceleration ENABLED");
            } else if cfg!(feature = "openblas") {
                println!("cargo:warning=✅ Linux: OpenBLAS CPU optimization ENABLED");
            } else {
                println!("cargo:warning=⚠️  Linux: Using CPU-only mode (no GPU or BLAS acceleration)");
                println!("cargo:warning=💡 For NVIDIA GPU: cargo build --release --features cuda");
                println!("cargo:warning=💡 For AMD GPU: cargo build --release --features hipblas");
                println!("cargo:warning=💡 For other GPUs: cargo build --release --features vulkan");
                println!("cargo:warning=💡 For CPU optimization: cargo build --release --features openblas");

                // Try to detect NVIDIA GPU
                if which::which("nvidia-smi").is_ok() {
                    println!("cargo:warning=🎯 NVIDIA GPU detected! Consider rebuilding with --features cuda");
                }

                // Try to detect AMD GPU
                if which::which("rocm-smi").is_ok() {
                    println!("cargo:warning=🎯 AMD GPU detected! Consider rebuilding with --features hipblas");
                }
            }
        }
        _ => {
            println!("cargo:warning=ℹ️  Unknown platform: {}", target_os);
        }
    }

    // Performance guidance
    if !cfg!(feature = "cuda") && !cfg!(feature = "vulkan") && !cfg!(feature = "hipblas") && !cfg!(feature = "openblas") && target_os != "macos" {
        println!("cargo:warning=📊 Performance: CPU-only builds are significantly slower than GPU/BLAS builds");
        println!("cargo:warning=📚 See README.md for GPU/BLAS setup instructions");
    }
}

/// Delay-load de `DirectML.dll`, `d3d12.dll`, `dxgi.dll` y `dxcore.dll` en Windows/MSVC
/// (#33 de la auditoría de recursos, `docs/AUDITORIA_RECURSOS_2026-09-02.md`; detalle
/// en `docs/ONNX_EXECUTION_PROVIDERS.md`).
///
/// Por qué: el prebuilt estático de ONNX Runtime que baja `ort-sys` (pyke, fila `none`
/// de su `dist.txt` para `x86_64-pc-windows-msvc`) ya trae el provider DirectML
/// compilado dentro, y su `build.rs` enlaza `DXCORE/DXGI/D3D12/DirectML` de forma
/// INCONDICIONAL en Windows — el feature `directml` del crate `ort` NO decide qué
/// código entra al exe, solo si `DirectMLExecutionProvider::register()` tiene cuerpo.
/// Resultado: el exe importaba en tiempo de carga `DMLCreateDevice1`, `D3D12CreateDevice`,
/// `D3D12SerializeVersionedRootSignature`, `CreateDXGIFactory2` y
/// `DXCoreCreateAdapterFactory`, así que Windows mapeaba los cuatro DLLs en cada
/// arranque aunque el motor por defecto (Parakeet) corre en CPU y nadie registre DML.
///
/// Con `/DELAYLOAD` el loader difiere cada DLL hasta la PRIMERA llamada a una de sus
/// funciones, que solo ocurre si un motor registra el EP DirectML (hoy requiere
/// `--features onnx-directml` Y `prefer_gpu: true`). Es exactamente lo que hace el
/// propio ORT en su `onnxruntime.dll` (`cmake/onnxruntime_providers_dml.cmake`,
/// `onnxruntime_ENABLE_DELAY_LOADING_WIN_DLLS`, con `delayimp.lib` + `/ignore:4199`).
///
/// Efecto lateral deseado: un Windows sin `DirectML.dll`/`dxcore.dll` (LTSC/Server
/// viejos) hoy ni siquiera arrancaba la app; con delay-load arranca y solo truena si de
/// verdad se registra DML sin el DLL, cosa que el build por defecto nunca hace.
///
/// `rustc-link-arg` (no `-bins`) para que aplique también a los binarios de `cargo test`,
/// que enlazan el mismo ORT. El guard `frontend/scripts/lint-exe-imports.js` (post-build)
/// falla si alguno de los cuatro vuelve a la tabla de imports de carga.
fn configure_windows_delay_load() {
    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    let target_env = std::env::var("CARGO_CFG_TARGET_ENV").unwrap_or_default();
    if target_os != "windows" || target_env != "msvc" {
        return;
    }
    for dll in ["DirectML.dll", "d3d12.dll", "dxgi.dll", "dxcore.dll"] {
        println!("cargo:rustc-link-arg=/DELAYLOAD:{dll}");
    }
    // LNK4199 "/DELAYLOAD:x.dll ignored; no imports found": inofensivo si un `ort` futuro
    // deja de referenciar alguno; ORT usa el mismo /ignore.
    println!("cargo:rustc-link-arg=/IGNORE:4199");
    // `__delayLoadHelper2`; vive en VC\Tools\MSVC\<ver>\lib\x64, el mismo directorio del
    // que rustc ya toma msvcrt.lib.
    println!("cargo:rustc-link-lib=delayimp");
}
